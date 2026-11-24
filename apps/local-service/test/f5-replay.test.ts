import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { defaultCompilerPolicyVersion } from "@laplace/contracts";
import {
  fixture,
  git,
  readGitInvariantSnapshot,
} from "./fixtures/ipc-harness.ts";

test(
  "F5-M02.A1: Replay explicavel reconstroi estado em (V, K), declara lacunas de expurgo sem ressuscitar texto, inspeciona manifesto/policyVersion F2 e isola projetos",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repoA = await env.repository("Replay-Project-A");
    const repoB = await env.repository("Replay-Project-B");
    await mkdir(join(repoA, "docs"), { recursive: true });
    await mkdir(join(repoB, "docs"), { recursive: true });
    git(repoA, "config", "core.autocrlf", "false");
    git(repoB, "config", "core.autocrlf", "false");

    await writeFile(
      join(repoA, "docs", "spec.txt"),
      "Especificacao verificavel do projeto A para Replay F5.\n",
    );
    await writeFile(
      join(repoB, "docs", "other.txt"),
      "Documento isolado do projeto B.\n",
    );
    git(repoA, "add", ".");
    git(repoA, "commit", "-qm", "base A");
    git(repoB, "add", ".");
    git(repoB, "commit", "-qm", "base B");

    const gitBeforeA = await readGitInvariantSnapshot(repoA);
    let client = env.start(env.dataDir, "completed");
    const projA = await client.request("workspace.addLocal", { path: repoA });
    const projB = await client.request("workspace.addLocal", { path: repoB });
    const scopeA = (
      await client.request("project.identity", { projectId: projA.id })
    ).scope;
    const scopeB = (
      await client.request("project.identity", { projectId: projB.id })
    ).scope;

    const snapA = await client.request("context.capture", {
      projectId: projA.id,
      paths: ["docs/spec.txt"],
    });
    const entryA = snapA.entries.find((e) => e.path === "docs/spec.txt");
    assert.ok(entryA?.outcome === "included");
    await client.request("context.index", {
      projectId: projA.id,
      contextId: snapA.contextId,
      force: true,
    });
    const excerptA = {
      contextId: snapA.contextId,
      path: "docs/spec.txt",
      sha256: entryA.sha256,
      chunk: 0,
    };

    const k1 = "2026-03-01T00:00:00.000Z";
    const k2 = "2026-03-10T00:00:00.000Z";
    const v1 = "2026-02-01T00:00:00.000Z";
    const v2 = "2026-02-15T00:00:00.000Z";
    const v3 = "2026-02-28T00:00:00.000Z";

    // 1. F3 Claim C1 com correcao parcial retroativa entre K1 e K2.
    const c1 = await client.request("memory.claimRecord", {
      ...scopeA,
      requestId: "replay-claim-1",
      title: "Regra bitemporal principal",
      content: "Versao original K1 valida no periodo completo.",
      author: "Arquiteto",
      reason: "Estado inicial K1",
      promoteCanonical: true,
      validFrom: v1,
      validTo: v3,
      knownAt: k1,
      evidenceRef: { kind: "context_excerpt", ...excerptA },
    });
    await client.request("memory.claimCorrect", {
      ...scopeA,
      requestId: "replay-claim-1-corr",
      claimId: c1.claimId,
      content: "Correcao retroativa conhecida em K2 para o fim do periodo.",
      author: "Arquiteto",
      reason: "Correcao retroativa K2",
      correctFrom: v2,
      correctTo: v3,
      knownAt: k2,
      evidenceRef: { kind: "context_excerpt", ...excerptA },
    });

    // 2. Claim C2 e Decisao D2 criadas e posteriormente expurgadas com canarios.
    const secretClaimCanary = "CANARIO-CLAIM-EXPURGADA-NAO-RESSUSCITAR";
    const c2 = await client.request("memory.claimRecord", {
      ...scopeA,
      requestId: "replay-claim-purge",
      title: "Afirmacao descartavel",
      content: secretClaimCanary,
      author: "Arquiteto",
      reason: "Sera expurgada",
      validFrom: v1,
      knownAt: k1,
    });
    const secretDecisionCanary = "CANARIO-DECISAO-EXPURGADA-NAO-RESSUSCITAR";
    const d1 = await client.request("decision.record", {
      ...scopeA,
      requestId: "replay-dec-1",
      assertionId: null,
      expectedRevision: 0,
      content: "Decisao ativa F1 visivel no Replay",
      author: "Operador",
      reason: "Prova F1 no replay",
      promoteCanonical: true,
      humanConfirmed: true,
      evidence: excerptA,
    });
    const d2 = await client.request("decision.record", {
      ...scopeA,
      requestId: "replay-dec-purge",
      assertionId: null,
      expectedRevision: 0,
      content: secretDecisionCanary,
      author: "Operador",
      reason: "Sera expurgada",
      humanConfirmed: true,
      evidence: excerptA,
    });

    // 3. Entrega F2 compilada + grant emitido + acesso auditado antes de k3.
    const compiled = await client.request("compiler.compile", {
      ...scopeA,
      objective: "Entrega auditada para replay",
      destinationId: "codex_mock",
      budgetBytes: 8192,
      policyVersion: defaultCompilerPolicyVersion,
      contextId: snapA.contextId,
      selection: [
        {
          path: "docs/spec.txt",
          sha256: entryA.sha256,
          chunk: null,
        },
      ],
    });
    const grant = await client.request("compiler.grantIssue", {
      ...scopeA,
      sessionId: "replay-session-1",
      manifestDigest: compiled.manifestDigest,
      policyVersion: compiled.publicManifest.policyVersion,
      destinationId: "codex_mock",
      allowedOperations: [
        "summary",
        "search",
        "read",
        "package",
        "handoff",
        "query",
      ],
      humanConfirmed: true,
    });
    await client.request("compiler.queryRun", {
      ...scopeA,
      grantId: grant.grantId,
      sessionId: "replay-session-1",
      manifestDigest: compiled.manifestDigest,
      policyVersion: compiled.publicManifest.policyVersion,
      destinationId: "codex_mock",
      channel: "mcp_stdio",
      mode: "mock_development",
    });

    const knownAfterDelivery = new Date(Date.now() + 60_000).toISOString();

    // Expurga D2 (F1) e C2 (F3) definitivamente.
    await client.request("decision.purge", {
      ...scopeA,
      assertionId: d2.assertionId,
      expectedRevision: 1,
      confirmedScope: true,
      reason: "Expurgo definitivo F1",
    });
    await client.request("memory.purgeStart", {
      ...scopeA,
      targetKind: "claim",
      targetId: c2.claimId,
      reason: "Expurgo definitivo F3",
      humanConfirmed: true,
    });

    // Reinicia sidecar para garantir replay passivo 100% persistido.
    await client.close();
    client = env.start(env.dataDir);

    // 4. Consulta em (validAt: v2, knownAt: k1): antes de K2 e antes das decisoes/entregas posteriores.
    const atK1 = await client.request("replay.query", {
      ...scopeA,
      validAt: v2,
      knownAt: k1,
    });
    const claimAtK1 = atK1.claims.find((c) => c.claimId === c1.claimId);
    assert.ok(claimAtK1);
    assert.equal(claimAtK1.revision.txSeq, 1);
    assert.match(claimAtK1.revision.content, /Versao original K1/);
    assert.equal(claimAtK1.evidenceState, "verified");
    assert.ok(atK1.gaps.some((g) => g.kind === "not_yet_known"));
    assert.ok(
      atK1.gaps.some(
        (g) => g.kind === "purged_tombstone" && g.targetId === c2.claimId,
      ),
    );
    assert.ok(
      atK1.gaps.some(
        (g) => g.kind === "purged_tombstone" && g.targetId === d2.assertionId,
      ),
    );
    // ZERO ressurreicao de payloads expurgados.
    const serializedK1 = JSON.stringify(atK1);
    assert.equal(serializedK1.includes(secretClaimCanary), false);
    assert.equal(serializedK1.includes(secretDecisionCanary), false);

    // 5. Consulta em (validAt: v2, knownAt: knownAfterDelivery) mostra correcao K2 + entrega F2;
    // e em (validAt: knownAfterDelivery, knownAt: knownAfterDelivery) tambem mostra decisao D1 efetiva agora.
    const atK3 = await client.request("replay.query", {
      ...scopeA,
      validAt: v2,
      knownAt: knownAfterDelivery,
    });
    const claimAtK3 = atK3.claims.find((c) => c.claimId === c1.claimId);
    assert.ok(claimAtK3);
    assert.equal(claimAtK3.revision.txSeq, 2);
    assert.ok(
      atK3.deliveries.some((d) => d.manifestDigest === compiled.manifestDigest),
    );
    const atNow = await client.request("replay.query", {
      ...scopeA,
      validAt: knownAfterDelivery,
      knownAt: knownAfterDelivery,
    });
    assert.ok(atNow.decisions.some((d) => d.assertionId === d1.assertionId));
    assert.equal(
      atNow.decisions.some((d) => d.assertionId === d2.assertionId),
      false,
    );
    const serializedK3 = JSON.stringify({ atK3, atNow });
    assert.equal(serializedK3.includes(secretClaimCanary), false);
    assert.equal(serializedK3.includes(secretDecisionCanary), false);

    // 6. Diff entre pontos bitemporais (v2/k1 -> now/knownAfterDelivery).
    const diff = await client.request("replay.diff", {
      ...scopeA,
      pointA: { validAt: v2, knownAt: k1 },
      pointB: { validAt: knownAfterDelivery, knownAt: knownAfterDelivery },
    });
    assert.ok(diff.removedClaims.some((c) => c.claimId === c1.claimId));
    assert.ok(
      diff.addedDecisions.some((d) => d.assertionId === d1.assertionId),
    );
    assert.ok(
      diff.newDeliveries.some(
        (d) => d.manifestDigest === compiled.manifestDigest,
      ),
    );

    // 7. Reconstrucao exata de entrega F2 + policyVersion em deliveryInspect.
    const delivery = await client.request("replay.deliveryInspect", {
      ...scopeA,
      manifestDigest: compiled.manifestDigest,
      knownAt: knownAfterDelivery,
    });
    assert.equal(delivery.manifestDigest, compiled.manifestDigest);
    assert.equal(delivery.policyVersion, defaultCompilerPolicyVersion);
    assert.ok(delivery.includedItems.length >= 1);
    assert.equal(delivery.grants.length, 1);
    assert.equal(delivery.audits.length, 1);

    // 8. Isolamento estrito entre projetos A e B (INV-01).
    const replayB = await client.request("replay.query", {
      ...scopeB,
      validAt: v3,
      knownAt: knownAfterDelivery,
    });
    assert.equal(replayB.claims.length, 0);
    assert.equal(replayB.decisions.length, 0);
    assert.equal(replayB.deliveries.length, 0);
    await assert.rejects(
      client.request("replay.deliveryInspect", {
        ...scopeB,
        manifestDigest: compiled.manifestDigest,
        knownAt: knownAfterDelivery,
      }),
      { message: "intelligence_not_found" },
    );

    // Zero mutacao no Git durante todo o replay.
    assert.deepEqual(await readGitInvariantSnapshot(repoA), gitBeforeA);
    await client.close();
  },
);
