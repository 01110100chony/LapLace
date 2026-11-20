import {
  isContextPath,
  maxContextFiles,
  type ContextBrowse,
  type ContextHistory,
  type ContextIssue,
  type ContextSnapshot,
  type ContextStatus,
  type OmissionReason,
} from "@laplace/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { type createDesktopClient, errorMessage } from "./ipc";
import { createLatestRequest } from "./workspace";

type Client = ReturnType<typeof createDesktopClient>["context"];
type Load<T> =
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "error"; message: string };

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
});
const statuses: Record<ContextStatus, string> = {
  complete: "Válida",
  partial: "Parcial",
  invalidated: "Invalidada",
};
const issues: Record<ContextIssue, string> = {
  repository_changed:
    "O estado do Git mudou ou deixou de estar disponível durante a captura.",
  timeout: "O tempo de leitura da captura se esgotou.",
  source_changed: "Uma fonte mudou durante a captura.",
};
const omissions: Record<OmissionReason, string> = {
  excluded: "Excluído pela política de captura.",
  sensitive_path: "Caminho sensível.",
  linked_path: "Link ou redirecionamento de caminho.",
  nested_project: "Pertence a outro checkout ou aos dados do aplicativo.",
  not_file: "O caminho não indica um arquivo regular.",
  missing: "O arquivo não estava disponível no início da leitura.",
  unreadable: "O arquivo não pôde ser lido.",
  too_large: "O arquivo excede o limite individual.",
  total_limit: "O arquivo excederia o limite total de bytes.",
  binary: "O arquivo é binário ou usa outra codificação.",
  changed: "O arquivo mudou ou foi removido durante a leitura.",
  duplicate_path: "A seleção já contém esse arquivo.",
  capture_invalidated: "Os bytes foram descartados com a captura.",
};

function ContextTime({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))}</time>;
}

function SnapshotDetail({
  snapshot,
  validate,
}: {
  snapshot: ContextSnapshot;
  validate: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [snapshot.contextId]);

  return (
    <>
      <header className="section-heading">
        <h3 ref={heading} id="context-result" tabIndex={-1}>
          Captura {statuses[snapshot.status].toLowerCase()}
        </h3>
        {snapshot.status !== "invalidated" && (
          <button className="button" onClick={validate}>
            Comparar com estado atual
          </button>
        )}
      </header>
      {snapshot.issue && (
        <p className="service-error" role="status">
          {issues[snapshot.issue]} Faça uma nova tentativa para preservar os
          bytes.
        </p>
      )}
      <dl className="repo-info context-metadata">
        <div>
          <dt>Concluída</dt>
          <dd>
            <ContextTime value={snapshot.completedAt} />
          </dd>
        </div>
        <div>
          <dt>Branch observada</dt>
          <dd>
            <code>{snapshot.branch ?? "HEAD destacado"}</code>
          </dd>
        </div>
        <div>
          <dt>HEAD observado</dt>
          <dd>
            {snapshot.head ? <code>{snapshot.head}</code> : "Sem commits"}
          </dd>
        </div>
        <div>
          <dt>Raiz observada</dt>
          <dd>
            <code>{snapshot.gitRoot}</code>
          </dd>
        </div>
        <div>
          <dt>SHA-256 do manifesto</dt>
          <dd>
            <code>{snapshot.digest}</code>
          </dd>
        </div>
      </dl>
    </>
  );
}

