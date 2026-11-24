import { randomUUID } from "node:crypto";
import {
  adaptiveDefaultBaselineVersion,
  adaptiveDefaultStrategyVersion,
  type AdaptiveEvaluateInput,
  type AdaptiveStrategyActivateInput,
  type AdaptiveStrategyStatusResult,
  type BkmEvidenceRecord,
  type BkmHypothesisListResult,
  type BkmHypothesisRecord,
  type BkmHypothesisTransitionInput,
  type BkmHypothesisUpsertInput,
  type EvaluationRunRecord,
  type IdentityScope,
} from "@laplace/contracts";
import { canTransitionBkmState, evaluateAdaptiveStrategy } from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import { GitError } from "./git.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

export function createLearningService(deps: {
  withCatalog: WithCatalog;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());

  function scopeOf(input: IdentityScope): IdentityScope {
    return {
      projectId: input.projectId,
      bindingId: input.bindingId,
      worktreeId: input.worktreeId,
    };
  }

  return {
    hypothesisUpsert(input: BkmHypothesisUpsertInput): BkmHypothesisRecord {
      const scope = scopeOf(input);
      const recordedAt = now();
      const hypothesisId =
        input.hypothesisId ?? `bkm-${randomUUID().slice(0, 12)}`;

      const evidence: BkmEvidenceRecord[] = (input.evidence ?? []).map(
        (ev) => ({
          evidenceId: randomUUID(),
          polarity: ev.polarity,
          originKey: ev.originKey,
          originKind: ev.originKind,
          sourceRefId: ev.sourceRefId ?? null,
          weight: ev.weight ?? 1,
          note: ev.note,
          recordedAt,
        }),
      );

      return deps.withCatalog((store) =>
        store.f5.upsertBkmHypothesis({
          scope,
          hypothesisId,
          competingGroupKey: input.competingGroupKey,
          category: input.category,
          title: input.title,
          statement: input.statement,
          pattern: input.pattern,
          evidence,
          nowIso: recordedAt,
        }),
      );
    },

    hypothesisList(scope: IdentityScope): BkmHypothesisListResult {
      const cleanScope = scopeOf(scope);
      return {
        scope: cleanScope,
        items: deps.withCatalog((store) =>
          store.f5.listBkmHypotheses(cleanScope),
        ),
      };
    },

    hypothesisTransition(
      input: BkmHypothesisTransitionInput,
    ): BkmHypothesisRecord {
      if (!input.humanConfirmed) {
        throw new GitError("intelligence_invalid_input");
      }
      const scope = scopeOf(input);
      const recordedAt = now();

      return deps.withCatalog((store) => {
        const current = store.f5.getBkmHypothesis(scope, input.hypothesisId);
        if (!current) throw new GitError("intelligence_not_found");
        if (!canTransitionBkmState(current.state, input.toState)) {
          throw new GitError("learning_hypothesis_conflict");
        }

        const supersedeCompetitors: {
          hypothesisId: string;
          fromState: BkmHypothesisRecord["state"];
          transitionId: string;
        }[] = [];

        if (input.toState === "active" && input.supersedeCompetitors) {
          const all = store.f5.listBkmHypotheses(scope);
          for (const other of all) {
            if (
              other.hypothesisId !== current.hypothesisId &&
              other.competingGroupKey === current.competingGroupKey &&
              other.state === "active"
            ) {
              supersedeCompetitors.push({
                hypothesisId: other.hypothesisId,
                fromState: other.state,
                transitionId: randomUUID(),
              });
            }
          }
        }

        return store.f5.transitionBkmHypothesis({
          scope,
          hypothesisId: current.hypothesisId,
          fromState: current.state,
          toState: input.toState,
          reason: input.reason,
          reviewer: input.reviewer,
          transitionId: randomUUID(),
          supersedeCompetitors,
          nowIso: recordedAt,
        });
      });
    },

    evaluateAdaptive(input: AdaptiveEvaluateInput): EvaluationRunRecord {
      const scope = scopeOf(input);
      const evaluatedAt = now();
      const evaluationId = randomUUID();

      return deps.withCatalog((store) => {
        const hypotheses = store.f5.listBkmHypotheses(scope);
        const run = evaluateAdaptiveStrategy({
          scope,
          evaluationId,
          requestId: input.requestId,
          strategyVersion:
            input.strategyVersion ?? adaptiveDefaultStrategyVersion,
          splitBoundaryAt: input.splitBoundaryAt,
          minRecallGain: input.minRecallGain,
          maxComputeCostMs: input.maxComputeCostMs,
          activeHypotheses: hypotheses,
          heldOutCases: input.heldOutCases,
          evaluatedAt,
        });
        return store.f5.insertAdaptiveEvaluation(run);
      });
    },

    strategyActivate(
      input: AdaptiveStrategyActivateInput,
    ): AdaptiveStrategyStatusResult {
      if (!input.humanConfirmed) {
        throw new GitError("intelligence_invalid_input");
      }
      const scope = scopeOf(input);
      const nowIso = now();

      return deps.withCatalog((store) => {
        if (input.mode === "rollback_to_baseline") {
          return store.f5.setAdaptiveStrategyState({
            scope,
            activeMode: "baseline_fts5",
            activeVersion: adaptiveDefaultBaselineVersion,
            evaluationId: input.evaluationId ?? null,
            activatedAt: nowIso,
            activatedBy: input.reviewer,
            rollbackReason: input.reason,
          });
        }

        if (!input.evaluationId) {
          throw new GitError("adaptive_gate_rejected");
        }
        const evaluation = store.f5.getAdaptiveEvaluation(
          scope,
          input.evaluationId,
        );
        if (!evaluation) {
          throw new GitError("intelligence_not_found");
        }
        if (evaluation.decision !== "eligible_for_activation") {
          throw new GitError("adaptive_gate_rejected");
        }

        return store.f5.setAdaptiveStrategyState({
          scope,
          activeMode: "adaptive_symbolic",
          activeVersion: evaluation.strategyVersion,
          evaluationId: evaluation.evaluationId,
          activatedAt: nowIso,
          activatedBy: input.reviewer,
          rollbackReason: null,
        });
      });
    },

    strategyStatus(scope: IdentityScope): AdaptiveStrategyStatusResult {
      return deps.withCatalog((store) =>
        store.f5.getAdaptiveStrategyStatus(scopeOf(scope)),
      );
    },
  };
}
