import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { defaultCompilerPolicyVersion } from "@laplace/contracts";
import {
  fixture,
  git,
  readGitInvariantSnapshot,
} from "./fixtures/ipc-harness.ts";

test(
  "F3-T07 / F3-M03: inbox deduplica/expira/rejeita/promove e exportação bloqueia db_only, detecta segredos e invalida exceção se digest ou destino mudar",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repo = await env.repository("F3-InboxExport");
    await writeFile(join(repo, "README.md"), "# Inbox & Export\n");
    git(repo, "add", "README.md");
    git(repo, "commit", "-qm", "base");

    const gitBefore = await readGitInvariantSnapshot(repo);
    const client = env.start(env.dataDir);
    const project = await client.request("workspace.addLocal", { path: repo });
    const identity = await client.request("project.identity", {
      projectId: project.id,
    });
    const scope = identity.scope;

    // 1. Deduplication across whitespace/case variants
    const sub1 = await client.request("memory.inboxSubmit", {
      ...scope,
      title: "Padronizar fila local",
      content: "  Usar SQLite   estrito para filas locais  ",
      targetKind: "claim",
      originLabel: "sessao-codex-1",
    });
    const sub2 = await client.request("memory.inboxSubmit", {
      ...scope,
      title: "Padronizar fila local (dup)",
      content: "usar sqlite estrito para filas locais",
      targetKind: "claim",
      originLabel: "sessao-codex-2",
    });
    assert.equal(sub2.proposalId, sub1.proposalId);
    assert.equal(sub2.duplicateCount, 2);
    assert.deepEqual(sub2.origins, ["sessao-codex-1", "sessao-codex-2"]);

    // 2. Expiration without promotion
    const shortTtl = await client.request("memory.inboxSubmit", {
      ...scope,
      title: "Sugestão efêmera",
      content: "Expirar rapidamente antes da revisão.",
      targetKind: "preference",
      originLabel: "ttl-check",
      ttlMs: 500,
    });
    await delay(650);
    const listedAfterTtl = await client.request("memory.inboxList", scope);
    const expiredItem = listedAfterTtl.items.find(
      (i) => i.proposalId === shortTtl.proposalId,
    );
    assert.equal(expiredItem?.status, "expired");
    await assert.rejects(
      client.request("memory.inboxReview", {
        ...scope,
        proposalId: shortTtl.proposalId,
        decision: "approve",
        reviewer: "Operador",
        note: "Tentativa após expiração",
        humanConfirmed: true,
      }),
      { message: "memory_conflict" },
    );

    // 3. Rejection with human confirmation missing & present
    const rejTarget = await client.request("memory.inboxSubmit", {
      ...scope,
      title: "Atalho inseguro",
      content: "Desabilitar verificação de checksum no CAS",
      targetKind: "claim",
      originLabel: "heuristica",
    });
    await assert.rejects(
      client.request("memory.inboxReview", {
        ...scope,
        proposalId: rejTarget.proposalId,
        decision: "reject",
        reviewer: "Operador",
        note: "Sem confirmação explícita",
        humanConfirmed: false,
      }),
      { message: "memory_invalid_input" },
    );
    const rejected = await client.request("memory.inboxReview", {
      ...scope,
      proposalId: rejTarget.proposalId,
      decision: "reject",
      reviewer: "Operador",
      note: "Checksum CAS é invariante obrigatório.",
      humanConfirmed: true,
    });
    assert.equal(rejected.proposal.status, "rejected");
    assert.equal(rejected.feedback.decision, "reject");
    assert.equal(rejected.createdClaim, null);

    // 4. Confirmed human promotion creates human-authorized claim visible on timeline
    const approved = await client.request("memory.inboxReview", {
      ...scope,
      proposalId: sub1.proposalId,
      decision: "approve",
      reviewer: "Autor Principal",
      note: "Promovido após revisão.",
      promoteCanonical: true,
      humanConfirmed: true,
      validFrom: "2026-03-01T00:00:00.000Z",
    });
    assert.equal(approved.proposal.status, "approved");
    assert.ok(approved.createdClaim);
    assert.equal(
      approved.createdClaim.revisions[0]!.authority,
      "human_promoted",
    );

    const tl = await client.request("memory.timeline", {
      ...scope,
      knownAt: new Date(Date.now() + 10_000).toISOString(),
    });
    assert.ok(
      tl.claims.some((c) => c.claimId === approved.createdClaim!.claimId),
    );
    assert.equal(
      tl.claims.some((c) => c.title === "Sugestão efêmera"),
      false,
    );
    assert.equal(
      tl.claims.some((c) => c.title === "Atalho inseguro"),
      false,
    );

    // 5. Export governance: db_only hard-denied
    const dbOnlyItems = [
      {
        itemId: "item-db-1",
        title: "Segredo interno do banco",
        visibility: "db_only" as const,
        content: "Nota privada somente banco",
      },
    ];
    const dbPreview = await client.request("memory.exportPreview", {
      ...scope,
      destinationId: "codex_mock",
      items: dbOnlyItems,
    });
    assert.equal(dbPreview.hardDenied, true);
    assert.equal(dbPreview.eligible, false);
    await assert.rejects(
      client.request("memory.exportExceptionGrant", {
        ...scope,
        bundleDigest: dbPreview.bundleDigest,
        destinationId: "codex_mock",
        policyVersion: dbPreview.policyVersion,
        reviewer: "Autor",
        reason: "Tentativa inválida",
        humanConfirmed: true,
        hasDbOnlyItems: true,
      }),
      { message: "export_denied" },
    );
    await assert.rejects(
      client.request("memory.exportExecute", {
        ...scope,
        destinationId: "codex_mock",
        policyVersion: dbPreview.policyVersion,
        items: dbOnlyItems,
      }),
      { message: "export_denied" },
    );

    // 6. Secret scanner + scoped exception bound to (bundleDigest, destinationId)
    const sensitiveItems = [
      {
        itemId: "item-sec-1",
        title: "Config com token sintético",
        visibility: "local_only" as const,
        content: 'token = "sk-SyntheticSecretToken123456"',
      },
    ];
    const secPreview = await client.request("memory.exportPreview", {
      ...scope,
      destinationId: "codex_mock",
      items: sensitiveItems,
    });
    assert.equal(secPreview.hardDenied, false);
    assert.equal(secPreview.eligible, false);
    assert.equal(secPreview.requiresException, true);
    assert.ok(secPreview.findings.length >= 1);

    await assert.rejects(
      client.request("memory.exportExecute", {
        ...scope,
        destinationId: "codex_mock",
        policyVersion: defaultCompilerPolicyVersion,
        items: sensitiveItems,
      }),
      { message: "export_denied" },
    );

    const exception = await client.request("memory.exportExceptionGrant", {
      ...scope,
      bundleDigest: secPreview.bundleDigest,
      destinationId: "codex_mock",
      policyVersion: secPreview.policyVersion,
      reviewer: "Autor Principal",
      reason: "Teste sintético aprovado em sandbox.",
      humanConfirmed: true,
    });

    const executed = await client.request("memory.exportExecute", {
      ...scope,
      destinationId: "codex_mock",
      policyVersion: secPreview.policyVersion,
      items: sensitiveItems,
      exceptionId: exception.exceptionId,
    });
    assert.equal(executed.bundleDigest, secPreview.bundleDigest);
    assert.equal(executed.exceptionId, exception.exceptionId);

    // Changing content (digest change) OR destination invalidates exception
    await assert.rejects(
      client.request("memory.exportExecute", {
        ...scope,
        destinationId: "codex_mock",
        policyVersion: secPreview.policyVersion,
        items: [
          {
            itemId: "item-sec-1",
            title: "Config alterada",
            visibility: "local_only",
            content: 'token = "sk-SyntheticSecretToken999999"',
          },
        ],
        exceptionId: exception.exceptionId,
      }),
      { message: "export_exception_invalid" },
    );
    await assert.rejects(
      client.request("memory.exportExecute", {
        ...scope,
        destinationId: "local_preview",
        policyVersion: secPreview.policyVersion,
        items: sensitiveItems,
        exceptionId: exception.exceptionId,
      }),
      { message: "export_exception_invalid" },
    );

    await client.close();

    // Verify audit trail persisted on SQLite after service close
    {
      using db = new DatabaseSync(env.database, { readOnly: true });
      const audits = db
        .prepare("SELECT export_id, bundle_digest FROM f3_export_audits")
        .all() as { export_id: string; bundle_digest: string }[];
      assert.equal(audits.length, 1);
      assert.equal(audits[0]!.export_id, executed.exportId);
    }

    const gitAfter = await readGitInvariantSnapshot(repo);
    assert.deepEqual(gitAfter, gitBefore);
  },
);
