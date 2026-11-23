import type {
  OperationEffect,
  PlannerBackendMode,
  PlannerConflict,
  PlannerDiffAction,
  PlannerDriftReason,
  PlannerGitBase,
  PlannerOperationKind,
  PlannerPrecondition,
  PlannerPredictedEffect,
  PlannerPreflightStatus,
  PlannerProposedEdit,
  PlannerRiskLevel,
  VerifierApprovalStatus,
  VerifierDefinitionRecord,
  VerifierPrivilegeProfile,
} from "@laplace/contracts";
import { canonicalJson, sha256Hex } from "./hash.ts";

export type PlannerGitObservation = {
  base: PlannerGitBase;
  branches: readonly { name: string; head: string; current: boolean }[];
  dirtyPaths: readonly string[];
  conflictedPaths: readonly string[];
};

export type GitPlanSimulationInput = {
  operationKind: PlannerOperationKind;
  backendMode: PlannerBackendMode;
  targetBranch?: string | null;
  targetPaths: readonly string[];
  proposedEdits?: readonly PlannerProposedEdit[];
  sessionGrantId?: string | null;
  snapshot: PlannerGitObservation;
  strictIsolatedAllowed?: boolean;
};

export type GitPlanSimulation = {
  base: PlannerGitBase;
  baseDigest: string;
  riskLevel: PlannerRiskLevel;
  status: "ready" | "blocked";
  preflightStatus: PlannerPreflightStatus;
  predictedEffects: PlannerPredictedEffect[];
  conflicts: PlannerConflict[];
  preconditions: PlannerPrecondition[];
  simulationDigest: string;
  mutatesOrigin: false;
};

export type PreFlightEvaluationInput = {
  expectedBase: PlannerGitBase;
  expectedBaseDigest?: string;
  observed: PlannerGitObservation;
  backendMode: PlannerBackendMode;
  operationKind: PlannerOperationKind;
  targetBranch?: string | null;
  targetPaths: readonly string[];
  sessionGrantId?: string | null;
  strictIsolatedAllowed?: boolean;
};

export type PreFlightEvaluation = {
  status: PlannerPreflightStatus;
  driftDetected: boolean;
  driftReasons: PlannerDriftReason[];
  expectedBase: PlannerGitBase;
  observedBase: PlannerGitBase;
  expectedBaseDigest: string;
  observedBaseDigest: string;
  preconditions: PlannerPrecondition[];
  conflicts: PlannerConflict[];
  executionAllowed: boolean;
};

export type DiffDigestFile = {
  path: string;
  action: PlannerDiffAction;
  beforeSha256: string | null;
  beforeBytes: number | null;
  beforeCrlf: boolean;
  afterSha256: string | null;
  afterBytes: number | null;
  afterCrlf: boolean;
};

export type VerifierTuple = {
  definitionId: string;
  argv: readonly string[];
  cwdRelative: string;
  envWhitelist: readonly string[];
  timeoutMs: number;
  privilegeProfile: VerifierPrivilegeProfile;
};

export type VerifierApprovalValidation = {
  allowed: boolean;
  status: VerifierApprovalStatus;
  computedDigest: string;
  reason: string | null;
};

export function computeGitBaseDigest(base: PlannerGitBase): string {
  return sha256Hex(
    canonicalJson({
      head: base.head,
      branch: base.branch,
      indexStamp: base.indexStamp,
      worktreeRoot: base.worktreeRoot,
      dirtyDigest: base.dirtyDigest,
    }),
  );
}

function backendRequiresSessionGrant(backendMode: PlannerBackendMode): boolean {
  return (
    backendMode === "codex_cli_workspace" ||
    backendMode === "codex_cli_isolated"
  );
}

function normalizedUniquePaths(
  targetPaths: readonly string[],
  proposedEdits: readonly PlannerProposedEdit[],
): string[] {
  const seen = new Set<string>();
  for (const item of targetPaths) {
    seen.add(item);
  }
  for (const edit of proposedEdits) {
    seen.add(edit.path);
  }
  return [...seen].sort();
}

