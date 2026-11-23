import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CasPinRecord,
  ClaimDetailResult,
  DirtyOverlaySummary,
  ExportAuditRecord,
  ExportExceptionRecord,
  ExportPreviewResult,
  GcReport,
  IdentityScope,
  InboxProposalRecord,
  MemoryVisibility,
  OverlayReconstructResult,
  OverlayVerifyResult,
  PurgeJobRecord,
  RelationKind,
  TimelineResult,
  TimelineSignalKind,
} from "@laplace/contracts";
import { errorMessage, type createDesktopClient } from "./ipc";
import { EmptyState, WorkDisclosure, WorkHeading } from "./WorkView";

type MemoryClient = ReturnType<typeof createDesktopClient>["memory"];

const signalLabels: Record<TimelineSignalKind, string> = {
  confirmed_link: "Ligação confirmada",
  objective_drift: "Deriva objetiva / lacuna",
  inference: "Inferência (derivada)",
  verifier_signal: "Sinal do verificador",
};

const signalBadgeClass: Record<TimelineSignalKind, string> = {
  confirmed_link: "verified",
  objective_drift: "warning",
  inference: "",
  verifier_signal: "error",
};

export function MemoryWorkspaceView({
  projectId,
  projectName,
  scope,
  client,
}: {
  projectId: string;
  projectName: string;
  scope: IdentityScope | null;
  client: MemoryClient;
}) {
  const scopeKey = scope
    ? `${projectId}:${scope.projectId}:${scope.bindingId}:${scope.worktreeId}`
    : null;
  const scopeKeyRef = useRef<string | null>(scopeKey);
  const generationRef = useRef(0);

  const [knownAt, setKnownAt] = useState(() => new Date().toISOString());
  const [validAt, setValidAt] = useState("");
  const [activeSignals, setActiveSignals] = useState<TimelineSignalKind[]>([
    "confirmed_link",
    "objective_drift",
    "inference",
    "verifier_signal",
  ]);
  const [timeline, setTimeline] = useState<TimelineResult | null>(null);

  const [claimTitle, setClaimTitle] = useState("");
  const [claimContent, setClaimContent] = useState("");
  const [claimReason, setClaimReason] = useState("");
  const [claimConflictKey, setClaimConflictKey] = useState("");
  const [claimPinId, setClaimPinId] = useState("");
  const [claimValidFrom, setClaimValidFrom] = useState(
    "2026-01-01T00:00:00.000Z",
  );
  const [claimValidTo, setClaimValidTo] = useState("");
  const [lastClaim, setLastClaim] = useState<ClaimDetailResult | null>(null);

  const [correctClaimId, setCorrectClaimId] = useState("");
  const [correctContent, setCorrectContent] = useState("");
  const [correctFrom, setCorrectFrom] = useState("2026-01-10T00:00:00.000Z");
  const [correctTo, setCorrectTo] = useState("2026-01-20T00:00:00.000Z");
  const [correctReason] = useState("Correção parcial retroativa");

  const [relFromId, setRelFromId] = useState("");
  const [relToId, setRelToId] = useState("");
  const [relKind, setRelKind] = useState<RelationKind>("supports");
  const [relSignalKind, setRelSignalKind] =
    useState<TimelineSignalKind>("confirmed_link");
  const [relRationale, setRelRationale] = useState("");

  const [pinLabel, setPinLabel] = useState("");
  const [pinInlineContent, setPinInlineContent] = useState("");
  const [pinsData, setPinsData] = useState<{
    quotaBytes: number;
    usedBytes: number;
    items: CasPinRecord[];
  } | null>(null);
  const [gcReport, setGcReport] = useState<GcReport | null>(null);
  const [purgeJob, setPurgeJob] = useState<PurgeJobRecord | null>(null);
  const [purgeReason, setPurgeReason] = useState(
    "Expurgo explícito solicitado pelo autor",
  );

  const [inboxTitle, setInboxTitle] = useState("");
  const [inboxContent, setInboxContent] = useState("");
  const [inboxOrigin, setInboxOrigin] = useState("sessao-local");
  const [inboxItems, setInboxItems] = useState<InboxProposalRecord[]>([]);

  const [exportDest, setExportDest] = useState("codex_mock");
  const [exportVisibility, setExportVisibility] =
    useState<MemoryVisibility>("local_only");
  const [exportContent, setExportContent] = useState("");
  const [exportPreview, setExportPreview] =
    useState<ExportPreviewResult | null>(null);
  const [exportException, setExportException] =
    useState<ExportExceptionRecord | null>(null);
  const [exportAudit, setExportAudit] = useState<ExportAuditRecord | null>(
    null,
  );

  const [overlayLabel, setOverlayLabel] = useState("Checkpoint local");
  const [overlays, setOverlays] = useState<DirtyOverlaySummary[]>([]);
  const [overlayVerify, setOverlayVerify] =
    useState<OverlayVerifyResult | null>(null);
  const [targetDir, setTargetDir] = useState("");
  const [disposableConfirmed, setDisposableConfirmed] = useState(false);
  const [reconstructResult, setReconstructResult] =
    useState<OverlayReconstructResult | null>(null);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    scopeKeyRef.current = scopeKey;
    generationRef.current += 1;
    setTimeline(null);
    setPinsData(null);
    setInboxItems([]);
    setOverlays([]);
    setLastClaim(null);
    setGcReport(null);
    setPurgeJob(null);
    setExportPreview(null);
    setExportException(null);
    setExportAudit(null);
    setOverlayVerify(null);
    setReconstructResult(null);
    setProblem("");
  }, [scopeKey]);

  const isCurrentRequest = useCallback(
    (capturedScope: string | null, capturedGen: number) =>
      scopeKeyRef.current === capturedScope &&
      generationRef.current === capturedGen,
    [],
  );

  const refreshAll = useCallback(
    async (
      targetScope: IdentityScope,
      capturedScope: string | null,
      capturedGen: number,
      queryKnownAt?: string,
    ) => {
      const k = queryKnownAt ?? new Date().toISOString();
      const [tl, pins, inbox, ovs] = await Promise.all([
        client.timeline({
          ...targetScope,
          knownAt: k,
          validAt: validAt.trim() || null,
          signalKinds: activeSignals,
        }),
        client.pinList(targetScope),
        client.inboxList(targetScope),
        client.overlayList(targetScope),
      ]);
      if (!isCurrentRequest(capturedScope, capturedGen)) return;
      setTimeline(tl);
      setPinsData({
        quotaBytes: pins.quotaBytes,
        usedBytes: pins.usedBytes,
        items: pins.items,
      });
      setInboxItems(inbox.items);
      setOverlays(ovs.items);
    },
    [activeSignals, client, isCurrentRequest, validAt],
  );

  useEffect(() => {
    if (!scope || !scopeKey) return;
    const capturedScope = scopeKey;
    const capturedGen = generationRef.current;
    void refreshAll(scope, capturedScope, capturedGen).catch((error) => {
      if (isCurrentRequest(capturedScope, capturedGen)) {
        setProblem(errorMessage(error));
      }
    });
  }, [isCurrentRequest, refreshAll, scope, scopeKey]);

  async function runScoped(action: (s: IdentityScope) => Promise<void>) {
    if (!scope || !scopeKey || busy) return;
    const capturedScope = scopeKey;
    const capturedGen = generationRef.current;
    setBusy(true);
    setProblem("");
    try {
      await action(scope);
    } catch (error) {
      if (isCurrentRequest(capturedScope, capturedGen)) {
        setProblem(errorMessage(error));
      }
    } finally {
      if (isCurrentRequest(capturedScope, capturedGen)) setBusy(false);
    }
  }

  if (!scope) {
    return (
      <section className="investigation-surface" aria-label="Memória F3">
        <WorkHeading
          id="f3-memory-heading"
          title="Memória durável, CAS & Dirty Overlays (F3)"
          description={`Projeto ${projectName}`}
        />
        <EmptyState icon="archive" title="Identidade de checkout pendente">
          Confirme o vínculo do checkout na aba Retomada antes de registrar
          revisões bitemporais, pins CAS ou Dirty Overlays.
        </EmptyState>
      </section>
    );
  }

  return (
    <section
      className="investigation-surface"
      aria-labelledby="f3-memory-heading"
    >
      <WorkHeading
        id="f3-memory-heading"
        title="Memória durável, CAS & Dirty Overlays (F3)"
        description={`Escopo ${scope.projectId.slice(0, 8)} · worktree ${scope.worktreeId.slice(0, 8)}`}
        actions={
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void runScoped(async (s) => {
                const nowIso = new Date().toISOString();
                setKnownAt(nowIso);
                await refreshAll(
                  s,
                  scopeKeyRef.current,
                  generationRef.current,
                  nowIso,
                );
              })
            }
          >
            Atualizar projeção (Agora)
          </button>
        }
      />

      {problem && (
        <p className="error-banner" role="alert">
          {problem}
        </p>
      )}

      <div className="work-grid investigation-grid">
        <div className="investigation-main">
          <section className="panel cockpit-stack">
            <header className="section-heading">
              <h3>Linha do tempo bitemporal (V/K) & Sinais KGRAPH</h3>
              <span className="badge">
                {timeline ? `${timeline.claims.length} visíveis` : "Carregando"}
              </span>
            </header>

            <div className="cockpit-header-meta">
              <div className="cockpit-field">
                <label htmlFor="f3-known-at">Conhecido em (K)</label>
                <input
                  id="f3-known-at"
                  value={knownAt}
                  onChange={(e) => setKnownAt(e.target.value)}
                />
              </div>
              <div className="cockpit-field">
                <label htmlFor="f3-valid-at">Válido em (V, opcional)</label>
                <input
                  id="f3-valid-at"
                  placeholder="Vazio = todos os intervalos"
                  value={validAt}
                  onChange={(e) => setValidAt(e.target.value)}
                />
              </div>
            </div>

            <div className="cockpit-actions">
              {(Object.keys(signalLabels) as TimelineSignalKind[]).map(
                (kind) => (
                  <label key={kind} className="cockpit-check">
                    <input
                      type="checkbox"
                      checked={activeSignals.includes(kind)}
                      onChange={(e) =>
                        setActiveSignals((prev) =>
                          e.target.checked
                            ? [...prev, kind]
                            : prev.filter((item) => item !== kind),
                        )
                      }
                    />
                    {signalLabels[kind]}
                  </label>
                ),
              )}
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void runScoped((s) =>
                    refreshAll(
                      s,
                      scopeKeyRef.current,
                      generationRef.current,
                      knownAt,
                    ),
                  )
                }
              >
                Consultar timeline (K/V)
              </button>
            </div>

            {timeline && timeline.conflicts.length > 0 && (
              <div className="error-banner" role="status">
                <strong>Conflitos materiais no recorte K/V:</strong>
                <ul className="work-list">
                  {timeline.conflicts.map((conflict, idx) => (
                    <li key={`${conflict.conflictKey}-${idx}`}>
                      <code>{conflict.conflictKey}</code> — {conflict.summary}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {timeline && timeline.claims.length > 0 ? (
              <ul className="work-list">
                {timeline.claims.map((entry) => (
                  <li className="work-list-row" key={entry.revision.revisionId}>
                    <div>
                      <strong>{entry.title}</strong>{" "}
                      <code>{entry.claimId.slice(0, 8)}</code>
                      <p>{entry.revision.content}</p>
                      <small>
                        V:[{entry.revision.validFrom},{" "}
                        {entry.revision.validTo ?? "∞"}) · K:[
                        {entry.revision.knownFrom},{" "}
                        {entry.revision.knownTo ?? "∞"}) · autor:{" "}
                        {entry.revision.author}
                      </small>
                    </div>
                    <div className="cockpit-badges">
                      <span
                        className={`badge ${
                          entry.resolvedEvidence.state === "verified"
                            ? "verified"
                            : entry.resolvedEvidence.state === "gap"
                              ? "warning"
                              : ""
                        }`}
                      >
                        {entry.resolvedEvidence.state === "verified"
                          ? "Prova CAS/contexto verificada"
                          : entry.resolvedEvidence.state === "gap"
                            ? `Lacuna: ${entry.resolvedEvidence.gapReason ?? "gap"}`
                            : "Sem prova anexada"}
                      </span>
                      <span className="badge">{entry.revision.visibility}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">
                Nenhuma afirmação visível neste instante bitemporal.
              </p>
            )}

            {timeline && timeline.signals.length > 0 && (
              <div className="cockpit-evidence-box">
                <h4>Sinais KGRAPH ({timeline.signals.length})</h4>
                <ul className="work-list">
                  {timeline.signals.map((sig) => (
                    <li className="work-list-row" key={sig.signalId}>
                      <div>
                        <span
                          className={`badge ${signalBadgeClass[sig.signalKind]}`}
                        >
                          {signalLabels[sig.signalKind]}
                        </span>{" "}
                        {sig.summary}
                      </div>
                      <small>{sig.recordedAt}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="panel cockpit-stack">
            <header className="section-heading">
              <h3>Caixa de Entrada & Exportação Governada (F3-M03)</h3>
              <span className="badge">{inboxItems.length} propostas</span>
            </header>

            <form
              className="cockpit-form"
              onSubmit={(e) => {
                e.preventDefault();
                void runScoped(async (s) => {
                  await client.inboxSubmit({
                    ...s,
                    title: inboxTitle,
                    content: inboxContent,
                    targetKind: "claim",
                    originLabel: inboxOrigin,
                  });
                  setInboxTitle("");
                  setInboxContent("");
                  await refreshAll(
                    s,
                    scopeKeyRef.current,
                    generationRef.current,
                    knownAt,
                  );
                });
              }}
            >
              <div className="cockpit-header-meta">
                <div className="cockpit-field">
                  <label htmlFor="f3-inbox-title">Título da proposta</label>
                  <input
                    id="f3-inbox-title"
                    value={inboxTitle}
                    onChange={(e) => setInboxTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="cockpit-field">
                  <label htmlFor="f3-inbox-origin">Origem</label>
                  <input
                    id="f3-inbox-origin"
                    value={inboxOrigin}
                    onChange={(e) => setInboxOrigin(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="cockpit-field">
                <label htmlFor="f3-inbox-content">Conteúdo candidato</label>
                <textarea
                  id="f3-inbox-content"
                  rows={2}
                  value={inboxContent}
                  onChange={(e) => setInboxContent(e.target.value)}
                  required
                />
              </div>
              <div className="cockpit-actions">
                <button type="submit" className="button" disabled={busy}>
                  Enviar para Inbox
                </button>
              </div>
            </form>

            {inboxItems.length > 0 && (
              <ul className="work-list">
                {inboxItems.map((item) => (
                  <li className="work-list-row" key={item.proposalId}>
                    <div>
                      <strong>{item.title}</strong>{" "}
                      <span className="badge">{item.status}</span>{" "}
                      <span className="badge">dup ×{item.duplicateCount}</span>
                      <p>{item.content}</p>
                      <small>Origens: {item.origins.join(", ")}</small>
                    </div>
                    {item.status === "pending" && (
                      <div className="cockpit-actions">
                        <button
                          type="button"
                          className="button primary"
                          disabled={busy}
                          onClick={() =>
                            void runScoped(async (s) => {
                              await client.inboxReview({
                                ...s,
                                proposalId: item.proposalId,
                                decision: "approve",
                                reviewer: "Autor Local",
                                note: "Aprovado pelo cockpit F3.",
                                promoteCanonical: true,
                                humanConfirmed: true,
                              });
                              await refreshAll(
                                s,
                                scopeKeyRef.current,
                                generationRef.current,
                                knownAt,
                              );
                            })
                          }
                        >
                          Promover (humano)
                        </button>
                        <button
                          type="button"
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void runScoped(async (s) => {
                              await client.inboxReview({
                                ...s,
                                proposalId: item.proposalId,
                                decision: "reject",
                                reviewer: "Autor Local",
                                note: "Rejeitado pelo cockpit F3.",
                                humanConfirmed: true,
                              });
                              await refreshAll(
                                s,
                                scopeKeyRef.current,
                                generationRef.current,
                                knownAt,
                              );
                            })
                          }
                        >
                          Rejeitar
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="cockpit-form">
              <div className="cockpit-header-meta">
                <div className="cockpit-field">
                  <label htmlFor="f3-exp-dest">Destino</label>
                  <select
                    id="f3-exp-dest"
                    value={exportDest}
                    onChange={(e) => setExportDest(e.target.value)}
                  >
                    <option value="local_preview">local_preview</option>
                    <option value="codex_mock">codex_mock</option>
                  </select>
                </div>
                <div className="cockpit-field">
                  <label htmlFor="f3-exp-vis">Visibilidade</label>
                  <select
                    id="f3-exp-vis"
                    value={exportVisibility}
                    onChange={(e) =>
                      setExportVisibility(e.target.value as MemoryVisibility)
                    }
                  >
                    <option value="canonical_verified">
                      canonical_verified
                    </option>
                    <option value="local_only">local_only</option>
                    <option value="db_only">db_only (sempre bloqueado)</option>
                  </select>
                </div>
              </div>
              <div className="cockpit-field">
                <label htmlFor="f3-exp-content">Item candidato</label>
                <textarea
                  id="f3-exp-content"
                  rows={2}
                  value={exportContent}
                  onChange={(e) => setExportContent(e.target.value)}
                />
              </div>
              <div className="cockpit-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy || !exportContent.trim()}
                  onClick={() =>
                    void runScoped(async (s) => {
                      const prev = await client.exportPreview({
                        ...s,
                        destinationId: exportDest,
                        items: [
                          {
                            itemId: "item-ui-1",
                            title: "Item de exportação F3",
                            visibility: exportVisibility,
                            content: exportContent,
                          },
                        ],
                      });
                      setExportPreview(prev);
                      setExportException(null);
                      setExportAudit(null);
                    })
                  }
                >
                  Pré-visualizar & escanear segredos
                </button>
                {exportPreview &&
                  !exportPreview.hardDenied &&
                  exportPreview.requiresException && (
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void runScoped(async (s) => {
                          const exc = await client.exportExceptionGrant({
                            ...s,
                            bundleDigest: exportPreview.bundleDigest,
                            destinationId: exportPreview.destinationId,
                            policyVersion: exportPreview.policyVersion,
                            reviewer: "Autor Local",
                            reason: "Exceção escopada via cockpit",
                            humanConfirmed: true,
                          });
                          setExportException(exc);
                        })
                      }
                    >
                      Conceder exceção escopada
                    </button>
                  )}
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || !exportPreview}
                  onClick={() =>
                    void runScoped(async (s) => {
                      if (!exportPreview) return;
                      const res = await client.exportExecute({
                        ...s,
                        destinationId: exportPreview.destinationId,
                        policyVersion: exportPreview.policyVersion,
                        items: [
                          {
                            itemId: "item-ui-1",
                            title: "Item de exportação F3",
                            visibility: exportVisibility,
                            content: exportContent,
                          },
                        ],
                        ...(exportException
                          ? { exceptionId: exportException.exceptionId }
                          : {}),
                      });
                      setExportAudit(res);
                    })
                  }
                >
                  Executar exportação auditada
                </button>
              </div>
              {exportPreview && (
                <div className="cockpit-evidence-box">
                  <span
                    className={`badge ${
                      exportPreview.hardDenied
                        ? "error"
                        : exportPreview.eligible || exportException
                          ? "verified"
                          : "warning"
                    }`}
                  >
                    {exportPreview.reason}
                  </span>{" "}
                  <code>digest:{exportPreview.bundleDigest.slice(0, 12)}</code>
                  {exportAudit && (
                    <p>
                      Auditado em {exportAudit.executedAt} ·{" "}
                      <code>{exportAudit.exportId.slice(0, 8)}</code>
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="investigation-inspector">
          <WorkDisclosure
            icon="overview"
            title="Registrar / Corrigir Afirmação & KGRAPH"
            detail="Histórico V/K imutável e ligações tipadas"
          >
            <form
              className="cockpit-form"
              onSubmit={(e) => {
                e.preventDefault();
                void runScoped(async (s) => {
                  const rec = await client.claimRecord({
                    ...s,
                    requestId: crypto.randomUUID(),
                    title: claimTitle,
                    content: claimContent,
                    author: "Autor Local",
                    reason: claimReason || "Registro no cockpit",
                    promoteCanonical: true,
                    conflictKey: claimConflictKey.trim() || undefined,
                    conflictPolarity: claimConflictKey.trim()
                      ? "require"
                      : undefined,
                    validFrom: claimValidFrom,
                    validTo: claimValidTo.trim() || null,
                    knownAt,
                    evidenceRef: claimPinId.trim()
                      ? { kind: "pin", pinId: claimPinId.trim() }
                      : null,
                  });
                  setLastClaim(rec);
                  setCorrectClaimId(rec.claimId);
                  await refreshAll(
                    s,
                    scopeKeyRef.current,
                    generationRef.current,
                    knownAt,
                  );
                });
              }}
            >
              <div className="cockpit-field">
                <label htmlFor="f3-claim-title">Título</label>
                <input
                  id="f3-claim-title"
                  value={claimTitle}
                  onChange={(e) => setClaimTitle(e.target.value)}
                  required
                />
              </div>
              <div className="cockpit-field">
                <label htmlFor="f3-claim-content">Afirmação</label>
                <textarea
                  id="f3-claim-content"
                  rows={2}
                  value={claimContent}
                  onChange={(e) => setClaimContent(e.target.value)}
                  required
                />
              </div>
              <div className="cockpit-header-meta">
                <div className="cockpit-field">
                  <label htmlFor="f3-valid-from">Válido de (V)</label>
                  <input
                    id="f3-valid-from"
                    value={claimValidFrom}
                    onChange={(e) => setClaimValidFrom(e.target.value)}
                    required
                  />
                </div>
                <div className="cockpit-field">
                  <label htmlFor="f3-valid-to">Válido até (opcional)</label>
                  <input
                    id="f3-valid-to"
                    value={claimValidTo}
                    onChange={(e) => setClaimValidTo(e.target.value)}
                  />
                </div>
              </div>
              <div className="cockpit-header-meta">
                <div className="cockpit-field">
                  <label htmlFor="f3-conflict-key">Chave conflito</label>
                  <input
                    id="f3-conflict-key"
                    value={claimConflictKey}
                    onChange={(e) => setClaimConflictKey(e.target.value)}
                  />
                </div>
                <div className="cockpit-field">
                  <label htmlFor="f3-pin-id">ID Pin CAS</label>
                  <input
                    id="f3-pin-id"
                    value={claimPinId}
                    onChange={(e) => setClaimPinId(e.target.value)}
                  />
                </div>
              </div>
              <div className="cockpit-field">
                <label htmlFor="f3-claim-reason">Justificativa</label>
                <input
                  id="f3-claim-reason"
                  value={claimReason}
                  onChange={(e) => setClaimReason(e.target.value)}
                />
              </div>
              <button type="submit" className="button primary" disabled={busy}>
                Registrar afirmação bitemporal
              </button>
            </form>

            {lastClaim && (
              <p className="context-muted">
                Última afirmação: <code>{lastClaim.claimId}</code> (
                {lastClaim.activeCount} segmentos ativos)
              </p>
            )}

            <form
              className="cockpit-form"
              onSubmit={(e) => {
                e.preventDefault();
                void runScoped(async (s) => {
                  const updated = await client.claimCorrect({
                    ...s,
                    requestId: crypto.randomUUID(),
                    claimId: correctClaimId,
                    content: correctContent,
                    author: "Revisor Local",
                    reason: correctReason,
                    correctFrom,
                    correctTo: correctTo.trim() || null,
                    knownAt: new Date().toISOString(),
                  });
                  setLastClaim(updated);
                  await refreshAll(
                    s,
                    scopeKeyRef.current,
                    generationRef.current,
                    new Date().toISOString(),
                  );
                });
              }}
            >
              <div className="cockpit-field">
                <label htmlFor="f3-corr-id">ID afirmação (correção)</label>
                <input
                  id="f3-corr-id"
                  value={correctClaimId}
                  onChange={(e) => setCorrectClaimId(e.target.value)}
                  required
                />
              </div>
              <div className="cockpit-field">
                <label htmlFor="f3-corr-content">Conteúdo corrigido</label>
                <input
                  id="f3-corr-content"
                  value={correctContent}
                  onChange={(e) => setCorrectContent(e.target.value)}
                  required
                />
              </div>
              <div className="cockpit-header-meta">
                <div className="cockpit-field">
                  <label htmlFor="f3-corr-from">Início janela</label>
                  <input
                    id="f3-corr-from"
                    value={correctFrom}
                    onChange={(e) => setCorrectFrom(e.target.value)}
                    required
                  />
                </div>
                <div className="cockpit-field">
                  <label htmlFor="f3-corr-to">Fim janela</label>
                  <input
                    id="f3-corr-to"
                    value={correctTo}
                    onChange={(e) => setCorrectTo(e.target.value)}
                  />
                </div>
              </div>
              <button type="submit" className="button" disabled={busy}>
                Aplicar correção parcial §7
              </button>
            </form>

            <form
              className="cockpit-form"
              onSubmit={(e) => {
                e.preventDefault();
                void runScoped(async (s) => {
                  await client.relationRecord({
                    ...s,
                    fromId: relFromId,
                    toId: relToId,
                    kind: relKind,
                    signalKind: relSignalKind,
                    rationale: relRationale,
                    author: "Autor Local",
                  });
                  await refreshAll(
                    s,
                    scopeKeyRef.current,
                    generationRef.current,
                    new Date().toISOString(),
                  );
                });
              }}
            >
              <div className="cockpit-header-meta">
                <div className="cockpit-field">
                  <label htmlFor="f3-rel-from">Origem ID</label>
                  <input
                    id="f3-rel-from"
                    value={relFromId}
                    onChange={(e) => setRelFromId(e.target.value)}
                    required
                  />
                </div>
                <div className="cockpit-field">
                  <label htmlFor="f3-rel-to">Alvo ID</label>
                  <input
                    id="f3-rel-to"
                    value={relToId}
                    onChange={(e) => setRelToId(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="cockpit-header-meta">
                <div className="cockpit-field">
                  <label htmlFor="f3-rel-kind">Relação</label>
                  <select
                    id="f3-rel-kind"
                    value={relKind}
                    onChange={(e) => setRelKind(e.target.value as RelationKind)}
                  >
                    <option value="supports">supports</option>
                    <option value="supersedes">supersedes</option>
                    <option value="contradicts">contradicts</option>
                    <option value="derived_from">derived_from</option>
                    <option value="references_evidence">
                      references_evidence
                    </option>
                  </select>
                </div>
                <div className="cockpit-field">
                  <label htmlFor="f3-rel-signal">Sinal KGRAPH</label>
                  <select
                    id="f3-rel-signal"
                    value={relSignalKind}
                    onChange={(e) =>
                      setRelSignalKind(e.target.value as TimelineSignalKind)
                    }
                  >
                    <option value="confirmed_link">confirmed_link</option>
                    <option value="objective_drift">objective_drift</option>
                    <option value="inference">inference</option>
                    <option value="verifier_signal">verifier_signal</option>
                  </select>
                </div>
              </div>
              <div className="cockpit-field">
                <label htmlFor="f3-rel-rationale">Justificativa relação</label>
                <input
                  id="f3-rel-rationale"
                  value={relRationale}
                  onChange={(e) => setRelRationale(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="button" disabled={busy}>
                Gravar ligação KGRAPH
              </button>
            </form>
          </WorkDisclosure>

          <WorkDisclosure
            icon="archive"
            title="CAS Administrado, Pins, GC & Expurgo"
            detail={
              pinsData
                ? `${pinsData.usedBytes} / ${pinsData.quotaBytes} bytes`
                : "Proteção e coleta"
            }
          >
            <form
              className="cockpit-form"
              onSubmit={(e) => {
                e.preventDefault();
                void runScoped(async (s) => {
                  await client.pinCreate({
                    ...s,
                    label: pinLabel,
                    source: { kind: "inline", content: pinInlineContent },
                  });
                  setPinLabel("");
                  setPinInlineContent("");
                  await refreshAll(
                    s,
                    scopeKeyRef.current,
                    generationRef.current,
                    knownAt,
                  );
                });
              }}
            >
              <div className="cockpit-field">
                <label htmlFor="f3-pin-label">Rótulo do pin CAS</label>
                <input
                  id="f3-pin-label"
                  value={pinLabel}
                  onChange={(e) => setPinLabel(e.target.value)}
                  required
                />
              </div>
              <div className="cockpit-field">
                <label htmlFor="f3-pin-inline">Prova inline para fixar</label>
                <textarea
                  id="f3-pin-inline"
                  rows={2}
                  value={pinInlineContent}
                  onChange={(e) => setPinInlineContent(e.target.value)}
                  required
                />
              </div>
              <div className="cockpit-actions">
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy}
                >
                  Criar Pin CAS
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void runScoped(async (s) => {
                      const report = await client.gcRun({
                        ...s,
                        humanConfirmed: true,
                      });
                      setGcReport(report);
                      await refreshAll(
                        s,
                        scopeKeyRef.current,
                        generationRef.current,
                        knownAt,
                      );
                    })
                  }
                >
                  Executar GC protegido
                </button>
              </div>
            </form>

            {gcReport && (
              <p className="context-muted">
                GC: removidos {gcReport.deletedDigests.length} órfãos ·
                protegidos {gcReport.protectedCount} digests.
              </p>
            )}

            {pinsData && pinsData.items.length > 0 && (
              <ul className="work-list">
                {pinsData.items.map((pin) => (
                  <li className="work-list-row" key={pin.pinId}>
                    <div>
                      <strong>{pin.label}</strong>{" "}
                      <code>{pin.pinId.slice(0, 8)}</code>
                      <small>
                        {" "}
                        · {pin.bytes} B · {pin.status}
                      </small>
                    </div>
                    <div className="cockpit-actions">
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void runScoped(async (s) => {
                            await client.pinVerify({ ...s, pinId: pin.pinId });
                            await refreshAll(
                              s,
                              scopeKeyRef.current,
                              generationRef.current,
                              knownAt,
                            );
                          })
                        }
                      >
                        Verificar
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void runScoped(async (s) => {
                            await client.pinRelease({
                              ...s,
                              pinId: pin.pinId,
                              humanConfirmed: true,
                            });
                            await refreshAll(
                              s,
                              scopeKeyRef.current,
                              generationRef.current,
                              knownAt,
                            );
                          })
                        }
                      >
                        Liberar
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void runScoped(async (s) => {
                            const job = await client.purgeStart({
                              ...s,
                              targetKind: "pin",
                              targetId: pin.pinId,
                              reason: purgeReason,
                              humanConfirmed: true,
                              maxSteps: 1,
                            });
                            setPurgeJob(job);
                            await refreshAll(
                              s,
                              scopeKeyRef.current,
                              generationRef.current,
                              knownAt,
                            );
                          })
                        }
                      >
                        Expurgar (etapa 1)
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="cockpit-field">
              <label htmlFor="f3-purge-reason">Motivo expurgo</label>
              <input
                id="f3-purge-reason"
                value={purgeReason}
                onChange={(e) => setPurgeReason(e.target.value)}
              />
            </div>

            {purgeJob && (
              <div className="cockpit-evidence-box">
                <p>
                  Expurgo <code>{purgeJob.purgeId.slice(0, 8)}</code> · estágio{" "}
                  <strong>{purgeJob.stage}</strong> ({purgeJob.state})
                </p>
                {purgeJob.state === "in_progress" && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void runScoped(async (s) => {
                        const done = await client.purgeResume(
                          s,
                          purgeJob.purgeId,
                        );
                        setPurgeJob(done);
                        await refreshAll(
                          s,
                          scopeKeyRef.current,
                          generationRef.current,
                          knownAt,
                        );
                      })
                    }
                  >
                    Retomar expurgo até concluir
                  </button>
                )}
              </div>
            )}
          </WorkDisclosure>

          <WorkDisclosure
            icon="git"
            title="Dirty Overlays Fiéis & Reconstrução OCC (F3-M04)"
            detail={`${overlays.length} capturados`}
          >
            <div className="cockpit-form">
              <div className="cockpit-field">
                <label htmlFor="f3-overlay-label">Rótulo do overlay</label>
                <input
                  id="f3-overlay-label"
                  value={overlayLabel}
                  onChange={(e) => setOverlayLabel(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="button primary"
                disabled={busy || !overlayLabel.trim()}
                onClick={() =>
                  void runScoped(async (s) => {
                    await client.overlayCapture({ ...s, label: overlayLabel });
                    await refreshAll(
                      s,
                      scopeKeyRef.current,
                      generationRef.current,
                      knownAt,
                    );
                  })
                }
              >
                Capturar Dirty Overlay (read-only + OCC)
              </button>
            </div>

            <div className="cockpit-form">
              <div className="cockpit-field">
                <label htmlFor="f3-target-dir">
                  Destino descartável absoluto (reconstrução)
                </label>
                <input
                  id="f3-target-dir"
                  placeholder="C:\Temp\laplace-overlay-restore"
                  value={targetDir}
                  onChange={(e) => setTargetDir(e.target.value)}
                />
              </div>
              <label className="cockpit-check">
                <input
                  type="checkbox"
                  checked={disposableConfirmed}
                  onChange={(e) => setDisposableConfirmed(e.target.checked)}
                />
                Confirmo que o destino é descartável e externo ao repositório e
                catálogo
              </label>
            </div>

            {overlays.length > 0 && (
              <ul className="work-list">
                {overlays.map((ov) => (
                  <li className="work-list-row" key={ov.overlayId}>
                    <div>
                      <strong>{ov.label}</strong>{" "}
                      <code>{ov.overlayId.slice(0, 8)}</code>
                      <small>
                        {" "}
                        · {ov.fileCount} arquivos · {ov.gapCount} lacunas
                      </small>
                    </div>
                    <div className="cockpit-actions">
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void runScoped(async (s) => {
                            const res = await client.overlayVerify({
                              ...s,
                              overlayId: ov.overlayId,
                            });
                            setOverlayVerify(res);
                          })
                        }
                      >
                        Verificar CAS
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void runScoped(async (s) => {
                            const rec = await client.overlayReconstruct({
                              ...s,
                              overlayId: ov.overlayId,
                              targetDir,
                              disposableTargetConfirmed: disposableConfirmed,
                            });
                            setReconstructResult(rec);
                          })
                        }
                      >
                        Reconstruir
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {overlayVerify && (
              <p className="context-muted">
                Verificação CAS:{" "}
                <strong>
                  {overlayVerify.intact ? "Íntegro" : "Falha/Ausente"}
                </strong>{" "}
                ({overlayVerify.checkedBlobs} blobs checados)
              </p>
            )}
            {reconstructResult && (
              <p className="context-muted">
                Reconstrução: {reconstructResult.verifiedCount} gravados ·{" "}
                {reconstructResult.deletedCount} removidos ·{" "}
                {reconstructResult.skippedCount} lacunas
              </p>
            )}
          </WorkDisclosure>
        </aside>
      </div>
    </section>
  );
}
