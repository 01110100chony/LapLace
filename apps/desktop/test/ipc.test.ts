import assert from "node:assert/strict";
import { test } from "node:test";
import { createDesktopClient } from "../src/ipc.ts";

test("correlaciona operação e ID e devolve a resposta do health check", async () => {
  const desktop = createDesktopClient(async (command, { id }) => {
    assert.equal(command, "service_health");
    assert.ok(id);
    return {
      version: 1,
      id,
      operation: "health",
      ok: true,
      data: { version: "0.1.0", nodeVersion: "24.1.0" },
    };
  });
  assert.deepEqual(await desktop.health(), {
    version: "0.1.0",
    nodeVersion: "24.1.0",
  });
});

test("apresenta falhas estruturadas do host e do serviço", async () => {
  const hostFailure = createDesktopClient(async () => {
    throw { code: "service_unavailable" };
  });
  await assert.rejects(hostFailure.health(), { code: "service_unavailable" });
  const serviceFailure = createDesktopClient(async (_, { id }) => ({
    version: 1,
    id,
    ok: false,
    error: { code: "not_repository" },
  }));
  await assert.rejects(serviceFailure.addLocal(), { code: "not_repository" });
});

test("rejeita respostas inválidas, de outro pedido ou de outra operação", async () => {
  for (const replacement of [
    { id: "outro-pedido" },
    { operation: "project.inspect" },
    { data: { version: 1 } },
    { version: 2 },
  ]) {
    const desktop = createDesktopClient(async (_, { id }) => ({
      version: 1,
      id,
      operation: "health",
      ok: true,
      data: { version: "0.1.0", nodeVersion: "24" },
      ...replacement,
    }));
    await assert.rejects(desktop.health(), { code: "invalid_response" });
  }
});

test("expira IPC que não responde e aceita cancelamento do diálogo", async () => {
  const timeout = createDesktopClient(() => new Promise(() => {}), 5);
  await assert.rejects(timeout.health(), { code: "ipc_timeout" });
  const cancel = createDesktopClient(async () => null);
  assert.equal(await cancel.addLocal(), null);
});
