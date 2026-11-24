import type { ProjectRecord } from "@laplace/contracts";
import { useId, useRef, type RefObject } from "react";
import type { Theme } from "./appearance";
import { SpectralField } from "./SpectralField";
import { NavButton } from "./ShellTooltip";
import {
  projectDestinations,
  type PreviewId,
  type ProjectSection,
  type Route,
} from "./navigation";
import { LambdaMark, VisualIcon } from "./VisualIcon";
import type { ServiceStatus } from "./views";

export function ShellNavigation({
  route,
  section,
  active,
  projects,
  service,
  theme,
  paused,
  phase,
  compact,
  id,
  onWorkspace,
  onProject,
  onSection,
  onLab,
  onSettings,
}: {
  route: Route;
  section: ProjectSection;
  active?: ProjectRecord;
  projects: ProjectRecord[];
  service: ServiceStatus;
  theme: Theme;
  paused: boolean;
  phase: RefObject<number>;
  compact: boolean;
  id?: string;
  onWorkspace: () => void;
  onProject: (project: ProjectRecord) => void;
  onSection: (section: ProjectSection) => void;
  onLab: (preview?: PreviewId) => void;
  onSettings: () => void;
}) {
  const picker = useRef<HTMLDialogElement>(null);
  const pickerId = useId();
  const projectsLabel = useId();
  const currentProject = route.kind === "project" ? active : undefined;
  const serviceLabel =
    service.state === "ready"
      ? "Conectado"
      : service.state === "loading"
        ? "Conectando"
        : "Indisponível";
  const projectList = projects.length ? (
    <ul aria-labelledby={projectsLabel}>
      {projects.map((project) => (
        <li key={project.id}>
          <button
            type="button"
            className="shell-link"
            aria-current={
              currentProject?.id === project.id ? "true" : undefined
            }
            title={project.root}
            onClick={() => {
              picker.current?.close();
              onProject(project);
            }}
          >
            <VisualIcon name="folder" />
            <span className="shell-link-label">{project.name}</span>
            {currentProject?.id === project.id && (
              <span className="shell-project-dot" aria-hidden="true" />
            )}
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <p className="shell-no-projects">Nenhum projeto no catálogo</p>
  );

  return (
    <nav
      id={id}
      className="shell-nav"
      data-compact={compact}
      aria-label="Navegação principal"
    >
      <div className="shell-nav-scroll">
        <div className="shell-nav-group">
          <NavButton
            label="Área de trabalho"
            icon="workspace"
            compact={compact}
            current={route.kind === "workspace"}
            onClick={onWorkspace}
          />
        </div>
        <div className="shell-nav-group" role="group" aria-label="Catálogo">
          {compact ? (
            <>
              <NavButton
                label={
                  currentProject
                    ? `Projetos locais · ${currentProject.name}`
                    : "Projetos locais"
                }
                icon="folder"
                compact
                aria-haspopup="dialog"
                aria-controls={pickerId}
                onClick={(event) => {
                  const anchor = event.currentTarget.getBoundingClientRect();
                  const dialog = picker.current;
                  if (!dialog) return;
                  dialog.style.setProperty("--flyout-top", `${anchor.top}px`);
                  dialog.showModal();
                }}
              />
              <dialog
                ref={picker}
                id={pickerId}
                className="shell-project-picker"
                aria-labelledby={projectsLabel}
                onClick={(event) => {
                  if (event.target === event.currentTarget)
                    picker.current?.close();
                }}
              >
                <div className="shell-picker-body">
                  <header>
                    <h2 id={projectsLabel}>Projetos locais</h2>
                    <button
                      type="button"
                      autoFocus
                      className="shell-icon-button"
                      aria-label="Fechar projetos"
                      onClick={() => picker.current?.close()}
                    >
                      <VisualIcon name="close" />
                    </button>
                  </header>
                  {projectList}
                </div>
              </dialog>
            </>
          ) : (
            <>
              <p id={projectsLabel} className="shell-group-title">
                Projetos locais
              </p>
              {projectList}
            </>
          )}
        </div>
        {currentProject && (
          <div
            className="shell-nav-group shell-project-nav"
            role="group"
            aria-label="Neste projeto"
          >
            {!compact && <p className="shell-group-title">Neste projeto</p>}
            {projectDestinations.map(({ id, label, icon }) => (
              <NavButton
                key={id}
                label={label}
                icon={icon}
                compact={compact}
                current={id === section}
                onClick={() => onSection(id)}
              />
            ))}
          </div>
        )}
        <div
          className="shell-nav-group"
          role="group"
          aria-label="Laboratório e prévias"
        >
          {!compact && <p className="shell-group-title">Experiências</p>}
          <NavButton
            label="Laboratório"
            icon="lab"
            compact={compact}
            current={route.kind === "lab" && !route.preview}
            onClick={() => onLab()}
          >
            {!compact && <small className="shell-preview-tag">Prévia</small>}
          </NavButton>
          {route.kind === "lab" && (
            <>
              <NavButton
                label="Memória"
                icon="archive"
                compact={compact}
                current={route.preview === "memory"}
                onClick={() => onLab("memory")}
              />
              <NavButton
                label="KGraph"
                icon="graph"
                compact={compact}
                current={route.preview === "graph"}
                onClick={() => onLab("graph")}
              />
            </>
          )}
        </div>
      </div>
      <div className="shell-nav-foot">
        <div className="shell-nav-field" aria-hidden="true">
          <SpectralField
            theme={theme}
            paused={paused}
            phase={phase}
            scene="rail"
            compact
          />
        </div>
        <NavButton
          label="Preferências"
          icon="settings"
          compact={compact}
          current={route.kind === "settings"}
          onClick={onSettings}
        />
        <div
          className="shell-system"
          role="status"
          aria-label={`Serviço local · ${serviceLabel}`}
          data-state={service.state}
          title={`Serviço local · ${serviceLabel}`}
        >
          <span className="shell-service-symbol">
            <LambdaMark />
            <span className="status-dot" aria-hidden="true" />
          </span>
          {!compact && (
            <span className="shell-service-copy">
              <strong>Serviço local</strong>
              <small>{serviceLabel}</small>
            </span>
          )}
        </div>
      </div>
    </nav>
  );
}
