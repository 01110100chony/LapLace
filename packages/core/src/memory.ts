import {
  defaultCompilerPolicyVersion,
  type ClaimRevision,
  type ConflictPolarity,
  type EvidenceAttachmentRef,
  type ExportCandidateInput,
  type ExportExceptionRecord,
  type ExportItemClassification,
  type ExportSecretFinding,
  type IdentityScope,
  type MemoryAuthority,
  type MemoryVisibility,
  type RelationRecord,
  type TimelineConflictEntry,
  type TimelineSignalEntry,
  type TimelineSignalKind,
} from "@laplace/contracts";
import { resolveDestinationPolicy } from "./context-compiler.ts";
import { canonicalJson, sha256Hex, utf8ByteLength } from "./hash.ts";

function ts(value: string): number {
  return Date.parse(value);
}

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

export function isKnownAt(revision: ClaimRevision, knownAt: string): boolean {
  const k = ts(knownAt);
  const from = ts(revision.knownFrom);
  if (from > k) return false;
  if (revision.knownTo === null) return true;
  return k < ts(revision.knownTo);
}

export function isValidAt(revision: ClaimRevision, validAt: string): boolean {
  const v = ts(validAt);
  const from = ts(revision.validFrom);
  if (from > v) return false;
  if (revision.validTo === null) return true;
  return v < ts(revision.validTo);
}

function intervalOverlaps(
  leftFrom: string,
  leftTo: string | null,
  rightFrom: string,
  rightTo: string | null,
): { start: string; end: string | null } | null {
  const s = ts(leftFrom) >= ts(rightFrom) ? leftFrom : rightFrom;
  let e: string | null;
  if (leftTo === null) {
    e = rightTo;
  } else if (rightTo === null) {
    e = leftTo;
  } else {
    e = ts(leftTo) <= ts(rightTo) ? leftTo : rightTo;
  }
  if (e !== null && ts(s) >= ts(e)) return null;
  return { start: s, end: e };
}

export type PartialCorrectionSegment = {
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
  knownTo: null;
  supersedesRevisionId: string;
  evidenceRef: EvidenceAttachmentRef | null;
  recordedAt: string;
};

export type PartialCorrectionPlan = {
  closedRevisionIds: string[];
  knownTo: string;
  newSegments: PartialCorrectionSegment[];
};

/**
 * Splits active known revisions over [correctFrom, correctTo) into immutable
 * replacement segments without altering prior knowledge state (< knownAt).
 */
export function applyPartialCorrection(params: {
  activeRevisions: readonly ClaimRevision[];
  correctFrom: string;
  correctTo: string | null;
  knownAt: string;
  nextTxSeq: number;
  nextStartSegmentSeq: number;
  replacement: {
    content: string;
    author: string;
    reason: string;
    authority?: MemoryAuthority;
    visibility?: MemoryVisibility;
    conflictKey?: string | null;
    conflictPolarity?: ConflictPolarity | null;
    evidenceRef: EvidenceAttachmentRef | null;
    recordedAt: string;
  };
}): PartialCorrectionPlan {
  const sorted = [...params.activeRevisions].sort((a, b) =>
    compareAsc(a.validFrom, b.validFrom),
  );
  const corrStart = ts(params.correctFrom);
  const corrEnd = params.correctTo === null ? null : ts(params.correctTo);
  if (corrEnd !== null && corrStart >= corrEnd) {
    throw new Error("invalid_correction_interval");
  }

  const knownAtTs = ts(params.knownAt);
  const closedRevisionIds: string[] = [];
  const newSegments: PartialCorrectionSegment[] = [];
  let seq = params.nextStartSegmentSeq;

  const overlapping: ClaimRevision[] = [];
  for (const rev of sorted) {
    if (rev.knownTo !== null) continue;
    if (ts(rev.knownFrom) > knownAtTs) {
      throw new Error("bitemporal_clock_regression");
    }
    const overlap = intervalOverlaps(
      rev.validFrom,
      rev.validTo,
      params.correctFrom,
      params.correctTo,
    );
    if (overlap) {
      overlapping.push(rev);
    }
  }

  if (overlapping.length === 0) {
    throw new Error("no_overlapping_revision");
  }

  for (const rev of overlapping) {
    closedRevisionIds.push(rev.revisionId);
    const revStart = ts(rev.validFrom);
    const revEnd = rev.validTo === null ? null : ts(rev.validTo);

    // Left residual: strictly before correctFrom
    if (revStart < corrStart) {
      newSegments.push({
        segmentSeq: seq++,
        txSeq: params.nextTxSeq,
        content: rev.content,
        author: rev.author,
        reason: rev.reason,
        authority: rev.authority,
        visibility: rev.visibility,
        conflictKey: rev.conflictKey,
        conflictPolarity: rev.conflictPolarity,
        validFrom: rev.validFrom,
        validTo: params.correctFrom,
        knownFrom: params.knownAt,
        knownTo: null,
        supersedesRevisionId: rev.revisionId,
        evidenceRef: rev.evidenceRef,
        recordedAt: rev.recordedAt,
      });
    }

    // Right residual: strictly after correctTo (only possible if correctTo is bounded)
    if (corrEnd !== null && (revEnd === null || corrEnd < revEnd)) {
      newSegments.push({
        segmentSeq: seq++,
        txSeq: params.nextTxSeq,
        content: rev.content,
        author: rev.author,
        reason: rev.reason,
        authority: rev.authority,
        visibility: rev.visibility,
        conflictKey: rev.conflictKey,
        conflictPolarity: rev.conflictPolarity,
        validFrom: params.correctTo!,
        validTo: rev.validTo,
        knownFrom: params.knownAt,
        knownTo: null,
        supersedesRevisionId: rev.revisionId,
        evidenceRef: rev.evidenceRef,
        recordedAt: rev.recordedAt,
      });
    }
  }

  const baseAnchor = overlapping[0]!;
  newSegments.push({
    segmentSeq: seq,
    txSeq: params.nextTxSeq,
    content: params.replacement.content,
    author: params.replacement.author,
    reason: params.replacement.reason,
    authority: params.replacement.authority ?? baseAnchor.authority,
    visibility: params.replacement.visibility ?? baseAnchor.visibility,
    conflictKey:
      params.replacement.conflictKey !== undefined
        ? params.replacement.conflictKey
        : baseAnchor.conflictKey,
    conflictPolarity:
      params.replacement.conflictPolarity !== undefined
        ? params.replacement.conflictPolarity
        : baseAnchor.conflictPolarity,
    validFrom: params.correctFrom,
    validTo: params.correctTo,
    knownFrom: params.knownAt,
    knownTo: null,
    supersedesRevisionId: baseAnchor.revisionId,
    evidenceRef: params.replacement.evidenceRef,
    recordedAt: params.replacement.recordedAt,
  });

  newSegments.sort((a, b) => compareAsc(a.validFrom, b.validFrom));
  return {
    closedRevisionIds,
    knownTo: params.knownAt,
    newSegments,
  };
}

