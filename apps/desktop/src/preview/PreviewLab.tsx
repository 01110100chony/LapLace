import { useEffect, useState } from "react";
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
import { ContextCompiler, KnowledgeGraph, MemoryExplorer } from "./Knowledge";
import { AgentCenter, GitPlanner, MemoryInbox, PreFlight } from "./Operations";
import type { NavigatePreview } from "./Shared";

const experiences = {
  memory: {
    description: "Leia uma decisão, percorra suas revisões e siga até a prova.",
    Screen: MemoryExplorer,
  },
  graph: {
    description: "Navegue pelas relações que ligam decisões, fontes e tarefas.",
    Screen: KnowledgeGraph,
  },
  compiler: {
    description: "Componha um manifesto local com seleção e orçamento.",
    Screen: ContextCompiler,
  },
  inbox: {
    description: "Inspecione propostas de memória e revise conflitos.",
    Screen: MemoryInbox,
  },
  agents: {
    description: "Acompanhe capacidades, tentativas e resultados em revisão.",
    Screen: AgentCenter,
  },
  planner: {
    description: "Organize as etapas e revise as precondições de um plano.",
    Screen: GitPlanner,
  },
  preflight: {
    description: "Confira escopo, fontes, risco e destino antes de revisar.",
    Screen: PreFlight,
  },
  arena: {
    description: "Compare o resultado e o custo de hipóteses concorrentes.",
    Screen: HypothesisArena,
  },
  replay: {
    description: "Compare o estado conhecido e a vigência em dois momentos.",
    Screen: TemporalReplay,
  },
} satisfies Record<
  PreviewId,
  { description: string; Screen: typeof MemoryExplorer }
>;

const scenarios: Record<Scenario, string> = {
  ready: "Dados de exemplo",
  empty: "Sem registros",
  error: "Falha de leitura",
  unavailable: "Indisponível",
};
const groups = [...new Set(previewDestinations.map((item) => item.group))];

function Experiment({
  preview,
  navigate,
}: {
  preview: PreviewId;
  navigate: NavigatePreview;
}) {
  const [request, setRequest] = useState({
    scenario: "ready" as Scenario,
    revision: 0,
  });
  const [response, setResponse] = useState<{
    revision: number;
    state: PreviewState;
  }>();
  const { Screen, description } = experiences[preview];
  const entry = previewDestinations.find((item) => item.id === preview)!;
  const state =
    response?.revision === request.revision
      ? response.state
      : { kind: "loading" as const };

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setResponse({
          revision: request.revision,
          state: readFixture(preview, request.scenario),
        }),
      180,
    );
    return () => window.clearTimeout(timer);
  }, [preview, request]);

  function chooseScenario(scenario: Scenario) {
    setRequest((current) => ({ scenario, revision: current.revision + 1 }));
  }

  return (
    <div className="preview-experiment">
      <header className="surface-intro preview-heading">
        <div>
          <p className="eyebrow">
            <VisualIcon name={entry.icon} /> {entry.group}
          </p>
          <h1>{entry.label}</h1>
          <p>{description}</p>
        </div>
        <label className="preview-input scenario-control">
          <span>Cenário de prévia</span>
          <select
            value={request.scenario}
            onChange={(event) => chooseScenario(event.target.value as Scenario)}
          >
            {Object.entries(scenarios).map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="preview-content" aria-busy={state.kind === "loading"}>
        {state.kind === "loading" && (
          <p className="work-message" role="status">
            Carregando o cenário…
          </p>
        )}
        {state.kind === "empty" && (
          <EmptyState icon={entry.icon} title="A fixture está vazia">
            Use o cenário Dados de exemplo para explorar a experiência.
          </EmptyState>
        )}
        {state.kind === "error" && (
          <div className="error-banner" role="alert">
            {state.message}{" "}
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
        {state.kind === "ready" && <Screen navigate={navigate} />}
      </div>
    </div>
  );
}

export default function PreviewLab({
  preview,
  navigate,
  index,
}: {
  preview?: PreviewId;
  navigate: NavigatePreview;
  index: () => void;
}) {
  return (
    <div className="preview-lab">
      <div className="lab-status">
        <span>
          <VisualIcon name="lab" /> Prévia <small>{fixtureName}</small>
        </span>
        {preview && (
          <button type="button" className="text-button" onClick={index}>
            Todas as experiências
          </button>
        )}
      </div>
      {preview ? (
        <Experiment key={preview} preview={preview} navigate={navigate} />
      ) : (
        <>
          <header className="surface-intro lab-intro">
            <h1>Laboratório</h1>
            <p>
              Explore as experiências futuras em um projeto demonstrativo, com
              dados isolados do catálogo local.
            </p>
          </header>
          <div className="lab-index">
            {groups.map((group) => (
              <section key={group}>
                <h2>{group}</h2>
                <ul>
                  {previewDestinations
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <li key={item.id}>
                        <button
                          className="lab-destination"
                          type="button"
                          onClick={() => navigate(item.id)}
                        >
                          <VisualIcon name={item.icon} />
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
        </>
      )}
    </div>
  );
}
