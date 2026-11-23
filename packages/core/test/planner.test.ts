import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  PlannerGitBase,
  VerifierDefinitionRecord,
} from "@laplace/contracts";
import {
  computeDiffDigest,
  computeGitBaseDigest,
  computeVerifierDefinitionDigest,
  evaluatePreFlight,
  simulateGitPlan,
  validateVerifierApproval,
  type PlannerGitObservation,
} from "../src/index.ts";

const sampleScope = {
  projectId: "a".repeat(64),
  bindingId: "b".repeat(64),
  worktreeId: "c".repeat(64),
};

function makeObservation(
  overrides: Partial<PlannerGitBase> = {},
  extra: Partial<Omit<PlannerGitObservation, "base">> = {},
): PlannerGitObservation {
  return {
    base: {
      head: "1111111111111111111111111111111111111111",
      branch: "main",
      indexStamp: "idx-100-1234",
      worktreeRoot: "C:\\Repo",
      dirtyDigest: "0".repeat(64),
      ...overrides,
    },
    branches: extra.branches ?? [
      {
        name: "main",
        head: "1111111111111111111111111111111111111111",
        current: true,
      },
    ],
    dirtyPaths: extra.dirtyPaths ?? [],
    conflictedPaths: extra.conflictedPaths ?? [],
  };
}

test("simulateGitPlan calcula efeitos sem mutar origem e sinaliza sobreposicao dirty", () => {
  const observation = makeObservation({}, { dirtyPaths: ["src/app.ts"] });
  const sim = simulateGitPlan({
    operationKind: "worktree_edit",
    backendMode: "mock_supervised",
    targetPaths: ["src/app.ts", "README.md"],
    proposedEdits: [
      { path: "src/app.ts", action: "modify", content: "updated\n" },
    ],
    snapshot: observation,
  });

  assert.equal(sim.mutatesOrigin, false);
  assert.equal(sim.status, "ready");
  assert.equal(sim.preflightStatus, "valid");
  assert.equal(sim.baseDigest, computeGitBaseDigest(observation.base));
  assert.ok(sim.predictedEffects.every((effect) => !effect.mutatesOrigin));
  assert.ok(
    sim.conflicts.some(
      (c) =>
        c.kind === "dirty_path_overlap" &&
        !c.blocking &&
        c.path === "src/app.ts",
    ),
  );
  assert.equal(sim.riskLevel, "medium");
});

test("simulateGitPlan bloqueia codex_cli_isolated sem prova LPAC e branch duplicada", () => {
  const blockedBackend = simulateGitPlan({
    operationKind: "agent_supervised",
    backendMode: "codex_cli_isolated",
    targetPaths: ["src/index.ts"],
    sessionGrantId: "grant-session-1",
    snapshot: makeObservation(),
  });
  assert.equal(blockedBackend.status, "blocked");
  assert.equal(blockedBackend.preflightStatus, "blocked");
  assert.ok(
    blockedBackend.conflicts.some(
      (c) => c.kind === "backend_blocked" && c.blocking,
    ),
  );

  const missingSessionGrant = simulateGitPlan({
    operationKind: "agent_supervised",
    backendMode: "codex_cli_workspace",
    targetPaths: ["src/index.ts"],
    snapshot: makeObservation(),
  });
  assert.equal(missingSessionGrant.status, "blocked");
  assert.ok(
    missingSessionGrant.conflicts.some(
      (c) => c.kind === "session_grant_required" && c.blocking,
    ),
  );

  const duplicateBranch = simulateGitPlan({
    operationKind: "branch_patch",
    backendMode: "local_process_job",
    targetBranch: "main",
    targetPaths: ["src/index.ts"],
    snapshot: makeObservation(),
  });
  assert.equal(duplicateBranch.status, "blocked");
  assert.ok(
    duplicateBranch.conflicts.some(
      (c) => c.kind === "branch_exists" && c.blocking,
    ),
  );

  const unbornRepo = simulateGitPlan({
    operationKind: "worktree_edit",
    backendMode: "mock_supervised",
    targetPaths: ["src/index.ts"],
    snapshot: makeObservation({ head: null }),
  });
  assert.equal(unbornRepo.status, "blocked");
  assert.ok(
    unbornRepo.conflicts.some((c) => c.kind === "unborn_head" && c.blocking),
  );
});

