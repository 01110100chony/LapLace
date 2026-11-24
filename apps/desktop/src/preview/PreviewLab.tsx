import { useEffect, useState } from "react";
import { GraphTeaser } from "../graph/GraphTeaser";
import { previewDestinations, type PreviewId } from "../navigation";
import { VisualIcon } from "../VisualIcon";
import { EmptyState } from "../WorkView";
import {
  fixtureName,
  readFixture,
  type PreviewState,
  type Scenario,
} from "./fixtures";
import { HypothesisArena, TemporalReplay } from "./History";
import { ContextCompiler, MemoryExplorer } from "./Knowledge";
import { AgentCenter, GitPlanner, MemoryInbox, PreFlight } from "./Operations";
import { PreviewGraph } from "./PreviewGraph";
import type { NavigatePreview } from "./Shared";

const experiences = {
  memory: {
    description: "Decisões, revisões e fontes",
    Screen: MemoryExplorer,
  },
  graph: { description: "Relações do acervo de exemplo", Screen: PreviewGraph },
  compiler: {
    description: "Manifesto, fontes e orçamento",
    Screen: ContextCompiler,
  },
  inbox: { description: "Propostas e conflitos", Screen: MemoryInbox },
  agents: {
    description: "Sessões e revisão de resultados",
    Screen: AgentCenter,
  },
  planner: { description: "Etapas, precondições e risco", Screen: GitPlanner },
  preflight: { description: "Escopo, fontes e destino", Screen: PreFlight },
  arena: { description: "Comparação de hipóteses", Screen: HypothesisArena },
  replay: {
    description: "Vigência e registro das revisões",
    Screen: TemporalReplay,
  },
};

const scenarios: Record<Scenario, string> = {
  ready: "Dados de exemplo",
  medium: "Grafo médio",
  empty: "Sem registros",
  error: "Falha de leitura",
  unavailable: "Indisponível",
};
const groups = [...new Set(previewDestinations.map((item) => item.group))];

function Experiment({
  preview,
  navigate,
  focus,
}: {
  preview: PreviewId;
  navigate: NavigatePreview;
  focus?: string;
}) {
  const [request, setRequest] = useState({
    scenario: "ready" as Scenario,
    revision: 0,
  });
  const [response, setResponse] = useState<{
    revision: number;
    state: PreviewState;
  }>();
  const entry = previewDestinations.find((item) => item.id === preview)!;
  const state =
    response?.revision === request.revision
      ? response.state
      : { kind: "loading" as const };
  const graph = preview === "graph";

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setResponse({
          revision: request.revision,
          state: readFixture(preview, request.scenario),
        }),
      150,
    );
    return () => window.clearTimeout(timer);
  }, [preview, request]);

  function chooseScenario(scenario: Scenario) {
    setRequest((current) => ({ scenario, revision: current.revision + 1 }));
  }

  const scenarioControl = (
    <label className="preview-input scenario-control">
      <span>Cenário de prévia</span>
      <select
        value={request.scenario}
        onChange={(event) => chooseScenario(event.target.value as Scenario)}
      >
        {Object.entries(scenarios)
          .filter(([id]) => id !== "medium" || graph)
          .map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
      </select>
    </label>
  );

  if (state.kind === "ready" && graph)
    return (
      <PreviewGraph
        navigate={navigate}
        focus={focus}
        isMedium={request.scenario === "medium"}
        tools={scenarioControl}
      />
    );

  const Screen = preview !== "graph" ? experiences[preview].Screen : null;
  return (
    <div className="preview-experiment">
      <header className="surface-intro preview-heading">
        <div>
          <p className="eyebrow">
            <VisualIcon name={entry.icon} />{" "}
            {graph ? "Prévia · " + fixtureName : entry.group}
          </p>
          <h1>{entry.label}</h1>
        </div>
        {scenarioControl}
      </header>
      <div className="preview-content" aria-busy={state.kind === "loading"}>
        {state.kind === "loading" && (
          <p className="work-message" role="status">
            Carregando o cenário…
          </p>
        )}
        {state.kind === "empty" && (
          <EmptyState
            icon={entry.icon}
            title={
              graph ? "Nenhum nó no cenário" : "Nenhum registro no cenário"
            }
          >
            <button
              type="button"
              className="text-button"
              onClick={() => chooseScenario("ready")}
            >
              Abrir dados de exemplo
            </button>
          </EmptyState>
        )}
        {state.kind === "error" && (
          <div className="error-banner" role="alert">
            {state.message}
            <button
              type="button"
              className="text-button"
              onClick={() => chooseScenario("ready")}
            >
              Reabrir o exemplo
            </button>
          </div>
        )}
        {state.kind === "unavailable" && (
          <EmptyState icon={entry.icon} title="Capacidade indisponível">
            {state.message}
          </EmptyState>
        )}
        {state.kind === "ready" && Screen && (
          <Screen navigate={navigate} focus={focus} />
        )}
      </div>
    </div>
  );
}

export default function PreviewLab({
  preview,
  focus,
  navigate,
  index,
}: {
  preview?: PreviewId;
  focus?: string;
  navigate: NavigatePreview;
  index: () => void;
}) {
  return (
    <div className="preview-lab">
      {preview && preview !== "graph" && (
        <div className="lab-status">
          <span>
            <VisualIcon name="lab" /> Prévia · dados de exemplo
          </span>
          {preview && (
            <button type="button" className="text-button" onClick={index}>
              Todas as experiências
            </button>
          )}
        </div>
      )}
      {preview ? (
        <Experiment
          key={preview + (focus ?? "")}
          preview={preview}
          focus={focus}
          navigate={navigate}
        />
      ) : (
        <>
          <header className="surface-intro lab-intro">
            <h1>Laboratório</h1>
            <span className="lab-mode">
              <VisualIcon name="lab" /> Prévia · dados de exemplo
            </span>
          </header>
          <div className="lab-layout">
            <GraphTeaser preview onOpen={() => navigate("graph")} />
            <div className="lab-index">
              {groups.map((group) => (
                <section key={group}>
                  <h2>{group}</h2>
                  <ul>
                    {previewDestinations
                      .filter(
                        (item) => item.group === group && item.id !== "graph",
                      )
                      .map((item) => (
                        <li key={item.id}>
                          <button
                            className="lab-destination"
                            type="button"
                            onClick={() => navigate(item.id)}
                          >
                            <span className="artifact-icon">
                              <VisualIcon name={item.icon} />
                            </span>
                            <span>
                              <strong>{item.label}</strong>
                              <small>{experiences[item.id].description}</small>
                            </span>
                            <VisualIcon name="chevron" />
                          </button>
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
