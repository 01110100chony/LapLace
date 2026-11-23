import { isProjectId, isRecord, isRequestId, type ErrorCode } from "./index.ts";
import { isContextDate, isContextPath } from "./context.ts";
import { isGitObjectId } from "./working-tree.ts";
import { isIdentityScope, type IdentityScope } from "./resume.ts";

export const plannerSchemaVersion = 1;
export const plannerMaxProposedEdits = 16;
export const plannerMaxEditBytes = 12 * 1024;
export const plannerMaxTitleBytes = 160;
export const plannerMaxObjectiveBytes = 4096;
export const plannerMaxEvents = 256;
export const plannerEventsPageSize = 32;
export const plannerGrantMinTtlMs = 1_000;
export const plannerGrantDefaultTtlMs = 10 * 60_000;
export const plannerGrantMaxTtlMs = 60 * 60_000;
export const verifierMinTimeoutMs = 500;
export const verifierDefaultTimeoutMs = 15_000;
export const verifierMaxTimeoutMs = 120_000;
export const verifierMaxArgv = 32;
export const verifierMaxEnvVars = 16;

export const plannerErrorCodes = [
  "planner_invalid_input",
  "planner_not_found",
  "planner_drift_detected",
  "planner_worktree_unavailable",
  "operation_grant_invalid",
  "operation_grant_expired",
  "execution_backend_blocked",
  "execution_interrupted",
  "apply_not_approved",
  "apply_conflict_detected",
  "verifier_approval_invalid",
] as const satisfies readonly ErrorCode[];

export const plannerOperationKinds = [
  "worktree_edit",
  "branch_patch",
  "verifier_only",
  "agent_supervised",
] as const;
export type PlannerOperationKind = (typeof plannerOperationKinds)[number];

export const plannerBackendModes = [
  "mock_supervised",
  "local_process_job",
  "codex_cli_workspace",
  "codex_cli_isolated",
] as const;
export type PlannerBackendMode = (typeof plannerBackendModes)[number];

export const operationEffects = [
  "create_worktree",
  "write_worktree",
  "run_agent",
  "run_verifier",
  "apply_local",
] as const;
export type OperationEffect = (typeof operationEffects)[number];

export const verifierPrivilegeProfiles = [
  "readonly_check",
  "workspace_build_test",
  "isolated_probe",
] as const;
export type VerifierPrivilegeProfile =
  (typeof verifierPrivilegeProfiles)[number];

export const plannerPreflightStatuses = [
  "valid",
  "blocked",
  "invalidated_by_drift",
] as const;
export type PlannerPreflightStatus = (typeof plannerPreflightStatuses)[number];

export const plannerRiskLevels = ["low", "medium", "high"] as const;
export type PlannerRiskLevel = (typeof plannerRiskLevels)[number];

export const plannerDriftReasons = [
  "head_changed",
  "branch_changed",
  "index_changed",
  "worktree_dirty_changed",
  "root_changed",
] as const;
export type PlannerDriftReason = (typeof plannerDriftReasons)[number];

export const plannerExecutionStates = [
  "running",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "timeout",
] as const;
export type PlannerExecutionState = (typeof plannerExecutionStates)[number];

export const plannerWorktreeStrategies = [
  "git_worktree",
  "isolated_checkout",
] as const;
export type PlannerWorktreeStrategy =
  (typeof plannerWorktreeStrategies)[number];

export const plannerWorktreeStatuses = [
  "active",
  "retained_for_review",
  "cleaned",
  "orphaned",
] as const;
export type PlannerWorktreeStatus = (typeof plannerWorktreeStatuses)[number];

export const plannerDiffActions = ["created", "modified", "deleted"] as const;
export type PlannerDiffAction = (typeof plannerDiffActions)[number];

export const plannerApplyStatuses = [
  "applied",
  "aborted_conflict",
  "rolled_back",
] as const;
export type PlannerApplyStatus = (typeof plannerApplyStatuses)[number];

export const verifierApprovalStatuses = [
  "pending",
  "approved",
  "revoked_by_redefinition",
] as const;
export type VerifierApprovalStatus = (typeof verifierApprovalStatuses)[number];

export const plannerMockBehaviors = [
  "complete",
  "hold_for_cancel",
  "fail",
] as const;
export type PlannerMockBehavior = (typeof plannerMockBehaviors)[number];

export type PlannerGitBase = {
  head: string | null;
  branch: string | null;
  indexStamp: string;
  worktreeRoot: string;
  dirtyDigest: string;
};

export type PlannerProposedEdit = {
  path: string;
  action: "create" | "modify" | "delete";
  content: string | null;
};

export type PlannerPredictedEffect = {
  kind: OperationEffect;
  target: string;
  summary: string;
  mutatesOrigin: boolean;
};

export type PlannerConflictKind =
  | "working_conflict"
  | "dirty_path_overlap"
  | "branch_exists"
  | "backend_blocked"
  | "unborn_head"
  | "session_grant_required"
  | "drift_detected";

export type PlannerConflict = {
  kind: PlannerConflictKind;
  blocking: boolean;
  path: string | null;
  summary: string;
};

export type PlannerPrecondition = {
  id: string;
  label: string;
  satisfied: boolean;
  detail: string;
};

export type PlannerExploreResult = {
  scope: IdentityScope;
  observedAt: string;
  base: PlannerGitBase;
  branches: { name: string; head: string; current: boolean }[];
  worktrees: {
    root: string;
    head: string | null;
    branch: string | null;
    isMain: boolean;
  }[];
  dirtyPaths: string[];
  conflictedPaths: string[];
  changesCount: {
    staged: number;
    unstaged: number;
    untracked: number;
    conflicted: number;
  };
  dedicatedWorktreeCount: number;
};

