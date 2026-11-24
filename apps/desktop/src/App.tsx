import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  GitObservation,
  Project,
  ProjectIdentityResult,
  ProjectRecord,
  ResumeSummary,
} from "@laplace/contracts";
import { CloneDialog } from "./CloneDialog";
import { AppTitleBar } from "./AppTitleBar";
import {
  initialPause,
  initialShellMode,
  initialTheme,
  savePause,
  saveShellMode,
  saveTheme,
  type Theme,
} from "./appearance";
import { ProjectFolderDialog } from "./ProjectFolderDialog";
import { createDesktopClient, DesktopError, errorMessage } from "./ipc";
import {
  Home,
  ProjectView,
  type ProjectStatus,
  type ServiceStatus,
} from "./views";
import { createResumeLoader } from "./workspace";
import { CommandPalette, type Command } from "./CommandPalette";
import { ShellNavigation } from "./ShellNavigation";
import { SettingsView } from "./SettingsView";
import {
  previewDestinations,
  projectDestinations,
  type PreviewId,
  type ProjectSection,
  type Route,
} from "./navigation";
import type { TaskProposal } from "./TaskView";
import { LambdaMark, VisualIcon } from "./VisualIcon";

const PreviewLab = lazy(() => import("./preview/PreviewLab"));

const desktop = createDesktopClient(async (command, args) => {
  if (!isTauri()) throw new DesktopError("desktop_required");
  return invoke(command, args);
});

type Selection = {
  id: string;
  status: ProjectStatus;
  identity: ProjectIdentityResult | null;
  resume: ResumeSummary | null;
};

function updateProject(
  items: ProjectRecord[],
  { id, name, root }: ProjectRecord,
) {
  const record = { id, name, root };
  return items.some((item) => item.id === id)
    ? items.map((item) => (item.id === id ? record : item))
    : [...items, record];
}