function evaluateConflictsAndPreconditions(input: {
  operationKind: PlannerOperationKind;
  backendMode: PlannerBackendMode;
  targetBranch: string | null;
  normalizedPaths: readonly string[];
  sessionGrantId: string | null;
  snapshot: PlannerGitObservation;
  strictIsolatedAllowed: boolean;
}): {
  conflicts: PlannerConflict[];
  preconditions: PlannerPrecondition[];
  dirtyOverlapCount: number;
} {
  const conflicts: PlannerConflict[] = [];
  const preconditions: PlannerPrecondition[] = [];

  const headOk =
    input.snapshot.base.head !== null ||
    input.operationKind === "verifier_only";
  preconditions.push({
    id: "head_present",
    label: "HEAD resolvido",
    satisfied: headOk,
    detail: headOk
      ? (input.snapshot.base.head ?? "verifier_only sem worktree Git")
      : "Repositorio sem commit inicial (unborn HEAD)",
  });
  if (!headOk) {
    conflicts.push({
      kind: "unborn_head",
      blocking: true,
      path: null,
      summary:
        "Repositorio sem commit inicial nao permite criar worktree dedicada.",
    });
  }

  const noMergeConflicts = input.snapshot.conflictedPaths.length === 0;
  preconditions.push({
    id: "no_working_conflicts",
    label: "Sem conflitos pendentes",
    satisfied: noMergeConflicts,
    detail: noMergeConflicts
      ? "Nenhum caminho em conflito no checkout observado."
      : `${input.snapshot.conflictedPaths.length} caminho(s) em conflito.`,
  });
  if (!noMergeConflicts) {
    conflicts.push({
      kind: "working_conflict",
      blocking: true,
      path: input.snapshot.conflictedPaths[0] ?? null,
      summary: `Checkout possui ${input.snapshot.conflictedPaths.length} conflito(s) de merge aberto(s).`,
    });
  }

  const branchCollision =
    input.operationKind === "branch_patch" &&
    input.targetBranch !== null &&
    input.snapshot.branches.some((b) => b.name === input.targetBranch);
  if (input.operationKind === "branch_patch" && input.targetBranch !== null) {
    preconditions.push({
      id: "target_branch_available",
      label: "Branch alvo disponivel",
      satisfied: !branchCollision,
      detail: branchCollision
        ? `Branch ${input.targetBranch} ja existe no repositorio.`
        : `Branch ${input.targetBranch} livre para criacao na worktree dedicada.`,
    });
  }
  if (branchCollision) {
    conflicts.push({
      kind: "branch_exists",
      blocking: true,
      path: null,
      summary: `Branch alvo ja existe (${input.targetBranch}).`,
    });
  }

  const backendAllowed =
    input.backendMode !== "codex_cli_isolated" || input.strictIsolatedAllowed;
  preconditions.push({
    id: "backend_permitted",
    label: "Backend autorizado pela politica",
    satisfied: backendAllowed,
    detail: backendAllowed
      ? `Backend ${input.backendMode} permitido.`
      : "codex_cli_isolated bloqueado pela politica LPAC (INV-07) ate prova real completa.",
  });
  if (!backendAllowed) {
    conflicts.push({
      kind: "backend_blocked",
      blocking: true,
      path: null,
      summary:
        "Backend codex_cli_isolated bloqueado pela politica LPAC (INV-07).",
    });
  }

  if (backendRequiresSessionGrant(input.backendMode)) {
    const hasGrant = Boolean(input.sessionGrantId);
    preconditions.push({
      id: "session_grant_bound",
      label: "SessionGrant F2 vinculado",
      satisfied: hasGrant,
      detail: hasGrant
        ? `SessionGrant ${input.sessionGrantId} informado.`
        : `Backend ${input.backendMode} exige SessionGrant F2 valido.`,
    });
    if (!hasGrant) {
      conflicts.push({
        kind: "session_grant_required",
        blocking: true,
        path: null,
        summary: `Execucao ${input.backendMode} exige SessionGrant F2 valido.`,
      });
    }
  }

  const dirtySet = new Set(input.snapshot.dirtyPaths);
  let dirtyOverlapCount = 0;
  for (const path of input.normalizedPaths) {
    if (dirtySet.has(path)) {
      dirtyOverlapCount += 1;
      conflicts.push({
        kind: "dirty_path_overlap",
        blocking: false,
        path,
        summary: `Arquivo ja modificado na worktree local (${path}); snapshot preventivo sera capturado antes de applyLocal.`,
      });
    }
  }

  return { conflicts, preconditions, dirtyOverlapCount };
}

