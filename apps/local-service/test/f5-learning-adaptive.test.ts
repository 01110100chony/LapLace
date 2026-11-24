import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { adaptiveDefaultBaselineVersion } from "@laplace/contracts";
import { fixture, git } from "./fixtures/ipc-harness.ts";

test(
  "F5-M03.A1 / A2: BKM deduplica origens correlacionadas, permite ativacao/reversao e Adaptive Gate exige ganho held-out sem vazamento ou regressao",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repo = await env.repository("Learning-BKM-F5");
    git(repo, "config", "core.autocrlf", "false");
    await writeFile(join(repo, "README.md"), "# BKM F5\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "base bkm");

    let client = env.start(env.dataDir);
    const project = await client.request("workspace.addLocal", { path: repo });
    const scope = (
      await client.request("project.identity", { projectId: project.id })
    ).scope;

    // Seed real f3_local_feedback via memory.inboxSubmit + memory.inboxReview.
    const proposal = await client.request("memory.inboxSubmit", {
      ...scope,
      title: "Priorizar guias de autenticacao",
      content: "Arquivos em docs/auth devem subir para consultas de token.",
      targetKind: "claim",
      originLabel: "revisao-local",
    });
    const reviewed = await client.request("memory.inboxReview", {
      ...scope,
      proposalId: proposal.proposalId,
      decision: "approve",
      reviewer: "Operador",
      note: "Regra valida para ranking simbolico",
      humanConfirmed: true,
    });

    // 1. Duas hipoteses concorrentes com eventos repetidos da mesma originKey (anti-inflacao).
    const hWinner = await client.request("learning.hypothesisUpsert", {
      ...scope,
      requestId: "bkm-upsert-1",
      hypothesisId: "bkm-auth-win",
      competingGroupKey: "auth-ranking",
      category: "retrieval_boost",
      title: "Priorizar docs/auth para consultas de token e oauth",
      statement:
        "Quando consultar token/oauth, reforcar docs/auth canonicos e recentes.",
      pattern: {
        keywords: ["token", "oauth", "sessao"],
        pathPrefixes: ["docs/auth/"],
        boostWeight: 3.5,
        preferCanonical: true,
        preferRecent: true,
      },
      evidence: [
        {
          polarity: "support",
          originKey: "origin-dup-feedback",
          originKind: "inbox_feedback",
          sourceRefId: reviewed.feedback.feedbackId,
          weight: 2,
          note: "Evento 1 da origem duplicada",
        },
        {
          polarity: "support",
          originKey: "origin-dup-feedback",
          originKind: "inbox_feedback",
          sourceRefId: reviewed.feedback.feedbackId,
          weight: 2,
          note: "Evento 2 correlacionado da mesma origem",
        },
        {
          polarity: "support",
          originKey: "origin-dup-feedback",
          originKind: "inbox_feedback",
          sourceRefId: reviewed.feedback.feedbackId,
          weight: 2,
          note: "Evento 3 correlacionado da mesma origem",
        },
        {
          polarity: "support",
          originKey: "origin-review-2",
          originKind: "review",
          sourceRefId: "rev-auth-2",
          weight: 1.5,
          note: "Segunda origem independente",
        },
      ],
    });
    assert.equal(hWinner.rawSupportEvents, 4);
    assert.equal(hWinner.independentSupportOrigins, 2);

    const hCompetitor = await client.request("learning.hypothesisUpsert", {
      ...scope,
      requestId: "bkm-upsert-2",
      hypothesisId: "bkm-auth-alt",
      competingGroupKey: "auth-ranking",
      category: "path_affinity",
      title: "Competidora inicial para ranking",
      statement: "Regra alternativa concorrente.",
      pattern: {
        keywords: ["token"],
        pathPrefixes: ["src/legacy/"],
        boostWeight: 1,
        preferCanonical: false,
        preferRecent: false,
      },
      evidence: [
        {
          polarity: "support",
          originKey: "origin-comp-1",
          originKind: "manual",
          weight: 1,
          note: "Suporte inicial",
        },
        {
          polarity: "oppose",
          originKey: "origin-comp-opp",
          originKind: "review",
          weight: 1.5,
          note: "Contra-evidencia",
        },
      ],
    });

    // Ativa competidora e depois supera pela vencedora com humanConfirmed.
    await client.request("learning.hypothesisTransition", {
      ...scope,
      hypothesisId: hCompetitor.hypothesisId,
      toState: "active",
      reason: "Teste inicial",
      reviewer: "Operador",
      humanConfirmed: true,
    });
    const activated = await client.request("learning.hypothesisTransition", {
      ...scope,
      hypothesisId: hWinner.hypothesisId,
      toState: "active",
      reason: "Maior suporte independente no grupo",
      reviewer: "Operador",
      supersedeCompetitors: true,
      humanConfirmed: true,
    });
    assert.equal(activated.state, "active");

    const afterActivateList = await client.request(
      "learning.hypothesisList",
      scope,
    );
    const oldActive = afterActivateList.items.find(
      (h) => h.hypothesisId === hCompetitor.hypothesisId,
    );
    assert.equal(oldActive?.state, "superseded");

    // Reversao temporaria e reativacao para comprovar reversibilidade BKM.
    const reverted = await client.request("learning.hypothesisTransition", {
      ...scope,
      hypothesisId: hWinner.hypothesisId,
      toState: "reverted",
      reason: "Teste de reversibilidade",
      reviewer: "Operador",
      humanConfirmed: true,
    });
    assert.equal(reverted.state, "reverted");
    await client.request("learning.hypothesisTransition", {
      ...scope,
      hypothesisId: hWinner.hypothesisId,
      toState: "active",
      reason: "Reativado para avaliacao held-out",
      reviewer: "Operador",
      humanConfirmed: true,
    });

    const splitAt = new Date(Date.now() + 5_000).toISOString();
    const heldOutAt = new Date(Date.now() + 60_000).toISOString();

    // 2. Avaliacao com vazamento / split invalido deve manter baseline FTS5 e bloquear ativacao.
    const failedEval = await client.request("learning.evaluateAdaptive", {
      ...scope,
      requestId: "eval-fail-1",
      splitBoundaryAt: splitAt,
      heldOutCases: [
        {
          caseId: "case-leak-1",
          query: "token oauth",
          queryAt: "2026-03-15T00:00:00.000Z", // pre-split -> temporal_split_invalid
          topK: 1,
          candidates: [
            {
              itemId: "leak-secret",
              scope: {
                projectId: "f".repeat(64),
                bindingId: scope.bindingId,
                worktreeId: scope.worktreeId,
              },
              path: "docs/auth/secret.md",
              title: "Token vazado",
              text: "token oauth segredo",
              recordedAt: heldOutAt,
              validAt: heldOutAt,
              isCurrent: true,
              isMandatory: false,
              isCanonical: true,
              isSecretOrCanary: true,
              ftsScore: 5.0,
              isRelevant: false,
            },
          ],
        },
      ],
    });
    assert.equal(failedEval.decision, "stay_on_baseline");
    assert.ok(failedEval.failedGates.includes("insufficient_held_out_cases"));
    assert.ok(failedEval.failedGates.includes("temporal_split_invalid"));
    // Vazamento zero mesmo sob candidatos maliciosos cross-scope/canary.
    assert.equal(failedEval.adaptiveMetrics.leakageCount, 0);

    await assert.rejects(
      client.request("learning.strategyActivate", {
        ...scope,
        mode: "adaptive_symbolic",
        evaluationId: failedEval.evaluationId,
        reviewer: "Operador",
        reason: "Tentativa indevida com avaliacao reprovada",
        humanConfirmed: true,
      }),
      { message: "adaptive_gate_rejected" },
    );

    // 3. Avaliacao held-out limpa onde BKM supera FTS5 em >= +0.05 mantendo 100% obrigatorios e 0 vazamentos.
    const cleanEval = await client.request("learning.evaluateAdaptive", {
      ...scope,
      requestId: "eval-pass-1",
      splitBoundaryAt: splitAt,
      heldOutCases: [
        {
          caseId: "case-1",
          query: "token oauth",
          queryAt: heldOutAt,
          topK: 1,
          candidates: [
            {
              itemId: "noise-1",
              scope,
              path: "src/old/auth.ts",
              title: "Arquivo antigo",
              text: "token antigo",
              recordedAt: heldOutAt,
              validAt: heldOutAt,
              isCurrent: false,
              isMandatory: false,
              isCanonical: false,
              isSecretOrCanary: false,
              ftsScore: 3.0,
              isRelevant: false,
            },
            {
              itemId: "gold-1",
              scope,
              path: "docs/auth/oauth.md",
              title: "Guia oficial token oauth",
              text: "Fluxo completo de token oauth e sessao",
              recordedAt: heldOutAt,
              validAt: heldOutAt,
              isCurrent: true,
              isMandatory: false,
              isCanonical: true,
              isSecretOrCanary: false,
              ftsScore: 2.0,
              isRelevant: true,
            },
          ],
        },
        {
          caseId: "case-2",
          query: "sessao token",
          queryAt: heldOutAt,
          topK: 1,
          candidates: [
            {
              itemId: "noise-2",
              scope,
              path: "misc/notes.txt",
              title: "Anotacao avulsa",
              text: "sessao token rascunho",
              recordedAt: heldOutAt,
              validAt: heldOutAt,
              isCurrent: false,
              isMandatory: false,
              isCanonical: false,
              isSecretOrCanary: false,
              ftsScore: 3.2,
              isRelevant: false,
            },
            {
              itemId: "gold-2",
              scope,
              path: "docs/auth/session.md",
              title: "Sessao e token renovado",
              text: "Regra canonica para sessao e token",
              recordedAt: heldOutAt,
              validAt: heldOutAt,
              isCurrent: true,
              isMandatory: false,
              isCanonical: true,
              isSecretOrCanary: false,
              ftsScore: 2.1,
              isRelevant: true,
            },
          ],
        },
        {
          caseId: "case-3",
          query: "oauth sessao",
          queryAt: heldOutAt,
          topK: 1,
          candidates: [
            {
              itemId: "gold-3",
              scope,
              path: "docs/auth/overview.md",
              title: "Visao geral oauth sessao",
              text: "Contrato atual oauth sessao",
              recordedAt: heldOutAt,
              validAt: heldOutAt,
              isCurrent: true,
              isMandatory: true,
              isCanonical: true,
              isSecretOrCanary: false,
              ftsScore: 4.0,
              isRelevant: true,
            },
            {
              itemId: "noise-3",
              scope,
              path: "tmp/draft.md",
              title: "Rascunho",
              text: "oauth",
              recordedAt: heldOutAt,
              validAt: heldOutAt,
              isCurrent: false,
              isMandatory: false,
              isCanonical: false,
              isSecretOrCanary: false,
              ftsScore: 1.0,
              isRelevant: false,
            },
          ],
        },
      ],
    });
    assert.equal(cleanEval.decision, "eligible_for_activation");
    assert.deepEqual(cleanEval.failedGates, []);
    assert.equal(cleanEval.adaptiveMetrics.leakageCount, 0);
    assert.equal(cleanEval.adaptiveMetrics.mandatoryPreservation, 1);
    assert.ok(cleanEval.recallGain >= 0.05);
    assert.ok(
      cleanEval.explanations.some((e) =>
        e.appliedHypothesisIds.includes("bkm-auth-win"),
      ),
    );

    // 4. Ativa estrategia adaptativa, reinicia sidecar e valida persistencia + rollback instantaneo.
    const activatedStrategy = await client.request(
      "learning.strategyActivate",
      {
        ...scope,
        mode: "adaptive_symbolic",
        evaluationId: cleanEval.evaluationId,
        reviewer: "Operador",
        reason: "Gate F5-M03.A2 aprovado no held-out",
        humanConfirmed: true,
      },
    );
    assert.equal(activatedStrategy.activeMode, "adaptive_symbolic");

    await client.close();
    client = env.start(env.dataDir);
    const persistedStatus = await client.request(
      "learning.strategyStatus",
      scope,
    );
    assert.equal(persistedStatus.activeMode, "adaptive_symbolic");
    assert.equal(persistedStatus.evaluationId, cleanEval.evaluationId);

    const rolledBack = await client.request("learning.strategyActivate", {
      ...scope,
      mode: "rollback_to_baseline",
      reviewer: "Operador",
      reason: "Voltar para baseline FTS5",
      humanConfirmed: true,
    });
    assert.equal(rolledBack.activeMode, "baseline_fts5");
    assert.equal(rolledBack.activeVersion, adaptiveDefaultBaselineVersion);
    await client.close();
  },
);
