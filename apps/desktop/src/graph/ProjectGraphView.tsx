import { useEffect, useState } from "react";
import type { ResolvedEvidence, ResumeSummary } from "@laplace/contracts";
import { EvidenceProof } from "../EvidenceProof";
import { type createDesktopClient, errorMessage } from "../ipc";
import type { ProjectSection } from "../navigation";
import { VisualIcon } from "../VisualIcon";
import { createLatestRequest } from "../workspace";
import type { GraphData } from "./model";
import { KGraph } from "./KGraph";

function GraphSource({
  resume,
  client,
}: {
  resume: ResumeSummary;
  client: ReturnType<typeof createDesktopClient>["decisions"];
}) {
  const [latest] = useState(createLatestRequest);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; proof: ResolvedEvidence }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  useEffect(() => () => latest.invalidate(), [latest]);
  const ref = resume.memory.decision?.evidence.ref;
  if (!ref || ref.projectId !== resume.scope.projectId) return null;
  function load() {
    if (!ref) return;
    setState({ kind: "loading" });
    void latest.run(
      () =>
        client.evidenceResolve(resume.scope, {
          contextId: ref.contextId,
          path: ref.path,
          sha256: ref.sha256,
          chunk: ref.chunk,
        }),
      (proof) => setState({ kind: "ready", proof }),
      (error) => setState({ kind: "error", message: errorMessage(error) }),
    );
  }
  if (state.kind === "ready") return <EvidenceProof proof={state.proof} />;
  return (
    <>
      {state.kind === "error" && (
        <p className="work-message" role="alert">
          {state.message}
        </p>
      )}
      <button
        type="button"
        className="button primary"
        onClick={load}
        disabled={state.kind === "loading"}
      >
        <VisualIcon name="file" />{" "}
        {state.kind === "loading" ? "Lendo a prova…" : "Abrir prova preservada"}
      </button>
    </>
  );
}

const routes = {
  overview: "Abrir retomada",
  working: "Ver alterações Git",
  context: "Abrir contexto",
  tasks: "Abrir tarefas",
} as const;
type GraphRoute = keyof typeof routes;

export function ProjectGraphView({
  data,
  resume,
  client,
  initialNode,
  navigate,
  refresh,
}: {
  data: GraphData;
  resume: ResumeSummary;
  client: ReturnType<typeof createDesktopClient>["decisions"];
  initialNode?: string;
  navigate: (section: ProjectSection) => void;
  refresh: () => void;
}) {
  return (
    <KGraph
      data={data}
      initialNode={initialNode}
      tools={
        <button type="button" className="button" onClick={refresh}>
          <VisualIcon name="refresh" /> Atualizar leitura
        </button>
      }
      renderAction={(node) => {
        if (node.target === "source")
          return (
            <GraphSource
              key={resume.memory.decision?.revisionId}
              resume={resume}
              client={client}
            />
          );
        const target = node.target as GraphRoute | undefined;
        return (
          target && (
            <button
              type="button"
              className="button"
              onClick={() => navigate(target)}
            >
              {routes[target]} <VisualIcon name="forward" />
            </button>
          )
        );
      }}
    />
  );
}