export function simulateGitPlan(
  input: GitPlanSimulationInput,
): GitPlanSimulation {
  const proposedEdits = input.proposedEdits ?? [];
  const normalizedPaths = normalizedUniquePaths(
    input.targetPaths,
    proposedEdits,
  );
  const targetBranch = input.targetBranch ?? null;
  const sessionGrantId = input.sessionGrantId ?? null;
  const strictIsolatedAllowed = Boolean(input.strictIsolatedAllowed);
  const baseDigest = computeGitBaseDigest(input.snapshot.base);

  const predictedEffects: PlannerPredictedEffect[] = [];
  if (input.operationKind !== "verifier_only") {
    predictedEffects.push({
      kind: "create_worktree",
      target: targetBranch ?? "dedicated-worktree",
      summary:
        "Criar worktree dedicada isolada sem modificar HEAD, indice ou worktree de origem.",
      mutatesOrigin: false,
    });
  }
  if (proposedEdits.length > 0) {
    for (const edit of proposedEdits) {
      predictedEffects.push({
        kind: "write_worktree",
        target: edit.path,
        summary: `Aplicar edicao (${edit.action}) somente dentro da worktree dedicada.`,
        mutatesOrigin: false,
      });
    }
  } else if (
    input.operationKind === "worktree_edit" ||
    input.operationKind === "branch_patch"
  ) {
    for (const path of normalizedPaths) {
      predictedEffects.push({
        kind: "write_worktree",
        target: path,
        summary: `Operar em ${path} dentro da worktree dedicada.`,
        mutatesOrigin: false,
      });
    }
  }
  if (input.operationKind === "agent_supervised") {
    predictedEffects.push({
      kind: "run_agent",
      target: input.backendMode,
      summary: `Executar agente supervisionado (${input.backendMode}) em worktree dedicada.`,
      mutatesOrigin: false,
    });
  }
  if (input.operationKind === "verifier_only") {
    predictedEffects.push({
      kind: "run_verifier",
      target: normalizedPaths[0] ?? ".",
      summary:
        "Executar verificador aprovado sem mutacao automatica da origem.",
      mutatesOrigin: false,
    });
  }

  const { conflicts, preconditions, dirtyOverlapCount } =
    evaluateConflictsAndPreconditions({
      operationKind: input.operationKind,
      backendMode: input.backendMode,
      targetBranch,
      normalizedPaths,
      sessionGrantId,
      snapshot: input.snapshot,
      strictIsolatedAllowed,
    });

  const hasBlocking = conflicts.some((c) => c.blocking);
  const status: "ready" | "blocked" = hasBlocking ? "blocked" : "ready";
  const preflightStatus: PlannerPreflightStatus = hasBlocking
    ? "blocked"
    : "valid";

  let riskLevel: PlannerRiskLevel = "low";
  if (
    hasBlocking ||
    input.backendMode === "codex_cli_isolated" ||
    proposedEdits.some((e) => e.action === "delete") ||
    normalizedPaths.length > 5
  ) {
    riskLevel = "high";
  } else if (
    dirtyOverlapCount > 0 ||
    input.operationKind === "agent_supervised" ||
    input.operationKind === "branch_patch"
  ) {
    riskLevel = "medium";
  }

  const simulationDigest = sha256Hex(
    canonicalJson({
      operationKind: input.operationKind,
      backendMode: input.backendMode,
      targetBranch,
      targetPaths: normalizedPaths,
      proposedEdits: proposedEdits.map((e) => ({
        path: e.path,
        action: e.action,
        contentHash: e.content === null ? null : sha256Hex(e.content),
      })),
      sessionGrantId,
      baseDigest,
      predictedEffects,
      conflicts,
      preconditions,
    }),
  );

  return {
    base: input.snapshot.base,
    baseDigest,
    riskLevel,
    status,
    preflightStatus,
    predictedEffects,
    conflicts,
    preconditions,
    simulationDigest,
    mutatesOrigin: false,
  };
}

