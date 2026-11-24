import { isProjectId, isRecord, isRequestId, type ErrorCode } from "./index.ts";
import { isContextDate, isContextPath } from "./context.ts";
import { isGitObjectId } from "./working-tree.ts";
import { isIdentityScope, type IdentityScope } from "./resume.ts";
import {
  plannerBackendModes,
  plannerMaxEditBytes,
  plannerMaxObjectiveBytes,
  plannerMaxProposedEdits,
  plannerMaxTitleBytes,
  type ExecutionDiffFile,
  type PlannerBackendMode,
  type PlannerGitBase,
  type PlannerProposedEdit,
} from "./planner.ts";
import {
  timelineSignalKinds,
  type ClaimRevision,
  type RelationRecord,
  type TimelineConflictEntry,
  type TimelineSignalKind,
} from "./memory.ts";

export const intelligenceSchemaVersion = 1;
export const arenaMaxHypotheses = 6;
export const arenaMinHypotheses = 2;
export const arenaMaxCriteria = 12;
export const arenaMaxSourceRefs = 32;
export const bkmMaxTitleBytes = 256;
export const bkmMaxStatementBytes = 4096;
export const bkmMaxKeywords = 16;
export const bkmMaxPaths = 16;
export const adaptiveDefaultBaselineVersion = "baseline_fts5_v1";
export const adaptiveDefaultStrategyVersion = "bkm_symbolic_v1";
export const adaptiveDefaultMaxComputeCostMs = 50;
export const adaptiveDefaultMinRecallGain = 0.05;
export const adaptiveMaxHeldOutCases = 64;
export const adaptiveMaxCandidatesPerCase = 64;
export const proactivityMaxSuggestions = 64;

export const intelligenceErrorCodes = [
  "intelligence_invalid_input",
  "intelligence_not_found",
  "arena_base_divergence",
  "arena_review_incomplete",
  "arena_session_invalidated",
  "replay_invalid_range",
  "learning_hypothesis_conflict",
  "adaptive_gate_rejected",
  "proactivity_opt_in_required",
  "proactivity_schedule_conflict",
] as const satisfies readonly ErrorCode[];

// ---- F5-M01: Parallel Hypothesis Arena ----

export const arenaSessionStatuses = [
  "created",
  "running",
  "ready_for_review",
  "reviewed",
  "invalidated",
] as const;
export type ArenaSessionStatus = (typeof arenaSessionStatuses)[number];

export const arenaHypothesisStates = [
  "pending",
  "running",
  "completed",
  "failed",
  "invalidated",
] as const;
export type ArenaHypothesisState = (typeof arenaHypothesisStates)[number];

export const arenaReviewOutcomes = [
  "winner_selected",
  "tie",
  "both_discarded",
] as const;
export type ArenaReviewOutcome = (typeof arenaReviewOutcomes)[number];

export const arenaInvalidationReasons = [
  "invalidated_base_divergence",
  "invalidated_criteria_mismatch",
] as const;
export type ArenaInvalidationReason = (typeof arenaInvalidationReasons)[number];

export type ArenaCriterion = {
  criterionId: string;
  label: string;
  weight: number;
};

export type ArenaCriteria = {
  sharedObjective: string;
  items: ArenaCriterion[];
};

export type ArenaSourceRef = {
  kind: "diff" | "execution" | "context_excerpt" | "claim" | "decision";
  refId: string;
  label: string;
  digest: string | null;
};

export type ArenaHypothesisInput = {
  hypothesisId: string;
  label: string;
  summary: string;
  targetPaths: string[];
  proposedEdits?: PlannerProposedEdit[];
  commandArgv?: string[];
  mockBehavior?: "complete" | "fail";
  sourceRefs?: ArenaSourceRef[];
};

export type ArenaHypothesisRecord = {
  ordinal: number;
  hypothesisId: string;
  label: string;
  summary: string;
  targetPaths: string[];
  proposedEdits: PlannerProposedEdit[];
  observedBaseHead: string | null;
  observedBaseIndexStamp: string | null;
  observedBaseDigest: string | null;
  criteriaDigest: string;
  planId: string | null;
  grantId: string | null;
  executionId: string | null;
  dedicatedWorktreeId: string | null;
  dedicatedRoot: string | null;
  diffDigest: string | null;
  diffFiles: ExecutionDiffFile[];
  sourceRefs: ArenaSourceRef[];
  state: ArenaHypothesisState;
  failureCode: string | null;
};

export type ArenaPairedReview = {
  reviewId: string;
  outcome: ArenaReviewOutcome;
  winnerHypothesisId: string | null;
  reviewer: string;
  rationale: string;
  reviewedHypothesisIds: string[];
  criterionScores: {
    hypothesisId: string;
    criterionId: string;
    score: number;
  }[];
  evidenceRefs: string[];
  recordedAt: string;
  appliedToLocal: false;
};

export type ArenaSessionRecord = {
  scope: IdentityScope;
  sessionId: string;
  requestId: string;
  title: string;
  objective: string;
  backendMode: PlannerBackendMode;
  status: ArenaSessionStatus;
  invalidationReason: ArenaInvalidationReason | null;
  base: PlannerGitBase;
  baseDigest: string;
  criteria: ArenaCriteria;
  criteriaDigest: string;
  hypotheses: ArenaHypothesisRecord[];
  pairedReview: ArenaPairedReview | null;
  appliedToLocal: false;
  createdAt: string;
  updatedAt: string;
};

export type ArenaSessionListResult = {
  scope: IdentityScope;
  items: ArenaSessionRecord[];
};

export type ArenaSessionCreateInput = IdentityScope & {
  requestId: string;
  title: string;
  objective: string;
  backendMode: PlannerBackendMode;
  criteria: ArenaCriteria;
  hypotheses: ArenaHypothesisInput[];
  humanConfirmed: boolean;
};

export type ArenaSessionRunInput = IdentityScope & {
  sessionId: string;
  humanConfirmed: boolean;
};

export type ArenaSessionGetInput = IdentityScope & {
  sessionId: string;
};

export type ArenaSessionReviewInput = IdentityScope & {
  sessionId: string;
  requestId: string;
  outcome: ArenaReviewOutcome;
  winnerHypothesisId: string | null;
  reviewer: string;
  rationale: string;
  reviewedHypothesisIds: string[];
  criterionScores: {
    hypothesisId: string;
    criterionId: string;
    score: number;
  }[];
  evidenceRefs: string[];
  humanConfirmed: boolean;
};

// ---- F5-M02: Explainable Replay ----

export const replayGapKinds = [
  "purged_tombstone",
  "retention_expired",
  "unpinned_cas_missing",
  "not_yet_known",
] as const;
export type ReplayGapKind = (typeof replayGapKinds)[number];

export type ReplayGap = {
  gapId: string;
  kind: ReplayGapKind;
  targetKind: "claim" | "decision" | "pin" | "overlay" | "delivery";
  targetId: string;
  recordedAt: string | null;
  detail: string;
};

