import type {
  GitObservation,
  Health,
  Project,
  ProjectIdentityResult,
  ProjectRecord,
  ResumeSummary,
} from "@laplace/contracts";
import { useMemo, type RefObject } from "react";
import { ContextView } from "./ContextView";
import { GraphTeaser } from "./graph/GraphTeaser";
import { ProjectGraphView } from "./graph/ProjectGraphView";
import { projectGraph } from "./graph/projectGraph";
import { branchLabel, ChangeSummary, ObservationTime } from "./Home";
import { ProjectTaskDigest } from "./ProjectTaskDigest";
import { ResumeCockpit } from "./ResumeCockpit";
import { TaskView, type TaskProposal } from "./TaskView";
import { SpectralField } from "./SpectralField";
import { VisualIcon } from "./VisualIcon";
import {
  projectDestinations,
  type PreviewId,
  type ProjectSection,
} from "./navigation";
import { EmptyState } from "./WorkView";
import type { Theme } from "./appearance";
import { WorkingTreeView } from "./WorkingTreeView";
import type { createDesktopClient } from "./ipc";

export { Home } from "./Home";

export type ServiceStatus =
  | { state: "loading" }
  | { state: "ready"; health: Health }
  | { state: "error"; message: string };

export type ProjectStatus =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; message: string; canRelocate: boolean };