export type GitPlanRecord = {
  scope: IdentityScope;
  planId: string;
  requestId: string;
  title: string;
  objective: string;
  operationKind: PlannerOperationKind;
  backendMode: PlannerBackendMode;
  targetBranch: string | null;
  targetPaths: string[];
  proposedEdits: PlannerProposedEdit[];
  sessionGrantId: string | null;
  base: PlannerGitBase;
  baseDigest: string;
  riskLevel: PlannerRiskLevel;
  status: "ready" | "blocked";
  preflightStatus: PlannerPreflightStatus;
  predictedEffects: PlannerPredictedEffect[];
  conflicts: PlannerConflict[];
  preconditions: PlannerPrecondition[];
  simulationDigest: string;
  mutatesOrigin: false;
  createdAt: string;
  updatedAt: string;
};

export type PlanListResult = {
  scope: IdentityScope;
  items: GitPlanRecord[];
};

export type PreFlightCheckResult = {
  scope: IdentityScope;
  planId: string;
  checkedAt: string;
  status: PlannerPreflightStatus;
  driftDetected: boolean;
  driftReasons: PlannerDriftReason[];
  expectedBase: PlannerGitBase;
  observedBase: PlannerGitBase;
  expectedBaseDigest: string;
  observedBaseDigest: string;
  preconditions: PlannerPrecondition[];
  conflicts: PlannerConflict[];
  executionAllowed: boolean;
};

export type OperationGrantRecord = {
  scope: IdentityScope;
  grantId: string;
  planId: string;
  baseDigest: string;
  backendMode: PlannerBackendMode;
  allowedEffects: OperationEffect[];
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  status: "active" | "revoked" | "expired";
};

export type OperationGrantListResult = {
  scope: IdentityScope;
  items: OperationGrantRecord[];
};

export type BoundaryStatusResult = {
  scope: IdentityScope;
  checkedAt: string;
  lpacVerified: boolean;
  lpacDetail: string;
  strictBackendAllowed: boolean;
  supervisionHelperAvailable: boolean;
  backends: {
    mode: PlannerBackendMode;
    available: boolean;
    verified: boolean;
    blockedReason: string | null;
  }[];
};

