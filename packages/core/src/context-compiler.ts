import {
  compilerMaxItems,
  contextCompilerSchemaVersion,
  defaultCompilerPolicyVersion,
  defaultCompilerStrategyVersion,
  type CompiledContextPreview,
  type CompiledPublicManifest,
  type CompilerCandidateKind,
  type CompilerConflict,
  type CompilerLocalItem,
  type CompilerLocalOmission,
  type CompilerManifestStatus,
  type CompilerOmissionReason,
  type CompilerPublicAnchor,
  type CompilerPublicItem,
  type CompilerPublicOmission,
  type CompilerVisibility,
  type DestinationPolicy,
  type IdentityScope,
  type PrecedenceTier,
} from "@laplace/contracts";
import { canonicalJson, sha256Hex, utf8ByteLength } from "./hash.ts";

export const knownDestinations: readonly DestinationPolicy[] = [
  {
    id: "local_preview",
    label: "Preview local (offline)",
    known: true,
    executionMode: null,
    deliveryAllowed: false,
    allowsLocalOnly: true,
    blockReason: "local_only_destination",
  },
  {
    id: "codex_mock",
    label: "Codex Mock (desenvolvimento)",
    known: true,
    executionMode: "mock_development",
    deliveryAllowed: true,
    allowsLocalOnly: false,
    blockReason: null,
  },
  {
    id: "codex_cli_workspace",
    label: "Codex CLI (Workspace Dev — não isolado)",
    known: true,
    executionMode: "unconfined_workspace_development",
    deliveryAllowed: true,
    allowsLocalOnly: false,
    blockReason: null,
  },
  {
    id: "codex_cli_isolated",
    label: "Codex CLI (Isolado verificado — bloqueado até F4-M02)",
    known: true,
    executionMode: "verified_isolated",
    deliveryAllowed: false,
    allowsLocalOnly: false,
    blockReason: "confinement_unverified",
  },
];

export function resolveDestinationPolicy(
  destinationId: string,
): DestinationPolicy {
  const found = knownDestinations.find((item) => item.id === destinationId);
  if (found) return found;
  return {
    id: destinationId,
    label: `Destino desconhecido (${destinationId})`,
    known: false,
    executionMode: null,
    deliveryAllowed: false,
    allowsLocalOnly: false,
    blockReason: "destination_unknown",
  };
}

export type CompilerCandidate = {
  candidateId: string;
  scope: IdentityScope;
  kind: CompilerCandidateKind;
  tier: PrecedenceTier;
  mandatory: boolean;
  visibility: CompilerVisibility;
  version: string;
  title: string;
  text: string;
  capturedAt: string;
  rationale: string;
  anchor: CompilerPublicAnchor;
  conflictKey?: string;
  conflictPolarity?: "require" | "forbid";
  privateMetadata?: Record<string, string>;
  omissionHint?: CompilerOmissionReason;
};

export type CompileContextInput = {
  scope: IdentityScope;
  now: string;
  objective: string;
  destinationId: string;
  budgetBytes: number;
  policyVersion?: string;
  strategyVersion?: string;
  candidates: readonly CompilerCandidate[];
  blockingConflicts?: readonly CompilerConflict[];
};

export type AuthorizedContextPayload = {
  text: string;
  contentDigest: string;
  bytes: number;
  title: string;
  tier: PrecedenceTier;
  version: string;
  anchor: CompilerPublicAnchor;
};

export type CompiledContextResult = {
  preview: CompiledContextPreview;
  authorizedPayloads: Record<string, AuthorizedContextPayload>;
};

const tierRank: Record<PrecedenceTier, number> = {
  invariant_canonical: 0,
  project_preference: 1,
  personal_profile: 2,
};

const kindRank: Record<CompilerCandidateKind, number> = {
  decision: 0,
  evidence_excerpt: 1,
  context_source: 2,
  project_preference: 3,
  personal_profile: 4,
};

