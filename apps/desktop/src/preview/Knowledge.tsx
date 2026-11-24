import { VisualIcon } from "../VisualIcon";
import { useState } from "react";
import { memoryRecords, sources } from "./fixtures";
import { BudgetSpectrum, RevisionStrata } from "./Instruments";
import {
  Evidence,
  PreviewLinks,
  PreviewRow,
  PreviewSection,
  type NavigatePreview,
} from "./Shared";

export function MemoryExplorer({
  navigate,
  focus,
}: {
  navigate: NavigatePreview;
  focus?: string;
}) {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState(focus ?? "m1");
  const [version, setVersion] = useState<number>();
  const results = memoryRecords.filter((item) =>
    (item.title + " " + item.scope)
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const active = results.find(({ id }) => id === selection) ?? results[0];
  const revision =
    active?.revisions.find((item) => item.version === version) ??
    active?.revisions[0];
  return (
    <div className="preview-workbench">
      <PreviewSection title="Registros de memória" icon="archive">
        <label className="preview-input">
          <span>Filtrar registros</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {results.length ? (
          <ul className="preview-list">
            {results.map((record) => (
              <li key={record.id}>
                <PreviewRow
                  title={record.title}
                  detail={record.scope}
                  active={record.id === active?.id}
                  onClick={() => {
                    setSelection(record.id);
                    setVersion(undefined);
                  }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="preview-muted">
            Nenhum registro corresponde ao filtro.
          </p>
        )}
      </PreviewSection>
      <PreviewSection title="Revisão e origem" icon="decision">
        {active && revision ? (
          <>
            <p className="preview-detail-title">{active.title}</p>
            <RevisionStrata
              record={active}
              selected={revision.version}
              onSelect={setVersion}
            />
            <p className="preview-reading">{revision.content}</p>
            <Evidence id={active.source} />
            <div className="preview-related">
              <button
                type="button"
                className="text-button"
                onClick={() => navigate("graph", active.id)}
              >
                Localizar no KGraph <VisualIcon name="forward" />
              </button>
            </div>
            <PreviewLinks ids={["replay"]} navigate={navigate} />
          </>
        ) : (
          <p className="preview-muted">
            Escolha um registro para examinar sua revisão.
          </p>
        )}
      </PreviewSection>
    </div>
  );
}

export function ContextCompiler({ navigate }: { navigate: NavigatePreview }) {
  const [selection, setSelection] = useState<string[]>(["s1", "s2", "s3"]);
  const [budget, setBudget] = useState(410);
  let used = 0;
  const manifest = sources
    .filter(({ id }) => selection.includes(id))
    .map((source) => {
      const included = used + source.tokens <= budget;
      if (included) used += source.tokens;
      return { ...source, included };
    });

  return (
    <div className="preview-workbench">
      <PreviewSection title="Seleção e orçamento">
        <fieldset className="preview-checks">
          <legend>Fontes disponíveis</legend>
          {sources.map((source) => (
            <label key={source.id}>
              <input
                type="checkbox"
                checked={selection.includes(source.id)}
                onChange={(event) =>
                  setSelection((items) =>
                    event.target.checked
                      ? [...items, source.id]
                      : items.filter((id) => id !== source.id),
                  )
                }
              />
              <span>
                <code>{source.path}</code>
                <small>
                  {source.kind} · {source.tokens} tokens estimados
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="preview-input">
          <span>
            Orçamento em tokens{" "}
            <span className="budget-label" aria-hidden="true">
              {budget}
            </span>
          </span>
          <input
            type="range"
            min="100"
            max="800"
            step="10"
            value={budget}
            onChange={(event) => setBudget(Number(event.target.value))}
          />
        </label>
      </PreviewSection>
      <PreviewSection title="Manifesto de exemplo">
        <BudgetSpectrum manifest={manifest} budget={budget} />
        {manifest.length ? (
          <ul className="preview-events">
            {manifest.map((source) => (
              <li key={source.id}>
                <code>{source.path}</code>
                <small data-included={source.included}>
                  {source.included
                    ? "Incluída por inteiro"
                    : "Omitida pelo limite"}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="preview-muted">
            Nenhuma fonte selecionada para o pacote.
          </p>
        )}
        <details className="preview-disclosure">
          <summary>Inspecionar pacote</summary>
          <pre className="preview-code" tabIndex={0}>
            {JSON.stringify(
              {
                demonstracao: true,
                destino: "local",
                tokensEstimados: used,
                fontes: manifest
                  .filter((source) => source.included)
                  .map(({ path, kind }) => ({ path, kind })),
              },
              null,
              2,
            )}
          </pre>
        </details>
        <PreviewLinks ids={["graph", "preflight"]} navigate={navigate} />
      </PreviewSection>
    </div>
  );
}
