import type { DatabaseSync } from "node:sqlite";
import {
  isTaskResultResponse,
  taskResultMaxFileBytes,
  type EvidenceSnapshot,
  type TaskBlob,
  type TaskChange,
  type TaskChangePreview,
  type TaskResult,
  type TaskRun,
} from "@laplace/contracts";
import type { createCatalogBlobs } from "./catalog-blobs.ts";
import { isText } from "./context-files.ts";
import { sha256 } from "./context.ts";
import { GitError } from "./git.ts";

export const taskResultMigration = `
  CREATE TABLE task_results (
    execution_id TEXT PRIMARY KEY NOT NULL REFERENCES task_executions(execution_id)
  ) STRICT, WITHOUT ROWID;
  CREATE TABLE task_result_files (
    execution_id TEXT NOT NULL REFERENCES task_results(execution_id),
    path TEXT NOT NULL,
    before_digest TEXT REFERENCES context_blobs(sha256),
    before_size INTEGER,
    after_digest TEXT REFERENCES context_blobs(sha256),
    after_size INTEGER,
    PRIMARY KEY (execution_id, path),
    CHECK ((before_digest IS NULL) = (before_size IS NULL)),
    CHECK ((after_digest IS NULL) = (after_size IS NULL)),
    CHECK (before_size BETWEEN 0 AND ${taskResultMaxFileBytes}),
    CHECK (after_size BETWEEN 0 AND ${taskResultMaxFileBytes}),
    CHECK (before_digest IS NOT after_digest)
  ) STRICT, WITHOUT ROWID;
`;

export type CapturedTaskChange = {
  path: string;
  before: Buffer | null;
  after: Buffer | null;
};
type FileRow = {
  path: string;
  beforeDigest: string | null;
  beforeSize: number | null;
  afterDigest: string | null;
  afterSize: number | null;
};

function descriptor(bytes: Buffer | null): TaskBlob | null {
  if (bytes === null) return null;
  if (bytes.length > taskResultMaxFileBytes || !isText(bytes))
    throw new Error("Task output is not a bounded UTF-8 file");
  return { sha256: sha256(bytes), bytes: bytes.length };
}

export function createTaskResultStore(
  database: DatabaseSync,
  blobs: ReturnType<typeof createCatalogBlobs>,
) {
  const present = database.prepare(
    "SELECT 1 FROM task_results WHERE execution_id = ?",
  );
  const insert = database.prepare(
    "INSERT INTO task_results (execution_id) VALUES (?)",
  );
  const insertFile = database.prepare(`
    INSERT INTO task_result_files (execution_id, path, before_digest, before_size, after_digest, after_size)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const files = database.prepare(`
    SELECT path, before_digest AS beforeDigest, before_size AS beforeSize,
      after_digest AS afterDigest, after_size AS afterSize
    FROM task_result_files WHERE execution_id = ? ORDER BY path
  `);

  function get({
    projectId,
    taskId,
    executionId,
    mode,
    state,
    finishedAt,
  }: TaskRun): TaskResult {
    const scope = { projectId, taskId, executionId };
    if (!present.get(executionId)) return { ...scope, result: null };
    if (state !== "completed" || !finishedAt)
      throw new GitError("task_result_unavailable");
    const changes = (files.all(executionId) as FileRow[]).map(
      (row): TaskChange => ({
        path: row.path,
        before:
          row.beforeDigest === null
            ? null
            : { sha256: row.beforeDigest, bytes: row.beforeSize! },
        after:
          row.afterDigest === null
            ? null
            : { sha256: row.afterDigest, bytes: row.afterSize! },
      }),
    );
    const summary = {
      ...scope,
      result: { mode, capturedAt: finishedAt, changes },
    };
    if (!isTaskResultResponse("execution.result", summary))
      throw new GitError("task_result_unavailable");
    return summary;
  }

  function asText(blob: TaskBlob | null) {
    if (blob === null) return null;
    const bytes = Buffer.from(blobs.read(blob.sha256, blob.bytes));
    if (!isText(bytes)) throw new Error("Invalid stored output");
    return bytes.toString("utf8");
  }

  return {
    save(run: TaskRun, output: CapturedTaskChange) {
      const before = descriptor(output.before);
      const after = descriptor(output.after);
      insert.run(run.executionId);
      if (before?.sha256 === after?.sha256) return;
      if (output.before && before) blobs.save(before.sha256, output.before);
      if (output.after && after) blobs.save(after.sha256, output.after);
      insertFile.run(
        run.executionId,
        output.path,
        before?.sha256 ?? null,
        before?.bytes ?? null,
        after?.sha256 ?? null,
        after?.bytes ?? null,
      );
      get(run);
    },
    get,
    evidence(run: TaskRun): EvidenceSnapshot {
      const artifact = get(run);
      if (!artifact.result) throw new GitError("task_result_unavailable");
      try {
        for (const { before, after } of artifact.result.changes) {
          asText(before);
          asText(after);
        }
      } catch {
        throw new GitError("task_result_unavailable");
      }
      return {
        schemaVersion: 1,
        source: "mock_result",
        capturedAt: artifact.result.capturedAt,
        resultDigest: sha256(JSON.stringify(artifact)),
      };
    },
    change(run: TaskRun, path: string): TaskChangePreview {
      const { result, ...scope } = get(run);
      const change = result?.changes.find((file) => file.path === path);
      if (!change) throw new GitError("task_result_unavailable");
      try {
        return {
          ...scope,
          change,
          beforeText: asText(change.before),
          afterText: asText(change.after),
        };
      } catch {
        throw new GitError("task_result_unavailable");
      }
    },
  };
}
