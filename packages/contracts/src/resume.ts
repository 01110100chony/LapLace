import {
  isGitObservation,
  isProjectId,
  isRecord,
  isRequestId,
  type GitObservation,
} from "./index.ts";
import {
  isContextDate,
  isContextPath,
  omissionReasons,
  type OmissionReason,
} from "./context.ts";

export type IdentityScope = {
  projectId: string;
  bindingId: string;
  worktreeId: string;
};

export type BindingVerificationState =
  "verified" | "unverified_legacy" | "ambiguous" | "divergent" | "unavailable";

export type WorktreeRecord = {
  worktreeId: string;
  bindingId: string;
  projectId: string;
  legacyProjectId: string;
  name: string;
  root: string;
  isMain: boolean;
  verification: BindingVerificationState;
};

export type IdentityCandidateReason =
  | "verified_match"
  | "unverified_legacy"
  | "shared_common_git"
  | "identity_mismatch";

export type IdentityCandidate = {
  scope: IdentityScope;
  legacyProjectId: string;
  root: string;
  isMain: boolean;
  verification: BindingVerificationState;
  reason: IdentityCandidateReason;
};

export type ProjectIdentityResult = {
  scope: IdentityScope;
  legacyProjectId: string;
  root: string;
  verification: BindingVerificationState;
  requiresConfirmation: boolean;
  worktrees: WorktreeRecord[];
  candidates: IdentityCandidate[];
};

export type ResumeObservationGap =
  | "folder_unavailable"
  | "git_timeout"
  | "git_missing"
  | "identity_mismatch"
  | "identity_unknown"
  | "not_repository"
  | "git_failed";

export type ResumeObservation =
  | {
      state: "fresh";
      observation: GitObservation;
      attemptedAt: string;
      gap: null;
    }
  | {
      state: "cached";
      observation: GitObservation;
      attemptedAt: string;
      gap: ResumeObservationGap;
    }
  | {
      state: "unavailable";
      observation: null;
      attemptedAt: string;
      gap: ResumeObservationGap;
    };

export type EvidenceCoverage = "full" | "partial" | "none";
export type EvidenceDurability = "durable_blob" | "missing_blob" | "none";
export type EvidenceGapReason =
  | "no_source_attached"
  | "source_unavailable"
  | "source_digest_mismatch"
  | "source_omitted"
  | "source_cross_scope";

export type ResumeEvidenceRef = {
  projectId: string;
  contextId: string;
  path: string;
  sha256: string;
  chunk: number;
  omittedReasons?: OmissionReason[];
};

export type ResumeEvidence =
  | {
      state: "verified";
      coverage: "full" | "partial";
      durability: "durable_blob";
      sourceOrigin: "context_capture" | "context_search";
      capturedAt: string;
      excerptDigest: string;
      ref: ResumeEvidenceRef;
      gap: null;
    }
  | {
      state: "gap";
      coverage: "none" | "partial";
      durability: "missing_blob" | "none";
      sourceOrigin: "context_capture" | "context_search" | "none";
      capturedAt: string | null;
      excerptDigest: string | null;
      ref: ResumeEvidenceRef | null;
      gap: EvidenceGapReason;
    };

export type DecisionStatus = "active" | "superseded" | "purged";
export type DecisionVisibility = "local_only" | "canonical_verified";

export type ResumeDecision = {
  assertionId: string;
  revisionId: string;
  revision: number;
  projectId: string;
  content: string;
  author: string;
  authority: "human_local" | "human_promoted";
  visibility: DecisionVisibility;
  status: DecisionStatus;
  effectiveAt: string;
  recordedAt: string;
  sourceOrigin: "human_decision";
  evidence: ResumeEvidence;
};

export type ResumeConflict = {
  kind:
    | "identity_divergent"
    | "identity_ambiguous"
    | "legacy_unverified"
    | "evidence_gap"
    | "working_conflict"
    | "git_unavailable";
  blocking: boolean;
  summary: string;
  detectedAt: string;
};

export type ResumeMemory =
  | {
      state: "available";
      decision: ResumeDecision;
      conflicts: ResumeConflict[];
    }
  | {
      state: "empty";
      decision: null;
      conflicts: ResumeConflict[];
    };

