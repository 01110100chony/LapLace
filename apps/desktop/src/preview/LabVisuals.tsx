import { useId } from "react";
import type { PreviewId } from "../navigation";
import {
  graphEdges,
  graphNodes,
  hypotheses,
  plannerSteps,
  preflightChecks,
  proposals,
  replayEvents,
  sessions,
  sources,
  type GraphKind,
  type MemoryRecord,
} from "./fixtures";

/**
 * Miniature Living Systems vector specimen rendered on each Lab index card.
 */
export function LabThumb({ id }: { id: PreviewId }) {
  switch (id) {
    case "memory":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <path className="lv-grid" d="M6 15h76M6 27h76M6 39h76" />
          <path className="lv-accent" d="M12 15h46" strokeWidth="3" />
          <path className="lv-source" d="M18 27h56" strokeWidth="3" />
          <path className="lv-task" d="M26 39h38" strokeWidth="3" />
          <circle className="lv-dot-accent" cx="58" cy="15" r="3.5" />
          <circle className="lv-dot-source" cx="74" cy="27" r="3.5" />
          <circle className="lv-dot-task" cx="64" cy="39" r="3.5" />
        </svg>
      );
    case "graph":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <ellipse className="lv-orbit" cx="44" cy="26" rx="22" ry="15" />
          <ellipse className="lv-orbit" cx="44" cy="26" rx="36" ry="22" />
          <path
            className="lv-source"
            d="M14 14 C28 14 30 26 44 26 S62 14 74 14"
          />
          <path className="lv-accent" d="M44 26 C56 26 58 40 72 40" />
          <circle className="lv-dot-source" cx="14" cy="14" r="3" />
          <circle className="lv-dot-task" cx="72" cy="40" r="3" />
          <circle className="lv-hub" cx="44" cy="26" r="7" />
          <text className="lv-lambda" x="44" y="29">
            λ
          </text>
        </svg>
      );
    case "compiler":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <rect
            className="lv-panel"
            x="6"
            y="14"
            width="76"
            height="18"
            rx="4"
          />
          <rect
            className="lv-fill-accent"
            x="9"
            y="17"
            width="18"
            height="12"
            rx="2"
          />
          <rect
            className="lv-fill-source"
            x="29"
            y="17"
            width="22"
            height="12"
            rx="2"
          />
          <rect
            className="lv-fill-muted"
            x="54"
            y="17"
            width="24"
            height="12"
            rx="2"
          />
          <path className="lv-accent" d="M52 8v32" strokeWidth="1.6" />
          <circle className="lv-dot-accent" cx="52" cy="8" r="2.5" />
        </svg>
      );
    case "inbox":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <path className="lv-source" d="M8 14 C24 14 26 26 42 26" />
          <path className="lv-warn" d="M8 26 L36 26" strokeDasharray="3 2" />
          <path className="lv-source" d="M8 38 C24 38 26 26 42 26" />
          <path className="lv-accent" d="M44 8v36" strokeWidth="1.8" />
          <path className="lv-green" d="M46 26 C60 26 64 18 80 18" />
          <circle className="lv-hub" cx="44" cy="26" r="6.5" />
          <text className="lv-lambda" x="44" y="29">
            λ
          </text>
        </svg>
      );
    case "agents":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <circle className="lv-orbit" cx="24" cy="26" r="15" />
          <circle className="lv-accent" cx="24" cy="26" r="9" />
          <path
            className="lv-green"
            d="M42 28 C47 16 51 36 56 26 S64 14 70 28 S76 34 82 22"
          />
          <circle className="lv-dot-accent" cx="24" cy="26" r="3" />
        </svg>
      );
    case "planner":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <path className="lv-grid" d="M8 38h72" strokeWidth="1.6" />
          <path
            className="lv-accent"
            d="M18 38 C28 38 28 16 40 16 H70"
            strokeWidth="1.8"
          />
          <circle className="lv-dot-source" cx="18" cy="38" r="3" />
          <circle className="lv-dot-accent" cx="42" cy="16" r="3" />
          <circle className="lv-dot-accent" cx="56" cy="16" r="3" />
          <circle className="lv-dot-green" cx="70" cy="16" r="3.5" />
        </svg>
      );
    case "preflight":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <circle className="lv-orbit" cx="44" cy="26" r="19" />
          <path
            className="lv-green"
            d="M44 7 A19 19 0 0 1 63 26"
            strokeWidth="2.4"
          />
          <path
            className="lv-accent"
            d="M63 26 A19 19 0 0 1 44 45"
            strokeWidth="2.4"
          />
          <path
            className="lv-source"
            d="M44 45 A19 19 0 0 1 25 26"
            strokeWidth="2.4"
          />
          <circle className="lv-hub" cx="44" cy="26" r="6" />
          <text className="lv-lambda" x="44" y="29">
            λ
          </text>
        </svg>
      );
    case "arena":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <path className="lv-accent" d="M18 26 C32 26 36 13 74 13" />
          <path className="lv-source" d="M18 26 C32 26 36 39 74 39" />
          <path className="lv-task" d="M18 26 H74" />
          <circle className="lv-hub" cx="16" cy="26" r="6" />
          <circle className="lv-dot-accent" cx="74" cy="13" r="3" />
          <circle className="lv-dot-source" cx="74" cy="39" r="3" />
          <circle className="lv-dot-task" cx="74" cy="26" r="3" />
        </svg>
      );
    case "replay":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <path className="lv-accent" d="M10 17h68" />
          <path className="lv-source" d="M10 36h68" />
          <path className="lv-grid" d="M22 17v19M44 17v19M66 17v19" />
          <path
            className="lv-accent"
            d="M22 17 C36 6 52 6 66 17"
            strokeDasharray="2.5 2.5"
          />
          <circle className="lv-dot-accent" cx="22" cy="17" r="3" />
          <circle className="lv-dot-accent" cx="66" cy="17" r="3.5" />
          <circle className="lv-dot-source" cx="66" cy="36" r="3" />
        </svg>
      );
  }
}

