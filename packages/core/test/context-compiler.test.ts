import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { IdentityScope } from "@laplace/contracts";
import {
  canonicalJson,
  compileContext,
  resolveDestinationPolicy,
  sha256Hex,
  type CompilerCandidate,
} from "../src/index.ts";

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
const now = "2026-11-23T05:00:00.000Z";

function makeCandidate(
  overrides: Partial<CompilerCandidate> & {
    candidateId: string;
    text: string;
  },
): CompilerCandidate {
  return {
    scope,
    kind: "context_source",
    tier: "project_preference",
    mandatory: false,
    visibility: "captured_eligible",
    version: "1",
    title: overrides.candidateId,
    capturedAt: now,
    rationale: "Fonte de teste.",
    anchor: { kind: "preference", key: overrides.candidateId },
    ...overrides,
  };
}

test("F2-T02: sha256Hex coincide byte a byte com node:crypto em ASCII, UTF-8 e string vazia", () => {
  for (const text of [
    "",
    "hello world",
    "Retomada verificável com acentuação — λ 🚀",
    "a".repeat(129),
  ]) {
    const expected = createHash("sha256").update(text, "utf8").digest("hex");
    assert.equal(sha256Hex(text), expected);
  }
  assert.equal(canonicalJson({ b: 2, a: 1, skip: undefined }), '{"a":1,"b":2}');
});

test("F2-T02.A1: compilador é invariante à permutação e aplica precedência, deduplicação e ocultação de metadados privados", () => {
  const candidates: CompilerCandidate[] = [
    makeCandidate({
      candidateId: "profile-override",
      kind: "personal_profile",
      tier: "personal_profile",
      title: "Preferência pessoal conflitante",
      text: "Usar singleton global.",
      conflictKey: "persistence-mode",
      conflictPolarity: "forbid",
    }),
    makeCandidate({
      candidateId: "profile-keep",
      kind: "personal_profile",
      tier: "personal_profile",
      title: "Preferência pessoal segura",
      text: "Responder em português conciso.",
    }),
    makeCandidate({
      candidateId: "proj-pref",
      kind: "project_preference",
      tier: "project_preference",
      title: "Preferência do projeto",
      text: "Manter consultas somente leitura.",
      privateMetadata: { secretPath: "C:\\segredo\\interno.txt" },
    }),
    makeCandidate({
      candidateId: "canonical-1",
      kind: "decision",
      tier: "invariant_canonical",
      mandatory: true,
      visibility: "canonical_verified",
      version: "2",
      title: "Invariante SQLite",
      text: "SQLite governa binding e escopo.",
      conflictKey: "persistence-mode",
      conflictPolarity: "require",
      anchor: {
        kind: "decision",
        assertionId: "1".repeat(64),
        revisionId: "2".repeat(64),
        revision: 2,
      },
      privateMetadata: { internalNote: "CANARY_PRIVATE_METADATA" },
    }),
    makeCandidate({
      candidateId: "dup-source",
      kind: "context_source",
      tier: "personal_profile",
      title: "Cópia redundante",
      text: "SQLite governa binding e escopo.",
    }),
    makeCandidate({
      candidateId: "db-only-1",
      visibility: "db_only",
      title: "Segredo DB Only",
      text: "CANARY_DB_ONLY_SECRET",
    }),
    makeCandidate({
      candidateId: "local-only-1",
      visibility: "local_only",
      title: "Nota Local Only",
      text: "CANARY_LOCAL_ONLY_SECRET",
    }),
    makeCandidate({
      candidateId: "cross-1",
      scope: otherScope,
      title: "Item de outro projeto",
      text: "CANARY_CROSS_SCOPE_SECRET",
    }),
  ];

  const first = compileContext({
    scope,
    now,
    objective: "Como manter escopo e persistência?",
    destinationId: "codex_mock",
    budgetBytes: 4096,
    candidates,
  });

  const reversed = compileContext({
    scope,
    now,
    objective: "Como manter escopo e persistência?",
    destinationId: "codex_mock",
    budgetBytes: 4096,
    candidates: [...candidates].reverse(),
  });

  assert.equal(first.preview.manifestDigest, reversed.preview.manifestDigest);
  assert.deepEqual(
    first.preview.publicManifest,
    reversed.preview.publicManifest,
  );
  assert.deepEqual(first.authorizedPayloads, reversed.authorizedPayloads);
  assert.equal(first.preview.publicManifest.status, "ready");
  assert.deepEqual(
    first.preview.publicManifest.items.map((item) => item.tier),
    ["invariant_canonical", "project_preference", "personal_profile"],
  );

  const serializedPublic = JSON.stringify({
    publicManifest: first.preview.publicManifest,
    authorizedPayloads: first.authorizedPayloads,
  });
  for (const canary of [
    "CANARY_PRIVATE_METADATA",
    "CANARY_DB_ONLY_SECRET",
    "CANARY_LOCAL_ONLY_SECRET",
    "CANARY_CROSS_SCOPE_SECRET",
    "Segredo DB Only",
    "Nota Local Only",
    "Item de outro projeto",
  ]) {
    assert.ok(!serializedPublic.includes(canary), `Leak detected: ${canary}`);
  }

  assert.ok(
    first.preview.publicManifest.omissions.some(
      (item) => item.reason === "overridden_by_precedence" && item.disclosable,
    ),
  );
  assert.ok(
    first.preview.publicManifest.omissions.some(
      (item) => item.reason === "duplicate_excerpt" && item.disclosable,
    ),
  );
  assert.ok(
    first.preview.publicManifest.omissions.some(
      (item) => item.reason === "policy_restricted" && !item.disclosable,
    ),
  );
  assert.ok(
    first.preview.publicManifest.omissions.some(
      (item) => item.reason === "db_only_restricted" && !item.disclosable,
    ),
  );
  assert.ok(
    first.preview.publicManifest.omissions.some(
      (item) => item.reason === "cross_scope" && !item.disclosable,
    ),
  );
});

