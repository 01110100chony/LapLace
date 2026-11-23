import { isTauri } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  type Window as TauriWindow,
} from "@tauri-apps/api/window";
import { useEffect, useState, type RefObject } from "react";
import { LambdaMark, VisualIcon } from "./VisualIcon";

type TitleBarProps = {
  projectName?: string;
  locationLabel: string;
  isPreview: boolean;
  paused: boolean;
  onTogglePause: () => void;
  paletteTrigger: RefObject<HTMLButtonElement | null>;
};

const appWindow = isTauri() ? getCurrentWindow() : undefined;

function WindowControls({ app }: { app: TauriWindow }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let generation = 0;

    function refresh() {
      clearTimeout(timer);
      const current = ++generation;
      timer = setTimeout(() => {
        void app
          .isMaximized()
          .then((value) => {
            if (current === generation) setMaximized(value);
          })
          .catch(reportWindowError);
      }, 80);
    }

    refresh();
    window.addEventListener("resize", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      generation++;
      clearTimeout(timer);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [app]);

  const maximizeLabel = maximized ? "Restaurar janela" : "Maximizar janela";

  return (
    <div
      className="window-controls"
      role="group"
      aria-label="Controles da janela"
    >
      <button
        type="button"
        className="window-control"
        aria-label="Minimizar janela"
        title="Minimizar janela"
        onClick={() => void app.minimize().catch(reportWindowError)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5h10" />
        </svg>
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximizeLabel}
        title={maximizeLabel}
        onClick={() => void app.toggleMaximize().catch(reportWindowError)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {maximized ? (
            <path d="M6.5 4.5h5v5m-7 2h5v-5h-5z" />
          ) : (
            <rect x="3.5" y="3.5" width="9" height="9" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className="window-control window-close"
        aria-label="Fechar janela"
        title="Fechar janela"
        onClick={() => void app.close().catch(reportWindowError)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 4 8 8m0-8-8 8" />
        </svg>
      </button>
    </div>
  );
}

function reportWindowError(error: unknown) {
  console.error("[laplace:window]", error);
}

export function AppTitleBar({
  projectName,
  locationLabel,
  isPreview,
  paused,
  onTogglePause,
  paletteTrigger,
}: TitleBarProps) {
  const [frameless, setFrameless] = useState(false);

  useEffect(() => {
    if (!appWindow) return;
    let mounted = true;
    void appWindow
      .isDecorated()
      .then((decorated) => {
        if (mounted) setFrameless(!decorated);
      })
      .catch(reportWindowError);
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <header className="app-titlebar">
      <div className="brand" data-tauri-drag-region={frameless || undefined}>
        <span
          className="brand-mark"
          aria-hidden="true"
          data-tauri-drag-region={frameless || undefined}
        >
          <LambdaMark />
        </span>
        LapLace
      </div>
      <div className="breadcrumb" aria-label="Localização atual">
        {(projectName || isPreview) && (
          <>
            <span className="shell-context">
              {projectName ?? "Laboratório"}
            </span>
            <span className="breadcrumb-separator" aria-hidden="true">
              /
            </span>
          </>
        )}
        <strong aria-current="page" title={locationLabel}>
          {locationLabel}
        </strong>
      </div>
      <div
        className="window-drag-region"
        aria-hidden="true"
        data-tauri-drag-region={frameless || undefined}
      />
      <button
        className="command-trigger"
        type="button"
        aria-label="Abrir navegação rápida"
        aria-keyshortcuts="Control+K Meta+K"
        ref={paletteTrigger}
      >
        <VisualIcon name="search" /> <span>Buscar ou executar</span>{" "}
        <kbd>Ctrl K</kbd>
      </button>
      <button
        type="button"
        className="shell-motion"
        aria-label="Pausar campo espectral"
        aria-pressed={paused}
        title={paused ? "Retomar campo espectral" : "Pausar campo espectral"}
        onClick={onTogglePause}
      >
        <VisualIcon name={paused ? "play" : "pause"} />
      </button>
      {frameless && appWindow && <WindowControls app={appWindow} />}
    </header>
  );
}
