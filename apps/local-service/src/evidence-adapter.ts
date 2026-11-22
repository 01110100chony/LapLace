import type { DatabaseSync } from "node:sqlite";
import {
  maxContextSnippetBytes,
  type ContextEntry,
  type ContextSnapshot,
  type DecisionEvidenceInput,
  type EvidenceExcerpt,
  type IdentityScope,
  type OmissionReason,
  type ResolvedEvidence,
  type ResumeEvidence,
} from "@laplace/contracts";
import { sha256 } from "./context.ts";
import { chunkSource } from "./context-chunks.ts";
import type { createContextSearch } from "./context-search.ts";
import { GitError } from "./git.ts";
import type { createIdentityStore } from "./identity-store.ts";

type SnapshotHeaderRow = {
  project_id: string;
  status: ContextSnapshot["status"];
  completed_at: string;
};

type EntryRow = {
  path: string;
  blob: string | null;
  payload: string;
};

type BlobRow = {
  bytes: Uint8Array;
};

export function createEvidenceAdapter(
  database: DatabaseSync,
  identity: ReturnType<typeof createIdentityStore>,
  contextSearch: ReturnType<typeof createContextSearch>,
) {
  const selectSnapshot = database.prepare(`
    SELECT project_id, status, completed_at
    FROM context_snapshots
    WHERE context_id = ?
  `);

  const selectEntries = database.prepare(`
    SELECT path, blob_sha256 AS blob, payload
    FROM context_entries
    WHERE context_id = ?
    ORDER BY ordinal
  `);

  const selectBlob = database.prepare(`
    SELECT bytes FROM context_blobs WHERE sha256 = ?
  `);

  const selectIndex = database.prepare(`
    SELECT indexed_at FROM context_search_indexes WHERE context_id = ?
  `);

  function buildGap(
    scope: IdentityScope,
    ref: Exclude<DecisionEvidenceInput, null>,
    options: {
      gap: Extract<ResumeEvidence, { state: "gap" }>["gap"];
      coverage: "none" | "partial";
      durability: "missing_blob" | "none";
      sourceOrigin: "context_capture" | "context_search" | "none";
      capturedAt: string | null;
      snapshotStatus: ContextSnapshot["status"] | null;
      omittedPaths: { path: string; reason: OmissionReason }[];
      omittedReasons: OmissionReason[];
      reindexedPreserved: boolean;
    },
  ): ResolvedEvidence {
    const evidenceRef = {
      projectId: scope.projectId,
      contextId: ref.contextId,
      path: ref.path,
      sha256: ref.sha256,
      chunk: ref.chunk,
      ...(options.omittedReasons.length > 0
        ? { omittedReasons: options.omittedReasons }
        : {}),
    };
    return {
      scope,
      evidence: {
        state: "gap",
        coverage: options.coverage,
        durability: options.durability,
        sourceOrigin: options.sourceOrigin,
        capturedAt: options.capturedAt,
        excerptDigest: null,
        ref: evidenceRef,
        gap: options.gap,
      },
      excerpt: null,
      snapshotStatus: options.snapshotStatus,
      omittedPaths: options.omittedPaths,
      reindexedPreserved: options.reindexedPreserved,
    };
  }

  return {
    resolve(
      scope: IdentityScope,
      ref: Exclude<DecisionEvidenceInput, null>,
    ): ResolvedEvidence {
      const worktree = identity.resolveScope(scope);
      const legacyProjectId = worktree.legacyProjectId;

      const snapshot = selectSnapshot.get(ref.contextId) as
        SnapshotHeaderRow | undefined;
      if (snapshot && snapshot.project_id !== legacyProjectId) {
        // Cross-scope snapshot IDs must be rejected without revealing metadata or bytes.
        throw new GitError("context_source_unavailable");
      }

      if (!snapshot) {
        return buildGap(scope, ref, {
          gap: "source_unavailable",
          coverage: "none",
          durability: "missing_blob",
          sourceOrigin: "context_capture",
          capturedAt: null,
          snapshotStatus: null,
          omittedPaths: [],
          omittedReasons: [],
          reindexedPreserved: false,
        });
      }

      const entryRows = selectEntries.all(ref.contextId) as EntryRow[];
      const entries: Array<{ entry: ContextEntry; blob: string | null }> = [];
      const omittedPaths: { path: string; reason: OmissionReason }[] = [];
      const reasonSet = new Set<OmissionReason>();

      for (const row of entryRows) {
        const entry = JSON.parse(row.payload) as ContextEntry;
        if (entry.path !== row.path) {
          throw new Error("Corrupt context entry");
        }
        entries.push({ entry, blob: row.blob });
        if (entry.outcome === "omitted") {
          omittedPaths.push({ path: entry.path, reason: entry.reason });
          reasonSet.add(entry.reason);
        }
      }
      const omittedReasons = [...reasonSet];

      const matched = entries.find((item) => item.entry.path === ref.path);
      if (!matched) {
        return buildGap(scope, ref, {
          gap: "source_unavailable",
          coverage: snapshot.status === "partial" ? "partial" : "none",
          durability: "missing_blob",
          sourceOrigin: "context_capture",
          capturedAt: snapshot.completed_at,
          snapshotStatus: snapshot.status,
          omittedPaths,
          omittedReasons,
          reindexedPreserved: false,
        });
      }

      const target = matched.entry;
      if (target.outcome === "omitted") {
        const itemReasons = [
          ...new Set<OmissionReason>([target.reason, ...omittedReasons]),
        ];
        return buildGap(scope, ref, {
          gap: "source_omitted",
          coverage: snapshot.status === "partial" ? "partial" : "none",
          durability: "none",
          sourceOrigin: "context_capture",
          capturedAt: snapshot.completed_at,
          snapshotStatus: snapshot.status,
          omittedPaths,
          omittedReasons: itemReasons,
          reindexedPreserved: false,
        });
      }

      if (target.sha256 !== ref.sha256 || matched.blob !== target.sha256) {
        return buildGap(scope, ref, {
          gap: "source_digest_mismatch",
          coverage: "none",
          durability: "missing_blob",
          sourceOrigin: "context_capture",
          capturedAt: snapshot.completed_at,
          snapshotStatus: snapshot.status,
          omittedPaths,
          omittedReasons,
          reindexedPreserved: false,
        });
      }

      const blobRow = selectBlob.get(target.sha256) as BlobRow | undefined;
      if (!blobRow) {
        return buildGap(scope, ref, {
          gap: "source_unavailable",
          coverage: "none",
          durability: "missing_blob",
          sourceOrigin: "context_capture",
          capturedAt: snapshot.completed_at,
          snapshotStatus: snapshot.status,
          omittedPaths,
          omittedReasons,
          reindexedPreserved: false,
        });
      }

      if (
        blobRow.bytes.length !== target.size ||
        sha256(blobRow.bytes) !== target.sha256
      ) {
        return buildGap(scope, ref, {
          gap: "source_digest_mismatch",
          coverage: "none",
          durability: "missing_blob",
          sourceOrigin: "context_capture",
          capturedAt: snapshot.completed_at,
          snapshotStatus: snapshot.status,
          omittedPaths,
          omittedReasons,
          reindexedPreserved: false,
        });
      }

      const coverage: "full" | "partial" =
        snapshot.status === "complete" ? "full" : "partial";
      const indexed = Boolean(selectIndex.get(ref.contextId));

      if (indexed) {
        try {
          const result = contextSearch.readExcerpt(legacyProjectId, {
            contextId: ref.contextId,
            path: ref.path,
            sha256: ref.sha256,
            chunk: ref.chunk,
          });
          const excerptDigest = sha256(result.bytes);
          const excerpt: EvidenceExcerpt = {
            firstLine: result.preview.firstLine,
            lastLine: result.preview.lastLine,
            splitLine: result.preview.splitLine,
            text: result.preview.text,
            bytesLength: result.bytes.length,
            sha256: excerptDigest,
          };
          return {
            scope,
            evidence: {
              state: "verified",
              coverage,
              durability: "durable_blob",
              sourceOrigin: "context_search",
              capturedAt: snapshot.completed_at,
              excerptDigest,
              ref: {
                projectId: scope.projectId,
                contextId: ref.contextId,
                path: ref.path,
                sha256: ref.sha256,
                chunk: ref.chunk,
                ...(omittedReasons.length > 0 ? { omittedReasons } : {}),
              },
              gap: null,
            },
            excerpt,
            snapshotStatus: snapshot.status,
            omittedPaths,
            reindexedPreserved: true,
          };
        } catch (error) {
          if (
            !(error instanceof GitError) ||
            error.code !== "context_source_unavailable"
          ) {
            throw error;
          }
          return buildGap(scope, ref, {
            gap: "source_unavailable",
            coverage: "none",
            durability: "missing_blob",
            sourceOrigin: "context_search",
            capturedAt: snapshot.completed_at,
            snapshotStatus: snapshot.status,
            omittedPaths,
            omittedReasons,
            reindexedPreserved: false,
          });
        }
      }

      const buffer = Buffer.from(blobRow.bytes);
      const chunks = [...chunkSource(buffer)];
      const chunk = chunks[ref.chunk];
      if (!chunk || chunk.endByte - chunk.startByte > maxContextSnippetBytes) {
        return buildGap(scope, ref, {
          gap: "source_unavailable",
          coverage: "none",
          durability: "missing_blob",
          sourceOrigin: "context_capture",
          capturedAt: snapshot.completed_at,
          snapshotStatus: snapshot.status,
          omittedPaths,
          omittedReasons,
          reindexedPreserved: false,
        });
      }

      const slice = buffer.subarray(chunk.startByte, chunk.endByte);
      const excerptDigest = sha256(slice);
      return {
        scope,
        evidence: {
          state: "verified",
          coverage,
          durability: "durable_blob",
          sourceOrigin: "context_capture",
          capturedAt: snapshot.completed_at,
          excerptDigest,
          ref: {
            projectId: scope.projectId,
            contextId: ref.contextId,
            path: ref.path,
            sha256: ref.sha256,
            chunk: ref.chunk,
            ...(omittedReasons.length > 0 ? { omittedReasons } : {}),
          },
          gap: null,
        },
        excerpt: {
          firstLine: chunk.firstLine,
          lastLine: chunk.lastLine,
          splitLine: chunk.splitLine === 1,
          text: slice.toString("utf8"),
          bytesLength: slice.length,
          sha256: excerptDigest,
        },
        snapshotStatus: snapshot.status,
        omittedPaths,
        reindexedPreserved: false,
      };
    },
  };
}
