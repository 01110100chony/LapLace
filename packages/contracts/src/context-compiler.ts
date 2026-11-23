import {
  isIpcError,
  isProjectId,
  isRecord,
  isRequestId,
  type ErrorCode,
} from "./index.ts";
import { isContextDate, isContextPath } from "./context.ts";
import { codexModes, type CodexMode, type CodexSelection } from "./codex.ts";
import { isIdentityScope, type IdentityScope } from "./resume.ts";

export const contextCompilerSchemaVersion = 1;
export const defaultCompilerPolicyVersion = "f2-policy-v1";
export const defaultCompilerStrategyVersion = "f2-deterministic-v1";
export const compilerMinBudgetBytes = 256;
export const compilerMaxBudgetBytes = 64 * 1024;
export const compilerDefaultBudgetBytes = 16 * 1024;
export const compilerMaxItems = 64;
export const compilerMaxObjectiveBytes = 4096;
export const sessionGrantMinTtlMs = 1_000;
export const sessionGrantDefaultTtlMs = 5 * 60_000;
export const sessionGrantMaxTtlMs = 30 * 60_000;
export const mcpSearchPageSize = 10;

export const precedenceTiers = [
  "invariant_canonical",
  "project_preference",
  "personal_profile",
] as const;
export type PrecedenceTier = (typeof precedenceTiers)[number];

export const compilerCandidateKinds = [
  "decision",
  "evidence_excerpt",
  "context_source",
  "project_preference",
  "personal_profile",
] as const;
export type CompilerCandidateKind = (typeof compilerCandidateKinds)[number];

export const compilerVisibility = [
  "canonical_verified",
  "captured_eligible",
  "local_only",
  "db_only",
] as const;
export type CompilerVisibility = (typeof compilerVisibility)[number];

export const knownDestinationIds = [
  "local_preview",
  "codex_mock",
  "codex_cli_workspace",
  "codex_cli_isolated",
] as const;
export type KnownDestinationId = (typeof knownDestinationIds)[number];

export const compilerManifestStatuses = [
  "ready",
  "mandatory_context_exceeded",
  "conflict_suspended",
  "destination_blocked",
] as const;
export type CompilerManifestStatus = (typeof compilerManifestStatuses)[number];

export const compilerOmissionReasons = [
  "cross_scope",
  "db_only_restricted",
  "policy_restricted",
  "budget_exceeded",
  "duplicate_excerpt",
  "overridden_by_precedence",
  "destination_blocked",
  "snapshot_omission",
] as const;
export type CompilerOmissionReason = (typeof compilerOmissionReasons)[number];

export const compilerConflictKinds = [
  "canonical_contradiction",
  "identity_divergent",
  "identity_ambiguous",
  "legacy_unverified",
  "evidence_gap",
  "working_conflict",
  "git_unavailable",
] as const;
export type CompilerConflictKind = (typeof compilerConflictKinds)[number];

export const sessionGrantOperations = [
  "summary",
  "search",
  "read",
  "package",
  "handoff",
  "query",
] as const;
export type SessionGrantOperation = (typeof sessionGrantOperations)[number];

export const f2Channels = ["mcp_stdio", "context_package"] as const;
export type F2Channel = (typeof f2Channels)[number];

export const auditReviewStatuses = [
  "pending",
  "approved",
  "rejected",
  "needs_followup",
] as const;
export type AuditReviewStatus = (typeof auditReviewStatuses)[number];

export type DestinationBlockReason =
  "destination_unknown" | "confinement_unverified" | "local_only_destination";

export type DestinationPolicy = {
  id: string;
  label: string;
  known: boolean;
  executionMode: CodexMode | null;
  deliveryAllowed: boolean;
  allowsLocalOnly: boolean;
  blockReason: DestinationBlockReason | null;
};

export type CompilerPublicAnchor =
  | {
      kind: "decision";
      assertionId: string;
      revisionId: string;
      revision: number;
    }
  | {
      kind: "context_excerpt";
      contextId: string;
      path: string;
      sha256: string;
      chunk: number;
      firstLine: number;
      lastLine: number;
    }
  | {
      kind: "preference";
      key: string;
    };

export type CompilerPublicItem = {
  opaqueRef: string;
  ordinal: number;
  kind: CompilerCandidateKind;
  tier: PrecedenceTier;
  mandatory: boolean;
  version: string;
  contentDigest: string;
  bytes: number;
  rationale: string;
  anchor: CompilerPublicAnchor;
};

export type CompilerLocalItem = CompilerPublicItem & {
  candidateId: string;
  title: string;
  visibility: CompilerVisibility;
  capturedAt: string;
};

export type CompilerConflict = {
  kind: CompilerConflictKind;
  blocking: boolean;
  summary: string;
  detectedAt: string;
  relatedRefs?: string[];
};

export type CompilerPublicOmission = {
  reason: CompilerOmissionReason;
  count: number;
  disclosable: boolean;
};

export type CompilerLocalOmission = {
  candidateId: string;
  title: string;
  tier: PrecedenceTier;
  reason: CompilerOmissionReason;
  bytes: number;
  disclosable: boolean;
  detail: string;
};

export type CompilerBudgetSummary = {
  limitBytes: number;
  mandatoryBytes: number;
  selectedBytes: number;
  remainingBytes: number;
  estimatedTokens: number;
  exceededByBytes: number;
};

export type CompiledPublicManifest = {
  schemaVersion: typeof contextCompilerSchemaVersion;
  scope: IdentityScope;
  objective: string;
  destinationId: string;
  policyVersion: string;
  strategyVersion: string;
  status: CompilerManifestStatus;
  recommendationSuspended: boolean;
  suspensionReason: string | null;
  budget: CompilerBudgetSummary;
  items: CompilerPublicItem[];
  conflicts: CompilerConflict[];
  omissions: CompilerPublicOmission[];
  manifestDigest: string;
};

