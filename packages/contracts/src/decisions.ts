import { isProjectId, isRecord, isRequestId } from "./index.ts";
import {
  isContextDate,
  isContextPath,
  omissionReasons,
  type OmissionReason,
} from "./context.ts";
import {
  isIdentityScope,
  isResumeDecision,
  isResumeEvidence,
  type IdentityScope,
  type ResumeDecision,
  type ResumeEvidence,
} from "./resume.ts";

export type EvidenceExcerpt = {
  firstLine: number;
  lastLine: number;
  splitLine: boolean;
  text: string;
  bytesLength: number;
  sha256: string;
};

export type ResolvedEvidence = {
  scope: IdentityScope;
  evidence: ResumeEvidence;
  excerpt: EvidenceExcerpt | null;
  snapshotStatus: "complete" | "partial" | "invalidated" | null;
  omittedPaths: { path: string; reason: OmissionReason }[];
  reindexedPreserved: boolean;
};

export type DecisionEvidenceInput = {
  contextId: string;
  path: string;
  sha256: string;
  chunk: number;
} | null;

export type DecisionRecordInput = IdentityScope & {
  requestId: string;
  assertionId: string | null;
  expectedRevision: number;
  content: string;
  author: string;
  reason: string;
  humanConfirmed: boolean;
  promoteCanonical?: boolean;
  effectiveAt?: string;
  evidence: DecisionEvidenceInput;
};

export type DecisionListResult = {
  scope: IdentityScope;
  active: ResumeDecision | null;
  items: ResumeDecision[];
};

export type DecisionDetailResult = {
  scope: IdentityScope;
  assertionId: string;
  revisions: ResumeDecision[];
};

export type DecisionPurgeInput = IdentityScope & {
  assertionId: string;
  expectedRevision: number;
  confirmedScope: boolean;
  reason: string;
};

export type DecisionPurgeReceipt = {
  scope: IdentityScope;
  assertionId: string;
  purgedRevision: number;
  status: "purged" | "already_purged";
  purgedAt: string;
  removed: {
    revisions: number;
    evidenceLinks: number;
    cacheEntriesCleared: number;
  };
  preservedSharedBlobs: boolean;
  tombstoneId: string;
  scopeBoundary: "f1_local_decisions_only";
};

export type EvidencePresentComparison = {
  scope: IdentityScope;
  historical: ResolvedEvidence;
  present: {
    state: "available" | "unavailable" | "blocked_by_gap";
    origin: "working_tree";
    checkedAt: string;
    path: string;
    sha256: string | null;
    text: string | null;
  };
  comparison: "matches" | "differs" | "unavailable";
};

export type DecisionRequests =
  | (IdentityScope & {
      operation: "decision.evidenceResolve";
      contextId: string;
      path: string;
      sha256: string;
      chunk: number;
    })
  | (IdentityScope & {
      operation: "decision.comparePresent";
      contextId: string;
      path: string;
      sha256: string;
      chunk: number;
    })
  | ({ operation: "decision.record" } & DecisionRecordInput)
  | (IdentityScope & { operation: "decision.list" })
  | (IdentityScope & { operation: "decision.get"; assertionId: string })
  | ({ operation: "decision.purge" } & DecisionPurgeInput);

export type DecisionResults = {
  "decision.evidenceResolve": ResolvedEvidence;
  "decision.comparePresent": EvidencePresentComparison;
  "decision.record": ResumeDecision;
  "decision.list": DecisionListResult;
  "decision.get": DecisionDetailResult;
  "decision.purge": DecisionPurgeReceipt;
};

const snapshotStatuses = ["complete", "partial", "invalidated"] as const;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function boundedNonEmpty(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !value.includes("\0")
  );
}

function isEvidenceInputRef(
  value: unknown,
): value is Exclude<DecisionEvidenceInput, null> {
  return (
    isRecord(value) &&
    isProjectId(value.contextId) &&
    isContextPath(value.path) &&
    isProjectId(value.sha256) &&
    isCount(value.chunk)
  );
}

function isExcerpt(value: unknown): value is EvidenceExcerpt {
  return (
    isRecord(value) &&
    isCount(value.firstLine) &&
    value.firstLine > 0 &&
    isCount(value.lastLine) &&
    value.lastLine >= value.firstLine &&
    typeof value.splitLine === "boolean" &&
    typeof value.text === "string" &&
    !value.text.includes("\0") &&
    isCount(value.bytesLength) &&
    isProjectId(value.sha256)
  );
}

