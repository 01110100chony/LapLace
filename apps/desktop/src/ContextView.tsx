import {
  isContextPath,
  maxContextFiles,
  type ContextBrowse,
  type ContextHistory,
  type ContextIssue,
  type ContextSnapshot,
  type ContextSourcePreview,
  type ContextStatus,
  type TaskSource,
} from "@laplace/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { type createDesktopClient, errorMessage } from "./ipc";
import { createLatestRequest } from "./workspace";
import { CodexQueryView } from "./CodexQueryView";
import { ContextSearchView } from "./ContextSearchView";
import { omissionLabels } from "./contextLabels";
import { EmptyState, WorkDisclosure, WorkHeading } from "./WorkView";
import { VisualIcon } from "./VisualIcon";

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

function ContextTime({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))}</time>;
}

function SnapshotDetail({
  snapshot,
  validate,
  focusHeading,
  checking,
}: {
  snapshot: ContextSnapshot;
  focusHeading: boolean;
  checking: boolean;
  validate: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading, snapshot.contextId]);

  return (
    <>
      <header className="section-heading">
        <h3 ref={heading} id="context-result" tabIndex={-1}>
          Captura {statuses[snapshot.status].toLowerCase()}
        </h3>
        {snapshot.status !== "invalidated" && (
          <button className="button" disabled={checking} onClick={validate}>
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
  projectName,
  client,
  codex,
  onCreateTask,
  openMemory,
}: {
  projectId: string;
  projectName: string;
  client: Client;
  codex: ReturnType<typeof createDesktopClient>["codex"];
  onCreateTask: (source: TaskSource, question: string) => void;
  openMemory: () => void;
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
  const [excerpts, setExcerpts] = useState<ContextSourcePreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [focusCapture, setFocusCapture] = useState(true);
  const [providerActivated, setProviderActivated] = useState(false);
  const sourcesPanel = useRef<HTMLDetailsElement>(null);
  const providerPanel = useRef<HTMLDetailsElement>(null);
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
    setValidating(false);
    setDetailBusy(false);
    setBusy(true);
    setProblem("");
    setMessage("");
    void requests.capture.run(
      () => client.capture(projectId, selected),
      (data) => {
        setBusy(false);
        setFocusCapture(true);
        setSnapshot(data);
        setExcerpts([]);
        readHistory();
      },
      (error) => {
        setBusy(false);
        setProblem(errorMessage(error));
      },
    );
  }

  function open(contextId: string, excerpt?: ContextSourcePreview) {
    requests.validation.invalidate();
    setValidating(false);
    setMessage("");
    setProblem("");
    setDetailBusy(true);
    void requests.detail.run(
      () => client.get(projectId, contextId),
      (data) => {
        setFocusCapture(!excerpt);
        setSnapshot(data);
        setExcerpts((old) =>
          excerpt
            ? [
                ...old.filter(
                  (item) =>
                    item.contextId === contextId &&
                    (item.path !== excerpt.path ||
                      item.chunk !== excerpt.chunk),
                ),
                excerpt,
              ].slice(-8)
            : [],
        );
        setDetailBusy(false);
        if (excerpt) openDisclosure(providerPanel.current);
      },
      (error) => {
        setProblem(errorMessage(error));
        setDetailBusy(false);
      },
    );
  }

  function validate() {
    if (!snapshot || busy || detailBusy || validating) return;
    setValidating(true);
    setMessage("Comparando com o estado atual…");
    setProblem("");
    void requests.validation.run(
      () => client.validate(projectId, snapshot.contextId),
      (result) => {
        setValidating(false);
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
        setValidating(false);
        setMessage("");
        setProblem(errorMessage(error));
      },
    );
  }

  function openDisclosure(disclosure: HTMLDetailsElement | null) {
    if (!disclosure) return;
    disclosure.open = true;
    disclosure.querySelector("summary")?.focus();
  }

  return (
    <section
      className="investigation-surface"
      aria-labelledby="context-heading"
    >
      <WorkHeading
        id="context-heading"
        title="Arquivos e capturas"
        icon="archive"
        actions={
          <button
            className="button"
            aria-controls="context-source-picker"
            onClick={() => openDisclosure(sourcesPanel.current)}
          >
            <VisualIcon name="folder" /> Selecionar fontes
          </button>
        }
      />
      {problem && (
        <p className="error-banner" role="alert">
          {problem}
        </p>
      )}
      <div className="work-grid investigation-grid">
        <div className="work-stack investigation-sheet">
          <ContextSearchView
            key={`${projectId}/${snapshot?.contextId ?? ""}`}
            projectId={projectId}
            client={client}
            selected={snapshot}
            onOfferExcerpt={(excerpt) => open(excerpt.contextId, excerpt)}
          />
        </div>
        <aside
          className="work-stack investigation-inspector"
          aria-label="Fontes e proveniência"
        >
          {snapshot && (
            <section
              className="panel context-result"
              aria-labelledby="context-result"
            >
              <SnapshotDetail
                snapshot={snapshot}
                validate={validate}
                focusHeading={focusCapture}
                checking={busy || detailBusy || validating}
              />
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
                      <p>Omitido · {omissionLabels[entry.reason]}</p>
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
                                  Estágio {stage.stage} ·{" "}
                                  <code>{stage.oid}</code>
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

          <section
            className="panel capture-history"
            aria-labelledby="context-history"
          >
            <header className="work-panel-heading">
              <h3 id="context-history">Capturas</h3>
            </header>
            {history.state === "loading" && (
              <p className="work-message" role="status">
                Carregando histórico…
              </p>
            )}
            {history.state === "error" && (
              <p className="work-message" role="alert">
                {history.message}{" "}
                <button className="text-button" onClick={() => readHistory()}>
                  Tentar novamente
                </button>
              </p>
            )}
            {history.state === "ready" && (
              <>
                {history.data.items.length ? (
                  <ul className="work-list">
                    {history.data.items.map((item) => (
                      <li key={item.contextId}>
                        <button
                          className="work-list-row"
                          disabled={busy}
                          aria-current={
                            snapshot?.contextId === item.contextId || undefined
                          }
                          onClick={() => open(item.contextId)}
                        >
                          <VisualIcon name="archive" />
                          <span className="work-row-copy">
                            <strong>
                              {statuses[item.status]} · {item.included} fontes
                            </strong>
                            <small>
                              <ContextTime value={item.completedAt} /> ·{" "}
                              {item.head ? (
                                <code title={item.head}>
                                  {item.head.slice(0, 12)}
                                </code>
                              ) : (
                                "Sem commits"
                              )}
                            </small>
                          </span>
                          <VisualIcon name="chevron" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon="archive" title="Nenhuma captura salva">
                    Selecione fontes para preservar uma primeira leitura.
                  </EmptyState>
                )}
                <div className="context-toolbar">
                  <button className="text-button" onClick={() => readHistory()}>
                    Atualizar histórico
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
              <p className="work-message" role="status">
                Abrindo captura…
              </p>
            )}
          </section>
          <WorkDisclosure
            ref={sourcesPanel}
            id="context-source-picker"
            icon="folder"
            title="Fontes da árvore de trabalho"
            detail={
              selected.length
                ? `${selected.length} arquivos selecionados`
                : undefined
            }
          >
            <div className="source-picker">
              <div className="source-directory">
                {folder && (
                  <button
                    className="button"
                    onClick={() =>
                      readFolder(folder.split("/").slice(0, -1).join("/"))
                    }
                  >
                    <VisualIcon name="back" /> Pasta acima
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
                <label htmlFor="context-prefix">
                  Filtrar por início do nome
                </label>
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
                        <VisualIcon name="folder" />
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
              <div className="source-tools">
                <details>
                  <summary>Adicionar pelo caminho</summary>
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
                    <label htmlFor="context-manual">
                      Caminho relativo (use /)
                    </label>
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
                </details>
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
              </div>
              <button
                className="button primary"
                disabled={busy || !selected.length}
                onClick={capture}
              >
                <VisualIcon name="archive" /> Capturar contexto
              </button>
              {busy && (
                <p className="empty" role="status">
                  Capturando e verificando os arquivos…
                </p>
              )}
            </div>
          </WorkDisclosure>
          <WorkDisclosure
            ref={providerPanel}
            icon="search"
            title="Consulta com Codex"
            detail="Verificar provedor e revisar fontes"
            onOpen={() => setProviderActivated(true)}
          >
            {providerActivated && (
              <CodexQueryView
                key={`${projectId}/${snapshot?.contextId ?? ""}`}
                projectId={projectId}
                projectName={projectName}
                client={codex}
                onCreateTask={onCreateTask}
                snapshot={snapshot}
                excerpts={excerpts}
              />
            )}
          </WorkDisclosure>
          <button type="button" className="desk-link" onClick={openMemory}>
            <VisualIcon name="archive" /> Memória · prévia{" "}
            <VisualIcon name="chevron" />
          </button>
        </aside>
      </div>
    </section>
  );
}
