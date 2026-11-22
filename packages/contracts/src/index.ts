export const protocolVersion = 2;
export const maxIpcBytes = 192 * 1024;

export const cloneFailures = [
  "clone_failed",
  "clone_timeout",
  "clone_destination_exists",
  "clone_destination_changed",
  "clone_registration_failed",
  "clone_cleanup_pending",
] as const;

export const errorCodes = [
  "invalid_request",
  "invalid_folder",
  "not_repository",
  "git_missing",
  "permission_denied",
  "git_failed",
  "git_timeout",
  "project_unavailable",
  "project_identity_mismatch",
  "project_identity_unknown",
  "project_already_registered",
  "project_identity_ambiguous",
  "catalog_unavailable",
  "dialog_failed",
  "service_unavailable",
  "ipc_timeout",
  "invalid_response",
  "desktop_required",
  "context_not_found",
  "context_path_unavailable",
  "context_timeout",
  "context_limit",
  "context_not_eligible",
  "context_not_indexed",
  "context_index_failed",
  "context_search_query",
  "context_source_unavailable",
  "codex_selection_invalid",
  "codex_authorization_required",
  "codex_unavailable",
  "codex_busy",
  "codex_execution_unavailable",
  "task_unavailable",
  "task_conflict",
  "task_busy",
  "task_runner_unavailable",
  "task_execution_unavailable",
  "task_result_unavailable",
  "working_changed",
  "working_unavailable",
  "working_conflict",
  "result_review_conflict",
  "decision_unavailable",
  "decision_conflict",
  "decision_authorization_required",
  "decision_purge_pending",
  "resume_stale",
  "clone_unavailable",
  "clone_busy",
  ...cloneFailures,
] as const;

