import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BoundaryStatusResult,
  ExecutionDiffResult,
  GitPlanRecord,
  IdentityScope,
  OperationEffect,
  OperationGrantRecord,
  PlannerBackendMode,
  PlannerExploreResult,
  PlannerOperationKind,
  PreFlightCheckResult,
  SupervisedExecutionEventsResult,
  SupervisedExecutionRecord,
  VerifierDefinitionRecord,
  VerifierPrivilegeProfile,
  VerifierRunRecord,
} from "@laplace/contracts";
import type { createDesktopClient } from "./ipc";
import { errorMessage } from "./ipc";

type PlannerClient = ReturnType<typeof createDesktopClient>["planner"];

export function PlannerSupervisionView({
  projectName,
  scope,
  client,
}: {
  projectId: string;
  projectName: string;
  scope: IdentityScope | null;
  client: PlannerClient;
}) {
  const scopeKey = scope
    ? `${scope.projectId}:${scope.bindingId}:${scope.worktreeId}`
    : null;
  const activeScopeKeyRef = useRef<string | null>(scopeKey);
  activeScopeKeyRef.current = scopeKey;
  const generationRef = useRef(0);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [boundary, setBoundary] = useState<BoundaryStatusResult | null>(null);
  const [exploration, setExploration] = useState<PlannerExploreResult | null>(
    null,
  );
  const [plans, setPlans] = useState<GitPlanRecord[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreFlightCheckResult | null>(null);
  const [grants, setGrants] = useState<OperationGrantRecord[]>([]);
  const [executions, setExecutions] = useState<SupervisedExecutionRecord[]>([]);
  const [eventsView, setEventsView] =
    useState<SupervisedExecutionEventsResult | null>(null);
  const [diffView, setDiffView] = useState<ExecutionDiffResult | null>(null);
  const [verifiers, setVerifiers] = useState<VerifierDefinitionRecord[]>([]);
  const [verifierRuns, setVerifierRuns] = useState<VerifierRunRecord[]>([]);

  // Plan builder state
  const [planTitle, setPlanTitle] = useState("");
  const [planObjective, setPlanObjective] = useState("");
  const [operationKind, setOperationKind] =
    useState<PlannerOperationKind>("worktree_edit");
  const [backendMode, setBackendMode] =
    useState<PlannerBackendMode>("mock_supervised");
  const [targetPathsText, setTargetPathsText] = useState("README.md");
  const [targetBranch, setTargetBranch] = useState("");
  const [proposedContent, setProposedContent] = useState("");
  const [sessionGrantId, setSessionGrantId] = useState("");

  // Review / Apply controls (distinct human confirmations)
  const [reviewer, setReviewer] = useState("operador");
  const [reviewNote, setReviewNote] = useState("");
  const [applyConfirmed, setApplyConfirmed] = useState(false);

  // Verifier form state
  const [verId, setVerId] = useState("verif-local");
  const [verLabel, setVerLabel] = useState("Verificador local");
  const [verArgvText, setVerArgvText] = useState("node --version");
  const [verCwdRelative, setVerCwdRelative] = useState(".");
  const [verEnvWhitelist, setVerEnvWhitelist] = useState("NODE_ENV");
  const [verTimeoutMs, setVerTimeoutMs] = useState(15_000);
  const [verProfile, setVerProfile] =
    useState<VerifierPrivilegeProfile>("readonly_check");

  const isCurrent = (expectedKey: string | null, expectedGen: number) =>
    activeScopeKeyRef.current === expectedKey &&
    generationRef.current === expectedGen;

  const refreshAll = useCallback(
    async (
      targetScope: IdentityScope,
      expectedKey: string,
      expectedGen: number,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const [bStatus, pList, gList, eList, vList] = await Promise.all([
          client.boundaryStatus(targetScope),
          client.planList(targetScope),
          client.grantList(targetScope),
          client.executionList(targetScope),
          client.verifierList(targetScope),
        ]);
        if (!isCurrent(expectedKey, expectedGen)) return;
        setBoundary(bStatus);
        setPlans(pList.items);
        setSelectedPlanId((prev) =>
          prev && pList.items.some((p) => p.planId === prev)
            ? prev
            : (pList.items[0]?.planId ?? null),
        );
        setGrants(gList.items);
        setExecutions(eList.items);
        setVerifiers(vList.items);
        setVerifierRuns(vList.runs);
      } catch (err) {
        if (isCurrent(expectedKey, expectedGen)) {
          setError(errorMessage(err));
        }
      } finally {
        if (isCurrent(expectedKey, expectedGen)) {
          setBusy(false);
        }
      }
    },
    [client],
  );

  useEffect(() => {
    generationRef.current += 1;
    const currentGen = generationRef.current;
    setError(null);
    setNotice(null);
    setBoundary(null);
    setExploration(null);
    setPlans([]);
    setSelectedPlanId(null);
    setPreflight(null);
    setGrants([]);
    setExecutions([]);
    setEventsView(null);
    setDiffView(null);
    setVerifiers([]);
    setVerifierRuns([]);
    setApplyConfirmed(false);

    if (scope && scopeKey) {
      void refreshAll(scope, scopeKey, currentGen);
    }
  }, [scopeKey, scope, refreshAll]);

  if (!scope || !scopeKey) {
    return (
      <section className="dashboard-panel" aria-live="polite">
        <header className="dashboard-heading">
          <h2>Supervisão e Planejador Git</h2>
        </header>
        <p className="muted">
          Selecione e verifique a identidade do projeto {projectName} antes de
          abrir o planejador, concessões de operação ou verificadores.
        </p>
      </section>
    );
  }

  const activeScope = scope;
  const activeKey = scopeKey;
  const selectedPlan = plans.find((p) => p.planId === selectedPlanId) ?? null;

  async function runScoped(action: (gen: number) => Promise<void>) {
    const gen = generationRef.current;
    const key = activeKey;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action(gen);
    } catch (err) {
      if (isCurrent(key, gen)) setError(errorMessage(err));
    } finally {
      if (isCurrent(key, gen)) setBusy(false);
    }
  }

  async function handleExplore(gen: number) {
    const res = await client.explore({ ...activeScope });
    if (!isCurrent(activeKey, gen)) return;
    setExploration(res);
    setNotice("Estado Git observado de forma passiva.");
  }

  async function handlePlanCreate(gen: number) {
    const paths = targetPathsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const edits =
      proposedContent && paths[0]
        ? [
            {
              path: paths[0],
              action: "modify" as const,
              content: proposedContent,
            },
          ]
        : undefined;
    const created = await client.planCreate({
      ...activeScope,
      requestId: crypto.randomUUID(),
      title: planTitle.trim() || "Plano supervisionado",
      objective:
        planObjective.trim() ||
        "Executar alteração isolada em worktree dedicada",
      operationKind,
      backendMode,
      targetBranch: targetBranch.trim() || null,
      targetPaths: paths.length > 0 ? paths : ["README.md"],
      ...(edits ? { proposedEdits: edits } : {}),
      ...(sessionGrantId.trim()
        ? { sessionGrantId: sessionGrantId.trim() }
        : {}),
    });
    if (!isCurrent(activeKey, gen)) return;
    setSelectedPlanId(created.planId);
    setNotice(
      `Plano criado (${created.riskLevel}, pre-flight: ${created.preflightStatus}).`,
    );
    await refreshAll(activeScope, activeKey, gen);
  }

  async function handlePreflight(planId: string, gen: number) {
    const res = await client.planPreflight({ ...activeScope, planId });
    if (!isCurrent(activeKey, gen)) return;
    setPreflight(res);
    setNotice(`Pre-Flight: ${res.status}`);
    await refreshAll(activeScope, activeKey, gen);
  }

  async function handleIssueGrant(plan: GitPlanRecord, gen: number) {
    const effects: OperationEffect[] = [
      "create_worktree",
      "write_worktree",
      "run_agent",
      "run_verifier",
      "apply_local",
    ];
    await client.grantIssue({
      ...activeScope,
      planId: plan.planId,
      expectedBaseDigest: plan.baseDigest,
      backendMode: plan.backendMode,
      allowedEffects: effects,
      humanConfirmed: true,
    });
    if (!isCurrent(activeKey, gen)) return;
    setNotice("OperationGrant emitido com confirmação humana.");
    await refreshAll(activeScope, activeKey, gen);
  }

  async function handleStartExecution(
    plan: GitPlanRecord,
    grant: OperationGrantRecord,
    gen: number,
  ) {
    const exec = await client.executionStart({
      ...activeScope,
      requestId: crypto.randomUUID(),
      planId: plan.planId,
      grantId: grant.grantId,
      expectedBaseDigest: plan.baseDigest,
      ...(plan.backendMode === "mock_supervised"
        ? { mockBehavior: "complete" as const }
        : {}),
      ...(plan.sessionGrantId ? { sessionGrantId: plan.sessionGrantId } : {}),
    });
    if (!isCurrent(activeKey, gen)) return;
    setNotice(`Execução iniciada em ${exec.dedicatedRoot}.`);
    await refreshAll(activeScope, activeKey, gen);
  }

  async function handleReview(choice: "approved" | "rejected", gen: number) {
    if (!diffView) return;
    const rev = diffView.latestReview?.revision ?? 0;
    await client.diffReview({
      ...activeScope,
      requestId: crypto.randomUUID(),
      executionId: diffView.executionId,
      expectedDiffDigest: diffView.diffDigest,
      expectedRevision: rev,
      choice,
      reviewer: reviewer.trim() || "operador",
      note: reviewNote.trim() || `Revisão ${choice}`,
      humanConfirmed: true,
    });
    if (!isCurrent(activeKey, gen)) return;
    const updated = await client.diffGet(activeScope, diffView.executionId);
    if (!isCurrent(activeKey, gen)) return;
    setDiffView(updated);
    setNotice(`Revisão registrada (${choice}, aplicado localmente: não).`);
  }

  async function handleApplyLocal(gen: number) {
    if (!diffView || !applyConfirmed) return;
    const exec = executions.find((e) => e.executionId === diffView.executionId);
    if (!exec) return;
    const applied = await client.applyLocal({
      ...activeScope,
      requestId: crypto.randomUUID(),
      executionId: diffView.executionId,
      grantId: exec.grantId,
      expectedDiffDigest: diffView.diffDigest,
      applyConfirmed: true,
    });
    if (!isCurrent(activeKey, gen)) return;
    setApplyConfirmed(false);
    setNotice(
      `Aplicação local concluída (${applied.appliedPaths.length} arquivo(s), overlay backup: ${applied.backupOverlayId ?? "n/d"}).`,
    );
    const updated = await client.diffGet(activeScope, diffView.executionId);
    if (!isCurrent(activeKey, gen)) return;
    setDiffView(updated);
  }

  async function handleDefineVerifier(gen: number) {
    const argv = verArgvText.trim().split(/\s+/).filter(Boolean);
    const envList = verEnvWhitelist
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const def = await client.verifierDefine({
      ...activeScope,
      definitionId: verId.trim(),
      label: verLabel.trim(),
      argv,
      cwdRelative: verCwdRelative.trim() || ".",
      envWhitelist: envList,
      timeoutMs: Number(verTimeoutMs) || 15_000,
      privilegeProfile: verProfile,
    });
    if (!isCurrent(activeKey, gen)) return;
    setNotice(
      `Verificador salvo (${def.approvalStatus}, digest ${def.definitionDigest.slice(0, 12)}).`,
    );
    await refreshAll(activeScope, activeKey, gen);
  }

  return (
    <div className="workspace-flow" aria-busy={busy || undefined}>
      {error && (
        <div className="error-banner" role="alert">
          <strong>{error}</strong>
        </div>
      )}
      {notice && (
        <p className="panel" role="status">
          {notice}
        </p>
      )}

      <section className="dashboard-panel">
        <header className="dashboard-heading">
          <h2>Fronteira de Isolamento &amp; LPAC (INV-07)</h2>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void runScoped((gen) => refreshAll(activeScope, activeKey, gen))
            }
          >
            Atualizar estado
          </button>
        </header>
        {boundary && (
          <div>
            <p>
              <strong>LPAC estrito:</strong>{" "}
              {boundary.lpacVerified ? "Verificado" : "Bloqueado"} ·{" "}
              <code>{boundary.lpacDetail}</code>
            </p>
            <p className="muted">
              Helper nativo (`laplace-codex-job`):{" "}
              {boundary.supervisionHelperAvailable ? "Disponível" : "Ausente"}
            </p>
            <ul>
              {boundary.backends.map((b) => (
                <li key={b.mode}>
                  <code>{b.mode}</code> —{" "}
                  {b.available ? "disponível" : "bloqueado"}
                  {b.blockedReason ? ` (${b.blockedReason})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="dashboard-panel">
        <header className="dashboard-heading">
          <h2>Planejador Git &amp; Pre-Flight (F4-M01)</h2>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void runScoped(handleExplore)}
          >
            Explorar Checkout (Read-Only)
          </button>
        </header>
        {exploration && (
          <div className="panel">
            <p>
              <strong>HEAD:</strong>{" "}
              <code>{exploration.base.head ?? "(unborn)"}</code> ·{" "}
              <strong>Branch:</strong>{" "}
              <code>{exploration.base.branch ?? "(detached)"}</code> ·{" "}
              <strong>Worktrees dedicadas ativas:</strong>{" "}
              {exploration.dedicatedWorktreeCount}
            </p>
            <p className="muted">
              Sujos: {exploration.dirtyPaths.length} · Conflitos:{" "}
              {exploration.conflictedPaths.length}
            </p>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runScoped(handlePlanCreate);
          }}
        >
          <div className="field-group">
            <label>
              Título do plano
              <input
                value={planTitle}
                onChange={(e) => setPlanTitle(e.target.value)}
                placeholder="Ex.: Atualizar documentação F4"
              />
            </label>
            <label>
              Objetivo
              <input
                value={planObjective}
                onChange={(e) => setPlanObjective(e.target.value)}
                placeholder="Descrição da operação isolada"
              />
            </label>
            <label>
              Tipo de operação
              <select
                value={operationKind}
                onChange={(e) =>
                  setOperationKind(e.target.value as PlannerOperationKind)
                }
              >
                <option value="worktree_edit">worktree_edit</option>
                <option value="branch_patch">branch_patch</option>
                <option value="agent_supervised">agent_supervised</option>
                <option value="verifier_only">verifier_only</option>
              </select>
            </label>
            <label>
              Backend
              <select
                value={backendMode}
                onChange={(e) =>
                  setBackendMode(e.target.value as PlannerBackendMode)
                }
              >
                <option value="mock_supervised">mock_supervised</option>
                <option value="local_process_job">local_process_job</option>
                <option value="codex_cli_workspace">codex_cli_workspace</option>
                <option value="codex_cli_isolated">
                  codex_cli_isolated (bloqueado)
                </option>
              </select>
            </label>
            <label>
              Caminhos alvo (vírgula)
              <input
                value={targetPathsText}
                onChange={(e) => setTargetPathsText(e.target.value)}
              />
            </label>
            <label>
              Branch alvo (opcional)
              <input
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
              />
            </label>
            <label>
              Conteúdo simulado (opcional)
              <textarea
                rows={2}
                value={proposedContent}
                onChange={(e) => setProposedContent(e.target.value)}
              />
            </label>
            <label>
              SessionGrant F2 (para Codex)
              <input
                value={sessionGrantId}
                onChange={(e) => setSessionGrantId(e.target.value)}
              />
            </label>
          </div>
          <button type="submit" className="button primary" disabled={busy}>
            Simular &amp; Criar Plano
          </button>
        </form>

        {selectedPlan && (
          <div className="panel">
            <p>
              <strong>Plano selecionado:</strong> {selectedPlan.title} ·{" "}
              <code>{selectedPlan.backendMode}</code> · risco{" "}
              <strong>{selectedPlan.riskLevel}</strong> · preflight:{" "}
              <code>{selectedPlan.preflightStatus}</code>
            </p>
            <div className="work-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() =>
                  void runScoped((gen) =>
                    handlePreflight(selectedPlan.planId, gen),
                  )
                }
              >
                Verificar Pre-Flight
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || selectedPlan.status !== "ready"}
                onClick={() =>
                  void runScoped((gen) => handleIssueGrant(selectedPlan, gen))
                }
              >
                Emitir OperationGrant (Confirmado)
              </button>
            </div>
            {preflight && preflight.planId === selectedPlan.planId && (
              <p>
                <strong>Resultado Pre-Flight:</strong>{" "}
                <code>{preflight.status}</code> · drift:{" "}
                {preflight.driftDetected
                  ? preflight.driftReasons.join(", ")
                  : "nenhum"}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="dashboard-panel">
        <header className="dashboard-heading">
          <h2>Central de Agentes &amp; Worktrees Dedicadas (F4-M02)</h2>
        </header>
        {selectedPlan && (
          <div className="work-actions">
            {grants
              .filter(
                (g) =>
                  g.planId === selectedPlan.planId && g.status === "active",
              )
              .map((grant) => (
                <div key={grant.grantId} className="work-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void runScoped((gen) =>
                        handleStartExecution(selectedPlan, grant, gen),
                      )
                    }
                  >
                    Executar com Grant {grant.grantId.slice(0, 8)}
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void runScoped(async (gen) => {
                        await client.grantRevoke({
                          ...activeScope,
                          grantId: grant.grantId,
                          reason: "Revogado pelo operador na UI",
                        });
                        await refreshAll(activeScope, activeKey, gen);
                      })
                    }
                  >
                    Revogar Grant
                  </button>
                </div>
              ))}
          </div>
        )}

        <ul>
          {executions.map((exec) => (
            <li key={exec.executionId} className="panel">
              <p>
                <code>{exec.executionId.slice(0, 8)}</code> ·{" "}
                <strong>{exec.state}</strong> · <code>{exec.backendMode}</code>{" "}
                · worktree <code>{exec.worktreeStatus}</code>
                {exec.recoveredAfterRestart
                  ? " (recuperado após reinício)"
                  : ""}
              </p>
              <div className="work-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void runScoped(async (gen) => {
                      const ev = await client.executionEvents(
                        activeScope,
                        exec.executionId,
                        0,
                      );
                      if (isCurrent(activeKey, gen)) setEventsView(ev);
                    })
                  }
                >
                  Eventos
                </button>
                {(exec.state === "running" || exec.state === "cancelling") && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void runScoped(async (gen) => {
                        await client.executionCancel({
                          ...activeScope,
                          executionId: exec.executionId,
                          humanConfirmed: true,
                        });
                        await refreshAll(activeScope, activeKey, gen);
                      })
                    }
                  >
                    Cancelar árvore
                  </button>
                )}
                {exec.diffDigest && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void runScoped(async (gen) => {
                        const df = await client.diffGet(
                          activeScope,
                          exec.executionId,
                        );
                        if (isCurrent(activeKey, gen)) setDiffView(df);
                      })
                    }
                  >
                    Inspecionar Diff
                  </button>
                )}
                {exec.worktreeStatus !== "cleaned" &&
                  exec.state !== "running" &&
                  exec.state !== "cancelling" && (
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void runScoped(async (gen) => {
                          await client.worktreeCleanup({
                            ...activeScope,
                            executionId: exec.executionId,
                            humanConfirmed: true,
                          });
                          await refreshAll(activeScope, activeKey, gen);
                        })
                      }
                    >
                      Limpar worktree
                    </button>
                  )}
              </div>
            </li>
          ))}
        </ul>

        {eventsView && (
          <div className="panel">
            <strong>
              Eventos ({eventsView.execution.executionId.slice(0, 8)}):
            </strong>
            <ul>
              {eventsView.events.map((ev) => (
                <li key={ev.seq}>
                  #{ev.seq} [{ev.type}] {ev.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {diffView && (
        <section className="dashboard-panel">
          <header className="dashboard-heading">
            <h2>Revisão de Diff &amp; Aplicação Local OCC (F4-M03)</h2>
          </header>
          <p>
            <strong>SHA-256 Diff:</strong> <code>{diffView.diffDigest}</code> ·{" "}
            <strong>Revisão atual:</strong>{" "}
            {diffView.latestReview
              ? `${diffView.latestReview.choice} (rev ${diffView.latestReview.revision})`
              : "pendente"}
          </p>
          <ul>
            {diffView.files.map((f) => (
              <li key={f.path}>
                <code>{f.action}</code> <code>{f.path}</code> (
                {f.afterBytes ?? 0} bytes, {f.afterCrlf ? "CRLF" : "LF"})
              </li>
            ))}
          </ul>
          <div className="field-group">
            <label>
              Revisor
              <input
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
              />
            </label>
            <label>
              Nota de revisão
              <input
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
            </label>
          </div>
          <div className="work-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() =>
                void runScoped((gen) => handleReview("approved", gen))
              }
            >
              Aprovar Diff (sem aplicar)
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void runScoped((gen) => handleReview("rejected", gen))
              }
            >
              Recusar Diff
            </button>
          </div>
          <div className="panel">
            <label>
              <input
                type="checkbox"
                checked={applyConfirmed}
                onChange={(e) => setApplyConfirmed(e.target.checked)}
              />{" "}
              Confirmo captura de DirtyOverlay preventivo e aplicação local OCC
              na worktree de origem
            </label>
            <button
              type="button"
              className="button primary"
              disabled={
                busy ||
                !applyConfirmed ||
                diffView.latestReview?.choice !== "approved"
              }
              onClick={() => void runScoped(handleApplyLocal)}
            >
              Aplicar Localmente (OCC)
            </button>
            {diffView.latestApply && (
              <p className="muted">
                Última aplicação: <code>{diffView.latestApply.status}</code> ·{" "}
                backup overlay{" "}
                <code>{diffView.latestApply.backupOverlayId ?? "n/d"}</code>
              </p>
            )}
          </div>
        </section>
      )}

      <section className="dashboard-panel">
        <header className="dashboard-heading">
          <h2>Verificadores Executáveis Assinados por Digest (F4-M03.A3)</h2>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runScoped(handleDefineVerifier);
          }}
        >
          <div className="field-group">
            <label>
              ID
              <input value={verId} onChange={(e) => setVerId(e.target.value)} />
            </label>
            <label>
              Rótulo
              <input
                value={verLabel}
                onChange={(e) => setVerLabel(e.target.value)}
              />
            </label>
            <label>
              Comando (argv)
              <input
                value={verArgvText}
                onChange={(e) => setVerArgvText(e.target.value)}
              />
            </label>
            <label>
              CWD relativo
              <input
                value={verCwdRelative}
                onChange={(e) => setVerCwdRelative(e.target.value)}
              />
            </label>
            <label>
              Env whitelist
              <input
                value={verEnvWhitelist}
                onChange={(e) => setVerEnvWhitelist(e.target.value)}
              />
            </label>
            <label>
              Timeout (ms)
              <input
                type="number"
                value={verTimeoutMs}
                onChange={(e) => setVerTimeoutMs(Number(e.target.value))}
              />
            </label>
            <label>
              Perfil de privilégio
              <select
                value={verProfile}
                onChange={(e) =>
                  setVerProfile(e.target.value as VerifierPrivilegeProfile)
                }
              >
                <option value="readonly_check">readonly_check</option>
                <option value="workspace_build_test">
                  workspace_build_test
                </option>
                <option value="isolated_probe">
                  isolated_probe (bloqueado)
                </option>
              </select>
            </label>
          </div>
          <button type="submit" className="button primary" disabled={busy}>
            Definir / Atualizar Verificador
          </button>
        </form>

        <ul>
          {verifiers.map((v) => (
            <li key={v.definitionId} className="panel">
              <p>
                <strong>{v.label}</strong> (<code>{v.definitionId}</code>) ·{" "}
                status: <code>{v.approvalStatus}</code> · digest:{" "}
                <code>{v.definitionDigest.slice(0, 12)}</code>
              </p>
              <div className="work-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void runScoped(async (gen) => {
                      await client.verifierApprove({
                        ...activeScope,
                        definitionId: v.definitionId,
                        expectedDefinitionDigest: v.definitionDigest,
                        reviewer: reviewer.trim() || "operador",
                        humanConfirmed: true,
                      });
                      await refreshAll(activeScope, activeKey, gen);
                    })
                  }
                >
                  Aprovar tupla exata
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || v.approvalStatus !== "approved"}
                  onClick={() =>
                    void runScoped(async (gen) => {
                      const run = await client.verifierRun({
                        ...activeScope,
                        requestId: crypto.randomUUID(),
                        definitionId: v.definitionId,
                        expectedDefinitionDigest: v.definitionDigest,
                      });
                      if (!isCurrent(activeKey, gen)) return;
                      setNotice(
                        `Verificador terminou: ${run.state} (exit=${run.exitCode ?? "null"}).`,
                      );
                      await refreshAll(activeScope, activeKey, gen);
                    })
                  }
                >
                  Executar Verificador
                </button>
              </div>
            </li>
          ))}
        </ul>

        {verifierRuns.length > 0 && (
          <div className="panel">
            <strong>Execuções recentes de verificadores:</strong>
            <ul>
              {verifierRuns.map((r) => (
                <li key={r.runId}>
                  <code>{r.definitionId}</code> · {r.state} (exit=
                  {r.exitCode ?? "null"}, {r.durationMs}ms)
                  {r.stdoutExcerpt ? <pre>{r.stdoutExcerpt}</pre> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
