import {
  isTaskObjective,
  isTaskTitle,
  taskObjectiveBytes,
  taskTitleBytes,
  type Task,
  type TaskPage,
  type TaskSource,
} from "@laplace/contracts";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { errorMessage, type createDesktopClient } from "./ipc";
import { createLatestRequest } from "./workspace";
import { TaskExecutionView } from "./TaskExecutionView";

type Client = ReturnType<typeof createDesktopClient>["task"];
export type TaskProposal = { source: TaskSource; objective: string };

function TaskEditor({
  projectId,
  client,
  task,
  proposal,
  saved,
}: {
  projectId: string;
  client: Client;
  task: Task | undefined;
  proposal: TaskProposal | undefined;
  saved: (task: Task) => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(task?.title ?? "");
  const [objective, setObjective] = useState(
    task?.objective ?? proposal?.objective ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [field, setField] = useState<"title" | "objective">();
  const [request] = useState(createLatestRequest);
  const labelId = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const objectiveInput = useRef<HTMLTextAreaElement>(null);
  const source = task ? task.source : (proposal?.source ?? null);

  useEffect(() => () => request.invalidate(), [request]);
  useEffect(() => {
    if (proposal) titleInput.current?.focus();
  }, [proposal]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!isTaskTitle(title)) {
      setField("title");
      setProblem(`Informe um título com até ${taskTitleBytes} bytes em UTF-8.`);
      titleInput.current?.focus();
      return;
    }
    const effectiveObjective = objective.trim() || title.trim();
    if (!isTaskObjective(effectiveObjective)) {
      setField("objective");
      setProblem(
        `Informe um objetivo com até ${taskObjectiveBytes} bytes em UTF-8.`,
      );
      objectiveInput.current?.focus();
      return;
    }
    setField(undefined);
    setProblem("");
    setSaving(true);
    const fields = { projectId, title, objective: effectiveObjective };
    void request.run(
      () =>
        task
          ? client.update({
              ...fields,
              taskId: task.taskId,
              expectedRevision: task.revision,
            })
          : client.create({ ...fields, taskId: id, source }),
      saved,
      (error) => {
        setSaving(false);
        setProblem(errorMessage(error));
      },
    );
  }

  return (
    <form className="task-form" onSubmit={submit}>
      <fieldset className="task-fields" disabled={saving}>
        <legend>{task ? "Editar tarefa" : "Criar tarefa"}</legend>
        {source && (
          <details>
            <summary>Consulta vinculada</summary>
            <p>
              Execução <code>{source.executionId}</code>
            </p>
            <p>
              Captura <code>{source.contextId}</code>
            </p>
          </details>
        )}
        <label htmlFor={`${labelId}-title`}>Título</label>
        <input
          id={`${labelId}-title`}
          ref={titleInput}
          required
          maxLength={taskTitleBytes}
          value={title}
          aria-invalid={field === "title" || undefined}
          aria-describedby={field === "title" ? `${labelId}-error` : undefined}
          onChange={(event) => {
            setTitle(event.target.value);
            if (field === "title") {
              setField(undefined);
              setProblem("");
            }
          }}
        />
        <label htmlFor={`${labelId}-objective`}>Objetivo (opcional)</label>
        <textarea
          id={`${labelId}-objective`}
          ref={objectiveInput}
          rows={4}
          maxLength={taskObjectiveBytes}
          value={objective}
          aria-invalid={field === "objective" || undefined}
          aria-describedby={
            field === "objective" ? `${labelId}-error` : undefined
          }
          onChange={(event) => {
            setObjective(event.target.value);
            if (field === "objective") {
              setField(undefined);
              setProblem("");
            }
          }}
        />
        <div>
          <button className="button primary" type="submit">
            {saving ? "Salvando…" : "Salvar tarefa"}
          </button>
        </div>
      </fieldset>
      {problem && (
        <p id={`${labelId}-error`} role="alert" className="service-error">
          {problem}
        </p>
      )}
    </form>
  );
}

export function TaskView({
  projectId,
  client,
  executionClient,
  proposal,
}: {
  projectId: string;
  client: Client;
  executionClient: ReturnType<typeof createDesktopClient>["execution"];
  proposal: TaskProposal | undefined;
}) {
  const [requests] = useState(createLatestRequest);
  const [page, setPage] = useState<TaskPage>();
  const [active, setActive] = useState<Task>();
  const [draft, setDraft] = useState(proposal);
  const [draftNumber, setDraftNumber] = useState(0);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(
    (before: string | null = null) => {
      setLoading(true);
      setProblem("");
      void requests.run(
        () => client.list(projectId, before),
        (next) => {
          setPage((old) =>
            before && old
              ? { ...next, items: [...old.items, ...next.items] }
              : next,
          );
          setLoading(false);
        },
        (error) => {
          setProblem(errorMessage(error));
          setLoading(false);
        },
      );
    },
    [client, projectId, requests],
  );

  useEffect(() => {
    load();
    return () => requests.invalidate();
  }, [load, requests]);

  function startDraft() {
    setActive(undefined);
    setDraft(undefined);
    setFeedback("");
    setDraftNumber((value) => value + 1);
  }

  return (
    <section className="panel context-search" aria-labelledby="task-heading">
      <div className="section-heading">
        <h2 id="task-heading">Tarefas</h2>
        <button className="button" type="button" onClick={startDraft}>
          Nova tarefa
        </button>
      </div>
      <p role="status" className="context-muted">
        {feedback}
      </p>
      <TaskEditor
        key={active ? `${active.taskId}/${active.revision}` : draftNumber}
        projectId={projectId}
        client={client}
        task={active}
        proposal={draft}
        saved={(task) => {
          setActive(task);
          setDraft(undefined);
          setFeedback("Tarefa salva no projeto.");
          load();
        }}
      />
      {active && (
        <TaskExecutionView
          key={active.taskId}
          task={active}
          client={executionClient}
        />
      )}
      <div className="section-heading">
        <h3>Tarefas do projeto</h3>
        <button
          type="button"
          className="text-button"
          disabled={loading}
          onClick={() => load()}
        >
          Atualizar tarefas
        </button>
      </div>
      {loading && <p className="context-muted">Carregando tarefas…</p>}
      {problem && (
        <p role="alert" className="service-error">
          {problem}
        </p>
      )}
      {!loading && !problem && !page?.items.length && (
        <p>Nenhuma tarefa criada neste projeto.</p>
      )}
      {!!page?.items.length && (
        <ul className="context-list">
          {page.items.map((task) => (
            <li key={task.taskId}>
              <button
                className="context-history-row"
                type="button"
                aria-current={active?.taskId === task.taskId || undefined}
                onClick={() => {
                  setFeedback("");
                  setActive(task);
                }}
              >
                <span>{task.title}</span>
                <small>
                  {task.source ? "Consulta vinculada" : "Tarefa direta"} ·{" "}
                  <time dateTime={task.updatedAt}>
                    {new Date(task.updatedAt).toLocaleString("pt-BR")}
                  </time>
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {page?.nextBefore && (
        <button
          className="button"
          type="button"
          disabled={loading}
          onClick={() => load(page.nextBefore)}
        >
          Ver tarefas anteriores
        </button>
      )}
    </section>
  );
}