export function evaluatePreFlight(
  input: PreFlightEvaluationInput,
): PreFlightEvaluation {
  const expectedBaseDigest =
    input.expectedBaseDigest ?? computeGitBaseDigest(input.expectedBase);
  const observedBase = input.observed.base;
  const observedBaseDigest = computeGitBaseDigest(observedBase);

  const driftReasons: PlannerDriftReason[] = [];
  if (input.expectedBase.head !== observedBase.head) {
    driftReasons.push("head_changed");
  }
  if (input.expectedBase.branch !== observedBase.branch) {
    driftReasons.push("branch_changed");
  }
  if (input.expectedBase.indexStamp !== observedBase.indexStamp) {
    driftReasons.push("index_changed");
  }
  if (input.expectedBase.dirtyDigest !== observedBase.dirtyDigest) {
    driftReasons.push("worktree_dirty_changed");
  }
  if (input.expectedBase.worktreeRoot !== observedBase.worktreeRoot) {
    driftReasons.push("root_changed");
  }

  const driftDetected =
    driftReasons.length > 0 || expectedBaseDigest !== observedBaseDigest;

  const { conflicts, preconditions } = evaluateConflictsAndPreconditions({
    operationKind: input.operationKind,
    backendMode: input.backendMode,
    targetBranch: input.targetBranch ?? null,
    normalizedPaths: normalizedUniquePaths(input.targetPaths, []),
    sessionGrantId: input.sessionGrantId ?? null,
    snapshot: input.observed,
    strictIsolatedAllowed: Boolean(input.strictIsolatedAllowed),
  });

  const finalPreconditions: PlannerPrecondition[] = [
    {
      id: "no_base_drift",
      label: "Base Git inalterada desde o plano",
      satisfied: !driftDetected,
      detail: driftDetected
        ? `Drift detectado: ${driftReasons.length > 0 ? driftReasons.join(", ") : "baseDigest divergente"}`
        : `Base intacta (${observedBaseDigest.slice(0, 12)})`,
    },
    ...preconditions,
  ];

  const finalConflicts: PlannerConflict[] = driftDetected
    ? [
        {
          kind: "drift_detected",
          blocking: true,
          path: null,
          summary: `Estado atual divergiu da base planejada (${driftReasons.join(", ") || "digest"}).`,
        },
        ...conflicts,
      ]
    : conflicts;

  let status: PlannerPreflightStatus = "valid";
  if (driftDetected) {
    status = "invalidated_by_drift";
  } else if (finalConflicts.some((c) => c.blocking)) {
    status = "blocked";
  }

  return {
    status,
    driftDetected,
    driftReasons,
    expectedBase: input.expectedBase,
    observedBase,
    expectedBaseDigest,
    observedBaseDigest,
    preconditions: finalPreconditions,
    conflicts: finalConflicts,
    executionAllowed: status === "valid",
  };
}

export function computeDiffDigest(input: {
  planId: string;
  executionId: string;
  baseHead: string | null;
  files: readonly DiffDigestFile[];
}): string {
  const sorted = [...input.files].sort((a, b) => a.path.localeCompare(b.path));
  return sha256Hex(
    canonicalJson({
      planId: input.planId,
      executionId: input.executionId,
      baseHead: input.baseHead,
      files: sorted.map((file) => ({
        path: file.path,
        action: file.action,
        beforeSha256: file.beforeSha256,
        beforeBytes: file.beforeBytes,
        beforeCrlf: file.beforeCrlf,
        afterSha256: file.afterSha256,
        afterBytes: file.afterBytes,
        afterCrlf: file.afterCrlf,
      })),
    }),
  );
}

export function computeVerifierDefinitionDigest(tuple: VerifierTuple): string {
  return sha256Hex(
    canonicalJson({
      definitionId: tuple.definitionId,
      argv: [...tuple.argv],
      cwdRelative: tuple.cwdRelative,
      envWhitelist: [...tuple.envWhitelist],
      timeoutMs: tuple.timeoutMs,
      privilegeProfile: tuple.privilegeProfile,
    }),
  );
}

export function validateVerifierApproval(input: {
  definition: VerifierDefinitionRecord;
  expectedDefinitionDigest?: string;
  strictIsolatedAllowed?: boolean;
}): VerifierApprovalValidation {
  const computedDigest = computeVerifierDefinitionDigest({
    definitionId: input.definition.definitionId,
    argv: input.definition.argv,
    cwdRelative: input.definition.cwdRelative,
    envWhitelist: input.definition.envWhitelist,
    timeoutMs: input.definition.timeoutMs,
    privilegeProfile: input.definition.privilegeProfile,
  });

  if (
    input.definition.privilegeProfile === "isolated_probe" &&
    !input.strictIsolatedAllowed
  ) {
    return {
      allowed: false,
      status: input.definition.approvalStatus,
      computedDigest,
      reason: "execution_backend_blocked",
    };
  }

  if (input.definition.definitionDigest !== computedDigest) {
    return {
      allowed: false,
      status: "revoked_by_redefinition",
      computedDigest,
      reason: "verifier_approval_invalid",
    };
  }

  if (
    input.definition.approvalStatus !== "approved" ||
    !input.definition.approvedDigest ||
    input.definition.approvedDigest !== computedDigest
  ) {
    return {
      allowed: false,
      status: input.definition.approvalStatus,
      computedDigest,
      reason: "verifier_approval_invalid",
    };
  }

  if (
    input.expectedDefinitionDigest &&
    input.expectedDefinitionDigest !== computedDigest
  ) {
    return {
      allowed: false,
      status: input.definition.approvalStatus,
      computedDigest,
      reason: "verifier_approval_invalid",
    };
  }

  return {
    allowed: true,
    status: "approved",
    computedDigest,
    reason: null,
  };
}

export function grantAllowsEffect(
  allowedEffects: readonly OperationEffect[],
  required: OperationEffect,
): boolean {
  return allowedEffects.includes(required);
}
