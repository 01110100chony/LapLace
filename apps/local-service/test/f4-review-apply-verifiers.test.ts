import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openCatalog } from "../src/catalog.ts";
import { createDirtyOverlayService } from "../src/dirty-overlay-service.ts";
import { createPlannerService } from "../src/planner-service.ts";
import { PlannerSupervisor } from "../src/planner-supervisor.ts";
import { createSessionGrantService } from "../src/session-grant-store.ts";
import { fixture, git } from "./fixtures/ipc-harness.ts";

test(
  "F4-M03.A1 / A2 / A3: diff verificavel, revisao persistida, applyLocal com DirtyOverlay + OCC + CRLF + rollback e verificadores assinados por digest",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repo = await env.repository("planner-review-apply-repo");
    git(repo, "config", "core.autocrlf", "false");
    await writeFile(
      join(repo, "crlf.txt"),
      Buffer.from("um\r\ndois\r\n", "utf8"),
    );
    await writeFile(join(repo, "second.txt"), Buffer.from("b-0\n", "utf8"));
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "Base CRLF");

    const client = env.start();
    const added = await client.request("workspace.addLocal", { path: repo });
    const identity = await client.request("project.identity", {
      projectId: added.id,
    });
    const scope = identity.scope;

    // 1. Executa edicao com CRLF explicito na worktree dedicada.
    const plan = await client.request("planner.planCreate", {
      ...scope,
      requestId: "req-m03-plan",
      title: "Atualizar CRLF e criar nota",
      objective: "Preservar bytes CRLF exatamente na aplicacao local",
      operationKind: "worktree_edit",
      backendMode: "mock_supervised",
      targetPaths: ["crlf.txt", "nova.txt"],
      proposedEdits: [
        { path: "crlf.txt", action: "modify", content: "um\r\natualizado\r\n" },
        { path: "nova.txt", action: "create", content: "conteudo\r\nnovo\r\n" },
      ],
    });
    const grant = await client.request("planner.grantIssue", {
      ...scope,
      planId: plan.planId,
      expectedBaseDigest: plan.baseDigest,
      backendMode: "mock_supervised",
      allowedEffects: ["create_worktree", "write_worktree", "apply_local"],
      humanConfirmed: true,
    });
    const exec = await client.request("planner.executionStart", {
      ...scope,
      requestId: "req-m03-exec",
      planId: plan.planId,
      grantId: grant.grantId,
      expectedBaseDigest: plan.baseDigest,
      mockBehavior: "complete",
    });

    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const p = await client.request("planner.executionEvents", {
        ...scope,
        executionId: exec.executionId,
        afterSeq: 0,
      });
      if (p.execution.state === "completed") break;
    }

    // Reinicia catalogo para provar persistencia do diff e da revisao (.A1).
    await client.close();
    const secondClient = env.start();

    const diff = await secondClient.request("planner.diffGet", {
      ...scope,
      executionId: exec.executionId,
    });
    assert.equal(diff.files.length, 2);
    const crlfEntry = diff.files.find((f) => f.path === "crlf.txt")!;
    assert.equal(crlfEntry.beforeCrlf, true);
    assert.equal(crlfEntry.afterCrlf, true);

    const rejected = await secondClient.request("planner.diffReview", {
      ...scope,
      requestId: "req-rev-reject",
      executionId: exec.executionId,
      expectedDiffDigest: diff.diffDigest,
      expectedRevision: 0,
      choice: "rejected",
      reviewer: "alice",
      note: "Precisa revisar",
      humanConfirmed: true,
    });
    assert.equal(rejected.appliedToLocal, false);
    assert.equal(rejected.review.revision, 1);

    await secondClient.close();
    const thirdClient = env.start();
    const diffAfterRestart = await thirdClient.request("planner.diffGet", {
      ...scope,
      executionId: exec.executionId,
    });
    assert.equal(diffAfterRestart.latestReview?.choice, "rejected");

    // Aplicar sem aprovacao nem confirmacao falha (.A2).
    await assert.rejects(
      thirdClient.request("planner.applyLocal", {
        ...scope,
        requestId: "req-apply-unapproved",
        executionId: exec.executionId,
        grantId: grant.grantId,
        expectedDiffDigest: diff.diffDigest,
        applyConfirmed: false,
      }),
      /apply_not_approved/,
    );

    const approved = await thirdClient.request("planner.diffReview", {
      ...scope,
      requestId: "req-rev-approve",
      executionId: exec.executionId,
      expectedDiffDigest: diff.diffDigest,
      expectedRevision: 1,
      choice: "approved",
      reviewer: "alice",
      note: "Aprovado para aplicacao posterior",
      humanConfirmed: true,
    });
    assert.equal(approved.appliedToLocal, false);
    assert.deepEqual(
      await readFile(join(repo, "crlf.txt")),
      Buffer.from("um\r\ndois\r\n", "utf8"),
    );

    // Edicao externa concorrente bloqueia applyLocal sem sobrescrever alteracao do usuario.
    await writeFile(
      join(repo, "crlf.txt"),
      Buffer.from("usuario-externo\r\n", "utf8"),
    );
    await assert.rejects(
      thirdClient.request("planner.applyLocal", {
        ...scope,
        requestId: "req-apply-conflict",
        executionId: exec.executionId,
        grantId: grant.grantId,
        expectedDiffDigest: diff.diffDigest,
        applyConfirmed: true,
      }),
      /apply_conflict_detected/,
    );
    assert.deepEqual(
      await readFile(join(repo, "crlf.txt")),
      Buffer.from("usuario-externo\r\n", "utf8"),
    );

    // Restaura base original -> applyLocal captura DirtyOverlay preventivo e preserva CRLF.
    await writeFile(
      join(repo, "crlf.txt"),
      Buffer.from("um\r\ndois\r\n", "utf8"),
    );
    const applied = await thirdClient.request("planner.applyLocal", {
      ...scope,
      requestId: "req-apply-ok",
      executionId: exec.executionId,
      grantId: grant.grantId,
      expectedDiffDigest: diff.diffDigest,
      applyConfirmed: true,
    });
    assert.equal(applied.status, "applied");
    assert.ok(applied.backupOverlayId);
    assert.deepEqual(
      await readFile(join(repo, "crlf.txt")),
      Buffer.from("um\r\natualizado\r\n", "utf8"),
    );
    assert.deepEqual(
      await readFile(join(repo, "nova.txt")),
      Buffer.from("conteudo\r\nnovo\r\n", "utf8"),
    );

    const verifiedOverlay = await thirdClient.request("memory.overlayVerify", {
      ...scope,
      overlayId: applied.backupOverlayId,
    });
    assert.equal(verifiedOverlay.intact, true);

    await thirdClient.close();

    // 2. Rollback de falha parcial durante escrita + Verificadores com whitelist e auto-revogacao (.A2/.A3).
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
      git(repo, "add", ".");
      git(repo, "commit", "--quiet", "-m", "Apos applyLocal ok");

      let failOnPath: string | null = null;
      const service = createPlannerService({
        withCatalog,
        dirtyOverlayService: dirtyOverlay,
        supervisor,
        protectedRoots: () => [env.dataDir, repo],
        env: {
          ...process.env,
          SAFE_TOKEN: "ok-42",
          LAPLACE_SECRET_CANARY: "must-not-leak",
        },
        beforeFileWriteHook: async (targetPath) => {
          if (failOnPath === targetPath) {
            throw new Error("Simulated EACCES partial failure");
          }
        },
      });

      const p2 = await service.planCreate({
        ...scope,
        requestId: "req-rollback-plan",
        title: "Plano 2 arquivos para testar rollback",
        objective: "Falhar no segundo arquivo",
        operationKind: "worktree_edit",
        backendMode: "mock_supervised",
        targetPaths: ["crlf.txt", "second.txt"],
        proposedEdits: [
          { path: "crlf.txt", action: "modify", content: "parcial-1\n" },
          { path: "second.txt", action: "modify", content: "parcial-2\n" },
        ],
      });
      const g2 = await service.grantIssue({
        ...scope,
        planId: p2.planId,
        expectedBaseDigest: p2.baseDigest,
        backendMode: "mock_supervised",
        allowedEffects: ["create_worktree", "write_worktree", "apply_local"],
        humanConfirmed: true,
      });
      const ex2 = await service.executionStart({
        ...scope,
        requestId: "req-rollback-exec",
        planId: p2.planId,
        grantId: g2.grantId,
        expectedBaseDigest: p2.baseDigest,
        mockBehavior: "complete",
      });
      await supervisor.waitForCompletion(scope, ex2.executionId);
      const df2 = service.diffGet(scope, ex2.executionId);
      service.diffReview({
        ...scope,
        requestId: "req-rollback-rev",
        executionId: ex2.executionId,
        expectedDiffDigest: df2.diffDigest,
        expectedRevision: 0,
        choice: "approved",
        reviewer: "alice",
        note: "Aprovar para ensaio de rollback",
        humanConfirmed: true,
      });

      failOnPath = "second.txt";
      await assert.rejects(
        service.applyLocal({
          ...scope,
          requestId: "req-rollback-apply",
          executionId: ex2.executionId,
          grantId: g2.grantId,
          expectedDiffDigest: df2.diffDigest,
          applyConfirmed: true,
        }),
        /apply_conflict_detected/,
      );
      assert.deepEqual(
        await readFile(join(repo, "crlf.txt")),
        Buffer.from("um\r\natualizado\r\n", "utf8"),
      );

      // Verificador (.A3): envWhitelist isola canario e edicao de 1 byte auto-revoga aprovacao.
      const def = service.verifierDefine({
        ...scope,
        definitionId: "verif-env",
        label: "Check env whitelist",
        argv: [
          process.execPath,
          "-e",
          "process.stdout.write(JSON.stringify({ safe: process.env.SAFE_TOKEN ?? null, secret: process.env.LAPLACE_SECRET_CANARY ?? null }))",
        ],
        cwdRelative: ".",
        envWhitelist: ["SAFE_TOKEN"],
        timeoutMs: 5_000,
        privilegeProfile: "readonly_check",
      });
      assert.equal(def.approvalStatus, "pending");

      await assert.rejects(
        service.verifierRun({
          ...scope,
          requestId: "req-vrun-unapproved",
          definitionId: def.definitionId,
          expectedDefinitionDigest: def.definitionDigest,
        }),
        /verifier_approval_invalid/,
      );

      const approvedDef = service.verifierApprove({
        ...scope,
        definitionId: def.definitionId,
        expectedDefinitionDigest: def.definitionDigest,
        reviewer: "alice",
        humanConfirmed: true,
      });
      assert.equal(approvedDef.approvalStatus, "approved");

      const runResult = await service.verifierRun({
        ...scope,
        requestId: "req-vrun-ok",
        definitionId: def.definitionId,
        expectedDefinitionDigest: approvedDef.definitionDigest,
      });
      assert.equal(runResult.state, "passed");
      assert.equal(runResult.exitCode, 0);
      assert.deepEqual(JSON.parse(runResult.stdoutExcerpt), {
        safe: "ok-42",
        secret: null,
      });

      // Redefinir timeout em 1ms revoga automaticamente a aprovacao anterior.
      const redefined = service.verifierDefine({
        ...scope,
        definitionId: def.definitionId,
        label: "Check env whitelist",
        argv: def.argv,
        cwdRelative: ".",
        envWhitelist: ["SAFE_TOKEN"],
        timeoutMs: 5_001,
        privilegeProfile: "readonly_check",
      });
      assert.equal(redefined.approvalStatus, "revoked_by_redefinition");
      assert.equal(redefined.approvedDigest, null);
      assert.notEqual(redefined.definitionDigest, approvedDef.definitionDigest);

      await assert.rejects(
        service.verifierRun({
          ...scope,
          requestId: "req-vrun-revoked-old",
          definitionId: def.definitionId,
          expectedDefinitionDigest: approvedDef.definitionDigest,
        }),
        /verifier_approval_invalid/,
      );
      await assert.rejects(
        service.verifierRun({
          ...scope,
          requestId: "req-vrun-revoked-new",
          definitionId: def.definitionId,
          expectedDefinitionDigest: redefined.definitionDigest,
        }),
        /verifier_approval_invalid/,
      );

      await service.worktreeCleanup({
        ...scope,
        executionId: ex2.executionId,
        humanConfirmed: true,
      });
    } finally {
      await supervisor.close();
      directCatalog.close();
    }
  },
);
