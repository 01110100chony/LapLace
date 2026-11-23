import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  plannerGrantDefaultTtlMs,
  type ApplyLocalInput,
  type BoundaryStatusResult,
  type ExecutionDiffResult,
  type ExecutionReviewInput,
  type ExecutionReviewResult,
  type GitPlanRecord,
  type IdentityScope,
  type LocalApplyRecord,
  type OperationGrantIssueInput,
  type OperationGrantListResult,
  type OperationGrantRecord,
  type OperationGrantRevokeInput,
  type PlanCreateInput,
  type PlanListResult,
  type PlanPreflightInput,
  type PlannerExploreInput,
  type PlannerExploreResult,
  type PreFlightCheckResult,
  type SupervisedExecutionCancelInput,
  type SupervisedExecutionEventsResult,
  type SupervisedExecutionListResult,
  type SupervisedExecutionRecord,
  type SupervisedExecutionStartInput,
  type VerifierApproveInput,
  type VerifierDefineInput,
  type VerifierDefinitionRecord,
  type VerifierListResult,
  type VerifierRunInput,
  type VerifierRunRecord,
  type WorktreeCleanupInput,
  type WorktreeCleanupResult,
} from "@laplace/contracts";
import {
  computeVerifierDefinitionDigest,
  evaluatePreFlight,
  grantAllowsEffect,
  simulateGitPlan,
  validateVerifierApproval,
} from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import { sha256 } from "./context.ts";
import type { createDirtyOverlayService } from "./dirty-overlay-service.ts";
import { canonicalPath, GitError } from "./git.ts";
import {
  observeCheckoutForPlanner,
  removeDedicatedWorktree,
} from "./planner-git.ts";
import {
  PlannerSupervisor,
  resolveExecutablePath,
} from "./planner-supervisor.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

const maxVerifierExcerptBytes = 16 * 1024;
const documentedLpacDiagnostic =
  "LPAC Windows bloqueado em 0xc0000142 (STATUS_DLL_INIT_FAILED / GetFinalPathNameByHandleW FILE_NAME_OPENED erro 5 em canonicalize(CODEX_HOME)); ACLs preservadas (INV-07).";

function excerpt(chunks: Buffer[]): string {
  const full = Buffer.concat(chunks);
  if (full.length <= maxVerifierExcerptBytes) {
    return full.toString("utf8");
  }
  return full.subarray(0, maxVerifierExcerptBytes).toString("utf8");
}

function resolveInsideBase(baseDir: string, rel: string): string {
  const target = rel === "" || rel === "." ? baseDir : resolve(baseDir, rel);
  const diff = relative(baseDir, target);
  if (diff.startsWith("..") || isAbsolute(diff)) {
    throw new GitError("planner_invalid_input");
  }
  return target;
}

export function buildWhitelistedEnv(
  sourceEnv: NodeJS.ProcessEnv,
  whitelist: readonly string[],
): NodeJS.ProcessEnv {
  const filtered: NodeJS.ProcessEnv = {};
  const minimalOsKeys = ["SYSTEMROOT", "WINDIR", "TEMP", "TMP"];
  for (const key of minimalOsKeys) {
    const entry = Object.entries(sourceEnv).find(
      ([k]) => k.toUpperCase() === key,
    );
    if (entry && entry[1] !== undefined) {
      filtered[entry[0]] = entry[1];
    }
  }
  const allowed = new Set(whitelist);
  for (const [k, v] of Object.entries(sourceEnv)) {
    if (allowed.has(k) && v !== undefined) {
      filtered[k] = v;
    }
  }
  return filtered;
}

