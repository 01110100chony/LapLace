import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Health, Project } from "@laplace/contracts";
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
  const [projects, setProjects] = useState<Project[]>([]);
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

  const checkService = useCallback(async () => {
    setService({ state: "loading" });
    try {
      const health: Health = await desktop.health();
      setService({ state: "ready", health });
    } catch (error) {
      setService({ state: "error", message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void checkService();
  }, [checkService]);

  useEffect(() => {
    if (focusOnNavigation.current) {
      main.current?.focus();
      focusOnNavigation.current = false;
    }
  }, [activeId]);

  function remember(project: Project) {
    setProjects((items) =>
      items.some((item) => item.id === project.id)
        ? items.map((item) => (item.id === project.id ? project : item))
        : [...items, project],
    );
  }

  function goHome() {
    if (selection) focusOnNavigation.current = true;
    latest.invalidate();
    setSelection(null);
  }

  function acceptProject(project: Project) {
    if (selection?.id !== project.id) focusOnNavigation.current = true;
    latest.invalidate();
    remember(project);
    setRecentId(project.id);
    setSelection({ id: project.id, status: { state: "ready" } });
  }

  function inspect(project: Project) {
    if (selection?.id !== project.id) focusOnNavigation.current = true;
    setRecentId(project.id);
    setSelection({ id: project.id, status: { state: "loading" } });
    void latest.run(
      () => desktop.inspect(project.id),
      (fresh) => {
        remember(fresh);
        setSelection({ id: project.id, status: { state: "ready" } });
      },
      (error) => {
        setSelection({
          id: project.id,
          status: { state: "error", message: errorMessage(error) },
        });
      },
    );
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
                  onClick={() => inspect(project)}
                  title={project.root}
                >
                  <span className="project-mark" aria-hidden="true" />
                  <span className="nav-name">{project.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nav-empty">Nenhum projeto local</p>
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
              status={selection.status}
              refresh={() => inspect(active)}
            />
          ) : (
            <Home
              projects={projects}
              recent={recent}
              service={service}
              add={showImport}
              open={inspect}
              retryService={() => void checkService()}
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
