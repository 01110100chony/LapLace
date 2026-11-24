import type { DatabaseSync } from "node:sqlite";
import { adaptiveDefaultBaselineVersion } from "@laplace/contracts";
import type {
  AdaptiveGateFailure,
  AdaptiveRankingExplanation,
  AdaptiveStrategyStatusResult,
  ArenaCriteria,
  ArenaHypothesisRecord,
  ArenaInvalidationReason,
  ArenaPairedReview,
  ArenaSessionRecord,
  ArenaSessionStatus,
  ArenaSourceRef,
  BkmCategory,
  BkmEvidenceRecord,
  BkmHypothesisRecord,
  BkmHypothesisState,
  BkmPattern,
  BkmTransitionRecord,
  EvaluationMetrics,
  EvaluationRunRecord,
  IdentityScope,
  PlannerBackendMode,
  PlannerGitBase,
  PlannerProposedEdit,
  ProactiveScheduleRecord,
  ProactiveScheduleRunRecord,
  ProactiveSignalKind,
  ProactiveSourceRef,
  ProactiveSuggestionRecord,
  ProactiveSuggestionStatus,
  ProactivityTelemetrySummary,
} from "@laplace/contracts";
import {
  computeProactivityTelemetry,
  summarizeBkmHypothesis,
} from "@laplace/core";
import { GitError } from "./git.ts";
import type { createIdentityStore } from "./identity-store.ts";

export const f5Migration = `
  CREATE TABLE f5_arena_sessions (
    sequence INTEGER PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    request_id TEXT NOT NULL,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    backend_mode TEXT NOT NULL CHECK (
      backend_mode IN ('mock_supervised', 'local_process_job', 'codex_cli_workspace', 'codex_cli_isolated')
    ),
    status TEXT NOT NULL CHECK (
      status IN ('created', 'running', 'ready_for_review', 'reviewed', 'invalidated')
    ),
    invalidation_reason TEXT CHECK (
      invalidation_reason IS NULL OR invalidation_reason IN ('invalidated_base_divergence', 'invalidated_criteria_mismatch')
    ),
    base_json TEXT NOT NULL,
    base_digest TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    criteria_digest TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, binding_id, worktree_id, request_id)
  ) STRICT;

  CREATE INDEX f5_arena_sessions_scope
    ON f5_arena_sessions (project_id, binding_id, worktree_id, sequence DESC);

  CREATE TABLE f5_arena_hypotheses (
    session_id TEXT NOT NULL REFERENCES f5_arena_sessions(session_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    hypothesis_id TEXT NOT NULL,
    label TEXT NOT NULL,
    summary TEXT NOT NULL,
    target_paths_json TEXT NOT NULL,
    proposed_edits_json TEXT NOT NULL,
    command_argv_json TEXT,
    mock_behavior TEXT,
    observed_base_head TEXT,
    observed_base_index_stamp TEXT,
    observed_base_digest TEXT,
    criteria_digest TEXT NOT NULL,
    plan_id TEXT,
    grant_id TEXT,
    execution_id TEXT,
    dedicated_worktree_id TEXT,
    dedicated_root TEXT,
    diff_digest TEXT,
    source_refs_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (
      state IN ('pending', 'running', 'completed', 'failed', 'invalidated')
    ),
    failure_code TEXT,
    PRIMARY KEY (session_id, hypothesis_id)
  ) STRICT;

  CREATE TABLE f5_arena_reviews (
    review_id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT UNIQUE NOT NULL REFERENCES f5_arena_sessions(session_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    request_id TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('winner_selected', 'tie', 'both_discarded')),
    winner_hypothesis_id TEXT,
    reviewer TEXT NOT NULL,
    rationale TEXT NOT NULL,
    reviewed_hypothesis_ids_json TEXT NOT NULL,
    criterion_scores_json TEXT NOT NULL,
    evidence_refs_json TEXT NOT NULL,
    applied_to_local INTEGER NOT NULL CHECK (applied_to_local = 0),
    recorded_at TEXT NOT NULL,
    UNIQUE (project_id, binding_id, worktree_id, request_id)
  ) STRICT;

  CREATE TABLE f5_bkm_hypotheses (
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    hypothesis_id TEXT NOT NULL,
    competing_group_key TEXT NOT NULL,
    category TEXT NOT NULL CHECK (
      category IN ('retrieval_boost', 'temporal_recency', 'canonical_priority', 'path_affinity')
    ),
    title TEXT NOT NULL,
    statement TEXT NOT NULL,
    pattern_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (
      state IN ('candidate', 'active', 'superseded', 'reverted', 'purged')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, binding_id, worktree_id, hypothesis_id)
  ) STRICT;

  CREATE TABLE f5_bkm_evidence (
    evidence_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    hypothesis_id TEXT NOT NULL,
    polarity TEXT NOT NULL CHECK (polarity IN ('support', 'oppose')),
    origin_key TEXT NOT NULL,
    origin_kind TEXT NOT NULL CHECK (origin_kind IN ('inbox_feedback', 'review', 'manual')),
    source_ref_id TEXT,
    weight REAL NOT NULL,
    note TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (project_id, binding_id, worktree_id, hypothesis_id)
      REFERENCES f5_bkm_hypotheses (project_id, binding_id, worktree_id, hypothesis_id)
      ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX f5_bkm_evidence_hyp
    ON f5_bkm_evidence (project_id, binding_id, worktree_id, hypothesis_id, recorded_at ASC);

  CREATE TABLE f5_bkm_transitions (
    transition_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    hypothesis_id TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    reason TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (project_id, binding_id, worktree_id, hypothesis_id)
      REFERENCES f5_bkm_hypotheses (project_id, binding_id, worktree_id, hypothesis_id)
      ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE f5_adaptive_evaluations (
    sequence INTEGER PRIMARY KEY,
    evaluation_id TEXT UNIQUE NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    request_id TEXT NOT NULL,
    baseline_version TEXT NOT NULL,
    strategy_version TEXT NOT NULL,
    split_boundary_at TEXT NOT NULL,
    held_out_count INTEGER NOT NULL,
    temporal_split_valid INTEGER NOT NULL CHECK (temporal_split_valid IN (0, 1)),
    project_isolation_valid INTEGER NOT NULL CHECK (project_isolation_valid IN (0, 1)),
    baseline_metrics_json TEXT NOT NULL,
    adaptive_metrics_json TEXT NOT NULL,
    recall_gain REAL NOT NULL,
    temporal_accuracy_gain REAL NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('eligible_for_activation', 'stay_on_baseline')),
    failed_gates_json TEXT NOT NULL,
    explanations_json TEXT NOT NULL,
    report_digest TEXT NOT NULL,
    evaluated_at TEXT NOT NULL,
    UNIQUE (project_id, binding_id, worktree_id, request_id)
  ) STRICT;

  CREATE TABLE f5_adaptive_strategy_state (
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    active_mode TEXT NOT NULL CHECK (active_mode IN ('baseline_fts5', 'adaptive_symbolic')),
    active_version TEXT NOT NULL,
    evaluation_id TEXT,
    activated_at TEXT,
    activated_by TEXT,
    rollback_reason TEXT,
    PRIMARY KEY (project_id, binding_id, worktree_id)
  ) STRICT;

  CREATE TABLE f5_proactive_suggestions (
    suggestion_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    signal_fingerprint TEXT NOT NULL,
    signal_kind TEXT NOT NULL CHECK (
      signal_kind IN (
        'bitemporal_conflict',
        'inbox_pending_critical',
        'planner_drift',
        'diff_awaiting_review',
        'verifier_pending_or_revoked',
        'overlay_gap'
      )
    ),
    title TEXT NOT NULL,
    rationale TEXT NOT NULL,
    priority_score REAL NOT NULL,
    priority_band TEXT NOT NULL CHECK (priority_band IN ('critical', 'high', 'medium', 'low')),
    source_refs_json TEXT NOT NULL,
    proposed_action_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'snoozed', 'dismissed', 'accepted')),
    snooze_until TEXT,
    dismiss_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, binding_id, worktree_id, signal_fingerprint)
  ) STRICT;

  CREATE TABLE f5_proactivity_telemetry (
    event_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    suggestion_id TEXT,
    event_kind TEXT NOT NULL CHECK (
      event_kind IN ('evaluated', 'accepted', 'dismissed', 'snoozed', 'restored')
    ),
    estimated_manual_seconds INTEGER NOT NULL DEFAULT 0,
    estimated_saved_seconds INTEGER NOT NULL DEFAULT 0,
    recorded_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE f5_proactive_schedules (
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    schedule_id TEXT NOT NULL,
    label TEXT NOT NULL,
    opt_in_active INTEGER NOT NULL CHECK (opt_in_active IN (0, 1)),
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'revoked')),
    window_start_utc TEXT NOT NULL,
    window_end_utc TEXT NOT NULL,
    allowed_days_json TEXT NOT NULL,
    min_interval_minutes INTEGER NOT NULL CHECK (min_interval_minutes > 0),
    app_closed_mode TEXT NOT NULL CHECK (app_closed_mode = 'disabled_deferred'),
    revoked_at TEXT,
    revoke_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, binding_id, worktree_id, schedule_id)
  ) STRICT;

  CREATE TABLE f5_proactive_schedule_runs (
    run_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    schedule_id TEXT NOT NULL,
    window_key TEXT NOT NULL,
    state TEXT NOT NULL CHECK (
      state IN ('running', 'completed', 'cancelled', 'blocked_out_of_window', 'blocked_revoked', 'interrupted_recovered')
    ),
    recovered_after_restart INTEGER NOT NULL CHECK (recovered_after_restart IN (0, 1)),
    duplicate_suppressed INTEGER NOT NULL CHECK (duplicate_suppressed IN (0, 1)),
    suggestions_found INTEGER NOT NULL CHECK (suggestions_found >= 0),
    detail TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    FOREIGN KEY (project_id, binding_id, worktree_id, schedule_id)
      REFERENCES f5_proactive_schedules (project_id, binding_id, worktree_id, schedule_id)
      ON DELETE CASCADE,
    UNIQUE (project_id, binding_id, worktree_id, schedule_id, window_key)
  ) STRICT;
`;

