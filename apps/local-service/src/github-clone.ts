import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { lstat, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
  parseGitHubRepository,
  type CloneFailure,
  type CloneJob,
  type ClonePhase,
  type ClonePlan,
  type Project,
} from "@laplace/contracts";
import { fileId } from "./context-files.ts";
import {
  canonicalPath,
  folder,
  GitError,
  gitEnvironment,
  gitOnPath,
  inspectRepository,
  type RepositoryInspection,
} from "./git.ts";

type Progress = (phase: ClonePhase, percent: number | null) => void;
type Outcome = "success" | "failure" | "cancelled" | "unconfirmed";
export type CloneRunner = (
  url: string,
  workdir: string,
  signal: AbortSignal,
  progress: Progress,
) => Promise<Outcome>;
type Grant = ClonePlan & {
  parent: string;
  parentId: string;
  expiresAt: number;
};
type Active = {
  job: CloneJob;
  controller: AbortController;
  completion?: Promise<void>;
};
const cloneDeadlineMs = 10 * 60_000;

async function directoryId(path: string) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      metadata.isDirectory() &&
      metadata.ino !== 0n &&
      (await canonicalPath(path)) === path
    )
      return fileId(metadata);
  } catch {
    // A deleted or redirected directory withdraws the original destination.
  }
  throw new GitError("clone_destination_changed");
}

async function requireNewDestination(path: string) {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new GitError("clone_destination_changed");
  }
  throw new GitError("clone_destination_exists");
}

export function runGitHubClone(helper: string): CloneRunner {
  return async (url, workdir, signal, progress) => {
    const git = await gitOnPath(process.env).catch(() => undefined);
    if (!git) return "failure";
    if (signal.aborted) return "cancelled";
    const env = gitEnvironment(
      Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^gcm_/i.test(key)),
      ),
    );
    const args = [
      "-c",
      "protocol.allow=never",
      "-c",
      "protocol.https.allow=always",
      "-c",
      "http.followRedirects=false",
      "-c",
      "http.sslVerify=true",
      "-c",
      "core.hooksPath=NUL",
      "-c",
      "core.protectNTFS=true",
      "-c",
      "credential.helper=",
      "-c",
      "credential.helper=manager",
      "-c",
      "credential.interactive=false",
      "clone",
      "--progress",
      "--template=",
      "--no-recurse-submodules",
      "--",
      url,
      ".",
    ];
    const child = spawn(
      helper,
      ["--laplace-clone-job", String(process.pid), git, ...args],
      {
        cwd: workdir,
        env: {
          ...env,
          GIT_CEILING_DIRECTORIES: dirname(workdir),
          GCM_INTERACTIVE: "never",
        },
        windowsHide: true,
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    child.stdin.on("error", () => undefined);
    const cancel = () => child.stdin.end("cancel\n");
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    let buffer = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const lines = (buffer + chunk).split(/[\r\n]+/);
      buffer = lines.pop()!.slice(-4096);
      for (const line of lines) {
        const match =
          /^(Receiving objects|Resolving deltas|Updating files):\s+(\d{1,3})%/.exec(
            line,
          );
        if (!match) continue;
        const phase =
          match[1] === "Receiving objects"
            ? "receiving"
            : match[1] === "Resolving deltas"
              ? "resolving"
              : "checking_out";
        progress(phase, Math.min(Number(match[2]), 100));
      }
    });
    try {
      const [code] = await once(child, "close");
      if (code === 0) return "success";
      if (code === 1) return "failure";
      if (code === 125) return "cancelled";
      return "unconfirmed";
    } catch {
      return child.pid === undefined ? "failure" : "unconfirmed";
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  };
}

export class GitHubClones {
  private grant: Grant | undefined;
  private current: Active | undefined;

  private readonly runner: CloneRunner | undefined;

  constructor(runner: CloneRunner | undefined) {
    this.runner = runner;
  }

  async prepare(url: string, path: string): Promise<ClonePlan> {
    if (!this.runner || process.platform !== "win32")
      throw new GitError("clone_unavailable");
    if (this.isActive()) throw new GitError("clone_busy");
    const repository = parseGitHubRepository(url);
    if (!repository || !isAbsolute(path)) throw new GitError("invalid_request");
    const parent = await folder(path);
    const parentId = await directoryId(parent);
    const destination = join(parent, repository.name);
    await requireNewDestination(destination);
    if (this.isActive()) throw new GitError("clone_busy");
    const plan = { grantId: randomUUID(), url: repository.url, destination };
    this.grant = {
      ...plan,
      parent,
      parentId,
      expiresAt: Date.now() + 5 * 60_000,
    };
    return plan;
  }

