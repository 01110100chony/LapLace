import { themes, type Theme } from "./appearance";
import type { ServiceStatus } from "./views";
import { VisualIcon } from "./VisualIcon";

export function SettingsView({
  theme,
  paused,
  service,
  changeTheme,
  togglePause,
  openAgents,
}: {
  theme: Theme;
  paused: boolean;
  service: ServiceStatus;
  changeTheme: (theme: Theme) => void;
  togglePause: () => void;
  openAgents: () => void;
}) {
  return (
    <div className="preferences">
      <header className="surface-intro">
        <h1>Preferências</h1>
      </header>
      <section className="settings-row" aria-labelledby="appearance-heading">
        <div>
          <h2 id="appearance-heading">Aparência</h2>
          <p>Aplicada a toda a bancada.</p>
        </div>
        <div className="theme-options" role="group" aria-label="Tema">
          {themes.map((item) => (
            <button
              type="button"
              className="theme-option"
              key={item}
              aria-pressed={theme === item}
              onClick={() => changeTheme(item)}
            >
              <span data-swatch={item} aria-hidden="true" />
              {item}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-row" aria-labelledby="motion-heading">
        <div>
          <h2 id="motion-heading">Campo espectral</h2>
          <p>A preferência de movimento reduzido do Windows é respeitada.</p>
        </div>
        <button
          className="button"
          type="button"
          aria-pressed={paused}
          onClick={togglePause}
        >
          <VisualIcon name={paused ? "play" : "pause"} /> Pausar campo espectral
        </button>
      </section>
      <section className="settings-row" aria-labelledby="provider-heading">
        <div>
          <h2 id="provider-heading">Agentes</h2>
          <p>
            A disponibilidade real do Codex é verificada na consulta de cada
            projeto.
          </p>
        </div>
        <button type="button" className="button" onClick={openAgents}>
          Central de agentes · prévia <VisualIcon name="forward" />
        </button>
      </section>
      <section className="settings-row" aria-labelledby="privacy-heading">
        <div>
          <h2 id="privacy-heading">Dados e privacidade</h2>
          <p>
            O catálogo e as capturas ficam no serviço local. Uma consulta usa a
            seleção e a autorização do fluxo correspondente.
          </p>
        </div>
        <div role="status" className="local-status">
          <VisualIcon name="workspace" />
          {service.state === "ready" ? (
            <span>
              Serviço conectado · versão <code>{service.health.version}</code>
            </span>
          ) : service.state === "loading" ? (
            <span>Verificando serviço…</span>
          ) : (
            <span>Serviço indisponível</span>
          )}
        </div>
      </section>
    </div>
  );
}
