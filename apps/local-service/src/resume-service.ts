import type {
  BindingVerificationState,
  EvidencePresentComparison,
  IdentityScope,
  ResumeObservation,
  ResumeObservationGap,
  ResumeSummary,
} from "@laplace/contracts";
import { composeResume } from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import { captureContext } from "./context.ts";
import { chunkSource } from "./context-chunks.ts";
import {
  GitError,
  inspectRepository,
  type RepositoryInspection,
} from "./git.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

const maxLivePreviewBytes = 32 * 1024;

function sliceUtf8Prefix(bytes: Buffer, maxBytes: number): Buffer {
  if (bytes.length <= maxBytes) return bytes;
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  if (end > 0 && bytes[end] === 10 && bytes[end - 1] === 13) end--;
  return bytes.subarray(0, end);
}

function mapGitErrorToGap(code: GitError["code"]): ResumeObservationGap {
  switch (code) {
    case "invalid_folder":
    case "project_unavailable":
      return "folder_unavailable";
    case "not_repository":
      return "not_repository";
    case "project_identity_mismatch":
      return "identity_mismatch";
    case "project_identity_unknown":
      return "identity_unknown";
    case "git_timeout":
      return "git_timeout";
    case "git_missing":
      return "git_missing";
    default:
      return "git_failed";
  }
}

export type ResumeServiceDeps = {
  withCatalog: WithCatalog;
  inspect?: typeof inspectRepository;
  captureLive?: typeof captureContext;
  contextOptions: (
    legacyProjectId: string,
  ) => Parameters<typeof captureContext>[2];
  getSelectionGeneration: () => number;
  now?: () => string;
  beforePublishHook?: () => Promise<void>;
};

