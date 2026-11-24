import {
  memo,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from "react";
import { VisualIcon } from "../VisualIcon";
import {
  centerAt,
  edgePath,
  fittedView,
  maxZoom,
  nodeKinds,
  nodeSize,
  zoomAt,
  type GraphEdge,
  type GraphNode,
  type OrbitRing,
  type Point,
  type Size,
  type Viewport,
} from "./model";

export type GraphSelection = { kind: "node" | "edge"; id: string };
export type GraphCamera = { focus: (node: GraphNode) => void };

type DrawnEdge = GraphEdge & { start: GraphNode; end: GraphNode };

export function drawEdges(
  edges: readonly GraphEdge[],
  nodes: readonly GraphNode[],
): DrawnEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return edges.flatMap((edge) => {
    const start = byId.get(edge.from);
    const end = byId.get(edge.to);
    return start && end && start !== end ? [{ ...edge, start, end }] : [];
  });
}

function traverseGraph(
  event: KeyboardEvent<HTMLElement | SVGElement>,
  selector: string,
) {
  const entries = Array.from(
    event.currentTarget.parentElement?.querySelectorAll<
      HTMLElement | SVGElement
    >(selector) ?? [],
  );
  const active = entries.indexOf(event.currentTarget);
  const key = event.key;
  const forward = key === "ArrowDown" || key === "ArrowRight";
  const backward = key === "ArrowUp" || key === "ArrowLeft";
  if (active < 0 || (!forward && !backward && key !== "Home" && key !== "End"))
    return;
  const index =
    key === "Home"
      ? 0
      : key === "End"
        ? entries.length - 1
        : (active + (forward ? 1 : -1) + entries.length) % entries.length;
  event.preventDefault();
  entries[index]?.focus({ preventScroll: true });
}

const GraphOverlay = memo(function GraphOverlay({
  nodes,
  edges,
  selection,
  onSelect,
  reveal,
}: {
  nodes: readonly GraphNode[];
  edges: readonly DrawnEdge[];
  selection?: GraphSelection;
  onSelect: (selection: GraphSelection) => void;
  reveal: (point: Point) => void;
}) {
  const [hovered, setHovered] = useState<GraphSelection>();
  const active = hovered ?? selection;
  const near = new Set<string>();
  const tabNode = selection?.kind === "node" ? selection.id : nodes[0]?.id;
  const tabEdge = selection?.kind === "edge" ? selection.id : edges[0]?.id;
  if (active?.kind === "node") near.add(active.id);

  const paths = edges.map((edge) => {
    const highlighted =
      active?.kind === "node"
        ? edge.from === active.id || edge.to === active.id
        : edge.id === active?.id;
    if (highlighted) {
      near.add(edge.from);
      near.add(edge.to);
    }
    return { edge, highlighted, ...edgePath(edge.start, edge.end) };
  });

  return (
    <>
      {nodes.map((node) => {
        const kind = nodeKinds[node.kind];
        const selected = selection?.kind === "node" && selection.id === node.id;
        const choose = () => onSelect({ kind: "node", id: node.id });
        return (
          <button
            type="button"
            className="graph-node-card"
            key={node.id}
            data-graph-node={node.id}
            data-kind={node.kind}
            data-state={
              selected
                ? "selected"
                : near.has(node.id)
                  ? "related"
                  : active
                    ? "dim"
                    : undefined
            }
            style={{
              left: node.x,
              top: node.y,
              width: nodeSize.width,
              height: nodeSize.height,
            }}
            aria-label={`${node.label} · ${kind.label}`}
            aria-pressed={selected}
            tabIndex={node.id === tabNode ? 0 : -1}
            onKeyDown={(event) => traverseGraph(event, "[data-graph-node]")}
            onPointerEnter={() => setHovered({ kind: "node", id: node.id })}
            onPointerLeave={() => setHovered(undefined)}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible")) {
                reveal(node);
                choose();
              }
            }}
            onClick={choose}
          >
            <span className="graph-node-emblem">
              <VisualIcon name={kind.icon} />
            </span>
            <span className="graph-node-text">
              <small>{kind.label}</small>
              <strong>
                {node.kind === "source"
                  ? node.label.split("/").at(-1)
                  : node.label}
              </strong>
            </span>
          </button>
        );
      })}
      <svg className="graph-wires" width="1" height="1" aria-label="Relações">
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M1 1 7 4 1 7" className="graph-arrow" />
          </marker>
        </defs>
        {paths.map(({ edge, d, midpoint, highlighted }) => {
          const selected =
            selection?.kind === "edge" && edge.id === selection.id;
          const label = `${edge.start.label} ${edge.label} ${edge.end.label}`;
          const choose = () => onSelect({ kind: "edge", id: edge.id });
          return (
            <g
              key={edge.id}
              data-graph-edge={edge.id}
              data-state={
                selected
                  ? "selected"
                  : highlighted
                    ? "related"
                    : active
                      ? "dim"
                      : undefined
              }
              role="button"
              aria-label={label}
              aria-pressed={selected}
              tabIndex={edge.id === tabEdge ? 0 : -1}
              onPointerEnter={() => setHovered({ kind: "edge", id: edge.id })}
              onPointerLeave={() => setHovered(undefined)}
              onFocus={(event) => {
                if (event.currentTarget.matches(":focus-visible")) {
                  reveal(midpoint);
                  choose();
                }
              }}
              onClick={choose}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  choose();
                } else traverseGraph(event, "[data-graph-edge]");
              }}
            >
              <path
                className="graph-wire"
                d={d}
                markerEnd="url(#graph-arrow)"
              />
              <path className="graph-wire-hit" d={d} />
              {(edges.length <= 12 || highlighted) && (
                <text
                  className="graph-wire-label"
                  x={midpoint.x}
                  y={midpoint.y - 9}
                  aria-hidden="true"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </>
  );
});

