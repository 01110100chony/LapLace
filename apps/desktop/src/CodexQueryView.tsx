import {
  codexMaxQuestionBytes,
  codexMaxSourceBytes,
  codexMaxSources,
  codexTimeoutMs,
  isCodexQuestion,
  type CodexEvent,
  type CodexExecution,
  type CodexHistory,
  type CodexHistoryItem,
  type CodexPreview,
  type CodexSelection,
  type CodexStatus,
  type ContextSnapshot,
  type ContextSourcePreview,
  type TaskSource,
} from "@laplace/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { DesktopError, errorMessage, type createDesktopClient } from "./ipc";
import { createLatestRequest } from "./workspace";
import { CodexResponse, modeLabel, stateLabel } from "./CodexResponse";

type Client = ReturnType<typeof createDesktopClient>["codex"];
const availability: Record<CodexStatus["state"], string> = {
  missing: "Executável Codex CLI indisponível.",
  unsupported:
    "A versão do Codex CLI está fora do perfil homologado pelo adaptador.",
  probe_failed: "Falha ao verificar o Codex CLI ou sua autenticação.",
  unauthenticated: "Entre no Codex CLI para disponibilizar a autenticação.",
  confinement_unverified:
    "Envio bloqueado. O confinamento de leitura do Codex ainda precisa ser comprovado neste ambiente.",
  ready: "Confinamento verificado. Codex disponível para consulta.",
  mock_ready: "Simulação local com dados fictícios.",
  workspace_ready: "Codex disponível. Isolamento de leitura não verificado.",
};