export type CompiledContextPreview = {
  scope: IdentityScope;
  compiledAt: string;
  destination: DestinationPolicy;
  manifestDigest: string;
  publicManifest: CompiledPublicManifest;
  localItems: CompilerLocalItem[];
  localOmissions: CompilerLocalOmission[];
  mandatoryOverflowItems: {
    candidateId: string;
    title: string;
    tier: PrecedenceTier;
    version: string;
    bytes: number;
    contentDigest: string;
  }[];
};

export type CompilerPreferenceInput = {
  key: string;
  title: string;
  content: string;
  mandatory?: boolean;
  conflictKey?: string;
  conflictPolarity?: "require" | "forbid";
};

export type CompilerExtraCandidateInput = {
  candidateId: string;
  kind: CompilerCandidateKind;
  tier: PrecedenceTier;
  mandatory: boolean;
  visibility: CompilerVisibility;
  version: string;
  title: string;
  text: string;
  scope?: IdentityScope;
  conflictKey?: string;
  conflictPolarity?: "require" | "forbid";
  privateMetadata?: Record<string, string>;
};

export type CompilerCompileInput = IdentityScope & {
  objective: string;
  destinationId: string;
  budgetBytes: number;
  policyVersion?: string;
  strategyVersion?: string;
  contextId?: string;
  selection?: CodexSelection[];
  projectPreferences?: CompilerPreferenceInput[];
  personalPreferences?: CompilerPreferenceInput[];
  extraCandidates?: CompilerExtraCandidateInput[];
};

export type SessionGrantStatus = "active" | "revoked" | "expired";

export type SessionGrantRecord = {
  grantId: string;
  sessionId: string;
  scope: IdentityScope;
  manifestDigest: string;
  policyVersion: string;
  destinationId: string;
  allowedOperations: SessionGrantOperation[];
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  status: SessionGrantStatus;
};

export type GrantIssueInput = IdentityScope & {
  sessionId: string;
  manifestDigest: string;
  policyVersion: string;
  destinationId: string;
  allowedOperations: SessionGrantOperation[];
  ttlMs?: number;
  humanConfirmed: boolean;
  unconfinedConfirmed?: boolean;
};

export type GrantListResult = {
  scope: IdentityScope;
  items: SessionGrantRecord[];
};

export type GrantRevokeInput = IdentityScope & {
  grantId: string;
  reason: string;
};

export type ContextPackageItem = {
  opaqueRef: string;
  version: string;
  tier: PrecedenceTier;
  mandatory: boolean;
  contentDigest: string;
  bytes: number;
  anchor: CompilerPublicAnchor;
  text: string;
};

export type ContextPackage = {
  schemaVersion: typeof contextCompilerSchemaVersion;
  packageId: string;
  createdAt: string;
  manifestDigest: string;
  policyVersion: string;
  strategyVersion: string;
  destinationId: string;
  publicManifest: CompiledPublicManifest;
  items: ContextPackageItem[];
  packageDigest: string;
};

export type HandoffArtifact = {
  schemaVersion: typeof contextCompilerSchemaVersion;
  handoffId: string;
  createdAt: string;
  sourceProjectId: string;
  objective: string;
  manifestDigest: string;
  policyVersion: string;
  strategyVersion: string;
  destinationHint: string;
  selectedRefs: {
    opaqueRef: string;
    version: string;
    tier: PrecedenceTier;
    contentDigest: string;
    bytes: number;
  }[];
  pendingConflicts: CompilerConflict[];
  openQuestions: string[];
  requiresReevaluation: true;
};

export type ContextPackageBundle = {
  scope: IdentityScope;
  grantId: string;
  contextPackage: ContextPackage;
  handoff: HandoffArtifact | null;
};

export type PackageExportInput = IdentityScope & {
  grantId: string;
  sessionId: string;
  manifestDigest: string;
  policyVersion: string;
  destinationId: string;
  includeHandoff: boolean;
};

export type HandoffImportInput = IdentityScope & {
  destinationId: string;
  humanConfirmed: boolean;
  contextPackage?: ContextPackage;
  handoff?: HandoffArtifact;
};

export type HandoffEvaluationStatus =
  | "accepted_requires_grant"
  | "rejected_scope_mismatch"
  | "rejected_destination"
  | "rejected_integrity";

export type HandoffEvaluationResult = {
  scope: IdentityScope;
  evaluation: HandoffEvaluationStatus;
  requiresNewGrant: true;
  sourceProjectId: string | null;
  manifestDigest: string | null;
  destination: DestinationPolicy;
  reason: string;
  selectedRefCount: number;
  pendingConflicts: CompilerConflict[];
};

export type McpMethodName = "summary" | "search" | "read";

export type McpCallInput = IdentityScope & {
  grantId: string;
  sessionId: string;
  manifestDigest: string;
  policyVersion: string;
  destinationId: string;
  method: McpMethodName;
  query?: string;
  cursor?: number;
  limit?: number;
  opaqueRef?: string;
};

export type McpToolResponse = {
  scope: IdentityScope;
  grantId: string;
  sessionId: string;
  method: McpMethodName;
  manifestDigest: string;
  policyVersion: string;
  destinationId: string;
  payload: Record<string, unknown>;
};

export type ObservedMcpToolName =
  "laplace_context_summary" | "laplace_context_search" | "laplace_context_read";

export type ObservedMcpRead = {
  tool: ObservedMcpToolName;
  opaqueRef: string | null;
  query: string | null;
  cursor: number | null;
  outcome: "allowed" | "denied";
  errorCode: ErrorCode | null;
  at: string;
};

export type AuditedCitation = {
  opaqueRef: string;
  verified: boolean;
  version: string | null;
  contentDigest: string | null;
};

export type AuditedQueryState =
  "completed" | "failed" | "denied" | "cancelled" | "timeout";