const nonDisclosableReasons = new Set<CompilerOmissionReason>([
  "cross_scope",
  "db_only_restricted",
  "policy_restricted",
  "snapshot_omission",
]);

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

type NormalizedCandidate = {
  candidateId: string;
  scope: IdentityScope;
  kind: CompilerCandidateKind;
  tier: PrecedenceTier;
  mandatory: boolean;
  visibility: CompilerVisibility;
  version: string;
  title: string;
  text: string;
  bytes: number;
  contentDigest: string;
  capturedAt: string;
  rationale: string;
  anchor: CompilerPublicAnchor;
  conflictKey?: string;
  conflictPolarity?: "require" | "forbid";
  omissionHint?: CompilerOmissionReason;
};

function sortCandidates(
  candidates: readonly NormalizedCandidate[],
): NormalizedCandidate[] {
  return [...candidates].sort((a, b) => {
    const byTier = tierRank[a.tier] - tierRank[b.tier];
    if (byTier !== 0) return byTier;

    const aMandatory = a.mandatory ? 0 : 1;
    const bMandatory = b.mandatory ? 0 : 1;
    if (aMandatory !== bMandatory) return aMandatory - bMandatory;

    const byKind = kindRank[a.kind] - kindRank[b.kind];
    if (byKind !== 0) return byKind;

    const byDigest = compareAsc(a.contentDigest, b.contentDigest);
    if (byDigest !== 0) return byDigest;

    const byVersion = compareAsc(a.version, b.version);
    if (byVersion !== 0) return byVersion;

    return compareAsc(a.candidateId, b.candidateId);
  });
}

