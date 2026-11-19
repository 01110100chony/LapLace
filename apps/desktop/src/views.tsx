import type { Health, Project } from "@laplace/contracts";

export type ServiceStatus =
  | { state: "loading" }
  | { state: "ready"; health: Health }
  | { state: "error"; message: string };

export type ProjectStatus =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; message: string };

type HomeProps = {
  projects: Project[];
  recent: Project | undefined;
  service: ServiceStatus;
  add: () => void;
  open: (project: Project) => void;
  retryService: () => void;
};

function branchLabel(project: Project) {
  return project.branch ?? "HEAD destacado";
}

export function Home({
  projects,
  recent,
  service,
  add,
  open,
  retryService,
}: HomeProps) {
  return (
    <>
      <header className="headline">
        <div>
          <p className="label">Workspace pessoal</p>
          <h1>Área de trabalho</h1>
        </div>
        {recent && (
          <button className="button" onClick={add}>
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
              {recent ? recent.name : "Abra seu primeiro projeto"}
            </h2>
            <p>
              {recent ? (
                <>
                  <code>{branchLabel(recent)}</code> ·{" "}
                  {recent.head ? "Repositório Git" : "Sem commits"}
                </>
              ) : (
                "Selecione uma pasta para consultar a branch, o HEAD e as alterações do Git."
              )}
            </p>
            {recent ? (
              <button className="button primary" onClick={() => open(recent)}>
                Abrir projeto <span aria-hidden="true">→</span>
              </button>
            ) : (
              <button className="button primary" onClick={add}>
                <span aria-hidden="true">+</span> Adicionar projeto
              </button>
            )}
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
                      <code className="tag">{branchLabel(project)}</code>
                      <span className="chevron" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">Nenhum projeto adicionado.</p>
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
            <p className="service-error">{service.message}</p>
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

export function ProjectView({
  project,
  status,
  refresh,
}: {
  project: Project;
  status: ProjectStatus;
  refresh: () => void;
}) {
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
          disabled={status.state === "loading"}
          onClick={refresh}
        >
          Atualizar
        </button>
      </header>
      <div className="project-view-label">Visão geral</div>
      {status.state === "loading" ? (
        <p className="panel loading" role="status">
          <span aria-hidden="true" /> Consultando o Git…
        </p>
      ) : (
        <>
          {status.state === "error" && (
            <div className="error-banner" role="alert">
              <strong>{status.message}</strong>
              <p>Exibindo a última leitura do repositório.</p>
            </div>
          )}
          <div className="project-grid">
            <section className="panel" aria-labelledby="repo-heading">
              <h2 id="repo-heading">Repositório Git</h2>
              <dl className="repo-info">
                <div>
                  <dt>Branch</dt>
                  <dd>
                    <code>{branchLabel(project)}</code>
                  </dd>
                </div>
                <div>
                  <dt>HEAD</dt>
                  <dd>
                    {project.head ? <code>{project.head}</code> : "Sem commits"}
                  </dd>
                </div>
              </dl>
            </section>
            <section className="panel" aria-labelledby="changes-heading">
              <h2 id="changes-heading">Alterações</h2>
              <dl className="change-counts">
                <div>
                  <dt>Preparadas</dt>
                  <dd>{project.changes.staged}</dd>
                </div>
                <div>
                  <dt>Não preparadas</dt>
                  <dd>{project.changes.unstaged}</dd>
                </div>
                <div>
                  <dt>Não rastreadas</dt>
                  <dd>{project.changes.untracked}</dd>
                </div>
                {project.changes.conflicted > 0 && (
                  <div>
                    <dt>Em conflito</dt>
                    <dd>{project.changes.conflicted}</dd>
                  </div>
                )}
              </dl>
              {Object.values(project.changes).every((count) => count === 0) && (
                <p className="clean">
                  <span className="status-dot" aria-hidden="true" /> Árvore de
                  trabalho limpa
                </p>
              )}
            </section>
          </div>
          <p className="observed">
            Leitura em{" "}
            <time dateTime={project.observedAt}>
              {observedFormat.format(new Date(project.observedAt))}
            </time>
          </p>
        </>
      )}
    </>
  );
}
