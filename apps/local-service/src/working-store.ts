import type { DatabaseSync } from "node:sqlite";
import {
  isWorkingSnapshot,
  type WorkingComparison,
  type WorkingLayer,
  type WorkingRef,
  type WorkingVersion,
} from "@laplace/contracts";
import type { createCatalogBlobs } from "./catalog-blobs.ts";
import { GitError } from "./git.ts";
import { workingDigest, type WorkingCapture } from "./working-tree.ts";

export const workingMigration = `
  CREATE TABLE working_snapshots (
    sequence INTEGER PRIMARY KEY,
    snapshot_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id),
    root TEXT NOT NULL,
    identity TEXT NOT NULL,
    payload TEXT NOT NULL
  ) STRICT;
  CREATE INDEX working_snapshots_project_sequence ON working_snapshots (project_id, sequence DESC);
  CREATE TABLE working_blobs (
    snapshot_id TEXT NOT NULL REFERENCES working_snapshots(snapshot_id),
    sha256 TEXT NOT NULL REFERENCES context_blobs(sha256),
    PRIMARY KEY (snapshot_id, sha256)
  ) STRICT, WITHOUT ROWID;
`;

type Transaction = <T>(action: () => T) => T;
type Row = {
  snapshotId: string;
  projectId: string;
  root: string;
  identity: string;
  payload: string;
};

export function createWorkingStore(
  database: DatabaseSync,
  blobs: ReturnType<typeof createCatalogBlobs>,
  lookup: (projectId: string) => { root: string; identity: string | null },
  write: Transaction,
  read: Transaction,
) {
  const columns =
    "snapshot_id AS snapshotId, project_id AS projectId, root, identity, payload";
  const get = database.prepare(
    `SELECT ${columns} FROM working_snapshots WHERE project_id = ? AND snapshot_id = ?`,
  );
  const latest = database.prepare(
    `SELECT ${columns} FROM working_snapshots WHERE project_id = ? ORDER BY sequence DESC LIMIT 1`,
  );
  const save = database.prepare(
    `INSERT INTO working_snapshots (snapshot_id, project_id, root, identity, payload) VALUES (?, ?, ?, ?, ?)`,
  );
  const link = database.prepare(
    `INSERT INTO working_blobs (snapshot_id, sha256) VALUES (?, ?)`,
  );
  const linked = database.prepare(
    `SELECT 1 FROM working_blobs WHERE snapshot_id = ? AND sha256 = ?`,
  );

  function decode(row: Row) {
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(row.payload);
    } catch {
      throw new GitError("working_unavailable");
    }
    if (
      !isWorkingSnapshot(snapshot) ||
      snapshot.projectId !== row.projectId ||
      snapshot.snapshotId !== row.snapshotId ||
      workingDigest(row, snapshot) !== snapshot.digest
    )
      throw new GitError("working_unavailable");
    return snapshot;
  }

  function content(snapshotId: string, version: WorkingVersion) {
    if (version.kind !== "text") return null;
    if (!linked.get(snapshotId, version.sha256))
      throw new GitError("working_unavailable");
    try {
      return Buffer.from(blobs.read(version.sha256, version.size)).toString(
        "utf8",
      );
    } catch {
      throw new GitError("working_unavailable");
    }
  }

  return {
    save(capture: WorkingCapture) {
      const { root, identity, snapshot } = capture;
      const { projectId, snapshotId } = snapshot;
      return write(() => {
        const project = lookup(projectId);
        if (project.root !== root || project.identity !== identity)
          throw new GitError("project_identity_mismatch");
        if (
          !isWorkingSnapshot(snapshot) ||
          workingDigest(capture, snapshot) !== snapshot.digest
        )
          throw new GitError("working_unavailable");
        save.run(
          snapshotId,
          projectId,
          root,
          identity,
          JSON.stringify(snapshot),
        );
        const stored = new Set<string>();
        for (const file of snapshot.files) {
          for (const version of [
            file.head,
            ...file.index.map(({ version }) => version),
            file.disk,
          ]) {
            if (version.kind !== "text" || stored.has(version.sha256)) continue;
            const bytes = capture.blobs.get(version.sha256);
            if (!bytes || version.size !== bytes.length)
              throw new GitError("working_unavailable");
            blobs.save(version.sha256, bytes);
            link.run(snapshotId, version.sha256);
            stored.add(version.sha256);
          }
        }
        return snapshot;
      });
    },
    latest(projectId: string) {
      const row = latest.get(projectId) as Row | undefined;
      return { projectId, snapshot: row ? decode(row) : null };
    },
    compare(
      { projectId, snapshotId }: WorkingRef,
      path: string,
      layer: WorkingLayer,
    ): WorkingComparison {
      return read(() => {
        const row = get.get(projectId, snapshotId) as Row | undefined;
        if (!row) throw new GitError("working_unavailable");
        const file = decode(row).files.find((file) => file.path === path);
        if (!file) throw new GitError("working_unavailable");
        if (file.kind === "conflicted") throw new GitError("working_conflict");
        const index: WorkingVersion = file.index[0]?.version ?? {
          kind: "absent",
        };
        const [before, after] =
          layer === "staged" ? [file.head, index] : [index, file.disk];
        return {
          projectId,
          snapshotId,
          path,
          layer,
          before,
          after,
          beforeText: content(snapshotId, before),
          afterText: content(snapshotId, after),
        };
      });
    },
  };
}
