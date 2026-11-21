import type { DatabaseSync } from "node:sqlite";
import {
  codexHistoryPageSize,
  codexMaxEvents,
  codexPageSize,
  isCodexEvent,
  isCodexManifest,
  type CodexCitation,
  type CodexCitations,
  type CodexEvent,
  type CodexExecution,
  type CodexHistory,
  type CodexHistoryItem,
  type CodexManifest,
  type CodexPage,
  type CodexSource,
  type CodexState,
} from "@laplace/contracts";
import type { createContextStore } from "./context-store.ts";
import { sha256 } from "./context.ts";
import { GitError } from "./git.ts";

export const codexHistoryMigration = `
  CREATE TABLE codex_history (
    sequence INTEGER PRIMARY KEY,
    execution_id TEXT UNIQUE NOT NULL,
    context_id TEXT NOT NULL REFERENCES context_snapshots(context_id),
    manifest_digest TEXT NOT NULL,
    manifest TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('completed', 'failed', 'cancelled', 'interrupted', 'timeout')),
    finished_at TEXT NOT NULL,
    events TEXT NOT NULL
  ) STRICT;
  CREATE INDEX codex_history_context_sequence ON codex_history (context_id, sequence DESC);
`;

export type CodexRecord = {
  execution: CodexExecution;
  manifest: CodexManifest;
  events: CodexEvent[];
  state: CodexState;
  saved?: boolean;
};
type Scope = Pick<CodexExecution, "projectId" | "contextId">;
type Ref = Scope & Pick<CodexExecution, "executionId">;
type Context = ReturnType<typeof createContextStore>;

function verifiedBytes(
  context: Context,
  manifest: CodexManifest,
  source: CodexSource,
) {
  const { projectId, contextId } = manifest;
  try {
    const bytes = Buffer.from(
      context.readSource(
        projectId,
        contextId,
        source.path,
        source.sha256,
        manifest.snapshotDigest,
      ),
    );
    const excerpt = source.range
      ? bytes.subarray(source.range.startByte, source.range.endByte)
      : bytes;
    if (
      excerpt.length === source.bytes &&
      sha256(excerpt) === source.sentSha256
    )
      return excerpt;
  } catch {
    // A stale or damaged capture cannot back a verified citation.
  }
}

function citationIds(text: string) {
  return new Set(
    Array.from(text.matchAll(/\[(source-\d+)\]/g), ([, id]) => id!),
  );
}

export function codexPage(
  record: CodexRecord,
  afterSeq: number,
  context?: Context,
): CodexPage {
  const { execution, state, saved, events, manifest } = record;
  if (afterSeq > events.length) throw new GitError("invalid_request");
  const page = events.slice(afterSeq, afterSeq + codexPageSize);
  const nextSeq = afterSeq + page.length;
  // Verify a source at most once per page. Historical results are checked
  // against the saved capture again on every open.
  const verified = new Map<string, boolean>();
  return {
    ...execution,
    state,
    saved,
    events: page.map((event) => {
      if (event.type !== "message" || !context) return event;
      const citations: CodexCitations = { sources: [], hasUnknown: false };
      const ids = citationIds(event.text);
      for (const source of manifest.sources) {
        if (!ids.delete(source.id)) continue;
        if (!verified.has(source.id))
          verified.set(
            source.id,
            verifiedBytes(context, manifest, source) !== undefined,
          );
        citations.sources.push({
          id: source.id,
          path: source.path,
          verified: verified.get(source.id) === true,
        });
      }
      citations.hasUnknown = ids.size > 0;
      return { ...event, citations };
    }),
    nextSeq,
    more: nextSeq < events.length,
  };
}

export function createCodexHistory(database: DatabaseSync, context: Context) {
  const insert = database.prepare(`
    INSERT INTO codex_history (execution_id, context_id, manifest_digest, manifest, state, finished_at, events)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const inScope = `
    FROM codex_history AS run JOIN context_snapshots AS snapshot USING (context_id)
    WHERE snapshot.project_id = ? AND run.context_id = ?
  `;
  const list = database.prepare(`
    SELECT run.execution_id AS executionId, run.manifest_digest AS manifestDigest,
      json_extract(run.manifest, '$.mode') AS mode,
      json_extract(run.manifest, '$.question') AS question,
      run.state, run.finished_at AS finishedAt
    ${inScope}
    AND run.sequence < COALESCE(?, run.sequence + 1)
    ORDER BY run.sequence DESC LIMIT ?
  `);
  const find = database.prepare(`
    SELECT run.sequence, run.manifest_digest AS digest, run.manifest, run.state, run.events
    ${inScope} AND run.execution_id = ?
  `);

  function lookup({ projectId, contextId, executionId }: Ref) {
    const row = find.get(projectId, contextId, executionId);
    if (!row) throw new GitError("codex_execution_unavailable");
    return row as {
      sequence: number;
      digest: string;
      manifest: string;
      state: string;
      events: string;
    };
  }

  return {
    save({ execution, manifest, events, state }: CodexRecord) {
      if (state === "running") throw new Error("Cannot store an active run");
      insert.run(
        execution.executionId,
        execution.contextId,
        execution.manifestDigest,
        JSON.stringify(manifest),
        state,
        new Date().toISOString(),
        JSON.stringify(events),
      );
    },
    list({ projectId, contextId }: Scope, before: string | null): CodexHistory {
      const scope = { projectId, contextId };
      const sequence = before
        ? lookup({ ...scope, executionId: before }).sequence
        : null;
      const rows = list.all(
        projectId,
        contextId,
        sequence,
        codexHistoryPageSize + 1,
      ) as Omit<CodexHistoryItem, keyof Scope>[];
      const items = rows
        .slice(0, codexHistoryPageSize)
        .map((row) => ({ ...scope, ...row }));
      return {
        ...scope,
        items,
        nextBefore:
          rows.length > items.length ? items.at(-1)!.executionId : null,
      };
    },
    get(ref: Ref): CodexRecord {
      const row = lookup(ref);
      const manifest: unknown = JSON.parse(row.manifest);
      const events: unknown = JSON.parse(row.events);
      if (
        !isCodexManifest(manifest) ||
        manifest.projectId !== ref.projectId ||
        manifest.contextId !== ref.contextId ||
        sha256(Buffer.from(row.manifest)) !== row.digest ||
        !Array.isArray(events) ||
        events.length > codexMaxEvents ||
        !events.every((event, i) => isCodexEvent(event) && event.seq === i + 1)
      )
        throw new GitError("codex_execution_unavailable");
      const terminal: CodexEvent | undefined = events.at(-1);
      if (terminal?.type !== "terminal" || terminal.state !== row.state)
        throw new GitError("codex_execution_unavailable");
      return {
        execution: {
          projectId: ref.projectId,
          contextId: ref.contextId,
          executionId: ref.executionId,
          mode: manifest.mode,
          manifestDigest: row.digest,
        },
        manifest,
        events,
        state: terminal.state,
        saved: true,
      };
    },
    page(record: CodexRecord, afterSeq: number) {
      return codexPage(record, afterSeq, context);
    },
    citation(record: CodexRecord, sourceId: string): CodexCitation {
      const { manifest, execution, events } = record;
      const source = manifest.sources.find(({ id }) => id === sourceId);
      if (
        !source ||
        !events.some(
          (event) =>
            event.type === "message" && citationIds(event.text).has(sourceId),
        )
      )
        throw new GitError("context_not_found");
      const bytes = verifiedBytes(context, manifest, source);
      if (!bytes) throw new GitError("context_not_found");
      return { ...execution, source, text: bytes.toString("utf8") };
    },
  };
}