export type ResumeActivity = {
  lastCapture: {
    contextId: string;
    projectId: string;
    head: string | null;
    completedAt: string;
    status: "complete" | "partial" | "invalidated";
    included: number;
    omitted: number;
  } | null;
  lastExecution: {
    taskId: string;
    executionId: string;
    projectId: string;
    mode: "mock_development";
    state: string;
    recordedAt: string;
    reviewChoice: "approved" | "rejected" | null;
    isLegacyAttemptNote: true;
  } | null;
};

export type ResumeNextAction = {
  advisory: true;
  kind:
    | "resolve_conflict"
    | "confirm_identity"
    | "relocate_project"
    | "record_decision"
    | "review_evidence_gap"
    | "continue_from_decision"
    | "inspect_changes";
  label: string;
  rationale: string;
  blockedByConflict: boolean;
};

export type ResumeSummary = {
  scope: IdentityScope;
  projectName: string;
  root: string;
  verification: BindingVerificationState;
  computedAt: string;
  correlationId?: string;
  observation: ResumeObservation;
  memory: ResumeMemory;
  activity: ResumeActivity;
  nextAction: ResumeNextAction;
};

export type ResumeRequests =
  | {
      operation: "project.identity";
      projectId: string;
      path?: string;
    }
  | ({
      operation: "project.resume";
      correlationId?: string;
    } & IdentityScope);

export type ResumeResults = {
  "project.identity": ProjectIdentityResult;
  "project.resume": ResumeSummary;
};

const verificationStates: readonly BindingVerificationState[] = [
  "verified",
  "unverified_legacy",
  "ambiguous",
  "divergent",
  "unavailable",
];

const candidateReasons: readonly IdentityCandidateReason[] = [
  "verified_match",
  "unverified_legacy",
  "shared_common_git",
  "identity_mismatch",
];

const observationGaps: readonly ResumeObservationGap[] = [
  "folder_unavailable",
  "git_timeout",
  "git_missing",
  "identity_mismatch",
  "identity_unknown",
  "not_repository",
  "git_failed",
];

const evidenceGaps: readonly EvidenceGapReason[] = [
  "no_source_attached",
  "source_unavailable",
  "source_digest_mismatch",
  "source_omitted",
  "source_cross_scope",
];

const conflictKinds: readonly ResumeConflict["kind"][] = [
  "identity_divergent",
  "identity_ambiguous",
  "legacy_unverified",
  "evidence_gap",
  "working_conflict",
  "git_unavailable",
];

const nextActionKinds: readonly ResumeNextAction["kind"][] = [
  "resolve_conflict",
  "confirm_identity",
  "relocate_project",
  "record_decision",
  "review_evidence_gap",
  "continue_from_decision",
  "inspect_changes",
];

function boundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !value.includes("\0")
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOidOrNull(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))
  );
}

function isVerificationState(
  value: unknown,
): value is BindingVerificationState {
  return verificationStates.some((item) => item === value);
}

export function isIdentityScope(value: unknown): value is IdentityScope {
  return (
    isRecord(value) &&
    isProjectId(value.projectId) &&
    isProjectId(value.bindingId) &&
    isProjectId(value.worktreeId)
  );
}

function isWorktreeRecord(
  value: unknown,
  expectedProjectId: string,
): value is WorktreeRecord {
  return (
    isRecord(value) &&
    isProjectId(value.worktreeId) &&
    isProjectId(value.bindingId) &&
    value.projectId === expectedProjectId &&
    isProjectId(value.legacyProjectId) &&
    boundedText(value.name, 256) &&
    boundedText(value.root, 32_767) &&
    typeof value.isMain === "boolean" &&
    isVerificationState(value.verification)
  );
}

function isIdentityCandidate(value: unknown): value is IdentityCandidate {
  return (
    isRecord(value) &&
    isIdentityScope(value.scope) &&
    isProjectId(value.legacyProjectId) &&
    boundedText(value.root, 32_767) &&
    typeof value.isMain === "boolean" &&
    isVerificationState(value.verification) &&
    candidateReasons.some((item) => item === value.reason)
  );
}

