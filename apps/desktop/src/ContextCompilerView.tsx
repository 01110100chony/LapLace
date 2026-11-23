import { useCallback, useEffect, useRef, useState } from "react";
import {
  compilerDefaultBudgetBytes,
  compilerMaxBudgetBytes,
  compilerMinBudgetBytes,
  type AuditedQueryRecord,
  type AuditReviewStatus,
  type CompiledContextPreview,
  type ContextPackageBundle,
  type ContextSnapshot,
  type HandoffEvaluationResult,
  type IdentityScope,
  type McpToolResponse,
  type PrecedenceTier,
  type SessionGrantRecord,
} from "@laplace/contracts";
import { errorMessage, type createDesktopClient } from "./ipc";

type CompilerClient = ReturnType<typeof createDesktopClient>["compiler"];

const tierLabels: Record<PrecedenceTier, string> = {
  invariant_canonical: "Invariante canônico",
  project_preference: "Preferência do projeto",
  personal_profile: "Perfil pessoal",
};

const statusLabels: Record<
  CompiledContextPreview["publicManifest"]["status"],
  string
> = {
  ready: "Pronto para concessão",
  mandatory_context_exceeded: "Obrigatório excede o orçamento",
  conflict_suspended: "Suspenso por conflito material",
  destination_blocked: "Destino desconhecido / bloqueado",
};

const modeLabels: Record<AuditedQueryRecord["mode"], string> = {
  mock_development: "Mock local (desenvolvimento)",
  unconfined_workspace_development: "Workspace Dev (não isolado)",
  verified_isolated: "Isolado verificado (bloqueado até F4-M02)",
};