function summarizeOmissions(
  localOmissions: readonly CompilerLocalOmission[],
): CompilerPublicOmission[] {
  const counts = new Map<CompilerOmissionReason, number>();
  for (const omission of localOmissions) {
    counts.set(omission.reason, (counts.get(omission.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => compareAsc(a, b))
    .map(([reason, count]) => ({
      reason,
      count,
      disclosable: !nonDisclosableReasons.has(reason),
    }));
}

function dedupeAndSortConflicts(
  conflicts: readonly CompilerConflict[],
): CompilerConflict[] {
  const seen = new Map<string, CompilerConflict>();
  for (const conflict of conflicts) {
    const related = conflict.relatedRefs
      ? [...conflict.relatedRefs].sort(compareAsc)
      : undefined;
    const normalized: CompilerConflict = related
      ? { ...conflict, relatedRefs: related }
      : {
          kind: conflict.kind,
          blocking: conflict.blocking,
          summary: conflict.summary,
          detectedAt: conflict.detectedAt,
        };
    const key = `${normalized.kind}::${normalized.blocking}::${normalized.summary}::${(related ?? []).join(",")}`;
    if (!seen.has(key)) seen.set(key, normalized);
  }
  return [...seen.values()].sort((a, b) => {
    const byKind = compareAsc(a.kind, b.kind);
    if (byKind !== 0) return byKind;
    return compareAsc(a.summary, b.summary);
  });
}

function buildOpaqueRef(params: {
  scope: IdentityScope;
  destinationId: string;
  policyVersion: string;
  strategyVersion: string;
  tier: PrecedenceTier;
  version: string;
  contentDigest: string;
  ordinal: number;
}): string {
  const digest = sha256Hex(
    canonicalJson({
      projectId: params.scope.projectId,
      bindingId: params.scope.bindingId,
      worktreeId: params.scope.worktreeId,
      destinationId: params.destinationId,
      policyVersion: params.policyVersion,
      strategyVersion: params.strategyVersion,
      tier: params.tier,
      version: params.version,
      contentDigest: params.contentDigest,
      ordinal: params.ordinal,
    }),
  );
  return `ref-${digest.slice(0, 16)}`;
}

export function compileContext(
  input: CompileContextInput,
): CompiledContextResult {
  const policyVersion = input.policyVersion ?? defaultCompilerPolicyVersion;
  const strategyVersion =
    input.strategyVersion ?? defaultCompilerStrategyVersion;
  const destination = resolveDestinationPolicy(input.destinationId);

  // Strip privateMetadata immediately so it can never reach public manifests or payloads.
  const normalized = sortCandidates(
    input.candidates.map((candidate) => {
      const bytes = utf8ByteLength(candidate.text);
      const contentDigest = sha256Hex(candidate.text);
      return {
        candidateId: candidate.candidateId,
        scope: candidate.scope,
        kind: candidate.kind,
        tier: candidate.tier,
        mandatory: candidate.mandatory,
        visibility: candidate.visibility,
        version: candidate.version,
        title: candidate.title,
        text: candidate.text,
        bytes,
        contentDigest,
        capturedAt: candidate.capturedAt,
        rationale: candidate.rationale,
        anchor: candidate.anchor,
        conflictKey: candidate.conflictKey,
        conflictPolarity: candidate.conflictPolarity,
        omissionHint: candidate.omissionHint,
      };
    }),
  );

  const localOmissions: CompilerLocalOmission[] = [];
  const policyEligible: NormalizedCandidate[] = [];

  for (const candidate of normalized) {
    if (!sameScope(candidate.scope, input.scope)) {
      localOmissions.push({
        candidateId: candidate.candidateId,
        title: candidate.title,
        tier: candidate.tier,
        reason: "cross_scope",
        bytes: candidate.bytes,
        disclosable: false,
        detail:
          "Candidato de outro escopo bloqueado pela fronteira de projeto.",
      });
      continue;
    }

    if (candidate.omissionHint === "snapshot_omission") {
      localOmissions.push({
        candidateId: candidate.candidateId,
        title: candidate.title,
        tier: candidate.tier,
        reason: "snapshot_omission",
        bytes: candidate.bytes,
        disclosable: false,
        detail: "Arquivo já omitido na captura C01 de origem.",
      });
      continue;
    }

    if (candidate.visibility === "db_only") {
      localOmissions.push({
        candidateId: candidate.candidateId,
        title: candidate.title,
        tier: candidate.tier,
        reason: "db_only_restricted",
        bytes: candidate.bytes,
        disclosable: false,
        detail:
          "Registro marcado como db_only não elegível para envio externo.",
      });
      continue;
    }

    if (candidate.visibility === "local_only" && !destination.allowsLocalOnly) {
      localOmissions.push({
        candidateId: candidate.candidateId,
        title: candidate.title,
        tier: candidate.tier,
        reason: "policy_restricted",
        bytes: candidate.bytes,
        disclosable: false,
        detail:
          "Decisão local_only não é divulgável fora de preview estritamente local.",
      });
      continue;
    }

    policyEligible.push(candidate);
  }

  // Evaluate canonical conflicts and precedence overrides before deduplicating/budgeting.
  const conflicts: CompilerConflict[] = [...(input.blockingConflicts ?? [])];
  const canonicalKeys = new Map<
    string,
    { require: string[]; forbid: string[] }
  >();
  for (const item of policyEligible) {
    if (
      item.tier === "invariant_canonical" &&
      item.conflictKey &&
      item.conflictPolarity
    ) {
      const group = canonicalKeys.get(item.conflictKey) ?? {
        require: [],
        forbid: [],
      };
      group[item.conflictPolarity].push(item.candidateId);
      canonicalKeys.set(item.conflictKey, group);
    }
  }

  const dominantByKey = new Map<string, "require" | "forbid">();
  for (const [key, group] of [...canonicalKeys.entries()].sort(([a], [b]) =>
    compareAsc(a, b),
  )) {
    if (group.require.length > 0 && group.forbid.length > 0) {
      conflicts.push({
        kind: "canonical_contradiction",
        blocking: true,
        summary: `Conflito material entre invariantes canônicos na chave "${key}".`,
        detectedAt: input.now,
        relatedRefs: [...group.require, ...group.forbid].sort(compareAsc),
      });
    } else if (group.require.length > 0) {
      dominantByKey.set(key, "require");
    } else if (group.forbid.length > 0) {
      dominantByKey.set(key, "forbid");
    }
  }

  const precedenceEligible: NormalizedCandidate[] = [];
  for (const item of policyEligible) {
    if (item.tier === "invariant_canonical") {
      precedenceEligible.push(item);
      continue;
    }
    if (item.conflictKey && item.conflictPolarity) {
      const dominant = dominantByKey.get(item.conflictKey);
      if (dominant && dominant !== item.conflictPolarity) {
        localOmissions.push({
          candidateId: item.candidateId,
          title: item.title,
          tier: item.tier,
          reason: "overridden_by_precedence",
          bytes: item.bytes,
          disclosable: true,
          detail: `Preterido por regra de precedência superior na chave "${item.conflictKey}".`,
        });
        continue;
      }
      if (!dominant && item.tier === "project_preference") {
        dominantByKey.set(item.conflictKey, item.conflictPolarity);
      }
    }
    precedenceEligible.push(item);
  }

  // Deduplicate exact content digests in strict precedence order.
  const deduped: NormalizedCandidate[] = [];
  const seenDigests = new Set<string>();
  for (const item of precedenceEligible) {
    if (seenDigests.has(item.contentDigest)) {
      localOmissions.push({
        candidateId: item.candidateId,
        title: item.title,
        tier: item.tier,
        reason: "duplicate_excerpt",
        bytes: item.bytes,
        disclosable: true,
        detail: "Conteúdo idêntico já coberto por item de maior precedência.",
      });
      continue;
    }
    seenDigests.add(item.contentDigest);
    deduped.push(item);
  }

  const sortedConflicts = dedupeAndSortConflicts(conflicts);
  const hasBlockingConflict = sortedConflicts.some((item) => item.blocking);
  const suspensionReason = hasBlockingConflict
    ? (sortedConflicts.find((item) => item.blocking)?.summary ??
      "Recomendação suspensa por conflito material.")
    : null;

  const mandatoryCandidates = deduped.filter((item) => item.mandatory);
  const optionalCandidates = deduped.filter((item) => !item.mandatory);
  const mandatoryBytes = mandatoryCandidates.reduce(
    (sum, item) => sum + item.bytes,
    0,
  );

  const selectedCandidates: NormalizedCandidate[] = [];
  const mandatoryOverflowItems: CompiledContextPreview["mandatoryOverflowItems"] =
    [];

  const deliveryBlocked =
    !destination.known ||
    (!destination.deliveryAllowed && !destination.allowsLocalOnly);

  let status: CompilerManifestStatus;
  let selectedBytes = 0;

  if (mandatoryBytes > input.budgetBytes) {
    status = "mandatory_context_exceeded";
    for (const item of mandatoryCandidates) {
      mandatoryOverflowItems.push({
        candidateId: item.candidateId,
        title: item.title,
        tier: item.tier,
        version: item.version,
        bytes: item.bytes,
        contentDigest: item.contentDigest,
      });
    }
    for (const item of optionalCandidates) {
      localOmissions.push({
        candidateId: item.candidateId,
        title: item.title,
        tier: item.tier,
        reason: "budget_exceeded",
        bytes: item.bytes,
        disclosable: true,
        detail:
          "Item opcional omitido porque os itens obrigatórios já excedem o orçamento.",
      });
    }
  } else {
    selectedBytes = mandatoryBytes;
    selectedCandidates.push(...mandatoryCandidates);

    for (const item of optionalCandidates) {
      if (
        selectedCandidates.length < compilerMaxItems &&
        selectedBytes + item.bytes <= input.budgetBytes
      ) {
        selectedCandidates.push(item);
        selectedBytes += item.bytes;
      } else {
        localOmissions.push({
          candidateId: item.candidateId,
          title: item.title,
          tier: item.tier,
          reason: "budget_exceeded",
          bytes: item.bytes,
          disclosable: true,
          detail: "Excede o orçamento restante do manifesto compilado.",
        });
      }
    }

    status = deliveryBlocked
      ? "destination_blocked"
      : hasBlockingConflict
        ? "conflict_suspended"
        : "ready";
  }

  const orderedSelection = sortCandidates(selectedCandidates);
  const localItems: CompilerLocalItem[] = [];
  const publicItems: CompilerPublicItem[] = [];
  const authorizedPayloads: Record<string, AuthorizedContextPayload> = {};

  for (let ordinal = 0; ordinal < orderedSelection.length; ordinal++) {
    const item = orderedSelection[ordinal]!;
    const opaqueRef = buildOpaqueRef({
      scope: input.scope,
      destinationId: input.destinationId,
      policyVersion,
      strategyVersion,
      tier: item.tier,
      version: item.version,
      contentDigest: item.contentDigest,
      ordinal,
    });
    const publicItem: CompilerPublicItem = {
      opaqueRef,
      ordinal,
      kind: item.kind,
      tier: item.tier,
      mandatory: item.mandatory,
      version: item.version,
      contentDigest: item.contentDigest,
      bytes: item.bytes,
      rationale: item.rationale,
      anchor: item.anchor,
    };
    localItems.push({
      ...publicItem,
      candidateId: item.candidateId,
      title: item.title,
      visibility: item.visibility,
      capturedAt: item.capturedAt,
    });
    if (!deliveryBlocked && status !== "mandatory_context_exceeded") {
      publicItems.push(publicItem);
      authorizedPayloads[opaqueRef] = {
        text: item.text,
        contentDigest: item.contentDigest,
        bytes: item.bytes,
        title: item.title,
        tier: item.tier,
        version: item.version,
        anchor: item.anchor,
      };
    }
  }

  if (deliveryBlocked && status === "destination_blocked") {
    const blockDetail =
      destination.blockReason === "confinement_unverified"
        ? `Entrega bloqueada até F4-M02 (${input.destinationId}): confinamento ainda não comprovado.`
        : `Entrega bloqueada: destino desconhecido (${input.destinationId}).`;
    for (const item of orderedSelection) {
      localOmissions.push({
        candidateId: item.candidateId,
        title: item.title,
        tier: item.tier,
        reason: "destination_blocked",
        bytes: item.bytes,
        disclosable: true,
        detail: blockDetail,
      });
    }
  }

  const publicSelectedBytes =
    status === "destination_blocked" || status === "mandatory_context_exceeded"
      ? 0
      : selectedBytes;

  const budget = {
    limitBytes: input.budgetBytes,
    mandatoryBytes,
    selectedBytes: publicSelectedBytes,
    remainingBytes: Math.max(0, input.budgetBytes - publicSelectedBytes),
    estimatedTokens: Math.ceil(publicSelectedBytes / 4),
    exceededByBytes:
      status === "mandatory_context_exceeded"
        ? mandatoryBytes - input.budgetBytes
        : 0,
  };

  const omissions = summarizeOmissions(localOmissions);
  const manifestCore: Omit<CompiledPublicManifest, "manifestDigest"> = {
    schemaVersion: contextCompilerSchemaVersion,
    scope: input.scope,
    objective: input.objective,
    destinationId: input.destinationId,
    policyVersion,
    strategyVersion,
    status,
    recommendationSuspended: hasBlockingConflict,
    suspensionReason,
    budget,
    items: publicItems,
    conflicts: sortedConflicts,
    omissions,
  };
  const manifestDigest = sha256Hex(canonicalJson(manifestCore));
  const publicManifest: CompiledPublicManifest = {
    ...manifestCore,
    manifestDigest,
  };

  const preview: CompiledContextPreview = {
    scope: input.scope,
    compiledAt: input.now,
    destination,
    manifestDigest,
    publicManifest,
    localItems,
    localOmissions,
    mandatoryOverflowItems,
  };

  return { preview, authorizedPayloads };
}
