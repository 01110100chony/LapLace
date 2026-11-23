import { isProjectId, isRecord, isRequestId, type ErrorCode } from "./index.ts";
import { isContextDate, isContextPath } from "./context.ts";
import {
  compilerVisibility,
  type CompilerVisibility,
} from "./context-compiler.ts";
import { isIdentityScope, type IdentityScope } from "./resume.ts";

export const memorySchemaVersion = 1;
export const defaultCasQuotaBytes = 64 * 1024 * 1024;
export const minCasQuotaBytes = 64;
export const maxCasQuotaBytes = 1024 * 1024 * 1024;
export const maxClaimContentBytes = 16 * 1024;
export const maxOverlayItems = 256;
export const maxExportItems = 64;
export const defaultInboxTtlMs = 7 * 24 * 60 * 60_000;
export const minInboxTtlMs = 500;
export const maxInboxTtlMs = 90 * 24 * 60 * 60_000;

export const memoryErrorCodes = [
  "memory_invalid_input",
  "memory_not_found",
  "memory_conflict",
  "pin_quota_exceeded",
  "pin_protected",
  "purge_in_progress",
  "export_denied",
  "export_exception_invalid",
  "overlay_race_detected",
  "overlay_blob_missing",
  "overlay_unsafe_target",
] as const satisfies readonly ErrorCode[];

export const memoryAuthorities = ["human_local", "human_promoted"] as const;
export type MemoryAuthority = (typeof memoryAuthorities)[number];

export const relationKinds = [
  "supports",
  "supersedes",
  "contradicts",
  "derived_from",
  "references_evidence",
] as const;
export type RelationKind = (typeof relationKinds)[number];

export const timelineSignalKinds = [
  "confirmed_link",
  "objective_drift",
  "inference",
  "verifier_signal",
] as const;
export type TimelineSignalKind = (typeof timelineSignalKinds)[number];

export const conflictPolarities = ["require", "forbid"] as const;
export type ConflictPolarity = (typeof conflictPolarities)[number];

export type MemoryVisibility = CompilerVisibility;

export type EvidenceAttachmentRef =
  | { kind: "pin"; pinId: string }
  | {
      kind: "context_excerpt";
      contextId: string;
      path: string;
      sha256: string;
      chunk: number;
    };

export type ClaimRevision = {
  revisionId: string;
  claimId: string;
  segmentSeq: number;
  txSeq: number;
  content: string;
  author: string;
  reason: string;
  authority: MemoryAuthority;
  visibility: MemoryVisibility;
  conflictKey: string | null;
  conflictPolarity: ConflictPolarity | null;
  validFrom: string;
  validTo: string | null;
  knownFrom: string;
  knownTo: string | null;
  supersedesRevisionId: string | null;
  evidenceRef: EvidenceAttachmentRef | null;
  recordedAt: string;
};

export type ClaimDetailResult = {
  scope: IdentityScope;
  claimId: string;
  title: string;
  activeCount: number;
  revisions: ClaimRevision[];
};

export type RelationRecord = {
  relationId: string;
  scope: IdentityScope;
  fromId: string;
  toId: string;
  kind: RelationKind;
  signalKind: TimelineSignalKind;
  rationale: string;
  author: string;
  knownAt: string;
};

export type TimelineEvidenceResolution = {
  state: "verified" | "gap" | "none";
  source: "cas_pin" | "context_store" | "none";
  digest: string | null;
  gapReason: string | null;
  textPreview: string | null;
};

export type TimelineClaimEntry = {
  claimId: string;
  title: string;
  revision: ClaimRevision;
  resolvedEvidence: TimelineEvidenceResolution;
};

export type TimelineConflictEntry = {
  conflictKey: string;
  kind: "bitemporal_contradiction" | "drift_alert";
  summary: string;
  revisionIds: string[];
  validOverlapFrom: string;
  validOverlapTo: string | null;
};

export type TimelineSignalEntry = {
  signalId: string;
  signalKind: TimelineSignalKind;
  subjectId: string;
  targetId: string | null;
  summary: string;
  recordedAt: string;
  derivedFromConfirmed: boolean;
};

export type TimelineResult = {
  scope: IdentityScope;
  knownAt: string;
  validAt: string | null;
  claims: TimelineClaimEntry[];
  edges: RelationRecord[];
  signals: TimelineSignalEntry[];
  conflicts: TimelineConflictEntry[];
};

export type ClaimRecordInput = IdentityScope & {
  requestId: string;
  title: string;
  content: string;
  author: string;
  reason: string;
  promoteCanonical?: boolean;
  visibility?: MemoryVisibility;
  conflictKey?: string;
  conflictPolarity?: ConflictPolarity;
  validFrom: string;
  validTo?: string | null;
  knownAt?: string;
  evidenceRef?: EvidenceAttachmentRef | null;
};

export type ClaimCorrectInput = IdentityScope & {
  requestId: string;
  claimId: string;
  content: string;
  author: string;
  reason: string;
  correctFrom: string;
  correctTo?: string | null;
  knownAt?: string;
  conflictKey?: string;
  conflictPolarity?: ConflictPolarity;
  evidenceRef?: EvidenceAttachmentRef | null;
};

export type RelationRecordInput = IdentityScope & {
  fromId: string;
  toId: string;
  kind: RelationKind;
  signalKind: TimelineSignalKind;
  rationale: string;
  author: string;
  knownAt?: string;
};

export type TimelineInput = IdentityScope & {
  knownAt: string;
  validAt?: string | null;
  signalKinds?: TimelineSignalKind[];
};

export type PinSourceInput =
  | {
      kind: "context_excerpt";
      contextId: string;
      path: string;
      sha256: string;
      chunk: number;
    }
  | {
      kind: "inline";
      content: string;
    };

export type CasPinRecord = {
  pinId: string;
  scope: IdentityScope;
  label: string;
  digest: string;
  bytes: number;
  sourceKind: "context_excerpt" | "inline";
  sourceContextId: string | null;
  sourcePath: string | null;
  sourceChunk: number | null;
  protectedClaimId: string | null;
  status: "active" | "released" | "purged";
  createdAt: string;
};

export type PinListResult = {
  scope: IdentityScope;
  quotaBytes: number;
  usedBytes: number;
  items: CasPinRecord[];
};

