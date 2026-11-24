import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { VisualIcon } from "../VisualIcon";
import {
  drawEdges,
  GraphCanvas,
  type GraphCamera,
  type GraphSelection,
} from "./GraphCanvas";
import {
  nodeKinds,
  placeOnOrbits,
  searchKey,
  type GraphData,
  type GraphNode,
  type Metadata,
  type NodeKind,
} from "./model";

export function GraphFacts({ facts }: { facts: readonly Metadata[] }) {
  return (
    <dl className="graph-facts">
      {facts.map(({ label, value, mono }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {mono && /^[0-9a-f]{32,}$/i.test(value) ? (
              <details className="graph-identifier">
                <summary>
                  <code>{value.slice(0, 12)}…</code>
                </summary>
                <code>{value}</code>
              </details>
            ) : mono ? (
              <code>{value}</code>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function KGraph({
  data,
  tools,
  initialNode,
  defaultLayout = "hierarchical",
  renderAction,
}: {
  data: GraphData;
  tools?: ReactNode;
  initialNode?: string;
  defaultLayout?: "hierarchical" | "orbital";
  renderAction: (node: GraphNode) => ReactNode;
}) {
  const camera = useRef<GraphCamera>(null);
  const search = useRef<HTMLInputElement>(null);
  const filterMenu = useRef<HTMLDetailsElement>(null);
  const [view, setView] = useState<"canvas" | "list">("canvas");
  const [layout, setLayout] = useState(defaultLayout);
  const orbits = useMemo(
    () =>
      layout === "orbital" ? placeOnOrbits(data.nodes, data.edges) : undefined,
    [data.nodes, data.edges, layout],
  );
  const [sort, setSort] = useState<"kind" | "name">("kind");
  const [query, setQuery] = useState("");
  const [hiddenKinds, setHiddenKinds] = useState<readonly NodeKind[]>([]);
  const [hiddenRelations, setHiddenRelations] = useState<readonly string[]>([]);
  const positioned = orbits?.nodes ?? data.nodes;
  const initial = positioned.find((node) => node.id === initialNode);
  const [selection, setSelection] = useState<GraphSelection | undefined>(
    initial && { kind: "node", id: initial.id },
  );
  const [focusRequest, setFocusRequest] = useState<GraphNode | undefined>(
    initial,
  );
  const kinds = [...new Set(data.nodes.map((node) => node.kind))];
  const relationTypes = [...new Set(data.edges.map((edge) => edge.label))];
  const nodes = useMemo(
    () => positioned.filter((node) => !hiddenKinds.includes(node.kind)),
    [positioned, hiddenKinds],
  );
  const edges = useMemo(
    () =>
      drawEdges(
        data.edges.filter((edge) => !hiddenRelations.includes(edge.label)),
        nodes,
      ),
    [data, hiddenRelations, nodes],
  );
  const term = searchKey(query.trim());
  const matches = term
    ? nodes.filter((node) =>
        searchKey(
          [node.label, node.description, nodeKinds[node.kind].label].join(" "),
        ).includes(term),
      )
    : [];
  const activeNode =
    selection?.kind === "node"
      ? nodes.find((node) => node.id === selection.id)
      : undefined;
  const activeEdge =
    selection?.kind === "edge"
      ? edges.find((edge) => edge.id === selection.id)
      : undefined;
  const neighbors = activeNode
    ? edges.filter(
        (edge) => edge.from === activeNode.id || edge.to === activeNode.id,
      )
    : [];
  const filters = hiddenKinds.length + hiddenRelations.length;
  const inspector = !!(activeNode || activeEdge);

  useLayoutEffect(() => {
    if (view === "canvas" && focusRequest) camera.current?.focus(focusRequest);
  }, [view, focusRequest]);

  function locate(node: GraphNode) {
    setSelection({ kind: "node", id: node.id });
    setView("canvas");
    setFocusRequest({ ...node });
    setQuery("");
  }

  function clearFilters() {
    setHiddenKinds([]);
    setHiddenRelations([]);
  }

  function closeInspector() {
    setSelection(undefined);
    search.current?.focus();
  }

  const sortedNodes =
    view === "list"
      ? [...nodes].sort(
          (a, b) =>
            (sort === "kind"
              ? nodeKinds[a.kind].label.localeCompare(
                  nodeKinds[b.kind].label,
                  "pt-BR",
                )
              : 0) || a.label.localeCompare(b.label, "pt-BR"),
        )
      : [];

  return (
    <div
      className="graph-workspace"
      onPointerDown={(event) => {
        if (
          filterMenu.current?.open &&
          !filterMenu.current.contains(event.target as Node)
        )
          filterMenu.current.open = false;
      }}
    >
      <header className="graph-heading">
        <div className="graph-heading-title">
          <span className="graph-heading-icon">
            <VisualIcon name="graph" />
          </span>
          <div>
            <div className="graph-scope">
              <span className="badge">
                {data.scope.kind === "project"
                  ? "Relações registradas"
                  : "Prévia · dados de exemplo"}
              </span>
              <span>{data.scope.label}</span>
            </div>
            <h1>KGraph</h1>
          </div>
        </div>
        {tools}
      </header>
      <div className="graph-tools">
        <form
          className="graph-search"
          role="search"
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (matches[0]) locate(matches[0]);
          }}
        >
          <VisualIcon name="search" />
          <input
            ref={search}
            type="search"
            aria-label="Buscar no grafo"
            placeholder="Localizar um nó…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {term && (
            <div className="graph-search-results">
              {matches.length ? (
                <ul aria-label="Resultados do grafo">
                  {matches.slice(0, 5).map((node) => (
                    <li key={node.id}>
                      <button type="button" onClick={() => locate(node)}>
                        <VisualIcon name={nodeKinds[node.kind].icon} />{" "}
                        <span>{node.label}</span> <VisualIcon name="forward" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p role="status">Nenhum nó corresponde à busca.</p>
              )}
            </div>
          )}
        </form>
        <details
          ref={filterMenu}
          className="graph-filters"
          onKeyDown={(event) => {
            if (event.key === "Escape" && event.currentTarget.open) {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary>
            <VisualIcon name="filter" /> Filtros
            {filters > 0 && <span className="badge">{filters}</span>}
          </summary>
          <div className="graph-filter-panel">
            <fieldset>
              <legend>Nós</legend>
              {kinds.map((kind) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    checked={!hiddenKinds.includes(kind)}
                    onChange={(event) => {
                      setHiddenKinds(
                        event.target.checked
                          ? hiddenKinds.filter((item) => item !== kind)
                          : [...hiddenKinds, kind],
                      );
                      setSelection(undefined);
                    }}
                  />
                  <VisualIcon name={nodeKinds[kind].icon} />{" "}
                  {nodeKinds[kind].plural}
                </label>
              ))}
            </fieldset>
            {relationTypes.length > 0 && (
              <fieldset>
                <legend>Relações</legend>
                {relationTypes.map((type) => (
                  <label key={type}>
                    <input
                      type="checkbox"
                      checked={!hiddenRelations.includes(type)}
                      onChange={(event) => {
                        setHiddenRelations(
                          event.target.checked
                            ? hiddenRelations.filter((item) => item !== type)
                            : [...hiddenRelations, type],
                        );
                        if (activeEdge?.label === type) setSelection(undefined);
                      }}
                    />{" "}
                    {type}
                  </label>
                ))}
              </fieldset>
            )}
            <button
              type="button"
              className="text-button"
              onClick={clearFilters}
              disabled={!filters}
            >
              Restaurar filtros
            </button>
          </div>
        </details>
        <div
          className="graph-modes"
          role="group"
          aria-label="Modo de visualização"
        >
          {(
            [
              ["hierarchical", "Hierárquico", "layers"],
              ["orbital", "Orbital", "graph"],
            ] as const
          ).map(([mode, label, icon]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === "canvas" && layout === mode}
              onClick={() => {
                if (layout !== mode) setFocusRequest(undefined);
                setLayout(mode);
                setView("canvas");
              }}
            >
              <VisualIcon name={icon} /> {label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => {
              setView("list");
              setFocusRequest(undefined);
            }}
          >
            <VisualIcon name="list" /> Lista
          </button>
        </div>
      </div>
      <div className="graph-body" data-inspector={inspector}>
        <div className="graph-content">
          {!nodes.length && (
            <div className="graph-empty">
              <VisualIcon name="filter" />
              <h2>Nenhum nó visível</h2>
              <button type="button" className="button" onClick={clearFilters}>
                Restaurar filtros
              </button>
            </div>
          )}
          <GraphCanvas
            key={layout}
            rings={orbits?.rings}
            nodes={nodes}
            edges={edges}
            selection={selection}
            onSelect={setSelection}
            onClear={() => setSelection(undefined)}
            camera={camera}
            hidden={view !== "canvas" || !nodes.length}
          />
          {view === "list" && nodes.length > 0 && (
            <div className="graph-list">
              <header>
                <h2>Nós</h2>
                <label>
                  Ordenar por{" "}
                  <select
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value === "name" ? "name" : "kind")
                    }
                  >
                    <option value="kind">Tipo</option>
                    <option value="name">Nome</option>
                  </select>
                </label>
              </header>
              <ul>
                {sortedNodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      aria-pressed={activeNode?.id === node.id}
                      onClick={() =>
                        setSelection({ kind: "node", id: node.id })
                      }
                    >
                      <span className="graph-node-emblem" data-kind={node.kind}>
                        <VisualIcon name={nodeKinds[node.kind].icon} />
                      </span>
                      <span>
                        <strong>{node.label}</strong>
                        <small>{nodeKinds[node.kind].label}</small>
                      </span>
                      <VisualIcon name="chevron" />
                    </button>
                  </li>
                ))}
              </ul>
              <h2>Relações</h2>
              {edges.length ? (
                <ul>
                  {edges.map((edge) => (
                    <li key={edge.id}>
                      <button
                        type="button"
                        aria-pressed={activeEdge?.id === edge.id}
                        onClick={() =>
                          setSelection({ kind: "edge", id: edge.id })
                        }
                      >
                        <VisualIcon name="forward" />
                        <span>
                          <strong>
                            {edge.start.label} → {edge.end.label}
                          </strong>
                          <small>{edge.label}</small>
                        </span>
                        <VisualIcon name="chevron" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="work-muted">Nenhuma relação visível.</p>
              )}
            </div>
          )}
        </div>
        {inspector && (
          <aside
            className="graph-inspector"
            aria-label="Inspetor de evidências"
          >
            <header className="graph-inspector-heading">
              <span>
                <VisualIcon
                  name={activeNode ? nodeKinds[activeNode.kind].icon : "graph"}
                />{" "}
                {activeNode ? nodeKinds[activeNode.kind].label : "Relação"}
              </span>
              <button
                type="button"
                className="shell-icon-button"
                aria-label="Fechar inspetor"
                title="Fechar inspetor"
                onClick={closeInspector}
              >
                <VisualIcon name="close" />
              </button>
            </header>
            {activeNode && (
              <>
                <h2>{activeNode.label}</h2>
                {activeNode.description && (
                  <p className="graph-description">{activeNode.description}</p>
                )}
                <GraphFacts
                  facts={[
                    { label: "Escopo", value: data.scope.label },
                    ...(activeNode.facts ?? []),
                  ]}
                />
                <div className="graph-node-actions" key={activeNode.id}>
                  {renderAction(activeNode)}
                  {view === "list" && (
                    <button
                      type="button"
                      className="button"
                      onClick={() => locate(activeNode)}
                    >
                      <VisualIcon name="fit" /> Localizar no canvas
                    </button>
                  )}
                </div>
                {neighbors.length > 0 && (
                  <section className="graph-neighbors">
                    <h3>Relações do nó</h3>
                    <ul>
                      {neighbors.map((edge) => {
                        const outgoing = edge.from === activeNode.id;
                        const other = outgoing ? edge.end : edge.start;
                        return (
                          <li key={edge.id}>
                            <button type="button" onClick={() => locate(other)}>
                              <VisualIcon
                                name={outgoing ? "forward" : "back"}
                              />
                              <span>
                                <strong>{other.label}</strong>
                                <small>
                                  {edge.label} ·{" "}
                                  {outgoing ? "Saída" : "Entrada"}
                                </small>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
              </>
            )}
            {activeEdge && (
              <>
                <h2 className="relation-title">{activeEdge.label}</h2>
                <GraphFacts
                  facts={[
                    { label: "Escopo", value: data.scope.label },
                    { label: "Origem", value: activeEdge.origin },
                  ]}
                />
                <ol className="graph-edge-direction">
                  {[activeEdge.start, activeEdge.end].map((node, index) => (
                    <li key={node.id}>
                      <button type="button" onClick={() => locate(node)}>
                        <VisualIcon name={nodeKinds[node.kind].icon} />
                        <span>
                          <small>{index === 0 ? "De" : "Para"}</small>
                          <strong>{node.label}</strong>
                        </span>
                        <VisualIcon name="forward" />
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </aside>
        )}
      </div>
      <footer className="graph-status">
        <span role="status">
          {nodes.length} {nodes.length === 1 ? "nó" : "nós"} · {edges.length}{" "}
          {edges.length === 1 ? "relação" : "relações"}
        </span>
        {data.nodes.length > 0 && data.edges.length === 0 && (
          <span>Nenhuma relação registrada neste checkout.</span>
        )}
        {view === "canvas" && (
          <span className="graph-hint">
            Arraste o fundo para mover · Role para ampliar
          </span>
        )}
      </footer>
    </div>
  );
}