export type SupervisedExecutionRecord = {
  scope: IdentityScope;
  executionId: string;
  requestId: string;
  planId: string;
  grantId: string;
  baseDigest: string;
  backendMode: PlannerBackendMode;
  dedicatedWorktreeId: string;
  dedicatedRoot: string;
  worktreeStrategy: PlannerWorktreeStrategy;
  worktreeStatus: PlannerWorktreeStatus;
  baseHead: string | null;
  state: PlannerExecutionState;
  failureCode: string | null;
  childPid: number | null;
  recoveredAfterRestart: boolean;
  diffDigest: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type SupervisedExecutionListResult = {
  scope: IdentityScope;
  items: SupervisedExecutionRecord[];
};

export type SupervisedExecutionEvent = {
  seq: number;
  type:
    | "queued"
    | "worktree_created"
    | "started"
    | "progress"
    | "message"
    | "cancel_requested"
    | "diff_captured"
    | "terminal";
  at: string;
  summary: string;
  state?: PlannerExecutionState;
};

export type SupervisedExecutionEventsResult = {
  scope: IdentityScope;
  execution: SupervisedExecutionRecord;
  events: SupervisedExecutionEvent[];
  nextSeq: number;
  more: boolean;
};

export type WorktreeCleanupResult = {
  scope: IdentityScope;
  executionId: string;
  dedicatedWorktreeId: string;
  dedicatedRoot: string;
  status: "cleaned";
  cleanedAt: string;
  historyPreserved: true;
};

export type ExecutionDiffFile = {
  path: string;
  action: PlannerDiffAction;
  beforeSha256: string | null;
  beforeBytes: number | null;
  beforeCrlf: boolean;
  beforeText: string | null;
  afterSha256: string | null;
  afterBytes: number | null;
  afterCrlf: boolean;
  afterText: string | null;
};

export type ExecutionDiffReview = {
  revision: number;
  requestId: string;
  diffDigest: string;
  choice: "approved" | "rejected";
  reviewer: string;
  note: string;
  recordedAt: string;
};

export type LocalApplyRecord = {
  scope: IdentityScope;
  applyId: string;
  requestId: string;
  executionId: string;
  grantId: string;
  diffDigest: string;
  backupOverlayId: string | null;
  status: PlannerApplyStatus;
  appliedPaths: string[];
  detail: string;
  appliedAt: string;
};

export type ExecutionDiffResult = {
  scope: IdentityScope;
  executionId: string;
  planId: string;
  diffDigest: string;
  baseHead: string | null;
  capturedAt: string;
  files: ExecutionDiffFile[];
  latestReview: ExecutionDiffReview | null;
  latestApply: LocalApplyRecord | null;
};

export type ExecutionReviewResult = {
  scope: IdentityScope;
  executionId: string;
  review: ExecutionDiffReview;
  appliedToLocal: false;
};

export type VerifierDefinitionRecord = {
  scope: IdentityScope;
  definitionId: string;
  label: string;
  argv: string[];
  cwdRelative: string;
  envWhitelist: string[];
  timeoutMs: number;
  privilegeProfile: VerifierPrivilegeProfile;
  definitionDigest: string;
  approvalStatus: VerifierApprovalStatus;
  approvedDigest: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VerifierRunRecord = {
  scope: IdentityScope;
  runId: string;
  requestId: string;
  definitionId: string;
  definitionDigest: string;
  executionId: string | null;
  privilegeProfile: VerifierPrivilegeProfile;
  state: "passed" | "failed" | "timeout" | "blocked";
  exitCode: number | null;
  timedOut: boolean;
  stdoutExcerpt: string;
  stderrExcerpt: string;
  durationMs: number;
  ranAt: string;
};

export type VerifierListResult = {
  scope: IdentityScope;
  items: VerifierDefinitionRecord[];
  runs: VerifierRunRecord[];
};

export type PlannerExploreInput = IdentityScope & {
  watchedPaths?: string[];
};

export type PlanCreateInput = IdentityScope & {
  requestId: string;
  title: string;
  objective: string;
  operationKind: PlannerOperationKind;
  backendMode: PlannerBackendMode;
  targetBranch?: string | null;
  targetPaths: string[];
  proposedEdits?: PlannerProposedEdit[];
  sessionGrantId?: string;
};

export type PlanPreflightInput = IdentityScope & {
  planId: string;
};

export type OperationGrantIssueInput = IdentityScope & {
  planId: string;
  expectedBaseDigest: string;
  backendMode: PlannerBackendMode;
  allowedEffects: OperationEffect[];
  ttlMs?: number;
  humanConfirmed: boolean;
  unconfinedConfirmed?: boolean;
};

export type OperationGrantRevokeInput = IdentityScope & {
  grantId: string;
  reason: string;
};

export type SupervisedExecutionStartInput = IdentityScope & {
  requestId: string;
  planId: string;
  grantId: string;
  expectedBaseDigest: string;
  mockBehavior?: PlannerMockBehavior;
  commandArgv?: string[];
  sessionGrantId?: string;
};

export type SupervisedExecutionCancelInput = IdentityScope & {
  executionId: string;
  humanConfirmed: boolean;
};

export type WorktreeCleanupInput = IdentityScope & {
  executionId: string;
  humanConfirmed: boolean;
};

export type ExecutionReviewInput = IdentityScope & {
  requestId: string;
  executionId: string;
  expectedDiffDigest: string;
  expectedRevision: number;
  choice: "approved" | "rejected";
  reviewer: string;
  note: string;
  humanConfirmed: boolean;
};

export type ApplyLocalInput = IdentityScope & {
  requestId: string;
  executionId: string;
  grantId: string;
  expectedDiffDigest: string;
  applyConfirmed: boolean;
};

export type VerifierDefineInput = IdentityScope & {
  definitionId: string;
  label: string;
  argv: string[];
  cwdRelative: string;
  envWhitelist: string[];
  timeoutMs: number;
  privilegeProfile: VerifierPrivilegeProfile;
};

export type VerifierApproveInput = IdentityScope & {
  definitionId: string;
  expectedDefinitionDigest: string;
  reviewer: string;
  humanConfirmed: boolean;
};

export type VerifierRunInput = IdentityScope & {
  requestId: string;
  definitionId: string;
  expectedDefinitionDigest: string;
  executionId?: string;
  grantId?: string;
};

export type PlannerRequests =
  | ({ operation: "planner.explore" } & PlannerExploreInput)
  | ({ operation: "planner.planCreate" } & PlanCreateInput)
  | (IdentityScope & { operation: "planner.planList" })
  | ({ operation: "planner.planPreflight" } & PlanPreflightInput)
  | ({ operation: "planner.grantIssue" } & OperationGrantIssueInput)
  | (IdentityScope & { operation: "planner.grantList"; planId?: string })
  | ({ operation: "planner.grantRevoke" } & OperationGrantRevokeInput)
  | (IdentityScope & { operation: "planner.boundaryStatus" })
  | ({ operation: "planner.executionStart" } & SupervisedExecutionStartInput)
  | (IdentityScope & { operation: "planner.executionList"; planId?: string })
  | (IdentityScope & {
      operation: "planner.executionEvents";
      executionId: string;
      afterSeq: number;
    })
  | ({ operation: "planner.executionCancel" } & SupervisedExecutionCancelInput)
  | ({ operation: "planner.worktreeCleanup" } & WorktreeCleanupInput)
  | (IdentityScope & { operation: "planner.diffGet"; executionId: string })
  | ({ operation: "planner.diffReview" } & ExecutionReviewInput)
  | ({ operation: "planner.applyLocal" } & ApplyLocalInput)
  | ({ operation: "planner.verifierDefine" } & VerifierDefineInput)
  | (IdentityScope & { operation: "planner.verifierList" })
  | ({ operation: "planner.verifierApprove" } & VerifierApproveInput)
  | ({ operation: "planner.verifierRun" } & VerifierRunInput);

export type PlannerResults = {
  "planner.explore": PlannerExploreResult;
  "planner.planCreate": GitPlanRecord;
  "planner.planList": PlanListResult;
  "planner.planPreflight": PreFlightCheckResult;
  "planner.grantIssue": OperationGrantRecord;
  "planner.grantList": OperationGrantListResult;
  "planner.grantRevoke": OperationGrantRecord;
  "planner.boundaryStatus": BoundaryStatusResult;
  "planner.executionStart": SupervisedExecutionRecord;
  "planner.executionList": SupervisedExecutionListResult;
  "planner.executionEvents": SupervisedExecutionEventsResult;
  "planner.executionCancel": SupervisedExecutionRecord;
  "planner.worktreeCleanup": WorktreeCleanupResult;
  "planner.diffGet": ExecutionDiffResult;
  "planner.diffReview": ExecutionReviewResult;
  "planner.applyLocal": LocalApplyRecord;
  "planner.verifierDefine": VerifierDefinitionRecord;
  "planner.verifierList": VerifierListResult;
  "planner.verifierApprove": VerifierDefinitionRecord;
  "planner.verifierRun": VerifierRunRecord;
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

function isEnvKey(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value)
  );
}

function isBranchName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    !/[\0\r\n\p{Cs}]/u.test(value) &&
    !value.startsWith("-") &&
    !value.includes("..") &&
    !value.includes(" ")
  );
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

