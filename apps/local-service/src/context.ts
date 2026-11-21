import { createHash, randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  contextSchemaVersion,
  isContextPath,
  maxContextFiles,
  type ContextEntry,
  type ContextIssue,
  type ContextSnapshot,
  type IndexEntry,
  type OmissionReason,
  type ProjectRecord,
} from "@laplace/contracts";
import {
  defaultContextLimits,
  fileStamp,
  isText,
  Omission,
  omissionReason,
  pathKey,
  sourcePaths,
} from "./context-files.ts";
import { contextCheckout, GitError } from "./git.ts";

export type ContextProject = ProjectRecord & { identity: string | null };
export type ContextCheckout = Awaited<ReturnType<typeof contextCheckout>>;
export type ContextOptions = {
  signal?: AbortSignal;
  limits?: Partial<typeof defaultContextLimits>;
  exclusions?: string[];
  protectedRoots?: string[];
  afterFirstRead?: (path: string) => Promise<void>;
};

export function sha256(bytes: string | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function manifestDigest(snapshot: Omit<ContextSnapshot, "digest">) {
  // Exclude the capture receipt so repeated observations of the same inputs share a digest.
  const {
    schemaVersion,
    projectId,
    gitRoot,
    worktreeIdentity,
    branch,
    head,
    selectedIndexDigest,
    status,
    issue,
    included,
    omitted,
    entries,
  } = snapshot;
  return sha256(
    canonicalJson({
      schemaVersion,
      projectId,
      gitRoot,
      worktreeIdentity,
      branch,
      head,
      selectedIndexDigest,
      status,
      issue,
      included,
      omitted,
      entries,
    }),
  );
}

export async function checkout(project: ContextProject, signal: AbortSignal) {
  if (!project.identity) throw new GitError("project_identity_unknown");
  try {
    return await contextCheckout(project.root, {
      expectedRoot: project.root,
      expectedIdentity: project.identity,
      timeoutMs: defaultContextLimits.deadlineMs,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new GitError("context_timeout");
    if (
      error instanceof GitError &&
      ["invalid_folder", "not_repository"].includes(error.code)
    )
      throw new GitError("project_unavailable");
    throw error;
  }
}

async function indexStamp(gitDir: string) {
  try {
    const index = await lstat(join(gitDir, "index"), { bigint: true });
    if (!index.isFile() || index.nlink !== 1n) throw new GitError("git_failed");
    return fileStamp(index);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function parseIndex(output: string, paths: string[]) {
  const requested = new Set(paths.map(pathKey));
  const index = new Map<string, { path: string; entries: IndexEntry[] }>();
  const records = output.split("\0");
  if (records.pop() !== "") throw new GitError("git_failed");
  for (const record of records) {
    const match =
      /^([0-7]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])\t(.+)$/s.exec(record);
    if (!match) throw new GitError("git_failed");
    const [, mode, oid, stage, path] = match;
    const key = pathKey(path!);
    if (!requested.has(key)) continue;
    const previous = index.get(key);
    const item = { mode: mode!, oid: oid!, stage: Number(stage) };
    if (previous && previous.path !== path) throw new GitError("git_failed");
    if (!previous) index.set(key, { path: path!, entries: [item] });
    else previous.entries.push(item);
  }
  return index;
}

export async function observe(repo: ContextCheckout, paths: string[]) {
  const before = await indexStamp(repo.gitDir);
  const [revision, rawIndex] = await Promise.all([
    repo.revision(),
    repo.indexEntries(paths),
  ]);
  const after = await indexStamp(repo.gitDir);
  return {
    ...revision,
    index: parseIndex(rawIndex, paths),
    indexStamp: after,
    consistent: before === after,
  };
}

export function captureEnvironment(options: ContextOptions) {
  const limits = { ...defaultContextLimits, ...options.limits };
  const deadline = AbortSignal.timeout(limits.deadlineMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  return { limits, signal };
}

export function pathsFor(
  repo: ContextCheckout,
  options: ContextOptions,
  fileBytes: number,
  signal: AbortSignal,
) {
  return sourcePaths(
    repo.root,
    repo.identity.split("/")[0]!,
    options.protectedRoots ?? [],
    options.exclusions ?? [],
    fileBytes,
    signal,
  );
}

export async function browseContext(
  project: ContextProject,
  folder: string,
  prefix: string,
  options: ContextOptions,
) {
  const { limits, signal } = captureEnvironment(options);
  const repo = await checkout(project, signal);
  try {
    const data = await pathsFor(repo, options, limits.fileBytes, signal).browse(
      folder,
      prefix,
      limits.directoryEntries,
    );
    signal.throwIfAborted();
    return { projectId: project.id, ...data };
  } catch {
    throw new GitError(
      signal.aborted ? "context_timeout" : "context_path_unavailable",
    );
  }
}

export async function captureContext(
  project: ContextProject,
  selection: string[],
  options: ContextOptions = {},
) {
  if (
    !selection.length ||
    selection.length > maxContextFiles ||
    !selection.every(isContextPath) ||
    new Set(selection).size !== selection.length
  )
    throw new GitError("invalid_request");

  const startedAt = new Date().toISOString();
  const { limits, signal } = captureEnvironment(options);
  const repo = await checkout(project, signal);
  if (Buffer.byteLength(repo.root) > 8192) throw new GitError("context_limit");
  const paths = pathsFor(repo, options, limits.fileBytes, signal);
  const ordered = [...selection].sort();
  const allowed = ordered.filter((path) => {
    try {
      paths.enforcePolicy(path);
      return true;
    } catch {
      return false;
    }
  });
  const first = await observe(repo, allowed).catch((error: unknown) => {
    if (signal.aborted) throw new GitError("context_timeout");
    throw error;
  });
  const selectedIndexDigest = sha256(canonicalJson([...first.index]));
  const entries = new Map<string, ContextEntry>();
  const blobs = new Map<string, Buffer>();
  let issue: ContextIssue | null = first.consistent
    ? null
    : "repository_changed";

  function omit(path: string, reason: OmissionReason) {
    entries.set(path, {
      path,
      origin: "working_tree",
      outcome: "omitted",
      reason,
    });
    if (reason === "changed") issue ??= "source_changed";
  }

  type Location = Awaited<ReturnType<typeof paths.inspect>>;
  const candidates = new Map<string, Location>();
  const captured = new Map<string, { location: Location; sha256: string }>();
  const seen = new Set<string>();
  let total = 0;

  try {
    for (const path of ordered) {
      signal.throwIfAborted();
      try {
        const location = await paths.inspect(path, "file");
        const key = pathKey(location.canonical);
        if (
          first.index.get(key)?.entries.some((item) => item.mode === "120000")
        )
          throw new Omission("linked_path");
        if (
          first.index.get(key)?.entries.some((item) => item.mode === "160000")
        )
          throw new Omission("nested_project");
        if (seen.has(key)) throw new Omission("duplicate_path");
        seen.add(key);
        if (location.info.size > BigInt(limits.fileBytes))
          throw new Omission("too_large");
        candidates.set(path, location);
      } catch (error) {
        signal.throwIfAborted();
        omit(path, omissionReason(error));
      }
    }
    for (const [path, location] of candidates) {
      if (issue) break;
      signal.throwIfAborted();
      try {
        if (total + Number(location.info.size) > limits.totalBytes)
          throw new Omission("total_limit");
        const bytes = await paths.read(path, location);
        const digest = sha256(bytes);
        if (!isText(bytes)) throw new Omission("binary");
        total += bytes.length;
        captured.set(path, { location, sha256: digest });
        blobs.set(digest, bytes);
        await options.afterFirstRead?.(path);
      } catch (error) {
        signal.throwIfAborted();
        const reason = omissionReason(error);
        omit(
          path,
          reason === "missing" || reason === "linked_path" ? "changed" : reason,
        );
      }
    }
    for (const [path, source] of captured) {
      signal.throwIfAborted();
      try {
        if (sha256(await paths.read(path, source.location)) !== source.sha256)
          throw new Omission("changed");
        entries.set(path, {
          path,
          canonicalPath: source.location.canonical,
          origin: "working_tree",
          outcome: "included",
          size: Number(source.location.info.size),
          sha256: source.sha256,
          contentRef: `sha256:${source.sha256}`,
          index: first.index.get(pathKey(path))?.entries ?? [],
        });
      } catch {
        signal.throwIfAborted();
        omit(path, "changed");
      }
    }
    try {
      const current = await checkout(project, signal);
      const last = await observe(current, allowed);
      if (
        current.gitDir !== repo.gitDir ||
        current.identity !== repo.identity ||
        last.head !== first.head ||
        last.branch !== first.branch ||
        last.indexStamp !== first.indexStamp ||
        !last.consistent ||
        sha256(canonicalJson([...last.index])) !== selectedIndexDigest ||
        (await indexStamp(current.gitDir)) !== last.indexStamp
      )
        issue = "repository_changed";
    } catch {
      signal.throwIfAborted();
      issue = "repository_changed";
    }
    for (const [path, source] of captured) {
      try {
        await paths.assertSame(path, source.location);
      } catch {
        signal.throwIfAborted();
        omit(path, "changed");
      }
    }
    signal.throwIfAborted();
  } catch (error) {
    if (!signal.aborted) throw error;
    issue = "timeout";
  }
  // Closing the app aborts the operation before any catalog write.
  options.signal?.throwIfAborted();
  if (issue) {
    for (const path of ordered) {
      if (entries.get(path)?.outcome !== "omitted")
        omit(path, "capture_invalidated");
    }
    blobs.clear();
  }

  const finalEntries = ordered.map((path) => entries.get(path)!);
  const included = finalEntries.filter(
    (entry) => entry.outcome === "included",
  ).length;
  const omitted = finalEntries.length - included;
  const manifest: Omit<ContextSnapshot, "digest"> = {
    schemaVersion: contextSchemaVersion,
    contextId: randomBytes(32).toString("hex"),
    projectId: project.id,
    gitRoot: repo.root,
    worktreeIdentity: repo.identity,
    branch: first.branch,
    head: first.head,
    selectedIndexDigest,
    startedAt,
    completedAt: new Date().toISOString(),
    status: issue ? "invalidated" : omitted ? "partial" : "complete",
    issue,
    included,
    omitted,
    entries: finalEntries,
  };
  return { snapshot: { ...manifest, digest: manifestDigest(manifest) }, blobs };
}
