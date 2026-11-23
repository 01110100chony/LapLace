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

test("F2-T01.A1: valida todas as 10 operações compiler.* e rejeita escopo trocado, opaqueRef inválido e invariantes inconsistentes", () => {
  const scope = {
    projectId: "a".repeat(64),
    bindingId: "b".repeat(64),
    worktreeId: "c".repeat(64),
  };
  const otherScope = {
    ...scope,
    bindingId: "9".repeat(64),
  };
  const digest = "d".repeat(64);
  const manifestDigest = "e".repeat(64);
  const packageDigest = "f".repeat(64);
  const now = "2026-11-23T05:00:00.000Z";
  const opaqueRef = `ref-${"1".repeat(16)}`;
  const itemText = "Manter invariante de contrato F2.";

  const compileReq = {
    ...envelope,
    operation: "compiler.compile",
    ...scope,
    objective: "Explicar contrato do compilador.",
    destinationId: "codex_mock",
    budgetBytes: 4096,
    policyVersion: "f2-policy-v1",
    strategyVersion: "f2-deterministic-v1",
  };
  assert.deepEqual(parseRequest(compileReq), compileReq);
  assert.equal(parseRequest({ ...compileReq, budgetBytes: 128 }), undefined);
  assert.equal(parseRequest({ ...compileReq, objective: "   " }), undefined);

  const grantIssueReq = {
    ...envelope,
    operation: "compiler.grantIssue",
    ...scope,
    sessionId: "session-1",
    manifestDigest,
    policyVersion: "f2-policy-v1",
    destinationId: "codex_mock",
    allowedOperations: ["summary", "search", "read", "package", "query"],
    ttlMs: 60_000,
    humanConfirmed: false,
  };
  assert.deepEqual(parseRequest(grantIssueReq), grantIssueReq);
  assert.equal(
    parseRequest({ ...grantIssueReq, allowedOperations: [] }),
    undefined,
  );

  const grantListReq = {
    ...envelope,
    operation: "compiler.grantList",
    ...scope,
  };
  assert.deepEqual(parseRequest(grantListReq), grantListReq);

  const grantRevokeReq = {
    ...envelope,
    operation: "compiler.grantRevoke",
    ...scope,
    grantId: "grant-1",
    reason: "Revogado em teste",
  };
  assert.deepEqual(parseRequest(grantRevokeReq), grantRevokeReq);

  const packageExportReq = {
    ...envelope,
    operation: "compiler.packageExport",
    ...scope,
    grantId: "grant-1",
    sessionId: "session-1",
    manifestDigest,
    policyVersion: "f2-policy-v1",
    destinationId: "codex_mock",
    includeHandoff: true,
  };
  assert.deepEqual(parseRequest(packageExportReq), packageExportReq);

  const mcpCallReq = {
    ...envelope,
    operation: "compiler.mcpCall",
    ...scope,
    grantId: "grant-1",
    sessionId: "session-1",
    manifestDigest,
    policyVersion: "f2-policy-v1",
    destinationId: "codex_mock",
    method: "read",
    opaqueRef,
  };
  assert.deepEqual(parseRequest(mcpCallReq), mcpCallReq);

  const queryRunReq = {
    ...envelope,
    operation: "compiler.queryRun",
    ...scope,
    grantId: "grant-1",
    sessionId: "session-1",
    manifestDigest,
    policyVersion: "f2-policy-v1",
    destinationId: "codex_mock",
    channel: "mcp_stdio",
    mode: "mock_development",
  };
  assert.deepEqual(parseRequest(queryRunReq), queryRunReq);

  const auditListReq = {
    ...envelope,
    operation: "compiler.auditList",
    ...scope,
  };
  assert.deepEqual(parseRequest(auditListReq), auditListReq);

  const auditReviewReq = {
    ...envelope,
    operation: "compiler.auditReview",
    ...scope,
    auditId: "audit-1",
    status: "approved",
    reviewer: "Autor Local",
    note: "Citações conferidas",
    humanConfirmed: true,
  };
  assert.deepEqual(parseRequest(auditReviewReq), auditReviewReq);

  const publicItem = {
    opaqueRef,
    ordinal: 0,
    kind: "decision",
    tier: "invariant_canonical",
    mandatory: true,
    version: "1",
    contentDigest: digest,
    bytes: Buffer.byteLength(itemText),
    rationale: "Decisão canônica obrigatória.",
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
    objective: compileReq.objective,
    destinationId: "codex_mock",
    policyVersion: "f2-policy-v1",
    strategyVersion: "f2-deterministic-v1",
    status: "ready",
    recommendationSuspended: false,
    suspensionReason: null,
    budget: {
      limitBytes: 4096,
      mandatoryBytes: Buffer.byteLength(itemText),
      selectedBytes: Buffer.byteLength(itemText),
      remainingBytes: 4096 - Buffer.byteLength(itemText),
      estimatedTokens: 9,
      exceededByBytes: 0,
    },
    items: [publicItem],
    conflicts: [],
    omissions: [],
    manifestDigest,
  };
  const preview = {
    scope,
    compiledAt: now,
    destination: {
      id: "codex_mock",
      label: "Mock local de desenvolvimento",
      known: true,
      executionMode: "mock_development",
      deliveryAllowed: true,
      allowsLocalOnly: false,
      blockReason: null,
    },
    manifestDigest,
    publicManifest,
    localItems: [
      {
        ...publicItem,
        candidateId: "cand-1",
        title: "Decisão canônica",
        visibility: "canonical_verified",
        capturedAt: now,
      },
    ],
    localOmissions: [],
    mandatoryOverflowItems: [],
  };
  assert.ok(
    isResponse(
      { ...envelope, ok: true, operation: "compiler.compile", data: preview },
      envelope.id,
      "compiler.compile",
    ),
  );
  // mandatory_context_exceeded with non-empty publicManifest.items must fail validation.
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "compiler.compile",
        data: {
          ...preview,
          publicManifest: {
            ...publicManifest,
            status: "mandatory_context_exceeded",
            budget: { ...publicManifest.budget, exceededByBytes: 120 },
          },
        },
      },
      envelope.id,
      "compiler.compile",
    ),
  );
  // Cross-scope nested manifest must fail validation.
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "compiler.compile",
        data: {
          ...preview,
          publicManifest: { ...publicManifest, scope: otherScope },
        },
      },
      envelope.id,
      "compiler.compile",
    ),
  );
  // Invalid opaqueRef must fail validation.
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "compiler.compile",
        data: {
          ...preview,
          publicManifest: {
            ...publicManifest,
            items: [{ ...publicItem, opaqueRef: "../secret.ts" }],
          },
        },
      },
      envelope.id,
      "compiler.compile",
    ),
  );

  const grantRecord = {
    grantId: "grant-1",
    sessionId: "session-1",
    scope,
    manifestDigest,
    policyVersion: "f2-policy-v1",
    destinationId: "codex_mock",
    allowedOperations: ["summary", "search", "read", "package", "query"],
    issuedAt: now,
    expiresAt: "2026-11-23T05:05:00.000Z",
    revokedAt: null,
    revokeReason: null,
    status: "active",
  };
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "compiler.grantIssue",
        data: grantRecord,
      },
      envelope.id,
      "compiler.grantIssue",
    ),
  );

  const pkg = {
    schemaVersion: 1,
    packageId: "pkg-1",
    createdAt: now,
    manifestDigest,
    policyVersion: "f2-policy-v1",
    strategyVersion: "f2-deterministic-v1",
    destinationId: "codex_mock",
    publicManifest,
    items: [
      {
        opaqueRef,
        version: "1",
        tier: "invariant_canonical",
        mandatory: true,
        contentDigest: digest,
        bytes: Buffer.byteLength(itemText),
        anchor: publicItem.anchor,
        text: itemText,
      },
    ],
    packageDigest,
  };
  const handoff = {
    schemaVersion: 1,
    handoffId: "handoff-1",
    createdAt: now,
    sourceProjectId: scope.projectId,
    objective: compileReq.objective,
    manifestDigest,
    policyVersion: "f2-policy-v1",
    strategyVersion: "f2-deterministic-v1",
    destinationHint: "codex_mock",
    selectedRefs: [
      {
        opaqueRef,
        version: "1",
        tier: "invariant_canonical",
        contentDigest: digest,
        bytes: Buffer.byteLength(itemText),
      },
    ],
    pendingConflicts: [],
    openQuestions: [],
    requiresReevaluation: true,
  };
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "compiler.packageExport",
        data: { scope, grantId: "grant-1", contextPackage: pkg, handoff },
      },
      envelope.id,
      "compiler.packageExport",
    ),
  );
  // Handoff without requiresReevaluation === true must be rejected.
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "compiler.packageExport",
        data: {
          scope,
          grantId: "grant-1",
          contextPackage: pkg,
          handoff: { ...handoff, requiresReevaluation: false },
        },
      },
      envelope.id,
      "compiler.packageExport",
    ),
  );

  const importReq = {
    ...envelope,
    operation: "compiler.handoffImport",
    ...scope,
    destinationId: "codex_mock",
    humanConfirmed: true,
    handoff,
  };
  assert.deepEqual(parseRequest(importReq), importReq);
  assert.equal(
    parseRequest({
      ...envelope,
      operation: "compiler.handoffImport",
      ...scope,
      destinationId: "codex_mock",
      humanConfirmed: true,
    }),
    undefined,
  );
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "compiler.handoffImport",
        data: {
          scope,
          evaluation: "accepted_requires_grant",
          requiresNewGrant: true,
          sourceProjectId: scope.projectId,
          manifestDigest,
          destination: preview.destination,
          reason: "Reavaliação aprovada; emita novo grant nesta sessão.",
          selectedRefCount: 1,
          pendingConflicts: [],
        },
      },
      envelope.id,
      "compiler.handoffImport",
    ),
  );

  const auditRecord = {
    auditId: "audit-1",
    scope,
    grantId: "grant-1",
    sessionId: "session-1",
    manifestDigest,
    policyVersion: "f2-policy-v1",
    destinationId: "codex_mock",
    channel: "mcp_stdio",
    mode: "mock_development",
    objective: compileReq.objective,
    state: "completed",
    failureCode: null,
    delivered: {
      digest: manifestDigest,
      bytes: Buffer.byteLength(itemText),
      opaqueRefs: [opaqueRef],
    },
    observability: "mcp_observed",
    observedReads: [
      {
        tool: "laplace_context_read",
        opaqueRef,
        query: null,
        cursor: null,
        outcome: "allowed",
        errorCode: null,
        at: now,
      },
    ],
    mcpAdherence: "observed",
    responseText: `Resposta referenciando [${opaqueRef}].`,
    citations: {
      declared: [
        {
          opaqueRef,
          verified: true,
          version: "1",
          contentDigest: digest,
        },
      ],
      unknown: [],
    },
    durationMs: 12,
    usage: { input: 10, cachedInput: 0, output: 5 },
    startedAt: now,
    finishedAt: now,
    review: {
      status: "approved",
      reviewer: "Autor Local",
      note: "Conferido.",
      reviewedAt: now,
    },
  };
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "compiler.queryRun",
        data: auditRecord,
      },
      envelope.id,
      "compiler.queryRun",
    ),
  );
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "compiler.auditList",
        data: { scope, items: [auditRecord] },
      },
      envelope.id,
      "compiler.auditList",
    ),
  );
});

