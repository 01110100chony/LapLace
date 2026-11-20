import { isProjectId, isRecord } from "./index.ts";

export const contextSchemaVersion = 1;
export const maxContextFiles = 32;
export const maxContextPathBytes = 384;
export const contextBrowseLimit = 100;
export const contextHistoryLimit = 20;

export const omissionReasons = [
  "excluded",
  "sensitive_path",
  "linked_path",
  "nested_project",
  "not_file",
  "missing",
  "unreadable",
  "too_large",
  "total_limit",
  "binary",
  "changed",
  "duplicate_path",
  "capture_invalidated",
] as const;
export type OmissionReason = (typeof omissionReasons)[number];
export type ContextIssue = "repository_changed" | "timeout" | "source_changed";
export type ContextStatus = "complete" | "partial" | "invalidated";
export type IndexEntry = { mode: string; oid: string; stage: number };

export type ContextEntry = { path: string; origin: "working_tree" } & (
  | {
      outcome: "included";
      canonicalPath: string;
      size: number;
      sha256: string;
      contentRef: string;
      index: IndexEntry[];
    }
  | { outcome: "omitted"; reason: OmissionReason }
);

export type ContextSummary = {
  schemaVersion: typeof contextSchemaVersion;
  contextId: string;
  projectId: string;
  head: string | null;
  completedAt: string;
  status: ContextStatus;
  digest: string;
  included: number;
  omitted: number;
};
export type ContextSnapshot = ContextSummary & {
  gitRoot: string;
  worktreeIdentity: string;
  branch: string | null;
  startedAt: string;
  issue: ContextIssue | null;
  selectedIndexDigest: string;
  entries: ContextEntry[];
};
export type ContextBrowse = {
  projectId: string;
  folder: string;
  items: { path: string; kind: "folder" | "file" }[];
  limited: boolean;
};
export type ContextHistory = {
  projectId: string;
  items: ContextSummary[];
  nextBefore: string | null;
};
export type ContextValidation = {
  projectId: string;
  contextId: string;
  state: "matches" | "differs" | "inconclusive";
  checkedAt: string;
};

export type ContextRequests =
  | {
      operation: "context.browse";
      projectId: string;
      folder: string;
      prefix: string;
    }
  | { operation: "context.capture"; projectId: string; paths: string[] }
  | { operation: "context.list"; projectId: string; before: string | null }
  | {
      operation: "context.get" | "context.validate";
      projectId: string;
      contextId: string;
    };

export type ContextResults = {
  "context.browse": ContextBrowse;
  "context.capture": ContextSnapshot;
  "context.list": ContextHistory;
  "context.get": ContextSnapshot;
  "context.validate": ContextValidation;
};

const utf8 = new TextEncoder();
const forbiddenPath = /[\\:*?"<>|\p{Cc}\p{Cs}\uFFFD]/u;
const device =
  /^(?:con|prn|aux|nul|conin\$|conout\$|(?:com|lpt)[1-9¹²³])(?:\.|$)/i;

export function isContextPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxContextPathBytes &&
    utf8.encode(value).length <= maxContextPathBytes &&
    !forbiddenPath.test(value) &&
    value
      .split("/")
      .every((part) => part && !/[. ]$/.test(part) && !device.test(part))
  );
}

export function parseContextRequest(
  value: Record<string, unknown>,
): ContextRequests | undefined {
  const { operation, projectId } = value;
  if (!isProjectId(projectId)) return;
  switch (operation) {
    case "context.browse": {
      const { folder, prefix } = value;
      if (
        (folder === "" || isContextPath(folder)) &&
        typeof prefix === "string" &&
        prefix.length <= 128 &&
        !prefix.includes("/") &&
        !forbiddenPath.test(prefix)
      )
        return { operation, projectId, folder, prefix };
      break;
    }
    case "context.capture": {
      const { paths } = value;
      if (
        Array.isArray(paths) &&
        paths.length > 0 &&
        paths.length <= maxContextFiles &&
        paths.every(isContextPath) &&
        new Set(paths).size === paths.length
      )
        return { operation, projectId, paths };
      break;
    }
    case "context.list":
      if (value.before === null || isProjectId(value.before))
        return { operation, projectId, before: value.before };
      break;
    case "context.get":
    case "context.validate":
      if (isProjectId(value.contextId))
        return { operation, projectId, contextId: value.contextId };
  }
}

