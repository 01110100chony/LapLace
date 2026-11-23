import type { DatabaseSync } from "node:sqlite";
import {
  plannerEventsPageSize,
  type ExecutionDiffFile,
  type ExecutionDiffResult,
  type ExecutionDiffReview,
  type GitPlanRecord,
  type IdentityScope,
  type LocalApplyRecord,
  type OperationEffect,
  type OperationGrantRecord,
  type PlannerApplyStatus,
  type PlannerBackendMode,
  type PlannerConflict,
  type PlannerExecutionState,
  type PlannerGitBase,
  type PlannerOperationKind,
  type PlannerPrecondition,
  type PlannerPredictedEffect,
  type PlannerPreflightStatus,
  type PlannerProposedEdit,
  type PlannerRiskLevel,
  type PlannerWorktreeStatus,
  type PlannerWorktreeStrategy,
  type SupervisedExecutionEvent,
  type SupervisedExecutionEventsResult,
  type SupervisedExecutionRecord,
  type VerifierApprovalStatus,
  type VerifierDefinitionRecord,
  type VerifierPrivilegeProfile,
  type VerifierRunRecord,
} from "@laplace/contracts";
import { GitError } from "./git.ts";
import type { createIdentityStore } from "./identity-store.ts";

export const f4Migration = `
  CREATE TABLE f4_plans (
    sequence INTEGER PRIMARY KEY,
    plan_id TEXT UNIQUE NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    request_id TEXT NOT NULL,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    operation_kind TEXT NOT NULL CHECK (
      operation_kind IN ('worktree_edit', 'branch_patch', 'verifier_only', 'agent_supervised')
    ),
    backend_mode TEXT NOT NULL CHECK (
      backend_mode IN ('mock_supervised', 'local_process_job', 'codex_cli_workspace', 'codex_cli_isolated')
    ),
    target_branch TEXT,
    target_paths_json TEXT NOT NULL,
    proposed_edits_json TEXT NOT NULL,
    session_grant_id TEXT,
    base_json TEXT NOT NULL,
    base_digest TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
    status TEXT NOT NULL CHECK (status IN ('ready', 'blocked')),
    preflight_status TEXT NOT NULL CHECK (
      preflight_status IN ('valid', 'blocked', 'invalidated_by_drift')
    ),
    predicted_effects_json TEXT NOT NULL,
    conflicts_json TEXT NOT NULL,
    preconditions_json TEXT NOT NULL,
    simulation_digest TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, binding_id, worktree_id, request_id)
  ) STRICT;

  CREATE INDEX f4_plans_scope ON f4_plans (project_id, binding_id, worktree_id, sequence DESC);

  CREATE TABLE f4_operation_grants (
    grant_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    plan_id TEXT NOT NULL REFERENCES f4_plans(plan_id),
    base_digest TEXT NOT NULL,
    backend_mode TEXT NOT NULL CHECK (
      backend_mode IN ('mock_supervised', 'local_process_job', 'codex_cli_workspace', 'codex_cli_isolated')
    ),
    allowed_effects_json TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    revoke_reason TEXT
  ) STRICT;

  CREATE INDEX f4_operation_grants_scope ON f4_operation_grants (project_id, binding_id, worktree_id, plan_id);

  CREATE TABLE f4_dedicated_worktrees (
    dedicated_worktree_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    plan_id TEXT NOT NULL REFERENCES f4_plans(plan_id),
    root TEXT NOT NULL,
    branch_name TEXT,
    strategy TEXT NOT NULL CHECK (strategy IN ('git_worktree', 'isolated_checkout')),
    status TEXT NOT NULL CHECK (status IN ('active', 'retained_for_review', 'cleaned', 'orphaned')),
    base_head TEXT,
    created_at TEXT NOT NULL,
    cleaned_at TEXT
  ) STRICT;

  CREATE TABLE f4_executions (
    sequence INTEGER PRIMARY KEY,
    execution_id TEXT UNIQUE NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    request_id TEXT NOT NULL,
    plan_id TEXT NOT NULL REFERENCES f4_plans(plan_id),
    grant_id TEXT NOT NULL REFERENCES f4_operation_grants(grant_id),
    base_digest TEXT NOT NULL,
    backend_mode TEXT NOT NULL CHECK (
      backend_mode IN ('mock_supervised', 'local_process_job', 'codex_cli_workspace', 'codex_cli_isolated')
    ),
    dedicated_worktree_id TEXT NOT NULL REFERENCES f4_dedicated_worktrees(dedicated_worktree_id),
    base_head TEXT,
    state TEXT NOT NULL CHECK (
      state IN ('running', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted', 'timeout')
    ),
    failure_code TEXT,
    child_pid INTEGER,
    owner_id TEXT NOT NULL,
    owner_pid INTEGER NOT NULL CHECK (owner_pid > 0),
    recovered_after_restart INTEGER NOT NULL CHECK (recovered_after_restart IN (0, 1)),
    diff_digest TEXT,
    last_seq INTEGER NOT NULL CHECK (last_seq >= 0),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    UNIQUE (project_id, binding_id, worktree_id, request_id)
  ) STRICT;

  CREATE INDEX f4_executions_scope ON f4_executions (project_id, binding_id, worktree_id, sequence DESC);

  CREATE TABLE f4_execution_events (
    execution_id TEXT NOT NULL REFERENCES f4_executions(execution_id),
    seq INTEGER NOT NULL CHECK (seq > 0),
    type TEXT NOT NULL,
    at TEXT NOT NULL,
    summary TEXT NOT NULL,
    state TEXT,
    PRIMARY KEY (execution_id, seq)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE f4_execution_diffs (
    execution_id TEXT PRIMARY KEY NOT NULL REFERENCES f4_executions(execution_id),
    project_id TEXT NOT NULL,
    binding_id TEXT NOT NULL,
    worktree_id TEXT NOT NULL,
    plan_id TEXT NOT NULL REFERENCES f4_plans(plan_id),
    diff_digest TEXT NOT NULL,
    base_head TEXT,
    captured_at TEXT NOT NULL,
    files_json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE f4_diff_blobs (
    execution_id TEXT NOT NULL REFERENCES f4_execution_diffs(execution_id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('before', 'after')),
    sha256 TEXT NOT NULL,
    byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
    crlf INTEGER NOT NULL CHECK (crlf IN (0, 1)),
    content BLOB NOT NULL,
    PRIMARY KEY (execution_id, path, side)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE f4_diff_reviews (
    execution_id TEXT NOT NULL REFERENCES f4_execution_diffs(execution_id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    project_id TEXT NOT NULL,
    binding_id TEXT NOT NULL,
    worktree_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    diff_digest TEXT NOT NULL,
    choice TEXT NOT NULL CHECK (choice IN ('approved', 'rejected')),
    reviewer TEXT NOT NULL,
    note TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (execution_id, revision),
    UNIQUE (project_id, binding_id, worktree_id, request_id)
  ) STRICT;

  CREATE TABLE f4_apply_records (
    apply_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    request_id TEXT NOT NULL,
    execution_id TEXT NOT NULL REFERENCES f4_executions(execution_id),
    grant_id TEXT NOT NULL REFERENCES f4_operation_grants(grant_id),
    diff_digest TEXT NOT NULL,
    backup_overlay_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('applied', 'aborted_conflict', 'rolled_back')),
    applied_paths_json TEXT NOT NULL,
    detail TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    UNIQUE (project_id, binding_id, worktree_id, request_id)
  ) STRICT;

  CREATE TABLE f4_verifiers (
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    definition_id TEXT NOT NULL,
    label TEXT NOT NULL,
    argv_json TEXT NOT NULL,
    cwd_relative TEXT NOT NULL,
    env_whitelist_json TEXT NOT NULL,
    timeout_ms INTEGER NOT NULL,
    privilege_profile TEXT NOT NULL CHECK (
      privilege_profile IN ('readonly_check', 'workspace_build_test', 'isolated_probe')
    ),
    definition_digest TEXT NOT NULL,
    approval_status TEXT NOT NULL CHECK (
      approval_status IN ('pending', 'approved', 'revoked_by_redefinition')
    ),
    approved_digest TEXT,
    approved_by TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, binding_id, worktree_id, definition_id)
  ) STRICT;

  CREATE TABLE f4_verifier_runs (
    run_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    request_id TEXT NOT NULL,
    definition_id TEXT NOT NULL,
    definition_digest TEXT NOT NULL,
    execution_id TEXT,
    privilege_profile TEXT NOT NULL CHECK (
      privilege_profile IN ('readonly_check', 'workspace_build_test', 'isolated_probe')
    ),
    state TEXT NOT NULL CHECK (state IN ('passed', 'failed', 'timeout', 'blocked')),
    exit_code INTEGER,
    timed_out INTEGER NOT NULL CHECK (timed_out IN (0, 1)),
    stdout_excerpt TEXT NOT NULL,
    stderr_excerpt TEXT NOT NULL,
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
    ran_at TEXT NOT NULL,
    UNIQUE (project_id, binding_id, worktree_id, request_id)
  ) STRICT;
`;

