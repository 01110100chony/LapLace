import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdaptiveStrategyStatusResult,
  ArenaReviewOutcome,
  ArenaSessionRecord,
  BkmCategory,
  BkmHypothesisRecord,
  BkmHypothesisState,
  IdentityScope,
  PlannerBackendMode,
  ProactiveScheduleListResult,
  ProactivitySuggestionListResult,
  ReplayDeliveryDetail,
  ReplayDiffResult,
  ReplayQueryResult,
} from "@laplace/contracts";
import type { createDesktopClient } from "./ipc";
import { errorMessage } from "./ipc";

type IntelligenceClient = ReturnType<
  typeof createDesktopClient
>["intelligence"];
type IntelligenceTab = "arena" | "replay" | "learning" | "proactivity";

function nextClientRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function IntelligenceView({
  projectName,
  scope,
  client,
}: {
  projectId: string;
  projectName: string;
  scope: IdentityScope | null;
  client: IntelligenceClient;
}) {
  const scopeKey = scope
    ? `${scope.projectId}:${scope.bindingId}:${scope.worktreeId}`
    : null;
  const activeScopeKeyRef = useRef<string | null>(scopeKey);
  activeScopeKeyRef.current = scopeKey;
  const generationRef = useRef(0);

  const [tab, setTab] = useState<IntelligenceTab>("arena");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Arena state (F5-M01)
  const [sessions, setSessions] = useState<ArenaSessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [arenaTitle, setArenaTitle] = useState("Comparativo F5");
  const [arenaObjective, setArenaObjective] = useState(
    "Avaliar hipoteses paralelas a partir da mesma base Git",
  );
  const [arenaBackend, setArenaBackend] =
    useState<PlannerBackendMode>("mock_supervised");
  const [hypALabel, setHypALabel] = useState("Hipotese A");
  const [hypAPath, setHypAPath] = useState("hyp-a.txt");
  const [hypAContent, setHypAContent] = useState("Implementacao A\n");
  const [hypBLabel, setHypBLabel] = useState("Hipotese B");
  const [hypBPath, setHypBPath] = useState("hyp-b.txt");
  const [hypBContent, setHypBContent] = useState("Implementacao B\n");
  const [arenaConfirmed, setArenaConfirmed] = useState(false);

  const [reviewOutcome, setReviewOutcome] =
    useState<ArenaReviewOutcome>("winner_selected");
  const [winnerId, setWinnerId] = useState<string>("");
  const [reviewerName, setReviewerName] = useState("operador");
  const [reviewRationale, setReviewRationale] = useState("");
  const [scoreA, setScoreA] = useState(5);
  const [scoreB, setScoreB] = useState(4);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  // Replay state (F5-M02)
  const [validAt, setValidAt] = useState(() => new Date().toISOString());
  const [knownAt, setKnownAt] = useState(() => new Date().toISOString());
  const [pointBValidAt, setPointBValidAt] = useState(() =>
    new Date().toISOString(),
  );
  const [pointBKnownAt, setPointBKnownAt] = useState(() =>
    new Date().toISOString(),
  );
  const [replayResult, setReplayResult] = useState<ReplayQueryResult | null>(
    null,
  );
  const [replayDiff, setReplayDiff] = useState<ReplayDiffResult | null>(null);
  const [deliveryDetail, setDeliveryDetail] =
    useState<ReplayDeliveryDetail | null>(null);

  // Learning state (F5-M03)
  const [bkmList, setBkmList] = useState<BkmHypothesisRecord[]>([]);
  const [strategyStatus, setStrategyStatus] =
    useState<AdaptiveStrategyStatusResult | null>(null);
  const [bkmGroup, setBkmGroup] = useState("retrieval-policy");
  const [bkmCategory, setBkmCategory] =
    useState<BkmCategory>("retrieval_boost");
  const [bkmTitle, setBkmTitle] = useState("Priorizar evidencias recentes");
  const [bkmStatement, setBkmStatement] = useState(
    "Reforcar itens canonicos e vigentes alinhados aos termos da consulta.",
  );
  const [bkmKeywords, setBkmKeywords] = useState("token, contrato");
  const [bkmPaths, setBkmPaths] = useState("docs/");
  const [bkmOriginKey, setBkmOriginKey] = useState("origin-manual-1");
  const [bkmNote, setBkmNote] = useState("Evidencia local verificada");
  const [bkmTransitionConfirmed, setBkmTransitionConfirmed] = useState(false);
  const [adaptiveConfirmed, setAdaptiveConfirmed] = useState(false);

  // Proactivity state (F5-M04)
  const [proactSuggestions, setProactSuggestions] =
    useState<ProactivitySuggestionListResult | null>(null);
  const [proactSchedules, setProactSchedules] =
    useState<ProactiveScheduleListResult | null>(null);
  const [schedLabel, setSchedLabel] = useState("Janela assistiva opt-in");
  const [schedStartUtc, setSchedStartUtc] = useState("08:00");
  const [schedEndUtc, setSchedEndUtc] = useState("20:00");
  const [schedIntervalMin, setSchedIntervalMin] = useState(30);
  const [schedOptIn, setSchedOptIn] = useState(false);

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
        const [arenaRes, bkmRes, stratRes, sugRes, schedRes] =
          await Promise.all([
            client.arena.sessionList(targetScope),
            client.learning.hypothesisList(targetScope),
            client.learning.strategyStatus(targetScope),
            client.proactivity.suggestionList(targetScope),
            client.proactivity.scheduleList(targetScope),
          ]);
        if (!isCurrent(expectedKey, expectedGen)) return;
        setSessions(arenaRes.items);
        setSelectedSessionId((prev) =>
          prev && arenaRes.items.some((s) => s.sessionId === prev)
            ? prev
            : (arenaRes.items[0]?.sessionId ?? null),
        );
        setBkmList(bkmRes.items);
        setStrategyStatus(stratRes);
        setProactSuggestions(sugRes);
        setProactSchedules(schedRes);
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
    const gen = generationRef.current;
    setSessions([]);
    setSelectedSessionId(null);
    setReplayResult(null);
    setReplayDiff(null);
    setDeliveryDetail(null);
    setBkmList([]);
    setStrategyStatus(null);
    setProactSuggestions(null);
    setProactSchedules(null);
    setError(null);
    setNotice(null);

    if (!scope || !scopeKey) return;
    void refreshAll(scope, scopeKey, gen);
  }, [scope, scopeKey, refreshAll]);

  if (!scope || !scopeKey) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Escopo pendente (INV-01)</div>
        <p className="empty-state-detail">
          Confirme a identidade Git de {projectName} antes de usar Arena, Replay
          bitemporal, BKM simbólico ou Proatividade graduada.
        </p>
      </div>
    );
  }

  const activeScope = scope;
  const activeKey = scopeKey;

  async function runScoped(fn: (gen: number) => Promise<void>) {
    const gen = ++generationRef.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn(gen);
    } catch (err) {
      if (isCurrent(activeKey, gen)) {
        setError(errorMessage(err));
      }
    } finally {
      if (isCurrent(activeKey, gen)) {
        setBusy(false);
      }
    }
  }

  const selectedSession =
    sessions.find((s) => s.sessionId === selectedSessionId) ??
    sessions[0] ??
    null;

  return (
    <div className="workspace-flow" aria-busy={busy || undefined}>
      <header className="work-heading">
        <div>
          <h2>Inteligência Avançada (F5)</h2>
          <p>
            Arena paralela isolada, Replay explicável em (V, K), aprendizado BKM
            reversível e Proatividade graduada offline-first.
          </p>
        </div>
        <div className="work-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void runScoped((gen) => refreshAll(activeScope, activeKey, gen))
            }
          >
            Atualizar F5
          </button>
        </div>
      </header>

      <nav className="project-tabs" aria-label="Capacidades F5">
        {(
          [
            ["arena", "Arena (F5-M01)"],
            ["replay", "Replay (V, K) (F5-M02)"],
            ["learning", "Aprendizado BKM (F5-M03)"],
            ["proactivity", "Proatividade (F5-M04)"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

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

      {tab === "arena" && (
        <section className="dashboard-panel">
          <header className="dashboard-heading">
            <h3>F5-M01 · Arena Paralela com Base Única</h3>
            <span className="badge warning">
              INV-07: codex_cli_isolated bloqueado (0xc0000142)
            </span>
          </header>

          <form
            className="work-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void runScoped(async (gen) => {
                const created = await client.arena.sessionCreate({
                  ...activeScope,
                  requestId: nextClientRequestId("arena-create"),
                  title: arenaTitle.trim(),
                  objective: arenaObjective.trim(),
                  backendMode: arenaBackend,
                  humanConfirmed: arenaConfirmed,
                  criteria: {
                    sharedObjective: arenaObjective.trim(),
                    items: [
                      {
                        criterionId: "correctness",
                        label: "Corretude & Evidência",
                        weight: 1,
                      },
                    ],
                  },
                  hypotheses: [
                    {
                      hypothesisId: "hyp-a",
                      label: hypALabel.trim(),
                      summary: `Alterar ${hypAPath.trim()}`,
                      targetPaths: [hypAPath.trim()],
                      proposedEdits: [
                        {
                          path: hypAPath.trim(),
                          action: "create",
                          content: hypAContent,
                        },
                      ],
                      mockBehavior:
                        arenaBackend === "mock_supervised"
                          ? "complete"
                          : undefined,
                    },
                    {
                      hypothesisId: "hyp-b",
                      label: hypBLabel.trim(),
                      summary: `Alterar ${hypBPath.trim()}`,
                      targetPaths: [hypBPath.trim()],
                      proposedEdits: [
                        {
                          path: hypBPath.trim(),
                          action: "create",
                          content: hypBContent,
                        },
                      ],
                      mockBehavior:
                        arenaBackend === "mock_supervised"
                          ? "complete"
                          : undefined,
                    },
                  ],
                });
                if (!isCurrent(activeKey, gen)) return;
                setSelectedSessionId(created.sessionId);
                setArenaConfirmed(false);
                setNotice(
                  `Sessão Arena ${created.sessionId.slice(0, 8)} criada sobre a base ${created.baseDigest.slice(0, 12)}.`,
                );
                await refreshAll(activeScope, activeKey, gen);
              });
            }}
          >
            <div className="work-grid">
              <label>
                Título da Arena
                <input
                  value={arenaTitle}
                  onChange={(e) => setArenaTitle(e.target.value)}
                  required
                />
              </label>
              <label>
                Backend
                <select
                  value={arenaBackend}
                  onChange={(e) =>
                    setArenaBackend(e.target.value as PlannerBackendMode)
                  }
                >
                  <option value="mock_supervised">
                    mock_supervised (determinístico offline)
                  </option>
                  <option value="local_process_job">
                    local_process_job (processo filho)
                  </option>
                  <option value="codex_cli_isolated">
                    codex_cli_isolated (bloqueado por política)
                  </option>
                </select>
              </label>
            </div>
            <label>
              Objetivo compartilhado
              <input
                value={arenaObjective}
                onChange={(e) => setArenaObjective(e.target.value)}
                required
              />
            </label>
            <div className="work-grid">
              <div className="panel">
                <strong>Hipótese A</strong>
                <input
                  aria-label="Rótulo Hipótese A"
                  value={hypALabel}
                  onChange={(e) => setHypALabel(e.target.value)}
                />
                <input
                  aria-label="Caminho Hipótese A"
                  value={hypAPath}
                  onChange={(e) => setHypAPath(e.target.value)}
                />
                <textarea
                  rows={2}
                  aria-label="Conteúdo Hipótese A"
                  value={hypAContent}
                  onChange={(e) => setHypAContent(e.target.value)}
                />
              </div>
              <div className="panel">
                <strong>Hipótese B</strong>
                <input
                  aria-label="Rótulo Hipótese B"
                  value={hypBLabel}
                  onChange={(e) => setHypBLabel(e.target.value)}
                />
                <input
                  aria-label="Caminho Hipótese B"
                  value={hypBPath}
                  onChange={(e) => setHypBPath(e.target.value)}
                />
                <textarea
                  rows={2}
                  aria-label="Conteúdo Hipótese B"
                  value={hypBContent}
                  onChange={(e) => setHypBContent(e.target.value)}
                />
              </div>
            </div>
            <label>
              <input
                type="checkbox"
                checked={arenaConfirmed}
                onChange={(e) => setArenaConfirmed(e.target.checked)}
              />{" "}
              Confirmo criação de worktrees isoladas sem aplicar código no
              checkout local
            </label>
            <button type="submit" className="button" disabled={busy}>
              Criar sessão Arena
            </button>
          </form>

          {sessions.length > 0 && (
            <div className="work-stack">
              <div className="work-actions">
                {sessions.map((s) => (
                  <button
                    key={s.sessionId}
                    type="button"
                    className="button"
                    aria-pressed={selectedSession?.sessionId === s.sessionId}
                    onClick={() => setSelectedSessionId(s.sessionId)}
                  >
                    {s.title} ({s.status})
                  </button>
                ))}
              </div>

              {selectedSession && (
                <div className="panel work-stack">
                  <div className="work-heading">
                    <div>
                      <strong>{selectedSession.title}</strong> · status{" "}
                      <code>{selectedSession.status}</code> · base{" "}
                      <code>{selectedSession.baseDigest.slice(0, 12)}</code>
                      {selectedSession.invalidationReason && (
                        <span className="badge warning">
                          {selectedSession.invalidationReason}
                        </span>
                      )}
                    </div>
                    <span className="badge">
                      appliedToLocal: {String(selectedSession.appliedToLocal)}
                    </span>
                  </div>

                  {selectedSession.status === "created" && (
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void runScoped(async (gen) => {
                          const ran = await client.arena.sessionRun({
                            ...activeScope,
                            sessionId: selectedSession.sessionId,
                            humanConfirmed: true,
                          });
                          if (!isCurrent(activeKey, gen)) return;
                          setNotice(
                            `Execução concluída: estado ${ran.status}.`,
                          );
                          await refreshAll(activeScope, activeKey, gen);
                        })
                      }
                    >
                      Executar hipóteses em paralelo
                    </button>
                  )}

                  <div className="work-grid">
                    {selectedSession.hypotheses.map((h) => (
                      <article key={h.hypothesisId} className="panel">
                        <h4>
                          {h.label} (<code>{h.hypothesisId}</code>)
                        </h4>
                        <p className="muted">
                          Estado: <code>{h.state}</code> · Worktree:{" "}
                          <code>
                            {h.dedicatedWorktreeId?.slice(0, 8) ?? "n/d"}
                          </code>
                        </p>
                        <p className="muted">
                          Diff SHA-256:{" "}
                          <code>
                            {h.diffDigest?.slice(0, 16) ?? "sem diff"}
                          </code>{" "}
                          ({h.diffFiles.length} arquivo(s))
                        </p>
                        <p className="muted">
                          Fontes independentes: {h.sourceRefs.length}
                        </p>
                      </article>
                    ))}
                  </div>

                  {selectedSession.status === "ready_for_review" && (
                    <form
                      className="work-stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const [h0, h1] = selectedSession.hypotheses;
                        if (!h0 || !h1) return;
                        void runScoped(async (gen) => {
                          await client.arena.sessionReview({
                            ...activeScope,
                            sessionId: selectedSession.sessionId,
                            requestId: nextClientRequestId("arena-rev"),
                            outcome: reviewOutcome,
                            winnerHypothesisId:
                              reviewOutcome === "winner_selected"
                                ? winnerId || h0.hypothesisId
                                : null,
                            reviewer: reviewerName.trim(),
                            rationale: reviewRationale.trim(),
                            reviewedHypothesisIds:
                              selectedSession.hypotheses.map(
                                (h) => h.hypothesisId,
                              ),
                            criterionScores: [
                              {
                                hypothesisId: h0.hypothesisId,
                                criterionId:
                                  selectedSession.criteria.items[0]
                                    ?.criterionId ?? "correctness",
                                score: scoreA,
                              },
                              {
                                hypothesisId: h1.hypothesisId,
                                criterionId:
                                  selectedSession.criteria.items[0]
                                    ?.criterionId ?? "correctness",
                                score: scoreB,
                              },
                            ],
                            evidenceRefs: selectedSession.hypotheses
                              .map((h) => h.diffDigest)
                              .filter((d): d is string => Boolean(d)),
                            humanConfirmed: reviewConfirmed,
                          });
                          if (!isCurrent(activeKey, gen)) return;
                          setReviewConfirmed(false);
                          setNotice(
                            "Revisão pareada registrada (appliedToLocal permanece false; aplique via F4 OCC se desejar).",
                          );
                          await refreshAll(activeScope, activeKey, gen);
                        });
                      }}
                    >
                      <h4>Revisão Humana Pareada Obrigatória</h4>
                      <div className="work-grid">
                        <label>
                          Resultado pareado
                          <select
                            value={reviewOutcome}
                            onChange={(e) =>
                              setReviewOutcome(
                                e.target.value as ArenaReviewOutcome,
                              )
                            }
                          >
                            <option value="winner_selected">
                              Vencedora selecionada
                            </option>
                            <option value="tie">Empate</option>
                            <option value="both_discarded">
                              Ambas descartadas
                            </option>
                          </select>
                        </label>
                        {reviewOutcome === "winner_selected" && (
                          <label>
                            Hipótese vencedora
                            <select
                              value={
                                winnerId ||
                                selectedSession.hypotheses[0]?.hypothesisId ||
                                ""
                              }
                              onChange={(e) => setWinnerId(e.target.value)}
                            >
                              {selectedSession.hypotheses.map((h) => (
                                <option
                                  key={h.hypothesisId}
                                  value={h.hypothesisId}
                                >
                                  {h.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                      <div className="work-grid">
                        <label>
                          Nota Hipótese A (0-10)
                          <input
                            type="number"
                            min={0}
                            max={10}
                            value={scoreA}
                            onChange={(e) => setScoreA(Number(e.target.value))}
                          />
                        </label>
                        <label>
                          Nota Hipótese B (0-10)
                          <input
                            type="number"
                            min={0}
                            max={10}
                            value={scoreB}
                            onChange={(e) => setScoreB(Number(e.target.value))}
                          />
                        </label>
                      </div>
                      <label>
                        Revisor
                        <input
                          value={reviewerName}
                          onChange={(e) => setReviewerName(e.target.value)}
                          required
                        />
                      </label>
                      <label>
                        Justificativa comparativa
                        <input
                          value={reviewRationale}
                          onChange={(e) => setReviewRationale(e.target.value)}
                          required
                        />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={reviewConfirmed}
                          onChange={(e) => setReviewConfirmed(e.target.checked)}
                        />{" "}
                        Confirmo revisão pareada humana (não aplica código
                        automaticamente)
                      </label>
                      <button type="submit" className="button" disabled={busy}>
                        Registrar revisão pareada
                      </button>
                    </form>
                  )}

                  {selectedSession.pairedReview && (
                    <div className="panel">
                      <strong>Revisão registrada:</strong>{" "}
                      <code>{selectedSession.pairedReview.outcome}</code>{" "}
                      {selectedSession.pairedReview.winnerHypothesisId
                        ? `(vencedora: ${selectedSession.pairedReview.winnerHypothesisId})`
                        : ""}
                      {" · "}
                      {selectedSession.pairedReview.rationale}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {tab === "replay" && (
        <section className="dashboard-panel work-stack">
          <header className="dashboard-heading">
            <h3>F5-M02 · Replay Bitemporal Explicável em (V, K)</h3>
            <span className="badge">Leitura passiva + tombstones</span>
          </header>

          <div className="work-grid">
            <label>
              Ponto A validAt (V)
              <input
                value={validAt}
                onChange={(e) => setValidAt(e.target.value)}
              />
            </label>
            <label>
              Ponto A knownAt (K)
              <input
                value={knownAt}
                onChange={(e) => setKnownAt(e.target.value)}
              />
            </label>
          </div>
          <div className="work-grid">
            <label>
              Ponto B validAt (diff)
              <input
                value={pointBValidAt}
                onChange={(e) => setPointBValidAt(e.target.value)}
              />
            </label>
            <label>
              Ponto B knownAt (diff)
              <input
                value={pointBKnownAt}
                onChange={(e) => setPointBKnownAt(e.target.value)}
              />
            </label>
          </div>
          <div className="work-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void runScoped(async (gen) => {
                  const res = await client.replay.query({
                    ...activeScope,
                    validAt: validAt.trim(),
                    knownAt: knownAt.trim(),
                  });
                  if (!isCurrent(activeKey, gen)) return;
                  setReplayResult(res);
                  setDeliveryDetail(null);
                  setNotice(
                    `Replay reconstruído em V=${res.validAt} / K=${res.knownAt}.`,
                  );
                })
              }
            >
              Consultar estado em (V, K)
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void runScoped(async (gen) => {
                  const res = await client.replay.diff({
                    ...activeScope,
                    pointA: {
                      validAt: validAt.trim(),
                      knownAt: knownAt.trim(),
                    },
                    pointB: {
                      validAt: pointBValidAt.trim(),
                      knownAt: pointBKnownAt.trim(),
                    },
                  });
                  if (!isCurrent(activeKey, gen)) return;
                  setReplayDiff(res);
                })
              }
            >
              Comparar Ponto A ↔ Ponto B
            </button>
          </div>

          {replayResult && (
            <div className="work-stack">
              <div className="work-grid">
                <div className="panel">
                  <h4>Afirmações F3 ({replayResult.claims.length})</h4>
                  <ul>
                    {replayResult.claims.map((c) => (
                      <li key={c.revision.revisionId}>
                        <strong>{c.title}</strong> (tx#{c.revision.txSeq}) —{" "}
                        {c.revision.content}{" "}
                        <span className="badge">{c.evidenceState}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="panel">
                  <h4>Decisões F1 ({replayResult.decisions.length})</h4>
                  <ul>
                    {replayResult.decisions.map((d) => (
                      <li key={d.revisionId}>
                        <code>v{d.revision}</code> {d.content} (
                        {d.evidenceState})
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="panel">
                <h4>
                  Lacunas Declaradas &amp; Expurgos ({replayResult.gaps.length})
                </h4>
                {replayResult.gaps.length === 0 ? (
                  <p className="muted">
                    Nenhuma lacuna registrada neste ponto.
                  </p>
                ) : (
                  <ul>
                    {replayResult.gaps.map((g) => (
                      <li key={g.gapId}>
                        <span className="badge warning">{g.kind}</span>{" "}
                        <code>{g.targetKind}</code> ({g.targetId}) — {g.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="panel">
                <h4>
                  Entregas F2 conhecidas até K ({replayResult.deliveries.length}
                  )
                </h4>
                <ul>
                  {replayResult.deliveries.map((d) => (
                    <li key={d.manifestDigest}>
                      <code>{d.manifestDigest.slice(0, 12)}</code> · destino{" "}
                      <code>{d.destinationId}</code> · política{" "}
                      <code>{d.policyVersion}</code> ({d.includedCount}{" "}
                      incluídos, {d.omittedCount} omissões){" "}
                      <button
                        type="button"
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          void runScoped(async (gen) => {
                            const detail = await client.replay.deliveryInspect({
                              ...activeScope,
                              manifestDigest: d.manifestDigest,
                              knownAt: replayResult.knownAt,
                            });
                            if (!isCurrent(activeKey, gen)) return;
                            setDeliveryDetail(detail);
                          })
                        }
                      >
                        Inspecionar entrega
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {deliveryDetail && (
            <div className="panel">
              <h4>
                Detalhe da Entrega{" "}
                <code>{deliveryDetail.manifestDigest.slice(0, 16)}</code>
              </h4>
              <p className="muted">
                Política: <code>{deliveryDetail.policyVersion}</code> ·
                Estratégia: <code>{deliveryDetail.strategyVersion}</code> ·
                Grants: {deliveryDetail.grants.length} · Audits:{" "}
                {deliveryDetail.audits.length} · Leituras MCP:{" "}
                {deliveryDetail.observedReads.length}
              </p>
              <ul>
                {deliveryDetail.includedItems.map((it) => (
                  <li key={it.opaqueRef}>
                    <code>{it.opaqueRef}</code> ({it.kind}, {it.tier},{" "}
                    {it.bytes}B) — {it.rationale}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {replayDiff && (
            <div className="panel">
              <h4>Diff Temporal (Ponto A ↔ Ponto B)</h4>
              <p className="muted">
                Claims: +{replayDiff.addedClaims.length} / -
                {replayDiff.removedClaims.length} / ~
                {replayDiff.changedClaims.length} · Decisões: +
                {replayDiff.addedDecisions.length} / -
                {replayDiff.removedDecisions.length} / ~
                {replayDiff.changedDecisions.length} · Novas lacunas:{" "}
                {replayDiff.newGaps.length} · Novas entregas:{" "}
                {replayDiff.newDeliveries.length}
              </p>
            </div>
          )}
        </section>
      )}

      {tab === "learning" && (
        <section className="dashboard-panel work-stack">
          <header className="dashboard-heading">
            <h3>
              F5-M03 · Hipóteses Simbólicas (BKM) &amp; Avaliação Adaptativa
            </h3>
            {strategyStatus && (
              <span className="badge">
                Modo: {strategyStatus.activeMode} (
                {strategyStatus.activeVersion})
              </span>
            )}
          </header>

          <form
            className="work-stack panel"
            onSubmit={(e) => {
              e.preventDefault();
              void runScoped(async (gen) => {
                await client.learning.hypothesisUpsert({
                  ...activeScope,
                  requestId: nextClientRequestId("bkm-upsert"),
                  competingGroupKey: bkmGroup.trim(),
                  category: bkmCategory,
                  title: bkmTitle.trim(),
                  statement: bkmStatement.trim(),
                  pattern: {
                    keywords: bkmKeywords
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    pathPrefixes: bkmPaths
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    boostWeight: 3,
                    preferCanonical: true,
                    preferRecent: true,
                  },
                  evidence: [
                    {
                      polarity: "support",
                      originKey: bkmOriginKey.trim(),
                      originKind: "manual",
                      weight: 2,
                      note: bkmNote.trim(),
                    },
                  ],
                });
                if (!isCurrent(activeKey, gen)) return;
                setNotice("Hipótese BKM salva no grupo concorrente.");
                await refreshAll(activeScope, activeKey, gen);
              });
            }}
          >
            <div className="work-grid">
              <label>
                Grupo concorrente
                <input
                  value={bkmGroup}
                  onChange={(e) => setBkmGroup(e.target.value)}
                  required
                />
              </label>
              <label>
                Categoria
                <select
                  value={bkmCategory}
                  onChange={(e) =>
                    setBkmCategory(e.target.value as BkmCategory)
                  }
                >
                  <option value="retrieval_boost">retrieval_boost</option>
                  <option value="temporal_recency">temporal_recency</option>
                  <option value="canonical_priority">canonical_priority</option>
                  <option value="path_affinity">path_affinity</option>
                </select>
              </label>
            </div>
            <label>
              Título da hipótese simbólica
              <input
                value={bkmTitle}
                onChange={(e) => setBkmTitle(e.target.value)}
                required
              />
            </label>
            <label>
              Regra declarativa
              <input
                value={bkmStatement}
                onChange={(e) => setBkmStatement(e.target.value)}
                required
              />
            </label>
            <div className="work-grid">
              <label>
                Palavras-chave (vírgula)
                <input
                  value={bkmKeywords}
                  onChange={(e) => setBkmKeywords(e.target.value)}
                />
              </label>
              <label>
                Prefixos de caminho (vírgula)
                <input
                  value={bkmPaths}
                  onChange={(e) => setBkmPaths(e.target.value)}
                />
              </label>
            </div>
            <div className="work-grid">
              <label>
                Chave de origem independente
                <input
                  value={bkmOriginKey}
                  onChange={(e) => setBkmOriginKey(e.target.value)}
                  required
                />
              </label>
              <label>
                Nota de evidência
                <input
                  value={bkmNote}
                  onChange={(e) => setBkmNote(e.target.value)}
                  required
                />
              </label>
            </div>
            <button type="submit" className="button" disabled={busy}>
              Registrar hipótese BKM
            </button>
          </form>

          <div className="panel work-stack">
            <div className="work-heading">
              <h4>Hipóteses BKM no escopo ({bkmList.length})</h4>
              <label>
                <input
                  type="checkbox"
                  checked={bkmTransitionConfirmed}
                  onChange={(e) => setBkmTransitionConfirmed(e.target.checked)}
                />{" "}
                Confirmo transição humana reversível
              </label>
            </div>
            {bkmList.map((h) => (
              <div key={h.hypothesisId} className="panel">
                <strong>{h.title}</strong> · <code>{h.state}</code> · grupo{" "}
                <code>{h.competingGroupKey}</code>
                <p className="muted">
                  Origens suporte: {h.independentSupportOrigins} (eventos
                  brutos: {h.rawSupportEvents}) · Origens contrárias:{" "}
                  {h.independentOpposeOrigins} · Saldo: {h.netScore}
                </p>
                <div className="work-actions">
                  {(
                    ["active", "reverted", "superseded"] as BkmHypothesisState[]
                  ).map((targetState) => (
                    <button
                      key={targetState}
                      type="button"
                      className="button"
                      disabled={busy || h.state === targetState}
                      onClick={() =>
                        void runScoped(async (gen) => {
                          await client.learning.hypothesisTransition({
                            ...activeScope,
                            hypothesisId: h.hypothesisId,
                            toState: targetState,
                            reason: `Transição manual UI para ${targetState}`,
                            reviewer: "operador",
                            supersedeCompetitors: targetState === "active",
                            humanConfirmed: bkmTransitionConfirmed,
                          });
                          if (!isCurrent(activeKey, gen)) return;
                          setBkmTransitionConfirmed(false);
                          await refreshAll(activeScope, activeKey, gen);
                        })
                      }
                    >
                      Mover para {targetState}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {strategyStatus && (
            <div className="panel work-stack">
              <h4>Gate Held-Out F5-M03.A2 &amp; Rollback</h4>
              <div className="work-actions">
                <label>
                  <input
                    type="checkbox"
                    checked={adaptiveConfirmed}
                    onChange={(e) => setAdaptiveConfirmed(e.target.checked)}
                  />{" "}
                  Confirmação humana para ativação/rollback
                </label>
                {strategyStatus.latestEvaluation && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void runScoped(async (gen) => {
                        await client.learning.strategyActivate({
                          ...activeScope,
                          mode: "adaptive_symbolic",
                          evaluationId:
                            strategyStatus.latestEvaluation!.evaluationId,
                          reviewer: "operador",
                          reason: "Ativação via painel F5",
                          humanConfirmed: adaptiveConfirmed,
                        });
                        if (!isCurrent(activeKey, gen)) return;
                        setAdaptiveConfirmed(false);
                        await refreshAll(activeScope, activeKey, gen);
                      })
                    }
                  >
                    Ativar estratégia adaptativa
                  </button>
                )}
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void runScoped(async (gen) => {
                      await client.learning.strategyActivate({
                        ...activeScope,
                        mode: "rollback_to_baseline",
                        reviewer: "operador",
                        reason: "Rollback explícito para FTS5",
                        humanConfirmed: adaptiveConfirmed,
                      });
                      if (!isCurrent(activeKey, gen)) return;
                      setAdaptiveConfirmed(false);
                      await refreshAll(activeScope, activeKey, gen);
                    })
                  }
                >
                  Reverter para baseline FTS5
                </button>
              </div>
              {strategyStatus.latestEvaluation && (
                <p className="muted">
                  Última avaliação:{" "}
                  <code>{strategyStatus.latestEvaluation.decision}</code> ·
                  Ganho recall:{" "}
                  {strategyStatus.latestEvaluation.recallGain.toFixed(4)} ·
                  Falhas:{" "}
                  {strategyStatus.latestEvaluation.failedGates.join(", ") ||
                    "nenhuma"}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {tab === "proactivity" && (
        <section className="dashboard-panel work-stack">
          <header className="dashboard-heading">
            <h3>F5-M04 · Proatividade Graduada &amp; Janelas Opt-In</h3>
            <span className="badge">
              App fechado: disabled_deferred (sem daemon oculto)
            </span>
          </header>

          <div className="work-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void runScoped(async (gen) => {
                  const res = await client.proactivity.evaluate(activeScope);
                  if (!isCurrent(activeKey, gen)) return;
                  setProactSuggestions({
                    scope: res.scope,
                    suggestions: res.suggestions,
                    telemetry: res.telemetry,
                  });
                  setNotice(
                    `Avaliação passiva concluída: ${res.suggestions.length} sugestão(ões), zero mutação no Git.`,
                  );
                })
              }
            >
              Avaliar sinais locais agora
            </button>
          </div>

          {proactSuggestions && (
            <div className="panel work-stack">
              <h4>
                Sugestões Priorizadas ({proactSuggestions.suggestions.length}) ·
                Economia estimada:{" "}
                {proactSuggestions.telemetry.estimatedSavedSeconds}s ·
                Utilidade:{" "}
                {(proactSuggestions.telemetry.utilityRate * 100).toFixed(0)}%
              </h4>
              {proactSuggestions.suggestions.map((s) => (
                <article key={s.suggestionId} className="panel">
                  <strong>
                    [{s.priorityBand} · {s.priorityScore}] {s.title}
                  </strong>{" "}
                  · <code>{s.status}</code> ·{" "}
                  <span className="badge">autoExecutable: false</span>
                  <p className="muted">{s.rationale}</p>
                  <p className="muted">
                    Fontes:{" "}
                    {s.sourceRefs.map((r) => `${r.kind}:${r.id}`).join(", ")}
                  </p>
                  <div className="work-actions">
                    {(
                      [
                        [
                          "accept_proposal",
                          "Aceitar sugestão (não auto-executa)",
                        ],
                        ["snooze", "Adiar"],
                        ["dismiss", "Dispensar"],
                        ["restore", "Restaurar"],
                      ] as const
                    ).map(([action, label]) => (
                      <button
                        key={action}
                        type="button"
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          void runScoped(async (gen) => {
                            await client.proactivity.suggestionRespond({
                              ...activeScope,
                              suggestionId: s.suggestionId,
                              action,
                              snoozeUntil:
                                action === "snooze"
                                  ? new Date(
                                      Date.now() + 86_400_000,
                                    ).toISOString()
                                  : undefined,
                            });
                            if (!isCurrent(activeKey, gen)) return;
                            await refreshAll(activeScope, activeKey, gen);
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}

          <form
            className="panel work-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void runScoped(async (gen) => {
                await client.proactivity.scheduleUpsert({
                  ...activeScope,
                  label: schedLabel.trim(),
                  optInConfirmed: schedOptIn,
                  windowStartUtc: schedStartUtc.trim(),
                  windowEndUtc: schedEndUtc.trim(),
                  allowedDaysUtc: [0, 1, 2, 3, 4, 5, 6],
                  minIntervalMinutes: Number(schedIntervalMin) || 30,
                  appClosedMode: "disabled_deferred",
                  runWhenAppClosed: false,
                });
                if (!isCurrent(activeKey, gen)) return;
                setSchedOptIn(false);
                setNotice("Janela opt-in configurada.");
                await refreshAll(activeScope, activeKey, gen);
              });
            }}
          >
            <h4>Agenda Opt-In por Janela UTC (F5-M04.A2)</h4>
            <div className="work-grid">
              <label>
                Rótulo da janela
                <input
                  value={schedLabel}
                  onChange={(e) => setSchedLabel(e.target.value)}
                  required
                />
              </label>
              <label>
                Intervalo mínimo (min)
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={schedIntervalMin}
                  onChange={(e) => setSchedIntervalMin(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="work-grid">
              <label>
                Início UTC (HH:MM)
                <input
                  value={schedStartUtc}
                  onChange={(e) => setSchedStartUtc(e.target.value)}
                />
              </label>
              <label>
                Fim UTC (HH:MM)
                <input
                  value={schedEndUtc}
                  onChange={(e) => setSchedEndUtc(e.target.value)}
                />
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={schedOptIn}
                onChange={(e) => setSchedOptIn(e.target.checked)}
              />{" "}
              Confirmo opt-in explícito apenas enquanto o app estiver aberto
            </label>
            <button type="submit" className="button" disabled={busy}>
              Salvar janela opt-in
            </button>
          </form>

          {proactSchedules && proactSchedules.schedules.length > 0 && (
            <div className="panel work-stack">
              <h4>Janelas &amp; Auditoria de Execuções</h4>
              {proactSchedules.schedules.map((sc) => (
                <div key={sc.scheduleId} className="panel">
                  <strong>{sc.label}</strong> · <code>{sc.status}</code> · UTC{" "}
                  {sc.windowStartUtc}–{sc.windowEndUtc} ·{" "}
                  <code>{sc.appClosedMode}</code>
                  <div className="work-actions">
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void runScoped(async (gen) => {
                          await client.proactivity.scheduleControl({
                            ...activeScope,
                            scheduleId: sc.scheduleId,
                            action: "trigger_window",
                            evaluatedAt: new Date().toISOString(),
                          });
                          if (!isCurrent(activeKey, gen)) return;
                          await refreshAll(activeScope, activeKey, gen);
                        })
                      }
                    >
                      Executar janela agora
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={busy || sc.status === "revoked"}
                      onClick={() =>
                        void runScoped(async (gen) => {
                          await client.proactivity.scheduleControl({
                            ...activeScope,
                            scheduleId: sc.scheduleId,
                            action: "revoke",
                            reason: "Revogado pelo usuário",
                            humanConfirmed: true,
                          });
                          if (!isCurrent(activeKey, gen)) return;
                          await refreshAll(activeScope, activeKey, gen);
                        })
                      }
                    >
                      Revogar opt-in
                    </button>
                  </div>
                </div>
              ))}
              {proactSchedules.runs.length > 0 && (
                <ul>
                  {proactSchedules.runs.map((r) => (
                    <li key={r.runId}>
                      <code>{r.state}</code> · janela {r.windowKey} · duplicata
                      suprimida={String(r.duplicateSuppressed)} · recuperado=
                      {String(r.recoveredAfterRestart)} — {r.detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