export function ContextCompilerView({
  scope,
  projectName,
  snapshot,
  client,
}: {
  scope: IdentityScope | null;
  projectName: string;
  snapshot: ContextSnapshot | undefined;
  client: CompilerClient;
}) {
  const [objective, setObjective] = useState(
    "Qual é a decisão vigente e quais fontes sustentam a retomada?",
  );
  const [destinationChoice, setDestinationChoice] = useState("codex_mock");
  const [customDestination, setCustomDestination] = useState(
    "destino_desconhecido",
  );
  const [budgetBytes, setBudgetBytes] = useState(compilerDefaultBudgetBytes);
  const [includeSnapshot, setIncludeSnapshot] = useState(true);
  const [projectPrefKey, setProjectPrefKey] = useState("");
  const [projectPrefContent, setProjectPrefContent] = useState("");
  const [personalPrefKey, setPersonalPrefKey] = useState("");
  const [personalPrefContent, setPersonalPrefContent] = useState("");

  const [sessionId] = useState(
    () => `session-${Math.random().toString(36).slice(2, 10)}`,
  );
  const [humanConfirmed, setHumanConfirmed] = useState(false);
  const [unconfinedConfirmed, setUnconfinedConfirmed] = useState(false);

  const [preview, setPreview] = useState<CompiledContextPreview | null>(null);
  const [grants, setGrants] = useState<SessionGrantRecord[]>([]);
  const [selectedGrantId, setSelectedGrantId] = useState<string>("");
  const [mcpPreview, setMcpPreview] = useState<McpToolResponse | null>(null);
  const [bundle, setBundle] = useState<ContextPackageBundle | null>(null);
  const [handoffEval, setHandoffEval] =
    useState<HandoffEvaluationResult | null>(null);
  const [audits, setAudits] = useState<AuditedQueryRecord[]>([]);

  const [reviewDrafts, setReviewDrafts] = useState<
    Record<
      string,
      {
        status: Exclude<AuditReviewStatus, "pending">;
        reviewer: string;
        note: string;
        confirmed: boolean;
      }
    >
  >({});

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const scopeKey = scope
    ? `${scope.projectId}:${scope.bindingId}:${scope.worktreeId}`
    : null;
  const activeScopeKeyRef = useRef<string | null>(scopeKey);
  const generationRef = useRef(0);

  const effectiveDestination =
    destinationChoice === "custom"
      ? customDestination.trim() || "destino_desconhecido"
      : destinationChoice;

  const isCurrentRequest = useCallback(
    (capturedScopeKey: string | null, capturedGen: number) =>
      activeScopeKeyRef.current === capturedScopeKey &&
      generationRef.current === capturedGen,
    [],
  );

  const refreshGrantsAndAudits = useCallback(
    async (
      targetScope: IdentityScope,
      capturedScopeKey: string | null,
      capturedGen: number,
    ) => {
      try {
        const [grantPage, auditPage] = await Promise.all([
          client.grantList(targetScope),
          client.auditList(targetScope),
        ]);
        if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
        setGrants(grantPage.items);
        setAudits(auditPage.items);
        const firstActive = grantPage.items.find(
          (item) => item.status === "active",
        );
        if (firstActive) {
          setSelectedGrantId((prev) =>
            grantPage.items.some((g) => g.grantId === prev)
              ? prev
              : firstActive.grantId,
          );
        }
      } catch {
        // Initial load may race with identity resolution; explicit actions surface errors.
      }
    },
    [client, isCurrentRequest],
  );

  useEffect(() => {
    activeScopeKeyRef.current = scopeKey;
    const nextGen = generationRef.current + 1;
    generationRef.current = nextGen;
    setPreview(null);
    setGrants([]);
    setSelectedGrantId("");
    setMcpPreview(null);
    setBundle(null);
    setHandoffEval(null);
    setAudits([]);
    setReviewDrafts({});
    setProblem("");
    setHumanConfirmed(false);
    setUnconfinedConfirmed(false);
    setBusy(false);
    if (!scope) return;
    void refreshGrantsAndAudits(scope, scopeKey, nextGen);
  }, [scope, scopeKey, refreshGrantsAndAudits]);

  async function handleCompile(event: React.FormEvent) {
    event.preventDefault();
    if (!scope || busy) return;
    const capturedScopeKey = scopeKey;
    const capturedGen = generationRef.current;
    setBusy(true);
    setProblem("");
    setMcpPreview(null);
    setBundle(null);
    setHandoffEval(null);
    try {
      const result = await client.compile({
        ...scope,
        objective,
        destinationId: effectiveDestination,
        budgetBytes,
        ...(includeSnapshot && snapshot && snapshot.status !== "invalidated"
          ? { contextId: snapshot.contextId }
          : {}),
        ...(projectPrefKey.trim() && projectPrefContent.trim()
          ? {
              projectPreferences: [
                {
                  key: projectPrefKey.trim(),
                  title: `Preferência ${projectPrefKey.trim()}`,
                  content: projectPrefContent.trim(),
                },
              ],
            }
          : {}),
        ...(personalPrefKey.trim() && personalPrefContent.trim()
          ? {
              personalPreferences: [
                {
                  key: personalPrefKey.trim(),
                  title: `Perfil ${personalPrefKey.trim()}`,
                  content: personalPrefContent.trim(),
                },
              ],
            }
          : {}),
      });
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setPreview(result);
    } catch (error) {
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setProblem(errorMessage(error));
    } finally {
      if (isCurrentRequest(capturedScopeKey, capturedGen)) setBusy(false);
    }
  }

  async function handleIssueGrant() {
    if (!scope || !preview || busy) return;
    const capturedScopeKey = scopeKey;
    const capturedGen = generationRef.current;
    setBusy(true);
    setProblem("");
    try {
      const issued = await client.grantIssue({
        ...scope,
        sessionId,
        manifestDigest: preview.manifestDigest,
        policyVersion: preview.publicManifest.policyVersion,
        destinationId: preview.publicManifest.destinationId,
        allowedOperations: [
          "summary",
          "search",
          "read",
          "package",
          "handoff",
          "query",
        ],
        humanConfirmed,
        ...(preview.destination.id === "codex_cli_workspace"
          ? { unconfinedConfirmed }
          : {}),
      });
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setSelectedGrantId(issued.grantId);
      setHumanConfirmed(false);
      await refreshGrantsAndAudits(scope, capturedScopeKey, capturedGen);
    } catch (error) {
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setProblem(errorMessage(error));
    } finally {
      if (isCurrentRequest(capturedScopeKey, capturedGen)) setBusy(false);
    }
  }

  async function handleRevokeGrant(grantId: string) {
    if (!scope || busy) return;
    const capturedScopeKey = scopeKey;
    const capturedGen = generationRef.current;
    setBusy(true);
    setProblem("");
    try {
      await client.grantRevoke({
        ...scope,
        grantId,
        reason: "Revogação explícita no cockpit F2",
      });
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      await refreshGrantsAndAudits(scope, capturedScopeKey, capturedGen);
    } catch (error) {
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setProblem(errorMessage(error));
    } finally {
      if (isCurrentRequest(capturedScopeKey, capturedGen)) setBusy(false);
    }
  }

  const activeGrant = grants.find(
    (item) => item.grantId === selectedGrantId && item.status === "active",
  );

  async function handleMcpSummary() {
    if (!scope || !activeGrant || busy) return;
    const capturedScopeKey = scopeKey;
    const capturedGen = generationRef.current;
    setBusy(true);
    setProblem("");
    try {
      const response = await client.mcpCall({
        ...scope,
        grantId: activeGrant.grantId,
        sessionId: activeGrant.sessionId,
        manifestDigest: activeGrant.manifestDigest,
        policyVersion: activeGrant.policyVersion,
        destinationId: activeGrant.destinationId,
        method: "summary",
      });
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setMcpPreview(response);
    } catch (error) {
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setProblem(errorMessage(error));
    } finally {
      if (isCurrentRequest(capturedScopeKey, capturedGen)) setBusy(false);
    }
  }

  async function handleExportPackage() {
    if (!scope || !activeGrant || busy) return;
    const capturedScopeKey = scopeKey;
    const capturedGen = generationRef.current;
    setBusy(true);
    setProblem("");
    setHandoffEval(null);
    try {
      const exported = await client.packageExport({
        ...scope,
        grantId: activeGrant.grantId,
        sessionId: activeGrant.sessionId,
        manifestDigest: activeGrant.manifestDigest,
        policyVersion: activeGrant.policyVersion,
        destinationId: activeGrant.destinationId,
        includeHandoff: true,
      });
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setBundle(exported);
    } catch (error) {
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setProblem(errorMessage(error));
    } finally {
      if (isCurrentRequest(capturedScopeKey, capturedGen)) setBusy(false);
    }
  }

  async function handleReevaluateHandoff() {
    if (!scope || !bundle || busy) return;
    const capturedScopeKey = scopeKey;
    const capturedGen = generationRef.current;
    setBusy(true);
    setProblem("");
    try {
      const evaluation = await client.handoffImport({
        ...scope,
        destinationId: bundle.contextPackage.destinationId,
        humanConfirmed: true,
        contextPackage: bundle.contextPackage,
        ...(bundle.handoff ? { handoff: bundle.handoff } : {}),
      });
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setHandoffEval(evaluation);
    } catch (error) {
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setProblem(errorMessage(error));
    } finally {
      if (isCurrentRequest(capturedScopeKey, capturedGen)) setBusy(false);
    }
  }

  async function handleRunAuditedQuery(
    channel: "mcp_stdio" | "context_package",
  ) {
    if (!scope || !activeGrant || busy) return;
    const capturedScopeKey = scopeKey;
    const capturedGen = generationRef.current;
    setBusy(true);
    setProblem("");
    try {
      await client.queryRun({
        ...scope,
        grantId: activeGrant.grantId,
        sessionId: activeGrant.sessionId,
        manifestDigest: activeGrant.manifestDigest,
        policyVersion: activeGrant.policyVersion,
        destinationId: activeGrant.destinationId,
        channel,
        ...(activeGrant.destinationId === "codex_cli_workspace"
          ? { unconfinedConfirmed }
          : {}),
      });
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      await refreshGrantsAndAudits(scope, capturedScopeKey, capturedGen);
    } catch (error) {
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setProblem(errorMessage(error));
      await refreshGrantsAndAudits(scope, capturedScopeKey, capturedGen);
    } finally {
      if (isCurrentRequest(capturedScopeKey, capturedGen)) setBusy(false);
    }
  }

  async function handleReviewAudit(auditId: string) {
    if (!scope || busy) return;
    const capturedScopeKey = scopeKey;
    const capturedGen = generationRef.current;
    const draft = reviewDrafts[auditId] ?? {
      status: "approved" as const,
      reviewer: "Autor Local",
      note: "Citações verificadas no cockpit.",
      confirmed: false,
    };
    if (!draft.confirmed) {
      setProblem("Confirme explicitamente a revisão humana antes de salvar.");
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      await client.auditReview({
        ...scope,
        auditId,
        status: draft.status,
        reviewer: draft.reviewer,
        note: draft.note,
        humanConfirmed: draft.confirmed,
      });
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      await refreshGrantsAndAudits(scope, capturedScopeKey, capturedGen);
    } catch (error) {
      if (!isCurrentRequest(capturedScopeKey, capturedGen)) return;
      setProblem(errorMessage(error));
    } finally {
      if (isCurrentRequest(capturedScopeKey, capturedGen)) setBusy(false);
    }
  }

  if (!scope) {
    return (
      <section className="panel" aria-labelledby="f2-compiler-heading">
        <h3 id="f2-compiler-heading">Compilador de Contexto (F2)</h3>
        <p className="empty">
          Confirme o vínculo do checkout na Visão geral para compilar e
          autorizar contexto com escopo verificado.
        </p>
      </section>
    );
  }

  return (
    <section
      className="panel cockpit-stack"
      aria-labelledby="f2-compiler-heading"
    >
      <header className="section-heading">
        <div>
          <h3 id="f2-compiler-heading">
            Compilador de Contexto, MCP & Handoff (F2)
          </h3>
          <p className="context-muted">
            Projeto <strong>{projectName}</strong> · sessão{" "}
            <code>{sessionId}</code>
          </p>
        </div>
      </header>

      <form className="cockpit-form" onSubmit={(e) => void handleCompile(e)}>
        <div className="cockpit-field">
          <label htmlFor="f2-objective">Objetivo / pergunta</label>
          <textarea
            id="f2-objective"
            rows={2}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            required
          />
        </div>

        <div className="cockpit-header-meta">
          <div className="cockpit-field">
            <label htmlFor="f2-destination">Destino</label>
            <select
              id="f2-destination"
              value={destinationChoice}
              onChange={(e) => setDestinationChoice(e.target.value)}
            >
              <option value="local_preview">
                Preview local offline (sem envio externo)
              </option>
              <option value="codex_mock">Codex Mock (desenvolvimento)</option>
              <option value="codex_cli_workspace">
                Codex CLI · Workspace Dev (não isolado)
              </option>
              <option value="codex_cli_isolated">
                Codex CLI · Isolado verificado (bloqueado até F4-M02)
              </option>
              <option value="custom">Outro destino (testar bloqueio)</option>
            </select>
          </div>

          {destinationChoice === "custom" && (
            <div className="cockpit-field">
              <label htmlFor="f2-custom-dest">ID do destino desconhecido</label>
              <input
                id="f2-custom-dest"
                value={customDestination}
                onChange={(e) => setCustomDestination(e.target.value)}
              />
            </div>
          )}

          <div className="cockpit-field">
            <label htmlFor="f2-budget">Orçamento (bytes)</label>
            <input
              id="f2-budget"
              type="number"
              min={compilerMinBudgetBytes}
              max={compilerMaxBudgetBytes}
              value={budgetBytes}
              onChange={(e) =>
                setBudgetBytes(
                  Number.parseInt(e.target.value || "0", 10) ||
                    compilerMinBudgetBytes,
                )
              }
            />
          </div>
        </div>

        <div className="cockpit-actions">
          <button
            type="button"
            className="button"
            onClick={() => setBudgetBytes(512)}
          >
            512 B
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setBudgetBytes(4096)}
          >
            4 KiB
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setBudgetBytes(16384)}
          >
            16 KiB
          </button>
          {snapshot && snapshot.status !== "invalidated" && (
            <label className="cockpit-check">
              <input
                type="checkbox"
                checked={includeSnapshot}
                onChange={(e) => setIncludeSnapshot(e.target.checked)}
              />
              Incluir captura ativa ({snapshot.contextId.slice(0, 8)})
            </label>
          )}
        </div>

        <details>
          <summary>Preferências opcionais (projeto / perfil pessoal)</summary>
          <div className="cockpit-form">
            <div className="cockpit-header-meta">
              <div className="cockpit-field">
                <label htmlFor="f2-proj-key">Chave preferência projeto</label>
                <input
                  id="f2-proj-key"
                  placeholder="ex.: style-guide"
                  value={projectPrefKey}
                  onChange={(e) => setProjectPrefKey(e.target.value)}
                />
              </div>
              <div className="cockpit-field">
                <label htmlFor="f2-proj-val">Conteúdo projeto</label>
                <input
                  id="f2-proj-val"
                  value={projectPrefContent}
                  onChange={(e) => setProjectPrefContent(e.target.value)}
                />
              </div>
            </div>
            <div className="cockpit-header-meta">
              <div className="cockpit-field">
                <label htmlFor="f2-prof-key">Chave perfil pessoal</label>
                <input
                  id="f2-prof-key"
                  placeholder="ex.: response-lang"
                  value={personalPrefKey}
                  onChange={(e) => setPersonalPrefKey(e.target.value)}
                />
              </div>
              <div className="cockpit-field">
                <label htmlFor="f2-prof-val">Conteúdo perfil</label>
                <input
                  id="f2-prof-val"
                  value={personalPrefContent}
                  onChange={(e) => setPersonalPrefContent(e.target.value)}
                />
              </div>
            </div>
          </div>
        </details>

        <div className="cockpit-actions">
          <button type="submit" className="button primary" disabled={busy}>
            Compilar prévia local
          </button>
        </div>
      </form>

      {problem && (
        <p className="error-banner" role="alert">
          {problem}
        </p>
      )}

      {preview && (
        <div className="cockpit-evidence-box">
          <div className="cockpit-badges">
            <span
              className={`badge ${preview.publicManifest.status === "ready" ? "verified" : "error"}`}
            >
              {statusLabels[preview.publicManifest.status]}
            </span>
            <span
              className={`badge ${preview.destination.deliveryAllowed ? "verified" : "warning"}`}
            >
              {preview.destination.label}
            </span>
            <span className="badge">
              Política <code>{preview.publicManifest.policyVersion}</code>
            </span>
            <span className="badge">
              Estratégia <code>{preview.publicManifest.strategyVersion}</code>
            </span>
          </div>

          <p className="observed">
            Manifesto SHA-256 <code>{preview.manifestDigest}</code> ·{" "}
            {preview.publicManifest.budget.selectedBytes} /{" "}
            {preview.publicManifest.budget.limitBytes} B (~
            {preview.publicManifest.budget.estimatedTokens} tokens) ·
            Obrigatório: {preview.publicManifest.budget.mandatoryBytes} B
            {preview.publicManifest.budget.exceededByBytes > 0 &&
              ` · Excesso: ${preview.publicManifest.budget.exceededByBytes} B`}
          </p>

          {preview.destination.blockReason && (
            <p className="service-error">
              Bloqueio de destino:{" "}
              <code>{preview.destination.blockReason}</code>. Preview local
              disponível; envio/grant bloqueados.
            </p>
          )}

          {preview.publicManifest.conflicts.length > 0 && (
            <ul className="cockpit-conflicts">
              {preview.publicManifest.conflicts.map((conflict, idx) => (
                <li
                  key={`${conflict.kind}-${idx}`}
                  className={`cockpit-conflict-item ${conflict.blocking ? "blocking" : ""}`}
                >
                  <strong>{conflict.kind}</strong>: {conflict.summary}
                </li>
              ))}
            </ul>
          )}

          {preview.mandatoryOverflowItems.length > 0 && (
            <div>
              <strong>Itens obrigatórios acima do orçamento</strong>
              <ul className="context-list">
                {preview.mandatoryOverflowItems.map((item) => (
                  <li key={item.candidateId}>
                    <code>{item.title}</code> · {item.bytes} B · versão{" "}
                    <code>{item.version}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <strong>Itens selecionados ({preview.localItems.length})</strong>
            {preview.localItems.length === 0 ? (
              <p className="empty">Nenhum item entregável no manifesto.</p>
            ) : (
              <ul className="context-list">
                {preview.localItems.map((item) => (
                  <li key={item.opaqueRef}>
                    <code>{item.opaqueRef}</code> ·{" "}
                    <span className="badge">{tierLabels[item.tier]}</span> ·{" "}
                    {item.mandatory ? "obrigatório" : "opcional"} ·{" "}
                    <strong>{item.title}</strong> ({item.bytes} B ·{" "}
                    <code>{item.version}</code>)
                  </li>
                ))}
              </ul>
            )}
          </div>

          {preview.localOmissions.length > 0 && (
            <details>
              <summary>
                Omissões locais ({preview.localOmissions.length}) · divulgáveis
                no manifesto público:{" "}
                {preview.publicManifest.omissions
                  .filter((o) => o.disclosable)
                  .reduce((s, o) => s + o.count, 0)}
              </summary>
              <ul className="context-list">
                {preview.localOmissions.map((omission, idx) => (
                  <li key={`${omission.candidateId}-${idx}`}>
                    <code>{omission.reason}</code> ·{" "}
                    {omission.disclosable ? "divulgável" : "privado/omitido"} ·{" "}
                    {omission.title}: {omission.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {preview.publicManifest.status === "ready" &&
            preview.destination.deliveryAllowed && (
              <div className="cockpit-form">
                <strong>Autorização por sessão (SessionGrant)</strong>
                <label className="cockpit-check">
                  <input
                    type="checkbox"
                    checked={humanConfirmed}
                    onChange={(e) => setHumanConfirmed(e.target.checked)}
                  />
                  Confirmo emissão de SessionGrant restrito a este manifesto e
                  destino
                </label>
                {preview.destination.id === "codex_cli_workspace" && (
                  <label className="cockpit-check">
                    <input
                      type="checkbox"
                      checked={unconfinedConfirmed}
                      onChange={(e) => setUnconfinedConfirmed(e.target.checked)}
                    />
                    Modo Workspace Dev (não isolado): autorizo leitura apenas
                    com dados não sensíveis
                  </label>
                )}
                <div className="cockpit-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy || !humanConfirmed}
                    onClick={() => void handleIssueGrant()}
                  >
                    Emitir SessionGrant
                  </button>
                </div>
              </div>
            )}
        </div>
      )}

      {grants.length > 0 && (
        <div className="cockpit-evidence-box">
          <strong>Concessões deste escopo ({grants.length})</strong>
          <ul className="context-list">
            {grants.map((grant) => (
              <li key={grant.grantId} className="cockpit-actions">
                <span
                  className={`badge ${grant.status === "active" ? "verified" : "error"}`}
                >
                  {grant.status}
                </span>
                <code>{grant.grantId.slice(0, 8)}</code> ·{" "}
                <code>{grant.destinationId}</code> · expira{" "}
                <time dateTime={grant.expiresAt}>
                  {new Date(grant.expiresAt).toLocaleTimeString("pt-BR")}
                </time>
                {grant.status === "active" && (
                  <>
                    <button
                      type="button"
                      className="button"
                      onClick={() => setSelectedGrantId(grant.grantId)}
                    >
                      {selectedGrantId === grant.grantId
                        ? "Selecionado"
                        : "Selecionar"}
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => void handleRevokeGrant(grant.grantId)}
                    >
                      Revogar grant
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          {activeGrant && (
            <div className="cockpit-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void handleMcpSummary()}
              >
                Inspecionar via MCP (summary)
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void handleExportPackage()}
              >
                Exportar ContextPackage + Handoff
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => void handleRunAuditedQuery("mcp_stdio")}
              >
                Consultar via MCP stdio
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => void handleRunAuditedQuery("context_package")}
              >
                Consultar via ContextPackage
              </button>
            </div>
          )}
        </div>
      )}

      {mcpPreview && (
        <div className="cockpit-evidence-box">
          <strong>Resposta MCP (summary)</strong>
          <pre className="cockpit-excerpt">
            {JSON.stringify(mcpPreview.payload, null, 2)}
          </pre>
        </div>
      )}

      {bundle && (
        <div className="cockpit-evidence-box">
          <strong>ContextPackage & Handoff exportados</strong>
          <p className="observed">
            Pacote SHA-256 <code>{bundle.contextPackage.packageDigest}</code> ·{" "}
            {bundle.contextPackage.items.length} itens
            {bundle.handoff &&
              ` · Handoff ${bundle.handoff.handoffId.slice(0, 8)} (requiresReevaluation: ${String(bundle.handoff.requiresReevaluation)})`}
          </p>
          <div className="cockpit-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void handleReevaluateHandoff()}
            >
              Reavaliar Handoff no escopo
            </button>
          </div>
          {handoffEval && (
            <p className="observed">
              Avaliação: <code>{handoffEval.evaluation}</code> ·{" "}
              {handoffEval.reason} (
              <code>
                requiresNewGrant={String(handoffEval.requiresNewGrant)}
              </code>
              )
            </p>
          )}
        </div>
      )}

      {audits.length > 0 && (
        <div className="cockpit-evidence-box">
          <strong>
            Trilha auditada e comparação de canais ({audits.length})
          </strong>
          <ul className="cockpit-conflicts">
            {audits.map((audit) => {
              const draft = reviewDrafts[audit.auditId] ?? {
                status: "approved" as const,
                reviewer: "Autor Local",
                note: "Citações verificadas.",
                confirmed: false,
              };
              return (
                <li key={audit.auditId} className="cockpit-conflict-item">
                  <div className="cockpit-badges">
                    <span className="badge">{audit.channel}</span>
                    <span className="badge">{modeLabels[audit.mode]}</span>
                    <span
                      className={`badge ${audit.state === "completed" ? "verified" : "error"}`}
                    >
                      {audit.state}
                      {audit.failureCode ? ` (${audit.failureCode})` : ""}
                    </span>
                    <span className="badge">
                      MCP: <code>{audit.mcpAdherence}</code> (
                      {audit.observedReads.length} leituras)
                    </span>
                  </div>
                  <p className="observed">
                    Entregue: <code>{audit.delivered.digest.slice(0, 12)}</code>{" "}
                    · {audit.delivered.bytes} B · refs:{" "}
                    {audit.delivered.opaqueRefs.join(", ") || "nenhuma"}
                  </p>
                  {audit.responseText && (
                    <pre className="cockpit-excerpt">{audit.responseText}</pre>
                  )}
                  <p className="observed">
                    Citações verificadas:{" "}
                    {audit.citations.declared
                      .map(
                        (c) =>
                          `${c.opaqueRef} (${c.verified ? "verificada" : "falhou"})`,
                      )
                      .join(", ") || "nenhuma"}{" "}
                    · Revisão: <code>{audit.review.status}</code>
                    {audit.review.note ? ` — ${audit.review.note}` : ""}
                  </p>
                  {audit.review.status === "pending" && (
                    <div className="cockpit-actions">
                      <select
                        aria-label="Decisão da revisão"
                        value={draft.status}
                        onChange={(e) =>
                          setReviewDrafts((prev) => ({
                            ...prev,
                            [audit.auditId]: {
                              ...draft,
                              status: e.target.value as Exclude<
                                AuditReviewStatus,
                                "pending"
                              >,
                            },
                          }))
                        }
                      >
                        <option value="approved">Aprovar</option>
                        <option value="rejected">Rejeitar</option>
                        <option value="needs_followup">
                          Necessita acompanhamento
                        </option>
                      </select>
                      <input
                        aria-label="Nota da revisão"
                        value={draft.note}
                        onChange={(e) =>
                          setReviewDrafts((prev) => ({
                            ...prev,
                            [audit.auditId]: {
                              ...draft,
                              note: e.target.value,
                            },
                          }))
                        }
                      />
                      <label className="context-checkbox">
                        <input
                          type="checkbox"
                          checked={draft.confirmed}
                          onChange={(e) =>
                            setReviewDrafts((prev) => ({
                              ...prev,
                              [audit.auditId]: {
                                ...draft,
                                confirmed: e.target.checked,
                              },
                            }))
                          }
                        />{" "}
                        Confirmo revisão humana
                      </label>
                      <button
                        type="button"
                        className="button"
                        disabled={busy || !draft.confirmed}
                        onClick={() => void handleReviewAudit(audit.auditId)}
                      >
                        Salvar revisão humana
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