test("F2-T02.A1: orçamento excedido em obrigatório falha sem truncamento silencioso e orçamento menor omite opcionais", () => {
  const mandatoryText = "Invariante obrigatório longo: ".repeat(15);
  const optionalText = "Contexto opcional auxiliar.";

  const exceeded = compileContext({
    scope,
    now,
    objective: "Testar limite obrigatório",
    destinationId: "codex_mock",
    budgetBytes: 256,
    candidates: [
      makeCandidate({
        candidateId: "mand-1",
        tier: "invariant_canonical",
        mandatory: true,
        visibility: "canonical_verified",
        text: mandatoryText,
      }),
      makeCandidate({
        candidateId: "opt-1",
        tier: "project_preference",
        mandatory: false,
        text: optionalText,
      }),
    ],
  });

  assert.equal(
    exceeded.preview.publicManifest.status,
    "mandatory_context_exceeded",
  );
  assert.equal(exceeded.preview.publicManifest.items.length, 0);
  assert.equal(Object.keys(exceeded.authorizedPayloads).length, 0);
  assert.ok(exceeded.preview.publicManifest.budget.exceededByBytes > 0);
  assert.equal(exceeded.preview.mandatoryOverflowItems.length, 1);

  const shrunk = compileContext({
    scope,
    now,
    objective: "Testar redução de opcionais",
    destinationId: "codex_mock",
    budgetBytes: 512,
    candidates: [
      makeCandidate({
        candidateId: "mand-small",
        tier: "invariant_canonical",
        mandatory: true,
        visibility: "canonical_verified",
        text: "Regra obrigatória curta.",
      }),
      makeCandidate({
        candidateId: "opt-fits",
        tier: "project_preference",
        mandatory: false,
        text: "Preferência que cabe.",
      }),
      makeCandidate({
        candidateId: "opt-overflow",
        tier: "personal_profile",
        mandatory: false,
        text: "B".repeat(500),
      }),
    ],
  });

  assert.equal(shrunk.preview.publicManifest.status, "ready");
  assert.equal(shrunk.preview.publicManifest.items.length, 2);
  assert.ok(
    shrunk.preview.publicManifest.omissions.some(
      (item) => item.reason === "budget_exceeded" && item.count === 1,
    ),
  );
});

