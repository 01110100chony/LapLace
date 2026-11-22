import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gitSource,
  gitSummaryVersion,
  isResumeResult,
  type ResumeDecision,
  type ResumeObservation,
} from "@laplace/contracts";
import { composeResume } from "../src/index.ts";

const scopeA = {
  projectId: "a".repeat(64),
  bindingId: "b".repeat(64),
  worktreeId: "c".repeat(64),
};
const otherProjectId = "f".repeat(64);
const now = "2026-11-22T06:00:00.000Z";

function makeDecision(overrides: Partial<ResumeDecision> = {}): ResumeDecision {
  return {
    assertionId: "1".repeat(64),
    revisionId: "2".repeat(64),
    revision: 1,
    projectId: scopeA.projectId,
    content: "Preservar fluxo de retomada determinístico em core puro.",
    author: "Operador Local",
    authority: "human_local",
    visibility: "local_only",
    status: "active",
    effectiveAt: "2026-11-22T05:00:00.000Z",
    recordedAt: "2026-11-22T05:00:00.000Z",
    sourceOrigin: "human_decision",
    evidence: {
      state: "verified",
      coverage: "partial",
      durability: "durable_blob",
      sourceOrigin: "context_search",
      capturedAt: "2026-11-22T04:50:00.000Z",
      excerptDigest: "3".repeat(64),
      ref: {
        projectId: scopeA.projectId,
        contextId: "4".repeat(64),
        path: "src/retomada.ts",
        sha256: "5".repeat(64),
        chunk: 0,
      },
      gap: null,
    },
    ...overrides,
  };
}

const freshClean: ResumeObservation = {
  state: "fresh",
  observation: {
    branch: "main",
    head: "9".repeat(40),
    changes: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
    observedAt: now,
    source: gitSource,
    summaryVersion: gitSummaryVersion,
  },
  attemptedAt: now,
  gap: null,
};

test("F1-T08.A1: composição é pura, determinística, invariante a permutações e filtra escopo cruzado", () => {
  const localOlder = makeDecision({
    assertionId: "1".repeat(64),
    revisionId: "1".repeat(64),
    visibility: "local_only",
    effectiveAt: "2026-11-22T04:00:00.000Z",
    recordedAt: "2026-11-22T04:00:00.000Z",
  });
  const canonicalWinner = makeDecision({
    assertionId: "2".repeat(64),
    revisionId: "2".repeat(64),
    authority: "human_promoted",
    visibility: "canonical_verified",
    effectiveAt: "2026-11-22T03:00:00.000Z",
    recordedAt: "2026-11-22T03:00:00.000Z",
  });
  const foreignDecision = makeDecision({
    projectId: otherProjectId,
    assertionId: "e".repeat(64),
    visibility: "canonical_verified",
    effectiveAt: "2026-11-22T05:59:00.000Z",
  });
  const supersededDecision = makeDecision({
    assertionId: "3".repeat(64),
    status: "superseded",
    visibility: "canonical_verified",
    effectiveAt: "2026-11-22T05:59:00.000Z",
  });

  const inputA = {
    scope: scopeA,
    projectName: "Projeto A",
    root: "C:\\Repos\\A",
    verification: "verified" as const,
    now,
    correlationId: "req-core-1",
    observation: freshClean,
    decisions: [
      localOlder,
      foreignDecision,
      supersededDecision,
      canonicalWinner,
    ],
    lastCapture: {
      contextId: "c".repeat(64),
      projectId: otherProjectId,
      head: null,
      completedAt: "2026-11-22T04:00:00.000Z",
      status: "partial" as const,
      included: 1,
      omitted: 1,
    },
    lastExecution: {
      taskId: "t1",
      executionId: "e1",
      projectId: otherProjectId,
      mode: "mock_development" as const,
      state: "completed",
      recordedAt: "2026-11-22T04:10:00.000Z",
      reviewChoice: "approved" as const,
      isLegacyAttemptNote: true as const,
    },
  };

  const first = composeResume(inputA);
  const permuted = composeResume({
    ...inputA,
    decisions: [
      canonicalWinner,
      supersededDecision,
      foreignDecision,
      localOlder,
    ],
  });

  assert.deepEqual(permuted, first);
  assert.ok(isResumeResult("project.resume", first));
  assert.equal(first.memory.state, "available");
  assert.equal(first.memory.decision.assertionId, canonicalWinner.assertionId);
  assert.equal(first.activity.lastCapture, null);
  assert.equal(first.activity.lastExecution, null);
  assert.equal(first.nextAction.advisory, true);
  assert.equal(first.nextAction.kind, "continue_from_decision");
  assert.equal(first.nextAction.blockedByConflict, false);
});

