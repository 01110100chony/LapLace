import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { lstat, readFile, readlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  isContextPath,
  maxOverlayItems,
  memorySchemaVersion,
  workingMaxTextBytes,
  type DirtyOverlayManifest,
  type IdentityScope,
  type OverlayCaptureInput,
  type OverlayFileEntry,
  type OverlayFileKind,
  type OverlayListResult,
  type OverlayReconstructFileResult,
  type OverlayReconstructInput,
  type OverlayReconstructResult,
  type OverlayRefInput,
  type OverlayStageEntry,
  type OverlayVerifyResult,
  type WorkingChange,
} from "@laplace/contracts";
import { canonicalJson, sha256Hex } from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import {
  captureEnvironment,
  checkout,
  sha256,
  type ContextOptions,
} from "./context.ts";
import { pathKey } from "./context-files.ts";
import { GitError } from "./git.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

type RawStage = {
  stage: 0 | 1 | 2 | 3;
  mode: string;
  oid: string;
};

type DiskVerificationItem = {
  path: string;
  deleted: boolean;
  symlink: boolean;
  gitlink: boolean;
  worktreeSha256: string | null;
  worktreeSize: number | null;
};

function hasCrlf(bytes: Buffer): boolean {
  return bytes.includes(Buffer.from("\r\n"));
}