export type AuditedQueryRecord = {
  auditId: string;
  scope: IdentityScope;
  grantId: string;
  sessionId: string;
  manifestDigest: string;
  policyVersion: string;
  destinationId: string;
  channel: F2Channel;
  mode: CodexMode;
  objective: string;
  state: AuditedQueryState;
  failureCode: string | null;
  delivered: {
    digest: string;
    bytes: number;
    opaqueRefs: string[];
  };
  observability: "mcp_observed" | "package_static";
  observedReads: ObservedMcpRead[];
  mcpAdherence: "observed" | "not_used" | "not_applicable";
  responseText: string | null;
  citations: {
    declared: AuditedCitation[];
    unknown: string[];
  };
  durationMs: number;
  usage: { input: number; cachedInput: number; output: number } | null;
  startedAt: string;
  finishedAt: string;
  review: {
    status: AuditReviewStatus;
    reviewer: string | null;
    note: string | null;
    reviewedAt: string | null;
  };
};

export type AuditedQueryRunInput = IdentityScope & {
  grantId: string;
  sessionId: string;
  manifestDigest: string;
  policyVersion: string;
  destinationId: string;
  channel: F2Channel;
  mode?: CodexMode;
  unconfinedConfirmed?: boolean;
};

export type AuditListResult = {
  scope: IdentityScope;
  items: AuditedQueryRecord[];
};

export type AuditReviewInput = IdentityScope & {
  auditId: string;
  status: Exclude<AuditReviewStatus, "pending">;
  reviewer: string;
  note: string;
  humanConfirmed: boolean;
};

export type CompilerRequests =
  | ({ operation: "compiler.compile" } & CompilerCompileInput)
  | ({ operation: "compiler.grantIssue" } & GrantIssueInput)
  | (IdentityScope & {
      operation: "compiler.grantList";
      manifestDigest?: string;
    })
  | ({ operation: "compiler.grantRevoke" } & GrantRevokeInput)
  | ({ operation: "compiler.packageExport" } & PackageExportInput)
  | ({ operation: "compiler.handoffImport" } & HandoffImportInput)
  | ({ operation: "compiler.mcpCall" } & McpCallInput)
  | ({ operation: "compiler.queryRun" } & AuditedQueryRunInput)
  | (IdentityScope & {
      operation: "compiler.auditList";
      manifestDigest?: string;
    })
  | ({ operation: "compiler.auditReview" } & AuditReviewInput);

export type CompilerResults = {
  "compiler.compile": CompiledContextPreview;
  "compiler.grantIssue": SessionGrantRecord;
  "compiler.grantList": GrantListResult;
  "compiler.grantRevoke": SessionGrantRecord;
  "compiler.packageExport": ContextPackageBundle;
  "compiler.handoffImport": HandoffEvaluationResult;
  "compiler.mcpCall": McpToolResponse;
  "compiler.queryRun": AuditedQueryRecord;
  "compiler.auditList": AuditListResult;
  "compiler.auditReview": AuditedQueryRecord;
};

const utf8 = new TextEncoder();

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function boundedText(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxBytes &&
    utf8.encode(value).length <= maxBytes &&
    !/[\0\p{Cs}]/u.test(value)
  );
}

function boundedNonEmpty(value: unknown, maxChars: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxChars &&
    !/[\0\p{Cs}]/u.test(value)
  );
}

function isSlugId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,64}$/.test(value);
}

export function isOpaqueRef(value: unknown): value is string {
  return typeof value === "string" && /^ref-[a-f0-9]{16}$/.test(value);
}

function oneOf<T extends string>(
  list: readonly T[],
  value: unknown,
): value is T {
  return list.some((item) => item === value);
}

function sameScope(left: IdentityScope, right: IdentityScope): boolean {
  return (
    left.projectId === right.projectId &&
    left.bindingId === right.bindingId &&
    left.worktreeId === right.worktreeId
  );
}

function readSelectionEntry(value: unknown): CodexSelection | undefined {
  if (!isRecord(value)) return;
  const { path, sha256, chunk } = value;
  if (
    isContextPath(path) &&
    isProjectId(sha256) &&
    (chunk === null || (isCount(chunk) && chunk <= 0xffffffff))
  ) {
    return { path, sha256, chunk };
  }
}

function readPreferenceInput(
  value: unknown,
): CompilerPreferenceInput | undefined {
  if (!isRecord(value)) return;
  if (
    !isSlugId(value.key) ||
    !boundedNonEmpty(value.title, 256) ||
    !boundedText(value.content, 8_192)
  ) {
    return;
  }
  if (value.mandatory !== undefined && typeof value.mandatory !== "boolean") {
    return;
  }
  if (value.conflictKey !== undefined && !isSlugId(value.conflictKey)) {
    return;
  }
  if (
    value.conflictPolarity !== undefined &&
    value.conflictPolarity !== "require" &&
    value.conflictPolarity !== "forbid"
  ) {
    return;
  }
  const result: CompilerPreferenceInput = {
    key: value.key,
    title: value.title,
    content: value.content,
  };
  if (value.mandatory !== undefined) result.mandatory = value.mandatory;
  if (value.conflictKey !== undefined) result.conflictKey = value.conflictKey;
  if (value.conflictPolarity !== undefined) {
    result.conflictPolarity = value.conflictPolarity;
  }
  return result;
}

