import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  isContextPath,
  isGitObjectId,
  workingMaxTextBytes,
  type ExecutionDiffFile,
  type PlannerDiffAction,
  type PlannerGitBase,
} from "@laplace/contracts";
import {
  canonicalJson,
  computeDiffDigest,
  sha256Hex,
  type PlannerGitObservation,
} from "@laplace/core";
import { sha256 } from "./context.ts";
import {
  canonicalPath,
  contextCheckout,
  gitEnvironment,
  gitOnPath,
  GitError,
} from "./git.ts";
import type { StoredDiffBlobInput } from "./f4-store.ts";

const exec = promisify(execFile);
const gitTimeoutMs = 10_000;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const maxDiffTextPreviewBytes = 64 * 1024;
const maxDirtyHashBytes = 1024 * 1024;

function isSafeText(bytes: Buffer): boolean {
  if (bytes.includes(0) || bytes.length > maxDiffTextPreviewBytes) return false;
  try {
    utf8Decoder.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

async function runPassiveGit(
  cwd: string,
  args: string[],
  sourceEnv: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  allowNoMatch = false,
): Promise<Buffer> {
  const git = await gitOnPath(sourceEnv);
  const env = gitEnvironment(sourceEnv);
  const timeoutSignal = AbortSignal.timeout(gitTimeoutMs);
  const combined = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  try {
    const { stdout } = await exec(
      git,
      [
        "--no-optional-locks",
        "-C",
        cwd,
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "-c",
        "core.hooksPath=" +
          (process.platform === "win32" ? "NUL" : "/dev/null"),
        ...args,
      ],
      {
        env,
        signal: combined,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "buffer",
      },
    );
    return stdout;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (allowNoMatch && Number(failure.code) === 1) return Buffer.alloc(0);
    if (combined.aborted) throw new GitError("git_timeout");
    throw new GitError("git_failed");
  }
}

async function runWorktreeGit(
  originRoot: string,
  args: string[],
  sourceEnv: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<void> {
  const git = await gitOnPath(sourceEnv);
  const env = gitEnvironment(sourceEnv);
  const timeoutSignal = AbortSignal.timeout(30_000);
  const combined = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  try {
    await exec(
      git,
      [
        "-C",
        originRoot,
        "-c",
        "core.hooksPath=" +
          (process.platform === "win32" ? "NUL" : "/dev/null"),
        ...args,
      ],
      {
        env,
        signal: combined,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
  } catch {
    if (combined.aborted) throw new GitError("git_timeout");
    throw new GitError("planner_worktree_unavailable");
  }
}

export async function readIndexStamp(gitDir: string): Promise<string> {
  try {
    const st = await lstat(join(gitDir, "index"), { bigint: true });
    if (!st.isFile()) throw new GitError("git_failed");
    return `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw new GitError("git_failed");
  }
}

export type DetailedPlannerObservation = PlannerGitObservation & {
  worktrees: {
    root: string;
    head: string | null;
    branch: string | null;
    isMain: boolean;
  }[];
  changesCount: {
    staged: number;
    unstaged: number;
    untracked: number;
    conflicted: number;
  };
};

export async function observeCheckoutForPlanner(
  root: string,
  options: {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    expectedRoot?: string;
    expectedIdentity?: string;
    watchedPaths?: readonly string[];
  } = {},
): Promise<DetailedPlannerObservation> {
  const sourceEnv = options.env ?? process.env;
  const repo = await contextCheckout(root, {
    env: sourceEnv,
    signal: options.signal,
    expectedRoot: options.expectedRoot,
    expectedIdentity: options.expectedIdentity,
  });

  const [{ head, branch }, indexStamp] = await Promise.all([
    repo.revision(),
    readIndexStamp(repo.gitDir),
  ]);

  const dirtySet = new Set<string>();
  const conflictedSet = new Set<string>();
  const statusEntries: { path: string; status: string; kind: string }[] = [];

  const summary = await repo.status((change) => {
    statusEntries.push({
      path: change.path,
      status: change.status,
      kind: change.kind,
    });
    if (isContextPath(change.path)) {
      if (change.kind === "conflicted") conflictedSet.add(change.path);
      else dirtySet.add(change.path);
    }
  });

  const [branchesRaw, worktreesRaw] = await Promise.all([
    runPassiveGit(
      repo.root,
      [
        "for-each-ref",
        "--format=%(refname:short)%00%(objectname)%00%(HEAD)",
        "refs/heads",
      ],
      sourceEnv,
      options.signal,
    ),
    runPassiveGit(
      repo.root,
      ["worktree", "list", "--porcelain"],
      sourceEnv,
      options.signal,
    ),
  ]);

  const branches: { name: string; head: string; current: boolean }[] = [];
  for (const line of branchesRaw.toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const [name, commitHead, headMark] = line.split("\0");
    if (name && commitHead && isGitObjectId(commitHead)) {
      branches.push({
        name,
        head: commitHead,
        current: headMark === "*",
      });
    }
  }

  const worktrees: DetailedPlannerObservation["worktrees"] = [];
  const blocks = worktreesRaw.toString("utf8").split(/\r?\n\r?\n/);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!.trim();
    if (!block) continue;
    let wtRoot = "";
    let wtHead: string | null = null;
    let wtBranch: string | null = null;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) {
        wtRoot = line.slice(9);
      } else if (line.startsWith("HEAD ")) {
        const oid = line.slice(5).trim();
        if (isGitObjectId(oid)) wtHead = oid;
      } else if (line.startsWith("branch ")) {
        wtBranch = line.slice(7).replace(/^refs\/heads\//, "");
      }
    }
    if (wtRoot) {
      worktrees.push({
        root: wtRoot,
        head: wtHead,
        branch: wtBranch,
        isMain: i === 0,
      });
    }
  }

  const watched = [
    ...new Set([
      ...dirtySet,
      ...conflictedSet,
      ...(options.watchedPaths ?? []),
    ]),
  ]
    .filter(isContextPath)
    .sort();
  const diskStamps: {
    path: string;
    kind: string;
    sha256: string | null;
    size: number | null;
  }[] = [];
  for (const rel of watched) {
    const abs = join(repo.root, rel);
    try {
      const st = await lstat(abs);
      if (st.isSymbolicLink()) {
        diskStamps.push({
          path: rel,
          kind: "symlink",
          sha256: null,
          size: null,
        });
      } else if (st.isFile()) {
        if (st.size <= maxDirtyHashBytes) {
          const buf = await readFile(abs);
          diskStamps.push({
            path: rel,
            kind: "file",
            sha256: sha256(buf),
            size: buf.length,
          });
        } else {
          diskStamps.push({
            path: rel,
            kind: "large_file",
            sha256: null,
            size: st.size,
          });
        }
      } else {
        diskStamps.push({ path: rel, kind: "other", sha256: null, size: null });
      }
    } catch {
      diskStamps.push({ path: rel, kind: "absent", sha256: null, size: null });
    }
  }

  statusEntries.sort((a, b) => a.path.localeCompare(b.path));
  const dirtyDigest = sha256Hex(
    canonicalJson({
      statusEntries,
      diskStamps,
    }),
  );

  const base: PlannerGitBase = {
    head,
    branch,
    indexStamp,
    worktreeRoot: repo.root,
    dirtyDigest,
  };

  return {
    base,
    branches,
    dirtyPaths: [...dirtySet].sort(),
    conflictedPaths: [...conflictedSet].sort(),
    worktrees,
    changesCount: summary.changes,
  };
}

function assertOutsideProtectedRoots(
  candidate: string,
  protectedRoots: readonly string[],
) {
  for (const root of protectedRoots) {
    const rel = relative(root, candidate);
    if (rel === "" || (!isAbsolute(rel) && rel.split(/[\\/]/)[0] !== "..")) {
      throw new GitError("planner_worktree_unavailable");
    }
  }
}

export async function createDedicatedWorktree(input: {
  originRoot: string;
  baseHead: string | null;
  targetBranch: string | null;
  protectedRoots: readonly string[];
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): Promise<{
  dedicatedRoot: string;
  strategy: "git_worktree" | "isolated_checkout";
  branchName: string | null;
}> {
  const sourceEnv = input.env ?? process.env;
  const temp = await canonicalPath(tmpdir());
  assertOutsideProtectedRoots(temp, input.protectedRoots);
  const holder = await mkdtemp(join(temp, "laplace-f4-wt-"));
  const targetDir = join(holder, "checkout");

  if (!input.baseHead) {
    // Only valid when operationKind === "verifier_only" with unborn repo.
    const emptyHolder = await mkdtemp(join(temp, "laplace-f4-iso-"));
    await rm(holder, { recursive: true, force: true });
    return {
      dedicatedRoot: emptyHolder,
      strategy: "isolated_checkout",
      branchName: null,
    };
  }

  try {
    const args = input.targetBranch
      ? ["worktree", "add", "-b", input.targetBranch, targetDir, input.baseHead]
      : ["worktree", "add", "--detach", targetDir, input.baseHead];
    await runWorktreeGit(input.originRoot, args, sourceEnv, input.signal);
    const dedicatedRoot = await canonicalPath(targetDir);
    return {
      dedicatedRoot,
      strategy: "git_worktree",
      branchName: input.targetBranch,
    };
  } catch (error) {
    await rm(holder, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removeDedicatedWorktree(input: {
  originRoot: string;
  dedicatedRoot: string;
  strategy: "git_worktree" | "isolated_checkout";
  protectedRoots: readonly string[];
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): Promise<void> {
  const sourceEnv = input.env ?? process.env;
  const temp = await canonicalPath(tmpdir());
  assertOutsideProtectedRoots(input.dedicatedRoot, input.protectedRoots);

  const normalizedTemp = temp.toLowerCase();
  const normalizedTarget = resolve(input.dedicatedRoot).toLowerCase();
  if (!normalizedTarget.startsWith(normalizedTemp)) {
    throw new GitError("planner_worktree_unavailable");
  }

  if (input.strategy === "git_worktree" && existsSync(input.originRoot)) {
    await runWorktreeGit(
      input.originRoot,
      ["worktree", "remove", "--force", input.dedicatedRoot],
      sourceEnv,
      input.signal,
    ).catch(() => undefined);
    await runWorktreeGit(
      input.originRoot,
      ["worktree", "prune"],
      sourceEnv,
      input.signal,
    ).catch(() => undefined);
  }

  const removeTarget =
    input.strategy === "git_worktree" &&
    dirname(input.dedicatedRoot).startsWith(join(temp, "laplace-f4-wt-"))
      ? dirname(input.dedicatedRoot)
      : input.dedicatedRoot;
  await rm(removeTarget, { recursive: true, force: true, maxRetries: 2 });
}

export async function captureWorktreeDiff(input: {
  dedicatedRoot: string;
  baseHead: string | null;
  planId: string;
  executionId: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): Promise<{
  diffDigest: string;
  files: ExecutionDiffFile[];
  blobs: StoredDiffBlobInput[];
}> {
  const sourceEnv = input.env ?? process.env;
  const repo = await contextCheckout(input.dedicatedRoot, {
    env: sourceEnv,
    signal: input.signal,
  });

  const touched = new Set<string>();
  await repo.status((change) => {
    if (isContextPath(change.path)) touched.add(change.path);
  });

  const rev = await repo.revision();
  if (input.baseHead && rev.head && rev.head !== input.baseHead) {
    const committed = await runPassiveGit(
      repo.root,
      [
        "diff-tree",
        "--no-commit-id",
        "-r",
        "--name-only",
        "-z",
        input.baseHead,
        rev.head,
      ],
      sourceEnv,
      input.signal,
      true,
    );
    for (const p of committed.toString("utf8").split("\0")) {
      if (p && isContextPath(p)) touched.add(p);
    }
  }

  const paths = [...touched].sort();
  const baseBlobByPath = new Map<string, string>();
  if (input.baseHead && paths.length > 0) {
    const treeRaw = await repo.treeEntries(input.baseHead, paths);
    const neededOids: string[] = [];
    for (const record of treeRaw.split("\0")) {
      if (!record) continue;
      const tab = record.indexOf("\t");
      if (tab === -1) continue;
      const meta = record.slice(0, tab).split(" ");
      const path = record.slice(tab + 1);
      if (
        meta[1] === "blob" &&
        meta[2] &&
        meta[0] !== "160000" &&
        meta[0] !== "120000"
      ) {
        baseBlobByPath.set(path, meta[2]);
        neededOids.push(meta[2]);
      }
    }
    const baseBlobs = await repo.blobs(neededOids, workingMaxTextBytes);
    const files: ExecutionDiffFile[] = [];
    const blobs: StoredDiffBlobInput[] = [];

    for (const path of paths) {
      const beforeOid = baseBlobByPath.get(path);
      const beforeBuf = beforeOid
        ? (baseBlobs.get(beforeOid)?.bytes ?? null)
        : null;
      let afterBuf: Buffer | null = null;
      const absPath = join(repo.root, path);
      try {
        const st = await lstat(absPath);
        if (st.isFile() && st.size <= workingMaxTextBytes) {
          afterBuf = await readFile(absPath);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new GitError("git_failed");
        }
      }

      const beforeSha = beforeBuf ? sha256(beforeBuf) : null;
      const afterSha = afterBuf ? sha256(afterBuf) : null;
      if (beforeBuf === null && afterBuf === null) continue;
      if (beforeSha !== null && afterSha !== null && beforeSha === afterSha) {
        continue;
      }

      const action: PlannerDiffAction =
        beforeBuf === null
          ? "created"
          : afterBuf === null
            ? "deleted"
            : "modified";
      const beforeCrlf = beforeBuf
        ? beforeBuf.includes(Buffer.from("\r\n"))
        : false;
      const afterCrlf = afterBuf
        ? afterBuf.includes(Buffer.from("\r\n"))
        : false;

      if (beforeBuf !== null && beforeSha !== null) {
        blobs.push({
          path,
          side: "before",
          sha256: beforeSha,
          byteLength: beforeBuf.length,
          crlf: beforeCrlf,
          content: beforeBuf,
        });
      }
      if (afterBuf !== null && afterSha !== null) {
        blobs.push({
          path,
          side: "after",
          sha256: afterSha,
          byteLength: afterBuf.length,
          crlf: afterCrlf,
          content: afterBuf,
        });
      }

      files.push({
        path,
        action,
        beforeSha256: beforeSha,
        beforeBytes: beforeBuf ? beforeBuf.length : null,
        beforeCrlf,
        beforeText:
          beforeBuf && isSafeText(beforeBuf)
            ? beforeBuf.toString("utf8")
            : null,
        afterSha256: afterSha,
        afterBytes: afterBuf ? afterBuf.length : null,
        afterCrlf,
        afterText:
          afterBuf && isSafeText(afterBuf) ? afterBuf.toString("utf8") : null,
      });
    }

    const diffDigest = computeDiffDigest({
      planId: input.planId,
      executionId: input.executionId,
      baseHead: input.baseHead,
      files,
    });
    return { diffDigest, files, blobs };
  }

  // Fallback for unborn baseHead (no base blobs to fetch via ls-tree)
  const files: ExecutionDiffFile[] = [];
  const blobs: StoredDiffBlobInput[] = [];
  for (const path of paths) {
    let afterBuf: Buffer | null = null;
    try {
      const st = await lstat(join(repo.root, path));
      if (st.isFile() && st.size <= workingMaxTextBytes) {
        afterBuf = await readFile(join(repo.root, path));
      }
    } catch {
      afterBuf = null;
    }
    if (!afterBuf) continue;
    const afterSha = sha256(afterBuf);
    const afterCrlf = afterBuf.includes(Buffer.from("\r\n"));
    blobs.push({
      path,
      side: "after",
      sha256: afterSha,
      byteLength: afterBuf.length,
      crlf: afterCrlf,
      content: afterBuf,
    });
    files.push({
      path,
      action: "created",
      beforeSha256: null,
      beforeBytes: null,
      beforeCrlf: false,
      beforeText: null,
      afterSha256: afterSha,
      afterBytes: afterBuf.length,
      afterCrlf,
      afterText: isSafeText(afterBuf) ? afterBuf.toString("utf8") : null,
    });
  }
  const diffDigest = computeDiffDigest({
    planId: input.planId,
    executionId: input.executionId,
    baseHead: input.baseHead,
    files,
  });
  return { diffDigest, files, blobs };
}
