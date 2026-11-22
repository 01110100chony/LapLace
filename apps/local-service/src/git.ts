import { constants, realpath } from "node:fs";
import { createHash } from "node:crypto";
import { access, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  gitSource,
  gitSummaryVersion,
  isGitObjectId,
  type ErrorCode,
  type GitObservation,
  type GitSummary,
  type ProjectRecord,
  type WorkingChange,
} from "@laplace/contracts";

const exec = promisify(execFile);
// Native resolution also returns the on-disk casing on Windows.
export const canonicalPath = promisify(realpath.native);
const gitDeadlineMs = 7_000;

export class GitError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}

type GitOptions = {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  expectedRoot?: string;
  expectedIdentity?: string;
};

export type RepositoryInspection = Omit<ProjectRecord, "id"> &
  GitObservation & {
    identity: string;
    gitDir: string;
    commonGitDir: string;
    commonGitIdentity: string;
    isLinkedWorktree: boolean;
  };

function isMissing(error: NodeJS.ErrnoException) {
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

function isDenied(error: NodeJS.ErrnoException) {
  return error.code === "EACCES" || error.code === "EPERM";
}

export async function folder(path: string): Promise<string> {
  try {
    if (!isAbsolute(path)) throw new GitError("invalid_folder");
    const canonical = await canonicalPath(path);
    if (!(await stat(canonical)).isDirectory())
      throw new GitError("invalid_folder");
    return canonical;
  } catch (error) {
    if (error instanceof GitError) throw error;
    if (isDenied(error as NodeJS.ErrnoException))
      throw new GitError("permission_denied");
    throw new GitError("invalid_folder");
  }
}

export async function gitOnPath(env: NodeJS.ProcessEnv): Promise<string> {
  const pathValue = Object.entries(env).find(
    ([key]) => key.toUpperCase() === "PATH",
  )?.[1];
  const executable = process.platform === "win32" ? "git.exe" : "git";
  let denied = false;
  for (const entry of pathValue?.split(delimiter) ?? []) {
    const directory = entry.replace(/^"(.*)"$/, "$1");
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, executable);
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      denied ||= isDenied(error as NodeJS.ErrnoException);
    }
  }
  throw new GitError(denied ? "permission_denied" : "git_missing");
}

