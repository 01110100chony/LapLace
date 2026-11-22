import type {
  BindingVerificationState,
  IdentityScope,
  ResumeActivity,
  ResumeConflict,
  ResumeDecision,
  ResumeMemory,
  ResumeNextAction,
  ResumeObservation,
  ResumeSummary,
} from "@laplace/contracts";

export type ResumePreference = {
  preferActionKind?: ResumeNextAction["kind"];
  customActionLabel?: string;
};

export type ComposeResumeInput = {
  scope: IdentityScope;
  projectName: string;
  root: string;
  verification: BindingVerificationState;
  now: string;
  correlationId?: string;
  observation: ResumeObservation;
  decisions: readonly ResumeDecision[];
  conflicts?: readonly ResumeConflict[];
  lastCapture?: ResumeActivity["lastCapture"] | null;
  lastExecution?: ResumeActivity["lastExecution"] | null;
  workingConflict?: boolean;
  preferences?: {
    project?: ResumePreference;
    profile?: ResumePreference;
  };
};

function compareDesc(left: string, right: string): number {
  return left > right ? -1 : left < right ? 1 : 0;
}

function compareAsc(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function rankActiveDecisions(
  decisions: readonly ResumeDecision[],
  projectId: string,
): ResumeDecision[] {
  return decisions
    .filter((item) => item.projectId === projectId && item.status === "active")
    .sort((a, b) => {
      const aCanonical = a.visibility === "canonical_verified" ? 0 : 1;
      const bCanonical = b.visibility === "canonical_verified" ? 0 : 1;
      if (aCanonical !== bCanonical) return aCanonical - bCanonical;

      const byEffective = compareDesc(a.effectiveAt, b.effectiveAt);
      if (byEffective !== 0) return byEffective;

      const byRecorded = compareDesc(a.recordedAt, b.recordedAt);
      if (byRecorded !== 0) return byRecorded;

      if (a.revision !== b.revision) return b.revision - a.revision;

      const byAssertion = compareAsc(a.assertionId, b.assertionId);
      if (byAssertion !== 0) return byAssertion;

      return compareAsc(a.revisionId, b.revisionId);
    });
}

function buildConflicts(
  input: ComposeResumeInput,
  selected: ResumeDecision | null,
): ResumeConflict[] {
  const candidates: ResumeConflict[] = [...(input.conflicts ?? [])];
  const { now, verification, observation, workingConflict } = input;

  if (verification === "divergent") {
    candidates.push({
      kind: "identity_divergent",
      blocking: true,
      summary:
        "O checkout encontrado diverge da identidade vinculada ao projeto.",
      detectedAt: now,
    });
  } else if (verification === "ambiguous") {
    candidates.push({
      kind: "identity_ambiguous",
      blocking: true,
      summary:
        "O repositório compartilhado possui múltiplos checkouts candidatos.",
      detectedAt: now,
    });
  } else if (verification === "unverified_legacy") {
    candidates.push({
      kind: "legacy_unverified",
      blocking: true,
      summary:
        "Projeto migrado sem identidade verificada; confirmação explícita necessária.",
      detectedAt: now,
    });
  }

  if (verification === "unavailable" || observation.state === "unavailable") {
    candidates.push({
      kind: "git_unavailable",
      blocking: true,
      summary: "Não há leitura Git atual disponível para este checkout.",
      detectedAt: now,
    });
  }

  if (workingConflict) {
    candidates.push({
      kind: "working_conflict",
      blocking: true,
      summary: "Há conflitos não resolvidos no índice Git do checkout.",
      detectedAt: now,
    });
  }

  if (selected && selected.evidence.state === "gap") {
    const broken = selected.evidence.gap !== "no_source_attached";
    candidates.push({
      kind: "evidence_gap",
      blocking: broken,
      summary: broken
        ? "A fonte preservada vinculada à decisão vigente apresenta lacuna ou violação de integridade."
        : "A decisão vigente foi registrada manualmente sem fonte anexada.",
      detectedAt: now,
    });
  }

  const unique = new Map<string, ResumeConflict>();
  for (const conflict of candidates) {
    const key = `${conflict.kind}::${conflict.blocking}::${conflict.summary}`;
    if (!unique.has(key)) unique.set(key, conflict);
  }

  return [...unique.values()].sort((a, b) => {
    const byKind = compareAsc(a.kind, b.kind);
    if (byKind !== 0) return byKind;
    return compareAsc(a.summary, b.summary);
  });
}

function chooseBlockingAction(
  conflicts: readonly ResumeConflict[],
  observation: ResumeObservation,
): ResumeNextAction {
  const byKind = (kind: ResumeConflict["kind"]) =>
    conflicts.some((c) => c.blocking && c.kind === kind);

  if (byKind("identity_divergent")) {
    return {
      advisory: true,
      kind: "resolve_conflict",
      label: "Resolver divergência de identidade do checkout",
      rationale:
        "Conflito material de identidade suspende sugestões dependentes.",
      blockedByConflict: true,
    };
  }
  if (byKind("identity_ambiguous") || byKind("legacy_unverified")) {
    return {
      advisory: true,
      kind: "confirm_identity",
      label: "Confirmar vínculo verificável do checkout",
      rationale:
        "Vínculo não confirmado ou ambíguo exige confirmação humana explícita.",
      blockedByConflict: true,
    };
  }
  if (byKind("working_conflict")) {
    return {
      advisory: true,
      kind: "resolve_conflict",
      label: "Resolver conflito no índice Git",
      rationale:
        "Arquivos em conflito no índice suspendem sugestões de continuidade.",
      blockedByConflict: true,
    };
  }
  if (byKind("git_unavailable")) {
    if (observation.gap === "git_missing") {
      return {
        advisory: true,
        kind: "resolve_conflict",
        label: "Disponibilizar o executável Git no PATH",
        rationale:
          "O executável Git está ausente no ambiente; restabeleça o Git para validar o checkout.",
        blockedByConflict: true,
      };
    }
    if (observation.gap === "git_timeout" || observation.gap === "git_failed") {
      return {
        advisory: true,
        kind: "resolve_conflict",
        label: "Verificar acesso e resposta do Git no checkout",
        rationale:
          "A consulta Git falhou ou excedeu o tempo limite; verifique permissões e tente atualizar.",
        blockedByConflict: true,
      };
    }
    return {
      advisory: true,
      kind: "relocate_project",
      label: "Restabelecer acesso ou relocalizar a pasta do projeto",
      rationale: "Sem leitura Git recente, confirme ou relocalize o checkout.",
      blockedByConflict: true,
    };
  }
  return {
    advisory: true,
    kind: "review_evidence_gap",
    label: "Revisar lacuna na evidência vinculada",
    rationale:
      "A fonte preservada da decisão falhou na verificação de disponibilidade ou digest.",
    blockedByConflict: true,
  };
}

function chooseNextAction(
  input: ComposeResumeInput,
  selected: ResumeDecision | null,
  conflicts: readonly ResumeConflict[],
): ResumeNextAction {
  if (conflicts.some((item) => item.blocking)) {
    return chooseBlockingAction(conflicts, input.observation);
  }

  let defaultKind: ResumeNextAction["kind"];
  let defaultLabel: string;
  let rationale: string;

  if (!selected) {
    defaultKind = "record_decision";
    defaultLabel = "Registrar primeira decisão humana de retomada";
    rationale = "Nenhuma decisão ativa registrada neste escopo.";
  } else if (selected.evidence.state === "gap") {
    defaultKind = "review_evidence_gap";
    defaultLabel = "Vincular uma fonte preservada à decisão ativa";
    rationale = "Decisão ativa está provisória sem evidência verificada.";
  } else if (
    input.observation.state === "fresh" &&
    input.observation.observation.changes.staged +
      input.observation.observation.changes.unstaged +
      input.observation.observation.changes.untracked >
      0
  ) {
    defaultKind = "inspect_changes";
    defaultLabel = "Comparar alterações atuais com a decisão vigente";
    rationale = "Existem alterações pendentes no checkout em relação à prova.";
  } else {
    defaultKind = "continue_from_decision";
    defaultLabel = "Retomar trabalho a partir da decisão vigente";
    rationale = "Identidade verificada, Git observado e decisão fundamentada.";
  }

  const projectPref = input.preferences?.project;
  const profilePref = input.preferences?.profile;
  const applied =
    projectPref?.preferActionKind !== undefined ||
    projectPref?.customActionLabel !== undefined
      ? { source: "projeto", pref: projectPref }
      : profilePref?.preferActionKind !== undefined ||
          profilePref?.customActionLabel !== undefined
        ? { source: "perfil", pref: profilePref }
        : null;

  if (!applied) {
    return {
      advisory: true,
      kind: defaultKind,
      label: defaultLabel,
      rationale,
      blockedByConflict: false,
    };
  }

  return {
    advisory: true,
    kind: applied.pref.preferActionKind ?? defaultKind,
    label: applied.pref.customActionLabel ?? defaultLabel,
    rationale: `${rationale} Preferência de ${applied.source} aplicada após invariantes.`,
    blockedByConflict: false,
  };
}

export function composeResume(input: ComposeResumeInput): ResumeSummary {
  const { scope } = input;
  const ranked = rankActiveDecisions(input.decisions, scope.projectId);
  const selected = ranked[0] ?? null;
  const conflicts = buildConflicts(input, selected);
  const memory: ResumeMemory = selected
    ? { state: "available", decision: selected, conflicts }
    : { state: "empty", decision: null, conflicts };

  const activity: ResumeActivity = {
    lastCapture:
      input.lastCapture && input.lastCapture.projectId === scope.projectId
        ? input.lastCapture
        : null,
    lastExecution:
      input.lastExecution && input.lastExecution.projectId === scope.projectId
        ? input.lastExecution
        : null,
  };

  const summary: ResumeSummary = {
    scope,
    projectName: input.projectName,
    root: input.root,
    verification: input.verification,
    computedAt: input.now,
    observation: input.observation,
    memory,
    activity,
    nextAction: chooseNextAction(input, selected, conflicts),
  };

  return input.correlationId === undefined
    ? summary
    : { ...summary, correlationId: input.correlationId };
}