test("evaluatePreFlight detecta drift em HEAD, branch, index, worktree e root", () => {
  const initial = makeObservation();
  const expectedBaseDigest = computeGitBaseDigest(initial.base);

  const valid = evaluatePreFlight({
    expectedBase: initial.base,
    expectedBaseDigest,
    observed: initial,
    backendMode: "mock_supervised",
    operationKind: "worktree_edit",
    targetPaths: ["README.md"],
  });
  assert.equal(valid.status, "valid");
  assert.equal(valid.driftDetected, false);
  assert.equal(valid.executionAllowed, true);

  const drifted = evaluatePreFlight({
    expectedBase: initial.base,
    expectedBaseDigest,
    observed: makeObservation({
      head: "2222222222222222222222222222222222222222",
      branch: "feature/other",
      indexStamp: "idx-200-5678",
      worktreeRoot: "C:\\Repo2",
      dirtyDigest: "f".repeat(64),
    }),
    backendMode: "mock_supervised",
    operationKind: "worktree_edit",
    targetPaths: ["README.md"],
  });
  assert.equal(drifted.status, "invalidated_by_drift");
  assert.equal(drifted.driftDetected, true);
  assert.equal(drifted.executionAllowed, false);
  assert.deepEqual(drifted.driftReasons, [
    "head_changed",
    "branch_changed",
    "index_changed",
    "worktree_dirty_changed",
    "root_changed",
  ]);
});

test("computeDiffDigest e deterministico independentemente da ordem dos arquivos", () => {
  const a = computeDiffDigest({
    planId: "plan-1",
    executionId: "exec-1",
    baseHead: "1111111111111111111111111111111111111111",
    files: [
      {
        path: "b.txt",
        action: "created",
        beforeSha256: null,
        beforeBytes: null,
        beforeCrlf: false,
        afterSha256: "a".repeat(64),
        afterBytes: 10,
        afterCrlf: true,
      },
      {
        path: "a.txt",
        action: "modified",
        beforeSha256: "b".repeat(64),
        beforeBytes: 5,
        beforeCrlf: false,
        afterSha256: "c".repeat(64),
        afterBytes: 6,
        afterCrlf: false,
      },
    ],
  });
  const b = computeDiffDigest({
    planId: "plan-1",
    executionId: "exec-1",
    baseHead: "1111111111111111111111111111111111111111",
    files: [
      {
        path: "a.txt",
        action: "modified",
        beforeSha256: "b".repeat(64),
        beforeBytes: 5,
        beforeCrlf: false,
        afterSha256: "c".repeat(64),
        afterBytes: 6,
        afterCrlf: false,
      },
      {
        path: "b.txt",
        action: "created",
        beforeSha256: null,
        beforeBytes: null,
        beforeCrlf: false,
        afterSha256: "a".repeat(64),
        afterBytes: 10,
        afterCrlf: true,
      },
    ],
  });
  assert.equal(a, b);
});

test("validateVerifierApproval revoga automaticamente se qualquer campo da tupla mudar em 1 byte", () => {
  const baseTuple = {
    definitionId: "verif-unit",
    argv: ["node", "--version"],
    cwdRelative: ".",
    envWhitelist: ["NODE_ENV"],
    timeoutMs: 5_000,
    privilegeProfile: "readonly_check" as const,
  };
  const digest = computeVerifierDefinitionDigest(baseTuple);
  const approved: VerifierDefinitionRecord = {
    scope: sampleScope,
    ...baseTuple,
    label: "Check Node",
    definitionDigest: digest,
    approvalStatus: "approved",
    approvedDigest: digest,
    approvedBy: "operador",
    approvedAt: "2026-11-23T12:00:00.000Z",
    createdAt: "2026-11-23T12:00:00.000Z",
    updatedAt: "2026-11-23T12:00:00.000Z",
  };

  assert.equal(
    validateVerifierApproval({ definition: approved }).allowed,
    true,
  );

  const mutations: Partial<VerifierDefinitionRecord>[] = [
    { definitionId: "verif-uniu" },
    { argv: ["node", "--versioo"] },
    { cwdRelative: "sub" },
    { envWhitelist: ["NODE_ENV", "PATH"] },
    { timeoutMs: 5_001 },
    { privilegeProfile: "workspace_build_test" },
  ];

  for (const mutation of mutations) {
    const mutated: VerifierDefinitionRecord = { ...approved, ...mutation };
    const verdict = validateVerifierApproval({ definition: mutated });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.status, "revoked_by_redefinition");
    assert.equal(verdict.reason, "verifier_approval_invalid");
  }

  const isolatedTuple = {
    ...baseTuple,
    privilegeProfile: "isolated_probe" as const,
  };
  const isolatedDigest = computeVerifierDefinitionDigest(isolatedTuple);
  const isolatedDef: VerifierDefinitionRecord = {
    ...approved,
    ...isolatedTuple,
    definitionDigest: isolatedDigest,
    approvedDigest: isolatedDigest,
  };
  const isolatedVerdict = validateVerifierApproval({ definition: isolatedDef });
  assert.equal(isolatedVerdict.allowed, false);
  assert.equal(isolatedVerdict.reason, "execution_backend_blocked");
});
