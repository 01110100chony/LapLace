import { constants, type BigIntStats } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  contextBrowseLimit,
  isContextPath,
  type ContextBrowse,
  type OmissionReason,
} from "@laplace/contracts";
import { canonicalPath } from "./git.ts";

export const defaultContextLimits = {
  fileBytes: 256 * 1024,
  totalBytes: 2 * 1024 * 1024,
  deadlineMs: 10_000,
  directoryEntries: 2_048,
};

const excludedSegments = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".turbo",
  ".next",
  ".nuxt",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
]);
const sensitiveSegments = new Set([
  ".aws",
  ".azure",
  ".gcloud",
  ".kube",
  ".ssh",
  ".gnupg",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  "credentials",
  "credentials.json",
  "secrets",
  "secrets.json",
  "secrets.yml",
  "secrets.yaml",
]);
const sensitiveFile =
  /^(?:\.env|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$))|\.(?:key|pem|p12|pfx|ppk|jks|kdbx)$/i;
const binaryExtension =
  /\.(?:exe|dll|so|dylib|obj|o|a|lib|class|wasm|zip|7z|gz|jar|png|jpe?g|gif|webp|ico|pdf|mp[34]|sqlite3?|db)$/i;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export class Omission extends Error {
  readonly reason: OmissionReason;

  constructor(reason: OmissionReason) {
    super(reason);
    this.reason = reason;
  }
}

export function omissionReason(error: unknown): OmissionReason {
  if (error instanceof Omission) return error.reason;
  if (
    ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
  )
    return "missing";
  if ((error as NodeJS.ErrnoException).code === "ELOOP") return "linked_path";
  return "unreadable";
}

export function pathKey(path: string) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export function fileId({ dev, ino }: BigIntStats) {
  return `${dev}:${ino}`;
}

export function fileStamp(info: BigIntStats) {
  return [
    fileId(info),
    info.size,
    info.mtimeNs,
    info.ctimeNs,
    info.mode,
    info.nlink,
  ].join(":");
}

export function isText(bytes: Buffer) {
  try {
    return !/\p{Cc}/u.test(utf8.decode(bytes).replace(/[\t\n\r\f]/g, ""));
  } catch {
    return false;
  }
}

