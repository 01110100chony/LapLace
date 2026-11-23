import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  codexEnvironment,
  detectCodex,
  supervisedCodexExecArgs,
} from "@laplace/agents";
import {
  type IdentityScope,
  type PlannerExecutionState,
  type PlannerProposedEdit,
  type SupervisedExecutionRecord,
  type SupervisedExecutionStartInput,
} from "@laplace/contracts";
import {
  evaluatePreFlight,
  grantAllowsEffect,
  resolveDestinationPolicy,
} from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import { GitError } from "./git.ts";
import {
  captureWorktreeDiff,
  createDedicatedWorktree,
  observeCheckoutForPlanner,
} from "./planner-git.ts";
import type { createSessionGrantService } from "./session-grant-store.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

type ActiveRun = {
  controller: AbortController;
  completion: Promise<void>;
  killProcess: () => void;
};

function scopeKey(scope: IdentityScope, executionId: string): string {
  return `${scope.projectId}:${scope.bindingId}:${scope.worktreeId}:${executionId}`;
}

export async function resolveExecutablePath(
  cmd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  if (!cmd || cmd.includes("\0")) throw new GitError("planner_invalid_input");
  if (isAbsolute(cmd)) {
    const st = await stat(cmd).catch(() => null);
    if (!st || !st.isFile()) throw new GitError("planner_invalid_input");
    return cmd;
  }
  const pathEnv =
    Object.entries(env).find(([k]) => k.toUpperCase() === "PATH")?.[1] ?? "";
  const exts =
    process.platform === "win32" && !/\.[a-z0-9]+$/i.test(cmd)
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  for (const dir of pathEnv.split(delimiter)) {
    const cleaned = dir.replace(/^"(.*)"$/, "$1");
    if (!cleaned || !isAbsolute(cleaned)) continue;
    for (const ext of exts) {
      const candidate = join(cleaned, `${cmd}${ext}`);
      const st = await stat(candidate).catch(() => null);
      if (st?.isFile()) return candidate;
    }
  }
  throw new GitError("planner_invalid_input");
}

function killPidTree(pid: number | undefined): void {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    execFile(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      { windowsHide: true },
      () => undefined,
    );
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore already exited child.
    }
  }
}

async function applyProposedEditsInWorktree(
  dedicatedRoot: string,
  edits: readonly PlannerProposedEdit[],
): Promise<void> {
  for (const edit of edits) {
    const target = resolve(dedicatedRoot, edit.path);
    const rel = relative(dedicatedRoot, target);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      throw new GitError("planner_invalid_input");
    }
    if (edit.action === "delete") {
      await unlink(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(edit.content ?? "", "utf8"));
    }
  }
}

export class PlannerSupervisor {
  private readonly ownerId = randomUUID();
  private readonly active = new Map<string, ActiveRun>();
  private readonly deps: {
    withCatalog: WithCatalog;
    grants: ReturnType<typeof createSessionGrantService>;
    supervisionHelper?: string;
    dataDir: string;
    mcpEntry: string;
    env?: NodeJS.ProcessEnv;
    protectedRoots: () => string[];
    now?: () => string;
    strictIsolatedAllowed?: boolean;
  };

  constructor(deps: {
    withCatalog: WithCatalog;
    grants: ReturnType<typeof createSessionGrantService>;
    supervisionHelper?: string;
    dataDir: string;
    mcpEntry: string;
    env?: NodeJS.ProcessEnv;
    protectedRoots: () => string[];
    now?: () => string;
    strictIsolatedAllowed?: boolean;
  }) {
    this.deps = deps;
  }

