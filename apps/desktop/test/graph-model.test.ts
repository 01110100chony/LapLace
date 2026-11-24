import assert from "node:assert/strict";
import test from "node:test";
import {
  centerAt,
  edgePath,
  fittedView,
  nodeSize,
  placeOnOrbits,
  zoomAt,
  type GraphNode,
} from "../src/graph/model.ts";

function node(id: string, x: number, y: number): GraphNode {
  return { id, kind: "source", label: id, x, y };
}

test("the camera keeps the world coordinate under the pointer at each zoom level", () => {
  const viewport = { x: 64, y: -38, scale: 0.8 };
  const pointer = { x: 377, y: 244 };
  const world = [
    (pointer.x - viewport.x) / viewport.scale,
    (pointer.y - viewport.y) / viewport.scale,
  ];
  for (const factor of [1.24, 0.75, 100, 0.005]) {
    const next = zoomAt(viewport, pointer, factor);
    assert.ok(Math.abs((pointer.x - next.x) / next.scale - world[0]!) < 1e-8);
    assert.ok(Math.abs((pointer.y - next.y) / next.scale - world[1]!) < 1e-8);
    assert.ok(next.scale >= 0.1 && next.scale <= 2.75);
  }
});

test("fit includes node bounds on narrow and medium viewports", () => {
  const nodes = Array.from({ length: 75 }, (_, index) =>
    node(String(index), (index % 9) * 245, Math.floor(index / 9) * 125),
  );
  for (const size of [
    { width: 414, height: 480 },
    { width: 1040, height: 540 },
  ]) {
    const fit = fittedView(nodes, size);
    for (const { x, y } of nodes) {
      assert.ok(fit.x + (x - nodeSize.width / 2) * fit.scale >= 0);
      assert.ok(fit.x + (x + nodeSize.width / 2) * fit.scale <= size.width);
      assert.ok(fit.y + (y - nodeSize.height / 2) * fit.scale >= 0);
      assert.ok(fit.y + (y + nodeSize.height / 2) * fit.scale <= size.height);
    }
  }
});

test("reset and focus center the intended point without changing the graph layout", () => {
  const size = { width: 800, height: 500 };
  assert.deepEqual(centerAt({ x: 100, y: 80 }, size, 2), {
    x: 200,
    y: 90,
    scale: 2,
  });
  assert.deepEqual(fittedView([], size), { x: 400, y: 250, scale: 1 });
  assert.deepEqual(
    fittedView([node("source", 0, 0), node("record", 200, 160)], size, true),
    { x: 300, y: 170, scale: 1 },
  );
});

test("edge paths stop at node boundaries and preserve direction", () => {
  const from = node("decision", 0, 0);
  const to = node("proof", 300, 0);
  assert.match(edgePath(from, to).d, /^M90,0 .* 205,0$/);
  assert.match(edgePath(to, from).d, /^M210,0 .* 95,0$/);
});

test("orbital projection preserves node identity and prioritizes connected nodes", () => {
  const project = { ...node("project", 42, 22), kind: "project" } as const;
  const graph = [
    project,
    ...Array.from({ length: 7 }, (_, i) => node("detached-" + i, i, 0)),
    node("evidence", 300, 600),
  ];
  const edges = [
    {
      id: "proof",
      from: project.id,
      to: "evidence",
      label: "referencia",
      origin: "fixture",
    },
    {
      id: "missing",
      from: "unknown",
      to: "evidence",
      label: "referencia",
      origin: "fixture",
    },
  ];
  const layout = placeOnOrbits(graph, edges);
  assert.deepEqual(
    layout.nodes.map(({ id }) => id),
    graph.map(({ id }) => id),
  );
  assert.deepEqual(layout.nodes[0], { ...project, x: 0, y: 0 });
  assert.equal(layout.nodes.at(-1)?.y, -layout.rings[0]!.ry);
  assert.equal(project.x, 42);
  assert.deepEqual(placeOnOrbits(graph, edges), layout);
});

test("the medium orbital fixture fits the camera without overlapping node cards", () => {
  const graph = Array.from({ length: 75 }, (_, i) => node(String(i), i, 0));
  const { nodes, rings } = placeOnOrbits(graph, []);
  assert.equal(rings.length, 5);
  for (const [i, current] of nodes.entries()) {
    for (const other of nodes.slice(i + 1)) {
      assert.ok(
        Math.abs(current.x - other.x) >= nodeSize.width ||
          Math.abs(current.y - other.y) >= nodeSize.height,
        current.id + " overlaps " + other.id,
      );
    }
  }
});
