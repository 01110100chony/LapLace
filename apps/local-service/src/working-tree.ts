import { randomBytes } from "node:crypto";
import {
  isContextPath,
  isWorkingSnapshot,
  workingListLimit,
  workingMaxTextBytes,
  type IndexEntry,
  type OmissionReason,
  type WorkingChange,
  type WorkingFile,
  type WorkingList,
  type WorkingSnapshot,
  type WorkingVersion,
} from "@laplace/contracts";
import {
  captureEnvironment,
  checkout,
  observe,
  pathsFor,
  sha256,
  type ContextCheckout,
  type ContextOptions,
  type ContextProject,
} from "./context.ts";
import { isText, omissionReason, pathKey } from "./context-files.ts";
import { GitError } from "./git.ts";

type Paths = ReturnType<typeof pathsFor>;
type GitVersion = Pick<IndexEntry, "mode" | "oid">;
type GitBlobs = Awaited<ReturnType<ContextCheckout["blobs"]>>;
type Base = { root: string; identity: string };
export type WorkingCapture = Base & {
  snapshot: WorkingSnapshot;
  blobs: Map<string, Buffer>;
};

const absent: WorkingVersion = { kind: "absent" };

function omitted(
  reason: OmissionReason,
  { oid, mode }: Partial<GitVersion> = {},
  size: number | null = null,
): WorkingVersion {
  return {
    kind: "omitted",
    reason,
    size,
    oid: oid ?? null,
    mode: mode ?? null,
  };
}

function textVersion(
  bytes: Buffer,
  captured: Map<string, Buffer>,
  version?: GitVersion,
): WorkingVersion {
  if (!isText(bytes)) return omitted("binary", version, bytes.length);
  const digest = sha256(bytes);
  captured.set(digest, bytes);
  return {
    kind: "text",
    sha256: digest,
    size: bytes.length,
    oid: version?.oid ?? null,
    mode: version?.mode ?? null,
  };
}

function regular(mode: string) {
  return mode === "100644" || mode === "100755";
}

function gitVersion(
  version: GitVersion | undefined,
  objects: GitBlobs,
  captured: Map<string, Buffer>,
): WorkingVersion {
  if (!version) return absent;
  if (!regular(version.mode)) {
    const reason =
      version.mode === "160000"
        ? "nested_project"
        : version.mode === "120000"
          ? "linked_path"
          : "not_file";
    return omitted(reason, version);
  }
  const object = objects.get(version.oid);
  if (!object || object.size === null) return omitted("unreadable", version);
  if (!object.bytes) return omitted("too_large", version, object.size);
  return textVersion(object.bytes, captured, version);
}

async function diskVersion(
  path: string,
  paths: Paths,
  captured: Map<string, Buffer>,
): Promise<WorkingVersion> {
  try {
    const location = await paths.inspect(path, "file");
    if (location.info.size > BigInt(workingMaxTextBytes))
      return omitted("too_large");
    return textVersion(await paths.read(path, location), captured);
  } catch (error) {
    const reason = omissionReason(error);
    if (reason === "changed") throw new GitError("working_changed");
    return reason === "missing" ? absent : omitted(reason);
  }
}

function allowed(path: string, paths: Paths) {
  if (!isContextPath(path)) return false;
  try {
    paths.enforcePolicy(path);
    return true;
  } catch {
    return false;
  }
}

async function changesFor(
  repo: ContextCheckout,
  paths: Paths,
  selection?: Set<string>,
) {
  const seen = new Map<string, WorkingChange>();
  let limited = false;
  const revision = await repo.status((change) => {
    if (selection && !selection.has(change.path)) return;
    if (
      !allowed(change.path, paths) ||
      (change.from !== null && !allowed(change.from, paths))
    )
      return;
    const previous = seen.get(change.path);
    if (previous) {
      if (previous.kind !== "untracked" && change.kind !== "untracked")
        throw new GitError("working_changed");
      seen.set(change.path, {
        ...(change.kind === "untracked" ? previous : change),
        untracked: true,
      });
    } else if (selection || seen.size < workingListLimit) {
      seen.set(change.path, change);
    } else {
      limited = true;
    }
  });
  return { head: revision.head, branch: revision.branch, seen, limited };
}

export async function listWorkingTree(
  project: ContextProject,
  options: ContextOptions,
): Promise<WorkingList> {
  const { signal } = captureEnvironment(options);
  const repo = await checkout(project, signal);
  const paths = pathsFor(repo, options, workingMaxTextBytes, signal);
  const result = await changesFor(repo, paths);
  const current = await checkout(project, signal);
  if (current.gitDir !== repo.gitDir) throw new GitError("working_changed");
  return {
    projectId: project.id,
    head: result.head,
    observedAt: new Date().toISOString(),
    changes: [...result.seen.values()],
    limited: result.limited,
  };
}

