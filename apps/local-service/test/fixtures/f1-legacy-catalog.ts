import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type {
  ContextEntry,
  ContextIndexStatus,
  ContextSearchPage,
  ContextSnapshot,
  ContextSourcePreview,
  ContextSourceRef,
  GitObservation,
  ResultReview,
  ReviewReceipt,
  Task,
  TaskChangePreview,
  TaskResult,
  TaskRun,
  TaskRunRef,
} from "@laplace/contracts";
import {
  defaultServiceEntry,
  fixture,
  git,
  gitReadOnly,
  gitReadOnlyBuffer,
  readGitInvariantSnapshot,
  type GitInvariantSnapshot,
  type IpcFixture,
} from "./ipc-harness.ts";

export const LEGACY_SIDECAR_REVISION =
  "9254b502e544d40caa30cfc82c3e530f6dadee23";
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const LEGACY_RUNTIME_PATHS = [
  "apps/local-service/package.json",
  "apps/local-service/src",
  "packages/contracts/package.json",
  "packages/contracts/src",
  "packages/agents/package.json",
  "packages/agents/src",
] as const;

export const LEGACY_PROJECT_A_ID = "a".repeat(64);
export const LEGACY_PROJECT_A_NAME = "Projeto Legado A";
export const LEGACY_PROJECT_B_NAME = "Projeto Sintetico B";
export const PRESERVED_SOURCE_PATH = "src/retomada.ts";
export const PRESERVED_SOURCE_CONTENT =
  "// Fixture sintetica F1-T01 para o projeto A.\n" +
  'export const politicaRetomada = "retomada-verificavel-a";\n' +
  'export const resumo = "Decisao sintetica preservada para oraculo de migracao.";\n';
export const OMITTED_SOURCE_PATH = "dist/gerado.txt";
export const OMITTED_SOURCE_CONTENT =
  "Conteudo gerado sintetico omitido intencionalmente.\n";
export const PROJECT_B_SOURCE_PATH = "src/outro.ts";
export const PROJECT_B_SOURCE_CONTENT =
  'export const projeto = "sintetico-b";\n';
export const LEGACY_TASK_ID = "f1-t01-mock-task";
export const LEGACY_TASK_TITLE = "Validar retomada sintetica";
export const LEGACY_TASK_OBJECTIVE =
  "Registrar tentativa simulada e revisao no oraculo legado.";
export const LEGACY_RUN_REQUEST_ID = "f1-t01-run-1";
export const LEGACY_REVIEW_REQUEST_ID = "f1-t01-review-1";
export const MOCK_RESULT_PATH = "resultado.txt";
export const MOCK_RESULT_BEFORE_CONTENT = "Resultado inicial da simulação.\n";
export const MOCK_RESULT_AFTER_CONTENT = "Execução simulada concluída.\n";

const SCHEMA_TABLES = [
  "projects",
  "workspace_state",
  "git_inspections",
  "context_blobs",
  "context_snapshots",
  "context_entries",
  "context_search_indexes",
  "context_search_documents",
  "context_search_chunks",
  "context_fts",
  "codex_history",
  "tasks",
  "task_executions",
  "task_execution_events",
  "task_results",
  "task_result_files",
  "working_snapshots",
  "working_blobs",
  "result_reviews",
] as const;

export type SchemaTableName = (typeof SCHEMA_TABLES)[number];

