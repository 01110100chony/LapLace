import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ClaimRevision,
  ExportCandidateInput,
  ExportExceptionRecord,
  IdentityScope,
  RelationRecord,
  TimelineSignalEntry,
} from "@laplace/contracts";
import {
  applyPartialCorrection,
  evaluateExportGovernance,
  projectBitemporalState,
  projectKgraphTimeline,
  scanExportItems,
  sha256Hex,
} from "../src/index.ts";
import { canonicalJson } from "../src/hash.ts";

const scope: IdentityScope = {
  projectId: "a".repeat(64),
  bindingId: "b".repeat(64),
  worktreeId: "c".repeat(64),
};

const otherScope: IdentityScope = {
  projectId: "9".repeat(64),
  bindingId: "b".repeat(64),
  worktreeId: "c".repeat(64),
};

test("F3-T02.A1: correção parcial retroativa preserva K1, divide resíduos em K2 e expõe conflito bitemporal", () => {
  const k1 = "2026-02-01T10:00:00.000Z";
  const k2 = "2026-02-15T12:00:00.000Z";
  const vStart = "2026-01-01T00:00:00.000Z";
  const corrFrom = "2026-01-10T00:00:00.000Z";
  const corrTo = "2026-01-20T00:00:00.000Z";

  const initial: ClaimRevision = {
    revisionId: "rev-001",
    claimId: "claim-001",
    segmentSeq: 1,
    txSeq: 1,
    content: "Política original: usar REST síncrono.",
    author: "Autor F3",
    reason: "Registro inicial §7",
    authority: "human_promoted",
    visibility: "canonical_verified",
    conflictKey: "transport-mode",
    conflictPolarity: "require",
    validFrom: vStart,
    validTo: null,
    knownFrom: k1,
    knownTo: null,
    supersedesRevisionId: null,
    evidenceRef: null,
    recordedAt: k1,
  };

  const plan = applyPartialCorrection({
    activeRevisions: [initial],
    correctFrom: corrFrom,
    correctTo: corrTo,
    knownAt: k2,
    nextTxSeq: 2,
    nextStartSegmentSeq: 2,
    replacement: {
      content: "Correção parcial: usar RPC stdio apenas nessa janela.",
      author: "Autor F3",
      reason: "Correção retroativa parcial §7",
      evidenceRef: null,
      recordedAt: k2,
    },
  });

  assert.deepEqual(plan.closedRevisionIds, ["rev-001"]);
  assert.equal(plan.newSegments.length, 3);
  assert.deepEqual(
    plan.newSegments.map((seg) => [seg.validFrom, seg.validTo, seg.content]),
    [
      [vStart, corrFrom, initial.content],
      [
        corrFrom,
        corrTo,
        "Correção parcial: usar RPC stdio apenas nessa janela.",
      ],
      [corrTo, null, initial.content],
    ],
  );

  // Build persisted bitemporal revision table
  const closedInitial: ClaimRevision = { ...initial, knownTo: plan.knownTo };
  const replaced: ClaimRevision[] = plan.newSegments.map((seg, idx) => ({
    ...seg,
    revisionId: `rev-00${idx + 2}`,
    claimId: initial.claimId,
  }));
  const allRevisions = [closedInitial, ...replaced];

  // Querying at K1 sees untouched original truth over entire validity range
  const atK1Mid = projectBitemporalState(allRevisions, {
    knownAt: "2026-02-05T00:00:00.000Z",
    validAt: "2026-01-15T00:00:00.000Z",
  });
  assert.equal(atK1Mid.visible.length, 1);
  assert.equal(atK1Mid.visible[0]?.content, initial.content);

  // Querying at K2 inspects each interval accurately
  const atK2Left = projectBitemporalState(allRevisions, {
    knownAt: k2,
    validAt: "2026-01-05T00:00:00.000Z",
  });
  assert.equal(atK2Left.visible[0]?.content, initial.content);

  const atK2Corrected = projectBitemporalState(allRevisions, {
    knownAt: k2,
    validAt: "2026-01-15T00:00:00.000Z",
  });
  assert.equal(
    atK2Corrected.visible[0]?.content,
    "Correção parcial: usar RPC stdio apenas nessa janela.",
  );

  const atK2Right = projectBitemporalState(allRevisions, {
    knownAt: k2,
    validAt: "2026-02-01T00:00:00.000Z",
  });
  assert.equal(atK2Right.visible[0]?.content, initial.content);

  // Conflicting overlapping claim at K2 stays visible and surfaces contradiction
  const conflictingClaim: ClaimRevision = {
    revisionId: "rev-conf",
    claimId: "claim-002",
    segmentSeq: 1,
    txSeq: 3,
    content: "Conflito: proibir RPC stdio nessa janela.",
    author: "Outro Revisor",
    reason: "Divergência material",
    authority: "human_local",
    visibility: "canonical_verified",
    conflictKey: "transport-mode",
    conflictPolarity: "forbid",
    validFrom: "2026-01-12T00:00:00.000Z",
    validTo: "2026-01-18T00:00:00.000Z",
    knownFrom: k2,
    knownTo: null,
    supersedesRevisionId: null,
    evidenceRef: null,
    recordedAt: k2,
  };
  const withConflict = projectBitemporalState(
    [...allRevisions, conflictingClaim],
    {
      knownAt: k2,
      validAt: "2026-01-15T00:00:00.000Z",
    },
  );
  assert.equal(withConflict.visible.length, 2);
  assert.equal(withConflict.conflicts.length, 1);
  assert.equal(withConflict.conflicts[0]?.conflictKey, "transport-mode");
});

