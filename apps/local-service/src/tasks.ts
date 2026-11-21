import type { DatabaseSync } from "node:sqlite";
import {
  taskPageSize,
  type Task,
  type TaskDraft,
  type TaskEdit,
  type TaskPage,
} from "@laplace/contracts";
import type { createCodexHistory } from "./codex-history.ts";
import { sha256 } from "./context.ts";
import { GitError } from "./git.ts";

export const tasksMigration = `
  CREATE TABLE tasks (
    sequence INTEGER PRIMARY KEY,
    task_id TEXT UNIQUE NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    source_execution_id TEXT REFERENCES codex_history(execution_id),
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    create_digest TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX tasks_project_sequence ON tasks (project_id, sequence DESC);
`;

type Row = Omit<Task, "source"> & {
  sourceExecutionId: string | null;
  sourceContextId: string | null;
  sequence: number;
  createDigest: string;
};

function taskFromRow({
  projectId,
  taskId,
  title,
  objective,
  revision,
  createdAt,
  updatedAt,
  sourceExecutionId,
  sourceContextId,
}: Row): Task {
  return {
    projectId,
    taskId,
    title,
    objective,
    revision,
    createdAt,
    updatedAt,
    source:
      sourceExecutionId && sourceContextId
        ? { executionId: sourceExecutionId, contextId: sourceContextId }
        : null,
  };
}

export function createTaskStore(
  database: DatabaseSync,
  write: <T>(operation: () => T) => T,
  history: ReturnType<typeof createCodexHistory>,
) {
  const select = `
    SELECT task.task_id AS taskId, task.project_id AS projectId, task.title, task.objective,
      task.sequence, task.create_digest AS createDigest, task.revision,
      task.source_execution_id AS sourceExecutionId, run.context_id AS sourceContextId,
      task.created_at AS createdAt, task.updated_at AS updatedAt
    FROM tasks AS task LEFT JOIN codex_history AS run ON task.source_execution_id = run.execution_id
    WHERE task.project_id = ?
  `;
  const find = database.prepare(`${select} AND task.task_id = ?`);
  const list = database.prepare(
    `${select} AND task.sequence < COALESCE(?, task.sequence + 1) ORDER BY task.sequence DESC LIMIT ?`,
  );
  const insert = database.prepare(`
    INSERT INTO tasks (task_id, project_id, source_execution_id, title, objective, create_digest, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(task_id) DO NOTHING
  `);
  const update = database.prepare(`
    UPDATE tasks SET title = ?, objective = ?, revision = revision + 1, updated_at = ?
    WHERE project_id = ? AND task_id = ? AND revision = ?
  `);

  function lookup(projectId: string, taskId: string): Row {
    const row = find.get(projectId, taskId) as Row | undefined;
    if (!row) throw new GitError("task_unavailable");
    return row;
  }

  return {
    list(projectId: string, before: string | null): TaskPage {
      const sequence = before ? lookup(projectId, before).sequence : null;
      const rows = list.all(projectId, sequence, taskPageSize + 1) as Row[];
      const items = rows.slice(0, taskPageSize).map(taskFromRow);
      return {
        projectId,
        items,
        nextBefore: rows.length > items.length ? items.at(-1)!.taskId : null,
      };
    },
    create({ projectId, taskId, title, objective, source }: TaskDraft): Task {
      const digest = sha256(
        Buffer.from(
          JSON.stringify([
            title,
            objective,
            source?.contextId,
            source?.executionId,
          ]),
        ),
      );
      return write(() => {
        const current = find.get(projectId, taskId) as Row | undefined;
        if (current) {
          if (current.createDigest !== digest)
            throw new GitError("task_conflict");
          return taskFromRow(current);
        }
        if (source) {
          const record = history.get({ projectId, ...source });
          if (
            record.state !== "completed" ||
            !record.events.some((event) => event.type === "message")
          )
            throw new GitError("codex_execution_unavailable");
        }
        const now = new Date().toISOString();
        const result = insert.run(
          taskId,
          projectId,
          source?.executionId ?? null,
          title,
          objective,
          digest,
          now,
          now,
        );
        if (result.changes === 0) throw new GitError("task_conflict");
        return taskFromRow(lookup(projectId, taskId));
      });
    },
    update({
      projectId,
      taskId,
      expectedRevision,
      title,
      objective,
    }: TaskEdit): Task {
      return write(() => {
        const current = lookup(projectId, taskId);
        if (current.revision !== expectedRevision)
          throw new GitError("task_conflict");
        update.run(
          title,
          objective,
          new Date().toISOString(),
          projectId,
          taskId,
          expectedRevision,
        );
        return taskFromRow(lookup(projectId, taskId));
      });
    },
  };
}