type Transaction = <T>(action: () => T) => T;
type IdentityStore = ReturnType<typeof createIdentityStore>;

export type StoredArenaHypothesisSpec = ArenaHypothesisRecord & {
  commandArgv: string[] | null;
  mockBehavior: "complete" | "fail" | null;
};

export function createF5Store(
  database: DatabaseSync,
  write: Transaction,
  read: Transaction,
  identity: IdentityStore,
) {
  function sameScopeRow(
    row: { project_id: string; binding_id: string; worktree_id: string },
    scope: IdentityScope,
  ): boolean {
    return (
      row.project_id === scope.projectId &&
      row.binding_id === scope.bindingId &&
      row.worktree_id === scope.worktreeId
    );
  }

  function loadArenaHypotheses(sessionId: string): StoredArenaHypothesisSpec[] {
    const rows = database
      .prepare(
        `SELECT * FROM f5_arena_hypotheses WHERE session_id = ? ORDER BY ordinal ASC`,
      )
      .all(sessionId) as Record<string, unknown>[];

    return rows.map((row) => ({
      ordinal: row.ordinal as number,
      hypothesisId: row.hypothesis_id as string,
      label: row.label as string,
      summary: row.summary as string,
      targetPaths: JSON.parse(row.target_paths_json as string) as string[],
      proposedEdits: JSON.parse(
        row.proposed_edits_json as string,
      ) as PlannerProposedEdit[],
      commandArgv: row.command_argv_json
        ? (JSON.parse(row.command_argv_json as string) as string[])
        : null,
      mockBehavior: (row.mock_behavior as "complete" | "fail" | null) ?? null,
      observedBaseHead: (row.observed_base_head as string | null) ?? null,
      observedBaseIndexStamp:
        (row.observed_base_index_stamp as string | null) ?? null,
      observedBaseDigest: (row.observed_base_digest as string | null) ?? null,
      criteriaDigest: row.criteria_digest as string,
      planId: (row.plan_id as string | null) ?? null,
      grantId: (row.grant_id as string | null) ?? null,
      executionId: (row.execution_id as string | null) ?? null,
      dedicatedWorktreeId: (row.dedicated_worktree_id as string | null) ?? null,
      dedicatedRoot: (row.dedicated_root as string | null) ?? null,
      diffDigest: (row.diff_digest as string | null) ?? null,
      diffFiles: [],
      sourceRefs: JSON.parse(
        row.source_refs_json as string,
      ) as ArenaSourceRef[],
      state: row.state as ArenaHypothesisRecord["state"],
      failureCode: (row.failure_code as string | null) ?? null,
    }));
  }

  function loadArenaReview(sessionId: string): ArenaPairedReview | null {
    const row = database
      .prepare(`SELECT * FROM f5_arena_reviews WHERE session_id = ?`)
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      reviewId: row.review_id as string,
      outcome: row.outcome as ArenaPairedReview["outcome"],
      winnerHypothesisId: (row.winner_hypothesis_id as string | null) ?? null,
      reviewer: row.reviewer as string,
      rationale: row.rationale as string,
      reviewedHypothesisIds: JSON.parse(
        row.reviewed_hypothesis_ids_json as string,
      ) as string[],
      criterionScores: JSON.parse(
        row.criterion_scores_json as string,
      ) as ArenaPairedReview["criterionScores"],
      evidenceRefs: JSON.parse(row.evidence_refs_json as string) as string[],
      recordedAt: row.recorded_at as string,
      appliedToLocal: false,
    };
  }

  function mapArenaSession(
    row: Record<string, unknown>,
  ): ArenaSessionRecord & { hypothesisSpecs: StoredArenaHypothesisSpec[] } {
    const sessionId = row.session_id as string;
    const specs = loadArenaHypotheses(sessionId);
    const hypotheses: ArenaHypothesisRecord[] = specs.map(
      ({ commandArgv: _c, mockBehavior: _m, ...rest }) => {
        void _c;
        void _m;
        return rest;
      },
    );
    return {
      scope: {
        projectId: row.project_id as string,
        bindingId: row.binding_id as string,
        worktreeId: row.worktree_id as string,
      },
      sessionId,
      requestId: row.request_id as string,
      title: row.title as string,
      objective: row.objective as string,
      backendMode: row.backend_mode as PlannerBackendMode,
      status: row.status as ArenaSessionStatus,
      invalidationReason:
        (row.invalidation_reason as ArenaInvalidationReason | null) ?? null,
      base: JSON.parse(row.base_json as string) as PlannerGitBase,
      baseDigest: row.base_digest as string,
      criteria: JSON.parse(row.criteria_json as string) as ArenaCriteria,
      criteriaDigest: row.criteria_digest as string,
      hypotheses,
      pairedReview: loadArenaReview(sessionId),
      appliedToLocal: false,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      hypothesisSpecs: specs,
    };
  }

  function hydrateBkmHypothesis(
    row: Record<string, unknown>,
  ): BkmHypothesisRecord {
    const scope: IdentityScope = {
      projectId: row.project_id as string,
      bindingId: row.binding_id as string,
      worktreeId: row.worktree_id as string,
    };
    const hypothesisId = row.hypothesis_id as string;

    const evidenceRows = database
      .prepare(
        `SELECT * FROM f5_bkm_evidence
         WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND hypothesis_id = ?
         ORDER BY recorded_at ASC, evidence_id ASC`,
      )
      .all(
        scope.projectId,
        scope.bindingId,
        scope.worktreeId,
        hypothesisId,
      ) as Record<string, unknown>[];
    const evidence: BkmEvidenceRecord[] = evidenceRows.map((ev) => ({
      evidenceId: ev.evidence_id as string,
      polarity: ev.polarity as "support" | "oppose",
      originKey: ev.origin_key as string,
      originKind: ev.origin_kind as BkmEvidenceRecord["originKind"],
      sourceRefId: (ev.source_ref_id as string | null) ?? null,
      weight: Number(ev.weight),
      note: ev.note as string,
      recordedAt: ev.recorded_at as string,
    }));

    const transitionRows = database
      .prepare(
        `SELECT * FROM f5_bkm_transitions
         WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND hypothesis_id = ?
         ORDER BY recorded_at ASC, transition_id ASC`,
      )
      .all(
        scope.projectId,
        scope.bindingId,
        scope.worktreeId,
        hypothesisId,
      ) as Record<string, unknown>[];
    const transitions: BkmTransitionRecord[] = transitionRows.map((tr) => ({
      transitionId: tr.transition_id as string,
      fromState: tr.from_state as BkmHypothesisState,
      toState: tr.to_state as BkmHypothesisState,
      reason: tr.reason as string,
      reviewer: tr.reviewer as string,
      recordedAt: tr.recorded_at as string,
    }));

    const summary = summarizeBkmHypothesis(evidence);
    return {
      scope,
      hypothesisId,
      competingGroupKey: row.competing_group_key as string,
      category: row.category as BkmCategory,
      title: row.title as string,
      statement: row.statement as string,
      pattern: JSON.parse(row.pattern_json as string) as BkmPattern,
      state: row.state as BkmHypothesisState,
      ...summary,
      evidence,
      transitions,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  function mapEvaluationRow(row: Record<string, unknown>): EvaluationRunRecord {
    return {
      scope: {
        projectId: row.project_id as string,
        bindingId: row.binding_id as string,
        worktreeId: row.worktree_id as string,
      },
      evaluationId: row.evaluation_id as string,
      requestId: row.request_id as string,
      baselineVersion: row.baseline_version as string,
      strategyVersion: row.strategy_version as string,
      splitBoundaryAt: row.split_boundary_at as string,
      heldOutCount: Number(row.held_out_count),
      temporalSplitValid: row.temporal_split_valid === 1,
      projectIsolationValid: row.project_isolation_valid === 1,
      baselineMetrics: JSON.parse(
        row.baseline_metrics_json as string,
      ) as EvaluationMetrics,
      adaptiveMetrics: JSON.parse(
        row.adaptive_metrics_json as string,
      ) as EvaluationMetrics,
      recallGain: Number(row.recall_gain),
      temporalAccuracyGain: Number(row.temporal_accuracy_gain),
      decision: row.decision as EvaluationRunRecord["decision"],
      failedGates: JSON.parse(
        row.failed_gates_json as string,
      ) as AdaptiveGateFailure[],
      explanations: JSON.parse(
        row.explanations_json as string,
      ) as AdaptiveRankingExplanation[],
      reportDigest: row.report_digest as string,
      evaluatedAt: row.evaluated_at as string,
    };
  }

  function mapSuggestionRow(
    row: Record<string, unknown>,
  ): ProactiveSuggestionRecord {
    return {
      scope: {
        projectId: row.project_id as string,
        bindingId: row.binding_id as string,
        worktreeId: row.worktree_id as string,
      },
      suggestionId: row.suggestion_id as string,
      signalFingerprint: row.signal_fingerprint as string,
      signalKind: row.signal_kind as ProactiveSignalKind,
      title: row.title as string,
      rationale: row.rationale as string,
      priorityScore: Number(row.priority_score),
      priorityBand:
        row.priority_band as ProactiveSuggestionRecord["priorityBand"],
      sourceRefs: JSON.parse(
        row.source_refs_json as string,
      ) as ProactiveSourceRef[],
      proposedAction: JSON.parse(
        row.proposed_action_json as string,
      ) as ProactiveSuggestionRecord["proposedAction"],
      autoExecutable: false,
      status: row.status as ProactiveSuggestionStatus,
      snoozeUntil: (row.snooze_until as string | null) ?? null,
      dismissReason: (row.dismiss_reason as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  function mapScheduleRow(
    row: Record<string, unknown>,
  ): ProactiveScheduleRecord {
    return {
      scope: {
        projectId: row.project_id as string,
        bindingId: row.binding_id as string,
        worktreeId: row.worktree_id as string,
      },
      scheduleId: row.schedule_id as string,
      label: row.label as string,
      optInActive: row.opt_in_active === 1,
      status: row.status as ProactiveScheduleRecord["status"],
      windowStartUtc: row.window_start_utc as string,
      windowEndUtc: row.window_end_utc as string,
      allowedDaysUtc: JSON.parse(row.allowed_days_json as string) as number[],
      minIntervalMinutes: Number(row.min_interval_minutes),
      appClosedMode: "disabled_deferred",
      revokedAt: (row.revoked_at as string | null) ?? null,
      revokeReason: (row.revoke_reason as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  function mapScheduleRunRow(
    row: Record<string, unknown>,
  ): ProactiveScheduleRunRecord {
    return {
      scope: {
        projectId: row.project_id as string,
        bindingId: row.binding_id as string,
        worktreeId: row.worktree_id as string,
      },
      runId: row.run_id as string,
      scheduleId: row.schedule_id as string,
      windowKey: row.window_key as string,
      state: row.state as ProactiveScheduleRunRecord["state"],
      recoveredAfterRestart: row.recovered_after_restart === 1,
      duplicateSuppressed: row.duplicate_suppressed === 1,
      suggestionsFound: Number(row.suggestions_found),
      detail: row.detail as string,
      startedAt: row.started_at as string,
      finishedAt: (row.finished_at as string | null) ?? null,
    };
  }

  return {
    reconcileInterruptedSchedules(nowIso: string): number {
      return write(() => {
        const res = database
          .prepare(
            `UPDATE f5_proactive_schedule_runs
             SET state = 'interrupted_recovered',
                 recovered_after_restart = 1,
                 finished_at = ?,
                 detail = detail || ' [reconciliado apos reinicio sem duplicacao]'
             WHERE state = 'running'`,
          )
          .run(nowIso);
        return Number(res.changes);
      });
    },

    // ---- Arena (F5-M01) ----

    createArenaSession(params: {
      session: ArenaSessionRecord;
      hypothesisSpecs: {
        ordinal: number;
        hypothesisId: string;
        label: string;
        summary: string;
        targetPaths: string[];
        proposedEdits: PlannerProposedEdit[];
        commandArgv: string[] | null;
        mockBehavior: "complete" | "fail" | null;
        observedBaseHead: string | null;
        observedBaseIndexStamp: string | null;
        observedBaseDigest: string | null;
        criteriaDigest: string;
        sourceRefs: ArenaSourceRef[];
      }[];
    }): ArenaSessionRecord {
      return write(() => {
        identity.resolveScope(params.session.scope);
        const existing = database
          .prepare(
            `SELECT * FROM f5_arena_sessions
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND request_id = ?`,
          )
          .get(
            params.session.scope.projectId,
            params.session.scope.bindingId,
            params.session.scope.worktreeId,
            params.session.requestId,
          ) as Record<string, unknown> | undefined;
        if (existing) {
          const { hypothesisSpecs: _ignored, ...rest } =
            mapArenaSession(existing);
          void _ignored;
          return rest;
        }

        database
          .prepare(
            `INSERT INTO f5_arena_sessions (
              session_id, project_id, binding_id, worktree_id, request_id,
              title, objective, backend_mode, status, invalidation_reason,
              base_json, base_digest, criteria_json, criteria_digest,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            params.session.sessionId,
            params.session.scope.projectId,
            params.session.scope.bindingId,
            params.session.scope.worktreeId,
            params.session.requestId,
            params.session.title,
            params.session.objective,
            params.session.backendMode,
            params.session.status,
            params.session.invalidationReason,
            JSON.stringify(params.session.base),
            params.session.baseDigest,
            JSON.stringify(params.session.criteria),
            params.session.criteriaDigest,
            params.session.createdAt,
            params.session.updatedAt,
          );

        const insHyp = database.prepare(
          `INSERT INTO f5_arena_hypotheses (
            session_id, ordinal, hypothesis_id, label, summary,
            target_paths_json, proposed_edits_json, command_argv_json, mock_behavior,
            observed_base_head, observed_base_index_stamp, observed_base_digest,
            criteria_digest, plan_id, grant_id, execution_id, dedicated_worktree_id,
            dedicated_root, diff_digest, source_refs_json, state, failure_code
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, 'pending', NULL)`,
        );
        for (const h of params.hypothesisSpecs) {
          insHyp.run(
            params.session.sessionId,
            h.ordinal,
            h.hypothesisId,
            h.label,
            h.summary,
            JSON.stringify(h.targetPaths),
            JSON.stringify(h.proposedEdits),
            h.commandArgv ? JSON.stringify(h.commandArgv) : null,
            h.mockBehavior,
            h.observedBaseHead,
            h.observedBaseIndexStamp,
            h.observedBaseDigest,
            h.criteriaDigest,
            JSON.stringify(h.sourceRefs),
          );
        }

        const saved = database
          .prepare(`SELECT * FROM f5_arena_sessions WHERE session_id = ?`)
          .get(params.session.sessionId) as Record<string, unknown>;
        const { hypothesisSpecs: _ignored, ...rest } = mapArenaSession(saved);
        void _ignored;
        return rest;
      });
    },

    getArenaSessionWithSpecs(
      scope: IdentityScope,
      sessionId: string,
    ):
      | (ArenaSessionRecord & { hypothesisSpecs: StoredArenaHypothesisSpec[] })
      | null {
      return read(() => {
        identity.resolveScope(scope);
        const row = database
          .prepare(
            `SELECT * FROM f5_arena_sessions
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND session_id = ?`,
          )
          .get(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            sessionId,
          ) as Record<string, unknown> | undefined;
        return row ? mapArenaSession(row) : null;
      });
    },

    listArenaSessions(scope: IdentityScope): ArenaSessionRecord[] {
      return read(() => {
        identity.resolveScope(scope);
        const rows = database
          .prepare(
            `SELECT * FROM f5_arena_sessions
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
             ORDER BY sequence DESC LIMIT 50`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];
        return rows.map((row) => {
          const { hypothesisSpecs: _ignored, ...rest } = mapArenaSession(row);
          void _ignored;
          return rest;
        });
      });
    },

    updateArenaSessionStatus(params: {
      scope: IdentityScope;
      sessionId: string;
      status: ArenaSessionStatus;
      invalidationReason: ArenaInvalidationReason | null;
      updatedAt: string;
    }): void {
      write(() => {
        identity.resolveScope(params.scope);
        database
          .prepare(
            `UPDATE f5_arena_sessions
             SET status = ?, invalidation_reason = ?, updated_at = ?
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND session_id = ?`,
          )
          .run(
            params.status,
            params.invalidationReason,
            params.updatedAt,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.sessionId,
          );
      });
    },

    updateArenaHypothesis(params: {
      sessionId: string;
      hypothesisId: string;
      observedBaseHead?: string | null;
      observedBaseIndexStamp?: string | null;
      observedBaseDigest?: string | null;
      planId?: string | null;
      grantId?: string | null;
      executionId?: string | null;
      dedicatedWorktreeId?: string | null;
      dedicatedRoot?: string | null;
      diffDigest?: string | null;
      sourceRefs?: ArenaSourceRef[];
      state?: ArenaHypothesisRecord["state"];
      failureCode?: string | null;
    }): void {
      write(() => {
        database
          .prepare(
            `UPDATE f5_arena_hypotheses SET
               observed_base_head = COALESCE(?, observed_base_head),
               observed_base_index_stamp = COALESCE(?, observed_base_index_stamp),
               observed_base_digest = COALESCE(?, observed_base_digest),
               plan_id = COALESCE(?, plan_id),
               grant_id = COALESCE(?, grant_id),
               execution_id = COALESCE(?, execution_id),
               dedicated_worktree_id = COALESCE(?, dedicated_worktree_id),
               dedicated_root = COALESCE(?, dedicated_root),
               diff_digest = COALESCE(?, diff_digest),
               source_refs_json = COALESCE(?, source_refs_json),
               state = COALESCE(?, state),
               failure_code = ?
             WHERE session_id = ? AND hypothesis_id = ?`,
          )
          .run(
            params.observedBaseHead ?? null,
            params.observedBaseIndexStamp ?? null,
            params.observedBaseDigest ?? null,
            params.planId ?? null,
            params.grantId ?? null,
            params.executionId ?? null,
            params.dedicatedWorktreeId ?? null,
            params.dedicatedRoot ?? null,
            params.diffDigest ?? null,
            params.sourceRefs ? JSON.stringify(params.sourceRefs) : null,
            params.state ?? null,
            params.failureCode ?? null,
            params.sessionId,
            params.hypothesisId,
          );
      });
    },

    saveArenaReview(params: {
      scope: IdentityScope;
      sessionId: string;
      review: ArenaPairedReview & { requestId: string };
      updatedAt: string;
    }): ArenaSessionRecord {
      return write(() => {
        identity.resolveScope(params.scope);
        const existingByReq = database
          .prepare(
            `SELECT session_id FROM f5_arena_reviews
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND request_id = ?`,
          )
          .get(
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.review.requestId,
          ) as { session_id: string } | undefined;
        if (!existingByReq) {
          database
            .prepare(
              `INSERT INTO f5_arena_reviews (
                review_id, session_id, project_id, binding_id, worktree_id, request_id,
                outcome, winner_hypothesis_id, reviewer, rationale,
                reviewed_hypothesis_ids_json, criterion_scores_json, evidence_refs_json,
                applied_to_local, recorded_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            )
            .run(
              params.review.reviewId,
              params.sessionId,
              params.scope.projectId,
              params.scope.bindingId,
              params.scope.worktreeId,
              params.review.requestId,
              params.review.outcome,
              params.review.winnerHypothesisId,
              params.review.reviewer,
              params.review.rationale,
              JSON.stringify(params.review.reviewedHypothesisIds),
              JSON.stringify(params.review.criterionScores),
              JSON.stringify(params.review.evidenceRefs),
              params.review.recordedAt,
            );
          database
            .prepare(
              `UPDATE f5_arena_sessions SET status = 'reviewed', updated_at = ?
               WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND session_id = ?`,
            )
            .run(
              params.updatedAt,
              params.scope.projectId,
              params.scope.bindingId,
              params.scope.worktreeId,
              params.sessionId,
            );
        }
        const row = database
          .prepare(`SELECT * FROM f5_arena_sessions WHERE session_id = ?`)
          .get(params.sessionId) as Record<string, unknown>;
        const { hypothesisSpecs: _ignored, ...rest } = mapArenaSession(row);
        void _ignored;
        return rest;
      });
    },

    // ---- Replay passive read helpers (F5-M02) ----

    readReplayScopeArtifacts(scope: IdentityScope, knownAt: string) {
      return read(() => {
        identity.resolveScope(scope);
        const decisionRevs = database
          .prepare(
            `SELECT r.revision_id, r.assertion_id, r.revision, r.content, r.author,
                    r.authority, r.visibility, r.status, r.effective_at, r.recorded_at,
                    l.context_id, l.path AS evidence_path, l.sha256 AS evidence_sha256, l.chunk AS evidence_chunk
             FROM decisions d
             JOIN decision_revisions r ON r.assertion_id = d.assertion_id
             LEFT JOIN decision_evidence_links l ON l.revision_id = r.revision_id
             WHERE d.project_id = ? AND d.binding_id = ? AND d.worktree_id = ?
             ORDER BY r.assertion_id ASC, r.revision ASC`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];

        const decisionTombstones = database
          .prepare(
            `SELECT assertion_id, purged_at FROM decision_purge_tombstones
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
             ORDER BY purged_at ASC`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as {
          assertion_id: string;
          purged_at: string;
        }[];

        const f3Tombstones = database
          .prepare(
            `SELECT target_kind, target_id, purged_at FROM f3_purge_tombstones
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
             ORDER BY purged_at ASC`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as {
          target_kind: "claim" | "pin" | "overlay";
          target_id: string;
          purged_at: string;
        }[];

        const manifests = database
          .prepare(
            `SELECT manifest_digest, destination_id, policy_version, strategy_version, status,
                    compiled_at, public_manifest, preview_json
             FROM f2_compiled_manifests
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
               AND compiled_at <= ?
             ORDER BY compiled_at ASC`,
          )
          .all(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            knownAt,
          ) as Record<string, unknown>[];

        const grants = database
          .prepare(
            `SELECT grant_id, session_id, manifest_digest, policy_version, destination_id,
                    issued_at, expires_at, revoked_at
             FROM f2_session_grants
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
               AND issued_at <= ?
             ORDER BY issued_at ASC`,
          )
          .all(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            knownAt,
          ) as Record<string, unknown>[];

        const audits = database
          .prepare(
            `SELECT audit_id, grant_id, manifest_digest, channel, mode, state, started_at, finished_at
             FROM f2_query_audits
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
               AND started_at <= ?
             ORDER BY started_at ASC`,
          )
          .all(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            knownAt,
          ) as Record<string, unknown>[];

        const mcpReads = database
          .prepare(
            `SELECT grant_id, tool, opaque_ref, outcome, at
             FROM f2_mcp_access_log
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
               AND at <= ?
             ORDER BY sequence ASC`,
          )
          .all(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            knownAt,
          ) as Record<string, unknown>[];

        return {
          decisionRevs,
          decisionTombstones,
          f3Tombstones,
          manifests,
          grants,
          audits,
          mcpReads,
        };
      });
    },

    // ---- BKM & Adaptive Strategy (F5-M03) ----

    upsertBkmHypothesis(params: {
      scope: IdentityScope;
      hypothesisId: string;
      competingGroupKey: string;
      category: BkmCategory;
      title: string;
      statement: string;
      pattern: BkmPattern;
      evidence: BkmEvidenceRecord[];
      nowIso: string;
    }): BkmHypothesisRecord {
      return write(() => {
        identity.resolveScope(params.scope);
        const existing = database
          .prepare(
            `SELECT * FROM f5_bkm_hypotheses
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND hypothesis_id = ?`,
          )
          .get(
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.hypothesisId,
          ) as Record<string, unknown> | undefined;

        if (existing) {
          if (existing.state === "purged") {
            throw new GitError("learning_hypothesis_conflict");
          }
          database
            .prepare(
              `UPDATE f5_bkm_hypotheses
               SET competing_group_key = ?, category = ?, title = ?, statement = ?,
                   pattern_json = ?, updated_at = ?
               WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND hypothesis_id = ?`,
            )
            .run(
              params.competingGroupKey,
              params.category,
              params.title,
              params.statement,
              JSON.stringify(params.pattern),
              params.nowIso,
              params.scope.projectId,
              params.scope.bindingId,
              params.scope.worktreeId,
              params.hypothesisId,
            );
        } else {
          database
            .prepare(
              `INSERT INTO f5_bkm_hypotheses (
                project_id, binding_id, worktree_id, hypothesis_id, competing_group_key,
                category, title, statement, pattern_json, state, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)`,
            )
            .run(
              params.scope.projectId,
              params.scope.bindingId,
              params.scope.worktreeId,
              params.hypothesisId,
              params.competingGroupKey,
              params.category,
              params.title,
              params.statement,
              JSON.stringify(params.pattern),
              params.nowIso,
              params.nowIso,
            );
        }

        const insEv = database.prepare(
          `INSERT INTO f5_bkm_evidence (
            evidence_id, project_id, binding_id, worktree_id, hypothesis_id,
            polarity, origin_key, origin_kind, source_ref_id, weight, note, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const ev of params.evidence) {
          insEv.run(
            ev.evidenceId,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.hypothesisId,
            ev.polarity,
            ev.originKey,
            ev.originKind,
            ev.sourceRefId,
            ev.weight,
            ev.note,
            ev.recordedAt,
          );
        }

        const saved = database
          .prepare(
            `SELECT * FROM f5_bkm_hypotheses
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND hypothesis_id = ?`,
          )
          .get(
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.hypothesisId,
          ) as Record<string, unknown>;
        return hydrateBkmHypothesis(saved);
      });
    },

    getBkmHypothesis(
      scope: IdentityScope,
      hypothesisId: string,
    ): BkmHypothesisRecord | null {
      return read(() => {
        identity.resolveScope(scope);
        const row = database
          .prepare(
            `SELECT * FROM f5_bkm_hypotheses
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND hypothesis_id = ?`,
          )
          .get(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            hypothesisId,
          ) as Record<string, unknown> | undefined;
        return row ? hydrateBkmHypothesis(row) : null;
      });
    },

    listBkmHypotheses(scope: IdentityScope): BkmHypothesisRecord[] {
      return read(() => {
        identity.resolveScope(scope);
        const rows = database
          .prepare(
            `SELECT * FROM f5_bkm_hypotheses
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
             ORDER BY updated_at DESC, hypothesis_id ASC`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];
        return rows.map(hydrateBkmHypothesis);
      });
    },

    transitionBkmHypothesis(params: {
      scope: IdentityScope;
      hypothesisId: string;
      fromState: BkmHypothesisState;
      toState: BkmHypothesisState;
      reason: string;
      reviewer: string;
      transitionId: string;
      supersedeCompetitors: {
        hypothesisId: string;
        fromState: BkmHypothesisState;
        transitionId: string;
      }[];
      nowIso: string;
    }): BkmHypothesisRecord {
      return write(() => {
        identity.resolveScope(params.scope);
        const updStmt = database.prepare(
          `UPDATE f5_bkm_hypotheses SET state = ?, updated_at = ?
           WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND hypothesis_id = ?`,
        );
        const trStmt = database.prepare(
          `INSERT INTO f5_bkm_transitions (
            transition_id, project_id, binding_id, worktree_id, hypothesis_id,
            from_state, to_state, reason, reviewer, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        for (const comp of params.supersedeCompetitors) {
          updStmt.run(
            "superseded",
            params.nowIso,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            comp.hypothesisId,
          );
          trStmt.run(
            comp.transitionId,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            comp.hypothesisId,
            comp.fromState,
            "superseded",
            `Preterida pela ativacao de ${params.hypothesisId}: ${params.reason}`,
            params.reviewer,
            params.nowIso,
          );
        }

        updStmt.run(
          params.toState,
          params.nowIso,
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.hypothesisId,
        );
        trStmt.run(
          params.transitionId,
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.hypothesisId,
          params.fromState,
          params.toState,
          params.reason,
          params.reviewer,
          params.nowIso,
        );

        const row = database
          .prepare(
            `SELECT * FROM f5_bkm_hypotheses
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND hypothesis_id = ?`,
          )
          .get(
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.hypothesisId,
          ) as Record<string, unknown>;
        return hydrateBkmHypothesis(row);
      });
    },

    insertAdaptiveEvaluation(record: EvaluationRunRecord): EvaluationRunRecord {
      return write(() => {
        identity.resolveScope(record.scope);
        const existing = database
          .prepare(
            `SELECT * FROM f5_adaptive_evaluations
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND request_id = ?`,
          )
          .get(
            record.scope.projectId,
            record.scope.bindingId,
            record.scope.worktreeId,
            record.requestId,
          ) as Record<string, unknown> | undefined;
        if (existing) return mapEvaluationRow(existing);

        database
          .prepare(
            `INSERT INTO f5_adaptive_evaluations (
              evaluation_id, project_id, binding_id, worktree_id, request_id,
              baseline_version, strategy_version, split_boundary_at, held_out_count,
              temporal_split_valid, project_isolation_valid,
              baseline_metrics_json, adaptive_metrics_json, recall_gain, temporal_accuracy_gain,
              decision, failed_gates_json, explanations_json, report_digest, evaluated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            record.evaluationId,
            record.scope.projectId,
            record.scope.bindingId,
            record.scope.worktreeId,
            record.requestId,
            record.baselineVersion,
            record.strategyVersion,
            record.splitBoundaryAt,
            record.heldOutCount,
            record.temporalSplitValid ? 1 : 0,
            record.projectIsolationValid ? 1 : 0,
            JSON.stringify(record.baselineMetrics),
            JSON.stringify(record.adaptiveMetrics),
            record.recallGain,
            record.temporalAccuracyGain,
            record.decision,
            JSON.stringify(record.failedGates),
            JSON.stringify(record.explanations),
            record.reportDigest,
            record.evaluatedAt,
          );
        return record;
      });
    },

    getAdaptiveEvaluation(
      scope: IdentityScope,
      evaluationId: string,
    ): EvaluationRunRecord | null {
      return read(() => {
        identity.resolveScope(scope);
        const row = database
          .prepare(
            `SELECT * FROM f5_adaptive_evaluations
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND evaluation_id = ?`,
          )
          .get(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            evaluationId,
          ) as Record<string, unknown> | undefined;
        return row ? mapEvaluationRow(row) : null;
      });
    },

    setAdaptiveStrategyState(params: {
      scope: IdentityScope;
      activeMode: "baseline_fts5" | "adaptive_symbolic";
      activeVersion: string;
      evaluationId: string | null;
      activatedAt: string | null;
      activatedBy: string | null;
      rollbackReason: string | null;
    }): AdaptiveStrategyStatusResult {
      return write(() => {
        identity.resolveScope(params.scope);
        database
          .prepare(
            `INSERT INTO f5_adaptive_strategy_state (
              project_id, binding_id, worktree_id, active_mode, active_version,
              evaluation_id, activated_at, activated_by, rollback_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, binding_id, worktree_id) DO UPDATE SET
              active_mode = excluded.active_mode,
              active_version = excluded.active_version,
              evaluation_id = excluded.evaluation_id,
              activated_at = excluded.activated_at,
              activated_by = excluded.activated_by,
              rollback_reason = excluded.rollback_reason`,
          )
          .run(
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.activeMode,
            params.activeVersion,
            params.evaluationId,
            params.activatedAt,
            params.activatedBy,
            params.rollbackReason,
          );
        return this.getAdaptiveStrategyStatus(params.scope);
      });
    },

    getAdaptiveStrategyStatus(
      scope: IdentityScope,
    ): AdaptiveStrategyStatusResult {
      return read(() => {
        identity.resolveScope(scope);
        const stateRow = database
          .prepare(
            `SELECT * FROM f5_adaptive_strategy_state
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?`,
          )
          .get(scope.projectId, scope.bindingId, scope.worktreeId) as
          Record<string, unknown> | undefined;

        const evalRows = database
          .prepare(
            `SELECT * FROM f5_adaptive_evaluations
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
             ORDER BY sequence DESC LIMIT 20`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];
        const evaluations = evalRows.map(mapEvaluationRow);

        return {
          scope,
          activeMode:
            (stateRow?.active_mode as "baseline_fts5" | "adaptive_symbolic") ??
            "baseline_fts5",
          activeVersion:
            (stateRow?.active_version as string) ??
            adaptiveDefaultBaselineVersion,
          evaluationId: (stateRow?.evaluation_id as string | null) ?? null,
          activatedAt: (stateRow?.activated_at as string | null) ?? null,
          activatedBy: (stateRow?.activated_by as string | null) ?? null,
          rollbackReason: (stateRow?.rollback_reason as string | null) ?? null,
          latestEvaluation: evaluations[0] ?? null,
          evaluations,
        };
      });
    },

    // ---- Proactivity & Schedules (F5-M04) ----

    readProactivitySourceSignals(scope: IdentityScope) {
      return read(() => {
        identity.resolveScope(scope);
        const inboxPending = database
          .prepare(
            `SELECT proposal_id, title, duplicate_count, expires_at
             FROM f3_inbox_proposals
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND status = 'pending'`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];

        const overlaysWithGaps = database
          .prepare(
            `SELECT overlay_id, label, gap_count
             FROM f3_dirty_overlays
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND gap_count > 0`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];

        const driftedPlans = database
          .prepare(
            `SELECT plan_id, title, preflight_status
             FROM f4_plans
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND preflight_status = 'invalidated_by_drift'`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];

        const unreviewedDiffs = database
          .prepare(
            `SELECT d.execution_id, d.plan_id, d.diff_digest
             FROM f4_execution_diffs d
             LEFT JOIN f4_diff_reviews r ON r.execution_id = d.execution_id
             WHERE d.project_id = ? AND d.binding_id = ? AND d.worktree_id = ? AND r.execution_id IS NULL`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];

        const pendingVerifiers = database
          .prepare(
            `SELECT definition_id, label, approval_status
             FROM f4_verifiers
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
               AND approval_status IN ('pending', 'revoked_by_redefinition')`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];

        return {
          inboxPending,
          overlaysWithGaps,
          driftedPlans,
          unreviewedDiffs,
          pendingVerifiers,
        };
      });
    },

    upsertProactiveSuggestions(params: {
      scope: IdentityScope;
      items: Omit<
        ProactiveSuggestionRecord,
        "status" | "snoozeUntil" | "dismissReason"
      >[];
      telemetryEventId: string;
      nowIso: string;
    }): {
      suggestions: ProactiveSuggestionRecord[];
      telemetry: ProactivityTelemetrySummary;
    } {
      return write(() => {
        identity.resolveScope(params.scope);
        const findByFp = database.prepare(
          `SELECT * FROM f5_proactive_suggestions
           WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND signal_fingerprint = ?`,
        );
        const insSug = database.prepare(
          `INSERT INTO f5_proactive_suggestions (
            suggestion_id, project_id, binding_id, worktree_id, signal_fingerprint,
            signal_kind, title, rationale, priority_score, priority_band,
            source_refs_json, proposed_action_json, status, snooze_until, dismiss_reason,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, ?, ?)`,
        );
        const updSug = database.prepare(
          `UPDATE f5_proactive_suggestions SET
             title = ?, rationale = ?, priority_score = ?, priority_band = ?,
             source_refs_json = ?, proposed_action_json = ?, updated_at = ?
           WHERE suggestion_id = ?`,
        );

        for (const item of params.items) {
          const existing = findByFp.get(
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            item.signalFingerprint,
          ) as Record<string, unknown> | undefined;
          if (!existing) {
            insSug.run(
              item.suggestionId,
              params.scope.projectId,
              params.scope.bindingId,
              params.scope.worktreeId,
              item.signalFingerprint,
              item.signalKind,
              item.title,
              item.rationale,
              item.priorityScore,
              item.priorityBand,
              JSON.stringify(item.sourceRefs),
              JSON.stringify(item.proposedAction),
              item.createdAt,
              item.updatedAt,
            );
          } else {
            updSug.run(
              item.title,
              item.rationale,
              item.priorityScore,
              item.priorityBand,
              JSON.stringify(item.sourceRefs),
              JSON.stringify(item.proposedAction),
              params.nowIso,
              existing.suggestion_id as string,
            );
          }
        }

        database
          .prepare(
            `INSERT INTO f5_proactivity_telemetry (
              event_id, project_id, binding_id, worktree_id, suggestion_id,
              event_kind, estimated_manual_seconds, estimated_saved_seconds, recorded_at
            ) VALUES (?, ?, ?, ?, NULL, 'evaluated', 0, 0, ?)`,
          )
          .run(
            params.telemetryEventId,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.nowIso,
          );

        return this.listProactiveSuggestions(params.scope);
      });
    },

    listProactiveSuggestions(scope: IdentityScope): {
      suggestions: ProactiveSuggestionRecord[];
      telemetry: ProactivityTelemetrySummary;
    } {
      return read(() => {
        identity.resolveScope(scope);
        const rows = database
          .prepare(
            `SELECT * FROM f5_proactive_suggestions
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
             ORDER BY priority_score DESC, updated_at DESC`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];
        const telRows = database
          .prepare(
            `SELECT event_kind AS eventKind,
                    estimated_manual_seconds AS estimatedManualSeconds,
                    estimated_saved_seconds AS estimatedSavedSeconds
             FROM f5_proactivity_telemetry
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as {
          eventKind:
            "evaluated" | "accepted" | "dismissed" | "snoozed" | "restored";
          estimatedManualSeconds: number;
          estimatedSavedSeconds: number;
        }[];
        return {
          suggestions: rows.map(mapSuggestionRow),
          telemetry: computeProactivityTelemetry(telRows),
        };
      });
    },

    respondProactiveSuggestion(params: {
      scope: IdentityScope;
      suggestionId: string;
      status: ProactiveSuggestionStatus;
      snoozeUntil: string | null;
      dismissReason: string | null;
      eventId: string;
      eventKind: "accepted" | "dismissed" | "snoozed" | "restored";
      estimatedManualSeconds: number;
      estimatedSavedSeconds: number;
      nowIso: string;
    }): {
      suggestion: ProactiveSuggestionRecord;
      telemetry: ProactivityTelemetrySummary;
    } {
      return write(() => {
        identity.resolveScope(params.scope);
        const row = database
          .prepare(
            `SELECT * FROM f5_proactive_suggestions WHERE suggestion_id = ?`,
          )
          .get(params.suggestionId) as Record<string, unknown> | undefined;
        if (
          !row ||
          !sameScopeRow(
            row as {
              project_id: string;
              binding_id: string;
              worktree_id: string;
            },
            params.scope,
          )
        ) {
          throw new GitError("intelligence_not_found");
        }

        database
          .prepare(
            `UPDATE f5_proactive_suggestions
             SET status = ?, snooze_until = ?, dismiss_reason = ?, updated_at = ?
             WHERE suggestion_id = ?`,
          )
          .run(
            params.status,
            params.snoozeUntil,
            params.dismissReason,
            params.nowIso,
            params.suggestionId,
          );

        database
          .prepare(
            `INSERT INTO f5_proactivity_telemetry (
              event_id, project_id, binding_id, worktree_id, suggestion_id,
              event_kind, estimated_manual_seconds, estimated_saved_seconds, recorded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            params.eventId,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.suggestionId,
            params.eventKind,
            params.estimatedManualSeconds,
            params.estimatedSavedSeconds,
            params.nowIso,
          );

        const updated = database
          .prepare(
            `SELECT * FROM f5_proactive_suggestions WHERE suggestion_id = ?`,
          )
          .get(params.suggestionId) as Record<string, unknown>;
        const { telemetry } = this.listProactiveSuggestions(params.scope);
        return {
          suggestion: mapSuggestionRow(updated),
          telemetry,
        };
      });
    },

    upsertProactiveSchedule(
      record: ProactiveScheduleRecord,
    ): ProactiveScheduleRecord {
      return write(() => {
        identity.resolveScope(record.scope);
        database
          .prepare(
            `INSERT INTO f5_proactive_schedules (
              project_id, binding_id, worktree_id, schedule_id, label,
              opt_in_active, status, window_start_utc, window_end_utc,
              allowed_days_json, min_interval_minutes, app_closed_mode,
              revoked_at, revoke_reason, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disabled_deferred', NULL, NULL, ?, ?)
            ON CONFLICT(project_id, binding_id, worktree_id, schedule_id) DO UPDATE SET
              label = excluded.label,
              opt_in_active = excluded.opt_in_active,
              status = excluded.status,
              window_start_utc = excluded.window_start_utc,
              window_end_utc = excluded.window_end_utc,
              allowed_days_json = excluded.allowed_days_json,
              min_interval_minutes = excluded.min_interval_minutes,
              revoked_at = NULL,
              revoke_reason = NULL,
              updated_at = excluded.updated_at`,
          )
          .run(
            record.scope.projectId,
            record.scope.bindingId,
            record.scope.worktreeId,
            record.scheduleId,
            record.label,
            record.optInActive ? 1 : 0,
            record.status,
            record.windowStartUtc,
            record.windowEndUtc,
            JSON.stringify(record.allowedDaysUtc),
            record.minIntervalMinutes,
            record.createdAt,
            record.updatedAt,
          );
        return this.getProactiveSchedule(record.scope, record.scheduleId)!;
      });
    },

    getProactiveSchedule(
      scope: IdentityScope,
      scheduleId: string,
    ): ProactiveScheduleRecord | null {
      return read(() => {
        identity.resolveScope(scope);
        const row = database
          .prepare(
            `SELECT * FROM f5_proactive_schedules
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND schedule_id = ?`,
          )
          .get(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            scheduleId,
          ) as Record<string, unknown> | undefined;
        return row ? mapScheduleRow(row) : null;
      });
    },

    revokeProactiveSchedule(
      scope: IdentityScope,
      scheduleId: string,
      reason: string,
      nowIso: string,
    ): ProactiveScheduleRecord {
      return write(() => {
        identity.resolveScope(scope);
        const res = database
          .prepare(
            `UPDATE f5_proactive_schedules
             SET opt_in_active = 0, status = 'revoked', revoked_at = ?, revoke_reason = ?, updated_at = ?
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND schedule_id = ?`,
          )
          .run(
            nowIso,
            reason,
            nowIso,
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            scheduleId,
          );
        if (Number(res.changes) === 0) {
          throw new GitError("intelligence_not_found");
        }
        return this.getProactiveSchedule(scope, scheduleId)!;
      });
    },

    listProactiveSchedules(scope: IdentityScope): {
      schedules: ProactiveScheduleRecord[];
      runs: ProactiveScheduleRunRecord[];
    } {
      return read(() => {
        identity.resolveScope(scope);
        const sRows = database
          .prepare(
            `SELECT * FROM f5_proactive_schedules
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
             ORDER BY updated_at DESC`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];
        const rRows = database
          .prepare(
            `SELECT * FROM f5_proactive_schedule_runs
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
             ORDER BY started_at DESC LIMIT 50`,
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as Record<
          string,
          unknown
        >[];
        return {
          schedules: sRows.map(mapScheduleRow),
          runs: rRows.map(mapScheduleRunRow),
        };
      });
    },

    findScheduleRunByWindow(
      scope: IdentityScope,
      scheduleId: string,
      windowKey: string,
    ): ProactiveScheduleRunRecord | null {
      return read(() => {
        const row = database
          .prepare(
            `SELECT * FROM f5_proactive_schedule_runs
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
               AND schedule_id = ? AND window_key = ?`,
          )
          .get(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            scheduleId,
            windowKey,
          ) as Record<string, unknown> | undefined;
        return row ? mapScheduleRunRow(row) : null;
      });
    },

    insertScheduleRun(
      run: ProactiveScheduleRunRecord,
    ): ProactiveScheduleRunRecord {
      return write(() => {
        identity.resolveScope(run.scope);
        database
          .prepare(
            `INSERT INTO f5_proactive_schedule_runs (
              run_id, project_id, binding_id, worktree_id, schedule_id, window_key,
              state, recovered_after_restart, duplicate_suppressed, suggestions_found,
              detail, started_at, finished_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            run.runId,
            run.scope.projectId,
            run.scope.bindingId,
            run.scope.worktreeId,
            run.scheduleId,
            run.windowKey,
            run.state,
            run.recoveredAfterRestart ? 1 : 0,
            run.duplicateSuppressed ? 1 : 0,
            run.suggestionsFound,
            run.detail,
            run.startedAt,
            run.finishedAt,
          );
        return run;
      });
    },

    finishScheduleRun(params: {
      scope: IdentityScope;
      runId: string;
      state: ProactiveScheduleRunRecord["state"];
      suggestionsFound: number;
      detail: string;
      finishedAt: string;
    }): ProactiveScheduleRunRecord {
      return write(() => {
        identity.resolveScope(params.scope);
        const res = database
          .prepare(
            `UPDATE f5_proactive_schedule_runs
             SET state = ?, suggestions_found = ?, detail = ?, finished_at = ?
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND run_id = ?`,
          )
          .run(
            params.state,
            params.suggestionsFound,
            params.detail,
            params.finishedAt,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.runId,
          );
        if (Number(res.changes) === 0) {
          throw new GitError("intelligence_not_found");
        }
        const row = database
          .prepare(`SELECT * FROM f5_proactive_schedule_runs WHERE run_id = ?`)
          .get(params.runId) as Record<string, unknown>;
        return mapScheduleRunRow(row);
      });
    },
  };
}