type Transaction = <T>(action: () => T) => T;
type IdentityStore = ReturnType<typeof createIdentityStore>;

export type StoredDedicatedWorktree = {
  dedicatedWorktreeId: string;
  scope: IdentityScope;
  planId: string;
  root: string;
  branchName: string | null;
  strategy: PlannerWorktreeStrategy;
  status: PlannerWorktreeStatus;
  baseHead: string | null;
  createdAt: string;
  cleanedAt: string | null;
};

export type StoredDiffBlobInput = {
  path: string;
  side: "before" | "after";
  sha256: string;
  byteLength: number;
  crlf: boolean;
  content: Buffer;
};

type PlanRow = {
  projectId: string;
  bindingId: string;
  worktreeId: string;
  planId: string;
  requestId: string;
  title: string;
  objective: string;
  operationKind: PlannerOperationKind;
  backendMode: PlannerBackendMode;
  targetBranch: string | null;
  targetPathsJson: string;
  proposedEditsJson: string;
  sessionGrantId: string | null;
  baseJson: string;
  baseDigest: string;
  riskLevel: PlannerRiskLevel;
  status: "ready" | "blocked";
  preflightStatus: PlannerPreflightStatus;
  predictedEffectsJson: string;
  conflictsJson: string;
  preconditionsJson: string;
  simulationDigest: string;
  createdAt: string;
  updatedAt: string;
};

type GrantRow = {
  grantId: string;
  projectId: string;
  bindingId: string;
  worktreeId: string;
  planId: string;
  baseDigest: string;
  backendMode: PlannerBackendMode;
  allowedEffectsJson: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
};

type ExecutionRow = {
  executionId: string;
  projectId: string;
  bindingId: string;
  worktreeId: string;
  requestId: string;
  planId: string;
  grantId: string;
  baseDigest: string;
  backendMode: PlannerBackendMode;
  dedicatedWorktreeId: string;
  dedicatedRoot: string;
  worktreeStrategy: PlannerWorktreeStrategy;
  worktreeStatus: PlannerWorktreeStatus;
  baseHead: string | null;
  state: PlannerExecutionState;
  failureCode: string | null;
  childPid: number | null;
  ownerId: string;
  ownerPid: number;
  recoveredAfterRestart: number;
  diffDigest: string | null;
  lastSeq: number;
  startedAt: string;
  finishedAt: string | null;
};

function computeGrantStatus(
  revokedAt: string | null,
  expiresAt: string,
  nowIso: string,
): "active" | "revoked" | "expired" {
  if (revokedAt !== null) return "revoked";
  if (Date.parse(expiresAt) <= Date.parse(nowIso)) return "expired";
  return "active";
}

