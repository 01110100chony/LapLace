import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  BkmHypothesisRecord,
  HeldOutEvalCase,
  PlannerGitBase,
  ReplayQueryResult,
} from "@laplace/contracts";
import {
  buildReplayVersionPoints,
  canTransitionBkmState,
  classifyReplayGaps,
  computeArenaCriteriaDigest,
  computeGitBaseDigest,
  computeProactivityTelemetry,
  diffReplayStates,
  evaluateAdaptiveStrategy,
  evaluateProactiveSignals,
  evaluateScheduleWindow,
  summarizeBkmHypothesis,
  validateArenaBaseEquivalence,
  validateArenaPairedReview,
} from "../src/index.ts";

const scopeA = {
  projectId: "a".repeat(64),
  bindingId: "b".repeat(64),
  worktreeId: "c".repeat(64),
};
const scopeB = {
  projectId: "1".repeat(64),
  bindingId: "2".repeat(64),
  worktreeId: "3".repeat(64),
};

function makeBase(head = "1".repeat(40)): PlannerGitBase {
  return {
    head,
    branch: "main",
    indexStamp: "idx-10-100",
    worktreeRoot: "C:\\Repo",
    dirtyDigest: "0".repeat(64),
  };
}

test("F5-M01: Arena valida equivalencia estrita de base e revisao pareada completa", () => {
  const base = makeBase();
  const baseDigest = computeGitBaseDigest(base);
  const criteria = {
    sharedObjective: "Melhorar isolamento de cache",
    items: [
      { criterionId: "safety", label: "Seguranca", weight: 2 },
      { criterionId: "clarity", label: "Clareza", weight: 1 },
    ],
  };
  const criteriaDigest = computeArenaCriteriaDigest(
    "Comparar duas abordagens",
    criteria,
  );

  const okEquivalence = validateArenaBaseEquivalence({
    sessionBase: base,
    sessionBaseDigest: baseDigest,
    sessionCriteriaDigest: criteriaDigest,
    hypotheses: [
      {
        hypothesisId: "h1",
        observedBaseHead: base.head,
        observedBaseIndexStamp: base.indexStamp,
        observedBaseDigest: baseDigest,
        criteriaDigest,
        state: "completed",
      },
      {
        hypothesisId: "h2",
        observedBaseHead: base.head,
        observedBaseIndexStamp: base.indexStamp,
        observedBaseDigest: baseDigest,
        criteriaDigest,
        state: "completed",
      },
    ],
  });
  assert.equal(okEquivalence.valid, true);

  const divergent = validateArenaBaseEquivalence({
    sessionBase: base,
    sessionBaseDigest: baseDigest,
    sessionCriteriaDigest: criteriaDigest,
    hypotheses: [
      {
        hypothesisId: "h1",
        observedBaseHead: base.head,
        observedBaseIndexStamp: base.indexStamp,
        observedBaseDigest: baseDigest,
        criteriaDigest,
        state: "completed",
      },
      {
        hypothesisId: "h2",
        observedBaseHead: "2".repeat(40),
        observedBaseIndexStamp: base.indexStamp,
        observedBaseDigest: baseDigest,
        criteriaDigest,
        state: "completed",
      },
    ],
  });
  assert.equal(divergent.valid, false);
  assert.equal(divergent.reason, "invalidated_base_divergence");
  assert.deepEqual(divergent.divergentHypothesisIds, ["h2"]);

  const incompleteReview = validateArenaPairedReview({
    sessionStatus: "ready_for_review",
    invalidationReason: null,
    criteria,
    hypotheses: [
      {
        hypothesisId: "h1",
        state: "completed",
        diffDigest: "d".repeat(64),
        sourceRefs: [],
      },
      {
        hypothesisId: "h2",
        state: "completed",
        diffDigest: "e".repeat(64),
        sourceRefs: [],
      },
    ],
    review: {
      outcome: "winner_selected",
      winnerHypothesisId: "h1",
      reviewedHypothesisIds: ["h1"],
      criterionScores: [],
    },
  });
  assert.equal(incompleteReview.valid, false);
  assert.equal(incompleteReview.errorCode, "arena_review_incomplete");

  const validReview = validateArenaPairedReview({
    sessionStatus: "ready_for_review",
    invalidationReason: null,
    criteria,
    hypotheses: [
      {
        hypothesisId: "h1",
        state: "completed",
        diffDigest: "d".repeat(64),
        sourceRefs: [],
      },
      {
        hypothesisId: "h2",
        state: "completed",
        diffDigest: "e".repeat(64),
        sourceRefs: [],
      },
    ],
    review: {
      outcome: "winner_selected",
      winnerHypothesisId: "h1",
      reviewedHypothesisIds: ["h1", "h2"],
      criterionScores: [
        { hypothesisId: "h1", criterionId: "safety", score: 9 },
        { hypothesisId: "h2", criterionId: "safety", score: 6 },
      ],
    },
  });
  assert.equal(validReview.valid, true);
});