function readExtraCandidateInput(
  value: unknown,
): CompilerExtraCandidateInput | undefined {
  if (!isRecord(value)) return;
  if (
    !isSlugId(value.candidateId) ||
    !oneOf(compilerCandidateKinds, value.kind) ||
    !oneOf(precedenceTiers, value.tier) ||
    typeof value.mandatory !== "boolean" ||
    !oneOf(compilerVisibility, value.visibility) ||
    !isSlugId(value.version) ||
    !boundedNonEmpty(value.title, 256) ||
    typeof value.text !== "string" ||
    value.text.length > 32_768 ||
    /[\0\p{Cs}]/u.test(value.text)
  ) {
    return;
  }
  if (value.scope !== undefined && !isIdentityScope(value.scope)) return;
  if (value.conflictKey !== undefined && !isSlugId(value.conflictKey)) return;
  if (
    value.conflictPolarity !== undefined &&
    value.conflictPolarity !== "require" &&
    value.conflictPolarity !== "forbid"
  ) {
    return;
  }
  let privateMetadata: Record<string, string> | undefined;
  if (value.privateMetadata !== undefined) {
    if (!isRecord(value.privateMetadata)) return;
    privateMetadata = {};
    for (const [k, v] of Object.entries(value.privateMetadata)) {
      if (!isSlugId(k) || typeof v !== "string" || v.length > 1024) return;
      privateMetadata[k] = v;
    }
  }
  const candidate: CompilerExtraCandidateInput = {
    candidateId: value.candidateId,
    kind: value.kind,
    tier: value.tier,
    mandatory: value.mandatory,
    visibility: value.visibility,
    version: value.version,
    title: value.title,
    text: value.text,
  };
  if (value.scope !== undefined) candidate.scope = value.scope;
  if (value.conflictKey !== undefined) {
    candidate.conflictKey = value.conflictKey;
  }
  if (value.conflictPolarity !== undefined) {
    candidate.conflictPolarity = value.conflictPolarity;
  }
  if (privateMetadata !== undefined) {
    candidate.privateMetadata = privateMetadata;
  }
  return candidate;
}

function isDestinationPolicy(value: unknown): value is DestinationPolicy {
  return (
    isRecord(value) &&
    isSlugId(value.id) &&
    boundedNonEmpty(value.label, 128) &&
    typeof value.known === "boolean" &&
    (value.executionMode === null || oneOf(codexModes, value.executionMode)) &&
    typeof value.deliveryAllowed === "boolean" &&
    typeof value.allowsLocalOnly === "boolean" &&
    (value.blockReason === null ||
      oneOf(
        [
          "destination_unknown",
          "confinement_unverified",
          "local_only_destination",
        ],
        value.blockReason,
      ))
  );
}

function isPublicAnchor(value: unknown): value is CompilerPublicAnchor {
  if (!isRecord(value)) return false;
  if (value.kind === "decision") {
    return (
      isProjectId(value.assertionId) &&
      isProjectId(value.revisionId) &&
      isCount(value.revision) &&
      value.revision > 0
    );
  }
  if (value.kind === "context_excerpt") {
    return (
      isProjectId(value.contextId) &&
      isContextPath(value.path) &&
      isProjectId(value.sha256) &&
      isCount(value.chunk) &&
      isCount(value.firstLine) &&
      value.firstLine > 0 &&
      isCount(value.lastLine) &&
      value.lastLine >= value.firstLine
    );
  }
  if (value.kind === "preference") {
    return isSlugId(value.key);
  }
  return false;
}

function isPublicItem(value: unknown): value is CompilerPublicItem {
  return (
    isRecord(value) &&
    isOpaqueRef(value.opaqueRef) &&
    isCount(value.ordinal) &&
    oneOf(compilerCandidateKinds, value.kind) &&
    oneOf(precedenceTiers, value.tier) &&
    typeof value.mandatory === "boolean" &&
    isSlugId(value.version) &&
    isProjectId(value.contentDigest) &&
    isCount(value.bytes) &&
    boundedNonEmpty(value.rationale, 512) &&
    isPublicAnchor(value.anchor)
  );
}

function isLocalItem(value: unknown): value is CompilerLocalItem {
  if (!isPublicItem(value) || !isRecord(value)) return false;
  const raw = value as Record<string, unknown>;
  return (
    isSlugId(raw.candidateId) &&
    boundedNonEmpty(raw.title, 256) &&
    oneOf(compilerVisibility, raw.visibility) &&
    isContextDate(raw.capturedAt)
  );
}

function isCompilerConflict(value: unknown): value is CompilerConflict {
  return (
    isRecord(value) &&
    oneOf(compilerConflictKinds, value.kind) &&
    typeof value.blocking === "boolean" &&
    boundedNonEmpty(value.summary, 512) &&
    isContextDate(value.detectedAt) &&
    (value.relatedRefs === undefined ||
      (Array.isArray(value.relatedRefs) &&
        value.relatedRefs.length <= compilerMaxItems &&
        value.relatedRefs.every((item) => isSlugId(item))))
  );
}

function isPublicOmission(value: unknown): value is CompilerPublicOmission {
  return (
    isRecord(value) &&
    oneOf(compilerOmissionReasons, value.reason) &&
    isCount(value.count) &&
    value.count > 0 &&
    typeof value.disclosable === "boolean"
  );
}

function isLocalOmission(value: unknown): value is CompilerLocalOmission {
  return (
    isRecord(value) &&
    isSlugId(value.candidateId) &&
    boundedNonEmpty(value.title, 256) &&
    oneOf(precedenceTiers, value.tier) &&
    oneOf(compilerOmissionReasons, value.reason) &&
    isCount(value.bytes) &&
    typeof value.disclosable === "boolean" &&
    boundedNonEmpty(value.detail, 512)
  );
}

function isBudgetSummary(value: unknown): value is CompilerBudgetSummary {
  return (
    isRecord(value) &&
    isCount(value.limitBytes) &&
    value.limitBytes >= compilerMinBudgetBytes &&
    isCount(value.mandatoryBytes) &&
    isCount(value.selectedBytes) &&
    isCount(value.remainingBytes) &&
    isCount(value.estimatedTokens) &&
    isCount(value.exceededByBytes)
  );
}

