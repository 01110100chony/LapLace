import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openCatalog } from "../src/catalog.ts";
import { sha256 } from "../src/context.ts";
import { createDirtyOverlayService } from "../src/dirty-overlay-service.ts";
import {
  fixture,
  git,
  isolatedGitEnv,
  readGitInvariantSnapshot,
} from "./fixtures/ipc-harness.ts";

function runGitRaw(
  cwd: string,
  args: string[],
  input?: Buffer | string,
): { status: number | null; stdout: string } {
  const res = spawnSync(
    "git",
    [
      "-C",
      cwd,
      "-c",
      "user.name=Laplace Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    {
      input,
      encoding: "utf8",
      windowsHide: true,
      env: isolatedGitEnv(),
    },
  );
  return { status: res.status, stdout: (res.stdout ?? "").trim() };
}

test(
  "F3-T09 / F3-M04: captura e reconstrução fiel de Dirty Overlay (§17: HEAD ausente, conflito multiestágio, CRLF bruto, deleção, symlink/gitlink, OCC real, blob faltante e bloqueio de destino inseguro)",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);

    // Part A: Unborn HEAD repo with raw CRLF untracked + staged files
    const repoUnborn = await env.repository("Overlay-Unborn");
    git(repoUnborn, "config", "core.autocrlf", "false");
    const unbornCrlf = Buffer.from("unborn-line-1\r\nunborn-line-2\r\n");
    await writeFile(join(repoUnborn, "init.txt"), unbornCrlf);
    git(repoUnborn, "add", "init.txt");
    const unbornBefore = await readGitInvariantSnapshot(repoUnborn);

    const client = env.start(env.dataDir);
    const unbornProj = await client.request("workspace.addLocal", {
      path: repoUnborn,
    });
    const unbornScope = (
      await client.request("project.identity", { projectId: unbornProj.id })
    ).scope;

    const unbornManifest = await client.request("memory.overlayCapture", {
      ...unbornScope,
      label: "Overlay unborn HEAD",
    });
    assert.equal(unbornManifest.head, null);
    assert.ok(
      unbornManifest.files.some((f) => f.path === "init.txt" && f.crlf),
    );
    const unbornVerify = await client.request("memory.overlayVerify", {
      ...unbornScope,
      overlayId: unbornManifest.overlayId,
    });
    assert.equal(unbornVerify.intact, true);
    const unbornTarget = join(env.root, "reconstruct-unborn");
    const unbornRec = await client.request("memory.overlayReconstruct", {
      ...unbornScope,
      overlayId: unbornManifest.overlayId,
      targetDir: unbornTarget,
      disposableTargetConfirmed: true,
    });
    assert.equal(unbornRec.intact, true);
    assert.equal(
      (await readFile(join(unbornTarget, "init.txt"))).equals(unbornCrlf),
      true,
    );
    assert.deepEqual(await readGitInvariantSnapshot(repoUnborn), unbornBefore);

    // Part B: Full §17 dirty overlay fixture (CRLF, deleted, merge conflict stages 1/2/3, 120000 symlink, 160000 gitlink)
    const repo = await env.repository("Overlay-Main");
    git(repo, "config", "core.autocrlf", "false");
    await writeFile(join(repo, "mod.txt"), Buffer.from("orig-1\r\norig-2\r\n"));
    await writeFile(join(repo, "del.txt"), "apagar-este-arquivo\n");
    await writeFile(join(repo, "conflict.txt"), "linha-base\n");
    git(repo, "add", "mod.txt", "del.txt", "conflict.txt");
    git(repo, "commit", "-qm", "base");
    const baseBranch = git(repo, "symbolic-ref", "--short", "HEAD");
    const baseCommit = git(repo, "rev-parse", "HEAD");

    git(repo, "checkout", "-qb", "side-b");
    await writeFile(join(repo, "conflict.txt"), "versao-side-b\n");
    git(repo, "commit", "-qam", "side b change");

    git(repo, "checkout", "-q", baseBranch);
    await writeFile(join(repo, "conflict.txt"), "versao-side-a\n");
    git(repo, "commit", "-qam", "side a change");

    // Genuine merge conflict creating stages 1, 2, 3 in .git/index
    const mergeRes = runGitRaw(repo, ["merge", "side-b"]);
    assert.notEqual(mergeRes.status, 0);

    // Index-only symlink (120000) and gitlink (160000) work portably without OS symlink elevation
    const symHash = runGitRaw(
      repo,
      ["hash-object", "-w", "--stdin"],
      "../target-relativo.txt",
    );
    assert.equal(symHash.status, 0);
    git(
      repo,
      "update-index",
      "--add",
      "--cacheinfo",
      `120000,${symHash.stdout},linked.txt`,
    );
    git(
      repo,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${baseCommit},submod`,
    );

    const modEdited = Buffer.from("edited-1\r\nedited-2\r\n");
    const addedRaw = Buffer.from("untracked-1\r\nuntracked-2\r\n");
    await writeFile(join(repo, "mod.txt"), modEdited);
    await rm(join(repo, "del.txt"));
    await writeFile(join(repo, "added.txt"), addedRaw);

    const gitBefore = await readGitInvariantSnapshot(repo);

    const mainProj = await client.request("workspace.addLocal", { path: repo });
    const scope = (
      await client.request("project.identity", { projectId: mainProj.id })
    ).scope;

    const captured = await client.request("memory.overlayCapture", {
      ...scope,
      label: "Overlay completo §17",
    });

    const byPath = new Map(captured.files.map((f) => [f.path, f]));
    assert.equal(byPath.get("mod.txt")?.kind, "modified");
    assert.equal(byPath.get("mod.txt")?.crlf, true);
    assert.equal(byPath.get("added.txt")?.kind, "added");
    assert.equal(byPath.get("added.txt")?.crlf, true);
    assert.equal(byPath.get("del.txt")?.kind, "deleted");

    const conflictFile = byPath.get("conflict.txt");
    assert.equal(conflictFile?.kind, "conflicted");
    assert.deepEqual(
      conflictFile?.stages.map((s) => s.stage),
      [1, 2, 3],
    );

    const symlinkFile = byPath.get("linked.txt");
    assert.equal(symlinkFile?.kind, "symlink");
    assert.equal(symlinkFile?.symlinkTarget, "../target-relativo.txt");
    assert.equal(symlinkFile?.gap, "symlink_target_only");

    const gitlinkFile = byPath.get("submod");
    assert.equal(gitlinkFile?.kind, "gitlink");
    assert.equal(gitlinkFile?.gitlinkOid, baseCommit);
    assert.equal(gitlinkFile?.gap, "gitlink_pointer_only");

    const verifyOk = await client.request("memory.overlayVerify", {
      ...scope,
      overlayId: captured.overlayId,
    });
    assert.equal(verifyOk.intact, true);

    // Safety refusals for target reconstruction
    const safeDisposable = join(env.root, "disposable-target");
    await assert.rejects(
      client.request("memory.overlayReconstruct", {
        ...scope,
        overlayId: captured.overlayId,
        targetDir: safeDisposable,
        disposableTargetConfirmed: false,
      }),
      { message: "overlay_unsafe_target" },
    );
    await assert.rejects(
      client.request("memory.overlayReconstruct", {
        ...scope,
        overlayId: captured.overlayId,
        targetDir: repo,
        disposableTargetConfirmed: true,
      }),
      { message: "overlay_unsafe_target" },
    );
    await assert.rejects(
      client.request("memory.overlayReconstruct", {
        ...scope,
        overlayId: captured.overlayId,
        targetDir: join(repo, "nested"),
        disposableTargetConfirmed: true,
      }),
      { message: "overlay_unsafe_target" },
    );
    await assert.rejects(
      client.request("memory.overlayReconstruct", {
        ...scope,
        overlayId: captured.overlayId,
        targetDir: env.dataDir,
        disposableTargetConfirmed: true,
      }),
      { message: "overlay_unsafe_target" },
    );

    // Pre-populate del.txt inside disposable target to verify deletion behavior + CRLF fidelity
    await mkdir(safeDisposable, { recursive: true });
    await writeFile(join(safeDisposable, "del.txt"), "stale file to delete");

    const rec = await client.request("memory.overlayReconstruct", {
      ...scope,
      overlayId: captured.overlayId,
      targetDir: safeDisposable,
      disposableTargetConfirmed: true,
    });
    assert.equal(rec.intact, true);
    assert.equal(rec.deletedCount, 1);
    assert.equal(rec.skippedCount, 2); // symlink + gitlink
    assert.equal(
      (await readFile(join(safeDisposable, "mod.txt"))).equals(modEdited),
      true,
    );
    assert.equal(
      (await readFile(join(safeDisposable, "added.txt"))).equals(addedRaw),
      true,
    );
    await assert.rejects(readFile(join(safeDisposable, "del.txt")), {
      code: "ENOENT",
    });

    // Missing/corrupt CAS blob causes verify failure & reconstruct error
    const modDigest = byPath.get("mod.txt")!.worktreeSha256!;
    await client.close();
    await rm(join(env.dataDir, "cas", modDigest.slice(0, 2), modDigest), {
      force: true,
    });

    const restarted = env.start(env.dataDir);
    const verifyMissing = await restarted.request("memory.overlayVerify", {
      ...scope,
      overlayId: captured.overlayId,
    });
    assert.equal(verifyMissing.intact, false);
    assert.ok(verifyMissing.missingBlobs.includes(modDigest));

    const recTarget2 = join(env.root, "disposable-target-missing");
    await assert.rejects(
      restarted.request("memory.overlayReconstruct", {
        ...scope,
        overlayId: captured.overlayId,
        targetDir: recTarget2,
        disposableTargetConfirmed: true,
      }),
      { message: "overlay_blob_missing" },
    );
    await restarted.close();

    // Source repository HEAD, index, refs & status remained completely untouched!
    assert.deepEqual(await readGitInvariantSnapshot(repo), gitBefore);

    // Part C: Genuine OCC race test via beforeVerifyHook mutating disk mid-capture
    const store = openCatalog(env.dataDir);
    try {
      let mutated = false;
      const beforeCount = store.f3.listOverlays(scope).length;
      const raceService = createDirtyOverlayService({
        withCatalog: (op) => op(store),
        contextOptions: () => ({}),
        dataDir: env.dataDir,
        beforeVerifyHook: async () => {
          mutated = true;
          await writeFile(
            join(repo, "mod.txt"),
            Buffer.from("CONCURRENT-MUTATION\r\n"),
          );
        },
      });
      await assert.rejects(
        raceService.capture({ ...scope, label: "OCC Race Test" }),
        { message: "overlay_race_detected" },
      );
      assert.equal(mutated, true);
      assert.equal(store.f3.listOverlays(scope).length, beforeCount);
      assert.equal(
        sha256(await readFile(join(repo, "mod.txt"))) !== sha256(modEdited),
        true,
      );
    } finally {
      store.close();
    }
  },
);
