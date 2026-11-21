import type { DatabaseSync } from "node:sqlite";
import { sha256 } from "./context.ts";

export function createCatalogBlobs(database: DatabaseSync) {
  const insert = database.prepare(`
    INSERT INTO context_blobs (sha256, bytes) VALUES (?, ?) ON CONFLICT(sha256) DO NOTHING
  `);
  const select = database.prepare(
    "SELECT bytes FROM context_blobs WHERE sha256 = ?",
  );

  return {
    save(digest: string, bytes: Buffer) {
      if (sha256(bytes) !== digest) throw new Error("Invalid captured bytes");
      insert.run(digest, bytes);
      const stored = select.get(digest)?.bytes as Uint8Array | undefined;
      if (!stored || !bytes.equals(stored))
        throw new Error("Invalid stored blob");
    },
    read(digest: string, size: number) {
      const stored = select.get(digest)?.bytes as Uint8Array | undefined;
      if (!stored || stored.length !== size || sha256(stored) !== digest)
        throw new Error("Invalid stored blob");
      return stored;
    },
  };
}
