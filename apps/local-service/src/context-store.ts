import type { DatabaseSync } from "node:sqlite";
import {
  contextHistoryLimit,
  isContextSnapshot,
  type ContextEntry,
  type ContextHistory,
  type ContextSnapshot,
  type ContextSummary,
} from "@laplace/contracts";
import { manifestDigest, sha256 } from "./context.ts";
import { GitError } from "./git.ts";

export const contextMigration = `
  CREATE TABLE context_blobs (
    sha256 TEXT PRIMARY KEY NOT NULL CHECK (length(sha256) = 64),
    bytes BLOB NOT NULL
  ) STRICT, WITHOUT ROWID;
  CREATE TABLE context_snapshots (
    sequence INTEGER PRIMARY KEY,
    context_id TEXT UNIQUE NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    schema_version INTEGER NOT NULL,
    git_root TEXT NOT NULL,
    worktree_identity TEXT NOT NULL,
    branch TEXT,
    head TEXT,
    selected_index_digest TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'invalidated')),
    issue TEXT,
    digest TEXT NOT NULL,
    included INTEGER NOT NULL CHECK (included >= 0),
    omitted INTEGER NOT NULL CHECK (omitted >= 0)
  ) STRICT;
  CREATE INDEX context_snapshots_project_sequence
    ON context_snapshots (project_id, sequence DESC);
  CREATE TABLE context_entries (
    context_id TEXT NOT NULL REFERENCES context_snapshots(context_id),
    ordinal INTEGER NOT NULL,
    path TEXT NOT NULL,
    blob_sha256 TEXT REFERENCES context_blobs(sha256),
    payload TEXT NOT NULL,
    PRIMARY KEY (context_id, ordinal),
    UNIQUE (context_id, path)
  ) STRICT, WITHOUT ROWID;
`;