export function createResumeService(deps: ResumeServiceDeps) {
  const inspect = deps.inspect ?? inspectRepository;
  const captureLive = deps.captureLive ?? captureContext;
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    async resume(
      scope: IdentityScope,
      correlationId: string | undefined,
      signal?: AbortSignal,
    ): Promise<ResumeSummary> {
      const before = deps.withCatalog((store) => {
        const worktree = store.identity.resolveScope(scope);
        const legacyProject = store.lookup(worktree.legacyProjectId);
        const selectedLegacyId = store.list().selectedProjectId;
        if (
          selectedLegacyId !== null &&
          selectedLegacyId !== worktree.legacyProjectId
        ) {
          throw new GitError("resume_stale");
        }
        return {
          worktree,
          legacyProject,
          generation: deps.getSelectionGeneration(),
          purgeEpoch: store.decisions.getPurgeEpoch(scope),
          tombstones: store.decisions.countTombstones(scope),
        };
      });

      let inspection: RepositoryInspection | null = null;
      let gap: ResumeObservationGap | null = null;
      let resolvedVerification: BindingVerificationState =
        before.worktree.verification;

      try {
        inspection = await inspect(before.legacyProject.root, {
          signal,
          expectedRoot: before.legacyProject.root,
          expectedIdentity: before.legacyProject.identity ?? undefined,
        });
      } catch (error) {
        if (error instanceof GitError) {
          gap = mapGitErrorToGap(error.code);
          if (error.code === "project_identity_mismatch") {
            resolvedVerification = "divergent";
          } else if (resolvedVerification === "verified") {
            resolvedVerification = "unavailable";
          }
        } else {
          gap = "git_failed";
          if (resolvedVerification === "verified") {
            resolvedVerification = "unavailable";
          }
        }
      }

      if (deps.beforePublishHook) {
        await deps.beforePublishHook();
      }

      const attemptedAt = now();

      return deps.withCatalog((store) => {
        if (deps.getSelectionGeneration() !== before.generation) {
          throw new GitError("resume_stale");
        }
        const selectedAfter = store.list().selectedProjectId;
        if (
          selectedAfter !== null &&
          selectedAfter !== before.worktree.legacyProjectId
        ) {
          throw new GitError("resume_stale");
        }

        const afterWorktree = store.identity.resolveScope(scope);
        const afterLegacy = store.lookup(afterWorktree.legacyProjectId);
        if (
          afterWorktree.root !== before.worktree.root ||
          afterLegacy.identity !== before.legacyProject.identity
        ) {
          throw new GitError("resume_stale");
        }

        if (
          store.decisions.getPurgeEpoch(scope) !== before.purgeEpoch ||
          store.decisions.countTombstones(scope) !== before.tombstones
        ) {
          throw new GitError("resume_stale");
        }

        let observation: ResumeObservation;
        if (inspection) {
          const freshObservation = {
            branch: inspection.branch,
            head: inspection.head,
            changes: inspection.changes,
            observedAt: inspection.observedAt,
            source: inspection.source,
            summaryVersion: inspection.summaryVersion,
          };
          if (afterWorktree.verification === "verified") {
            store.record(afterLegacy, inspection);
          }
          observation = {
            state: "fresh",
            observation: freshObservation,
            attemptedAt,
            gap: null,
          };
        } else {
          const cached = store.readCachedObservation(afterLegacy.id);
          const effectiveGap: ResumeObservationGap = gap ?? "git_failed";
          observation = cached
            ? {
                state: "cached",
                observation: cached,
                attemptedAt,
                gap: effectiveGap,
              }
            : {
                state: "unavailable",
                observation: null,
                attemptedAt,
                gap: effectiveGap,
              };
        }

        const decisions = store.decisions.list(scope).items;
        const activity = store.readLatestActivity(
          afterLegacy.id,
          scope.projectId,
        );
        const workingConflict =
          observation.state !== "unavailable" &&
          observation.observation.changes.conflicted > 0;

        return composeResume({
          scope,
          projectName: afterWorktree.name,
          root: afterWorktree.root,
          verification: resolvedVerification,
          now: attemptedAt,
          correlationId,
          observation,
          decisions,
          lastCapture: activity.lastCapture,
          lastExecution: activity.lastExecution,
          workingConflict,
        });
      });
    },

    async comparePresent(
      scope: IdentityScope,
      ref: { contextId: string; path: string; sha256: string; chunk: number },
    ): Promise<EvidencePresentComparison> {
      const { historical, legacyProject } = deps.withCatalog((store) => {
        const worktree = store.identity.resolveScope(scope);
        const resolved = store.evidence.resolve(scope, ref);
        const project = store.lookup(worktree.legacyProjectId);
        return { historical: resolved, legacyProject: project };
      });

      const checkedAt = now();
      if (historical.evidence.state !== "verified") {
        // Never touch disk working tree when historical proof has a gap.
        return {
          scope,
          historical,
          present: {
            state: "blocked_by_gap",
            origin: "working_tree",
            checkedAt,
            path: ref.path,
            sha256: null,
            text: null,
          },
          comparison: "unavailable",
        };
      }

      try {
        const captured = await captureLive(
          legacyProject,
          [ref.path],
          deps.contextOptions(legacyProject.id),
        );
        const entry = captured.snapshot.entries.find(
          (item) => item.path === ref.path,
        );
        if (entry?.outcome === "included") {
          const bytes = captured.blobs.get(entry.sha256);
          if (bytes) {
            const isMultiChunk =
              historical.excerpt !== null &&
              historical.excerpt.sha256 !== ref.sha256;
            let slice: Buffer;
            if (isMultiChunk) {
              const chunks = [...chunkSource(bytes)];
              const targetChunk = chunks[ref.chunk];
              slice = targetChunk
                ? bytes.subarray(targetChunk.startByte, targetChunk.endByte)
                : Buffer.alloc(0);
            } else {
              slice = sliceUtf8Prefix(bytes, maxLivePreviewBytes);
            }
            const text = slice.toString("utf8");
            if (!text.includes("\0")) {
              return {
                scope,
                historical,
                present: {
                  state: "available",
                  origin: "working_tree",
                  checkedAt,
                  path: ref.path,
                  sha256: entry.sha256,
                  text,
                },
                comparison: entry.sha256 === ref.sha256 ? "matches" : "differs",
              };
            }
          }
        }
      } catch (error) {
        if (!(error instanceof GitError)) {
          return {
            scope,
            historical,
            present: {
              state: "unavailable",
              origin: "working_tree",
              checkedAt,
              path: ref.path,
              sha256: null,
              text: null,
            },
            comparison: "unavailable",
          };
        }
      }

      return {
        scope,
        historical,
        present: {
          state: "unavailable",
          origin: "working_tree",
          checkedAt,
          path: ref.path,
          sha256: null,
          text: null,
        },
        comparison: "unavailable",
      };
    },
  };
}