test("F5-M02: Replay classifica lacunas, ordena timeline e calcula diff entre dois pontos V/K", () => {
  const gaps = classifyReplayGaps({
    knownAt: "2026-11-20T12:00:00.000Z",
    claimTombstones: [
      {
        targetId: "claim-purged",
        purgedAt: "2026-11-19T10:00:00.000Z",
        targetKind: "claim",
      },
    ],
    decisionTombstones: [
      {
        assertionId: "d".repeat(64),
        purgedAt: "2026-11-19T11:00:00.000Z",
      },
    ],
    evidenceGaps: [
      {
        targetKind: "pin",
        targetId: "pin-1",
        reason: "cas_missing",
        recordedAt: "2026-11-18T10:00:00.000Z",
      },
    ],
    postKnowledgeCount: 2,
  });
  assert.equal(gaps.length, 4);
  assert.ok(gaps.some((g) => g.kind === "purged_tombstone"));
  assert.ok(gaps.some((g) => g.kind === "unpinned_cas_missing"));
  assert.ok(gaps.some((g) => g.kind === "not_yet_known"));

  const stateA: ReplayQueryResult = {
    scope: scopeA,
    validAt: "2026-11-10T00:00:00.000Z",
    knownAt: "2026-11-10T00:00:00.000Z",
    claims: [],
    decisions: [
      {
        assertionId: "a1",
        revisionId: "r1",
        revision: 1,
        content: "Regra inicial",
        author: "Autor",
        authority: "human_local",
        visibility: "local_only",
        status: "active",
        effectiveAt: "2026-11-01T00:00:00.000Z",
        recordedAt: "2026-11-01T00:00:00.000Z",
        evidenceState: "none",
        evidenceDigest: null,
        evidenceGapReason: null,
      },
    ],
    relations: [],
    conflicts: [],
    gaps: [],
    deliveries: [],
    versionTimeline: [],
  };
  const stateB: ReplayQueryResult = {
    ...stateA,
    validAt: "2026-11-20T00:00:00.000Z",
    knownAt: "2026-11-20T00:00:00.000Z",
    decisions: [
      {
        ...stateA.decisions[0]!,
        revisionId: "r2",
        revision: 2,
        content: "Regra revisada",
        recordedAt: "2026-11-15T00:00:00.000Z",
      },
    ],
    gaps,
  };
  const diff = diffReplayStates(stateA, stateB);
  assert.equal(diff.changedDecisions.length, 1);
  assert.equal(diff.changedDecisions[0]?.before.revision, 1);
  assert.equal(diff.changedDecisions[0]?.after.revision, 2);
  assert.equal(diff.newGaps.length, 4);

  const timeline = buildReplayVersionPoints({
    claims: [],
    decisions: stateB.decisions,
    deliveries: [],
    gaps,
  });
  assert.ok(timeline.length >= 3);
});

