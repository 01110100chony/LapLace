import assert from "node:assert/strict";
import { test } from "node:test";
import { protocolVersion, type ContextHistory } from "@laplace/contracts";
import { createDesktopClient, DesktopError, errorMessage } from "../src/ipc.ts";
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

test("F1-T10.A1 e F1-T11: valida desktop.identity, desktop.resume e desktop.decisions e rejeita escopo/correlação incorretos", async () => {
  const legacyProjectId = "1".repeat(64);
  const scope = {
    projectId: "a".repeat(64),
    bindingId: "b".repeat(64),
    worktreeId: "c".repeat(64),
  };
  const wrongBinding = "d".repeat(64);
  const contextId = "e".repeat(64);
  const sha256 = "f".repeat(64);
  const assertionId = "2".repeat(64);
  const revisionId = "3".repeat(64);
  const tombstoneId = "4".repeat(64);
  const now = "2026-11-22T06:00:00.000Z";

  const verifiedEvidence = {
    state: "verified",
    coverage: "partial",
    durability: "durable_blob",
    sourceOrigin: "context_search",
    capturedAt: now,
    excerptDigest: sha256,
    ref: {
      projectId: scope.projectId,
      contextId,
      path: "src/retomada.ts",
      sha256,
      chunk: 0,
    },
    gap: null,
  };
  const decision = {
    assertionId,
    revisionId,
    revision: 1,
    projectId: scope.projectId,
    content: "Decisão F1 validada no renderer IPC.",
    author: "Operador",
    authority: "human_local",
    visibility: "local_only",
    status: "active",
    effectiveAt: now,
    recordedAt: now,
    sourceOrigin: "human_decision",
    evidence: verifiedEvidence,
  };

  let injectWrongScope = false;
  let injectWrongCorrelation = false;

  const client = createDesktopClient(async (command, args) => {
    assert.equal(command, "resume_request");
    const id = args.id as string;
    const req = args.request as Record<string, unknown>;
    const op = req.operation as string;
    const returnedScope = injectWrongScope
      ? { ...scope, bindingId: wrongBinding }
      : scope;

    if (op === "project.identity") {
      return {
        version: protocolVersion,
        id,
        ok: true,
        operation: op,
        data: {
          scope: returnedScope,
          legacyProjectId,
          root: "C:\\Repos\\A",
          verification: "verified",
          requiresConfirmation: false,
          worktrees: [],
          candidates: [],
        },
      };
    }
    if (op === "project.resume") {
      return {
        version: protocolVersion,
        id,
        ok: true,
        operation: op,
        data: {
          scope: returnedScope,
          projectName: "Projeto A",
          root: "C:\\Repos\\A",
          verification: "verified",
          computedAt: now,
          correlationId: injectWrongCorrelation
            ? "wrong-corr"
            : req.correlationId,
          observation: {
            state: "fresh",
            observation: {
              branch: "main",
              head: null,
              changes: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
              observedAt: now,
              source: "git.status",
              summaryVersion: 1,
            },
            attemptedAt: now,
            gap: null,
          },
          memory: { state: "available", decision, conflicts: [] },
          activity: { lastCapture: null, lastExecution: null },
          nextAction: {
            advisory: true,
            kind: "continue_from_decision",
            label: "Retomar",
            rationale: "Decisão ativa",
            blockedByConflict: false,
          },
        },
      };
    }
    if (op === "decision.record") {
      return {
        version: protocolVersion,
        id,
        ok: true,
        operation: op,
        data: decision,
      };
    }
    if (op === "decision.evidenceResolve") {
      return {
        version: protocolVersion,
        id,
        ok: true,
        operation: op,
        data: {
          scope: returnedScope,
          evidence: verifiedEvidence,
          excerpt: {
            firstLine: 1,
            lastLine: 1,
            splitLine: false,
            text: "export const ok = true;\n",
            bytesLength: 24,
            sha256,
          },
          snapshotStatus: "partial",
          omittedPaths: [],
          reindexedPreserved: true,
        },
      };
    }
    if (op === "decision.comparePresent") {
      return {
        version: protocolVersion,
        id,
        ok: true,
        operation: op,
        data: {
          scope: returnedScope,
          historical: {
            scope: returnedScope,
            evidence: verifiedEvidence,
            excerpt: {
              firstLine: 1,
              lastLine: 1,
              splitLine: false,
              text: "export const ok = true;\n",
              bytesLength: 24,
              sha256,
            },
            snapshotStatus: "partial",
            omittedPaths: [],
            reindexedPreserved: true,
          },
          present: {
            state: "available",
            origin: "working_tree",
            checkedAt: now,
            path: "src/retomada.ts",
            sha256,
            text: "export const ok = true;\n",
          },
          comparison: "matches",
        },
      };
    }
    if (op === "decision.purge") {
      return {
        version: protocolVersion,
        id,
        ok: true,
        operation: op,
        data: {
          scope: returnedScope,
          assertionId,
          purgedRevision: 1,
          status: "purged",
          purgedAt: now,
          removed: { revisions: 1, evidenceLinks: 1, cacheEntriesCleared: 0 },
          preservedSharedBlobs: true,
          tombstoneId,
          scopeBoundary: "f1_local_decisions_only",
        },
      };
    }
    assert.fail(`unexpected op: ${op}`);
  });

  const idRes = await client.identity(legacyProjectId);
  assert.deepEqual(idRes.scope, scope);

  const resumeRes = await client.resume(scope, "corr-42");
  assert.equal(resumeRes.correlationId, "corr-42");

  const recorded = await client.decisions.record({
    ...scope,
    requestId: "req-dec-1",
    assertionId: null,
    expectedRevision: 0,
    content: decision.content,
    author: decision.author,
    reason: "Registro",
    humanConfirmed: true,
    evidence: { contextId, path: "src/retomada.ts", sha256, chunk: 0 },
  });
  assert.equal(recorded.assertionId, assertionId);

  const resolved = await client.decisions.evidenceResolve(scope, {
    contextId,
    path: "src/retomada.ts",
    sha256,
    chunk: 0,
  });
  assert.equal(resolved.evidence.state, "verified");

  const compared = await client.decisions.comparePresent(scope, {
    contextId,
    path: "src/retomada.ts",
    sha256,
    chunk: 0,
  });
  assert.equal(compared.comparison, "matches");

  const purged = await client.decisions.purge({
    ...scope,
    assertionId,
    expectedRevision: 1,
    confirmedScope: true,
    reason: "Expurgo UI",
  });
  assert.equal(purged.status, "purged");

  injectWrongScope = true;
  await assert.rejects(client.resume(scope, "corr-42"), {
    code: "invalid_response",
  });
  injectWrongScope = false;

  injectWrongCorrelation = true;
  await assert.rejects(client.resume(scope, "corr-42"), {
    code: "invalid_response",
  });
});