function readArgvList(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > verifierMaxArgv
  ) {
    return;
  }
  const out: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.length === 0 ||
      item.length > 2048 ||
      /[\0\p{Cs}]/u.test(item)
    ) {
      return;
    }
    out.push(item);
  }
  return out;
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

function isPlannerGitBase(value: unknown): value is PlannerGitBase {
  return (
    isRecord(value) &&
    (value.head === null || isGitObjectId(value.head)) &&
    (value.branch === null || nonEmptyNoNul(value.branch, 512)) &&
    nonEmptyNoNul(value.indexStamp, 256) &&
    nonEmptyNoNul(value.worktreeRoot, 4096) &&
    isProjectId(value.dirtyDigest)
  );
}

function isGitPlanRecord(value: unknown): value is GitPlanRecord {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isRequestId(value.planId) &&
    isRequestId(value.requestId) &&
    boundedBytes(value.title, plannerMaxTitleBytes) &&
    boundedBytes(value.objective, plannerMaxObjectiveBytes) &&
    oneOf(plannerOperationKinds, value.operationKind) &&
    oneOf(plannerBackendModes, value.backendMode) &&
    (value.targetBranch === null || isBranchName(value.targetBranch)) &&
    Array.isArray(value.targetPaths) &&
    value.targetPaths.every(isContextPath) &&
    Array.isArray(value.proposedEdits) &&
    value.proposedEdits.every((item) => readProposedEdit(item) !== undefined) &&
    (value.sessionGrantId === null || isRequestId(value.sessionGrantId)) &&
    isPlannerGitBase(value.base) &&
    isProjectId(value.baseDigest) &&
    oneOf(plannerRiskLevels, value.riskLevel) &&
    (value.status === "ready" || value.status === "blocked") &&
    oneOf(plannerPreflightStatuses, value.preflightStatus) &&
    Array.isArray(value.predictedEffects) &&
    Array.isArray(value.conflicts) &&
    Array.isArray(value.preconditions) &&
    isProjectId(value.simulationDigest) &&
    value.mutatesOrigin === false &&
    isContextDate(value.createdAt) &&
    isContextDate(value.updatedAt)
  );
}

function isOperationGrantRecord(value: unknown): value is OperationGrantRecord {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isRequestId(value.grantId) &&
    isRequestId(value.planId) &&
    isProjectId(value.baseDigest) &&
    oneOf(plannerBackendModes, value.backendMode) &&
    Array.isArray(value.allowedEffects) &&
    value.allowedEffects.length > 0 &&
    value.allowedEffects.every((item) => oneOf(operationEffects, item)) &&
    isContextDate(value.issuedAt) &&
    isContextDate(value.expiresAt) &&
    (value.revokedAt === null || isContextDate(value.revokedAt)) &&
    (value.revokeReason === null || nonEmptyNoNul(value.revokeReason, 512)) &&
    oneOf(["active", "revoked", "expired"], value.status)
  );
}

function isSupervisedExecutionRecord(
  value: unknown,
): value is SupervisedExecutionRecord {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isRequestId(value.executionId) &&
    isRequestId(value.requestId) &&
    isRequestId(value.planId) &&
    isRequestId(value.grantId) &&
    isProjectId(value.baseDigest) &&
    oneOf(plannerBackendModes, value.backendMode) &&
    isRequestId(value.dedicatedWorktreeId) &&
    nonEmptyNoNul(value.dedicatedRoot, 4096) &&
    oneOf(plannerWorktreeStrategies, value.worktreeStrategy) &&
    oneOf(plannerWorktreeStatuses, value.worktreeStatus) &&
    (value.baseHead === null || isGitObjectId(value.baseHead)) &&
    oneOf(plannerExecutionStates, value.state) &&
    (value.failureCode === null || nonEmptyNoNul(value.failureCode, 128)) &&
    (value.childPid === null ||
      (isCount(value.childPid) && value.childPid > 0)) &&
    typeof value.recoveredAfterRestart === "boolean" &&
    (value.diffDigest === null || isProjectId(value.diffDigest)) &&
    isContextDate(value.startedAt) &&
    (value.finishedAt === null || isContextDate(value.finishedAt))
  );
}

function isExecutionDiffFile(value: unknown): value is ExecutionDiffFile {
  return (
    isRecord(value) &&
    isContextPath(value.path) &&
    oneOf(plannerDiffActions, value.action) &&
    (value.beforeSha256 === null || isProjectId(value.beforeSha256)) &&
    (value.beforeBytes === null || isCount(value.beforeBytes)) &&
    typeof value.beforeCrlf === "boolean" &&
    (value.beforeText === null || typeof value.beforeText === "string") &&
    (value.afterSha256 === null || isProjectId(value.afterSha256)) &&
    (value.afterBytes === null || isCount(value.afterBytes)) &&
    typeof value.afterCrlf === "boolean" &&
    (value.afterText === null || typeof value.afterText === "string")
  );
}

