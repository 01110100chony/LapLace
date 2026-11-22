import assert from "node:assert/strict";
import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { sha256 } from "../src/context.ts";
import {
  buildF1LegacyFixture,
  createConsistentCatalogCopy,
  OMITTED_SOURCE_PATH,
  PRESERVED_SOURCE_CONTENT,
} from "./fixtures/f1-legacy-catalog.ts";
import { fixture, git } from "./fixtures/ipc-harness.ts";

test(
  "F1-T05.A1: resolve fonte histórica imutável mesmo após edição/ausência/reindexação, recusa escopo cruzado e distingue lacunas",
  { timeout: 60_000 },
  async (t) => {
    const built = await buildF1LegacyFixture(t);
    const { env, projectA, projectB, snapshot, sourceRef, copy } = built;

    const service = env.start(copy.copyDataDir, "completed");
    const idA = await service.request("project.identity", {
      projectId: projectA.id,
    });
    const idB = await service.request("project.identity", {
      projectId: projectB.id,
    });

    const resolvedInitial = await service.request("decision.evidenceResolve", {
      ...idA.scope,
      ...sourceRef,
    });
    assert.equal(resolvedInitial.evidence.state, "verified");
    assert.equal(resolvedInitial.evidence.coverage, "partial");
    assert.equal(resolvedInitial.evidence.durability, "durable_blob");
    assert.equal(resolvedInitial.evidence.sourceOrigin, "context_search");
    assert.equal(resolvedInitial.snapshotStatus, "partial");
    assert.equal(resolvedInitial.reindexedPreserved, true);
    assert.equal(resolvedInitial.excerpt?.text, PRESERVED_SOURCE_CONTENT);
    assert.equal(
      resolvedInitial.excerpt?.sha256,
      sha256(PRESERVED_SOURCE_CONTENT),
    );
    assert.deepEqual(resolvedInitial.omittedPaths, [
      { path: OMITTED_SOURCE_PATH, reason: "excluded" },
    ]);

    // Force reindex and verify exact bytes are preserved.
    await service.request("context.index", {
      projectId: projectA.id,
      contextId: snapshot.contextId,
      force: true,
    });
    const resolvedReindexed = await service.request(
      "decision.evidenceResolve",
      {
        ...idA.scope,
        ...sourceRef,
      },
    );
    assert.equal(resolvedReindexed.reindexedPreserved, true);
    assert.deepEqual(resolvedReindexed.excerpt, resolvedInitial.excerpt);

    // Invalid chunk after reindex yields an explicit gap rather than falling back to disk.
    const invalidChunk = await service.request("decision.evidenceResolve", {
      ...idA.scope,
      ...sourceRef,
      chunk: 99,
    });
    assert.equal(invalidChunk.evidence.state, "gap");
    assert.equal(invalidChunk.evidence.gap, "source_unavailable");
    assert.equal(invalidChunk.excerpt, null);

    // Mutate the live file on disk AND remove checkout A; preserved bytes remain intact.
    await writeFile(
      join(projectA.root, sourceRef.path),
      "// Arquivo ao vivo alterado depois.\n",
    );
    const missingRoot = join(env.root, "Projeto-A-Ausente");
    await rename(projectA.root, missingRoot);
    const afterMissing = await service.request("decision.evidenceResolve", {
      ...idA.scope,
      ...sourceRef,
    });
    assert.equal(afterMissing.evidence.state, "verified");
    assert.equal(afterMissing.excerpt?.text, PRESERVED_SOURCE_CONTENT);
    await rename(missingRoot, projectA.root);

    // Cross-scope resolution in B must reject without exposing metadata.
    await assert.rejects(
      service.request("decision.evidenceResolve", {
        ...idB.scope,
        ...sourceRef,
      }),
      { message: "context_source_unavailable" },
    );

    // Omitted path yields explicit source_omitted gap.
    const omittedGap = await service.request("decision.evidenceResolve", {
      ...idA.scope,
      contextId: snapshot.contextId,
      path: OMITTED_SOURCE_PATH,
      sha256: "0".repeat(64),
      chunk: 0,
    });
    assert.equal(omittedGap.evidence.state, "gap");
    assert.equal(omittedGap.evidence.gap, "source_omitted");
    assert.equal(omittedGap.evidence.coverage, "partial");

    // Wrong digest yields source_digest_mismatch.
    const wrongDigestGap = await service.request("decision.evidenceResolve", {
      ...idA.scope,
      ...sourceRef,
      sha256: "0".repeat(64),
    });
    assert.equal(wrongDigestGap.evidence.state, "gap");
    assert.equal(wrongDigestGap.evidence.gap, "source_digest_mismatch");

    // Nonexistent snapshot yields source_unavailable.
    const missingSnapshotGap = await service.request(
      "decision.evidenceResolve",
      {
        ...idA.scope,
        ...sourceRef,
        contextId: "9".repeat(64),
      },
    );
    assert.equal(missingSnapshotGap.evidence.state, "gap");
    assert.equal(missingSnapshotGap.evidence.gap, "source_unavailable");
    await service.close();

    // Corrupt stored blob bytes and confirm digest mismatch on reopen.
    {
      using database = new DatabaseSync(copy.copyDatabase);
      database
        .prepare("UPDATE context_blobs SET bytes = ? WHERE sha256 = ?")
        .run(Buffer.from("blob corrompido"), sourceRef.sha256);
    }
    const reopened = env.start(copy.copyDataDir);
    const corruptedGap = await reopened.request("decision.evidenceResolve", {
      ...idA.scope,
      ...sourceRef,
    });
    assert.equal(corruptedGap.evidence.state, "gap");
    assert.equal(corruptedGap.evidence.gap, "source_digest_mismatch");
    assert.equal(corruptedGap.excerpt, null);
    await reopened.close();
  },
);

