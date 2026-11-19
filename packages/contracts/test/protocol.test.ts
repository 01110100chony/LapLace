import assert from "node:assert/strict";
import { test } from "node:test";
import { isResponse, parseRequest, protocolVersion } from "../src/index.ts";

const envelope = { version: protocolVersion, id: "distribution-smoke" };

test("o pedido de importação conserva o caminho Unicode e rejeita NUL e versão antiga", () => {
  const request = {
    ...envelope,
    operation: "workspace.addLocal",
    path: "C:\\Projetos\\São João",
  };
  assert.deepEqual(parseRequest(request), request);
  assert.equal(
    parseRequest({ ...request, path: request.path + "\0" }),
    undefined,
  );
  assert.equal(parseRequest({ ...request, version: 1 }), undefined);
});

test("a resposta do catálogo deve corresponder ao pedido e referenciar um projeto listado", () => {
  const response = {
    ...envelope,
    ok: true,
    operation: "workspace.list",
    data: { projects: [], selectedProjectId: null },
  };
  assert.ok(isResponse(response, envelope.id, "workspace.list"));
  assert.ok(!isResponse(response, "late-request", "workspace.list"));
  assert.ok(!isResponse(response, envelope.id, "health"));
  assert.ok(
    !isResponse(
      {
        ...response,
        data: { ...response.data, selectedProjectId: "f".repeat(64) },
      },
      envelope.id,
      "workspace.list",
    ),
  );
});
