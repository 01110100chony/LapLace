import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openCatalog } from "../src/catalog.ts";
import { createDirtyOverlayService } from "../src/dirty-overlay-service.ts";
import { createPlannerService } from "../src/planner-service.ts";
import { PlannerSupervisor } from "../src/planner-supervisor.ts";
import { createSessionGrantService } from "../src/session-grant-store.ts";
import {
  fixture,
  git,
  readGitInvariantSnapshot,
} from "./fixtures/ipc-harness.ts";

test(
  "F4-M02.A1 / F4-M02.A2: worktree dedicada isolada, bloqueio LPAC, multiplas tentativas, cancelamento de arvore e recuperacao pos-reinicio",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repo = await env.repository("planner-exec-repo");
    await writeFile(join(repo, "app.txt"), "inicial\n", "utf8");
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "Base");

    const client = env.start();
    const added = await client.request("workspace.addLocal", { path: repo });
    const identity = await client.request("project.identity", {
      projectId: added.id,
    });
    const scope = identity.scope;

    // 1. Fronteira LPAC permanece bloqueada enquanto nao houver prova completa (INV-07).
    const boundary = await client.request("planner.boundaryStatus", scope);
    assert.equal(boundary.lpacVerified, false);
    assert.equal(boundary.strictBackendAllowed, false);
    assert.match(boundary.lpacDetail, /0xc0000142/);

    const blockedPlan = await client.request("planner.planCreate", {
      ...scope,
      requestId: "req-exec-blocked-plan",
      title: "Plano codex isolado",
      objective: "Deve ser bloqueado pela politica LPAC",
      operationKind: "agent_supervised",
      backendMode: "codex_cli_isolated",
      targetPaths: ["app.txt"],
    });
    assert.equal(blockedPlan.status, "blocked");
    await assert.rejects(
      client.request("planner.grantIssue", {
        ...scope,
        planId: blockedPlan.planId,
        expectedBaseDigest: blockedPlan.baseDigest,
        backendMode: "codex_cli_isolated",
        allowedEffects: ["create_worktree", "run_agent"],
        humanConfirmed: true,
      }),
      /execution_backend_blocked/,
    );

    // 2. Execucao mock supervisionada cria worktree dedicada preservando origem intacta.
    const snapshotBefore = await readGitInvariantSnapshot(repo);
    const plan1 = await client.request("planner.planCreate", {
      ...scope,
      requestId: "req-exec-plan-1",
      title: "Editar em worktree isolada",
      objective: "Escrever app.txt apenas na worktree dedicada",
      operationKind: "worktree_edit",
      backendMode: "mock_supervised",
      targetPaths: ["app.txt"],
      proposedEdits: [
        { path: "app.txt", action: "modify", content: "na-worktree\n" },
      ],
    });
    const grant1 = await client.request("planner.grantIssue", {
      ...scope,
      planId: plan1.planId,
      expectedBaseDigest: plan1.baseDigest,
      backendMode: "mock_supervised",
      allowedEffects: ["create_worktree", "write_worktree", "apply_local"],
      humanConfirmed: true,
    });
    const exec1 = await client.request("planner.executionStart", {
      ...scope,
      requestId: "req-exec-start-1",
      planId: plan1.planId,
      grantId: grant1.grantId,
      expectedBaseDigest: plan1.baseDigest,
      mockBehavior: "complete",
    });
    assert.notEqual(exec1.dedicatedRoot, repo);

    let settled1 = exec1;
    for (
      let i = 0;
      i < 40 &&
      (settled1.state === "running" || settled1.state === "cancelling");
      i++
    ) {
      await new Promise((r) => setTimeout(r, 50));
      const page = await client.request("planner.executionEvents", {
        ...scope,
        executionId: exec1.executionId,
        afterSeq: 0,
      });
      settled1 = page.execution;
    }
    assert.equal(settled1.state, "completed");
    assert.ok(settled1.diffDigest);
    assert.equal(await readFile(join(repo, "app.txt"), "utf8"), "inicial\n");
    assert.deepEqual(await readGitInvariantSnapshot(repo), snapshotBefore);

    // 3. Execucao pendente sobrevive a crash e e conciliada como interrupted sem reexecucao automatica.
    const planHold = await client.request("planner.planCreate", {
      ...scope,
      requestId: "req-exec-plan-hold",
      title: "Hold para testar queda do sidecar",
      objective: "Interromper ao reiniciar",
      operationKind: "worktree_edit",
      backendMode: "mock_supervised",
      targetPaths: ["hold.txt"],
      proposedEdits: [
        { path: "hold.txt", action: "create", content: "held\n" },
      ],
    });
    const grantHold = await client.request("planner.grantIssue", {
      ...scope,
      planId: planHold.planId,
      expectedBaseDigest: planHold.baseDigest,
      backendMode: "mock_supervised",
      allowedEffects: ["create_worktree", "write_worktree"],
      humanConfirmed: true,
    });
    const execHold = await client.request("planner.executionStart", {
      ...scope,
      requestId: "req-exec-start-hold",
      planId: planHold.planId,
      grantId: grantHold.grantId,
      expectedBaseDigest: planHold.baseDigest,
      mockBehavior: "hold_for_cancel",
    });

    await client.crash();

    const reopened = env.start();
    const afterCrash = await reopened.request("planner.executionList", {
      ...scope,
      planId: planHold.planId,
    });
    const recovered = afterCrash.items.find(
      (item) => item.executionId === execHold.executionId,
    );
    assert.ok(recovered);
    assert.equal(recovered.state, "interrupted");
    assert.equal(recovered.recoveredAfterRestart, true);
    assert.equal(recovered.failureCode, "sidecar_restarted");

    // Limpeza de worktree remove pasta dedicada preservando historico e diff.
    const cleanup = await reopened.request("planner.worktreeCleanup", {
      ...scope,
      executionId: exec1.executionId,
      humanConfirmed: true,
    });
    assert.equal(cleanup.status, "cleaned");
    assert.equal(cleanup.historyPreserved, true);
    assert.equal(existsSync(exec1.dedicatedRoot), false);
    const preservedDiff = await reopened.request("planner.diffGet", {
      ...scope,
      executionId: exec1.executionId,
    });
    assert.equal(preservedDiff.diffDigest, settled1.diffDigest);

    await reopened.close();

    // 4. Cancelamento de processo filho real + multiplas tentativas simultaneas em servico direto.
    const directCatalog = openCatalog(env.dataDir);
    const withCatalog = <T>(op: (store: typeof directCatalog) => T): T =>
      op(directCatalog);
    const grants = createSessionGrantService({ withCatalog });
    const dirtyOverlay = createDirtyOverlayService({
      withCatalog,
      contextOptions: () => ({
        signal: new AbortController().signal,
        protectedRoots: [env.dataDir],
        exclusions: [],
      }),
      dataDir: env.dataDir,
    });
    const supervisor = new PlannerSupervisor({
      withCatalog,
      grants,
      dataDir: env.dataDir,
      mcpEntry: "mcp-stdio.ts",
      protectedRoots: () => [env.dataDir, repo],
    });
    try {
      const planner = createPlannerService({
        withCatalog,
        dirtyOverlayService: dirtyOverlay,
        supervisor,
        protectedRoots: () => [env.dataDir, repo],
      });

      const procPlan = await planner.planCreate({
        ...scope,
        requestId: "req-proc-plan-1",
        title: "Processo local longo",
        objective: "Cancelar arvore real",
        operationKind: "worktree_edit",
        backendMode: "local_process_job",
        targetPaths: ["app.txt"],
      });
      const procGrant = await planner.grantIssue({
        ...scope,
        planId: procPlan.planId,
        expectedBaseDigest: procPlan.baseDigest,
        backendMode: "local_process_job",
        allowedEffects: ["create_worktree", "write_worktree"],
        humanConfirmed: true,
      });
      const procExec = await planner.executionStart({
        ...scope,
        requestId: "req-proc-start-1",
        planId: procPlan.planId,
        grantId: procGrant.grantId,
        expectedBaseDigest: procPlan.baseDigest,
        commandArgv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      });

      let childPid: number | null = null;
      for (let i = 0; i < 40 && !childPid; i++) {
        await new Promise((r) => setTimeout(r, 50));
        childPid =
          directCatalog.f4.getExecution(scope, procExec.executionId)
            ?.childPid ?? null;
      }
      assert.ok(
        childPid && childPid > 0,
        "expected real childPid to be persisted",
      );

      planner.executionCancel({
        ...scope,
        executionId: procExec.executionId,
        humanConfirmed: true,
      });
      await supervisor.waitForCompletion(scope, procExec.executionId);
      const ended = directCatalog.f4.getExecution(scope, procExec.executionId)!;
      assert.equal(ended.state, "cancelled");

      await new Promise((r) => setTimeout(r, 100));
      assert.throws(() => process.kill(childPid!, 0), /ESRCH/);

      await planner.worktreeCleanup({
        ...scope,
        executionId: procExec.executionId,
        humanConfirmed: true,
      });
    } finally {
      await supervisor.close();
      directCatalog.close();
    }
  },
);
