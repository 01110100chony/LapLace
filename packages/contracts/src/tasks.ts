import { isProjectId, isRecord, isRequestId } from "./index.ts";
import { isContextDate } from "./context.ts";

export const taskPageSize = 6;
export const taskTitleBytes = 160;
export const taskObjectiveBytes = 4096;

export type TaskSource = {
  contextId: string;
  executionId: string;
};
type Scope = { projectId: string; taskId: string };
type Fields = { title: string; objective: string };
export type TaskDraft = Scope & Fields & { source: TaskSource | null };
export type TaskEdit = Scope & Fields & { expectedRevision: number };
export type Task = TaskDraft & {
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type TaskPage = {
  projectId: string;
  items: Task[];
  nextBefore: string | null;
};
export type TaskRequests =
  | ({ operation: "task.create" } & TaskDraft)
  | ({ operation: "task.update" } & TaskEdit)
  | { operation: "task.list"; projectId: string; before: string | null };
export type TaskResults = {
  "task.create": Task;
  "task.update": Task;
  "task.list": TaskPage;
};

const utf8 = new TextEncoder();

function taskText(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= limit &&
    utf8.encode(value).length <= limit &&
    value.trim().length > 0 &&
    !/[\0\p{Cs}]/u.test(value)
  );
}

export function isTaskTitle(value: unknown): value is string {
  return taskText(value, taskTitleBytes) && !/[\r\n]/.test(value);
}

export function isTaskObjective(value: unknown): value is string {
  return taskText(value, taskObjectiveBytes);
}

function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSource(value: unknown): value is TaskSource {
  return (
    isRecord(value) &&
    isProjectId(value.contextId) &&
    isRequestId(value.executionId)
  );
}

export function parseTaskRequest(
  value: Record<string, unknown>,
): TaskRequests | undefined {
  const {
    operation,
    projectId,
    taskId,
    title,
    objective,
    before,
    source,
    expectedRevision,
  } = value;
  if (!isProjectId(projectId)) return;
  if (operation === "task.list") {
    if (before === null || isRequestId(before))
      return { operation, projectId, before };
    return;
  }
  if (
    !isRequestId(taskId) ||
    !isTaskTitle(title) ||
    !isTaskObjective(objective)
  )
    return;
  const draft = {
    projectId,
    taskId,
    title: title.trim(),
    objective: objective.trim(),
  };
  if (operation === "task.create" && (source === null || isSource(source))) {
    return {
      operation,
      ...draft,
      source: source && {
        contextId: source.contextId,
        executionId: source.executionId,
      },
    };
  }
  if (operation === "task.update" && revision(expectedRevision))
    return { operation, ...draft, expectedRevision };
}

function isTask(value: unknown): value is Task {
  return (
    isRecord(value) &&
    isProjectId(value.projectId) &&
    isRequestId(value.taskId) &&
    isTaskTitle(value.title) &&
    isTaskObjective(value.objective) &&
    (value.source === null || isSource(value.source)) &&
    revision(value.revision) &&
    isContextDate(value.createdAt) &&
    isContextDate(value.updatedAt)
  );
}

export function isTaskResult(
  operation: keyof TaskResults,
  value: unknown,
): boolean {
  if (operation !== "task.list") return isTask(value);
  if (!isRecord(value) || !isProjectId(value.projectId)) return false;
  const { projectId, items, nextBefore } = value;
  return (
    Array.isArray(items) &&
    items.length <= taskPageSize &&
    items.every(
      (item: unknown) => isTask(item) && item.projectId === projectId,
    ) &&
    (nextBefore === null ||
      (isRequestId(nextBefore) && nextBefore === items.at(-1)?.taskId))
  );
}
