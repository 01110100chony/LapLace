import {
  workingSelectionLimit,
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

function changeLabel(change: WorkingChange) {
  if (change.kind === "conflicted") return "Conflito";
  if (change.kind === "untracked") return "Novo no disco";
  const layers = [];
  if (change.status[0] !== ".") layers.push("Índice");
  if (change.status[1] !== "." || change.untracked) layers.push("Disco");
  return layers.join(" e ");
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
    <div className="working-diff">
      <h4>
        <code>{file.path}</code>
      </h4>
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
          <div
            className="context-toolbar"
            aria-label="Origem do diff"
            role="group"
          >
            {(["staged", "unstaged"] as const).map((source) => (
              <button
                type="button"
                key={source}
                className="button"
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
            <p className="service-error" role="alert">
              {problem}
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
  client,
}: {
  projectId: string;
  client: Client;
}) {
  const [listing, setListing] = useState<WorkingList>();
  const [snapshot, setSnapshot] = useState<WorkingSnapshot | null>();
  const [selection, setSelection] = useState<string[]>([]);
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

  const file = snapshot?.files.find((item) => item.path === path);
  return (
    <section className="panel context-result" aria-labelledby="working-heading">
      <header className="section-heading">
        <h2 id="working-heading">Alterações Git</h2>
        <button
          className="text-button"
          type="button"
          disabled={loading || capturing}
          onClick={refresh}
        >
          Atualizar alterações
        </button>
      </header>
      {loading && <p className="context-muted">Consultando alterações…</p>}
      {listError && (
        <p className="service-error" role="alert">
          {listError}
        </p>
      )}
      {listing && listing.changes.length === 0 && (
        <p>Nenhuma alteração disponível para captura.</p>
      )}
      {listing && listing.changes.length > 0 && (
        <>
          <fieldset className="context-files" disabled={capturing || loading}>
            <legend>Arquivos para capturar</legend>
            {listing.changes.map((change) => (
              <label className="context-file" key={change.path}>
                <input
                  type="checkbox"
                  checked={selection.includes(change.path)}
                  disabled={
                    selection.length === workingSelectionLimit &&
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
                <code>{change.path}</code> <small>{changeLabel(change)}</small>
              </label>
            ))}
          </fieldset>
          <div className="context-toolbar">
            <button
              type="button"
              className="button primary"
              disabled={capturing || loading || !selection.length}
              onClick={capture}
            >
              {capturing ? "Capturando…" : "Capturar alterações"}
            </button>
            <small>
              {selection.length} de {workingSelectionLimit} selecionados
            </small>
          </div>
          {listing.limited && (
            <p className="context-muted">
              A lista atingiu o limite de alterações exibidas.
            </p>
          )}
        </>
      )}
      {captureError && (
        <p className="service-error" role="alert">
          {captureError}
        </p>
      )}
      {snapshot && (
        <section aria-labelledby="working-saved-heading">
          <h3 id="working-saved-heading">Captura Git preservada</h3>
          <p className="context-muted">
            <time dateTime={snapshot.capturedAt}>
              {dateFormat.format(new Date(snapshot.capturedAt))}
            </time>{" "}
            ·{" "}
            {snapshot.head ? (
              <code title={snapshot.head}>{snapshot.head.slice(0, 12)}</code>
            ) : (
              "Sem commit"
            )}
          </p>
          <ul className="context-list">
            {snapshot.files.map((saved) => (
              <li key={saved.path}>
                <button
                  type="button"
                  className="context-history-row"
                  aria-current={path === saved.path ? "true" : undefined}
                  onClick={() => setPath(saved.path)}
                >
                  <code>{saved.path}</code>
                  <small>{changeLabel(saved)}</small>
                </button>
              </li>
            ))}
          </ul>
          {file && (
            <WorkingDiff
              key={`${snapshot.snapshotId}/${file.path}`}
              client={client}
              snapshot={snapshot}
              file={file}
            />
          )}
        </section>
      )}
    </section>
  );
}
