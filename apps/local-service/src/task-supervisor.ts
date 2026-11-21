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
  private active: Active | undefined;
  private readonly scenario: CodexMockScenario | undefined;

  constructor(scenario: CodexMockScenario | undefined) {
    this.scenario = scenario;
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
      this.active?.controller.abort();
      const active: Active = { execution, controller: new AbortController() };
      this.active = active;
      active.completion = this.run(active, scenario, store, protectedRoots);
    }
    return execution;
  }

  cancel(ref: TaskRunRef, store: Store) {
    const execution = store.cancel(ref);
    if (this.active?.execution.executionId === execution.executionId)
      this.active.controller.abort();
    return execution;
  }

  close() {
    this.active?.controller.abort();
    return this.active?.completion;
  }

  private async run(
    active: Active,
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
      if (this.active === active) this.active = undefined;
    }
  }
}