  private currentIso(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))();
  }

  async start(
    input: SupervisedExecutionStartInput,
  ): Promise<SupervisedExecutionRecord> {
    const scope: IdentityScope = {
      projectId: input.projectId,
      bindingId: input.bindingId,
      worktreeId: input.worktreeId,
    };
    const existing = this.deps.withCatalog((store) =>
      store.f4.findExecutionByRequest(scope, input.requestId),
    );
    if (existing) return existing;

    const nowIso = this.currentIso();
    const { worktree, plan, grant } = this.deps.withCatalog((store) => {
      const resolvedWt = store.identity.resolveScope(scope);
      const foundPlan = store.f4.getPlan(scope, input.planId);
      if (!foundPlan) throw new GitError("planner_not_found");
      const foundGrant = store.f4.getGrant(scope, input.grantId, nowIso);
      if (!foundGrant) throw new GitError("operation_grant_invalid");
      if (foundGrant.status === "revoked") {
        throw new GitError("operation_grant_invalid");
      }
      if (foundGrant.status === "expired") {
        throw new GitError("operation_grant_expired");
      }
      if (
        foundGrant.planId !== foundPlan.planId ||
        foundGrant.backendMode !== foundPlan.backendMode
      ) {
        throw new GitError("operation_grant_invalid");
      }
      if (
        foundGrant.baseDigest !== input.expectedBaseDigest ||
        foundGrant.baseDigest !== foundPlan.baseDigest
      ) {
        throw new GitError("planner_drift_detected");
      }
      return { worktree: resolvedWt, plan: foundPlan, grant: foundGrant };
    });

    const strictIsolatedAllowed = Boolean(this.deps.strictIsolatedAllowed);
    if (grant.backendMode === "codex_cli_isolated" && !strictIsolatedAllowed) {
      throw new GitError("execution_backend_blocked");
    }

    if (
      !grantAllowsEffect(grant.allowedEffects, "create_worktree") &&
      plan.operationKind !== "verifier_only"
    ) {
      throw new GitError("operation_grant_invalid");
    }
    if (
      (plan.operationKind === "worktree_edit" ||
        plan.operationKind === "branch_patch") &&
      !grantAllowsEffect(grant.allowedEffects, "write_worktree")
    ) {
      throw new GitError("operation_grant_invalid");
    }
    if (
      plan.operationKind === "agent_supervised" &&
      !grantAllowsEffect(grant.allowedEffects, "run_agent")
    ) {
      throw new GitError("operation_grant_invalid");
    }

    const sessionGrantId = input.sessionGrantId ?? plan.sessionGrantId;
    let validatedSessionGrant:
      | ReturnType<ReturnType<typeof createSessionGrantService>["validate"]>
      | undefined;

    if (
      grant.backendMode === "codex_cli_workspace" ||
      grant.backendMode === "codex_cli_isolated" ||
      sessionGrantId
    ) {
      if (!sessionGrantId) {
        throw new GitError("operation_grant_invalid");
      }
      const rawSessionGrant = this.deps.withCatalog((store) =>
        store.f2.getGrant(sessionGrantId, nowIso),
      );
      if (!rawSessionGrant) {
        throw new GitError("operation_grant_invalid");
      }
      validatedSessionGrant = this.deps.grants.validate({
        scope,
        grantId: rawSessionGrant.grantId,
        sessionId: rawSessionGrant.sessionId,
        destinationId: rawSessionGrant.destinationId,
        manifestDigest: rawSessionGrant.manifestDigest,
        policyVersion: rawSessionGrant.policyVersion,
      });
    }

    const sourceEnv = this.deps.env ?? process.env;
    const observed = await observeCheckoutForPlanner(worktree.root, {
      env: sourceEnv,
      expectedRoot: worktree.root,
      watchedPaths: [
        ...plan.targetPaths,
        ...plan.proposedEdits.map((e) => e.path),
      ],
    });
    const preflight = evaluatePreFlight({
      expectedBase: plan.base,
      expectedBaseDigest: plan.baseDigest,
      observed,
      backendMode: plan.backendMode,
      operationKind: plan.operationKind,
      targetBranch: plan.targetBranch,
      targetPaths: plan.targetPaths,
      sessionGrantId,
      strictIsolatedAllowed,
    });
    if (preflight.driftDetected) {
      this.deps.withCatalog((store) => {
        store.f4.updatePlanPreflightStatus(
          scope,
          plan.planId,
          "invalidated_by_drift",
          nowIso,
        );
      });
      throw new GitError("planner_drift_detected");
    }
    if (!preflight.executionAllowed) {
      const hasBackendBlock = preflight.conflicts.some(
        (c) => c.kind === "backend_blocked",
      );
      throw new GitError(
        hasBackendBlock
          ? "execution_backend_blocked"
          : "planner_drift_detected",
      );
    }

    const createdWt = await createDedicatedWorktree({
      originRoot: worktree.root,
      baseHead: observed.base.head,
      targetBranch:
        plan.operationKind === "branch_patch" ? plan.targetBranch : null,
      protectedRoots: this.deps.protectedRoots(),
      env: sourceEnv,
    });

    const executionId = randomUUID();
    const dedicatedWorktreeId = randomUUID();
    const record = this.deps.withCatalog((store) =>
      store.f4.createExecution({
        worktree: {
          dedicatedWorktreeId,
          scope,
          planId: plan.planId,
          root: createdWt.dedicatedRoot,
          branchName: createdWt.branchName,
          strategy: createdWt.strategy,
          status: "active",
          baseHead: observed.base.head,
          createdAt: nowIso,
          cleanedAt: null,
        },
        execution: {
          scope,
          executionId,
          requestId: input.requestId,
          planId: plan.planId,
          grantId: grant.grantId,
          baseDigest: plan.baseDigest,
          backendMode: grant.backendMode,
          dedicatedWorktreeId,
          baseHead: observed.base.head,
          state: "running",
          failureCode: null,
          childPid: null,
          recoveredAfterRestart: false,
          diffDigest: null,
          startedAt: nowIso,
          finishedAt: null,
        },
        ownerId: this.ownerId,
      }),
    );

    const controller = new AbortController();
    let killChild: () => void = () => {};
    const runState: ActiveRun = {
      controller,
      killProcess: () => killChild(),
      completion: Promise.resolve(),
    };
    const key = scopeKey(scope, executionId);
    this.active.set(key, runState);

    runState.completion = this.runAttempt({
      scope,
      execution: record,
      plan,
      input,
      dedicatedRoot: createdWt.dedicatedRoot,
      sessionGrant: validatedSessionGrant,
      controller,
      setKillChild: (fn) => {
        killChild = fn;
      },
      sourceEnv,
    }).finally(() => {
      if (this.active.get(key) === runState) {
        this.active.delete(key);
      }
    });

    return record;
  }

  async waitForCompletion(
    scope: IdentityScope,
    executionId: string,
  ): Promise<void> {
    const active = this.active.get(scopeKey(scope, executionId));
    if (active) await active.completion;
  }

  cancel(
    scope: IdentityScope,
    executionId: string,
    humanConfirmed: boolean,
  ): SupervisedExecutionRecord {
    if (!humanConfirmed) {
      throw new GitError("apply_not_approved");
    }
    const nowIso = this.currentIso();
    const record = this.deps.withCatalog((store) =>
      store.f4.markExecutionCancelling(scope, executionId, nowIso),
    );
    const active = this.active.get(scopeKey(scope, executionId));
    if (active) {
      active.controller.abort();
      active.killProcess();
    } else if (record.state === "running" || record.state === "cancelling") {
      if (record.childPid) killPidTree(record.childPid);
      return this.deps.withCatalog((store) =>
        store.f4.finishExecution({
          scope,
          executionId,
          state: "cancelled",
          failureCode: "cancelled",
          diffDigest: null,
          finishedAt: nowIso,
          summary: "Execucao cancelada pelo operador.",
          worktreeStatus: "retained_for_review",
        }),
      );
    }
    return record;
  }

  async close(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const run of this.active.values()) {
      run.controller.abort();
      run.killProcess();
      pending.push(run.completion);
    }
    await Promise.allSettled(pending);
  }

  private async runAttempt(params: {
    scope: IdentityScope;
    execution: SupervisedExecutionRecord;
    plan: ReturnType<CatalogStore["f4"]["getPlan"]> & {};
    input: SupervisedExecutionStartInput;
    dedicatedRoot: string;
    sessionGrant:
      | ReturnType<ReturnType<typeof createSessionGrantService>["validate"]>
      | undefined;
    controller: AbortController;
    setKillChild: (fn: () => void) => void;
    sourceEnv: NodeJS.ProcessEnv;
  }): Promise<void> {
    const {
      scope,
      execution,
      plan,
      input,
      dedicatedRoot,
      controller,
      sourceEnv,
    } = params;
    const { signal } = controller;

    try {
      this.deps.withCatalog((store) =>
        store.f4.appendExecutionEvent(scope, execution.executionId, {
          type: "started",
          at: this.currentIso(),
          summary: `Execucao iniciada via ${execution.backendMode}.`,
        }),
      );

      if (plan.proposedEdits.length > 0) {
        await applyProposedEditsInWorktree(dedicatedRoot, plan.proposedEdits);
      }

      if (execution.backendMode === "mock_supervised") {
        if (input.mockBehavior === "hold_for_cancel") {
          this.deps.withCatalog((store) =>
            store.f4.appendExecutionEvent(scope, execution.executionId, {
              type: "progress",
              at: this.currentIso(),
              summary: "Aguardando sinal de cancelamento em modo mock.",
            }),
          );
          await new Promise<void>((done) => {
            if (signal.aborted) {
              done();
              return;
            }
            signal.addEventListener("abort", () => done(), { once: true });
          });
        }
        if (signal.aborted) {
          this.deps.withCatalog((store) =>
            store.f4.finishExecution({
              scope,
              executionId: execution.executionId,
              state: "cancelled",
              failureCode: "cancelled",
              diffDigest: null,
              finishedAt: this.currentIso(),
              summary: "Execucao mock cancelada.",
              worktreeStatus: "retained_for_review",
            }),
          );
          return;
        }
        if (input.mockBehavior === "fail") {
          this.deps.withCatalog((store) =>
            store.f4.finishExecution({
              scope,
              executionId: execution.executionId,
              state: "failed",
              failureCode: "mock_failed",
              diffDigest: null,
              finishedAt: this.currentIso(),
              summary: "Falha simulada na execucao mock.",
              worktreeStatus: "retained_for_review",
            }),
          );
          return;
        }
      } else if (execution.backendMode === "local_process_job") {
        if (input.commandArgv && input.commandArgv.length > 0) {
          const outcome = await this.spawnProcessInWorktree({
            scope,
            executionId: execution.executionId,
            dedicatedRoot,
            argv: input.commandArgv,
            sourceEnv,
            signal,
            timeoutMs: 60_000,
            setKillChild: params.setKillChild,
          });
          if (signal.aborted) {
            this.deps.withCatalog((store) =>
              store.f4.finishExecution({
                scope,
                executionId: execution.executionId,
                state: "cancelled",
                failureCode: "cancelled",
                diffDigest: null,
                finishedAt: this.currentIso(),
                summary: "Execucao encerrada por cancelamento humano.",
                worktreeStatus: "retained_for_review",
              }),
            );
            return;
          }
          if (outcome.timedOut) {
            this.deps.withCatalog((store) =>
              store.f4.finishExecution({
                scope,
                executionId: execution.executionId,
                state: "timeout",
                failureCode: "timeout",
                diffDigest: null,
                finishedAt: this.currentIso(),
                summary: "Processo local excedeu tempo limite.",
                worktreeStatus: "retained_for_review",
              }),
            );
            return;
          }
          if (outcome.exitCode !== 0) {
            this.deps.withCatalog((store) =>
              store.f4.finishExecution({
                scope,
                executionId: execution.executionId,
                state: "failed",
                failureCode: `exit_${outcome.exitCode ?? "unknown"}`,
                diffDigest: null,
                finishedAt: this.currentIso(),
                summary: `Processo local encerrou com codigo ${outcome.exitCode ?? "null"}.`,
                worktreeStatus: "retained_for_review",
              }),
            );
            return;
          }
        }
      } else if (execution.backendMode === "codex_cli_workspace") {
        const sg = params.sessionGrant;
        const helper = this.deps.supervisionHelper;
        const detected = await detectCodex(dedicatedRoot, { workspace: true });
        if (
          !sg ||
          !helper ||
          !existsSync(helper) ||
          !detected.installation ||
          !resolveDestinationPolicy(sg.grant.destinationId).deliveryAllowed
        ) {
          this.deps.withCatalog((store) =>
            store.f4.finishExecution({
              scope,
              executionId: execution.executionId,
              state: "failed",
              failureCode: "execution_backend_blocked",
              diffDigest: null,
              finishedAt: this.currentIso(),
              summary:
                "Codex workspace indisponivel ou sem helper/SessionGrant valido.",
              worktreeStatus: "retained_for_review",
            }),
          );
          return;
        }
        const codexArgs = supervisedCodexExecArgs(dedicatedRoot, {
          sandbox: "workspace-write",
          mcpBinding: {
            command: process.execPath,
            gatewayScriptPath: this.deps.mcpEntry,
            dataDir: this.deps.dataDir,
            projectId: scope.projectId,
            bindingId: scope.bindingId,
            worktreeId: scope.worktreeId,
            destinationId: sg.grant.destinationId,
            grantId: sg.grant.grantId,
            sessionId: sg.grant.sessionId,
            manifestDigest: sg.grant.manifestDigest,
            policyVersion: sg.grant.policyVersion,
          },
        });
        const outcome = await this.spawnCodexHelper({
          scope,
          executionId: execution.executionId,
          dedicatedRoot,
          helper,
          codexExecutable: detected.installation.executable,
          codexArgs,
          prompt: plan.objective,
          sourceEnv,
          signal,
          setKillChild: params.setKillChild,
        });
        if (signal.aborted) {
          this.deps.withCatalog((store) =>
            store.f4.finishExecution({
              scope,
              executionId: execution.executionId,
              state: "cancelled",
              failureCode: "cancelled",
              diffDigest: null,
              finishedAt: this.currentIso(),
              summary: "Execucao Codex cancelada.",
              worktreeStatus: "retained_for_review",
            }),
          );
          return;
        }
        if (outcome !== 0) {
          this.deps.withCatalog((store) =>
            store.f4.finishExecution({
              scope,
              executionId: execution.executionId,
              state: "failed",
              failureCode: `codex_exit_${outcome ?? "null"}`,
              diffDigest: null,
              finishedAt: this.currentIso(),
              summary: `Codex CLI terminou com codigo ${outcome ?? "null"}.`,
              worktreeStatus: "retained_for_review",
            }),
          );
          return;
        }
      }

      if (signal.aborted) return;

      const captured = await captureWorktreeDiff({
        dedicatedRoot,
        baseHead: execution.baseHead,
        planId: plan.planId,
        executionId: execution.executionId,
        env: sourceEnv,
        signal,
      });
      const capturedAt = this.currentIso();
      this.deps.withCatalog((store) => {
        store.f4.saveExecutionDiff({
          scope,
          executionId: execution.executionId,
          planId: plan.planId,
          diffDigest: captured.diffDigest,
          baseHead: execution.baseHead,
          capturedAt,
          files: captured.files,
          blobs: captured.blobs,
        });
        store.f4.appendExecutionEvent(scope, execution.executionId, {
          type: "diff_captured",
          at: capturedAt,
          summary: `Diff verificavel capturado (${captured.files.length} arquivo(s), SHA-256 ${captured.diffDigest.slice(0, 12)}).`,
        });
        store.f4.finishExecution({
          scope,
          executionId: execution.executionId,
          state: "completed",
          failureCode: null,
          diffDigest: captured.diffDigest,
          finishedAt: capturedAt,
          summary: `Execucao concluida com diff verificavel (${captured.files.length} arquivo(s)).`,
          worktreeStatus: "retained_for_review",
        });
      });
    } catch (error) {
      const finishedAt = this.currentIso();
      const state: PlannerExecutionState = signal.aborted
        ? "cancelled"
        : "failed";
      const code = signal.aborted
        ? "cancelled"
        : error instanceof GitError
          ? error.code
          : "execution_interrupted";
      this.deps.withCatalog((store) =>
        store.f4.finishExecution({
          scope,
          executionId: execution.executionId,
          state,
          failureCode: code,
          diffDigest: null,
          finishedAt,
          summary: signal.aborted
            ? "Execucao cancelada."
            : `Falha na execucao supervisionada (${code}).`,
          worktreeStatus: "retained_for_review",
        }),
      );
    }
  }

  private async spawnProcessInWorktree(params: {
    scope: IdentityScope;
    executionId: string;
    dedicatedRoot: string;
    argv: string[];
    sourceEnv: NodeJS.ProcessEnv;
    signal: AbortSignal;
    timeoutMs: number;
    setKillChild: (fn: () => void) => void;
  }): Promise<{ exitCode: number | null; timedOut: boolean }> {
    const resolvedExe = await resolveExecutablePath(
      params.argv[0]!,
      params.sourceEnv,
    );
    const restArgs = params.argv.slice(1);
    const helper = this.deps.supervisionHelper;
    const useHelper = Boolean(helper && existsSync(helper));
    const spawnFile = useHelper ? helper! : resolvedExe;
    const spawnArgs = useHelper
      ? [
          "--laplace-verifier-job",
          String(process.pid),
          String(params.timeoutMs),
          resolvedExe,
          ...restArgs,
        ]
      : restArgs;

    return await new Promise((resolvePromise) => {
      let settled = false;
      let timedOut = false;
      const child = spawn(spawnFile, spawnArgs, {
        cwd: params.dedicatedRoot,
        env: params.sourceEnv,
        shell: false,
        windowsHide: true,
        stdio: [useHelper ? "pipe" : "ignore", "pipe", "pipe"],
      });

      const killFn = () => {
        try {
          child.stdin?.destroy();
        } catch {
          // ignore
        }
        killPidTree(child.pid);
      };
      params.setKillChild(killFn);

      if (child.pid) {
        this.deps.withCatalog((store) =>
          store.f4.setExecutionChildPid(params.executionId, child.pid!),
        );
      }

      const timer = setTimeout(() => {
        timedOut = true;
        killFn();
      }, params.timeoutMs);
      timer.unref();

      const onAbort = () => killFn();
      params.signal.addEventListener("abort", onAbort, { once: true });

      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        params.signal.removeEventListener("abort", onAbort);
        resolvePromise({ exitCode, timedOut });
      };

      child.on("error", () => finish(null));
      child.on("close", (code) => finish(code));
    });
  }

  private async spawnCodexHelper(params: {
    scope: IdentityScope;
    executionId: string;
    dedicatedRoot: string;
    helper: string;
    codexExecutable: string;
    codexArgs: string[];
    prompt: string;
    sourceEnv: NodeJS.ProcessEnv;
    signal: AbortSignal;
    setKillChild: (fn: () => void) => void;
  }): Promise<number | null> {
    return await new Promise((resolvePromise) => {
      let settled = false;
      const child = spawn(
        params.helper,
        [
          "--laplace-codex-job",
          String(process.pid),
          params.codexExecutable,
          ...params.codexArgs,
        ],
        {
          cwd: params.dedicatedRoot,
          env: codexEnvironment(params.sourceEnv),
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const killFn = () => {
        try {
          child.stdin?.destroy();
        } catch {
          // ignore
        }
        killPidTree(child.pid);
      };
      params.setKillChild(killFn);
      if (child.pid) {
        this.deps.withCatalog((store) =>
          store.f4.setExecutionChildPid(params.executionId, child.pid!),
        );
      }
      child.stdin?.end(params.prompt);
      const onAbort = () => killFn();
      params.signal.addEventListener("abort", onAbort, { once: true });
      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        params.signal.removeEventListener("abort", onAbort);
        resolvePromise(code);
      };
      child.on("error", () => finish(null));
      child.on("close", (code) => finish(code));
    });
  }
}
