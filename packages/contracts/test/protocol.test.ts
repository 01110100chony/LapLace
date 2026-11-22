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

test("o IPC de contexto limita caminhos e seleção e rejeita cursores inválidos", () => {
  const projectId = "a".repeat(64);
  const request = {
    ...envelope,
    operation: "context.capture",
    projectId,
    paths: ["Pasta/ação.txt"],
  };
  assert.deepEqual(parseRequest(request), request);
  for (const paths of [
    [],
    ["."],
    ["a/../b"],
    ["a/./b"],
    ["a//b"],
    ["/a"],
    ["a\\b"],
    ["C:/a"],
    ["a:stream"],
    ["a\0b"],
    ["a."],
    ["NUL.txt"],
    ["é".repeat(193)],
    ["dup.txt", "dup.txt"],
    Array.from({ length: 33 }, (_, i) => `${i}.txt`),
  ])
    assert.equal(parseRequest({ ...request, paths }), undefined);
  assert.equal(
    parseRequest({
      ...envelope,
      operation: "context.list",
      projectId,
      before: "anything",
    }),
    undefined,
  );
});

test("F1-T02.A1: valida project.identity e project.resume em fresh, cached, unavailable e empty e rejeita escopo trocado ou camadas inconsistentes", () => {
  const scope = {
    projectId: "a".repeat(64),
    bindingId: "b".repeat(64),
    worktreeId: "c".repeat(64),
  };
  const otherProjectId = "d".repeat(64);
  const digest = "e".repeat(64);
  const contextId = "f".repeat(64);

  const identityReq = {
    ...envelope,
    operation: "project.identity",
    projectId: scope.projectId,
    path: "C:\\Repos\\ProjetoA",
  };
  assert.deepEqual(parseRequest(identityReq), identityReq);
  assert.equal(
    parseRequest({
      ...identityReq,
      path: "C:\\Repos\\ProjetoA\0",
    }),
    undefined,
  );

  const resumeReq = {
    ...envelope,
    operation: "project.resume",
    ...scope,
    correlationId: "req-1",
  };
  assert.deepEqual(parseRequest(resumeReq), resumeReq);
  assert.equal(
    parseRequest({
      ...envelope,
      operation: "project.resume",
      projectId: scope.projectId,
      bindingId: scope.bindingId,
    }),
    undefined,
  );

  const baseActivity = {
    lastCapture: {
      contextId,
      projectId: scope.projectId,
      head: null,
      completedAt: "2026-11-22T05:00:00.000Z",
      status: "partial",
      included: 1,
      omitted: 1,
    },
    lastExecution: {
      taskId: "task-1",
      executionId: "exec-1",
      projectId: scope.projectId,
      mode: "mock_development",
      state: "completed",
      recordedAt: "2026-11-22T05:05:00.000Z",
      reviewChoice: "approved",
      isLegacyAttemptNote: true,
    },
  };

  const freshData = {
    scope,
    projectName: "Projeto A",
    root: "C:\\Repos\\ProjetoA",
    verification: "verified",
    computedAt: "2026-11-22T06:00:00.000Z",
    correlationId: "req-1",
    observation: {
      state: "fresh",
      observation: {
        branch: "main",
        head: "1".repeat(40),
        changes: { staged: 0, unstaged: 1, untracked: 0, conflicted: 0 },
        observedAt: "2026-11-22T06:00:00.000Z",
        source: "git.status",
        summaryVersion: 1,
      },
      attemptedAt: "2026-11-22T06:00:00.000Z",
      gap: null,
    },
    memory: {
      state: "available",
      decision: {
        assertionId: "1".repeat(64),
        revisionId: "2".repeat(64),
        revision: 1,
        projectId: scope.projectId,
        content: "Manter contrato de retomada compatível com SQLite v10.",
        author: "Operador Local",
        authority: "human_local",
        visibility: "local_only",
        status: "active",
        effectiveAt: "2026-11-22T05:30:00.000Z",
        recordedAt: "2026-11-22T05:30:00.000Z",
        sourceOrigin: "human_decision",
        evidence: {
          state: "verified",
          coverage: "partial",
          durability: "durable_blob",
          sourceOrigin: "context_capture",
          capturedAt: "2026-11-22T05:00:00.000Z",
          excerptDigest: digest,
          ref: {
            projectId: scope.projectId,
            contextId,
            path: "src/index.ts",
            sha256: digest,
            chunk: 0,
            omittedReasons: ["too_large"],
          },
          gap: null,
        },
      },
      conflicts: [],
    },
    activity: baseActivity,
    nextAction: {
      advisory: true,
      kind: "continue_from_decision",
      label: "Revisar alterações locais",
      rationale: "Decisão vigente e 1 alteração pendente.",
      blockedByConflict: false,
    },
  };
  assert.ok(
    isResponse(
      { ...envelope, ok: true, operation: "project.resume", data: freshData },
      envelope.id,
      "project.resume",
    ),
  );

  // Cached with HEAD nulo + empty memory (coexisting independent dimensions)
  const cachedNullHead = {
    ...freshData,
    observation: {
      state: "cached",
      observation: {
        branch: "main",
        head: null,
        changes: { staged: 0, unstaged: 0, untracked: 1, conflicted: 0 },
        observedAt: "2026-11-22T04:00:00.000Z",
        source: "git.status",
        summaryVersion: 1,
      },
      attemptedAt: "2026-11-22T06:00:00.000Z",
      gap: "folder_unavailable",
    },
    memory: {
      state: "empty",
      decision: null,
      conflicts: [],
    },
  };
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "project.resume",
        data: cachedNullHead,
      },
      envelope.id,
      "project.resume",
    ),
  );

  // Unavailable observation (observedAt is absent via observation: null) + evidence gap
  const unavailableWithGap = {
    ...freshData,
    observation: {
      state: "unavailable",
      observation: null,
      attemptedAt: "2026-11-22T06:00:00.000Z",
      gap: "folder_unavailable",
    },
    memory: {
      ...freshData.memory,
      decision: {
        ...freshData.memory.decision,
        evidence: {
          state: "gap",
          coverage: "none",
          durability: "missing_blob",
          sourceOrigin: "context_capture",
          capturedAt: "2026-11-22T05:00:00.000Z",
          excerptDigest: null,
          ref: null,
          gap: "source_unavailable",
        },
      },
      conflicts: [
        {
          kind: "git_unavailable",
          blocking: true,
          summary: "Checkout indisponível no disco.",
          detectedAt: "2026-11-22T06:00:00.000Z",
        },
      ],
    },
    nextAction: {
      advisory: true,
      kind: "relocate_project",
      label: "Localizar pasta do projeto",
      rationale: "Sem leitura Git recente.",
      blockedByConflict: true,
    },
  };
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "project.resume",
        data: unavailableWithGap,
      },
      envelope.id,
      "project.resume",
    ),
  );

  // Rejections: swapped scope, fabricated cached time, and inconsistent layers
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "project.resume",
        data: {
          ...freshData,
          memory: {
            ...freshData.memory,
            decision: {
              ...freshData.memory.decision,
              projectId: otherProjectId,
            },
          },
        },
      },
      envelope.id,
      "project.resume",
    ),
  );
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "project.resume",
        data: {
          ...freshData,
          observation: {
            ...freshData.observation,
            gap: "folder_unavailable",
          },
        },
      },
      envelope.id,
      "project.resume",
    ),
  );
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "project.resume",
        data: {
          ...cachedNullHead,
          observation: {
            ...cachedNullHead.observation,
            observation: {
              ...cachedNullHead.observation.observation,
              observedAt: "2026-11-22T07:00:00.000Z",
            },
          },
        },
      },
      envelope.id,
      "project.resume",
    ),
  );
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "project.resume",
        data: {
          ...freshData,
          memory: {
            state: "empty",
            decision: freshData.memory.decision,
            conflicts: [],
          },
        },
      },
      envelope.id,
      "project.resume",
    ),
  );
});

