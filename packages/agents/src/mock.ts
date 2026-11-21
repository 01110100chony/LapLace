import { setTimeout as wait } from "node:timers/promises";
import { CodexJsonl, type CodexRunEvent } from "./codex.ts";

export const codexMockScenarios = [
  "completed",
  "fragmented",
  "cancel",
  "timeout",
  "malformed_jsonl",
  "authentication_error",
  "interrupted",
  "preparation_failure",
  "late_after_cancel",
] as const;
export type CodexMockScenario = (typeof codexMockScenarios)[number];

const response =
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: "Resposta simulada. Citação fictícia [source-1].",
    },
  }) + "\n";

export async function runMockCodex(
  scenario: CodexMockScenario,
  emit: (event: CodexRunEvent) => void,
  signal: AbortSignal,
): Promise<Extract<CodexRunEvent, { type: "terminal" }>> {
  const cancelled = {
    type: "terminal",
    state: "cancelled",
    failure: null,
  } as const;
  if (signal.aborted) return cancelled;
  if (scenario === "preparation_failure")
    return { type: "terminal", state: "failed", failure: "workspace_failed" };

  const parser = new CodexJsonl((event) => {
    if (!signal.aborted) emit(event);
  });
  const push = (line: string) => parser.push(Buffer.from(line));
  emit({ type: "started" });
  push('{"type":"thread.started","thread_id":"mock-session"}\n');
  push('{"type":"turn.started"}\n');

  try {
    const waitsForCancel =
      scenario === "cancel" || scenario === "late_after_cancel";
    await wait(waitsForCancel ? 120_000 : 450, undefined, { signal });
    if (waitsForCancel || scenario === "timeout")
      return { type: "terminal", state: "timeout", failure: null };
    if (scenario === "interrupted")
      return { type: "terminal", state: "interrupted", failure: null };
    if (scenario === "authentication_error") {
      push('{"type":"error","message":"401 Unauthorized (simulated)"}\n');
    } else {
      if (scenario === "malformed_jsonl") push("{invalid JSONL}\n");
      if (scenario === "fragmented") {
        const bytes = Buffer.from(response);
        const middle = bytes.indexOf(Buffer.from("í")) + 1;
        push('{"type":"item.started","item":{"type":"agent_message"}}\n');
        parser.push(bytes.subarray(0, middle));
        await wait(750, undefined, { signal });
        parser.push(bytes.subarray(middle));
      } else {
        push(response);
      }
      push(
        '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":8}}\n',
      );
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    if (scenario === "late_after_cancel") push(response);
    return cancelled;
  }

  const { completed, failure } = parser.finish();
  return completed
    ? { type: "terminal", state: "completed", failure: null }
    : {
        type: "terminal",
        state: "failed",
        failure: failure ?? "protocol_error",
      };
}
