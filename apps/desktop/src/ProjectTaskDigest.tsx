import { useEffect, useState } from "react";
import type { Task } from "@laplace/contracts";
import { type createDesktopClient, errorMessage } from "./ipc";
import { VisualIcon } from "./VisualIcon";

type TaskDigest =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; tasks: Task[] };

export function ProjectTaskDigest({
  projectId,
  client,
  openTasks,
}: {
  projectId: string;
  client: ReturnType<typeof createDesktopClient>["task"];
  openTasks: () => void;
}) {
  const [digest, setDigest] = useState<TaskDigest>({ state: "loading" });
  useEffect(() => {
    let current = true;
    void client.list(projectId).then(
      (page) => {
        if (current)
          setDigest({ state: "ready", tasks: page.items.slice(0, 3) });
      },
      (error) => {
        if (current)
          setDigest({ state: "error", message: errorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [client, projectId]);

  return (
    <section
      className="dashboard-panel task-digest"
      aria-labelledby="recent-task-heading"
    >
      <header className="dashboard-heading">
        <VisualIcon name="tasks" />
        <h2 id="recent-task-heading">Tarefas recentes</h2>
        <button type="button" className="text-button" onClick={openTasks}>
          Abrir tarefas <VisualIcon name="forward" />
        </button>
      </header>
      {digest.state === "loading" && (
        <p className="work-message" role="status">
          Carregando tarefas…
        </p>
      )}
      {digest.state === "error" && (
        <p className="work-message" role="alert">
          {digest.message}
        </p>
      )}
      {digest.state === "ready" &&
        (digest.tasks.length ? (
          <ul>
            {digest.tasks.map((task) => (
              <li key={task.taskId}>
                <span className="dashboard-icon">
                  <VisualIcon name="tasks" />
                </span>
                <div>
                  <strong>{task.title}</strong>
                  <small>
                    {task.source ? "Vinculada a uma fonte" : "Tarefa direta"}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="work-muted">Nenhuma tarefa criada neste projeto.</p>
        ))}
    </section>
  );
}
