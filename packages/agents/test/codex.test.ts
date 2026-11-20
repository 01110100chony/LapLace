import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  codexMaxLineBytes,
  codexMaxOutputBytes,
  codexMaxEvents,
} from "@laplace/contracts";
import {
  codexExecArgs,
  codexEnvironment,
  CodexJsonl,
  detectCodex,
  runCodex,
  type CodexRunEvent,
  type VerifiedCodexBoundary,
} from "../src/codex.ts";

const lines = [
  { type: "thread.started", thread_id: "fixture-thread" },
  { type: "turn.started" },
  { type: "item.started", item: { type: "progress" } },
  { type: "error", message: "retrying" },
  { type: "future_event", secret: "ignored" },
  { type: "item.completed", item: { type: "agent_message", text: "Função λ" } },
  {
    type: "turn.completed",
    usage: { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4 },
  },
];

test("detects absent, unsupported, unauthenticated and recognized Codex", async () => {
  const state = async (version: string, authenticated: boolean) =>
    (
      await detectCodex(tmpdir(), {
        find: () => "fixture",
        call: async (_path, args) => {
          if (args.includes("--version"))
            return { code: 0, stdout: `codex-cli ${version}\r\n`, stderr: "" };
          if (args.includes("--help"))
            return {
              code: 0,
              stdout: codexExecArgs("fixture").join(" ") + " stdin --config",
              stderr: "",
            };
          return authenticated
            ? { code: 0, stdout: "", stderr: "Logged in using ChatGPT" }
            : { code: 1, stdout: "", stderr: "Not logged in" };
        },
      })
    ).availability.state;
  assert.equal(
    (await detectCodex(tmpdir(), { find: () => undefined })).availability.state,
    "missing",
  );
  assert.equal(await state("0.140.0", true), "unsupported");
  assert.equal(await state("0.141.0", false), "unauthenticated");
  assert.equal(await state("0.141.0", true), "confinement_unverified");
  assert.deepEqual(
    codexEnvironment({
      Path: "path",
      CODEX_HOME: "auth",
      MY_SECRET: "secret",
      OPENAI_BASE_URL: "custom",
    }),
    { PATH: "path", CODEX_HOME: "auth" },
  );
});

test("decodes fragmented UTF-8/CRLF, unknown events, usage and completion", () => {
  const events: CodexRunEvent[] = [];
  const parser = new CodexJsonl((event) => events.push(event));
  const bytes = Buffer.from(
    "bad json\r\n" + lines.map((event) => JSON.stringify(event)).join("\r\n"),
  );
  for (const byte of bytes) parser.push(Buffer.from([byte]));
  assert.deepEqual(events, [
    { type: "notice", reason: "malformed_event" },
    { type: "session", sessionId: "fixture-thread" },
    { type: "progress", stage: "turn" },
    { type: "progress", stage: "item" },
    { type: "notice", reason: "provider_error" },
    { type: "notice", reason: "unknown_event" },
    { type: "message", text: "Função λ" },
  ]);
  assert.deepEqual(parser.finish(), { completed: true, failure: undefined });
  assert.deepEqual(events.at(-1), {
    type: "usage",
    input: 12,
    cachedInput: 3,
    output: 4,
  });
});

test("bounds individual lines, total output and event count", () => {
  for (const input of [
    Buffer.alloc(codexMaxLineBytes + 1, "a"),
    Buffer.alloc(codexMaxOutputBytes + 1, 10),
    Buffer.from('{"type":"future"}\n'.repeat(codexMaxEvents)),
  ]) {
    const parser = new CodexJsonl(() => {});
    parser.push(input);
    assert.equal(parser.finish().failure, "output_limit");
  }
});

test("supervises a child with no shell and distinguishes end states", async () => {
  async function ask(
    code: string,
    { timeout = 3000, cancel = false, interrupt = false } = {},
  ) {
    const controller = new AbortController();
    const events: CodexRunEvent[] = [];
    const prompt = Buffer.from("source λ; $(echo unexpected)");
    const installation = { executable: process.execPath, version: "0.141.0" };
    const boundary: VerifiedCodexBoundary = {
      async verify() {
        return true;
      },
      start(file, args, { cwd }) {
        assert.equal(args.at(-1), "-");
        assert.ok(!args.includes(prompt.toString()));
        const child = spawn(file, ["-e", code], {
          cwd,
          windowsHide: true,
          stdio: "pipe",
        });
        if (interrupt) child.once("spawn", () => child.kill());
        return {
          child,
          stop: () => {
            child.kill();
          },
        };
      },
    };
    const terminal = await runCodex({
      installation,
      boundary,
      cwd: tmpdir(),
      workspace: tmpdir(),
      prompt,
      timeout,
      signal: controller.signal,
      emit: (event) => {
        events.push(event);
        if (cancel && event.type === "started") controller.abort();
      },
    });
    return { terminal, events };
  }
  const completed = await ask(`
    const chunks = [];
    process.stdin.on('data', (data) => chunks.push(data));
    process.stdin.on('end', () => {
      if (Buffer.concat(chunks).toString() !== 'source λ; $(echo unexpected)') process.exit(42);
      for (const line of ${JSON.stringify(lines)}) console.log(JSON.stringify(line));
    });
  `);
  assert.equal(completed.terminal.state, "completed");
  assert.ok(completed.events.some((event) => event.type === "message"));
  const hold = "setInterval(() => {}, 1000)";
  assert.equal((await ask(hold, { timeout: 100 })).terminal.state, "timeout");
  assert.equal((await ask(hold, { cancel: true })).terminal.state, "cancelled");
  assert.equal(
    (await ask(hold, { interrupt: true })).terminal.state,
    "interrupted",
  );
  assert.equal(
    (await ask("process.exit(1)")).terminal.failure,
    "provider_failed",
  );
  assert.equal(
    (await ask("process.exit(0)")).terminal.failure,
    "protocol_error",
  );
  assert.equal(
    (await ask(`console.log('x'.repeat(${codexMaxLineBytes + 1}))`)).terminal
      .failure,
    "output_limit",
  );
});
