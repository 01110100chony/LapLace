import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isResponse,
  protocolVersion,
  type Operation,
  type Results,
} from "@laplace/contracts";

export const defaultServiceEntry = fileURLToPath(
  new URL("../../src/main.ts", import.meta.url),
);

export type GitInvariantSnapshot = {
  headFile: string;
  indexSha256: string | null;
  refs: string;
  status: string;
};

export function isolatedGitEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
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

export function git(path: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-C",
      path,
      "-c",
      "user.name=Laplace Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: isolatedGitEnv(),
    },
  ).trim();
}

function readOnlyArgs(path: string, args: string[]): string[] {
  return [
    "--no-optional-locks",
    "-C",
    path,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
    ...args,
  ];
}

export function gitReadOnly(path: string, ...args: string[]): string {
  return execFileSync("git", readOnlyArgs(path, args), {
    encoding: "utf8",
    windowsHide: true,
    env: isolatedGitEnv(),
  }).trim();
}

export function gitReadOnlyBuffer(
  path: string,
  args: string[],
  options?: { input?: string; maxBuffer?: number },
): Buffer {
  return execFileSync("git", readOnlyArgs(path, args), {
    windowsHide: true,
    env: isolatedGitEnv(),
    maxBuffer: options?.maxBuffer ?? 16 * 1024 * 1024,
    input: options?.input,
  });
}

export async function readGitInvariantSnapshot(
  repoPath: string,
): Promise<GitInvariantSnapshot> {
  const headFile = await readFile(join(repoPath, ".git", "HEAD"), "utf8");
  let indexSha256: string | null = null;
  try {
    const indexBytes = await readFile(join(repoPath, ".git", "index"));
    indexSha256 = createHash("sha256").update(indexBytes).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const refs = gitReadOnly(repoPath, "for-each-ref");
  const status = gitReadOnly(repoPath, "status", "--porcelain");
  return { headFile, indexSha256, refs, status };
}

export async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "laplace-ipc-"));
  const dataDir = join(root, "dados do aplicativo");
  const stores = new Set<() => Promise<unknown>>();
  t.after(async () => {
    await Promise.all([...stores].map((stop) => stop()));
    await rm(root, { recursive: true, force: true });
  });

  return {
    root,
    dataDir,
    database: join(dataDir, "catalog.sqlite3"),
    start(
      path = dataDir,
      mock?: "completed" | "cancel",
      options?: { entry?: string },
    ) {
      const serviceEntry = options?.entry ?? defaultServiceEntry;
      // Exercise the sidecar's development argument gate without bundling it in the test.
      const args = mock
        ? [
            "--import",
            "data:text/javascript,globalThis.__LAPLACE_DEVELOPMENT__=true",
            serviceEntry,
            path,
            "--codex-mock",
            mock,
          ]
        : [serviceEntry, path];
      const child = spawn(process.execPath, args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "inherit"],
      });
      const closed = once(child, "close");
      const lines = createInterface({ input: child.stdout })[
        Symbol.asyncIterator
      ]();
      const stop = () => {
        if (child.exitCode === null) child.kill();
        return closed;
      };
      stores.add(stop);
      let sequence = 0;
      return {
        async exchange(value: object): Promise<unknown> {
          child.stdin.write(JSON.stringify(value) + "\n");
          return JSON.parse((await lines.next()).value ?? "null");
        },
        async request<K extends Operation>(
          operation: K,
          args: Record<string, unknown> = {},
        ): Promise<Results[K]> {
          const id = `request-${++sequence}`;
          const response = await this.exchange({
            version: protocolVersion,
            id,
            operation,
            ...args,
          });
          assert.ok(
            isResponse(response, id, operation),
            JSON.stringify(response),
          );
          if (!response.ok) throw new Error(response.error.code);
          return response.data;
        },
        async close() {
          child.stdin.end();
          assert.deepEqual(await closed, [0, null]);
          stores.delete(stop);
        },
        async crash() {
          await stop();
          stores.delete(stop);
        },
      };
    },
    async repository(name: string) {
      const path = join(root, name);
      await mkdir(path);
      git(path, "init", "--quiet", "-b", "main");
      return path;
    },
  };
}

export type IpcFixture = Awaited<ReturnType<typeof fixture>>;
export type IpcClient = ReturnType<IpcFixture["start"]>;