test("F1-T08.A1: modela memória vazia, HEAD nulo, cache datado, lacuna de fonte e precedência invariante > preferência sob conflito", () => {
  const emptyNullHead = composeResume({
    scope: scopeA,
    projectName: "Projeto Vazio",
    root: "C:\\Repos\\Vazio",
    verification: "verified",
    now,
    observation: {
      state: "cached",
      observation: {
        branch: "main",
        head: null,
        changes: { staged: 0, unstaged: 1, untracked: 0, conflicted: 0 },
        observedAt: "2026-11-22T01:00:00.000Z",
        source: gitSource,
        summaryVersion: gitSummaryVersion,
      },
      attemptedAt: now,
      gap: "folder_unavailable",
    },
    decisions: [],
    preferences: {
      profile: {
        preferActionKind: "inspect_changes",
        customActionLabel: "Preferência de perfil",
      },
      project: {
        preferActionKind: "record_decision",
        customActionLabel: "Preferência do projeto",
      },
    },
  });
  assert.ok(isResumeResult("project.resume", emptyNullHead));
  assert.equal(emptyNullHead.memory.state, "empty");
  assert.equal(emptyNullHead.observation.state, "cached");
  assert.equal(
    emptyNullHead.observation.observation.observedAt,
    "2026-11-22T01:00:00.000Z",
  );
  assert.equal(emptyNullHead.nextAction.kind, "record_decision");
  assert.equal(emptyNullHead.nextAction.label, "Preferência do projeto");

  const conflictedWithGap = composeResume({
    scope: scopeA,
    projectName: "Projeto Conflito",
    root: "C:\\Repos\\Conflito",
    verification: "divergent",
    now,
    observation: {
      state: "unavailable",
      observation: null,
      attemptedAt: now,
      gap: "folder_unavailable",
    },
    decisions: [
      makeDecision({
        evidence: {
          state: "gap",
          coverage: "none",
          durability: "missing_blob",
          sourceOrigin: "context_capture",
          capturedAt: "2026-11-22T04:50:00.000Z",
          excerptDigest: null,
          ref: null,
          gap: "source_unavailable",
        },
      }),
    ],
    workingConflict: true,
    preferences: {
      project: {
        preferActionKind: "continue_from_decision",
        customActionLabel: "Continuar mesmo com conflito",
      },
    },
  });

  assert.ok(isResumeResult("project.resume", conflictedWithGap));
  assert.equal(conflictedWithGap.nextAction.advisory, true);
  assert.equal(conflictedWithGap.nextAction.blockedByConflict, true);
  assert.equal(conflictedWithGap.nextAction.kind, "resolve_conflict");
  assert.ok(
    conflictedWithGap.memory.conflicts.some(
      (c) => c.kind === "identity_divergent" && c.blocking,
    ),
  );
  assert.ok(
    conflictedWithGap.memory.conflicts.some(
      (c) => c.kind === "evidence_gap" && c.blocking,
    ),
  );
  assert.ok(
    conflictedWithGap.memory.conflicts.some(
      (c) => c.kind === "working_conflict" && c.blocking,
    ),
  );

  const gitMissingCached = composeResume({
    scope: scopeA,
    projectName: "Projeto Sem Git",
    root: "C:\\Repos\\SemGit",
    verification: "unavailable",
    now,
    observation: {
      state: "cached",
      observation: {
        branch: "main",
        head: "9".repeat(40),
        changes: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
        observedAt: "2026-11-22T01:00:00.000Z",
        source: gitSource,
        summaryVersion: gitSummaryVersion,
      },
      attemptedAt: now,
      gap: "git_missing",
    },
    decisions: [makeDecision()],
  });
  assert.ok(isResumeResult("project.resume", gitMissingCached));
  assert.equal(gitMissingCached.nextAction.kind, "resolve_conflict");
  assert.equal(gitMissingCached.nextAction.blockedByConflict, true);
  assert.match(gitMissingCached.nextAction.label, /Git/i);
  assert.ok(
    gitMissingCached.memory.conflicts.some(
      (c) => c.kind === "git_unavailable" && c.blocking,
    ),
  );
});
