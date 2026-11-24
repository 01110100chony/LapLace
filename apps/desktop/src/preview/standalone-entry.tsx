import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { themes, type Theme } from "../appearance";
import { DesktopNavigation } from "../DesktopNavigation";
import { previewDestinations, type PreviewId } from "../navigation";
import { LambdaMark, VisualIcon } from "../VisualIcon";
import PreviewLab from "./PreviewLab";

const demoProjects = [
  {
    id: "atlas",
    name: "Atlas",
    root: "C:/projetos/Atlas",
  },
  {
    id: "nextm",
    name: "NexTM",
    root: "C:/projetos/NexTM",
  },
  {
    id: "iuris",
    name: "Iuris",
    root: "C:/projetos/Iuris",
  },
];

function parseHash(): PreviewId | undefined {
  const raw = window.location.hash.replace(/^#/, "").trim();
  if (!raw || raw === "index") return undefined;
  return previewDestinations.some((item) => item.id === raw)
    ? (raw as PreviewId)
    : undefined;
}

function initialStandaloneTheme(): Theme {
  const param = new URLSearchParams(window.location.search).get("theme");
  return themes.includes(param as Theme) ? (param as Theme) : "Noir";
}

function initialStandalonePause(): boolean {
  return new URLSearchParams(window.location.search).get("pause") === "1";
}

function StandaloneLabApp() {
  const [preview, setPreview] = useState<PreviewId | undefined>(parseHash);
  const [theme, setTheme] = useState<Theme>(initialStandaloneTheme);
  const [paused, setPaused] = useState<boolean>(initialStandalonePause);
  const spectralPhase = useRef(0.6);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onHash = () => setPreview(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function goLab(next?: PreviewId) {
    setPreview(next);
    window.location.hash = next ?? "index";
  }

  const locationLabel = preview
    ? (previewDestinations.find((item) => item.id === preview)?.label ??
      "Laboratório")
    : "Índice do Laboratório";

  return (
    <div className="frame living-shell" data-motion-paused={paused}>
      <a className="skip-link" href="#content">
        Ir para o conteúdo
      </a>

      <header className="app-titlebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <LambdaMark />
          </span>
          LapLace
        </div>
        <div className="breadcrumb" aria-label="Localização atual">
          <span className="shell-context">Laboratório</span>
          <span className="breadcrumb-separator" aria-hidden="true">
            /
          </span>
          <strong aria-current="page" title={locationLabel}>
            {locationLabel}
          </strong>
        </div>
        <div className="window-drag-region" aria-hidden="true" />
        <div className="appearance-controls">
          <label className="visually-hidden" htmlFor="standalone-theme">
            Tema visual
          </label>
          <select
            id="standalone-theme"
            className="theme-select"
            value={theme}
            onChange={(event) => setTheme(event.target.value as Theme)}
          >
            {themes.map((item) => (
              <option key={item} value={item}>
                Tema · {item}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="shell-motion"
            aria-label={
              paused ? "Retomar campo espectral" : "Pausar campo espectral"
            }
            aria-pressed={paused}
            title={
              paused ? "Retomar campo espectral" : "Pausar campo espectral"
            }
            onClick={() => setPaused((p) => !p)}
          >
            <VisualIcon name={paused ? "play" : "pause"} />
          </button>
        </div>
      </header>

      <DesktopNavigation
        route={{ kind: "lab", preview }}
        projects={demoProjects}
        service={{
          state: "ready",
          health: { version: "0.1.0-lab", nodeVersion: "24.x" },
        }}
        onWorkspace={() => goLab(undefined)}
        onProject={() => goLab(preview ?? "memory")}
        onLab={goLab}
        onSettings={() =>
          setTheme(
            (current) =>
              themes[(themes.indexOf(current) + 1) % themes.length] ?? "Noir",
          )
        }
      />

      <div className="workspace">
        <main id="content" tabIndex={-1} className="main">
          <PreviewLab
            preview={preview}
            navigate={(id) => goLab(id)}
            index={() => goLab(undefined)}
            theme={theme}
            paused={paused}
            spectralPhase={spectralPhase}
          />
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StandaloneLabApp />);