test("F5-M03: BKM agrupa origens correlacionadas e avaliador held-out decide entre promocao e stay_on_baseline", () => {
  const summary = summarizeBkmHypothesis([
    {
      evidenceId: "e1",
      polarity: "support",
      originKey: "sessao-repetida",
      originKind: "inbox_feedback",
      sourceRefId: "p1",
      weight: 1,
      note: "Evento 1",
      recordedAt: "2026-11-01T10:00:00.000Z",
    },
    {
      evidenceId: "e2",
      polarity: "support",
      originKey: "sessao-repetida",
      originKind: "inbox_feedback",
      sourceRefId: "p1",
      weight: 1,
      note: "Evento 2 repetido da mesma origem",
      recordedAt: "2026-11-01T10:01:00.000Z",
    },
    {
      evidenceId: "e3",
      polarity: "support",
      originKey: "sessao-repetida",
      originKind: "inbox_feedback",
      sourceRefId: "p1",
      weight: 1,
      note: "Evento 3 repetido da mesma origem",
      recordedAt: "2026-11-01T10:02:00.000Z",
    },
    {
      evidenceId: "e4",
      polarity: "oppose",
      originKey: "revisao-independente",
      originKind: "review",
      sourceRefId: null,
      weight: 1,
      note: "Contraexemplo independente",
      recordedAt: "2026-11-02T10:00:00.000Z",
    },
  ]);
  assert.equal(summary.rawSupportEvents, 3);
  assert.equal(summary.independentSupportOrigins, 1);
  assert.equal(summary.independentOpposeOrigins, 1);
  assert.equal(summary.netScore, 0);
  assert.equal(canTransitionBkmState("purged", "active"), false);
  assert.equal(canTransitionBkmState("active", "reverted"), true);

  const activeHypothesis: BkmHypothesisRecord = {
    scope: scopeA,
    hypothesisId: "bkm-auth-recency",
    competingGroupKey: "auth-ranking",
    category: "retrieval_boost",
    title: "Priorizar guias vigentes em src/auth",
    statement: "Boost em docs vigentes sob src/auth",
    pattern: {
      keywords: ["auth", "token"],
      pathPrefixes: ["src/auth/"],
      boostWeight: 6,
      preferCanonical: true,
      preferRecent: true,
    },
    state: "active",
    independentSupportOrigins: 2,
    independentOpposeOrigins: 0,
    rawSupportEvents: 2,
    rawOpposeEvents: 0,
    netScore: 2,
    originGroups: [],
    evidence: [
      {
        evidenceId: "ev-train",
        polarity: "support",
        originKey: "train-1",
        originKind: "review",
        sourceRefId: null,
        weight: 1,
        note: "Treino anterior ao corte",
        recordedAt: "2026-11-10T00:00:00.000Z",
      },
    ],
    transitions: [],
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
  };

  const makeCase = (caseId: string, queryAt: string): HeldOutEvalCase => ({
    caseId,
    query: "auth token policy",
    queryAt,
    topK: 2,
    candidates: [
      {
        itemId: "mandatory-rule",
        scope: scopeA,
        path: "docs/invariants.md",
        title: "Invariante obrigatorio",
        text: "Regra obrigatoria do projeto",
        recordedAt: "2026-11-01T00:00:00.000Z",
        validAt: "2026-11-01T00:00:00.000Z",
        isCurrent: true,
        isMandatory: true,
        isCanonical: true,
        isSecretOrCanary: false,
        ftsScore: 5,
        isRelevant: true,
      },
      {
        itemId: "stale-noise",
        scope: scopeA,
        path: "legacy/old-notes.md",
        title: "auth token antigo",
        text: "auth token obsoleto com FTS alto",
        recordedAt: "2026-11-01T00:00:00.000Z",
        validAt: "2026-11-01T00:00:00.000Z",
        isCurrent: false,
        isMandatory: false,
        isCanonical: false,
        isSecretOrCanary: false,
        ftsScore: 9,
        isRelevant: false,
      },
      {
        itemId: "current-auth",
        scope: scopeA,
        path: "src/auth/policy.ts",
        title: "auth token vigente",
        text: "auth token atual canonico",
        recordedAt: "2026-11-16T00:00:00.000Z",
        validAt: "2026-11-16T00:00:00.000Z",
        isCurrent: true,
        isMandatory: false,
        isCanonical: true,
        isSecretOrCanary: false,
        ftsScore: 6,
        isRelevant: true,
      },
      {
        itemId: "cross-project-leak",
        scope: scopeB,
        path: "src/auth/secret.ts",
        title: "auth token projeto B",
        text: "auth token de outro projeto",
        recordedAt: "2026-11-16T00:00:00.000Z",
        validAt: "2026-11-16T00:00:00.000Z",
        isCurrent: true,
        isMandatory: false,
        isCanonical: true,
        isSecretOrCanary: false,
        ftsScore: 50,
        isRelevant: false,
      },
    ],
  });

  const winningRun = evaluateAdaptiveStrategy({
    scope: scopeA,
    evaluationId: "eval-win-1",
    requestId: "req-eval-win-1",
    splitBoundaryAt: "2026-11-15T00:00:00.000Z",
    activeHypotheses: [activeHypothesis],
    heldOutCases: [
      makeCase("c1", "2026-11-16T00:00:00.000Z"),
      makeCase("c2", "2026-11-17T00:00:00.000Z"),
      makeCase("c3", "2026-11-18T00:00:00.000Z"),
    ],
    evaluatedAt: "2026-11-19T00:00:00.000Z",
  });
  assert.equal(winningRun.decision, "eligible_for_activation");
  assert.equal(winningRun.failedGates.length, 0);
  assert.equal(winningRun.adaptiveMetrics.leakageCount, 0);
  assert.equal(winningRun.adaptiveMetrics.mandatoryPreservation, 1);
  assert.ok(winningRun.recallGain >= 0.05);

  // Without matching hypotheses, adaptive matches baseline => zero gain => stay_on_baseline
  const noGainRun = evaluateAdaptiveStrategy({
    scope: scopeA,
    evaluationId: "eval-lose-1",
    requestId: "req-eval-lose-1",
    splitBoundaryAt: "2026-11-15T00:00:00.000Z",
    activeHypotheses: [],
    heldOutCases: [
      makeCase("c1", "2026-11-16T00:00:00.000Z"),
      makeCase("c2", "2026-11-17T00:00:00.000Z"),
      makeCase("c3", "2026-11-18T00:00:00.000Z"),
    ],
    evaluatedAt: "2026-11-19T00:00:00.000Z",
  });
  assert.equal(noGainRun.decision, "stay_on_baseline");
  assert.ok(noGainRun.failedGates.includes("insufficient_recall_gain"));
});

