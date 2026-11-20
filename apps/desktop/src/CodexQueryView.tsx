import {
  codexMaxQuestionBytes,
  codexMaxSourceBytes,
  codexMaxSources,
  codexTimeoutMs,
  isCodexQuestion,
  type CodexEvent,
  type CodexExecution,
  type CodexPreview,
  type CodexSelection,
  type CodexStatus,
  type ContextSnapshot,
  type ContextSourcePreview,
} from "@laplace/contracts";
import { useEffect, useRef, useState } from "react";
import { DesktopError, errorMessage, type createDesktopClient } from "./ipc";
import { createLatestRequest } from "./workspace";

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
};
const stateLabel = {
  running: "Consulta em andamento",
  completed: "Consulta concluída",
  failed: "Falha na consulta",
  cancelled: "Consulta cancelada",
  interrupted: "Consulta interrompida",
  timeout: "Tempo da consulta esgotado",
};
const failures = {
  launch_failed: "Falha ao iniciar o processo.",
  provider_failed: "O CLI ou o provedor reportou uma falha.",
  protocol_error: "O fluxo JSONL terminou sem indicar uma resposta completa.",
  output_limit: "O fluxo excedeu o limite de saída.",
  workspace_failed: "Falha ao preparar a área temporária.",
};

function ExecutionProgress({ events }: { events: CodexEvent[] }) {
  const terminal = events.find((item) => item.type === "terminal");
  const session = events.find((item) => item.type === "session");
  const notices = events.filter((item) => item.type === "notice").length;
  return (
    <section className="context-result" aria-labelledby="codex-response">
      <h4 id="codex-response">Resposta gerada pelo Codex</h4>
      <p role="status">
        {terminal
          ? stateLabel[terminal.state]
          : events.some((event) => event.type === "progress")
            ? "Processando a pergunta…"
            : "Iniciando consulta…"}
      </p>
      {terminal?.failure && (
        <p className="service-error">{failures[terminal.failure]}</p>
      )}
      {events
        .filter((item) => item.type === "message")
        .map(({ seq, text }) => (
          <pre key={seq} className="codex-message">
            {text}
          </pre>
        ))}
      <p className="context-muted">
        As afirmações e referências no texto são do modelo. O Laplace verifica a
        origem das fontes na prévia.
      </p>
      <details>
        <summary>Dados da execução</summary>
        {session && (
          <p>
            Sessão do provedor <code>{session.sessionId}</code>
          </p>
        )}
        {notices > 0 && <p>Eventos ignorados pelo adaptador: {notices}</p>}
        {events
          .filter((item) => item.type === "usage")
          .map(({ seq, input, cachedInput, output }) => (
            <p key={seq}>
              {input} tokens de entrada · {cachedInput} em cache · {output} de
              saída
            </p>
          ))}
      </details>
    </section>
  );
}

export function CodexQueryView({
  projectId,
  projectName,
  client,
  snapshot,
  excerpts,
}: {
  projectId: string;
  projectName: string;
  client: Client;
  snapshot: ContextSnapshot | undefined;
  excerpts: ContextSourcePreview[];
}) {
  const [status, setStatus] = useState<CodexStatus>();
  const [checking, setChecking] = useState(false);
  const [selection, setSelection] = useState<CodexSelection[]>([]);
  const [question, setQuestion] = useState("");
  const [preview, setPreview] = useState<CodexPreview>();
  const [execution, setExecution] = useState<CodexExecution>();
  const [events, setEvents] = useState<CodexEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState("");
  const [requests] = useState(() => ({
    status: createLatestRequest(),
    prepare: createLatestRequest(),
    start: createLatestRequest(),
  }));
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const run = useRef<CodexExecution | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      Object.values(requests).forEach((request) => request.invalidate());
      if (run.current) void client.cancel(run.current).catch(() => {});
    };
  }, [client, requests]);

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
          run.current = null;
        }
      } catch (error) {
        if (disposed) return;
        void client.cancel(current).catch(() => {});
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
  }, [client, execution]);

  function check() {
    setChecking(true);
    setProblem("");
    void requests.status.run(
      () => client.status(projectId),
      (data) => {
        setStatus(data);
        setChecking(false);
      },
      (error) => {
        setChecking(false);
        setProblem(errorMessage(error));
      },
    );
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
    if (!preview || busy || running || status?.state !== "ready") return;
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
        setExecution(data);
        setEvents([]);
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
    <section className="panel context-search" aria-labelledby="codex-query">
      <div className="section-heading">
        <h3 id="codex-query">Consultar com Codex</h3>
        <button
          className="button"
          onClick={check}
          disabled={checking || busy || running}
        >
          Verificar Codex CLI
        </button>
      </div>
      <p role="status" className="context-muted">
        {checking
          ? "Verificando o Codex CLI…"
          : status
            ? [
                status.version && `Codex CLI ${status.version}`,
                availability[status.state],
              ]
                .filter(Boolean)
                .join(" · ")
            : "Verifique a disponibilidade do Codex CLI antes de enviar."}
      </p>
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
            Prévia do envio
          </h4>
          <p>
            Destino <strong>OpenAI Codex</strong> · Projeto{" "}
            <strong>{projectName}</strong>
          </p>
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
            de entrada · sessão efêmera · somente leitura · sem escalonamento ·
            até {codexTimeoutMs / 1000} s
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
                status?.state !== "ready" ||
                busy ||
                running ||
                execution?.manifestDigest === preview.manifestDigest
              }
              onClick={start}
            >
              Autorizar e consultar
            </button>
            {running && (
              <button className="button" disabled={cancelling} onClick={cancel}>
                {cancelling ? "Cancelando…" : "Cancelar consulta"}
              </button>
            )}
          </div>
        </section>
      )}
      {problem && (
        <p role="alert" className="service-error">
          {problem}
        </p>
      )}
      {execution && <ExecutionProgress events={events} />}
    </section>
  );
}
