import { useState } from "react";
import { TextComparison } from "../TextComparison";
import {
  graphEdges,
  graphNodes,
  memoryRecords,
  sources,
  type GraphKind,
} from "./fixtures";
import {
  CompilerSpectrumVisual,
  KGraphAtlasVisual,
  MemoryStrataVisual,
} from "./LabVisuals";
import {
  Evidence,
  PreviewLinks,
  PreviewRow,
  PreviewSection,
  type NavigatePreview,
} from "./Shared";

const scopeFilters = ["Todos", "Canônica", "Local"] as const;

export function MemoryExplorer({ navigate }: { navigate: NavigatePreview }) {
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] =
    useState<(typeof scopeFilters)[number]>("Todos");
  const [selection, setSelection] = useState("m1");
  const [version, setVersion] = useState<number>();
  const [compareMode, setCompareMode] = useState(false);

  const results = memoryRecords.filter((item) => {
    const matchesScope =
      scopeFilter === "Todos" ||
      item.scope.toLocaleLowerCase().includes(scopeFilter.toLocaleLowerCase());
    const matchesQuery = (item.title + " " + item.scope + " " + item.summaryTag)
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
    return matchesScope && matchesQuery;
  });

  const active = results.find(({ id }) => id === selection) ?? results[0];
  const revision =
    active?.revisions.find((item) => item.version === version) ??
    active?.revisions[0];
  const initialRevision = active?.revisions[active.revisions.length - 1];

  return (
    <div className="lab-stack">
      {active && revision && (
        <MemoryStrataVisual
          record={active}
          activeVersion={revision.version}
          onSelectVersion={(ver) => setVersion(ver)}
        />
      )}

      <div className="preview-workbench">
        <PreviewSection
          eyebrow="Acervo da fixture"
          title="Registros de memória"
          aside={<span className="lab-count">{results.length} registros</span>}
        >
          <div className="preview-switch" role="group" aria-label="Escopo">
            {scopeFilters.map((filter) => (
              <button
                type="button"
                key={filter}
                aria-pressed={scopeFilter === filter}
                onClick={() => setScopeFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
          <label className="preview-input">
            <span>Filtrar registros</span>
            <input
              type="search"
              placeholder="Buscar título ou invariante…"
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
                    detail={`${record.scope} · ${record.summaryTag}`}
                    badge={`v${record.revisions[0]?.version ?? 1}`}
                    active={record.id === active?.id}
                    onClick={() => {
                      setSelection(record.id);
                      setVersion(undefined);
                      setCompareMode(false);
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

        <PreviewSection
          eyebrow="Dossiê auditável"
          title="Revisão e origem"
          aside={
            active &&
            revision && (
              <span className="lab-chip mono">digest:{revision.digest}</span>
            )
          }
        >
          {active && revision ? (
            <>
              <div className="dossier-header">
                <p className="preview-detail-title">{active.title}</p>
                <span className="lab-chip accent">{active.authority}</span>
              </div>

              <div className="dossier-toolbar">
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

                {active.revisions.length > 1 && initialRevision && (
                  <button
                    type="button"
                    className="pill-toggle"
                    aria-pressed={compareMode}
                    onClick={() => setCompareMode((prev) => !prev)}
                  >
                    {compareMode ? "Ocultar diff" : "Comparar com v1"}
                  </button>
                )}
              </div>

              <dl className="dossier-meta">
                <div>
                  <dt>Observada (K)</dt>
                  <dd>{revision.observed}</dd>
                </div>
                <div>
                  <dt>Vigente (V)</dt>
                  <dd>{revision.effective}</dd>
                </div>
                <div>
                  <dt>Marcador</dt>
                  <dd>{active.summaryTag}</dd>
                </div>
              </dl>

              <blockquote className="editorial-statement">
                {revision.content}
              </blockquote>

              {compareMode &&
                initialRevision &&
                revision.version !== initialRevision.version && (
                  <div className="lab-comparison-frame">
                    <TextComparison
                      before={initialRevision.content}
                      after={revision.content}
                    />
                  </div>
                )}

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
    </div>
  );
}

const graphTypes: readonly GraphKind[] = ["Decisão", "Fonte", "Tarefa"];

export function KnowledgeGraph({ navigate }: { navigate: NavigatePreview }) {
  const [types, setTypes] = useState<GraphKind[]>([...graphTypes]);
  const [selected, setSelected] = useState("n1");
  const [focusNeighborhood, setFocusNeighborhood] = useState(false);

  const visible = graphNodes.filter((item) => types.includes(item.type));
  const active = visible.find((item) => item.id === selected) ?? visible[0];
  const edges = graphEdges.filter(
    (edge) =>
      visible.some(({ id }) => id === edge.from) &&
      visible.some(({ id }) => id === edge.to),
  );
  const connectedEdges = active
    ? edges.filter((edge) => edge.from === active.id || edge.to === active.id)
    : [];

  return (
    <div className="preview-workbench graph-bench">
      <PreviewSection
        eyebrow="Cartografia orbital"
        title="Relações da fixture"
        aside={
          <span className="lab-count">
            {visible.length} nós · {edges.length} ligações
          </span>
        }
      >
        <div className="graph-controls">
          <div className="preview-switch" role="group" aria-label="Tipos de nó">
            {graphTypes.map((type) => (
              <button
                type="button"
                key={type}
                data-kind={type}
                aria-pressed={types.includes(type)}
                onClick={() =>
                  setTypes((current) =>
                    current.includes(type)
                      ? current.filter((value) => value !== type)
                      : [...current, type],
                  )
                }
              >
                <span
                  className="kind-marker"
                  data-kind={type}
                  aria-hidden="true"
                />
                {type}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pill-toggle"
            aria-pressed={focusNeighborhood}
            onClick={() => setFocusNeighborhood((v) => !v)}
          >
            Focar vizinhança
          </button>
        </div>

        {visible.length ? (
          <KGraphAtlasVisual
            visibleIds={visible.map((n) => n.id)}
            activeId={active?.id}
            focusNeighborhood={focusNeighborhood}
            onSelect={(id) => setSelected(id)}
          />
        ) : (
          <p className="preview-muted">
            Selecione um tipo de nó para mostrar relações.
          </p>
        )}

        {!!visible.length && (
          <details className="preview-disclosure">
            <summary>Navegar por lista acessível ({visible.length})</summary>
            <ul className="preview-list">
              {visible.map((item) => (
                <li key={item.id}>
                  <PreviewRow
                    title={item.name}
                    detail={`${item.type} · ${item.status}`}
                    badge={item.digest}
                    active={active?.id === item.id}
                    onClick={() => setSelected(item.id)}
                  />
                </li>
              ))}
            </ul>
          </details>
        )}
      </PreviewSection>

      <PreviewSection
        eyebrow="Inspetor de nó"
        title="Nó selecionado"
        aside={
          active && (
            <span className="lab-chip" data-kind={active.type}>
              {active.status}
            </span>
          )
        }
      >
        {active && (
          <>
            <p className="preview-detail-title">{active.name}</p>
            <div className="lab-chip-row">
              <span className="lab-chip accent">{active.type}</span>
              <span className="lab-chip mono">{active.digest}</span>
              <span className="lab-chip">
                {connectedEdges.length} conexões diretas
              </span>
            </div>

            <Evidence id={active.evidence} />

            <p className="section-eyebrow">Relações conectadas</p>
            <ul
              className="graph-relations"
              aria-label="Relações do nó selecionado"
            >
              {connectedEdges.map((edge) => {
                const outgoing = edge.from === active.id;
                const other = graphNodes.find(
                  (node) => node.id === (outgoing ? edge.to : edge.from),
                )!;
                const relation = outgoing
                  ? `→ ${edge.relation} ${other.name}`
                  : `← ${other.name} ${edge.relation}`;
                return (
                  <li key={edge.from + edge.to}>
                    <PreviewRow
                      title={other.name}
                      detail={relation}
                      badge={other.type}
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

const budgetPresets = [260, 410, 600, 800] as const;

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

  const includedCount = manifest.filter((m) => m.included).length;
  const omittedCount = manifest.length - includedCount;

  return (
    <div className="lab-stack">
      <CompilerSpectrumVisual manifest={manifest} budget={budget} used={used} />

      <div className="preview-workbench">
        <PreviewSection
          eyebrow="Entrada e limites"
          title="Seleção e orçamento"
          aside={
            <span className="lab-count">{selection.length}/4 selecionadas</span>
          }
        >
          <fieldset className="preview-checks">
            <legend>Fontes disponíveis na fixture</legend>
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
                <span className="check-copy">
                  <span className="check-title">
                    <code>{source.path}</code>
                    <span className="lab-chip">{source.tier}</span>
                  </span>
                  <small>
                    {source.kind} · {source.tokens} tokens ·{" "}
                    <code>{source.digest}</code>
                  </small>
                </span>
              </label>
            ))}
          </fieldset>

          <div
            className="budget-presets"
            role="group"
            aria-label="Limites rápidos"
          >
            {budgetPresets.map((preset) => (
              <button
                type="button"
                key={preset}
                className="pill-toggle"
                aria-pressed={budget === preset}
                onClick={() => setBudget(preset)}
              >
                {preset} tok
              </button>
            ))}
          </div>

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

        <PreviewSection
          eyebrow="Saída determinística"
          title="Manifesto de exemplo"
          aside={
            <span className={`lab-chip ${omittedCount ? "warn" : "ok"}`}>
              {includedCount} incluídas · {omittedCount} omitidas
            </span>
          }
        >
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
            <ul className="manifest-list">
              {manifest.map((source) => (
                <li
                  key={source.id}
                  className={source.included ? "included" : "omitted"}
                >
                  <div className="manifest-item-head">
                    <code>{source.path}</code>
                    <span
                      className={`lab-chip ${source.included ? "ok" : "warn"}`}
                    >
                      {source.included
                        ? "Incluída por inteiro"
                        : "Omitida pelo limite"}
                    </span>
                  </div>
                  <div className="manifest-item-meta">
                    <span>{source.tier}</span>
                    <span>
                      {source.tokens} tok · <code>{source.digest}</code>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="preview-muted">
              Nenhuma fonte selecionada para o pacote.
            </p>
          )}

          <details className="preview-disclosure">
            <summary>Inspecionar pacote JSON</summary>
            <pre className="preview-code" tabIndex={0}>
              {JSON.stringify(
                {
                  demonstracao: true,
                  destino: "local",
                  tokensEstimados: used,
                  limiteTokens: budget,
                  fontes: manifest
                    .filter((source) => source.included)
                    .map(({ path, kind, digest }) => ({ path, kind, digest })),
                },
                null,
                2,
              )}
            </pre>
          </details>
          <PreviewLinks ids={["graph", "preflight"]} navigate={navigate} />
        </PreviewSection>
      </div>
    </div>
  );
}