async function readIndexStamp(gitDir: string): Promise<string> {
  try {
    const st = await lstat(join(gitDir, "index"), { bigint: true });
    if (!st.isFile()) throw new GitError("git_failed");
    return `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

function parseAllStages(output: string): Map<string, RawStage[]> {
  const byPath = new Map<string, RawStage[]>();
  const records = output.split("\0");
  if (records.pop() !== "") throw new GitError("git_failed");
  for (const record of records) {
    const match =
      /^([0-7]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])\t(.+)$/s.exec(record);
    if (!match) continue;
    const [, mode, oid, stageStr, path] = match;
    const key = pathKey(path!);
    const list = byPath.get(key) ?? [];
    list.push({
      stage: Number(stageStr) as 0 | 1 | 2 | 3,
      mode: mode!,
      oid: oid!,
    });
    byPath.set(key, list);
  }
  return byPath;
}

function normalizeBoundaryPath(targetPath: string): string {
  const abs = resolve(targetPath);
  const parts: string[] = [];
  let probe = abs;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    parts.unshift(probe.slice(parent.length).replace(/^[\\/]+/, ""));
    probe = parent;
  }
  let base: string;
  try {
    base = realpathSync.native(probe);
  } catch {
    base = probe;
  }
  const combined = parts.length > 0 ? join(base, ...parts) : base;
  const cleaned = combined.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? cleaned.toLowerCase() : cleaned;
}

function pathsOverlap(a: string, b: string): boolean {
  const na = normalizeBoundaryPath(a);
  const nb = normalizeBoundaryPath(b);
  const sep = process.platform === "win32" ? "\\" : "/";
  return (
    na === nb || na.startsWith(`${nb}${sep}`) || nb.startsWith(`${na}${sep}`)
  );
}

export function createDirtyOverlayService(deps: {
  withCatalog: WithCatalog;
  contextOptions: (projectId: string) => ContextOptions;
  dataDir: string;
  now?: () => string;
  beforeVerifyHook?: () => Promise<void>;
}) {
  const now = deps.now ?? (() => new Date().toISOString());

  async function captureDirtyOverlay(
    input: OverlayCaptureInput,
    hook?: () => Promise<void>,
  ): Promise<DirtyOverlayManifest> {
    const scope: IdentityScope = {
      projectId: input.projectId,
      bindingId: input.bindingId,
      worktreeId: input.worktreeId,
    };
    const { legacyProjectId } = deps.withCatalog((store) =>
      store.identity.resolveScope(scope),
    );
    const project = deps.withCatalog((store) => store.lookup(legacyProjectId));
    const options = deps.contextOptions(legacyProjectId);
    const { signal } = captureEnvironment(options);
    const repo = await checkout(project, signal);

    const stampBefore = await readIndexStamp(repo.gitDir);
    const seen = new Map<string, WorkingChange>();
    const gaps: string[] = [];
    let truncated = false;

    const revBefore = await repo.status((change) => {
      if (!isContextPath(change.path)) return;
      if (seen.has(change.path)) {
        const prev = seen.get(change.path)!;
        seen.set(change.path, {
          ...(change.kind === "untracked" ? prev : change),
          untracked: true,
        });
      } else if (seen.size < maxOverlayItems) {
        seen.set(change.path, change);
      } else {
        truncated = true;
      }
    });
    if (truncated) {
      gaps.push("overlay_item_limit_reached");
    }

    const orderedPaths = [...seen.keys()].sort();
    const rawStages = await repo.indexEntries(orderedPaths);
    const stagesByKey = parseAllStages(rawStages);

    // Collect only regular/symlink Git blob OIDs (NEVER gitlink commit OIDs 160000).
    const blobOids: string[] = [];
    for (const path of orderedPaths) {
      const stages = stagesByKey.get(pathKey(path)) ?? [];
      for (const s of stages) {
        if (s.mode !== "160000") blobOids.push(s.oid);
      }
    }
    const gitBlobs = await repo.blobs(blobOids, workingMaxTextBytes);

    const pendingBlobs = new Map<string, Buffer>();
    const diskVerifyList: DiskVerificationItem[] = [];
    const files: OverlayFileEntry[] = [];

    for (const path of orderedPaths) {
      signal.throwIfAborted();
      const change = seen.get(path)!;
      const stageList = (stagesByKey.get(pathKey(path)) ?? []).sort(
        (a, b) => a.stage - b.stage,
      );

      const gitlinkStage = stageList.find((s) => s.mode === "160000");
      const symlinkStage = stageList.find((s) => s.mode === "120000");

      const absPath = join(repo.root, path);
      let diskStat: Awaited<ReturnType<typeof lstat>> | null = null;
      try {
        diskStat = await lstat(absPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          gaps.push(`stat_failed:${path}`);
        }
      }

      let kind: OverlayFileKind;
      let worktreeSha256: string | null = null;
      let worktreeSize: number | null = null;
      let crlf = false;
      let symlinkTarget: string | null = null;
      let gitlinkOid: string | null = null;
      let fileGap: string | null = null;

      if (gitlinkStage || change.submodule) {
        kind = "gitlink";
        gitlinkOid = gitlinkStage?.oid ?? null;
        fileGap = "gitlink_pointer_only";
        gaps.push(`gitlink:${path}:${gitlinkOid ?? "unrecorded"}`);
      } else if (diskStat?.isSymbolicLink() || symlinkStage) {
        kind = "symlink";
        if (diskStat?.isSymbolicLink()) {
          try {
            symlinkTarget = await readlink(absPath, "utf8");
          } catch {
            symlinkTarget = null;
          }
        } else if (symlinkStage) {
          const blob = gitBlobs.get(symlinkStage.oid)?.bytes;
          if (blob) symlinkTarget = blob.toString("utf8");
        }
        fileGap = "symlink_target_only";
        gaps.push(`symlink:${path}:${symlinkTarget ?? "unknown"}`);
      } else if (
        change.kind === "conflicted" ||
        stageList.some((s) => s.stage > 0)
      ) {
        kind = "conflicted";
      } else if (
        diskStat === null ||
        (!diskStat.isFile() && !diskStat.isDirectory()) ||
        change.status === "D " ||
        change.status === " D" ||
        change.status === "DD"
      ) {
        kind = "deleted";
      } else if (change.status === "??" || change.status[0] === "A") {
        kind = "added";
      } else {
        kind = "modified";
      }

      if (
        (kind === "modified" || kind === "added" || kind === "conflicted") &&
        diskStat !== null &&
        diskStat.isFile()
      ) {
        if (diskStat.size > workingMaxTextBytes) {
          fileGap = "worktree_too_large";
          gaps.push(`too_large:${path}`);
        } else {
          const rawBytes = await readFile(absPath);
          const digest = sha256(rawBytes);
          pendingBlobs.set(digest, rawBytes);
          worktreeSha256 = digest;
          worktreeSize = rawBytes.length;
          crlf = hasCrlf(rawBytes);
        }
      }

      const stageEntries: OverlayStageEntry[] = stageList.map((s) => {
        if (s.mode === "160000") {
          return {
            stage: s.stage,
            mode: s.mode,
            oid: s.oid,
            sha256: null,
            size: null,
            crlf: false,
            gap: "gitlink_pointer_only",
          };
        }
        const blobObj = gitBlobs.get(s.oid);
        if (!blobObj || !blobObj.bytes) {
          return {
            stage: s.stage,
            mode: s.mode,
            oid: s.oid,
            sha256: null,
            size: blobObj?.size ?? null,
            crlf: false,
            gap: blobObj?.size === null ? "blob_unreadable" : "blob_too_large",
          };
        }
        const digest = sha256(blobObj.bytes);
        pendingBlobs.set(digest, blobObj.bytes);
        return {
          stage: s.stage,
          mode: s.mode,
          oid: s.oid,
          sha256: digest,
          size: blobObj.bytes.length,
          crlf: hasCrlf(blobObj.bytes),
          gap: null,
        };
      });

      diskVerifyList.push({
        path,
        deleted: kind === "deleted",
        symlink: kind === "symlink",
        gitlink: kind === "gitlink",
        worktreeSha256,
        worktreeSize,
      });

      files.push({
        path,
        fromPath: change.from,
        kind,
        status: change.status,
        worktreeSha256,
        worktreeSize,
        crlf,
        symlinkTarget,
        gitlinkOid,
        stages: stageEntries,
        gap: fileGap,
      });
    }

    const activeHook = hook ?? deps.beforeVerifyHook;
    if (activeHook) {
      await activeHook();
    }

    // Strict OCC double-check before committing anything to CAS or SQLite.
    const repoAfter = await checkout(project, signal);
    if (repoAfter.gitDir !== repo.gitDir) {
      throw new GitError("overlay_race_detected");
    }
    const stampAfter = await readIndexStamp(repoAfter.gitDir);
    if (stampAfter !== stampBefore) {
      throw new GitError("overlay_race_detected");
    }

    const afterSeen = new Map<string, WorkingChange>();
    let afterTruncated = false;
    const revAfter = await repoAfter.status((change) => {
      if (!isContextPath(change.path)) return;
      if (afterSeen.has(change.path)) {
        const prev = afterSeen.get(change.path)!;
        afterSeen.set(change.path, {
          ...(change.kind === "untracked" ? prev : change),
          untracked: true,
        });
      } else if (afterSeen.size < maxOverlayItems) {
        afterSeen.set(change.path, change);
      } else {
        afterTruncated = true;
      }
    });

    if (
      revAfter.head !== revBefore.head ||
      revAfter.branch !== revBefore.branch ||
      afterTruncated !== truncated ||
      afterSeen.size !== seen.size
    ) {
      throw new GitError("overlay_race_detected");
    }

    for (const [path, beforeChange] of seen) {
      const afterChange = afterSeen.get(path);
      if (
        !afterChange ||
        afterChange.status !== beforeChange.status ||
        afterChange.kind !== beforeChange.kind ||
        afterChange.from !== beforeChange.from
      ) {
        throw new GitError("overlay_race_detected");
      }
    }

    for (const check of diskVerifyList) {
      if (check.symlink || check.gitlink) continue;
      const absPath = join(repoAfter.root, check.path);
      if (check.deleted) {
        if (existsSync(absPath)) throw new GitError("overlay_race_detected");
        continue;
      }
      if (check.worktreeSha256 !== null) {
        let currentBytes: Buffer;
        try {
          const st = await lstat(absPath);
          if (!st.isFile() || st.size !== check.worktreeSize) {
            throw new GitError("overlay_race_detected");
          }
          currentBytes = await readFile(absPath);
        } catch (error) {
          if (error instanceof GitError) throw error;
          throw new GitError("overlay_race_detected");
        }
        if (sha256(currentBytes) !== check.worktreeSha256) {
          throw new GitError("overlay_race_detected");
        }
      }
    }

    const capturedAt = now();
    const overlayId = randomUUID();
    const sortedGaps = [...new Set(gaps)].sort();
    const manifestDigest = sha256Hex(
      canonicalJson({
        schemaVersion: memorySchemaVersion,
        scope,
        head: revBefore.head,
        branch: revBefore.branch,
        baseIndexStamp: stampBefore,
        files,
        gaps: sortedGaps,
      }),
    );

    const manifest: DirtyOverlayManifest = {
      schemaVersion: memorySchemaVersion,
      overlayId,
      scope,
      label: input.label,
      head: revBefore.head,
      branch: revBefore.branch,
      capturedAt,
      manifestDigest,
      stability: "occ_verified",
      occLimits:
        "Protege via dupla leitura atomica contra concorrencia no indice/worktree sem garantir bloqueio de escritas externas.",
      baseIndexStamp: stampBefore,
      files,
      gaps: sortedGaps,
    };

    // Persist CAS blobs BEFORE committing SQLite manifest row.
    return deps.withCatalog((store) => {
      const storedBlobs: { digest: string; bytes: number }[] = [];
      for (const [, rawBytes] of pendingBlobs) {
        const res = store.cas.put(rawBytes);
        storedBlobs.push({ digest: res.digest, bytes: res.bytes });
      }
      return store.f3.insertOverlay(manifest, storedBlobs);
    });
  }

  function list(scope: IdentityScope): OverlayListResult {
    return deps.withCatalog((store) => ({
      scope,
      items: store.f3.listOverlays(scope),
    }));
  }

  function verify(input: OverlayRefInput): OverlayVerifyResult {
    const scope: IdentityScope = {
      projectId: input.projectId,
      bindingId: input.bindingId,
      worktreeId: input.worktreeId,
    };
    return deps.withCatalog((store) => {
      const manifest = store.f3.getOverlay(scope, input.overlayId);
      if (!manifest) throw new GitError("memory_not_found");

      const checked = new Set<string>();
      const missingBlobs: string[] = [];
      const mismatchedPaths: string[] = [];

      const checkDigest = (digest: string, pathLabel: string) => {
        if (!checked.has(digest)) {
          checked.add(digest);
          const result = store.cas.verify(digest);
          if (result.state === "missing") {
            missingBlobs.push(digest);
          } else if (result.state === "corrupt") {
            mismatchedPaths.push(pathLabel);
          }
        } else if (missingBlobs.includes(digest)) {
          mismatchedPaths.push(pathLabel);
        }
      };

      for (const file of manifest.files) {
        if (file.worktreeSha256) {
          checkDigest(file.worktreeSha256, file.path);
        }
        for (const stage of file.stages) {
          if (stage.sha256) {
            checkDigest(stage.sha256, `${file.path}@stage${stage.stage}`);
          }
        }
      }

      return {
        scope,
        overlayId: manifest.overlayId,
        intact: missingBlobs.length === 0 && mismatchedPaths.length === 0,
        manifestDigest: manifest.manifestDigest,
        checkedBlobs: checked.size,
        missingBlobs,
        mismatchedPaths,
      };
    });
  }

  function reconstruct(
    input: OverlayReconstructInput,
  ): OverlayReconstructResult {
    if (!input.disposableTargetConfirmed || !isAbsolute(input.targetDir)) {
      throw new GitError("overlay_unsafe_target");
    }

    const scope: IdentityScope = {
      projectId: input.projectId,
      bindingId: input.bindingId,
      worktreeId: input.worktreeId,
    };

    return deps.withCatalog((store) => {
      const worktree = store.identity.resolveScope(scope);
      const registeredRoots = store.list().projects.map((p) => p.root);
      const forbidden = [deps.dataDir, worktree.root, ...registeredRoots];
      for (const boundary of forbidden) {
        if (pathsOverlap(input.targetDir, boundary)) {
          throw new GitError("overlay_unsafe_target");
        }
      }

      const manifest = store.f3.getOverlay(scope, input.overlayId);
      if (!manifest) throw new GitError("memory_not_found");

      // Pre-verify every required worktree blob BEFORE creating or touching files.
      const verifiedBlobs = new Map<string, Buffer>();
      for (const file of manifest.files) {
        if (!file.worktreeSha256) continue;
        if (!verifiedBlobs.has(file.worktreeSha256)) {
          const check = store.cas.verify(file.worktreeSha256);
          if (check.state !== "verified" || check.bytes === null) {
            throw new GitError("overlay_blob_missing");
          }
          verifiedBlobs.set(file.worktreeSha256, check.bytes);
        }
      }

      mkdirSync(input.targetDir, { recursive: true });
      const results: OverlayReconstructFileResult[] = [];
      let verifiedCount = 0;
      let deletedCount = 0;
      let skippedCount = 0;

      for (const file of manifest.files) {
        if (!isContextPath(file.path)) {
          skippedCount++;
          results.push({
            path: file.path,
            action: "skipped_gap",
            sha256: null,
            bytes: null,
            crlf: false,
            detail: "unsafe_relative_path",
          });
          continue;
        }

        const dest = resolve(input.targetDir, file.path);
        if (!pathsOverlap(dest, input.targetDir)) {
          throw new GitError("overlay_unsafe_target");
        }

        if (file.kind === "symlink" || file.kind === "gitlink") {
          skippedCount++;
          results.push({
            path: file.path,
            action: "skipped_gap",
            sha256: null,
            bytes: null,
            crlf: false,
            detail: file.gap ?? file.kind,
          });
          continue;
        }

        if (file.kind === "deleted") {
          if (existsSync(dest)) {
            rmSync(dest, { force: true });
          }
          deletedCount++;
          results.push({
            path: file.path,
            action: "deleted",
            sha256: null,
            bytes: null,
            crlf: false,
            detail: "deleted_in_overlay",
          });
          continue;
        }

        if (file.worktreeSha256) {
          const rawBytes = verifiedBlobs.get(file.worktreeSha256);
          if (!rawBytes) throw new GitError("overlay_blob_missing");
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, rawBytes);
          const written = readFileSync(dest);
          const writtenDigest = sha256(written);
          if (writtenDigest !== file.worktreeSha256) {
            throw new GitError("overlay_blob_missing");
          }
          verifiedCount++;
          results.push({
            path: file.path,
            action: "written",
            sha256: writtenDigest,
            bytes: written.length,
            crlf: hasCrlf(written),
            detail:
              file.kind === "conflicted"
                ? "conflicted_worktree_written"
                : "verified",
          });
          continue;
        }

        skippedCount++;
        results.push({
          path: file.path,
          action: "skipped_gap",
          sha256: null,
          bytes: null,
          crlf: false,
          detail: file.gap ?? "no_worktree_blob",
        });
      }

      return {
        scope,
        overlayId: manifest.overlayId,
        targetDir: input.targetDir,
        verifiedCount,
        deletedCount,
        skippedCount,
        intact: true,
        files: results,
        gaps: manifest.gaps,
      };
    });
  }

  return {
    capture: captureDirtyOverlay,
    captureDirtyOverlay,
    list,
    verify,
    reconstruct,
  };
}
