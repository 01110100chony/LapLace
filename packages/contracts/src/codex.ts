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
export const codexHistoryPageSize = 6;

export const codexModes = [
  "verified_isolated",
  "mock_development",
  "unconfined_workspace_development",
] as const;
export type CodexMode = (typeof codexModes)[number];

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
  "mock_ready",
  "workspace_ready",
] as const;
export type CodexStatus = {
  projectId: string;
  mode: CodexMode;
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
  mode: CodexMode;
  snapshotDigest: string;
  capturedAt: string;
  provider: typeof codexProvider | "mock";
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
  "authentication_failed",
  "provider_failed",
  "protocol_error",
  "output_limit",
  "workspace_failed",
] as const;
export type CodexFailure = (typeof codexFailures)[number];
export type CodexCitations = {
  sources: { id: string; path: string; verified: boolean }[];
  hasUnknown: boolean;
};
export type CodexEvent = { seq: number } & (
  | { type: "started" }
  | { type: "session"; sessionId: string }
  | { type: "message"; text: string; citations?: CodexCitations }
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
  mode: CodexMode;
  executionId: string;
  manifestDigest: string;
};
type Grant = Scope & { grantId: string; manifestDigest: string };
export type CodexApproval = Grant & {
  mode: CodexMode;
  projectName: string;
  snapshotDigest: string;
  sources: { path: string; bytes: number }[];
  sourceBytes: number;
  promptBytes: number;
};
export type CodexPage = CodexExecution & {
  state: CodexState;
  events: CodexEvent[];
  nextSeq: number;
  more: boolean;
  saved?: boolean;
};
export type CodexHistoryItem = CodexExecution & {
  question: string;
  state: Exclude<CodexState, "running">;
  finishedAt: string;
};
export type CodexHistory = Scope & {
  items: CodexHistoryItem[];
  nextBefore: string | null;
};
export type CodexCitation = CodexExecution & {
  source: CodexSource;
  text: string;
};
export type CodexRequests =
  | { projectId: string; operation: "codex.status" }
  | (Scope &
      (
        | ({ operation: "codex.prepare" } & CodexPrepare)
        | ({ operation: "codex.approval" } & Grant)
        | ({
            operation: "codex.start";
            confirmed: true;
            unconfinedConfirmed?: true;
          } & Grant)
        | { operation: "codex.events"; executionId: string; afterSeq: number }
        | { operation: "codex.cancel"; executionId: string }
        | { operation: "codex.history"; before: string | null }
        | { operation: "codex.citation"; executionId: string; sourceId: string }
      ));
export type CodexResults = {
  "codex.status": CodexStatus;
  "codex.prepare": CodexPreview;
  "codex.approval": CodexApproval;
  "codex.start": CodexExecution;
  "codex.events": CodexPage;
  "codex.cancel": CodexExecution;
  "codex.history": CodexHistory;
  "codex.citation": CodexCitation;
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

function isSourceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^source-[1-9]\d?$/.test(value) &&
    Number(value.slice(7)) <= codexMaxSources
  );
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
    unconfinedConfirmed,
    executionId,
    afterSeq,
    before,
    sourceId,
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
    case "codex.approval":
    case "codex.start": {
      if (!isRequestId(grantId) || !isProjectId(manifestDigest)) return;
      const grant = { ...scope, grantId, manifestDigest };
      if (operation === "codex.approval") return { operation, ...grant };
      if (
        confirmed === true &&
        (unconfinedConfirmed === undefined || unconfinedConfirmed === true)
      )
        return { operation, ...grant, confirmed, unconfinedConfirmed };
      break;
    }
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
    case "codex.history":
      if (before === null || isRequestId(before))
        return { operation, ...scope, before };
      break;
    case "codex.citation":
      if (isRequestId(executionId) && isSourceId(sourceId))
        return { operation, ...scope, executionId, sourceId };
      break;
  }
}

