import type { DatabaseSync } from "node:sqlite";
import {
  contextSearchPageSize,
  isContextSummary,
  maxContextQueryTerms,
  maxContextSearchOffset,
  maxContextSnippetBytes,
  type ContextIndexStatus,
  type ContextSearchHit,
  type ContextSearchInput,
  type ContextSearchPage,
  type ContextSearchScope,
  type ContextSourcePreview,
  type ContextSourceRef,
  type ContextSummary,
} from "@laplace/contracts";
import { chunkSource, type Chunk } from "./context-chunks.ts";
import type { createContextStore } from "./context-store.ts";
import { GitError } from "./git.ts";

export const contextSearchMigration = `
  CREATE TABLE context_search_indexes (
    context_id TEXT PRIMARY KEY NOT NULL REFERENCES context_snapshots(context_id) ON DELETE CASCADE,
    indexed_at TEXT NOT NULL,
    files INTEGER NOT NULL CHECK (files > 0),
    chunks INTEGER NOT NULL CHECK (chunks >= files)
  ) STRICT, WITHOUT ROWID;
  CREATE TABLE context_search_documents (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL REFERENCES context_blobs(sha256),
    UNIQUE (project_id, path, sha256)
  ) STRICT;
  CREATE TABLE context_search_chunks (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES context_search_documents(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    start_byte INTEGER NOT NULL CHECK (start_byte >= 0),
    end_byte INTEGER NOT NULL CHECK (end_byte >= start_byte),
    first_line INTEGER NOT NULL CHECK (first_line > 0),
    last_line INTEGER NOT NULL CHECK (last_line >= first_line),
    split_line INTEGER NOT NULL CHECK (split_line IN (0, 1)),
    UNIQUE (document_id, ordinal)
  ) STRICT;
  CREATE INDEX context_entries_search_source
    ON context_entries(path, blob_sha256, context_id) WHERE blob_sha256 IS NOT NULL;
  CREATE VIRTUAL TABLE context_fts USING fts5(
    project_key, name, path, body,
    content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER context_search_delete_chunk AFTER DELETE ON context_search_chunks
    BEGIN DELETE FROM context_fts WHERE rowid = OLD.id; END;
`;

const summaryColumns = `
  snapshot.schema_version AS schemaVersion, snapshot.context_id AS contextId,
  snapshot.project_id AS projectId, snapshot.completed_at AS completedAt,
  snapshot.head, snapshot.status, snapshot.digest, snapshot.included, snapshot.omitted
`;
const chunkColumns = `
  chunk.ordinal AS chunk, chunk.start_byte AS startByte, chunk.end_byte AS endByte,
  chunk.first_line AS firstLine, chunk.last_line AS lastLine, chunk.split_line AS splitLine
`;
const eligibility =
  "snapshot.status IN ('complete', 'partial') AND snapshot.included > 0";
type Transaction = <T>(run: () => T) => T;
type Location = Chunk & { chunk: number };
type HitRow = ContextSummary & Location & { path: string; sha256: string };

function matchQuery(projectId: string, query: string) {
  const terms = query.match(/[\p{L}\p{N}\p{Co}][\p{L}\p{N}\p{M}\p{Co}]*/gu);
  if (!terms || terms.length > maxContextQueryTerms)
    throw new GitError("context_search_query");
  return `project_key:"${projectId}" AND {name path body} : (${terms
    .map((term) => `"${term}"`)
    .join(" AND ")})`;
}

function excerpt(
  bytes: Buffer,
  { startByte, endByte, firstLine, lastLine, splitLine }: Location,
) {
  if (endByte > bytes.length || endByte - startByte > maxContextSnippetBytes)
    throw new GitError("context_source_unavailable");
  return {
    firstLine,
    lastLine,
    splitLine: splitLine === 1,
    text: bytes.toString("utf8", startByte, endByte),
  };
}

