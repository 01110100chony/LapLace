import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CompiledContextPreview,
  EvidenceAttachmentRef,
  IdentityScope,
  ReplayClaimEntry,
  ReplayDecisionEntry,
  ReplayDeliveryDetail,
  ReplayDeliveryInspectInput,
  ReplayDeliverySummary,
  ReplayDiffInput,
  ReplayDiffResult,
  ReplayGap,
  ReplayQueryInput,
  ReplayQueryResult,
} from "@laplace/contracts";
import {
  buildReplayVersionPoints,
  classifyReplayGaps,
  diffReplayStates,
  projectBitemporalState,
  projectKgraphTimeline,
} from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import { sha256 } from "./context.ts";
import { GitError } from "./git.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

function assertValidRange(validAt: string, knownAt: string) {
  if (
    !Number.isFinite(Date.parse(validAt)) ||
    !Number.isFinite(Date.parse(knownAt))
  ) {
    throw new GitError("replay_invalid_range");
  }
}

function resolveClaimEvidencePassive(
  store: CatalogStore,
  scope: IdentityScope,
  worktreeRoot: string,
  legacyProjectId: string,
  ref: EvidenceAttachmentRef | null,
): {
  state: "verified" | "gap" | "none";
  source: "cas_pin" | "context_store" | "none";
  digest: string | null;
  gapReason: string | null;
  preview: string | null;
} {
  if (ref === null) {
    return {
      state: "none",
      source: "none",
      digest: null,
      gapReason: null,
      preview: null,
    };
  }
  if (ref.kind === "pin") {
    const pin = store.f3.getPin(scope, ref.pinId);
    if (!pin) {
      return {
        state: "gap",
        source: "cas_pin",
        digest: null,
        gapReason: "pin_purged_or_released",
        preview: null,
      };
    }
    const check = store.cas.verify(pin.digest);
    if (check.state === "verified" && check.bytes !== null) {
      return {
        state: "verified",
        source: "cas_pin",
        digest: pin.digest,
        gapReason: null,
        preview: check.bytes.subarray(0, 300).toString("utf8"),
      };
    }
    return {
      state: "gap",
      source: "cas_pin",
      digest: pin.digest,
      gapReason: `cas_${check.state}`,
      preview: null,
    };
  }
  try {
    const excerpt = store.contextSearch.readExcerpt(legacyProjectId, {
      contextId: ref.contextId,
      path: ref.path,
      sha256: ref.sha256,
      chunk: ref.chunk,
    });
    const diskPath = join(worktreeRoot, ref.path);
    if (!existsSync(diskPath)) {
      return {
        state: "gap",
        source: "context_store",
        digest: ref.sha256,
        gapReason: "origin_unavailable",
        preview: null,
      };
    }
    const diskDigest = sha256(readFileSync(diskPath));
    if (diskDigest !== ref.sha256) {
      return {
        state: "gap",
        source: "context_store",
        digest: ref.sha256,
        gapReason: "origin_divergent",
        preview: null,
      };
    }
    return {
      state: "verified",
      source: "context_store",
      digest: ref.sha256,
      gapReason: null,
      preview: excerpt.preview.text.slice(0, 300),
    };
  } catch {
    return {
      state: "gap",
      source: "context_store",
      digest: ref.sha256,
      gapReason: "context_source_unavailable",
      preview: null,
    };
  }
}

