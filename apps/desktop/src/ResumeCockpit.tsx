import { useEffect, useState, type ReactNode } from "react";
import type {
  BindingVerificationState,
  ContextSnapshot,
  DecisionDetailResult,
  DecisionEvidenceInput,
  DecisionPurgeReceipt,
  EvidencePresentComparison,
  GitObservation,
  Project,
  ProjectIdentityResult,
  ProjectRecord,
  ResolvedEvidence,
  ResumeConflict,
  ResumeDecision,
  ResumeSummary,
} from "@laplace/contracts";
import { TextComparison } from "./TextComparison";
import { errorMessage, type createDesktopClient } from "./ipc";
import { createLatestRequest } from "./workspace";
import { EmptyState } from "./WorkView";
import { VisualIcon } from "./VisualIcon";

const timeFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
});

function formatTimestamp(iso: string) {
  return <time dateTime={iso}>{timeFormat.format(new Date(iso))}</time>;
}

const verificationLabels: Record<BindingVerificationState, string> = {
  verified: "Vínculo verificado",
  unverified_legacy: "Legado não confirmado",
  ambiguous: "Vínculo ambíguo",
  divergent: "Identidade divergente",
  unavailable: "Checkout indisponível",
};

const conflictLabels: Record<ResumeConflict["kind"], string> = {
  identity_divergent: "Identidade divergente",
  identity_ambiguous: "Vínculo ambíguo",
  legacy_unverified: "Projeto legado sem confirmação",
  evidence_gap: "Lacuna na evidência",
  working_conflict: "Conflito no índice Git",
  git_unavailable: "Leitura Git indisponível",
};

const comparisonLabels: Record<
  EvidencePresentComparison["comparison"],
  string
> = {
  matches: "Idêntico ao arquivo atual",
  differs: "Difere do arquivo atual",
  unavailable: "Indisponível",
};

const presentStateLabels: Record<
  EvidencePresentComparison["present"]["state"],
  string
> = {
  available: "working tree disponível",
  unavailable: "arquivo indisponível no working tree",
  blocked_by_gap: "bloqueada por lacuna na prova histórica",
};

const gapLabels: Record<string, string> = {
  folder_unavailable: "Pasta do checkout ausente ou inacessível",
  not_repository: "A pasta não é um repositório Git válido",
  identity_mismatch: "Checkout no disco difere da identidade cadastrada",
  identity_unknown: "Identidade do checkout ainda não confirmada",
  git_timeout: "Tempo limite excedido na consulta Git",
  git_missing: "Executável Git ausente no ambiente",
  git_failed: "Falha ao consultar estado do Git",
};

const evidenceGapBadges: Record<string, string> = {
  no_source_attached: "Sem fonte anexada",
  source_unavailable: "Fonte indisponível",
  source_digest_mismatch: "Digest divergente",
  source_omitted: "Fonte omitida",
  source_cross_scope: "Outro projeto",
};

const evidenceGapLabels: Record<string, string> = {
  no_source_attached:
    "Sem fonte preservada vinculada (registro manual provisório)",
  source_unavailable: "Fonte histórica ou blob indisponível no catálogo",
  source_digest_mismatch: "O digest da fonte preservada falhou na verificação",
  source_omitted: "O arquivo selecionado foi omitido na captura original",
  source_cross_scope: "Referência pertence a outro projeto",
};

const coverageLabels: Record<string, string> = {
  full: "completa",
  partial: "parcial",
  none: "nenhuma",
};

function formatLineRange(firstLine: number, lastLine: number) {
  return firstLine === lastLine
    ? `Linha ${firstLine}`
    : `Linhas ${firstLine}–${lastLine}`;
}

type CapturedSourceOption = {
  label: string;
  value: string;
  ref: Exclude<DecisionEvidenceInput, null>;
};

