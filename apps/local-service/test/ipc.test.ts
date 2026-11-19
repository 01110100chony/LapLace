import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isResponse } from "@laplace/contracts";

test(
  "processo Node responde por stdio, preserva IDs e encerra com EOF",
  { timeout: 12_000 },
  async (t) => {
    const entry = fileURLToPath(new URL("../src/main.ts", import.meta.url));
    const child = spawn(process.execPath, [entry], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "inherit"],
    });
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    const closed = once(child, "close");
    const lines = createInterface({ input: child.stdout })[
      Symbol.asyncIterator
    ]();

    child.stdin.write('{"version":1,"id":"bad-1","operation":"shell"}\n');
    const bad = JSON.parse((await lines.next()).value ?? "null");
    assert.ok(isResponse(bad, "bad-1", "health"));
    assert.deepEqual(bad, {
      version: 1,
      id: "bad-1",
      ok: false,
      error: { code: "invalid_request" },
    });

    child.stdin.write('{"version":1,"id":"health-2","operation":"health"}\n');
    const health = JSON.parse((await lines.next()).value ?? "null");
    assert.ok(isResponse(health, "health-2", "health"));
    assert.equal(health.ok, true);
    if (health.ok) assert.equal(health.data.nodeVersion, process.versions.node);

    child.stdin.end();
    assert.deepEqual(await closed, [0, null]);
  },
);