export function sha256(bytes: string | Uint8Array): string {
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

function legacyManifestDigest(
  snapshot: Omit<ContextSnapshot, "digest">,
): string {
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

export type LegacySidecarRuntime = {
  revision: string;
  root: string;
  entry: string;
  fileCount: number;
  treeDigest: string;
};

export type LegacyCatalogOracle = {
  schema: {
    initialUserVersion: number;
    userVersion: number;
    sqliteVersion: string;
    journalMode: string;
    integrityCheck: string;
    foreignKeyViolations: number;
  };
  counts: Record<SchemaTableName, number>;
  selection: {
    selectedProjectId: string | null;
  };
  projects: Array<{
    id: string;
    name: string;
    root: string;
    gitIdentity: string | null;
    inspectionObservedAt: string | null;
    inspectionHead: string | null;
    inspectionBranch: string | null;
    inspectionSource: string | null;
    inspectionSummaryVersion: number | null;
  }>;
  links: {
    snapshots: Array<{
      contextId: string;
      projectId: string;
      schemaVersion: number;
      gitRoot: string;
      worktreeIdentity: string;
      branch: string | null;
      head: string | null;
      status: string;
      issue: string | null;
      included: number;
      omitted: number;
      digest: string;
      selectedIndexDigest: string;
      entries: Array<{
        ordinal: number;
        path: string;
        outcome: ContextEntry["outcome"];
        reason: string | null;
        blobSha256: string | null;
      }>;
    }>;
    searchIndexes: Array<{
      contextId: string;
      projectId: string;
      indexedAt: string;
      files: number;
      chunks: number;
    }>;
    documents: Array<{
      projectId: string;
      path: string;
      sha256: string;
      chunks: number;
    }>;
    tasks: Array<{
      taskId: string;
      projectId: string;
      sourceExecutionId: string | null;
      revision: number;
      createDigest: string;
    }>;
    executions: Array<{
      executionId: string;
      projectId: string;
      taskId: string;
      requestId: string;
      taskRevision: number;
      mode: string;
      state: string;
      lastSeq: number;
      hasResult: boolean;
    }>;
    resultFiles: Array<{
      executionId: string;
      projectId: string;
      taskId: string;
      path: string;
      beforeDigest: string | null;
      beforeSize: number | null;
      afterDigest: string | null;
      afterSize: number | null;
    }>;
    reviews: Array<{
      executionId: string;
      projectId: string;
      taskId: string;
      revision: number;
      requestId: string;
      resultDigest: string;
      capturedAt: string;
      choice: string;
      recordedAt: string;
    }>;
  };
  digests: {
    blobs: Array<{
      sha256: string;
      bytesLength: number;
    }>;
    preservedSourceSha256: string;
    omittedSourceSha256: string;
    taskCreateDigest: string | null;
    mockBeforeSha256: string | null;
    mockAfterSha256: string | null;
  };
};

export type ConsistentCatalogCopy = {
  copyDataDir: string;
  copyDatabase: string;
  sourceSha256: string;
  copySha256: string;
  bytes: number;
};

export type BuiltLegacyProject = {
  id: string;
  name: string;
  root: string;
  head: string;
  gitBefore: GitInvariantSnapshot;
};

export type BuiltF1LegacyFixture = {
  env: IpcFixture;
  legacyRuntime: LegacySidecarRuntime;
  projectA: BuiltLegacyProject;
  projectB: BuiltLegacyProject;
  expectedList: {
    projects: Array<{ id: string; name: string; root: string }>;
    selectedProjectId: string | null;
  };
  snapshot: ContextSnapshot;
  indexStatus: ContextIndexStatus;
  searchBeforeRestart: ContextSearchPage;
  sourceRef: ContextSourceRef;
  previewBeforeRestart: ContextSourcePreview;
  task: Task;
  execution: TaskRun;
  execScope: TaskRunRef;
  execResult: TaskResult;
  execChange: TaskChangePreview;
  review: TaskRunRef & ReviewReceipt;
  reviewStatusBeforeRestart: ResultReview;
  copy: ConsistentCatalogCopy;
  oracle: LegacyCatalogOracle;
};

export async function prepareLegacySidecarRuntime(
  targetDir: string,
): Promise<LegacySidecarRuntime> {
  const resolvedCommit = gitReadOnly(
    REPO_ROOT,
    "rev-parse",
    "--verify",
    `${LEGACY_SIDECAR_REVISION}^{commit}`,
  );
  assert.equal(resolvedCommit, LEGACY_SIDECAR_REVISION);

  const rawTreeBuffer = gitReadOnlyBuffer(REPO_ROOT, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    LEGACY_SIDECAR_REVISION,
    "--",
    ...LEGACY_RUNTIME_PATHS,
  ]);
  const rawTree = rawTreeBuffer.toString("utf8");
  const records = rawTree.split("\0");
  assert.equal(records.pop(), "");
  assert.ok(records.length > 0, "Expected tracked files in legacy revision");

  const entries = records.map((record) => {
    const match = /^[0-7]{6} blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(
      record,
    );
    assert.ok(match, `Unexpected ls-tree record: ${record}`);
    return { oid: match[1]!, path: match[2]! };
  });
  const treeDigest = sha256(rawTreeBuffer);

  const batch = gitReadOnlyBuffer(REPO_ROOT, ["cat-file", "--batch"], {
    input: entries.map((item) => item.oid).join("\n") + "\n",
    maxBuffer: 32 * 1024 * 1024,
  });

  await mkdir(targetDir, { recursive: true });
  let offset = 0;
  for (const item of entries) {
    const lineEnd = batch.indexOf(10, offset);
    assert.ok(lineEnd > offset, `Missing cat-file header for ${item.path}`);
    const header = batch.subarray(offset, lineEnd).toString("ascii");
    const match = /^([a-f0-9]{40}|[a-f0-9]{64}) blob (\d+)$/.exec(header);
    assert.ok(match && match[1] === item.oid, `Unexpected header: ${header}`);
    const size = Number(match[2]);
    const contentStart = lineEnd + 1;
    const contentEnd = contentStart + size;
    assert.ok(
      contentEnd < batch.length && batch[contentEnd] === 10,
      `Truncated blob for ${item.path}`,
    );
    const content = batch.subarray(contentStart, contentEnd);
    offset = contentEnd + 1;
    const destination = join(targetDir, ...item.path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  assert.equal(offset, batch.length);

  // Node 24 refuses TypeScript stripping when the resolved realpath contains
  // node_modules, so extract workspace packages under packages/ and link via
  // junctions inside node_modules/@laplace.
  const scopeDir = join(targetDir, "node_modules", "@laplace");
  await mkdir(scopeDir, { recursive: true });
  const linkType = process.platform === "win32" ? "junction" : "dir";
  for (const pkg of ["contracts", "agents"] as const) {
    await symlink(
      join(targetDir, "packages", pkg),
      join(scopeDir, pkg),
      linkType,
    );
  }

  const entry = join(targetDir, "apps", "local-service", "src", "main.ts");
  await access(entry);
  assert.notEqual(
    realpathSync.native(entry),
    realpathSync.native(defaultServiceEntry),
  );

  return {
    revision: LEGACY_SIDECAR_REVISION,
    root: targetDir,
    entry,
    fileCount: entries.length,
    treeDigest,
  };
}

export async function seedD04Catalog(
  dataDir: string,
  databasePath: string,
  project: { id: string; root: string; name: string },
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const legacy = new DatabaseSync(databasePath);
  try {
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        root TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL
      ) STRICT;
      CREATE TABLE workspace_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        selected_project_id TEXT REFERENCES projects(id)
      ) STRICT;
      PRAGMA user_version = 1;
    `);
    legacy
      .prepare("INSERT INTO projects (id, root, name) VALUES (?, ?, ?)")
      .run(project.id, project.root, project.name);
    legacy
      .prepare(
        "INSERT INTO workspace_state (id, selected_project_id) VALUES (1, ?)",
      )
      .run(project.id);
    const versionRow = legacy.prepare("PRAGMA user_version").get() as
      { user_version: number } | undefined;
    assert.equal(versionRow?.user_version, 1);
  } finally {
    legacy.close();
  }
}

export function readLegacyMigrationOracle(
  databasePath: string,
  initialSchemaVersion: number,
): LegacyCatalogOracle {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const userVersion = Number(
      (
        database.prepare("PRAGMA user_version").get() as {
          user_version: number;
        }
      ).user_version,
    );
    const sqliteVersion = String(
      (
        database.prepare("SELECT sqlite_version() AS v").get() as {
          v: string;
        }
      ).v,
    );
    const journalMode = String(
      (
        database.prepare("PRAGMA journal_mode").get() as {
          journal_mode: string;
        }
      ).journal_mode,
    );
    const integrityCheck = String(
      (
        database.prepare("PRAGMA integrity_check").get() as {
          integrity_check: string;
        }
      ).integrity_check,
    );
    const foreignKeyViolations = database
      .prepare("PRAGMA foreign_key_check")
      .all().length;

    const counts = {} as Record<SchemaTableName, number>;
    for (const table of SCHEMA_TABLES) {
      const row = database
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count: number };
      counts[table] = Number(row.count);
    }

    const selectionRow = database
      .prepare("SELECT selected_project_id FROM workspace_state WHERE id = 1")
      .get() as { selected_project_id: string | null } | undefined;

    const projectRows = database
      .prepare(
        `SELECT p.id, p.name, p.root, p.git_identity AS gitIdentity,
           g.observed_at AS inspectionObservedAt, g.payload AS inspectionPayload
         FROM projects AS p
         LEFT JOIN git_inspections AS g ON g.project_id = p.id
         ORDER BY p.rowid`,
      )
      .all() as Array<{
      id: string;
      name: string;
      root: string;
      gitIdentity: string | null;
      inspectionObservedAt: string | null;
      inspectionPayload: string | null;
    }>;

    const projects = projectRows.map((row) => {
      const inspection = row.inspectionPayload
        ? (JSON.parse(row.inspectionPayload) as GitObservation)
        : null;
      return {
        id: row.id,
        name: row.name,
        root: row.root,
        gitIdentity: row.gitIdentity,
        inspectionObservedAt: row.inspectionObservedAt,
        inspectionHead: inspection?.head ?? null,
        inspectionBranch: inspection?.branch ?? null,
        inspectionSource: inspection?.source ?? null,
        inspectionSummaryVersion: inspection?.summaryVersion ?? null,
      };
    });

    const snapshotRows = database
      .prepare(
        `SELECT context_id AS contextId, project_id AS projectId, schema_version AS schemaVersion,
           git_root AS gitRoot, worktree_identity AS worktreeIdentity, branch, head, status,
           issue, included, omitted, digest, selected_index_digest AS selectedIndexDigest
         FROM context_snapshots
         ORDER BY sequence`,
      )
      .all() as Array<{
      contextId: string;
      projectId: string;
      schemaVersion: number;
      gitRoot: string;
      worktreeIdentity: string;
      branch: string | null;
      head: string | null;
      status: string;
      issue: string | null;
      included: number;
      omitted: number;
      digest: string;
      selectedIndexDigest: string;
    }>;

    const entryStmt = database.prepare(
      `SELECT ordinal, path, blob_sha256 AS blobSha256, payload
       FROM context_entries
       WHERE context_id = ?
       ORDER BY ordinal`,
    );

    const snapshots = snapshotRows.map((snap) => {
      const entryRows = entryStmt.all(snap.contextId) as Array<{
        ordinal: number;
        path: string;
        blobSha256: string | null;
        payload: string;
      }>;
      return {
        ...snap,
        entries: entryRows.map((entryRow) => {
          const parsed = JSON.parse(entryRow.payload) as ContextEntry;
          return {
            ordinal: entryRow.ordinal,
            path: entryRow.path,
            outcome: parsed.outcome,
            reason: parsed.outcome === "omitted" ? parsed.reason : null,
            blobSha256: entryRow.blobSha256,
          };
        }),
      };
    });

    const searchIndexes = database
      .prepare(
        `SELECT idx.context_id AS contextId, snap.project_id AS projectId,
           idx.indexed_at AS indexedAt, idx.files, idx.chunks
         FROM context_search_indexes AS idx
         JOIN context_snapshots AS snap ON snap.context_id = idx.context_id
         ORDER BY snap.sequence`,
      )
      .all() as LegacyCatalogOracle["links"]["searchIndexes"];

    const documents = database
      .prepare(
        `SELECT doc.project_id AS projectId, doc.path, doc.sha256,
           COUNT(chunk.id) AS chunks
         FROM context_search_documents AS doc
         LEFT JOIN context_search_chunks AS chunk ON chunk.document_id = doc.id
         GROUP BY doc.id
         ORDER BY doc.id`,
      )
      .all() as LegacyCatalogOracle["links"]["documents"];

    const tasks = database
      .prepare(
        `SELECT task_id AS taskId, project_id AS projectId,
           source_execution_id AS sourceExecutionId, revision,
           create_digest AS createDigest
         FROM tasks
         ORDER BY sequence`,
      )
      .all() as LegacyCatalogOracle["links"]["tasks"];

    const executionRows = database
      .prepare(
        `SELECT exec.execution_id AS executionId, exec.project_id AS projectId,
           exec.task_id AS taskId, exec.request_id AS requestId,
           exec.task_revision AS taskRevision, exec.mode, exec.state,
           exec.last_seq AS lastSeq,
           CASE WHEN res.execution_id IS NOT NULL THEN 1 ELSE 0 END AS hasResult
         FROM task_executions AS exec
         LEFT JOIN task_results AS res ON res.execution_id = exec.execution_id
         ORDER BY exec.sequence`,
      )
      .all() as Array<{
      executionId: string;
      projectId: string;
      taskId: string;
      requestId: string;
      taskRevision: number;
      mode: string;
      state: string;
      lastSeq: number;
      hasResult: number;
    }>;

    const executions = executionRows.map((row) => ({
      ...row,
      hasResult: row.hasResult === 1,
    }));

    const resultFiles = database
      .prepare(
        `SELECT rf.execution_id AS executionId, exec.project_id AS projectId,
           exec.task_id AS taskId, rf.path,
           rf.before_digest AS beforeDigest, rf.before_size AS beforeSize,
           rf.after_digest AS afterDigest, rf.after_size AS afterSize
         FROM task_result_files AS rf
         JOIN task_executions AS exec ON exec.execution_id = rf.execution_id
         ORDER BY exec.sequence, rf.path`,
      )
      .all() as LegacyCatalogOracle["links"]["resultFiles"];

    const reviews = database
      .prepare(
        `SELECT rev.execution_id AS executionId, exec.project_id AS projectId,
           exec.task_id AS taskId, rev.revision, rev.request_id AS requestId,
           rev.result_digest AS resultDigest, rev.captured_at AS capturedAt,
           rev.choice, rev.recorded_at AS recordedAt
         FROM result_reviews AS rev
         JOIN task_executions AS exec ON exec.execution_id = rev.execution_id
         ORDER BY exec.sequence, rev.revision`,
      )
      .all() as LegacyCatalogOracle["links"]["reviews"];

    const blobRows = database
      .prepare("SELECT sha256, bytes FROM context_blobs ORDER BY sha256")
      .all() as Array<{ sha256: string; bytes: Uint8Array }>;

    const blobs = blobRows.map((row) => {
      const buf = Buffer.from(row.bytes);
      assert.equal(sha256(buf), row.sha256);
      return {
        sha256: row.sha256,
        bytesLength: buf.length,
      };
    });

    const firstTask = tasks[0];
    const firstResultFile = resultFiles[0];

    return {
      schema: {
        initialUserVersion: initialSchemaVersion,
        userVersion,
        sqliteVersion,
        journalMode,
        integrityCheck,
        foreignKeyViolations,
      },
      counts,
      selection: {
        selectedProjectId: selectionRow?.selected_project_id ?? null,
      },
      projects,
      links: {
        snapshots,
        searchIndexes,
        documents,
        tasks,
        executions,
        resultFiles,
        reviews,
      },
      digests: {
        blobs,
        preservedSourceSha256: sha256(PRESERVED_SOURCE_CONTENT),
        omittedSourceSha256: sha256(OMITTED_SOURCE_CONTENT),
        taskCreateDigest: firstTask?.createDigest ?? null,
        mockBeforeSha256: firstResultFile?.beforeDigest ?? null,
        mockAfterSha256: firstResultFile?.afterDigest ?? null,
      },
    };
  } finally {
    database.close();
  }
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await access(path);
    assert.fail(`Unexpected SQLite sidecar file present: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function createConsistentCatalogCopy(
  sourceDataDir: string,
  sourceDatabase: string,
  copyDataDir: string,
): Promise<ConsistentCatalogCopy> {
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    await assertAbsent(`${sourceDatabase}${suffix}`);
  }
  assert.ok(sourceDataDir.length > 0);
  const check = new DatabaseSync(sourceDatabase, { readOnly: true });
  try {
    const mode = (
      check.prepare("PRAGMA journal_mode").get() as { journal_mode: string }
    ).journal_mode;
    assert.notEqual(mode.toLowerCase(), "wal");
    const integrity = (
      check.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      }
    ).integrity_check;
    assert.equal(integrity, "ok");
    assert.deepEqual(check.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    check.close();
  }

  await mkdir(copyDataDir, { recursive: true });
  const copyDatabase = join(copyDataDir, "catalog.sqlite3");
  await copyFile(sourceDatabase, copyDatabase);

  const [sourceBytes, copyBytes] = await Promise.all([
    readFile(sourceDatabase),
    readFile(copyDatabase),
  ]);
  const sourceSha256 = sha256(sourceBytes);
  const copySha256 = sha256(copyBytes);
  assert.equal(sourceSha256, copySha256);
  const info = await stat(copyDatabase);
  assert.equal(info.size, sourceBytes.length);

  return {
    copyDataDir,
    copyDatabase,
    sourceSha256,
    copySha256,
    bytes: sourceBytes.length,
  };
}

export async function buildF1LegacyFixture(
  t: TestContext,
): Promise<BuiltF1LegacyFixture> {
  const env = await fixture(t);
  const legacyRuntime = await prepareLegacySidecarRuntime(
    join(env.root, "legacy-runtime"),
  );

  const repoA = await env.repository(LEGACY_PROJECT_A_NAME);
  git(repoA, "config", "core.autocrlf", "false");
  await mkdir(join(repoA, "src"), { recursive: true });
  await mkdir(join(repoA, "dist"), { recursive: true });
  await writeFile(join(repoA, PRESERVED_SOURCE_PATH), PRESERVED_SOURCE_CONTENT);
  await writeFile(join(repoA, OMITTED_SOURCE_PATH), OMITTED_SOURCE_CONTENT);
  git(repoA, "add", "--", PRESERVED_SOURCE_PATH, OMITTED_SOURCE_PATH);
  git(repoA, "commit", "-qm", "Base sintetica A");
  const headA = git(repoA, "rev-parse", "HEAD");
  const rootA = realpathSync.native(repoA);

  const repoB = await env.repository(LEGACY_PROJECT_B_NAME);
  git(repoB, "config", "core.autocrlf", "false");
  await mkdir(join(repoB, "src"), { recursive: true });
  await writeFile(join(repoB, PROJECT_B_SOURCE_PATH), PROJECT_B_SOURCE_CONTENT);
  git(repoB, "add", "--", PROJECT_B_SOURCE_PATH);
  git(repoB, "commit", "-qm", "Base sintetica B");
  const headB = git(repoB, "rev-parse", "HEAD");
  const rootB = realpathSync.native(repoB);

  const [gitBeforeA, gitBeforeB] = await Promise.all([
    readGitInvariantSnapshot(repoA),
    readGitInvariantSnapshot(repoB),
  ]);

  await seedD04Catalog(env.dataDir, env.database, {
    id: LEGACY_PROJECT_A_ID,
    root: rootA,
    name: LEGACY_PROJECT_A_NAME,
  });

  // Launch the isolated legacy sidecar reconstructed from LEGACY_SIDECAR_REVISION
  // so v10 catalog creation is decoupled from the candidate under test.
  const legacy = env.start(env.dataDir, "completed", {
    entry: legacyRuntime.entry,
  });

  const initialList = await legacy.request("workspace.list");
  assert.deepEqual(initialList, {
    projects: [
      { id: LEGACY_PROJECT_A_ID, name: LEGACY_PROJECT_A_NAME, root: rootA },
    ],
    selectedProjectId: LEGACY_PROJECT_A_ID,
  });

  const initialSelectA = await legacy.request("project.select", {
    projectId: LEGACY_PROJECT_A_ID,
  });
  assert.equal(initialSelectA.id, LEGACY_PROJECT_A_ID);
  assert.equal(initialSelectA.root, rootA);
  assert.equal(initialSelectA.cached, null);

  const inspectedA = await legacy.request("project.inspect", {
    projectId: LEGACY_PROJECT_A_ID,
  });
  assert.equal(inspectedA.id, LEGACY_PROJECT_A_ID);
  assert.equal(inspectedA.root, rootA);
  assert.equal(inspectedA.branch, "main");
  assert.equal(inspectedA.head, headA);

  const addedB = await legacy.request("workspace.addLocal", { path: repoB });
  assert.notEqual(addedB.id, LEGACY_PROJECT_A_ID);
  assert.equal(addedB.root, rootB);
  assert.equal(addedB.branch, "main");
  assert.equal(addedB.head, headB);

  const inspectedB = await legacy.request("project.inspect", {
    projectId: addedB.id,
  });
  assert.equal(inspectedB.id, addedB.id);
  assert.equal(inspectedB.root, rootB);
  assert.equal(inspectedB.head, headB);

  const selectedB = await legacy.request("project.select", {
    projectId: addedB.id,
  });
  assert.equal(selectedB.cached?.head, headB);

  const selectedA = await legacy.request("project.select", {
    projectId: LEGACY_PROJECT_A_ID,
  });
  assert.equal(selectedA.cached?.head, headA);

  const expectedList = await legacy.request("workspace.list");
  assert.deepEqual(expectedList, {
    projects: [
      { id: LEGACY_PROJECT_A_ID, name: LEGACY_PROJECT_A_NAME, root: rootA },
      { id: addedB.id, name: LEGACY_PROJECT_B_NAME, root: rootB },
    ],
    selectedProjectId: LEGACY_PROJECT_A_ID,
  });

  const snapshot = await legacy.request("context.capture", {
    projectId: LEGACY_PROJECT_A_ID,
    paths: [PRESERVED_SOURCE_PATH, OMITTED_SOURCE_PATH],
  });
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.included, 1);
  assert.equal(snapshot.omitted, 1);
  assert.equal(snapshot.issue, null);
  assert.equal(snapshot.digest, legacyManifestDigest(snapshot));

  const includedEntry = snapshot.entries.find(
    (item) => item.path === PRESERVED_SOURCE_PATH,
  );
  const omittedEntry = snapshot.entries.find(
    (item) => item.path === OMITTED_SOURCE_PATH,
  );
  assert.ok(includedEntry && includedEntry.outcome === "included");
  assert.equal(includedEntry.sha256, sha256(PRESERVED_SOURCE_CONTENT));
  assert.deepEqual(omittedEntry, {
    path: OMITTED_SOURCE_PATH,
    origin: "working_tree",
    outcome: "omitted",
    reason: "excluded",
  });

  const indexStatus = await legacy.request("context.index", {
    projectId: LEGACY_PROJECT_A_ID,
    contextId: snapshot.contextId,
    force: false,
  });
  assert.equal(indexStatus.eligible, true);
  assert.ok(indexStatus.indexedAt !== null);
  assert.equal(indexStatus.files, 1);
  assert.equal(indexStatus.chunks, 1);

  const searchBeforeRestart = await legacy.request("context.search", {
    projectId: LEGACY_PROJECT_A_ID,
    scope: "snapshot",
    contextId: snapshot.contextId,
    query: "retomada verificavel",
    offset: 0,
  });
  assert.equal(searchBeforeRestart.items.length, 1);
  const hit = searchBeforeRestart.items[0]!;
  assert.equal(hit.path, PRESERVED_SOURCE_PATH);
  assert.equal(hit.text, PRESERVED_SOURCE_CONTENT);

  const omittedSearch = await legacy.request("context.search", {
    projectId: LEGACY_PROJECT_A_ID,
    scope: "snapshot",
    contextId: snapshot.contextId,
    query: "omitido intencionalmente",
    offset: 0,
  });
  assert.equal(omittedSearch.items.length, 0);

  const sourceRef: ContextSourceRef = {
    contextId: snapshot.contextId,
    path: hit.path,
    sha256: hit.sha256,
    chunk: hit.chunk,
  };
  const previewBeforeRestart = await legacy.request("context.sourcePreview", {
    projectId: LEGACY_PROJECT_A_ID,
    ...sourceRef,
  });
  assert.equal(previewBeforeRestart.text, PRESERVED_SOURCE_CONTENT);

  const task = await legacy.request("task.create", {
    projectId: LEGACY_PROJECT_A_ID,
    taskId: LEGACY_TASK_ID,
    title: LEGACY_TASK_TITLE,
    objective: LEGACY_TASK_OBJECTIVE,
    source: null,
  });
  assert.equal(task.revision, 1);

  const startedRun = await legacy.request("task.start", {
    projectId: LEGACY_PROJECT_A_ID,
    taskId: LEGACY_TASK_ID,
    requestId: LEGACY_RUN_REQUEST_ID,
    expectedRevision: task.revision,
  });
  assert.equal(startedRun.mode, "mock_development");

  let completedRun: TaskRun | null = null;
  for (let attempt = 0; attempt < 150; attempt++) {
    const status = await legacy.request("execution.latest", {
      projectId: LEGACY_PROJECT_A_ID,
      taskId: LEGACY_TASK_ID,
    });
    if (status.latest?.finishedAt) {
      completedRun = status.latest;
      break;
    }
    await delay(20);
  }
  assert.ok(completedRun, "Mock execution did not finish within timeout");
  assert.equal(completedRun.state, "completed");
  assert.equal(completedRun.mode, "mock_development");

  const execScope: TaskRunRef = {
    projectId: LEGACY_PROJECT_A_ID,
    taskId: LEGACY_TASK_ID,
    executionId: completedRun.executionId,
  };

  const execResult = await legacy.request("execution.result", execScope);
  assert.ok(execResult.result);
  assert.equal(execResult.result.mode, "mock_development");
  assert.deepEqual(
    execResult.result.changes.map((item) => item.path),
    [MOCK_RESULT_PATH],
  );

  const execChange = await legacy.request("execution.change", {
    ...execScope,
    path: MOCK_RESULT_PATH,
  });
  assert.equal(execChange.beforeText, MOCK_RESULT_BEFORE_CONTENT);
  assert.equal(execChange.afterText, MOCK_RESULT_AFTER_CONTENT);

  const reviewBefore = await legacy.request("result.reviewStatus", execScope);
  assert.equal(reviewBefore.latest, null);
  assert.equal(reviewBefore.evidence.source, "mock_result");
  assert.equal(
    reviewBefore.evidence.resultDigest,
    sha256(JSON.stringify(execResult)),
  );

  const review = await legacy.request("result.review", {
    ...execScope,
    requestId: LEGACY_REVIEW_REQUEST_ID,
    expectedBase: reviewBefore.evidence.resultDigest,
    expectedRevision: 0,
    choice: "approved",
  });
  assert.equal(review.revision, 1);
  assert.equal(review.choice, "approved");

  const reviewStatusBeforeRestart = await legacy.request(
    "result.reviewStatus",
    execScope,
  );
  assert.equal(reviewStatusBeforeRestart.latest?.revision, 1);
  assert.equal(reviewStatusBeforeRestart.latest?.choice, "approved");

  await legacy.close();

  // Prove the catalog and its consistent copy reached schema v10 before any
  // opening by the candidate sidecar.
  const copy = await createConsistentCatalogCopy(
    env.dataDir,
    env.database,
    join(env.root, "consistent-copy"),
  );
  const oracle = readLegacyMigrationOracle(env.database, 1);
  const copyOracle = readLegacyMigrationOracle(copy.copyDatabase, 1);
  assert.equal(oracle.schema.userVersion, 10);
  assert.equal(copyOracle.schema.userVersion, 10);
  assert.deepEqual(copyOracle, oracle);

  return {
    env,
    legacyRuntime,
    projectA: {
      id: LEGACY_PROJECT_A_ID,
      name: LEGACY_PROJECT_A_NAME,
      root: rootA,
      head: headA,
      gitBefore: gitBeforeA,
    },
    projectB: {
      id: addedB.id,
      name: LEGACY_PROJECT_B_NAME,
      root: rootB,
      head: headB,
      gitBefore: gitBeforeB,
    },
    expectedList,
    snapshot,
    indexStatus,
    searchBeforeRestart,
    sourceRef,
    previewBeforeRestart,
    task,
    execution: completedRun,
    execScope,
    execResult,
    execChange,
    review,
    reviewStatusBeforeRestart,
    copy,
    oracle,
  };
}

export function formatRedactedOracle(
  oracle: LegacyCatalogOracle,
  copy: ConsistentCatalogCopy,
  legacyRuntime: LegacySidecarRuntime,
) {
  const rootAlias = new Map<string, string>();
  for (const project of oracle.projects) {
    rootAlias.set(project.root, `<tmp>/${project.name}`);
  }
  const redactRoot = (value: string) => rootAlias.get(value) ?? "<tmp>/unknown";

  return {
    legacyRuntime: {
      revision: legacyRuntime.revision,
      fileCount: legacyRuntime.fileCount,
      treeDigest: legacyRuntime.treeDigest,
    },
    schema: oracle.schema,
    copy: {
      bytes: copy.bytes,
      sourceSha256: copy.sourceSha256,
      copySha256: copy.copySha256,
    },
    counts: oracle.counts,
    selection: oracle.selection,
    projects: oracle.projects.map((project) => ({
      ...project,
      root: redactRoot(project.root),
    })),
    links: {
      ...oracle.links,
      snapshots: oracle.links.snapshots.map((snap) => ({
        ...snap,
        gitRoot: redactRoot(snap.gitRoot),
      })),
    },
    digests: oracle.digests,
  };
}
