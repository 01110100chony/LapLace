import {
  adaptiveDefaultBaselineVersion,
  adaptiveDefaultMaxComputeCostMs,
  adaptiveDefaultMinRecallGain,
  adaptiveDefaultStrategyVersion,
  type AdaptiveGateFailure,
  type AdaptiveRankingExplanation,
  type ArenaCriteria,
  type ArenaHypothesisRecord,
  type ArenaInvalidationReason,
  type ArenaPairedReview,
  type ArenaSessionStatus,
  type BkmCategory,
  type BkmEvidenceRecord,
  type BkmHypothesisRecord,
  type BkmHypothesisState,
  type BkmOriginGroup,
  type BkmPattern,
  type EvaluationMetrics,
  type EvaluationRunRecord,
  type HeldOutCandidateItem,
  type HeldOutEvalCase,
  type IdentityScope,
  type PlannerGitBase,
  type ProactiveScheduleRecord,
  type ProactiveSignalKind,
  type ProactiveSourceRef,
  type ProactiveSuggestionRecord,
  type ProactivityTelemetrySummary,
  type ReplayClaimEntry,
  type ReplayDecisionEntry,
  type ReplayDeliverySummary,
  type ReplayGap,
  type ReplayQueryResult,
  type ReplayVersionPoint,
} from "@laplace/contracts";
import { canonicalJson, sha256Hex } from "./hash.ts";