test("F2-T02.A1: conflito material suspende recomendação e destino desconhecido bloqueia entrega preservando preview local", () => {
  const conflictResult = compileContext({
    scope,
    now,
    objective: "Resolver contradição",
    destinationId: "codex_mock",
    budgetBytes: 4096,
    candidates: [
      makeCandidate({
        candidateId: "canon-a",
        kind: "decision",
        tier: "invariant_canonical",
        mandatory: true,
        visibility: "canonical_verified",
        text: "Usar apenas canal MCP.",
        conflictKey: "channel-policy",
        conflictPolarity: "require",
      }),
      makeCandidate({
        candidateId: "canon-b",
        kind: "decision",
        tier: "invariant_canonical",
        mandatory: true,
        visibility: "canonical_verified",
        text: "Proibir uso de canal MCP.",
        conflictKey: "channel-policy",
        conflictPolarity: "forbid",
      }),
    ],
  });

  assert.equal(
    conflictResult.preview.publicManifest.status,
    "conflict_suspended",
  );
  assert.equal(
    conflictResult.preview.publicManifest.recommendationSuspended,
    true,
  );
  assert.ok(
    conflictResult.preview.publicManifest.conflicts.some(
      (item) => item.kind === "canonical_contradiction" && item.blocking,
    ),
  );

  const unknownDest = compileContext({
    scope,
    now,
    objective: "Enviar para destino desconhecido",
    destinationId: "external_untrusted_cloud",
    budgetBytes: 4096,
    candidates: [
      makeCandidate({
        candidateId: "item-1",
        tier: "invariant_canonical",
        mandatory: true,
        visibility: "canonical_verified",
        text: "Dados válidos.",
      }),
    ],
  });

  assert.equal(unknownDest.preview.destination.known, false);
  assert.equal(
    unknownDest.preview.destination.blockReason,
    "destination_unknown",
  );
  assert.equal(
    unknownDest.preview.publicManifest.status,
    "destination_blocked",
  );
  assert.equal(unknownDest.preview.publicManifest.items.length, 0);
  assert.equal(Object.keys(unknownDest.authorizedPayloads).length, 0);
  assert.equal(unknownDest.preview.localItems.length, 1);

  assert.equal(
    resolveDestinationPolicy("codex_cli_isolated").blockReason,
    "confinement_unverified",
  );
  assert.equal(
    resolveDestinationPolicy("codex_cli_isolated").deliveryAllowed,
    false,
  );

  const isolatedDest = compileContext({
    scope,
    now,
    objective: "Testar bloqueio em destino isolado não verificado",
    destinationId: "codex_cli_isolated",
    budgetBytes: 4096,
    candidates: [
      makeCandidate({
        candidateId: "item-iso-1",
        tier: "invariant_canonical",
        mandatory: true,
        visibility: "canonical_verified",
        text: "Dados bloqueados para entrega externa não confinada.",
      }),
    ],
  });

  assert.equal(isolatedDest.preview.destination.known, true);
  assert.equal(
    isolatedDest.preview.destination.blockReason,
    "confinement_unverified",
  );
  assert.equal(
    isolatedDest.preview.publicManifest.status,
    "destination_blocked",
  );
  assert.equal(isolatedDest.preview.publicManifest.items.length, 0);
  assert.equal(Object.keys(isolatedDest.authorizedPayloads).length, 0);
  assert.equal(isolatedDest.preview.localItems.length, 1);
});
