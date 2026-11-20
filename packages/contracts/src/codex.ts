import { isProjectId, isRecord, isRequestId } from "./index.ts";
import { isContextDate, isContextPath, maxContextFiles } from "./context.ts";

export const codexProvider = "openai";
export const codexMaxSources = 8;
export const codexMaxQuestionBytes = 4096;
export const codexMaxSourceBytes = 64 * 1024;
export const codexMaxPromptBytes = 128 * 1024;
export const codexTimeoutMs = 120_000;
export const codexMaxEvents = 256;
export const codexMaxLineBytes = 24 * 1024;
export const codexMaxOutputBytes = 512 * 1024;
export const codexPageSize = 4;

export type CodexSelection = {
  path: string;
  sha256: string;
  chunk: number | null;
};
type Scope = { projectId: string; contextId: string };
export type CodexPrepare = Scope & {
  snapshotDigest: string;
  question: string;
  selection: CodexSelection[];
};
export const codexAvailability = [
  "missing",
  "unsupported",
  "probe_failed",
  "unauthenticated",
  "confinement_unverified",
  "ready",
] as const;
export type CodexStatus = {
  projectId: string;
  state: (typeof codexAvailability)[number];
  version: string | null;
};
export type CodexSource = CodexSelection & {
  id: string;
  sentSha256: string;
  bytes: number;
  range: {
    startByte: number;
    endByte: number;
    firstLine: number;
    lastLine: number;
    splitLine: boolean;
  } | null;
};
export type CodexManifest = Scope & {
  schemaVersion: 1;
  snapshotDigest: string;
  capturedAt: string;
  provider: typeof codexProvider;
  profile: "read-only";
  question: string;
  sources: CodexSource[];
  omissions: {
    path: string;
    reason: "not_selected" | "snapshot_omission" | "outside_excerpt";
  }[];
  sourceBytes: number;
  promptBytes: number;
  promptSha256: string;
};
export type CodexPreview = CodexManifest & {
  grantId: string;
  manifestDigest: string;
  expiresAt: string;
};
export const codexStates = [
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "timeout",
] as const;
export type CodexState = (typeof codexStates)[number];
export const codexFailures = [
  "launch_failed",
  "provider_failed",
  "protocol_error",
  "output_limit",
  "workspace_failed",
] as const;
export type CodexFailure = (typeof codexFailures)[number];
export type CodexEvent = { seq: number } & (
  | { type: "started" }
  | { type: "session"; sessionId: string }
  | { type: "message"; text: string }
  | { type: "progress"; stage: "turn" | "item" }
  | {
      type: "notice";
      reason: "unknown_event" | "malformed_event" | "provider_error";
    }
  | { type: "usage"; input: number; cachedInput: number; output: number }
  | {
      type: "terminal";
      state: Exclude<CodexState, "running">;
      failure: CodexFailure | null;
    }
);
export type CodexExecution = Scope & {
  executionId: string;
  manifestDigest: string;
};
export type CodexPage = CodexExecution & {
  state: CodexState;
  events: CodexEvent[];
  nextSeq: number;
  more: boolean;
};
export type CodexRequests =
  | { projectId: string; operation: "codex.status" }
  | (Scope &
      (
        | ({ operation: "codex.prepare" } & CodexPrepare)
        | {
            operation: "codex.start";
            grantId: string;
            manifestDigest: string;
            confirmed: true;
          }
        | { operation: "codex.events"; executionId: string; afterSeq: number }
        | { operation: "codex.cancel"; executionId: string }
      ));
export type CodexResults = {
  "codex.status": CodexStatus;
  "codex.prepare": CodexPreview;
  "codex.start": CodexExecution;
  "codex.events": CodexPage;
  "codex.cancel": CodexExecution;
};

const utf8 = new TextEncoder();
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const limit = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  utf8.encode(value).length <= max;
const oneOf = (list: readonly string[], value: unknown) =>
  list.some((item) => item === value);

export function isCodexQuestion(value: unknown): value is string {
  return (
    limit(value, codexMaxQuestionBytes) &&
    value.trim().length > 0 &&
    !/[\0\p{Cs}]/u.test(value)
  );
}

function readSelection(value: unknown): CodexSelection | undefined {
  if (!isRecord(value)) return;
  const { path, sha256, chunk } = value;
  if (
    isContextPath(path) &&
    isProjectId(sha256) &&
    (chunk === null || (count(chunk) && chunk <= 0xffffffff))
  )
    return { path, sha256, chunk };
}