export function ProjectView({
  project,
  summary,
  identity,
  resume,
  status,
  theme,
  paused,
  spectralPhase,
  refresh,
  relocate,
  confirmIdentity,
  contextClient,
  codexClient,
  taskClient,
  executionClient,
  workingClient,
  decisionClient,
  onResumeUpdated,
  section,
  graphFocus,
  taskProposal,
  onTaskProposal,
  onSection,
  openLab,
}: {
  project: ProjectRecord;
  summary: GitObservation | undefined;
  identity: ProjectIdentityResult | null;
  resume: ResumeSummary | null;
  status: ProjectStatus;
  theme: Theme;
  paused: boolean;
  spectralPhase: RefObject<number>;
  refresh: () => void;
  relocate: () => void;
  confirmIdentity: () => Promise<Project>;
  contextClient: ReturnType<typeof createDesktopClient>["context"];
  codexClient: ReturnType<typeof createDesktopClient>["codex"];
  taskClient: ReturnType<typeof createDesktopClient>["task"];
  executionClient: ReturnType<typeof createDesktopClient>["execution"];
  workingClient: ReturnType<typeof createDesktopClient>["working"];
  decisionClient: ReturnType<typeof createDesktopClient>["decisions"];
  onResumeUpdated: () => void;
  section: ProjectSection;
  graphFocus?: string;
  taskProposal?: TaskProposal;
  onTaskProposal: (source: TaskProposal["source"], objective: string) => void;
  onSection: (section: ProjectSection, focus?: string) => void;
  openLab: (id: PreviewId) => void;
}) {
  const loading = status.state === "loading";
  const overview = section === "overview";
  const observation = resume ? resume.observation.observation : summary;
  const graph = useMemo(
    () => projectGraph(project, identity, resume),
    [project, identity, resume],
  );
  const source = graph?.nodes.find((node) => node.kind === "source");
  const destination = projectDestinations.find((item) => item.id === section)!;

  if (section === "graph" && graph && resume)
    return (
      <ProjectGraphView
        key={graphFocus ?? "overview"}
        data={graph}
        resume={resume}
        client={decisionClient}
        initialNode={graphFocus}
        navigate={onSection}
        refresh={refresh}
      />
    );

  return (
    <>
      <header
        className={overview ? "checkout-masthead" : "checkout-masthead subview"}
      >
        {overview && (
          <SpectralField
            theme={theme}
            paused={paused}
            phase={spectralPhase}
            scene={project.id}
          />
        )}
        <div className="checkout-masthead-body">
          <div>
            <p className="eyebrow">
              <VisualIcon name={overview ? "folder" : destination.icon} />{" "}
              {overview ? "Checkout local" : project.name}
            </p>
            <h1>{overview ? project.name : destination.label}</h1>
            <div className="checkout-chips">
              {observation && (
                <span className="checkout-chip">
                  <VisualIcon name="git" />
                  <code>{branchLabel(observation)}</code>
                </span>
              )}
              {overview && observation && (
                <span className="checkout-observed">
                  {resume?.observation.state === "fresh"
                    ? "Leitura Git"
                    : "Git em cache"}{" "}
                  · <ObservationTime iso={observation.observedAt} />
                </span>
              )}
              <details className="checkout-path">
                <summary>
                  <VisualIcon name="folder" /> Pasta do checkout{" "}
                  <VisualIcon name="chevron" />
                </summary>
                <code>{project.root}</code>
              </details>
            </div>
          </div>
          {(overview || status.state !== "ready") && (
            <button
              type="button"
              className="button checkout-refresh"
              disabled={loading}
              onClick={refresh}
            >
              <VisualIcon name="refresh" /> Atualizar Git
            </button>
          )}
        </div>
        {overview && observation && (
          <ChangeSummary changes={observation.changes} />
        )}
      </header>
      {loading && (
        <p className="work-message" role="status">
          Consultando o checkout…
        </p>
      )}
      {status.state === "error" && (
        <div className="error-banner">
          <strong role="alert">{status.message}</strong>
          {status.canRelocate && (
            <button type="button" className="text-button" onClick={relocate}>
              Relocalizar pasta
            </button>
          )}
        </div>
      )}
      {section === "graph" ? (
        !loading && (
          <EmptyState
            icon="graph"
            title="Relações indisponíveis neste checkout"
          >
            <button type="button" className="text-button" onClick={refresh}>
              Atualizar leitura do checkout
            </button>
          </EmptyState>
        )
      ) : section === "tasks" ? (
        <TaskView
          projectId={project.id}
          client={taskClient}
          executionClient={executionClient}
          proposal={taskProposal}
          openAgents={() => openLab("agents")}
        />
      ) : section === "context" ? (
        <ContextView
          key={project.id + "/" + project.root}
          projectId={project.id}
          projectName={project.name}
          client={contextClient}
          codex={codexClient}
          onCreateTask={onTaskProposal}
          openMemory={() => openLab("memory")}
        />
      ) : section === "working" ? (
        <WorkingTreeView
          key={project.root}
          projectId={project.id}
          client={workingClient}
          cockpitObservation={observation}
        />
      ) : (
        <div className="cockpit-layout">
          <ResumeCockpit
            project={project}
            fallbackSummary={summary}
            identity={identity}
            resume={resume}
            loading={loading}
            relocate={relocate}
            confirmIdentity={confirmIdentity}
            contextClient={contextClient}
            decisionClient={decisionClient}
            onResumeUpdated={onResumeUpdated}
            onViewChanges={() => onSection("working")}
            onViewGraph={
              graph?.nodes.some((node) => node.kind === "decision")
                ? () => onSection("graph", "decision")
                : undefined
            }
          />
          <aside
            className="cockpit-aside"
            aria-label="Fontes, relações e tarefas"
          >
            <section className="source-register">
              <header className="surface-heading">
                <VisualIcon name="file" />
                <h2>Fontes e evidências</h2>
              </header>
              {source ? (
                <button
                  type="button"
                  className="studio-project-row"
                  onClick={() => onSection("graph", "source")}
                >
                  <span className="artifact-icon" data-kind="source">
                    <VisualIcon name="file" />
                  </span>
                  <span>
                    <strong>{source.label}</strong>
                    <small>
                      {source.target
                        ? "Prova da decisão"
                        : "Lacuna na última leitura"}
                    </small>
                  </span>
                  <VisualIcon name="forward" />
                </button>
              ) : (
                <p className="work-muted">
                  {loading
                    ? "Lendo a revisão do checkout…"
                    : "Nenhuma prova vinculada à decisão vigente."}
                </p>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => onSection("context")}
              >
                Abrir contexto <VisualIcon name="forward" />
              </button>
            </section>
            {graph && (
              <GraphTeaser data={graph} onOpen={() => onSection("graph")} />
            )}
            {resume && (
              <ProjectTaskDigest
                projectId={project.id}
                client={taskClient}
                openTasks={() => onSection("tasks")}
              />
            )}
          </aside>
        </div>
      )}
    </>
  );
}
