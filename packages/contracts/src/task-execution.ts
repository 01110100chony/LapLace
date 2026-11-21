import {
  codexMaxEvents,
  codexPageSize,
  codexStates,
  isCodexEvent,
  type CodexEvent,
  type CodexState,
} from "./codex.ts";
import { isContextDate } from "./context.ts";
import { isProjectId, isRecord, isRequestId } from "./index.ts";

export type TaskRunMode = "mock_development";
export type TaskRunState = CodexState | "cancelling";
export type TaskRunEvent =
  CodexEvent | { seq: number; type: "queued" | "cancel_requested" };
export type TaskScope = { projectId: string; taskId: string };
export type TaskRunRef = TaskScope & { executionId: string };
export type TaskRun = TaskRunRef & {
  requestId: string;
  taskRevision: number;
  mode: TaskRunMode;
  state: TaskRunState;
  startedAt: string;
  finishedAt: string | null;
};
export type TaskRunnerStatus = TaskScope & {
  availableMode: TaskRunMode | null;
  latest: TaskRun | null;
};
export type TaskStart = TaskScope & {
  requestId: string;
  expectedRevision: number;
};
export type TaskRunPage = TaskRun & {
  events: TaskRunEvent[];
  nextSeq: number;
  more: boolean;
};
export type TaskRunRequests =
  | (TaskScope & { operation: "execution.latest" })
  | (TaskStart & { operation: "task.start" })
  | (TaskRunRef & { operation: "execution.events"; afterSeq: number })
  | (TaskRunRef & { operation: "execution.cancel" });
export type TaskRunResults = {
  "execution.latest": TaskRunnerStatus;
  "task.start": TaskRun;
  "execution.events": TaskRunPage;
  "execution.cancel": TaskRun;
};

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function isTaskRunActive(state: TaskRunState): boolean {
  return state === "running" || state === "cancelling";
}

export function parseTaskRunRequest(
  value: Record<string, unknown>,
): TaskRunRequests | undefined {
  const {
    operation,
    projectId,
    taskId,
    requestId,
    expectedRevision,
    executionId,
    afterSeq,
  } = value;
  if (!isProjectId(projectId) || !isRequestId(taskId)) return;
  const scope = { projectId, taskId };
  if (operation === "execution.latest") return { operation, ...scope };
  if (
    operation === "task.start" &&
    isRequestId(requestId) &&
    count(expectedRevision) &&
    expectedRevision > 0
  )
    return { operation, ...scope, requestId, expectedRevision };
  if (!isRequestId(executionId)) return;
  if (operation === "execution.cancel")
    return { operation, ...scope, executionId };
  if (
    operation === "execution.events" &&
    count(afterSeq) &&
    afterSeq <= codexMaxEvents
  )
    return { operation, ...scope, executionId, afterSeq };
}

function isTaskRun(value: unknown): value is TaskRun & Record<string, unknown> {
  return (
    isRecord(value) &&
    isProjectId(value.projectId) &&
    isRequestId(value.taskId) &&
    isRequestId(value.executionId) &&
    isRequestId(value.requestId) &&
    count(value.taskRevision) &&
    value.taskRevision > 0 &&
    value.mode === "mock_development" &&
    (value.state === "cancelling" ||
      codexStates.some((state) => state === value.state)) &&
    isContextDate(value.startedAt) &&
    (value.state === "running" || value.state === "cancelling"
      ? value.finishedAt === null
      : isContextDate(value.finishedAt))
  );
}

export function isTaskRunEvent(value: unknown): value is TaskRunEvent {
  return (
    isCodexEvent(value) ||
    (isRecord(value) &&
      (value.type === "queued" || value.type === "cancel_requested") &&
      count(value.seq) &&
      value.seq > 0 &&
      value.seq <= codexMaxEvents)
  );
}

export function isTaskRunResult(
  operation: keyof TaskRunResults,
  value: unknown,
): boolean {
  if (operation === "execution.latest") {
    return (
      isRecord(value) &&
      isProjectId(value.projectId) &&
      isRequestId(value.taskId) &&
      (value.availableMode === null ||
        value.availableMode === "mock_development") &&
      (value.latest === null ||
        (isTaskRun(value.latest) &&
          value.latest.projectId === value.projectId &&
          value.latest.taskId === value.taskId))
    );
  }
  if (!isTaskRun(value)) return false;
  if (operation !== "execution.events") return true;
  const { nextSeq, events, more } = value;
  return (
    count(nextSeq) &&
    nextSeq <= codexMaxEvents &&
    typeof more === "boolean" &&
    Array.isArray(events) &&
    events.length <= codexPageSize &&
    (!more || events.length > 0) &&
    events.every(
      (event, index) =>
        isTaskRunEvent(event) &&
        event.seq === nextSeq - events.length + index + 1,
    )
  );
}
