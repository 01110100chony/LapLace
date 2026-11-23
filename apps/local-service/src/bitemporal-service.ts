import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ClaimCorrectInput,
  ClaimDetailResult,
  ClaimRecordInput,
  ClaimRevision,
  EvidenceAttachmentRef,
  IdentityScope,
  RelationRecord,
  RelationRecordInput,
  TimelineClaimEntry,
  TimelineEvidenceResolution,
  TimelineInput,
  TimelineResult,
  TimelineSignalEntry,
} from "@laplace/contracts";
import {
  applyPartialCorrection,
  projectBitemporalState,
  projectKgraphTimeline,
} from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import { sha256 } from "./context.ts";
import { GitError } from "./git.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

function toClaimDetail(
  scope: IdentityScope,
  claimId: string,
  title: string,
  revisions: ClaimRevision[],
): ClaimDetailResult {
  return {
    scope,
    claimId,
    title,
    activeCount: revisions.filter((rev) => rev.knownTo === null).length,
    revisions,
  };
}

function resolveAttachment(
  store: CatalogStore,
  scope: IdentityScope,
  worktreeRoot: string,
  legacyProjectId: string,
  ref: EvidenceAttachmentRef | null,
): TimelineEvidenceResolution {
  if (ref === null) {
    return {
      state: "none",
      source: "none",
      digest: null,
      gapReason: null,
      textPreview: null,
    };
  }
  if (ref.kind === "pin") {
    const pin = store.f3.getPin(scope, ref.pinId);
    if (!pin) {
      return {
        state: "gap",
        source: "cas_pin",
        digest: null,
        gapReason: "pin_missing_or_purged",
        textPreview: null,
      };
    }
    const check = store.cas.verify(pin.digest);
    if (check.state === "verified" && check.bytes !== null) {
      return {
        state: "verified",
        source: "cas_pin",
        digest: pin.digest,
        gapReason: null,
        textPreview: check.bytes.subarray(0, 400).toString("utf8"),
      };
    }
    return {
      state: "gap",
      source: "cas_pin",
      digest: pin.digest,
      gapReason: `cas_${check.state}`,
      textPreview: null,
    };
  }

  // Unpinned context_excerpt: check captured context store AND live origin file.
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
        textPreview: null,
      };
    }
    const diskDigest = sha256(readFileSync(diskPath));
    if (diskDigest !== ref.sha256) {
      return {
        state: "gap",
        source: "context_store",
        digest: ref.sha256,
        gapReason: "origin_divergent",
        textPreview: null,
      };
    }
    return {
      state: "verified",
      source: "context_store",
      digest: ref.sha256,
      gapReason: null,
      textPreview: excerpt.preview.text.slice(0, 400),
    };
  } catch {
    return {
      state: "gap",
      source: "context_store",
      digest: ref.sha256,
      gapReason: "context_source_unavailable",
      textPreview: null,
    };
  }
}

