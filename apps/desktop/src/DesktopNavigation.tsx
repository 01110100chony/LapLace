import type { ProjectRecord } from "@laplace/contracts";
import {
  previewDestinations,
  projectDestinations,
  type PreviewId,
  type ProjectSection,
  type Route,
} from "./navigation";
import { LambdaMark, VisualIcon } from "./VisualIcon";
import type { ServiceStatus } from "./views";

const shortPreviewLabels: Partial<Record<PreviewId, string>> = {
  compiler: "Compilador",
  agents: "Agentes",
  arena: "Hipóteses",
};

// A folded contour drawn in depth. Each line follows the same ridge at a
// different elevation, so the paused frame keeps the shape of the field.
const railContours = Array.from({ length: 19 }, (_, i) => {
  const depth = i / 18;
  const crest = 53 + depth * 48;
  return `M-24 95 C12 94 ${crest - 27} ${27 - depth * 15} ${crest} ${28 - depth * 14}
    S140 ${108 - depth * 58} 181 ${62 - depth * 16} S226 ${50 - depth * 35} 263 26`;
});

function RailField() {
  return (
    <div className="rail-field" aria-hidden="true">
      <svg viewBox="0 0 240 96" preserveAspectRatio="none" focusable="false">
        <g>
          {railContours.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
    </div>
  );
}

export function DesktopNavigation({
  route,
  active,
  projects,
  service,
  onWorkspace,
  onProject,
  onLab,
  onSettings,
}: {
  route: Route;
  active?: ProjectRecord;
  projects: ProjectRecord[];
  service: ServiceStatus;
  onWorkspace: () => void;
  onProject: (project: ProjectRecord) => void;
  onLab: (preview?: PreviewId) => void;
  onSettings: () => void;
}) {
  return (
    <nav className="sidebar desktop-rail" aria-label="Navegação principal">
      <div className="rail-group">
        <button
          type="button"
          className="rail-link"
          aria-current={route.kind === "workspace" ? "page" : undefined}
          onClick={onWorkspace}
        >
          <VisualIcon name="workspace" /> Área de trabalho
        </button>
        <button
          type="button"
          className="rail-link"
          aria-current={
            route.kind === "lab" && !route.preview ? "page" : undefined
          }
          onClick={() => onLab()}
        >
          <VisualIcon name="lab" /> Laboratório <small>Prévia</small>
        </button>
      </div>

      <div className="rail-group rail-projects">
        <p className="rail-caption" id="project-navigation">
          Projetos locais
        </p>
        {projects.length ? (
          <ul aria-labelledby="project-navigation">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className="rail-link"
                  aria-current={
                    route.kind === "project" && active?.id === project.id
                      ? "true"
                      : undefined
                  }
                  onClick={() => onProject(project)}
                  title={project.root}
                >
                  <span className="project-initial" aria-hidden="true">
                    {project.name.slice(0, 2)}
                  </span>
                  <span className="rail-label">{project.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rail-empty">Nenhum projeto no catálogo</p>
        )}
      </div>

      {route.kind === "lab" && (
        <div
          className="rail-group rail-destinations rail-previews"
          role="group"
          aria-label="Experiências de prévia"
        >
          <p className="rail-caption">Experiências</p>
          {previewDestinations.map(({ id, label, icon }) => (
            <button
              type="button"
              key={id}
              className="rail-link"
              aria-label={label}
              aria-current={id === route.preview ? "page" : undefined}
              onClick={() => onLab(id)}
            >
              <VisualIcon name={icon} />{" "}
              <span className="rail-label">
                {shortPreviewLabels[id] ?? label}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="rail-foot">
        <RailField />
        <div className="rail-system" role="status">
          <LambdaMark />
          <div>
            <strong>Serviço local</strong>
            <small className={service.state}>
              <span className="status-dot" aria-hidden="true" />
              {service.state === "ready"
                ? "Conectado"
                : service.state === "loading"
                  ? "Conectando"
                  : "Indisponível"}
            </small>
          </div>
        </div>
        <button
          type="button"
          className="rail-link"
          aria-current={route.kind === "settings" ? "page" : undefined}
          onClick={onSettings}
        >
          <VisualIcon name="settings" /> Preferências
        </button>
      </div>
    </nav>
  );
}

export function ProjectNavigation({
  section,
  onSection,
}: {
  section: ProjectSection;
  onSection: (section: ProjectSection) => void;
}) {
  return (
    <nav className="project-tabs" aria-label="Seções do projeto">
      {projectDestinations.map(({ id, label, icon }) => (
        <button
          key={id}
          type="button"
          aria-current={id === section ? "page" : undefined}
          onClick={() => onSection(id)}
        >
          <VisualIcon name={icon} /> {label}
        </button>
      ))}
    </nav>
  );
}