export function createReplayService(deps: { withCatalog: WithCatalog }) {
  function scopeOf(input: IdentityScope): IdentityScope {
    return {
      projectId: input.projectId,
      bindingId: input.bindingId,
      worktreeId: input.worktreeId,
    };
  }

  function runQuery(input: ReplayQueryInput): ReplayQueryResult {
    assertValidRange(input.validAt, input.knownAt);
    const scope = scopeOf(input);
    const knownAtMs = Date.parse(input.knownAt);
    const validAtMs = Date.parse(input.validAt);

    return deps.withCatalog((store) => {
      const worktree = store.identity.resolveScope(scope);
      const { titles, revisions } =
        store.f3.listAllScopeClaimsAndRevisions(scope);
      const storedEdges = store.f3.listRelations(scope);
      const artifacts = store.f5.readReplayScopeArtifacts(scope, input.knownAt);

      const postKnowledgeCount = revisions.filter(
        (r) => Date.parse(r.knownFrom) > knownAtMs,
      ).length;

      const { visible, conflicts } = projectBitemporalState(revisions, {
        knownAt: input.knownAt,
        validAt: input.validAt,
      });

      const evidenceGaps: {
        targetKind: "claim" | "decision" | "pin" | "delivery";
        targetId: string;
        reason: string;
        recordedAt: string | null;
      }[] = [];

      const claims: ReplayClaimEntry[] = visible.map((rev) => {
        const res = resolveClaimEvidencePassive(
          store,
          scope,
          worktree.root,
          worktree.legacyProjectId,
          rev.evidenceRef,
        );
        if (res.state === "gap") {
          evidenceGaps.push({
            targetKind: "claim",
            targetId: rev.claimId,
            reason: res.gapReason ?? "gap",
            recordedAt: rev.knownFrom,
          });
        }
        return {
          claimId: rev.claimId,
          title: titles.get(rev.claimId) ?? rev.claimId,
          revision: rev,
          evidenceState: res.state,
          evidenceSource: res.source,
          evidenceDigest: res.digest,
          evidenceGapReason: res.gapReason,
          evidencePreview: res.preview,
        };
      });

      // Reconstruct F1 human decisions as known at knownAt and effective at validAt.
      const latestDecisionByAssertion = new Map<
        string,
        Record<string, unknown>
      >();
      for (const row of artifacts.decisionRevs) {
        const recordedAt = row.recorded_at as string;
        const effectiveAt = row.effective_at as string;
        if (
          Date.parse(recordedAt) <= knownAtMs &&
          Date.parse(effectiveAt) <= validAtMs
        ) {
          latestDecisionByAssertion.set(row.assertion_id as string, row);
        }
      }

      const decisions: ReplayDecisionEntry[] = [];
      for (const row of latestDecisionByAssertion.values()) {
        const assertionId = row.assertion_id as string;
        const contextId = (row.context_id as string | null) ?? null;
        const path = (row.evidence_path as string | null) ?? null;
        const sha = (row.evidence_sha256 as string | null) ?? null;
        const chunk = (row.evidence_chunk as number | null) ?? null;

        let evState: "verified" | "gap" | "none" = "none";
        let evDigest: string | null = null;
        let evGap: string | null = null;
        if (contextId && path && sha && chunk !== null) {
          try {
            store.contextSearch.readExcerpt(worktree.legacyProjectId, {
              contextId,
              path,
              sha256: sha,
              chunk,
            });
            evState = "verified";
            evDigest = sha;
          } catch {
            evState = "gap";
            evDigest = sha;
            evGap = "context_source_unavailable";
            evidenceGaps.push({
              targetKind: "decision",
              targetId: assertionId,
              reason: "context_source_unavailable",
              recordedAt: row.recorded_at as string,
            });
          }
        }
        decisions.push({
          assertionId,
          revisionId: row.revision_id as string,
          revision: Number(row.revision),
          content: row.content as string,
          author: row.author as string,
          authority: row.authority as ReplayDecisionEntry["authority"],
          visibility: row.visibility as ReplayDecisionEntry["visibility"],
          status: row.status as ReplayDecisionEntry["status"],
          effectiveAt: row.effective_at as string,
          recordedAt: row.recorded_at as string,
          evidenceState: evState,
          evidenceDigest: evDigest,
          evidenceGapReason: evGap,
        });
      }

      const kgraph = projectKgraphTimeline({
        scope,
        edges: storedEdges,
        signals: [],
        knownAt: input.knownAt,
        signalKinds: input.signalKinds,
      });

      const deliveries: ReplayDeliverySummary[] = artifacts.manifests.map(
        (row) => {
          const manifestDigest = row.manifest_digest as string;
          const preview = JSON.parse(
            row.preview_json as string,
          ) as CompiledContextPreview;
          const grantIds = artifacts.grants
            .filter((g) => g.manifest_digest === manifestDigest)
            .map((g) => g.grant_id as string);
          const auditIds = artifacts.audits
            .filter((a) => a.manifest_digest === manifestDigest)
            .map((a) => a.audit_id as string);
          return {
            manifestDigest,
            destinationId: row.destination_id as string,
            policyVersion: row.policy_version as string,
            strategyVersion: row.strategy_version as string,
            compiledAt: row.compiled_at as string,
            status: row.status as string,
            includedCount: preview.publicManifest.items.length,
            omittedCount: preview.publicManifest.omissions.length,
            grantIds,
            auditIds,
          };
        },
      );

      const gaps = classifyReplayGaps({
        knownAt: input.knownAt,
        claimTombstones: artifacts.f3Tombstones.map((t) => ({
          targetKind: t.target_kind,
          targetId: t.target_id,
          purgedAt: t.purged_at,
        })),
        decisionTombstones: artifacts.decisionTombstones.map((d) => ({
          assertionId: d.assertion_id,
          purgedAt: d.purged_at,
        })),
        evidenceGaps,
        postKnowledgeCount,
      });

      const versionTimeline = buildReplayVersionPoints({
        claims,
        decisions,
        deliveries,
        gaps,
      });

      return {
        scope,
        validAt: input.validAt,
        knownAt: input.knownAt,
        claims,
        decisions,
        relations: kgraph.edges,
        conflicts,
        gaps,
        deliveries,
        versionTimeline,
      };
    });
  }

  return {
    query(input: ReplayQueryInput): ReplayQueryResult {
      return runQuery(input);
    },

    diff(input: ReplayDiffInput): ReplayDiffResult {
      const stateA = runQuery({
        ...scopeOf(input),
        validAt: input.pointA.validAt,
        knownAt: input.pointA.knownAt,
      });
      const stateB = runQuery({
        ...scopeOf(input),
        validAt: input.pointB.validAt,
        knownAt: input.pointB.knownAt,
      });
      return diffReplayStates(stateA, stateB);
    },

    deliveryInspect(input: ReplayDeliveryInspectInput): ReplayDeliveryDetail {
      if (!Number.isFinite(Date.parse(input.knownAt))) {
        throw new GitError("replay_invalid_range");
      }
      const scope = scopeOf(input);
      const knownAtMs = Date.parse(input.knownAt);

      return deps.withCatalog((store) => {
        const worktree = store.identity.resolveScope(scope);
        const manifest = store.f2.getCompiledManifest(
          scope,
          input.manifestDigest,
        );
        if (!manifest || Date.parse(manifest.compiledAt) > knownAtMs) {
          throw new GitError("intelligence_not_found");
        }

        const artifacts = store.f5.readReplayScopeArtifacts(
          scope,
          input.knownAt,
        );
        const grants = artifacts.grants
          .filter((g) => g.manifest_digest === input.manifestDigest)
          .map((g) => ({
            grantId: g.grant_id as string,
            sessionId: g.session_id as string,
            issuedAt: g.issued_at as string,
            expiresAt: g.expires_at as string,
            revokedAt: (g.revoked_at as string | null) ?? null,
          }));
        const grantSet = new Set(grants.map((g) => g.grantId));

        const audits = artifacts.audits
          .filter((a) => a.manifest_digest === input.manifestDigest)
          .map((a) => ({
            auditId: a.audit_id as string,
            channel: a.channel as string,
            mode: a.mode as string,
            state: a.state as string,
            startedAt: a.started_at as string,
            finishedAt: a.finished_at as string,
          }));

        const observedReads = artifacts.mcpReads
          .filter((m) => grantSet.has(m.grant_id as string))
          .map((m) => ({
            tool: m.tool as string,
            opaqueRef: (m.opaque_ref as string | null) ?? null,
            outcome: m.outcome as "allowed" | "denied",
            at: m.at as string,
          }));

        const sourceGaps: ReplayGap[] = [];
        const decisionTombstoneSet = new Set(
          artifacts.decisionTombstones.map((t) => t.assertion_id),
        );
        for (const item of manifest.preview.publicManifest.items) {
          if (
            item.anchor.kind === "decision" &&
            decisionTombstoneSet.has(item.anchor.assertionId)
          ) {
            sourceGaps.push({
              gapId: `delivery-gap-${item.anchor.assertionId}`,
              kind: "purged_tombstone",
              targetKind: "decision",
              targetId: item.anchor.assertionId,
              recordedAt: input.knownAt,
              detail:
                "Decisao referenciada no manifesto foi expurgada posteriormente; conteudo nao ressuscitado.",
            });
          } else if (item.anchor.kind === "context_excerpt") {
            try {
              store.contextSearch.readExcerpt(worktree.legacyProjectId, {
                contextId: item.anchor.contextId,
                path: item.anchor.path,
                sha256: item.anchor.sha256,
                chunk: item.anchor.chunk,
              });
            } catch {
              sourceGaps.push({
                gapId: `delivery-ctx-${item.opaqueRef}`,
                kind: "unpinned_cas_missing",
                targetKind: "delivery",
                targetId: item.opaqueRef,
                recordedAt: manifest.compiledAt,
                detail: `Trecho de origem (${item.anchor.path}) indisponivel no momento do replay.`,
              });
            }
          }
        }

        return {
          scope,
          knownAt: input.knownAt,
          manifestDigest: manifest.preview.manifestDigest,
          destinationId: manifest.destinationId,
          policyVersion: manifest.policyVersion,
          strategyVersion: manifest.strategyVersion,
          compiledAt: manifest.compiledAt,
          status: manifest.status,
          objective: manifest.publicManifest.objective,
          includedItems: manifest.publicManifest.items.map((item) => ({
            opaqueRef: item.opaqueRef,
            kind: item.kind,
            tier: item.tier,
            version: item.version,
            contentDigest: item.contentDigest,
            bytes: item.bytes,
            rationale: item.rationale,
          })),
          omittedSummary: manifest.publicManifest.omissions,
          grants,
          audits,
          observedReads,
          sourceGaps,
        };
      });
    },
  };
}
