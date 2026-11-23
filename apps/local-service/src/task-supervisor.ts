import { randomUUID } from "node:crypto";
import type { CodexRunEvent } from "@laplace/agents";
import { runMockCodex, type CodexMockScenario } from "@laplace/agents/mock";
import {
  type TaskRun,
  type TaskRunRef,
  type TaskScope,
  type TaskStart,
} from "@laplace/contracts";
import type { createTaskExecutionStore } from "./task-execution-store.ts";
import { prepareMockOutput } from "./task-output.ts";

type Store = ReturnType<typeof createTaskExecutionStore>;
type Active = {
  execution: TaskRun;
  controller: AbortController;
  completion?: Promise<void>;
};
type Terminal = Extract<CodexRunEvent, { type: "terminal" }>;

export class TaskSupervisor {
  private readonly owner = { id: randomUUID(), pid: process.pid };
  private readonly active = new Map<string, Active>();
  private readonly scenario: CodexMockScenario | undefined;

  constructor(scenario: CodexMockScenario | undefined) {
    this.scenario = scenario;
  }

  private keyFor(ref: TaskRunRef) {
    return `${ref.projectId}:${ref.taskId}:${ref.executionId}`;
  }

  latest(scope: TaskScope, store: Store) {
    return store.latest(scope, this.scenario ? "mock_development" : null);
  }

  start(request: TaskStart, store: Store, protectedRoots: string[]) {
    const scenario = this.scenario;
    const { execution, created } = store.start(
      request,
      scenario ? this.owner : undefined,
    );
    if (created && scenario) {
      const controller = new AbortController();
      const active: Active = { execution, controller };
      const key = this.keyFor(execution);
      this.active.get(key)?.controller.abort();
      this.active.set(key, active);
      active.completion = this.run(
        active,
        key,
        scenario,
        store,
        protectedRoots,
      );
    }
    return execution;
  }

  cancel(ref: TaskRunRef, store: Store) {
    const execution = store.cancel(ref);
    this.active.get(this.keyFor(execution))?.controller.abort();
    return execution;
  }

  close() {
    const pending: Promise<void>[] = [];
    for (const entry of this.active.values()) {
      entry.controller.abort();
      if (entry.completion) pending.push(entry.completion);
    }
    return pending.length > 0
      ? Promise.all(pending).then(() => undefined)
      : undefined;
  }

  private async run(
    active: Active,
    key: string,
    scenario: CodexMockScenario,
    store: Store,
    protectedRoots: string[],
  ) {
    const { execution, controller } = active;
    const timer = setInterval(() => {
      try {
        const state = store.heartbeat(execution, this.owner.id);
        if (state !== "running") controller.abort();
      } catch {
        controller.abort();
        console.error("[laplace:task] heartbeat_failed");
      }
    }, 1000);
    timer.unref();

    const failed: Terminal = {
      type: "terminal",
      state: "failed",
      failure: "workspace_failed",
    };
    let terminal = failed;
    let output: Awaited<ReturnType<typeof prepareMockOutput>> | undefined;
    try {
      terminal = await runMockCodex(
        scenario,
        (event) => {
          if (controller.signal.aborted || event.type === "terminal") return;
          const taskEvent =
            event.type === "message"
              ? { ...event, text: "Resposta simulada da tarefa." }
              : event;
          store.append(execution, this.owner.id, taskEvent);
        },
        controller.signal,
      );
      if (terminal.state === "completed")
        output = await prepareMockOutput(protectedRoots, controller.signal);
    } catch {
      terminal = controller.signal.aborted
        ? { type: "terminal", state: "cancelled", failure: null }
        : failed;
      if (!controller.signal.aborted)
        console.error("[laplace:task] run_failed");
    } finally {
      clearInterval(timer);
      try {
        store.finish(execution, this.owner.id, terminal, output);
      } catch {
        console.error("[laplace:task] terminal_save_failed");
        if (terminal.state === "completed") {
          try {
            store.finish(execution, this.owner.id, failed);
          } catch {
            // Leave a failed write to lease recovery.
          }
        }
      }
      if (this.active.get(key) === active) this.active.delete(key);
    }
  }
}