function mapPlanRow(row: PlanRow): GitPlanRecord {
  return {
    scope: {
      projectId: row.projectId,
      bindingId: row.bindingId,
      worktreeId: row.worktreeId,
    },
    planId: row.planId,
    requestId: row.requestId,
    title: row.title,
    objective: row.objective,
    operationKind: row.operationKind,
    backendMode: row.backendMode,
    targetBranch: row.targetBranch,
    targetPaths: JSON.parse(row.targetPathsJson) as string[],
    proposedEdits: JSON.parse(row.proposedEditsJson) as PlannerProposedEdit[],
    sessionGrantId: row.sessionGrantId,
    base: JSON.parse(row.baseJson) as PlannerGitBase,
    baseDigest: row.baseDigest,
    riskLevel: row.riskLevel,
    status: row.status,
    preflightStatus: row.preflightStatus,
    predictedEffects: JSON.parse(
      row.predictedEffectsJson,
    ) as PlannerPredictedEffect[],
    conflicts: JSON.parse(row.conflictsJson) as PlannerConflict[],
    preconditions: JSON.parse(row.preconditionsJson) as PlannerPrecondition[],
    simulationDigest: row.simulationDigest,
    mutatesOrigin: false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapGrantRow(row: GrantRow, nowIso: string): OperationGrantRecord {
  return {
    scope: {
      projectId: row.projectId,
      bindingId: row.bindingId,
      worktreeId: row.worktreeId,
    },
    grantId: row.grantId,
    planId: row.planId,
    baseDigest: row.baseDigest,
    backendMode: row.backendMode,
    allowedEffects: JSON.parse(row.allowedEffectsJson) as OperationEffect[],
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokeReason: row.revokeReason,
    status: computeGrantStatus(row.revokedAt, row.expiresAt, nowIso),
  };
}

function mapExecutionRow(row: ExecutionRow): SupervisedExecutionRecord {
  return {
    scope: {
      projectId: row.projectId,
      bindingId: row.bindingId,
      worktreeId: row.worktreeId,
    },
    executionId: row.executionId,
    requestId: row.requestId,
    planId: row.planId,
    grantId: row.grantId,
    baseDigest: row.baseDigest,
    backendMode: row.backendMode,
    dedicatedWorktreeId: row.dedicatedWorktreeId,
    dedicatedRoot: row.dedicatedRoot,
    worktreeStrategy: row.worktreeStrategy,
    worktreeStatus: row.worktreeStatus,
    baseHead: row.baseHead,
    state: row.state,
    failureCode: row.failureCode,
    childPid: row.childPid,
    recoveredAfterRestart: row.recoveredAfterRestart === 1,
    diffDigest: row.diffDigest,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function pidAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function createF4Store(
  database: DatabaseSync,
  write: Transaction,
  read: Transaction,
  identity: IdentityStore,
) {
  const planFields = `project_id AS projectId, binding_id AS bindingId, worktree_id AS worktreeId,
    plan_id AS planId, request_id AS requestId, title, objective,
    operation_kind AS operationKind, backend_mode AS backendMode,
    target_branch AS targetBranch, target_paths_json AS targetPathsJson,
    proposed_edits_json AS proposedEditsJson, session_grant_id AS sessionGrantId,
    base_json AS baseJson, base_digest AS baseDigest, risk_level AS riskLevel,
    status, preflight_status AS preflightStatus,
    predicted_effects_json AS predictedEffectsJson, conflicts_json AS conflictsJson,
    preconditions_json AS preconditionsJson, simulation_digest AS simulationDigest,
    created_at AS createdAt, updated_at AS updatedAt`;

  const findPlanByReq = database.prepare(
    `SELECT ${planFields} FROM f4_plans WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND request_id = ?`,
  );
  const findPlan = database.prepare(
    `SELECT ${planFields} FROM f4_plans WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND plan_id = ?`,
  );
  const listPlansStmt = database.prepare(
    `SELECT ${planFields} FROM f4_plans WHERE project_id = ? AND binding_id = ? AND worktree_id = ? ORDER BY sequence DESC LIMIT 100`,
  );
  const insertPlanStmt = database.prepare(
    `INSERT INTO f4_plans (
      plan_id, project_id, binding_id, worktree_id, request_id, title, objective,
      operation_kind, backend_mode, target_branch, target_paths_json, proposed_edits_json,
      session_grant_id, base_json, base_digest, risk_level, status, preflight_status,
      predicted_effects_json, conflicts_json, preconditions_json, simulation_digest,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updatePlanPreflightStmt = database.prepare(
    `UPDATE f4_plans SET preflight_status = ?, updated_at = ? WHERE plan_id = ? AND project_id = ? AND binding_id = ? AND worktree_id = ?`,
  );

  const grantFields = `grant_id AS grantId, project_id AS projectId, binding_id AS bindingId,
    worktree_id AS worktreeId, plan_id AS planId, base_digest AS baseDigest,
    backend_mode AS backendMode, allowed_effects_json AS allowedEffectsJson,
    issued_at AS issuedAt, expires_at AS expiresAt, revoked_at AS revokedAt, revoke_reason AS revokeReason`;
  const findGrantStmt = database.prepare(
    `SELECT ${grantFields} FROM f4_operation_grants WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND grant_id = ?`,
  );
  const listGrantsAllStmt = database.prepare(
    `SELECT ${grantFields} FROM f4_operation_grants WHERE project_id = ? AND binding_id = ? AND worktree_id = ? ORDER BY issued_at DESC LIMIT 100`,
  );
  const listGrantsByPlanStmt = database.prepare(
    `SELECT ${grantFields} FROM f4_operation_grants WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND plan_id = ? ORDER BY issued_at DESC LIMIT 100`,
  );
  const insertGrantStmt = database.prepare(
    `INSERT INTO f4_operation_grants (
      grant_id, project_id, binding_id, worktree_id, plan_id, base_digest,
      backend_mode, allowed_effects_json, issued_at, expires_at, revoked_at, revoke_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  );
  const revokeGrantStmt = database.prepare(
    `UPDATE f4_operation_grants SET revoked_at = ?, revoke_reason = ? WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND grant_id = ? AND revoked_at IS NULL`,
  );

  const insertWorktreeStmt = database.prepare(
    `INSERT INTO f4_dedicated_worktrees (
      dedicated_worktree_id, project_id, binding_id, worktree_id, plan_id,
      root, branch_name, strategy, status, base_head, created_at, cleaned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );
  const findWorktreeStmt = database.prepare(
    `SELECT dedicated_worktree_id AS dedicatedWorktreeId, project_id AS projectId, binding_id AS bindingId,
      worktree_id AS worktreeId, plan_id AS planId, root, branch_name AS branchName,
      strategy, status, base_head AS baseHead, created_at AS createdAt, cleaned_at AS cleanedAt
     FROM f4_dedicated_worktrees WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND dedicated_worktree_id = ?`,
  );
  const countActiveWorktreesStmt = database.prepare(
    `SELECT COUNT(*) AS count FROM f4_dedicated_worktrees
     WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND status IN ('active', 'retained_for_review')`,
  );
  const updateWorktreeStatusStmt = database.prepare(
    `UPDATE f4_dedicated_worktrees SET status = ?, cleaned_at = ?
     WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND dedicated_worktree_id = ?`,
  );

  const executionFields = `e.execution_id AS executionId, e.project_id AS projectId, e.binding_id AS bindingId,
    e.worktree_id AS worktreeId, e.request_id AS requestId, e.plan_id AS planId, e.grant_id AS grantId,
    e.base_digest AS baseDigest, e.backend_mode AS backendMode, e.dedicated_worktree_id AS dedicatedWorktreeId,
    w.root AS dedicatedRoot, w.strategy AS worktreeStrategy, w.status AS worktreeStatus,
    e.base_head AS baseHead, e.state, e.failure_code AS failureCode, e.child_pid AS childPid,
    e.owner_id AS ownerId, e.owner_pid AS ownerPid, e.recovered_after_restart AS recoveredAfterRestart,
    e.diff_digest AS diffDigest, e.last_seq AS lastSeq, e.started_at AS startedAt, e.finished_at AS finishedAt`;
  const findExecutionStmt = database.prepare(
    `SELECT ${executionFields} FROM f4_executions e
     JOIN f4_dedicated_worktrees w ON w.dedicated_worktree_id = e.dedicated_worktree_id
     WHERE e.project_id = ? AND e.binding_id = ? AND e.worktree_id = ? AND e.execution_id = ?`,
  );
  const findExecutionByReqStmt = database.prepare(
    `SELECT ${executionFields} FROM f4_executions e
     JOIN f4_dedicated_worktrees w ON w.dedicated_worktree_id = e.dedicated_worktree_id
     WHERE e.project_id = ? AND e.binding_id = ? AND e.worktree_id = ? AND e.request_id = ?`,
  );
  const listExecutionsStmt = database.prepare(
    `SELECT ${executionFields} FROM f4_executions e
     JOIN f4_dedicated_worktrees w ON w.dedicated_worktree_id = e.dedicated_worktree_id
     WHERE e.project_id = ? AND e.binding_id = ? AND e.worktree_id = ?
     ORDER BY e.sequence DESC LIMIT 100`,
  );
  const listExecutionsByPlanStmt = database.prepare(
    `SELECT ${executionFields} FROM f4_executions e
     JOIN f4_dedicated_worktrees w ON w.dedicated_worktree_id = e.dedicated_worktree_id
     WHERE e.project_id = ? AND e.binding_id = ? AND e.worktree_id = ? AND e.plan_id = ?
     ORDER BY e.sequence DESC LIMIT 100`,
  );
  const insertExecutionStmt = database.prepare(
    `INSERT INTO f4_executions (
      execution_id, project_id, binding_id, worktree_id, request_id, plan_id, grant_id,
      base_digest, backend_mode, dedicated_worktree_id, base_head, state, failure_code,
      child_pid, owner_id, owner_pid, recovered_after_restart, diff_digest, last_seq,
      started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, NULL, ?, ?, 0, NULL, 0, ?, NULL)`,
  );
  const updateExecutionPidStmt = database.prepare(
    `UPDATE f4_executions SET child_pid = ? WHERE execution_id = ?`,
  );
  const updateExecutionTerminalStmt = database.prepare(
    `UPDATE f4_executions SET state = ?, failure_code = ?, diff_digest = COALESCE(?, diff_digest),
      finished_at = ?, child_pid = NULL WHERE execution_id = ?`,
  );
  const updateExecutionStateOnlyStmt = database.prepare(
    `UPDATE f4_executions SET state = ? WHERE execution_id = ?`,
  );
  const bumpLastSeqStmt = database.prepare(
    `UPDATE f4_executions SET last_seq = ? WHERE execution_id = ?`,
  );
  const insertEventStmt = database.prepare(
    `INSERT INTO f4_execution_events (execution_id, seq, type, at, summary, state)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const listEventsStmt = database.prepare(
    `SELECT seq, type, at, summary, state FROM f4_execution_events
     WHERE execution_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
  );
  const listActiveExecutionsStmt = database.prepare(
    `SELECT ${executionFields} FROM f4_executions e
     JOIN f4_dedicated_worktrees w ON w.dedicated_worktree_id = e.dedicated_worktree_id
     WHERE e.state IN ('running', 'cancelling')`,
  );
  const markInterruptedStmt = database.prepare(
    `UPDATE f4_executions SET state = 'interrupted', failure_code = 'sidecar_restarted',
      recovered_after_restart = 1, child_pid = NULL, finished_at = ?
     WHERE execution_id = ?`,
  );

  const upsertDiffStmt = database.prepare(
    `INSERT OR REPLACE INTO f4_execution_diffs (
      execution_id, project_id, binding_id, worktree_id, plan_id, diff_digest,
      base_head, captured_at, files_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const findDiffStmt = database.prepare(
    `SELECT execution_id AS executionId, project_id AS projectId, binding_id AS bindingId,
      worktree_id AS worktreeId, plan_id AS planId, diff_digest AS diffDigest,
      base_head AS baseHead, captured_at AS capturedAt, files_json AS filesJson
     FROM f4_execution_diffs WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND execution_id = ?`,
  );
  const deleteDiffBlobsStmt = database.prepare(
    `DELETE FROM f4_diff_blobs WHERE execution_id = ?`,
  );
  const insertDiffBlobStmt = database.prepare(
    `INSERT INTO f4_diff_blobs (execution_id, path, side, sha256, byte_length, crlf, content)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const listDiffBlobsAfterStmt = database.prepare(
    `SELECT path, sha256, byte_length AS byteLength, crlf, content FROM f4_diff_blobs
     WHERE execution_id = ? AND side = 'after'`,
  );

  const latestReviewStmt = database.prepare(
    `SELECT revision, request_id AS requestId, diff_digest AS diffDigest, choice, reviewer, note, recorded_at AS recordedAt
     FROM f4_diff_reviews WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND execution_id = ?
     ORDER BY revision DESC LIMIT 1`,
  );
  const findReviewByReqStmt = database.prepare(
    `SELECT revision, request_id AS requestId, diff_digest AS diffDigest, choice, reviewer, note, recorded_at AS recordedAt
     FROM f4_diff_reviews WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND request_id = ?`,
  );
  const insertReviewStmt = database.prepare(
    `INSERT INTO f4_diff_reviews (
      execution_id, revision, project_id, binding_id, worktree_id, request_id,
      diff_digest, choice, reviewer, note, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertApplyStmt = database.prepare(
    `INSERT INTO f4_apply_records (
      apply_id, project_id, binding_id, worktree_id, request_id, execution_id,
      grant_id, diff_digest, backup_overlay_id, status, applied_paths_json, detail, applied_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const latestApplyStmt = database.prepare(
    `SELECT apply_id AS applyId, project_id AS projectId, binding_id AS bindingId, worktree_id AS worktreeId,
      request_id AS requestId, execution_id AS executionId, grant_id AS grantId, diff_digest AS diffDigest,
      backup_overlay_id AS backupOverlayId, status, applied_paths_json AS appliedPathsJson,
      detail, applied_at AS appliedAt
     FROM f4_apply_records WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND execution_id = ?
     ORDER BY applied_at DESC LIMIT 1`,
  );
  const findApplyByReqStmt = database.prepare(
    `SELECT apply_id AS applyId, project_id AS projectId, binding_id AS bindingId, worktree_id AS worktreeId,
      request_id AS requestId, execution_id AS executionId, grant_id AS grantId, diff_digest AS diffDigest,
      backup_overlay_id AS backupOverlayId, status, applied_paths_json AS appliedPathsJson,
      detail, applied_at AS appliedAt
     FROM f4_apply_records WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND request_id = ?`,
  );

  const verifierFields = `project_id AS projectId, binding_id AS bindingId, worktree_id AS worktreeId,
    definition_id AS definitionId, label, argv_json AS argvJson, cwd_relative AS cwdRelative,
    env_whitelist_json AS envWhitelistJson, timeout_ms AS timeoutMs,
    privilege_profile AS privilegeProfile, definition_digest AS definitionDigest,
    approval_status AS approvalStatus, approved_digest AS approvedDigest,
    approved_by AS approvedBy, approved_at AS approvedAt, created_at AS createdAt, updated_at AS updatedAt`;
  const findVerifierStmt = database.prepare(
    `SELECT ${verifierFields} FROM f4_verifiers WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND definition_id = ?`,
  );
  const listVerifiersStmt = database.prepare(
    `SELECT ${verifierFields} FROM f4_verifiers WHERE project_id = ? AND binding_id = ? AND worktree_id = ? ORDER BY updated_at DESC`,
  );
  const insertVerifierStmt = database.prepare(
    `INSERT INTO f4_verifiers (
      project_id, binding_id, worktree_id, definition_id, label, argv_json, cwd_relative,
      env_whitelist_json, timeout_ms, privilege_profile, definition_digest, approval_status,
      approved_digest, approved_by, approved_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)`,
  );
  const updateVerifierStmt = database.prepare(
    `UPDATE f4_verifiers SET
      label = ?, argv_json = ?, cwd_relative = ?, env_whitelist_json = ?, timeout_ms = ?,
      privilege_profile = ?, definition_digest = ?, approval_status = ?,
      approved_digest = ?, approved_by = ?, approved_at = ?, updated_at = ?
     WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND definition_id = ?`,
  );
  const approveVerifierStmt = database.prepare(
    `UPDATE f4_verifiers SET approval_status = 'approved', approved_digest = ?, approved_by = ?, approved_at = ?, updated_at = ?
     WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND definition_id = ?`,
  );

  const findVerifierRunByReqStmt = database.prepare(
    `SELECT run_id AS runId, project_id AS projectId, binding_id AS bindingId, worktree_id AS worktreeId,
      request_id AS requestId, definition_id AS definitionId, definition_digest AS definitionDigest,
      execution_id AS executionId, privilege_profile AS privilegeProfile, state, exit_code AS exitCode,
      timed_out AS timedOut, stdout_excerpt AS stdoutExcerpt, stderr_excerpt AS stderrExcerpt,
      duration_ms AS durationMs, ran_at AS ranAt
     FROM f4_verifier_runs WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND request_id = ?`,
  );
  const insertVerifierRunStmt = database.prepare(
    `INSERT INTO f4_verifier_runs (
      run_id, project_id, binding_id, worktree_id, request_id, definition_id, definition_digest,
      execution_id, privilege_profile, state, exit_code, timed_out, stdout_excerpt, stderr_excerpt,
      duration_ms, ran_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const listVerifierRunsStmt = database.prepare(
    `SELECT run_id AS runId, project_id AS projectId, binding_id AS bindingId, worktree_id AS worktreeId,
      request_id AS requestId, definition_id AS definitionId, definition_digest AS definitionDigest,
      execution_id AS executionId, privilege_profile AS privilegeProfile, state, exit_code AS exitCode,
      timed_out AS timedOut, stdout_excerpt AS stdoutExcerpt, stderr_excerpt AS stderrExcerpt,
      duration_ms AS durationMs, ran_at AS ranAt
     FROM f4_verifier_runs WHERE project_id = ? AND binding_id = ? AND worktree_id = ? ORDER BY ran_at DESC LIMIT 50`,
  );

  function appendEventInTx(
    executionId: string,
    lastSeq: number,
    event: {
      type: SupervisedExecutionEvent["type"];
      at: string;
      summary: string;
      state?: PlannerExecutionState;
    },
  ): number {
    const seq = lastSeq + 1;
    insertEventStmt.run(
      executionId,
      seq,
      event.type,
      event.at,
      event.summary,
      event.state ?? null,
    );
    bumpLastSeqStmt.run(seq, executionId);
    return seq;
  }

  function mapVerifierRow(
    row: Record<string, unknown>,
  ): VerifierDefinitionRecord {
    return {
      scope: {
        projectId: row.projectId as string,
        bindingId: row.bindingId as string,
        worktreeId: row.worktreeId as string,
      },
      definitionId: row.definitionId as string,
      label: row.label as string,
      argv: JSON.parse(row.argvJson as string) as string[],
      cwdRelative: row.cwdRelative as string,
      envWhitelist: JSON.parse(row.envWhitelistJson as string) as string[],
      timeoutMs: row.timeoutMs as number,
      privilegeProfile: row.privilegeProfile as VerifierPrivilegeProfile,
      definitionDigest: row.definitionDigest as string,
      approvalStatus: row.approvalStatus as VerifierApprovalStatus,
      approvedDigest: (row.approvedDigest as string | null) ?? null,
      approvedBy: (row.approvedBy as string | null) ?? null,
      approvedAt: (row.approvedAt as string | null) ?? null,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }

  function mapVerifierRunRow(row: Record<string, unknown>): VerifierRunRecord {
    return {
      scope: {
        projectId: row.projectId as string,
        bindingId: row.bindingId as string,
        worktreeId: row.worktreeId as string,
      },
      runId: row.runId as string,
      requestId: row.requestId as string,
      definitionId: row.definitionId as string,
      definitionDigest: row.definitionDigest as string,
      executionId: (row.executionId as string | null) ?? null,
      privilegeProfile: row.privilegeProfile as VerifierPrivilegeProfile,
      state: row.state as VerifierRunRecord["state"],
      exitCode: (row.exitCode as number | null) ?? null,
      timedOut: row.timedOut === 1,
      stdoutExcerpt: row.stdoutExcerpt as string,
      stderrExcerpt: row.stderrExcerpt as string,
      durationMs: row.durationMs as number,
      ranAt: row.ranAt as string,
    };
  }

  function mapApplyRow(row: Record<string, unknown>): LocalApplyRecord {
    return {
      scope: {
        projectId: row.projectId as string,
        bindingId: row.bindingId as string,
        worktreeId: row.worktreeId as string,
      },
      applyId: row.applyId as string,
      requestId: row.requestId as string,
      executionId: row.executionId as string,
      grantId: row.grantId as string,
      diffDigest: row.diffDigest as string,
      backupOverlayId: (row.backupOverlayId as string | null) ?? null,
      status: row.status as PlannerApplyStatus,
      appliedPaths: JSON.parse(row.appliedPathsJson as string) as string[],
      detail: row.detail as string,
      appliedAt: row.appliedAt as string,
    };
  }

  return {
    reconcileInterruptedExecutions(nowIso: string): number {
      return write(() => {
        const rows = listActiveExecutionsStmt.all() as ExecutionRow[];
        let updated = 0;
        for (const row of rows) {
          if (row.ownerPid === process.pid && pidAlive(row.ownerPid)) {
            continue;
          }
          // When a previous sidecar process died or restarted, reconcile without re-running effects.
          markInterruptedStmt.run(nowIso, row.executionId);
          appendEventInTx(row.executionId, row.lastSeq, {
            type: "terminal",
            at: nowIso,
            summary:
              "Execucao interrompida apos reinicio do sidecar sem reexecutar efeitos.",
            state: "interrupted",
          });
          if (row.worktreeStatus === "active") {
            updateWorktreeStatusStmt.run(
              "orphaned",
              null,
              row.projectId,
              row.bindingId,
              row.worktreeId,
              row.dedicatedWorktreeId,
            );
          }
          updated += 1;
        }
        return updated;
      });
    },

    countActiveWorktrees(scope: IdentityScope): number {
      return read(() => {
        const row = countActiveWorktreesStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
        ) as { count: number };
        return row.count;
      });
    },

    insertPlan(record: GitPlanRecord): GitPlanRecord {
      return write(() => {
        identity.resolveScope(record.scope);
        const existing = findPlanByReq.get(
          record.scope.projectId,
          record.scope.bindingId,
          record.scope.worktreeId,
          record.requestId,
        ) as PlanRow | undefined;
        if (existing) return mapPlanRow(existing);
        insertPlanStmt.run(
          record.planId,
          record.scope.projectId,
          record.scope.bindingId,
          record.scope.worktreeId,
          record.requestId,
          record.title,
          record.objective,
          record.operationKind,
          record.backendMode,
          record.targetBranch,
          JSON.stringify(record.targetPaths),
          JSON.stringify(record.proposedEdits),
          record.sessionGrantId,
          JSON.stringify(record.base),
          record.baseDigest,
          record.riskLevel,
          record.status,
          record.preflightStatus,
          JSON.stringify(record.predictedEffects),
          JSON.stringify(record.conflicts),
          JSON.stringify(record.preconditions),
          record.simulationDigest,
          record.createdAt,
          record.updatedAt,
        );
        return record;
      });
    },

    getPlan(scope: IdentityScope, planId: string): GitPlanRecord | null {
      return read(() => {
        identity.resolveScope(scope);
        const row = findPlan.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          planId,
        ) as PlanRow | undefined;
        return row ? mapPlanRow(row) : null;
      });
    },

    listPlans(scope: IdentityScope): GitPlanRecord[] {
      return read(() => {
        identity.resolveScope(scope);
        return (
          listPlansStmt.all(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
          ) as PlanRow[]
        ).map(mapPlanRow);
      });
    },

    updatePlanPreflightStatus(
      scope: IdentityScope,
      planId: string,
      status: PlannerPreflightStatus,
      updatedAt: string,
    ): void {
      write(() => {
        updatePlanPreflightStmt.run(
          status,
          updatedAt,
          planId,
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
        );
      });
    },

    insertGrant(
      record: OperationGrantRecord,
      nowIso: string,
    ): OperationGrantRecord {
      return write(() => {
        identity.resolveScope(record.scope);
        insertGrantStmt.run(
          record.grantId,
          record.scope.projectId,
          record.scope.bindingId,
          record.scope.worktreeId,
          record.planId,
          record.baseDigest,
          record.backendMode,
          JSON.stringify(record.allowedEffects),
          record.issuedAt,
          record.expiresAt,
        );
        const saved = findGrantStmt.get(
          record.scope.projectId,
          record.scope.bindingId,
          record.scope.worktreeId,
          record.grantId,
        ) as GrantRow;
        return mapGrantRow(saved, nowIso);
      });
    },

    getGrant(
      scope: IdentityScope,
      grantId: string,
      nowIso: string,
    ): OperationGrantRecord | null {
      return read(() => {
        identity.resolveScope(scope);
        const row = findGrantStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          grantId,
        ) as GrantRow | undefined;
        return row ? mapGrantRow(row, nowIso) : null;
      });
    },

    listGrants(
      scope: IdentityScope,
      planId: string | null,
      nowIso: string,
    ): OperationGrantRecord[] {
      return read(() => {
        identity.resolveScope(scope);
        const rows = (
          planId
            ? listGrantsByPlanStmt.all(
                scope.projectId,
                scope.bindingId,
                scope.worktreeId,
                planId,
              )
            : listGrantsAllStmt.all(
                scope.projectId,
                scope.bindingId,
                scope.worktreeId,
              )
        ) as GrantRow[];
        return rows.map((row) => mapGrantRow(row, nowIso));
      });
    },

    revokeGrant(
      scope: IdentityScope,
      grantId: string,
      nowIso: string,
      reason: string,
    ): OperationGrantRecord {
      return write(() => {
        identity.resolveScope(scope);
        const row = findGrantStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          grantId,
        ) as GrantRow | undefined;
        if (!row) throw new GitError("operation_grant_invalid");
        revokeGrantStmt.run(
          nowIso,
          reason,
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          grantId,
        );
        const updated = findGrantStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          grantId,
        ) as GrantRow;
        return mapGrantRow(updated, nowIso);
      });
    },

    findExecutionByRequest(
      scope: IdentityScope,
      requestId: string,
    ): SupervisedExecutionRecord | null {
      return read(() => {
        const row = findExecutionByReqStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          requestId,
        ) as ExecutionRow | undefined;
        return row ? mapExecutionRow(row) : null;
      });
    },

    createExecution(params: {
      worktree: StoredDedicatedWorktree;
      execution: Omit<
        SupervisedExecutionRecord,
        "worktreeStrategy" | "worktreeStatus" | "dedicatedRoot"
      >;
      ownerId: string;
    }): SupervisedExecutionRecord {
      return write(() => {
        identity.resolveScope(params.execution.scope);
        insertWorktreeStmt.run(
          params.worktree.dedicatedWorktreeId,
          params.worktree.scope.projectId,
          params.worktree.scope.bindingId,
          params.worktree.scope.worktreeId,
          params.worktree.planId,
          params.worktree.root,
          params.worktree.branchName,
          params.worktree.strategy,
          params.worktree.status,
          params.worktree.baseHead,
          params.worktree.createdAt,
        );
        insertExecutionStmt.run(
          params.execution.executionId,
          params.execution.scope.projectId,
          params.execution.scope.bindingId,
          params.execution.scope.worktreeId,
          params.execution.requestId,
          params.execution.planId,
          params.execution.grantId,
          params.execution.baseDigest,
          params.execution.backendMode,
          params.worktree.dedicatedWorktreeId,
          params.execution.baseHead,
          params.ownerId,
          process.pid,
          params.execution.startedAt,
        );
        appendEventInTx(params.execution.executionId, 0, {
          type: "queued",
          at: params.execution.startedAt,
          summary: `Execucao enfileirada (${params.execution.backendMode}).`,
          state: "running",
        });
        appendEventInTx(params.execution.executionId, 1, {
          type: "worktree_created",
          at: params.execution.startedAt,
          summary: `Worktree dedicada criada em ${params.worktree.root}.`,
        });
        const saved = findExecutionStmt.get(
          params.execution.scope.projectId,
          params.execution.scope.bindingId,
          params.execution.scope.worktreeId,
          params.execution.executionId,
        ) as ExecutionRow;
        return mapExecutionRow(saved);
      });
    },

    appendExecutionEvent(
      scope: IdentityScope,
      executionId: string,
      event: {
        type: SupervisedExecutionEvent["type"];
        at: string;
        summary: string;
        state?: PlannerExecutionState;
      },
    ): void {
      write(() => {
        const row = findExecutionStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          executionId,
        ) as ExecutionRow | undefined;
        if (!row) return;
        appendEventInTx(executionId, row.lastSeq, event);
      });
    },

    setExecutionChildPid(executionId: string, pid: number | null): void {
      write(() => {
        updateExecutionPidStmt.run(pid, executionId);
      });
    },

    markExecutionCancelling(
      scope: IdentityScope,
      executionId: string,
      at: string,
    ): SupervisedExecutionRecord {
      return write(() => {
        const row = findExecutionStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          executionId,
        ) as ExecutionRow | undefined;
        if (!row) throw new GitError("planner_not_found");
        if (row.state === "running") {
          updateExecutionStateOnlyStmt.run("cancelling", executionId);
          appendEventInTx(executionId, row.lastSeq, {
            type: "cancel_requested",
            at,
            summary: "Cancelamento humano solicitado.",
            state: "cancelling",
          });
        }
        const updated = findExecutionStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          executionId,
        ) as ExecutionRow;
        return mapExecutionRow(updated);
      });
    },

    finishExecution(params: {
      scope: IdentityScope;
      executionId: string;
      state: PlannerExecutionState;
      failureCode: string | null;
      diffDigest: string | null;
      finishedAt: string;
      summary: string;
      worktreeStatus: PlannerWorktreeStatus;
    }): SupervisedExecutionRecord {
      return write(() => {
        const row = findExecutionStmt.get(
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.executionId,
        ) as ExecutionRow | undefined;
        if (!row) throw new GitError("planner_not_found");
        if (row.state !== "running" && row.state !== "cancelling") {
          return mapExecutionRow(row);
        }
        updateExecutionTerminalStmt.run(
          params.state,
          params.failureCode,
          params.diffDigest,
          params.finishedAt,
          params.executionId,
        );
        updateWorktreeStatusStmt.run(
          params.worktreeStatus,
          params.worktreeStatus === "cleaned" ? params.finishedAt : null,
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          row.dedicatedWorktreeId,
        );
        appendEventInTx(params.executionId, row.lastSeq, {
          type: "terminal",
          at: params.finishedAt,
          summary: params.summary,
          state: params.state,
        });
        const updated = findExecutionStmt.get(
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.executionId,
        ) as ExecutionRow;
        return mapExecutionRow(updated);
      });
    },

    getExecution(
      scope: IdentityScope,
      executionId: string,
    ): SupervisedExecutionRecord | null {
      return read(() => {
        identity.resolveScope(scope);
        const row = findExecutionStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          executionId,
        ) as ExecutionRow | undefined;
        return row ? mapExecutionRow(row) : null;
      });
    },

    listExecutions(
      scope: IdentityScope,
      planId: string | null,
    ): SupervisedExecutionRecord[] {
      return read(() => {
        identity.resolveScope(scope);
        const rows = (
          planId
            ? listExecutionsByPlanStmt.all(
                scope.projectId,
                scope.bindingId,
                scope.worktreeId,
                planId,
              )
            : listExecutionsStmt.all(
                scope.projectId,
                scope.bindingId,
                scope.worktreeId,
              )
        ) as ExecutionRow[];
        return rows.map(mapExecutionRow);
      });
    },

    getExecutionEvents(
      scope: IdentityScope,
      executionId: string,
      afterSeq: number,
    ): SupervisedExecutionEventsResult {
      return read(() => {
        identity.resolveScope(scope);
        const row = findExecutionStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          executionId,
        ) as ExecutionRow | undefined;
        if (!row) throw new GitError("planner_not_found");
        if (afterSeq > row.lastSeq) throw new GitError("planner_invalid_input");
        const eventsRaw = listEventsStmt.all(
          executionId,
          afterSeq,
          plannerEventsPageSize,
        ) as {
          seq: number;
          type: SupervisedExecutionEvent["type"];
          at: string;
          summary: string;
          state: PlannerExecutionState | null;
        }[];
        const events: SupervisedExecutionEvent[] = eventsRaw.map((ev) => ({
          seq: ev.seq,
          type: ev.type,
          at: ev.at,
          summary: ev.summary,
          ...(ev.state ? { state: ev.state } : {}),
        }));
        const nextSeq = afterSeq + events.length;
        return {
          scope,
          execution: mapExecutionRow(row),
          events,
          nextSeq,
          more: nextSeq < row.lastSeq,
        };
      });
    },

    getDedicatedWorktree(
      scope: IdentityScope,
      dedicatedWorktreeId: string,
    ): StoredDedicatedWorktree | null {
      return read(() => {
        const row = findWorktreeStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          dedicatedWorktreeId,
        ) as Record<string, unknown> | undefined;
        if (!row) return null;
        return {
          dedicatedWorktreeId: row.dedicatedWorktreeId as string,
          scope: {
            projectId: row.projectId as string,
            bindingId: row.bindingId as string,
            worktreeId: row.worktreeId as string,
          },
          planId: row.planId as string,
          root: row.root as string,
          branchName: (row.branchName as string | null) ?? null,
          strategy: row.strategy as PlannerWorktreeStrategy,
          status: row.status as PlannerWorktreeStatus,
          baseHead: (row.baseHead as string | null) ?? null,
          createdAt: row.createdAt as string,
          cleanedAt: (row.cleanedAt as string | null) ?? null,
        };
      });
    },

    markWorktreeCleaned(
      scope: IdentityScope,
      dedicatedWorktreeId: string,
      cleanedAt: string,
    ): void {
      write(() => {
        updateWorktreeStatusStmt.run(
          "cleaned",
          cleanedAt,
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          dedicatedWorktreeId,
        );
      });
    },

    saveExecutionDiff(params: {
      scope: IdentityScope;
      executionId: string;
      planId: string;
      diffDigest: string;
      baseHead: string | null;
      capturedAt: string;
      files: ExecutionDiffFile[];
      blobs: StoredDiffBlobInput[];
    }): void {
      write(() => {
        upsertDiffStmt.run(
          params.executionId,
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.planId,
          params.diffDigest,
          params.baseHead,
          params.capturedAt,
          JSON.stringify(params.files),
        );
        deleteDiffBlobsStmt.run(params.executionId);
        for (const blob of params.blobs) {
          insertDiffBlobStmt.run(
            params.executionId,
            blob.path,
            blob.side,
            blob.sha256,
            blob.byteLength,
            blob.crlf ? 1 : 0,
            blob.content,
          );
        }
      });
    },

    getExecutionDiff(
      scope: IdentityScope,
      executionId: string,
    ): ExecutionDiffResult | null {
      return read(() => {
        identity.resolveScope(scope);
        const row = findDiffStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          executionId,
        ) as Record<string, unknown> | undefined;
        if (!row) return null;
        const latestReview = latestReviewStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          executionId,
        ) as ExecutionDiffReview | undefined;
        const applyRow = latestApplyStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          executionId,
        ) as Record<string, unknown> | undefined;
        return {
          scope,
          executionId: row.executionId as string,
          planId: row.planId as string,
          diffDigest: row.diffDigest as string,
          baseHead: (row.baseHead as string | null) ?? null,
          capturedAt: row.capturedAt as string,
          files: JSON.parse(row.filesJson as string) as ExecutionDiffFile[],
          latestReview: latestReview ?? null,
          latestApply: applyRow ? mapApplyRow(applyRow) : null,
        };
      });
    },

    getAfterDiffBlobs(
      executionId: string,
    ): Map<
      string,
      { sha256: string; byteLength: number; crlf: boolean; content: Buffer }
    > {
      return read(() => {
        const rows = listDiffBlobsAfterStmt.all(executionId) as {
          path: string;
          sha256: string;
          byteLength: number;
          crlf: number;
          content: Uint8Array;
        }[];
        const map = new Map<
          string,
          { sha256: string; byteLength: number; crlf: boolean; content: Buffer }
        >();
        for (const row of rows) {
          map.set(row.path, {
            sha256: row.sha256,
            byteLength: row.byteLength,
            crlf: row.crlf === 1,
            content: Buffer.from(row.content),
          });
        }
        return map;
      });
    },

    recordDiffReview(params: {
      scope: IdentityScope;
      executionId: string;
      requestId: string;
      expectedDiffDigest: string;
      expectedRevision: number;
      choice: "approved" | "rejected";
      reviewer: string;
      note: string;
      recordedAt: string;
    }): ExecutionDiffReview {
      return write(() => {
        identity.resolveScope(params.scope);
        const existingReq = findReviewByReqStmt.get(
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.requestId,
        ) as ExecutionDiffReview | undefined;
        if (existingReq) return existingReq;

        const diffRow = findDiffStmt.get(
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.executionId,
        ) as Record<string, unknown> | undefined;
        if (!diffRow) throw new GitError("planner_not_found");
        if (diffRow.diffDigest !== params.expectedDiffDigest) {
          throw new GitError("planner_drift_detected");
        }
        const latest = latestReviewStmt.get(
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.executionId,
        ) as ExecutionDiffReview | undefined;
        const currentRevision = latest?.revision ?? 0;
        if (currentRevision !== params.expectedRevision) {
          throw new GitError("apply_conflict_detected");
        }
        const revision = currentRevision + 1;
        insertReviewStmt.run(
          params.executionId,
          revision,
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.requestId,
          params.expectedDiffDigest,
          params.choice,
          params.reviewer,
          params.note,
          params.recordedAt,
        );
        return {
          revision,
          requestId: params.requestId,
          diffDigest: params.expectedDiffDigest,
          choice: params.choice,
          reviewer: params.reviewer,
          note: params.note,
          recordedAt: params.recordedAt,
        };
      });
    },

    findApplyByRequest(
      scope: IdentityScope,
      requestId: string,
    ): LocalApplyRecord | null {
      return read(() => {
        const row = findApplyByReqStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          requestId,
        ) as Record<string, unknown> | undefined;
        return row ? mapApplyRow(row) : null;
      });
    },

    insertApplyRecord(record: LocalApplyRecord): LocalApplyRecord {
      return write(() => {
        identity.resolveScope(record.scope);
        const existing = findApplyByReqStmt.get(
          record.scope.projectId,
          record.scope.bindingId,
          record.scope.worktreeId,
          record.requestId,
        ) as Record<string, unknown> | undefined;
        if (existing) return mapApplyRow(existing);
        insertApplyStmt.run(
          record.applyId,
          record.scope.projectId,
          record.scope.bindingId,
          record.scope.worktreeId,
          record.requestId,
          record.executionId,
          record.grantId,
          record.diffDigest,
          record.backupOverlayId,
          record.status,
          JSON.stringify(record.appliedPaths),
          record.detail,
          record.appliedAt,
        );
        return record;
      });
    },

    upsertVerifier(params: {
      scope: IdentityScope;
      definitionId: string;
      label: string;
      argv: string[];
      cwdRelative: string;
      envWhitelist: string[];
      timeoutMs: number;
      privilegeProfile: VerifierPrivilegeProfile;
      definitionDigest: string;
      nowIso: string;
    }): VerifierDefinitionRecord {
      return write(() => {
        identity.resolveScope(params.scope);
        const existingRow = findVerifierStmt.get(
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.definitionId,
        ) as Record<string, unknown> | undefined;
        if (!existingRow) {
          insertVerifierStmt.run(
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.definitionId,
            params.label,
            JSON.stringify(params.argv),
            params.cwdRelative,
            JSON.stringify(params.envWhitelist),
            params.timeoutMs,
            params.privilegeProfile,
            params.definitionDigest,
            params.nowIso,
            params.nowIso,
          );
        } else {
          const prev = mapVerifierRow(existingRow);
          let nextStatus: VerifierApprovalStatus = prev.approvalStatus;
          let approvedDigest = prev.approvedDigest;
          let approvedBy = prev.approvedBy;
          let approvedAt = prev.approvedAt;
          // Any change to the canonical verifier tuple auto-revokes prior approval.
          if (
            prev.definitionDigest !== params.definitionDigest ||
            (approvedDigest !== null &&
              approvedDigest !== params.definitionDigest)
          ) {
            nextStatus =
              prev.approvalStatus === "approved" ||
              prev.approvalStatus === "revoked_by_redefinition"
                ? "revoked_by_redefinition"
                : "pending";
            approvedDigest = null;
            approvedBy = null;
            approvedAt = null;
          }
          updateVerifierStmt.run(
            params.label,
            JSON.stringify(params.argv),
            params.cwdRelative,
            JSON.stringify(params.envWhitelist),
            params.timeoutMs,
            params.privilegeProfile,
            params.definitionDigest,
            nextStatus,
            approvedDigest,
            approvedBy,
            approvedAt,
            params.nowIso,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.definitionId,
          );
        }
        const saved = findVerifierStmt.get(
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.definitionId,
        ) as Record<string, unknown>;
        return mapVerifierRow(saved);
      });
    },

    getVerifier(
      scope: IdentityScope,
      definitionId: string,
    ): VerifierDefinitionRecord | null {
      return read(() => {
        identity.resolveScope(scope);
        const row = findVerifierStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          definitionId,
        ) as Record<string, unknown> | undefined;
        return row ? mapVerifierRow(row) : null;
      });
    },

    approveVerifier(params: {
      scope: IdentityScope;
      definitionId: string;
      expectedDefinitionDigest: string;
      reviewer: string;
      nowIso: string;
    }): VerifierDefinitionRecord {
      return write(() => {
        identity.resolveScope(params.scope);
        const row = findVerifierStmt.get(
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.definitionId,
        ) as Record<string, unknown> | undefined;
        if (!row) throw new GitError("planner_not_found");
        const existing = mapVerifierRow(row);
        if (existing.definitionDigest !== params.expectedDefinitionDigest) {
          throw new GitError("verifier_approval_invalid");
        }
        approveVerifierStmt.run(
          params.expectedDefinitionDigest,
          params.reviewer,
          params.nowIso,
          params.nowIso,
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.definitionId,
        );
        const updated = findVerifierStmt.get(
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.definitionId,
        ) as Record<string, unknown>;
        return mapVerifierRow(updated);
      });
    },

    listVerifiers(scope: IdentityScope): {
      items: VerifierDefinitionRecord[];
      runs: VerifierRunRecord[];
    } {
      return read(() => {
        identity.resolveScope(scope);
        const items = (
          listVerifiersStmt.all(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
          ) as Record<string, unknown>[]
        ).map(mapVerifierRow);
        const runs = (
          listVerifierRunsStmt.all(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
          ) as Record<string, unknown>[]
        ).map(mapVerifierRunRow);
        return { items, runs };
      });
    },

    findVerifierRunByRequest(
      scope: IdentityScope,
      requestId: string,
    ): VerifierRunRecord | null {
      return read(() => {
        const row = findVerifierRunByReqStmt.get(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          requestId,
        ) as Record<string, unknown> | undefined;
        return row ? mapVerifierRunRow(row) : null;
      });
    },

    insertVerifierRun(record: VerifierRunRecord): VerifierRunRecord {
      return write(() => {
        identity.resolveScope(record.scope);
        const existing = findVerifierRunByReqStmt.get(
          record.scope.projectId,
          record.scope.bindingId,
          record.scope.worktreeId,
          record.requestId,
        ) as Record<string, unknown> | undefined;
        if (existing) return mapVerifierRunRow(existing);
        insertVerifierRunStmt.run(
          record.runId,
          record.scope.projectId,
          record.scope.bindingId,
          record.scope.worktreeId,
          record.requestId,
          record.definitionId,
          record.definitionDigest,
          record.executionId,
          record.privilegeProfile,
          record.state,
          record.exitCode,
          record.timedOut ? 1 : 0,
          record.stdoutExcerpt,
          record.stderrExcerpt,
          record.durationMs,
          record.ranAt,
        );
        return record;
      });
    },
  };
}