function isExecutionDiffReview(value: unknown): value is ExecutionDiffReview {
  return (
    isRecord(value) &&
    isCount(value.revision) &&
    value.revision > 0 &&
    isRequestId(value.requestId) &&
    isProjectId(value.diffDigest) &&
    (value.choice === "approved" || value.choice === "rejected") &&
    nonEmptyNoNul(value.reviewer, 128) &&
    nonEmptyNoNul(value.note, 512) &&
    isContextDate(value.recordedAt)
  );
}

function isLocalApplyRecord(value: unknown): value is LocalApplyRecord {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isRequestId(value.applyId) &&
    isRequestId(value.requestId) &&
    isRequestId(value.executionId) &&
    isRequestId(value.grantId) &&
    isProjectId(value.diffDigest) &&
    (value.backupOverlayId === null || isRequestId(value.backupOverlayId)) &&
    oneOf(plannerApplyStatuses, value.status) &&
    Array.isArray(value.appliedPaths) &&
    value.appliedPaths.every(isContextPath) &&
    nonEmptyNoNul(value.detail, 512) &&
    isContextDate(value.appliedAt)
  );
}

function isVerifierDefinitionRecord(
  value: unknown,
): value is VerifierDefinitionRecord {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isRequestId(value.definitionId) &&
    nonEmptyNoNul(value.label, 256) &&
    readArgvList(value.argv) !== undefined &&
    (value.cwdRelative === "" ||
      value.cwdRelative === "." ||
      isContextPath(value.cwdRelative)) &&
    Array.isArray(value.envWhitelist) &&
    value.envWhitelist.every(isEnvKey) &&
    isCount(value.timeoutMs) &&
    value.timeoutMs >= verifierMinTimeoutMs &&
    value.timeoutMs <= verifierMaxTimeoutMs &&
    oneOf(verifierPrivilegeProfiles, value.privilegeProfile) &&
    isProjectId(value.definitionDigest) &&
    oneOf(verifierApprovalStatuses, value.approvalStatus) &&
    (value.approvedDigest === null || isProjectId(value.approvedDigest)) &&
    (value.approvedBy === null || nonEmptyNoNul(value.approvedBy, 128)) &&
    (value.approvedAt === null || isContextDate(value.approvedAt)) &&
    isContextDate(value.createdAt) &&
    isContextDate(value.updatedAt)
  );
}

function isVerifierRunRecord(value: unknown): value is VerifierRunRecord {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isRequestId(value.runId) &&
    isRequestId(value.requestId) &&
    isRequestId(value.definitionId) &&
    isProjectId(value.definitionDigest) &&
    (value.executionId === null || isRequestId(value.executionId)) &&
    oneOf(verifierPrivilegeProfiles, value.privilegeProfile) &&
    oneOf(["passed", "failed", "timeout", "blocked"], value.state) &&
    (value.exitCode === null ||
      (typeof value.exitCode === "number" &&
        Number.isSafeInteger(value.exitCode))) &&
    typeof value.timedOut === "boolean" &&
    typeof value.stdoutExcerpt === "string" &&
    typeof value.stderrExcerpt === "string" &&
    isCount(value.durationMs) &&
    isContextDate(value.ranAt)
  );
}

