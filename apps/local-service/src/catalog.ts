import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  isGitObservation,
  type Catalog,
  type GitObservation,
  type Project,
  type ProjectRecord,
  type ResumeActivity,
  type SelectedProject,
} from "@laplace/contracts";
import { GitError, type RepositoryInspection } from "./git.ts";
import { contextMigration, createContextStore } from "./context-store.ts";
import {
  contextSearchMigration,
  createContextSearch,
} from "./context-search.ts";
import { codexHistoryMigration, createCodexHistory } from "./codex-history.ts";
import { createTaskStore, tasksMigration } from "./tasks.ts";
import {
  createTaskExecutionStore,
  taskExecutionMigration,
} from "./task-execution-store.ts";
import { createCatalogBlobs } from "./catalog-blobs.ts";
import {
  createTaskResultStore,
  taskResultMigration,
} from "./task-result-store.ts";
import { createWorkingStore, workingMigration } from "./working-store.ts";
import { createResultReviewStore, reviewMigration } from "./result-review.ts";
import { createIdentityStore, identityMigration } from "./identity-store.ts";
import { createEvidenceAdapter } from "./evidence-adapter.ts";
import { createDecisionStore, decisionMigration } from "./decision-store.ts";
import { createF2Store, f2Migration } from "./f2-store.ts";
import { createCasStore } from "./cas-store.ts";
import { createF3Store, f3Migration } from "./f3-store.ts";

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
  `ALTER TABLE projects ADD COLUMN git_identity TEXT;
   CREATE UNIQUE INDEX projects_git_identity ON projects (git_identity);
   CREATE TABLE git_inspections (
     project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id),
     root TEXT NOT NULL,
     git_identity TEXT NOT NULL,
     observed_at TEXT NOT NULL,
     payload TEXT NOT NULL
   ) STRICT;`,
  contextMigration,
  contextSearchMigration,
  codexHistoryMigration,
  tasksMigration,
  taskExecutionMigration,
  taskResultMigration,
  workingMigration,
  reviewMigration,
  identityMigration,
  decisionMigration,
  f2Migration,
  f3Migration,
];

export const catalogSchemaVersion = migrations.length;

type RegisteredProject = ProjectRecord & { identity: string | null };

function readObservation(
  payload: unknown,
  observedAt: unknown,
): GitObservation | null {
  if (typeof payload !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isGitObservation(parsed) && parsed.observedAt === observedAt
      ? parsed
      : null;
  } catch {
    return null;
  }
}

let savepointSequence = 0;

