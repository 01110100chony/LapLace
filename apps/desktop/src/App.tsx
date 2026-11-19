import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GitSummary, Project, ProjectRecord } from "@laplace/contracts";
import { AppTitleBar } from "./AppTitleBar";
import { ImportDialog } from "./ImportDialog";
import { createDesktopClient, DesktopError, errorMessage } from "./ipc";
import {
  Home,
  ProjectView,
  type ProjectStatus,
  type ServiceStatus,
} from "./views";
import { createLatestRequest } from "./workspace";

const desktop = createDesktopClient(async (command, args) => {
  if (!isTauri()) throw new DesktopError("desktop_required");
  return invoke(command, args);
});

type Selection = { id: string; status: ProjectStatus };

export function App() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [summaries, setSummaries] = useState<Record<string, GitSummary>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [recentId, setRecentId] = useState<string>();
  const [service, setService] = useState<ServiceStatus>({ state: "loading" });
  const [latest] = useState(createLatestRequest);
  const dialog = useRef<HTMLDialogElement>(null);
  const main = useRef<HTMLElement>(null);
  const focusOnNavigation = useRef(false);
  const active = projects.find((project) => project.id === selection?.id);
  const recent = projects.find((project) => project.id === recentId);
  const activeId = selection?.id;

  const inspect = useCallback(
    (project: ProjectRecord) => {
      setRecentId(project.id);
      setSelection({ id: project.id, status: { state: "loading" } });
      void latest.run(
        () => desktop.inspect(project.id),
        (fresh) => {
          setSummaries((items) => ({ ...items, [project.id]: fresh }));
          setSelection({ id: project.id, status: { state: "ready" } });
        },
        (error) => {
          setSelection({
            id: project.id,
            status: { state: "error", message: errorMessage(error) },
          });
        },
      );
    },
    [latest],
  );

  const loadWorkspace = useCallback(async () => {
    setService({ state: "loading" });
    try {
      const [health, catalog] = await Promise.all([
        desktop.health(),
        desktop.list(),
      ]);
      setProjects(catalog.projects);
      const selected = catalog.projects.find(
        (project) => project.id === catalog.selectedProjectId,
      );
      if (selected) inspect(selected);
      setService({ state: "ready", health });
    } catch (error) {
      setService({ state: "error", message: errorMessage(error) });
    }
  }, [inspect]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (focusOnNavigation.current) {
      main.current?.focus();
      focusOnNavigation.current = false;
    }
  }, [activeId]);

  function goHome() {
    if (selection) focusOnNavigation.current = true;
    latest.invalidate();
    setSelection(null);
  }

  function acceptProject(project: Project) {
    if (selection?.id !== project.id) focusOnNavigation.current = true;
    latest.invalidate();
    const { id, name, root } = project;
    setProjects((items) =>
      items.some((item) => item.id === id)
        ? items
        : [...items, { id, name, root }],
    );
    setSummaries((items) => ({ ...items, [id]: project }));
    setRecentId(project.id);
    setSelection({ id: project.id, status: { state: "ready" } });
  }

  function openProject(project: ProjectRecord) {
    if (selection?.id !== project.id) focusOnNavigation.current = true;
    inspect(project);
  }

  function showImport() {
    dialog.current?.showModal();
  }

  return (
    <div className="frame">
      <a className="skip-link" href="#content">
        Ir para o conteúdo
      </a>
      <AppTitleBar projectName={active?.name} goHome={goHome} />
      <nav className="sidebar" aria-label="Navegação principal">
        <button
          className="nav-item"
          aria-current={active ? undefined : "page"}
          onClick={goHome}
        >
          <span className="home-mark" aria-hidden="true">
            ▦
          </span>
          Área de trabalho
        </button>
        <div className="nav-group">Projetos</div>
        {projects.length ? (
          <ul className="nav-list">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  className="nav-item"
                  aria-current={active?.id === project.id ? "page" : undefined}
                  onClick={() => openProject(project)}
                  title={project.root}
                >
                  <span className="project-mark" aria-hidden="true" />
                  <span className="nav-name">{project.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nav-empty">
            {service.state === "ready"
              ? "Nenhum projeto local"
              : service.state === "loading"
                ? "Carregando projetos…"
                : "Catálogo indisponível"}
          </p>
        )}
        <div className="sidebar-footer">
          <span className="footer-mark" aria-hidden="true">
            λ
          </span>
          Workspace pessoal
        </div>
      </nav>

      <div className="workspace">
        <main ref={main} id="content" tabIndex={-1} className="main">
          {active && selection ? (
            <ProjectView
              project={active}
              summary={summaries[active.id]}
              status={selection.status}
              refresh={() => inspect(active)}
            />
          ) : (
            <Home
              projects={projects}
              summaries={summaries}
              recent={recent}
              service={service}
              add={showImport}
              open={openProject}
              retryService={() => void loadWorkspace()}
            />
          )}
        </main>
      </div>
      <ImportDialog
        dialogRef={dialog}
        choose={desktop.addLocal}
        onImported={acceptProject}
      />
    </div>
  );
}
