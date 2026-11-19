import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Catalog, ProjectRecord } from "@laplace/contracts";

const migrations = [
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY NOT NULL,
     root TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL
   ) STRICT;
   CREATE TABLE workspace_state (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     selected_project_id TEXT REFERENCES projects(id)
   ) STRICT;
   INSERT INTO workspace_state (id) VALUES (1);`,
];

function writeTransaction<T>(database: DatabaseSync, write: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = write();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

export function openCatalog(dataDir: string) {
  if (!isAbsolute(dataDir)) throw new Error("Absolute data directory required");
  mkdirSync(dataDir, { recursive: true });
  // Keep the default rollback journal. Node 24 can bundle a SQLite release
  // affected by the WAL-reset bug when multiple processes open the catalog.
  const database = new DatabaseSync(join(dataDir, "catalog.sqlite3"), {
    enableForeignKeyConstraints: true,
    timeout: 2_000,
  });

  try {
    writeTransaction(database, () => {
      const { user_version: version } = database
        .prepare("PRAGMA user_version")
        .get() as { user_version: number };
      if (version < 0 || version > migrations.length)
        throw new Error("Unsupported catalog version");
      for (let index = version; index < migrations.length; index++) {
        database.exec(migrations[index]!);
        database.exec(`PRAGMA user_version = ${index + 1}`);
      }
    });

    const list = database.prepare(`
      SELECT p.id, p.name, p.root, w.selected_project_id AS selectedProjectId
      FROM projects AS p CROSS JOIN workspace_state AS w
      ORDER BY p.rowid
    `);
    const insert = database.prepare(`
      INSERT INTO projects (id, root, name) VALUES (?, ?, ?)
      ON CONFLICT(root) DO NOTHING
    `);
    const byRoot = database.prepare(
      "SELECT id, name, root FROM projects WHERE root = ?",
    );
    const byId = database.prepare(
      "SELECT id, name, root FROM projects WHERE id = ?",
    );
    const setSelection = database.prepare(
      "UPDATE workspace_state SET selected_project_id = ? WHERE id = 1",
    );

    return {
      list(): Catalog {
        const rows = list.all() as (ProjectRecord & {
          selectedProjectId: string | null;
        })[];
        return {
          projects: rows.map(({ id, name, root }) => ({ id, name, root })),
          selectedProjectId: rows[0]?.selectedProjectId ?? null,
        };
      },
      add({ name, root }: Omit<ProjectRecord, "id">): ProjectRecord {
        return writeTransaction(database, () => {
          insert.run(randomBytes(32).toString("hex"), root, name);
          const project = byRoot.get(root) as ProjectRecord;
          setSelection.run(project.id);
          return project;
        });
      },
      select(id: string): ProjectRecord | undefined {
        return writeTransaction(database, () => {
          const project = byId.get(id) as ProjectRecord | undefined;
          if (project) setSelection.run(project.id);
          return project;
        });
      },
      close() {
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
