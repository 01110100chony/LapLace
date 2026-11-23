import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { VisualIcon, type IconName } from "./VisualIcon";

export type Command = {
  id: string;
  label: string;
  scope: "Workspace" | "Projeto" | "Prévia";
  icon: IconName;
  action: () => void;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

export function CommandPalette({
  commands,
  trigger,
}: {
  commands: Command[];
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const matches = commands.filter(({ label, scope }) =>
    normalize(label + " " + scope).includes(normalize(query.trim())),
  );
  const selected = Math.min(cursor, Math.max(0, matches.length - 1));

  useEffect(() => {
    function open() {
      const palette = dialog.current;
      if (!palette || palette.open || document.querySelector("dialog[open]"))
        return;
      palette.showModal();
    }
    const button = trigger.current;
    button?.addEventListener("click", open);
    function shortcut(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "k" &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        open();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => {
      button?.removeEventListener("click", open);
      window.removeEventListener("keydown", shortcut);
    };
  }, [trigger]);

  function activate(command: Command) {
    dialog.current?.close();
    command.action();
  }

  return (
    <dialog
      className="import-dialog command-palette"
      ref={dialog}
      aria-labelledby={titleId}
      onClose={() => {
        setQuery("");
        setCursor(0);
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const command = matches[selected];
          if (command) activate(command);
        }}
      >
        <div className="palette-search">
          <VisualIcon name="search" />
          <label id={titleId} htmlFor={inputId} className="visually-hidden">
            Navegação rápida
          </label>
          <input
            id={inputId}
            type="search"
            ref={(node) => {
              if (node) node.autofocus = true;
            }}
            value={query}
            placeholder="Projeto, ferramenta ou ação…"
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                dialog.current?.close();
                return;
              }
              if (
                !matches.length ||
                (event.key !== "ArrowDown" && event.key !== "ArrowUp")
              )
                return;
              event.preventDefault();
              const next =
                (selected +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  matches.length) %
                matches.length;
              setCursor(next);
              const result = dialog.current
                ?.querySelectorAll(".palette-result")
                .item(next);
              result?.scrollIntoView({ block: "nearest" });
            }}
          />
          <button
            className="icon-button"
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Fechar navegação rápida"
          >
            <VisualIcon name="close" />
          </button>
        </div>
        <p className="visually-hidden" role="status">
          {matches.length} comandos. {matches[selected]?.label}
        </p>
        {matches.length ? (
          <ul className="palette-results">
            {matches.map((command, index) => (
              <li key={command.id}>
                <button
                  className="palette-result"
                  data-current={index === selected}
                  type="button"
                  onClick={() => activate(command)}
                >
                  <VisualIcon name={command.icon} />
                  <span>{command.label}</span>
                  <small>{command.scope}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="palette-empty">Nenhum resultado para esta busca.</p>
        )}
      </form>
      <p className="palette-keys">
        <kbd>↑</kbd>
        <kbd>↓</kbd> Navegar <kbd>Enter</kbd> Abrir
      </p>
    </dialog>
  );
}