function isOid(value: unknown) {
  return (
    typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
  );
}

function isDate(value: unknown) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSummary(
  value: unknown,
): value is ContextSummary & Record<string, unknown> {
  return (
    isRecord(value) &&
    value.schemaVersion === contextSchemaVersion &&
    isProjectId(value.contextId) &&
    isProjectId(value.projectId) &&
    (value.head === null || isOid(value.head)) &&
    isDate(value.completedAt) &&
    isProjectId(value.digest) &&
    isSize(value.included) &&
    isSize(value.omitted) &&
    value.included + value.omitted > 0 &&
    value.included + value.omitted <= maxContextFiles &&
    (value.status === "complete"
      ? value.omitted === 0
      : value.status === "partial"
        ? value.omitted > 0
        : value.status === "invalidated" && value.included === 0)
  );
}

function isEntry(value: unknown): value is ContextEntry {
  if (
    !isRecord(value) ||
    !isContextPath(value.path) ||
    value.origin !== "working_tree"
  )
    return false;
  if (value.outcome === "omitted")
    return omissionReasons.some((reason) => reason === value.reason);
  return (
    value.outcome === "included" &&
    isContextPath(value.canonicalPath) &&
    isSize(value.size) &&
    isProjectId(value.sha256) &&
    value.contentRef === `sha256:${value.sha256}` &&
    Array.isArray(value.index) &&
    value.index.length <= 3 &&
    value.index.every(
      (item: unknown) =>
        isRecord(item) &&
        typeof item.mode === "string" &&
        /^[0-7]{6}$/.test(item.mode) &&
        isOid(item.oid) &&
        (item.stage === 0 ||
          item.stage === 1 ||
          item.stage === 2 ||
          item.stage === 3),
    )
  );
}

export function isContextSnapshot(value: unknown): value is ContextSnapshot {
  if (!isSummary(value)) return false;
  const {
    entries,
    issue,
    gitRoot,
    worktreeIdentity,
    branch,
    startedAt,
    status,
  } = value;
  if (
    typeof gitRoot !== "string" ||
    !gitRoot ||
    typeof worktreeIdentity !== "string" ||
    !worktreeIdentity ||
    !(branch === null || (typeof branch === "string" && branch.length > 0)) ||
    !isDate(startedAt) ||
    !Array.isArray(entries) ||
    !entries.every(isEntry) ||
    entries.length !== value.included + value.omitted ||
    entries.filter((entry) => entry.outcome === "included").length !==
      value.included ||
    !isProjectId(value.selectedIndexDigest)
  )
    return false;
  return status === "invalidated"
    ? issue === "repository_changed" ||
        issue === "timeout" ||
        issue === "source_changed"
    : issue === null;
}

export function isContextResult(
  operation: keyof ContextResults,
  value: unknown,
): boolean {
  if (!isRecord(value) || !isProjectId(value.projectId)) return false;
  switch (operation) {
    case "context.browse":
      return (
        (value.folder === "" || isContextPath(value.folder)) &&
        typeof value.limited === "boolean" &&
        Array.isArray(value.items) &&
        value.items.length <= contextBrowseLimit &&
        value.items.every(
          (item: unknown) =>
            isRecord(item) &&
            isContextPath(item.path) &&
            (item.kind === "folder" || item.kind === "file"),
        )
      );
    case "context.list": {
      const { projectId, items, nextBefore } = value;
      return (
        Array.isArray(items) &&
        items.length <= contextHistoryLimit &&
        items.every(
          (item: unknown) => isSummary(item) && item.projectId === projectId,
        ) &&
        (nextBefore === null ||
          (isProjectId(nextBefore) && items.at(-1)?.contextId === nextBefore))
      );
    }
    case "context.get":
    case "context.capture":
      return isContextSnapshot(value);
    case "context.validate":
      return (
        isProjectId(value.contextId) &&
        isDate(value.checkedAt) &&
        (value.state === "matches" ||
          value.state === "differs" ||
          value.state === "inconclusive")
      );
  }
}