export function projectBitemporalState(
  revisions: readonly ClaimRevision[],
  query: { knownAt: string; validAt: string | null },
): {
  visible: ClaimRevision[];
  conflicts: TimelineConflictEntry[];
} {
  const filtered = revisions
    .filter((rev) => {
      if (!isKnownAt(rev, query.knownAt)) return false;
      if (query.validAt !== null && !isValidAt(rev, query.validAt))
        return false;
      return true;
    })
    .sort((a, b) => {
      const byClaim = compareAsc(a.claimId, b.claimId);
      if (byClaim !== 0) return byClaim;
      const byValid = compareAsc(a.validFrom, b.validFrom);
      if (byValid !== 0) return byValid;
      if (a.txSeq !== b.txSeq) return a.txSeq - b.txSeq;
      return a.segmentSeq - b.segmentSeq;
    });

  const conflicts: TimelineConflictEntry[] = [];
  const byKey = new Map<string, ClaimRevision[]>();
  for (const rev of filtered) {
    if (!rev.conflictKey) continue;
    const list = byKey.get(rev.conflictKey) ?? [];
    list.push(rev);
    byKey.set(rev.conflictKey, list);
  }

  for (const [key, list] of [...byKey.entries()].sort(([a], [b]) =>
    compareAsc(a, b),
  )) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const left = list[i]!;
        const right = list[j]!;
        const overlap = intervalOverlaps(
          left.validFrom,
          left.validTo,
          right.validFrom,
          right.validTo,
        );
        if (!overlap) continue;
        const polarityClash =
          left.conflictPolarity !== null &&
          right.conflictPolarity !== null &&
          left.conflictPolarity !== right.conflictPolarity;
        const contentClash = left.content !== right.content;
        if (polarityClash || contentClash) {
          conflicts.push({
            conflictKey: key,
            kind: "bitemporal_contradiction",
            summary: `Conflito material na chave "${key}" para o intervalo [${overlap.start}, ${overlap.end ?? "∞"}).`,
            revisionIds: [left.revisionId, right.revisionId].sort(compareAsc),
            validOverlapFrom: overlap.start,
            validOverlapTo: overlap.end,
          });
        }
      }
    }
  }

  return { visible: filtered, conflicts };
}

export function projectKgraphTimeline(params: {
  scope: IdentityScope;
  edges: readonly RelationRecord[];
  signals: readonly TimelineSignalEntry[];
  knownAt: string;
  signalKinds?: readonly TimelineSignalKind[];
}): {
  edges: RelationRecord[];
  signals: TimelineSignalEntry[];
} {
  const kindSet = params.signalKinds
    ? new Set<TimelineSignalKind>(params.signalKinds)
    : null;
  const knownAtTs = ts(params.knownAt);

  const edges = params.edges
    .filter(
      (edge) =>
        sameScope(edge.scope, params.scope) &&
        ts(edge.knownAt) <= knownAtTs &&
        (!kindSet || kindSet.has(edge.signalKind)),
    )
    .sort((a, b) => {
      const byTime = compareAsc(a.knownAt, b.knownAt);
      return byTime !== 0 ? byTime : compareAsc(a.relationId, b.relationId);
    });

  const signals = params.signals
    .filter(
      (sig) =>
        ts(sig.recordedAt) <= knownAtTs &&
        (!kindSet || kindSet.has(sig.signalKind)),
    )
    .sort((a, b) => {
      const byTime = compareAsc(a.recordedAt, b.recordedAt);
      return byTime !== 0 ? byTime : compareAsc(a.signalId, b.signalId);
    });

  return { edges, signals };
}

