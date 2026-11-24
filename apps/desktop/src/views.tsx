import type {
  GitObservation,
  GitSummary,
  Health,
  Project,
  ProjectIdentityResult,
  ProjectRecord,
  ResumeSummary,
} from "@laplace/contracts";
import type { RefObject } from "react";
import { ContextView } from "./ContextView";
import { ProjectNavigation } from "./DesktopNavigation";
import { ProjectTaskDigest } from "./ProjectTaskDigest";
import { ResumeCockpit } from "./ResumeCockpit";
import { TaskView, type TaskProposal } from "./TaskView";
import { SpectralField } from "./SpectralField";
import { VisualIcon } from "./VisualIcon";
import type { PreviewId, ProjectSection } from "./navigation";
import { EmptyState } from "./WorkView";
import type { Theme } from "./appearance";
import { WorkingTreeView } from "./WorkingTreeView";
import { MemoryWorkspaceView } from "./MemoryWorkspaceView";
import { PlannerSupervisionView } from "./PlannerSupervisionView";
import { IntelligenceView } from "./IntelligenceView";
import type { createDesktopClient } from "./ipc";

export type ServiceStatus =
  | { state: "loading" }
  | { state: "ready"; health: Health }
  | { state: "error"; message: string };

export type ProjectStatus =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; message: string; canRelocate: boolean };

type HomeProps = {
  projects: ProjectRecord[];
  summaries: Readonly<Record<string, GitObservation | undefined>>;
  recent: ProjectRecord | undefined;
  service: ServiceStatus;
  theme: Theme;
  paused: boolean;
  spectralPhase: RefObject<number>;
  add: () => void;
  clone: () => void;
  open: (project: ProjectRecord) => void;
  retryService: () => void;
  openLab: (id?: PreviewId) => void;
};

function branchLabel(summary: GitSummary) {
  return summary.branch ?? "HEAD destacado";
}