export function parseCodexRequest(
  value: Record<string, unknown>,
): CodexRequests | undefined {
  const {
    operation,
    projectId,
    contextId,
    snapshotDigest,
    question,
    selection,
    grantId,
    manifestDigest,
    confirmed,
    executionId,
    afterSeq,
  } = value;
  if (!isProjectId(projectId)) return;
  if (operation === "codex.status") return { operation, projectId };
  if (!isProjectId(contextId)) return;
  const scope = { projectId, contextId };
  switch (operation) {
    case "codex.prepare": {
      if (
        !isProjectId(snapshotDigest) ||
        !isCodexQuestion(question) ||
        !Array.isArray(selection) ||
        !selection.length ||
        selection.length > codexMaxSources
      )
        return;
      const entries = selection.map(readSelection);
      if (
        !entries.every((entry) => entry !== undefined) ||
        new Set(entries.map(({ path }) => path)).size !== entries.length
      )
        return;
      return {
        operation,
        ...scope,
        snapshotDigest,
        question,
        selection: entries,
      };
    }
    case "codex.start":
      if (
        isRequestId(grantId) &&
        isProjectId(manifestDigest) &&
        confirmed === true
      )
        return { operation, ...scope, grantId, manifestDigest, confirmed };
      break;
    case "codex.events":
      if (
        isRequestId(executionId) &&
        count(afterSeq) &&
        afterSeq <= codexMaxEvents
      )
        return { operation, ...scope, executionId, afterSeq };
      break;
    case "codex.cancel":
      if (isRequestId(executionId)) return { operation, ...scope, executionId };
      break;
  }
}

function isSource(value: unknown): boolean {
  if (!isRecord(value) || !readSelection(value)) return false;
  const { range, bytes, id, sentSha256 } = value;
  return (
    isRequestId(id) &&
    isProjectId(sentSha256) &&
    count(bytes) &&
    bytes <= codexMaxSourceBytes &&
    (value.chunk === null
      ? range === null && sentSha256 === value.sha256
      : isRecord(range) &&
        count(range.startByte) &&
        count(range.endByte) &&
        range.endByte - range.startByte === bytes &&
        count(range.firstLine) &&
        range.firstLine > 0 &&
        count(range.lastLine) &&
        range.lastLine >= range.firstLine &&
        typeof range.splitLine === "boolean")
  );
}

function isEvent(value: unknown): value is CodexEvent {
  if (
    !isRecord(value) ||
    !count(value.seq) ||
    value.seq < 1 ||
    value.seq > codexMaxEvents
  )
    return false;
  switch (value.type) {
    case "started":
      return true;
    case "session":
      return isRequestId(value.sessionId);
    case "message":
      return limit(value.text, codexMaxLineBytes);
    case "progress":
      return oneOf(["turn", "item"], value.stage);
    case "notice":
      return oneOf(
        ["unknown_event", "malformed_event", "provider_error"],
        value.reason,
      );
    case "usage":
      return (
        count(value.input) && count(value.cachedInput) && count(value.output)
      );
    case "terminal":
      return (
        value.state !== "running" &&
        oneOf(codexStates, value.state) &&
        (value.failure === null || oneOf(codexFailures, value.failure))
      );
    default:
      return false;
  }
}

export function isCodexResult(
  operation: keyof CodexResults,
  value: unknown,
): boolean {
  if (!isRecord(value) || !isProjectId(value.projectId)) return false;
  if (operation === "codex.status")
    return (
      oneOf(codexAvailability, value.state) &&
      (value.version === null || limit(value.version, 64))
    );
  if (!isProjectId(value.contextId) || !isProjectId(value.manifestDigest))
    return false;
  if (operation === "codex.prepare") {
    return (
      value.schemaVersion === 1 &&
      value.provider === codexProvider &&
      value.profile === "read-only" &&
      isProjectId(value.snapshotDigest) &&
      isContextDate(value.capturedAt) &&
      isContextDate(value.expiresAt) &&
      isRequestId(value.grantId) &&
      isCodexQuestion(value.question) &&
      count(value.sourceBytes) &&
      value.sourceBytes <= codexMaxSourceBytes &&
      count(value.promptBytes) &&
      value.promptBytes <= codexMaxPromptBytes &&
      isProjectId(value.promptSha256) &&
      Array.isArray(value.sources) &&
      value.sources.length > 0 &&
      value.sources.length <= codexMaxSources &&
      value.sources.every(isSource) &&
      Array.isArray(value.omissions) &&
      value.omissions.length <= maxContextFiles &&
      value.omissions.every(
        (item: unknown) =>
          isRecord(item) &&
          isContextPath(item.path) &&
          oneOf(
            ["not_selected", "snapshot_omission", "outside_excerpt"],
            item.reason,
          ),
      )
    );
  }
  if (!isRequestId(value.executionId)) return false;
  if (operation !== "codex.events") return true;
  return (
    oneOf(codexStates, value.state) &&
    count(value.nextSeq) &&
    value.nextSeq <= codexMaxEvents &&
    typeof value.more === "boolean" &&
    Array.isArray(value.events) &&
    value.events.length <= codexPageSize &&
    value.events.every(isEvent) &&
    (!value.events.length ||
      value.events.every(
        (event, i) =>
          event.seq ===
          (value.nextSeq as number) -
            (value.events as unknown[]).length +
            i +
            1,
      ))
  );
}