export function gitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(source).filter(
      ([key]) => !/^git_/i.test(key) && key.toUpperCase() !== "LC_ALL",
    ),
  );
  return {
    ...environment,
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function parseStatus(
  text: string,
  observeChange?: (change: WorkingChange) => void,
): Omit<GitSummary, "observedAt"> {
  const records = text.split("\0");
  if (records.pop() !== "") throw new GitError("git_failed");
  let branch: string | null | undefined;
  let head: string | null | undefined;
  const changes = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (record.startsWith("# branch.oid ")) {
      const oid = record.slice(13);
      if (!/^(?:\(initial\)|[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid)) {
        throw new GitError("git_failed");
      }
      head = oid === "(initial)" ? null : oid;
    } else if (record.startsWith("# branch.head ")) {
      const name = record.slice(14);
      if (!name) throw new GitError("git_failed");
      branch = name === "(detached)" ? null : name;
    } else if (record.startsWith("# ")) {
      continue;
    } else if (/^[12] [A-Z.]{2} /.test(record)) {
      if (record[2] !== ".") changes.staged++;
      if (record[3] !== ".") changes.unstaged++;
      const from = record[0] === "2" ? records[++index] : null;
      if (from === undefined || from === "") throw new GitError("git_failed");
      if (observeChange) {
        const fields = record.split(" ", from === null ? 8 : 9);
        const path = record.slice(fields.join(" ").length + 1);
        if (!path || !fields[2]) throw new GitError("git_failed");
        observeChange({
          path,
          from,
          status: fields[1]!,
          kind: from === null ? "tracked" : "renamed",
          submodule: fields[2][0] === "S",
          untracked: false,
        });
      }
    } else if (record.startsWith("u ")) {
      changes.conflicted++;
      if (observeChange) {
        const fields = record.split(" ", 10);
        const path = record.slice(fields.join(" ").length + 1);
        if (!path || !fields[2]) throw new GitError("git_failed");
        observeChange({
          path,
          from: null,
          status: fields[1]!,
          kind: "conflicted",
          submodule: fields[2][0] === "S",
          untracked: false,
        });
      }
    } else if (record.startsWith("? ")) {
      changes.untracked++;
      const path = record.slice(2);
      if (path)
        observeChange?.({
          path,
          from: null,
          status: "??",
          kind: "untracked",
          submodule: false,
          untracked: true,
        });
    } else {
      throw new GitError("git_failed");
    }
  }
  if (branch === undefined || head === undefined)
    throw new GitError("git_failed");
  return { branch, head, changes };
}

async function repositoryReader(path: string, options: GitOptions) {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? gitDeadlineMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  const selected = await folder(path);
  const sourceEnv = options.env ?? process.env;
  const git = await gitOnPath(sourceEnv);
  const env = gitEnvironment(sourceEnv);

  async function runBytes(
    cwd: string,
    args: string[],
    {
      noMatchIsEmpty = false,
      overrides = {},
      maxBuffer = 16 * 1024 * 1024,
      input,
    }: {
      noMatchIsEmpty?: boolean;
      overrides?: NodeJS.ProcessEnv;
      maxBuffer?: number;
      input?: string;
    } = {},
  ): Promise<Buffer> {
    try {
      const child = exec(
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
          env: { ...env, ...overrides },
          signal,
          windowsHide: true,
          maxBuffer,
          encoding: "buffer",
        },
      );
      if (input !== undefined) {
        child.child.stdin?.on("error", () => undefined);
        child.child.stdin?.end(input);
      }
      const { stdout } = await child;
      return stdout;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: Buffer };
      if (signal.aborted) throw new GitError("git_timeout");
      if (isMissing(failure)) throw new GitError("git_missing");
      const stderr = failure.stderr?.toString("utf8") ?? "";
      if (noMatchIsEmpty && Number(failure.code) === 1 && !stderr)
        return Buffer.alloc(0);
      if (
        isDenied(failure) ||
        /permission denied|access is denied|dubious ownership/i.test(stderr)
      ) {
        throw new GitError("permission_denied");
      }
      if (/not a git repository|must be run in a work tree/i.test(stderr)) {
        throw new GitError("not_repository");
      }
      if (/cannot change to .*no such file or directory/i.test(stderr)) {
        throw new GitError("invalid_folder");
      }
      throw new GitError("git_failed");
    }
  }

  async function run(
    cwd: string,
    args: string[],
    config?: Parameters<typeof runBytes>[2],
  ) {
    return (await runBytes(cwd, args, config)).toString("utf8");
  }

  const topLevel = await run(selected, ["rev-parse", "--show-toplevel"]);
  const root = await folder(topLevel.replace(/\r?\n$/, ""));
  if (options.expectedRoot !== undefined && root !== options.expectedRoot)
    throw new GitError("project_unavailable");

  async function checkoutLocation() {
    const [rawGitDir, rawCommonDir] = await Promise.all([
      run(root, ["rev-parse", "--absolute-git-dir"]),
      run(root, ["rev-parse", "--git-common-dir"]),
    ]);
    const cleanedCommon = rawCommonDir.replace(/\r?\n$/, "");
    const [gitDir, commonGitDir] = await Promise.all([
      folder(rawGitDir.replace(/\r?\n$/, "")),
      folder(
        isAbsolute(cleanedCommon)
          ? cleanedCommon
          : resolve(root, cleanedCommon),
      ),
    ]);
    try {
      const locations = await Promise.all(
        [root, gitDir, commonGitDir].map((location) =>
          stat(location, { bigint: true }),
        ),
      );
      // Directory IDs survive a rename and distinguish clones, including linked
      // worktrees. Git commit IDs alone cannot distinguish two copies.
      if (locations.some((entry) => !entry.isDirectory() || entry.ino === 0n))
        throw new GitError("project_identity_unknown");
      const [rootStat, gitStat, commonStat] = locations as [
        NonNullable<(typeof locations)[number]>,
        NonNullable<(typeof locations)[number]>,
        NonNullable<(typeof locations)[number]>,
      ];
      const identity = `${rootStat.dev}:${rootStat.ino}/${gitStat.dev}:${gitStat.ino}`;
      const commonGitIdentity = `${commonStat.dev}:${commonStat.ino}`;
      if (options.expectedIdentity && options.expectedIdentity !== identity)
        throw new GitError("project_identity_mismatch");
      return {
        gitDir,
        commonGitDir,
        identity,
        commonGitIdentity,
        isLinkedWorktree: gitDir !== commonGitDir,
      };
    } catch (error) {
      if (error instanceof GitError) throw error;
      if (isMissing(error as NodeJS.ErrnoException))
        throw new GitError("invalid_folder");
      if (isDenied(error as NodeJS.ErrnoException))
        throw new GitError("permission_denied");
      throw new GitError("git_failed");
    }
  }

  return { root, run, runBytes, checkoutLocation };
}

async function checkoutStatus(
  { root, run }: Awaited<ReturnType<typeof repositoryReader>>,
  observeChange?: (change: WorkingChange) => void,
) {
  // Status may invoke configured clean/process filters when stat checks miss.
  const filters = await run(
    root,
    [
      "config",
      "--null",
      "--name-only",
      "--get-regexp",
      "^filter\\..*\\.(clean|process|required)$",
    ],
    { noMatchIsEmpty: true },
  );
  const filterKeys = [...new Set(filters.split("\0").filter(Boolean))];
  const overrides: NodeJS.ProcessEnv = {
    GIT_CONFIG_COUNT: String(filterKeys.length),
  };
  // Git accepts "=" in a filter name, so pass keys and values separately.
  for (const [index, key] of filterKeys.entries()) {
    overrides[`GIT_CONFIG_KEY_${index}`] = key;
    overrides[`GIT_CONFIG_VALUE_${index}`] = key.endsWith(".required")
      ? "false"
      : "";
  }
  return parseStatus(
    await run(
      root,
      [
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--renames",
        "--untracked-files=all",
        "--ignore-submodules=dirty",
      ],
      { overrides },
    ),
    observeChange,
  );
}