test("F2-T04 / F2-T10: desktop.compiler valida operações compiler.* e rejeita escopo cruzado", async () => {
  const scope = {
    projectId: "a".repeat(64),
    bindingId: "b".repeat(64),
    worktreeId: "c".repeat(64),
  };
  const wrongScope = { ...scope, worktreeId: "9".repeat(64) };
  const manifestDigest = "e".repeat(64);
  const contentDigest = "d".repeat(64);
  const opaqueRef = `ref-${"1".repeat(16)}`;
  const now = "2026-11-23T06:00:00.000Z";
  let returnWrongScope = false;

  const item = {
    opaqueRef,
    ordinal: 0,
    kind: "decision",
    tier: "invariant_canonical",
    mandatory: true,
    version: "rev-1",
    contentDigest,
    bytes: 18,
    rationale: "Decisão canônica.",
    anchor: {
      kind: "decision",
      assertionId: "2".repeat(64),
      revisionId: "3".repeat(64),
      revision: 1,
    },
  };
  const publicManifest = {
    schemaVersion: 1,
    scope,
    objective: "Validar cliente desktop F2",
    destinationId: "codex_mock",
    policyVersion: "f2-policy-v1",
    strategyVersion: "f2-deterministic-v1",
    status: "ready",
    recommendationSuspended: false,
    suspensionReason: null,
    budget: {
      limitBytes: 4096,
      mandatoryBytes: 18,
      selectedBytes: 18,
      remainingBytes: 4078,
      estimatedTokens: 5,
      exceededByBytes: 0,
    },
    items: [item],
    conflicts: [],
    omissions: [],
    manifestDigest,
  };

  const client = createDesktopClient(async (command, args) => {
    assert.equal(command, "compiler_request");
    const id = args.id as string;
    const req = args.request as Record<string, unknown>;
    const op = req.operation as string;
    const responseScope = returnWrongScope ? wrongScope : scope;

    if (op === "compiler.compile") {
      return {
        version: protocolVersion,
        id,
        ok: true,
        operation: op,
        data: {
          scope: responseScope,
          compiledAt: now,
          destination: {
            id: "codex_mock",
            label: "Codex Mock",
            known: true,
            executionMode: "mock_development",
            deliveryAllowed: true,
            allowsLocalOnly: false,
            blockReason: null,
          },
          manifestDigest,
          publicManifest: { ...publicManifest, scope: responseScope },
          localItems: [
            {
              ...item,
              candidateId: "cand-1",
              title: "Invariante",
              visibility: "canonical_verified",
              capturedAt: now,
            },
          ],
          localOmissions: [],
          mandatoryOverflowItems: [],
        },
      };
    }

    if (op === "compiler.grantIssue" || op === "compiler.grantRevoke") {
      return {
        version: protocolVersion,
        id,
        ok: true,
        operation: op,
        data: {
          grantId: "grant-1",
          sessionId: "session-1",
          scope: responseScope,
          manifestDigest,
          policyVersion: "f2-policy-v1",
          destinationId: "codex_mock",
          allowedOperations: ["summary", "search", "read", "package", "query"],
          issuedAt: now,
          expiresAt: "2026-11-23T06:05:00.000Z",
          revokedAt: op === "compiler.grantRevoke" ? now : null,
          revokeReason: op === "compiler.grantRevoke" ? "Teste" : null,
          status: op === "compiler.grantRevoke" ? "revoked" : "active",
        },
      };
    }

    if (op === "compiler.grantList") {
      return {
        version: protocolVersion,
        id,
        ok: true,
        operation: op,
        data: { scope: responseScope, items: [] },
      };
    }

    if (op === "compiler.auditList") {
      return {
        version: protocolVersion,
        id,
        ok: true,
        operation: op,
        data: { scope: responseScope, items: [] },
      };
    }

    assert.fail(`unexpected op: ${op}`);
  });

  const compiled = await client.compiler.compile({
    ...scope,
    objective: "Validar cliente desktop F2",
    destinationId: "codex_mock",
    budgetBytes: 4096,
  });
  assert.equal(compiled.manifestDigest, manifestDigest);

  const grant = await client.compiler.grantIssue({
    ...scope,
    sessionId: "session-1",
    manifestDigest,
    policyVersion: "f2-policy-v1",
    destinationId: "codex_mock",
    allowedOperations: ["summary", "search", "read", "package", "query"],
    humanConfirmed: true,
  });
  assert.equal(grant.status, "active");

  const revoked = await client.compiler.grantRevoke({
    ...scope,
    grantId: grant.grantId,
    reason: "Teste",
  });
  assert.equal(revoked.status, "revoked");

  assert.equal((await client.compiler.grantList(scope)).items.length, 0);
  assert.equal((await client.compiler.auditList(scope)).items.length, 0);

  returnWrongScope = true;
  await assert.rejects(
    client.compiler.compile({
      ...scope,
      objective: "Validar cliente desktop F2",
      destinationId: "codex_mock",
      budgetBytes: 4096,
    }),
    { code: "invalid_response" },
  );
});

