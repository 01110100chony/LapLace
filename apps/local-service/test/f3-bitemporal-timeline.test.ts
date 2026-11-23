import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  fixture,
  git,
  readGitInvariantSnapshot,
} from "./fixtures/ipc-harness.ts";

test(
  "F3-T03 / F3-M01: preserva K1 após correção parcial retroativa em K2, detecta conflito material e separa sinais KGRAPH sem mutar o Git",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repo = await env.repository("F3-Bitemporal");
    await mkdir(join(repo, "docs"), { recursive: true });
    git(repo, "config", "core.autocrlf", "false");

    const filePath = "docs/regra.txt";
    await writeFile(
      join(repo, filePath),
      "Regra arquitetural original para prova em texto.\n",
    );
    git(repo, "add", filePath);
    git(repo, "commit", "-qm", "base f3 bitemporal");

    const gitBefore = await readGitInvariantSnapshot(repo);
    const client = env.start(env.dataDir);
    const project = await client.request("workspace.addLocal", { path: repo });
    const identity = await client.request("project.identity", {
      projectId: project.id,
    });
    const scope = identity.scope;

    const snap = await client.request("context.capture", {
      projectId: project.id,
      paths: [filePath],
    });
    const included = snap.entries.find((e) => e.path === filePath);
    assert.ok(included?.outcome === "included");
    await client.request("context.index", {
      projectId: project.id,
      contextId: snap.contextId,
      force: true,
    });

    const excerptRef = {
      kind: "context_excerpt" as const,
      contextId: snap.contextId,
      path: filePath,
      sha256: included.sha256,
      chunk: 0,
    };

    const pin = await client.request("memory.pinCreate", {
      ...scope,
      label: "Prova CAS regra inicial",
      source: {
        kind: "inline",
        content: "Evidência imutável fixada em CAS para o endpoint v1.",
      },
    });

    const k1 = "2026-02-01T00:00:00.000Z";
    const k2 = "2026-02-10T00:00:00.000Z";
    const t1 = "2026-01-01T00:00:00.000Z";
    const t2 = "2026-01-10T00:00:00.000Z";
    const t3 = "2026-01-20T00:00:00.000Z";
    const t4 = "2026-01-31T00:00:00.000Z";

    const recorded = await client.request("memory.claimRecord", {
      ...scope,
      requestId: "claim-init-1",
      title: "Contrato endpoint F3",
      content: "Usar contrato legado A no intervalo completo.",
      author: "Arquiteto",
      reason: "Registro inicial F3",
      promoteCanonical: true,
      conflictKey: "endpoint.contract",
      conflictPolarity: "require",
      validFrom: t1,
      validTo: t4,
      knownAt: k1,
      evidenceRef: { kind: "pin", pinId: pin.pinId },
    });
    assert.equal(recorded.revisions.length, 1);

    // Retry idempotency with same requestId
    const idempotent = await client.request("memory.claimRecord", {
      ...scope,
      requestId: "claim-init-1",
      title: "Contrato endpoint F3",
      content: "Usar contrato legado A no intervalo completo.",
      author: "Arquiteto",
      reason: "Registro inicial F3",
      validFrom: t1,
      validTo: t4,
      knownAt: k1,
    });
    assert.equal(idempotent.claimId, recorded.claimId);

    // Partial retroactive correction at K2 over [t2, t3)
    const corrected = await client.request("memory.claimCorrect", {
      ...scope,
      requestId: "claim-corr-1",
      claimId: recorded.claimId,
      content: "Janela emergencial usou contrato B.",
      author: "Revisor",
      reason: "Correção retroativa parcial §7",
      correctFrom: t2,
      correctTo: t3,
      knownAt: k2,
      evidenceRef: { kind: "pin", pinId: pin.pinId },
    });
    assert.equal(corrected.activeCount, 3);

    // Query at K1: sees ONLY original full interval [t1, t4)
    const tlK1 = await client.request("memory.timeline", {
      ...scope,
      knownAt: k1,
      validAt: "2026-01-15T00:00:00.000Z",
    });
    assert.equal(tlK1.claims.length, 1);
    assert.equal(
      tlK1.claims[0]!.revision.content,
      "Usar contrato legado A no intervalo completo.",
    );
    assert.equal(tlK1.claims[0]!.resolvedEvidence.state, "verified");
    assert.equal(tlK1.claims[0]!.resolvedEvidence.source, "cas_pin");

    // Query at K2 across whole V range: sees left residual, corrected middle, right residual
    const tlK2All = await client.request("memory.timeline", {
      ...scope,
      knownAt: k2,
    });
    const segs = tlK2All.claims
      .filter((c) => c.claimId === recorded.claimId)
      .map((c) => ({
        validFrom: c.revision.validFrom,
        validTo: c.revision.validTo,
        content: c.revision.content,
      }));
    assert.deepEqual(segs, [
      {
        validFrom: t1,
        validTo: t2,
        content: "Usar contrato legado A no intervalo completo.",
      },
      {
        validFrom: t2,
        validTo: t3,
        content: "Janela emergencial usou contrato B.",
      },
      {
        validFrom: t3,
        validTo: t4,
        content: "Usar contrato legado A no intervalo completo.",
      },
    ]);

    // Conflicting claim overlapping [2026-01-12, 2026-01-18) + unpinned missing origin
    const rival = await client.request("memory.claimRecord", {
      ...scope,
      requestId: "claim-rival-1",
      title: "Exceção incompatível",
      content: "Proibir contrato B durante a janela.",
      author: "Auditoria",
      reason: "Teste conflito material + deriva",
      conflictKey: "endpoint.contract",
      conflictPolarity: "forbid",
      validFrom: "2026-01-12T00:00:00.000Z",
      validTo: "2026-01-18T00:00:00.000Z",
      knownAt: k2,
      evidenceRef: excerptRef,
    });

    await client.request("memory.relationRecord", {
      ...scope,
      fromId: recorded.claimId,
      toId: rival.claimId,
      kind: "contradicts",
      signalKind: "confirmed_link",
      rationale: "Anotação humana confirmou choque de regra",
      author: "Revisor",
      knownAt: k2,
    });
    await client.request("memory.relationRecord", {
      ...scope,
      fromId: rival.claimId,
      toId: recorded.claimId,
      kind: "derived_from",
      signalKind: "inference",
      rationale: "Sugestão heurística de dependência",
      author: "Agente Local",
      knownAt: k2,
    });

    // Delete origin file in worktree (NOTE: only on test fixture untracked deletion or check unpinned gap: wait — keep Git HEAD untouched by modifying file on disk temporarily? Wait: deleting tracked file touches WT only, NEVER HEAD/index/refs, AND readGitInvariantSnapshot checks HEAD/index/refs + status! Wait: readGitInvariantSnapshot checks `status` too! So do NOT mutate `repo` working tree before `readGitInvariantSnapshot` — instead attach a nonexistent sha256 or capture from a second file in a scratch dir? Actually even cleaner: create claim with an unpinned context_excerpt pointing to a second deleted snapshot or delete Snapshot? Wait: context_blobs isn't tracked by Git, OR delete an UNTRACKED file won't work cleanly if readGitInvariantSnapshot checks status. Wait — let's restore the file or use nonexistent digest in a third claim OR test unpinned ref pointing to a second snapshot created on an untracked-clean committed deletion? No: if a ref points to nonexistent sha256 or missing snapshot -> `contextSearch.readExcerpt` fails -> `gap`! Even better: delete the committed file `docs/regra.txt` ONLY if we want unpinned gap, OR recreate/restore it BEFORE `readGitInvariantSnapshot`? Better yet: use an invalid/missing context_excerpt ref `{ contextId: snap.contextId, path: filePath, sha256: "f".repeat(64), chunk: 0 }` so we NEVER touch `repo` at all, preserving exact git status!)
    await client.request("memory.claimRecord", {
      ...scope,
      requestId: "claim-gap-1",
      title: "Referência sem prova durável",
      content: "Depende de trecho ausente no repositório.",
      author: "Revisor",
      reason: "Exercitar objective_drift",
      validFrom: t2,
      validTo: t3,
      knownAt: k2,
      evidenceRef: {
        kind: "context_excerpt",
        contextId: snap.contextId,
        path: filePath,
        sha256: "f".repeat(64),
        chunk: 0,
      },
    });

    const tlFilteredConfirmedAndDrift = await client.request(
      "memory.timeline",
      {
        ...scope,
        knownAt: k2,
        validAt: "2026-01-15T00:00:00.000Z",
        signalKinds: ["confirmed_link", "objective_drift"],
      },
    );
    assert.ok(tlFilteredConfirmedAndDrift.conflicts.length >= 1);
    assert.ok(
      tlFilteredConfirmedAndDrift.signals.some(
        (s) => s.signalKind === "confirmed_link" && s.derivedFromConfirmed,
      ),
    );
    assert.ok(
      tlFilteredConfirmedAndDrift.signals.some(
        (s) => s.signalKind === "objective_drift" && !s.derivedFromConfirmed,
      ),
    );
    assert.equal(
      tlFilteredConfirmedAndDrift.signals.some(
        (s) =>
          s.signalKind === "inference" || s.signalKind === "verifier_signal",
      ),
      false,
    );

    const tlAllSignals = await client.request("memory.timeline", {
      ...scope,
      knownAt: k2,
    });
    const kinds = new Set(tlAllSignals.signals.map((s) => s.signalKind));
    assert.equal(kinds.has("confirmed_link"), true);
    assert.equal(kinds.has("objective_drift"), true);
    assert.equal(kinds.has("inference"), true);
    assert.equal(kinds.has("verifier_signal"), true);

    await client.close();
    const gitAfter = await readGitInvariantSnapshot(repo);
    assert.deepEqual(gitAfter, gitBefore);
  },
);