test("F1-M04: valida contratos decision.* (evidenceResolve, record, list, get, purge) e rejeita escopo trocado ou payload inconsistente", () => {
  const scope = {
    projectId: "a".repeat(64),
    bindingId: "b".repeat(64),
    worktreeId: "c".repeat(64),
  };
  const otherProjectId = "d".repeat(64);
  const contextId = "e".repeat(64);
  const sha = "f".repeat(64);
  const assertionId = "1".repeat(64);
  const revisionId = "2".repeat(64);
  const tombstoneId = "3".repeat(64);

  const evidenceReq = {
    ...envelope,
    operation: "decision.evidenceResolve",
    ...scope,
    contextId,
    path: "src/retomada.ts",
    sha256: sha,
    chunk: 0,
  };
  assert.deepEqual(parseRequest(evidenceReq), evidenceReq);
  assert.equal(parseRequest({ ...evidenceReq, path: "../fora.ts" }), undefined);

  // humanConfirmed: false must pass parser so service returns decision_authorization_required.
  const recordReq = {
    ...envelope,
    operation: "decision.record",
    ...scope,
    requestId: "dec-1",
    assertionId: null,
    expectedRevision: 0,
    content: "Manter contrato compatível offline.",
    author: "Operador Local",
    reason: "Registro inicial da F1.",
    humanConfirmed: false,
    promoteCanonical: false,
    evidence: {
      contextId,
      path: "src/retomada.ts",
      sha256: sha,
      chunk: 0,
    },
  };
  assert.deepEqual(parseRequest(recordReq), recordReq);
  assert.equal(
    parseRequest({ ...recordReq, content: "texto\0invalido" }),
    undefined,
  );

  const listReq = { ...envelope, operation: "decision.list", ...scope };
  assert.deepEqual(parseRequest(listReq), listReq);

  const getReq = {
    ...envelope,
    operation: "decision.get",
    ...scope,
    assertionId,
  };
  assert.deepEqual(parseRequest(getReq), getReq);

  // confirmedScope: false must pass parser so service returns decision_authorization_required.
  const purgeReq = {
    ...envelope,
    operation: "decision.purge",
    ...scope,
    assertionId,
    expectedRevision: 1,
    confirmedScope: false,
    reason: "Expurgo sintético",
  };
  assert.deepEqual(parseRequest(purgeReq), purgeReq);
  assert.equal(parseRequest({ ...purgeReq, expectedRevision: 0 }), undefined);

  const verifiedEvidence = {
    state: "verified",
    coverage: "partial",
    durability: "durable_blob",
    sourceOrigin: "context_search",
    capturedAt: "2026-11-22T05:00:00.000Z",
    excerptDigest: sha,
    ref: {
      projectId: scope.projectId,
      contextId,
      path: "src/retomada.ts",
      sha256: sha,
      chunk: 0,
      omittedReasons: ["excluded"],
    },
    gap: null,
  };
  const validResolved = {
    scope,
    evidence: verifiedEvidence,
    excerpt: {
      firstLine: 1,
      lastLine: 3,
      splitLine: false,
      text: "export const ok = true;\n",
      bytesLength: 24,
      sha256: sha,
    },
    snapshotStatus: "partial",
    omittedPaths: [{ path: "dist/gerado.txt", reason: "excluded" }],
    reindexedPreserved: true,
  };
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "decision.evidenceResolve",
        data: validResolved,
      },
      envelope.id,
      "decision.evidenceResolve",
    ),
  );
  // Inconsistent verified evidence with null excerpt must be rejected.
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "decision.evidenceResolve",
        data: { ...validResolved, excerpt: null },
      },
      envelope.id,
      "decision.evidenceResolve",
    ),
  );

  const decision = {
    assertionId,
    revisionId,
    revision: 1,
    projectId: scope.projectId,
    content: "Manter contrato compatível offline.",
    author: "Operador Local",
    authority: "human_local",
    visibility: "local_only",
    status: "active",
    effectiveAt: "2026-11-22T05:10:00.000Z",
    recordedAt: "2026-11-22T05:10:00.000Z",
    sourceOrigin: "human_decision",
    evidence: verifiedEvidence,
  };
  assert.ok(
    isResponse(
      { ...envelope, ok: true, operation: "decision.record", data: decision },
      envelope.id,
      "decision.record",
    ),
  );
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "decision.list",
        data: { scope, active: decision, items: [decision] },
      },
      envelope.id,
      "decision.list",
    ),
  );
  // Swapped projectId inside decision.list must be rejected.
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "decision.list",
        data: {
          scope,
          active: null,
          items: [{ ...decision, projectId: otherProjectId }],
        },
      },
      envelope.id,
      "decision.list",
    ),
  );
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "decision.get",
        data: { scope, assertionId, revisions: [decision] },
      },
      envelope.id,
      "decision.get",
    ),
  );
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "decision.purge",
        data: {
          scope,
          assertionId,
          purgedRevision: 1,
          status: "purged",
          purgedAt: "2026-11-22T05:20:00.000Z",
          removed: { revisions: 1, evidenceLinks: 1, cacheEntriesCleared: 0 },
          preservedSharedBlobs: true,
          tombstoneId,
          scopeBoundary: "f1_local_decisions_only",
        },
      },
      envelope.id,
      "decision.purge",
    ),
  );

  const compareReq = {
    ...envelope,
    operation: "decision.comparePresent",
    ...scope,
    contextId,
    path: "src/retomada.ts",
    sha256: sha,
    chunk: 0,
  };
  assert.deepEqual(parseRequest(compareReq), compareReq);
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "decision.comparePresent",
        data: {
          scope,
          historical: validResolved,
          present: {
            state: "available",
            origin: "working_tree",
            checkedAt: "2026-11-22T06:00:00.000Z",
            path: "src/retomada.ts",
            sha256: sha,
            text: "export const ok = true;\n",
          },
          comparison: "matches",
        },
      },
      envelope.id,
      "decision.comparePresent",
    ),
  );
  // Gap historical evidence must never report present.state === "available".
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "decision.comparePresent",
        data: {
          scope,
          historical: {
            ...validResolved,
            evidence: {
              state: "gap",
              coverage: "none",
              durability: "missing_blob",
              sourceOrigin: "context_capture",
              capturedAt: null,
              excerptDigest: null,
              ref: null,
              gap: "source_unavailable",
            },
            excerpt: null,
          },
          present: {
            state: "available",
            origin: "working_tree",
            checkedAt: "2026-11-22T06:00:00.000Z",
            path: "src/retomada.ts",
            sha256: sha,
            text: "export const ok = true;\n",
          },
          comparison: "matches",
        },
      },
      envelope.id,
      "decision.comparePresent",
    ),
  );
});
