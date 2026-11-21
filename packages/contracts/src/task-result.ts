import { isContextDate, isContextPath } from "./context.ts";
import { isProjectId, isRecord, isRequestId } from "./index.ts";
import type { TaskRunRef } from "./task-execution.ts";

// A preview carries both versions in one IPC response, including JSON escaping.
export const taskResultMaxFileBytes = 12 * 1024;
export const taskResultMaxFiles = 16;

export type TaskBlob = { sha256: string; bytes: number };
export type TaskChange = {
  path: string;
  before: TaskBlob | null;
  after: TaskBlob | null;
};
export type TaskResult = TaskRunRef & {
  result: {
    mode: "mock_development";
    capturedAt: string;
    changes: TaskChange[];
  } | null;
};
export type TaskChangePreview = TaskRunRef & {
  change: TaskChange;
  beforeText: string | null;
  afterText: string | null;
};
export type TaskResultRequests = TaskRunRef &
  (
    | { operation: "execution.result" }
    | { operation: "execution.change"; path: string }
  );
export type TaskResultResults = {
  "execution.result": TaskResult;
  "execution.change": TaskChangePreview;
};

const utf8 = new TextEncoder();

function isRef(value: Record<string, unknown>): boolean {
  return (
    isProjectId(value.projectId) &&
    isRequestId(value.taskId) &&
    isRequestId(value.executionId)
  );
}

export function parseTaskResultRequest(
  value: Record<string, unknown>,
): TaskResultRequests | undefined {
  const { operation, projectId, taskId, executionId, path } = value;
  if (
    !isProjectId(projectId) ||
    !isRequestId(taskId) ||
    !isRequestId(executionId)
  )
    return;
  const scope = { projectId, taskId, executionId };
  if (operation === "execution.result") return { operation, ...scope };
  if (operation === "execution.change" && isContextPath(path))
    return { operation, ...scope, path };
}

function isBlob(value: unknown): value is TaskBlob {
  return (
    isRecord(value) &&
    isProjectId(value.sha256) &&
    typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0 &&
    value.bytes <= taskResultMaxFileBytes
  );
}

function isChange(value: unknown): value is TaskChange {
  return (
    isRecord(value) &&
    isContextPath(value.path) &&
    (value.before === null || isBlob(value.before)) &&
    (value.after === null || isBlob(value.after)) &&
    value.before?.sha256 !== value.after?.sha256
  );
}

function matchesSize(text: unknown, blob: TaskBlob | null): boolean {
  return blob === null
    ? text === null
    : typeof text === "string" &&
        text.length <= blob.bytes &&
        utf8.encode(text).length === blob.bytes;
}

export function isTaskResultResponse(
  operation: keyof TaskResultResults,
  value: unknown,
): boolean {
  if (!isRecord(value) || !isRef(value)) return false;
  if (operation === "execution.change")
    return (
      isChange(value.change) &&
      matchesSize(value.beforeText, value.change.before) &&
      matchesSize(value.afterText, value.change.after)
    );
  const { result } = value;
  return (
    result === null ||
    (isRecord(result) &&
      result.mode === "mock_development" &&
      isContextDate(result.capturedAt) &&
      Array.isArray(result.changes) &&
      result.changes.length <= taskResultMaxFiles &&
      result.changes.every(isChange))
  );
}
