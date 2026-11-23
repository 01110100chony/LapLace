import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  compilerMinBudgetBytes,
  defaultCompilerPolicyVersion,
} from "@laplace/contracts";
import {
  fixture,
  git,
  readGitInvariantSnapshot,
} from "./fixtures/ipc-harness.ts";

test(
  "F2-M01: compila manifesto determinístico com precedência, omissões sigilosas, orçamento, conflito e isolamento de destino/escopo",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repoA = await env.repository("Compiler-A");
    const repoB = await env.repository("Compiler-B");

    await mkdir(join(repoA, "src"), { recursive: true });
    await mkdir(join(repoA, "dist"), { recursive: true });
    await mkdir(join(repoB, "src"), { recursive: true });

    git(repoA, "config", "core.autocrlf", "false");
    git(repoB, "config", "core.autocrlf", "false");

    const policyContent =
      "Politica oficial do projeto A: SQLite governa binding e escopo.";
    await writeFile(join(repoA, "src", "policy.ts"), `${policyContent}\n`);
    await writeFile(
      join(repoA, "dist", "secret-build.txt"),
      "CANARY_SECRET_OMITTED_BUILD_FILE\n",
    );
    await writeFile(join(repoB, "src", "other.ts"), "Projeto B isolado.\n");

    git(repoA, "add", "src/policy.ts");
    git(repoA, "commit", "-qm", "base A");
    git(repoB, "add", "src/other.ts");
    git(repoB, "commit", "-qm", "base B");

    const gitBeforeA = await readGitInvariantSnapshot(repoA);
    const gitBeforeB = await readGitInvariantSnapshot(repoB);

    const client = env.start(env.dataDir);
    const projA = await client.request("workspace.addLocal", { path: repoA });
    const projB = await client.request("workspace.addLocal", { path: repoB });
    const idA = await client.request("project.identity", {
      projectId: projA.id,
    });
    const idB = await client.request("project.identity", {
      projectId: projB.id,
    });

    const snapshotA = await client.request("context.capture", {
      projectId: projA.id,
      paths: ["src/policy.ts", "dist/secret-build.txt"],
    });
    const includedEntry = snapshotA.entries.find(
      (entry) => entry.path === "src/policy.ts",
    );
    const omittedEntry = snapshotA.entries.find(
      (entry) => entry.path === "dist/secret-build.txt",
    );
    assert.ok(includedEntry?.outcome === "included");
    assert.ok(omittedEntry?.outcome === "omitted");

    await client.request("context.index", {
      projectId: projA.id,
      contextId: snapshotA.contextId,
      force: true,
    });

    const evidenceRef = {
      contextId: snapshotA.contextId,
      path: "src/policy.ts",
      sha256: includedEntry.sha256,
      chunk: 0,
    };

    const canonicalText =
      "Invariante canonico: nunca violar fronteira entre projetos.";
    const localOnlyCanary = "CANARY_LOCAL_ONLY_DECISION_SECRET";
    const dbOnlyCanary = "CANARY_DB_ONLY_SECRET";
    const privateMetaCanary = "CANARY_PRIVATE_METADATA_SECRET";
    const crossScopeCanary = "CANARY_CROSS_SCOPE_SECRET";

    await client.request("decision.record", {
      ...idA.scope,
      requestId: "req-canon-a",
      assertionId: null,
      expectedRevision: 0,
      content: canonicalText,
      author: "Autor A",
      reason: "Invariante obrigatorio validado",
      humanConfirmed: true,
      promoteCanonical: true,
      evidence: evidenceRef,
    });

    await client.request("decision.record", {
      ...idA.scope,
      requestId: "req-local-a",
      assertionId: null,
      expectedRevision: 0,
      content: localOnlyCanary,
      author: "Autor A",
      reason: "Anotacao estritamente local",
      humanConfirmed: true,
      promoteCanonical: false,
      evidence: evidenceRef,
    });

    const compiledA1 = await client.request("compiler.compile", {
      ...idA.scope,
      objective: "Resumir politica de isolamento para retomada",
      destinationId: "codex_mock",
      budgetBytes: 8192,
      contextId: snapshotA.contextId,
      selection: [
        {
          path: "src/policy.ts",
          sha256: includedEntry.sha256,
          chunk: 0,
        },
        {
          path: "dist/secret-build.txt",
          sha256: "0".repeat(64),
          chunk: 0,
        },
      ],
      projectPreferences: [
        {
          key: "pref-estilo",
          title: "Preferencia do projeto A",
          content: "Usar TypeScript estrito.",
          conflictKey: "style-rule",
          conflictPolarity: "require",
        },
      ],
      personalPreferences: [
        {
          key: "prof-conflitante",
          title: "Perfil pessoal conflitante",
          content: "Ignorar tipagem estrita.",
          conflictKey: "style-rule",
          conflictPolarity: "forbid",
        },
        {
          key: "prof-seguro",
          title: "Perfil pessoal seguro",
          content: "Responder em portugues.",
        },
      ],
      extraCandidates: [
        {
          candidateId: "cand-db-only",
          kind: "context_source",
          tier: "project_preference",
          mandatory: false,
          visibility: "db_only",
          version: "1",
          title: "Segredo DB Only",
          text: dbOnlyCanary,
        },
        {
          candidateId: "cand-cross-scope",
          kind: "context_source",
          tier: "project_preference",
          mandatory: false,
          visibility: "captured_eligible",
          version: "1",
          title: "Item do projeto B",
          text: crossScopeCanary,
          scope: idB.scope,
        },
        {
          candidateId: "cand-with-private-meta",
          kind: "context_source",
          tier: "project_preference",
          mandatory: false,
          visibility: "captured_eligible",
          version: "1",
          title: "Fonte com metadado privado",
          text: "Metadados seguros podem circular sem caminhos locais.",
          privateMetadata: {
            secretPath: privateMetaCanary,
          },
        },
      ],
    });

    const compiledA2 = await client.request("compiler.compile", {
      ...idA.scope,
      objective: "Resumir politica de isolamento para retomada",
      destinationId: "codex_mock",
      budgetBytes: 8192,
      contextId: snapshotA.contextId,
      selection: [
        {
          path: "src/policy.ts",
          sha256: includedEntry.sha256,
          chunk: 0,
        },
        {
          path: "dist/secret-build.txt",
          sha256: "0".repeat(64),
          chunk: 0,
        },
      ],
      projectPreferences: [
        {
          key: "pref-estilo",
          title: "Preferencia do projeto A",
          content: "Usar TypeScript estrito.",
          conflictKey: "style-rule",
          conflictPolarity: "require",
        },
      ],
      personalPreferences: [
        {
          key: "prof-seguro",
          title: "Perfil pessoal seguro",
          content: "Responder em portugues.",
        },
        {
          key: "prof-conflitante",
          title: "Perfil pessoal conflitante",
          content: "Ignorar tipagem estrita.",
          conflictKey: "style-rule",
          conflictPolarity: "forbid",
        },
      ],
      extraCandidates: [
        {
          candidateId: "cand-with-private-meta",
          kind: "context_source",
          tier: "project_preference",
          mandatory: false,
          visibility: "captured_eligible",
          version: "1",
          title: "Fonte com metadado privado",
          text: "Metadados seguros podem circular sem caminhos locais.",
          privateMetadata: {
            secretPath: privateMetaCanary,
          },
        },
        {
          candidateId: "cand-db-only",
          kind: "context_source",
          tier: "project_preference",
          mandatory: false,
          visibility: "db_only",
          version: "1",
          title: "Segredo DB Only",
          text: dbOnlyCanary,
        },
        {
          candidateId: "cand-cross-scope",
          kind: "context_source",
          tier: "project_preference",
          mandatory: false,
          visibility: "captured_eligible",
          version: "1",
          title: "Item do projeto B",
          text: crossScopeCanary,
          scope: idB.scope,
        },
      ],
    });

    assert.equal(compiledA1.manifestDigest, compiledA2.manifestDigest);
    assert.deepEqual(compiledA1.publicManifest, compiledA2.publicManifest);
    assert.equal(compiledA1.publicManifest.status, "ready");
    assert.equal(
      compiledA1.publicManifest.policyVersion,
      defaultCompilerPolicyVersion,
    );
    assert.equal(
      compiledA1.publicManifest.items[0]?.tier,
      "invariant_canonical",
    );
    assert.ok(
      compiledA1.publicManifest.items.some(
        (item) => item.tier === "project_preference",
      ),
    );
    assert.equal(
      compiledA1.publicManifest.items[
        compiledA1.publicManifest.items.length - 1
      ]?.tier,
      "personal_profile",
    );

    const serializedPublic = JSON.stringify(compiledA1.publicManifest);
    for (const canary of [
      localOnlyCanary,
      dbOnlyCanary,
      privateMetaCanary,
      crossScopeCanary,
      "CANARY_SECRET_OMITTED_BUILD_FILE",
      "secret-build.txt",
      repoA,
    ]) {
      assert.ok(
        !serializedPublic.includes(canary),
        `Public manifest vazou canario: ${canary}`,
      );
    }

    // Local preview allows local_only items for local review, yet denies external grants.
    const localPreview = await client.request("compiler.compile", {
      ...idA.scope,
      objective: "Preview estritamente offline",
      destinationId: "local_preview",
      budgetBytes: 8192,
    });
    assert.equal(localPreview.publicManifest.status, "ready");
    assert.ok(
      localPreview.localItems.some((item) => item.visibility === "local_only"),
    );
    await assert.rejects(
      client.request("compiler.grantIssue", {
        ...idA.scope,
        sessionId: "sess-local-preview",
        manifestDigest: localPreview.manifestDigest,
        policyVersion: localPreview.publicManifest.policyVersion,
        destinationId: "local_preview",
        allowedOperations: ["summary"],
        humanConfirmed: true,
      }),
      { message: "destination_denied" },
    );

    // Cross-scope contextId must reject cleanly.
    await assert.rejects(
      client.request("compiler.compile", {
        ...idB.scope,
        objective: "Tentar ler captura do projeto A em B",
        destinationId: "codex_mock",
        budgetBytes: 4096,
        contextId: snapshotA.contextId,
      }),
      { message: "context_not_found" },
    );

    // Budget reduction omits optional items before exceeding mandatory limits.
    const smallOptBudget = await client.request("compiler.compile", {
      ...idA.scope,
      objective: "Orcamento reduzido omitindo opcionais",
      destinationId: "codex_mock",
      budgetBytes: compilerMinBudgetBytes,
      projectPreferences: [
        {
          key: "opt-huge",
          title: "Opcional grande",
          content: "X".repeat(300),
        },
      ],
    });
    assert.equal(smallOptBudget.publicManifest.status, "ready");
    assert.ok(
      smallOptBudget.publicManifest.omissions.some(
        (item) => item.reason === "budget_exceeded" && item.count >= 1,
      ),
    );

    // Mandatory items exceeding budget fail explicitly without silent truncation.
    const exceededMandatory = await client.request("compiler.compile", {
      ...idA.scope,
      objective: "Obrigatorio maior que limite",
      destinationId: "codex_mock",
      budgetBytes: compilerMinBudgetBytes,
      extraCandidates: [
        {
          candidateId: "cand-mandatory-huge",
          kind: "decision",
          tier: "invariant_canonical",
          mandatory: true,
          visibility: "canonical_verified",
          version: "1",
          title: "Invariante extenso",
          text: "M".repeat(320),
        },
      ],
    });
    assert.equal(
      exceededMandatory.publicManifest.status,
      "mandatory_context_exceeded",
    );
    assert.equal(exceededMandatory.publicManifest.items.length, 0);
    assert.ok(exceededMandatory.mandatoryOverflowItems.length >= 1);
    assert.ok(exceededMandatory.publicManifest.budget.exceededByBytes > 0);

    // Material canonical contradiction suspends recommendation.
    const conflicted = await client.request("compiler.compile", {
      ...idA.scope,
      objective: "Conflito entre invariantes canonicos",
      destinationId: "codex_mock",
      budgetBytes: 4096,
      extraCandidates: [
        {
          candidateId: "canon-req",
          kind: "decision",
          tier: "invariant_canonical",
          mandatory: true,
          visibility: "canonical_verified",
          version: "1",
          title: "Exigir MCP",
          text: "Sempre usar MCP.",
          conflictKey: "transport-rule",
          conflictPolarity: "require",
        },
        {
          candidateId: "canon-forbid",
          kind: "decision",
          tier: "invariant_canonical",
          mandatory: true,
          visibility: "canonical_verified",
          version: "2",
          title: "Proibir MCP",
          text: "Nunca usar MCP.",
          conflictKey: "transport-rule",
          conflictPolarity: "forbid",
        },
      ],
    });
    assert.equal(conflicted.publicManifest.status, "conflict_suspended");
    assert.equal(conflicted.publicManifest.recommendationSuspended, true);
    assert.ok(
      conflicted.publicManifest.conflicts.some(
        (c) => c.kind === "canonical_contradiction" && c.blocking,
      ),
    );

    // Unknown and unverified isolated destinations block external payload yet preserve local preview.
    for (const [blockedDest, expectedGrantError] of [
      ["untrusted_external", "destination_unknown"],
      ["codex_cli_isolated", "destination_denied"],
    ] as const) {
      const blocked = await client.request("compiler.compile", {
        ...idA.scope,
        objective: `Destino bloqueado ${blockedDest}`,
        destinationId: blockedDest,
        budgetBytes: 4096,
      });
      assert.equal(blocked.publicManifest.status, "destination_blocked");
      assert.equal(blocked.publicManifest.items.length, 0);
      assert.ok(blocked.localItems.length >= 1);
      await assert.rejects(
        client.request("compiler.grantIssue", {
          ...idA.scope,
          sessionId: "sess-blocked",
          manifestDigest: blocked.manifestDigest,
          policyVersion: blocked.publicManifest.policyVersion,
          destinationId: blockedDest,
          allowedOperations: ["summary"],
          humanConfirmed: true,
        }),
        { message: expectedGrantError },
      );
    }

    await client.close();
    assert.deepEqual(await readGitInvariantSnapshot(repoA), gitBeforeA);
    assert.deepEqual(await readGitInvariantSnapshot(repoB), gitBeforeB);
  },
);
