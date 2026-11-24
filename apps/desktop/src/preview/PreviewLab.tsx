import { useEffect, useRef, useState, type RefObject } from "react";
import type { Theme } from "../appearance";
import { previewDestinations, type PreviewId } from "../navigation";
import { SpectralField } from "../SpectralField";
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
import { LabThumb } from "./LabVisuals";
import { AgentCenter, GitPlanner, MemoryInbox, PreFlight } from "./Operations";
import { LabHero, type NavigatePreview } from "./Shared";

const experiences = {
  memory: {
    description:
      "Leia uma decisão, percorra suas revisões bitemporais e siga até a prova preservada.",
    Screen: MemoryExplorer,
  },
  graph: {
    description:
      "Navegue pela cartografia orbital que liga decisões, fontes e tarefas verificáveis.",
    Screen: KnowledgeGraph,
  },
  compiler: {
    description:
      "Componha um manifesto local com seleção estratificada e limite explícito em tokens.",
    Screen: ContextCompiler,
  },
  inbox: {
    description:
      "Inspecione propostas na membrana de quarentena e resolva conflitos humanos.",
    Screen: MemoryInbox,
  },
  agents: {
    description:
      "Acompanhe confinamento, estágios de execução e resultados em revisão.",
    Screen: AgentCenter,
  },
  planner: {
    description:
      "Organize etapas em worktree dedicada e revise as precondições sem mutar main.",
    Screen: GitPlanner,
  },
  preflight: {
    description:
      "Confira escopo, fontes, risco e destino no astrolábio de prontidão antes de agir.",
    Screen: PreFlight,
  },
  arena: {
    description:
      "Compare trajetórias paralelas e custo de hipóteses a partir da mesma base Git.",
    Screen: HypothesisArena,
  },
  replay: {
    description:
      "Reconstrua o estado conhecido (K) e a vigência (V) comparando dois instantes.",
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

const groupDescriptions: Record<(typeof groups)[number], string> = {
  Conhecimento:
    "Memória versionada, cartografia causal, orçamento de contexto e triagem humana.",
  Supervisão:
    "Observatório de execução confinada, topologia Git e portões de prontidão.",
  Experimentos:
    "Bifurcação de hipóteses paralelas e reconstrução histórica bitemporal.",
};

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
      <LabHero
        preview={preview}
        description={description}
        scenarioControl={
          <label className="preview-input scenario-control">
            <span>Cenário de prévia</span>
            <select
              value={request.scenario}
              onChange={(event) =>
                chooseScenario(event.target.value as Scenario)
              }
            >
              {Object.entries(scenarios).map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        }
      />

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
  theme = "Noir",
  paused = false,
  spectralPhase,
}: {
  preview?: PreviewId;
  navigate: NavigatePreview;
  index: () => void;
  theme?: Theme;
  paused?: boolean;
  spectralPhase?: RefObject<number>;
}) {
  const localPhase = useRef(0);
  const phase = spectralPhase ?? localPhase;
  const stripRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!preview || !stripRef.current) return;
    const active = stripRef.current.querySelector('[aria-current="page"]');
    if (active instanceof HTMLElement) {
      active.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [preview]);

  return (
    <div className="preview-lab">
      <div className="lab-status">
        <span className="lab-status-id">
          <VisualIcon name="lab" />
          <strong>Prévia isolada</strong>
          <small>{fixtureName}</small>
        </span>
        {preview && (
          <button type="button" className="text-button" onClick={index}>
            Todas as experiências
          </button>
        )}
      </div>

      {preview && (
        <nav
          ref={stripRef}
          className="lab-strip"
          aria-label="Instrumentos do Laboratório"
        >
          {previewDestinations.map((item) => (
            <button
              key={item.id}
              type="button"
              className="lab-strip-item"
              aria-current={item.id === preview ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <VisualIcon name={item.icon} />
              <span>{item.label}</span>
              <small>{item.milestone}</small>
            </button>
          ))}
        </nav>
      )}

      {preview ? (
        <Experiment key={preview} preview={preview} navigate={navigate} />
      ) : (
        <>
          <header className="lab-masthead">
            <div className="lab-masthead-copy">
              <p className="eyebrow">
                <VisualIcon name="lab" /> Living Systems 2.0 · Instrumentos
              </p>
              <h1>Laboratório</h1>
              <p>
                Explore as nove superfícies experimentais em um projeto
                demonstrativo isolado do catálogo local.
              </p>
              <dl className="lab-telemetry" aria-label="Resumo do laboratório">
                <div>
                  <dt>Instrumentos</dt>
                  <dd>9</dd>
                </div>
                <div>
                  <dt>Camadas</dt>
                  <dd>3</dd>
                </div>
                <div>
                  <dt>Fases</dt>
                  <dd>F2–F5</dd>
                </div>
              </dl>
            </div>
            <SpectralField
              theme={theme}
              paused={paused}
              phase={phase}
              scene="lab"
            />
          </header>

          <div className="lab-index-groups">
            {groups.map((group) => (
              <section key={group} className="lab-gallery">
                <header className="lab-gallery-head">
                  <h2>{group}</h2>
                  <p>{groupDescriptions[group]}</p>
                </header>
                <ul className="lab-specimen-grid">
                  {previewDestinations
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <li key={item.id}>
                        <button
                          className="lab-specimen"
                          type="button"
                          onClick={() => navigate(item.id)}
                        >
                          <div className="lab-specimen-visual">
                            <LabThumb id={item.id} />
                            <span className="lab-milestone-badge">
                              {item.milestone}
                            </span>
                          </div>
                          <div className="lab-specimen-body">
                            <span className="lab-specimen-title">
                              <VisualIcon name={item.icon} />
                              <strong>{item.label}</strong>
                            </span>
                            <small>{experiences[item.id].description}</small>
                          </div>
                          <span className="lab-specimen-foot">
                            <span>Abrir instrumento</span>
                            <VisualIcon name="forward" />
                          </span>
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