export function isCompiledPublicManifest(
  value: unknown,
): value is CompiledPublicManifest {
  if (
    !isRecord(value) ||
    value.schemaVersion !== contextCompilerSchemaVersion ||
    !isIdentityScope(value.scope) ||
    !boundedText(value.objective, compilerMaxObjectiveBytes) ||
    !isSlugId(value.destinationId) ||
    !isSlugId(value.policyVersion) ||
    !isSlugId(value.strategyVersion) ||
    !oneOf(compilerManifestStatuses, value.status) ||
    typeof value.recommendationSuspended !== "boolean" ||
    !(
      value.suspensionReason === null ||
      boundedNonEmpty(value.suspensionReason, 512)
    ) ||
    !isBudgetSummary(value.budget) ||
    !Array.isArray(value.items) ||
    value.items.length > compilerMaxItems ||
    !value.items.every(
      (item, index) => isPublicItem(item) && item.ordinal === index,
    ) ||
    !Array.isArray(value.conflicts) ||
    !value.conflicts.every(isCompilerConflict) ||
    !Array.isArray(value.omissions) ||
    !value.omissions.every(isPublicOmission) ||
    !isProjectId(value.manifestDigest)
  ) {
    return false;
  }
  if (value.status === "mandatory_context_exceeded") {
    return value.items.length === 0 && value.budget.exceededByBytes > 0;
  }
  if (value.status === "destination_blocked") {
    return value.items.length === 0;
  }
  return value.budget.selectedBytes <= value.budget.limitBytes;
}

function isCompiledContextPreview(
  value: unknown,
): value is CompiledContextPreview {
  if (
    !isRecord(value) ||
    !isIdentityScope(value.scope) ||
    !isContextDate(value.compiledAt) ||
    !isDestinationPolicy(value.destination) ||
    !isProjectId(value.manifestDigest) ||
    !isCompiledPublicManifest(value.publicManifest) ||
    !sameScope(value.scope, value.publicManifest.scope) ||
    value.publicManifest.manifestDigest !== value.manifestDigest ||
    !Array.isArray(value.localItems) ||
    value.localItems.length > compilerMaxItems ||
    !value.localItems.every(isLocalItem) ||
    !Array.isArray(value.localOmissions) ||
    value.localOmissions.length > compilerMaxItems * 2 ||
    !value.localOmissions.every(isLocalOmission) ||
    !Array.isArray(value.mandatoryOverflowItems) ||
    !value.mandatoryOverflowItems.every(
      (item: unknown) =>
        isRecord(item) &&
        isSlugId(item.candidateId) &&
        boundedNonEmpty(item.title, 256) &&
        oneOf(precedenceTiers, item.tier) &&
        isSlugId(item.version) &&
        isCount(item.bytes) &&
        isProjectId(item.contentDigest),
    )
  ) {
    return false;
  }
  return true;
}

function isSessionGrantRecord(value: unknown): value is SessionGrantRecord {
  return (
    isRecord(value) &&
    isRequestId(value.grantId) &&
    isSlugId(value.sessionId) &&
    isIdentityScope(value.scope) &&
    isProjectId(value.manifestDigest) &&
    isSlugId(value.policyVersion) &&
    isSlugId(value.destinationId) &&
    Array.isArray(value.allowedOperations) &&
    value.allowedOperations.length > 0 &&
    value.allowedOperations.every((op) => oneOf(sessionGrantOperations, op)) &&
    isContextDate(value.issuedAt) &&
    isContextDate(value.expiresAt) &&
    (value.revokedAt === null || isContextDate(value.revokedAt)) &&
    (value.revokeReason === null || boundedNonEmpty(value.revokeReason, 256)) &&
    oneOf(["active", "revoked", "expired"], value.status)
  );
}

function isContextPackageItem(value: unknown): value is ContextPackageItem {
  return (
    isRecord(value) &&
    isOpaqueRef(value.opaqueRef) &&
    isSlugId(value.version) &&
    oneOf(precedenceTiers, value.tier) &&
    typeof value.mandatory === "boolean" &&
    isProjectId(value.contentDigest) &&
    isCount(value.bytes) &&
    isPublicAnchor(value.anchor) &&
    typeof value.text === "string" &&
    !/[\0\p{Cs}]/u.test(value.text) &&
    utf8.encode(value.text).length === value.bytes
  );
}

export function isContextPackage(value: unknown): value is ContextPackage {
  if (
    !isRecord(value) ||
    value.schemaVersion !== contextCompilerSchemaVersion ||
    !isRequestId(value.packageId) ||
    !isContextDate(value.createdAt) ||
    !isProjectId(value.manifestDigest) ||
    !isSlugId(value.policyVersion) ||
    !isSlugId(value.strategyVersion) ||
    !isSlugId(value.destinationId) ||
    !isCompiledPublicManifest(value.publicManifest)
  ) {
    return false;
  }
  const manifest = value.publicManifest;
  return (
    manifest.manifestDigest === value.manifestDigest &&
    manifest.policyVersion === value.policyVersion &&
    manifest.strategyVersion === value.strategyVersion &&
    manifest.destinationId === value.destinationId &&
    Array.isArray(value.items) &&
    value.items.length === manifest.items.length &&
    value.items.every(
      (item, index) =>
        isContextPackageItem(item) &&
        item.opaqueRef === manifest.items[index]!.opaqueRef &&
        item.contentDigest === manifest.items[index]!.contentDigest &&
        item.bytes === manifest.items[index]!.bytes,
    ) &&
    isProjectId(value.packageDigest)
  );
}

