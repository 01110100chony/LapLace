import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CodexRunEvent } from "@laplace/agents";
import {
  codexMaxEvents,
  codexPageSize,
  isTaskRunActive,
  isTaskRunEvent,
  type ReviewInput,
  type TaskRun,
  type TaskRunPage,
  type TaskRunRef,
  type TaskRunState,
  type TaskRunnerStatus,
  type TaskScope,
  type TaskStart,
} from "@laplace/contracts";
import { GitError } from "./git.ts";
import type {
  CapturedTaskChange,
  createTaskResultStore,
} from "./task-result-store.ts";
import type { createResultReviewStore } from "./result-review.ts";

export const taskExecutionMigration = `
  CREATE UNIQUE INDEX tasks_project_task ON tasks (project_id, task_id);
  CREATE TABLE task_executions (
    sequence INTEGER PRIMARY KEY,
    execution_id TEXT UNIQUE NOT NULL,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    task_revision INTEGER NOT NULL CHECK (task_revision > 0),
    task_title TEXT NOT NULL,
    task_objective TEXT NOT NULL,
    mode TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('running', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted', 'timeout')),
    last_seq INTEGER NOT NULL CHECK (last_seq >= 0),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    owner_id TEXT NOT NULL,
    owner_pid INTEGER NOT NULL CHECK (owner_pid > 0),
    lease_until INTEGER NOT NULL,
    UNIQUE (project_id, request_id),
    FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, task_id),
    CHECK ((state IN ('running', 'cancelling')) = (finished_at IS NULL))
  ) STRICT;
  CREATE INDEX task_executions_task_sequence ON task_executions (project_id, task_id, sequence DESC);
  CREATE UNIQUE INDEX task_executions_one_active ON task_executions ((1)) WHERE state IN ('running', 'cancelling');
  CREATE TABLE task_execution_events (
    execution_id TEXT NOT NULL REFERENCES task_executions(execution_id),
    seq INTEGER NOT NULL CHECK (seq > 0),
    payload TEXT NOT NULL,
    PRIMARY KEY (execution_id, seq)
  ) STRICT, WITHOUT ROWID;
`;

type Transaction = <T>(action: () => T) => T;
type Owner = { id: string; pid: number };
type Row = TaskRun & {
  lastSeq: number;
  ownerId: string;
  ownerPid: number;
  leaseUntil: number;
};
type Terminal = Extract<CodexRunEvent, { type: "terminal" }>;
type AdapterEvent = Exclude<CodexRunEvent, Terminal>;
type Event = CodexRunEvent | { type: "queued" | "cancel_requested" };
const leaseMs = 15_000;

function receipt({
  projectId,
  taskId,
  executionId,
  requestId,
  taskRevision,
  mode,
  state,
  startedAt,
  finishedAt,
}: Row): TaskRun {
  return {
    projectId,
    taskId,
    executionId,
    requestId,
    taskRevision,
    mode,
    state,
    startedAt,
    finishedAt,
  };
}

