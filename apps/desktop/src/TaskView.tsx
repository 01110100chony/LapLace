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
import { EmptyState, WorkHeading } from "./WorkView";
import { VisualIcon } from "./VisualIcon";

type Client = ReturnType<typeof createDesktopClient>["task"];
export type TaskProposal = { source: TaskSource; objective: string };
type Editor =
  { task: Task; proposal?: never } | { task?: never; proposal?: TaskProposal };

const taskDate = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

function TaskEditor({
  projectId,
  client,
  task,
  proposal,
  saved,
  dismissed,
}: {
  projectId: string;
  client: Client;
  task: Task | undefined;
  proposal: TaskProposal | undefined;
  saved: (task: Task) => void;
  dismissed: () => void;
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
  const dialog = useRef<HTMLDialogElement>(null);
  const source = task ? task.source : (proposal?.source ?? null);
  const heading = task ? "Editar tarefa" : "Nova tarefa";

  useEffect(() => () => request.invalidate(), [request]);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

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
      (result) => {
        dialog.current?.close();
        saved(result);
      },
      (error) => {
        setSaving(false);
        setProblem(errorMessage(error));
      },
    );
  }

  return (
    <dialog
      className="import-dialog task-dialog"
      ref={dialog}
      aria-labelledby={`${labelId}-heading`}
      onClose={dismissed}
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
    >
      <header className="dialog-heading">
        <h2 id={`${labelId}-heading`}>{heading}</h2>
        <button
          type="button"
          className="icon-button"
          disabled={saving}
          onClick={() => dialog.current?.close()}
          aria-label="Fechar"
        >
          <VisualIcon name="close" />
        </button>
      </header>
      <form className="task-form" onSubmit={submit}>
        <fieldset className="task-fields" disabled={saving}>
          <legend className="visually-hidden">Dados da tarefa</legend>
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
            ref={(input) => {
              titleInput.current = input;
              if (input) input.autofocus = true;
            }}
            required
            maxLength={taskTitleBytes}
            value={title}
            aria-invalid={field === "title" || undefined}
            aria-describedby={
              field === "title" ? `${labelId}-error` : undefined
            }
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
          <div className="dialog-actions">
            <button
              className="button"
              type="button"
              onClick={() => dialog.current?.close()}
            >
              Cancelar
            </button>
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
    </dialog>
  );
}