export type ReplayClaimEntry = {
  claimId: string;
  title: string;
  revision: ClaimRevision;
  evidenceState: "verified" | "gap" | "none";
  evidenceSource: "cas_pin" | "context_store" | "none";
  evidenceDigest: string | null;
  evidenceGapReason: string | null;
  evidencePreview: string | null;
};

export type ReplayDecisionEntry = {
  assertionId: string;
  revisionId: string;
  revision: number;
  content: string;
  author: string;
  authority: "human_local" | "human_promoted";
  visibility: "local_only" | "canonical_verified";
  status: "active" | "superseded";
  effectiveAt: string;
  recordedAt: string;
  evidenceState: "verified" | "gap" | "none";
  evidenceDigest: string | null;
  evidenceGapReason: string | null;
};

export type ReplayDeliverySummary = {
  manifestDigest: string;
  destinationId: string;
  policyVersion: string;
  strategyVersion: string;
  compiledAt: string;
  status: string;
  includedCount: number;
  omittedCount: number;
  grantIds: string[];
  auditIds: string[];
};

export type ReplayDeliveryDetail = {
  scope: IdentityScope;
  knownAt: string;
  manifestDigest: string;
  destinationId: string;
  policyVersion: string;
  strategyVersion: string;
  compiledAt: string;
  status: string;
  objective: string;
  includedItems: {
    opaqueRef: string;
    kind: string;
    tier: string;
    version: string;
    contentDigest: string;
    bytes: number;
    rationale: string;
  }[];
  omittedSummary: {
    reason: string;
    count: number;
    disclosable: boolean;
  }[];
  grants: {
    grantId: string;
    sessionId: string;
    issuedAt: string;
    expiresAt: string;
    revokedAt: string | null;
  }[];
  audits: {
    auditId: string;
    channel: string;
    mode: string;
    state: string;
    startedAt: string;
    finishedAt: string;
  }[];
  observedReads: {
    tool: string;
    opaqueRef: string | null;
    outcome: "allowed" | "denied";
    at: string;
  }[];
  sourceGaps: ReplayGap[];
};

export type ReplayVersionPoint = {
  at: string;
  kind: "claim_revision" | "decision_revision" | "delivery" | "purge";
  subjectId: string;
  label: string;
};

export type ReplayQueryResult = {
  scope: IdentityScope;
  validAt: string;
  knownAt: string;
  claims: ReplayClaimEntry[];
  decisions: ReplayDecisionEntry[];
  relations: RelationRecord[];
  conflicts: TimelineConflictEntry[];
  gaps: ReplayGap[];
  deliveries: ReplayDeliverySummary[];
  versionTimeline: ReplayVersionPoint[];
};

export type ReplayDiffResult = {
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
};

export type ReplayQueryInput = IdentityScope & {
  validAt: string;
  knownAt: string;
  signalKinds?: TimelineSignalKind[];
};

export type ReplayDiffInput = IdentityScope & {
  pointA: { validAt: string; knownAt: string };
  pointB: { validAt: string; knownAt: string };
};

export type ReplayDeliveryInspectInput = IdentityScope & {
  manifestDigest: string;
  knownAt: string;
};

// ---- F5-M03: Symbolic BKM Learning & Adaptive Evaluation ----

export const bkmHypothesisStates = [
  "candidate",
  "active",
  "superseded",
  "reverted",
  "purged",
] as const;
export type BkmHypothesisState = (typeof bkmHypothesisStates)[number];

export const bkmCategories = [
  "retrieval_boost",
  "temporal_recency",
  "canonical_priority",
  "path_affinity",
] as const;
export type BkmCategory = (typeof bkmCategories)[number];

export type BkmPattern = {
  keywords: string[];
  pathPrefixes: string[];
  boostWeight: number;
  preferCanonical: boolean;
  preferRecent: boolean;
};

export type BkmEvidenceRecord = {
  evidenceId: string;
  polarity: "support" | "oppose";
  originKey: string;
  originKind: "inbox_feedback" | "review" | "manual";
  sourceRefId: string | null;
  weight: number;
  note: string;
  recordedAt: string;
};

export type BkmOriginGroup = {
  originKey: string;
  polarity: "support" | "oppose";
  rawEventCount: number;
  effectiveWeight: number;
};

export type BkmTransitionRecord = {
  transitionId: string;
  fromState: BkmHypothesisState;
  toState: BkmHypothesisState;
  reason: string;
  reviewer: string;
  recordedAt: string;
};

export type BkmHypothesisRecord = {
  scope: IdentityScope;
  hypothesisId: string;
  competingGroupKey: string;
  category: BkmCategory;
  title: string;
  statement: string;
  pattern: BkmPattern;
  state: BkmHypothesisState;
  independentSupportOrigins: number;
  independentOpposeOrigins: number;
  rawSupportEvents: number;
  rawOpposeEvents: number;
  netScore: number;
  originGroups: BkmOriginGroup[];
  evidence: BkmEvidenceRecord[];
  transitions: BkmTransitionRecord[];
  createdAt: string;
  updatedAt: string;
};

export type BkmHypothesisListResult = {
  scope: IdentityScope;
  items: BkmHypothesisRecord[];
};

export type HeldOutCandidateItem = {
  itemId: string;
  scope: IdentityScope;
  path: string;
  title: string;
  text: string;
  recordedAt: string;
  validAt: string;
  isCurrent: boolean;
  isMandatory: boolean;
  isCanonical: boolean;
  isSecretOrCanary: boolean;
  ftsScore: number;
  isRelevant: boolean;
};

export type HeldOutEvalCase = {
  caseId: string;
  query: string;
  queryAt: string;
  topK: number;
  candidates: HeldOutCandidateItem[];
};

export type EvaluationMetrics = {
  recallAtK: number;
  temporalAccuracy: number;
  mandatoryPreservation: number;
  leakageCount: number;
  computeCostMs: number;
  costRatio: number;
  caseCount: number;
};

export type AdaptiveRankingExplanation = {
  caseId: string;
  itemId: string;
  baselineScore: number;
  adaptiveScore: number;
  appliedHypothesisIds: string[];
  reasons: string[];
};

export type AdaptiveGateFailure =
  | "insufficient_held_out_cases"
  | "temporal_split_invalid"
  | "project_isolation_invalid"
  | "scope_or_secret_leakage"
  | "mandatory_regression"
  | "temporal_accuracy_regression"
  | "compute_cost_exceeded"
  | "insufficient_recall_gain";

export type EvaluationRunRecord = {
  scope: IdentityScope;
  evaluationId: string;
  requestId: string;
  baselineVersion: string;
  strategyVersion: string;
  splitBoundaryAt: string;
  heldOutCount: number;
  temporalSplitValid: boolean;
  projectIsolationValid: boolean;
  baselineMetrics: EvaluationMetrics;
  adaptiveMetrics: EvaluationMetrics;
  recallGain: number;
  temporalAccuracyGain: number;
  decision: "eligible_for_activation" | "stay_on_baseline";
  failedGates: AdaptiveGateFailure[];
  explanations: AdaptiveRankingExplanation[];
  reportDigest: string;
  evaluatedAt: string;
};

