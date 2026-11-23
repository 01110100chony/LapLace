import {
  contextSearchPageSize,
  isContextSearchQuery,
  maxContextQueryBytes,
  type ContextIndexStatus,
  type ContextSearchHit,
  type ContextSearchInput,
  type ContextSearchPage,
  type ContextSourcePreview,
  type ContextSummary,
} from "@laplace/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { DesktopError, errorMessage, type createDesktopClient } from "./ipc";
import { createLatestRequest } from "./workspace";
import { VisualIcon } from "./VisualIcon";

type Client = ReturnType<typeof createDesktopClient>["context"];
const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
});

function CaptureLabel({ snapshot }: { snapshot: ContextSummary }) {
  return (
    <span title={snapshot.contextId}>
      <time dateTime={snapshot.completedAt}>
        {dateFormat.format(new Date(snapshot.completedAt))}
      </time>
      {" · "}
      <code>{snapshot.contextId.slice(0, 12)}</code>
      {snapshot.status === "partial" && " · parcial"}
    </span>
  );
}

function lines({
  firstLine,
  lastLine,
}: ContextSourcePreview | ContextSearchHit) {
  return firstLine === lastLine
    ? `Linha ${firstLine}`
    : `Linhas ${firstLine}–${lastLine}`;
}

function SourcePreview({
  data,
  snapshot,
  close,
  offer,
}: {
  data: ContextSourcePreview;
  snapshot: ContextSummary;
  close: () => void;
  offer: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [data]);
  return (
    <section
      className="context-result search-preview"
      aria-labelledby="context-preview-heading"
    >
      <header className="section-heading">
        <h4 id="context-preview-heading" ref={heading} tabIndex={-1}>
          Fonte preservada
        </h4>
        <button className="button" onClick={offer}>
          Disponibilizar trecho para consulta
        </button>
        <button className="button" onClick={close}>
          Fechar fonte
        </button>
      </header>
      <p>
        <code>{data.path}</code> · {lines(data)}
        {data.splitLine && " · linha parcial"}
      </p>
      <pre>
        <code>{data.text || "(Arquivo vazio)"}</code>
      </pre>
      <dl className="repo-info context-metadata">
        <div>
          <dt>Captura</dt>
          <dd>
            <code>{data.contextId}</code>
          </dd>
        </div>
        <div>
          <dt>HEAD observado</dt>
          <dd>
            <code>{snapshot.head ?? "Sem commits"}</code>
          </dd>
        </div>
        <div>
          <dt>SHA-256 da fonte</dt>
          <dd>
            <code>{data.sha256}</code>
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function ContextSearchView({
  projectId,
  client,
  selected,
  onOfferExcerpt,
}: {
  projectId: string;
  client: Client;
  selected: ContextSummary | undefined;
  onOfferExcerpt: (excerpt: ContextSourcePreview) => void;
}) {
  const [scope, setScope] = useState<ContextSearchInput["scope"]>(
    selected ? "snapshot" : "latest",
  );
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<ContextIndexStatus | null>();
  const [indexError, setIndexError] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [search, setSearch] = useState<{
    input: ContextSearchInput;
    page: ContextSearchPage;
  }>();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [preview, setPreview] = useState<{
    data: ContextSourcePreview;
    snapshot: ContextSummary;
  }>();
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const [requests] = useState(() => ({
    index: createLatestRequest(),
    search: createLatestRequest(),
    preview: createLatestRequest(),
  }));
  const indexTarget = scope === "latest" ? null : (selected?.contextId ?? null);

  const readIndex = useCallback(() => {
    void requests.index.run(
      () => client.indexStatus(projectId, indexTarget),
      (result) => {
        setIndex(result);
        setIndexError("");
      },
      (error) => {
        setIndex(null);
        if (!(
          error instanceof DesktopError &&
          error.code === "context_not_found" &&
          indexTarget === null
        ))
          setIndexError(errorMessage(error));
      },
    );
  }, [client, indexTarget, projectId, requests]);

  useEffect(() => {
    readIndex();
    return () => requests.index.invalidate();
  }, [readIndex, requests]);
  useEffect(
    () => () => {
      requests.search.invalidate();
      requests.preview.invalidate();
    },
    [requests],
  );

  function clearPreview() {
    requests.preview.invalidate();
    setPreview(undefined);
    setPreviewError("");
    setPreviewing(false);
  }

  function chooseScope(next: ContextSearchInput["scope"]) {
    const nextTarget = next === "latest" ? null : (selected?.contextId ?? null);
    if (indexTarget !== nextTarget) {
      requests.index.invalidate();
      setIndex(undefined);
      setIndexError("");
    }
    requests.search.invalidate();
    setSearch(undefined);
    setSearchError("");
    setSearching(false);
    clearPreview();
    setScope(next);
  }

  function runIndex() {
    if (!index?.eligible || indexing) return;
    setIndexing(true);
    setIndexError("");
    void requests.index.run(
      () => client.index(projectId, index.contextId, index.indexedAt !== null),
      (result) => {
        setIndex(result);
        setIndexing(false);
        setSearchError("");
        setSearch(undefined);
        clearPreview();
      },
      (error) => {
        setIndexError(errorMessage(error));
        setIndexing(false);
      },
    );
  }

  function runSearch(input: ContextSearchInput) {
    clearPreview();
    setSearching(true);
    setSearchError("");
    setSearch(undefined);
    void requests.search.run(
      () => client.search(projectId, input),
      (page) => {
        setSearch({ input, page });
        setSearching(false);
      },
      (error) => {
        setSearchError(errorMessage(error));
        setSearching(false);
        if (input.scope !== "history") readIndex();
      },
    );
  }

  function openSource(hit: ContextSearchHit, trigger: HTMLButtonElement) {
    previewTrigger.current = trigger;
    clearPreview();
    setPreviewing(true);
    void requests.preview.run(
      () => client.preview(projectId, hit),
      (data) => {
        setPreview({ data, snapshot: hit.snapshot });
        setPreviewing(false);
      },
      (error) => {
        setPreviewError(errorMessage(error));
        setPreviewing(false);
      },
    );
  }

  const groups = new Map<string, ContextSearchHit[]>();
  for (const hit of search?.page.items ?? []) {
    const key = `${hit.contextId}/${hit.path}`;
    const group = groups.get(key);
    if (group) group.push(hit);
    else groups.set(key, [hit]);
  }
  const indexLabel = indexTarget
    ? "Captura selecionada"
    : "Captura mais recente elegível";
  const indexMessage = indexing
    ? "Indexação em andamento…"
    : index === undefined
      ? "Consultando índice…"
      : !index
        ? "Nenhuma captura elegível."
        : !index.eligible
          ? "Captura sem fontes elegíveis."
          : index.indexedAt
            ? `Índice atualizado · ${index.files} fontes · ${index.chunks} trechos`
            : "Índice inexistente.";
  const canSearch =
    isContextSearchQuery(query) &&
    !indexing &&
    !searching &&
    (scope === "history" || !!index?.indexedAt);

  return (
    <section
      className="panel context-search"
      aria-labelledby="context-search-heading"
    >
      <header className="work-panel-heading">
        <h3 id="context-search-heading">Busca nas capturas</h3>
      </header>
      <search aria-labelledby="context-search-heading">
        <form
          className="search-controls"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSearch) return;
            const input = { query: query.trim(), offset: 0 };
            if (scope === "snapshot") {
              if (selected)
                runSearch({ ...input, scope, contextId: selected.contextId });
            } else {
              runSearch({ ...input, scope, contextId: null });
            }
          }}
          aria-labelledby="context-search-heading"
        >
          <label className="work-field">
            <span>Termos de busca</span>
            <input
              id="context-query"
              type="search"
              required
              value={query}
              maxLength={maxContextQueryBytes}
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="search"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="work-field">
            <span>Escopo</span>
            <select
              id="context-scope"
              value={scope}
              disabled={indexing}
              onChange={(event) =>
                chooseScope(event.target.value as ContextSearchInput["scope"])
              }
            >
              <option value="latest">Captura mais recente</option>
              <option value="snapshot" disabled={!selected}>
                Captura selecionada
              </option>
              <option value="history">Histórico do projeto</option>
            </select>
          </label>
          <button className="button primary" disabled={!canSearch}>
            <VisualIcon name="search" /> Pesquisar
          </button>
        </form>
      </search>
      <div className="context-toolbar index-status">
        <p className="observed" role="status">
          <span className="index-label">
            {indexLabel}
            {index && (
              <>
                {" · "}
                <code title={index.contextId}>
                  {index.contextId.slice(0, 12)}
                </code>
              </>
            )}
          </span>{" "}
          {indexMessage}
        </p>
        {index?.eligible && (
          <button
            className="button"
            disabled={indexing || searching || previewing}
            onClick={runIndex}
          >
            {index.indexedAt ? "Reindexar captura" : "Indexar captura"}
          </button>
        )}
        {indexError && !index && (
          <button className="text-button" onClick={readIndex}>
            Consultar índice novamente
          </button>
        )}
      </div>
      {indexError && (
        <p className="service-error" role="alert">
          {indexError}
        </p>
      )}
      <p className="observed" role="status">
        {searching && "Pesquisando…"}
        {search && (
          <>
            {search.page.items.length
              ? `${search.page.items.length} trechos nesta página`
              : "Nenhum trecho encontrado"}
            {" · “"}
            {search.input.query}
            {"” · "}
            {search.page.snapshot ? (
              <CaptureLabel snapshot={search.page.snapshot} />
            ) : (
              `${search.page.indexed} de ${search.page.eligible} capturas elegíveis indexadas`
            )}
          </>
        )}
      </p>
      {searchError && (
        <p className="service-error" role="alert">
          {searchError}
        </p>
      )}
      {groups.size > 0 && (
        <ul className="context-list context-search-results">
          {Array.from(groups, ([key, hits]) => {
            const first = hits[0]!;
            return (
              <li key={key} className="search-results-row">
                <h4>
                  <code>{first.path}</code>
                </h4>
                <p className="observed">
                  {first.origin === "latest"
                    ? "Captura mais recente"
                    : "Captura histórica"}{" "}
                  · <CaptureLabel snapshot={first.snapshot} />
                </p>
                <ul className="context-list">
                  {hits.map((hit) => (
                    <li key={hit.chunk}>
                      <button
                        className="text-button"
                        onClick={(event) =>
                          openSource(hit, event.currentTarget)
                        }
                        aria-label={`Abrir fonte preservada de ${hit.path}, ${lines(hit)}${hit.splitLine ? " · linha parcial" : ""}`}
                      >
                        {lines(hit)}
                        {hit.splitLine && " · linha parcial"}
                      </button>
                      <pre>
                        <code>{hit.text || "(Arquivo vazio)"}</code>
                      </pre>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      {previewing && (
        <p role="status" className="observed">
          Verificando fonte preservada…
        </p>
      )}
      {previewError && (
        <p role="alert" className="service-error">
          {previewError}
        </p>
      )}
      {preview && (
        <SourcePreview
          {...preview}
          offer={() => onOfferExcerpt(preview.data)}
          close={() => {
            clearPreview();
            previewTrigger.current?.focus();
          }}
        />
      )}
      {search && (
        <div className="context-toolbar">
          {search.input.offset > 0 && (
            <button
              className="button"
              onClick={() =>
                runSearch({
                  ...search.input,
                  offset: search.input.offset - contextSearchPageSize,
                })
              }
            >
              Página anterior
            </button>
          )}
          {search.page.nextOffset !== null && (
            <button
              className="button"
              onClick={() =>
                runSearch({ ...search.input, offset: search.page.nextOffset! })
              }
            >
              Próxima página
            </button>
          )}
        </div>
      )}
    </section>
  );
}