export type ErrorCode = (typeof errorCodes)[number];
export type IpcError = { code: ErrorCode };
export type Health = { version: string; nodeVersion: string };
export type ProjectRecord = {
  id: string;
  name: string;
  root: string;
};
export type GitSummary = {
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
export const gitSource = "git.status";
export const gitSummaryVersion = 1;
export type GitObservation = GitSummary & {
  source: typeof gitSource;
  summaryVersion: typeof gitSummaryVersion;
};
export type Project = ProjectRecord & GitObservation;
export type SelectedProject = ProjectRecord & { cached: GitObservation | null };
export type Catalog = {
  projects: ProjectRecord[];
  selectedProjectId: string | null;
};

export type Results = ContextResults &
  CodexResults &
  TaskResults &
  TaskRunResults &
  TaskResultResults &
  WorkingResults &
  ReviewResults &
  ResumeResults &
  DecisionResults &
  CloneResults & {
    health: Health;
    "workspace.list": Catalog;
    "workspace.addLocal": Project;
    "project.select": SelectedProject;
    "project.inspect": Project;
    "project.relocate": Project;
  };
export type Operation = keyof Results;
type Envelope = { version: typeof protocolVersion; id: string };
export type Request = Envelope &
  (
    | { operation: "health" }
    | { operation: "workspace.list" }
    | { operation: "workspace.addLocal"; path: string }
    | { operation: "project.select" | "project.inspect"; projectId: string }
    | { operation: "project.relocate"; projectId: string; path: string }
    | ContextRequests
    | CodexRequests
    | TaskRequests
    | TaskRunRequests
    | TaskResultRequests
    | WorkingRequests
    | ReviewRequests
    | ResumeRequests
    | DecisionRequests
    | CloneRequests
  );
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
  const clone = parseCloneRequest(value);
  if (clone) return { ...envelope, ...clone };
  const context = parseContextRequest(value);
  if (context) return { ...envelope, ...context };
  const codex = parseCodexRequest(value);
  if (codex) return { ...envelope, ...codex };
  const task = parseTaskRequest(value);
  if (task) return { ...envelope, ...task };
  const execution = parseTaskRunRequest(value);
  if (execution) return { ...envelope, ...execution };
  const result = parseTaskResultRequest(value);
  if (result) return { ...envelope, ...result };
  const working = parseWorkingRequest(value);
  if (working) return { ...envelope, ...working };
  const review = parseReviewRequest(value);
  if (review) return { ...envelope, ...review };
  const resume = parseResumeRequest(value);
  if (resume) return { ...envelope, ...resume };
  const decision = parseDecisionRequest(value);
  if (decision) return { ...envelope, ...decision };
  if (value.operation === "health") return { ...envelope, operation: "health" };
  if (value.operation === "workspace.list")
    return { ...envelope, operation: "workspace.list" };
  if (
    (value.operation === "project.select" ||
      value.operation === "project.inspect") &&
    isProjectId(value.projectId)
  ) {
    return {
      ...envelope,
      operation: value.operation,
      projectId: value.projectId,
    };
  }
  if (
    typeof value.path === "string" &&
    value.path.length > 0 &&
    value.path.length <= 32_767 &&
    !value.path.includes("\0")
  ) {
    if (value.operation === "workspace.addLocal")
      return { ...envelope, operation: value.operation, path: value.path };
    if (value.operation === "project.relocate" && isProjectId(value.projectId))
      return {
        ...envelope,
        operation: value.operation,
        projectId: value.projectId,
        path: value.path,
      };
  }
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isProjectRecord(
  value: unknown,
): value is ProjectRecord & Record<string, unknown> {
  return (
    isRecord(value) &&
    isProjectId(value.id) &&
    nonempty(value.name) &&
    nonempty(value.root)
  );
}

export function isGitObservation(value: unknown): value is GitObservation {
  return (
    isRecord(value) &&
    value.source === gitSource &&
    value.summaryVersion === gitSummaryVersion &&
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

export function isProject(value: unknown): value is Project {
  return isProjectRecord(value) && isGitObservation(value);
}

function isCatalog(value: unknown): value is Catalog {
  if (!isRecord(value) || !Array.isArray(value.projects)) return false;
  const projects: unknown[] = value.projects;
  return (
    projects.every(isProjectRecord) &&
    (value.selectedProjectId === null ||
      projects.some((project) => project.id === value.selectedProjectId))
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
  if (value.ok !== true || value.operation !== operation) return false;
  if (operation === "health") return isHealth(value.data);
  if (
    operation === "clone.prepare" ||
    operation === "clone.start" ||
    operation === "clone.status" ||
    operation === "clone.cancel"
  )
    return isCloneResult(operation, value.data);
  if (operation === "workspace.list") return isCatalog(value.data);
  if (
    operation === "task.create" ||
    operation === "task.update" ||
    operation === "task.list"
  )
    return isTaskResult(operation, value.data);
  if (
    operation === "task.start" ||
    operation === "execution.latest" ||
    operation === "execution.events" ||
    operation === "execution.cancel"
  )
    return isTaskRunResult(operation, value.data);
  if (operation === "execution.result" || operation === "execution.change")
    return isTaskResultResponse(operation, value.data);
  if (
    operation === "working.list" ||
    operation === "working.latest" ||
    operation === "working.capture" ||
    operation === "working.compare"
  )
    return isWorkingResult(operation, value.data);
  if (operation === "result.review" || operation === "result.reviewStatus")
    return isReviewResult(operation, value.data);
  if (operation === "project.identity" || operation === "project.resume")
    return isResumeResult(operation, value.data);
  if (
    operation === "decision.evidenceResolve" ||
    operation === "decision.comparePresent" ||
    operation === "decision.record" ||
    operation === "decision.list" ||
    operation === "decision.get" ||
    operation === "decision.purge"
  )
    return isDecisionResult(operation, value.data);
  if (
    operation === "codex.status" ||
    operation === "codex.prepare" ||
    operation === "codex.approval" ||
    operation === "codex.start" ||
    operation === "codex.events" ||
    operation === "codex.cancel" ||
    operation === "codex.history" ||
    operation === "codex.citation"
  )
    return isCodexResult(operation, value.data);
  if (
    operation === "context.browse" ||
    operation === "context.capture" ||
    operation === "context.list" ||
    operation === "context.get" ||
    operation === "context.validate" ||
    operation === "context.indexStatus" ||
    operation === "context.index" ||
    operation === "context.search" ||
    operation === "context.sourcePreview"
  )
    return isContextResult(operation, value.data);
  if (!isProjectRecord(value.data)) return false;
  if (operation === "project.select")
    return value.data.cached === null || isGitObservation(value.data.cached);
  return isGitObservation(value.data);
}
import {
  isContextResult,
  parseContextRequest,
  type ContextRequests,
  type ContextResults,
} from "./context.ts";

export * from "./context.ts";
export * from "./context-search.ts";
export * from "./codex.ts";
export * from "./tasks.ts";
export * from "./task-execution.ts";
export * from "./task-result.ts";
export * from "./working-tree.ts";
export * from "./result-review.ts";
import {
  isCodexResult,
  parseCodexRequest,
  type CodexRequests,
  type CodexResults,
} from "./codex.ts";
import {
  isTaskResult,
  parseTaskRequest,
  type TaskRequests,
  type TaskResults,
} from "./tasks.ts";
import {
  isTaskRunResult,
  parseTaskRunRequest,
  type TaskRunRequests,
  type TaskRunResults,
} from "./task-execution.ts";
import {
  isTaskResultResponse,
  parseTaskResultRequest,
  type TaskResultRequests,
  type TaskResultResults,
} from "./task-result.ts";
import {
  isWorkingResult,
  parseWorkingRequest,
  type WorkingRequests,
  type WorkingResults,
} from "./working-tree.ts";
import {
  isReviewResult,
  parseReviewRequest,
  type ReviewRequests,
  type ReviewResults,
} from "./result-review.ts";

import {
  isCloneResult,
  parseCloneRequest,
  type CloneRequests,
  type CloneResults,
} from "./clone.ts";
export * from "./clone.ts";
import {
  isResumeResult,
  parseResumeRequest,
  type ResumeRequests,
  type ResumeResults,
} from "./resume.ts";
export * from "./resume.ts";
import {
  isDecisionResult,
  parseDecisionRequest,
  type DecisionRequests,
  type DecisionResults,
} from "./decisions.ts";
export * from "./decisions.ts";
