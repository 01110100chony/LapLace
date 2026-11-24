export const nodeKinds = {
  project: { label: "Projeto", plural: "Projetos", icon: "folder" },
  git: { label: "Git", plural: "Git", icon: "git" },
  decision: { label: "Decisão", plural: "Decisões", icon: "decision" },
  source: { label: "Fonte", plural: "Fontes", icon: "file" },
  capture: { label: "Captura", plural: "Capturas", icon: "archive" },
  task: { label: "Tarefa", plural: "Tarefas", icon: "tasks" },
} as const;

export type NodeKind = keyof typeof nodeKinds;
export type Point = { x: number; y: number };
export type Metadata = { label: string; value: string; mono?: boolean };

export type GraphNode = Point & {
  id: string;
  kind: NodeKind;
  label: string;
  description?: string;
  facts?: readonly Metadata[];
  target?: string;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  origin: string;
};

export type GraphData = {
  scope: { kind: "project" | "preview"; label: string };
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
};

export type Viewport = Point & { scale: number };
export type Size = { width: number; height: number };
export const nodeSize = { width: 176, height: 60 };
export const maxZoom = 2.75;
const minZoom = 0.1;

export function centerAt(point: Point, size: Size, scale: number): Viewport {
  return {
    x: size.width / 2 - point.x * scale,
    y: size.height / 2 - point.y * scale,
    scale,
  };
}

export function fittedView(
  nodes: readonly GraphNode[],
  size: Size,
  reset = false,
) {
  if (!nodes.length) return centerAt({ x: 0, y: 0 }, size, 1);
  const left = Math.min(...nodes.map((node) => node.x)) - nodeSize.width / 2;
  const right = Math.max(...nodes.map((node) => node.x)) + nodeSize.width / 2;
  const top = Math.min(...nodes.map((node) => node.y)) - nodeSize.height / 2;
  const bottom = Math.max(...nodes.map((node) => node.y)) + nodeSize.height / 2;
  const padding = Math.min(96, size.width * 0.12, size.height * 0.24);
  const scale = reset
    ? 1
    : Math.max(
        minZoom,
        Math.min(
          1.38,
          (size.width - padding) / (right - left),
          (size.height - padding) / (bottom - top),
        ),
      );
  return centerAt(
    { x: (left + right) / 2, y: (top + bottom) / 2 },
    size,
    scale,
  );
}

export function zoomAt(
  current: Viewport,
  point: Point,
  factor: number,
): Viewport {
  const scale = Math.max(minZoom, Math.min(maxZoom, current.scale * factor));
  const ratio = scale / current.scale;
  return {
    x: point.x - (point.x - current.x) * ratio,
    y: point.y - (point.y - current.y) * ratio,
    scale,
  };
}

function nodePort(node: GraphNode, other: GraphNode, gap: number) {
  const dx = other.x - node.x;
  const dy = other.y - node.y;
  const scale = Math.min(
    (nodeSize.width / 2 + gap) / Math.abs(dx),
    (nodeSize.height / 2 + gap) / Math.abs(dy),
  );
  return { x: node.x + dx * scale, y: node.y + dy * scale };
}

export function edgePath(from: GraphNode, to: GraphNode) {
  const start = nodePort(from, to, 2);
  const end = nodePort(to, from, 7);
  const horizontal =
    Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) * 0.8;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const first = horizontal
    ? { x: midpoint.x, y: start.y }
    : { x: start.x, y: midpoint.y };
  const second = horizontal
    ? { x: midpoint.x, y: end.y }
    : { x: end.x, y: midpoint.y };
  return {
    midpoint,
    d: `M${start.x},${start.y} C${first.x},${first.y} ${second.x},${second.y} ${end.x},${end.y}`,
  };
}

export function searchKey(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}