export type PinVerifyResult = {
  scope: IdentityScope;
  state: "verified" | "corrupt" | "gap";
  source: "cas_pin" | "context_store" | "none";
  digest: string | null;
  bytes: number | null;
  textPreview: string | null;
  gapReason: string | null;
};

export type PinReleaseResult = {
  scope: IdentityScope;
  pinId: string;
  released: boolean;
  blobCollected: boolean;
};

export type GcReport = {
  scope: IdentityScope;
  quotaBytes: number;
  usedBytesBefore: number;
  usedBytesAfter: number;
  deletedDigests: string[];
  protectedDigests: string[];
  protectedCount: number;
};

export const purgeStages = [
  "access_revoked",
  "blobs_removed",
  "projections_cleared",
  "completed",
] as const;
export type PurgeStage = (typeof purgeStages)[number];

export const purgeTargetKinds = ["claim", "pin", "overlay"] as const;
export type PurgeTargetKind = (typeof purgeTargetKinds)[number];

export type PurgeJobRecord = {
  purgeId: string;
  tombstoneId: string;
  scope: IdentityScope;
  targetKind: PurgeTargetKind;
  targetId: string;
  stage: PurgeStage;
  state: "in_progress" | "completed";
  removedBlobs: number;
  preservedSharedBlobs: boolean;
  reason: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type PinCreateInput = IdentityScope & {
  label: string;
  source: PinSourceInput;
  quotaBytes?: number;
  protectedClaimId?: string;
};

export type PinVerifyInput = IdentityScope & {
  pinId?: string;
  unpinnedRef?: {
    contextId: string;
    path: string;
    sha256: string;
    chunk: number;
  };
};

export type PinReleaseInput = IdentityScope & {
  pinId: string;
  humanConfirmed: boolean;
};

export type GcRunInput = IdentityScope & {
  quotaBytes?: number;
  humanConfirmed: boolean;
};

export type PurgeStartInput = IdentityScope & {
  targetKind: PurgeTargetKind;
  targetId: string;
  reason: string;
  humanConfirmed: boolean;
  maxSteps?: number;
};

export const inboxStatuses = [
  "pending",
  "approved",
  "rejected",
  "expired",
] as const;
export type InboxStatus = (typeof inboxStatuses)[number];

export const inboxTargetKinds = ["claim", "preference"] as const;
export type InboxTargetKind = (typeof inboxTargetKinds)[number];

export type InboxProposalRecord = {
  proposalId: string;
  scope: IdentityScope;
  fingerprint: string;
  title: string;
  content: string;
  targetKind: InboxTargetKind;
  visibility: MemoryVisibility;
  status: InboxStatus;
  duplicateCount: number;
  origins: string[];
  createdAt: string;
  expiresAt: string;
  reviewedAt: string | null;
  reviewer: string | null;
  reviewNote: string | null;
  promotedClaimId: string | null;
};

export type LocalFeedbackRecord = {
  feedbackId: string;
  scope: IdentityScope;
  proposalId: string;
  decision: "approve" | "reject";
  reviewer: string;
  note: string;
  recordedAt: string;
};

export type InboxListResult = {
  scope: IdentityScope;
  items: InboxProposalRecord[];
};

export type InboxReviewResult = {
  scope: IdentityScope;
  proposal: InboxProposalRecord;
  feedback: LocalFeedbackRecord;
  createdClaim: ClaimDetailResult | null;
};

export type ExportCandidateInput = {
  itemId: string;
  title: string;
  visibility: MemoryVisibility;
  content: string;
};

export type ExportSecretFinding = {
  itemId: string;
  pattern: string;
  severity: "high" | "medium";
};

export type ExportItemClassification = {
  itemId: string;
  title: string;
  visibility: MemoryVisibility;
  contentDigest: string;
  bytes: number;
  eligible: boolean;
  denyReason: string | null;
};

export type ExportPreviewResult = {
  scope: IdentityScope;
  destinationId: string;
  policyVersion: string;
  bundleDigest: string;
  eligible: boolean;
  hardDenied: boolean;
  requiresException: boolean;
  findings: ExportSecretFinding[];
  items: ExportItemClassification[];
  reason: string;
};

export type ExportExceptionRecord = {
  exceptionId: string;
  scope: IdentityScope;
  bundleDigest: string;
  destinationId: string;
  policyVersion: string;
  reviewer: string;
  reason: string;
  grantedAt: string;
};

export type ExportAuditRecord = {
  exportId: string;
  scope: IdentityScope;
  bundleDigest: string;
  destinationId: string;
  policyVersion: string;
  exceptionId: string | null;
  exportedCount: number;
  itemDigests: string[];
  executedAt: string;
};

export type InboxSubmitInput = IdentityScope & {
  title: string;
  content: string;
  targetKind: InboxTargetKind;
  originLabel: string;
  visibility?: MemoryVisibility;
  ttlMs?: number;
};

export type InboxReviewInput = IdentityScope & {
  proposalId: string;
  decision: "approve" | "reject";
  reviewer: string;
  note: string;
  promoteCanonical?: boolean;
  humanConfirmed: boolean;
  validFrom?: string;
};

export type ExportPreviewInput = IdentityScope & {
  destinationId: string;
  policyVersion?: string;
  items: ExportCandidateInput[];
};

export type ExportExceptionGrantInput = IdentityScope & {
  bundleDigest: string;
  destinationId: string;
  policyVersion: string;
  reviewer: string;
  reason: string;
  humanConfirmed: boolean;
  hasDbOnlyItems?: boolean;
};

export type ExportExecuteInput = IdentityScope & {
  destinationId: string;
  policyVersion: string;
  items: ExportCandidateInput[];
  exceptionId?: string;
};

export const overlayFileKinds = [
  "modified",
  "added",
  "deleted",
  "conflicted",
  "symlink",
  "gitlink",
] as const;
export type OverlayFileKind = (typeof overlayFileKinds)[number];

export type OverlayStageEntry = {
  stage: 0 | 1 | 2 | 3;
  mode: string;
  oid: string;
  sha256: string | null;
  size: number | null;
  crlf: boolean;
  gap: string | null;
};

export type OverlayFileEntry = {
  path: string;
  fromPath: string | null;
  kind: OverlayFileKind;
  status: string;
  worktreeSha256: string | null;
  worktreeSize: number | null;
  crlf: boolean;
  symlinkTarget: string | null;
  gitlinkOid: string | null;
  stages: OverlayStageEntry[];
  gap: string | null;
};

export type DirtyOverlayManifest = {
  schemaVersion: typeof memorySchemaVersion;
  overlayId: string;
  scope: IdentityScope;
  label: string;
  head: string | null;
  branch: string | null;
  capturedAt: string;
  manifestDigest: string;
  stability: "occ_verified";
  occLimits: string;
  baseIndexStamp: string;
  files: OverlayFileEntry[];
  gaps: string[];
};

export type DirtyOverlaySummary = {
  overlayId: string;
  scope: IdentityScope;
  label: string;
  head: string | null;
  branch: string | null;
  capturedAt: string;
  manifestDigest: string;
  fileCount: number;
  gapCount: number;
  stability: "occ_verified";
};

export type OverlayListResult = {
  scope: IdentityScope;
  items: DirtyOverlaySummary[];
};

export type OverlayVerifyResult = {
  scope: IdentityScope;
  overlayId: string;
  intact: boolean;
  manifestDigest: string;
  checkedBlobs: number;
  missingBlobs: string[];
  mismatchedPaths: string[];
};

export type OverlayReconstructFileResult = {
  path: string;
  action: "written" | "deleted" | "skipped_gap";
  sha256: string | null;
  bytes: number | null;
  crlf: boolean;
  detail: string;
};

export type OverlayReconstructResult = {
  scope: IdentityScope;
  overlayId: string;
  targetDir: string;
  verifiedCount: number;
  deletedCount: number;
  skippedCount: number;
  intact: boolean;
  files: OverlayReconstructFileResult[];
  gaps: string[];
};

export type OverlayCaptureInput = IdentityScope & { label: string };
export type OverlayRefInput = IdentityScope & { overlayId: string };
export type OverlayReconstructInput = IdentityScope & {
  overlayId: string;
  targetDir: string;
  disposableTargetConfirmed: boolean;
};

export type MemoryRequests =
  | ({ operation: "memory.claimRecord" } & ClaimRecordInput)
  | ({ operation: "memory.claimCorrect" } & ClaimCorrectInput)
  | ({ operation: "memory.relationRecord" } & RelationRecordInput)
  | ({ operation: "memory.timeline" } & TimelineInput)
  | ({ operation: "memory.pinCreate" } & PinCreateInput)
  | (IdentityScope & { operation: "memory.pinList" })
  | ({ operation: "memory.pinVerify" } & PinVerifyInput)
  | ({ operation: "memory.pinRelease" } & PinReleaseInput)
  | ({ operation: "memory.gcRun" } & GcRunInput)
  | ({ operation: "memory.purgeStart" } & PurgeStartInput)
  | (IdentityScope & { operation: "memory.purgeResume"; purgeId: string })
  | (IdentityScope & { operation: "memory.purgeStatus"; purgeId: string })
  | ({ operation: "memory.inboxSubmit" } & InboxSubmitInput)
  | (IdentityScope & { operation: "memory.inboxList" })
  | ({ operation: "memory.inboxReview" } & InboxReviewInput)
  | ({ operation: "memory.exportPreview" } & ExportPreviewInput)
  | ({ operation: "memory.exportExceptionGrant" } & ExportExceptionGrantInput)
  | ({ operation: "memory.exportExecute" } & ExportExecuteInput)
  | ({ operation: "memory.overlayCapture" } & OverlayCaptureInput)
  | (IdentityScope & { operation: "memory.overlayList" })
  | ({ operation: "memory.overlayVerify" } & OverlayRefInput)
  | ({ operation: "memory.overlayReconstruct" } & OverlayReconstructInput);

export type MemoryResults = {
  "memory.claimRecord": ClaimDetailResult;
  "memory.claimCorrect": ClaimDetailResult;
  "memory.relationRecord": RelationRecord;
  "memory.timeline": TimelineResult;
  "memory.pinCreate": CasPinRecord;
  "memory.pinList": PinListResult;
  "memory.pinVerify": PinVerifyResult;
  "memory.pinRelease": PinReleaseResult;
  "memory.gcRun": GcReport;
  "memory.purgeStart": PurgeJobRecord;
  "memory.purgeResume": PurgeJobRecord;
  "memory.purgeStatus": PurgeJobRecord;
  "memory.inboxSubmit": InboxProposalRecord;
  "memory.inboxList": InboxListResult;
  "memory.inboxReview": InboxReviewResult;
  "memory.exportPreview": ExportPreviewResult;
  "memory.exportExceptionGrant": ExportExceptionRecord;
  "memory.exportExecute": ExportAuditRecord;
  "memory.overlayCapture": DirtyOverlayManifest;
  "memory.overlayList": OverlayListResult;
  "memory.overlayVerify": OverlayVerifyResult;
  "memory.overlayReconstruct": OverlayReconstructResult;
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

function isOid(value: unknown): value is string {
  return (
    typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
  );
}

function bounded(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxBytes &&
    utf8.encode(value).length <= maxBytes &&
    !/[\0\p{Cs}]/u.test(value)
  );
}

function isNonEmptyNoNul(value: unknown, maxChars: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxChars &&
    !/[\0\p{Cs}]/u.test(value)
  );
}