test("F5-M04: Proatividade calcula prioridade sem efeito automatico e respeita janelas UTC", () => {
  const suggestions = evaluateProactiveSignals({
    scope: scopeA,
    nowIso: "2026-11-24T10:00:00.000Z",
    signals: [
      {
        signalKind: "bitemporal_conflict",
        subjectId: "auth-policy",
        title: "Conflito bitemporal em auth-policy",
        rationale: "Duas revisoes vigentes contraditorias",
        baseWeight: 80,
        sourceRefs: [{ kind: "claim", id: "c1", detail: "require vs forbid" }],
        proposedAction: {
          kind: "resolve_conflict",
          label: "Abrir revisao bitemporal",
          targetSection: "memory",
        },
      },
      {
        signalKind: "planner_drift",
        subjectId: "plan-1",
        title: "Drift no plano",
        rationale: "HEAD alterado",
        baseWeight: 60,
        sourceRefs: [
          {
            kind: "planner_plan",
            id: "plan-1",
            detail: "invalidated_by_drift",
          },
        ],
        proposedAction: {
          kind: "rerun_preflight",
          label: "Revalidar Pre-Flight",
          targetSection: "planner",
        },
      },
    ],
  });
  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0]?.autoExecutable, false);
  assert.equal(suggestions[0]?.priorityBand, "critical");

  const telemetry = computeProactivityTelemetry([
    {
      eventKind: "evaluated",
      estimatedManualSeconds: 0,
      estimatedSavedSeconds: 0,
    },
    {
      eventKind: "accepted",
      estimatedManualSeconds: 180,
      estimatedSavedSeconds: 120,
    },
    {
      eventKind: "dismissed",
      estimatedManualSeconds: 0,
      estimatedSavedSeconds: 0,
    },
  ]);
  assert.equal(telemetry.utilityRate, 0.5);
  assert.equal(telemetry.estimatedSavedSeconds, 120);

  const inWindow = evaluateScheduleWindow(
    {
      scheduleId: "sched-1",
      optInActive: true,
      status: "active",
      windowStartUtc: "09:00",
      windowEndUtc: "12:00",
      allowedDaysUtc: [2], // Tuesday 2026-11-24
      minIntervalMinutes: 30,
      appClosedMode: "disabled_deferred",
    },
    "2026-11-24T10:15:00.000Z",
  );
  assert.equal(inWindow.allowed, true);

  const outWindow = evaluateScheduleWindow(
    {
      scheduleId: "sched-1",
      optInActive: true,
      status: "active",
      windowStartUtc: "09:00",
      windowEndUtc: "12:00",
      allowedDaysUtc: [2],
      minIntervalMinutes: 30,
      appClosedMode: "disabled_deferred",
    },
    "2026-11-24T15:00:00.000Z",
  );
  assert.equal(outWindow.allowed, false);
  assert.equal(outWindow.reason, "outside_time_window");
});
