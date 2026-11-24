import { randomUUID } from "node:crypto";
import type {
  IdentityScope,
  ProactiveScheduleControlInput,
  ProactiveScheduleListResult,
  ProactiveScheduleRecord,
  ProactiveScheduleRunRecord,
  ProactiveScheduleUpsertInput,
  ProactivityEvaluateResult,
  ProactivitySuggestionListResult,
  ProactivitySuggestionRespondInput,
  ProactivitySuggestionRespondResult,
} from "@laplace/contracts";
import {
  evaluateProactiveSignals,
  evaluateScheduleWindow,
  projectBitemporalState,
  type ProactiveSignalCandidate,
} from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import { GitError } from "./git.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

export function createProactivityService(deps: {
  withCatalog: WithCatalog;
  now?: () => string;
  simulateCrashBeforeFinish?: boolean;
}) {
  const now = deps.now ?? (() => new Date().toISOString());

  function scopeOf(input: IdentityScope): IdentityScope {
    return {
      projectId: input.projectId,
      bindingId: input.bindingId,
      worktreeId: input.worktreeId,
    };
  }

  function evaluateInternal(scope: IdentityScope): ProactivityEvaluateResult {
    const evaluatedAt = now();
    return deps.withCatalog((store) => {
      store.identity.resolveScope(scope);
      const { revisions } = store.f3.listAllScopeClaimsAndRevisions(scope);
      const { conflicts } = projectBitemporalState(revisions, {
        knownAt: evaluatedAt,
        validAt: null,
      });
      const rawSignals = store.f5.readProactivitySourceSignals(scope);
      const candidates: ProactiveSignalCandidate[] = [];

      for (const conflict of conflicts) {
        candidates.push({
          signalKind: "bitemporal_conflict",
          subjectId: conflict.conflictKey,
          title: `Conflito bitemporal em "${conflict.conflictKey}"`,
          rationale: conflict.summary,
          baseWeight: 80,
          sourceRefs: conflict.revisionIds.map((id) => ({
            kind: "claim",
            id,
            detail: `Revisao em conflito (${conflict.conflictKey})`,
          })),
          proposedAction: {
            kind: "resolve_conflict",
            label: "Revisar conflito na Memória F3",
            targetSection: "memory",
          },
        });
      }

      for (const item of rawSignals.inboxPending) {
        const dupCount = Number(item.duplicate_count);
        candidates.push({
          signalKind: "inbox_pending_critical",
          subjectId: item.proposal_id as string,
          title: `Proposta pendente no Inbox: ${item.title as string}`,
          rationale: `Item aguardando revisao humana (${dupCount} ocorrencia(s), expira em ${item.expires_at as string}).`,
          baseWeight: dupCount > 1 ? 75 : 55,
          sourceRefs: [
            {
              kind: "inbox_proposal",
              id: item.proposal_id as string,
              detail: `duplicateCount=${dupCount}`,
            },
          ],
          proposedAction: {
            kind: "review_inbox",
            label: "Revisar proposta no Inbox",
            targetSection: "memory",
          },
        });
      }

      for (const plan of rawSignals.driftedPlans) {
        candidates.push({
          signalKind: "planner_drift",
          subjectId: plan.plan_id as string,
          title: `Drift detectado no plano "${plan.title as string}"`,
          rationale:
            "Base Git alterada desde a criacao do plano; reexecucao bloqueada ate novo Pre-Flight.",
          baseWeight: 72,
          sourceRefs: [
            {
              kind: "planner_plan",
              id: plan.plan_id as string,
              detail: "preflight=invalidated_by_drift",
            },
          ],
          proposedAction: {
            kind: "rerun_preflight",
            label: "Revalidar Pre-Flight no Planejador",
            targetSection: "planner",
          },
        });
      }

      for (const diff of rawSignals.unreviewedDiffs) {
        candidates.push({
          signalKind: "diff_awaiting_review",
          subjectId: diff.execution_id as string,
          title: "Diff supervisionado aguardando revisao humana",
          rationale: `Execucao ${(diff.execution_id as string).slice(0, 8)} produziu diff verificavel (${(diff.diff_digest as string).slice(0, 12)}) ainda sem revisao.`,
          baseWeight: 68,
          sourceRefs: [
            {
              kind: "planner_execution",
              id: diff.execution_id as string,
              detail: `diffDigest=${diff.diff_digest as string}`,
            },
          ],
          proposedAction: {
            kind: "open_review",
            label: "Abrir revisao de diff F4",
            targetSection: "planner",
          },
        });
      }

      for (const ver of rawSignals.pendingVerifiers) {
        candidates.push({
          signalKind: "verifier_pending_or_revoked",
          subjectId: ver.definition_id as string,
          title: `Verificador "${ver.label as string}" aguarda aprovacao`,
          rationale: `Estado atual: ${ver.approval_status as string}.`,
          baseWeight:
            ver.approval_status === "revoked_by_redefinition" ? 78 : 48,
          sourceRefs: [
            {
              kind: "verifier",
              id: ver.definition_id as string,
              detail: ver.approval_status as string,
            },
          ],
          proposedAction: {
            kind: "approve_verifier",
            label: "Conferir definicao do verificador",
            targetSection: "planner",
          },
        });
      }

      for (const ov of rawSignals.overlaysWithGaps) {
        candidates.push({
          signalKind: "overlay_gap",
          subjectId: ov.overlay_id as string,
          title: `Overlay "${ov.label as string}" possui lacunas`,
          rationale: `${Number(ov.gap_count)} lacuna(s) declarada(s) no DirtyOverlayManifest.`,
          baseWeight: 50,
          sourceRefs: [
            {
              kind: "overlay",
              id: ov.overlay_id as string,
              detail: `gapCount=${Number(ov.gap_count)}`,
            },
          ],
          proposedAction: {
            kind: "inspect_overlay",
            label: "Inspecionar Dirty Overlay",
            targetSection: "memory",
          },
        });
      }

      const computed = evaluateProactiveSignals({
        scope,
        signals: candidates,
        nowIso: evaluatedAt,
      });

      const saved = store.f5.upsertProactiveSuggestions({
        scope,
        items: computed.map((item) => ({
          ...item,
          suggestionId: randomUUID(),
          createdAt: evaluatedAt,
          updatedAt: evaluatedAt,
        })),
        telemetryEventId: randomUUID(),
        nowIso: evaluatedAt,
      });

      return {
        scope,
        evaluatedAt,
        mutatedOrigin: false,
        suggestions: saved.suggestions,
        telemetry: saved.telemetry,
      };
    });
  }

  return {
    evaluate(scope: IdentityScope): ProactivityEvaluateResult {
      return evaluateInternal(scopeOf(scope));
    },

    suggestionList(scope: IdentityScope): ProactivitySuggestionListResult {
      const cleanScope = scopeOf(scope);
      return deps.withCatalog((store) => {
        const res = store.f5.listProactiveSuggestions(cleanScope);
        return { scope: cleanScope, ...res };
      });
    },

    suggestionRespond(
      input: ProactivitySuggestionRespondInput,
    ): ProactivitySuggestionRespondResult {
      const scope = scopeOf(input);
      const nowIso = now();
      let status: "active" | "snoozed" | "dismissed" | "accepted";
      let eventKind: "accepted" | "dismissed" | "snoozed" | "restored";
      let snoozeUntil: string | null = null;
      let dismissReason: string | null = null;
      let manualSec = 0;
      let savedSec = 0;

      if (input.action === "accept_proposal") {
        status = "accepted";
        eventKind = "accepted";
        manualSec = 180;
        savedSec = 120;
      } else if (input.action === "dismiss") {
        status = "dismissed";
        eventKind = "dismissed";
        dismissReason = input.reason ?? "Dispensada pelo operador";
      } else if (input.action === "snooze") {
        if (!input.snoozeUntil) {
          throw new GitError("intelligence_invalid_input");
        }
        status = "snoozed";
        eventKind = "snoozed";
        snoozeUntil = input.snoozeUntil;
      } else {
        status = "active";
        eventKind = "restored";
      }

      const res = deps.withCatalog((store) =>
        store.f5.respondProactiveSuggestion({
          scope,
          suggestionId: input.suggestionId,
          status,
          snoozeUntil,
          dismissReason,
          eventId: randomUUID(),
          eventKind,
          estimatedManualSeconds: manualSec,
          estimatedSavedSeconds: savedSec,
          nowIso,
        }),
      );

      return {
        scope,
        suggestion: res.suggestion,
        telemetry: res.telemetry,
        autoExecuted: false,
      };
    },

    scheduleUpsert(
      input: ProactiveScheduleUpsertInput,
    ): ProactiveScheduleRecord {
      if (
        input.runWhenAppClosed === true ||
        (input.appClosedMode !== undefined &&
          input.appClosedMode !== "disabled_deferred")
      ) {
        throw new GitError("proactivity_opt_in_required");
      }
      if (!input.optInConfirmed) {
        throw new GitError("proactivity_opt_in_required");
      }
      const scope = scopeOf(input);
      const nowIso = now();
      const record: ProactiveScheduleRecord = {
        scope,
        scheduleId: input.scheduleId ?? `sched-${randomUUID().slice(0, 10)}`,
        label: input.label,
        optInActive: true,
        status: "active",
        windowStartUtc: input.windowStartUtc,
        windowEndUtc: input.windowEndUtc,
        allowedDaysUtc: input.allowedDaysUtc,
        minIntervalMinutes: input.minIntervalMinutes,
        appClosedMode: "disabled_deferred",
        revokedAt: null,
        revokeReason: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      return deps.withCatalog((store) =>
        store.f5.upsertProactiveSchedule(record),
      );
    },

    scheduleList(scope: IdentityScope): ProactiveScheduleListResult {
      const cleanScope = scopeOf(scope);
      return deps.withCatalog((store) => {
        const res = store.f5.listProactiveSchedules(cleanScope);
        return {
          scope: cleanScope,
          schedules: res.schedules,
          runs: res.runs,
          appClosedSupported: false,
        };
      });
    },

    scheduleControl(
      input: ProactiveScheduleControlInput,
    ): ProactiveScheduleRunRecord | ProactiveScheduleRecord {
      const scope = scopeOf(input);
      const nowIso = now();

      if (input.action === "revoke") {
        if (!input.humanConfirmed) {
          throw new GitError("proactivity_opt_in_required");
        }
        return deps.withCatalog((store) =>
          store.f5.revokeProactiveSchedule(
            scope,
            input.scheduleId,
            input.reason ?? "Opt-in revogado pelo usuario",
            nowIso,
          ),
        );
      }

      if (input.action === "cancel_run") {
        const runId = input.runId;
        if (!runId) {
          throw new GitError("intelligence_invalid_input");
        }
        return deps.withCatalog((store) =>
          store.f5.finishScheduleRun({
            scope,
            runId,
            state: "cancelled",
            suggestionsFound: 0,
            detail: input.reason ?? "Execucao de janela cancelada.",
            finishedAt: nowIso,
          }),
        );
      }

      // action === "trigger_window"
      const evaluatedAt = input.evaluatedAt ?? nowIso;
      const schedule = deps.withCatalog((store) =>
        store.f5.getProactiveSchedule(scope, input.scheduleId),
      );
      if (!schedule) {
        throw new GitError("intelligence_not_found");
      }

      const check = evaluateScheduleWindow(schedule, evaluatedAt);
      if (!check.allowed) {
        throw new GitError("proactivity_opt_in_required");
      }

      const existing = deps.withCatalog((store) =>
        store.f5.findScheduleRunByWindow(
          scope,
          schedule.scheduleId,
          check.windowKey,
        ),
      );
      if (existing) {
        return {
          ...existing,
          duplicateSuppressed: true,
        };
      }

      const runId = randomUUID();
      deps.withCatalog((store) =>
        store.f5.insertScheduleRun({
          scope,
          runId,
          scheduleId: schedule.scheduleId,
          windowKey: check.windowKey,
          state: "running",
          recoveredAfterRestart: false,
          duplicateSuppressed: false,
          suggestionsFound: 0,
          detail: "Avaliacao proativa em janela opt-in iniciada.",
          startedAt: evaluatedAt,
          finishedAt: null,
        }),
      );

      if (deps.simulateCrashBeforeFinish) {
        return deps.withCatalog((store) =>
          store.f5.findScheduleRunByWindow(
            scope,
            schedule.scheduleId,
            check.windowKey,
          )!,
        );
      }

      const evaluated = evaluateInternal(scope);
      return deps.withCatalog((store) =>
        store.f5.finishScheduleRun({
          scope,
          runId,
          state: "completed",
          suggestionsFound: evaluated.suggestions.length,
          detail: `Janela concluida passivamente (${evaluated.suggestions.length} sugestao(oes)).`,
          finishedAt: now(),
        }),
      );
    },
  };
}