export function sourcePaths(
  root: string,
  rootIdentity: string,
  protectedRoots: string[],
  exclusions: string[],
  fileBytes: number,
  signal: AbortSignal,
) {
  const blockedRoots = new Set(protectedRoots.map(pathKey));
  const excludedPaths = new Set(exclusions.map((path) => path.toLowerCase()));

  function enforcePolicy(path: string) {
    let prefix = "";
    for (const segment of path.toLowerCase().split("/")) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      if (excludedSegments.has(segment) || excludedPaths.has(prefix))
        throw new Omission("excluded");
      if (sensitiveSegments.has(segment) || sensitiveFile.test(segment))
        throw new Omission("sensitive_path");
    }
  }

  async function checkRoot() {
    signal.throwIfAborted();
    const info = await lstat(root, { bigint: true });
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      fileId(info) !== rootIdentity ||
      (await canonicalPath(root)) !== root
    )
      throw new Omission("changed");
  }

  async function checkDirectory(absolute: string) {
    if (blockedRoots.has(pathKey(absolute)))
      throw new Omission("nested_project");
    try {
      await lstat(join(absolute, ".git"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    throw new Omission("nested_project");
  }

  async function inspect(path: string, kind: "folder" | "file") {
    await checkRoot();
    if (path === "" && kind === "folder")
      return {
        absolute: root,
        canonical: "",
        ancestry: rootIdentity,
        info: await lstat(root, { bigint: true }),
      };
    if (!isContextPath(path)) throw new Omission("excluded");
    enforcePolicy(path);
    const parts = path.split("/");
    const ancestors = [rootIdentity];
    let absolute = root;
    for (const [index, segment] of parts.entries()) {
      signal.throwIfAborted();
      const directory = index < parts.length - 1 || kind === "folder";
      const next = join(absolute, segment);
      const info = await lstat(next, { bigint: true });
      if (info.isSymbolicLink() || info.ino === 0n)
        throw new Omission("linked_path");
      if (directory ? !info.isDirectory() : !info.isFile())
        throw new Omission("not_file");
      if (!directory && info.nlink !== 1n) throw new Omission("linked_path");
      const canonical = await canonicalPath(next);
      // Native resolution catches redirects and alternate Win32 names such as 8.3 aliases.
      if (pathKey(canonical) !== pathKey(next))
        throw new Omission("linked_path");
      absolute = canonical;
      const projectPath = relative(root, absolute).split(sep).join("/");
      if (!isContextPath(projectPath)) throw new Omission("linked_path");
      enforcePolicy(projectPath);
      if (!directory && binaryExtension.test(projectPath))
        throw new Omission("binary");
      if (directory) {
        await checkDirectory(canonical);
        ancestors.push(fileId(info));
      }
      if (index === parts.length - 1)
        return {
          absolute,
          canonical: projectPath,
          ancestry: ancestors.join("/"),
          info,
        };
    }
    throw new Omission("not_file");
  }

  type Location = Awaited<ReturnType<typeof inspect>>;
  const stamp = (location: Location) =>
    `${location.canonical}\0${location.ancestry}\0${fileStamp(location.info)}`;

  async function assertSame(path: string, previous: Location) {
    try {
      if (stamp(await inspect(path, "file")) === stamp(previous)) return;
    } catch {
      signal.throwIfAborted();
    }
    throw new Omission("changed");
  }

  async function read(path: string, location: Location) {
    await assertSame(path, location);
    const flags =
      constants.O_RDONLY |
      (process.platform === "win32"
        ? 0
        : (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
    const handle = await open(location.absolute, flags);
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || fileStamp(before) !== fileStamp(location.info))
        throw new Omission("changed");
      await assertSame(path, location);
      const bytes = Buffer.allocUnsafe(Number(before.size) + 1);
      let length = 0;
      while (length < bytes.length) {
        signal.throwIfAborted();
        const { bytesRead } = await handle.read(
          bytes,
          length,
          bytes.length - length,
          length,
        );
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (
        BigInt(length) !== before.size ||
        fileStamp(await handle.stat({ bigint: true })) !== fileStamp(before)
      )
        throw new Omission("changed");
      await assertSame(path, location);
      return bytes.subarray(0, length);
    } finally {
      await handle.close();
    }
  }

  async function browse(folder: string, prefix: string, scanLimit: number) {
    const location = await inspect(folder, "folder");
    const items: ContextBrowse["items"] = [];
    let scanned = 0;
    let limited = false;
    const directory = await opendir(location.absolute);
    for await (const entry of directory) {
      signal.throwIfAborted();
      if (++scanned > scanLimit || items.length === contextBrowseLimit) {
        limited = true;
        break;
      }
      if (!entry.name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      const kind = entry.isDirectory() ? "folder" : "file";
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const path = location.canonical
        ? `${location.canonical}/${entry.name}`
        : entry.name;
      try {
        const candidate = await inspect(path, kind);
        if (kind === "folder" || candidate.info.size <= fileBytes)
          items.push({ path: candidate.canonical, kind });
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof Omission && error.reason === "changed")
          throw error;
      }
    }
    const after = await inspect(folder, "folder");
    if (
      after.ancestry !== location.ancestry ||
      after.canonical !== location.canonical
    )
      throw new Omission("changed");
    items.sort((a, b) =>
      a.kind === b.kind
        ? a.path < b.path
          ? -1
          : 1
        : a.kind === "folder"
          ? -1
          : 1,
    );
    return { folder: location.canonical, items, limited };
  }

  return { inspect, read, assertSame, browse, enforcePolicy };
}
