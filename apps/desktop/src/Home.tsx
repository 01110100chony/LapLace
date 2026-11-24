import type {
  GitObservation,
  GitSummary,
  ProjectRecord,
  ResumeSummary,
} from "@laplace/contracts";
import type { RefObject } from "react";
import { formatObservation } from "./EvidenceProof";
import { GraphTeaser } from "./graph/GraphTeaser";
import { SpectralField } from "./SpectralField";
import { VisualIcon } from "./VisualIcon";
import { EmptyState } from "./WorkView";
import type { Theme } from "./appearance";
import type { PreviewId, ProjectSection } from "./navigation";
import type { ServiceStatus } from "./views";

export function branchLabel(summary: GitSummary) {
  return summary.branch ?? "HEAD destacado";
}

export function ObservationTime({ iso }: { iso: string }) {
  return <time dateTime={iso}>{formatObservation(iso)}</time>;
}

export function ChangeSummary({ changes }: { changes: GitSummary["changes"] }) {
  return (
    <dl className="change-summary">
      <div>
        <dt>No índice</dt>
        <dd>{changes.staged}</dd>
      </div>
      <div>
        <dt>No disco</dt>
        <dd>{changes.unstaged}</dd>
      </div>
      <div>
        <dt>Sem rastreio</dt>
        <dd>{changes.untracked}</dd>
      </div>
      {changes.conflicted > 0 && (
        <div className="change-conflicts">
          <dt>Em conflito</dt>
          <dd>{changes.conflicted}</dd>
        </div>
      )}
    </dl>
  );
}

