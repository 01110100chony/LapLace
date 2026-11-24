import {
  workingSelectionLimit,
  type GitObservation,
  type WorkingChange,
  type WorkingComparison,
  type WorkingFile,
  type WorkingLayer,
  type WorkingList,
  type WorkingSnapshot,
  type WorkingVersion,
} from "@laplace/contracts";
import { useCallback, useEffect, useState } from "react";
import { omissionLabels } from "./contextLabels";
import { errorMessage, type createDesktopClient } from "./ipc";
import { TextComparison } from "./TextComparison";
import { createLatestRequest } from "./workspace";
import { EmptyState, WorkHeading } from "./WorkView";
import { VisualIcon } from "./VisualIcon";

type Client = ReturnType<typeof createDesktopClient>["working"];
const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
});
const layerLabels = { staged: "HEAD → Índice", unstaged: "Índice → Disco" };
const stageLabels: Record<number, string> = {
  1: "Base",
  2: "Nossa versão",
  3: "Outra versão",
};

const filterLabels = {
  all: "Todas",
  staged: "Preparadas",
  unstaged: "Não preparadas",
  untracked: "Não rastreadas",
  conflicted: "Conflitos",
} as const;
type Filter = keyof typeof filterLabels;
type ChangeKind = Exclude<Filter, "all">;
const changeLabels: Record<ChangeKind, string> = {
  staged: "Índice",
  unstaged: "Disco",
  untracked: "Não rastreado",
  conflicted: "Conflito",
};
const filters = Object.keys(filterLabels) as Filter[];

function changeKinds(change: WorkingChange): ChangeKind[] {
  if (change.kind === "untracked") return ["untracked"];
  const kinds: ChangeKind[] = [];
  if (change.kind === "conflicted") kinds.push("conflicted");
  else {
    if (change.status[0] !== ".") kinds.push("staged");
    if (change.status[1] !== ".") kinds.push("unstaged");
  }
  if (change.untracked) kinds.push("untracked");
  return kinds;
}

function FileKinds({ kinds }: { kinds: ChangeKind[] }) {
  return (
    <span className="git-file-kinds">
      {kinds.map((kind) => (
        <span className={`git-kind ${kind}`} key={kind}>
          {changeLabels[kind]}
        </span>
      ))}
    </span>
  );
}

function VersionSummary({ version }: { version: WorkingVersion }) {
  if (version.kind === "absent") return <>Arquivo ausente</>;
  return (
    <>
      {version.kind === "omitted" && omissionLabels[version.reason]}
      {version.size !== null && ` ${version.size} bytes`}
      {version.oid && (
        <>
          {" "}
          · <code title={version.oid}>{version.oid.slice(0, 12)}</code>
        </>
      )}
      {version.kind === "text" && (
        <>
          {" "}
          · SHA-256{" "}
          <code title={version.sha256}>{version.sha256.slice(0, 12)}</code>
        </>
      )}
    </>
  );
}