function compareAsc(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameScope(left: IdentityScope, right: IdentityScope): boolean {
  return (
    left.projectId === right.projectId &&
    left.bindingId === right.bindingId &&
    left.worktreeId === right.worktreeId
  );
}

// ---- F5-M01: Arena Base Equivalence & Paired Review Validation ----

export function computeArenaCriteriaDigest(
  objective: string,
  criteria: ArenaCriteria,
): string {
  const sortedItems = [...criteria.items].sort((a, b) =>
    compareAsc(a.criterionId, b.criterionId),
  );
  return sha256Hex(
    canonicalJson({
      objective: objective.trim(),
      sharedObjective: criteria.sharedObjective.trim(),
      items: sortedItems.map((item) => ({
        criterionId: item.criterionId,
        label: item.label.trim(),
        weight: item.weight,
      })),
    }),
  );
}

export function validateArenaBaseEquivalence(input: {
  sessionBase: PlannerGitBase;
  sessionBaseDigest: string;
  sessionCriteriaDigest: string;
  hypotheses: readonly Pick<
    ArenaHypothesisRecord,
    | "hypothesisId"
    | "observedBaseHead"
    | "observedBaseIndexStamp"
    | "observedBaseDigest"
    | "criteriaDigest"
    | "state"
  >[];
}): {
  valid: boolean;
  reason: ArenaInvalidationReason | null;
  divergentHypothesisIds: string[];
  detail: string | null;
} {
  if (input.hypotheses.length < 2) {
    return {
      valid: false,
      reason: "invalidated_criteria_mismatch",
      divergentHypothesisIds: [],
      detail: "Arena exige pelo menos duas hipoteses concorrentes.",
    };
  }

  const criteriaMismatch: string[] = [];
  const baseDivergence: string[] = [];

  for (const h of input.hypotheses) {
    if (h.criteriaDigest !== input.sessionCriteriaDigest) {
      criteriaMismatch.push(h.hypothesisId);
    }
    if (
      h.observedBaseHead !== null &&
      h.observedBaseHead !== input.sessionBase.head
    ) {
      baseDivergence.push(h.hypothesisId);
      continue;
    }
    if (
      h.observedBaseIndexStamp !== null &&
      h.observedBaseIndexStamp !== input.sessionBase.indexStamp
    ) {
      baseDivergence.push(h.hypothesisId);
      continue;
    }
    if (
      h.observedBaseDigest !== null &&
      h.observedBaseDigest !== input.sessionBaseDigest
    ) {
      baseDivergence.push(h.hypothesisId);
    }
  }

  if (baseDivergence.length > 0) {
    return {
      valid: false,
      reason: "invalidated_base_divergence",
      divergentHypothesisIds: baseDivergence,
      detail: `Divergencia de base Git detectada entre worktrees/execucoes (${baseDivergence.join(", ")}).`,
    };
  }

  if (criteriaMismatch.length > 0) {
    return {
      valid: false,
      reason: "invalidated_criteria_mismatch",
      divergentHypothesisIds: criteriaMismatch,
      detail: `Criterios divergentes entre hipoteses (${criteriaMismatch.join(", ")}).`,
    };
  }

  return {
    valid: true,
    reason: null,
    divergentHypothesisIds: [],
    detail: null,
  };
}

export function validateArenaPairedReview(input: {
  sessionStatus: ArenaSessionStatus;
  invalidationReason: ArenaInvalidationReason | null;
  criteria: ArenaCriteria;
  hypotheses: readonly Pick<
    ArenaHypothesisRecord,
    "hypothesisId" | "state" | "diffDigest" | "sourceRefs"
  >[];
  review: Pick<
    ArenaPairedReview,
    | "outcome"
    | "winnerHypothesisId"
    | "reviewedHypothesisIds"
    | "criterionScores"
  >;
}): {
  valid: boolean;
  errorCode:
    | "arena_base_divergence"
    | "arena_session_invalidated"
    | "arena_review_incomplete"
    | "intelligence_invalid_input"
    | null;
  detail: string | null;
} {
  if (input.sessionStatus === "invalidated") {
    return {
      valid: false,
      errorCode:
        input.invalidationReason === "invalidated_base_divergence"
          ? "arena_base_divergence"
          : "arena_session_invalidated",
      detail:
        "Sessao invalidada por divergencia de base ou criterio nao pode ser concluida.",
    };
  }

  if (input.hypotheses.length < 2) {
    return {
      valid: false,
      errorCode: "arena_review_incomplete",
      detail: "Arena exige pelo menos duas hipoteses para revisao pareada.",
    };
  }

  for (const h of input.hypotheses) {
    if (h.state !== "completed" || h.diffDigest === null) {
      return {
        valid: false,
        errorCode: "arena_review_incomplete",
        detail: `Hipotese ${h.hypothesisId} ainda nao concluiu com diff verificavel.`,
      };
    }
  }

  const expectedIds = new Set(input.hypotheses.map((h) => h.hypothesisId));
  const reviewedSet = new Set(input.review.reviewedHypothesisIds);
  if (
    reviewedSet.size !== expectedIds.size ||
    ![...expectedIds].every((id) => reviewedSet.has(id))
  ) {
    return {
      valid: false,
      errorCode: "arena_review_incomplete",
      detail:
        "Revisao pareada deve cobrir explicitamente todas as hipoteses da sessao.",
    };
  }

  if (input.review.outcome === "winner_selected") {
    if (
      !input.review.winnerHypothesisId ||
      !expectedIds.has(input.review.winnerHypothesisId)
    ) {
      return {
        valid: false,
        errorCode: "intelligence_invalid_input",
        detail: "winnerHypothesisId obrigatorio e pertencente a sessao.",
      };
    }
  } else if (input.review.winnerHypothesisId !== null) {
    return {
      valid: false,
      errorCode: "intelligence_invalid_input",
      detail: "winnerHypothesisId deve ser nulo em empate ou descarte duplo.",
    };
  }

  const criteriaIds = new Set(input.criteria.items.map((c) => c.criterionId));
  for (const score of input.review.criterionScores) {
    if (
      !expectedIds.has(score.hypothesisId) ||
      !criteriaIds.has(score.criterionId)
    ) {
      return {
        valid: false,
        errorCode: "intelligence_invalid_input",
        detail: "Pontuacao referencia hipotese ou criterio desconhecido.",
      };
    }
  }

  return { valid: true, errorCode: null, detail: null };
}

// ---- F5-M02: Explainable Replay ----

export function classifyReplayGaps(input: {
  knownAt: string;
  claimTombstones: readonly {
    targetId: string;
    purgedAt: string;
    targetKind: "claim" | "pin" | "overlay";
  }[];
  decisionTombstones: readonly {
    assertionId: string;
    purgedAt: string;
  }[];
  evidenceGaps: readonly {
    targetKind: "claim" | "decision" | "pin" | "delivery";
    targetId: string;
    reason: string;
    recordedAt: string | null;
  }[];
  postKnowledgeCount: number;
}): ReplayGap[] {
  const gaps: ReplayGap[] = [];
  const knownAtMs = Date.parse(input.knownAt);

  for (const t of input.claimTombstones) {
    gaps.push({
      gapId: `tomb-${t.targetKind}-${t.targetId}`,
      kind: "purged_tombstone",
      targetKind: t.targetKind,
      targetId: t.targetId,
      recordedAt: t.purgedAt,
      detail: `Registro (${t.targetKind}) expurgado definitivamente; payload suprimido sem ressurreicao.`,
    });
  }

  for (const t of input.decisionTombstones) {
    gaps.push({
      gapId: `tomb-decision-${t.assertionId}`,
      kind: "purged_tombstone",
      targetKind: "decision",
      targetId: t.assertionId,
      recordedAt: t.purgedAt,
      detail:
        "Decisao humana F1 expurgada definitivamente; payload suprimido sem ressurreicao.",
    });
  }

  for (const ev of input.evidenceGaps) {
    const isRetention =
      ev.reason.includes("expired") ||
      ev.reason.includes("released") ||
      ev.reason.includes("purged");
    const kind = ev.reason.includes("purged")
      ? "purged_tombstone"
      : isRetention
        ? "retention_expired"
        : "unpinned_cas_missing";
    gaps.push({
      gapId: `ev-${ev.targetKind}-${ev.targetId}-${ev.reason}`,
      kind,
      targetKind: ev.targetKind,
      targetId: ev.targetId,
      recordedAt: ev.recordedAt,
      detail: `Evidencia indisponivel (${ev.reason}).`,
    });
  }

  if (input.postKnowledgeCount > 0 && Number.isFinite(knownAtMs)) {
    gaps.push({
      gapId: `future-${input.knownAt}`,
      kind: "not_yet_known",
      targetKind: "claim",
      targetId: "post_known_at",
      recordedAt: input.knownAt,
      detail: `${input.postKnowledgeCount} registro(s) conhecido(s) apenas apos knownAt (${input.knownAt}) omitido(s) fielmente.`,
    });
  }

  return gaps.sort((a, b) => compareAsc(a.gapId, b.gapId));
}

export function buildReplayVersionPoints(input: {
  claims: readonly ReplayClaimEntry[];
  decisions: readonly ReplayDecisionEntry[];
  deliveries: readonly ReplayDeliverySummary[];
  gaps: readonly ReplayGap[];
}): ReplayVersionPoint[] {
  const points: ReplayVersionPoint[] = [];
  for (const c of input.claims) {
    points.push({
      at: c.revision.knownFrom,
      kind: "claim_revision",
      subjectId: c.claimId,
      label: `${c.title} (tx ${c.revision.txSeq})`,
    });
  }
  for (const d of input.decisions) {
    points.push({
      at: d.recordedAt,
      kind: "decision_revision",
      subjectId: d.assertionId,
      label: `Decisao rev #${d.revision}`,
    });
  }
  for (const deliv of input.deliveries) {
    points.push({
      at: deliv.compiledAt,
      kind: "delivery",
      subjectId: deliv.manifestDigest,
      label: `Entrega ${deliv.destinationId} (${deliv.policyVersion})`,
    });
  }
  for (const gap of input.gaps) {
    if (gap.kind === "purged_tombstone" && gap.recordedAt) {
      points.push({
        at: gap.recordedAt,
        kind: "purge",
        subjectId: gap.targetId,
        label: `Expurgo ${gap.targetKind}`,
      });
    }
  }
  return points.sort((a, b) => {
    const byAt = compareAsc(a.at, b.at);
    return byAt !== 0 ? byAt : compareAsc(a.subjectId, b.subjectId);
  });
}

export function diffReplayStates(
  stateA: ReplayQueryResult,
  stateB: ReplayQueryResult,
): {
  scope: IdentityScope;
  pointA: { validAt: string; knownAt: string };
  pointB: { validAt: string; knownAt: string };
  addedClaims: ReplayClaimEntry[];
  removedClaims: ReplayClaimEntry[];
  changedClaims: {
    claimId: string;
    before: ReplayClaimEntry;
    after: ReplayClaimEntry;
  }[];
  addedDecisions: ReplayDecisionEntry[];
  removedDecisions: ReplayDecisionEntry[];
  changedDecisions: {
    assertionId: string;
    before: ReplayDecisionEntry;
    after: ReplayDecisionEntry;
  }[];
  newGaps: ReplayGap[];
  newDeliveries: ReplayDeliverySummary[];
} {
  const claimsA = new Map(
    stateA.claims.map((c) => [`${c.claimId}:${c.revision.segmentSeq}`, c]),
  );
  const claimsB = new Map(
    stateB.claims.map((c) => [`${c.claimId}:${c.revision.segmentSeq}`, c]),
  );
  const byClaimIdA = new Map<string, ReplayClaimEntry>();
  const byClaimIdB = new Map<string, ReplayClaimEntry>();
  for (const c of stateA.claims) byClaimIdA.set(c.claimId, c);
  for (const c of stateB.claims) byClaimIdB.set(c.claimId, c);

  const addedClaims: ReplayClaimEntry[] = [];
  const removedClaims: ReplayClaimEntry[] = [];
  const changedClaims: {
    claimId: string;
    before: ReplayClaimEntry;
    after: ReplayClaimEntry;
  }[] = [];

  for (const c of stateB.claims) {
    const prev = byClaimIdA.get(c.claimId);
    if (!prev) {
      addedClaims.push(c);
    } else if (
      !claimsA.has(`${c.claimId}:${c.revision.segmentSeq}`) &&
      prev.revision.content !== c.revision.content
    ) {
      changedClaims.push({ claimId: c.claimId, before: prev, after: c });
    }
  }
  for (const c of stateA.claims) {
    if (!byClaimIdB.has(c.claimId)) {
      removedClaims.push(c);
    } else if (
      !claimsB.has(`${c.claimId}:${c.revision.segmentSeq}`) &&
      !changedClaims.some((ch) => ch.claimId === c.claimId)
    ) {
      const next = byClaimIdB.get(c.claimId)!;
      if (next.revision.revisionId !== c.revision.revisionId) {
        changedClaims.push({ claimId: c.claimId, before: c, after: next });
      }
    }
  }

  const decA = new Map(stateA.decisions.map((d) => [d.assertionId, d]));
  const decB = new Map(stateB.decisions.map((d) => [d.assertionId, d]));
  const addedDecisions: ReplayDecisionEntry[] = [];
  const removedDecisions: ReplayDecisionEntry[] = [];
  const changedDecisions: {
    assertionId: string;
    before: ReplayDecisionEntry;
    after: ReplayDecisionEntry;
  }[] = [];

  for (const [id, d] of decB) {
    const prev = decA.get(id);
    if (!prev) {
      addedDecisions.push(d);
    } else if (prev.revisionId !== d.revisionId || prev.content !== d.content) {
      changedDecisions.push({ assertionId: id, before: prev, after: d });
    }
  }
  for (const [id, d] of decA) {
    if (!decB.has(id)) removedDecisions.push(d);
  }

  const gapsA = new Set(stateA.gaps.map((g) => g.gapId));
  const newGaps = stateB.gaps.filter((g) => !gapsA.has(g.gapId));

  const delivA = new Set(stateA.deliveries.map((d) => d.manifestDigest));
  const newDeliveries = stateB.deliveries.filter(
    (d) => !delivA.has(d.manifestDigest),
  );

  return {
    scope: stateB.scope,
    pointA: { validAt: stateA.validAt, knownAt: stateA.knownAt },
    pointB: { validAt: stateB.validAt, knownAt: stateB.knownAt },
    addedClaims,
    removedClaims,
    changedClaims,
    addedDecisions,
    removedDecisions,
    changedDecisions,
    newGaps,
    newDeliveries,
  };
}

// ---- F5-M03: Symbolic BKM & Adaptive Gate Evaluator ----

export function summarizeBkmHypothesis(
  evidence: readonly BkmEvidenceRecord[],
): {
  independentSupportOrigins: number;
  independentOpposeOrigins: number;
  rawSupportEvents: number;
  rawOpposeEvents: number;
  netScore: number;
  originGroups: BkmOriginGroup[];
} {
  const groups = new Map<
    string,
    { polarity: "support" | "oppose"; count: number; maxWeight: number }
  >();
  let rawSupportEvents = 0;
  let rawOpposeEvents = 0;

  for (const ev of evidence) {
    if (ev.polarity === "support") rawSupportEvents += 1;
    else rawOpposeEvents += 1;

    const key = `${ev.polarity}::${ev.originKey}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        polarity: ev.polarity,
        count: 1,
        maxWeight: ev.weight,
      });
    } else {
      existing.count += 1;
      if (ev.weight > existing.maxWeight) {
        existing.maxWeight = ev.weight;
      }
    }
  }

  let independentSupportOrigins = 0;
  let independentOpposeOrigins = 0;
  let netScore = 0;
  const originGroups: BkmOriginGroup[] = [];

  for (const [key, g] of [...groups.entries()].sort(([a], [b]) =>
    compareAsc(a, b),
  )) {
    const originKey = key.slice(key.indexOf("::") + 2);
    // Repeated events from the same correlated origin contribute once (capped at maxWeight).
    if (g.polarity === "support") {
      independentSupportOrigins += 1;
      netScore += g.maxWeight;
    } else {
      independentOpposeOrigins += 1;
      netScore -= g.maxWeight;
    }
    originGroups.push({
      originKey,
      polarity: g.polarity,
      rawEventCount: g.count,
      effectiveWeight: g.maxWeight,
    });
  }

  return {
    independentSupportOrigins,
    independentOpposeOrigins,
    rawSupportEvents,
    rawOpposeEvents,
    netScore: Number(netScore.toFixed(4)),
    originGroups,
  };
}

export function canTransitionBkmState(
  fromState: BkmHypothesisState,
  toState: BkmHypothesisState,
): boolean {
  if (fromState === "purged") return false;
  if (fromState === toState) return true;
  if (toState === "purged") return true;
  if (fromState === "candidate") {
    return (
      toState === "active" || toState === "superseded" || toState === "reverted"
    );
  }
  if (fromState === "active") {
    return toState === "superseded" || toState === "reverted";
  }
  if (fromState === "superseded" || fromState === "reverted") {
    return toState === "active" || toState === "candidate";
  }
  return false;
}

const canarySecretPattern =
  /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b)/;

function matchesBkmPattern(
  candidate: HeldOutCandidateItem,
  queryLower: string,
  pattern: BkmPattern,
): { matched: boolean; reason: string | null } {
  const haystack = `${candidate.title} ${candidate.text}`.toLowerCase();
  const keywordMatch =
    pattern.keywords.length === 0 ||
    pattern.keywords.some((kw) => {
      const lower = kw.toLowerCase();
      return queryLower.includes(lower) && haystack.includes(lower);
    });
  if (!keywordMatch) return { matched: false, reason: null };

  const pathMatch =
    pattern.pathPrefixes.length === 0 ||
    pattern.pathPrefixes.some((prefix) => candidate.path.startsWith(prefix));
  if (!pathMatch) return { matched: false, reason: null };

  return {
    matched: true,
    reason: `BKM match (peso ${pattern.boostWeight >= 0 ? "+" : ""}${pattern.boostWeight})`,
  };
}

export function scoreCandidateWithStrategy(params: {
  scope: IdentityScope;
  query: string;
  candidate: HeldOutCandidateItem;
  activeHypotheses: readonly Pick<
    BkmHypothesisRecord,
    | "hypothesisId"
    | "category"
    | "state"
    | "pattern"
    | "independentSupportOrigins"
    | "independentOpposeOrigins"
  >[];
}): {
  baselineScore: number;
  adaptiveScore: number;
  appliedHypothesisIds: string[];
  reasons: string[];
} {
  const { candidate } = params;
  // Security & scope boundary enforced identically before ranking.
  if (
    !sameScope(candidate.scope, params.scope) ||
    candidate.isSecretOrCanary ||
    canarySecretPattern.test(candidate.text)
  ) {
    return {
      baselineScore: -Infinity,
      adaptiveScore: -Infinity,
      appliedHypothesisIds: [],
      reasons: ["blocked_scope_or_secret"],
    };
  }

  const mandatoryBase = candidate.isMandatory ? 1000 : 0;
  const baselineScore =
    mandatoryBase + candidate.ftsScore + (candidate.isCurrent ? 0.5 : 0);

  let adaptiveScore = mandatoryBase + candidate.ftsScore;
  const appliedHypothesisIds: string[] = [];
  const reasons: string[] = [];
  const queryLower = params.query.toLowerCase();

  for (const hyp of params.activeHypotheses) {
    if (hyp.state !== "active") continue;
    if (hyp.independentOpposeOrigins > hyp.independentSupportOrigins) continue;

    const match = matchesBkmPattern(candidate, queryLower, hyp.pattern);
    if (!match.matched) continue;

    let delta = hyp.pattern.boostWeight;
    if (hyp.pattern.preferCanonical && candidate.isCanonical) {
      delta += 1.5;
    }
    if (hyp.pattern.preferRecent) {
      delta += candidate.isCurrent ? 2.0 : -3.0;
    }
    adaptiveScore += delta;
    appliedHypothesisIds.push(hyp.hypothesisId);
    reasons.push(`${hyp.hypothesisId}: ${match.reason ?? hyp.category}`);
  }

  // Fallback temporal boost if no explicit temporal hypothesis applied.
  if (appliedHypothesisIds.length === 0) {
    adaptiveScore += candidate.isCurrent ? 0.5 : 0;
  }

  return {
    baselineScore,
    adaptiveScore,
    appliedHypothesisIds,
    reasons,
  };
}

function measureMetricsForMode(params: {
  scope: IdentityScope;
  cases: readonly HeldOutEvalCase[];
  mode: "baseline" | "adaptive";
  activeHypotheses: readonly BkmHypothesisRecord[];
  baselineCostMs: number;
}): {
  metrics: EvaluationMetrics;
  explanations: Map<string, AdaptiveRankingExplanation>;
} {
  let totalRecall = 0;
  let totalTemporal = 0;
  let totalMandatoryTotal = 0;
  let totalMandatoryKept = 0;
  let leakageCount = 0;
  let operations = 0;
  const explanations = new Map<string, AdaptiveRankingExplanation>();

  for (const evalCase of params.cases) {
    const scored = evalCase.candidates.map((candidate) => {
      operations += 1;
      const res = scoreCandidateWithStrategy({
        scope: params.scope,
        query: evalCase.query,
        candidate,
        activeHypotheses: params.activeHypotheses,
      });
      const score =
        params.mode === "baseline" ? res.baselineScore : res.adaptiveScore;
      return { candidate, score, res };
    });

    const eligible = scored
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return compareAsc(a.candidate.itemId, b.candidate.itemId);
      });

    const topK = eligible.slice(0, evalCase.topK);
    const totalRelevant = evalCase.candidates.filter(
      (c) =>
        c.isRelevant &&
        sameScope(c.scope, params.scope) &&
        !c.isSecretOrCanary &&
        !canarySecretPattern.test(c.text),
    ).length;

    const relevantInTopK = topK.filter(
      (entry) => entry.candidate.isRelevant,
    ).length;
    totalRecall += totalRelevant > 0 ? relevantInTopK / totalRelevant : 1;

    const currentInTopK = topK.filter(
      (entry) => entry.candidate.isCurrent,
    ).length;
    totalTemporal += topK.length > 0 ? currentInTopK / topK.length : 1;

    const eligibleMandatory = evalCase.candidates.filter(
      (c) =>
        c.isMandatory &&
        sameScope(c.scope, params.scope) &&
        !c.isSecretOrCanary,
    );
    totalMandatoryTotal += eligibleMandatory.length;
    for (const m of eligibleMandatory) {
      if (topK.some((entry) => entry.candidate.itemId === m.itemId)) {
        totalMandatoryKept += 1;
      }
    }

    for (const entry of topK) {
      if (
        !sameScope(entry.candidate.scope, params.scope) ||
        entry.candidate.isSecretOrCanary ||
        canarySecretPattern.test(entry.candidate.text)
      ) {
        leakageCount += 1;
      }
      explanations.set(`${evalCase.caseId}::${entry.candidate.itemId}`, {
        caseId: evalCase.caseId,
        itemId: entry.candidate.itemId,
        baselineScore: entry.res.baselineScore,
        adaptiveScore: entry.res.adaptiveScore,
        appliedHypothesisIds: entry.res.appliedHypothesisIds,
        reasons:
          entry.res.reasons.length > 0
            ? entry.res.reasons
            : ["fts5_baseline_score"],
      });
    }
  }

  const caseCount = params.cases.length;
  // Deterministic complexity-bounded compute estimate (in ms) without Date.now().
  const rawCost = Number(
    (
      0.2 +
      operations * (params.mode === "baseline" ? 0.04 : 0.06) +
      (params.mode === "adaptive"
        ? params.activeHypotheses.filter((h) => h.state === "active").length *
          0.15
        : 0)
    ).toFixed(4),
  );

  return {
    metrics: {
      recallAtK:
        caseCount > 0 ? Number((totalRecall / caseCount).toFixed(4)) : 0,
      temporalAccuracy:
        caseCount > 0 ? Number((totalTemporal / caseCount).toFixed(4)) : 0,
      mandatoryPreservation:
        totalMandatoryTotal > 0
          ? Number((totalMandatoryKept / totalMandatoryTotal).toFixed(4))
          : 1,
      leakageCount,
      computeCostMs: rawCost,
      costRatio:
        params.baselineCostMs > 0
          ? Number((rawCost / params.baselineCostMs).toFixed(4))
          : 1,
      caseCount,
    },
    explanations,
  };
}

export function evaluateAdaptiveStrategy(input: {
  scope: IdentityScope;
  evaluationId: string;
  requestId: string;
  strategyVersion?: string;
  splitBoundaryAt: string;
  minRecallGain?: number;
  maxComputeCostMs?: number;
  activeHypotheses: readonly BkmHypothesisRecord[];
  heldOutCases: readonly HeldOutEvalCase[];
  evaluatedAt: string;
}): EvaluationRunRecord {
  const strategyVersion =
    input.strategyVersion ?? adaptiveDefaultStrategyVersion;
  const baselineVersion = adaptiveDefaultBaselineVersion;
  const minRecallGain = input.minRecallGain ?? adaptiveDefaultMinRecallGain;
  const maxComputeCostMs =
    input.maxComputeCostMs ?? adaptiveDefaultMaxComputeCostMs;
  const splitMs = Date.parse(input.splitBoundaryAt);

  const temporalSplitValid =
    input.heldOutCases.length > 0 &&
    input.heldOutCases.every((c) => Date.parse(c.queryAt) >= splitMs) &&
    input.activeHypotheses
      .filter((h) => h.state === "active")
      .every((h) =>
        h.evidence.every((ev) => Date.parse(ev.recordedAt) < splitMs),
      );

  const projectIsolationValid = input.activeHypotheses.every((h) =>
    sameScope(h.scope, input.scope),
  );

  const baselinePass = measureMetricsForMode({
    scope: input.scope,
    cases: input.heldOutCases,
    mode: "baseline",
    activeHypotheses: [],
    baselineCostMs: 1,
  });
  baselinePass.metrics.costRatio = 1;

  const adaptivePass = measureMetricsForMode({
    scope: input.scope,
    cases: input.heldOutCases,
    mode: "adaptive",
    activeHypotheses: input.activeHypotheses,
    baselineCostMs: baselinePass.metrics.computeCostMs,
  });

  const recallGain = Number(
    (adaptivePass.metrics.recallAtK - baselinePass.metrics.recallAtK).toFixed(
      4,
    ),
  );
  const temporalAccuracyGain = Number(
    (
      adaptivePass.metrics.temporalAccuracy -
      baselinePass.metrics.temporalAccuracy
    ).toFixed(4),
  );

  const failedGates: AdaptiveGateFailure[] = [];
  if (input.heldOutCases.length < 3) {
    failedGates.push("insufficient_held_out_cases");
  }
  if (!temporalSplitValid) {
    failedGates.push("temporal_split_invalid");
  }
  if (!projectIsolationValid) {
    failedGates.push("project_isolation_invalid");
  }
  if (adaptivePass.metrics.leakageCount > 0) {
    failedGates.push("scope_or_secret_leakage");
  }
  if (
    adaptivePass.metrics.mandatoryPreservation < 1 ||
    adaptivePass.metrics.mandatoryPreservation <
      baselinePass.metrics.mandatoryPreservation
  ) {
    failedGates.push("mandatory_regression");
  }
  if (
    adaptivePass.metrics.temporalAccuracy < 0.85 ||
    adaptivePass.metrics.temporalAccuracy <
      baselinePass.metrics.temporalAccuracy
  ) {
    failedGates.push("temporal_accuracy_regression");
  }
  if (
    adaptivePass.metrics.computeCostMs > maxComputeCostMs ||
    adaptivePass.metrics.costRatio > 2.0
  ) {
    failedGates.push("compute_cost_exceeded");
  }

  const meetsGainThreshold =
    recallGain >= minRecallGain ||
    (recallGain >= 0 && temporalAccuracyGain >= minRecallGain);
  if (!meetsGainThreshold) {
    failedGates.push("insufficient_recall_gain");
  }

  const decision =
    failedGates.length === 0 ? "eligible_for_activation" : "stay_on_baseline";

  const explanations = [...adaptivePass.explanations.values()].sort((a, b) => {
    const byCase = compareAsc(a.caseId, b.caseId);
    return byCase !== 0 ? byCase : compareAsc(a.itemId, b.itemId);
  });

  const core = {
    scope: input.scope,
    evaluationId: input.evaluationId,
    requestId: input.requestId,
    baselineVersion,
    strategyVersion,
    splitBoundaryAt: input.splitBoundaryAt,
    heldOutCount: input.heldOutCases.length,
    temporalSplitValid,
    projectIsolationValid,
    baselineMetrics: baselinePass.metrics,
    adaptiveMetrics: adaptivePass.metrics,
    recallGain,
    temporalAccuracyGain,
    decision,
    failedGates,
    explanations,
    evaluatedAt: input.evaluatedAt,
  } as const;

  const reportDigest = sha256Hex(canonicalJson(core));
  return { ...core, reportDigest };
}

// ---- F5-M04: Graduated Proactivity & Window Scheduling ----

export type ProactiveSignalCandidate = {
  signalKind: ProactiveSignalKind;
  subjectId: string;
  title: string;
  rationale: string;
  baseWeight: number;
  sourceRefs: ProactiveSourceRef[];
  proposedAction: ProactiveSuggestionRecord["proposedAction"];
};

export function evaluateProactiveSignals(input: {
  scope: IdentityScope;
  signals: readonly ProactiveSignalCandidate[];
  nowIso: string;
}): Omit<
  ProactiveSuggestionRecord,
  | "suggestionId"
  | "status"
  | "snoozeUntil"
  | "dismissReason"
  | "createdAt"
  | "updatedAt"
>[] {
  const seen = new Set<string>();
  const suggestions: Omit<
    ProactiveSuggestionRecord,
    | "suggestionId"
    | "status"
    | "snoozeUntil"
    | "dismissReason"
    | "createdAt"
    | "updatedAt"
  >[] = [];

  for (const sig of input.signals) {
    if (sig.sourceRefs.length === 0) continue;
    const fingerprint = sha256Hex(
      canonicalJson({
        scope: input.scope,
        signalKind: sig.signalKind,
        subjectId: sig.subjectId,
      }),
    );
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const refBonus = Math.min(20, sig.sourceRefs.length * 5);
    const priorityScore = Math.min(100, sig.baseWeight + refBonus);
    const priorityBand =
      priorityScore >= 85
        ? "critical"
        : priorityScore >= 65
          ? "high"
          : priorityScore >= 40
            ? "medium"
            : "low";

    suggestions.push({
      scope: input.scope,
      signalFingerprint: fingerprint,
      signalKind: sig.signalKind,
      title: sig.title,
      rationale: sig.rationale,
      priorityScore,
      priorityBand,
      sourceRefs: [...sig.sourceRefs],
      proposedAction: sig.proposedAction,
      autoExecutable: false,
    });
  }

  return suggestions.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore;
    }
    return compareAsc(a.signalFingerprint, b.signalFingerprint);
  });
}

export function computeProactivityTelemetry(
  events: readonly {
    eventKind: "evaluated" | "accepted" | "dismissed" | "snoozed" | "restored";
    estimatedManualSeconds: number;
    estimatedSavedSeconds: number;
  }[],
): ProactivityTelemetrySummary {
  let evaluatedCount = 0;
  let acceptedCount = 0;
  let dismissedCount = 0;
  let snoozedCount = 0;
  let restoredCount = 0;
  let estimatedManualSeconds = 0;
  let estimatedSavedSeconds = 0;

  for (const ev of events) {
    if (ev.eventKind === "evaluated") evaluatedCount += 1;
    else if (ev.eventKind === "accepted") {
      acceptedCount += 1;
      estimatedManualSeconds += ev.estimatedManualSeconds;
      estimatedSavedSeconds += ev.estimatedSavedSeconds;
    } else if (ev.eventKind === "dismissed") dismissedCount += 1;
    else if (ev.eventKind === "snoozed") snoozedCount += 1;
    else if (ev.eventKind === "restored") restoredCount += 1;
  }

  const responses = acceptedCount + dismissedCount;
  const utilityRate =
    responses > 0 ? Number((acceptedCount / responses).toFixed(4)) : 0;

  return {
    evaluatedCount,
    acceptedCount,
    dismissedCount,
    snoozedCount,
    restoredCount,
    utilityRate,
    estimatedManualSeconds,
    estimatedSavedSeconds,
  };
}

function parseUtcMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(":");
  return Number(hh) * 60 + Number(mm);
}

export function evaluateScheduleWindow(
  schedule: Pick<
    ProactiveScheduleRecord,
    | "scheduleId"
    | "optInActive"
    | "status"
    | "windowStartUtc"
    | "windowEndUtc"
    | "allowedDaysUtc"
    | "minIntervalMinutes"
    | "appClosedMode"
  >,
  evaluatedAtIso: string,
): {
  allowed: boolean;
  reason: string | null;
  windowKey: string;
} {
  const date = new Date(evaluatedAtIso);
  const day = date.getUTCDay();
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const dateStamp = evaluatedAtIso.slice(0, 10);
  const bucket = Math.floor(minutes / Math.max(1, schedule.minIntervalMinutes));
  const windowKey = `${schedule.scheduleId}:${dateStamp}:${bucket}`;

  if (schedule.appClosedMode !== "disabled_deferred") {
    return {
      allowed: false,
      reason: "app_closed_daemon_deferred",
      windowKey,
    };
  }
  if (!schedule.optInActive || schedule.status === "revoked") {
    return {
      allowed: false,
      reason: "schedule_revoked_or_no_opt_in",
      windowKey,
    };
  }
  if (schedule.status !== "active") {
    return {
      allowed: false,
      reason: "schedule_paused",
      windowKey,
    };
  }
  if (!schedule.allowedDaysUtc.includes(day)) {
    return {
      allowed: false,
      reason: "outside_allowed_days",
      windowKey,
    };
  }

  const startMin = parseUtcMinutes(schedule.windowStartUtc);
  const endMin = parseUtcMinutes(schedule.windowEndUtc);
  const inWindow =
    startMin <= endMin
      ? minutes >= startMin && minutes < endMin
      : minutes >= startMin || minutes < endMin;

  if (!inWindow) {
    return {
      allowed: false,
      reason: "outside_time_window",
      windowKey,
    };
  }

  return { allowed: true, reason: null, windowKey };
}