export function isHandoffArtifact(value: unknown): value is HandoffArtifact {
  return (
    isRecord(value) &&
    value.schemaVersion === contextCompilerSchemaVersion &&
    isRequestId(value.handoffId) &&
    isContextDate(value.createdAt) &&
    isProjectId(value.sourceProjectId) &&
    boundedText(value.objective, compilerMaxObjectiveBytes) &&
    isProjectId(value.manifestDigest) &&
    isSlugId(value.policyVersion) &&
    isSlugId(value.strategyVersion) &&
    isSlugId(value.destinationHint) &&
    Array.isArray(value.selectedRefs) &&
    value.selectedRefs.length <= compilerMaxItems &&
    value.selectedRefs.every(
      (ref: unknown) =>
        isRecord(ref) &&
        isOpaqueRef(ref.opaqueRef) &&
        isSlugId(ref.version) &&
        oneOf(precedenceTiers, ref.tier) &&
        isProjectId(ref.contentDigest) &&
        isCount(ref.bytes),
    ) &&
    Array.isArray(value.pendingConflicts) &&
    value.pendingConflicts.every(isCompilerConflict) &&
    Array.isArray(value.openQuestions) &&
    value.openQuestions.every((q) => boundedNonEmpty(q, 512)) &&
    value.requiresReevaluation === true
  );
}

function isObservedMcpRead(value: unknown): value is ObservedMcpRead {
  return (
    isRecord(value) &&
    oneOf(
      [
        "laplace_context_summary",
        "laplace_context_search",
        "laplace_context_read",
      ],
      value.tool,
    ) &&
    (value.opaqueRef === null || boundedNonEmpty(value.opaqueRef, 256)) &&
    (value.query === null || boundedNonEmpty(value.query, 256)) &&
    (value.cursor === null || isCount(value.cursor)) &&
    (value.outcome === "allowed" || value.outcome === "denied") &&
    (value.errorCode === null || isIpcError({ code: value.errorCode })) &&
    isContextDate(value.at)
  );
}

function isAuditedQueryRecord(value: unknown): value is AuditedQueryRecord {
  return (
    isRecord(value) &&
    isRequestId(value.auditId) &&
    isIdentityScope(value.scope) &&
    isRequestId(value.grantId) &&
    isSlugId(value.sessionId) &&
    isProjectId(value.manifestDigest) &&
    isSlugId(value.policyVersion) &&
    isSlugId(value.destinationId) &&
    oneOf(f2Channels, value.channel) &&
    oneOf(codexModes, value.mode) &&
    boundedText(value.objective, compilerMaxObjectiveBytes) &&
    oneOf(
      ["completed", "failed", "denied", "cancelled", "timeout"],
      value.state,
    ) &&
    (value.failureCode === null || boundedNonEmpty(value.failureCode, 128)) &&
    isRecord(value.delivered) &&
    isProjectId(value.delivered.digest) &&
    isCount(value.delivered.bytes) &&
    Array.isArray(value.delivered.opaqueRefs) &&
    value.delivered.opaqueRefs.every(isOpaqueRef) &&
    (value.observability === "mcp_observed" ||
      value.observability === "package_static") &&
    Array.isArray(value.observedReads) &&
    value.observedReads.every(isObservedMcpRead) &&
    oneOf(["observed", "not_used", "not_applicable"], value.mcpAdherence) &&
    (value.responseText === null ||
      (typeof value.responseText === "string" &&
        value.responseText.length <= 64 * 1024)) &&
    isRecord(value.citations) &&
    Array.isArray(value.citations.declared) &&
    value.citations.declared.every(
      (citation: unknown) =>
        isRecord(citation) &&
        boundedNonEmpty(citation.opaqueRef, 64) &&
        typeof citation.verified === "boolean" &&
        (citation.version === null || isSlugId(citation.version)) &&
        (citation.contentDigest === null ||
          isProjectId(citation.contentDigest)),
    ) &&
    Array.isArray(value.citations.unknown) &&
    value.citations.unknown.every((id) => boundedNonEmpty(id, 64)) &&
    isCount(value.durationMs) &&
    (value.usage === null ||
      (isRecord(value.usage) &&
        isCount(value.usage.input) &&
        isCount(value.usage.cachedInput) &&
        isCount(value.usage.output))) &&
    isContextDate(value.startedAt) &&
    isContextDate(value.finishedAt) &&
    isRecord(value.review) &&
    oneOf(auditReviewStatuses, value.review.status) &&
    (value.review.reviewer === null ||
      boundedNonEmpty(value.review.reviewer, 128)) &&
    (value.review.note === null || boundedNonEmpty(value.review.note, 1024)) &&
    (value.review.reviewedAt === null || isContextDate(value.review.reviewedAt))
  );
}

