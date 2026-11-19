import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { ErrorCode, Project } from "@laplace/contracts";

const exec = promisify(execFile);
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
};

function isMissing(error: NodeJS.ErrnoException) {
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

function isDenied(error: NodeJS.ErrnoException) {
  return error.code === "EACCES" || error.code === "EPERM";
}

async function folder(path: string): Promise<string> {
  try {
    if (!isAbsolute(path)) throw new GitError("invalid_folder");
    const canonical = await realpath(path);
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

async function gitOnPath(env: NodeJS.ProcessEnv): Promise<string> {
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

function gitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
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
): Pick<Project, "branch" | "head" | "changes"> {
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
      if (record[0] === "2" && !records[++index])
        throw new GitError("git_failed");
    } else if (record.startsWith("u ")) {
      changes.conflicted++;
    } else if (record.startsWith("? ")) {
      changes.untracked++;
    } else {
      throw new GitError("git_failed");
    }
  }
  if (branch === undefined || head === undefined)
    throw new GitError("git_failed");
  return { branch, head, changes };
}

export async function inspectRepository(
  path: string,
  options: GitOptions = {},
): Promise<Project> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? gitDeadlineMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  const selected = await folder(path);
  const sourceEnv = options.env ?? process.env;
  const git = await gitOnPath(sourceEnv);
  const env = gitEnvironment(sourceEnv);

  async function run(
    cwd: string,
    args: string[],
    {
      noMatchIsEmpty = false,
      overrides = {},
    }: {
      noMatchIsEmpty?: boolean;
      overrides?: NodeJS.ProcessEnv;
    } = {},
  ): Promise<string> {
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
          ...args,
        ],
        {
          env: { ...env, ...overrides },
          signal,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      return stdout;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: string };
      if (signal.aborted) throw new GitError("git_timeout");
      if (isMissing(failure)) throw new GitError("git_missing");
      if (noMatchIsEmpty && Number(failure.code) === 1 && !failure.stderr)
        return "";
      const stderr = failure.stderr ?? "";
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

  const topLevel = await run(selected, ["rev-parse", "--show-toplevel"]);
  const root = await folder(topLevel.replace(/\r?\n$/, ""));
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
  const status = parseStatus(
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
  );
  return {
    id: createHash("sha256").update(root).digest("hex"),
    name: basename(root) || root,
    root,
    ...status,
    observedAt: new Date().toISOString(),
  };
}
