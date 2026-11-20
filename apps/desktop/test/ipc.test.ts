import assert from "node:assert/strict";
import { test } from "node:test";
import { protocolVersion, type ContextHistory } from "@laplace/contracts";
import { createDesktopClient } from "../src/ipc.ts";
import { createLatestRequest } from "../src/workspace.ts";

test("correlaciona operação e ID e devolve a resposta do health check", async () => {
  const desktop = createDesktopClient(async (command, { id }) => {
    assert.equal(command, "service_health");
    assert.ok(id);
    return {
      version: protocolVersion,
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
    version: protocolVersion,
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
    { version: protocolVersion - 1 },
  ]) {
    const desktop = createDesktopClient(async (_, { id }) => ({
      version: protocolVersion,
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
  assert.equal(await cancel.relocate("a".repeat(64)), null);
});

test("rejeita dados de seleção de outro projeto mesmo com ID de IPC válido", async () => {
  const desktop = createDesktopClient(async (command, { id }) => {
    assert.equal(command, "project_select");
    return {
      version: protocolVersion,
      id,
      operation: "project.select",
      ok: true,
      data: {
        id: "b".repeat(64),
        name: "Outro",
        root: "C:\\Outro",
        cached: null,
      },
    };
  });
  await assert.rejects(desktop.select("a".repeat(64)), {
    code: "invalid_response",
  });
});

test("troca rápida de projeto descarta histórico atrasado e rejeita respostas de outro contexto", async () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const c = "c".repeat(64);
  let finishA!: () => void;
  const savedA = new Promise<void>((resolve) => {
    finishA = resolve;
  });
  const client = createDesktopClient(async (command, { id, projectId }) => {
    if (command === "context_validate")
      return {
        version: protocolVersion,
        id,
        ok: true,
        operation: "context.validate",
        data: {
          projectId,
          contextId: b,
          state: "matches",
          checkedAt: "2026-11-20T10:00:00.000Z",
        },
      };
    assert.equal(command, "context_list");
    if (projectId === a) await savedA;
    return {
      version: protocolVersion,
      id,
      ok: true,
      operation: "context.list",
      data: { projectId, items: [], nextBefore: null },
    };
  }).context;
  const latest = createLatestRequest();
  const shown: string[] = [];
  const render = (value: ContextHistory) => shown.push(value.projectId);
  const fail = () => assert.fail("histórico inesperado");
  const pending = latest.run(() => client.list(a), render, fail);
  latest.invalidate();
  await latest.run(() => client.list(b), render, fail);
  finishA();
  await pending;
  assert.deepEqual(shown, [b]);
  await assert.rejects(client.validate(a, c), { code: "invalid_response" });
});

test("descarta busca atrasada ao trocar de projeto e rejeita prévia de outro trecho", async () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const contextId = "c".repeat(64);
  const sha256 = "d".repeat(64);
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  const client = createDesktopClient(
    async (command, { id, projectId, path }) => {
      const envelope = { version: protocolVersion, id, ok: true };
      if (command === "context_source_preview")
        return {
          ...envelope,
          operation: "context.sourcePreview",
          data: {
            projectId,
            contextId,
            path,
            sha256,
            chunk: 1,
            firstLine: 1,
            lastLine: 1,
            splitLine: false,
            text: "Outro trecho",
          },
        };
      assert.equal(command, "context_search");
      if (projectId === a) await promise;
      return {
        ...envelope,
        operation: "context.search",
        data: {
          projectId,
          scope: "history",
          contextId: null,
          snapshot: null,
          eligible: 0,
          indexed: 0,
          items: [],
          nextOffset: null,
        },
      };
    },
  ).context;
  const search = createLatestRequest();
  const input = {
    scope: "history",
    contextId: null,
    query: "alvo",
    offset: 0,
  } as const;
  const rendered: string[] = [];
  const render = (data: { projectId: string }) => rendered.push(data.projectId);
  const fail = () => assert.fail("busca inesperada");
  const pending = search.run(() => client.search(a, input), render, fail);
  search.invalidate();
  await search.run(() => client.search(b, input), render, fail);
  resolve();
  await pending;
  assert.deepEqual(rendered, [b]);
  await assert.rejects(
    client.preview(b, { contextId, sha256, path: "a.ts", chunk: 0 }),
    {
      code: "invalid_response",
    },
  );
});