export async function inspectRepository(
  path: string,
  options: GitOptions = {},
): Promise<RepositoryInspection> {
  const repo = await repositoryReader(path, options);
  const { root, checkoutLocation } = repo;
  const {
    identity,
    gitDir,
    commonGitDir,
    commonGitIdentity,
    isLinkedWorktree,
  } = await checkoutLocation();
  const status = await checkoutStatus(repo);
  const confirmed = await checkoutLocation();
  if (
    confirmed.identity !== identity ||
    confirmed.commonGitIdentity !== commonGitIdentity
  )
    throw new GitError("project_identity_mismatch");
  return {
    name: basename(root) || root,
    root,
    identity,
    gitDir,
    commonGitDir,
    commonGitIdentity,
    isLinkedWorktree,
    ...status,
    source: gitSource,
    summaryVersion: gitSummaryVersion,
    observedAt: new Date().toISOString(),
  };
}

export async function contextCheckout(path: string, options: GitOptions) {
  const repo = await repositoryReader(path, options);
  const { root, run, runBytes, checkoutLocation } = repo;
  const { gitDir, identity } = await checkoutLocation();
  return {
    root,
    gitDir,
    identity,
    async revision() {
      const [branch, head] = await Promise.all([
        run(root, ["symbolic-ref", "-q", "--short", "HEAD"], {
          noMatchIsEmpty: true,
          maxBuffer: 4096,
        }),
        run(root, ["rev-parse", "--verify", "--quiet", "HEAD"], {
          noMatchIsEmpty: true,
          maxBuffer: 1024,
        }),
      ]);
      const oid = head.trimEnd();
      if (oid ? !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid) : !branch)
        throw new GitError("git_failed");
      return { head: oid || null, branch: branch.trimEnd() || null };
    },
    indexEntries(paths: string[]) {
      if (!paths.length) return Promise.resolve("");
      const magic =
        process.platform === "win32"
          ? ":(top,literal,icase)"
          : ":(top,literal)";
      return run(
        root,
        [
          "ls-files",
          "--stage",
          "-z",
          "--",
          ...paths.map((path) => magic + path),
        ],
        {
          maxBuffer: 256 * 1024,
        },
      );
    },
    status(observeChange: (change: WorkingChange) => void) {
      return checkoutStatus(repo, observeChange);
    },
    treeEntries(head: string, paths: string[]) {
      if (!isGitObjectId(head) || !paths.length)
        throw new GitError("git_failed");
      return run(
        root,
        [
          "--literal-pathspecs",
          "ls-tree",
          "-z",
          "--full-tree",
          head,
          "--",
          ...paths,
        ],
        { maxBuffer: 64 * 1024 },
      );
    },
    async blobs(oids: string[], maxFileBytes: number) {
      const unique = [...new Set(oids)];
      const blobs = new Map<
        string,
        { size: number | null; bytes: Buffer | null }
      >();
      if (!unique.length) return blobs;
      if (!unique.every(isGitObjectId)) throw new GitError("git_failed");
      const input = (ids: string[]) => `${ids.join("\n")}\n`;
      const descriptions = (
        await run(root, ["cat-file", "--batch-check"], {
          input: input(unique),
          maxBuffer: unique.length * 128,
        })
      )
        .trimEnd()
        .split(/\r?\n/);
      if (descriptions.length !== unique.length)
        throw new GitError("git_failed");
      const readable: string[] = [];
      let budget = 0;
      for (const [i, oid] of unique.entries()) {
        const [id, type, length] = descriptions[i]!.split(" ");
        const size = type === "missing" ? null : Number(length);
        if (
          id !== oid ||
          (type !== "missing" &&
            (type !== "blob" || !Number.isSafeInteger(size) || size! < 0))
        )
          throw new GitError("git_failed");
        blobs.set(oid, { size, bytes: null });
        if (size !== null && size <= maxFileBytes) {
          readable.push(oid);
          budget += size + 128;
        }
      }
      if (!readable.length) return blobs;
      const contents = await runBytes(root, ["cat-file", "--batch"], {
        input: input(readable),
        maxBuffer: budget,
      });
      let offset = 0;
      for (const oid of readable) {
        const entry = blobs.get(oid)!;
        const size = entry.size!;
        const end = contents.indexOf(10, offset);
        const header = contents.toString("ascii", offset, end);
        const bytes = contents.subarray(end + 1, end + 1 + size);
        const digest = createHash(oid.length === 40 ? "sha1" : "sha256")
          .update(`blob ${size}\0`)
          .update(bytes)
          .digest("hex");
        offset = end + 1 + size;
        if (
          end < 0 ||
          header !== `${oid} blob ${size}` ||
          bytes.length !== size ||
          digest !== oid ||
          contents[offset] !== 10
        )
          throw new GitError("git_failed");
        offset++;
        entry.bytes = bytes;
      }
      if (offset !== contents.length) throw new GitError("git_failed");
      return blobs;
    },
  };
}