function isEvidenceRef(
  value: unknown,
  expectedProjectId: string,
): value is ResumeEvidenceRef {
  return (
    isRecord(value) &&
    value.projectId === expectedProjectId &&
    isProjectId(value.contextId) &&
    isContextPath(value.path) &&
    isProjectId(value.sha256) &&
    isCount(value.chunk) &&
    (value.omittedReasons === undefined ||
      (Array.isArray(value.omittedReasons) &&
        value.omittedReasons.every((item: unknown) =>
          omissionReasons.some((reason) => reason === item),
        )))
  );
}

export function isResumeEvidence(
  value: unknown,
  expectedProjectId: string,
): value is ResumeEvidence {
  if (!isRecord(value)) return false;
  if (value.state === "verified") {
    return (
      (value.coverage === "full" || value.coverage === "partial") &&
      value.durability === "durable_blob" &&
      (value.sourceOrigin === "context_capture" ||
        value.sourceOrigin === "context_search") &&
      isContextDate(value.capturedAt) &&
      isProjectId(value.excerptDigest) &&
      isEvidenceRef(value.ref, expectedProjectId) &&
      value.gap === null
    );
  }
  if (value.state === "gap") {
    if (
      !evidenceGaps.some((item) => item === value.gap) ||
      (value.coverage !== "none" && value.coverage !== "partial") ||
      (value.durability !== "missing_blob" && value.durability !== "none") ||
      (value.sourceOrigin !== "context_capture" &&
        value.sourceOrigin !== "context_search" &&
        value.sourceOrigin !== "none")
    ) {
      return false;
    }
    if (value.sourceOrigin === "none" && value.coverage !== "none") {
      return false;
    }
    return (
      (value.capturedAt === null || isContextDate(value.capturedAt)) &&
      (value.excerptDigest === null || isProjectId(value.excerptDigest)) &&
      (value.ref === null || isEvidenceRef(value.ref, expectedProjectId))
    );
  }
  return false;
}

function isResumeObservation(value: unknown): value is ResumeObservation {
  if (!isRecord(value)) return false;
  const attemptedAt = value.attemptedAt;
  if (typeof attemptedAt !== "string" || !isContextDate(attemptedAt))
    return false;
  if (value.state === "fresh") {
    return isGitObservation(value.observation) && value.gap === null;
  }
  if (value.state === "cached") {
    if (
      !isGitObservation(value.observation) ||
      !observationGaps.some((item) => item === value.gap)
    ) {
      return false;
    }
    return Date.parse(value.observation.observedAt) <= Date.parse(attemptedAt);
  }
  if (value.state === "unavailable") {
    return (
      value.observation === null &&
      observationGaps.some((item) => item === value.gap)
    );
  }
  return false;
}

export function isResumeDecision(
  value: unknown,
  expectedProjectId: string,
): value is ResumeDecision {
  return (
    isRecord(value) &&
    isProjectId(value.assertionId) &&
    isProjectId(value.revisionId) &&
    isCount(value.revision) &&
    value.revision > 0 &&
    value.projectId === expectedProjectId &&
    boundedText(value.content, 8_192) &&
    boundedText(value.author, 128) &&
    (value.authority === "human_local" ||
      value.authority === "human_promoted") &&
    (value.visibility === "local_only" ||
      value.visibility === "canonical_verified") &&
    (value.status === "active" ||
      value.status === "superseded" ||
      value.status === "purged") &&
    isContextDate(value.effectiveAt) &&
    isContextDate(value.recordedAt) &&
    value.sourceOrigin === "human_decision" &&
    isResumeEvidence(value.evidence, expectedProjectId)
  );
}

function isResumeConflict(value: unknown): value is ResumeConflict {
  return (
    isRecord(value) &&
    conflictKinds.some((item) => item === value.kind) &&
    typeof value.blocking === "boolean" &&
    boundedText(value.summary, 512) &&
    isContextDate(value.detectedAt)
  );
}

function isResumeMemory(
  value: unknown,
  expectedProjectId: string,
): value is ResumeMemory {
  if (
    !isRecord(value) ||
    !Array.isArray(value.conflicts) ||
    !value.conflicts.every(isResumeConflict)
  ) {
    return false;
  }
  if (value.state === "empty") return value.decision === null;
  if (value.state === "available") {
    return isResumeDecision(value.decision, expectedProjectId);
  }
  return false;
}