function makeRequestId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ResumeCockpit({
  navigation,
  project,
  fallbackSummary,
  identity,
  resume,
  loading,
  relocate,
  confirmIdentity,
  contextClient,
  decisionClient,
  onResumeUpdated,
  onViewChanges,
}: {
  navigation: ReactNode;
  project: ProjectRecord;
  fallbackSummary: GitObservation | undefined;
  identity: ProjectIdentityResult | null;
  resume: ResumeSummary | null;
  loading: boolean;
  relocate: () => void;
  confirmIdentity: () => Promise<Project>;
  contextClient: ReturnType<typeof createDesktopClient>["context"];
  decisionClient: ReturnType<typeof createDesktopClient>["decisions"];
  onResumeUpdated: () => void;
  onViewChanges: () => void;
}) {
  const [actionLatest] = useState(() => createLatestRequest());
  const [sourcesLatest] = useState(() => createLatestRequest());
  const [evidenceState, setEvidenceState] = useState<{
    assertionId: string;
    revisionId: string;
    resolved: ResolvedEvidence;
  } | null>(null);
  const [compareState, setCompareState] = useState<{
    assertionId: string;
    revisionId: string;
    comparison: EvidencePresentComparison;
  } | null>(null);
  const [historyState, setHistoryState] = useState<{
    assertionId: string;
    revisionId: string;
    detail: DecisionDetailResult;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [purgeReceipt, setPurgeReceipt] = useState<DecisionPurgeReceipt | null>(
    null,
  );

  // Decision record/revision form state
  const [formOpen, setFormOpen] = useState(false);
  const [editingDecision, setEditingDecision] = useState<ResumeDecision | null>(
    null,
  );
  const [content, setContent] = useState("");
  const [author, setAuthor] = useState("Operador Local");
  const [reason, setReason] = useState("");
  const [humanConfirmed, setHumanConfirmed] = useState(false);
  const [promoteCanonical, setPromoteCanonical] = useState(false);
  const [selectedSourceKey, setSelectedSourceKey] = useState("");
  const [sourceOptions, setSourceOptions] = useState<CapturedSourceOption[]>(
    [],
  );

  // Purge confirmation state
  const [purgeTarget, setPurgeTarget] = useState<ResumeDecision | null>(null);
  const [purgeConfirmed, setPurgeConfirmed] = useState(false);
  const [purgeReason, setPurgeReason] = useState(
    "Exclusão deliberada pelo usuário",
  );

  useEffect(
    () => () => {
      actionLatest.invalidate();
      sourcesLatest.invalidate();
    },
    [actionLatest, sourcesLatest],
  );

  const verification: BindingVerificationState | null =
    resume?.verification ?? identity?.verification ?? null;
  const currentObs = resume?.observation;
  const displayGit: GitObservation | null =
    currentObs !== undefined
      ? currentObs.observation
      : (fallbackSummary ?? null);
  const activeDecision =
    resume?.memory.state === "available" ? resume.memory.decision : null;

  async function loadCapturedSources() {
    setActionError(null);
    setSourcesLoading(true);
    await sourcesLatest.run(
      async () => {
        const history = await contextClient.list(project.id, null);
        const snapshots: ContextSnapshot[] = await Promise.all(
          history.items
            .slice(0, 5)
            .map((item) => contextClient.get(project.id, item.contextId)),
        );
        const options: CapturedSourceOption[] = [];
        for (const snap of snapshots) {
          for (const entry of snap.entries) {
            if (entry.outcome !== "included") continue;
            const ref = {
              contextId: snap.contextId,
              path: entry.path,
              sha256: entry.sha256,
              chunk: 0,
            };
            options.push({
              label: `${entry.path} · captura ${snap.contextId.slice(0, 8)} (${snap.status})`,
              value: `${snap.contextId}:${entry.path}:${entry.sha256}:0`,
              ref,
            });
          }
        }
        return options;
      },
      (options) => {
        setSourcesLoading(false);
        setSourceOptions(options);
      },
      (err) => {
        setSourcesLoading(false);
        setActionError(errorMessage(err));
      },
    );
  }

  function handleConfirmIdentity() {
    setBusyAction("confirm_identity");
    setActionError(null);
    void actionLatest.run(
      () => confirmIdentity(),
      () => {
        setBusyAction(null);
        onResumeUpdated();
      },
      (err) => {
        setBusyAction(null);
        setActionError(errorMessage(err));
      },
    );
  }

  function openForm(existing: ResumeDecision | null) {
    setEditingDecision(existing);
    setContent(existing?.content ?? "");
    setAuthor(existing?.author ?? "Operador Local");
    setReason("");
    setHumanConfirmed(false);
    setPromoteCanonical(false);
    const existingRef = existing?.evidence.ref;
    setSelectedSourceKey(
      existingRef
        ? `${existingRef.contextId}:${existingRef.path}:${existingRef.sha256}:${existingRef.chunk}`
        : "",
    );
    setPurgeTarget(null);
    setActionError(null);
    setFormOpen(true);
    void loadCapturedSources();
  }

  function openPreview(decision: ResumeDecision) {
    if (!resume || !decision.evidence.ref) return;
    const ref = {
      contextId: decision.evidence.ref.contextId,
      path: decision.evidence.ref.path,
      sha256: decision.evidence.ref.sha256,
      chunk: decision.evidence.ref.chunk,
    };
    setBusyAction("preview");
    setActionError(null);
    void actionLatest.run(
      () => decisionClient.evidenceResolve(resume.scope, ref),
      (resolved) => {
        setBusyAction(null);
        setEvidenceState({
          assertionId: decision.assertionId,
          revisionId: decision.revisionId,
          resolved,
        });
      },
      (err) => {
        setBusyAction(null);
        setActionError(errorMessage(err));
      },
    );
  }

  function openCompare(decision: ResumeDecision) {
    if (!resume || !decision.evidence.ref) return;
    const ref = {
      contextId: decision.evidence.ref.contextId,
      path: decision.evidence.ref.path,
      sha256: decision.evidence.ref.sha256,
      chunk: decision.evidence.ref.chunk,
    };
    setBusyAction("compare");
    setActionError(null);
    void actionLatest.run(
      () => decisionClient.comparePresent(resume.scope, ref),
      (comparison) => {
        setBusyAction(null);
        setCompareState({
          assertionId: decision.assertionId,
          revisionId: decision.revisionId,
          comparison,
        });
      },
      (err) => {
        setBusyAction(null);
        setActionError(errorMessage(err));
      },
    );
  }

  function openHistory(decision: ResumeDecision) {
    if (!resume) return;
    if (
      historyState &&
      historyState.assertionId === decision.assertionId &&
      historyState.revisionId === decision.revisionId
    ) {
      setHistoryState(null);
      return;
    }
    setBusyAction("history");
    setActionError(null);
    void actionLatest.run(
      () => decisionClient.get(resume.scope, decision.assertionId),
      (detail) => {
        setBusyAction(null);
        setHistoryState({
          assertionId: decision.assertionId,
          revisionId: decision.revisionId,
          detail,
        });
      },
      (err) => {
        setBusyAction(null);
        setActionError(errorMessage(err));
      },
    );
  }

  function submitDecision(event: React.FormEvent) {
    event.preventDefault();
    if (!resume) return;
    const trimmedContent = content.trim();
    const trimmedAuthor = author.trim();
    const trimmedReason = reason.trim();
    if (!trimmedContent || !trimmedAuthor || !trimmedReason) {
      setActionError("Preencha decisão, autor e motivo sem texto em branco.");
      return;
    }
    const picked =
      sourceOptions.find((item) => item.value === selectedSourceKey)?.ref ??
      (editingDecision?.evidence.ref &&
      `${editingDecision.evidence.ref.contextId}:${editingDecision.evidence.ref.path}:${editingDecision.evidence.ref.sha256}:${editingDecision.evidence.ref.chunk}` ===
        selectedSourceKey
        ? {
            contextId: editingDecision.evidence.ref.contextId,
            path: editingDecision.evidence.ref.path,
            sha256: editingDecision.evidence.ref.sha256,
            chunk: editingDecision.evidence.ref.chunk,
          }
        : null);

    setBusyAction("record");
    setActionError(null);
    setPurgeReceipt(null);
    void actionLatest.run(
      () =>
        decisionClient.record({
          ...resume.scope,
          requestId: makeRequestId("dec"),
          assertionId: editingDecision?.assertionId ?? null,
          expectedRevision: editingDecision?.revision ?? 0,
          content: trimmedContent,
          author: trimmedAuthor,
          reason: trimmedReason,
          humanConfirmed,
          promoteCanonical,
          evidence: picked,
        }),
      () => {
        setBusyAction(null);
        setFormOpen(false);
        setEvidenceState(null);
        setCompareState(null);
        setHistoryState(null);
        onResumeUpdated();
      },
      (err) => {
        setBusyAction(null);
        setActionError(errorMessage(err));
      },
    );
  }

  function submitPurge(event: React.FormEvent) {
    event.preventDefault();
    if (!resume || !purgeTarget) return;
    const trimmedReason = purgeReason.trim();
    if (!trimmedReason) {
      setActionError("Informe o motivo do expurgo.");
      return;
    }
    setBusyAction("purge");
    setActionError(null);
    void actionLatest.run(
      () =>
        decisionClient.purge({
          ...resume.scope,
          assertionId: purgeTarget.assertionId,
          expectedRevision: purgeTarget.revision,
          confirmedScope: purgeConfirmed,
          reason: trimmedReason,
        }),
      (receipt) => {
        setBusyAction(null);
        setPurgeReceipt(receipt);
        setPurgeTarget(null);
        setPurgeConfirmed(false);
        setEvidenceState(null);
        setCompareState(null);
        setHistoryState(null);
        setFormOpen(false);
        onResumeUpdated();
      },
      (err) => {
        setBusyAction(null);
        setActionError(errorMessage(err));
      },
    );
  }

  const showingEvidence =
    activeDecision &&
    evidenceState?.assertionId === activeDecision.assertionId &&
    evidenceState?.revisionId === activeDecision.revisionId
      ? evidenceState.resolved
      : null;
  const showingCompare =
    activeDecision &&
    compareState?.assertionId === activeDecision.assertionId &&
    compareState?.revisionId === activeDecision.revisionId
      ? compareState.comparison
      : null;
  const showingHistory =
    activeDecision &&
    historyState?.assertionId === activeDecision.assertionId &&
    historyState?.revisionId === activeDecision.revisionId
      ? historyState.detail
      : null;

  return (
    <div className="resume-surface">
      <div className="cockpit-strip">
        {navigation}
        <div className="cockpit-header-meta resume-binding">
          {verification ? (
            <span className={`badge ${verification}`}>
              {verificationLabels[verification]}
            </span>
          ) : (
            <span className="badge">
              {loading ? "Verificando vínculo…" : "Vínculo indisponível"}
            </span>
          )}
          {resume && resume.projectName !== project.name && (
            <span className="badge">Projeto lógico: {resume.projectName}</span>
          )}
          {identity && identity.worktrees.length > 1 && (
            <span className="badge">
              {identity.worktrees.length} worktrees no repositório
            </span>
          )}
          {verification === "unverified_legacy" && (
            <button
              className="text-button"
              disabled={busyAction !== null}
              onClick={handleConfirmIdentity}
            >
              Confirmar vínculo do checkout
            </button>
          )}
          {(verification === "unavailable" ||
            verification === "divergent" ||
            verification === "ambiguous" ||
            currentObs?.state === "cached" ||
            currentObs?.state === "unavailable") && (
            <button className="text-button" onClick={relocate}>
              Relocalizar pasta
            </button>
          )}
        </div>
      </div>

      {verification === "ambiguous" &&
        identity &&
        identity.candidates.length > 0 && (
          <section className="panel" aria-live="polite">
            <h2>Candidatos de vínculo no mesmo repositório</h2>
            <p className="observed">
              Mais de um checkout compartilha o mesmo diretório Git comum.
              Confirme ou relocalize explicitamente o checkout desejado.
            </p>
            <ul className="cockpit-conflicts">
              {identity.candidates.map((candidate, index) => (
                <li
                  key={`${candidate.root}-${index}`}
                  className="cockpit-conflict-item"
                >
                  <code>{candidate.root}</code> ·{" "}
                  {candidate.isMain
                    ? "worktree principal"
                    : "worktree vinculada"}
                </li>
              ))}
            </ul>
          </section>
        )}

      {actionError && (
        <div className="error-banner" role="alert">
          <strong>{actionError}</strong>
        </div>
      )}

      {purgeReceipt && (
        <section className="panel" aria-live="polite">
          <h2>Expurgo F1 concluído</h2>
          <p>
            Estado: <code>{purgeReceipt.status}</code> · Tombstone:{" "}
            <code>{purgeReceipt.tombstoneId.slice(0, 12)}</code> · Capturas
            compartilhadas preservadas:{" "}
            {purgeReceipt.preservedSharedBlobs ? "sim" : "não"} · Escopo:{" "}
            <code>{purgeReceipt.scopeBoundary}</code>.
          </p>
        </section>
      )}

      <section
        className="resume-directive"
        aria-labelledby="next-action-heading"
      >
        <div className="directive-label">
          <h2 id="next-action-heading">Próxima ação</h2>
          <span className="badge advisory">Sugestão</span>
        </div>
        {resume ? (
          <>
            <h3>{resume.nextAction.label}</h3>
            <p className="next-action-rationale">
              {resume.nextAction.rationale}
            </p>
            {resume.nextAction.blockedByConflict && (
              <p className="badge warning">
                Sugestão dependente suspensa por conflito material
              </p>
            )}
            {resume.memory.conflicts.length > 0 && (
              <ul className="cockpit-conflicts">
                {resume.memory.conflicts.map(
                  (conflict: ResumeConflict, idx: number) => (
                    <li
                      key={`${conflict.kind}-${idx}`}
                      className={`cockpit-conflict-item ${conflict.blocking ? "blocking" : ""}`}
                    >
                      <strong>
                        {conflictLabels[conflict.kind] ?? conflict.kind}
                      </strong>
                      : {conflict.summary}
                    </li>
                  ),
                )}
              </ul>
            )}
          </>
        ) : (
          <p className="work-message" role="status">
            {loading
              ? "Compondo retomada…"
              : "Retomada indisponível para este checkout."}
          </p>
        )}
      </section>

      <div
        className={
          resume ? "checkout-ledger" : "checkout-ledger without-decision"
        }
      >
        {resume && (
          <section
            className="ledger-region decision-sheet"
            aria-labelledby="decision-heading"
          >
            <div className="work-panel-heading">
              <h2 id="decision-heading">Decisão vigente</h2>
              <button
                className="button"
                onClick={() => openForm(activeDecision)}
              >
                {activeDecision ? "Nova revisão" : "Registrar decisão"}
              </button>
            </div>

            {!activeDecision ? (
              <EmptyState icon="file" title="Nenhuma decisão vigente">
                Registre uma decisão local e, se houver, vincule uma fonte
                preservada.
              </EmptyState>
            ) : (
              <div className="cockpit-stack decision-details">
                <div className="cockpit-badges">
                  <span className="badge">
                    Revisão #{activeDecision.revision}
                  </span>
                  <span
                    className={`badge ${activeDecision.visibility === "canonical_verified" ? "verified" : ""}`}
                  >
                    {activeDecision.visibility === "canonical_verified"
                      ? "Canônica verificada"
                      : "Local"}
                  </span>
                  <span
                    className={`badge ${activeDecision.evidence.state === "verified" ? "verified" : "warning"}`}
                  >
                    {activeDecision.evidence.state === "verified"
                      ? "Evidência verificada"
                      : (evidenceGapBadges[activeDecision.evidence.gap] ??
                        `Lacuna (${activeDecision.evidence.gap})`)}
                  </span>
                </div>

                <blockquote className="cockpit-decision-body">
                  {activeDecision.content}
                </blockquote>

                <p className="observed">
                  Autor: <strong>{activeDecision.author}</strong> · Autoridade:{" "}
                  {activeDecision.authority === "human_promoted"
                    ? "promoção humana"
                    : "registro humano local"}{" "}
                  · Vigência: {formatTimestamp(activeDecision.effectiveAt)} ·
                  Registro: {formatTimestamp(activeDecision.recordedAt)}
                </p>

                {activeDecision.evidence.ref && (
                  <p className="observed">
                    Fonte vinculada:{" "}
                    <code>{activeDecision.evidence.ref.path}</code> · captura{" "}
                    <code>
                      {activeDecision.evidence.ref.contextId.slice(0, 12)}
                    </code>{" "}
                    · SHA-256{" "}
                    <code>
                      {activeDecision.evidence.ref.sha256.slice(0, 12)}
                    </code>{" "}
                    · cobertura:{" "}
                    {coverageLabels[activeDecision.evidence.coverage] ??
                      activeDecision.evidence.coverage}
                  </p>
                )}

                {activeDecision.evidence.state === "gap" && (
                  <p className="observed">
                    {evidenceGapLabels[activeDecision.evidence.gap] ??
                      activeDecision.evidence.gap}
                  </p>
                )}

                <div className="cockpit-actions">
                  <button
                    className="button primary"
                    disabled={
                      !activeDecision.evidence.ref || busyAction !== null
                    }
                    onClick={() => openPreview(activeDecision)}
                  >
                    Abrir prova histórica
                  </button>
                  <button
                    className="button"
                    disabled={
                      !activeDecision.evidence.ref || busyAction !== null
                    }
                    onClick={() => openCompare(activeDecision)}
                  >
                    Comparar com o presente
                  </button>
                  {activeDecision.revision > 1 && (
                    <button
                      className="button"
                      disabled={busyAction !== null}
                      onClick={() => openHistory(activeDecision)}
                    >
                      {showingHistory
                        ? "Ocultar histórico"
                        : `Histórico (${activeDecision.revision} revisões)`}
                    </button>
                  )}
                </div>
                <details className="decision-maintenance">
                  <summary>Manutenção da decisão</summary>
                  <button
                    className="text-button decision-danger"
                    disabled={busyAction !== null}
                    onClick={() => {
                      setPurgeTarget(activeDecision);
                      setPurgeConfirmed(false);
                      setFormOpen(false);
                      setActionError(null);
                    }}
                  >
                    Excluir decisão (expurgo F1)
                  </button>
                </details>

                {showingHistory && (
                  <div className="cockpit-evidence-box">
                    <strong>
                      Histórico de revisões ({showingHistory.revisions.length})
                    </strong>
                    <ul className="cockpit-conflicts">
                      {showingHistory.revisions.map((rev) => (
                        <li
                          key={rev.revisionId}
                          className="cockpit-conflict-item"
                        >
                          <strong>Revisão #{rev.revision}</strong> (
                          {rev.status === "active" ? "vigente" : "substituída"}{" "}
                          ·{" "}
                          {rev.visibility === "canonical_verified"
                            ? "canônica verificada"
                            : "local"}
                          ) · {rev.author} · {formatTimestamp(rev.recordedAt)}
                          <div>{rev.content}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {showingEvidence && (
                  <div className="cockpit-evidence-box">
                    <strong>
                      Prova histórica preservada (
                      {showingEvidence.evidence.state === "verified"
                        ? showingEvidence.evidence.sourceOrigin ===
                          "context_search"
                          ? "índice C02"
                          : "captura C01"
                        : (evidenceGapBadges[showingEvidence.evidence.gap] ??
                          `lacuna: ${showingEvidence.evidence.gap}`)}
                      )
                    </strong>
                    {showingEvidence.evidence.ref && (
                      <p className="observed">
                        Caminho:{" "}
                        <code>{showingEvidence.evidence.ref.path}</code>
                        {showingEvidence.excerpt && (
                          <>
                            {" "}
                            ·{" "}
                            {formatLineRange(
                              showingEvidence.excerpt.firstLine,
                              showingEvidence.excerpt.lastLine,
                            )}
                          </>
                        )}{" "}
                        · SHA-256{" "}
                        <code>
                          {showingEvidence.evidence.ref.sha256.slice(0, 12)}
                        </code>{" "}
                        · Cobertura:{" "}
                        {coverageLabels[showingEvidence.evidence.coverage] ??
                          showingEvidence.evidence.coverage}
                        {showingEvidence.evidence.capturedAt && (
                          <>
                            {" "}
                            · Capturada em{" "}
                            {formatTimestamp(
                              showingEvidence.evidence.capturedAt,
                            )}
                          </>
                        )}
                      </p>
                    )}
                    {showingEvidence.excerpt ? (
                      <pre className="cockpit-excerpt">
                        {showingEvidence.excerpt.text}
                      </pre>
                    ) : (
                      <p>
                        Sem trecho disponível devido a{" "}
                        {showingEvidence.evidence.state === "gap"
                          ? (evidenceGapLabels[showingEvidence.evidence.gap] ??
                            showingEvidence.evidence.gap)
                          : "lacuna"}
                        .
                      </p>
                    )}
                  </div>
                )}

                {showingCompare && (
                  <div className="cockpit-evidence-box">
                    <strong>
                      Comparação histórico × presente:{" "}
                      {comparisonLabels[showingCompare.comparison] ??
                        showingCompare.comparison}
                    </strong>
                    <p className="observed">
                      Passado:{" "}
                      {showingCompare.historical.evidence.capturedAt
                        ? formatTimestamp(
                            showingCompare.historical.evidence.capturedAt,
                          )
                        : "indisponível"}
                      {showingCompare.historical.excerpt && (
                        <>
                          {" "}
                          (
                          {formatLineRange(
                            showingCompare.historical.excerpt.firstLine,
                            showingCompare.historical.excerpt.lastLine,
                          )}
                          )
                        </>
                      )}{" "}
                      · Presente:{" "}
                      {formatTimestamp(showingCompare.present.checkedAt)} (
                      {presentStateLabels[showingCompare.present.state] ??
                        showingCompare.present.state}
                      )
                    </p>
                    {showingCompare.present.state === "available" &&
                    showingCompare.historical.excerpt ? (
                      <>
                        {showingCompare.comparison === "differs" &&
                          showingCompare.historical.excerpt.text ===
                            showingCompare.present.text && (
                            <p className="observed">
                              O arquivo completo no working tree difere da
                              captura histórica (SHA-256 distinto), embora o
                              trecho vinculado (
                              {formatLineRange(
                                showingCompare.historical.excerpt.firstLine,
                                showingCompare.historical.excerpt.lastLine,
                              )}
                              ) permaneça idêntico.
                            </p>
                          )}
                        <TextComparison
                          before={showingCompare.historical.excerpt.text}
                          after={showingCompare.present.text}
                        />
                      </>
                    ) : (
                      <p>
                        Não foi possível comparar com o working tree atual (
                        {presentStateLabels[showingCompare.present.state] ??
                          showingCompare.present.state}
                        ). A prova histórica não foi substituída pelo arquivo
                        vivo.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {purgeTarget && (
              <form className="cockpit-form" onSubmit={submitPurge}>
                <strong>Confirmar expurgo local da decisão F1</strong>
                <p className="observed">
                  Remove todas as revisões e vínculos da afirmação{" "}
                  <code>{purgeTarget.assertionId.slice(0, 12)}</code>,
                  preservando capturas C01/C02 compartilhadas.
                </p>
                <label className="cockpit-field">
                  Motivo do expurgo
                  <input
                    value={purgeReason}
                    onChange={(e) => setPurgeReason(e.target.value)}
                    required
                  />
                </label>
                <label className="cockpit-check">
                  <input
                    type="checkbox"
                    checked={purgeConfirmed}
                    onChange={(e) => setPurgeConfirmed(e.target.checked)}
                  />
                  Confirmo o expurgo definitivo desta decisão neste escopo F1
                </label>
                <div className="cockpit-actions">
                  <button
                    type="submit"
                    className="button primary"
                    disabled={!purgeConfirmed || busyAction !== null}
                  >
                    Confirmar exclusão
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setPurgeTarget(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {formOpen && (
              <form className="cockpit-form" onSubmit={submitDecision}>
                <strong>
                  {editingDecision
                    ? `Registrar revisão #${editingDecision.revision + 1}`
                    : "Registrar decisão humana"}
                </strong>
                <label className="cockpit-field">
                  Decisão
                  <textarea
                    rows={3}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    required
                  />
                </label>
                <label className="cockpit-field">
                  Autor
                  <input
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    required
                  />
                </label>
                <label className="cockpit-field">
                  Motivo
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                </label>
                <label className="cockpit-field">
                  Fonte preservada (C01)
                  <select
                    value={selectedSourceKey}
                    disabled={sourcesLoading}
                    onChange={(e) => {
                      setSelectedSourceKey(e.target.value);
                      if (!e.target.value) setPromoteCanonical(false);
                    }}
                  >
                    <option value="">
                      {sourcesLoading
                        ? "Carregando capturas C01…"
                        : "Sem fonte (provisória)"}
                    </option>
                    {editingDecision?.evidence.ref &&
                      !sourceOptions.some(
                        (o) =>
                          o.value ===
                          `${editingDecision.evidence.ref!.contextId}:${editingDecision.evidence.ref!.path}:${editingDecision.evidence.ref!.sha256}:${editingDecision.evidence.ref!.chunk}`,
                      ) && (
                        <option
                          value={`${editingDecision.evidence.ref.contextId}:${editingDecision.evidence.ref.path}:${editingDecision.evidence.ref.sha256}:${editingDecision.evidence.ref.chunk}`}
                        >
                          {editingDecision.evidence.ref.path} (atual)
                        </option>
                      )}
                    {sourceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {!sourcesLoading && sourceOptions.length === 0 && (
                    <small className="observed">
                      Nenhuma captura C01 disponível ainda. Para vincular uma
                      prova verificada, capture arquivos na aba Contexto.
                    </small>
                  )}
                </label>
                <label className="cockpit-check">
                  <input
                    type="checkbox"
                    checked={humanConfirmed}
                    onChange={(e) => setHumanConfirmed(e.target.checked)}
                  />
                  Confirmo autoria e aprovação humana desta revisão
                </label>
                <label className="cockpit-check">
                  <input
                    type="checkbox"
                    checked={promoteCanonical}
                    disabled={!selectedSourceKey}
                    onChange={(e) => setPromoteCanonical(e.target.checked)}
                  />
                  Promover para decisão canônica verificada (requer fonte
                  preservada)
                </label>
                <div className="cockpit-actions">
                  <button
                    type="submit"
                    className="button primary"
                    disabled={!humanConfirmed || busyAction !== null}
                  >
                    Salvar decisão
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setFormOpen(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </section>
        )}
        <section
          className="ledger-region git-register"
          aria-labelledby="repo-heading"
        >
          <div className="work-panel-heading">
            <h2 id="repo-heading">Repositório Git</h2>
            {currentObs?.state === "fresh" && (
              <span className="badge fresh">Leitura atual do Git</span>
            )}
            {currentObs?.state === "cached" && (
              <span className="badge cached">Cache datado</span>
            )}
            {currentObs?.state === "unavailable" && (
              <span className="badge unavailable">Git indisponível</span>
            )}
          </div>
          {displayGit && (
            <>
              <dl className="repo-info checkout-details">
                <div>
                  <dt>Branch</dt>
                  <dd>
                    <code>{displayGit.branch ?? "HEAD destacado"}</code>
                  </dd>
                </div>
                <div>
                  <dt>HEAD</dt>
                  <dd>
                    {displayGit.head ? (
                      <code>{displayGit.head}</code>
                    ) : (
                      "Sem commits"
                    )}
                  </dd>
                </div>
              </dl>
              <dl className="change-counts checkout-counts">
                <div>
                  <dt>Preparadas</dt>
                  <dd>{displayGit.changes.staged}</dd>
                </div>
                <div>
                  <dt>Não preparadas</dt>
                  <dd>{displayGit.changes.unstaged}</dd>
                </div>
                <div>
                  <dt>Não rastreadas</dt>
                  <dd>{displayGit.changes.untracked}</dd>
                </div>
                {displayGit.changes.conflicted > 0 && (
                  <div>
                    <dt>Em conflito</dt>
                    <dd>{displayGit.changes.conflicted}</dd>
                  </div>
                )}
              </dl>
            </>
          )}
          <div className="checkout-footer">
            {displayGit ? (
              <p className="observed" role="status">
                {currentObs?.state === "fresh" ? (
                  <>Observado em {formatTimestamp(displayGit.observedAt)}</>
                ) : currentObs?.state === "cached" ? (
                  <>
                    Última leitura do Git em cache (
                    {formatTimestamp(displayGit.observedAt)}) · Tentativa atual
                    em {formatTimestamp(currentObs.attemptedAt)} (
                    {gapLabels[currentObs.gap] ?? currentObs.gap})
                  </>
                ) : (
                  <>
                    Cache preliminar · {formatTimestamp(displayGit.observedAt)}
                  </>
                )}
              </p>
            ) : currentObs?.state === "unavailable" ? (
              <p className="observed" role="status">
                Sem leitura Git anterior. Tentativa em{" "}
                {formatTimestamp(currentObs.attemptedAt)}:{" "}
                {gapLabels[currentObs.gap] ?? currentObs.gap}.
              </p>
            ) : (
              <p className="work-message" role="status">
                {loading
                  ? "Consultando retomada e Git…"
                  : "Nenhuma leitura Git disponível."}
              </p>
            )}
            <button
              type="button"
              className="text-button view-changes"
              onClick={onViewChanges}
            >
              Ver alterações Git <VisualIcon name="forward" />
            </button>
          </div>
        </section>

        {resume && (
          <section
            className="ledger-region activity-rail"
            aria-labelledby="activity-heading"
          >
            <h2 id="activity-heading">Atividade registrada</h2>
            {!resume.activity.lastCapture && !resume.activity.lastExecution ? (
              <p className="observed empty-activity">
                Nenhuma captura C01 ou execução anterior registrada.
              </p>
            ) : (
              <ul className="activity-list">
                {resume.activity.lastCapture && (
                  <li>
                    <div className="activity-header">
                      <h3>Última captura C01</h3>
                      <time dateTime={resume.activity.lastCapture.completedAt}>
                        {formatTimestamp(
                          resume.activity.lastCapture.completedAt,
                        )}
                      </time>
                    </div>
                    <p>
                      <code>
                        {resume.activity.lastCapture.contextId.slice(0, 12)}
                      </code>
                      {" · "}Estado{" "}
                      <code>{resume.activity.lastCapture.status}</code>
                      {" · "}
                      {resume.activity.lastCapture.included} incluído(s),{" "}
                      {resume.activity.lastCapture.omitted} omitido(s)
                    </p>
                  </li>
                )}
                {resume.activity.lastExecution && (
                  <li>
                    <div className="activity-header">
                      <h3>Última tentativa simulada (Mock)</h3>
                      <time dateTime={resume.activity.lastExecution.recordedAt}>
                        {formatTimestamp(
                          resume.activity.lastExecution.recordedAt,
                        )}
                      </time>
                    </div>
                    <p>
                      Tarefa <code>{resume.activity.lastExecution.taskId}</code>{" "}
                      · estado{" "}
                      <code>{resume.activity.lastExecution.state}</code>
                      {resume.activity.lastExecution.reviewChoice && (
                        <>
                          {" · "}revisão da tentativa:{" "}
                          <code>
                            {resume.activity.lastExecution.reviewChoice}
                          </code>
                        </>
                      )}
                    </p>
                    <p>Registro legado de execução simulada.</p>
                  </li>
                )}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