function sameScope(left: IdentityScope, right: IdentityScope): boolean {
  return (
    left.projectId === right.projectId &&
    left.bindingId === right.bindingId &&
    left.worktreeId === right.worktreeId
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && isContextDate(value);
}

function validInterval(start: unknown, end: unknown): boolean {
  if (!isIsoDate(start)) return false;
  if (end === null || end === undefined) return true;
  if (!isIsoDate(end)) return false;
  return Date.parse(start) < Date.parse(end);
}

function readEvidenceAttachment(
  value: unknown,
): EvidenceAttachmentRef | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (value.kind === "pin" && isRequestId(value.pinId)) {
    return { kind: "pin", pinId: value.pinId };
  }
  if (
    value.kind === "context_excerpt" &&
    isProjectId(value.contextId) &&
    isContextPath(value.path) &&
    isProjectId(value.sha256) &&
    isCount(value.chunk) &&
    value.chunk <= 0xffffffff
  ) {
    return {
      kind: "context_excerpt",
      contextId: value.contextId,
      path: value.path,
      sha256: value.sha256,
      chunk: value.chunk,
    };
  }
  return undefined;
}

function readExportCandidate(value: unknown): ExportCandidateInput | undefined {
  if (!isRecord(value)) return;
  if (
    !isSlug(value.itemId) ||
    !isNonEmptyNoNul(value.title, 256) ||
    !oneOf(compilerVisibility, value.visibility) ||
    !bounded(value.content, maxClaimContentBytes)
  ) {
    return;
  }
  return {
    itemId: value.itemId,
    title: value.title,
    visibility: value.visibility,
    content: value.content,
  };
}