function isResumeActivity(
  value: unknown,
  expectedProjectId: string,
): value is ResumeActivity {
  if (!isRecord(value)) return false;
  const captureOk =
    value.lastCapture === null ||
    (isRecord(value.lastCapture) &&
      isProjectId(value.lastCapture.contextId) &&
      value.lastCapture.projectId === expectedProjectId &&
      isOidOrNull(value.lastCapture.head) &&
      isContextDate(value.lastCapture.completedAt) &&
      (value.lastCapture.status === "complete" ||
        value.lastCapture.status === "partial" ||
        value.lastCapture.status === "invalidated") &&
      isCount(value.lastCapture.included) &&
      isCount(value.lastCapture.omitted));
  const executionOk =
    value.lastExecution === null ||
    (isRecord(value.lastExecution) &&
      isRequestId(value.lastExecution.taskId) &&
      isRequestId(value.lastExecution.executionId) &&
      value.lastExecution.projectId === expectedProjectId &&
      value.lastExecution.mode === "mock_development" &&
      boundedText(value.lastExecution.state, 64) &&
      isContextDate(value.lastExecution.recordedAt) &&
      (value.lastExecution.reviewChoice === null ||
        value.lastExecution.reviewChoice === "approved" ||
        value.lastExecution.reviewChoice === "rejected") &&
      value.lastExecution.isLegacyAttemptNote === true);
  return captureOk && executionOk;
}

function isResumeNextAction(value: unknown): value is ResumeNextAction {
  return (
    isRecord(value) &&
    value.advisory === true &&
    nextActionKinds.some((item) => item === value.kind) &&
    boundedText(value.label, 256) &&
    boundedText(value.rationale, 512) &&
    typeof value.blockedByConflict === "boolean"
  );
}

export function parseResumeRequest(
  value: Record<string, unknown>,
): ResumeRequests | undefined {
  if (value.operation === "project.identity") {
    if (!isProjectId(value.projectId)) return;
    if (value.path === undefined) {
      return { operation: "project.identity", projectId: value.projectId };
    }
    if (boundedText(value.path, 32_767)) {
      return {
        operation: "project.identity",
        projectId: value.projectId,
        path: value.path,
      };
    }
    return;
  }
  if (value.operation === "project.resume") {
    const correlationId = value.correlationId;
    if (!isIdentityScope(value)) return;
    if (correlationId !== undefined && !isRequestId(correlationId)) return;
    const base: ResumeRequests = {
      operation: "project.resume",
      projectId: value.projectId,
      bindingId: value.bindingId,
      worktreeId: value.worktreeId,
    };
    return correlationId === undefined ? base : { ...base, correlationId };
  }
}

export function isResumeResult(
  operation: keyof ResumeResults,
  value: unknown,
): boolean {
  if (!isRecord(value)) return false;
  if (operation === "project.identity") {
    const scope = value.scope;
    return (
      isIdentityScope(scope) &&
      isProjectId(value.legacyProjectId) &&
      boundedText(value.root, 32_767) &&
      isVerificationState(value.verification) &&
      typeof value.requiresConfirmation === "boolean" &&
      Array.isArray(value.worktrees) &&
      value.worktrees.every((item) =>
        isWorktreeRecord(item, scope.projectId),
      ) &&
      Array.isArray(value.candidates) &&
      value.candidates.every(isIdentityCandidate)
    );
  }
  if (operation === "project.resume") {
    const scope = value.scope;
    if (
      !isIdentityScope(scope) ||
      !boundedText(value.projectName, 256) ||
      !boundedText(value.root, 32_767) ||
      !isVerificationState(value.verification) ||
      !isContextDate(value.computedAt) ||
      (value.correlationId !== undefined && !isRequestId(value.correlationId))
    ) {
      return false;
    }
    return (
      isResumeObservation(value.observation) &&
      isResumeMemory(value.memory, scope.projectId) &&
      isResumeActivity(value.activity, scope.projectId) &&
      isResumeNextAction(value.nextAction)
    );
  }
  return false;
}
