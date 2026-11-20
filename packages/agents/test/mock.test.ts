import assert from "node:assert/strict";
import { test } from "node:test";
import type { CodexRunEvent } from "../src/codex.ts";
import { codexMockScenarios, runMockCodex } from "../src/mock.ts";

test("mock emits the C03 lifecycle with deterministic, synthetic messages and failures", async () => {
  const expected = {
    completed: ["completed", null],
    fragmented: ["completed", null],
    cancel: ["cancelled", null],
    timeout: ["timeout", null],
    malformed_jsonl: ["completed", null],
    authentication_error: ["failed", "authentication_failed"],
    interrupted: ["interrupted", null],
    preparation_failure: ["failed", "workspace_failed"],
    late_after_cancel: ["cancelled", null],
  } as const;
  await Promise.all(
    codexMockScenarios.map(async (scenario) => {
      const events: CodexRunEvent[] = [];
      const controller = new AbortController();
      const result = await runMockCodex(
        scenario,
        (event) => {
          events.push(event);
          if (
            event.type === "progress" &&
            (scenario === "cancel" || scenario === "late_after_cancel")
          ) {
            controller.abort();
          }
        },
        controller.signal,
      );
      assert.deepEqual(
        [result.state, result.failure],
        expected[scenario],
        scenario,
      );
      if (result.state === "completed") {
        assert.deepEqual(
          events.find((event) => event.type === "message"),
          {
            type: "message",
            text: "Resposta simulada. Fonte fictícia: trecho de exemplo.",
          },
        );
      } else {
        assert.ok(
          events.every(({ type }) => type !== "message"),
          scenario,
        );
      }
      if (scenario === "malformed_jsonl")
        assert.ok(
          events.some(
            (event) =>
              event.type === "notice" && event.reason === "malformed_event",
          ),
        );
      if (scenario === "fragmented")
        assert.ok(
          events.some(
            (event) => event.type === "progress" && event.stage === "item",
          ),
        );
      if (scenario === "preparation_failure") assert.deepEqual(events, []);
    }),
  );
});