const bannerRidges = Array.from({ length: 12 }, (_, i) => {
  const depth = i / 11;
  const shift = depth * 36;
  return `M-10 ${106 - depth * 22} C80 ${98 - depth * 18} ${150 + shift} ${26 + depth * 16} ${230 + shift} ${34 + depth * 12} S350 ${96 - depth * 32} 430 ${22 + depth * 16}`;
});

/**
 * Subtle topographic field motif echoed in each Lab header, matching the Home masthead.
 */
export function LabBannerMotif({ id }: { id: PreviewId }) {
  return (
    <div className="lab-banner-motif" data-lab={id} aria-hidden="true">
      <svg viewBox="0 0 420 120" preserveAspectRatio="none" focusable="false">
        <g className="motif-ridges">
          {bannerRidges.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <circle className="motif-orbit" cx="230" cy="60" r="40" />
        <circle className="motif-orbit" cx="230" cy="60" r="23" />
        <text className="motif-lambda" x="230" y="69">
          λ
        </text>
      </svg>
    </div>
  );
}

/**
 * Memory Explorer: stratigraphic revision timeline (V/K) linked to source evidence.
 */
export function MemoryStrataVisual({
  record,
  activeVersion,
  onSelectVersion,
}: {
  record: MemoryRecord;
  activeVersion: number;
  onSelectVersion: (version: number) => void;
}) {
  const ordered = [...record.revisions].sort((a, b) => a.version - b.version);
  const src = sources.find((s) => s.id === record.source);

  return (
    <figure className="lab-instrument">
      <figcaption className="instrument-head">
        <span className="instrument-eyebrow">Estratigrafia de revisões</span>
        <span className="instrument-meta">
          {record.authority} · origem <code>{src?.digest ?? "fixture"}</code>
        </span>
      </figcaption>
      <div className="instrument-stage">
        <svg
          className="instrument-svg"
          viewBox="0 0 720 152"
          role="group"
          aria-label="Camadas de revisão do registro de memória"
        >
          <path className="lv-grid" d="M24 54h672M24 88h672M24 122h672" />
          <text className="lv-axis" x="24" y="20">
            VIGÊNCIA (V)
          </text>
          <text className="lv-axis" x="696" y="20" textAnchor="end">
            REGISTRO (K) · PROVA ANCORADA
          </text>

          <path
            className="lv-source"
            d="M66 122 C210 122 230 88 360 88 S540 54 640 54"
            strokeDasharray="3 4"
            opacity="0.65"
          />

          {ordered.map((rev, idx) => {
            const x1 = 74 + idx * 132;
            const width = Math.max(170, 480 - idx * 110);
            const y = 122 - idx * 34;
            const active = rev.version === activeVersion;
            const endX = Math.min(682, x1 + width);
            const handleSelect = () => onSelectVersion(rev.version);
            return (
              <g
                key={rev.version}
                role="button"
                tabIndex={0}
                className="strata-node"
                aria-label={`Revisão ${rev.version} observada em ${rev.observed}`}
                aria-pressed={active}
                onClick={handleSelect}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSelect();
                  } else if (event.key === " ") {
                    event.preventDefault();
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key === " ") {
                    event.preventDefault();
                    handleSelect();
                  }
                }}
              >
                <line
                  className={active ? "lv-accent" : "lv-muted-line"}
                  x1={x1}
                  y1={y}
                  x2={endX}
                  y2={y}
                  strokeWidth={active ? 4 : 2}
                />
                <circle
                  className={active ? "lv-hub" : "lv-node-plate"}
                  cx={x1}
                  cy={y}
                  r={active ? 11 : 8}
                />
                <text className="lv-node-code" x={x1} y={y + 4}>
                  v{rev.version}
                </text>
                <text className="lv-caption" x={x1 + 18} y={y - 8}>
                  {rev.observed} · {rev.digest}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

/**
 * KGraph: orbital Living Systems cartography with distinct node shapes (WCAG 1.4.1).
 */
export function KGraphAtlasVisual({
  visibleIds,
  activeId,
  focusNeighborhood,
  onSelect,
}: {
  visibleIds: readonly string[];
  activeId?: string;
  focusNeighborhood: boolean;
  onSelect: (id: string) => void;
}) {
  const gradientId = useId();
  const visibleSet = new Set(visibleIds);
  const visibleNodes = graphNodes.filter((n) => visibleSet.has(n.id));
  const visibleEdges = graphEdges.filter(
    (e) => visibleSet.has(e.from) && visibleSet.has(e.to),
  );
  const activeNode =
    visibleNodes.find((n) => n.id === activeId) ?? visibleNodes[0];

  const neighborIds = new Set<string>();
  if (activeNode) {
    neighborIds.add(activeNode.id);
    for (const edge of visibleEdges) {
      if (edge.from === activeNode.id) neighborIds.add(edge.to);
      if (edge.to === activeNode.id) neighborIds.add(edge.from);
    }
  }

  function renderShape(kind: GraphKind) {
    if (kind === "Decisão") {
      // Chamfered octagonal seal
      return (
        <polygon points="-92,-16 -80,-25 80,-25 92,-16 92,16 80,25 -80,25 -92,16" />
      );
    }
    if (kind === "Fonte") {
      // Archival folded-corner plate
      return <polygon points="-90,-23 76,-23 90,-9 90,23 -90,23" />;
    }
    // Task capsule
    return <rect x="-90" y="-23" width="180" height="46" rx="23" />;
  }

  function renderGlyph(kind: GraphKind) {
    if (kind === "Decisão") {
      return (
        <text className="graph-glyph" x="-73" y="5">
          λ
        </text>
      );
    }
    if (kind === "Fonte") {
      return (
        <rect
          className="graph-glyph-mark"
          x="-77"
          y="-5"
          width="9"
          height="10"
          rx="1.5"
        />
      );
    }
    return <circle className="graph-glyph-mark" cx="-73" cy="0" r="4.5" />;
  }

  return (
    <div className="graph-viewport">
      <svg
        className="knowledge-graph"
        viewBox="0 0 760 360"
        role="group"
        aria-label="Cartografia orbital do grafo de conhecimento"
      >
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {activeNode && (
          <g className="graph-aura" aria-hidden="true">
            <circle
              cx={activeNode.x}
              cy={activeNode.y}
              r="136"
              fill={`url(#${gradientId})`}
            />
            <ellipse
              className="lv-orbit"
              cx={activeNode.x}
              cy={activeNode.y}
              rx="132"
              ry="84"
            />
            <ellipse
              className="lv-orbit"
              cx={activeNode.x}
              cy={activeNode.y}
              rx="224"
              ry="136"
            />
          </g>
        )}

        {visibleEdges.map((edge) => {
          const from = graphNodes.find((item) => item.id === edge.from)!;
          const to = graphNodes.find((item) => item.id === edge.to)!;
          const connected =
            activeNode?.id === edge.from || activeNode?.id === edge.to;
          const middleX = (from.x + to.x) / 2;
          const arcLift = from.x === to.x ? 54 : 0;
          const d = `M ${from.x} ${from.y} C ${middleX + arcLift} ${from.y}, ${middleX - arcLift} ${to.y}, ${to.x} ${to.y}`;
          const labelX = (from.x + to.x) / 2 + arcLift * 0.35;
          const labelY = (from.y + to.y) / 2 - 4;
          const dimmed = focusNeighborhood && !connected;

          return (
            <g
              key={edge.from + "-" + edge.to}
              className="graph-edge-group"
              data-connected={connected}
              data-dimmed={dimmed}
            >
              <path
                className="graph-edge"
                data-kind={from.type}
                data-connected={connected}
                d={d}
              />
              {connected && (
                <g transform={`translate(${labelX} ${labelY})`}>
                  <rect
                    className="edge-pill"
                    x="-46"
                    y="-10"
                    width="92"
                    height="18"
                    rx="9"
                  />
                  <text className="edge-pill-text" x="0" y="3">
                    {edge.relation}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {visibleNodes.map((item) => {
          const isSelected = activeNode?.id === item.id;
          const isNeighbor = neighborIds.has(item.id);
          const dimmed = focusNeighborhood && !isNeighbor;
          return (
            <g
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={`${item.name} (${item.type}, ${item.status})`}
              aria-pressed={isSelected}
              className="graph-node"
              data-kind={item.type}
              data-dimmed={dimmed}
              transform={`translate(${item.x} ${item.y})`}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSelect(item.id);
                } else if (event.key === " ") {
                  event.preventDefault();
                }
              }}
              onKeyUp={(event) => {
                if (event.key === " ") {
                  event.preventDefault();
                  onSelect(item.id);
                }
              }}
            >
              {renderShape(item.type)}
              {renderGlyph(item.type)}
              <text className="graph-title" x="10" y="-2" textAnchor="middle">
                {item.name}
              </text>
              <text className="graph-sub" x="10" y="13" textAnchor="middle">
                {item.type} · {item.digest}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Context Compiler: token budget chamber showing included bands, cut marker, and overflow hatch.
 */
export function CompilerSpectrumVisual({
  manifest,
  budget,
  used,
}: {
  manifest: readonly {
    id: string;
    path: string;
    tokens: number;
    kind: "Documento" | "Código" | "Decisão";
    included: boolean;
  }[];
  budget: number;
  used: number;
}) {
  const totalSelected = manifest.reduce((sum, item) => sum + item.tokens, 0);
  const scaleMax = Math.max(800, budget, totalSelected);
  const barX = 28;
  const barW = 664;
  const barY = 56;
  const barH = 34;
  const cutX = barX + (budget / scaleMax) * barW;

  let cursor = barX;
  const segments = manifest.map((item) => {
    const w = Math.max(8, (item.tokens / scaleMax) * barW);
    const seg = { ...item, x: cursor, width: w };
    cursor += w + 3;
    return seg;
  });

  const hatchId = useId();

  return (
    <figure className="lab-instrument">
      <figcaption className="instrument-head">
        <span className="instrument-eyebrow">Espectro de orçamento</span>
        <span className="instrument-meta">
          {used} de {budget} tokens alocados · destino <code>local</code>
        </span>
      </figcaption>
      <div className="instrument-stage">
        <svg
          className="instrument-svg"
          viewBox="0 0 720 132"
          role="img"
          aria-label={`Orçamento de ${used} em ${budget} tokens`}
        >
          <defs>
            <pattern
              id={hatchId}
              width="8"
              height="8"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="8"
                stroke="var(--yellow)"
                strokeOpacity="0.4"
                strokeWidth="2"
              />
            </pattern>
          </defs>
          <rect
            className="lv-panel"
            x={barX}
            y={barY}
            width={barW}
            height={barH}
            rx="8"
          />
          {cutX < barX + barW && (
            <rect
              x={cutX}
              y={barY + 2}
              width={barX + barW - cutX - 2}
              height={barH - 4}
              rx="6"
              fill={`url(#${hatchId})`}
            />
          )}
          {segments.map((seg) => {
            const cls = !seg.included
              ? "lv-fill-warn"
              : seg.kind === "Decisão"
                ? "lv-fill-accent"
                : seg.kind === "Código"
                  ? "lv-fill-task"
                  : "lv-fill-source";
            return (
              <g key={seg.id}>
                <rect
                  className={cls}
                  x={seg.x}
                  y={barY + 5}
                  width={Math.min(seg.width, barX + barW - seg.x)}
                  height={barH - 10}
                  rx="4"
                  opacity={seg.included ? 0.92 : 0.45}
                />
                {seg.width > 56 && (
                  <text
                    className="lv-segment-label"
                    x={seg.x + seg.width / 2}
                    y={barY + barH + 18}
                    textAnchor="middle"
                  >
                    {seg.path.split("/").pop()} ({seg.tokens})
                  </text>
                )}
              </g>
            );
          })}
          <line
            className="lv-accent"
            x1={cutX}
            y1={barY - 22}
            x2={cutX}
            y2={barY + barH + 8}
            strokeWidth="2"
          />
          <circle className="lv-dot-accent" cx={cutX} cy={barY - 22} r="4" />
          <text
            className="lv-axis"
            x={Math.min(640, Math.max(70, cutX))}
            y={barY - 32}
            textAnchor="middle"
          >
            LIMITE {budget} TOKENS
          </text>
        </svg>
      </div>
    </figure>
  );
}

/**
 * Memory Inbox: quarantine membrane separating incoming candidates from canonical memory.
 */
export function InboxMembraneVisual({
  activeId,
  hasConflict,
  decision,
}: {
  activeId: string;
  hasConflict: boolean;
  decision?: "Aceita" | "Rejeitada";
}) {
  const statusTone =
    decision === "Aceita"
      ? "lv-green"
      : decision === "Rejeitada"
        ? "lv-muted-line"
        : hasConflict
          ? "lv-warn"
          : "lv-accent";

  return (
    <figure className="lab-instrument">
      <figcaption className="instrument-head">
        <span className="instrument-eyebrow">Membrana de quarentena</span>
        <span className="instrument-meta">
          {decision
            ? `Decisão simulada: ${decision}`
            : hasConflict
              ? "Tensão detectada com decisão vigente"
              : "Pronta para revisão humana"}
        </span>
      </figcaption>
      <div className="instrument-stage">
        <svg
          className="instrument-svg"
          viewBox="0 0 720 132"
          role="img"
          aria-label="Fluxo de propostas através da membrana de revisão humana"
        >
          <text className="lv-axis" x="28" y="24">
            PROPOSTAS EM FILA
          </text>
          <text className="lv-axis" x="360" y="24" textAnchor="middle">
            PORTÃO HUMANO
          </text>
          <text className="lv-axis" x="692" y="24" textAnchor="end">
            MEMÓRIA CANÔNICA
          </text>

          {proposals.map((item, idx) => {
            const y = 46 + idx * 28;
            const selected = item.id === activeId;
            return (
              <g key={item.id}>
                <circle
                  className={
                    selected
                      ? "lv-dot-accent"
                      : item.conflict
                        ? "lv-dot-warn"
                        : "lv-dot-source"
                  }
                  cx="32"
                  cy={y}
                  r={selected ? 5 : 3.5}
                />
                <text className="lv-caption" x="45" y={y + 4}>
                  {item.title}
                </text>
                <path
                  className={
                    selected
                      ? statusTone
                      : item.conflict
                        ? "lv-warn"
                        : "lv-muted-line"
                  }
                  d={`M 252 ${y} C 296 ${y}, 312 68, 344 68`}
                  strokeWidth={selected ? 2.4 : 1.1}
                  opacity={selected ? 1 : 0.45}
                />
              </g>
            );
          })}

          <path
            className="lv-orbit"
            d="M 360 32 C 344 52, 376 84, 360 116"
            strokeWidth="2"
          />
          <circle className="lv-hub" cx="360" cy="68" r="16" />
          <text className="lv-lambda" x="360" y="74">
            λ
          </text>

          <path
            className={statusTone}
            d={
              decision === "Rejeitada"
                ? "M 376 68 C 440 68, 460 112, 540 114"
                : "M 376 68 C 480 68, 520 68, 668 68"
            }
            strokeWidth="2.4"
            strokeDasharray={decision === "Aceita" ? undefined : "4 4"}
          />
          <rect
            className="lv-node-plate"
            x="556"
            y="48"
            width="136"
            height="40"
            rx="10"
          />
          <text className="lv-caption" x="624" y="72" textAnchor="middle">
            {decision === "Aceita"
              ? "Promovida · v+1"
              : decision === "Rejeitada"
                ? "Descartada local"
                : hasConflict
                  ? "Retida por conflito"
                  : "Aguardando selo"}
          </text>
        </svg>
      </div>
    </figure>
  );
}

const agentStages = [
  "Contexto",
  "Confinamento",
  "Execução",
  "Revisão",
] as const;

/**
 * Agent Center: confinement rings + 4-stage pipeline and harmonic telemetry wave.
 */
export function AgentTelemetryVisual({
  activeSession,
}: {
  activeSession: (typeof sessions)[number];
}) {
  const toneClass =
    activeSession.state === "Concluída"
      ? "lv-green"
      : activeSession.state === "Bloqueada"
        ? "lv-red"
        : "lv-accent";

  return (
    <figure className="lab-instrument">
      <figcaption className="instrument-head">
        <span className="instrument-eyebrow">Observatório de execução</span>
        <span className="instrument-meta">
          <code>{activeSession.worktree}</code> · {activeSession.boundary}
        </span>
      </figcaption>
      <div className="instrument-stage">
        <svg
          className="instrument-svg"
          viewBox="0 0 720 144"
          role="img"
          aria-label={`Telemetria da sessão ${activeSession.title}: ${activeSession.state}`}
        >
          <circle className="lv-orbit" cx="92" cy="72" r="50" />
          <circle
            className={
              activeSession.state === "Bloqueada" ? "lv-red" : "lv-source"
            }
            cx="92"
            cy="72"
            r="34"
            strokeDasharray={
              activeSession.state === "Bloqueada" ? "5 4" : undefined
            }
            strokeWidth="1.8"
          />
          <circle className="lv-hub" cx="92" cy="72" r="18" />
          <text className="lv-lambda" x="92" y="78">
            λ
          </text>

          <path
            className={toneClass}
            d="M 184 96 C 232 96, 250 56, 300 72 S 372 104, 420 68 S 492 48, 544 74 S 612 92, 678 62"
            strokeWidth="2"
            opacity="0.72"
          />
          <line className="lv-grid" x1="184" y1="48" x2="676" y2="48" />

          {agentStages.map((stage, idx) => {
            const cx = 196 + idx * 158;
            const reached = idx <= activeSession.stageIndex;
            const blockedHere =
              activeSession.state === "Bloqueada" &&
              idx === activeSession.stageIndex;
            return (
              <g key={stage}>
                <circle
                  className={
                    blockedHere
                      ? "lv-dot-red"
                      : reached
                        ? "lv-dot-accent"
                        : "lv-node-plate"
                  }
                  cx={cx}
                  cy="48"
                  r="8"
                />
                <text className="lv-caption" x={cx} y="28" textAnchor="middle">
                  {stage}
                </text>
              </g>
            );
          })}

          <text className="lv-axis" x="196" y="124">
            TENTATIVA #{activeSession.attempt} · DURAÇÃO{" "}
            {activeSession.duration}
          </text>
          <text className="lv-axis" x="676" y="124" textAnchor="end">
            ESTADO: {activeSession.state.toUpperCase()}
          </text>
        </svg>
      </div>
    </figure>
  );
}

/**
 * Git Planner: branched topology showing origin protection and selected steps in worktree.
 */
export function PlannerTopologyVisual({
  selectedIds,
  bindingConfirmed,
  reviewed,
}: {
  selectedIds: readonly string[];
  bindingConfirmed: boolean;
  reviewed: boolean;
}) {
  return (
    <figure className="lab-instrument">
      <figcaption className="instrument-head">
        <span className="instrument-eyebrow">Topologia isolada do plano</span>
        <span className="instrument-meta">
          {bindingConfirmed
            ? "Checkout original intacto · trabalho em worktree separada"
            : "Bloqueado pela precondição de vínculo"}
        </span>
      </figcaption>
      <div className="instrument-stage">
        <svg
          className="instrument-svg"
          viewBox="0 0 720 144"
          role="img"
          aria-label="Ramificação de plano em worktree isolada"
        >
          <line
            className="lv-grid"
            x1="40"
            y1="108"
            x2="680"
            y2="108"
            strokeWidth="2"
          />
          <text className="lv-axis" x="40" y="128">
            CHECKOUT ORIGINAL (INTACTO · READ-ONLY)
          </text>
          <circle
            className={bindingConfirmed ? "lv-dot-green" : "lv-dot-warn"}
            cx="72"
            cy="108"
            r="7"
          />

          <path
            className={bindingConfirmed ? "lv-accent" : "lv-warn"}
            d="M 72 108 C 138 108, 138 54, 210 54 H 646"
            strokeWidth="2.2"
            strokeDasharray={bindingConfirmed ? undefined : "5 4"}
          />

          {plannerSteps.map((step, idx) => {
            const x = 218 + idx * 116;
            const active = selectedIds.includes(step.id);
            const warn = step.risk !== "Baixo";
            return (
              <g key={step.id} opacity={active ? 1 : 0.36}>
                <circle
                  className={
                    active
                      ? warn
                        ? "lv-dot-warn"
                        : "lv-dot-accent"
                      : "lv-node-plate"
                  }
                  cx={x}
                  cy="54"
                  r="11"
                />
                <text className="lv-node-code" x={x} y="58">
                  {step.code}
                </text>
                <text className="lv-caption" x={x} y="31" textAnchor="middle">
                  {step.effect}
                </text>
              </g>
            );
          })}

          <circle
            className={reviewed ? "lv-dot-green" : "lv-hub"}
            cx="658"
            cy="54"
            r="16"
          />
          <text className="lv-lambda" x="658" y="60">
            λ
          </text>
          <text className="lv-axis" x="658" y="88" textAnchor="middle">
            {reviewed ? "REVISADO" : "PORTÃO"}
          </text>
        </svg>
      </div>
    </figure>
  );
}

/**
 * Pre-Flight: interactive 4-quadrant astrolabe dial synced with readiness checklist.
 */
export function PreflightAstrolabeVisual({
  checkedIds,
  onToggle,
}: {
  checkedIds: readonly string[];
  onToggle: (id: string) => void;
}) {
  const ready = checkedIds.length === preflightChecks.length;
  const quadrants = [
    {
      check: preflightChecks[0],
      arc: "M 180 42 A 118 118 0 0 1 298 160",
      lx: 266,
      ly: 74,
    },
    {
      check: preflightChecks[1],
      arc: "M 298 160 A 118 118 0 0 1 180 278",
      lx: 266,
      ly: 248,
    },
    {
      check: preflightChecks[2],
      arc: "M 180 278 A 118 118 0 0 1 62 160",
      lx: 94,
      ly: 248,
    },
    {
      check: preflightChecks[3],
      arc: "M 62 160 A 118 118 0 0 1 180 42",
      lx: 94,
      ly: 74,
    },
  ];

  return (
    <figure className="lab-instrument astrolabe-card">
      <figcaption className="instrument-head">
        <span className="instrument-eyebrow">Astrolábio de prontidão</span>
        <span className="instrument-meta">
          {checkedIds.length}/{preflightChecks.length} quadrantes selados
        </span>
      </figcaption>
      <div className="instrument-stage astrolabe-stage">
        <svg
          className="astrolabe-svg"
          viewBox="0 0 360 320"
          role="group"
          aria-label="Quadrantes de verificação do Pre-Flight"
        >
          <circle className="lv-orbit" cx="180" cy="160" r="118" />
          <circle className="lv-orbit" cx="180" cy="160" r="78" />
          <line className="lv-grid" x1="180" y1="26" x2="180" y2="294" />
          <line className="lv-grid" x1="46" y1="160" x2="314" y2="160" />

          {quadrants.map(({ check, arc, lx, ly }) => {
            const active = checkedIds.includes(check.id);
            const toggle = () => onToggle(check.id);
            return (
              <g
                key={check.id}
                role="button"
                tabIndex={0}
                aria-label={`${check.quadrant}: ${check.label}`}
                aria-pressed={active}
                className="astrolabe-quadrant"
                onClick={toggle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    toggle();
                  } else if (event.key === " ") {
                    event.preventDefault();
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key === " ") {
                    event.preventDefault();
                    toggle();
                  }
                }}
              >
                <path
                  className={active ? "lv-green" : "lv-muted-line"}
                  d={arc}
                  strokeWidth={active ? 6 : 2}
                />
                <circle
                  className={active ? "lv-dot-green" : "lv-node-plate"}
                  cx={lx}
                  cy={ly}
                  r="14"
                />
                <text className="lv-node-code" x={lx} y={ly + 4}>
                  {active ? "✓" : "•"}
                </text>
                <text
                  className="lv-caption"
                  x={lx}
                  y={ly + (ly < 160 ? -22 : 28)}
                  textAnchor="middle"
                >
                  {check.quadrant}
                </text>
              </g>
            );
          })}

          <circle
            className={ready ? "lv-dot-green" : "lv-hub"}
            cx="180"
            cy="160"
            r="34"
          />
          <text className="lv-lambda-lg" x="180" y="167">
            λ
          </text>
          <text className="lv-axis" x="180" y="185" textAnchor="middle">
            {ready ? "PRONTO" : `${checkedIds.length}/4`}
          </text>
        </svg>
      </div>
    </figure>
  );
}

/**
 * Hypothesis Arena: single-base divergence trajectories + 4-axis spectrum comparison.
 */
export function ArenaDivergenceVisual({
  visibleIds,
  chosenId,
}: {
  visibleIds: readonly string[];
  chosenId?: string;
}) {
  const comparing = hypotheses.filter((h) => visibleIds.includes(h.id));
  const tones = {
    h1: "lv-accent",
    h2: "lv-source",
    h3: "lv-task",
  } as const;
  const dots = {
    h1: "lv-dot-accent",
    h2: "lv-dot-source",
    h3: "lv-dot-task",
  } as const;

  return (
    <figure className="lab-instrument">
      <figcaption className="instrument-head">
        <span className="instrument-eyebrow">Campo de bifurcação</span>
        <span className="instrument-meta">
          Base única <code>bf194dd</code> · {comparing.length} hipótese(s) em
          paralelo
        </span>
      </figcaption>
      <div className="instrument-stage">
        <svg
          className="instrument-svg"
          viewBox="0 0 760 156"
          role="img"
          aria-label="Trajetórias paralelas a partir da mesma base Git"
        >
          <ellipse className="lv-orbit" cx="84" cy="78" rx="46" ry="38" />
          <circle className="lv-hub" cx="84" cy="78" r="22" />
          <text className="lv-lambda" x="84" y="84">
            λ
          </text>
          <text className="lv-axis" x="84" y="134" textAnchor="middle">
            BASE bf194dd
          </text>

          {comparing.map((item, idx) => {
            const y =
              comparing.length === 1
                ? 78
                : comparing.length === 2
                  ? 48 + idx * 60
                  : 32 + idx * 46;
            const chosen = chosenId === item.id;
            const tone = tones[item.id];
            const dot = dots[item.id];
            return (
              <g key={item.id}>
                <path
                  className={tone}
                  d={`M 106 78 C 210 78, 224 ${y}, 356 ${y} H 480`}
                  strokeWidth={chosen ? 3 : 1.7}
                  opacity={chosenId && !chosen ? 0.48 : 1}
                />
                <circle className={dot} cx="356" cy={y} r={chosen ? 7 : 5} />
                <text className="lv-caption" x="372" y={y - 7}>
                  {item.title}
                </text>
                <text className="lv-axis" x="372" y={y + 10}>
                  {item.branch} · {item.diffStats}
                </text>
                {chosen && (
                  <rect
                    className="lv-panel"
                    x="590"
                    y={y - 12}
                    width="136"
                    height="24"
                    rx="12"
                  />
                )}
                {chosen && (
                  <text
                    className="lv-caption"
                    x="658"
                    y={y + 4}
                    textAnchor="middle"
                  >
                    Selecionada · revisão
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

/**
 * Temporal Replay: interactive bitemporal (V, K) chronoscope with comparison arc.
 */
export function ReplayChronoscopeVisual({
  baseId,
  targetId,
  onSelectTarget,
}: {
  baseId: string;
  targetId: string;
  onSelectTarget: (id: string) => void;
}) {
  const xFor = (ratio: number) => 142 + ratio * 544;
  const baseEvent =
    replayEvents.find((e) => e.id === baseId) ?? replayEvents[0];
  const targetEvent =
    replayEvents.find((e) => e.id === targetId) ?? replayEvents[2];
  const xBase = xFor(baseEvent.vAxis);
  const xTarget = xFor(targetEvent.vAxis);
  const midX = (xBase + xTarget) / 2;

  return (
    <figure className="lab-instrument">
      <figcaption className="instrument-head">
        <span className="instrument-eyebrow">
          Cronoscópio bitemporal (V × K)
        </span>
        <span className="instrument-meta">
          <code>{baseEvent.revision}</code> →{" "}
          <code>{targetEvent.revision}</code> · clique em um marco para
          inspecionar
        </span>
      </figcaption>
      <div className="instrument-stage">
        <svg
          className="instrument-svg"
          viewBox="0 0 760 166"
          role="group"
          aria-label="Linha do tempo bitemporal entre vigência e registro"
        >
          <text className="lv-axis" x="28" y="64">
            V (VIGÊNCIA)
          </text>
          <text className="lv-axis" x="28" y="114">
            K (REGISTRO)
          </text>
          <line
            className="lv-accent"
            x1="126"
            y1="60"
            x2="716"
            y2="60"
            strokeWidth="1.5"
            opacity="0.55"
          />
          <line
            className="lv-source"
            x1="126"
            y1="110"
            x2="716"
            y2="110"
            strokeWidth="1.5"
            opacity="0.55"
          />

          {baseEvent.id !== targetEvent.id && (
            <path
              className="lv-accent"
              d={`M ${xBase} 60 C ${midX} 14, ${midX} 14, ${xTarget} 60`}
              strokeDasharray="4 3"
              strokeWidth="2"
            />
          )}

          {replayEvents.map((ev) => {
            const vx = xFor(ev.vAxis);
            const kx = xFor(ev.kAxis);
            const isTarget = ev.id === targetId;
            const isBase = ev.id === baseId;
            const select = () => onSelectTarget(ev.id);
            return (
              <g
                key={ev.id}
                role="button"
                tabIndex={0}
                className="chrono-node"
                aria-label={`${ev.label}, vigente em ${ev.effective}, registrado em ${ev.recorded}`}
                aria-pressed={isTarget}
                onClick={select}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    select();
                  } else if (event.key === " ") {
                    event.preventDefault();
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key === " ") {
                    event.preventDefault();
                    select();
                  }
                }}
              >
                <line
                  className={isTarget ? "lv-accent" : "lv-muted-line"}
                  x1={vx}
                  y1="60"
                  x2={kx}
                  y2="110"
                  strokeWidth={isTarget ? 2 : 1.2}
                />
                <circle
                  className={
                    isTarget
                      ? "lv-dot-accent"
                      : isBase
                        ? "lv-dot-task"
                        : "lv-node-plate"
                  }
                  cx={vx}
                  cy="60"
                  r={isTarget ? 8 : 6}
                />
                <circle
                  className={ev.gapNote ? "lv-dot-warn" : "lv-dot-source"}
                  cx={kx}
                  cy="110"
                  r="5.5"
                />
                <text className="lv-axis" x={kx} y="131" textAnchor="middle">
                  {ev.txSeq}
                </text>
                <text className="lv-caption" x={kx} y="147" textAnchor="middle">
                  {ev.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
