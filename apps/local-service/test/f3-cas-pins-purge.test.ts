import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { sha256 } from "../src/context.ts";
import {
  fixture,
  git,
  readGitInvariantSnapshot,
} from "./fixtures/ipc-harness.ts";

test(
  "F3-T05 / F3-M02: pin CAS sobrevive à remoção da origem, cota bloqueia publicação, GC protege última prova ativa, expurgo retoma após reinício e tombstones impedem ressurreição em backup",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);

    // 1. Pinned context excerpt remains verifiable after origin file & repo deletion; unpinned ref shows gap
    const repoEphemeral = await env.repository("Ephemeral-Repo");
    await mkdir(join(repoEphemeral, "src"), { recursive: true });
    const trackedFile = "src/proof.txt";
    const proofText = "Prova crítica que deve resistir à exclusão do repo.\n";
    await writeFile(join(repoEphemeral, trackedFile), proofText);
    git(repoEphemeral, "add", trackedFile);
    git(repoEphemeral, "commit", "-qm", "ephemeral base");

    let client = env.start(env.dataDir);
    const ephProj = await client.request("workspace.addLocal", {
      path: repoEphemeral,
    });
    const ephScope = (
      await client.request("project.identity", { projectId: ephProj.id })
    ).scope;
    const snap = await client.request("context.capture", {
      projectId: ephProj.id,
      paths: [trackedFile],
    });
    const entry = snap.entries.find((e) => e.path === trackedFile);
    assert.ok(entry?.outcome === "included");
    await client.request("context.index", {
      projectId: ephProj.id,
      contextId: snap.contextId,
      force: true,
    });
    const unpinnedRef = {
      contextId: snap.contextId,
      path: trackedFile,
      sha256: entry.sha256,
      chunk: 0,
    };
    const durablePin = await client.request("memory.pinCreate", {
      ...ephScope,
      label: "Prova fixada no CAS",
      source: { kind: "context_excerpt", ...unpinnedRef },
    });

    assert.equal(
      (
        await client.request("memory.pinVerify", {
          ...ephScope,
          pinId: durablePin.pinId,
        })
      ).state,
      "verified",
    );
    assert.equal(
      (await client.request("memory.pinVerify", { ...ephScope, unpinnedRef }))
        .state,
      "verified",
    );

    // Delete origin file AND remove entire ephemeral repo
    await unlink(join(repoEphemeral, trackedFile));
    await rm(repoEphemeral, { recursive: true, force: true });

    const verifiedPinAfterDelete = await client.request("memory.pinVerify", {
      ...ephScope,
      pinId: durablePin.pinId,
    });
    const unpinnedAfterDelete = await client.request("memory.pinVerify", {
      ...ephScope,
      unpinnedRef,
    });
    assert.equal(verifiedPinAfterDelete.state, "verified");
    assert.equal(verifiedPinAfterDelete.source, "cas_pin");
    assert.equal(unpinnedAfterDelete.state, "gap");

    // 2. Durable main repository for quota, GC, protected proof, resumable purge, and backup tombstone check
    const repoMain = await env.repository("Main-CAS");
    await writeFile(join(repoMain, "README.md"), "# CAS Governance\n");
    git(repoMain, "add", "README.md");
    git(repoMain, "commit", "-qm", "main base");
    const gitBefore = await readGitInvariantSnapshot(repoMain);

    const mainProj = await client.request("workspace.addLocal", {
      path: repoMain,
    });
    const scope = (
      await client.request("project.identity", { projectId: mainProj.id })
    ).scope;

    // Quota overflow fails atomically BEFORE publishing any manifest row
    const beforeQuotaCount = (await client.request("memory.pinList", scope))
      .items.length;
    await assert.rejects(
      client.request("memory.pinCreate", {
        ...scope,
        label: "Pin acima da cota",
        source: { kind: "inline", content: "A".repeat(256) },
        quotaBytes: 64,
      }),
      { message: "pin_quota_exceeded" },
    );
    const afterQuotaCount = (await client.request("memory.pinList", scope))
      .items.length;
    assert.equal(afterQuotaCount, beforeQuotaCount);

    // Protect last active proof of active claim
    const claim = await client.request("memory.claimRecord", {
      ...scope,
      requestId: "claim-cas-protect-1",
      title: "Afirmação protegida",
      content: "Última prova ativa não pode ser solta nem coletada.",
      author: "Autor",
      reason: "Teste proteção GC",
      validFrom: "2026-01-01T00:00:00.000Z",
    });
    const protectedPin = await client.request("memory.pinCreate", {
      ...scope,
      label: "Última prova da afirmação",
      source: { kind: "inline", content: "Bytes protegidos da última prova." },
      protectedClaimId: claim.claimId,
    });
    await assert.rejects(
      client.request("memory.pinRelease", {
        ...scope,
        pinId: protectedPin.pinId,
        humanConfirmed: true,
      }),
      { message: "pin_protected" },
    );

    // Plant an unreferenced orphan blob directly under <dataDir>/cas to verify GC collects ONLY orphans
    const orphanBytes = Buffer.from("blob-orfao-gc-f3", "utf8");
    const orphanDigest = sha256(orphanBytes);
    const orphanDir = join(env.dataDir, "cas", orphanDigest.slice(0, 2));
    await mkdir(orphanDir, { recursive: true });
    await writeFile(join(orphanDir, orphanDigest), orphanBytes);

    const gc = await client.request("memory.gcRun", {
      ...scope,
      humanConfirmed: true,
    });
    assert.ok(gc.deletedDigests.includes(orphanDigest));
    assert.ok(gc.protectedDigests.includes(protectedPin.digest));
    assert.equal(
      (
        await client.request("memory.pinVerify", {
          ...scope,
          pinId: protectedPin.pinId,
        })
      ).state,
      "verified",
    );

    // 3. Resumable interrupted multi-stage purge preserving shared CAS blobs
    const sharedText = `Conteúdo compartilhado ${randomBytes(4).toString("hex")}`;
    const sharedPinA = await client.request("memory.pinCreate", {
      ...scope,
      label: "Pin compartilhado A (expurgável)",
      source: { kind: "inline", content: sharedText },
    });
    const sharedPinB = await client.request("memory.pinCreate", {
      ...scope,
      label: "Pin compartilhado B (sobrevivente)",
      source: { kind: "inline", content: sharedText },
    });
    assert.equal(sharedPinA.digest, sharedPinB.digest);

    const pausedJob = await client.request("memory.purgeStart", {
      ...scope,
      targetKind: "pin",
      targetId: sharedPinA.pinId,
      reason: "Teste interrupção e retomada",
      humanConfirmed: true,
      maxSteps: 1,
    });
    assert.equal(pausedJob.stage, "access_revoked");
    assert.equal(pausedJob.state, "in_progress");

    const hiddenImmediately = await client.request("memory.pinList", scope);
    assert.equal(
      hiddenImmediately.items.some((p) => p.pinId === sharedPinA.pinId),
      false,
    );

    // Restart service and resume purge
    await client.close();
    client = env.start(env.dataDir);

    const resumed = await client.request("memory.purgeResume", {
      ...scope,
      purgeId: pausedJob.purgeId,
    });
    assert.equal(resumed.stage, "completed");
    assert.equal(resumed.state, "completed");
    assert.equal(resumed.preservedSharedBlobs, true);
    assert.equal(resumed.removedBlobs, 0);
    assert.equal(
      (
        await client.request("memory.pinVerify", {
          ...scope,
          pinId: sharedPinB.pinId,
        })
      ).state,
      "verified",
    );

    // 4. Backup restoration while tombstone journal persists -> ZERO resurrection
    const disposableClaim = await client.request("memory.claimRecord", {
      ...scope,
      requestId: "claim-backup-purge",
      title: "Afirmação pré-backup expurgada",
      content: "Não deve ressuscitar ao restaurar SQLite antigo.",
      author: "Autor",
      reason: "Teste anti-ressurreição",
      validFrom: "2026-01-01T00:00:00.000Z",
    });
    const disposablePin = await client.request("memory.pinCreate", {
      ...scope,
      label: "Pin exclusivo pré-backup",
      source: {
        kind: "inline",
        content: "Conteudo-exclusivo-expurgavel-backup",
      },
    });

    await client.close();
    const backupDbPath = join(env.root, "pre-purge-backup.sqlite");
    await cp(env.database, backupDbPath);

    client = env.start(env.dataDir);
    await client.request("memory.purgeStart", {
      ...scope,
      targetKind: "pin",
      targetId: disposablePin.pinId,
      reason: "Expurgo definitivo pós-backup",
      humanConfirmed: true,
    });
    await client.request("memory.purgeStart", {
      ...scope,
      targetKind: "claim",
      targetId: disposableClaim.claimId,
      reason: "Expurgo definitivo claim pós-backup",
      humanConfirmed: true,
    });
    await client.close();

    // Restore pre-purge SQLite DB while keeping f3-purge-tombstones.json in dataDir
    await rm(`${env.database}-wal`, { force: true });
    await rm(`${env.database}-shm`, { force: true });
    await cp(backupDbPath, env.database);

    client = env.start(env.dataDir);
    const pinsPostRestore = await client.request("memory.pinList", scope);
    assert.equal(
      pinsPostRestore.items.some((p) => p.pinId === disposablePin.pinId),
      false,
    );
    const verifyRestoredPin = await client.request("memory.pinVerify", {
      ...scope,
      pinId: disposablePin.pinId,
    });
    assert.equal(verifyRestoredPin.state, "gap");

    const timelinePostRestore = await client.request("memory.timeline", {
      ...scope,
      knownAt: new Date(Date.now() + 10_000).toISOString(),
    });
    assert.equal(
      timelinePostRestore.claims.some(
        (c) => c.claimId === disposableClaim.claimId,
      ),
      false,
    );

    await client.close();
    const gitAfter = await readGitInvariantSnapshot(repoMain);
    assert.deepEqual(gitAfter, gitBefore);
  },
);