test("encapsula operações F3 (memory.*) em memory_request e valida escopo e erros PT-BR", async () => {
  const { errorMessage, DesktopError } = await import("../src/ipc.ts");
  const scope = {
    projectId: "1".repeat(64),
    bindingId: "2".repeat(64),
    worktreeId: "3".repeat(64),
  };
  let corruptScope = false;

  const client = createDesktopClient(async (command, args) => {
    assert.equal(command, "memory_request");
    const req = args.request as Record<string, unknown>;
    const op = req.operation as string;
    const respScope = corruptScope
      ? { ...scope, worktreeId: "9".repeat(64) }
      : scope;

    if (op === "memory.pinList") {
      return {
        version: protocolVersion,
        id: args.id,
        ok: true,
        operation: op,
        data: { scope: respScope, quotaBytes: 65536, usedBytes: 0, items: [] },
      };
    }
    if (op === "memory.overlayVerify") {
      return {
        version: protocolVersion,
        id: args.id,
        ok: true,
        operation: op,
        data: {
          scope: respScope,
          overlayId: "ov-1",
          intact: true,
          manifestDigest: "a".repeat(64),
          checkedBlobs: 1,
          missingBlobs: [],
          mismatchedPaths: [],
        },
      };
    }
    assert.fail(`unexpected op: ${op}`);
  });

  const list = await client.memory.pinList(scope);
  assert.equal(list.quotaBytes, 65536);

  const verified = await client.memory.overlayVerify({
    ...scope,
    overlayId: "ov-1",
  });
  assert.equal(verified.intact, true);

  corruptScope = true;
  await assert.rejects(client.memory.pinList(scope), {
    code: "invalid_response",
  });

  assert.match(errorMessage(new DesktopError("overlay_race_detected")), /OCC/);
  assert.match(
    errorMessage(new DesktopError("pin_protected")),
    /última prova ativa/,
  );
});