function isSource(value: unknown): value is CodexSource {
  if (!isRecord(value) || !readSelection(value)) return false;
  const { range, bytes, id, sentSha256 } = value;
  return (
    isSourceId(id) &&
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

function isCitations(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.hasUnknown === "boolean" &&
    Array.isArray(value.sources) &&
    value.sources.length <= codexMaxSources &&
    value.sources.every(
      (source: unknown) =>
        isRecord(source) &&
        isSourceId(source.id) &&
        isContextPath(source.path) &&
        typeof source.verified === "boolean",
    )
  );
}

export function isCodexEvent(value: unknown): value is CodexEvent {
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
      return (
        limit(value.text, codexMaxLineBytes) &&
        (value.citations === undefined || isCitations(value.citations))
      );
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

export function isCodexManifest(value: unknown): value is CodexManifest {
  return (
    isRecord(value) &&
    isProjectId(value.projectId) &&
    isProjectId(value.contextId) &&
    oneOf(codexModes, value.mode) &&
    value.schemaVersion === 1 &&
    value.provider ===
      (value.mode === "mock_development" ? "mock" : codexProvider) &&
    value.profile === "read-only" &&
    isProjectId(value.snapshotDigest) &&
    isContextDate(value.capturedAt) &&
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
    value.sources.every(
      (source, index) => source.id === `source-${index + 1}`,
    ) &&
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

export function isCodexResult(
  operation: keyof CodexResults,
  value: unknown,
): boolean {
  if (!isRecord(value) || !isProjectId(value.projectId)) return false;
  if (operation === "codex.history") {
    const { contextId, projectId, items, nextBefore } = value;
    return (
      isProjectId(contextId) &&
      Array.isArray(items) &&
      items.length <= codexHistoryPageSize &&
      items.every(
        (item: unknown) =>
          isRecord(item) &&
          item.projectId === projectId &&
          item.contextId === contextId &&
          isRequestId(item.executionId) &&
          isProjectId(item.manifestDigest) &&
          oneOf(codexModes, item.mode) &&
          isCodexQuestion(item.question) &&
          isContextDate(item.finishedAt) &&
          item.state !== "running" &&
          oneOf(codexStates, item.state),
      ) &&
      (nextBefore === null ||
        (isRequestId(nextBefore) && nextBefore === items.at(-1)?.executionId))
    );
  }
  if (!oneOf(codexModes, value.mode)) return false;
  if (operation === "codex.status")
    return (
      oneOf(codexAvailability, value.state) &&
      (value.mode === "mock_development") === (value.state === "mock_ready") &&
      (value.state !== "ready" || value.mode === "verified_isolated") &&
      (value.state !== "workspace_ready" ||
        value.mode === "unconfined_workspace_development") &&
      (value.version === null || limit(value.version, 64))
    );
  if (!isProjectId(value.contextId) || !isProjectId(value.manifestDigest))
    return false;
  if (operation === "codex.approval") {
    return (
      isRequestId(value.grantId) &&
      isProjectId(value.snapshotDigest) &&
      limit(value.projectName, 4096) &&
      count(value.sourceBytes) &&
      value.sourceBytes <= codexMaxSourceBytes &&
      count(value.promptBytes) &&
      value.promptBytes <= codexMaxPromptBytes &&
      Array.isArray(value.sources) &&
      value.sources.length > 0 &&
      value.sources.length <= codexMaxSources &&
      value.sources.every(
        (source: unknown) =>
          isRecord(source) &&
          isContextPath(source.path) &&
          count(source.bytes) &&
          source.bytes <= codexMaxSourceBytes,
      )
    );
  }
  if (operation === "codex.prepare") {
    return (
      isContextDate(value.expiresAt) &&
      isRequestId(value.grantId) &&
      isCodexManifest(value)
    );
  }
  if (!isRequestId(value.executionId)) return false;
  if (operation === "codex.citation")
    return (
      isSource(value.source) &&
      limit(value.text, codexMaxSourceBytes) &&
      utf8.encode(value.text).length === value.source.bytes
    );
  if (operation !== "codex.events") return true;
  return (
    oneOf(codexStates, value.state) &&
    count(value.nextSeq) &&
    value.nextSeq <= codexMaxEvents &&
    typeof value.more === "boolean" &&
    (value.saved === undefined ||
      (value.state !== "running" && typeof value.saved === "boolean")) &&
    Array.isArray(value.events) &&
    value.events.length <= codexPageSize &&
    value.events.every(isCodexEvent) &&
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