export function CodexQueryView({
  projectId,
  projectName,
  client,
  snapshot,
  excerpts,
  onCreateTask,
}: {
  projectId: string;
  projectName: string;
  client: Client;
  snapshot: ContextSnapshot | undefined;
  excerpts: ContextSourcePreview[];
  onCreateTask: (source: TaskSource, question: string) => void;
}) {
  const [status, setStatus] = useState<CodexStatus>();
  const [checking, setChecking] = useState(true);
  const [selection, setSelection] = useState<CodexSelection[]>([]);
  const [question, setQuestion] = useState("");
  const [preview, setPreview] = useState<CodexPreview>();
  const [display, setDisplay] = useState<{
    execution: CodexExecution;
    question: string;
    fromHistory: boolean;
  }>();
  const execution = display?.execution;
  const contextId = snapshot?.contextId;
  const [history, setHistory] = useState<CodexHistory>();
  const [loadingHistory, setLoadingHistory] = useState(!!contextId);
  const [historyProblem, setHistoryProblem] = useState("");
  const [usedGrant, setUsedGrant] = useState<string>();
  const [events, setEvents] = useState<CodexEvent[]>([]);
  const [saved, setSaved] = useState<boolean>();
  const [trackingInterrupted, setTrackingInterrupted] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState("");
  const [requests] = useState(() => ({
    status: createLatestRequest(),
    prepare: createLatestRequest(),
    start: createLatestRequest(),
    history: createLatestRequest(),
  }));
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const run = useRef<CodexExecution | null>(null);
  const ready =
    status?.state === "ready" ||
    status?.state === "mock_ready" ||
    status?.state === "workspace_ready";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      Object.values(requests).forEach((request) => request.invalidate());
      if (run.current) void client.cancel(run.current).catch(() => {});
    };
  }, [client, requests]);

  const fetchHistory = useCallback(
    (before: string | null = null) => {
      if (!contextId) return;
      setLoadingHistory(true);
      setHistoryProblem("");
      void requests.history.run(
        () => client.history(projectId, contextId, before),
        (page) => {
          setHistory((previous) =>
            before && previous
              ? { ...page, items: [...previous.items, ...page.items] }
              : page,
          );
          setLoadingHistory(false);
        },
        (error) => {
          setHistoryProblem(errorMessage(error));
          setLoadingHistory(false);
        },
      );
    },
    [client, contextId, projectId, requests],
  );

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!execution) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let after = 0;
    async function poll(current: CodexExecution) {
      try {
        const page = await client.events(current, after);
        if (disposed) return;
        after = page.nextSeq;
        setEvents((old) => [...old, ...page.events]);
        if (page.more || page.state === "running") {
          timer = setTimeout(() => void poll(current), page.more ? 0 : 450);
        } else {
          setRunning(false);
          setCancelling(false);
          setSaved(page.saved);
          if (run.current?.executionId === current.executionId) {
            run.current = null;
            fetchHistory();
          }
        }
      } catch (error) {
        if (disposed) return;
        if (run.current?.executionId === current.executionId) {
          void client.cancel(current).catch(() => {});
          run.current = null;
        }
        setTrackingInterrupted(true);
        setRunning(false);
        setCancelling(false);
        setProblem(errorMessage(error));
      }
    }
    void poll(execution);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [client, execution, fetchHistory]);

  const fetchStatus = useCallback(() => {
    void requests.status.run(
      () => client.status(projectId),
      (data) => {
        setStatus(data);
        setChecking(false);
      },
      (error) => {
        setStatus(undefined);
        setChecking(false);
        setProblem(errorMessage(error));
      },
    );
  }, [client, projectId, requests]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  function check() {
    setChecking(true);
    setProblem("");
    fetchStatus();
  }

  function select(source: CodexSelection) {
    setPreview(undefined);
    setSelection((previous) => {
      const existing = previous.find((item) => item.path === source.path);
      const next = previous.filter((item) => item.path !== source.path);
      return existing?.chunk === source.chunk ? next : [...next, source];
    });
  }

  function prepare() {
    if (!snapshot || busy) return;
    setProblem("");
    setPreview(undefined);
    setBusy(true);
    void requests.prepare.run(
      () =>
        client.prepare({
          projectId,
          contextId: snapshot.contextId,
          snapshotDigest: snapshot.digest,
          selection,
          question,
        }),
      (data) => {
        setBusy(false);
        setPreview(data);
        requestAnimationFrame(() => heading.current?.focus());
      },
      (error) => {
        setBusy(false);
        setProblem(errorMessage(error));
      },
    );
  }

  function start() {
    if (
      !preview ||
      busy ||
      running ||
      checking ||
      !ready ||
      status?.mode !== preview.mode ||
      usedGrant === preview.grantId
    )
      return;
    setBusy(true);
    setProblem("");
    void requests.start.run(
      async () => {
        const id = await client.start(preview);
        if (!mounted.current) void client.cancel(id).catch(() => {});
        return id;
      },
      (data) => {
        run.current = data;
        setUsedGrant(preview.grantId);
        setDisplay({
          execution: data,
          question: preview.question,
          fromHistory: false,
        });
        setEvents([]);
        setSaved(undefined);
        setTrackingInterrupted(false);
        setBusy(false);
        setRunning(true);
      },
      (error) => {
        setBusy(false);
        setProblem(errorMessage(error));
        if (!(
          error instanceof DesktopError &&
          error.code === "codex_authorization_required"
        ))
          check();
      },
    );
  }

  function openHistory(item: CodexHistoryItem) {
    if (running || busy) return;
    setProblem("");
    setEvents([]);
    setSaved(undefined);
    setTrackingInterrupted(false);
    setDisplay({
      execution: { ...item },
      question: item.question,
      fromHistory: true,
    });
  }

  function cancel() {
    if (!execution) return;
    setCancelling(true);
    void client.cancel(execution).catch((error) => {
      if (!mounted.current) return;
      setCancelling(false);
      setProblem(errorMessage(error));
    });
  }

  const eligible =
    snapshot && snapshot.status !== "invalidated" && snapshot.included > 0;
  const checked = (source: CodexSelection) =>
    selection.some(
      (item) => item.path === source.path && item.chunk === source.chunk,
    );
  const sourceControl = (source: CodexSelection, label: React.ReactNode) => (
    <label key={`${source.path}/${source.chunk}`} className="context-file">
      <input
        type="checkbox"
        checked={checked(source)}
        disabled={
          selection.length >= codexMaxSources &&
          !selection.some((item) => item.path === source.path)
        }
        onChange={() => select(source)}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <section className="context-result" aria-labelledby="codex-query">
      <div className="work-panel-heading">
        <h3 id="codex-query">Disponibilidade e fontes</h3>
        <button
          className="button"
          onClick={check}
          disabled={checking || busy || running}
        >
          Verificar disponibilidade
        </button>
      </div>
      <p role="status" className="context-muted">
        {checking
          ? "Verificando disponibilidade…"
          : status
            ? [
                modeLabel[status.mode],
                status.version && `Codex CLI ${status.version}`,
                availability[status.state],
                !ready &&
                  status.state !== "confinement_unverified" &&
                  "Execução bloqueada",
                !ready &&
                  status.mode === "verified_isolated" &&
                  status.state !== "confinement_unverified" &&
                  "Isolamento indisponível",
              ]
                .filter(Boolean)
                .join(" · ")
            : "Verifique a disponibilidade antes de consultar."}
      </p>
      {status?.mode === "unconfined_workspace_development" && (
        <p className="service-error">
          Isolamento de leitura não verificado. Use somente dados fictícios ou
          não sensíveis.
        </p>
      )}
      {contextId && (
        <details className="context-result">
          <summary>Histórico da captura</summary>
          {loadingHistory && (
            <p className="context-muted">Carregando histórico…</p>
          )}
          {historyProblem && (
            <>
              <p role="alert" className="service-error">
                {historyProblem}
              </p>
              <button
                type="button"
                className="button"
                onClick={() => fetchHistory()}
              >
                Recarregar histórico
              </button>
            </>
          )}
          {!loadingHistory && !historyProblem && !history?.items.length && (
            <p className="context-muted">
              Nenhuma consulta salva nesta captura.
            </p>
          )}
          {!!history?.items.length && (
            <ul className="context-list">
              {history.items.map((item) => (
                <li key={item.executionId}>
                  <button
                    type="button"
                    className="button codex-history-item"
                    onClick={() => openHistory(item)}
                    disabled={running || busy}
                    aria-current={
                      execution?.executionId === item.executionId
                        ? true
                        : undefined
                    }
                  >
                    {item.question}
                  </button>
                  <p className="context-muted">
                    <time dateTime={item.finishedAt}>
                      {new Date(item.finishedAt).toLocaleString("pt-BR")}
                    </time>
                    {` · ${stateLabel[item.state]} · ${modeLabel[item.mode]}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {history?.nextBefore && (
            <button
              type="button"
              className="button"
              disabled={loadingHistory}
              onClick={() => fetchHistory(history.nextBefore)}
            >
              Ver consultas anteriores
            </button>
          )}
        </details>
      )}
      {!eligible ? (
        <p>Abra uma captura com fontes preservadas no histórico.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            prepare();
          }}
        >
          <fieldset disabled={busy || running} className="codex-form">
            <legend>Selecionar fontes preservadas</legend>
            <p className="context-muted">
              {selection.length} de até {codexMaxSources} fontes ·{" "}
              {codexMaxSourceBytes / 1024} KiB de fontes por consulta · um
              arquivo inteiro ou um trecho por caminho
            </p>
            {excerpts.map((item) =>
              sourceControl(
                item,
                <>
                  <code>{item.path}</code> · Linhas {item.firstLine}–
                  {item.lastLine}
                  {item.splitLine && " · linha parcial"}
                </>,
              ),
            )}
            <details>
              <summary>Arquivos da captura</summary>
              {snapshot.entries.map(
                (entry) =>
                  entry.outcome === "included" &&
                  sourceControl(
                    { path: entry.path, sha256: entry.sha256, chunk: null },
                    <>
                      <code>{entry.path}</code> · {entry.size} bytes
                    </>,
                  ),
              )}
            </details>
            <label htmlFor="codex-question">Pergunta</label>
            <textarea
              id="codex-question"
              rows={3}
              required
              maxLength={codexMaxQuestionBytes}
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
                setPreview(undefined);
              }}
            />
            <div>
              <button
                className="button"
                type="submit"
                disabled={!selection.length || !isCodexQuestion(question)}
              >
                Preparar prévia
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {preview && (
        <section className="context-result" aria-labelledby="codex-preview">
          <h4 id="codex-preview" ref={heading} tabIndex={-1}>
            Prévia da consulta
          </h4>
          <p>
            Destino{" "}
            <strong>
              {preview.mode === "mock_development"
                ? "Mock local"
                : "OpenAI Codex"}
            </strong>{" "}
            · Projeto <strong>{projectName}</strong>
          </p>
          <p>{modeLabel[preview.mode]}</p>
          <p>
            Captura <code>{preview.contextId}</code> ·{" "}
            <time dateTime={preview.capturedAt}>
              {new Date(preview.capturedAt).toLocaleString("pt-BR")}
            </time>
          </p>
          <p>
            SHA-256 da captura <code>{preview.snapshotDigest}</code>
          </p>
          <p>
            {preview.sourceBytes} bytes de fontes · {preview.promptBytes} bytes
            de entrada
            {preview.mode !== "mock_development" && (
              <>
                {" "}
                · sessão efêmera · somente leitura · sem escalonamento · até{" "}
                {codexTimeoutMs / 1000} s
              </>
            )}
          </p>
          <p>
            Pergunta <strong>{preview.question}</strong>
          </p>
          <h5>Fontes autorizáveis e verificadas pelo Laplace</h5>
          <ul className="context-list">
            {preview.sources.map(
              ({ id, path, range, sentSha256, sha256, bytes }) => (
                <li key={id}>
                  <code>{path}</code> ·{" "}
                  {range
                    ? `Linhas ${range.firstLine}–${range.lastLine}${range.splitLine ? " · linha parcial" : ""}`
                    : "Arquivo inteiro"}{" "}
                  · {bytes} bytes
                  <div className="context-muted">
                    {id} · SHA-256 da fonte <code>{sha256}</code>
                  </div>
                  {sentSha256 !== sha256 && (
                    <div className="context-muted">
                      SHA-256 do trecho <code>{sentSha256}</code>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
          {preview.omissions.length > 0 && (
            <details>
              <summary>Omissões ({preview.omissions.length})</summary>
              <ul className="context-list">
                {preview.omissions.map(({ path, reason }) => (
                  <li key={path}>
                    <code>{path}</code> ·{" "}
                    {
                      {
                        not_selected: "Fora da seleção",
                        outside_excerpt: "Bytes fora do trecho",
                        snapshot_omission: "Omitido na captura",
                      }[reason]
                    }
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="context-toolbar">
            <button
              className="button primary"
              disabled={
                !ready ||
                status?.mode !== preview.mode ||
                checking ||
                busy ||
                running ||
                usedGrant === preview.grantId
              }
              onClick={start}
            >
              {preview.mode === "mock_development"
                ? "Executar simulação"
                : "Autorizar e consultar"}
            </button>
            {running && (
              <button className="button" disabled={cancelling} onClick={cancel}>
                {cancelling ? "Cancelando…" : "Cancelar consulta"}
              </button>
            )}
          </div>
          <p className="context-muted">
            Pergunta e resposta ficam salvas neste dispositivo após a consulta.
          </p>
        </section>
      )}
      {problem && (
        <p role="alert" className="service-error">
          {problem}
        </p>
      )}
      {display && (
        <CodexResponse
          key={display.execution.executionId}
          client={client}
          {...display}
          events={events}
          saved={saved}
          trackingInterrupted={trackingInterrupted}
          onCreateTask={onCreateTask}
        />
      )}
    </section>
  );
}
