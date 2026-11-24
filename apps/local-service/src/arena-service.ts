import { randomUUID } from "node:crypto";
import type {
  ArenaSessionCreateInput,
  ArenaSessionGetInput,
  ArenaSessionListResult,
  ArenaSessionRecord,
  ArenaSessionRunInput,
  ArenaSessionReviewInput,
  ArenaSourceRef,
  IdentityScope,
} from "@laplace/contracts";
import {
  computeArenaCriteriaDigest,
  computeGitBaseDigest,
  validateArenaBaseEquivalence,
  validateArenaPairedReview,
} from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import { GitError } from "./git.ts";
import { observeCheckoutForPlanner } from "./planner-git.ts";
import type { createPlannerService } from "./planner-service.ts";
import type { PlannerSupervisor } from "./planner-supervisor.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

export function createArenaService(deps: {
  withCatalog: WithCatalog;
  plannerService: ReturnType<typeof createPlannerService>;
  plannerSupervisor: PlannerSupervisor;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  strictIsolatedAllowed?: boolean;
  beforeHypothesisRunHook?: (
    ordinal: number,
    originRoot: string,
  ) => Promise<void> | void;
}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const sourceEnv = () => deps.env ?? process.env;
  const strictIsolatedAllowed = Boolean(deps.strictIsolatedAllowed);

  function scopeOf(input: IdentityScope): IdentityScope {
    return {
      projectId: input.projectId,
      bindingId: input.bindingId,
      worktreeId: input.worktreeId,
    };
  }

  function hydrateSessionDiffs(
    store: CatalogStore,
    session: ArenaSessionRecord,
  ): ArenaSessionRecord {
    return {
      ...session,
      hypotheses: session.hypotheses.map((h) => {
        if (!h.executionId) return h;
        const diff = store.f4.getExecutionDiff(session.scope, h.executionId);
        return diff ? { ...h, diffFiles: diff.files } : h;
      }),
    };
  }

  return {
    async sessionCreate(
      input: ArenaSessionCreateInput,
    ): Promise<ArenaSessionRecord> {
      if (!input.humanConfirmed) {
        throw new GitError("intelligence_invalid_input");
      }
      if (
        input.backendMode === "codex_cli_isolated" &&
        !strictIsolatedAllowed
      ) {
        throw new GitError("execution_backend_blocked");
      }
      if (input.hypotheses.length < 2) {
        throw new GitError("intelligence_invalid_input");
      }
      const scope = scopeOf(input);
      const worktree = deps.withCatalog((store) =>
        store.identity.resolveScope(scope),
      );
      const watchedPaths = [
        ...new Set(input.hypotheses.flatMap((h) => h.targetPaths)),
      ];
      const observed = await observeCheckoutForPlanner(worktree.root, {
        env: sourceEnv(),
        expectedRoot: worktree.root,
        watchedPaths,
      });
      if (observed.base.head === null) {
        throw new GitError("arena_base_divergence");
      }

      const baseDigest = computeGitBaseDigest(observed.base);
      const criteriaDigest = computeArenaCriteriaDigest(
        input.objective,
        input.criteria,
      );
      const timestamp = now();
      const sessionId = randomUUID();

      const hypothesisSpecs = input.hypotheses.map((h, ordinal) => ({
        ordinal,
        hypothesisId: h.hypothesisId,
        label: h.label,
        summary: h.summary,
        targetPaths: h.targetPaths,
        proposedEdits: h.proposedEdits ?? [],
        commandArgv: h.commandArgv ?? null,
        mockBehavior: h.mockBehavior ?? null,
        observedBaseHead: observed.base.head,
        observedBaseIndexStamp: observed.base.indexStamp,
        observedBaseDigest: baseDigest,
        criteriaDigest,
        sourceRefs: h.sourceRefs ?? [],
      }));

      const session: ArenaSessionRecord = {
        scope,
        sessionId,
        requestId: input.requestId,
        title: input.title,
        objective: input.objective,
        backendMode: input.backendMode,
        status: "created",
        invalidationReason: null,
        base: observed.base,
        baseDigest,
        criteria: input.criteria,
        criteriaDigest,
        hypotheses: hypothesisSpecs.map(
          ({ commandArgv: _c, mockBehavior: _m, ...rest }) => {
            void _c;
            void _m;
            return {
              ...rest,
              planId: null,
              grantId: null,
              executionId: null,
              dedicatedWorktreeId: null,
              dedicatedRoot: null,
              diffDigest: null,
              diffFiles: [],
              state: "pending",
              failureCode: null,
            };
          },
        ),
        pairedReview: null,
        appliedToLocal: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      return deps.withCatalog((store) =>
        store.f5.createArenaSession({ session, hypothesisSpecs }),
      );
    },

    async sessionRun(input: ArenaSessionRunInput): Promise<ArenaSessionRecord> {
      if (!input.humanConfirmed) {
        throw new GitError("intelligence_invalid_input");
      }
      const scope = scopeOf(input);
      const { worktree, session } = deps.withCatalog((store) => {
        const wt = store.identity.resolveScope(scope);
        const found = store.f5.getArenaSessionWithSpecs(scope, input.sessionId);
        if (!found) throw new GitError("intelligence_not_found");
        return { worktree: wt, session: found };
      });

      if (session.status === "invalidated") {
        throw new GitError("arena_session_invalidated");
      }
      if (
        session.backendMode === "codex_cli_isolated" &&
        !strictIsolatedAllowed
      ) {
        throw new GitError("execution_backend_blocked");
      }

      deps.withCatalog((store) =>
        store.f5.updateArenaSessionStatus({
          scope,
          sessionId: session.sessionId,
          status: "running",
          invalidationReason: null,
          updatedAt: now(),
        }),
      );

      const watchedPaths = [
        ...new Set(session.hypothesisSpecs.flatMap((h) => h.targetPaths)),
      ];

      for (const spec of session.hypothesisSpecs) {
        if (deps.beforeHypothesisRunHook) {
          await deps.beforeHypothesisRunHook(spec.ordinal, worktree.root);
        }

        const currentObs = await observeCheckoutForPlanner(worktree.root, {
          env: sourceEnv(),
          expectedRoot: worktree.root,
          watchedPaths,
        });
        const currentDigest = computeGitBaseDigest(currentObs.base);

        const eqCheck = validateArenaBaseEquivalence({
          sessionBase: session.base,
          sessionBaseDigest: session.baseDigest,
          sessionCriteriaDigest: session.criteriaDigest,
          hypotheses: [
            {
              hypothesisId: spec.hypothesisId,
              observedBaseHead: currentObs.base.head,
              observedBaseIndexStamp: currentObs.base.indexStamp,
              observedBaseDigest: currentDigest,
              criteriaDigest: spec.criteriaDigest,
              state: "running",
            },
            ...session.hypothesisSpecs
              .filter((other) => other.hypothesisId !== spec.hypothesisId)
              .map((other) => ({
                hypothesisId: other.hypothesisId,
                observedBaseHead: other.observedBaseHead,
                observedBaseIndexStamp: other.observedBaseIndexStamp,
                observedBaseDigest: other.observedBaseDigest,
                criteriaDigest: other.criteriaDigest,
                state: other.state,
              })),
          ],
        });

        if (!eqCheck.valid) {
          deps.withCatalog((store) => {
            store.f5.updateArenaHypothesis({
              sessionId: session.sessionId,
              hypothesisId: spec.hypothesisId,
              observedBaseHead: currentObs.base.head,
              observedBaseIndexStamp: currentObs.base.indexStamp,
              observedBaseDigest: currentDigest,
              state: "invalidated",
              failureCode: eqCheck.reason,
            });
            store.f5.updateArenaSessionStatus({
              scope,
              sessionId: session.sessionId,
              status: "invalidated",
              invalidationReason:
                eqCheck.reason ?? "invalidated_base_divergence",
              updatedAt: now(),
            });
          });
          const invalidated = deps.withCatalog((store) => {
            const loaded = store.f5.getArenaSessionWithSpecs(
              scope,
              session.sessionId,
            )!;
            const { hypothesisSpecs: _ignored, ...rest } = loaded;
            void _ignored;
            return hydrateSessionDiffs(store, rest);
          });
          return invalidated;
        }

        const plan = await deps.plannerService.planCreate({
          ...scope,
          requestId: `arena-${session.sessionId}-${spec.hypothesisId}-plan`,
          title: `${session.title} · ${spec.label}`.slice(0, 150),
          objective: `${session.criteria.sharedObjective}\n${spec.summary}`,
          operationKind: "worktree_edit",
          backendMode: session.backendMode,
          targetPaths: spec.targetPaths,
          proposedEdits: spec.proposedEdits,
        });

        const grant = await deps.plannerService.grantIssue({
          ...scope,
          planId: plan.planId,
          expectedBaseDigest: plan.baseDigest,
          backendMode: session.backendMode,
          // Arena never auto-applies code to origin checkout (INV-08 / INV-10).
          allowedEffects: ["create_worktree", "write_worktree"],
          humanConfirmed: true,
        });

        const execution = await deps.plannerService.executionStart({
          ...scope,
          requestId: `arena-${session.sessionId}-${spec.hypothesisId}-exec`,
          planId: plan.planId,
          grantId: grant.grantId,
          expectedBaseDigest: plan.baseDigest,
          ...(session.backendMode === "mock_supervised"
            ? { mockBehavior: spec.mockBehavior ?? "complete" }
            : {}),
          ...(spec.commandArgv ? { commandArgv: spec.commandArgv } : {}),
        });

        await deps.plannerSupervisor.waitForCompletion(
          scope,
          execution.executionId,
        );

        const settled = deps.withCatalog((store) => {
          const exec = store.f4.getExecution(scope, execution.executionId);
          const diff = store.f4.getExecutionDiff(scope, execution.executionId);
          return { exec, diff };
        });

        const finalExec = settled.exec;
        const diff = settled.diff;
        const independentRefs: ArenaSourceRef[] = [
          ...spec.sourceRefs,
          {
            kind: "execution",
            refId: execution.executionId,
            label: `Worktree dedicada ${execution.dedicatedWorktreeId.slice(0, 8)}`,
            digest: finalExec?.diffDigest ?? null,
          },
        ];
        if (diff) {
          independentRefs.push({
            kind: "diff",
            refId: diff.diffDigest,
            label: `Diff ${diff.files.length} arquivo(s)`,
            digest: diff.diffDigest,
          });
        }

        const completedOk =
          finalExec?.state === "completed" &&
          finalExec.diffDigest !== null &&
          finalExec.baseHead === session.base.head;

        deps.withCatalog((store) =>
          store.f5.updateArenaHypothesis({
            sessionId: session.sessionId,
            hypothesisId: spec.hypothesisId,
            observedBaseHead: finalExec?.baseHead ?? currentObs.base.head,
            observedBaseIndexStamp: currentObs.base.indexStamp,
            observedBaseDigest: currentDigest,
            planId: plan.planId,
            grantId: grant.grantId,
            executionId: execution.executionId,
            dedicatedWorktreeId: execution.dedicatedWorktreeId,
            dedicatedRoot: execution.dedicatedRoot,
            diffDigest: finalExec?.diffDigest ?? null,
            sourceRefs: independentRefs,
            state: completedOk ? "completed" : "failed",
            failureCode: completedOk
              ? null
              : (finalExec?.failureCode ?? "arena_execution_failed"),
          }),
        );
      }

      return deps.withCatalog((store) => {
        const refreshed = store.f5.getArenaSessionWithSpecs(
          scope,
          session.sessionId,
        )!;
        const finalEq = validateArenaBaseEquivalence({
          sessionBase: refreshed.base,
          sessionBaseDigest: refreshed.baseDigest,
          sessionCriteriaDigest: refreshed.criteriaDigest,
          hypotheses: refreshed.hypotheses,
        });
        const allCompleted = refreshed.hypotheses.every(
          (h) => h.state === "completed" && h.diffDigest !== null,
        );
        const nextStatus = !finalEq.valid
          ? "invalidated"
          : allCompleted
            ? "ready_for_review"
            : "created";
        store.f5.updateArenaSessionStatus({
          scope,
          sessionId: session.sessionId,
          status: nextStatus,
          invalidationReason: finalEq.valid ? null : finalEq.reason,
          updatedAt: now(),
        });
        const finalSession = store.f5.getArenaSessionWithSpecs(
          scope,
          session.sessionId,
        )!;
        const { hypothesisSpecs: _ignored, ...rest } = finalSession;
        void _ignored;
        return hydrateSessionDiffs(store, rest);
      });
    },

    sessionList(scope: IdentityScope): ArenaSessionListResult {
      const cleanScope = scopeOf(scope);
      return deps.withCatalog((store) => ({
        scope: cleanScope,
        items: store.f5
          .listArenaSessions(cleanScope)
          .map((s) => hydrateSessionDiffs(store, s)),
      }));
    },

    sessionGet(input: ArenaSessionGetInput): ArenaSessionRecord {
      const scope = scopeOf(input);
      return deps.withCatalog((store) => {
        const found = store.f5.getArenaSessionWithSpecs(scope, input.sessionId);
        if (!found) throw new GitError("intelligence_not_found");
        const { hypothesisSpecs: _ignored, ...rest } = found;
        void _ignored;
        return hydrateSessionDiffs(store, rest);
      });
    },

    sessionReview(input: ArenaSessionReviewInput): ArenaSessionRecord {
      if (!input.humanConfirmed) {
        throw new GitError("intelligence_invalid_input");
      }
      const scope = scopeOf(input);
      return deps.withCatalog((store) => {
        const found = store.f5.getArenaSessionWithSpecs(scope, input.sessionId);
        if (!found) throw new GitError("intelligence_not_found");

        const check = validateArenaPairedReview({
          sessionStatus: found.status,
          invalidationReason: found.invalidationReason,
          criteria: found.criteria,
          hypotheses: found.hypotheses,
          review: {
            outcome: input.outcome,
            winnerHypothesisId: input.winnerHypothesisId,
            reviewedHypothesisIds: input.reviewedHypothesisIds,
            criterionScores: input.criterionScores,
          },
        });
        if (!check.valid) {
          throw new GitError(check.errorCode ?? "arena_review_incomplete");
        }

        const recordedAt = now();
        const saved = store.f5.saveArenaReview({
          scope,
          sessionId: found.sessionId,
          review: {
            reviewId: randomUUID(),
            requestId: input.requestId,
            outcome: input.outcome,
            winnerHypothesisId: input.winnerHypothesisId,
            reviewer: input.reviewer,
            rationale: input.rationale,
            reviewedHypothesisIds: input.reviewedHypothesisIds,
            criterionScores: input.criterionScores,
            evidenceRefs: input.evidenceRefs,
            recordedAt,
            appliedToLocal: false,
          },
          updatedAt: recordedAt,
        });
        return hydrateSessionDiffs(store, saved);
      });
    },
  };
}