const secretRules: readonly {
  pattern: string;
  regex: RegExp;
  severity: "high" | "medium";
}[] = [
  {
    pattern: "private_key_block",
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
    severity: "high",
  },
  {
    pattern: "api_key_token",
    regex: /\b(?:sk-[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/,
    severity: "high",
  },
  {
    pattern: "credential_assignment",
    regex: /(?:password|secret|token|api_key)\s*[:=]\s*["']?[^\s"']{6,}/i,
    severity: "medium",
  },
];

export function scanExportItems(
  items: readonly ExportCandidateInput[],
): ExportSecretFinding[] {
  const findings: ExportSecretFinding[] = [];
  for (const item of items) {
    for (const rule of secretRules) {
      if (rule.regex.test(item.content)) {
        findings.push({
          itemId: item.itemId,
          pattern: rule.pattern,
          severity: rule.severity,
        });
      }
    }
  }
  return findings.sort((a, b) => {
    const byItem = compareAsc(a.itemId, b.itemId);
    return byItem !== 0 ? byItem : compareAsc(a.pattern, b.pattern);
  });
}

export function evaluateExportGovernance(params: {
  scope: IdentityScope;
  destinationId: string;
  policyVersion?: string;
  items: readonly ExportCandidateInput[];
  exception?: ExportExceptionRecord | null;
}) {
  const policyVersion = params.policyVersion ?? defaultCompilerPolicyVersion;
  const destination = resolveDestinationPolicy(params.destinationId);
  const findings = scanExportItems(params.items);

  const sortedItems = [...params.items].sort((a, b) =>
    compareAsc(a.itemId, b.itemId),
  );
  const classifications: ExportItemClassification[] = [];
  let hasDbOnly = false;
  let hasPolicyBlocked = false;

  for (const item of sortedItems) {
    const digest = sha256Hex(item.content);
    const bytes = utf8ByteLength(item.content);
    const finding = findings.find((f) => f.itemId === item.itemId);
    let denyReason: string | null = null;
    if (item.visibility === "db_only") {
      hasDbOnly = true;
      denyReason = "db_only_never_exportable";
    } else if (
      item.visibility === "local_only" &&
      !destination.allowsLocalOnly
    ) {
      hasPolicyBlocked = true;
      denyReason = "local_only_restricted";
    } else if (finding) {
      hasPolicyBlocked = true;
      denyReason = `scanner_${finding.pattern}`;
    } else if (!destination.known) {
      hasPolicyBlocked = true;
      denyReason = "destination_unknown";
    } else if (!destination.deliveryAllowed && !destination.allowsLocalOnly) {
      hasPolicyBlocked = true;
      denyReason = destination.blockReason ?? "destination_denied";
    }

    classifications.push({
      itemId: item.itemId,
      title: item.title,
      visibility: item.visibility,
      contentDigest: digest,
      bytes,
      eligible: denyReason === null,
      denyReason,
    });
  }

  const bundleDigest = sha256Hex(
    canonicalJson({
      scope: params.scope,
      destinationId: params.destinationId,
      policyVersion,
      items: classifications.map((c) => ({
        itemId: c.itemId,
        visibility: c.visibility,
        contentDigest: c.contentDigest,
      })),
    }),
  );

  // Strongest-restriction-wins: db_only or unknown/unconfined destination cannot be overridden by exception.
  const hardDenied =
    hasDbOnly ||
    !destination.known ||
    (!destination.deliveryAllowed && !destination.allowsLocalOnly);

  const validException =
    !hardDenied &&
    params.exception !== undefined &&
    params.exception !== null &&
    sameScope(params.exception.scope, params.scope) &&
    params.exception.bundleDigest === bundleDigest &&
    params.exception.destinationId === params.destinationId &&
    params.exception.policyVersion === policyVersion;

  const eligible = !hardDenied && (!hasPolicyBlocked || validException);
  const requiresException = !hardDenied && hasPolicyBlocked && !validException;

  const reason = hasDbOnly
    ? "Exportação recusada: itens db_only não são elegíveis mesmo com exceção."
    : !destination.known
      ? `Destino desconhecido (${params.destinationId}) bloqueado.`
      : !destination.deliveryAllowed && !destination.allowsLocalOnly
        ? `Destino (${params.destinationId}) bloqueado pela política de confinamento.`
        : hasPolicyBlocked && !validException
          ? "Conteúdo sensível ou local_only detectado; exige exceção escopada válida."
          : validException
            ? "Elegível mediante exceção escopada verificada."
            : "Todos os itens elegíveis e livres de bloqueios.";

  return {
    scope: params.scope,
    destinationId: params.destinationId,
    policyVersion,
    bundleDigest,
    eligible,
    hardDenied,
    requiresException,
    findings,
    items: classifications,
    reason,
  };
}
