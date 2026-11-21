import {
  type CodexCitation,
  type CodexEvent,
  type CodexExecution,
  type CodexMode,
  type TaskSource,
} from "@laplace/contracts";
import { useEffect, useRef, useState } from "react";
import { errorMessage, type createDesktopClient } from "./ipc";
import { createLatestRequest } from "./workspace";

type Client = ReturnType<typeof createDesktopClient>["codex"];
type Message = Extract<CodexEvent, { type: "message" }>;

export const modeLabel: Record<CodexMode, string> = {
  verified_isolated: "Modo isolado",
  mock_development: "Mock de desenvolvimento",
  unconfined_workspace_development: "Codex real em Workspace Dev",
};
export const stateLabel = {
  running: "Consulta em andamento",
  completed: "Consulta concluída",
  failed: "Falha na consulta",
  cancelled: "Consulta cancelada",
  interrupted: "Consulta interrompida",
  timeout: "Tempo da consulta esgotado",
};
const failures = {
  launch_failed: "Falha ao iniciar o processo.",
  authentication_failed: "A autenticação da consulta falhou.",
  provider_failed: "O CLI ou o provedor reportou uma falha.",
  protocol_error: "O fluxo JSONL terminou sem indicar uma resposta completa.",
  output_limit: "O fluxo excedeu o limite de saída.",
  workspace_failed: "Falha ao preparar a área temporária.",
};

function ResponseMessage({
  text,
  citations,
  open,
}: Message & {
  open: (id: string) => Promise<CodexCitation>;
}) {
  const [request] = useState(createLatestRequest);
  const [preview, setPreview] = useState<CodexCitation>();
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => () => request.invalidate(), [request]);

  function read(sourceId: string, button: HTMLButtonElement) {
    trigger.current = button;
    setPreview(undefined);
    setProblem("");
    setLoading(true);
    void request.run(
      () => open(sourceId),
      (citation) => {
        setPreview(citation);
        setLoading(false);
      },
      (error) => {
        setProblem(errorMessage(error));
        setLoading(false);
      },
    );
  }

  return (
    <div>
      <pre className="codex-message">{text}</pre>
      {citations && (
        <>
          {citations.sources.length > 0 && (
            <ul className="context-list" aria-label="Fontes citadas">
              {citations.sources.map(({ id, path, verified }) => (
                <li key={id}>
                  {verified ? (
                    <button
                      type="button"
                      className="button codex-history-item"
                      onClick={(event) => read(id, event.currentTarget)}
                    >
                      Abrir fonte verificada · [{id}] · <code>{path}</code>
                    </button>
                  ) : (
                    <p>
                      Fonte indisponível na captura · <code>{path}</code>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {citations.hasUnknown && (
            <p className="context-muted">
              A resposta cita uma fonte ausente da seleção autorizada.
            </p>
          )}
          {!citations.sources.length && !citations.hasUnknown && (
            <p className="context-muted">Resposta sem citações.</p>
          )}
        </>
      )}
      {loading && <p className="context-muted">Abrindo fonte preservada…</p>}
      {problem && (
        <p role="alert" className="service-error">
          {problem}
        </p>
      )}
      {preview && (
        <div className="context-result">
          <p role="status">
            <code>{preview.source.path}</code> ·{" "}
            {preview.source.range
              ? `Linhas ${preview.source.range.firstLine}–${preview.source.range.lastLine}${preview.source.range.splitLine ? " · linha parcial" : ""}`
              : "Arquivo inteiro"}
          </p>
          <pre className="codex-message">{preview.text}</pre>
          <p className="context-muted">
            SHA-256 <code>{preview.source.sentSha256}</code>
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              setPreview(undefined);
              trigger.current?.focus();
            }}
          >
            Fechar fonte
          </button>
        </div>
      )}
    </div>
  );
}

export function CodexResponse({
  client,
  execution,
  events,
  question,
  fromHistory,
  saved,
  trackingInterrupted,
  onCreateTask,
}: {
  client: Client;
  execution: CodexExecution;
  events: CodexEvent[];
  question: string;
  fromHistory: boolean;
  saved: boolean | undefined;
  trackingInterrupted: boolean;
  onCreateTask: (source: TaskSource, question: string) => void;
}) {
  const { mode } = execution;
  const simulated = mode === "mock_development";
  const terminal = events.find((item) => item.type === "terminal");
  const session = events.find((item) => item.type === "session");
  const notices = events.filter((item) => item.type === "notice").length;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (fromHistory) heading.current?.focus();
  }, [fromHistory]);
  return (
    <section className="context-result" aria-labelledby="codex-response">
      <h4 id="codex-response" ref={heading} tabIndex={-1}>
        {simulated ? "Resposta simulada" : "Resposta do Codex"}
      </h4>
      <p className="codex-history-item">
        <strong>{question}</strong>
      </p>
      <p className="context-muted">
        {modeLabel[mode]}
        {mode === "unconfined_workspace_development" &&
          " · Isolamento de leitura não verificado"}
      </p>
      <p role="status">
        {terminal
          ? stateLabel[terminal.state]
          : trackingInterrupted
            ? "Acompanhamento da consulta interrompido"
            : fromHistory
              ? "Abrindo consulta salva…"
              : events.some((event) => event.type === "progress")
                ? "Processando a pergunta…"
                : "Consulta autorizada. Iniciando…"}
      </p>
      {terminal?.failure && (
        <p className="service-error">{failures[terminal.failure]}</p>
      )}
      {saved === false && (
        <p role="alert" className="service-error">
          A consulta não pôde ser salva no histórico.
        </p>
      )}
      {events
        .filter((item) => item.type === "message")
        .map((item) => (
          <ResponseMessage
            key={item.seq}
            {...item}
            open={(id) => client.citation(execution, id)}
          />
        ))}
      {saved && terminal?.state === "completed" && (
        <div className="context-toolbar">
          <button
            className="button"
            type="button"
            onClick={() =>
              onCreateTask(
                {
                  contextId: execution.contextId,
                  executionId: execution.executionId,
                },
                question,
              )
            }
          >
            Criar tarefa desta consulta
          </button>
        </div>
      )}
      <details>
        <summary>Dados da execução</summary>
        {session && (
          <p>
            {simulated ? "Sessão simulada" : "Sessão do provedor"}{" "}
            <code>{session.sessionId}</code>
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