export function Home({
  projects,
  summaries,
  recent,
  service,
  theme,
  paused,
  spectralPhase,
  add,
  clone,
  open,
  retryService,
  openLab,
}: HomeProps) {
  const recentSummary = recent ? summaries[recent.id] : undefined;
  const ready = service.state === "ready";
  const readings = projects
    .flatMap((project) => {
      const reading = summaries[project.id];
      return reading ? [{ project, reading }] : [];
    })
    .sort((left, right) =>
      right.reading.observedAt.localeCompare(left.reading.observedAt),
    );

  return (
    <div className="workspace-view workspace-dashboard">
      <header className="workspace-masthead">
        <div className="masthead-copy">
          <p className="eyebrow">LapLace</p>
          <h1>Área de trabalho</h1>
          <p>Retome seus projetos a partir da última leitura do checkout.</p>
          <div className="work-actions">
            <button
              type="button"
              className="button primary"
              disabled={!ready}
              onClick={add}
            >
              <VisualIcon name="plus" /> Adicionar projeto
            </button>
            <button
              type="button"
              className="button"
              disabled={!ready}
              onClick={clone}
            >
              <VisualIcon name="download" /> Clonar do GitHub
            </button>
          </div>
        </div>
        <SpectralField
          theme={theme}
          paused={paused}
          phase={spectralPhase}
          scene="workspace"
        />
      </header>

      <div className="workspace-flow">
        <section className="dashboard-panel desk-section desk-resume">
          <header className="dashboard-heading">
            <VisualIcon name="overview" />
            <h2>Continue de onde parou</h2>
          </header>
          {recent ? (
            <>
              <p className="desk-project-name">{recent.name}</p>
              {recentSummary ? (
                <>
                  <p className="desk-branch">
                    <VisualIcon name="git" />{" "}
                    <code>{branchLabel(recentSummary)}</code>
                  </p>
                  <p className="desk-changes">
                    {recentSummary.changes.staged} no índice ·{" "}
                    {recentSummary.changes.unstaged} no disco ·{" "}
                    {recentSummary.changes.untracked} sem rastreio
                    {recentSummary.changes.conflicted > 0 && (
                      <> · {recentSummary.changes.conflicted} em conflito</>
                    )}
                  </p>
                  <p className="work-muted">
                    Observado em <ObservedTime summary={recentSummary} />
                  </p>
                </>
              ) : (
                <p className="work-muted">
                  Abra o projeto para verificar o checkout.
                </p>
              )}
              <button
                type="button"
                className="button primary"
                onClick={() => open(recent)}
              >
                Retomar projeto <VisualIcon name="forward" />
              </button>
            </>
          ) : (
            <p className="work-muted">O último projeto aberto aparece aqui.</p>
          )}
        </section>

        <section className="project-register" aria-labelledby="local-projects">
          <header className="register-heading dashboard-heading">
            <VisualIcon name="folder" />
            <h2 id="local-projects">Projetos locais</h2>
            <span className="badge">{projects.length}</span>
          </header>
          {projects.length ? (
            <div
              className="directory"
              role="group"
              aria-label="Projetos cadastrados"
            >
              <ul>
                {projects.map((project) => {
                  const observation = summaries[project.id];
                  return (
                    <li key={project.id}>
                      <button
                        className="directory-row"
                        type="button"
                        onClick={() => open(project)}
                        title={project.root}
                      >
                        <span className="directory-project">
                          <span className="project-initial" aria-hidden="true">
                            <VisualIcon name="folder" />
                          </span>
                          <span className="directory-name">
                            <strong>{project.name}</strong>
                            {observation ? (
                              <code>{branchLabel(observation)}</code>
                            ) : (
                              <small>{project.root}</small>
                            )}
                          </span>
                        </span>
                        <span className="directory-observation">
                          {observation ? (
                            <small>
                              <ObservedTime summary={observation} />
                            </small>
                          ) : (
                            <small>Sem leitura nesta sessão</small>
                          )}
                        </span>
                        <VisualIcon name="forward" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : service.state === "loading" ? (
            <p className="work-message" role="status">
              Carregando catálogo…
            </p>
          ) : (
            <EmptyState
              icon="folder"
              title={
                ready ? "Nenhum projeto no catálogo" : "Catálogo indisponível"
              }
            >
              {ready
                ? "Adicione um checkout ou selecione um repositório do GitHub para clonar."
                : "Reconecte o serviço local para acessar seus projetos."}
            </EmptyState>
          )}
        </section>

        <section
          className="dashboard-panel workspace-activity"
          aria-labelledby="workspace-activity"
        >
          <header className="dashboard-heading">
            <VisualIcon name="clock" />
            <h2 id="workspace-activity">Leituras recentes</h2>
          </header>
          {readings.length ? (
            <ul>
              {readings.slice(0, 4).map(({ project, reading }) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className="activity-row"
                    onClick={() => open(project)}
                  >
                    <span className="dashboard-icon">
                      <VisualIcon name="git" />
                    </span>
                    <span>
                      <strong>{project.name}</strong>
                      <small>
                        Checkout observado · <code>{branchLabel(reading)}</code>
                      </small>
                    </span>
                    <ObservedTime summary={reading} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="work-muted">
              Abra um projeto para registrar a primeira leitura Git desta
              sessão.
            </p>
          )}
        </section>
      </div>

      <aside className="continuity-desk" aria-label="Retomada e ferramentas">
        <section className="dashboard-panel desk-section">
          <header className="dashboard-heading">
            <VisualIcon name="layers" />
            <h2>Contexto do workspace</h2>
          </header>
          <dl className="workspace-facts">
            <div>
              <dt>Projetos locais</dt>
              <dd>{projects.length}</dd>
            </div>
            <div>
              <dt>Projetos lidos</dt>
              <dd>{readings.length}</dd>
            </div>
          </dl>
          <div className="workspace-health">
            <span className={"health-signal " + service.state}>
              <span className="status-dot" aria-hidden="true" />
              {ready
                ? "Serviço conectado"
                : service.state === "loading"
                  ? "Conectando ao serviço…"
                  : "Serviço local indisponível"}
            </span>
            {service.state === "ready" && (
              <span>
                LapLace <code>{service.health.version}</code> · Node.js{" "}
                <code>{service.health.nodeVersion}</code>
              </span>
            )}
            {service.state === "error" && (
              <>
                <span role="alert">{service.message}</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={retryService}
                >
                  Reconectar
                </button>
              </>
            )}
          </div>
        </section>

        <section className="dashboard-panel desk-section">
          <header className="dashboard-heading">
            <VisualIcon name="lab" />
            <h2>Ferramentas</h2>
            <span className="badge">Prévia</span>
          </header>
          <button
            className="desk-link"
            type="button"
            onClick={() => openLab("agents")}
          >
            <span className="dashboard-icon">
              <VisualIcon name="agent" />
            </span>
            <span>
              <strong>Central de agentes</strong>
              <small>Sessões, tentativas e revisão</small>
            </span>
            <VisualIcon name="chevron" />
          </button>
          <button
            type="button"
            className="graph-atlas"
            onClick={() => openLab("graph")}
          >
            <span className="atlas-title">
              <VisualIcon name="graph" /> Explorar KGraph{" "}
              <VisualIcon name="forward" />
            </span>
            <svg viewBox="0 0 300 112" aria-hidden="true" focusable="false">
              <g className="atlas-orbits">
                <ellipse cx="150" cy="56" rx="59" ry="45" />
                <ellipse cx="150" cy="56" rx="94" ry="56" />
              </g>
              <g className="atlas-links">
                <path d="M48 28 C98 28 95 56 150 56 S205 24 251 24" />
                <path d="M150 56 C194 55 180 87 240 87" />
              </g>
              <g className="atlas-labels">
                <circle cx="48" cy="28" r="3" />
                <text x="48" y="48">
                  Fontes
                </text>
                <circle cx="251" cy="24" r="3" />
                <text x="251" y="44">
                  Decisões
                </text>
                <circle cx="240" cy="87" r="3" />
                <text x="240" y="106">
                  Tarefas
                </text>
              </g>
              <circle className="atlas-hub" cx="150" cy="56" r="21" />
              <text className="atlas-mark" x="150" y="65">
                λ
              </text>
            </svg>
          </button>
        </section>
      </aside>
    </div>
  );
}

const observedFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
});

function ObservedTime({ summary }: { summary: GitSummary }) {
  return (
    <time dateTime={summary.observedAt}>
      {observedFormat.format(new Date(summary.observedAt))}
    </time>
  );
}

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
  compilerClient,
  taskClient,
  executionClient,
  workingClient,
  decisionClient,
  memoryClient,
  plannerClient,
  intelligenceClient,
  onResumeUpdated,
  section,
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
  compilerClient: ReturnType<typeof createDesktopClient>["compiler"];
  taskClient: ReturnType<typeof createDesktopClient>["task"];
  executionClient: ReturnType<typeof createDesktopClient>["execution"];
  workingClient: ReturnType<typeof createDesktopClient>["working"];
  decisionClient: ReturnType<typeof createDesktopClient>["decisions"];
  memoryClient: ReturnType<typeof createDesktopClient>["memory"];
  plannerClient: ReturnType<typeof createDesktopClient>["planner"];
  intelligenceClient: ReturnType<typeof createDesktopClient>["intelligence"];
  onResumeUpdated: () => void;
  section: ProjectSection;
  taskProposal?: TaskProposal;
  onTaskProposal: (source: TaskProposal["source"], objective: string) => void;
  onSection: (section: ProjectSection) => void;
  openLab: (id: PreviewId) => void;
}) {
  const loading = status.state === "loading";
  const overview = section === "overview";
  const observation = resume ? resume.observation.observation : summary;
  const refreshControl = (overview || status.state !== "ready") && (
    <button
      type="button"
      className="button masthead-refresh"
      aria-disabled={loading || undefined}
      onClick={() => {
        if (!loading) refresh();
      }}
    >
      <VisualIcon name="refresh" /> Atualizar Git
    </button>
  );

  return (
    <>
      <header
        className={overview ? "project-masthead" : "project-masthead subview"}
      >
        <div className="project-identity">
          {overview && <p className="eyebrow">Retomada do projeto</p>}
          <h1>{project.name}</h1>
          <div className="project-identifiers">
            {observation && (
              <span className="project-branch-inline">
                <VisualIcon name="git" />{" "}
                <code>{branchLabel(observation)}</code>
              </span>
            )}
            <details className="project-path">
              <summary title={project.root}>
                <VisualIcon name="folder" />
                <span className="visually-hidden">Pasta do checkout</span>
                <code>{project.root}</code>
                <VisualIcon name="chevron" />
              </summary>
              <code className="project-path-full">{project.root}</code>
            </details>
          </div>
        </div>
        {overview ? (
          <div className="project-horizon">
            <SpectralField
              theme={theme}
              paused={paused}
              phase={spectralPhase}
              scene={project.id}
            />
            {refreshControl}
          </div>
        ) : (
          refreshControl
        )}
      </header>
      {!overview && (
        <ProjectNavigation section={section} onSection={onSection} />
      )}
      {loading && (
        <p className="panel loading inspection-status" role="status">
          <span aria-hidden="true" /> Consultando o Git…
        </p>
      )}
      {status.state === "error" && (
        <div className="error-banner">
          <strong role="alert">{status.message}</strong>
          {status.canRelocate && (
            <button className="text-button" onClick={relocate}>
              Relocalizar pasta
            </button>
          )}
        </div>
      )}
      {section === "tasks" ? (
        <TaskView
          projectId={project.id}
          client={taskClient}
          executionClient={executionClient}
          proposal={taskProposal}
          openAgents={() => openLab("agents")}
        />
      ) : section === "working" ? (
        <WorkingTreeView
          key={project.root}
          projectId={project.id}
          cockpitObservation={resume ? resume.observation.observation : summary}
          client={workingClient}
        />
      ) : section === "memory" ? (
        <MemoryWorkspaceView
          key={`${project.id}/${project.root}`}
          projectId={project.id}
          projectName={project.name}
          scope={resume?.scope ?? identity?.scope ?? null}
          client={memoryClient}
        />
      ) : section === "planner" ? (
        <PlannerSupervisionView
          key={`${project.id}/${project.root}`}
          projectId={project.id}
          projectName={project.name}
          scope={resume?.scope ?? identity?.scope ?? null}
          client={plannerClient}
        />
      ) : section === "intelligence" ? (
        <IntelligenceView
          key={`${project.id}/${project.root}`}
          projectId={project.id}
          projectName={project.name}
          scope={resume?.scope ?? identity?.scope ?? null}
          client={intelligenceClient}
        />
      ) : section === "context" ? (
        <ContextView
          key={`${project.id}/${project.root}`}
          projectId={project.id}
          projectName={project.name}
          scope={resume?.scope ?? identity?.scope ?? null}
          client={contextClient}
          codex={codexClient}
          compiler={compilerClient}
          onCreateTask={onTaskProposal}
          openMemory={() => onSection("memory")}
        />
      ) : (
        <>
          <ResumeCockpit
            navigation={
              <ProjectNavigation section={section} onSection={onSection} />
            }
            key={project.id}
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
          />
          {resume && (
            <div className="project-followup">
              <ProjectTaskDigest
                projectId={project.id}
                client={taskClient}
                openTasks={() => onSection("tasks")}
              />
              <section className="dashboard-panel project-connections">
                <header className="dashboard-heading">
                  <VisualIcon name="layers" />
                  <h2>Contexto e relações</h2>
                </header>
                <button
                  className="desk-link"
                  type="button"
                  onClick={() => onSection("context")}
                >
                  <span className="dashboard-icon">
                    <VisualIcon name="archive" />
                  </span>
                  <span>
                    <strong>Fontes do projeto</strong>
                    <small>Capturas preservadas e índice de busca</small>
                  </span>
                  <VisualIcon name="chevron" />
                </button>
                <button
                  className="desk-link"
                  type="button"
                  onClick={() => openLab("graph")}
                >
                  <span className="dashboard-icon">
                    <VisualIcon name="graph" />
                  </span>
                  <span>
                    <strong>KGraph · prévia</strong>
                    <small>Explorar relações no Laboratório</small>
                  </span>
                  <VisualIcon name="chevron" />
                </button>
              </section>
            </div>
          )}
        </>
      )}
    </>
  );
}