function isEvidenceAttachment(
  value: unknown,
): value is EvidenceAttachmentRef | null {
  return readEvidenceAttachment(value) !== undefined;
}

function isClaimRevision(
  value: unknown,
  expectedClaimId?: string,
): value is ClaimRevision {
  return (
    isRecord(value) &&
    isRequestId(value.revisionId) &&
    isRequestId(value.claimId) &&
    (expectedClaimId === undefined || value.claimId === expectedClaimId) &&
    isCount(value.segmentSeq) &&
    isCount(value.txSeq) &&
    value.txSeq > 0 &&
    bounded(value.content, maxClaimContentBytes) &&
    isNonEmptyNoNul(value.author, 128) &&
    isNonEmptyNoNul(value.reason, 512) &&
    oneOf(memoryAuthorities, value.authority) &&
    oneOf(compilerVisibility, value.visibility) &&
    (value.conflictKey === null || isSlug(value.conflictKey)) &&
    (value.conflictPolarity === null ||
      oneOf(conflictPolarities, value.conflictPolarity)) &&
    validInterval(value.validFrom, value.validTo) &&
    validInterval(value.knownFrom, value.knownTo) &&
    (value.supersedesRevisionId === null ||
      isRequestId(value.supersedesRevisionId)) &&
    isEvidenceAttachment(value.evidenceRef) &&
    isContextDate(value.recordedAt)
  );
}

function isClaimDetailResult(value: unknown): value is ClaimDetailResult {
  if (
    !isRecord(value) ||
    !isIdentityScope(value.scope) ||
    !isRequestId(value.claimId) ||
    !isNonEmptyNoNul(value.title, 256) ||
    !isCount(value.activeCount) ||
    !Array.isArray(value.revisions)
  ) {
    return false;
  }
  const cid = value.claimId;
  return value.revisions.every((item) => isClaimRevision(item, cid));
}

function isRelationRecord(value: unknown): value is RelationRecord {
  return (
    isRecord(value) &&
    isRequestId(value.relationId) &&
    isIdentityScope(value.scope) &&
    isSlug(value.fromId) &&
    isSlug(value.toId) &&
    oneOf(relationKinds, value.kind) &&
    oneOf(timelineSignalKinds, value.signalKind) &&
    isNonEmptyNoNul(value.rationale, 512) &&
    isNonEmptyNoNul(value.author, 128) &&
    isContextDate(value.knownAt)
  );
}

function isTimelineResult(value: unknown): value is TimelineResult {
  if (
    !isRecord(value) ||
    !isIdentityScope(value.scope) ||
    !isContextDate(value.knownAt) ||
    !(value.validAt === null || isContextDate(value.validAt)) ||
    !Array.isArray(value.claims) ||
    !Array.isArray(value.edges) ||
    !Array.isArray(value.signals) ||
    !Array.isArray(value.conflicts)
  ) {
    return false;
  }
  const scope = value.scope;
  return (
    value.claims.every(
      (entry: unknown) =>
        isRecord(entry) &&
        isRequestId(entry.claimId) &&
        isNonEmptyNoNul(entry.title, 256) &&
        isClaimRevision(entry.revision, entry.claimId) &&
        isRecord(entry.resolvedEvidence) &&
        oneOf(["verified", "gap", "none"], entry.resolvedEvidence.state) &&
        oneOf(
          ["cas_pin", "context_store", "none"],
          entry.resolvedEvidence.source,
        ),
    ) &&
    value.edges.every(
      (edge: unknown) => isRelationRecord(edge) && sameScope(edge.scope, scope),
    ) &&
    value.signals.every(
      (sig: unknown) =>
        isRecord(sig) &&
        isNonEmptyNoNul(sig.signalId, 192) &&
        oneOf(timelineSignalKinds, sig.signalKind) &&
        isSlug(sig.subjectId) &&
        (sig.targetId === null || isSlug(sig.targetId)) &&
        isNonEmptyNoNul(sig.summary, 512) &&
        isContextDate(sig.recordedAt) &&
        typeof sig.derivedFromConfirmed === "boolean",
    ) &&
    value.conflicts.every(
      (conf: unknown) =>
        isRecord(conf) &&
        isSlug(conf.conflictKey) &&
        oneOf(["bitemporal_contradiction", "drift_alert"], conf.kind) &&
        isNonEmptyNoNul(conf.summary, 512) &&
        Array.isArray(conf.revisionIds) &&
        validInterval(conf.validOverlapFrom, conf.validOverlapTo),
    )
  );
}

function isCasPinRecord(value: unknown): value is CasPinRecord {
  return (
    isRecord(value) &&
    isRequestId(value.pinId) &&
    isIdentityScope(value.scope) &&
    isNonEmptyNoNul(value.label, 256) &&
    isProjectId(value.digest) &&
    isCount(value.bytes) &&
    oneOf(["context_excerpt", "inline"], value.sourceKind) &&
    (value.sourceContextId === null || isProjectId(value.sourceContextId)) &&
    (value.sourcePath === null || isContextPath(value.sourcePath)) &&
    (value.sourceChunk === null || isCount(value.sourceChunk)) &&
    (value.protectedClaimId === null || isRequestId(value.protectedClaimId)) &&
    oneOf(["active", "released", "purged"], value.status) &&
    isContextDate(value.createdAt)
  );
}

function isPurgeJobRecord(value: unknown): value is PurgeJobRecord {
  return (
    isRecord(value) &&
    isRequestId(value.purgeId) &&
    isRequestId(value.tombstoneId) &&
    isIdentityScope(value.scope) &&
    oneOf(purgeTargetKinds, value.targetKind) &&
    isRequestId(value.targetId) &&
    oneOf(purgeStages, value.stage) &&
    oneOf(["in_progress", "completed"], value.state) &&
    isCount(value.removedBlobs) &&
    typeof value.preservedSharedBlobs === "boolean" &&
    isNonEmptyNoNul(value.reason, 256) &&
    isContextDate(value.startedAt) &&
    isContextDate(value.updatedAt) &&
    (value.completedAt === null || isContextDate(value.completedAt))
  );
}