export function parsePlannerRequest(
  raw: Record<string, unknown>,
): PlannerRequests | undefined {
  const op = raw.operation;
  if (typeof op !== "string" || !op.startsWith("planner.")) return;
  const scopeCandidate: unknown = {
    projectId: raw.projectId,
    bindingId: raw.bindingId,
    worktreeId: raw.worktreeId,
  };
  if (!isIdentityScope(scopeCandidate)) return;
  const scope: IdentityScope = scopeCandidate;

  switch (op) {
    case "planner.explore": {
      if (raw.watchedPaths !== undefined) {
        if (
          !Array.isArray(raw.watchedPaths) ||
          raw.watchedPaths.length > plannerMaxProposedEdits ||
          !raw.watchedPaths.every(isContextPath)
        ) {
          return;
        }
        return {
          operation: "planner.explore",
          ...scope,
          watchedPaths: [...new Set(raw.watchedPaths)],
        };
      }
      return { operation: "planner.explore", ...scope };
    }
    case "planner.planCreate": {
      if (
        !isRequestId(raw.requestId) ||
        !boundedBytes(raw.title, plannerMaxTitleBytes) ||
        !/^[^\r\n]+$/.test(raw.title) ||
        !boundedBytes(raw.objective, plannerMaxObjectiveBytes) ||
        !oneOf(plannerOperationKinds, raw.operationKind) ||
        !oneOf(plannerBackendModes, raw.backendMode) ||
        !Array.isArray(raw.targetPaths) ||
        raw.targetPaths.length > plannerMaxProposedEdits ||
        !raw.targetPaths.every(isContextPath)
      ) {
        return;
      }
      if (
        raw.targetBranch !== undefined &&
        raw.targetBranch !== null &&
        !isBranchName(raw.targetBranch)
      ) {
        return;
      }
      if (
        raw.sessionGrantId !== undefined &&
        !isRequestId(raw.sessionGrantId)
      ) {
        return;
      }
      let proposedEdits: PlannerProposedEdit[] | undefined;
      if (raw.proposedEdits !== undefined) {
        if (
          !Array.isArray(raw.proposedEdits) ||
          raw.proposedEdits.length > plannerMaxProposedEdits
        ) {
          return;
        }
        const parsedEdits = raw.proposedEdits.map(readProposedEdit);
        if (
          !parsedEdits.every((e): e is PlannerProposedEdit => e !== undefined)
        ) {
          return;
        }
        const uniqueEditPaths = new Set(parsedEdits.map((e) => e.path));
        if (uniqueEditPaths.size !== parsedEdits.length) return;
        proposedEdits = parsedEdits;
      }
      const out: Extract<PlannerRequests, { operation: "planner.planCreate" }> =
        {
          operation: "planner.planCreate",
          ...scope,
          requestId: raw.requestId,
          title: raw.title.trim(),
          objective: raw.objective.trim(),
          operationKind: raw.operationKind,
          backendMode: raw.backendMode,
          targetPaths: [...new Set(raw.targetPaths)],
        };
      if (raw.targetBranch !== undefined) out.targetBranch = raw.targetBranch;
      if (proposedEdits !== undefined) out.proposedEdits = proposedEdits;
      if (raw.sessionGrantId !== undefined)
        out.sessionGrantId = raw.sessionGrantId;
      return out;
    }
    case "planner.planList":
      return { operation: "planner.planList", ...scope };
    case "planner.planPreflight":
      if (!isRequestId(raw.planId)) return;
      return {
        operation: "planner.planPreflight",
        ...scope,
        planId: raw.planId,
      };
    case "planner.grantIssue": {
      if (
        !isRequestId(raw.planId) ||
        !isProjectId(raw.expectedBaseDigest) ||
        !oneOf(plannerBackendModes, raw.backendMode) ||
        !Array.isArray(raw.allowedEffects) ||
        raw.allowedEffects.length === 0 ||
        !raw.allowedEffects.every((item) => oneOf(operationEffects, item)) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      if (
        raw.ttlMs !== undefined &&
        (!isCount(raw.ttlMs) ||
          raw.ttlMs < plannerGrantMinTtlMs ||
          raw.ttlMs > plannerGrantMaxTtlMs)
      ) {
        return;
      }
      if (
        raw.unconfinedConfirmed !== undefined &&
        typeof raw.unconfinedConfirmed !== "boolean"
      ) {
        return;
      }
      const out: Extract<PlannerRequests, { operation: "planner.grantIssue" }> =
        {
          operation: "planner.grantIssue",
          ...scope,
          planId: raw.planId,
          expectedBaseDigest: raw.expectedBaseDigest,
          backendMode: raw.backendMode,
          allowedEffects: [...new Set(raw.allowedEffects)],
          humanConfirmed: raw.humanConfirmed,
        };
      if (raw.ttlMs !== undefined) out.ttlMs = raw.ttlMs;
      if (raw.unconfinedConfirmed !== undefined)
        out.unconfinedConfirmed = raw.unconfinedConfirmed;
      return out;
    }
    case "planner.grantList": {
      if (raw.planId !== undefined && !isRequestId(raw.planId)) return;
      const out: Extract<PlannerRequests, { operation: "planner.grantList" }> =
        { operation: "planner.grantList", ...scope };
      if (raw.planId !== undefined) out.planId = raw.planId;
      return out;
    }
    case "planner.grantRevoke":
      if (!isRequestId(raw.grantId) || !nonEmptyNoNul(raw.reason, 512)) return;
      return {
        operation: "planner.grantRevoke",
        ...scope,
        grantId: raw.grantId,
        reason: raw.reason.trim(),
      };
    case "planner.boundaryStatus":
      return { operation: "planner.boundaryStatus", ...scope };
    case "planner.executionStart": {
      if (
        !isRequestId(raw.requestId) ||
        !isRequestId(raw.planId) ||
        !isRequestId(raw.grantId) ||
        !isProjectId(raw.expectedBaseDigest)
      ) {
        return;
      }
      if (
        raw.mockBehavior !== undefined &&
        !oneOf(plannerMockBehaviors, raw.mockBehavior)
      ) {
        return;
      }
      let commandArgv: string[] | undefined;
      if (raw.commandArgv !== undefined) {
        commandArgv = readArgvList(raw.commandArgv);
        if (!commandArgv) return;
      }
      if (
        raw.sessionGrantId !== undefined &&
        !isRequestId(raw.sessionGrantId)
      ) {
        return;
      }
      const out: Extract<
        PlannerRequests,
        { operation: "planner.executionStart" }
      > = {
        operation: "planner.executionStart",
        ...scope,
        requestId: raw.requestId,
        planId: raw.planId,
        grantId: raw.grantId,
        expectedBaseDigest: raw.expectedBaseDigest,
      };
      if (raw.mockBehavior !== undefined) out.mockBehavior = raw.mockBehavior;
      if (commandArgv !== undefined) out.commandArgv = commandArgv;
      if (raw.sessionGrantId !== undefined)
        out.sessionGrantId = raw.sessionGrantId;
      return out;
    }
    case "planner.executionList": {
      if (raw.planId !== undefined && !isRequestId(raw.planId)) return;
      const out: Extract<
        PlannerRequests,
        { operation: "planner.executionList" }
      > = { operation: "planner.executionList", ...scope };
      if (raw.planId !== undefined) out.planId = raw.planId;
      return out;
    }
    case "planner.executionEvents":
      if (
        !isRequestId(raw.executionId) ||
        !isCount(raw.afterSeq) ||
        raw.afterSeq > plannerMaxEvents
      ) {
        return;
      }
      return {
        operation: "planner.executionEvents",
        ...scope,
        executionId: raw.executionId,
        afterSeq: raw.afterSeq,
      };
    case "planner.executionCancel":
      if (
        !isRequestId(raw.executionId) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      return {
        operation: "planner.executionCancel",
        ...scope,
        executionId: raw.executionId,
        humanConfirmed: raw.humanConfirmed,
      };
    case "planner.worktreeCleanup":
      if (
        !isRequestId(raw.executionId) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      return {
        operation: "planner.worktreeCleanup",
        ...scope,
        executionId: raw.executionId,
        humanConfirmed: raw.humanConfirmed,
      };
    case "planner.diffGet":
      if (!isRequestId(raw.executionId)) return;
      return {
        operation: "planner.diffGet",
        ...scope,
        executionId: raw.executionId,
      };
    case "planner.diffReview":
      if (
        !isRequestId(raw.requestId) ||
        !isRequestId(raw.executionId) ||
        !isProjectId(raw.expectedDiffDigest) ||
        !isCount(raw.expectedRevision) ||
        (raw.choice !== "approved" && raw.choice !== "rejected") ||
        !nonEmptyNoNul(raw.reviewer, 128) ||
        !nonEmptyNoNul(raw.note, 512) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      return {
        operation: "planner.diffReview",
        ...scope,
        requestId: raw.requestId,
        executionId: raw.executionId,
        expectedDiffDigest: raw.expectedDiffDigest,
        expectedRevision: raw.expectedRevision,
        choice: raw.choice,
        reviewer: raw.reviewer.trim(),
        note: raw.note.trim(),
        humanConfirmed: raw.humanConfirmed,
      };
    case "planner.applyLocal":
      if (
        !isRequestId(raw.requestId) ||
        !isRequestId(raw.executionId) ||
        !isRequestId(raw.grantId) ||
        !isProjectId(raw.expectedDiffDigest) ||
        typeof raw.applyConfirmed !== "boolean"
      ) {
        return;
      }
      return {
        operation: "planner.applyLocal",
        ...scope,
        requestId: raw.requestId,
        executionId: raw.executionId,
        grantId: raw.grantId,
        expectedDiffDigest: raw.expectedDiffDigest,
        applyConfirmed: raw.applyConfirmed,
      };
    case "planner.verifierDefine": {
      const argv = readArgvList(raw.argv);
      if (
        !isRequestId(raw.definitionId) ||
        !nonEmptyNoNul(raw.label, 256) ||
        !argv ||
        (raw.cwdRelative !== "" &&
          raw.cwdRelative !== "." &&
          !isContextPath(raw.cwdRelative)) ||
        !Array.isArray(raw.envWhitelist) ||
        raw.envWhitelist.length > verifierMaxEnvVars ||
        !raw.envWhitelist.every(isEnvKey) ||
        !isCount(raw.timeoutMs) ||
        raw.timeoutMs < verifierMinTimeoutMs ||
        raw.timeoutMs > verifierMaxTimeoutMs ||
        !oneOf(verifierPrivilegeProfiles, raw.privilegeProfile)
      ) {
        return;
      }
      return {
        operation: "planner.verifierDefine",
        ...scope,
        definitionId: raw.definitionId,
        label: raw.label.trim(),
        argv,
        cwdRelative: raw.cwdRelative,
        envWhitelist: [...new Set(raw.envWhitelist as string[])].sort(),
        timeoutMs: raw.timeoutMs,
        privilegeProfile: raw.privilegeProfile,
      };
    }
    case "planner.verifierList":
      return { operation: "planner.verifierList", ...scope };
    case "planner.verifierApprove":
      if (
        !isRequestId(raw.definitionId) ||
        !isProjectId(raw.expectedDefinitionDigest) ||
        !nonEmptyNoNul(raw.reviewer, 128) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      return {
        operation: "planner.verifierApprove",
        ...scope,
        definitionId: raw.definitionId,
        expectedDefinitionDigest: raw.expectedDefinitionDigest,
        reviewer: raw.reviewer.trim(),
        humanConfirmed: raw.humanConfirmed,
      };
    case "planner.verifierRun": {
      if (
        !isRequestId(raw.requestId) ||
        !isRequestId(raw.definitionId) ||
        !isProjectId(raw.expectedDefinitionDigest)
      ) {
        return;
      }
      if (raw.executionId !== undefined && !isRequestId(raw.executionId)) {
        return;
      }
      if (raw.grantId !== undefined && !isRequestId(raw.grantId)) {
        return;
      }
      const out: Extract<
        PlannerRequests,
        { operation: "planner.verifierRun" }
      > = {
        operation: "planner.verifierRun",
        ...scope,
        requestId: raw.requestId,
        definitionId: raw.definitionId,
        expectedDefinitionDigest: raw.expectedDefinitionDigest,
      };
      if (raw.executionId !== undefined) out.executionId = raw.executionId;
      if (raw.grantId !== undefined) out.grantId = raw.grantId;
      return out;
    }
    default:
      return;
  }
}

function sameScope(a: IdentityScope, b: IdentityScope): boolean {
  return (
    a.projectId === b.projectId &&
    a.bindingId === b.bindingId &&
    a.worktreeId === b.worktreeId
  );
}

export function isPlannerResult<K extends keyof PlannerResults>(
  operation: K,
  value: unknown,
): boolean {
  if (!isRecord(value) || !isIdentityScope(value.scope)) return false;
  const scope = value.scope;
  switch (operation) {
    case "planner.explore":
      return (
        isContextDate(value.observedAt) &&
        isPlannerGitBase(value.base) &&
        Array.isArray(value.branches) &&
        Array.isArray(value.worktrees) &&
        Array.isArray(value.dirtyPaths) &&
        value.dirtyPaths.every(isContextPath) &&
        Array.isArray(value.conflictedPaths) &&
        value.conflictedPaths.every(isContextPath) &&
        isRecord(value.changesCount) &&
        isCount(value.changesCount.staged) &&
        isCount(value.changesCount.unstaged) &&
        isCount(value.changesCount.untracked) &&
        isCount(value.changesCount.conflicted) &&
        isCount(value.dedicatedWorktreeCount)
      );
    case "planner.planCreate":
      return isGitPlanRecord(value);
    case "planner.planList":
      return (
        Array.isArray(value.items) &&
        value.items.every(
          (item) => isGitPlanRecord(item) && sameScope(item.scope, scope),
        )
      );
    case "planner.planPreflight":
      return (
        isRequestId(value.planId) &&
        isContextDate(value.checkedAt) &&
        oneOf(plannerPreflightStatuses, value.status) &&
        typeof value.driftDetected === "boolean" &&
        Array.isArray(value.driftReasons) &&
        value.driftReasons.every((r) => oneOf(plannerDriftReasons, r)) &&
        isPlannerGitBase(value.expectedBase) &&
        isPlannerGitBase(value.observedBase) &&
        isProjectId(value.expectedBaseDigest) &&
        isProjectId(value.observedBaseDigest) &&
        Array.isArray(value.preconditions) &&
        Array.isArray(value.conflicts) &&
        typeof value.executionAllowed === "boolean"
      );
    case "planner.grantIssue":
    case "planner.grantRevoke":
      return isOperationGrantRecord(value);
    case "planner.grantList":
      return (
        Array.isArray(value.items) &&
        value.items.every(
          (item) =>
            isOperationGrantRecord(item) && sameScope(item.scope, scope),
        )
      );
    case "planner.boundaryStatus":
      return (
        isContextDate(value.checkedAt) &&
        typeof value.lpacVerified === "boolean" &&
        nonEmptyNoNul(value.lpacDetail, 512) &&
        typeof value.strictBackendAllowed === "boolean" &&
        typeof value.supervisionHelperAvailable === "boolean" &&
        Array.isArray(value.backends) &&
        value.backends.every(
          (b) =>
            isRecord(b) &&
            oneOf(plannerBackendModes, b.mode) &&
            typeof b.available === "boolean" &&
            typeof b.verified === "boolean" &&
            (b.blockedReason === null || nonEmptyNoNul(b.blockedReason, 512)),
        )
      );
    case "planner.executionStart":
    case "planner.executionCancel":
      return isSupervisedExecutionRecord(value);
    case "planner.executionList":
      return (
        Array.isArray(value.items) &&
        value.items.every(
          (item) =>
            isSupervisedExecutionRecord(item) && sameScope(item.scope, scope),
        )
      );
    case "planner.executionEvents":
      return (
        isSupervisedExecutionRecord(value.execution) &&
        sameScope(value.execution.scope, scope) &&
        Array.isArray(value.events) &&
        value.events.length <= plannerEventsPageSize &&
        value.events.every(
          (ev, idx) =>
            isRecord(ev) &&
            isCount(ev.seq) &&
            ev.seq > 0 &&
            isSlug(ev.type) &&
            isContextDate(ev.at) &&
            nonEmptyNoNul(ev.summary, 1024) &&
            ev.seq ===
              (value.nextSeq as number) -
                (value.events as unknown[]).length +
                idx +
                1,
        ) &&
        isCount(value.nextSeq) &&
        typeof value.more === "boolean"
      );
    case "planner.worktreeCleanup":
      return (
        isRequestId(value.executionId) &&
        isRequestId(value.dedicatedWorktreeId) &&
        nonEmptyNoNul(value.dedicatedRoot, 4096) &&
        value.status === "cleaned" &&
        isContextDate(value.cleanedAt) &&
        value.historyPreserved === true
      );
    case "planner.diffGet":
      return (
        isRequestId(value.executionId) &&
        isRequestId(value.planId) &&
        isProjectId(value.diffDigest) &&
        (value.baseHead === null || isGitObjectId(value.baseHead)) &&
        isContextDate(value.capturedAt) &&
        Array.isArray(value.files) &&
        value.files.every(isExecutionDiffFile) &&
        (value.latestReview === null ||
          isExecutionDiffReview(value.latestReview)) &&
        (value.latestApply === null ||
          (isLocalApplyRecord(value.latestApply) &&
            sameScope(value.latestApply.scope, scope)))
      );
    case "planner.diffReview":
      return (
        isRequestId(value.executionId) &&
        isExecutionDiffReview(value.review) &&
        value.appliedToLocal === false
      );
    case "planner.applyLocal":
      return isLocalApplyRecord(value);
    case "planner.verifierDefine":
    case "planner.verifierApprove":
      return isVerifierDefinitionRecord(value);
    case "planner.verifierList":
      return (
        Array.isArray(value.items) &&
        value.items.every(
          (item) =>
            isVerifierDefinitionRecord(item) && sameScope(item.scope, scope),
        ) &&
        Array.isArray(value.runs) &&
        value.runs.every(
          (run) => isVerifierRunRecord(run) && sameScope(run.scope, scope),
        )
      );
    case "planner.verifierRun":
      return isVerifierRunRecord(value);
    default:
      return false;
  }
}
