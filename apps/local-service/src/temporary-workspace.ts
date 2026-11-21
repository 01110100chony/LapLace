import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileId } from "./context-files.ts";
import { canonicalPath } from "./git.ts";

export async function withTemporaryWorkspace<T>(
  purpose: "codex" | "task",
  protectedRoots: string[],
  use: (root: string) => Promise<T>,
): Promise<T> {
  const temp = await canonicalPath(tmpdir());
  for (const protectedRoot of protectedRoots) {
    const path = relative(protectedRoot, temp);
    if (path === "" || (!isAbsolute(path) && path.split(/[\\/]/)[0] !== ".."))
      throw new Error("Temporary directory belongs to a protected root");
  }
  const root = await mkdtemp(join(temp, `laplace-${purpose}-`));
  const created = await lstat(root, { bigint: true });
  if (created.ino === 0n || !created.isDirectory())
    throw new Error("Temporary workspace identity unavailable");
  try {
    return await use(root);
  } finally {
    try {
      const [resolved, current] = await Promise.all([
        canonicalPath(root),
        lstat(root, { bigint: true }),
      ]);
      if (
        resolved === root &&
        dirname(resolved) === temp &&
        current.isDirectory() &&
        fileId(current) === fileId(created)
      )
        await rm(resolved, { recursive: true, force: true, maxRetries: 2 });
      else console.error(`[laplace:${purpose}] workspace_identity_changed`);
    } catch {
      console.error(`[laplace:${purpose}] workspace_cleanup_failed`);
    }
  }
}
