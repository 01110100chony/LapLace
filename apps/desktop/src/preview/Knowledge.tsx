import { useState } from "react";
import {
  graphEdges,
  graphNodes,
  memoryRecords,
  sources,
  type GraphKind,
} from "./fixtures";
import {
  Evidence,
  PreviewLinks,
  PreviewRow,
  PreviewSection,
  type NavigatePreview,
} from "./Shared";

export function MemoryExplorer({ navigate }: { navigate: NavigatePreview }) {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState("m1");
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
      <PreviewSection title="Registros de memória">
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
      <PreviewSection title="Revisão e origem">
        {active && revision ? (
          <>
            <p className="preview-detail-title">{active.title}</p>
            <div
              role="group"
              aria-label="Revisões do registro"
              className="preview-switch"
            >
              {active.revisions.map((item) => (
                <button
                  type="button"
                  key={item.version}
                  aria-pressed={revision.version === item.version}
                  onClick={() => setVersion(item.version)}
                >
                  Revisão {item.version}
                </button>
              ))}
            </div>
            <p className="preview-muted">Observada em {revision.observed}</p>
            <p className="preview-reading">{revision.content}</p>
            <Evidence id={active.source} />
            <PreviewLinks ids={["graph", "replay"]} navigate={navigate} />
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

const graphTypes: readonly GraphKind[] = ["Decisão", "Fonte", "Tarefa"];

export function KnowledgeGraph({ navigate }: { navigate: NavigatePreview }) {
  const [types, setTypes] = useState<GraphKind[]>([...graphTypes]);
  const [selected, setSelected] = useState("n1");
  const visible = graphNodes.filter((item) => types.includes(item.type));
  const active = visible.find((item) => item.id === selected) ?? visible[0];
  const edges = graphEdges.filter(
    (edge) =>
      visible.some(({ id }) => id === edge.from) &&
      visible.some(({ id }) => id === edge.to),
  );
  return (
    <div className="preview-workbench graph-bench">
      <PreviewSection title="Relações da fixture">
        <div className="preview-switch" role="group" aria-label="Tipos de nó">
          {graphTypes.map((type) => (
            <button
              type="button"
              key={type}
              aria-pressed={types.includes(type)}
              onClick={() =>
                setTypes((current) =>
                  current.includes(type)
                    ? current.filter((value) => value !== type)
                    : [...current, type],
                )
              }
            >
              {type}
            </button>
          ))}
        </div>
        {visible.length ? (
          <div className="graph-viewport">
            <svg
              className="knowledge-graph"
              viewBox="0 0 640 290"
              role="group"
              aria-label="Grafo demonstrativo de relações"
            >
              {edges.map((edge) => {
                const from = graphNodes.find((item) => item.id === edge.from)!;
                const to = graphNodes.find((item) => item.id === edge.to)!;
                const middle = (from.x + to.x) / 2;
                return (
                  <path
                    className="graph-edge"
                    key={edge.from + edge.to}
                    data-kind={from.type}
                    data-connected={
                      active?.id === edge.from || active?.id === edge.to
                    }
                    d={`M ${from.x} ${from.y} C ${middle} ${from.y}, ${middle} ${to.y}, ${to.x} ${to.y}`}
                  />
                );
              })}
              {visible.map((item) => (
                <g
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  aria-label={item.name}
                  aria-pressed={active?.id === item.id}
                  className="graph-node"
                  data-kind={item.type}
                  transform={"translate(" + item.x + " " + item.y + ")"}
                  onClick={() => setSelected(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(item.id);
                    }
                  }}
                >
                  <rect x="-89" y="-22" width="178" height="44" rx="13" />
                  <circle cx="-77" cy="0" r="2.7" />
                  <text textAnchor="middle" x="5" y="4">
                    {item.name}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        ) : (
          <p className="preview-muted">
            Selecione um tipo de nó para mostrar relações.
          </p>
        )}
        {!!visible.length && (
          <details className="preview-disclosure">
            <summary>Navegar por lista</summary>
            <ul>
              {visible.map((item) => (
                <li key={item.id}>
                  <PreviewRow
                    title={item.name}
                    detail={item.type}
                    active={active?.id === item.id}
                    onClick={() => setSelected(item.id)}
                  />
                </li>
              ))}
            </ul>
          </details>
        )}
      </PreviewSection>
      <PreviewSection title="Nó selecionado">
        {active && (
          <>
            <p className="preview-detail-title">{active.name}</p>
            <p className="preview-muted">{active.type}</p>
            <Evidence id={active.evidence} />
            <ul
              className="graph-relations"
              aria-label="Relações do nó selecionado"
            >
              {edges
                .filter(
                  (edge) => edge.from === active.id || edge.to === active.id,
                )
                .map((edge) => {
                  const outgoing = edge.from === active.id;
                  const other = graphNodes.find(
                    (node) => node.id === (outgoing ? edge.to : edge.from),
                  )!;
                  const relation = outgoing
                    ? active.name + " " + edge.relation + " " + other.name
                    : other.name + " " + edge.relation + " " + active.name;
                  return (
                    <li key={edge.from + edge.to}>
                      <PreviewRow
                        title={other.name}
                        detail={relation}
                        onClick={() => setSelected(other.id)}
                      />
                    </li>
                  );
                })}
            </ul>
            <PreviewLinks ids={["memory", "compiler"]} navigate={navigate} />
          </>
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
        <p className="preview-number">
          {used} <small>de {budget} tokens estimados</small>
        </p>
        <progress
          className="budget-progress"
          value={used}
          max={budget}
          aria-label="Orçamento utilizado"
        />
        {manifest.length ? (
          <ul className="preview-events">
            {manifest.map((source) => (
              <li key={source.id}>
                <code>{source.path}</code>
                <small>
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