export function App() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [summaries, setSummaries] = useState<
    Record<string, GitObservation | undefined>
  >({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [recentId, setRecentId] = useState<string>();
  const [recentResume, setRecentResume] = useState<ResumeSummary | null>(null);
  const [service, setService] = useState<ServiceStatus>({ state: "loading" });
  const [theme, setTheme] = useState(initialTheme);
  const [paused, setPaused] = useState(initialPause);
  const [shellMode, setShellMode] = useState(initialShellMode);
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const spectralPhase = useRef(0);
  const railPhase = useRef(0);
  const [route, setRoute] = useState<Route>({ kind: "workspace" });
  const [section, setSection] = useState<ProjectSection>("overview");
  const [graphFocus, setGraphFocus] = useState<string>();
  const [taskProposal, setTaskProposal] = useState<TaskProposal>();
  const [loader] = useState(() => createResumeLoader(desktop));
  const cloneDialog = useRef<HTMLDialogElement>(null);
  const importDialog = useRef<HTMLDialogElement>(null);
  const relocateDialog = useRef<HTMLDialogElement>(null);
  const navigationDrawer = useRef<HTMLDialogElement>(null);
  const main = useRef<HTMLElement>(null);
  const paletteTrigger = useRef<HTMLButtonElement>(null);
  const focusOnNavigation = useRef(false);
  const active = projects.find((project) => project.id === selection?.id);
  const recent = projects.find((project) => project.id === recentId);
  const activeId = selection?.id;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    function update(event: MediaQueryListEvent) {
      if (!event.matches) {
        navigationDrawer.current?.close();
        setDrawerOpen(false);
      }
      setNarrow(event.matches);
    }
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function toggleNavigation() {
    if (narrow) {
      navigationDrawer.current?.showModal();
      setDrawerOpen(true);
      return;
    }
    const mode = shellMode === "compact" ? "expanded" : "compact";
    setShellMode(mode);
    saveShellMode(mode);
  }

  function changeTheme(next: Theme) {
    setTheme(next);
    saveTheme(next);
  }

  function togglePause() {
    setPaused(!paused);
    savePause(!paused);
  }

  const inspect = useCallback(
    (project: ProjectRecord) => {
      setRecentId(project.id);
      setRecentResume(null);
      setSelection({
        id: project.id,
        status: { state: "loading" },
        identity: null,
        resume: null,
      });
      void loader.open(
        project.id,
        (selected) => {
          setProjects((items) => updateProject(items, selected));
          setSummaries((items) => ({
            ...items,
            [project.id]: selected.cached ?? undefined,
          }));
        },
        (identity) => {
          setSelection((prev) =>
            prev && prev.id === project.id ? { ...prev, identity } : prev,
          );
        },
        (resume) => {
          setRecentResume(resume);
          setProjects((items) =>
            updateProject(items, {
              id: project.id,
              name: project.name,
              root: resume.root,
            }),
          );
          setSummaries((items) => ({
            ...items,
            [project.id]: resume.observation.observation ?? undefined,
          }));
          setSelection((prev) =>
            prev && prev.id === project.id
              ? {
                  ...prev,
                  status: { state: "ready" },
                  resume,
                }
              : prev,
          );
        },
        (error) => {
          setSelection((prev) => ({
            id: project.id,
            identity: prev?.id === project.id ? prev.identity : null,
            resume: prev?.id === project.id ? prev.resume : null,
            status: {
              state: "error",
              message: errorMessage(error),
              canRelocate:
                error instanceof DesktopError &&
                (error.code === "project_unavailable" ||
                  error.code === "project_identity_mismatch" ||
                  error.code === "project_identity_ambiguous"),
            },
          }));
        },
      );
    },
    [loader],
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
      if (selected) {
        inspect(selected);
        setRoute((current) =>
          current.kind === "workspace" ? { kind: "project" } : current,
        );
      }
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
      window.scrollTo(0, 0);
      main.current?.focus({ preventScroll: true });
      focusOnNavigation.current = false;
    }
  }, [activeId, route, section]);

  function goHome() {
    navigationDrawer.current?.close();
    if (route.kind !== "workspace") focusOnNavigation.current = true;
    loader.invalidate();
    setSelection(null);
    setTaskProposal(undefined);
    setRoute({ kind: "workspace" });
  }

  function acceptProject(project: Project) {
    setProjects((items) => updateProject(items, project));
    setSummaries((items) => ({ ...items, [project.id]: project }));
    openProject(project);
  }

  function openProject(
    project: ProjectRecord,
    next: ProjectSection = "overview",
  ) {
    navigationDrawer.current?.close();
    if (
      route.kind !== "project" ||
      selection?.id !== project.id ||
      section !== next
    )
      focusOnNavigation.current = true;
    setTaskProposal(undefined);
    setSection(next);
    setGraphFocus(undefined);
    setRoute({ kind: "project" });
    inspect(project);
  }

  function showSection(next: ProjectSection, focus?: string) {
    navigationDrawer.current?.close();
    if (route.kind !== "project" || next !== section) {
      focusOnNavigation.current = true;
      setTaskProposal(undefined);
    }
    setSection(next);
    setGraphFocus(focus);
    setRoute({ kind: "project" });
  }

  function openLab(preview?: PreviewId, focus?: string) {
    navigationDrawer.current?.close();
    focusOnNavigation.current = true;
    setTaskProposal(undefined);
    setRoute({ kind: "lab", preview, focus });
  }

  function openSettings() {
    navigationDrawer.current?.close();
    focusOnNavigation.current = true;
    setTaskProposal(undefined);
    setRoute({ kind: "settings" });
  }

  function showImport() {
    importDialog.current?.showModal();
  }

  function showClone() {
    cloneDialog.current?.showModal();
  }

  const commands: Command[] = [
    {
      id: "workspace",
      label: "Área de trabalho",
      scope: "Workspace",
      icon: "workspace",
      action: goHome,
    },
    {
      id: "settings",
      label: "Preferências",
      scope: "Workspace",
      icon: "settings",
      action: openSettings,
    },
    {
      id: "lab",
      label: "Laboratório",
      scope: "Prévia",
      icon: "lab",
      action: () => openLab(),
    },
    ...projects.map((project): Command => ({
      id: "project/" + project.id,
      label: project.name,
      scope: "Projeto",
      icon: "folder",
      action: () => openProject(project),
    })),
    ...(active
      ? projectDestinations.map(({ id, label, icon }): Command => ({
          id: "section/" + id,
          label,
          scope: "Projeto",
          icon,
          action: () => showSection(id),
        }))
      : []),
    ...(service.state === "ready"
      ? ([
          {
            id: "add",
            label: "Adicionar projeto",
            scope: "Workspace",
            icon: "plus",
            action: showImport,
          },
          {
            id: "clone",
            label: "Clonar do GitHub",
            scope: "Workspace",
            icon: "download",
            action: showClone,
          },
        ] as const)
      : []),
    ...previewDestinations.map(({ id, label, icon }): Command => ({
      id: "lab/" + id,
      label,
      scope: "Prévia",
      icon,
      action: () => openLab(id),
    })),
  ];
  const locationLabel =
    route.kind === "project"
      ? projectDestinations.find((item) => item.id === section)!.label
      : route.kind === "lab"
        ? (previewDestinations.find((item) => item.id === route.preview)
            ?.label ?? "Laboratório")
        : route.kind === "settings"
          ? "Preferências"
          : "Área de trabalho";
  const graphRoute =
    (route.kind === "project" && section === "graph") ||
    (route.kind === "lab" && route.preview === "graph");
  const navigation = (
    <ShellNavigation
      id={narrow ? undefined : "desktop-navigation"}
      route={route}
      section={section}
      active={active}
      projects={projects}
      service={service}
      theme={theme}
      paused={paused}
      phase={railPhase}
      compact={!narrow && shellMode === "compact"}
      onWorkspace={goHome}
      onProject={openProject}
      onSection={showSection}
      onLab={openLab}
      onSettings={openSettings}
    />
  );

  return (
    <div
      className="frame living-shell"
      data-motion-paused={paused}
      data-shell={shellMode}
      data-graph-route={graphRoute}
    >
      <a className="skip-link" href="#content">
        Ir para o conteúdo
      </a>
      <AppTitleBar
        projectName={route.kind === "project" ? active?.name : undefined}
        locationLabel={locationLabel}
        isPreview={route.kind === "lab" && !!route.preview}
        paused={paused}
        onTogglePause={togglePause}
        paletteTrigger={paletteTrigger}
        shellMode={shellMode}
        narrow={narrow}
        drawerOpen={drawerOpen}
        toggleNavigation={toggleNavigation}
      />
      {narrow ? (
        <dialog
          id="navigation-drawer"
          ref={navigationDrawer}
          className="shell-drawer"
          aria-labelledby="navigation-heading"
          onClose={() => setDrawerOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget)
              navigationDrawer.current?.close();
          }}
        >
          <header className="shell-drawer-heading">
            <h2 id="navigation-heading">
              <LambdaMark /> LapLace
            </h2>
            <button
              type="button"
              className="shell-icon-button"
              autoFocus
              aria-label="Fechar navegação"
              onClick={() => navigationDrawer.current?.close()}
            >
              <VisualIcon name="close" />
            </button>
          </header>
          {navigation}
        </dialog>
      ) : (
        navigation
      )}

      <div className="workspace">
        <main ref={main} id="content" tabIndex={-1} className="main">
          {route.kind === "lab" ? (
            <Suspense
              fallback={
                <p className="work-message" role="status">
                  Carregando o Laboratório…
                </p>
              }
            >
              <PreviewLab
                preview={route.preview}
                focus={route.focus}
                navigate={openLab}
                index={() => openLab()}
              />
            </Suspense>
          ) : route.kind === "settings" ? (
            <SettingsView
              theme={theme}
              paused={paused}
              service={service}
              changeTheme={changeTheme}
              togglePause={togglePause}
              openAgents={() => openLab("agents")}
            />
          ) : route.kind === "project" && active && selection ? (
            <ProjectView
              key={active.id}
              project={active}
              summary={summaries[active.id]}
              identity={selection.identity}
              resume={selection.resume}
              status={selection.status}
              theme={theme}
              paused={paused}
              spectralPhase={spectralPhase}
              section={section}
              graphFocus={graphFocus}
              taskProposal={taskProposal}
              onTaskProposal={(source, objective) => {
                setTaskProposal({ source, objective });
                setSection("tasks");
              }}
              onSection={showSection}
              openLab={openLab}
              refresh={() => inspect(active)}
              relocate={() => relocateDialog.current?.showModal()}
              confirmIdentity={() =>
                loader.persist(() => desktop.inspect(active.id))
              }
              contextClient={desktop.context}
              codexClient={desktop.codex}
              taskClient={desktop.task}
              executionClient={desktop.execution}
              workingClient={desktop.working}
              decisionClient={desktop.decisions}
              onResumeUpdated={() => inspect(active)}
            />
          ) : (
            <Home
              projects={projects}
              summaries={summaries}
              recent={recent}
              recentResume={recentResume}
              service={service}
              theme={theme}
              paused={paused}
              spectralPhase={spectralPhase}
              add={showImport}
              clone={showClone}
              open={openProject}
              retryService={() => void loadWorkspace()}
              openLab={openLab}
            />
          )}
        </main>
      </div>
      <CommandPalette commands={commands} trigger={paletteTrigger} />
      <CloneDialog
        dialogRef={cloneDialog}
        client={desktop.clone}
        onSelected={acceptProject}
      />
      <ProjectFolderDialog
        dialogRef={importDialog}
        mode="import"
        choose={() => loader.persist(desktop.addLocal)}
        onSelected={acceptProject}
      />
      {active && (
        <ProjectFolderDialog
          key={active.id}
          dialogRef={relocateDialog}
          mode="relocate"
          choose={() => loader.persist(() => desktop.relocate(active.id))}
          onSelected={acceptProject}
        />
      )}
    </div>
  );
}