export type AdaptiveStrategyStatusResult = {
  scope: IdentityScope;
  activeMode: "baseline_fts5" | "adaptive_symbolic";
  activeVersion: string;
  evaluationId: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  rollbackReason: string | null;
  latestEvaluation: EvaluationRunRecord | null;
  evaluations: EvaluationRunRecord[];
};

export type BkmHypothesisUpsertInput = IdentityScope & {
  requestId: string;
  hypothesisId?: string;
  competingGroupKey: string;
  category: BkmCategory;
  title: string;
  statement: string;
  pattern: BkmPattern;
  evidence?: {
    polarity: "support" | "oppose";
    originKey: string;
    originKind: "inbox_feedback" | "review" | "manual";
    sourceRefId?: string | null;
    weight?: number;
    note: string;
  }[];
};

export type BkmHypothesisTransitionInput = IdentityScope & {
  hypothesisId: string;
  toState: BkmHypothesisState;
  reason: string;
  reviewer: string;
  supersedeCompetitors?: boolean;
  humanConfirmed: boolean;
};

export type AdaptiveEvaluateInput = IdentityScope & {
  requestId: string;
  strategyVersion?: string;
  splitBoundaryAt: string;
  minRecallGain?: number;
  maxComputeCostMs?: number;
  heldOutCases: HeldOutEvalCase[];
};

export type AdaptiveStrategyActivateInput = IdentityScope & {
  mode: "adaptive_symbolic" | "rollback_to_baseline";
  evaluationId?: string;
  reviewer: string;
  reason: string;
  humanConfirmed: boolean;
};

// ---- F5-M04: Graduated Proactivity ----

export const proactiveSignalKinds = [
  "bitemporal_conflict",
  "inbox_pending_critical",
  "planner_drift",
  "diff_awaiting_review",
  "verifier_pending_or_revoked",
  "overlay_gap",
] as const;
export type ProactiveSignalKind = (typeof proactiveSignalKinds)[number];

export const proactiveSuggestionStatuses = [
  "active",
  "snoozed",
  "dismissed",
  "accepted",
] as const;
export type ProactiveSuggestionStatus =
  (typeof proactiveSuggestionStatuses)[number];

export type ProactiveSourceRef = {
  kind:
    | "claim"
    | "inbox_proposal"
    | "planner_plan"
    | "planner_execution"
    | "verifier"
    | "overlay";
  id: string;
  detail: string;
};

export type ProactiveSuggestionRecord = {
  scope: IdentityScope;
  suggestionId: string;
  signalFingerprint: string;
  signalKind: ProactiveSignalKind;
  title: string;
  rationale: string;
  priorityScore: number;
  priorityBand: "critical" | "high" | "medium" | "low";
  sourceRefs: ProactiveSourceRef[];
  proposedAction: {
    kind:
      | "open_review"
      | "resolve_conflict"
      | "rerun_preflight"
      | "review_inbox"
      | "approve_verifier"
      | "inspect_overlay";
    label: string;
    targetSection: "memory" | "planner" | "intelligence";
  };
  autoExecutable: false;
  status: ProactiveSuggestionStatus;
  snoozeUntil: string | null;
  dismissReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProactivityTelemetrySummary = {
  evaluatedCount: number;
  acceptedCount: number;
  dismissedCount: number;
  snoozedCount: number;
  restoredCount: number;
  utilityRate: number;
  estimatedManualSeconds: number;
  estimatedSavedSeconds: number;
};

export type ProactivityEvaluateResult = {
  scope: IdentityScope;
  evaluatedAt: string;
  mutatedOrigin: false;
  suggestions: ProactiveSuggestionRecord[];
  telemetry: ProactivityTelemetrySummary;
};

export type ProactivitySuggestionListResult = {
  scope: IdentityScope;
  suggestions: ProactiveSuggestionRecord[];
  telemetry: ProactivityTelemetrySummary;
};

export type ProactivitySuggestionRespondResult = {
  scope: IdentityScope;
  suggestion: ProactiveSuggestionRecord;
  telemetry: ProactivityTelemetrySummary;
  autoExecuted: false;
};

export type ProactiveScheduleRecord = {
  scope: IdentityScope;
  scheduleId: string;
  label: string;
  optInActive: boolean;
  status: "active" | "paused" | "revoked";
  windowStartUtc: string;
  windowEndUtc: string;
  allowedDaysUtc: number[];
  minIntervalMinutes: number;
  appClosedMode: "disabled_deferred";
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProactiveScheduleRunRecord = {
  scope: IdentityScope;
  runId: string;
  scheduleId: string;
  windowKey: string;
  state:
    | "running"
    | "completed"
    | "cancelled"
    | "blocked_out_of_window"
    | "blocked_revoked"
    | "interrupted_recovered";
  recoveredAfterRestart: boolean;
  duplicateSuppressed: boolean;
  suggestionsFound: number;
  detail: string;
  startedAt: string;
  finishedAt: string | null;
};

export type ProactiveScheduleListResult = {
  scope: IdentityScope;
  schedules: ProactiveScheduleRecord[];
  runs: ProactiveScheduleRunRecord[];
  appClosedSupported: false;
};

export type ProactivitySuggestionRespondInput = IdentityScope & {
  suggestionId: string;
  action: "accept_proposal" | "dismiss" | "snooze" | "restore";
  snoozeUntil?: string;
  reason?: string;
};

export type ProactiveScheduleUpsertInput = IdentityScope & {
  scheduleId?: string;
  label: string;
  optInConfirmed: boolean;
  windowStartUtc: string;
  windowEndUtc: string;
  allowedDaysUtc: number[];
  minIntervalMinutes: number;
  appClosedMode?: string;
  runWhenAppClosed?: boolean;
};

export type ProactiveScheduleControlInput = IdentityScope & {
  scheduleId: string;
  action: "trigger_window" | "cancel_run" | "revoke";
  evaluatedAt?: string;
  runId?: string;
  reason?: string;
  humanConfirmed?: boolean;
};

export type IntelligenceRequests =
  | ({ operation: "arena.sessionCreate" } & ArenaSessionCreateInput)
  | ({ operation: "arena.sessionRun" } & ArenaSessionRunInput)
  | (IdentityScope & { operation: "arena.sessionList" })
  | ({ operation: "arena.sessionGet" } & ArenaSessionGetInput)
  | ({ operation: "arena.sessionReview" } & ArenaSessionReviewInput)
  | ({ operation: "replay.query" } & ReplayQueryInput)
  | ({ operation: "replay.diff" } & ReplayDiffInput)
  | ({ operation: "replay.deliveryInspect" } & ReplayDeliveryInspectInput)
  | ({ operation: "learning.hypothesisUpsert" } & BkmHypothesisUpsertInput)
  | (IdentityScope & { operation: "learning.hypothesisList" })
  | ({
      operation: "learning.hypothesisTransition";
    } & BkmHypothesisTransitionInput)
  | ({ operation: "learning.evaluateAdaptive" } & AdaptiveEvaluateInput)
  | ({ operation: "learning.strategyActivate" } & AdaptiveStrategyActivateInput)
  | (IdentityScope & { operation: "learning.strategyStatus" })
  | (IdentityScope & { operation: "proactivity.evaluate" })
  | (IdentityScope & { operation: "proactivity.suggestionList" })
  | ({
      operation: "proactivity.suggestionRespond";
    } & ProactivitySuggestionRespondInput)
  | ({ operation: "proactivity.scheduleUpsert" } & ProactiveScheduleUpsertInput)
  | (IdentityScope & { operation: "proactivity.scheduleList" })
  | ({
      operation: "proactivity.scheduleControl";
    } & ProactiveScheduleControlInput);

export type IntelligenceResults = {
  "arena.sessionCreate": ArenaSessionRecord;
  "arena.sessionRun": ArenaSessionRecord;
  "arena.sessionList": ArenaSessionListResult;
  "arena.sessionGet": ArenaSessionRecord;
  "arena.sessionReview": ArenaSessionRecord;
  "replay.query": ReplayQueryResult;
  "replay.diff": ReplayDiffResult;
  "replay.deliveryInspect": ReplayDeliveryDetail;
  "learning.hypothesisUpsert": BkmHypothesisRecord;
  "learning.hypothesisList": BkmHypothesisListResult;
  "learning.hypothesisTransition": BkmHypothesisRecord;
  "learning.evaluateAdaptive": EvaluationRunRecord;
  "learning.strategyActivate": AdaptiveStrategyStatusResult;
  "learning.strategyStatus": AdaptiveStrategyStatusResult;
  "proactivity.evaluate": ProactivityEvaluateResult;
  "proactivity.suggestionList": ProactivitySuggestionListResult;
  "proactivity.suggestionRespond": ProactivitySuggestionRespondResult;
  "proactivity.scheduleUpsert": ProactiveScheduleRecord;
  "proactivity.scheduleList": ProactiveScheduleListResult;
  "proactivity.scheduleControl":
    ProactiveScheduleRunRecord | ProactiveScheduleRecord;
};

const utf8 = new TextEncoder();

function oneOf<T extends string>(
  list: readonly T[],
  value: unknown,
): value is T {
  return list.some((item) => item === value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,64}$/.test(value);
}

function boundedBytes(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxBytes &&
    utf8.encode(value).length <= maxBytes &&
    !/[\0\p{Cs}]/u.test(value)
  );
}

function nonEmptyNoNul(value: unknown, maxChars: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxChars &&
    !/[\0\p{Cs}]/u.test(value)
  );
}

function isUtcTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && isContextDate(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readProposedEdit(value: unknown): PlannerProposedEdit | undefined {
  if (!isRecord(value)) return;
  if (
    !isContextPath(value.path) ||
    (value.action !== "create" &&
      value.action !== "modify" &&
      value.action !== "delete")
  ) {
    return;
  }
  if (value.action === "delete") {
    if (value.content !== undefined && value.content !== null) return;
    return { path: value.path, action: "delete", content: null };
  }
  if (
    typeof value.content !== "string" ||
    utf8.encode(value.content).length > plannerMaxEditBytes ||
    /[\0\p{Cs}]/u.test(value.content)
  ) {
    return;
  }
  return { path: value.path, action: value.action, content: value.content };
}

function readSourceRef(value: unknown): ArenaSourceRef | undefined {
  if (!isRecord(value)) return;
  if (
    !oneOf(
      ["diff", "execution", "context_excerpt", "claim", "decision"],
      value.kind,
    ) ||
    !nonEmptyNoNul(value.refId, 128) ||
    !nonEmptyNoNul(value.label, 256) ||
    (value.digest !== null && !isProjectId(value.digest))
  ) {
    return;
  }
  return {
    kind: value.kind,
    refId: value.refId,
    label: value.label,
    digest: value.digest,
  };
}

function readArenaCriteria(value: unknown): ArenaCriteria | undefined {
  if (
    !isRecord(value) ||
    !boundedBytes(value.sharedObjective, plannerMaxObjectiveBytes)
  ) {
    return;
  }
  if (
    !Array.isArray(value.items) ||
    value.items.length === 0 ||
    value.items.length > arenaMaxCriteria
  ) {
    return;
  }
  const items: ArenaCriterion[] = [];
  const seenIds = new Set<string>();
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      !isSlug(item.criterionId) ||
      seenIds.has(item.criterionId) ||
      !nonEmptyNoNul(item.label, 256) ||
      !isFiniteNumber(item.weight) ||
      item.weight <= 0 ||
      item.weight > 100
    ) {
      return;
    }
    seenIds.add(item.criterionId);
    items.push({
      criterionId: item.criterionId,
      label: item.label.trim(),
      weight: item.weight,
    });
  }
  return { sharedObjective: value.sharedObjective.trim(), items };
}

function readArenaHypothesisInput(
  value: unknown,
): ArenaHypothesisInput | undefined {
  if (!isRecord(value)) return;
  if (
    !isSlug(value.hypothesisId) ||
    !boundedBytes(value.label, plannerMaxTitleBytes) ||
    !boundedBytes(value.summary, plannerMaxObjectiveBytes) ||
    !Array.isArray(value.targetPaths) ||
    value.targetPaths.length === 0 ||
    value.targetPaths.length > plannerMaxProposedEdits ||
    !value.targetPaths.every(isContextPath)
  ) {
    return;
  }
  let proposedEdits: PlannerProposedEdit[] | undefined;
  if (value.proposedEdits !== undefined) {
    if (
      !Array.isArray(value.proposedEdits) ||
      value.proposedEdits.length > plannerMaxProposedEdits
    ) {
      return;
    }
    const parsed = value.proposedEdits.map(readProposedEdit);
    if (!parsed.every((e): e is PlannerProposedEdit => e !== undefined)) return;
    proposedEdits = parsed;
  }
  let commandArgv: string[] | undefined;
  if (value.commandArgv !== undefined) {
    if (
      !Array.isArray(value.commandArgv) ||
      value.commandArgv.length === 0 ||
      value.commandArgv.length > 32 ||
      !value.commandArgv.every((a) => nonEmptyNoNul(a, 2048))
    ) {
      return;
    }
    commandArgv = [...value.commandArgv];
  }
  if (
    value.mockBehavior !== undefined &&
    value.mockBehavior !== "complete" &&
    value.mockBehavior !== "fail"
  ) {
    return;
  }
  let sourceRefs: ArenaSourceRef[] | undefined;
  if (value.sourceRefs !== undefined) {
    if (
      !Array.isArray(value.sourceRefs) ||
      value.sourceRefs.length > arenaMaxSourceRefs
    ) {
      return;
    }
    const refs = value.sourceRefs.map(readSourceRef);
    if (!refs.every((r): r is ArenaSourceRef => r !== undefined)) return;
    sourceRefs = refs;
  }
  const out: ArenaHypothesisInput = {
    hypothesisId: value.hypothesisId,
    label: value.label.trim(),
    summary: value.summary.trim(),
    targetPaths: [...new Set(value.targetPaths)],
  };
  if (proposedEdits !== undefined) out.proposedEdits = proposedEdits;
  if (commandArgv !== undefined) out.commandArgv = commandArgv;
  if (value.mockBehavior !== undefined) out.mockBehavior = value.mockBehavior;
  if (sourceRefs !== undefined) out.sourceRefs = sourceRefs;
  return out;
}