export function createContextSearch(
  database: DatabaseSync,
  context: ReturnType<typeof createContextStore>,
  read: Transaction,
  write: Transaction,
) {
  const latest = database.prepare(`
    SELECT ${summaryColumns} FROM context_snapshots AS snapshot
    WHERE snapshot.project_id = ? AND ${eligibility} ORDER BY snapshot.sequence DESC LIMIT 1
  `);
  const summaryById = database.prepare(`
    SELECT ${summaryColumns} FROM context_snapshots AS snapshot
    WHERE snapshot.project_id = ? AND snapshot.context_id = ?
  `);
  const readIndex = database.prepare(`
    SELECT indexed_at AS indexedAt, files, chunks FROM context_search_indexes WHERE context_id = ?
  `);
  const saveIndex = database.prepare(`
    INSERT INTO context_search_indexes (context_id, indexed_at, files, chunks) VALUES (?, ?, ?, ?)
    ON CONFLICT (context_id) DO UPDATE SET
      indexed_at = excluded.indexed_at, files = excluded.files, chunks = excluded.chunks
  `);
  const findDocument = database.prepare(`
    SELECT document.id, (SELECT count(*) FROM context_search_chunks WHERE document_id = document.id) AS chunks
    FROM context_search_documents AS document WHERE project_id = ? AND path = ? AND sha256 = ?
  `);
  const insertDocument = database.prepare(`
    INSERT INTO context_search_documents(project_id, path, sha256) VALUES (?, ?, ?)
  `);
  const deleteChunks = database.prepare(
    "DELETE FROM context_search_chunks WHERE document_id = ?",
  );
  const insertChunk = database.prepare(`
    INSERT INTO context_search_chunks
      (document_id, ordinal, start_byte, end_byte, first_line, last_line, split_line)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertText = database.prepare(`
    INSERT INTO context_fts(rowid, project_key, name, path, body) VALUES (?, ?, ?, ?, ?)
  `);
  const coverage = database.prepare(`
    SELECT count(*) AS eligible, count(indexed.context_id) AS indexed
    FROM context_snapshots AS snapshot
    LEFT JOIN context_search_indexes AS indexed USING (context_id)
    WHERE snapshot.project_id = ? AND ${eligibility}
  `);
  const joinSources = `
    JOIN context_search_documents AS doc ON doc.id = chunk.document_id
    JOIN context_entries AS entry ON entry.path = doc.path AND entry.blob_sha256 = doc.sha256
    JOIN context_snapshots AS snapshot ON snapshot.context_id = entry.context_id
      AND snapshot.project_id = doc.project_id
    JOIN context_search_indexes AS indexed ON indexed.context_id = snapshot.context_id
  `;
  const findHits = database.prepare(`
    SELECT ${summaryColumns}, ${chunkColumns}, doc.path, doc.sha256
    FROM context_fts JOIN context_search_chunks AS chunk ON chunk.id = context_fts.rowid
    ${joinSources}
    WHERE context_fts MATCH ? AND snapshot.project_id = ? AND ${eligibility}
      AND (? IS NULL OR snapshot.context_id = ?)
    ORDER BY bm25(context_fts, 0.0, 12.0, 5.0, 1.0), snapshot.sequence DESC, doc.path, chunk.ordinal
    LIMIT ? OFFSET ?
  `);
  const locateChunk = database.prepare(`
    SELECT ${chunkColumns} FROM context_search_chunks AS chunk
    ${joinSources}
    WHERE snapshot.project_id = ? AND snapshot.context_id = ? AND ${eligibility}
      AND doc.path = ? AND doc.sha256 = ? AND chunk.ordinal = ?
  `);

  function latestSnapshot(projectId: string): ContextSummary | undefined {
    const snapshot = latest.get(projectId);
    if (!snapshot || isContextSummary(snapshot)) return snapshot;
    throw new GitError("context_source_unavailable");
  }

  function status(
    projectId: string,
    snapshot: ContextSummary,
  ): ContextIndexStatus {
    const { contextId, included } = snapshot;
    const stored = readIndex.get(contextId) as
      Pick<ContextIndexStatus, "indexedAt" | "files" | "chunks"> | undefined;
    return {
      projectId,
      contextId,
      eligible: snapshot.status !== "invalidated" && included > 0,
      ...(stored ?? { indexedAt: null, files: 0, chunks: 0 }),
    };
  }

  function source(projectId: string, ref: Omit<ContextSourceRef, "chunk">) {
    try {
      return Buffer.from(
        context.readSource(projectId, ref.contextId, ref.path, ref.sha256),
      );
    } catch {
      throw new GitError("context_source_unavailable");
    }
  }

  return {
    status(projectId: string, contextId: string | null) {
      return read(() => {
        const snapshot = contextId
          ? context.get(projectId, contextId)
          : latestSnapshot(projectId);
        if (!snapshot) throw new GitError("context_not_found");
        return status(projectId, snapshot);
      });
    },

    index(
      projectId: string,
      contextId: string,
      force: boolean,
    ): ContextIndexStatus {
      const deadline = performance.now() + 10_000;
      try {
        return write(() => {
          const snapshot = context.get(projectId, contextId);
          const previous = status(projectId, snapshot);
          if (!previous.eligible) throw new GitError("context_not_eligible");
          if (previous.indexedAt && !force) return previous;

          let chunks = 0;
          for (const entry of snapshot.entries) {
            if (entry.outcome !== "included") continue;
            const { path, sha256 } = entry;
            const bytes = source(projectId, { contextId, path, sha256 });
            const doc = findDocument.get(projectId, path, sha256) as
              { id: number; chunks: number } | undefined;
            if (doc && !force && doc.chunks) {
              chunks += doc.chunks;
              continue;
            }
            const documentId =
              doc?.id ??
              insertDocument.run(projectId, path, sha256).lastInsertRowid;
            if (doc) deleteChunks.run(documentId);
            const name = path.split("/").at(-1)!;
            let ordinal = 0;
            for (const chunk of chunkSource(bytes)) {
              if (performance.now() >= deadline)
                throw new GitError("context_timeout");
              const row = insertChunk.run(
                documentId,
                ordinal,
                chunk.startByte,
                chunk.endByte,
                chunk.firstLine,
                chunk.lastLine,
                chunk.splitLine,
              );
              // One filename hit per source, even for a long file with many chunks.
              insertText.run(
                row.lastInsertRowid,
                projectId,
                ordinal === 0 ? name : "",
                ordinal === 0 ? path : "",
                bytes.toString("utf8", chunk.startByte, chunk.endByte),
              );
              ordinal++;
            }
            chunks += ordinal;
          }
          const indexedAt = new Date().toISOString();
          saveIndex.run(contextId, indexedAt, snapshot.included, chunks);
          return { ...previous, indexedAt, files: snapshot.included, chunks };
        });
      } catch (error) {
        if (error instanceof GitError) throw error;
        throw new GitError("context_index_failed");
      }
    },

    search(projectId: string, input: ContextSearchInput): ContextSearchPage {
      const { query, offset } = input;
      const scope: ContextSearchScope =
        input.scope === "snapshot"
          ? { scope: input.scope, contextId: input.contextId }
          : { scope: input.scope, contextId: null };
      const match = matchQuery(projectId, query);
      return read(() => {
        const newest = latestSnapshot(projectId);
        const snapshot =
          scope.scope === "history"
            ? null
            : scope.scope === "latest"
              ? newest
              : (summaryById.get(projectId, scope.contextId) as
                  ContextSummary | undefined);
        if (scope.scope !== "history" && !snapshot)
          throw new GitError("context_not_found");
        if (snapshot) {
          const { eligible, indexedAt } = status(projectId, snapshot);
          if (!eligible) throw new GitError("context_not_eligible");
          if (!indexedAt) throw new GitError("context_not_indexed");
        }
        let rows: HitRow[];
        const target = snapshot?.contextId ?? null;
        try {
          rows = findHits.all(
            match,
            projectId,
            target,
            target,
            contextSearchPageSize + 1,
            offset,
          ) as HitRow[];
        } catch (error) {
          if (
            error instanceof Error &&
            /fts5: (?:syntax error|unterminated)/i.test(error.message)
          )
            throw new GitError("context_search_query");
          throw error;
        }
        const sources = new Map<string, Buffer>();
        const items = rows
          .slice(0, contextSearchPageSize)
          .map((row): ContextSearchHit => {
            const {
              contextId,
              path,
              sha256,
              chunk,
              startByte,
              endByte,
              firstLine,
              lastLine,
              splitLine,
              ...snap
            } = row;
            const key = `${contextId}/${path}`;
            const bytes =
              sources.get(key) ??
              source(projectId, { contextId, path, sha256 });
            sources.set(key, bytes);
            return {
              contextId,
              path,
              sha256,
              chunk,
              snapshot: { contextId, ...snap },
              origin: newest?.contextId === contextId ? "latest" : "historical",
              ...excerpt(bytes, {
                chunk,
                startByte,
                endByte,
                firstLine,
                lastLine,
                splitLine,
              }),
            };
          });
        const counts = snapshot
          ? { eligible: 1, indexed: 1 }
          : (coverage.get(projectId) as { eligible: number; indexed: number });
        return {
          projectId,
          ...scope,
          snapshot: snapshot ?? null,
          ...counts,
          items,
          nextOffset:
            rows.length > contextSearchPageSize &&
            offset < maxContextSearchOffset
              ? offset + contextSearchPageSize
              : null,
        };
      });
    },

    readExcerpt(projectId: string, ref: ContextSourceRef) {
      return read(() => {
        const { contextId, path, sha256, chunk } = ref;
        const location = locateChunk.get(
          projectId,
          contextId,
          path,
          sha256,
          chunk,
        ) as Location | undefined;
        if (!location) throw new GitError("context_source_unavailable");
        const bytes = source(projectId, ref);
        const { text, ...lines } = excerpt(bytes, location);
        const { startByte, endByte } = location;
        return {
          preview: {
            projectId,
            ...ref,
            ...lines,
            text,
          } satisfies ContextSourcePreview,
          startByte,
          endByte,
          bytes: bytes.subarray(startByte, endByte),
        };
      });
    },
  };
}