export function TaskView({
  projectId,
  client,
  executionClient,
  proposal,
  openAgents,
}: {
  projectId: string;
  client: Client;
  executionClient: ReturnType<typeof createDesktopClient>["execution"];
  proposal: TaskProposal | undefined;
  openAgents: () => void;
}) {
  const [requests] = useState(createLatestRequest);
  const [page, setPage] = useState<TaskPage>();
  const [active, setActive] = useState<Task>();
  const [editor, setEditor] = useState<Editor | undefined>(() =>
    proposal ? { proposal } : undefined,
  );
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [feedback, setFeedback] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const newTask = useRef<HTMLButtonElement>(null);

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
          setActive((current) =>
            current
              ? (next.items.find((task) => task.taskId === current.taskId) ??
                current)
              : next.items[0],
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

  const needle = query.trim().toLocaleLowerCase("pt-BR");
  const visible =
    page?.items.filter(
      (task) =>
        (sourceFilter === "all" ||
          (sourceFilter === "linked"
            ? task.source !== null
            : task.source === null)) &&
        (task.title + " " + task.objective)
          .toLocaleLowerCase("pt-BR")
          .includes(needle),
    ) ?? [];

  const filtering = needle !== "" || sourceFilter !== "all";
  const selected = filtering
    ? (visible.find((task) => task.taskId === active?.taskId) ?? visible[0])
    : active;

  return (
    <section className="tasks-surface" aria-labelledby="task-heading">
      <WorkHeading
        id="task-heading"
        title="Tarefas"
        actions={
          <>
            <button type="button" className="button" onClick={openAgents}>
              <VisualIcon name="agent" /> Agentes · prévia
            </button>
            <button
              ref={newTask}
              className="button primary"
              type="button"
              onClick={() => setEditor({})}
            >
              <VisualIcon name="plus" /> Nova tarefa
            </button>
          </>
        }
      />
      <p role="status" className="work-message">
        {feedback}
      </p>
      <div className={selected ? "work-grid task-layout" : "work-stack"}>
        <section className="panel" aria-labelledby="task-list-heading">
          <header className="work-panel-heading">
            <h3 id="task-list-heading">Tarefas do projeto</h3>
            <button
              className="text-button"
              type="button"
              disabled={loading}
              onClick={() => load()}
            >
              Atualizar tarefas
            </button>
          </header>
          {loading && (
            <p className="work-message" role="status">
              Carregando tarefas…
            </p>
          )}
          {problem && (
            <p className="work-message" role="alert">
              {problem}
            </p>
          )}
          {!loading && !problem && !page?.items.length && (
            <EmptyState icon="tasks" title="Nenhuma tarefa neste projeto">
              Use Nova tarefa para registrar o próximo passo.
            </EmptyState>
          )}
          {!!page?.items.length && (
            <>
              <div className="task-filters">
                <label className="work-field">
                  <span>Filtrar tarefas carregadas</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <label className="work-field">
                  <span>Origem</span>
                  <select
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value)}
                  >
                    <option value="all">Todas</option>
                    <option value="direct">Diretas</option>
                    <option value="linked">Consulta vinculada</option>
                  </select>
                </label>
              </div>
              {!visible.length && (
                <p className="work-muted" role="status">
                  Nenhuma tarefa carregada corresponde ao filtro.
                </p>
              )}
              <ul className="work-list">
                {visible.map((task) => (
                  <li key={task.taskId}>
                    <button
                      className="work-list-row"
                      type="button"
                      aria-current={
                        selected?.taskId === task.taskId || undefined
                      }
                      aria-controls={selected ? "task-detail" : undefined}
                      onClick={() => {
                        setFeedback("");
                        setActive(task);
                      }}
                    >
                      <span className="work-row-copy">
                        <strong>{task.title}</strong>
                        <small>
                          {task.source ? "Consulta vinculada" : "Tarefa direta"}{" "}
                          ·{" "}
                          <time dateTime={task.updatedAt}>
                            {taskDate.format(new Date(task.updatedAt))}
                          </time>
                        </small>
                      </span>
                      <VisualIcon name="chevron" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {page?.nextBefore && (
            <button
              className="text-button"
              type="button"
              disabled={loading}
              onClick={() => load(page.nextBefore)}
            >
              Ver tarefas anteriores
            </button>
          )}
        </section>
        {selected && (
          <section
            id="task-detail"
            className="panel task-detail"
            aria-labelledby="task-detail-heading"
          >
            <header className="work-panel-heading">
              <h3 id="task-detail-heading">{selected.title}</h3>
              <button
                className="button"
                type="button"
                onClick={() => setEditor({ task: selected })}
              >
                Editar tarefa
              </button>
            </header>
            <p className="task-objective">{selected.objective}</p>
            {selected.source && (
              <details className="task-details">
                <summary>Consulta vinculada</summary>
                <p>
                  Execução <code>{selected.source.executionId}</code>
                </p>
                <p>
                  Captura <code>{selected.source.contextId}</code>
                </p>
              </details>
            )}
            <div className="work-divider">
              <TaskExecutionView
                key={selected.taskId}
                task={selected}
                client={executionClient}
              />
            </div>
          </section>
        )}
      </div>
      {editor && (
        <TaskEditor
          projectId={projectId}
          client={client}
          task={editor.task}
          proposal={editor.proposal}
          dismissed={() => {
            setEditor(undefined);
            if (document.activeElement === document.body)
              newTask.current?.focus();
          }}
          saved={(task) => {
            setActive(task);
            setEditor(undefined);
            setQuery("");
            setSourceFilter("all");
            setFeedback("Tarefa salva no projeto.");
            load();
          }}
        />
      )}
    </section>
  );
}