test("roteia operacoes planner.* pelo comando planner_request e rejeita resposta cross-scope", async () => {
  const scope = {
    projectId: "a".repeat(64),
    bindingId: "1".repeat(64),
    worktreeId: "2".repeat(64),
  };
  let corruptScope = false;

  const client = createDesktopClient(async (command, args) => {
    assert.equal(command, "planner_request");
    const req = args.request as Record<string, unknown>;
    const op = req.operation as string;
    const respScope = corruptScope
      ? { ...scope, worktreeId: "9".repeat(64) }
      : scope;

    if (op === "planner.boundaryStatus") {
      return {
        version: protocolVersion,
        id: args.id,
        ok: true,
        operation: op,
        data: {
          scope: respScope,
          checkedAt: "2026-11-23T12:00:00.000Z",
          lpacVerified: false,
          lpacDetail: "0xc0000142",
          strictBackendAllowed: false,
          supervisionHelperAvailable: true,
          backends: [
            {
              mode: "mock_supervised",
              available: true,
              verified: true,
              blockedReason: null,
            },
          ],
        },
      };
    }
    if (op === "planner.planList") {
      return {
        version: protocolVersion,
        id: args.id,
        ok: true,
        operation: op,
        data: { scope: respScope, items: [] },
      };
    }
    assert.fail(`unexpected op: ${op}`);
  });

  const boundary = await client.planner.boundaryStatus(scope);
  assert.equal(boundary.lpacVerified, false);

  corruptScope = true;
  await assert.rejects(client.planner.planList(scope), {
    code: "invalid_response",
  });

  assert.match(
    errorMessage(new DesktopError("execution_backend_blocked")),
    /LPAC/,
  );
  assert.match(
    errorMessage(new DesktopError("verifier_approval_invalid")),
    /revogada automaticamente/,
  );
});