function readBkmPattern(value: unknown): BkmPattern | undefined {
  if (!isRecord(value)) return;
  if (
    !Array.isArray(value.keywords) ||
    value.keywords.length > bkmMaxKeywords ||
    !value.keywords.every((k) => nonEmptyNoNul(k, 64)) ||
    !Array.isArray(value.pathPrefixes) ||
    value.pathPrefixes.length > bkmMaxPaths ||
    !value.pathPrefixes.every((p) => nonEmptyNoNul(p, 256)) ||
    !isFiniteNumber(value.boostWeight) ||
    value.boostWeight < -10 ||
    value.boostWeight > 10 ||
    typeof value.preferCanonical !== "boolean" ||
    typeof value.preferRecent !== "boolean"
  ) {
    return;
  }
  return {
    keywords: [...new Set(value.keywords.map((k) => k.trim()))],
    pathPrefixes: [...new Set(value.pathPrefixes.map((p) => p.trim()))],
    boostWeight: value.boostWeight,
    preferCanonical: value.preferCanonical,
    preferRecent: value.preferRecent,
  };
}

function readHeldOutCase(value: unknown): HeldOutEvalCase | undefined {
  if (!isRecord(value)) return;
  if (
    !isSlug(value.caseId) ||
    !nonEmptyNoNul(value.query, 512) ||
    !isIsoDate(value.queryAt) ||
    !isCount(value.topK) ||
    value.topK < 1 ||
    value.topK > 20 ||
    !Array.isArray(value.candidates) ||
    value.candidates.length === 0 ||
    value.candidates.length > adaptiveMaxCandidatesPerCase
  ) {
    return;
  }
  const candidates: HeldOutCandidateItem[] = [];
  for (const item of value.candidates) {
    if (
      !isRecord(item) ||
      !isSlug(item.itemId) ||
      !isIdentityScope(item.scope) ||
      !nonEmptyNoNul(item.path, 384) ||
      !nonEmptyNoNul(item.title, 256) ||
      typeof item.text !== "string" ||
      item.text.length > 8192 ||
      /[\0\p{Cs}]/u.test(item.text) ||
      !isIsoDate(item.recordedAt) ||
      !isIsoDate(item.validAt) ||
      typeof item.isCurrent !== "boolean" ||
      typeof item.isMandatory !== "boolean" ||
      typeof item.isCanonical !== "boolean" ||
      typeof item.isSecretOrCanary !== "boolean" ||
      !isFiniteNumber(item.ftsScore) ||
      typeof item.isRelevant !== "boolean"
    ) {
      return;
    }
    candidates.push({
      itemId: item.itemId,
      scope: item.scope,
      path: item.path,
      title: item.title,
      text: item.text,
      recordedAt: item.recordedAt,
      validAt: item.validAt,
      isCurrent: item.isCurrent,
      isMandatory: item.isMandatory,
      isCanonical: item.isCanonical,
      isSecretOrCanary: item.isSecretOrCanary,
      ftsScore: item.ftsScore,
      isRelevant: item.isRelevant,
    });
  }
  return {
    caseId: value.caseId,
    query: value.query.trim(),
    queryAt: value.queryAt,
    topK: value.topK,
    candidates,
  };
}