export function GraphCanvas({
  nodes,
  edges,
  selection,
  onSelect,
  onClear,
  camera,
  hidden,
  rings,
}: {
  nodes: readonly GraphNode[];
  edges: readonly DrawnEdge[];
  selection?: GraphSelection;
  onSelect: (selection: GraphSelection) => void;
  onClear: () => void;
  camera: Ref<GraphCamera>;
  hidden: boolean;
  rings?: readonly OrbitRing[];
}) {
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const dimensions = useRef<Size>({ width: 0, height: 0 });
  const viewport = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const initialFit = useRef(true);
  const animation = useRef(0);
  const drag = useRef<
    { id: number; start: Point; original: Viewport; moved: boolean } | undefined
  >(undefined);
  const [scale, setScale] = useState(100);

  const paint = useCallback((next: Viewport) => {
    viewport.current = next;
    if (animation.current) return;
    animation.current = requestAnimationFrame(() => {
      animation.current = 0;
      const { x, y, scale } = viewport.current;
      if (world.current && stage.current) {
        world.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        const grid = 24 * (scale < 0.65 ? scale * 2 : scale);
        stage.current.style.backgroundPosition = `${x}px ${y}px`;
        stage.current.style.backgroundSize = `${grid}px ${grid}px`;
        world.current.dataset.overview = String(scale < 0.62);
      }
      setScale(Math.round(scale * 100));
    });
  }, []);

  useLayoutEffect(() => {
    const surface = stage.current;
    if (!surface) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const previous = dimensions.current;
      dimensions.current = { width, height };
      if (initialFit.current) paint(fittedView(nodes, dimensions.current));
      else {
        const current = viewport.current;
        paint({
          ...current,
          x: current.x + (width - previous.width) / 2,
          y: current.y + (height - previous.height) / 2,
        });
      }
      initialFit.current = false;
    });
    observer.observe(surface);
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const box = surface!.getBoundingClientRect();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1);
      const factor = Math.exp(-Math.max(-190, Math.min(delta, 190)) * 0.004);
      paint(
        zoomAt(
          viewport.current,
          { x: event.clientX - box.left, y: event.clientY - box.top },
          factor,
        ),
      );
    }
    surface.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      surface.removeEventListener("wheel", wheel);
      cancelAnimationFrame(animation.current);
      animation.current = 0;
    };
  }, [nodes, paint]);

  function focus(node: GraphNode) {
    const box = stage.current?.getBoundingClientRect();
    const size = box?.width && box.height ? box : dimensions.current;
    dimensions.current = size;
    initialFit.current = false;
    paint(
      centerAt(
        node,
        size,
        Math.min(maxZoom, Math.max(1.12, viewport.current.scale)),
      ),
    );
  }
  useImperativeHandle(camera, () => ({ focus }));

  const reveal = useCallback(
    (point: Point) => {
      const current = viewport.current;
      const { width, height } = dimensions.current;
      const x = point.x * current.scale + current.x;
      const y = point.y * current.scale + current.y;
      if (x < 104 || x > width - 104 || y < 48 || y > height - 48)
        paint(centerAt(point, dimensions.current, current.scale));
    },
    [paint],
  );

  function zoom(factor: number) {
    const { width, height } = dimensions.current;
    paint(zoomAt(viewport.current, { x: width / 2, y: height / 2 }, factor));
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (drag.current || (event.button !== 0 && event.button !== 1)) return;
    if ((event.target as Element).closest("button,[data-graph-edge]")) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      original: viewport.current,
      moved: false,
    };
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (event.pointerId !== current?.id) return;
    const x = event.clientX - current.start.x;
    const y = event.clientY - current.start.y;
    if (!current.moved && Math.hypot(x, y) < 4) return;
    current.moved = true;
    event.currentTarget.dataset.panning = "true";
    paint({
      ...current.original,
      x: current.original.x + x,
      y: current.original.y + y,
    });
  }

  function stopPan(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId !== drag.current?.id) return;
    if (event.type === "pointerup" && !drag.current.moved) onClear();
    drag.current = undefined;
    delete event.currentTarget.dataset.panning;
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const offset: Record<string, Point> = {
      ArrowLeft: { x: 56, y: 0 },
      ArrowRight: { x: -56, y: 0 },
      ArrowUp: { x: 0, y: 56 },
      ArrowDown: { x: 0, y: -56 },
    };
    const shift = offset[event.key];
    if (shift) {
      const current = viewport.current;
      paint({ ...current, x: current.x + shift.x, y: current.y + shift.y });
    } else if (event.key === "+" || event.key === "=") zoom(1.24);
    else if (event.key === "-") zoom(1 / 1.24);
    else if (event.key === "0") paint(fittedView(nodes, dimensions.current));
    else if (event.key === "Escape") onClear();
    else return;
    event.preventDefault();
  }

  return (
    <div className="graph-canvas-area" hidden={hidden}>
      <div
        ref={stage}
        className="graph-stage"
        data-layout={rings ? "orbital" : "hierarchical"}
        role="region"
        aria-label="Canvas do KGraph"
        aria-describedby="graph-keyboard"
        tabIndex={0}
        onPointerDown={startPan}
        onPointerMove={pan}
        onPointerUp={stopPan}
        onLostPointerCapture={stopPan}
        onKeyDown={keyboard}
      >
        <div ref={world} className="graph-world">
          {!!rings?.length && (
            <svg
              className="graph-orbits"
              width="1"
              height="1"
              aria-hidden="true"
            >
              {rings.map(({ rx, ry }) => (
                <ellipse key={rx} cx="0" cy="0" rx={rx} ry={ry} />
              ))}
            </svg>
          )}
          <GraphOverlay
            nodes={nodes}
            edges={edges}
            selection={selection}
            onSelect={onSelect}
            reveal={reveal}
          />
        </div>
      </div>
      <span id="graph-keyboard" className="visually-hidden">
        Use as setas no fundo para deslocar, mais e menos para zoom e zero para
        enquadrar. Use Tab e as setas sobre os nós e relações para percorrê-los.
      </span>
      <div
        className="graph-camera"
        role="group"
        aria-label="Controles do canvas"
      >
        <button
          type="button"
          aria-label="Reduzir zoom"
          title="Reduzir zoom (−)"
          onClick={() => zoom(1 / 1.24)}
        >
          <VisualIcon name="minus" />
        </button>
        <button
          type="button"
          className="graph-zoom-value"
          aria-label={`Zoom ${scale}%. Redefinir para 100%`}
          title="Redefinir para 100%"
          onClick={() => paint(fittedView(nodes, dimensions.current, true))}
        >
          {scale}%
        </button>
        <button
          type="button"
          aria-label="Aumentar zoom"
          title="Aumentar zoom (+)"
          onClick={() => zoom(1.24)}
        >
          <VisualIcon name="plus" />
        </button>
        <button
          type="button"
          aria-label="Enquadrar grafo"
          title="Enquadrar grafo (0)"
          onClick={() => paint(fittedView(nodes, dimensions.current))}
        >
          <VisualIcon name="fit" />
        </button>
      </div>
    </div>
  );
}