export function Home({
  projects,
  summaries,
  recent,
  recentResume,
  service,
  theme,
  paused,
  spectralPhase,
  add,
  clone,
  open,
  retryService,
  openLab,
}: {
  projects: ProjectRecord[];
  summaries: Readonly<Record<string, GitObservation | undefined>>;
  recent: ProjectRecord | undefined;
  recentResume: ResumeSummary | null;
  service: ServiceStatus;
  theme: Theme;
  paused: boolean;
  spectralPhase: RefObject<number>;
  add: () => void;
  clone: () => void;
  open: (project: ProjectRecord, next?: ProjectSection) => void;
  retryService: () => void;
  openLab: (id?: PreviewId) => void;
}) {
  const ready = service.state === "ready";
  const matchingResume =
    recentResume?.root === recent?.root ? recentResume : null;
  const last = recent
    ? (matchingResume?.observation.observation ?? summaries[recent.id])
    : undefined;
  const decision = matchingResume?.memory.decision;
  const readings = projects
    .flatMap((project) => {
      const reading = summaries[project.id];
      return reading ? [{ project, reading }] : [];
    })
    .sort((left, right) =>
      right.reading.observedAt.localeCompare(left.reading.observedAt),
    );

  return (
    <div className="workspace-studio">
      <header className="studio-masthead">
        <SpectralField
          theme={theme}
          paused={paused}
          phase={spectralPhase}
          scene="workspace"
        />
        <div className="studio-title">
          <span className="studio-landmark" aria-hidden="true">
            <VisualIcon name="workspace" />
          </span>
          <h1>Área de trabalho</h1>
          <div className="studio-actions">
            <button
              type="button"
              className="button"
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
      </header>
      {service.state === "error" && (
        <div className="studio-connection" role="status">
          <VisualIcon name="activity" />
          <span>{service.message}</span>
          <button className="text-button" type="button" onClick={retryService}>
            Reconectar
          </button>
        </div>
      )}
      <div className="studio-layout">
        <div className="studio-ledger">
          <section
            className="resume-ticket"
            aria-labelledby="workspace-resume-title"
          >
            <header className="surface-heading">
              <VisualIcon name="overview" />
              <h2 id="workspace-resume-title">Retomar checkout</h2>
            </header>
            {recent ? (
              <>
                <div className="ticket-project">
                  <span className="artifact-icon" data-kind="project">
                    <VisualIcon name="folder" />
                  </span>
                  <div>
                    <h3>{recent.name}</h3>
                    <code title={recent.root}>{recent.root}</code>
                  </div>
                </div>
                {last ? (
                  <>
                    <div className="checkout-chips">
                      <span className="checkout-chip">
                        <VisualIcon name="git" />{" "}
                        <code>{branchLabel(last)}</code>
                      </span>
                      <span className="checkout-observed">
                        {matchingResume?.observation.state === "cached"
                          ? "Git em cache"
                          : "Leitura Git"}{" "}
                        · <ObservationTime iso={last.observedAt} />
                      </span>
                    </div>
                    <ChangeSummary changes={last.changes} />
                  </>
                ) : (
                  <p className="work-muted">
                    Sem leitura Git para este checkout.
                  </p>
                )}
                {decision && (
                  <div className="ticket-decision">
                    <VisualIcon name="decision" />
                    <div>
                      <strong>Decisão vigente</strong>
                      <p>{decision.content}</p>
                    </div>
                  </div>
                )}
                <div className="studio-actions ticket-actions">
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => open(recent)}
                  >
                    Retomar projeto <VisualIcon name="forward" />
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => open(recent, "context")}
                  >
                    <VisualIcon name="file" /> Fontes
                  </button>
                </div>
              </>
            ) : (
              <div className="ticket-empty">
                <span className="artifact-icon" data-kind="project">
                  <VisualIcon name="folder" />
                </span>
                <div>
                  <h3>
                    {ready
                      ? "Nenhum checkout aberto"
                      : service.state === "loading"
                        ? "Carregando catálogo…"
                        : "Catálogo indisponível"}
                  </h3>
                  {ready && projects.length > 0 && (
                    <p className="work-muted">
                      Escolha um projeto no catálogo.
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
          <section className="studio-register" aria-labelledby="local-projects">
            <header className="surface-heading">
              <VisualIcon name="folder" />
              <h2 id="local-projects">Catálogo de projetos</h2>
              <span className="badge">{projects.length}</span>
            </header>
            {projects.length ? (
              <ul>
                {projects.map((project) => {
                  const observation = summaries[project.id];
                  return (
                    <li key={project.id}>
                      <button
                        className="studio-project-row"
                        type="button"
                        onClick={() => open(project)}
                        title={project.root}
                      >
                        <span className="artifact-icon" data-kind="project">
                          <VisualIcon name="folder" />
                        </span>
                        <span>
                          <strong>{project.name}</strong>
                          <code>
                            {observation
                              ? branchLabel(observation)
                              : project.root}
                          </code>
                        </span>
                        <small>
                          {observation ? (
                            <ObservationTime iso={observation.observedAt} />
                          ) : (
                            "Sem leitura nesta sessão"
                          )}
                        </small>
                        <VisualIcon name="forward" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon="folder"
                title={ready ? "Nenhum projeto cadastrado" : "Catálogo local"}
              >
                {ready
                  ? "Adicione um checkout ou clone um repositório."
                  : service.state === "loading"
                    ? "Aguardando o serviço local."
                    : "O catálogo estará disponível quando o serviço conectar."}
              </EmptyState>
            )}
          </section>
        </div>
        <aside className="studio-aside" aria-label="Atividade e relações">
          <section
            className="studio-timeline"
            aria-labelledby="workspace-timeline"
          >
            <header className="surface-heading">
              <VisualIcon name="activity" />
              <h2 id="workspace-timeline">Leituras recentes</h2>
            </header>
            {readings.length > 0 ? (
              <ol>
                {readings.slice(0, 5).map(({ project, reading }) => (
                  <li key={project.id}>
                    <button
                      className="studio-event"
                      type="button"
                      onClick={() => open(project)}
                    >
                      <span className="artifact-icon" data-kind="git">
                        <VisualIcon name="git" />
                      </span>
                      <span>
                        <strong>{project.name}</strong>
                        <code>{branchLabel(reading)}</code>
                        <ObservationTime iso={reading.observedAt} />
                      </span>
                      <VisualIcon name="chevron" />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="work-muted">
                Nenhuma leitura Git registrada nesta sessão.
              </p>
            )}
          </section>
          <GraphTeaser onOpen={() => openLab("graph")} preview />
        </aside>
      </div>
    </div>
  );
}