export function parseIntelligenceRequest(
  raw: Record<string, unknown>,
): IntelligenceRequests | undefined {
  const op = raw.operation;
  if (
    typeof op !== "string" ||
    (!op.startsWith("arena.") &&
      !op.startsWith("replay.") &&
      !op.startsWith("learning.") &&
      !op.startsWith("proactivity."))
  ) {
    return;
  }
  const scopeCandidate: unknown = {
    projectId: raw.projectId,
    bindingId: raw.bindingId,
    worktreeId: raw.worktreeId,
  };
  if (!isIdentityScope(scopeCandidate)) return;
  const scope: IdentityScope = scopeCandidate;

  switch (op) {
    case "arena.sessionCreate": {
      const criteria = readArenaCriteria(raw.criteria);
      if (
        !isRequestId(raw.requestId) ||
        !boundedBytes(raw.title, plannerMaxTitleBytes) ||
        !boundedBytes(raw.objective, plannerMaxObjectiveBytes) ||
        !oneOf(plannerBackendModes, raw.backendMode) ||
        !criteria ||
        !Array.isArray(raw.hypotheses) ||
        raw.hypotheses.length < arenaMinHypotheses ||
        raw.hypotheses.length > arenaMaxHypotheses ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      const hypotheses = raw.hypotheses.map(readArenaHypothesisInput);
      if (
        !hypotheses.every((h): h is ArenaHypothesisInput => h !== undefined)
      ) {
        return;
      }
      const ids = new Set(hypotheses.map((h) => h.hypothesisId));
      if (ids.size !== hypotheses.length) return;
      return {
        operation: "arena.sessionCreate",
        ...scope,
        requestId: raw.requestId,
        title: raw.title.trim(),
        objective: raw.objective.trim(),
        backendMode: raw.backendMode,
        criteria,
        hypotheses,
        humanConfirmed: raw.humanConfirmed,
      };
    }
    case "arena.sessionRun":
      if (
        !isRequestId(raw.sessionId) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      return {
        operation: "arena.sessionRun",
        ...scope,
        sessionId: raw.sessionId,
        humanConfirmed: raw.humanConfirmed,
      };
    case "arena.sessionList":
      return { operation: "arena.sessionList", ...scope };
    case "arena.sessionGet":
      if (!isRequestId(raw.sessionId)) return;
      return {
        operation: "arena.sessionGet",
        ...scope,
        sessionId: raw.sessionId,
      };
    case "arena.sessionReview": {
      if (
        !isRequestId(raw.sessionId) ||
        !isRequestId(raw.requestId) ||
        !oneOf(arenaReviewOutcomes, raw.outcome) ||
        (raw.winnerHypothesisId !== null && !isSlug(raw.winnerHypothesisId)) ||
        !nonEmptyNoNul(raw.reviewer, 128) ||
        !nonEmptyNoNul(raw.rationale, 2048) ||
        !Array.isArray(raw.reviewedHypothesisIds) ||
        raw.reviewedHypothesisIds.length < arenaMinHypotheses ||
        !raw.reviewedHypothesisIds.every(isSlug) ||
        !Array.isArray(raw.criterionScores) ||
        !Array.isArray(raw.evidenceRefs) ||
        !raw.evidenceRefs.every((r) => nonEmptyNoNul(r, 256)) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      const scores: {
        hypothesisId: string;
        criterionId: string;
        score: number;
      }[] = [];
      for (const s of raw.criterionScores) {
        if (
          !isRecord(s) ||
          !isSlug(s.hypothesisId) ||
          !isSlug(s.criterionId) ||
          !isFiniteNumber(s.score) ||
          s.score < 0 ||
          s.score > 10
        ) {
          return;
        }
        scores.push({
          hypothesisId: s.hypothesisId,
          criterionId: s.criterionId,
          score: s.score,
        });
      }
      return {
        operation: "arena.sessionReview",
        ...scope,
        sessionId: raw.sessionId,
        requestId: raw.requestId,
        outcome: raw.outcome,
        winnerHypothesisId: raw.winnerHypothesisId,
        reviewer: raw.reviewer.trim(),
        rationale: raw.rationale.trim(),
        reviewedHypothesisIds: [...raw.reviewedHypothesisIds],
        criterionScores: scores,
        evidenceRefs: [...raw.evidenceRefs],
        humanConfirmed: raw.humanConfirmed,
      };
    }
    case "replay.query": {
      if (!isIsoDate(raw.validAt) || !isIsoDate(raw.knownAt)) return;
      if (
        raw.signalKinds !== undefined &&
        (!Array.isArray(raw.signalKinds) ||
          raw.signalKinds.length > timelineSignalKinds.length ||
          !raw.signalKinds.every((k) => oneOf(timelineSignalKinds, k)))
      ) {
        return;
      }
      const out: Extract<IntelligenceRequests, { operation: "replay.query" }> =
        {
          operation: "replay.query",
          ...scope,
          validAt: raw.validAt,
          knownAt: raw.knownAt,
        };
      if (raw.signalKinds !== undefined) out.signalKinds = raw.signalKinds;
      return out;
    }
    case "replay.diff": {
      if (
        !isRecord(raw.pointA) ||
        !isIsoDate(raw.pointA.validAt) ||
        !isIsoDate(raw.pointA.knownAt) ||
        !isRecord(raw.pointB) ||
        !isIsoDate(raw.pointB.validAt) ||
        !isIsoDate(raw.pointB.knownAt)
      ) {
        return;
      }
      return {
        operation: "replay.diff",
        ...scope,
        pointA: { validAt: raw.pointA.validAt, knownAt: raw.pointA.knownAt },
        pointB: { validAt: raw.pointB.validAt, knownAt: raw.pointB.knownAt },
      };
    }
    case "replay.deliveryInspect":
      if (!isProjectId(raw.manifestDigest) || !isIsoDate(raw.knownAt)) {
        return;
      }
      return {
        operation: "replay.deliveryInspect",
        ...scope,
        manifestDigest: raw.manifestDigest,
        knownAt: raw.knownAt,
      };
    case "learning.hypothesisUpsert": {
      const pattern = readBkmPattern(raw.pattern);
      if (
        !isRequestId(raw.requestId) ||
        (raw.hypothesisId !== undefined && !isSlug(raw.hypothesisId)) ||
        !isSlug(raw.competingGroupKey) ||
        !oneOf(bkmCategories, raw.category) ||
        !boundedBytes(raw.title, bkmMaxTitleBytes) ||
        !boundedBytes(raw.statement, bkmMaxStatementBytes) ||
        !pattern
      ) {
        return;
      }
      let evidence: BkmHypothesisUpsertInput["evidence"];
      if (raw.evidence !== undefined) {
        if (!Array.isArray(raw.evidence) || raw.evidence.length > 32) return;
        evidence = [];
        for (const ev of raw.evidence) {
          if (
            !isRecord(ev) ||
            (ev.polarity !== "support" && ev.polarity !== "oppose") ||
            !isSlug(ev.originKey) ||
            !oneOf(["inbox_feedback", "review", "manual"], ev.originKind) ||
            (ev.sourceRefId !== undefined &&
              ev.sourceRefId !== null &&
              !isSlug(ev.sourceRefId)) ||
            (ev.weight !== undefined &&
              (!isFiniteNumber(ev.weight) ||
                ev.weight <= 0 ||
                ev.weight > 10)) ||
            !nonEmptyNoNul(ev.note, 512)
          ) {
            return;
          }
          const item: NonNullable<
            BkmHypothesisUpsertInput["evidence"]
          >[number] = {
            polarity: ev.polarity,
            originKey: ev.originKey,
            originKind: ev.originKind,
            note: ev.note.trim(),
          };
          if (ev.sourceRefId !== undefined) item.sourceRefId = ev.sourceRefId;
          if (ev.weight !== undefined) item.weight = ev.weight;
          evidence.push(item);
        }
      }
      const out: Extract<
        IntelligenceRequests,
        { operation: "learning.hypothesisUpsert" }
      > = {
        operation: "learning.hypothesisUpsert",
        ...scope,
        requestId: raw.requestId,
        competingGroupKey: raw.competingGroupKey,
        category: raw.category,
        title: raw.title.trim(),
        statement: raw.statement.trim(),
        pattern,
      };
      if (raw.hypothesisId !== undefined) out.hypothesisId = raw.hypothesisId;
      if (evidence !== undefined) out.evidence = evidence;
      return out;
    }
    case "learning.hypothesisList":
      return { operation: "learning.hypothesisList", ...scope };
    case "learning.hypothesisTransition": {
      if (
        !isSlug(raw.hypothesisId) ||
        !oneOf(bkmHypothesisStates, raw.toState) ||
        !nonEmptyNoNul(raw.reason, 512) ||
        !nonEmptyNoNul(raw.reviewer, 128) ||
        typeof raw.humanConfirmed !== "boolean" ||
        (raw.supersedeCompetitors !== undefined &&
          typeof raw.supersedeCompetitors !== "boolean")
      ) {
        return;
      }
      const out: Extract<
        IntelligenceRequests,
        { operation: "learning.hypothesisTransition" }
      > = {
        operation: "learning.hypothesisTransition",
        ...scope,
        hypothesisId: raw.hypothesisId,
        toState: raw.toState,
        reason: raw.reason.trim(),
        reviewer: raw.reviewer.trim(),
        humanConfirmed: raw.humanConfirmed,
      };
      if (raw.supersedeCompetitors !== undefined) {
        out.supersedeCompetitors = raw.supersedeCompetitors;
      }
      return out;
    }
    case "learning.evaluateAdaptive": {
      if (
        !isRequestId(raw.requestId) ||
        (raw.strategyVersion !== undefined && !isSlug(raw.strategyVersion)) ||
        !isIsoDate(raw.splitBoundaryAt) ||
        (raw.minRecallGain !== undefined &&
          (!isFiniteNumber(raw.minRecallGain) ||
            raw.minRecallGain < 0 ||
            raw.minRecallGain > 1)) ||
        (raw.maxComputeCostMs !== undefined &&
          (!isFiniteNumber(raw.maxComputeCostMs) ||
            raw.maxComputeCostMs <= 0 ||
            raw.maxComputeCostMs > 10_000)) ||
        !Array.isArray(raw.heldOutCases) ||
        raw.heldOutCases.length > adaptiveMaxHeldOutCases
      ) {
        return;
      }
      const cases = raw.heldOutCases.map(readHeldOutCase);
      if (!cases.every((c): c is HeldOutEvalCase => c !== undefined)) return;
      const out: Extract<
        IntelligenceRequests,
        { operation: "learning.evaluateAdaptive" }
      > = {
        operation: "learning.evaluateAdaptive",
        ...scope,
        requestId: raw.requestId,
        splitBoundaryAt: raw.splitBoundaryAt,
        heldOutCases: cases,
      };
      if (raw.strategyVersion !== undefined) {
        out.strategyVersion = raw.strategyVersion;
      }
      if (raw.minRecallGain !== undefined)
        out.minRecallGain = raw.minRecallGain;
      if (raw.maxComputeCostMs !== undefined) {
        out.maxComputeCostMs = raw.maxComputeCostMs;
      }
      return out;
    }
    case "learning.strategyActivate": {
      if (
        (raw.mode !== "adaptive_symbolic" &&
          raw.mode !== "rollback_to_baseline") ||
        (raw.evaluationId !== undefined && !isRequestId(raw.evaluationId)) ||
        !nonEmptyNoNul(raw.reviewer, 128) ||
        !nonEmptyNoNul(raw.reason, 512) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      const out: Extract<
        IntelligenceRequests,
        { operation: "learning.strategyActivate" }
      > = {
        operation: "learning.strategyActivate",
        ...scope,
        mode: raw.mode,
        reviewer: raw.reviewer.trim(),
        reason: raw.reason.trim(),
        humanConfirmed: raw.humanConfirmed,
      };
      if (raw.evaluationId !== undefined) out.evaluationId = raw.evaluationId;
      return out;
    }
    case "learning.strategyStatus":
      return { operation: "learning.strategyStatus", ...scope };
    case "proactivity.evaluate":
      return { operation: "proactivity.evaluate", ...scope };
    case "proactivity.suggestionList":
      return { operation: "proactivity.suggestionList", ...scope };
    case "proactivity.suggestionRespond": {
      if (
        !isRequestId(raw.suggestionId) ||
        !oneOf(
          ["accept_proposal", "dismiss", "snooze", "restore"],
          raw.action,
        ) ||
        (raw.snoozeUntil !== undefined && !isIsoDate(raw.snoozeUntil)) ||
        (raw.reason !== undefined && !nonEmptyNoNul(raw.reason, 512))
      ) {
        return;
      }
      const out: Extract<
        IntelligenceRequests,
        { operation: "proactivity.suggestionRespond" }
      > = {
        operation: "proactivity.suggestionRespond",
        ...scope,
        suggestionId: raw.suggestionId,
        action: raw.action,
      };
      if (raw.snoozeUntil !== undefined) out.snoozeUntil = raw.snoozeUntil;
      if (raw.reason !== undefined) out.reason = raw.reason.trim();
      return out;
    }
    case "proactivity.scheduleUpsert": {
      if (
        (raw.scheduleId !== undefined && !isSlug(raw.scheduleId)) ||
        !nonEmptyNoNul(raw.label, 160) ||
        typeof raw.optInConfirmed !== "boolean" ||
        !isUtcTime(raw.windowStartUtc) ||
        !isUtcTime(raw.windowEndUtc) ||
        !Array.isArray(raw.allowedDaysUtc) ||
        raw.allowedDaysUtc.length === 0 ||
        raw.allowedDaysUtc.length > 7 ||
        !raw.allowedDaysUtc.every(
          (d) =>
            typeof d === "number" &&
            Number.isSafeInteger(d) &&
            d >= 0 &&
            d <= 6,
        ) ||
        !isCount(raw.minIntervalMinutes) ||
        raw.minIntervalMinutes < 1 ||
        raw.minIntervalMinutes > 1440 ||
        (raw.appClosedMode !== undefined &&
          typeof raw.appClosedMode !== "string") ||
        (raw.runWhenAppClosed !== undefined &&
          typeof raw.runWhenAppClosed !== "boolean")
      ) {
        return;
      }
      const out: Extract<
        IntelligenceRequests,
        { operation: "proactivity.scheduleUpsert" }
      > = {
        operation: "proactivity.scheduleUpsert",
        ...scope,
        label: raw.label.trim(),
        optInConfirmed: raw.optInConfirmed,
        windowStartUtc: raw.windowStartUtc,
        windowEndUtc: raw.windowEndUtc,
        allowedDaysUtc: [...new Set(raw.allowedDaysUtc)].sort(),
        minIntervalMinutes: raw.minIntervalMinutes,
      };
      if (raw.scheduleId !== undefined) out.scheduleId = raw.scheduleId;
      if (raw.appClosedMode !== undefined)
        out.appClosedMode = raw.appClosedMode;
      if (raw.runWhenAppClosed !== undefined) {
        out.runWhenAppClosed = raw.runWhenAppClosed;
      }
      return out;
    }
    case "proactivity.scheduleList":
      return { operation: "proactivity.scheduleList", ...scope };
    case "proactivity.scheduleControl": {
      if (
        !isSlug(raw.scheduleId) ||
        !oneOf(["trigger_window", "cancel_run", "revoke"], raw.action) ||
        (raw.evaluatedAt !== undefined && !isIsoDate(raw.evaluatedAt)) ||
        (raw.runId !== undefined && !isRequestId(raw.runId)) ||
        (raw.reason !== undefined && !nonEmptyNoNul(raw.reason, 512)) ||
        (raw.humanConfirmed !== undefined &&
          typeof raw.humanConfirmed !== "boolean")
      ) {
        return;
      }
      const out: Extract<
        IntelligenceRequests,
        { operation: "proactivity.scheduleControl" }
      > = {
        operation: "proactivity.scheduleControl",
        ...scope,
        scheduleId: raw.scheduleId,
        action: raw.action,
      };
      if (raw.evaluatedAt !== undefined) out.evaluatedAt = raw.evaluatedAt;
      if (raw.runId !== undefined) out.runId = raw.runId;
      if (raw.reason !== undefined) out.reason = raw.reason.trim();
      if (raw.humanConfirmed !== undefined) {
        out.humanConfirmed = raw.humanConfirmed;
      }
      return out;
    }
    default:
      return;
  }
}

function isArenaHypothesisRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    isCount(value.ordinal) &&
    isSlug(value.hypothesisId) &&
    nonEmptyNoNul(value.label, 256) &&
    oneOf(arenaHypothesisStates, value.state) &&
    isProjectId(value.criteriaDigest) &&
    Array.isArray(value.sourceRefs) &&
    Array.isArray(value.diffFiles) &&
    (value.observedBaseHead === null ||
      isGitObjectId(value.observedBaseHead)) &&
    (value.observedBaseDigest === null ||
      isProjectId(value.observedBaseDigest)) &&
    (value.diffDigest === null || isProjectId(value.diffDigest))
  );
}

function isArenaSessionRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isRequestId(value.sessionId) &&
    isRequestId(value.requestId) &&
    nonEmptyNoNul(value.title, 256) &&
    oneOf(plannerBackendModes, value.backendMode) &&
    oneOf(arenaSessionStatuses, value.status) &&
    (value.invalidationReason === null ||
      oneOf(arenaInvalidationReasons, value.invalidationReason)) &&
    isProjectId(value.baseDigest) &&
    isProjectId(value.criteriaDigest) &&
    Array.isArray(value.hypotheses) &&
    value.hypotheses.length >= arenaMinHypotheses &&
    value.hypotheses.every(isArenaHypothesisRecord) &&
    value.appliedToLocal === false &&
    isContextDate(value.createdAt) &&
    isContextDate(value.updatedAt) &&
    (value.pairedReview === null ||
      (isRecord(value.pairedReview) &&
        oneOf(arenaReviewOutcomes, value.pairedReview.outcome) &&
        value.pairedReview.appliedToLocal === false &&
        Array.isArray(value.pairedReview.reviewedHypothesisIds)))
  );
}

function isBkmHypothesisRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isSlug(value.hypothesisId) &&
    isSlug(value.competingGroupKey) &&
    oneOf(bkmCategories, value.category) &&
    oneOf(bkmHypothesisStates, value.state) &&
    isCount(value.independentSupportOrigins) &&
    isCount(value.independentOpposeOrigins) &&
    Array.isArray(value.evidence) &&
    Array.isArray(value.transitions) &&
    isContextDate(value.createdAt) &&
    isContextDate(value.updatedAt)
  );
}

function isEvaluationRunRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isRequestId(value.evaluationId) &&
    isRequestId(value.requestId) &&
    nonEmptyNoNul(value.baselineVersion, 64) &&
    nonEmptyNoNul(value.strategyVersion, 64) &&
    isContextDate(value.splitBoundaryAt) &&
    isCount(value.heldOutCount) &&
    typeof value.temporalSplitValid === "boolean" &&
    typeof value.projectIsolationValid === "boolean" &&
    (value.decision === "eligible_for_activation" ||
      value.decision === "stay_on_baseline") &&
    Array.isArray(value.failedGates) &&
    Array.isArray(value.explanations) &&
    isProjectId(value.reportDigest) &&
    isContextDate(value.evaluatedAt)
  );
}

function isProactiveSuggestionRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isRequestId(value.suggestionId) &&
    isProjectId(value.signalFingerprint) &&
    oneOf(proactiveSignalKinds, value.signalKind) &&
    oneOf(proactiveSuggestionStatuses, value.status) &&
    isFiniteNumber(value.priorityScore) &&
    value.autoExecutable === false &&
    Array.isArray(value.sourceRefs) &&
    isContextDate(value.createdAt)
  );
}

function isProactiveScheduleRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isSlug(value.scheduleId) &&
    typeof value.optInActive === "boolean" &&
    oneOf(["active", "paused", "revoked"], value.status) &&
    isUtcTime(value.windowStartUtc) &&
    isUtcTime(value.windowEndUtc) &&
    value.appClosedMode === "disabled_deferred"
  );
}

function isProactiveScheduleRunRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isRequestId(value.runId) &&
    isSlug(value.scheduleId) &&
    nonEmptyNoNul(value.windowKey, 128) &&
    typeof value.recoveredAfterRestart === "boolean" &&
    typeof value.duplicateSuppressed === "boolean" &&
    isContextDate(value.startedAt)
  );
}

export function isIntelligenceResult<K extends keyof IntelligenceResults>(
  operation: K,
  value: unknown,
): boolean {
  if (!isRecord(value) || !isIdentityScope(value.scope)) return false;
  switch (operation) {
    case "arena.sessionCreate":
    case "arena.sessionRun":
    case "arena.sessionGet":
    case "arena.sessionReview":
      return isArenaSessionRecord(value);
    case "arena.sessionList":
      return (
        Array.isArray(value.items) && value.items.every(isArenaSessionRecord)
      );
    case "replay.query":
      return (
        isContextDate(value.validAt) &&
        isContextDate(value.knownAt) &&
        Array.isArray(value.claims) &&
        Array.isArray(value.decisions) &&
        Array.isArray(value.relations) &&
        Array.isArray(value.conflicts) &&
        Array.isArray(value.gaps) &&
        Array.isArray(value.deliveries) &&
        Array.isArray(value.versionTimeline)
      );
    case "replay.diff":
      return (
        isRecord(value.pointA) &&
        isRecord(value.pointB) &&
        Array.isArray(value.addedClaims) &&
        Array.isArray(value.removedClaims) &&
        Array.isArray(value.changedClaims) &&
        Array.isArray(value.addedDecisions) &&
        Array.isArray(value.removedDecisions) &&
        Array.isArray(value.changedDecisions) &&
        Array.isArray(value.newGaps) &&
        Array.isArray(value.newDeliveries)
      );
    case "replay.deliveryInspect":
      return (
        isContextDate(value.knownAt) &&
        isProjectId(value.manifestDigest) &&
        nonEmptyNoNul(value.destinationId, 64) &&
        nonEmptyNoNul(value.policyVersion, 64) &&
        nonEmptyNoNul(value.strategyVersion, 64) &&
        Array.isArray(value.includedItems) &&
        Array.isArray(value.omittedSummary) &&
        Array.isArray(value.grants) &&
        Array.isArray(value.audits) &&
        Array.isArray(value.observedReads) &&
        Array.isArray(value.sourceGaps)
      );
    case "learning.hypothesisUpsert":
    case "learning.hypothesisTransition":
      return isBkmHypothesisRecord(value);
    case "learning.hypothesisList":
      return (
        Array.isArray(value.items) && value.items.every(isBkmHypothesisRecord)
      );
    case "learning.evaluateAdaptive":
      return isEvaluationRunRecord(value);
    case "learning.strategyActivate":
    case "learning.strategyStatus":
      return (
        (value.activeMode === "baseline_fts5" ||
          value.activeMode === "adaptive_symbolic") &&
        nonEmptyNoNul(value.activeVersion, 64) &&
        (value.evaluationId === null || isRequestId(value.evaluationId)) &&
        (value.latestEvaluation === null ||
          isEvaluationRunRecord(value.latestEvaluation)) &&
        Array.isArray(value.evaluations) &&
        value.evaluations.every(isEvaluationRunRecord)
      );
    case "proactivity.evaluate":
      return (
        isContextDate(value.evaluatedAt) &&
        value.mutatedOrigin === false &&
        Array.isArray(value.suggestions) &&
        value.suggestions.every(isProactiveSuggestionRecord) &&
        isRecord(value.telemetry)
      );
    case "proactivity.suggestionList":
      return (
        Array.isArray(value.suggestions) &&
        value.suggestions.every(isProactiveSuggestionRecord) &&
        isRecord(value.telemetry)
      );
    case "proactivity.suggestionRespond":
      return (
        isProactiveSuggestionRecord(value.suggestion) &&
        isRecord(value.telemetry) &&
        value.autoExecuted === false
      );
    case "proactivity.scheduleUpsert":
      return isProactiveScheduleRecord(value);
    case "proactivity.scheduleList":
      return (
        Array.isArray(value.schedules) &&
        value.schedules.every(isProactiveScheduleRecord) &&
        Array.isArray(value.runs) &&
        value.runs.every(isProactiveScheduleRunRecord) &&
        value.appClosedSupported === false
      );
    case "proactivity.scheduleControl":
      return (
        isProactiveScheduleRunRecord(value) || isProactiveScheduleRecord(value)
      );
    default:
      return false;
  }
}
