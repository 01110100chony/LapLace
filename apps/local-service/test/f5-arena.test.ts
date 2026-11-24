import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openCatalog } from "../src/catalog.ts";
import { createArenaService } from "../src/arena-service.ts";
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
  "F5-M01.A1: Arena paralela executa da mesma base em worktrees isoladas, bloqueia codex_cli_isolated, exige revisao pareada e invalida divergencia de base",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repo = await env.repository("Arena-F5");
    git(repo, "config", "core.autocrlf", "false");
    await writeFile(join(repo, "base.txt"), "base-inicial-v1\n");
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "Base Arena F5");

    const gitBefore = await readGitInvariantSnapshot(repo);
    let client = env.start(env.dataDir);
    const added = await client.request("workspace.addLocal", { path: repo });
    const identity = await client.request("project.identity", {
      projectId: added.id,
    });
    const scope = identity.scope;

    // 1. Invariante INV-07 preservado (F4-M02.A2): codex_cli_isolated permanece bloqueado por politica.
    await assert.rejects(
      client.request("arena.sessionCreate", {
        ...scope,
        requestId: "req-arena-blocked",
        title: "Sessao bloqueada isolated",
        objective: "Nao deve liberar backend bloqueado",
        backendMode: "codex_cli_isolated",
        humanConfirmed: true,
        criteria: {
          sharedObjective: "Comparar solucoes",
          items: [{ criterionId: "crit-1", label: "Corretude", weight: 1 }],
        },
        hypotheses: [
          {
            hypothesisId: "hyp-a",
            label: "Hipotese A",
            summary: "Abordagem A",
            targetPaths: ["hyp-a.txt"],
            proposedEdits: [
              { path: "hyp-a.txt", action: "create", content: "A\n" },
            ],
            mockBehavior: "complete",
          },
          {
            hypothesisId: "hyp-b",
            label: "Hipotese B",
            summary: "Abordagem B",
            targetPaths: ["hyp-b.txt"],
            proposedEdits: [
              { path: "hyp-b.txt", action: "create", content: "B\n" },
            ],
            mockBehavior: "complete",
          },
        ],
      }),
      { message: "execution_backend_blocked" },
    );

    // 2. Cria e executa Arena offline com >=2 hipoteses a partir da mesma base Git.
    const created = await client.request("arena.sessionCreate", {
      ...scope,
      requestId: "req-arena-ok",
      title: "Comparar estrategias de cache",
      objective: "Comparar implementacoes alternativas sem mutar o checkout",
      backendMode: "mock_supervised",
      humanConfirmed: true,
      criteria: {
        sharedObjective: "Mesmo objetivo e mesmos criterios",
        items: [
          { criterionId: "correctness", label: "Corretude", weight: 2 },
          { criterionId: "simplicity", label: "Simplicidade", weight: 1 },
        ],
      },
      hypotheses: [
        {
          hypothesisId: "hyp-a",
          label: "Estrategia A (arquivo dedicado A)",
          summary: "Cria a.txt deterministico",
          targetPaths: ["a.txt"],
          proposedEdits: [
            { path: "a.txt", action: "create", content: "estrategia-A\n" },
          ],
          mockBehavior: "complete",
        },
        {
          hypothesisId: "hyp-b",
          label: "Estrategia B (modifica base)",
          summary: "Atualiza base.txt em worktree propria",
          targetPaths: ["base.txt"],
          proposedEdits: [
            {
              path: "base.txt",
              action: "modify",
              content: "base-inicial-v1\nestrategia-B\n",
            },
          ],
          mockBehavior: "complete",
        },
      ],
    });
    assert.equal(created.status, "created");
    assert.equal(created.hypotheses.length, 2);

    const ran = await client.request("arena.sessionRun", {
      ...scope,
      sessionId: created.sessionId,
      humanConfirmed: true,
    });
    assert.equal(ran.status, "ready_for_review");
    const [hA, hB] = ran.hypotheses;
    assert.ok(hA && hB);
    assert.equal(hA.state, "completed");
    assert.equal(hB.state, "completed");
    assert.ok(hA.dedicatedWorktreeId && hB.dedicatedWorktreeId);
    assert.notEqual(hA.dedicatedWorktreeId, hB.dedicatedWorktreeId);
    assert.notEqual(hA.dedicatedRoot, hB.dedicatedRoot);
    assert.ok(hA.diffDigest && hB.diffDigest);
    assert.notEqual(hA.diffDigest, hB.diffDigest);
    assert.ok(hA.sourceRefs.some((ref) => ref.kind === "diff"));
    assert.ok(hB.sourceRefs.some((ref) => ref.kind === "diff"));
    assert.ok(hA.diffFiles.some((file) => file.path === "a.txt"));
    assert.ok(hB.diffFiles.some((file) => file.path === "base.txt"));
    assert.equal(ran.appliedToLocal, false);

    // Origem Git continua 100% intacta (INV-04 / INV-08).
    const gitAfterRun = await readGitInvariantSnapshot(repo);
    assert.deepEqual(gitAfterRun, gitBefore);
    assert.equal(existsSync(join(repo, "a.txt")), false);

    // 3. Revisao pareada incompleta (duplicada sem cobrir todas as hipoteses) eh formalmente rejeitada.
    await assert.rejects(
      client.request("arena.sessionReview", {
        ...scope,
        sessionId: created.sessionId,
        requestId: "req-review-incomplete",
        outcome: "winner_selected",
        winnerHypothesisId: "hyp-a",
        reviewer: "Revisor F5",
        rationale: "Faltando revisao efetiva da hipotese B",
        reviewedHypothesisIds: ["hyp-a", "hyp-a"],
        criterionScores: [
          { hypothesisId: "hyp-a", criterionId: "correctness", score: 5 },
          { hypothesisId: "hyp-a", criterionId: "simplicity", score: 4 },
        ],
        evidenceRefs: [hA.diffDigest!],
        humanConfirmed: true,
      }),
      { message: "arena_review_incomplete" },
    );

    // 4. Revisao pareada completa persiste e continua nao-aplicada automaticamente.
    const reviewed = await client.request("arena.sessionReview", {
      ...scope,
      sessionId: created.sessionId,
      requestId: "req-review-full",
      outcome: "winner_selected",
      winnerHypothesisId: "hyp-a",
      reviewer: "Revisor F5",
      rationale: "Hipotese A isola alteracao sem conflito com base.txt.",
      reviewedHypothesisIds: ["hyp-a", "hyp-b"],
      criterionScores: [
        { hypothesisId: "hyp-a", criterionId: "correctness", score: 5 },
        { hypothesisId: "hyp-a", criterionId: "simplicity", score: 5 },
        { hypothesisId: "hyp-b", criterionId: "correctness", score: 4 },
        { hypothesisId: "hyp-b", criterionId: "simplicity", score: 3 },
      ],
      evidenceRefs: [hA.diffDigest!, hB.diffDigest!],
      humanConfirmed: true,
    });
    assert.equal(reviewed.status, "reviewed");
    assert.equal(reviewed.appliedToLocal, false);
    assert.equal(reviewed.pairedReview?.winnerHypothesisId, "hyp-a");
    assert.equal(reviewed.pairedReview?.appliedToLocal, false);

    // Reinicia sidecar e confirma persistencia completa.
    await client.close();
    client = env.start(env.dataDir);
    const persisted = await client.request("arena.sessionGet", {
      ...scope,
      sessionId: created.sessionId,
    });
    assert.equal(persisted.status, "reviewed");
    assert.equal(persisted.pairedReview?.outcome, "winner_selected");
    assert.equal(persisted.hypotheses.length, 2);
    const listed = await client.request("arena.sessionList", scope);
    assert.equal(listed.items.length, 1);
    await client.close();

    // 5. Divergencia de base entre hipoteses durante execucao invalida o ensaio formalmente.
    const catalog = openCatalog(env.dataDir);
    const withCatalog = <T>(op: (store: typeof catalog) => T): T => op(catalog);
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
      const arenaDirect = createArenaService({
        withCatalog,
        plannerService: planner,
        plannerSupervisor: supervisor,
        beforeHypothesisRunHook: async (ordinal, originRoot) => {
          if (ordinal === 1) {
            await writeFile(join(originRoot, "drift.txt"), "mudanca externa\n");
            git(originRoot, "add", "drift.txt");
            git(originRoot, "commit", "--quiet", "-m", "Drift entre hipoteses");
          }
        },
      });

      const divergeSession = await arenaDirect.sessionCreate({
        ...scope,
        requestId: "req-arena-diverge",
        title: "Sessao com drift no meio",
        objective: "Detectar divergencia de base entre hipoteses",
        backendMode: "mock_supervised",
        humanConfirmed: true,
        criteria: {
          sharedObjective: "Mesma base obrigatoria",
          items: [{ criterionId: "crit-1", label: "Qualidade", weight: 1 }],
        },
        hypotheses: [
          {
            hypothesisId: "d-a",
            label: "Hipotese D-A",
            summary: "Primeira",
            targetPaths: ["da.txt"],
            proposedEdits: [
              { path: "da.txt", action: "create", content: "da\n" },
            ],
            mockBehavior: "complete",
          },
          {
            hypothesisId: "d-b",
            label: "Hipotese D-B",
            summary: "Segunda apos drift",
            targetPaths: ["db.txt"],
            proposedEdits: [
              { path: "db.txt", action: "create", content: "db\n" },
            ],
            mockBehavior: "complete",
          },
        ],
      });
      const invalidated = await arenaDirect.sessionRun({
        ...scope,
        sessionId: divergeSession.sessionId,
        humanConfirmed: true,
      });
      assert.equal(invalidated.status, "invalidated");
      assert.equal(
        invalidated.invalidationReason,
        "invalidated_base_divergence",
      );
      assert.throws(
        () =>
          arenaDirect.sessionReview({
            ...scope,
            sessionId: divergeSession.sessionId,
            requestId: "req-review-invalid",
            outcome: "tie",
            winnerHypothesisId: null,
            reviewer: "Revisor",
            rationale: "Nao pode aprovar sessao invalidada",
            reviewedHypothesisIds: ["d-a", "d-b"],
            criterionScores: [
              { hypothesisId: "d-a", criterionId: "crit-1", score: 3 },
              { hypothesisId: "d-b", criterionId: "crit-1", score: 3 },
            ],
            evidenceRefs: [],
            humanConfirmed: true,
          }),
        { message: "arena_base_divergence" },
      );
    } finally {
      await supervisor.close();
      catalog.close();
    }
  },
);