export function parseDecisionRequest(
  value: Record<string, unknown>,
): DecisionRequests | undefined {
  if (!isIdentityScope(value)) return;
  const scope: IdentityScope = {
    projectId: value.projectId,
    bindingId: value.bindingId,
    worktreeId: value.worktreeId,
  };
  const raw = value as Record<string, unknown>;
  const operation = raw.operation;
  switch (operation) {
    case "decision.evidenceResolve":
    case "decision.comparePresent":
      if (isEvidenceInputRef(raw)) {
        return {
          operation,
          ...scope,
          contextId: raw.contextId,
          path: raw.path,
          sha256: raw.sha256,
          chunk: raw.chunk,
        };
      }
      break;
    case "decision.record": {
      const {
        requestId,
        assertionId,
        expectedRevision,
        content,
        author,
        reason,
        humanConfirmed,
        promoteCanonical,
        effectiveAt,
        evidence,
      } = raw;
      if (
        !isRequestId(requestId) ||
        !(assertionId === null || isProjectId(assertionId)) ||
        !isCount(expectedRevision) ||
        !boundedNonEmpty(content, 8_192) ||
        !boundedNonEmpty(author, 128) ||
        !boundedNonEmpty(reason, 512) ||
        typeof humanConfirmed !== "boolean" ||
        !(
          promoteCanonical === undefined ||
          typeof promoteCanonical === "boolean"
        ) ||
        !(
          effectiveAt === undefined ||
          (typeof effectiveAt === "string" && isContextDate(effectiveAt))
        ) ||
        !(evidence === null || isEvidenceInputRef(evidence))
      ) {
        return;
      }
      const parsed: DecisionRequests = {
        operation: "decision.record",
        ...scope,
        requestId,
        assertionId,
        expectedRevision,
        content,
        author,
        reason,
        humanConfirmed,
        evidence,
      };
      if (promoteCanonical !== undefined) {
        parsed.promoteCanonical = promoteCanonical;
      }
      if (effectiveAt !== undefined) {
        parsed.effectiveAt = effectiveAt;
      }
      return parsed;
    }
    case "decision.list":
      return { operation: "decision.list", ...scope };
    case "decision.get":
      if (isProjectId(raw.assertionId)) {
        return {
          operation: "decision.get",
          ...scope,
          assertionId: raw.assertionId,
        };
      }
      break;
    case "decision.purge": {
      const { assertionId, expectedRevision, confirmedScope, reason } = raw;
      if (
        isProjectId(assertionId) &&
        isCount(expectedRevision) &&
        expectedRevision >= 1 &&
        typeof confirmedScope === "boolean" &&
        boundedNonEmpty(reason, 512)
      ) {
        return {
          operation: "decision.purge",
          ...scope,
          assertionId,
          expectedRevision,
          confirmedScope,
          reason,
        };
      }
      break;
    }
  }
}

export function isDecisionResult(
  operation: keyof DecisionResults,
  value: unknown,
): boolean {
  if (!isRecord(value)) return false;
  switch (operation) {
    case "decision.evidenceResolve": {
      const scope = value.scope;
      if (!isIdentityScope(scope)) return false;
      const evidence = value.evidence;
      if (!isResumeEvidence(evidence, scope.projectId)) return false;
      const excerptOk =
        evidence.state === "verified"
          ? isExcerpt(value.excerpt)
          : value.excerpt === null;
      const statusOk =
        value.snapshotStatus === null ||
        snapshotStatuses.some((item) => item === value.snapshotStatus);
      const omittedOk =
        Array.isArray(value.omittedPaths) &&
        value.omittedPaths.every(
          (item: unknown) =>
            isRecord(item) &&
            isContextPath(item.path) &&
            omissionReasons.some((reason) => reason === item.reason),
        );
      return (
        excerptOk &&
        statusOk &&
        omittedOk &&
        typeof value.reindexedPreserved === "boolean"
      );
    }
    case "decision.comparePresent": {
      const scope = value.scope;
      if (!isIdentityScope(scope)) return false;
      if (!isDecisionResult("decision.evidenceResolve", value.historical)) {
        return false;
      }
      const historical = value.historical as ResolvedEvidence;
      if (
        historical.scope.projectId !== scope.projectId ||
        historical.scope.bindingId !== scope.bindingId ||
        historical.scope.worktreeId !== scope.worktreeId
      ) {
        return false;
      }
      const present = value.present;
      if (!isRecord(present)) return false;
      const presentCommonOk =
        present.origin === "working_tree" &&
        typeof present.checkedAt === "string" &&
        isContextDate(present.checkedAt) &&
        isContextPath(present.path);
      if (!presentCommonOk) return false;
      if (historical.evidence.state !== "verified") {
        return (
          present.state === "blocked_by_gap" &&
          present.sha256 === null &&
          present.text === null &&
          value.comparison === "unavailable"
        );
      }
      if (present.state === "available") {
        return (
          isProjectId(present.sha256) &&
          typeof present.text === "string" &&
          !present.text.includes("\0") &&
          (value.comparison === "matches" || value.comparison === "differs")
        );
      }
      if (present.state === "unavailable") {
        return (
          present.sha256 === null &&
          present.text === null &&
          value.comparison === "unavailable"
        );
      }
      return false;
    }
    case "decision.record":
      return (
        isProjectId(value.projectId) && isResumeDecision(value, value.projectId)
      );
    case "decision.list": {
      const scope = value.scope;
      if (!isIdentityScope(scope)) return false;
      return (
        (value.active === null ||
          isResumeDecision(value.active, scope.projectId)) &&
        Array.isArray(value.items) &&
        value.items.every((item) => isResumeDecision(item, scope.projectId))
      );
    }
    case "decision.get": {
      const scope = value.scope;
      const assertionId = value.assertionId;
      if (!isIdentityScope(scope) || !isProjectId(assertionId)) return false;
      return (
        Array.isArray(value.revisions) &&
        value.revisions.every(
          (item) =>
            isResumeDecision(item, scope.projectId) &&
            item.assertionId === assertionId,
        )
      );
    }
    case "decision.purge": {
      const scope = value.scope;
      if (!isIdentityScope(scope)) return false;
      return (
        isProjectId(value.assertionId) &&
        isCount(value.purgedRevision) &&
        value.purgedRevision > 0 &&
        (value.status === "purged" || value.status === "already_purged") &&
        isContextDate(value.purgedAt) &&
        isRecord(value.removed) &&
        isCount(value.removed.revisions) &&
        isCount(value.removed.evidenceLinks) &&
        isCount(value.removed.cacheEntriesCleared) &&
        typeof value.preservedSharedBlobs === "boolean" &&
        isProjectId(value.tombstoneId) &&
        value.scopeBoundary === "f1_local_decisions_only"
      );
    }
  }
}