export function createContextStore(
  database: DatabaseSync,
  transaction: <T>(write: () => T) => T,
  lookup: (id: string) => { root: string; identity: string | null },
) {
  const summaryColumns = `
    schema_version AS schemaVersion, context_id AS contextId,
    project_id AS projectId, head, completed_at AS completedAt,
    status, digest, included, omitted
  `;
  const getHeader = database.prepare(`
    SELECT ${summaryColumns}, git_root AS gitRoot, worktree_identity AS worktreeIdentity,
      branch, started_at AS startedAt, issue, selected_index_digest AS selectedIndexDigest
    FROM context_snapshots WHERE project_id = ? AND context_id = ?
  `);
  const getEntries = database.prepare(`
    SELECT path, blob_sha256 AS blob, payload FROM context_entries
    WHERE context_id = ? ORDER BY ordinal
  `);
  const getSequence = database.prepare(`
    SELECT sequence FROM context_snapshots WHERE project_id = ? AND context_id = ?
  `);
  getSequence.setReadBigInts(true);
  const listHeaders = database.prepare(`
    SELECT ${summaryColumns} FROM context_snapshots
    WHERE project_id = ? AND sequence <= ?
    ORDER BY sequence DESC LIMIT ?
  `);
  const insertHeader = database.prepare(`
    INSERT INTO context_snapshots (
      context_id, project_id, schema_version, git_root, worktree_identity, branch, head,
      selected_index_digest, started_at, completed_at, status, issue, digest, included, omitted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBlob = database.prepare(`
    INSERT INTO context_blobs (sha256, bytes) VALUES (?, ?) ON CONFLICT(sha256) DO NOTHING
  `);
  const getBlob = database.prepare(
    "SELECT bytes FROM context_blobs WHERE sha256 = ?",
  );
  const insertEntry = database.prepare(`
    INSERT INTO context_entries (context_id, ordinal, path, blob_sha256, payload)
    VALUES (?, ?, ?, ?, ?)
  `);

  function get(projectId: string, contextId: string): ContextSnapshot {
    const header = getHeader.get(projectId, contextId);
    if (!header) throw new GitError("context_not_found");
    const entries = getEntries.all(contextId).map((row) => {
      const entry = JSON.parse(row.payload as string) as ContextEntry;
      if (
        entry.path !== row.path ||
        (entry.outcome === "included" ? entry.sha256 : null) !== row.blob
      )
        throw new Error("Corrupt context entry");
      return entry;
    });
    const snapshot = { ...header, entries };
    if (
      !isContextSnapshot(snapshot) ||
      snapshot.digest !== manifestDigest(snapshot)
    )
      throw new Error("Invalid context manifest");
    return snapshot;
  }

  return {
    save({
      snapshot,
      blobs,
    }: {
      snapshot: ContextSnapshot;
      blobs: Map<string, Buffer>;
    }) {
      return transaction(() => {
        const project = lookup(snapshot.projectId);
        if (
          project.root !== snapshot.gitRoot ||
          project.identity !== snapshot.worktreeIdentity
        )
          throw new GitError("project_identity_mismatch");
        const {
          contextId,
          projectId,
          schemaVersion,
          gitRoot,
          worktreeIdentity,
          branch,
          head,
          selectedIndexDigest,
          startedAt,
          completedAt,
          status,
          issue,
          digest,
          included,
          omitted,
        } = snapshot;
        if (!isContextSnapshot(snapshot) || digest !== manifestDigest(snapshot))
          throw new Error("Invalid context manifest");
        insertHeader.run(
          contextId,
          projectId,
          schemaVersion,
          gitRoot,
          worktreeIdentity,
          branch,
          head,
          selectedIndexDigest,
          startedAt,
          completedAt,
          status,
          issue,
          digest,
          included,
          omitted,
        );
        const stored = new Set<string>();
        for (const [ordinal, entry] of snapshot.entries.entries()) {
          const blob = entry.outcome === "included" ? entry.sha256 : null;
          if (blob && entry.outcome === "included" && !stored.has(blob)) {
            const bytes = blobs.get(blob);
            if (!bytes || bytes.length !== entry.size || sha256(bytes) !== blob)
              throw new Error("Missing or invalid captured bytes");
            insertBlob.run(blob, bytes);
            const saved = getBlob.get(blob)?.bytes as Uint8Array | undefined;
            if (!saved || !bytes.equals(saved))
              throw new Error("Invalid stored blob");
            stored.add(blob);
          }
          insertEntry.run(
            contextId,
            ordinal,
            entry.path,
            blob,
            JSON.stringify(entry),
          );
        }
        return snapshot;
      });
    },
    list(projectId: string, before: string | null): ContextHistory {
      lookup(projectId);
      let sequence = 9_223_372_036_854_775_807n;
      if (before) {
        const anchor = getSequence.get(projectId, before);
        if (!anchor) throw new GitError("context_not_found");
        sequence = (anchor.sequence as bigint) - 1n;
      }
      const items = listHeaders.all(
        projectId,
        sequence,
        contextHistoryLimit + 1,
      ) as ContextSummary[];
      const nextBefore =
        items.length > contextHistoryLimit
          ? items[contextHistoryLimit - 1]!.contextId
          : null;
      return {
        projectId,
        items: items.slice(0, contextHistoryLimit),
        nextBefore,
      };
    },
    get,
    readSource(
      projectId: string,
      contextId: string,
      path: string,
      expectedDigest?: string,
    ) {
      const entry = get(projectId, contextId).entries.find(
        (entry) => entry.path === path,
      );
      if (
        entry?.outcome !== "included" ||
        (expectedDigest && entry.sha256 !== expectedDigest)
      )
        throw new GitError("context_not_found");
      const bytes = getBlob.get(entry.sha256)?.bytes as Uint8Array | undefined;
      if (
        !bytes ||
        bytes.length !== entry.size ||
        sha256(bytes) !== entry.sha256
      )
        throw new Error("Invalid stored blob");
      return bytes;
    },
  };
}