test(
  "F1-T06.A1: persiste decisão humana versionada atomicamente com autor, fonte, idempotência e distinção de revisão Mock",
  { timeout: 60_000 },
  async (t) => {
    const built = await buildF1LegacyFixture(t);
    const {
      env,
      projectA,
      projectB,
      copy,
      sourceRef,
      review,
      reviewStatusBeforeRestart,
    } = built;

    const service = env.start(copy.copyDataDir, "completed");
    const idA = await service.request("project.identity", {
      projectId: projectA.id,
    });
    const idB = await service.request("project.identity", {
      projectId: projectB.id,
    });

    // Reject missing human confirmation.
    await assert.rejects(
      service.request("decision.record", {
        ...idA.scope,
        requestId: "req-no-auth",
        assertionId: null,
        expectedRevision: 0,
        content: "Não deveria salvar sem confirmação humana.",
        author: "Operador Local",
        reason: "Teste de autorização",
        humanConfirmed: false,
        evidence: sourceRef,
      }),
      { message: "decision_authorization_required" },
    );

    // Reject cross-scope evidence attachment.
    await assert.rejects(
      service.request("decision.record", {
        ...idB.scope,
        requestId: "req-cross",
        assertionId: null,
        expectedRevision: 0,
        content: "Não deveria vincular captura de A em B.",
        author: "Operador Local",
        reason: "Teste de isolamento",
        humanConfirmed: true,
        evidence: sourceRef,
      }),
      { message: "context_source_unavailable" },
    );

    // Reject promoting to canonical_verified without verified evidence.
    await assert.rejects(
      service.request("decision.record", {
        ...idA.scope,
        requestId: "req-promote-no-ev",
        assertionId: null,
        expectedRevision: 0,
        content: "Sem lastro não promove.",
        author: "Operador Local",
        reason: "Teste de promoção",
        humanConfirmed: true,
        promoteCanonical: true,
        evidence: null,
      }),
      { message: "decision_conflict" },
    );

    // Record rev 1 local_only with verified evidence.
    const rev1 = await service.request("decision.record", {
      ...idA.scope,
      requestId: "req-create-1",
      assertionId: null,
      expectedRevision: 0,
      content: "Usar contrato aditivo offline para F1.",
      author: "Autor A",
      reason: "Decisão inicial validada",
      humanConfirmed: true,
      promoteCanonical: false,
      evidence: sourceRef,
    });
    assert.equal(rev1.revision, 1);
    assert.equal(rev1.authority, "human_local");
    assert.equal(rev1.visibility, "local_only");
    assert.equal(rev1.status, "active");
    assert.equal(rev1.sourceOrigin, "human_decision");
    assert.equal(rev1.evidence.state, "verified");

    // Idempotent replay with same requestId returns identical revision.
    const replay1 = await service.request("decision.record", {
      ...idA.scope,
      requestId: "req-create-1",
      assertionId: null,
      expectedRevision: 0,
      content: "Usar contrato aditivo offline para F1.",
      author: "Autor A",
      reason: "Decisão inicial validada",
      humanConfirmed: true,
      promoteCanonical: false,
      evidence: sourceRef,
    });
    assert.deepEqual(replay1, rev1);

    // Revise to rev 2 and promote explicitly to canonical_verified.
    await delay(5);
    const rev2 = await service.request("decision.record", {
      ...idA.scope,
      requestId: "req-rev-2",
      assertionId: rev1.assertionId,
      expectedRevision: 1,
      content: "Usar contrato aditivo offline + promoção explícita.",
      author: "Autor A",
      reason: "Revisão e promoção humana",
      humanConfirmed: true,
      promoteCanonical: true,
      evidence: sourceRef,
    });
    assert.equal(rev2.assertionId, rev1.assertionId);
    assert.equal(rev2.revision, 2);
    assert.equal(rev2.authority, "human_promoted");
    assert.equal(rev2.visibility, "canonical_verified");

    // Reject obsolete expectedRevision: 1.
    await assert.rejects(
      service.request("decision.record", {
        ...idA.scope,
        requestId: "req-stale",
        assertionId: rev1.assertionId,
        expectedRevision: 1,
        content: "Revisão obsoleta.",
        author: "Autor A",
        reason: "Conflito esperado",
        humanConfirmed: true,
        evidence: sourceRef,
      }),
      { message: "decision_conflict" },
    );

    // Replaying an earlier revision's requestId with mismatched expectedRevision or effectiveAt must fail.
    await assert.rejects(
      service.request("decision.record", {
        ...idA.scope,
        requestId: "req-create-1",
        assertionId: rev1.assertionId,
        expectedRevision: 1,
        content: "Usar contrato aditivo offline para F1.",
        author: "Autor A",
        reason: "Decisão inicial validada",
        humanConfirmed: true,
        promoteCanonical: false,
        evidence: sourceRef,
      }),
      { message: "decision_conflict" },
    );
    await assert.rejects(
      service.request("decision.record", {
        ...idA.scope,
        requestId: "req-create-1",
        assertionId: null,
        expectedRevision: 2,
        content: "Usar contrato aditivo offline para F1.",
        author: "Autor A",
        reason: "Decisão inicial validada",
        humanConfirmed: true,
        promoteCanonical: false,
        evidence: sourceRef,
      }),
      { message: "decision_conflict" },
    );
    await assert.rejects(
      service.request("decision.record", {
        ...idA.scope,
        requestId: "req-create-1",
        assertionId: null,
        expectedRevision: 0,
        content: "Usar contrato aditivo offline para F1.",
        author: "Autor A",
        reason: "Decisão inicial validada",
        humanConfirmed: true,
        promoteCanonical: false,
        effectiveAt: "2020-01-01T00:00:00.000Z",
        evidence: sourceRef,
      }),
      { message: "decision_conflict" },
    );

    // A newer local_only decision must not outrank an older canonical_verified decision in decision.list or project.resume.
    await delay(5);
    const newerLocal = await service.request("decision.record", {
      ...idA.scope,
      requestId: "req-newer-local",
      assertionId: null,
      expectedRevision: 0,
      content: "Nota local mais recente que a decisão canônica.",
      author: "Autor A",
      reason: "Teste de precedência list vs resume",
      humanConfirmed: true,
      promoteCanonical: false,
      evidence: null,
    });
    const rankedList = await service.request("decision.list", idA.scope);
    assert.equal(rankedList.items.length, 2);
    assert.equal(rankedList.active?.assertionId, rev2.assertionId);
    const resumedParity = await service.request("project.resume", idA.scope);
    assert.equal(resumedParity.memory.state, "available");
    assert.equal(resumedParity.memory.decision.assertionId, rev2.assertionId);
    // Clean up the temporary newer local decision before verifying restart counts below.
    await service.request("decision.purge", {
      ...idA.scope,
      assertionId: newerLocal.assertionId,
      expectedRevision: 1,
      confirmedScope: true,
      reason: "Limpeza pós-verificação de paridade",
    });

    // Reject cross-project decision read.
    await assert.rejects(
      service.request("decision.get", {
        ...idB.scope,
        assertionId: rev1.assertionId,
      }),
      { message: "decision_unavailable" },
    );
    await service.close();

    // Fault injection between decision_revisions and decision_evidence_links must roll back both.
    {
      using database = new DatabaseSync(copy.copyDatabase);
      database.exec(`
        CREATE TRIGGER inject_evidence_link_fault
        BEFORE INSERT ON decision_evidence_links
        BEGIN
          SELECT RAISE(ABORT, 'injected_evidence_link_fault');
        END;
      `);
    }

    const faultService = env.start(copy.copyDataDir);
    await assert.rejects(
      faultService.request("decision.record", {
        ...idA.scope,
        requestId: "req-fault",
        assertionId: null,
        expectedRevision: 0,
        content: "Decisão que deve sofrer rollback total.",
        author: "Autor A",
        reason: "Injeção de falha",
        humanConfirmed: true,
        evidence: sourceRef,
      }),
      { message: "catalog_unavailable" },
    );
    await faultService.close();

    {
      using database = new DatabaseSync(copy.copyDatabase);
      database.exec("DROP TRIGGER inject_evidence_link_fault;");
      assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM decisions").get()?.c,
        1,
      );
      assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM decision_revisions").get()
          ?.c,
        2,
      );
    }

    // Reopen after restart and confirm full revision history + untouched mock review history.
    const restarted = env.start(copy.copyDataDir);
    const listA = await restarted.request("decision.list", idA.scope);
    assert.equal(listA.items.length, 1);
    assert.equal(listA.active?.assertionId, rev1.assertionId);
    assert.equal(listA.active?.revision, 2);
    assert.equal(listA.active?.evidence.state, "verified");
    assert.equal(listA.active?.evidence.sourceOrigin, "context_search");

    const detailA = await restarted.request("decision.get", {
      ...idA.scope,
      assertionId: rev1.assertionId,
    });
    assert.equal(detailA.revisions.length, 2);
    assert.equal(detailA.revisions[0]?.status, "superseded");
    assert.equal(detailA.revisions[0]?.evidence.state, "verified");
    assert.equal(detailA.revisions[1]?.status, "active");
    assert.equal(detailA.revisions[1]?.author, "Autor A");
    assert.equal(detailA.revisions[1]?.evidence.state, "verified");

    const listB = await restarted.request("decision.list", idB.scope);
    assert.equal(listB.items.length, 0);

    // Legacy mock task review stays completely distinct and preserved.
    assert.deepEqual(
      await restarted.request("result.reviewStatus", {
        projectId: projectA.id,
        taskId: review.taskId,
        executionId: review.executionId,
      }),
      reviewStatusBeforeRestart,
    );
    await restarted.close();
  },
);