function transaction<T>(
  database: DatabaseSync,
  run: () => T,
  mode: "read" | "write",
): T {
  if (database.isTransaction) {
    const name = `laplace_sp_${++savepointSequence}`;
    database.exec(`SAVEPOINT ${name}`);
    try {
      const result = run();
      database.exec(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      if (database.isTransaction) {
        database.exec(`ROLLBACK TO SAVEPOINT ${name}`);
        database.exec(`RELEASE SAVEPOINT ${name}`);
      }
      throw error;
    }
  }
  database.exec(mode === "write" ? "BEGIN IMMEDIATE" : "BEGIN");
  try {
    const result = run();
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
  // Keep the default rollback journal for compatibility with older catalogs
  // and Node 24 development builds that may carry an older SQLite.
  const database = new DatabaseSync(join(dataDir, "catalog.sqlite3"), {
    enableForeignKeyConstraints: true,
    timeout: 10_000,
  });
  const write = <T>(run: () => T) => transaction(database, run, "write");
  const read = <T>(run: () => T) => transaction(database, run, "read");

  try {
    write(() => {
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
      INSERT INTO projects (id, root, name, git_identity) VALUES (?, ?, ?, ?)
    `);
    const byRoot = database.prepare(
      "SELECT id, name, root, git_identity AS identity FROM projects WHERE root = ?",
    );
    const byIdentity = database.prepare(
      "SELECT id FROM projects WHERE git_identity = ?",
    );
    const byId = database.prepare(
      "SELECT id, name, root, git_identity AS identity FROM projects WHERE id = ?",
    );
    const setSelection = database.prepare(
      "UPDATE workspace_state SET selected_project_id = ? WHERE id = 1",
    );
    const setLocation = database.prepare(
      "UPDATE projects SET root = ?, git_identity = ? WHERE id = ?",
    );
    const cached = database.prepare(`
      SELECT payload, observed_at FROM git_inspections
      WHERE project_id = ? AND root = ? AND git_identity = ?
    `);
    const saveObservation = database.prepare(`
      INSERT INTO git_inspections (project_id, root, git_identity, observed_at, payload)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        root = excluded.root, git_identity = excluded.git_identity,
        observed_at = excluded.observed_at, payload = excluded.payload
    `);
    const latestSnapshotActivity = database.prepare(`
      SELECT
        context_id AS contextId, head, completed_at AS completedAt,
        status, included, omitted
      FROM context_snapshots
      WHERE project_id = ?
      ORDER BY sequence DESC
      LIMIT 1
    `);
    const latestExecutionActivity = database.prepare(`
      SELECT
        e.task_id AS taskId,
        e.execution_id AS executionId,
        e.mode,
        e.state,
        COALESCE(r.recorded_at, e.finished_at, e.started_at) AS recordedAt,
        r.choice AS reviewChoice
      FROM task_executions AS e
      LEFT JOIN result_reviews AS r
        ON r.execution_id = e.execution_id
        AND r.revision = (
          SELECT MAX(revision) FROM result_reviews WHERE execution_id = e.execution_id
        )
      WHERE e.project_id = ?
      ORDER BY e.sequence DESC
      LIMIT 1
    `);

    function lookup(id: string): RegisteredProject {
      const project = byId.get(id) as RegisteredProject | undefined;
      if (!project) throw new GitError("project_unavailable");
      return project;
    }

    function save(
      project: RegisteredProject,
      inspection: RepositoryInspection,
    ): Project {
      const {
        root,
        identity,
        branch,
        head,
        changes,
        observedAt,
        source,
        summaryVersion,
      } = inspection;
      const summary = {
        branch,
        head,
        changes,
        observedAt,
        source,
        summaryVersion,
      };
      if (project.identity !== null && project.identity !== identity)
        throw new GitError("project_identity_mismatch");
      const owner = byIdentity.get(identity);
      if (owner && owner.id !== project.id)
        throw new GitError("project_already_registered");
      if (project.root !== root || project.identity === null)
        setLocation.run(root, identity, project.id);
      const previous = cached.get(project.id, root, identity);
      const valid = readObservation(previous?.payload, previous?.observed_at);
      if (!valid || valid.observedAt <= observedAt)
        saveObservation.run(
          project.id,
          root,
          identity,
          observedAt,
          JSON.stringify(summary),
        );
      return { id: project.id, name: project.name, root, ...summary };
    }

    const blobs = createCatalogBlobs(database);
    const identity = createIdentityStore(database, write);
    const context = createContextStore(database, write, lookup, blobs);
    const contextSearch = createContextSearch(database, context, read, write);
    const evidence = createEvidenceAdapter(database, identity, contextSearch);
    const decisions = createDecisionStore(
      database,
      dataDir,
      write,
      read,
      identity,
      evidence,
    );
    decisions.reconcileTombstones();
    const cas = createCasStore(dataDir);
    const f3 = createF3Store(database, dataDir, write, read, identity, cas);
    f3.reconcileTombstones();
    const f2 = createF2Store(database, write, read, identity);
    const codexHistory = createCodexHistory(database, context);
    return {
      identity,
      context,
      contextSearch,
      evidence,
      decisions,
      cas,
      f3,
      f2,
      codexHistory,
      tasks: createTaskStore(database, write, codexHistory),
      executions: createTaskExecutionStore(
        database,
        read,
        write,
        createTaskResultStore(database, blobs),
        createResultReviewStore(database),
      ),
      working: createWorkingStore(database, blobs, lookup, write, read),
      list(): Catalog {
        const rows = list.all() as (ProjectRecord & {
          selectedProjectId: string | null;
        })[];
        return {
          projects: rows.map(({ id, name, root }) => ({ id, name, root })),
          selectedProjectId: rows[0]?.selectedProjectId ?? null,
        };
      },
      add(inspection: RepositoryInspection): Project {
        const { name, root, identity: identityKey } = inspection;
        return write(() => {
          const existing = byRoot.get(root) as RegisteredProject | undefined;
          if (!existing && byIdentity.get(identityKey))
            throw new GitError("project_already_registered");
          const project = existing ?? {
            id: randomBytes(32).toString("hex"),
            root,
            name,
            identity: identityKey,
          };
          if (!existing) {
            insert.run(project.id, root, name, identityKey);
            identity.registerFromInspection(project, inspection);
          } else {
            identity.syncFromInspection(project.id, inspection);
          }
          const result = save(project, inspection);
          setSelection.run(project.id);
          return result;
        });
      },
      lookup,
      readCachedObservation(id: string): GitObservation | null {
        const { root, identity: gitIdentity } = lookup(id);
        if (!gitIdentity) return null;
        const entry = cached.get(id, root, gitIdentity);
        return readObservation(entry?.payload, entry?.observed_at);
      },
      readLatestActivity(
        legacyProjectId: string,
        logicalProjectId: string,
      ): ResumeActivity {
        return read(() => {
          const snap = latestSnapshotActivity.get(legacyProjectId) as
            | {
                contextId: string;
                head: string | null;
                completedAt: string;
                status: "complete" | "partial" | "invalidated";
                included: number;
                omitted: number;
              }
            | undefined;
          const exec = latestExecutionActivity.get(legacyProjectId) as
            | {
                taskId: string;
                executionId: string;
                mode: string;
                state: string;
                recordedAt: string;
                reviewChoice: "approved" | "rejected" | null;
              }
            | undefined;
          return {
            lastCapture: snap
              ? {
                  contextId: snap.contextId,
                  projectId: logicalProjectId,
                  head: snap.head,
                  completedAt: snap.completedAt,
                  status: snap.status,
                  included: Number(snap.included),
                  omitted: Number(snap.omitted),
                }
              : null,
            lastExecution:
              exec && exec.mode === "mock_development"
                ? {
                    taskId: exec.taskId,
                    executionId: exec.executionId,
                    projectId: logicalProjectId,
                    mode: "mock_development",
                    state: exec.state,
                    recordedAt: exec.recordedAt,
                    reviewChoice: exec.reviewChoice ?? null,
                    isLegacyAttemptNote: true,
                  }
                : null,
          };
        });
      },
      select(id: string): SelectedProject {
        return write(() => {
          const { name, root, identity: gitIdentity } = lookup(id);
          setSelection.run(id);
          const entry = cached.get(id, root, gitIdentity);
          return {
            id,
            name,
            root,
            cached: readObservation(entry?.payload, entry?.observed_at),
          };
        });
      },
      record(
        previous: RegisteredProject,
        inspection: RepositoryInspection,
      ): Project {
        return write(() => {
          const current = lookup(previous.id);
          if (current.root !== previous.root)
            throw new GitError("project_unavailable");
          if (current.root !== inspection.root && byRoot.get(inspection.root))
            throw new GitError("project_already_registered");
          const result = save(current, inspection);
          identity.syncFromInspection(current.id, inspection);
          return result;
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