function ownerUnavailable(row: Row): boolean {
  if (Date.now() >= row.leaseUntil) return true;
  try {
    process.kill(row.ownerPid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

export function createTaskExecutionStore(
  database: DatabaseSync,
  read: Transaction,
  write: Transaction,
  results: ReturnType<typeof createTaskResultStore>,
  reviews: ReturnType<typeof createResultReviewStore>,
) {
  const fields = `project_id AS projectId, task_id AS taskId, execution_id AS executionId,
    request_id AS requestId, task_revision AS taskRevision, mode, state, started_at AS startedAt,
    finished_at AS finishedAt, last_seq AS lastSeq, owner_id AS ownerId, owner_pid AS ownerPid,
    lease_until AS leaseUntil`;
  const findTask = database.prepare(
    "SELECT revision, title, objective FROM tasks WHERE project_id = ? AND task_id = ?",
  );
  const find = database.prepare(
    `SELECT ${fields} FROM task_executions WHERE project_id = ? AND task_id = ? AND execution_id = ?`,
  );
  const latest = database.prepare(
    `SELECT ${fields} FROM task_executions WHERE project_id = ? AND task_id = ? ORDER BY sequence DESC LIMIT 1`,
  );
  const previous = database.prepare(
    `SELECT ${fields} FROM task_executions WHERE project_id = ? AND request_id = ?`,
  );
  const active = database.prepare(
    `SELECT ${fields} FROM task_executions WHERE state IN ('running', 'cancelling')`,
  );
  const insert = database.prepare(`
    INSERT INTO task_executions (execution_id, project_id, task_id, request_id, task_revision,
      task_title, task_objective, mode, state, last_seq, started_at, owner_id, owner_pid, lease_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'mock_development', 'running', 0, ?, ?, ?, ?)
  `);
  const insertEvent = database.prepare(
    "INSERT INTO task_execution_events (execution_id, seq, payload) VALUES (?, ?, ?)",
  );
  const advance = database.prepare(
    "UPDATE task_executions SET last_seq = ?, state = ?, finished_at = ? WHERE execution_id = ?",
  );
  const renew = database.prepare(
    "UPDATE task_executions SET lease_until = ? WHERE execution_id = ?",
  );
  const page = database.prepare(
    `SELECT payload FROM task_execution_events WHERE execution_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
  );

  function lookup({ projectId, taskId, executionId }: TaskRunRef): Row {
    const row = find.get(projectId, taskId, executionId) as Row | undefined;
    if (!row) throw new GitError("task_execution_unavailable");
    return row;
  }

  function task({ projectId, taskId }: TaskScope) {
    const row = findTask.get(projectId, taskId) as
      { revision: number; title: string; objective: string } | undefined;
    if (!row) throw new GitError("task_unavailable");
    return row;
  }

  function record(row: Row, event: Event, state: TaskRunState = row.state) {
    const seq = row.lastSeq + 1;
    const finishedAt =
      event.type === "terminal" ? new Date().toISOString() : null;
    insertEvent.run(row.executionId, seq, JSON.stringify({ ...event, seq }));
    advance.run(seq, state, finishedAt, row.executionId);
    return { ...row, lastSeq: seq, state, finishedAt };
  }

  function reconcileActive() {
    const row = active.get() as Row | undefined;
    // The current adapter runs entirely in its owning process. A real runner
    // must confirm process-tree exit before a lease can release a work area.
    if (row && ownerUnavailable(row)) {
      record(
        row,
        { type: "terminal", state: "interrupted", failure: null },
        "interrupted",
      );
      return;
    }
    return row;
  }

  function recover() {
    const row = active.get() as Row | undefined;
    if (row && ownerUnavailable(row)) write(reconcileActive);
  }

  function owned(ref: TaskRunRef, ownerId: string) {
    const row = lookup(ref);
    if (
      row.ownerId === ownerId &&
      isTaskRunActive(row.state) &&
      Date.now() < row.leaseUntil
    )
      return row;
  }

  return {
    start(
      request: TaskStart,
      owner: Owner | undefined,
    ): { execution: TaskRun; created: boolean } {
      return write(() => {
        const running = reconcileActive();
        const { projectId, taskId, requestId, expectedRevision } = request;
        const existing = previous.get(projectId, requestId) as Row | undefined;
        if (existing) {
          if (
            existing.taskId !== taskId ||
            existing.taskRevision !== expectedRevision
          )
            throw new GitError("task_conflict");
          return { execution: receipt(existing), created: false };
        }
        if (!owner) throw new GitError("task_runner_unavailable");
        const input = task(request);
        if (input.revision !== expectedRevision)
          throw new GitError("task_conflict");
        if (running) throw new GitError("task_busy");
        const executionId = randomUUID();
        insert.run(
          executionId,
          projectId,
          taskId,
          requestId,
          expectedRevision,
          input.title,
          input.objective,
          new Date().toISOString(),
          owner.id,
          owner.pid,
          Date.now() + leaseMs,
        );
        const row = record(lookup({ projectId, taskId, executionId }), {
          type: "queued",
        });
        return { execution: receipt(row), created: true };
      });
    },
    latest(
      scope: TaskScope,
      availableMode: TaskRunnerStatus["availableMode"],
    ): TaskRunnerStatus {
      recover();
      task(scope);
      const { projectId, taskId } = scope;
      const row = latest.get(projectId, taskId) as Row | undefined;
      return {
        projectId,
        taskId,
        availableMode,
        latest: row ? receipt(row) : null,
      };
    },
    events(ref: TaskRunRef, afterSeq: number): TaskRunPage {
      recover();
      return read(() => {
        const row = lookup(ref);
        if (afterSeq > row.lastSeq) throw new GitError("invalid_request");
        const events = page
          .all(row.executionId, afterSeq, codexPageSize)
          .map(({ payload }, index) => {
            const event: unknown = JSON.parse(payload as string);
            if (!isTaskRunEvent(event) || event.seq !== afterSeq + index + 1)
              throw new GitError("task_execution_unavailable");
            return event;
          });
        const nextSeq = afterSeq + events.length;
        return {
          ...receipt(row),
          events,
          nextSeq,
          more: nextSeq < row.lastSeq,
        };
      });
    },
    cancel(ref: TaskRunRef): TaskRun {
      return write(() => {
        reconcileActive();
        const row = lookup(ref);
        return receipt(
          row.state === "running"
            ? record(row, { type: "cancel_requested" }, "cancelling")
            : row,
        );
      });
    },
    heartbeat(ref: TaskRunRef, ownerId: string): TaskRunState | undefined {
      return write(() => {
        const row = owned(ref, ownerId);
        if (!row) return;
        renew.run(Date.now() + leaseMs, row.executionId);
        return row.state;
      });
    },
    append(ref: TaskRunRef, ownerId: string, event: AdapterEvent) {
      return write(() => {
        const row = owned(ref, ownerId);
        if (!row || row.state !== "running") return;
        if (row.lastSeq < codexMaxEvents - 2) record(row, event);
      });
    },
    finish(
      ref: TaskRunRef,
      ownerId: string,
      terminal: Terminal,
      output?: CapturedTaskChange,
    ) {
      return write(() => {
        const row = owned(ref, ownerId);
        if (!row) return;
        const event: Terminal =
          row.state === "cancelling"
            ? { type: "terminal", state: "cancelled", failure: null }
            : terminal;
        const completed = record(row, event, event.state);
        if (event.state === "completed") {
          if (!output)
            throw new Error("Completed task requires captured output");
          results.save(completed, output);
        }
      });
    },
    result(ref: TaskRunRef) {
      return read(() => results.get(lookup(ref)));
    },
    change(ref: TaskRunRef, path: string) {
      return read(() => results.change(lookup(ref), path));
    },
    reviewStatus(ref: TaskRunRef) {
      return read(() => reviews.status(ref, results.evidence(lookup(ref))));
    },
    review(input: ReviewInput) {
      return write(() =>
        reviews.review(input, results.evidence(lookup(input))),
      );
    },
  };
}
