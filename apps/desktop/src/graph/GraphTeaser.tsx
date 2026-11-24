import { VisualIcon } from "../VisualIcon";
import { nodeKinds, type GraphData, type GraphNode } from "./model";

const sample: readonly GraphNode[] = [
  { id: "project", kind: "project", label: "Projeto de exemplo", x: 0, y: 0 },
  { id: "decision", kind: "decision", label: "Decisão", x: 105, y: -15 },
  { id: "source", kind: "source", label: "Fonte", x: 180, y: 49 },
  { id: "task", kind: "task", label: "Tarefa", x: -123, y: 34 },
];

export function GraphTeaser({
  data,
  preview = false,
  onOpen,
}: {
  data?: GraphData;
  preview?: boolean;
  onOpen: () => void;
}) {
  const nodes = data?.nodes ?? sample;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = data?.edges ?? [
    { id: "project-decision", from: "project", to: "decision" },
    { id: "decision-source", from: "decision", to: "source" },
    { id: "task-project", from: "task", to: "project" },
  ];
  const kinds = [...new Set(nodes.map(({ kind }) => kind))].filter(
    (kind) => kind !== "project",
  );
  const maxX = Math.max(140, ...nodes.map((node) => Math.abs(node.x)));
  const maxY = Math.max(78, ...nodes.map((node) => Math.abs(node.y)));
  const x = (node: GraphNode) => 150 + (node.x * 0.39 * 300) / maxX;
  const y = (node: GraphNode) => 67 + (node.y * 45) / maxY;
  return (
    <button className="graph-teaser" type="button" onClick={onOpen}>
      <span className="surface-heading">
        <VisualIcon name="graph" />
        <strong>KGraph</strong>
        {preview && <span className="badge">Prévia</span>}
        <VisualIcon name="forward" />
      </span>
      <svg
        className="teaser-map"
        viewBox="0 0 300 138"
        aria-hidden="true"
        focusable="false"
      >
        <ellipse className="teaser-orbit" cx="150" cy="67" rx="57" ry="31" />
        <ellipse className="teaser-orbit" cx="150" cy="67" rx="106" ry="54" />
        {edges.map((edge) => {
          const start = byId.get(edge.from);
          const end = byId.get(edge.to);
          if (!start || !end) return null;
          return (
            <g data-kind={end.kind} key={edge.id}>
              <path
                d={`M${x(start)} ${y(start)} Q${(x(start) + x(end)) / 2} ${y(start)} ${x(end)} ${y(end)}`}
              />
            </g>
          );
        })}
        {nodes
          .filter(({ kind }) => kind !== "project")
          .map((node) => (
            <g key={node.id} data-kind={node.kind}>
              <circle cx={x(node)} cy={y(node)} r="8" />
              <circle cx={x(node)} cy={y(node)} r="2.7" />
            </g>
          ))}
        <circle className="teaser-core" cx="150" cy="67" r="17" />
        <path className="teaser-glyph" d="M144 58q4-1 6 4l6 13m-7-10-5 10" />
      </svg>
      <span className="teaser-footer">
        {data && (
          <span>
            {data.nodes.length} {data.nodes.length === 1 ? "nó" : "nós"} ·{" "}
            {data.edges.length}{" "}
            {data.edges.length === 1 ? "relação" : "relações"}
          </span>
        )}
        <span>{preview ? "Explorar relações de exemplo" : "Abrir canvas"}</span>
        {kinds.length > 0 && (
          <span className="teaser-legend" aria-hidden="true">
            {kinds.map((kind) => (
              <i key={kind} data-kind={kind} title={nodeKinds[kind].label} />
            ))}
          </span>
        )}
      </span>
    </button>
  );
}
