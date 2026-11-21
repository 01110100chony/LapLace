import { isContextDate } from "./context.ts";
import { isProjectId, isRecord, isRequestId } from "./index.ts";
import type { TaskRunRef } from "./task-execution.ts";

export type ReviewChoice = "approved" | "rejected";
export type EvidenceSnapshot = {
  schemaVersion: 1;
  source: "mock_result";
  capturedAt: string;
  resultDigest: string;
};
export type ReviewReceipt = {
  evidence: EvidenceSnapshot;
  choice: ReviewChoice;
  revision: number;
  recordedAt: string;
};
export type ResultReview = TaskRunRef & {
  evidence: EvidenceSnapshot;
  latest: ReviewReceipt | null;
};
export type ReviewInput = TaskRunRef & {
  requestId: string;
  expectedBase: string;
  expectedRevision: number;
  choice: ReviewChoice;
};
export type ReviewRequests =
  | ({ operation: "result.reviewStatus" } & TaskRunRef)
  | ({ operation: "result.review" } & ReviewInput);
export type ReviewResults = {
  "result.reviewStatus": ResultReview;
  "result.review": TaskRunRef & ReviewReceipt;
};

function isChoice(value: unknown): value is ReviewChoice {
  return value === "approved" || value === "rejected";
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseReviewRequest(
  value: Record<string, unknown>,
): ReviewRequests | undefined {
  const {
    operation,
    projectId,
    taskId,
    executionId,
    requestId,
    expectedBase,
    expectedRevision,
    choice,
  } = value;
  if (
    !isProjectId(projectId) ||
    !isRequestId(taskId) ||
    !isRequestId(executionId)
  )
    return;
  const scope = { projectId, taskId, executionId };
  if (operation === "result.reviewStatus") return { operation, ...scope };
  if (
    operation === "result.review" &&
    isRequestId(requestId) &&
    isProjectId(expectedBase) &&
    isRevision(expectedRevision) &&
    isChoice(choice)
  )
    return {
      operation,
      ...scope,
      requestId,
      expectedBase,
      expectedRevision,
      choice,
    };
}

function isEvidence(value: unknown): value is EvidenceSnapshot {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.source === "mock_result" &&
    isContextDate(value.capturedAt) &&
    isProjectId(value.resultDigest)
  );
}

export function isReviewReceipt(value: unknown): value is ReviewReceipt {
  return (
    isRecord(value) &&
    isEvidence(value.evidence) &&
    isChoice(value.choice) &&
    isRevision(value.revision) &&
    value.revision > 0 &&
    isContextDate(value.recordedAt)
  );
}

export function isReviewResult(
  operation: keyof ReviewResults,
  value: unknown,
): boolean {
  if (
    !isRecord(value) ||
    !isProjectId(value.projectId) ||
    !isRequestId(value.taskId) ||
    !isRequestId(value.executionId)
  )
    return false;
  if (operation === "result.review") return isReviewReceipt(value);
  return (
    isEvidence(value.evidence) &&
    (value.latest === null ||
      (isReviewReceipt(value.latest) &&
        value.latest.evidence.resultDigest === value.evidence.resultDigest &&
        value.latest.evidence.capturedAt === value.evidence.capturedAt))
  );
}