  start(
    grantId: string,
    register: (inspection: RepositoryInspection) => Project,
  ): CloneJob {
    if (this.isActive()) throw new GitError("clone_busy");
    const grant = this.grant;
    if (
      !this.runner ||
      !grant ||
      grant.grantId !== grantId ||
      Date.now() >= grant.expiresAt
    )
      throw new GitError("clone_unavailable");
    this.grant = undefined;
    const { url, destination } = grant;
    const active: Active = {
      controller: new AbortController(),
      job: {
        cloneId: randomUUID(),
        url,
        destination,
        startedAt: new Date().toISOString(),
        state: "cloning",
        phase: "connecting",
        percent: null,
        project: null,
        failure: null,
        leftover: null,
      },
    };
    this.current = active;
    active.completion = this.run(active, grant, this.runner, register);
    return active.job;
  }

  private isActive() {
    return (
      this.current?.job.state === "cloning" ||
      this.current?.job.state === "cancelling"
    );
  }

  status(cloneId: string): CloneJob {
    if (this.current?.job.cloneId !== cloneId)
      throw new GitError("clone_unavailable");
    return this.current.job;
  }

  cancel(cloneId: string): CloneJob {
    const job = this.status(cloneId);
    const current = this.current!;
    if (job.state === "cloning" && job.phase !== "registering") {
      current.job = { ...job, state: "cancelling" };
      current.controller.abort();
    }
    return current.job;
  }

  close() {
    this.current?.controller.abort();
    return this.current?.completion;
  }

  private async run(
    active: Active,
    grant: Grant,
    runner: CloneRunner,
    register: (inspection: RepositoryInspection) => Project,
  ) {
    const timeout = AbortSignal.timeout(cloneDeadlineMs);
    const signal = AbortSignal.any([active.controller.signal, timeout]);
    const { parent, parentId, destination, url } = grant;
    let staged: string | undefined;
    let stageId: string | undefined;
    let settled = true;
    let moved = false;
    let project: Project | null = null;
    let failure: CloneFailure | null = null;
    let leftover: string | null = null;
    try {
      if ((await directoryId(parent)) !== parentId)
        throw new GitError("clone_destination_changed");
      await requireNewDestination(destination);
      signal.throwIfAborted();
      staged = await mkdtemp(join(parent, ".laplace-clone-"));
      stageId = await directoryId(staged);
      settled = false;
      const outcome = await runner(url, staged, signal, (phase, percent) => {
        if (active.job.state === "cloning")
          active.job = { ...active.job, phase, percent };
      });
      settled = outcome !== "unconfirmed";
      if (!settled) throw new GitError("clone_cleanup_pending");
      signal.throwIfAborted();
      if (outcome !== "success") throw new GitError("clone_failed");
      const checkout = await inspectRepository(staged, {
        expectedRoot: staged,
        signal,
      });
      if (
        (await directoryId(parent)) !== parentId ||
        (await directoryId(staged)) !== stageId
      )
        throw new GitError("clone_destination_changed");
      signal.throwIfAborted();
      active.job = { ...active.job, phase: "registering", percent: null };
      // On Windows a directory rename fails if the target directory already exists.
      await rename(staged, destination).catch(async () => {
        await requireNewDestination(destination);
        throw new GitError("clone_destination_changed");
      });
      moved = true;
      const inspection = await inspectRepository(destination, {
        expectedRoot: destination,
        expectedIdentity: checkout.identity,
      });
      project = register(inspection);
    } catch (error) {
      if (moved) {
        failure = "clone_registration_failed";
        leftover = destination;
      } else if (!settled) failure = "clone_cleanup_pending";
      else if (timeout.aborted) failure = "clone_timeout";
      else if (!active.controller.signal.aborted) {
        failure =
          error instanceof GitError &&
          (error.code === "clone_destination_exists" ||
            error.code === "clone_destination_changed")
            ? error.code
            : "clone_failed";
      }
    }
    if (staged && !moved) {
      try {
        if (
          !settled ||
          (await directoryId(parent)) !== parentId ||
          (await directoryId(staged)) !== stageId
        )
          throw new Error("Clone stage identity unavailable");
        await rm(staged, { recursive: true, force: true, maxRetries: 2 });
      } catch {
        failure = "clone_cleanup_pending";
        leftover = staged;
      }
    }
    active.job = {
      ...active.job,
      state: project ? "completed" : failure ? "failed" : "cancelled",
      project,
      failure,
      leftover,
    };
  }
}