function WorkingDiff({
  client,
  snapshot,
  file,
}: {
  client: Client;
  snapshot: WorkingSnapshot;
  file: WorkingFile;
}) {
  const [layer, setLayer] = useState<WorkingLayer>(
    file.kind === "untracked" || file.status[0] === "." ? "unstaged" : "staged",
  );
  const [comparison, setComparison] = useState<WorkingComparison>();
  const [problem, setProblem] = useState("");
  const { projectId, snapshotId } = snapshot;
  const { path, kind } = file;

  useEffect(() => {
    if (kind === "conflicted") return;
    let cancelled = false;
    void client.compare({ projectId, snapshotId }, path, layer).then(
      (data) => {
        if (!cancelled) setComparison(data);
      },
      (error) => {
        if (!cancelled) setProblem(errorMessage(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, kind, layer, path, projectId, snapshotId]);

  return (
    <div className="working-diff git-diff work-divider">
      <div className="work-panel-heading">
        <h4>
          <code>{file.path}</code>
        </h4>
        <FileKinds kinds={changeKinds(file)} />
      </div>
      {file.from !== null && (
        <p className="context-muted">
          Origem <code>{file.from}</code>
        </p>
      )}
      {kind === "conflicted" ? (
        <>
          <p>Conflito no índice</p>
          <dl className="diff-versions">
            {file.index.map(({ stage, version }) => (
              <div key={stage}>
                <dt>{stageLabels[stage]}</dt>
                <dd>
                  <VersionSummary version={version} />
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <>
          <div className="git-filters" aria-label="Origem do diff" role="group">
            {(["staged", "unstaged"] as const).map((source) => (
              <button
                type="button"
                key={source}
                className="git-filter"
                aria-pressed={layer === source}
                onClick={() => {
                  if (source === layer) return;
                  setComparison(undefined);
                  setProblem("");
                  setLayer(source);
                }}
              >
                {layerLabels[source]}
              </button>
            ))}
          </div>
          {problem && (
            <p className="work-message" role="alert">
              {problem}
            </p>
          )}
          {!problem && !comparison && (
            <p className="work-message" role="status">
              Carregando comparação…
            </p>
          )}
          {comparison && (
            <>
              {comparison.before.kind === "omitted" ||
              comparison.after.kind === "omitted" ? (
                <dl className="diff-versions">
                  <dt>Antes</dt>
                  <dd>
                    <VersionSummary version={comparison.before} />
                  </dd>
                  <dt>Depois</dt>
                  <dd>
                    <VersionSummary version={comparison.after} />
                  </dd>
                </dl>
              ) : (
                <>
                  {comparison.beforeText === comparison.afterText && (
                    <p className="context-muted">
                      Sem alteração de conteúdo nesta comparação.
                    </p>
                  )}
                  <TextComparison
                    before={comparison.beforeText}
                    after={comparison.afterText}
                  />
                  <details className="git-provenance">
                    <summary>Origem das duas versões</summary>
                    <dl className="repo-info diff-versions">
                      <div>
                        <dt>Antes</dt>
                        <dd>
                          <VersionSummary version={comparison.before} />
                        </dd>
                      </div>
                      <div>
                        <dt>Depois</dt>
                        <dd>
                          <VersionSummary version={comparison.after} />
                        </dd>
                      </div>
                    </dl>
                  </details>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export function WorkingTreeView({
  projectId,
  cockpitObservation,
  client,
}: {
  projectId: string;
  cockpitObservation?: GitObservation | null;
  client: Client;
}) {
  const [listing, setListing] = useState<WorkingList>();
  const [snapshot, setSnapshot] = useState<WorkingSnapshot | null>();
  const [selection, setSelection] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [path, setPath] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [listError, setListError] = useState("");
  const [captureError, setCaptureError] = useState("");
  const [requests] = useState(() => ({
    live: createLatestRequest(),
    saved: createLatestRequest(),
  }));

  const show = useCallback((saved: WorkingSnapshot | null) => {
    setSnapshot(saved);
    setPath(saved?.files[0]?.path);
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setListError("");
    void requests.live.run(
      () => client.list(projectId),
      (data) => {
        setListing(data);
        setSelection((previous) =>
          previous.filter((name) =>
            data.changes.some(({ path }) => path === name),
          ),
        );
        setLoading(false);
      },
      (error) => {
        setListError(errorMessage(error));
        setListing(undefined);
        setSelection([]);
        setLoading(false);
      },
    );
  }, [client, projectId, requests]);

  useEffect(() => {
    void requests.saved.run(
      () => client.latest(projectId),
      ({ snapshot }) => show(snapshot),
      (error) => setCaptureError(errorMessage(error)),
    );
    refresh();
    return () => {
      requests.live.invalidate();
      requests.saved.invalidate();
    };
  }, [client, projectId, refresh, requests, show]);

  function capture() {
    if (!selection.length || capturing || loading) return;
    setCapturing(true);
    setCaptureError("");
    void requests.saved.run(
      () => client.capture(projectId, selection),
      (data) => {
        show(data);
        setCapturing(false);
      },
      (error) => {
        setCaptureError(errorMessage(error));
        setCapturing(false);
      },
    );
  }

  const entries = (listing?.changes ?? []).map((change) => ({
    change,
    kinds: changeKinds(change),
  }));
  const visible =
    filter === "all"
      ? entries
      : entries.filter(({ kinds }) => kinds.includes(filter));
  const file = snapshot?.files.find((item) => item.path === path);

  return (
    <section className="git-surface" aria-labelledby="working-heading">
      <WorkHeading
        id="working-heading"
        title="Árvore e comparação"
        icon="git"
        actions={
          <button
            className="button"
            type="button"
            disabled={loading || capturing}
            onClick={refresh}
          >
            <VisualIcon name="refresh" /> Atualizar alterações
          </button>
        }
      />
      {(cockpitObservation || listing) && (
        <dl className="checkout-reading">
          {cockpitObservation && (
            <div>
              <dt>Branch na leitura do cockpit</dt>
              <dd>
                <code>{cockpitObservation.branch ?? "HEAD destacado"}</code>
              </dd>
              <dd>
                <time dateTime={cockpitObservation.observedAt}>
                  {dateFormat.format(new Date(cockpitObservation.observedAt))}
                </time>
              </dd>
            </div>
          )}
          {listing && (
            <div>
              <dt>HEAD da listagem</dt>
              <dd>
                {listing.head ? (
                  <code title={listing.head}>{listing.head.slice(0, 12)}</code>
                ) : (
                  "Sem commits"
                )}
              </dd>
            </div>
          )}
        </dl>
      )}
      <div className="work-grid git-layout">
        <section className="panel" aria-labelledby="git-live-heading">
          <header className="work-panel-heading">
            <h3 id="git-live-heading">Árvore de trabalho</h3>
            {listing && (
              <small>
                Leitura de{" "}
                <time dateTime={listing.observedAt}>
                  {dateFormat.format(new Date(listing.observedAt))}
                </time>
              </small>
            )}
          </header>
          {loading && (
            <p className="work-message" role="status">
              Consultando alterações…
            </p>
          )}
          {listError && (
            <p className="work-message" role="alert">
              {listError}
            </p>
          )}
          {listing && !loading && entries.length === 0 && (
            <EmptyState
              icon="check"
              title="Nenhuma alteração disponível para captura"
            >
              A lista mostra os caminhos que podem ser selecionados neste
              checkout.
            </EmptyState>
          )}
          {entries.length > 0 && (
            <>
              <div
                className="git-filters"
                role="group"
                aria-label="Filtrar arquivos por estado"
              >
                {filters.map((kind) => {
                  const count =
                    kind === "all"
                      ? entries.length
                      : entries.filter((entry) => entry.kinds.includes(kind))
                          .length;
                  if (kind === "conflicted" && !count && filter !== kind)
                    return null;
                  return (
                    <button
                      key={kind}
                      type="button"
                      className="git-filter"
                      aria-pressed={filter === kind}
                      onClick={() => setFilter(kind)}
                    >
                      {filterLabels[kind]} <small>{count}</small>
                    </button>
                  );
                })}
              </div>
              <fieldset className="git-files" disabled={capturing || loading}>
                <legend className="visually-hidden">
                  Arquivos para capturar
                </legend>
                {visible.length === 0 && (
                  <p className="work-message" role="status">
                    Nenhum arquivo nesta categoria.
                  </p>
                )}
                {visible.map(({ change, kinds }) => (
                  <label className="git-file" key={change.path}>
                    <input
                      type="checkbox"
                      checked={selection.includes(change.path)}
                      disabled={
                        selection.length >= workingSelectionLimit &&
                        !selection.includes(change.path)
                      }
                      onChange={({ target }) =>
                        setSelection((current) =>
                          target.checked
                            ? [...current, change.path]
                            : current.filter((item) => item !== change.path),
                        )
                      }
                    />
                    <code>{change.path}</code>
                    <FileKinds kinds={kinds} />
                  </label>
                ))}
              </fieldset>
              {listing?.limited && (
                <p className="work-message">
                  A lista atingiu o limite de alterações exibidas.
                </p>
              )}
              <div className="context-toolbar git-selection">
                <small className="work-muted">
                  {selection.length} de {workingSelectionLimit} selecionados
                </small>
                <button
                  type="button"
                  className="button primary"
                  disabled={capturing || loading || !selection.length}
                  onClick={capture}
                >
                  <VisualIcon name="archive" />{" "}
                  {capturing ? "Capturando…" : "Capturar alterações"}
                </button>
              </div>
            </>
          )}
          {captureError && (
            <p className="work-message" role="alert">
              {captureError}
            </p>
          )}
        </section>
        <section className="panel" aria-labelledby="working-saved-heading">
          <header className="work-panel-heading">
            <h3 id="working-saved-heading">Captura Git preservada</h3>
          </header>
          {snapshot === undefined && !captureError && (
            <p className="work-message" role="status">
              Buscando última captura…
            </p>
          )}
          {snapshot === null && (
            <EmptyState icon="archive" title="Nenhuma captura Git preservada">
              Selecione arquivos na árvore de trabalho para comparar as versões.
            </EmptyState>
          )}
          {snapshot && (
            <>
              <p className="work-muted">
                <time dateTime={snapshot.capturedAt}>
                  {dateFormat.format(new Date(snapshot.capturedAt))}
                </time>
                {" · "}
                <code>
                  {snapshot.branch ??
                    (snapshot.head ? "HEAD destacado" : "Sem commits")}
                </code>
                {snapshot.head && (
                  <>
                    {" "}
                    ·{" "}
                    <code title={snapshot.head}>
                      {snapshot.head.slice(0, 12)}
                    </code>
                  </>
                )}
              </p>
              <details className="git-provenance">
                <summary>Proveniência da captura</summary>
                <dl className="repo-info">
                  <div>
                    <dt>Captura</dt>
                    <dd>
                      <code>{snapshot.snapshotId}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>SHA-256</dt>
                    <dd>
                      <code>{snapshot.digest}</code>
                    </dd>
                  </div>
                </dl>
              </details>
              {file && (
                <label className="work-field">
                  <span>Arquivo preservado</span>
                  <select
                    value={file.path}
                    onChange={(event) => setPath(event.target.value)}
                  >
                    {snapshot.files.map((saved) => (
                      <option key={saved.path}>{saved.path}</option>
                    ))}
                  </select>
                </label>
              )}
              {file && (
                <WorkingDiff
                  key={`${snapshot.snapshotId}/${file.path}`}
                  client={client}
                  snapshot={snapshot}
                  file={file}
                />
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
