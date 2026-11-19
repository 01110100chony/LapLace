export const protocolVersion = 1;
export const maxIpcBytes = 192 * 1024;

export const errorCodes = [
  "invalid_request",
  "invalid_folder",
  "not_repository",
  "git_missing",
  "permission_denied",
  "git_failed",
  "git_timeout",
  "project_unavailable",
  "dialog_failed",
  "service_unavailable",
  "ipc_timeout",
  "invalid_response",
  "desktop_required",
] as const;

export type ErrorCode = (typeof errorCodes)[number];
export type IpcError = { code: ErrorCode };
export type Health = { version: string; nodeVersion: string };
export type Project = {
  id: string;
  name: string;
  root: string;
  branch: string | null;
  head: string | null;
  changes: {
    staged: number;
    unstaged: number;
    untracked: number;
    conflicted: number;
  };
  observedAt: string;
};

export type Results = {
  health: Health;
  "workspace.addLocal": Project;
  "project.inspect": Project;
};
export type Operation = keyof Results;
export type ProjectOperation = Exclude<Operation, "health">;

type Envelope = { version: typeof protocolVersion; id: string };
export type Request = Envelope &
  ({ operation: "health" } | { operation: ProjectOperation; path: string });
export type Response<K extends Operation = Operation> =
  | { [P in K]: Envelope & { operation: P; ok: true; data: Results[P] } }[K]
  | (Envelope & { ok: false; error: IpcError });

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(value);
}

export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function isIpcError(value: unknown): value is IpcError {
  return isRecord(value) && errorCodes.some((code) => code === value.code);
}

export function parseRequest(value: unknown): Request | undefined {
  if (
    !isRecord(value) ||
    value.version !== protocolVersion ||
    !isRequestId(value.id)
  ) {
    return;
  }
  const envelope = { id: value.id, version: protocolVersion } as const;
  if (value.operation === "health") return { ...envelope, operation: "health" };
  if (
    (value.operation === "workspace.addLocal" ||
      value.operation === "project.inspect") &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    value.path.length <= 32_767 &&
    !value.path.includes("\0")
  ) {
    return { ...envelope, operation: value.operation, path: value.path };
  }
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    isProjectId(value.id) &&
    nonempty(value.name) &&
    nonempty(value.root) &&
    (value.branch === null || nonempty(value.branch)) &&
    (value.head === null ||
      (typeof value.head === "string" &&
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.head))) &&
    nonempty(value.observedAt) &&
    Number.isFinite(Date.parse(value.observedAt)) &&
    isRecord(value.changes) &&
    count(value.changes.staged) &&
    count(value.changes.unstaged) &&
    count(value.changes.untracked) &&
    count(value.changes.conflicted)
  );
}

function isHealth(value: unknown): value is Health {
  return (
    isRecord(value) && nonempty(value.version) && nonempty(value.nodeVersion)
  );
}

export function isResponse<K extends Operation>(
  value: unknown,
  id: string,
  operation: K,
): value is Response<K> {
  if (!isRecord(value) || value.version !== protocolVersion || value.id !== id)
    return false;
  if (value.ok === false) return isIpcError(value.error);
  return (
    value.ok === true &&
    value.operation === operation &&
    (operation === "health" ? isHealth(value.data) : isProject(value.data))
  );
}
