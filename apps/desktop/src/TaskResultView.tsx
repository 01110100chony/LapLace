import { useEffect, useState } from "react";
import type {
  TaskChangePreview,
  TaskResult,
  TaskRunRef,
} from "@laplace/contracts";
import { errorMessage, type createDesktopClient } from "./ipc";
import { TextComparison } from "./TextComparison";
import { ResultReviewView } from "./ResultReviewView";

type Client = ReturnType<typeof createDesktopClient>["execution"];

export function TaskResultView({
  run,
  client,
}: {
  run: TaskRunRef;
  client: Client;
}) {
  const { projectId, taskId, executionId } = run;
  const [result, setResult] = useState<TaskResult["result"]>();
  const [path, setPath] = useState<string>();
  const [preview, setPreview] = useState<TaskChangePreview>();
  const [summaryError, setSummaryError] = useState("");
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void client.result({ projectId, taskId, executionId }).then(
      ({ result: captured }) => {
        if (cancelled) return;
        setResult(captured);
        setPath(captured?.changes[0]?.path);
      },
      (error) => {
        if (!cancelled) setSummaryError(errorMessage(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, projectId, taskId, executionId]);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void client.change({ projectId, taskId, executionId }, path).then(
      (file) => {
        if (!cancelled) setPreview(file);
      },
      (error) => {
        if (!cancelled) setPreviewError(errorMessage(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, projectId, taskId, executionId, path]);

  return (
    <section className="task-result" aria-label="Resultado da simulação">
      <h4>Resultado da simulação</h4>
      {summaryError && (
        <p role="alert" className="service-error">
          {summaryError}
        </p>
      )}
      {result === null && (
        <p className="context-muted">
          Esta tentativa não tem um diff preservado.
        </p>
      )}
      {result?.changes.length === 0 && (
        <p>Simulação concluída sem alterações.</p>
      )}
      {result && result.changes.length > 0 && (
        <ul className="context-list">
          {result.changes.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className="context-history-row"
                aria-current={file.path === path ? "true" : undefined}
                onClick={() => {
                  if (file.path === path) return;
                  setPreview(undefined);
                  setPreviewError("");
                  setPath(file.path);
                }}
              >
                <code>{file.path}</code>
                <small>
                  {!file.before
                    ? "Adicionado"
                    : !file.after
                      ? "Excluído"
                      : "Modificado"}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {previewError && (
        <p role="alert" className="service-error">
          {previewError}
        </p>
      )}
      {preview && (
        <TextComparison before={preview.beforeText} after={preview.afterText} />
      )}
      {result && <ResultReviewView client={client} run={run} />}
    </section>
  );
}
