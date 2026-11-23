import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { sha256 } from "./context.ts";
import { GitError } from "./git.ts";

export type CasVerification = {
  state: "verified" | "missing" | "corrupt";
  bytes: Buffer | null;
  size: number | null;
};

export function createCasStore(dataDir: string) {
  const root = join(dataDir, "cas");

  function shardPath(digest: string): string {
    return join(root, digest.slice(0, 2), digest);
  }

  function listObjects(): { digest: string; bytes: number }[] {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      return [];
    }
    const items: { digest: string; bytes: number }[] = [];
    for (const shard of entries) {
      if (!/^[a-f0-9]{2}$/.test(shard)) continue;
      const shardDir = join(root, shard);
      let files: string[];
      try {
        files = readdirSync(shardDir);
      } catch {
        continue;
      }
      for (const digest of files) {
        if (!/^[a-f0-9]{64}$/.test(digest)) continue;
        try {
          const info = statSync(join(shardDir, digest));
          if (info.isFile()) {
            items.push({ digest, bytes: info.size });
          }
        } catch {
          // Ignore transient files cleanly.
        }
      }
    }
    return items.sort((a, b) =>
      a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0,
    );
  }

  function usageBytes(): number {
    return listObjects().reduce((sum, item) => sum + item.bytes, 0);
  }

  function verify(digest: string): CasVerification {
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      return { state: "missing", bytes: null, size: null };
    }
    const filePath = shardPath(digest);
    let raw: Buffer;
    try {
      raw = readFileSync(filePath);
    } catch {
      return { state: "missing", bytes: null, size: null };
    }
    if (sha256(raw) !== digest) {
      return { state: "corrupt", bytes: null, size: raw.length };
    }
    return { state: "verified", bytes: raw, size: raw.length };
  }

  return {
    root,
    listObjects,
    usageBytes,
    verify,

    put(
      bytes: Buffer,
      quotaBytes?: number,
    ): { digest: string; bytes: number; created: boolean } {
      const digest = sha256(bytes);
      const existing = verify(digest);
      if (existing.state === "verified" && existing.size === bytes.length) {
        return { digest, bytes: bytes.length, created: false };
      }

      if (quotaBytes !== undefined) {
        const current = usageBytes();
        if (current + bytes.length > quotaBytes) {
          throw new GitError("pin_quota_exceeded");
        }
      }

      const target = shardPath(digest);
      const dir = join(root, digest.slice(0, 2));
      mkdirSync(dir, { recursive: true });
      const tmp = `${target}.tmp-${randomUUID()}`;
      try {
        writeFileSync(tmp, bytes);
        const check = readFileSync(tmp);
        if (sha256(check) !== digest || !check.equals(bytes)) {
          throw new Error("CAS digest check failed");
        }
        renameSync(tmp, target);
      } catch (error) {
        rmSync(tmp, { force: true });
        if (error instanceof GitError) throw error;
        throw new GitError("catalog_unavailable");
      }
      return { digest, bytes: bytes.length, created: true };
    },

    remove(digest: string): boolean {
      if (!/^[a-f0-9]{64}$/.test(digest)) return false;
      const target = shardPath(digest);
      try {
        statSync(target);
      } catch {
        return false;
      }
      rmSync(target, { force: true });
      return true;
    },
  };
}
