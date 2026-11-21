import type { DatabaseSync } from "node:sqlite";
import {
  isReviewReceipt,
  type EvidenceSnapshot,
  type ResultReview,
  type ReviewInput,
  type ReviewReceipt,
  type TaskRunRef,
} from "@laplace/contracts";
import { GitError } from "./git.ts";

export const reviewMigration = `
  CREATE TABLE result_reviews (
    execution_id TEXT NOT NULL REFERENCES task_results(execution_id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    request_id TEXT NOT NULL,
    result_digest TEXT NOT NULL CHECK (length(result_digest) = 64),
    captured_at TEXT NOT NULL,
    choice TEXT NOT NULL CHECK (choice IN ('approved', 'rejected')),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (execution_id, revision),
    UNIQUE (execution_id, request_id)
  ) STRICT, WITHOUT ROWID;
`;

type Row = {
  resultDigest: string;
  capturedAt: string;
  choice: unknown;
  revision: number;
  recordedAt: string;
};

function scope({ projectId, taskId, executionId }: TaskRunRef): TaskRunRef {
  return { projectId, taskId, executionId };
}

function receipt(row: Row, evidence: EvidenceSnapshot): ReviewReceipt {
  const { choice, revision, recordedAt } = row;
  const saved = { evidence, choice, revision, recordedAt };
  if (
    evidence.resultDigest !== row.resultDigest ||
    evidence.capturedAt !== row.capturedAt ||
    !isReviewReceipt(saved)
  )
    throw new GitError("result_review_conflict");
  return saved;
}

export function createResultReviewStore(database: DatabaseSync) {
  const columns =
    "result_digest AS resultDigest, captured_at AS capturedAt, choice, revision, recorded_at AS recordedAt";
  const latest = database.prepare(
    `SELECT ${columns} FROM result_reviews WHERE execution_id = ? ORDER BY revision DESC LIMIT 1`,
  );
  const previous = database.prepare(
    `SELECT ${columns} FROM result_reviews WHERE execution_id = ? AND request_id = ?`,
  );
  const insert = database.prepare(`
    INSERT INTO result_reviews (execution_id, revision, request_id, result_digest, captured_at, choice, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  function status(ref: TaskRunRef, evidence: EvidenceSnapshot): ResultReview {
    const row = latest.get(ref.executionId) as Row | undefined;
    return {
      ...scope(ref),
      evidence,
      latest: row ? receipt(row, evidence) : null,
    };
  }

  return {
    status,
    review(input: ReviewInput, evidence: EvidenceSnapshot) {
      const { executionId, requestId, expectedBase, expectedRevision, choice } =
        input;
      if (expectedBase !== evidence.resultDigest)
        throw new GitError("result_review_conflict");
      const replay = previous.get(executionId, requestId) as Row | undefined;
      if (replay) {
        const saved = receipt(replay, evidence);
        if (saved.choice !== choice || saved.revision !== expectedRevision + 1)
          throw new GitError("result_review_conflict");
        return { ...scope(input), ...saved };
      }
      const current = status(input, evidence).latest?.revision ?? 0;
      if (current !== expectedRevision)
        throw new GitError("result_review_conflict");
      const revision = current + 1;
      const recordedAt = new Date().toISOString();
      insert.run(
        executionId,
        revision,
        requestId,
        evidence.resultDigest,
        evidence.capturedAt,
        choice,
        recordedAt,
      );
      return { ...scope(input), evidence, revision, choice, recordedAt };
    },
  };
}