export function ContextView({
  projectId,
  client,
}: {
  projectId: string;
  client: Client;
}) {
  const [browse, setBrowse] = useState<Load<ContextBrowse>>({
    state: "loading",
  });
  const [history, setHistory] = useState<Load<ContextHistory>>({
    state: "loading",
  });
  const [folder, setFolder] = useState("");
  const [prefix, setPrefix] = useState("");
  const [manual, setManual] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<ContextSnapshot>();
  const [busy, setBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [requests] = useState(() => ({
    browse: createLatestRequest(),
    history: createLatestRequest(),
    detail: createLatestRequest(),
    capture: createLatestRequest(),
    validation: createLatestRequest(),
  }));

  const readFolder = useCallback(
    (next: string, filter = "") => {
      setFolder(next);
      setPrefix(filter);
      setBrowse({ state: "loading" });
      void requests.browse.run(
        () => client.browse(projectId, next, filter),
        (data) => setBrowse({ state: "ready", data }),
        (error) => setBrowse({ state: "error", message: errorMessage(error) }),
      );
    },
    [client, projectId, requests],
  );

  const readHistory = useCallback(
    (before: string | null = null) => {
      setHistory({ state: "loading" });
      void requests.history.run(
        () => client.list(projectId, before),
        (data) => setHistory({ state: "ready", data }),
        (error) => setHistory({ state: "error", message: errorMessage(error) }),
      );
    },
    [client, projectId, requests],
  );

  useEffect(() => {
    readFolder("");
    readHistory();
    return () =>
      Object.values(requests).forEach((request) => request.invalidate());
  }, [readFolder, readHistory, requests]);

  function toggle(path: string) {
    setSelected((items) =>
      items.includes(path)
        ? items.filter((item) => item !== path)
        : items.length < maxContextFiles
          ? [...items, path]
          : items,
    );
  }

  function capture() {
    if (!selected.length || busy) return;
    requests.detail.invalidate();
    requests.validation.invalidate();
    setDetailBusy(false);
    setBusy(true);
    setProblem("");
    setMessage("");
    void requests.capture.run(
      () => client.capture(projectId, selected),
      (data) => {
        setBusy(false);
        setSnapshot(data);
        readHistory();
      },
      (error) => {
        setBusy(false);
        setProblem(errorMessage(error));
      },
    );
  }

  function open(contextId: string) {
    requests.validation.invalidate();
    setMessage("");
    setProblem("");
    setDetailBusy(true);
    void requests.detail.run(
      () => client.get(projectId, contextId),
      (data) => {
        setSnapshot(data);
        setDetailBusy(false);
      },
      (error) => {
        setProblem(errorMessage(error));
        setDetailBusy(false);
      },
    );
  }

  function validate() {
    if (!snapshot || busy || detailBusy) return;
    setMessage("Comparando com o estado atual…");
    setProblem("");
    void requests.validation.run(
      () => client.validate(projectId, snapshot.contextId),
      (result) => {
        const states = {
          matches: "A seleção e o estado Git correspondem à captura.",
          differs: "A seleção ou o estado Git difere da captura histórica.",
          inconclusive:
            "O estado mudou durante a verificação. Tente novamente.",
        };
        setMessage(
          `${states[result.state]} ${dateFormat.format(new Date(result.checkedAt))}`,
        );
      },
      (error) => {
        setMessage("");
        setProblem(errorMessage(error));
      },
    );
  }

  return (
    <section aria-labelledby="context-heading">
      <h2 id="context-heading">Contexto</h2>
      <div className="context-grid">
        <section className="panel" aria-labelledby="context-sources">
          <h3 id="context-sources">Fontes da árvore de trabalho</h3>
          <div className="context-toolbar">
            {folder && (
              <button
                className="button"
                onClick={() =>
                  readFolder(folder.split("/").slice(0, -1).join("/"))
                }
              >
                Pasta acima
              </button>
            )}
            <code>{folder || "/"}</code>
          </div>
          <form
            className="context-form"
            onSubmit={(event) => {
              event.preventDefault();
              readFolder(folder, prefix);
            }}
          >
            <label htmlFor="context-prefix">Filtrar por início do nome</label>
            <input
              id="context-prefix"
              value={prefix}
              maxLength={128}
              onChange={(event) => setPrefix(event.target.value)}
            />
            <button className="button">Filtrar</button>
          </form>
          {browse.state === "loading" && (
            <p role="status" className="empty">
              Carregando fontes…
            </p>
          )}
          {browse.state === "error" && (
            <p className="service-error" role="alert">
              {browse.message}{" "}
              <button
                className="text-button"
                onClick={() => readFolder(folder, prefix)}
              >
                Tentar novamente
              </button>
            </p>
          )}
          {browse.state === "ready" && (
            <fieldset className="context-files">
              <legend>Arquivos e pastas desta pasta</legend>
              {browse.data.items.length === 0 && (
                <p className="empty">Nenhuma fonte disponível.</p>
              )}
              {browse.data.items.map(({ path, kind }) =>
                kind === "folder" ? (
                  <button
                    className="text-button context-file"
                    key={path}
                    onClick={() => readFolder(path)}
                  >
                    {path.split("/").at(-1)}/
                  </button>
                ) : (
                  <label className="context-file" key={path}>
                    <input
                      type="checkbox"
                      checked={selected.includes(path)}
                      disabled={
                        busy ||
                        (selected.length >= maxContextFiles &&
                          !selected.includes(path))
                      }
                      onChange={() => toggle(path)}
                    />
                    <span>{path.split("/").at(-1)}</span>
                  </label>
                ),
              )}
              {browse.data.limited && (
                <p className="empty">
                  Limite da listagem atingido. Filtre por nome ou informe o
                  caminho.
                </p>
              )}
            </fieldset>
          )}
          <form
            className="context-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                isContextPath(manual) &&
                !selected.includes(manual) &&
                selected.length < maxContextFiles
              ) {
                toggle(manual);
                setManual("");
              }
            }}
          >
            <label htmlFor="context-manual">Caminho relativo (use /)</label>
            <input
              id="context-manual"
              value={manual}
              maxLength={384}
              onChange={(event) => setManual(event.target.value)}
            />
            <button
              className="button"
              disabled={
                busy ||
                !isContextPath(manual) ||
                selected.includes(manual) ||
                selected.length >= maxContextFiles
              }
            >
              Selecionar
            </button>
          </form>
          <details className="context-selection">
            <summary>
              {selected.length} de {maxContextFiles} arquivos selecionados
            </summary>
            {selected.length > 0 && (
              <ul className="context-list">
                {selected.map((path) => (
                  <li className="context-toolbar" key={path}>
                    <code>{path}</code>
                    <button
                      className="text-button"
                      aria-label={`Remover ${path}`}
                      disabled={busy}
                      onClick={() => toggle(path)}
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>
          <button
            className="button primary"
            disabled={busy || !selected.length}
            onClick={capture}
          >
            Capturar contexto
          </button>
          {busy && (
            <p className="empty" role="status">
              Capturando e verificando os arquivos…
            </p>
          )}
        </section>
        <section className="panel" aria-labelledby="context-history">
          <h3 id="context-history">Histórico de capturas</h3>
          {history.state === "loading" && (
            <p className="empty" role="status">
              Carregando histórico…
            </p>
          )}
          {history.state === "error" && (
            <p className="service-error" role="alert">
              {history.message}{" "}
              <button className="text-button" onClick={() => readHistory()}>
                Tentar novamente
              </button>
            </p>
          )}
          {history.state === "ready" && (
            <>
              {history.data.items.length ? (
                <ul className="context-list">
                  {history.data.items.map((item) => (
                    <li key={item.contextId}>
                      <button
                        className="context-history-row"
                        disabled={busy}
                        aria-current={
                          snapshot?.contextId === item.contextId || undefined
                        }
                        onClick={() => open(item.contextId)}
                      >
                        <span>
                          <ContextTime value={item.completedAt} /> ·{" "}
                          {statuses[item.status]}
                        </span>
                        <small>
                          {item.head ? (
                            <code>{item.head.slice(0, 12)}</code>
                          ) : (
                            "Sem commits"
                          )}{" "}
                          · {item.included} fontes
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">Nenhuma captura salva neste projeto.</p>
              )}
              <div className="context-toolbar">
                <button className="text-button" onClick={() => readHistory()}>
                  Mais recentes
                </button>
                {history.data.nextBefore && (
                  <button
                    className="text-button"
                    onClick={() => readHistory(history.data.nextBefore)}
                  >
                    Mais antigas
                  </button>
                )}
              </div>
            </>
          )}
          {detailBusy && (
            <p className="empty" role="status">
              Abrindo captura…
            </p>
          )}
        </section>
      </div>
      {problem && (
        <p className="error-banner" role="alert">
          {problem}
        </p>
      )}
      {snapshot && (
        <section
          className="panel context-result"
          aria-labelledby="context-result"
        >
          <SnapshotDetail snapshot={snapshot} validate={validate} />
          {message && (
            <p className="observed" role="status">
              {message}
            </p>
          )}
          <h4>
            {snapshot.included} incluídos · {snapshot.omitted} omitidos
          </h4>
          <ul className="context-list context-entries">
            {snapshot.entries.map((entry) => (
              <li key={entry.path}>
                <strong>
                  <code>
                    {entry.outcome === "included"
                      ? entry.canonicalPath
                      : entry.path}
                  </code>
                </strong>
                {entry.outcome === "omitted" ? (
                  <p>Omitido · {omissions[entry.reason]}</p>
                ) : (
                  <>
                    <p>
                      Árvore de trabalho ·{" "}
                      {entry.index.length
                        ? "Rastreado no índice"
                        : "Sem entrada no índice"}{" "}
                      · {entry.size} B
                    </p>
                    <p>
                      SHA-256 <code>{entry.sha256}</code>
                    </p>
                    {entry.index.length > 0 && (
                      <details>
                        <summary>Versões no índice</summary>
                        <ul className="context-list">
                          {entry.index.map((stage) => (
                            <li key={stage.stage}>
                              Estágio {stage.stage} · <code>{stage.oid}</code>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
