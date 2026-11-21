import {
  isContextDate,
  isContextPath,
  omissionReasons,
  type OmissionReason,
} from "./context.ts";
import { isProjectId, isRecord } from "./index.ts";

export const workingListLimit = 80;
export const workingSelectionLimit = 16;
export const workingMaxTextBytes = 12 * 1024;

export type WorkingChange = {
  path: string;
  from: string | null;
  status: string;
  kind: "tracked" | "renamed" | "conflicted" | "untracked";
  submodule: boolean;
  untracked: boolean;
};
export type WorkingList = {
  projectId: string;
  head: string | null;
  observedAt: string;
  changes: WorkingChange[];
  limited: boolean;
};
export type WorkingVersion =
  | { kind: "absent" }
  | {
      kind: "omitted";
      reason: OmissionReason;
      oid: string | null;
      mode: string | null;
      size: number | null;
    }
  | {
      kind: "text";
      sha256: string;
      size: number;
      oid: string | null;
      mode: string | null;
    };
export type WorkingFile = WorkingChange & {
  head: WorkingVersion;
  index: { stage: number; version: WorkingVersion }[];
  disk: WorkingVersion;
};
export type WorkingRef = { projectId: string; snapshotId: string };
export type WorkingSnapshot = WorkingRef & {
  schemaVersion: 1;
  head: string | null;
  branch: string | null;
  capturedAt: string;
  digest: string;
  files: WorkingFile[];
};
export type WorkingLayer = "staged" | "unstaged";
export type WorkingComparison = WorkingRef & {
  path: string;
  layer: WorkingLayer;
  before: WorkingVersion;
  after: WorkingVersion;
  beforeText: string | null;
  afterText: string | null;
};
export type WorkingRequests =
  | { operation: "working.list" | "working.latest"; projectId: string }
  | { operation: "working.capture"; projectId: string; paths: string[] }
  | ({
      operation: "working.compare";
      path: string;
      layer: WorkingLayer;
    } & WorkingRef);
export type WorkingResults = {
  "working.list": WorkingList;
  "working.capture": WorkingSnapshot;
  "working.latest": { projectId: string; snapshot: WorkingSnapshot | null };
  "working.compare": WorkingComparison;
};

const utf8 = new TextEncoder();
export function isGitObjectId(value: unknown): value is string {
  return (
    typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
  );
}

export function parseWorkingRequest(
  value: Record<string, unknown>,
): WorkingRequests | undefined {
  const { operation, projectId, paths, path, layer, snapshotId } = value;
  if (!isProjectId(projectId)) return;
  if (operation === "working.list" || operation === "working.latest")
    return { operation, projectId };
  if (
    operation === "working.capture" &&
    Array.isArray(paths) &&
    paths.length > 0 &&
    paths.length <= workingSelectionLimit &&
    paths.every(isContextPath) &&
    new Set(paths).size === paths.length
  )
    return { operation, projectId, paths };
  if (
    operation === "working.compare" &&
    isProjectId(snapshotId) &&
    isContextPath(path) &&
    (layer === "staged" || layer === "unstaged")
  )
    return { operation, projectId, snapshotId, path, layer };
}

function isChange(
  value: unknown,
): value is WorkingChange & Record<string, unknown> {
  if (
    !isRecord(value) ||
    !isContextPath(value.path) ||
    typeof value.submodule !== "boolean" ||
    typeof value.untracked !== "boolean"
  )
    return false;
  if (value.kind === "untracked")
    return (
      value.from === null &&
      value.status === "??" &&
      value.untracked &&
      !value.submodule
    );
  if (typeof value.status !== "string" || !/^[A-Z.]{2}$/.test(value.status))
    return false;
  return value.kind === "renamed"
    ? isContextPath(value.from)
    : (value.kind === "conflicted" || value.kind === "tracked") &&
        value.from === null;
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isVersion(value: unknown): value is WorkingVersion {
  if (!isRecord(value)) return false;
  if (value.kind === "absent") return true;
  if (
    (value.oid !== null && !isGitObjectId(value.oid)) ||
    (value.mode !== null &&
      (typeof value.mode !== "string" || !/^[0-7]{6}$/.test(value.mode)))
  )
    return false;
  if (value.kind === "text")
    return (
      isProjectId(value.sha256) &&
      isSize(value.size) &&
      value.size <= workingMaxTextBytes
    );
  return (
    value.kind === "omitted" &&
    omissionReasons.some((reason) => reason === value.reason) &&
    (value.size === null || isSize(value.size))
  );
}

function isFile(value: unknown): value is WorkingFile {
  if (
    !isRecord(value) ||
    !isChange(value) ||
    !isVersion(value.head) ||
    !isVersion(value.disk) ||
    !Array.isArray(value.index)
  )
    return false;
  const entries: unknown[] = value.index;
  const stages = entries.map((item) =>
    isRecord(item) && isVersion(item.version) && item.version.kind !== "absent"
      ? item.stage
      : null,
  );
  return value.kind === "conflicted"
    ? stages.length > 0 &&
        new Set(stages).size === stages.length &&
        stages.every((stage) => stage === 1 || stage === 2 || stage === 3)
    : stages.length === 0 || (stages.length === 1 && stages[0] === 0);
}

export function isWorkingSnapshot(value: unknown): value is WorkingSnapshot {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    isProjectId(value.projectId) &&
    isProjectId(value.snapshotId) &&
    isProjectId(value.digest) &&
    isContextDate(value.capturedAt) &&
    (value.head === null || isGitObjectId(value.head)) &&
    (value.branch === null ||
      (typeof value.branch === "string" && value.branch.length <= 1024)) &&
    Array.isArray(value.files) &&
    value.files.length > 0 &&
    value.files.length <= workingSelectionLimit &&
    value.files.every(isFile) &&
    new Set(value.files.map((file) => file.path)).size === value.files.length
  );
}

function matchesText(version: WorkingVersion, text: unknown) {
  return version.kind === "text"
    ? typeof text === "string" &&
        text.length <= version.size &&
        utf8.encode(text).length === version.size
    : text === null;
}

export function isWorkingResult(
  operation: keyof WorkingResults,
  value: unknown,
): boolean {
  if (!isRecord(value) || !isProjectId(value.projectId)) return false;
  switch (operation) {
    case "working.list":
      return (
        (value.head === null || isGitObjectId(value.head)) &&
        isContextDate(value.observedAt) &&
        typeof value.limited === "boolean" &&
        Array.isArray(value.changes) &&
        value.changes.length <= workingListLimit &&
        value.changes.every(isChange)
      );
    case "working.capture":
      return isWorkingSnapshot(value);
    case "working.latest":
      return (
        value.snapshot === null ||
        (isWorkingSnapshot(value.snapshot) &&
          value.snapshot.projectId === value.projectId)
      );
    case "working.compare":
      return (
        isProjectId(value.snapshotId) &&
        isContextPath(value.path) &&
        (value.layer === "staged" || value.layer === "unstaged") &&
        isVersion(value.before) &&
        isVersion(value.after) &&
        matchesText(value.before, value.beforeText) &&
        matchesText(value.after, value.afterText)
      );
  }
}
