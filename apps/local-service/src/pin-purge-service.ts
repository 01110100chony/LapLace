import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultCasQuotaBytes,
  type CasPinRecord,
  type GcReport,
  type GcRunInput,
  type IdentityScope,
  type PinCreateInput,
  type PinListResult,
  type PinReleaseInput,
  type PinReleaseResult,
  type PinVerifyInput,
  type PinVerifyResult,
  type PurgeJobRecord,
  type PurgeStage,
  type PurgeStartInput,
  type PurgeTargetKind,
} from "@laplace/contracts";
import type { openCatalog } from "./catalog.ts";
import { sha256 } from "./context.ts";
import { GitError } from "./git.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

export function createPinPurgeService(deps: {
  withCatalog: WithCatalog;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());

  function verifyTargetExists(
    store: CatalogStore,
    scope: IdentityScope,
    targetKind: PurgeTargetKind,
    targetId: string,
  ): void {
    if (targetKind === "claim") {
      if (!store.f3.getClaim(scope, targetId)) {
        throw new GitError("memory_not_found");
      }
      return;
    }
    if (targetKind === "pin") {
      if (!store.f3.getPin(scope, targetId)) {
        throw new GitError("memory_not_found");
      }
      return;
    }
    if (!store.f3.getOverlay(scope, targetId)) {
      throw new GitError("memory_not_found");
    }
  }

  function advanceTransitions(
    store: CatalogStore,
    scope: IdentityScope,
    purgeId: string,
    maxTransitions: number,
  ): PurgeJobRecord {
    const loaded = store.f3.getPurgeJob(scope, purgeId);
    if (!loaded) throw new GitError("memory_not_found");
    const { candidateDigests } = loaded;
    let { job } = loaded;
    let remaining = maxTransitions;

    while (job.state !== "completed" && remaining > 0) {
      remaining--;
      const updatedAt = now();
      let nextStage: PurgeStage;
      let removedBlobs = job.removedBlobs;
      let preservedSharedBlobs = job.preservedSharedBlobs;

      if (job.stage === "access_revoked") {
        const protectedSet = new Set(store.f3.listProtectedDigests());
        let sharedCount = 0;
        for (const digest of candidateDigests) {
          if (protectedSet.has(digest)) {
            sharedCount++;
          } else if (store.cas.remove(digest)) {
            removedBlobs++;
          }
        }
        preservedSharedBlobs = sharedCount > 0 || preservedSharedBlobs;
        nextStage = "blobs_removed";
        job = store.f3.advancePurgeStage({
          purgeId: job.purgeId,
          stage: nextStage,
          state: "in_progress",
          removedBlobs,
          preservedSharedBlobs,
          updatedAt,
          completedAt: null,
        });
      } else if (job.stage === "blobs_removed") {
        nextStage = "projections_cleared";
        job = store.f3.advancePurgeStage({
          purgeId: job.purgeId,
          stage: nextStage,
          state: "in_progress",
          removedBlobs,
          preservedSharedBlobs,
          updatedAt,
          completedAt: null,
          clearTarget: { kind: job.targetKind, id: job.targetId },
        });
      } else {
        job = store.f3.advancePurgeStage({
          purgeId: job.purgeId,
          stage: "completed",
          state: "completed",
          removedBlobs,
          preservedSharedBlobs,
          updatedAt,
          completedAt: updatedAt,
        });
      }
    }

    return job;
  }

  return {
    pinCreate(input: PinCreateInput): CasPinRecord {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const createdAt = now();
      const quotaBytes = input.quotaBytes ?? defaultCasQuotaBytes;

      return deps.withCatalog((store) => {
        const worktree = store.identity.resolveScope(scope);
        if (input.protectedClaimId !== undefined) {
          if (!store.f3.getClaim(scope, input.protectedClaimId)) {
            throw new GitError("memory_not_found");
          }
        }

        let raw: Buffer;
        let sourceKind: "context_excerpt" | "inline";
        let sourceContextId: string | null = null;
        let sourcePath: string | null = null;
        let sourceChunk: number | null = null;

        if (input.source.kind === "inline") {
          raw = Buffer.from(input.source.content, "utf8");
          sourceKind = "inline";
        } else {
          const excerpt = store.contextSearch.readExcerpt(
            worktree.legacyProjectId,
            {
              contextId: input.source.contextId,
              path: input.source.path,
              sha256: input.source.sha256,
              chunk: input.source.chunk,
            },
          );
          raw = excerpt.bytes;
          sourceKind = "context_excerpt";
          sourceContextId = input.source.contextId;
          sourcePath = input.source.path;
          sourceChunk = input.source.chunk;
        }

        // Strict commit-before-publish: write and verify CAS blob before inserting manifest row.
        const putResult = store.cas.put(raw, quotaBytes);
        const pin: CasPinRecord = {
          pinId: randomUUID(),
          scope,
          label: input.label,
          digest: putResult.digest,
          bytes: putResult.bytes,
          sourceKind,
          sourceContextId,
          sourcePath,
          sourceChunk,
          protectedClaimId: input.protectedClaimId ?? null,
          status: "active",
          createdAt,
        };
        return store.f3.insertPin(pin);
      });
    },

    pinList(scope: IdentityScope): PinListResult {
      return deps.withCatalog((store) => ({
        scope,
        quotaBytes: defaultCasQuotaBytes,
        usedBytes: store.cas.usageBytes(),
        items: store.f3.listPins(scope),
      }));
    },

    pinVerify(input: PinVerifyInput): PinVerifyResult {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      return deps.withCatalog((store) => {
        const worktree = store.identity.resolveScope(scope);
        if (input.pinId !== undefined) {
          const pin = store.f3.getPin(scope, input.pinId);
          if (!pin) {
            return {
              scope,
              state: "gap",
              source: "cas_pin",
              digest: null,
              bytes: null,
              textPreview: null,
              gapReason: "pin_not_found_or_purged",
            };
          }
          const verified = store.cas.verify(pin.digest);
          if (verified.state === "verified" && verified.bytes !== null) {
            return {
              scope,
              state: "verified",
              source: "cas_pin",
              digest: pin.digest,
              bytes: verified.size,
              textPreview: verified.bytes.subarray(0, 400).toString("utf8"),
              gapReason: null,
            };
          }
          if (verified.state === "corrupt") {
            return {
              scope,
              state: "corrupt",
              source: "cas_pin",
              digest: pin.digest,
              bytes: verified.size,
              textPreview: null,
              gapReason: "cas_digest_mismatch",
            };
          }
          return {
            scope,
            state: "gap",
            source: "cas_pin",
            digest: pin.digest,
            bytes: null,
            textPreview: null,
            gapReason: "cas_blob_missing",
          };
        }

        if (input.unpinnedRef !== undefined) {
          const diskPath = join(worktree.root, input.unpinnedRef.path);
          if (!existsSync(diskPath)) {
            return {
              scope,
              state: "gap",
              source: "context_store",
              digest: input.unpinnedRef.sha256,
              bytes: null,
              textPreview: null,
              gapReason: "origin_unavailable",
            };
          }
          const diskDigest = sha256(readFileSync(diskPath));
          if (diskDigest !== input.unpinnedRef.sha256) {
            return {
              scope,
              state: "gap",
              source: "context_store",
              digest: input.unpinnedRef.sha256,
              bytes: null,
              textPreview: null,
              gapReason: "origin_divergent",
            };
          }
          try {
            const excerpt = store.contextSearch.readExcerpt(
              worktree.legacyProjectId,
              input.unpinnedRef,
            );
            return {
              scope,
              state: "verified",
              source: "context_store",
              digest: input.unpinnedRef.sha256,
              bytes: excerpt.bytes.length,
              textPreview: excerpt.preview.text.slice(0, 400),
              gapReason: null,
            };
          } catch {
            return {
              scope,
              state: "gap",
              source: "context_store",
              digest: input.unpinnedRef.sha256,
              bytes: null,
              textPreview: null,
              gapReason: "context_source_unavailable",
            };
          }
        }

        throw new GitError("memory_invalid_input");
      });
    },

    pinRelease(input: PinReleaseInput): PinReleaseResult {
      if (!input.humanConfirmed) {
        throw new GitError("memory_invalid_input");
      }
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      return deps.withCatalog((store) => {
        const pin = store.f3.getPin(scope, input.pinId);
        if (!pin) throw new GitError("memory_not_found");

        if (
          pin.protectedClaimId !== null &&
          store.f3.countActivePinsProtectingClaim(
            pin.protectedClaimId,
            pin.pinId,
          ) === 0
        ) {
          throw new GitError("pin_protected");
        }
        if (store.f3.countActiveClaimAttachmentsForPin(pin.pinId) > 0) {
          throw new GitError("pin_protected");
        }

        store.f3.markPinReleased(pin.pinId);
        const protectedSet = new Set(store.f3.listProtectedDigests());
        const blobCollected = protectedSet.has(pin.digest)
          ? false
          : store.cas.remove(pin.digest);
        return {
          scope,
          pinId: pin.pinId,
          released: true,
          blobCollected,
        };
      });
    },

    gcRun(input: GcRunInput): GcReport {
      if (!input.humanConfirmed) {
        throw new GitError("memory_invalid_input");
      }
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      return deps.withCatalog((store) => {
        store.identity.resolveScope(scope);
        const usedBytesBefore = store.cas.usageBytes();
        const protectedDigests = store.f3.listProtectedDigests();
        const protectedSet = new Set(protectedDigests);
        const deletedDigests: string[] = [];

        for (const obj of store.cas.listObjects()) {
          if (!protectedSet.has(obj.digest)) {
            if (store.cas.remove(obj.digest)) {
              deletedDigests.push(obj.digest);
            }
          }
        }

        return {
          scope,
          quotaBytes: input.quotaBytes ?? defaultCasQuotaBytes,
          usedBytesBefore,
          usedBytesAfter: store.cas.usageBytes(),
          deletedDigests,
          protectedDigests,
          protectedCount: protectedDigests.length,
        };
      });
    },

    purgeStart(input: PurgeStartInput): PurgeJobRecord {
      if (!input.humanConfirmed) {
        throw new GitError("memory_invalid_input");
      }
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const startedAt = now();
      const maxSteps = input.maxSteps ?? 10;

      return deps.withCatalog((store) => {
        verifyTargetExists(store, scope, input.targetKind, input.targetId);
        const candidateDigests = store.f3.collectCandidateDigestsForTarget(
          scope,
          input.targetKind,
          input.targetId,
        );
        const created = store.f3.createPurgeJob({
          purgeId: randomUUID(),
          tombstoneId: randomUUID(),
          scope,
          targetKind: input.targetKind,
          targetId: input.targetId,
          reason: input.reason,
          candidateDigests,
          startedAt,
        });
        const extraSteps = Math.max(0, maxSteps - 1);
        if (extraSteps === 0) return created;
        return advanceTransitions(store, scope, created.purgeId, extraSteps);
      });
    },

    purgeResume(scope: IdentityScope, purgeId: string): PurgeJobRecord {
      return deps.withCatalog((store) =>
        advanceTransitions(store, scope, purgeId, 10),
      );
    },

    purgeStatus(scope: IdentityScope, purgeId: string): PurgeJobRecord {
      return deps.withCatalog((store) => {
        const found = store.f3.getPurgeJob(scope, purgeId);
        if (!found) throw new GitError("memory_not_found");
        return found.job;
      });
    },
  };
}
