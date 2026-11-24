import type { ReactNode } from "react";
import { KGraph } from "../graph/KGraph";
import type { GraphData, GraphNode } from "../graph/model";
import { VisualIcon } from "../VisualIcon";
import { fixtureName, memoryRecords, sources } from "./fixtures";
import { Evidence, type NavigatePreview } from "./Shared";

const scope = { kind: "preview", label: fixtureName } as const;
const nodes: GraphNode[] = [
  {
    id: "project",
    kind: "project",
    label: "Acervo Atlas",
    x: 0,
    y: 0,
    facts: [{ label: "Origem", value: "Cenário sintético do Laboratório" }],
  },
  ...memoryRecords.map((record, i): GraphNode => ({
    id: record.id,
    kind: "decision",
    label: record.title,
    x: 294,
    y: -170 + i * 148,
    description: record.revisions[0]?.content,
    target: record.id,
    facts: [
      { label: "Origem", value: record.scope },
      { label: "Revisão", value: String(record.revisions[0]?.version ?? 1) },
      { label: "Observada em", value: record.revisions[0]?.observed ?? "" },
    ],
  })),
  ...sources.map((source, i): GraphNode => ({
    id: source.id,
    kind: "source",
    label: source.path,
    x: i === 2 ? 36 : 545,
    y: [-201, 114, -156, -41][i]!,
    target: source.id,
    facts: [
      { label: "Origem", value: `${source.kind} da fixture` },
      { label: "Cobertura", value: "Trecho de exemplo" },
    ],
  })),
  {
    id: "review",
    kind: "task",
    label: "Revisar a prova",
    x: -250,
    y: -112,
    facts: [{ label: "Origem", value: "Tarefa do cenário sintético" }],
  },
  {
    id: "inspect",
    kind: "task",
    label: "Checar alterações",
    x: -250,
    y: 126,
    facts: [{ label: "Origem", value: "Tarefa do cenário sintético" }],
  },
];

const small: GraphData = {
  scope,
  nodes,
  edges: [
    ...memoryRecords.flatMap(({ id, source }) => [
      { from: "project", to: id, label: "tem decisão" },
      { from: id, to: source, label: "referencia" },
    ]),
    { from: "s3", to: "m1", label: "registra" },
    { from: "review", to: "project", label: "revisa" },
    { from: "inspect", to: "project", label: "verifica" },
  ].map((edge) => ({
    ...edge,
    id: `${edge.from}-${edge.to}`,
    origin: "Relação definida na fixture",
  })),
};

function mediumFixture(): GraphData {
  const kinds = ["source", "decision", "task", "capture"] as const;
  const labels = {
    source: "Fonte",
    decision: "Decisão",
    task: "Tarefa",
    capture: "Captura",
  };
  const nodes = Array.from({ length: 75 }, (_, i): GraphNode => {
    const kind = kinds[i % kinds.length]!;
    return {
      id: `medium-${i}`,
      kind,
      label: `${labels[kind]} ${i + 1}`,
      x: (i % 9) * 245,
      y: Math.floor(i / 9) * 125 + (i % 2) * 17,
      facts: [{ label: "Origem", value: "Fixture de escala" }],
    };
  });
  const edges = nodes.flatMap((node, i) =>
    [
      ...(i % 9 > 0 ? [i - 1] : []),
      ...(i >= 9 ? [i - 9] : []),
      ...(i > 18 && i % 9 < 8 && i % 2 === 0 ? [i - 8] : []),
    ].map((index) => ({
      id: `scale-${index}-${i}`,
      from: nodes[index]!.id,
      to: node.id,
      label: "relaciona",
      origin: "Relação sintética para verificar leitura espacial",
    })),
  );
  return {
    scope: { ...scope, label: "Cenário de escala · 75 nós" },
    nodes,
    edges,
  };
}

const medium = mediumFixture();

export function PreviewGraph({
  navigate,
  focus,
  isMedium,
  tools,
}: {
  navigate: NavigatePreview;
  focus?: string;
  isMedium: boolean;
  tools?: ReactNode;
}) {
  return (
    <KGraph
      data={isMedium ? medium : small}
      initialNode={focus}
      tools={tools}
      renderAction={(node) => {
        if (!node.target) return null;
        const target = node.target;
        if (node.kind === "source")
          return (
            <details className="graph-fixture-proof">
              <summary>Abrir fonte de exemplo</summary>
              <Evidence id={target} />
            </details>
          );
        return (
          <button
            type="button"
            className="button"
            onClick={() => navigate("memory", target)}
          >
            Abrir registro de memória <VisualIcon name="forward" />
          </button>
        );
      }}
    />
  );
}
