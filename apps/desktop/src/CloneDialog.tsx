import {
  parseGitHubRepository,
  type CloneJob,
  type ClonePhase,
  type Project,
} from "@laplace/contracts";
import { useId, useState, type FormEvent, type RefObject } from "react";
import { DesktopError, errorMessage, type createDesktopClient } from "./ipc";

type Props = {
  dialogRef: RefObject<HTMLDialogElement | null>;
  client: ReturnType<typeof createDesktopClient>["clone"];
  onSelected: (project: Project) => void;
};

const phases: Record<ClonePhase, string> = {
  connecting: "Conectando ao GitHub…",
  receiving: "Recebendo objetos…",
  resolving: "Resolvendo deltas…",
  checking_out: "Preparando checkout…",
  registering: "Adicionando ao catálogo…",
};

export function CloneDialog({ dialogRef, client, onSelected }: Props) {
  const heading = useId();
  const input = useId();
  const hint = useId();
  const [url, setUrl] = useState("");
  const [job, setJob] = useState<CloneJob>();
  const [monitoring, setMonitoring] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [failure, setFailure] = useState("");
  const [invalidUrl, setInvalidUrl] = useState(false);
  const running = job?.state === "cloning" || job?.state === "cancelling";
  const busy = monitoring || running;
  const status = running
    ? job.state === "cancelling"
      ? "Cancelando clone…"
      : phases[job.phase]
    : job?.state === "cancelled"
      ? "Clone cancelado."
      : monitoring
        ? "Aguardando seleção e confirmação do destino…"
        : "";

  async function monitor(start: () => Promise<CloneJob | null>) {
    setMonitoring(true);
    setFailure("");
    try {
      let current = await start();
      if (!current) return;
      setJob(current);
      while (current.state === "cloning" || current.state === "cancelling") {
        await new Promise((resolve) => setTimeout(resolve, 300));
        current = await client.status(current.cloneId);
        setJob(current);
      }
      if (current.project) {
        dialogRef.current?.close();
        onSelected(current.project);
      } else if (current.failure) {
        setFailure(errorMessage(new DesktopError(current.failure)));
      }
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setMonitoring(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const repository = parseGitHubRepository(url);
    if (!repository) {
      setInvalidUrl(true);
      event.currentTarget.querySelector("input")?.focus();
      return;
    }
    setJob(undefined);
    void monitor(() => client.start(repository.url));
  }

  async function cancel(cloneId: string) {
    setCancelling(true);
    setFailure("");
    try {
      await client.cancel(cloneId);
      if (!monitoring) void monitor(() => client.status(cloneId));
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setCancelling(false);
    }
  }

  function reset() {
    setUrl("");
    setJob(undefined);
    setFailure("");
    setInvalidUrl(false);
  }

  return (
    <dialog
      ref={dialogRef}
      className="import-dialog"
      aria-labelledby={heading}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={reset}
    >
      <div className="dialog-heading">
        <h2 id={heading}>Clonar do GitHub</h2>
        <button
          className="icon-button"
          disabled={busy}
          onClick={() => dialogRef.current?.close()}
          aria-label="Fechar"
        >
          ×
        </button>
      </div>
      <form className="task-fields" onSubmit={submit} aria-labelledby={heading}>
        <label htmlFor={input}>URL HTTPS do repositório</label>
        <input
          id={input}
          name="url"
          type="url"
          required
          maxLength={180}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
          disabled={busy}
          aria-invalid={invalidUrl || undefined}
          aria-describedby={hint}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setInvalidUrl(false);
          }}
        />
        <small id={hint}>Formato https://github.com/conta/repositorio</small>
        {job && <p className="clone-path">{job.destination}</p>}
        <p className={status ? undefined : "visually-hidden"} role="status">
          {status}
        </p>
        {running && job.state === "cloning" && (
          <progress
            className="clone-progress"
            aria-label={phases[job.phase]}
            max={100}
            value={job.percent ?? undefined}
          />
        )}
        <div
          className={invalidUrl || failure ? "dialog-error" : "visually-hidden"}
          role="alert"
        >
          {invalidUrl
            ? "Informe a URL HTTPS de um repositório em github.com."
            : failure}
          {job?.leftover && <p className="clone-path">{job.leftover}</p>}
        </div>
        <div className="dialog-actions">
          {running ? (
            <>
              {!monitoring && (
                <button
                  type="button"
                  className="button"
                  onClick={() => void monitor(() => client.status(job.cloneId))}
                >
                  Consultar andamento
                </button>
              )}
              <button
                type="button"
                className="button"
                disabled={
                  cancelling ||
                  job.state === "cancelling" ||
                  job.phase === "registering"
                }
                onClick={() => void cancel(job.cloneId)}
              >
                Cancelar clone
              </button>
            </>
          ) : (
            <button className="button primary" type="submit" disabled={busy}>
              Selecionar destino
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
