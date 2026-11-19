import { useId, useRef, useState, type RefObject } from "react";
import type { Project } from "@laplace/contracts";
import { errorMessage } from "./ipc";

type Props = {
  dialogRef: RefObject<HTMLDialogElement | null>;
  choose: () => Promise<Project | null>;
  onImported: (project: Project) => void;
};

export function ImportDialog({ dialogRef, choose, onImported }: Props) {
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
        onImported(project);
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
        <h2 id={headingId}>Adicionar projeto</h2>
        <button
          className="icon-button"
          disabled={busy}
          onClick={() => dialogRef.current?.close()}
          aria-label="Fechar"
        >
          ×
        </button>
      </div>
      <p id={descriptionId}>
        Escolha uma pasta de um repositório Git no seu computador.
      </p>
      <p className={failure ? "dialog-error" : "visually-hidden"} role="alert">
        {failure}
      </p>
      {busy && (
        <p className="loading">
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
          autoFocus
          disabled={busy}
          onClick={() => void select()}
        >
          Selecionar pasta
        </button>
      </div>
    </dialog>
  );
}