test(
  "F1-T07.A1: expurgo apaga decisão/derivados F1 sem ressuscitar após backup/reinício/reindex e preserva captura compartilhada",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repo = await env.repository("Projeto Expurgo");
    git(repo, "config", "core.autocrlf", "false");
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(
      join(repo, "src", "fonte.ts"),
      "export const dadoCompartilhado = 'preservado';\n",
    );
    git(repo, "add", "--", "src/fonte.ts");
    git(repo, "commit", "-qm", "base");

    const service = env.start();
    const project = await service.request("workspace.addLocal", { path: repo });
    const identity = await service.request("project.identity", {
      projectId: project.id,
    });
    const capture = await service.request("context.capture", {
      projectId: project.id,
      paths: ["src/fonte.ts"],
    });
    await service.request("context.index", {
      projectId: project.id,
      contextId: capture.contextId,
      force: true,
    });
    const included = capture.entries[0];
    assert.ok(included?.outcome === "included");
    const ref = {
      contextId: capture.contextId,
      path: included.path,
      sha256: included.sha256,
      chunk: 0,
    };

    const secretMarker = "CANARIO-EXPURGO-SEGREDO-SINTETICO";
    const victim = await service.request("decision.record", {
      ...identity.scope,
      requestId: "req-victim",
      assertionId: null,
      expectedRevision: 0,
      content: secretMarker,
      author: "Autor A",
      reason: "Decisão a ser expurgada",
      humanConfirmed: true,
      evidence: ref,
    });
    const survivor = await service.request("decision.record", {
      ...identity.scope,
      requestId: "req-survivor",
      assertionId: null,
      expectedRevision: 0,
      content: "Decisão preservada compartilhando a mesma captura.",
      author: "Autor A",
      reason: "Outra origem legítima",
      humanConfirmed: true,
      evidence: ref,
    });

    // Reject unconfirmed and stale-revision purge requests.
    await assert.rejects(
      service.request("decision.purge", {
        ...identity.scope,
        assertionId: victim.assertionId,
        expectedRevision: 1,
        confirmedScope: false,
        reason: "Sem confirmação",
      }),
      { message: "decision_authorization_required" },
    );
    await assert.rejects(
      service.request("decision.purge", {
        ...identity.scope,
        assertionId: victim.assertionId,
        expectedRevision: 99,
        confirmedScope: true,
        reason: "Revisão obsoleta",
      }),
      { message: "decision_conflict" },
    );
    await service.close();

    // Take a consistent pre-purge backup of catalog.sqlite3.
    const prePurgeBackup = await createConsistentCatalogCopy(
      env.dataDir,
      env.database,
      join(env.root, "pre-purge-backup"),
    );

    const activeService = env.start();
    const receipt = await activeService.request("decision.purge", {
      ...identity.scope,
      assertionId: victim.assertionId,
      expectedRevision: 1,
      confirmedScope: true,
      reason: "Limpeza deliberada F1",
    });
    assert.equal(receipt.status, "purged");
    assert.equal(receipt.removed.revisions, 1);
    assert.equal(receipt.removed.evidenceLinks, 1);
    assert.equal(receipt.preservedSharedBlobs, true);
    assert.equal(receipt.scopeBoundary, "f1_local_decisions_only");

    // Idempotent second purge succeeds safely.
    const replayPurge = await activeService.request("decision.purge", {
      ...identity.scope,
      assertionId: victim.assertionId,
      expectedRevision: 1,
      confirmedScope: true,
      reason: "Segunda chamada segura",
    });
    assert.equal(replayPurge.status, "already_purged");
    assert.equal(replayPurge.tombstoneId, receipt.tombstoneId);

    // Purged assertion is inaccessible; survivor and shared C01/C02 capture remain valid.
    await assert.rejects(
      activeService.request("decision.get", {
        ...identity.scope,
        assertionId: victim.assertionId,
      }),
      { message: "decision_unavailable" },
    );
    const listAfterPurge = await activeService.request(
      "decision.list",
      identity.scope,
    );
    assert.equal(listAfterPurge.items.length, 1);
    assert.equal(listAfterPurge.active?.assertionId, survivor.assertionId);

    const reindexed = await activeService.request("context.index", {
      projectId: project.id,
      contextId: capture.contextId,
      force: true,
    });
    assert.equal(reindexed.files, 1);
    assert.equal(
      (
        await activeService.request("context.sourcePreview", {
          projectId: project.id,
          ...ref,
        })
      ).text,
      "export const dadoCompartilhado = 'preservado';\n",
    );
    await activeService.close();

    // Tombstone journal contains zero sensitive decision text.
    const journalText = await readFile(
      join(env.dataDir, "purge-tombstones.json"),
      "utf8",
    );
    assert.equal(journalText.includes(secretMarker), false);

    // Restore pre-purge SQLite backup over env.database while keeping tombstones journal,
    // restart sidecar, and prove reconcileTombstones suppresses resurrection.
    await cp(prePurgeBackup.copyDatabase, env.database, { force: true });
    const restored = env.start();
    await assert.rejects(
      restored.request("decision.get", {
        ...identity.scope,
        assertionId: victim.assertionId,
      }),
      { message: "decision_unavailable" },
    );
    const listAfterRestore = await restored.request(
      "decision.list",
      identity.scope,
    );
    assert.equal(listAfterRestore.items.length, 1);
    assert.equal(listAfterRestore.active?.assertionId, survivor.assertionId);
    const survivorEvidence = await restored.request(
      "decision.evidenceResolve",
      { ...identity.scope, ...ref },
    );
    assert.equal(survivorEvidence.evidence.state, "verified");
    await restored.close();
  },
);