export function parseCompilerRequest(
  value: Record<string, unknown>,
): CompilerRequests | undefined {
  if (!isIdentityScope(value)) return;
  const raw = value as Record<string, unknown>;
  const scope: IdentityScope = {
    projectId: value.projectId,
    bindingId: value.bindingId,
    worktreeId: value.worktreeId,
  };
  switch (raw.operation) {
    case "compiler.compile": {
      if (
        !boundedText(raw.objective, compilerMaxObjectiveBytes) ||
        !isSlugId(raw.destinationId) ||
        !isCount(raw.budgetBytes) ||
        raw.budgetBytes < compilerMinBudgetBytes ||
        raw.budgetBytes > compilerMaxBudgetBytes
      ) {
        return;
      }
      if (raw.policyVersion !== undefined && !isSlugId(raw.policyVersion))
        return;
      if (raw.strategyVersion !== undefined && !isSlugId(raw.strategyVersion))
        return;
      if (raw.contextId !== undefined && !isProjectId(raw.contextId)) return;
      let selection: CodexSelection[] | undefined;
      if (raw.selection !== undefined) {
        if (
          !Array.isArray(raw.selection) ||
          raw.selection.length > compilerMaxItems
        ) {
          return;
        }
        const parsed = raw.selection.map(readSelectionEntry);
        if (!parsed.every((item) => item !== undefined)) return;
        selection = parsed;
      }
      let projectPreferences: CompilerPreferenceInput[] | undefined;
      if (raw.projectPreferences !== undefined) {
        if (
          !Array.isArray(raw.projectPreferences) ||
          raw.projectPreferences.length > 32
        ) {
          return;
        }
        const parsed = raw.projectPreferences.map(readPreferenceInput);
        if (!parsed.every((item) => item !== undefined)) return;
        projectPreferences = parsed;
      }
      let personalPreferences: CompilerPreferenceInput[] | undefined;
      if (raw.personalPreferences !== undefined) {
        if (
          !Array.isArray(raw.personalPreferences) ||
          raw.personalPreferences.length > 32
        ) {
          return;
        }
        const parsed = raw.personalPreferences.map(readPreferenceInput);
        if (!parsed.every((item) => item !== undefined)) return;
        personalPreferences = parsed;
      }
      let extraCandidates: CompilerExtraCandidateInput[] | undefined;
      if (raw.extraCandidates !== undefined) {
        if (
          !Array.isArray(raw.extraCandidates) ||
          raw.extraCandidates.length > 32
        ) {
          return;
        }
        const parsed = raw.extraCandidates.map(readExtraCandidateInput);
        if (!parsed.every((item) => item !== undefined)) return;
        extraCandidates = parsed;
      }
      const result: CompilerRequests = {
        operation: "compiler.compile",
        ...scope,
        objective: raw.objective,
        destinationId: raw.destinationId,
        budgetBytes: raw.budgetBytes,
      };
      if (raw.policyVersion !== undefined) {
        result.policyVersion = raw.policyVersion;
      }
      if (raw.strategyVersion !== undefined) {
        result.strategyVersion = raw.strategyVersion;
      }
      if (raw.contextId !== undefined) result.contextId = raw.contextId;
      if (selection !== undefined) result.selection = selection;
      if (projectPreferences !== undefined) {
        result.projectPreferences = projectPreferences;
      }
      if (personalPreferences !== undefined) {
        result.personalPreferences = personalPreferences;
      }
      if (extraCandidates !== undefined) {
        result.extraCandidates = extraCandidates;
      }
      return result;
    }
    case "compiler.grantIssue": {
      if (
        !isSlugId(raw.sessionId) ||
        !isProjectId(raw.manifestDigest) ||
        !isSlugId(raw.policyVersion) ||
        !isSlugId(raw.destinationId) ||
        !Array.isArray(raw.allowedOperations) ||
        raw.allowedOperations.length === 0 ||
        !raw.allowedOperations.every((op) =>
          oneOf(sessionGrantOperations, op),
        ) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      if (
        raw.ttlMs !== undefined &&
        (!isCount(raw.ttlMs) ||
          raw.ttlMs < sessionGrantMinTtlMs ||
          raw.ttlMs > sessionGrantMaxTtlMs)
      ) {
        return;
      }
      if (
        raw.unconfinedConfirmed !== undefined &&
        typeof raw.unconfinedConfirmed !== "boolean"
      ) {
        return;
      }
      const result: CompilerRequests = {
        operation: "compiler.grantIssue",
        ...scope,
        sessionId: raw.sessionId,
        manifestDigest: raw.manifestDigest,
        policyVersion: raw.policyVersion,
        destinationId: raw.destinationId,
        allowedOperations: raw.allowedOperations,
        humanConfirmed: raw.humanConfirmed,
      };
      if (raw.ttlMs !== undefined) result.ttlMs = raw.ttlMs;
      if (raw.unconfinedConfirmed !== undefined) {
        result.unconfinedConfirmed = raw.unconfinedConfirmed;
      }
      return result;
    }
    case "compiler.grantList": {
      if (
        raw.manifestDigest !== undefined &&
        !isProjectId(raw.manifestDigest)
      ) {
        return;
      }
      return raw.manifestDigest !== undefined
        ? {
            operation: "compiler.grantList",
            ...scope,
            manifestDigest: raw.manifestDigest,
          }
        : { operation: "compiler.grantList", ...scope };
    }
    case "compiler.grantRevoke": {
      if (!isRequestId(raw.grantId) || !boundedNonEmpty(raw.reason, 256)) {
        return;
      }
      return {
        operation: "compiler.grantRevoke",
        ...scope,
        grantId: raw.grantId,
        reason: raw.reason,
      };
    }
    case "compiler.packageExport": {
      if (
        !isRequestId(raw.grantId) ||
        !isSlugId(raw.sessionId) ||
        !isProjectId(raw.manifestDigest) ||
        !isSlugId(raw.policyVersion) ||
        !isSlugId(raw.destinationId) ||
        typeof raw.includeHandoff !== "boolean"
      ) {
        return;
      }
      return {
        operation: "compiler.packageExport",
        ...scope,
        grantId: raw.grantId,
        sessionId: raw.sessionId,
        manifestDigest: raw.manifestDigest,
        policyVersion: raw.policyVersion,
        destinationId: raw.destinationId,
        includeHandoff: raw.includeHandoff,
      };
    }
    case "compiler.handoffImport": {
      if (
        !isSlugId(raw.destinationId) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      if (raw.contextPackage === undefined && raw.handoff === undefined) {
        return;
      }
      if (raw.contextPackage !== undefined && !isRecord(raw.contextPackage)) {
        return;
      }
      if (raw.handoff !== undefined && !isRecord(raw.handoff)) {
        return;
      }
      const result: CompilerRequests = {
        operation: "compiler.handoffImport",
        ...scope,
        destinationId: raw.destinationId,
        humanConfirmed: raw.humanConfirmed,
      };
      if (raw.contextPackage !== undefined) {
        result.contextPackage = raw.contextPackage as ContextPackage;
      }
      if (raw.handoff !== undefined) {
        result.handoff = raw.handoff as HandoffArtifact;
      }
      return result;
    }
    case "compiler.mcpCall": {
      if (
        !isRequestId(raw.grantId) ||
        !isSlugId(raw.sessionId) ||
        !isProjectId(raw.manifestDigest) ||
        !isSlugId(raw.policyVersion) ||
        !isSlugId(raw.destinationId) ||
        !oneOf(["summary", "search", "read"], raw.method)
      ) {
        return;
      }
      if (raw.query !== undefined && !boundedNonEmpty(raw.query, 256)) {
        return;
      }
      if (raw.cursor !== undefined && !isCount(raw.cursor)) return;
      if (
        raw.limit !== undefined &&
        (!isCount(raw.limit) || raw.limit < 1 || raw.limit > mcpSearchPageSize)
      ) {
        return;
      }
      if (raw.opaqueRef !== undefined && !boundedNonEmpty(raw.opaqueRef, 512)) {
        return;
      }
      const result: CompilerRequests = {
        operation: "compiler.mcpCall",
        ...scope,
        grantId: raw.grantId,
        sessionId: raw.sessionId,
        manifestDigest: raw.manifestDigest,
        policyVersion: raw.policyVersion,
        destinationId: raw.destinationId,
        method: raw.method,
      };
      if (raw.query !== undefined) result.query = raw.query;
      if (raw.cursor !== undefined) result.cursor = raw.cursor;
      if (raw.limit !== undefined) result.limit = raw.limit;
      if (raw.opaqueRef !== undefined) result.opaqueRef = raw.opaqueRef;
      return result;
    }
    case "compiler.queryRun": {
      if (
        !isRequestId(raw.grantId) ||
        !isSlugId(raw.sessionId) ||
        !isProjectId(raw.manifestDigest) ||
        !isSlugId(raw.policyVersion) ||
        !isSlugId(raw.destinationId) ||
        !oneOf(f2Channels, raw.channel)
      ) {
        return;
      }
      if (raw.mode !== undefined && !oneOf(codexModes, raw.mode)) return;
      if (
        raw.unconfinedConfirmed !== undefined &&
        typeof raw.unconfinedConfirmed !== "boolean"
      ) {
        return;
      }
      const result: CompilerRequests = {
        operation: "compiler.queryRun",
        ...scope,
        grantId: raw.grantId,
        sessionId: raw.sessionId,
        manifestDigest: raw.manifestDigest,
        policyVersion: raw.policyVersion,
        destinationId: raw.destinationId,
        channel: raw.channel,
      };
      if (raw.mode !== undefined) result.mode = raw.mode;
      if (raw.unconfinedConfirmed !== undefined) {
        result.unconfinedConfirmed = raw.unconfinedConfirmed;
      }
      return result;
    }
    case "compiler.auditList": {
      if (
        raw.manifestDigest !== undefined &&
        !isProjectId(raw.manifestDigest)
      ) {
        return;
      }
      return raw.manifestDigest !== undefined
        ? {
            operation: "compiler.auditList",
            ...scope,
            manifestDigest: raw.manifestDigest,
          }
        : { operation: "compiler.auditList", ...scope };
    }
    case "compiler.auditReview": {
      if (
        !isRequestId(raw.auditId) ||
        !oneOf(["approved", "rejected", "needs_followup"], raw.status) ||
        !boundedNonEmpty(raw.reviewer, 128) ||
        !boundedNonEmpty(raw.note, 1024) ||
        typeof raw.humanConfirmed !== "boolean"
      ) {
        return;
      }
      return {
        operation: "compiler.auditReview",
        ...scope,
        auditId: raw.auditId,
        status: raw.status,
        reviewer: raw.reviewer,
        note: raw.note,
        humanConfirmed: raw.humanConfirmed,
      };
    }
  }
}

export function isCompilerResult(
  operation: keyof CompilerResults,
  value: unknown,
): boolean {
  if (!isRecord(value) || !isIdentityScope(value.scope)) return false;
  const scope = value.scope;
  switch (operation) {
    case "compiler.compile":
      return isCompiledContextPreview(value);
    case "compiler.grantIssue":
    case "compiler.grantRevoke":
      return isSessionGrantRecord(value);
    case "compiler.grantList":
      return (
        Array.isArray(value.items) &&
        value.items.every(
          (item) => isSessionGrantRecord(item) && sameScope(item.scope, scope),
        )
      );
    case "compiler.packageExport":
      return (
        isRequestId(value.grantId) &&
        isContextPackage(value.contextPackage) &&
        sameScope(value.contextPackage.publicManifest.scope, scope) &&
        (value.handoff === null ||
          (isHandoffArtifact(value.handoff) &&
            value.handoff.sourceProjectId === scope.projectId &&
            value.handoff.manifestDigest ===
              value.contextPackage.manifestDigest))
      );
    case "compiler.handoffImport":
      return (
        oneOf(
          [
            "accepted_requires_grant",
            "rejected_scope_mismatch",
            "rejected_destination",
            "rejected_integrity",
          ],
          value.evaluation,
        ) &&
        value.requiresNewGrant === true &&
        (value.sourceProjectId === null ||
          isProjectId(value.sourceProjectId)) &&
        (value.manifestDigest === null || isProjectId(value.manifestDigest)) &&
        isDestinationPolicy(value.destination) &&
        boundedNonEmpty(value.reason, 512) &&
        isCount(value.selectedRefCount) &&
        Array.isArray(value.pendingConflicts) &&
        value.pendingConflicts.every(isCompilerConflict)
      );
    case "compiler.mcpCall":
      return (
        isRequestId(value.grantId) &&
        isSlugId(value.sessionId) &&
        oneOf(["summary", "search", "read"], value.method) &&
        isProjectId(value.manifestDigest) &&
        isSlugId(value.policyVersion) &&
        isSlugId(value.destinationId) &&
        isRecord(value.payload)
      );
    case "compiler.queryRun":
    case "compiler.auditReview":
      return isAuditedQueryRecord(value);
    case "compiler.auditList":
      return (
        Array.isArray(value.items) &&
        value.items.every(
          (item) => isAuditedQueryRecord(item) && sameScope(item.scope, scope),
        )
      );
  }
}