test("F3-T01.A1: valida todas as 22 operações memory.* e rejeita intervalos invertidos e escopo cruzado", () => {
  const scope = {
    projectId: "a".repeat(64),
    bindingId: "b".repeat(64),
    worktreeId: "c".repeat(64),
  };
  const otherScope = {
    projectId: "9".repeat(64),
    bindingId: "b".repeat(64),
    worktreeId: "c".repeat(64),
  };
  const digest = "1".repeat(64);
  const ts1 = "2026-01-01T00:00:00.000Z";
  const ts2 = "2026-01-10T00:00:00.000Z";
  const envelope = { version: 2 as const, id: "req-f3-1" };

  assert.ok(
    parseRequest({
      ...envelope,
      operation: "memory.claimRecord",
      ...scope,
      requestId: "req-c1",
      title: "Claim inicial",
      content: "Usar RPC stdio.",
      author: "Autor",
      reason: "Decisão F3",
      validFrom: ts1,
      validTo: null,
      promoteCanonical: true,
    }),
  );

  // Inverted valid interval must be rejected
  assert.equal(
    parseRequest({
      ...envelope,
      operation: "memory.claimRecord",
      ...scope,
      requestId: "req-c-bad",
      title: "Invertido",
      content: "Falho.",
      author: "Autor",
      reason: "Teste",
      validFrom: ts2,
      validTo: ts1,
    }),
    undefined,
  );

  // Validate remaining 21 memory.* request shapes
  const validRequests = [
    {
      operation: "memory.claimCorrect",
      ...scope,
      requestId: "req-corr-1",
      claimId: "claim-1",
      content: "Correção parcial.",
      author: "Autor",
      reason: "Ajuste",
      correctFrom: ts1,
      correctTo: ts2,
    },
    {
      operation: "memory.relationRecord",
      ...scope,
      fromId: "claim-1",
      toId: "claim-2",
      kind: "supports",
      signalKind: "confirmed_link",
      rationale: "Sustentado por fonte.",
      author: "Autor",
    },
    {
      operation: "memory.timeline",
      ...scope,
      knownAt: ts2,
      validAt: ts1,
      signalKinds: [
        "confirmed_link",
        "objective_drift",
        "inference",
        "verifier_signal",
      ],
    },
    {
      operation: "memory.pinCreate",
      ...scope,
      label: "Pin fonte",
      source: { kind: "inline", content: "Bytes preservados no CAS." },
    },
    { operation: "memory.pinList", ...scope },
    { operation: "memory.pinVerify", ...scope, pinId: "pin-1" },
    {
      operation: "memory.pinRelease",
      ...scope,
      pinId: "pin-1",
      humanConfirmed: true,
    },
    { operation: "memory.gcRun", ...scope, humanConfirmed: true },
    {
      operation: "memory.purgeStart",
      ...scope,
      targetKind: "claim",
      targetId: "claim-1",
      reason: "Expurgo",
      humanConfirmed: true,
      maxSteps: 1,
    },
    { operation: "memory.purgeResume", ...scope, purgeId: "purge-1" },
    { operation: "memory.purgeStatus", ...scope, purgeId: "purge-1" },
    {
      operation: "memory.inboxSubmit",
      ...scope,
      title: "Proposta",
      content: "Adotar CAS.",
      targetKind: "claim",
      originLabel: "Sessão local",
    },
    { operation: "memory.inboxList", ...scope },
    {
      operation: "memory.inboxReview",
      ...scope,
      proposalId: "prop-1",
      decision: "approve",
      reviewer: "Autor",
      note: "Aprovado.",
      humanConfirmed: true,
    },
    {
      operation: "memory.exportPreview",
      ...scope,
      destinationId: "codex_mock",
      items: [
        {
          itemId: "item-1",
          title: "Nota",
          visibility: "captured_eligible",
          content: "Conteúdo seguro",
        },
      ],
    },
    {
      operation: "memory.exportExceptionGrant",
      ...scope,
      bundleDigest: digest,
      destinationId: "codex_mock",
      policyVersion: "f2-policy-v1",
      reviewer: "Autor",
      reason: "Teste",
      humanConfirmed: true,
    },
    {
      operation: "memory.exportExecute",
      ...scope,
      destinationId: "codex_mock",
      policyVersion: "f2-policy-v1",
      items: [
        {
          itemId: "item-1",
          title: "Nota",
          visibility: "captured_eligible",
          content: "Conteúdo seguro",
        },
      ],
    },
    { operation: "memory.overlayCapture", ...scope, label: "Overlay 1" },
    { operation: "memory.overlayList", ...scope },
    { operation: "memory.overlayVerify", ...scope, overlayId: "ov-1" },
    {
      operation: "memory.overlayReconstruct",
      ...scope,
      overlayId: "ov-1",
      targetDir: "C:\\temp\\restore",
      disposableTargetConfirmed: true,
    },
  ];
  for (const req of validRequests) {
    assert.ok(
      parseRequest({ ...envelope, ...req }),
      `Failed parseRequest for ${req.operation}`,
    );
  }

  // Response validation + cross-scope rejection on timeline
  const claimRev = {
    revisionId: "rev-1",
    claimId: "claim-1",
    segmentSeq: 1,
    txSeq: 1,
    content: "Usar RPC stdio.",
    author: "Autor",
    reason: "Decisão F3",
    authority: "human_promoted",
    visibility: "canonical_verified",
    conflictKey: null,
    conflictPolarity: null,
    validFrom: ts1,
    validTo: null,
    knownFrom: ts1,
    knownTo: null,
    supersedesRevisionId: null,
    evidenceRef: null,
    recordedAt: ts1,
  };
  assert.ok(
    isResponse(
      {
        ...envelope,
        ok: true,
        operation: "memory.timeline",
        data: {
          scope,
          knownAt: ts2,
          validAt: null,
          claims: [
            {
              claimId: "claim-1",
              title: "Claim",
              revision: claimRev,
              resolvedEvidence: {
                state: "none",
                source: "none",
                digest: null,
                gapReason: null,
                textPreview: null,
              },
            },
          ],
          edges: [],
          signals: [],
          conflicts: [],
        },
      },
      envelope.id,
      "memory.timeline",
    ),
  );
  assert.ok(
    !isResponse(
      {
        ...envelope,
        ok: true,
        operation: "memory.timeline",
        data: {
          scope,
          knownAt: ts2,
          validAt: null,
          claims: [],
          edges: [
            {
              relationId: "rel-cross",
              scope: otherScope,
              fromId: "c1",
              toId: "c2",
              kind: "supports",
              signalKind: "confirmed_link",
              rationale: "Cruzado",
              author: "Autor",
              knownAt: ts1,
            },
          ],
          signals: [],
          conflicts: [],
        },
      },
      envelope.id,
      "memory.timeline",
    ),
  );
});