function parseTree(output: string, names: string[]) {
  const records = output.split("\0");
  if (records.pop() !== "") throw new GitError("git_failed");
  const versions = new Map<string, GitVersion>();
  const requested = new Set(names);
  for (const record of records) {
    const match =
      /^([0-7]{6}) (?:blob|commit|tree) ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/s.exec(
        record,
      );
    if (!match) throw new GitError("git_failed");
    const [, mode, oid, name] = match;
    if (requested.has(name!)) versions.set(name!, { mode: mode!, oid: oid! });
  }
  return versions;
}

export function workingDigest(
  { root, identity }: Base,
  snapshot: Omit<WorkingSnapshot, "digest">,
) {
  const { schemaVersion, projectId, head, branch, files } = snapshot;
  return sha256(
    JSON.stringify({
      schemaVersion,
      projectId,
      root,
      identity,
      head,
      branch,
      files,
    }),
  );
}

export async function captureWorkingTree(
  project: ContextProject,
  selection: string[],
  options: ContextOptions,
): Promise<WorkingCapture> {
  const { signal } = captureEnvironment(options);
  const repo = await checkout(project, signal);
  const paths = pathsFor(repo, options, workingMaxTextBytes, signal);
  const selected = new Set(selection);
  if (new Set(selection.map(pathKey)).size !== selection.length)
    throw new GitError("invalid_request");
  const first = await changesFor(repo, paths, selected);
  const ordered = [...selected].sort();
  const changes = ordered.map((path) => {
    const change = first.seen.get(path);
    if (!change) throw new GitError("working_changed");
    return change;
  });
  const names = [
    ...new Set(
      changes.flatMap(({ path, from }) =>
        from === null ? [path] : [path, from],
      ),
    ),
  ];
  const base = await observe(repo, names);
  if (
    first.head !== base.head ||
    first.branch !== base.branch ||
    !base.consistent
  )
    throw new GitError("working_changed");
  const tree =
    first.head === null
      ? new Map<string, GitVersion>()
      : parseTree(await repo.treeEntries(first.head, names), names);
  const sources = changes.map((change) => {
    const { path, from, status } = change;
    const stagedRename = status[0] === "R" || status[0] === "C";
    const head = tree.get(from ?? path);
    const index =
      base.index.get(pathKey(from && !stagedRename ? from : path))?.entries ??
      [];
    return { change, head, index };
  });
  const oids = sources.flatMap(({ head, index }) =>
    (head ? [head, ...index] : index)
      .filter(({ mode }) => regular(mode))
      .map(({ oid }) => oid),
  );
  const git = await repo.blobs(oids, workingMaxTextBytes);
  const blobs = new Map<string, Buffer>();
  const files: WorkingFile[] = [];
  for (const { change, head, index } of sources) {
    signal.throwIfAborted();
    files.push({
      ...change,
      head: gitVersion(head, git, blobs),
      index: index.map(({ stage, mode, oid }) => ({
        stage,
        version: gitVersion({ mode, oid }, git, blobs),
      })),
      disk: change.submodule
        ? omitted("nested_project")
        : await diskVersion(change.path, paths, blobs),
    });
  }

  const current = await checkout(project, signal);
  const last = await changesFor(current, paths, selected);
  const currentBase = await observe(current, names);
  if (
    current.gitDir !== repo.gitDir ||
    last.head !== first.head ||
    last.branch !== first.branch ||
    currentBase.head !== base.head ||
    currentBase.branch !== base.branch ||
    !currentBase.consistent ||
    currentBase.indexStamp !== base.indexStamp ||
    JSON.stringify([...currentBase.index]) !==
      JSON.stringify([...base.index]) ||
    changes.some(
      (change) =>
        JSON.stringify(change) !== JSON.stringify(last.seen.get(change.path)),
    )
  )
    throw new GitError("working_changed");
  const checkBlobs = new Map<string, Buffer>();
  for (const file of files) {
    if (file.submodule) continue;
    const current = await diskVersion(file.path, paths, checkBlobs);
    if (JSON.stringify(current) !== JSON.stringify(file.disk))
      throw new GitError("working_changed");
  }
  signal.throwIfAborted();
  const location = { root: repo.root, identity: repo.identity };
  const receipt = {
    projectId: project.id,
    snapshotId: randomBytes(32).toString("hex"),
    schemaVersion: 1 as const,
    head: first.head,
    branch: first.branch,
    capturedAt: new Date().toISOString(),
    files,
  };
  const snapshot: WorkingSnapshot = {
    ...receipt,
    digest: workingDigest(location, receipt),
  };
  if (!isWorkingSnapshot(snapshot)) throw new GitError("working_changed");
  return { ...location, snapshot, blobs };
}