test("F3-T02.A1: timeline KGRAPH separa sinal confirmado, deriva objetiva, inferência e verificador", () => {
  const edges: RelationRecord[] = [
    {
      relationId: "rel-1",
      scope,
      fromId: "claim-001",
      toId: "src-1",
      kind: "references_evidence",
      signalKind: "confirmed_link",
      rationale: "Vínculo humano confirmado.",
      author: "Autor",
      knownAt: "2026-02-02T00:00:00.000Z",
    },
    {
      relationId: "rel-2",
      scope,
      fromId: "claim-001",
      toId: "claim-002",
      kind: "derived_from",
      signalKind: "inference",
      rationale: "Inferência local de candidato.",
      author: "Heurística",
      knownAt: "2026-02-03T00:00:00.000Z",
    },
    {
      relationId: "rel-cross",
      scope: otherScope,
      fromId: "claim-x",
      toId: "src-x",
      kind: "supports",
      signalKind: "confirmed_link",
      rationale: "Outro projeto.",
      author: "Outro",
      knownAt: "2026-02-02T00:00:00.000Z",
    },
  ];
  const signals: TimelineSignalEntry[] = [
    {
      signalId: "sig-drift",
      signalKind: "objective_drift",
      subjectId: "claim-001",
      targetId: "src-1",
      summary: "Arquivo de evidência divergiu no disco.",
      recordedAt: "2026-02-04T00:00:00.000Z",
      derivedFromConfirmed: true,
    },
    {
      signalId: "sig-verifier",
      signalKind: "verifier_signal",
      subjectId: "claim-001",
      targetId: null,
      summary: "Teste determinístico aprovado.",
      recordedAt: "2026-02-05T00:00:00.000Z",
      derivedFromConfirmed: true,
    },
  ];

  const onlyDrift = projectKgraphTimeline({
    scope,
    edges,
    signals,
    knownAt: "2026-02-10T00:00:00.000Z",
    signalKinds: ["objective_drift"],
  });
  assert.equal(onlyDrift.edges.length, 0);
  assert.deepEqual(
    onlyDrift.signals.map((s) => s.signalKind),
    ["objective_drift"],
  );

  const allBeforeCutoff = projectKgraphTimeline({
    scope,
    edges,
    signals,
    knownAt: "2026-02-03T12:00:00.000Z",
  });
  assert.equal(allBeforeCutoff.edges.length, 2);
  assert.equal(allBeforeCutoff.signals.length, 0);
});

test("F3-T02.A1: governança de exportação bloqueia db_only, detecta segredos e invalida exceção se digest/destino mudar", () => {
  const secretCandidate: ExportCandidateInput = {
    itemId: "item-secret",
    title: "Config com token",
    visibility: "captured_eligible",
    content: 'token = "sk-1234567890abcdef"',
  };
  const dbOnlyCandidate: ExportCandidateInput = {
    itemId: "item-db",
    title: "Registro interno",
    visibility: "db_only",
    content: "Uso estritamente local no SQLite.",
  };

  const findings = scanExportItems([secretCandidate]);
  assert.equal(findings.length, 2);
  assert.ok(findings.some((f) => f.pattern === "api_key_token"));
  assert.ok(findings.some((f) => f.pattern === "credential_assignment"));

  const blockedDb = evaluateExportGovernance({
    scope,
    destinationId: "codex_mock",
    items: [secretCandidate, dbOnlyCandidate],
  });
  assert.equal(blockedDb.hardDenied, true);
  assert.equal(blockedDb.eligible, false);
  assert.equal(blockedDb.requiresException, false);

  const secretPreview = evaluateExportGovernance({
    scope,
    destinationId: "codex_mock",
    items: [secretCandidate],
  });
  assert.equal(secretPreview.hardDenied, false);
  assert.equal(secretPreview.eligible, false);
  assert.equal(secretPreview.requiresException, true);

  const validException: ExportExceptionRecord = {
    exceptionId: "exc-1",
    scope,
    bundleDigest: secretPreview.bundleDigest,
    destinationId: "codex_mock",
    policyVersion: secretPreview.policyVersion,
    reviewer: "Autor F3",
    reason: "Token sintético de teste aprovado apenas para Mock.",
    grantedAt: "2026-02-01T00:00:00.000Z",
  };

  const withValidException = evaluateExportGovernance({
    scope,
    destinationId: "codex_mock",
    items: [secretCandidate],
    exception: validException,
  });
  assert.equal(withValidException.eligible, true);

  // Changing destination invalidates the exception
  const changedDest = evaluateExportGovernance({
    scope,
    destinationId: "codex_cli_workspace",
    items: [secretCandidate],
    exception: validException,
  });
  assert.equal(changedDest.eligible, false);

  // Changing content digest invalidates the exception
  const changedContent = evaluateExportGovernance({
    scope,
    destinationId: "codex_mock",
    items: [{ ...secretCandidate, content: 'token = "sk-9999999999zzzzzz"' }],
    exception: validException,
  });
  assert.equal(changedContent.eligible, false);

  // Check pure hash helper compatibility
  assert.equal(
    sha256Hex(canonicalJson({ b: 2, a: 1 })),
    sha256Hex('{"a":1,"b":2}'),
  );
});