function isInboxProposalRecord(value: unknown): value is InboxProposalRecord {
  return (
    isRecord(value) &&
    isRequestId(value.proposalId) &&
    isIdentityScope(value.scope) &&
    isProjectId(value.fingerprint) &&
    isNonEmptyNoNul(value.title, 256) &&
    bounded(value.content, maxClaimContentBytes) &&
    oneOf(inboxTargetKinds, value.targetKind) &&
    oneOf(compilerVisibility, value.visibility) &&
    oneOf(inboxStatuses, value.status) &&
    isCount(value.duplicateCount) &&
    value.duplicateCount >= 1 &&
    Array.isArray(value.origins) &&
    value.origins.every((item: unknown) => isNonEmptyNoNul(item, 128)) &&
    isContextDate(value.createdAt) &&
    isContextDate(value.expiresAt) &&
    (value.reviewedAt === null || isContextDate(value.reviewedAt)) &&
    (value.reviewer === null || isNonEmptyNoNul(value.reviewer, 128)) &&
    (value.reviewNote === null || isNonEmptyNoNul(value.reviewNote, 512)) &&
    (value.promotedClaimId === null || isRequestId(value.promotedClaimId))
  );
}

function isOverlayStage(value: unknown): value is OverlayStageEntry {
  return (
    isRecord(value) &&
    (value.stage === 0 ||
      value.stage === 1 ||
      value.stage === 2 ||
      value.stage === 3) &&
    typeof value.mode === "string" &&
    /^[0-7]{6}$/.test(value.mode) &&
    isOid(value.oid) &&
    (value.sha256 === null || isProjectId(value.sha256)) &&
    (value.size === null || isCount(value.size)) &&
    typeof value.crlf === "boolean" &&
    (value.gap === null || isNonEmptyNoNul(value.gap, 256))
  );
}

function isOverlayFile(value: unknown): value is OverlayFileEntry {
  return (
    isRecord(value) &&
    isContextPath(value.path) &&
    (value.fromPath === null || isContextPath(value.fromPath)) &&
    oneOf(overlayFileKinds, value.kind) &&
    typeof value.status === "string" &&
    value.status.length >= 1 &&
    value.status.length <= 4 &&
    (value.worktreeSha256 === null || isProjectId(value.worktreeSha256)) &&
    (value.worktreeSize === null || isCount(value.worktreeSize)) &&
    typeof value.crlf === "boolean" &&
    (value.symlinkTarget === null || typeof value.symlinkTarget === "string") &&
    (value.gitlinkOid === null || isOid(value.gitlinkOid)) &&
    Array.isArray(value.stages) &&
    value.stages.every(isOverlayStage) &&
    (value.gap === null || isNonEmptyNoNul(value.gap, 256))
  );
}

function isDirtyOverlayManifest(value: unknown): value is DirtyOverlayManifest {
  return (
    isRecord(value) &&
    value.schemaVersion === memorySchemaVersion &&
    isRequestId(value.overlayId) &&
    isIdentityScope(value.scope) &&
    isNonEmptyNoNul(value.label, 256) &&
    (value.head === null || isOid(value.head)) &&
    (value.branch === null || isNonEmptyNoNul(value.branch, 256)) &&
    isContextDate(value.capturedAt) &&
    isProjectId(value.manifestDigest) &&
    value.stability === "occ_verified" &&
    isNonEmptyNoNul(value.occLimits, 512) &&
    typeof value.baseIndexStamp === "string" &&
    Array.isArray(value.files) &&
    value.files.length <= maxOverlayItems &&
    value.files.every(isOverlayFile) &&
    Array.isArray(value.gaps) &&
    value.gaps.every((item: unknown) => typeof item === "string")
  );
}

