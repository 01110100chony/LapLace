import { useId, useRef, useState, type RefObject } from "react";
import type { Project } from "@laplace/contracts";
import { errorMessage } from "./ipc";
import { VisualIcon } from "./VisualIcon";

type Props = {
  dialogRef: RefObject<HTMLDialogElement | null>;
  mode: "import" | "relocate";
  choose: () => Promise<Project | null>;
  onSelected: (project: Project) => void;
};

export function ProjectFolderDialog({
  dialogRef,
  mode,
  choose,
  onSelected,
}: Props) {
  const headingId = useId();
  const descriptionId = useId();
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  async function select() {
    const current = ++generation.current;
    setFailure("");
    setBusy(true);
    try {
      const project = await choose();
      if (
        generation.current === current &&
        dialogRef.current?.open &&
        project
      ) {
        dialogRef.current.close();
        onSelected(project);
      }
    } catch (error) {
      if (generation.current === current && dialogRef.current?.open) {
        setFailure(errorMessage(error));
      }
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  function reset() {
    generation.current++;
    setBusy(false);
    setFailure("");
  }

  return (
    <dialog
      ref={dialogRef}
      className="import-dialog"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={reset}
    >
      <div className="dialog-heading">
        <h2 id={headingId}>
          {mode === "import" ? "Adicionar projeto" : "Relocalizar projeto"}
        </h2>
        <button
          className="icon-button"
          disabled={busy}
          onClick={() => dialogRef.current?.close()}
          aria-label="Fechar"
        >
          <VisualIcon name="close" />
        </button>
      </div>
      <p id={descriptionId}>
        {mode === "import"
          ? "Escolha uma pasta de um repositório Git no seu computador."
          : "Selecione o mesmo checkout Git na nova localização. O projeto mantém seu nome e registro."}
      </p>
      <p className={failure ? "dialog-error" : "visually-hidden"} role="alert">
        {failure}
      </p>
      {busy && (
        <p className="loading" role="status">
          <span aria-hidden="true" /> Aguardando seleção ou leitura do Git…
        </p>
      )}
      <div className="dialog-actions">
        <button
          className="button"
          disabled={busy}
          onClick={() => dialogRef.current?.close()}
        >
          Cancelar
        </button>
        <button
          className="button primary"
          ref={(button) => {
            if (button) button.autofocus = true;
          }}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) void select();
          }}
        >
          Selecionar pasta
        </button>
      </div>
    </dialog>
  );
}
