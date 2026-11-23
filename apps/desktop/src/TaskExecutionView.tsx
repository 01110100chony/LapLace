import {
  isTaskRunActive,
  type Task,
  type TaskRun,
  type TaskRunEvent,
  type TaskRunMode,
  type TaskRunState,
} from "@laplace/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, type createDesktopClient } from "./ipc";
import { createLatestRequest } from "./workspace";
import { TaskResultView } from "./TaskResultView";

type Client = ReturnType<typeof createDesktopClient>["execution"];
const labels: Record<TaskRunState, string> = {
  running: "Execução em andamento",
  cancelling: "Cancelamento solicitado",
  completed: "Execução concluída",
  failed: "Falha na execução",
  cancelled: "Execução cancelada",
  interrupted: "Execução interrompida",
  timeout: "Tempo da execução esgotado",
};

export function TaskExecutionView({
  task,
  client,
}: {
  task: Task;
  client: Client;
}) {
  const { projectId, taskId, revision } = task;
  const [mode, setMode] = useState<TaskRunMode | null>();
  const [run, setRun] = useState<TaskRun>();
  const [events, setEvents] = useState<TaskRunEvent[]>([]);
  const [replay, setReplay] = useState(0);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(true);
  const [problem, setProblem] = useState("");
  const [requests] = useState(() => ({
    status: createLatestRequest(),
    action: createLatestRequest(),
  }));
  const requestId = useRef<{ revision: number; id: string } | undefined>(
    undefined,
  );
  const executionId = run?.executionId;
  const running = run !== undefined && isTaskRunActive(run.state);

  const show = useCallback((execution: TaskRun | null) => {
    setRun(execution ?? undefined);
    setEvents([]);
    setReplay((current) => current + 1);
  }, []);

  const load = useCallback(() => {
    setChecking(true);
    setProblem("");
    void requests.status.run(
      () => client.latest({ projectId, taskId }),
      (status) => {
        setMode(status.availableMode);
        show(status.latest);
        setChecking(false);
      },
      (error) => {
        setProblem(errorMessage(error));
        setChecking(false);
      },
    );
  }, [client, projectId, taskId, requests, show]);

  useEffect(() => {
    load();
    return () => {
      requests.status.invalidate();
      requests.action.invalidate();
    };
  }, [load, requests]);

  useEffect(() => {
    if (!executionId) return;
    const ref = { projectId, taskId, executionId };
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let afterSeq = 0;
    async function poll() {
      try {
        const page = await client.events(ref, afterSeq);
        if (disposed) return;
        afterSeq = page.nextSeq;
        setRun(page);
        setEvents((all) => [...all, ...page.events]);
        if (page.more || isTaskRunActive(page.state))
          timer = setTimeout(() => void poll(), page.more ? 0 : 450);
      } catch (error) {
        if (!disposed) setProblem(errorMessage(error));
      }
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [client, executionId, projectId, replay, taskId]);

  function start() {
    if (pending || checking || running || mode !== "mock_development") return;
    if (requestId.current?.revision !== revision)
      requestId.current = { revision, id: crypto.randomUUID() };
    const id = requestId.current.id;
    setPending(true);
    setProblem("");
    void requests.action.run(
      () =>
        client.start({
          projectId,
          taskId,
          expectedRevision: revision,
          requestId: id,
        }),
      (execution) => {
        requestId.current = undefined;
        show(execution);
        setPending(false);
      },
      (error) => {
        setProblem(errorMessage(error));
        setPending(false);
      },
    );
  }

  function cancel() {
    if (!run || run.state !== "running" || pending) return;
    setPending(true);
    setProblem("");
    void requests.action.run(
      () => client.cancel(run),
      (execution) => {
        setRun((current) =>
          current && !isTaskRunActive(current.state) ? current : execution,
        );
        setPending(false);
      },
      (error) => {
        setProblem(errorMessage(error));
        setPending(false);
      },
    );
  }

  return (
    <section
      className="context-result"
      aria-labelledby="task-execution-heading"
    >
      <div className="work-panel-heading">
        <h4 id="task-execution-heading">Execução da tarefa</h4>
        <button
          type="button"
          className="text-button"
          disabled={checking || pending}
          onClick={load}
        >
          Atualizar execução
        </button>
      </div>
      {problem && (
        <p className="service-error" role="alert">
          {problem}
        </p>
      )}
      {mode === null && (
        <p className="context-muted">
          Nesta versão, novas execuções usam o modo Mock de desenvolvimento.
        </p>
      )}
      {mode === "mock_development" && (
        <div className="context-toolbar">
          <button
            type="button"
            className="button primary"
            disabled={running || pending || checking}
            onClick={start}
          >
            Executar simulação
          </button>
          {running && (
            <button
              type="button"
              className="button"
              disabled={pending || run?.state === "cancelling"}
              onClick={cancel}
            >
              Cancelar execução
            </button>
          )}
        </div>
      )}
      {run && (
        <>
          <p className="context-muted">Mock · Revisão {run.taskRevision}</p>
          <p role="status">{labels[run.state]}</p>
          {events
            .filter((item) => item.type === "message")
            .map(({ seq, text }) => (
              <pre key={seq} className="codex-message">
                {text}
              </pre>
            ))}
          {run.state === "completed" && (
            <TaskResultView
              key={`${run.executionId}-${replay}`}
              run={run}
              client={client}
            />
          )}
        </>
      )}
    </section>
  );
}