export function parseMemoryRequest(value: unknown): MemoryRequests | undefined {
  if (!isRecord(value) || typeof value.operation !== "string") return;
  if (!value.operation.startsWith("memory.")) return;
  if (!isIdentityScope(value)) return;
  const raw = value as Record<string, unknown>;
  const scope: IdentityScope = {
    projectId: value.projectId,
    bindingId: value.bindingId,
    worktreeId: value.worktreeId,
  };

  switch (raw.operation) {
    case "memory.claimRecord": {
      if (
        !isRequestId(raw.requestId) ||
        !isNonEmptyNoNul(raw.title, 256) ||
        !bounded(raw.content, maxClaimContentBytes) ||
        !isNonEmptyNoNul(raw.author, 128) ||
        !isNonEmptyNoNul(raw.reason, 512) ||
        !validInterval(raw.validFrom, raw.validTo)
      ) {
        return;
      }
      if (
        raw.promoteCanonical !== undefined &&
        typeof raw.promoteCanonical !== "boolean"
      )
        return;
      if (
        raw.visibility !== undefined &&
        !oneOf(compilerVisibility, raw.visibility)
      )
        return;
      if (raw.conflictKey !== undefined && !isSlug(raw.conflictKey)) return;
      if (
        raw.conflictPolarity !== undefined &&
        !oneOf(conflictPolarities, raw.conflictPolarity)
      )
        return;
      if (raw.knownAt !== undefined && !isIsoDate(raw.knownAt)) return;
      let evidenceRef: EvidenceAttachmentRef | null | undefined;
      if (raw.evidenceRef !== undefined) {
        evidenceRef = readEvidenceAttachment(raw.evidenceRef);
        if (evidenceRef === undefined) return;
      }
      const out: Extract<MemoryRequests, { operation: "memory.claimRecord" }> =
        {
          operation: "memory.claimRecord",
          ...scope,
          requestId: raw.requestId,
          title: raw.title,
          content: raw.content,
          author: raw.author,
          reason: raw.reason,
          validFrom: raw.validFrom as string,
        };
      if (raw.validTo !== undefined) out.validTo = raw.validTo as string | null;
      if (raw.promoteCanonical !== undefined)
        out.promoteCanonical = raw.promoteCanonical;
      if (raw.visibility !== undefined) out.visibility = raw.visibility;
      if (raw.conflictKey !== undefined) out.conflictKey = raw.conflictKey;
      if (raw.conflictPolarity !== undefined)
        out.conflictPolarity = raw.conflictPolarity;
      if (raw.knownAt !== undefined) out.knownAt = raw.knownAt;
      if (evidenceRef !== undefined) out.evidenceRef = evidenceRef;
      return out;
    }
    case "memory.claimCorrect": {
      if (
        !isRequestId(raw.requestId) ||
        !isRequestId(raw.claimId) ||
        !bounded(raw.content, maxClaimContentBytes) ||
        !isNonEmptyNoNul(raw.author, 128) ||
        !isNonEmptyNoNul(raw.reason, 512) ||
        !validInterval(raw.correctFrom, raw.correctTo)
      ) {
        return;
      }
      if (raw.knownAt !== undefined && !isIsoDate(raw.knownAt)) return;
      if (raw.conflictKey !== undefined && !isSlug(raw.conflictKey)) return;
      if (
        raw.conflictPolarity !== undefined &&
        !oneOf(conflictPolarities, raw.conflictPolarity)
      )
        return;
      let evidenceRef: EvidenceAttachmentRef | null | undefined;
      if (raw.evidenceRef !== undefined) {
        evidenceRef = readEvidenceAttachment(raw.evidenceRef);
        if (evidenceRef === undefined) return;
      }
      const out: Extract<MemoryRequests, { operation: "memory.claimCorrect" }> =
        {
          operation: "memory.claimCorrect",
          ...scope,
          requestId: raw.requestId,
          claimId: raw.claimId,
          content: raw.content,
          author: raw.author,
          reason: raw.reason,
          correctFrom: raw.correctFrom as string,
        };
      if (raw.correctTo !== undefined)
        out.correctTo = raw.correctTo as string | null;
      if (raw.knownAt !== undefined) out.knownAt = raw.knownAt;
      if (raw.conflictKey !== undefined) out.conflictKey = raw.conflictKey;
      if (raw.conflictPolarity !== undefined)
        out.conflictPolarity = raw.conflictPolarity;
      if (evidenceRef !== undefined) out.evidenceRef = evidenceRef;
      return out;
    }
    case "memory.relationRecord": {
      if (
        !isSlug(raw.fromId) ||
        !isSlug(raw.toId) ||
        !oneOf(relationKinds, raw.kind) ||
        !oneOf(timelineSignalKinds, raw.signalKind) ||
        !isNonEmptyNoNul(raw.rationale, 512) ||
        !isNonEmptyNoNul(raw.author, 128)
      ) {
        return;
      }
      if (raw.knownAt !== undefined && !isIsoDate(raw.knownAt)) return;
      const out: Extract<
        MemoryRequests,
        { operation: "memory.relationRecord" }
      > = {
        operation: "memory.relationRecord",
        ...scope,
        fromId: raw.fromId,
        toId: raw.toId,
        kind: raw.kind,
        signalKind: raw.signalKind,
        rationale: raw.rationale,
        author: raw.author,
      };
      if (raw.knownAt !== undefined) out.knownAt = raw.knownAt;
      return out;
    }
    case "memory.timeline": {
      if (!isIsoDate(raw.knownAt)) return;
      if (
        raw.validAt !== undefined &&
        raw.validAt !== null &&
        !isIsoDate(raw.validAt)
      )
        return;
      if (
        raw.signalKinds !== undefined &&
        (!Array.isArray(raw.signalKinds) ||
          raw.signalKinds.length > timelineSignalKinds.length ||
          !raw.signalKinds.every((k) => oneOf(timelineSignalKinds, k)))
      ) {
        return;
      }
      const out: Extract<MemoryRequests, { operation: "memory.timeline" }> = {
        operation: "memory.timeline",
        ...scope,
        knownAt: raw.knownAt,
      };
      if (raw.validAt !== undefined) out.validAt = raw.validAt;
      if (raw.signalKinds !== undefined) out.signalKinds = raw.signalKinds;
      return out;
    }
    case "memory.pinCreate": {
      if (!isNonEmptyNoNul(raw.label, 256) || !isRecord(raw.source)) return;
      let source: PinSourceInput;
      if (raw.source.kind === "inline") {
        if (!bounded(raw.source.content, maxClaimContentBytes)) return;
        source = { kind: "inline", content: raw.source.content };
      } else if (
        raw.source.kind === "context_excerpt" &&
        isProjectId(raw.source.contextId) &&
        isContextPath(raw.source.path) &&
        isProjectId(raw.source.sha256) &&
        isCount(raw.source.chunk)
      ) {
        source = {
          kind: "context_excerpt",
          contextId: raw.source.contextId,
          path: raw.source.path,
          sha256: raw.source.sha256,
          chunk: raw.source.chunk,
        };
      } else {
        return;
      }
      if (
        raw.quotaBytes !== undefined &&
        (!isCount(raw.quotaBytes) ||
          raw.quotaBytes < minCasQuotaBytes ||
          raw.quotaBytes > maxCasQuotaBytes)
      ) {
        return;
      }
      if (
        raw.protectedClaimId !== undefined &&
        !isRequestId(raw.protectedClaimId)
      ) {
        return;
      }
      const out: MemoryRequests = {
        operation: "memory.pinCreate",
        ...scope,
        label: raw.label,
        source,
      };
      if (raw.quotaBytes !== undefined) out.quotaBytes = raw.quotaBytes;
      if (raw.protectedClaimId !== undefined)
        out.protectedClaimId = raw.protectedClaimId;
      return out;
    }
    case "memory.pinList":
      return { operation: "memory.pinList", ...scope };
    case "memory.pinVerify": {
      if (raw.pinId !== undefined && !isRequestId(raw.pinId)) return;
      let unpinnedRef: PinVerifyInput["unpinnedRef"];
      if (raw.unpinnedRef !== undefined) {
        if (
          !isRecord(raw.unpinnedRef) ||
          !isProjectId(raw.unpinnedRef.contextId) ||
          !isContextPath(raw.unpinnedRef.path) ||
          !isProjectId(raw.unpinnedRef.sha256) ||
          !isCount(raw.unpinnedRef.chunk)
        ) {
          return;
        }
        unpinnedRef = {
          contextId: raw.unpinnedRef.contextId,
          path: raw.unpinnedRef.path,
          sha256: raw.unpinnedRef.sha256,
          chunk: raw.unpinnedRef.chunk,
        };
      }
      if (raw.pinId === undefined && unpinnedRef === undefined) return;
      const out: MemoryRequests = { operation: "memory.pinVerify", ...scope };
      if (raw.pinId !== undefined) out.pinId = raw.pinId;
      if (unpinnedRef !== undefined) out.unpinnedRef = unpinnedRef;
      return out;
    }
    case "memory.pinRelease":
      if (!isRequestId(raw.pinId) || typeof raw.humanConfirmed !== "boolean")
        return;
      return {
        operation: "memory.pinRelease",
        ...scope,
        pinId: raw.pinId,
        humanConfirmed: raw.humanConfirmed,
      };
    case "memory.gcRun": {
      if (typeof raw.humanConfirmed !== "boolean") return;
      if (
        raw.quotaBytes !== undefined &&
        (!isCount(raw.quotaBytes) ||
          raw.quotaBytes < minCasQuotaBytes ||
          raw.quotaBytes > maxCasQuotaBytes)
      )
        return;
      const out: MemoryRequests = {
        operation: "memory.gcRun",
        ...scope,
        humanConfirmed: raw.humanConfirmed,
      };
      if (raw.quotaBytes !== undefined) out.quotaBytes = raw.quotaBytes;
      return out;
    }
    case "memory.purgeStart": {
      if (
        !oneOf(purgeTargetKinds, raw.targetKind) ||
        !isRequestId(raw.targetId) ||
        !isNonEmptyNoNul(raw.reason, 256) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      if (
        raw.maxSteps !== undefined &&
        (!isCount(raw.maxSteps) || raw.maxSteps < 1 || raw.maxSteps > 4)
      )
        return;
      const out: MemoryRequests = {
        operation: "memory.purgeStart",
        ...scope,
        targetKind: raw.targetKind,
        targetId: raw.targetId,
        reason: raw.reason,
        humanConfirmed: raw.humanConfirmed,
      };
      if (raw.maxSteps !== undefined) out.maxSteps = raw.maxSteps;
      return out;
    }
    case "memory.purgeResume":
    case "memory.purgeStatus":
      if (!isRequestId(raw.purgeId)) return;
      return { operation: raw.operation, ...scope, purgeId: raw.purgeId };
    case "memory.inboxSubmit": {
      if (
        !isNonEmptyNoNul(raw.title, 256) ||
        !bounded(raw.content, maxClaimContentBytes) ||
        !oneOf(inboxTargetKinds, raw.targetKind) ||
        !isNonEmptyNoNul(raw.originLabel, 128)
      ) {
        return;
      }
      if (
        raw.visibility !== undefined &&
        !oneOf(compilerVisibility, raw.visibility)
      )
        return;
      if (
        raw.ttlMs !== undefined &&
        (!isCount(raw.ttlMs) ||
          raw.ttlMs < minInboxTtlMs ||
          raw.ttlMs > maxInboxTtlMs)
      )
        return;
      const out: MemoryRequests = {
        operation: "memory.inboxSubmit",
        ...scope,
        title: raw.title,
        content: raw.content,
        targetKind: raw.targetKind,
        originLabel: raw.originLabel,
      };
      if (raw.visibility !== undefined) out.visibility = raw.visibility;
      if (raw.ttlMs !== undefined) out.ttlMs = raw.ttlMs;
      return out;
    }
    case "memory.inboxList":
      return { operation: "memory.inboxList", ...scope };
    case "memory.inboxReview": {
      if (
        !isRequestId(raw.proposalId) ||
        (raw.decision !== "approve" && raw.decision !== "reject") ||
        !isNonEmptyNoNul(raw.reviewer, 128) ||
        !isNonEmptyNoNul(raw.note, 512) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      if (
        raw.promoteCanonical !== undefined &&
        typeof raw.promoteCanonical !== "boolean"
      )
        return;
      if (raw.validFrom !== undefined && !isIsoDate(raw.validFrom)) return;
      const out: Extract<MemoryRequests, { operation: "memory.inboxReview" }> =
        {
          operation: "memory.inboxReview",
          ...scope,
          proposalId: raw.proposalId,
          decision: raw.decision,
          reviewer: raw.reviewer,
          note: raw.note,
          humanConfirmed: raw.humanConfirmed,
        };
      if (raw.promoteCanonical !== undefined)
        out.promoteCanonical = raw.promoteCanonical;
      if (raw.validFrom !== undefined) out.validFrom = raw.validFrom;
      return out;
    }
    case "memory.exportPreview": {
      if (
        !isSlug(raw.destinationId) ||
        !Array.isArray(raw.items) ||
        raw.items.length === 0 ||
        raw.items.length > maxExportItems
      ) {
        return;
      }
      if (raw.policyVersion !== undefined && !isSlug(raw.policyVersion)) return;
      const items = raw.items.map(readExportCandidate);
      if (!items.every((item) => item !== undefined)) return;
      const out: MemoryRequests = {
        operation: "memory.exportPreview",
        ...scope,
        destinationId: raw.destinationId,
        items,
      };
      if (raw.policyVersion !== undefined)
        out.policyVersion = raw.policyVersion;
      return out;
    }
    case "memory.exportExceptionGrant": {
      if (
        !isProjectId(raw.bundleDigest) ||
        !isSlug(raw.destinationId) ||
        !isSlug(raw.policyVersion) ||
        !isNonEmptyNoNul(raw.reviewer, 128) ||
        !isNonEmptyNoNul(raw.reason, 512) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      if (
        raw.hasDbOnlyItems !== undefined &&
        typeof raw.hasDbOnlyItems !== "boolean"
      )
        return;
      const out: MemoryRequests = {
        operation: "memory.exportExceptionGrant",
        ...scope,
        bundleDigest: raw.bundleDigest,
        destinationId: raw.destinationId,
        policyVersion: raw.policyVersion,
        reviewer: raw.reviewer,
        reason: raw.reason,
        humanConfirmed: raw.humanConfirmed,
      };
      if (raw.hasDbOnlyItems !== undefined)
        out.hasDbOnlyItems = raw.hasDbOnlyItems;
      return out;
    }
    case "memory.exportExecute": {
      if (
        !isSlug(raw.destinationId) ||
        !isSlug(raw.policyVersion) ||
        !Array.isArray(raw.items) ||
        raw.items.length === 0 ||
        raw.items.length > maxExportItems
      ) {
        return;
      }
      if (raw.exceptionId !== undefined && !isRequestId(raw.exceptionId))
        return;
      const items = raw.items.map(readExportCandidate);
      if (!items.every((item) => item !== undefined)) return;
      const out: MemoryRequests = {
        operation: "memory.exportExecute",
        ...scope,
        destinationId: raw.destinationId,
        policyVersion: raw.policyVersion,
        items,
      };
      if (raw.exceptionId !== undefined) out.exceptionId = raw.exceptionId;
      return out;
    }
    case "memory.overlayCapture":
      if (!isNonEmptyNoNul(raw.label, 256)) return;
      return { operation: "memory.overlayCapture", ...scope, label: raw.label };
    case "memory.overlayList":
      return { operation: "memory.overlayList", ...scope };
    case "memory.overlayVerify":
      if (!isRequestId(raw.overlayId)) return;
      return {
        operation: "memory.overlayVerify",
        ...scope,
        overlayId: raw.overlayId,
      };
    case "memory.overlayReconstruct":
      if (
        !isRequestId(raw.overlayId) ||
        !isNonEmptyNoNul(raw.targetDir, 4096) ||
        typeof raw.disposableTargetConfirmed !== "boolean"
      ) {
        return;
      }
      return {
        operation: "memory.overlayReconstruct",
        ...scope,
        overlayId: raw.overlayId,
        targetDir: raw.targetDir,
        disposableTargetConfirmed: raw.disposableTargetConfirmed,
      };
    default:
      return;
  }
}

export function isMemoryResult<K extends keyof MemoryResults>(
  operation: K,
  value: unknown,
): boolean {
  if (!isRecord(value) || !isIdentityScope(value.scope)) return false;
  switch (operation) {
    case "memory.claimRecord":
    case "memory.claimCorrect":
      return isClaimDetailResult(value);
    case "memory.relationRecord":
      return isRelationRecord(value);
    case "memory.timeline":
      return isTimelineResult(value);
    case "memory.pinCreate":
      return isCasPinRecord(value);
    case "memory.pinList":
      return (
        isCount(value.quotaBytes) &&
        isCount(value.usedBytes) &&
        Array.isArray(value.items) &&
        value.items.every(isCasPinRecord)
      );
    case "memory.pinVerify":
      return (
        oneOf(["verified", "corrupt", "gap"], value.state) &&
        oneOf(["cas_pin", "context_store", "none"], value.source) &&
        (value.digest === null || isProjectId(value.digest)) &&
        (value.bytes === null || isCount(value.bytes)) &&
        (value.textPreview === null || typeof value.textPreview === "string") &&
        (value.gapReason === null || typeof value.gapReason === "string")
      );
    case "memory.pinRelease":
      return (
        isRequestId(value.pinId) &&
        typeof value.released === "boolean" &&
        typeof value.blobCollected === "boolean"
      );
    case "memory.gcRun":
      return (
        isCount(value.quotaBytes) &&
        isCount(value.usedBytesBefore) &&
        isCount(value.usedBytesAfter) &&
        Array.isArray(value.deletedDigests) &&
        value.deletedDigests.every(isProjectId) &&
        Array.isArray(value.protectedDigests) &&
        value.protectedDigests.every(isProjectId) &&
        isCount(value.protectedCount)
      );
    case "memory.purgeStart":
    case "memory.purgeResume":
    case "memory.purgeStatus":
      return isPurgeJobRecord(value);
    case "memory.inboxSubmit":
      return isInboxProposalRecord(value);
    case "memory.inboxList":
      return (
        Array.isArray(value.items) && value.items.every(isInboxProposalRecord)
      );
    case "memory.inboxReview":
      return (
        isInboxProposalRecord(value.proposal) &&
        isRecord(value.feedback) &&
        isRequestId(value.feedback.feedbackId) &&
        (value.createdClaim === null || isClaimDetailResult(value.createdClaim))
      );
    case "memory.exportPreview":
      return (
        isSlug(value.destinationId) &&
        isSlug(value.policyVersion) &&
        isProjectId(value.bundleDigest) &&
        typeof value.eligible === "boolean" &&
        typeof value.hardDenied === "boolean" &&
        typeof value.requiresException === "boolean" &&
        Array.isArray(value.findings) &&
        Array.isArray(value.items) &&
        isNonEmptyNoNul(value.reason, 512)
      );
    case "memory.exportExceptionGrant":
      return (
        isRequestId(value.exceptionId) &&
        isProjectId(value.bundleDigest) &&
        isSlug(value.destinationId) &&
        isSlug(value.policyVersion) &&
        isContextDate(value.grantedAt)
      );
    case "memory.exportExecute":
      return (
        isRequestId(value.exportId) &&
        isProjectId(value.bundleDigest) &&
        isSlug(value.destinationId) &&
        isSlug(value.policyVersion) &&
        (value.exceptionId === null || isRequestId(value.exceptionId)) &&
        isCount(value.exportedCount) &&
        Array.isArray(value.itemDigests) &&
        value.itemDigests.every(isProjectId) &&
        isContextDate(value.executedAt)
      );
    case "memory.overlayCapture":
      return isDirtyOverlayManifest(value);
    case "memory.overlayList":
      return (
        Array.isArray(value.items) &&
        value.items.every(
          (item: unknown) =>
            isRecord(item) &&
            isRequestId(item.overlayId) &&
            isIdentityScope(item.scope) &&
            isNonEmptyNoNul(item.label, 256) &&
            isProjectId(item.manifestDigest) &&
            isCount(item.fileCount) &&
            isCount(item.gapCount),
        )
      );
    case "memory.overlayVerify":
      return (
        isRequestId(value.overlayId) &&
        typeof value.intact === "boolean" &&
        isProjectId(value.manifestDigest) &&
        isCount(value.checkedBlobs) &&
        Array.isArray(value.missingBlobs) &&
        Array.isArray(value.mismatchedPaths)
      );
    case "memory.overlayReconstruct":
      return (
        isRequestId(value.overlayId) &&
        isNonEmptyNoNul(value.targetDir, 4096) &&
        isCount(value.verifiedCount) &&
        isCount(value.deletedCount) &&
        isCount(value.skippedCount) &&
        typeof value.intact === "boolean" &&
        Array.isArray(value.files) &&
        Array.isArray(value.gaps)
      );
    default:
      return false;
  }
}