export function createPlannerService(deps: {
  withCatalog: WithCatalog;
  dirtyOverlayService: ReturnType<typeof createDirtyOverlayService>;
  supervisor: PlannerSupervisor;
  supervisionHelper?: string;
  env?: NodeJS.ProcessEnv;
  protectedRoots: () => string[];
  now?: () => string;
  strictIsolatedAllowed?: boolean;
  beforeApplyOccHook?: () => Promise<void>;
  beforeFileWriteHook?: (path: string) => Promise<void>;
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

  return {
    async explore(input: PlannerExploreInput): Promise<PlannerExploreResult> {
      const scope = scopeOf(input);
      const worktree = deps.withCatalog((store) =>
        store.identity.resolveScope(scope),
      );
      const observed = await observeCheckoutForPlanner(worktree.root, {
        env: sourceEnv(),
        expectedRoot: worktree.root,
        watchedPaths: input.watchedPaths,
      });
      const dedicatedWorktreeCount = deps.withCatalog((store) =>
        store.f4.countActiveWorktrees(scope),
      );
      return {
        scope,
        observedAt: now(),
        base: observed.base,
        branches: [...observed.branches],
        worktrees: observed.worktrees,
        dirtyPaths: [...observed.dirtyPaths],
        conflictedPaths: [...observed.conflictedPaths],
        changesCount: observed.changesCount,
        dedicatedWorktreeCount,
      };
    },

    async planCreate(input: PlanCreateInput): Promise<GitPlanRecord> {
      const scope = scopeOf(input);
      const worktree = deps.withCatalog((store) =>
        store.identity.resolveScope(scope),
      );
      const watched = [
        ...input.targetPaths,
        ...(input.proposedEdits?.map((e) => e.path) ?? []),
      ];
      const observed = await observeCheckoutForPlanner(worktree.root, {
        env: sourceEnv(),
        expectedRoot: worktree.root,
        watchedPaths: watched,
      });
      const simulation = simulateGitPlan({
        operationKind: input.operationKind,
        backendMode: input.backendMode,
        targetBranch: input.targetBranch ?? null,
        targetPaths: input.targetPaths,
        proposedEdits: input.proposedEdits ?? [],
        sessionGrantId: input.sessionGrantId ?? null,
        snapshot: observed,
        strictIsolatedAllowed,
      });
      const timestamp = now();
      const record: GitPlanRecord = {
        scope,
        planId: randomUUID(),
        requestId: input.requestId,
        title: input.title,
        objective: input.objective,
        operationKind: input.operationKind,
        backendMode: input.backendMode,
        targetBranch: input.targetBranch ?? null,
        targetPaths: [...new Set(input.targetPaths)],
        proposedEdits: input.proposedEdits ?? [],
        sessionGrantId: input.sessionGrantId ?? null,
        base: simulation.base,
        baseDigest: simulation.baseDigest,
        riskLevel: simulation.riskLevel,
        status: simulation.status,
        preflightStatus: simulation.preflightStatus,
        predictedEffects: simulation.predictedEffects,
        conflicts: simulation.conflicts,
        preconditions: simulation.preconditions,
        simulationDigest: simulation.simulationDigest,
        mutatesOrigin: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return deps.withCatalog((store) => store.f4.insertPlan(record));
    },

    planList(scope: IdentityScope): PlanListResult {
      const cleanScope = scopeOf(scope);
      return {
        scope: cleanScope,
        items: deps.withCatalog((store) => store.f4.listPlans(cleanScope)),
      };
    },

    async planPreflight(
      input: PlanPreflightInput,
    ): Promise<PreFlightCheckResult> {
      const scope = scopeOf(input);
      const { worktree, plan } = deps.withCatalog((store) => {
        const wt = store.identity.resolveScope(scope);
        const found = store.f4.getPlan(scope, input.planId);
        if (!found) throw new GitError("planner_not_found");
        return { worktree: wt, plan: found };
      });
      const watched = [
        ...plan.targetPaths,
        ...plan.proposedEdits.map((e) => e.path),
      ];
      const observed = await observeCheckoutForPlanner(worktree.root, {
        env: sourceEnv(),
        expectedRoot: worktree.root,
        watchedPaths: watched,
      });
      const evaluation = evaluatePreFlight({
        expectedBase: plan.base,
        expectedBaseDigest: plan.baseDigest,
        observed,
        backendMode: plan.backendMode,
        operationKind: plan.operationKind,
        targetBranch: plan.targetBranch,
        targetPaths: plan.targetPaths,
        sessionGrantId: plan.sessionGrantId,
        strictIsolatedAllowed,
      });
      const checkedAt = now();
      deps.withCatalog((store) =>
        store.f4.updatePlanPreflightStatus(
          scope,
          plan.planId,
          evaluation.status,
          checkedAt,
        ),
      );
      return {
        scope,
        planId: plan.planId,
        checkedAt,
        status: evaluation.status,
        driftDetected: evaluation.driftDetected,
        driftReasons: evaluation.driftReasons,
        expectedBase: evaluation.expectedBase,
        observedBase: evaluation.observedBase,
        expectedBaseDigest: evaluation.expectedBaseDigest,
        observedBaseDigest: evaluation.observedBaseDigest,
        preconditions: evaluation.preconditions,
        conflicts: evaluation.conflicts,
        executionAllowed: evaluation.executionAllowed,
      };
    },

    async grantIssue(
      input: OperationGrantIssueInput,
    ): Promise<OperationGrantRecord> {
      if (!input.humanConfirmed) {
        throw new GitError("apply_not_approved");
      }
      if (
        input.backendMode === "codex_cli_isolated" &&
        !strictIsolatedAllowed
      ) {
        throw new GitError("execution_backend_blocked");
      }
      const scope = scopeOf(input);
      const { worktree, plan } = deps.withCatalog((store) => {
        const wt = store.identity.resolveScope(scope);
        const found = store.f4.getPlan(scope, input.planId);
        if (!found) throw new GitError("planner_not_found");
        return { worktree: wt, plan: found };
      });
      if (
        plan.baseDigest !== input.expectedBaseDigest ||
        plan.backendMode !== input.backendMode
      ) {
        throw new GitError("planner_drift_detected");
      }

      const observed = await observeCheckoutForPlanner(worktree.root, {
        env: sourceEnv(),
        expectedRoot: worktree.root,
        watchedPaths: [
          ...plan.targetPaths,
          ...plan.proposedEdits.map((e) => e.path),
        ],
      });
      const evaluation = evaluatePreFlight({
        expectedBase: plan.base,
        expectedBaseDigest: plan.baseDigest,
        observed,
        backendMode: plan.backendMode,
        operationKind: plan.operationKind,
        targetBranch: plan.targetBranch,
        targetPaths: plan.targetPaths,
        sessionGrantId: plan.sessionGrantId,
        strictIsolatedAllowed,
      });
      if (!evaluation.executionAllowed) {
        throw new GitError(
          evaluation.driftDetected
            ? "planner_drift_detected"
            : "execution_backend_blocked",
        );
      }

      const issuedAt = now();
      const ttlMs = input.ttlMs ?? plannerGrantDefaultTtlMs;
      const expiresAt = new Date(Date.parse(issuedAt) + ttlMs).toISOString();
      const grant: OperationGrantRecord = {
        scope,
        grantId: randomUUID(),
        planId: plan.planId,
        baseDigest: plan.baseDigest,
        backendMode: input.backendMode,
        allowedEffects: [...new Set(input.allowedEffects)],
        issuedAt,
        expiresAt,
        revokedAt: null,
        revokeReason: null,
        status: "active",
      };
      return deps.withCatalog((store) => store.f4.insertGrant(grant, issuedAt));
    },

    grantList(scope: IdentityScope, planId?: string): OperationGrantListResult {
      const cleanScope = scopeOf(scope);
      return {
        scope: cleanScope,
        items: deps.withCatalog((store) =>
          store.f4.listGrants(cleanScope, planId ?? null, now()),
        ),
      };
    },

    grantRevoke(input: OperationGrantRevokeInput): OperationGrantRecord {
      return deps.withCatalog((store) =>
        store.f4.revokeGrant(
          scopeOf(input),
          input.grantId,
          now(),
          input.reason,
        ),
      );
    },

    boundaryStatus(scope: IdentityScope): BoundaryStatusResult {
      const cleanScope = scopeOf(scope);
      deps.withCatalog((store) => store.identity.resolveScope(cleanScope));
      const helperAvailable = Boolean(
        deps.supervisionHelper && existsSync(deps.supervisionHelper),
      );
      return {
        scope: cleanScope,
        checkedAt: now(),
        lpacVerified: strictIsolatedAllowed,
        lpacDetail: strictIsolatedAllowed
          ? "LPAC verificado em runtime."
          : documentedLpacDiagnostic,
        strictBackendAllowed: strictIsolatedAllowed,
        supervisionHelperAvailable: helperAvailable,
        backends: [
          {
            mode: "mock_supervised",
            available: true,
            verified: true,
            blockedReason: null,
          },
          {
            mode: "local_process_job",
            available: true,
            verified: helperAvailable,
            blockedReason: null,
          },
          {
            mode: "codex_cli_workspace",
            available: helperAvailable,
            verified: helperAvailable,
            blockedReason: helperAvailable
              ? null
              : "Helper nativo laplace-codex-job ausente no ambiente atual.",
          },
          {
            mode: "codex_cli_isolated",
            available: strictIsolatedAllowed,
            verified: strictIsolatedAllowed,
            blockedReason: strictIsolatedAllowed
              ? null
              : documentedLpacDiagnostic,
          },
        ],
      };
    },

    executionStart(
      input: SupervisedExecutionStartInput,
    ): Promise<SupervisedExecutionRecord> {
      return deps.supervisor.start(input);
    },

    executionList(
      scope: IdentityScope,
      planId?: string,
    ): SupervisedExecutionListResult {
      const cleanScope = scopeOf(scope);
      return {
        scope: cleanScope,
        items: deps.withCatalog((store) =>
          store.f4.listExecutions(cleanScope, planId ?? null),
        ),
      };
    },

    executionEvents(
      scope: IdentityScope,
      executionId: string,
      afterSeq: number,
    ): SupervisedExecutionEventsResult {
      return deps.withCatalog((store) =>
        store.f4.getExecutionEvents(scopeOf(scope), executionId, afterSeq),
      );
    },

    executionCancel(
      input: SupervisedExecutionCancelInput,
    ): SupervisedExecutionRecord {
      return deps.supervisor.cancel(
        scopeOf(input),
        input.executionId,
        input.humanConfirmed,
      );
    },

    async worktreeCleanup(
      input: WorktreeCleanupInput,
    ): Promise<WorktreeCleanupResult> {
      if (!input.humanConfirmed) {
        throw new GitError("apply_not_approved");
      }
      const scope = scopeOf(input);
      const { originRoot, execution, wt } = deps.withCatalog((store) => {
        const origin = store.identity.resolveScope(scope);
        const exec = store.f4.getExecution(scope, input.executionId);
        if (!exec) throw new GitError("planner_not_found");
        if (exec.state === "running" || exec.state === "cancelling") {
          throw new GitError("planner_worktree_unavailable");
        }
        const dedicated = store.f4.getDedicatedWorktree(
          scope,
          exec.dedicatedWorktreeId,
        );
        if (!dedicated) throw new GitError("planner_not_found");
        return { originRoot: origin.root, execution: exec, wt: dedicated };
      });

      if (wt.status !== "cleaned") {
        await removeDedicatedWorktree({
          originRoot,
          dedicatedRoot: wt.root,
          strategy: wt.strategy,
          protectedRoots: deps.protectedRoots(),
          env: sourceEnv(),
        });
      }
      const cleanedAt = wt.cleanedAt ?? now();
      deps.withCatalog((store) =>
        store.f4.markWorktreeCleaned(scope, wt.dedicatedWorktreeId, cleanedAt),
      );
      return {
        scope,
        executionId: execution.executionId,
        dedicatedWorktreeId: wt.dedicatedWorktreeId,
        dedicatedRoot: wt.root,
        status: "cleaned",
        cleanedAt,
        historyPreserved: true,
      };
    },

    diffGet(scope: IdentityScope, executionId: string): ExecutionDiffResult {
      const diff = deps.withCatalog((store) =>
        store.f4.getExecutionDiff(scopeOf(scope), executionId),
      );
      if (!diff) throw new GitError("planner_not_found");
      return diff;
    },

    diffReview(input: ExecutionReviewInput): ExecutionReviewResult {
      if (!input.humanConfirmed) {
        throw new GitError("apply_not_approved");
      }
      const scope = scopeOf(input);
      const review = deps.withCatalog((store) =>
        store.f4.recordDiffReview({
          scope,
          executionId: input.executionId,
          requestId: input.requestId,
          expectedDiffDigest: input.expectedDiffDigest,
          expectedRevision: input.expectedRevision,
          choice: input.choice,
          reviewer: input.reviewer,
          note: input.note,
          recordedAt: now(),
        }),
      );
      return {
        scope,
        executionId: input.executionId,
        review,
        appliedToLocal: false,
      };
    },

    async applyLocal(input: ApplyLocalInput): Promise<LocalApplyRecord> {
      const scope = scopeOf(input);
      const priorApply = deps.withCatalog((store) =>
        store.f4.findApplyByRequest(scope, input.requestId),
      );
      if (priorApply) return priorApply;

      if (!input.applyConfirmed) {
        throw new GitError("apply_not_approved");
      }

      const nowIso = now();
      const { worktree, plan, execution, grant, diff } = deps.withCatalog(
        (store) => {
          const wt = store.identity.resolveScope(scope);
          const exec = store.f4.getExecution(scope, input.executionId);
          if (!exec) throw new GitError("planner_not_found");
          const pl = store.f4.getPlan(scope, exec.planId);
          if (!pl) throw new GitError("planner_not_found");
          const gr = store.f4.getGrant(scope, input.grantId, nowIso);
          if (!gr) throw new GitError("operation_grant_invalid");
          if (gr.status === "revoked") {
            throw new GitError("operation_grant_invalid");
          }
          if (gr.status === "expired") {
            throw new GitError("operation_grant_expired");
          }
          if (
            gr.planId !== pl.planId ||
            gr.baseDigest !== pl.baseDigest ||
            !grantAllowsEffect(gr.allowedEffects, "apply_local")
          ) {
            throw new GitError("operation_grant_invalid");
          }
          if (
            gr.backendMode === "codex_cli_isolated" &&
            !strictIsolatedAllowed
          ) {
            throw new GitError("execution_backend_blocked");
          }
          const df = store.f4.getExecutionDiff(scope, input.executionId);
          if (!df) throw new GitError("planner_not_found");
          return {
            worktree: wt,
            plan: pl,
            execution: exec,
            grant: gr,
            diff: df,
          };
        },
      );

      if (diff.diffDigest !== input.expectedDiffDigest) {
        throw new GitError("planner_drift_detected");
      }
      if (
        !diff.latestReview ||
        diff.latestReview.choice !== "approved" ||
        diff.latestReview.diffDigest !== diff.diffDigest
      ) {
        throw new GitError("apply_not_approved");
      }

      const targetPaths = diff.files.map((f) => f.path);
      const verifyOriginMatches = async () => {
        const obs = await observeCheckoutForPlanner(worktree.root, {
          env: sourceEnv(),
          expectedRoot: worktree.root,
          watchedPaths: targetPaths,
        });
        if (
          obs.base.head !== plan.base.head ||
          obs.base.indexStamp !== plan.base.indexStamp
        ) {
          return {
            ok: false as const,
            detail:
              "HEAD ou index de origem divergiu antes da aplicacao local.",
          };
        }
        for (const file of diff.files) {
          const absPath = resolveInsideBase(worktree.root, file.path);
          try {
            const st = await lstat(absPath);
            if (st.isSymbolicLink() || !st.isFile()) {
              return {
                ok: false as const,
                detail: `Destino nao regular em ${file.path}.`,
              };
            }
            const diskBytes = await readFile(absPath);
            const diskSha = sha256(diskBytes);
            if (file.beforeSha256 === null || diskSha !== file.beforeSha256) {
              return {
                ok: false as const,
                detail: `Arquivo alterado externamente antes de applyLocal: ${file.path}.`,
              };
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              if (file.beforeSha256 !== null) {
                return {
                  ok: false as const,
                  detail: `Arquivo esperado ausente antes de applyLocal: ${file.path}.`,
                };
              }
            } else {
              return {
                ok: false as const,
                detail: `Falha ao inspecionar ${file.path}.`,
              };
            }
          }
        }
        return { ok: true as const };
      };

      const occFirst = await verifyOriginMatches();
      if (!occFirst.ok) {
        deps.withCatalog((store) =>
          store.f4.insertApplyRecord({
            scope,
            applyId: randomUUID(),
            requestId: input.requestId,
            executionId: execution.executionId,
            grantId: grant.grantId,
            diffDigest: diff.diffDigest,
            backupOverlayId: null,
            status: "aborted_conflict",
            appliedPaths: [],
            detail: occFirst.detail,
            appliedAt: now(),
          }),
        );
        throw new GitError("apply_conflict_detected");
      }

      const overlay = await deps.dirtyOverlayService.capture({
        projectId: scope.projectId,
        bindingId: scope.bindingId,
        worktreeId: scope.worktreeId,
        label: `f4-apply-${execution.executionId.slice(0, 12)}`,
      });

      if (deps.beforeApplyOccHook) {
        await deps.beforeApplyOccHook();
      }

      const occSecond = await verifyOriginMatches();
      if (!occSecond.ok) {
        deps.withCatalog((store) =>
          store.f4.insertApplyRecord({
            scope,
            applyId: randomUUID(),
            requestId: input.requestId,
            executionId: execution.executionId,
            grantId: grant.grantId,
            diffDigest: diff.diffDigest,
            backupOverlayId: overlay.overlayId,
            status: "aborted_conflict",
            appliedPaths: [],
            detail: occSecond.detail,
            appliedAt: now(),
          }),
        );
        throw new GitError("apply_conflict_detected");
      }

      const afterBlobs = deps.withCatalog((store) =>
        store.f4.getAfterDiffBlobs(execution.executionId),
      );

      type RollbackEntry = {
        absPath: string;
        existed: boolean;
        originalBytes: Buffer | null;
      };
      const appliedRollback: RollbackEntry[] = [];
      const appliedPaths: string[] = [];

      try {
        for (const file of diff.files) {
          const absPath = resolveInsideBase(worktree.root, file.path);
          let existed = false;
          let originalBytes: Buffer | null = null;
          try {
            originalBytes = await readFile(absPath);
            existed = true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }

          if (deps.beforeFileWriteHook) {
            await deps.beforeFileWriteHook(file.path);
          }

          if (file.action === "deleted") {
            await unlink(absPath);
          } else {
            const blob = afterBlobs.get(file.path);
            if (!blob || blob.sha256 !== file.afterSha256) {
              throw new GitError("apply_conflict_detected");
            }
            await mkdir(dirname(absPath), { recursive: true });
            await writeFile(absPath, blob.content);
          }

          appliedRollback.push({ absPath, existed, originalBytes });
          appliedPaths.push(file.path);
        }
      } catch {
        for (let i = appliedRollback.length - 1; i >= 0; i--) {
          const item = appliedRollback[i]!;
          try {
            if (item.existed && item.originalBytes !== null) {
              await mkdir(dirname(item.absPath), { recursive: true });
              await writeFile(item.absPath, item.originalBytes);
            } else {
              await unlink(item.absPath).catch(() => undefined);
            }
          } catch {
            // Best-effort rollback per file.
          }
        }
        deps.withCatalog((store) =>
          store.f4.insertApplyRecord({
            scope,
            applyId: randomUUID(),
            requestId: input.requestId,
            executionId: execution.executionId,
            grantId: grant.grantId,
            diffDigest: diff.diffDigest,
            backupOverlayId: overlay.overlayId,
            status: "rolled_back",
            appliedPaths,
            detail:
              "Falha parcial durante escrita local; alteracoes revertidas via snapshot preventivo.",
            appliedAt: now(),
          }),
        );
        throw new GitError("apply_conflict_detected");
      }

      const appliedRecord: LocalApplyRecord = {
        scope,
        applyId: randomUUID(),
        requestId: input.requestId,
        executionId: execution.executionId,
        grantId: grant.grantId,
        diffDigest: diff.diffDigest,
        backupOverlayId: overlay.overlayId,
        status: "applied",
        appliedPaths,
        detail: `Aplicado localmente com snapshot preventivo (${overlay.overlayId}) e verificacao OCC.`,
        appliedAt: now(),
      };
      return deps.withCatalog((store) =>
        store.f4.insertApplyRecord(appliedRecord),
      );
    },

    verifierDefine(input: VerifierDefineInput): VerifierDefinitionRecord {
      const scope = scopeOf(input);
      const envWhitelist = [...new Set(input.envWhitelist)].sort();
      const definitionDigest = computeVerifierDefinitionDigest({
        definitionId: input.definitionId,
        argv: input.argv,
        cwdRelative: input.cwdRelative,
        envWhitelist,
        timeoutMs: input.timeoutMs,
        privilegeProfile: input.privilegeProfile,
      });
      return deps.withCatalog((store) =>
        store.f4.upsertVerifier({
          scope,
          definitionId: input.definitionId,
          label: input.label,
          argv: input.argv,
          cwdRelative: input.cwdRelative,
          envWhitelist,
          timeoutMs: input.timeoutMs,
          privilegeProfile: input.privilegeProfile,
          definitionDigest,
          nowIso: now(),
        }),
      );
    },

    verifierList(scope: IdentityScope): VerifierListResult {
      const cleanScope = scopeOf(scope);
      const data = deps.withCatalog((store) =>
        store.f4.listVerifiers(cleanScope),
      );
      return {
        scope: cleanScope,
        items: data.items,
        runs: data.runs,
      };
    },

    verifierApprove(input: VerifierApproveInput): VerifierDefinitionRecord {
      if (!input.humanConfirmed) {
        throw new GitError("verifier_approval_invalid");
      }
      const scope = scopeOf(input);
      return deps.withCatalog((store) =>
        store.f4.approveVerifier({
          scope,
          definitionId: input.definitionId,
          expectedDefinitionDigest: input.expectedDefinitionDigest,
          reviewer: input.reviewer,
          nowIso: now(),
        }),
      );
    },

    async verifierRun(input: VerifierRunInput): Promise<VerifierRunRecord> {
      const scope = scopeOf(input);
      const priorRun = deps.withCatalog((store) =>
        store.f4.findVerifierRunByRequest(scope, input.requestId),
      );
      if (priorRun) return priorRun;

      const { worktree, definition, baseDir } = deps.withCatalog((store) => {
        const wt = store.identity.resolveScope(scope);
        const def = store.f4.getVerifier(scope, input.definitionId);
        if (!def) throw new GitError("planner_not_found");
        let runRoot = wt.root;
        if (input.executionId) {
          const exec = store.f4.getExecution(scope, input.executionId);
          if (!exec) throw new GitError("planner_not_found");
          if (
            exec.worktreeStatus !== "cleaned" &&
            existsSync(exec.dedicatedRoot)
          ) {
            runRoot = exec.dedicatedRoot;
          }
        }
        return { worktree: wt, definition: def, baseDir: runRoot };
      });

      const verdict = validateVerifierApproval({
        definition,
        expectedDefinitionDigest: input.expectedDefinitionDigest,
        strictIsolatedAllowed,
      });
      if (!verdict.allowed) {
        throw new GitError(
          verdict.reason === "execution_backend_blocked"
            ? "execution_backend_blocked"
            : "verifier_approval_invalid",
        );
      }

      if (input.grantId) {
        const nowIso = now();
        deps.withCatalog((store) => {
          const grant = store.f4.getGrant(scope, input.grantId!, nowIso);
          if (!grant || grant.status === "revoked") {
            throw new GitError("operation_grant_invalid");
          }
          if (grant.status === "expired") {
            throw new GitError("operation_grant_expired");
          }
          if (!grantAllowsEffect(grant.allowedEffects, "run_verifier")) {
            throw new GitError("operation_grant_invalid");
          }
        });
      }

      const rawCwd = resolveInsideBase(baseDir, definition.cwdRelative);
      const resolvedCwd = await canonicalPath(rawCwd);
      const canonicalBase = await canonicalPath(baseDir);
      const relCwd = relative(canonicalBase, resolvedCwd);
      if (relCwd.startsWith("..") || isAbsolute(relCwd)) {
        throw new GitError("planner_invalid_input");
      }

      const env = sourceEnv();
      const exePath = await resolveExecutablePath(definition.argv[0]!, env);
      const childEnv = buildWhitelistedEnv(env, definition.envWhitelist);
      const restArgs = definition.argv.slice(1);
      const useHelper = Boolean(
        deps.supervisionHelper && existsSync(deps.supervisionHelper),
      );
      const spawnFile = useHelper ? deps.supervisionHelper! : exePath;
      const spawnArgs = useHelper
        ? [
            "--laplace-verifier-job",
            String(process.pid),
            String(definition.timeoutMs),
            exePath,
            ...restArgs,
          ]
        : restArgs;

      const startedAt = Date.now();
      const result = await new Promise<{
        exitCode: number | null;
        timedOut: boolean;
        stdoutExcerpt: string;
        stderrExcerpt: string;
      }>((resolvePromise) => {
        let settled = false;
        let timedOut = false;
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;

        const child = spawn(spawnFile, spawnArgs, {
          cwd: resolvedCwd,
          env: childEnv,
          shell: false,
          windowsHide: true,
          stdio: [useHelper ? "pipe" : "ignore", "pipe", "pipe"],
        });

        child.stdout?.on("data", (chunk: Buffer) => {
          if (stdoutBytes < maxVerifierExcerptBytes) {
            stdoutChunks.push(chunk);
            stdoutBytes += chunk.length;
          }
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          if (stderrBytes < maxVerifierExcerptBytes) {
            stderrChunks.push(chunk);
            stderrBytes += chunk.length;
          }
        });

        const timer = setTimeout(() => {
          timedOut = true;
          try {
            child.stdin?.destroy();
          } catch {
            // ignore
          }
          if (child.pid && process.platform === "win32") {
            spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
              windowsHide: true,
            });
          } else {
            child.kill("SIGKILL");
          }
        }, definition.timeoutMs + 250);
        timer.unref();

        const done = (code: number | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (useHelper && code === 124) timedOut = true;
          resolvePromise({
            exitCode: code,
            timedOut,
            stdoutExcerpt: excerpt(stdoutChunks),
            stderrExcerpt: excerpt(stderrChunks),
          });
        };

        child.on("error", () => done(null));
        child.on("close", (code) => done(code));
      });

      const durationMs = Math.max(0, Date.now() - startedAt);
      const state: VerifierRunRecord["state"] = result.timedOut
        ? "timeout"
        : result.exitCode === 0
          ? "passed"
          : "failed";

      const runRecord: VerifierRunRecord = {
        scope,
        runId: randomUUID(),
        requestId: input.requestId,
        definitionId: definition.definitionId,
        definitionDigest: definition.definitionDigest,
        executionId: input.executionId ?? null,
        privilegeProfile: definition.privilegeProfile,
        state,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdoutExcerpt: result.stdoutExcerpt,
        stderrExcerpt: result.stderrExcerpt,
        durationMs,
        ranAt: now(),
      };
      void worktree;
      return deps.withCatalog((store) => store.f4.insertVerifierRun(runRecord));
    },
  };
}