export function createBitemporalService(deps: {
  withCatalog: WithCatalog;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    claimRecord(input: ClaimRecordInput): ClaimDetailResult {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const recordedAt = now();
      const knownFrom = input.knownAt ?? recordedAt;

      return deps.withCatalog((store) => {
        const worktree = store.identity.resolveScope(scope);
        const existingId = store.f3.findClaimByRequestId(
          scope,
          input.requestId,
        );
        if (existingId) {
          const loaded = store.f3.getClaim(scope, existingId);
          if (loaded) {
            return toClaimDetail(
              scope,
              loaded.header.claim_id,
              loaded.header.title,
              loaded.revisions,
            );
          }
        }

        if (input.evidenceRef?.kind === "pin") {
          const pin = store.f3.getPin(scope, input.evidenceRef.pinId);
          if (!pin) throw new GitError("memory_not_found");
        }

        const claimId = randomUUID();
        const revisionId = randomUUID();
        const revision: ClaimRevision & { requestId: string } = {
          revisionId,
          claimId,
          segmentSeq: 1,
          txSeq: 1,
          requestId: input.requestId,
          content: input.content,
          author: input.author,
          reason: input.reason,
          authority: input.promoteCanonical ? "human_promoted" : "human_local",
          visibility: input.visibility ?? "local_only",
          conflictKey: input.conflictKey ?? null,
          conflictPolarity: input.conflictPolarity ?? null,
          validFrom: input.validFrom,
          validTo: input.validTo ?? null,
          knownFrom,
          knownTo: null,
          supersedesRevisionId: null,
          evidenceRef: input.evidenceRef ?? null,
          recordedAt,
        };

        store.f3.insertClaimWithRevision({
          scope,
          legacyProjectId: worktree.legacyProjectId,
          claimId,
          title: input.title,
          createdAt: recordedAt,
          revision,
        });

        const loaded = store.f3.getClaim(scope, claimId);
        if (!loaded) throw new GitError("catalog_unavailable");
        return toClaimDetail(
          scope,
          loaded.header.claim_id,
          loaded.header.title,
          loaded.revisions,
        );
      });
    },

    claimCorrect(input: ClaimCorrectInput): ClaimDetailResult {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const recordedAt = now();
      const knownAt = input.knownAt ?? recordedAt;

      return deps.withCatalog((store) => {
        store.identity.resolveScope(scope);
        const existingRequestClaimId = store.f3.findClaimByRequestId(
          scope,
          input.requestId,
        );
        if (existingRequestClaimId === input.claimId) {
          const current = store.f3.getClaim(scope, input.claimId);
          if (current) {
            return toClaimDetail(
              scope,
              current.header.claim_id,
              current.header.title,
              current.revisions,
            );
          }
        }

        const loaded = store.f3.getClaim(scope, input.claimId);
        if (!loaded) throw new GitError("memory_not_found");

        if (input.evidenceRef?.kind === "pin") {
          const pin = store.f3.getPin(scope, input.evidenceRef.pinId);
          if (!pin) throw new GitError("memory_not_found");
        }

        let plan;
        try {
          plan = applyPartialCorrection({
            activeRevisions: loaded.revisions,
            correctFrom: input.correctFrom,
            correctTo: input.correctTo ?? null,
            knownAt,
            nextTxSeq: loaded.header.next_tx_seq,
            nextStartSegmentSeq: loaded.header.next_segment_seq,
            replacement: {
              content: input.content,
              author: input.author,
              reason: input.reason,
              conflictKey: input.conflictKey,
              conflictPolarity: input.conflictPolarity,
              evidenceRef: input.evidenceRef ?? null,
              recordedAt,
            },
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : "";
          if (msg === "invalid_correction_interval") {
            throw new GitError("memory_invalid_input");
          }
          if (
            msg === "bitemporal_clock_regression" ||
            msg === "no_overlapping_revision"
          ) {
            throw new GitError("memory_conflict");
          }
          throw error;
        }

        const newRevisions: (ClaimRevision & { requestId: string })[] =
          plan.newSegments.map((seg) => ({
            revisionId: randomUUID(),
            claimId: input.claimId,
            requestId: input.requestId,
            ...seg,
          }));

        store.f3.applyClaimCorrection({
          scope,
          claimId: input.claimId,
          requestId: input.requestId,
          closedRevisionIds: plan.closedRevisionIds,
          knownTo: plan.knownTo,
          nextTxSeq: loaded.header.next_tx_seq + 1,
          nextSegmentSeq: loaded.header.next_segment_seq + newRevisions.length,
          newRevisions,
        });

        const updated = store.f3.getClaim(scope, input.claimId);
        if (!updated) throw new GitError("catalog_unavailable");
        return toClaimDetail(
          scope,
          updated.header.claim_id,
          updated.header.title,
          updated.revisions,
        );
      });
    },

    relationRecord(input: RelationRecordInput): RelationRecord {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const record: RelationRecord = {
        relationId: randomUUID(),
        scope,
        fromId: input.fromId,
        toId: input.toId,
        kind: input.kind,
        signalKind: input.signalKind,
        rationale: input.rationale,
        author: input.author,
        knownAt: input.knownAt ?? now(),
      };
      return deps.withCatalog((store) => store.f3.insertRelation(record));
    },

    timeline(input: TimelineInput): TimelineResult {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      return deps.withCatalog((store) => {
        const worktree = store.identity.resolveScope(scope);
        const { titles, revisions } =
          store.f3.listAllScopeClaimsAndRevisions(scope);
        const storedEdges = store.f3.listRelations(scope);

        const { visible, conflicts } = projectBitemporalState(revisions, {
          knownAt: input.knownAt,
          validAt: input.validAt ?? null,
        });

        const signals: TimelineSignalEntry[] = [];
        for (const edge of storedEdges) {
          signals.push({
            signalId: `edge:${edge.relationId}`,
            signalKind: edge.signalKind,
            subjectId: edge.fromId,
            targetId: edge.toId,
            summary: edge.rationale,
            recordedAt: edge.knownAt,
            derivedFromConfirmed: edge.signalKind === "confirmed_link",
          });
        }

        const claims: TimelineClaimEntry[] = visible.map((revision) => {
          const resolvedEvidence = resolveAttachment(
            store,
            scope,
            worktree.root,
            worktree.legacyProjectId,
            revision.evidenceRef,
          );
          if (resolvedEvidence.state === "gap") {
            signals.push({
              signalId: `drift:${revision.revisionId}`,
              signalKind: "objective_drift",
              subjectId: revision.claimId,
              targetId: revision.revisionId,
              summary: `Evidência anexada indisponível ou divergente (${resolvedEvidence.gapReason ?? "gap"}).`,
              recordedAt: revision.knownFrom,
              derivedFromConfirmed: false,
            });
          }
          return {
            claimId: revision.claimId,
            title: titles.get(revision.claimId) ?? revision.claimId,
            revision,
            resolvedEvidence,
          };
        });

        for (const conflict of conflicts) {
          signals.push({
            signalId: `verifier:${conflict.conflictKey}:${conflict.revisionIds.join("+")}`,
            signalKind: "verifier_signal",
            subjectId: conflict.conflictKey,
            targetId: conflict.revisionIds[0] ?? null,
            summary: conflict.summary,
            recordedAt: input.knownAt,
            derivedFromConfirmed: false,
          });
        }

        const projected = projectKgraphTimeline({
          scope,
          edges: storedEdges,
          signals,
          knownAt: input.knownAt,
          signalKinds: input.signalKinds,
        });

        return {
          scope,
          knownAt: input.knownAt,
          validAt: input.validAt ?? null,
          claims,
          edges: projected.edges,
          signals: projected.signals,
          conflicts,
        };
      });
    },
  };
}
