import type {
  GitObservation,
  GitSummary,
  Health,
  Project,
  ProjectIdentityResult,
  ProjectRecord,
  ResumeSummary,
} from "@laplace/contracts";
import { useState } from "react";
import { ContextView } from "./ContextView";
import { ResumeCockpit } from "./ResumeCockpit";
import { TaskView, type TaskProposal } from "./TaskView";
import { WorkingTreeView } from "./WorkingTreeView";
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
  add: () => void;
  clone: () => void;
  open: (project: ProjectRecord) => void;
  retryService: () => void;
};

function branchLabel(summary: GitSummary) {
  return summary.branch ?? "HEAD destacado";
}

export function Home({
  projects,
  summaries,
  recent,
  service,
  add,
  clone,
  open,
  retryService,
}: HomeProps) {
  const recentSummary = recent && summaries[recent.id];
  return (
    <>
      <header className="headline">
        <div>
          <p className="label">Workspace pessoal</p>
          <h1>Área de trabalho</h1>
        </div>
        {recent && (
          <button
            className="button"
            disabled={service.state !== "ready"}
            onClick={add}
          >
            <span aria-hidden="true">+</span> Adicionar projeto
          </button>
        )}
      </header>

      <div className="body-grid">
        <div>
          <section className="hero" aria-labelledby="next-project">
            <span className="watermark" aria-hidden="true">
              λ
            </span>
            <p className="label">{recent ? "Continuar" : "Projetos locais"}</p>
            <h2 id="next-project">
              {recent
                ? recent.name
                : service.state === "ready"
                  ? "Abra seu primeiro projeto"
                  : "Projetos locais"}
            </h2>
            <p>
              {recentSummary ? (
                <>
                  <code>{branchLabel(recentSummary)}</code> ·{" "}
                  {recentSummary.head
                    ? "Última leitura Git em"
                    : "Sem commits na leitura de"}{" "}
                  <ObservedTime summary={recentSummary} />
                </>
              ) : recent ? (
                recent.root
              ) : (
                "Selecione uma pasta para consultar a branch, o HEAD e as alterações do Git."
              )}
            </p>
            <div className="workspace-actions">
              {recent ? (
                <button className="button primary" onClick={() => open(recent)}>
                  Abrir projeto <span aria-hidden="true">→</span>
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={service.state !== "ready"}
                  onClick={add}
                >
                  <span aria-hidden="true">+</span> Adicionar projeto
                </button>
              )}
              <button
                className="button"
                disabled={service.state !== "ready"}
                onClick={clone}
              >
                Clonar do GitHub
              </button>
            </div>
          </section>

          <section className="projects" aria-labelledby="projects-heading">
            <header className="section-heading">
              <h2 id="projects-heading">Projetos</h2>
              <span>
                {projects.length === 1
                  ? "1 local"
                  : `${projects.length} locais`}
              </span>
            </header>
            {projects.length ? (
              <ul className="project-list">
                {projects.map((project) => (
                  <li key={project.id}>
                    <button
                      className="project-row"
                      onClick={() => open(project)}
                    >
                      <span className="project-icon" aria-hidden="true">
                        {Array.from(project.name)[0]}
                      </span>
                      <span className="project-row-name">
                        <strong>{project.name}</strong>
                        <small title={project.root}>{project.root}</small>
                      </span>
                      {summaries[project.id] ? (
                        <code className="tag">
                          {branchLabel(summaries[project.id]!)} · cache
                        </code>
                      ) : (
                        <span aria-hidden="true" />
                      )}
                      <span className="chevron" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">
                {service.state === "ready"
                  ? "Nenhum projeto adicionado."
                  : service.state === "loading"
                    ? "Carregando projetos…"
                    : "Catálogo indisponível."}
              </p>
            )}
          </section>
        </div>
        <ServicePanel service={service} retry={retryService} />
      </div>
    </>
  );
}

function ServicePanel({
  service,
  retry,
}: {
  service: ServiceStatus;
  retry: () => void;
}) {
  return (
    <aside className="rail" aria-labelledby="service-heading">
      <p className="label">Ambiente local</p>
      <h2 id="service-heading">Serviço local</h2>
      <div className="service-details">
        <p className={`signal ${service.state}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {service.state === "ready"
            ? "Conectado"
            : service.state === "loading"
              ? "Conectando…"
              : "Indisponível"}
        </p>
        {service.state === "ready" && (
          <p className="service-version">
            Laplace <code>{service.health.version}</code> · Node.js{" "}
            <code>{service.health.nodeVersion}</code>
          </p>
        )}
        {service.state === "error" && (
          <>
            <p className="service-error" role="alert">
              {service.message}
            </p>
            <button className="text-button" onClick={retry}>
              Reconectar
            </button>
          </>
        )}
      </div>
    </aside>
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
}: {
  project: ProjectRecord;
  summary: GitObservation | undefined;
  identity: ProjectIdentityResult | null;
  resume: ResumeSummary | null;
  status: ProjectStatus;
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
}) {
  const loading = status.state === "loading";
  const [section, setSection] = useState<
    "overview" | "context" | "tasks" | "working"
  >("overview");
  const [taskProposal, setTaskProposal] = useState<TaskProposal>();
  return (
    <>
      <header className="headline project-headline">
        <div>
          <p className="label">Projeto local</p>
          <h1>{project.name}</h1>
          <p className="project-path">
            <code>{project.root}</code>
          </p>
        </div>
        <button
          className="button"
          aria-disabled={loading || undefined}
          onClick={() => {
            if (!loading) refresh();
          }}
        >
          Atualizar
        </button>
      </header>
      <nav className="project-sections" aria-label="Seções do projeto">
        <button
          className="button"
          aria-current={section === "overview" ? "page" : undefined}
          onClick={() => setSection("overview")}
        >
          Visão geral
        </button>
        <button
          className="button"
          aria-current={section === "context" ? "page" : undefined}
          onClick={() => setSection("context")}
        >
          Contexto
        </button>
        <button
          className="button"
          aria-current={section === "tasks" ? "page" : undefined}
          onClick={() => {
            if (section !== "tasks") setTaskProposal(undefined);
            setSection("tasks");
          }}
        >
          Tarefas
        </button>
        <button
          className="button"
          aria-current={section === "working" ? "page" : undefined}
          onClick={() => setSection("working")}
        >
          Alterações Git
        </button>
      </nav>
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
        />
      ) : section === "working" ? (
        <WorkingTreeView
          key={project.root}
          projectId={project.id}
          client={workingClient}
        />
      ) : section === "context" ? (
        <ContextView
          key={`${project.id}/${project.root}`}
          projectId={project.id}
          projectName={project.name}
          client={contextClient}
          codex={codexClient}
          onCreateTask={(source, question) => {
            setTaskProposal({ source, objective: question });
            setSection("tasks");
          }}
        />
      ) : (
        <ResumeCockpit
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
        />
      )}
    </>
  );
}
