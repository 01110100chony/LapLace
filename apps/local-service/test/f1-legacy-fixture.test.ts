import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildF1LegacyFixture,
  formatRedactedOracle,
  LEGACY_PROJECT_A_ID,
  LEGACY_SIDECAR_REVISION,
  LEGACY_TASK_ID,
  LEGACY_TASK_OBJECTIVE,
  LEGACY_TASK_TITLE,
  MOCK_RESULT_AFTER_CONTENT,
  MOCK_RESULT_BEFORE_CONTENT,
  MOCK_RESULT_PATH,
  OMITTED_SOURCE_CONTENT,
  OMITTED_SOURCE_PATH,
  PRESERVED_SOURCE_CONTENT,
  PRESERVED_SOURCE_PATH,
  readLegacyMigrationOracle,
  sha256,
} from "./fixtures/f1-legacy-catalog.ts";
import {
  defaultServiceEntry,
  fixture,
  git,
  readGitInvariantSnapshot,
} from "./fixtures/ipc-harness.ts";

test("F1-T01: isola variaveis GIT_DIR, GIT_WORK_TREE e GIT_INDEX_FILE entre repositorios descartaveis", async (t) => {
  const env = await fixture(t);
  const decoy = await env.repository("Repo Isca");
  git(decoy, "config", "core.autocrlf", "false");
  await writeFile(join(decoy, "isca.txt"), "conteudo isca\n");
  git(decoy, "add", "--", "isca.txt");
  git(decoy, "commit", "-qm", "Commit isca");
  const decoyHead = git(decoy, "rev-parse", "HEAD");
  const decoyBefore = await readGitInvariantSnapshot(decoy);

  const envKeys = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
  ] as const;
  const saved = new Map<string, string | undefined>(
    envKeys.map((key) => [key, process.env[key]]),
  );

  let target: string;
  try {
    process.env.GIT_DIR = join(decoy, ".git");
    process.env.GIT_WORK_TREE = decoy;
    process.env.GIT_INDEX_FILE = join(decoy, ".git", "index");
    process.env.GIT_COMMON_DIR = join(decoy, ".git");

    target = await env.repository("Repo Alvo");
    git(target, "config", "core.autocrlf", "false");
    await writeFile(join(target, "alvo.txt"), "conteudo alvo\n");
    git(target, "add", "--", "alvo.txt");
    git(target, "commit", "-qm", "Commit isolado no alvo");

    assert.equal(git(target, "ls-files"), "alvo.txt");
    assert.notEqual(git(target, "rev-parse", "HEAD"), decoyHead);
    assert.deepEqual(await readGitInvariantSnapshot(decoy), decoyBefore);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.equal(git(decoy, "rev-parse", "HEAD"), decoyHead);
  assert.equal(git(decoy, "ls-files"), "isca.txt");
  assert.deepEqual(await readGitInvariantSnapshot(decoy), decoyBefore);
  assert.equal(git(target, "ls-files"), "alvo.txt");
});

test("F1-T01: medicao do indice permanece somente leitura com --no-optional-locks mesmo apos mudanca de mtime", async (t) => {
  const env = await fixture(t);
  const repo = await env.repository("Indice Somente Leitura");
  git(repo, "config", "core.autocrlf", "false");
  const trackedPath = join(repo, "rastreado.txt");
  await writeFile(trackedPath, "linha fixa\n");
  git(repo, "add", "--", "rastreado.txt");
  git(repo, "commit", "-qm", "Arquivo rastreado");

  const indexPath = join(repo, ".git", "index");
  const indexBefore = sha256(await readFile(indexPath));

  const bumped = new Date(Date.now() + 60_000);
  await utimes(trackedPath, bumped, bumped);
  assert.equal(sha256(await readFile(indexPath)), indexBefore);

  const first = await readGitInvariantSnapshot(repo);
  const indexAfterFirst = sha256(await readFile(indexPath));
  assert.equal(first.status, "");
  assert.equal(first.indexSha256, indexBefore);
  assert.equal(indexAfterFirst, indexBefore);

  const second = await readGitInvariantSnapshot(repo);
  const indexAfterSecond = sha256(await readFile(indexPath));
  assert.equal(indexAfterSecond, indexBefore);
  assert.deepEqual(second, first);
});

test(
  "F1-T01: reproduz base legada v10 desacoplada do candidato e reabre no original e na copia",
  { timeout: 60_000 },
  async (t) => {
    const built = await buildF1LegacyFixture(t);
    const projectAId = built.projectA.id;
    const projectBId = built.projectB.id;
    const contextId = built.snapshot.contextId;

    assert.equal(built.legacyRuntime.revision, LEGACY_SIDECAR_REVISION);
    assert.notEqual(
      realpathSync.native(built.legacyRuntime.entry),
      realpathSync.native(defaultServiceEntry),
    );
    assert.equal(
      readLegacyMigrationOracle(built.copy.copyDatabase, 1).schema.userVersion,
      10,
    );
    assert.equal(
      sha256(await readFile(built.copy.copyDatabase)),
      built.copy.copySha256,
    );

    // 1. Original restarted catalog opened by the candidate sidecar.
    const restarted = built.env.start();

    assert.deepEqual(
      await restarted.request("workspace.list"),
      built.expectedList,
    );

    const selectedA = await restarted.request("project.select", {
      projectId: projectAId,
    });
    assert.equal(selectedA.id, projectAId);
    assert.equal(selectedA.root, built.projectA.root);
    assert.equal(selectedA.cached?.source, "git.status");
    assert.equal(selectedA.cached?.summaryVersion, 1);
    assert.equal(selectedA.cached?.head, built.projectA.head);

    const inspectedA = await restarted.request("project.inspect", {
      projectId: projectAId,
    });
    assert.equal(inspectedA.id, projectAId);
    assert.equal(inspectedA.root, built.projectA.root);
    assert.equal(inspectedA.head, built.projectA.head);

    const inspectedB = await restarted.request("project.inspect", {
      projectId: projectBId,
    });
    assert.equal(inspectedB.id, projectBId);
    assert.equal(inspectedB.root, built.projectB.root);
    assert.equal(inspectedB.head, built.projectB.head);

    assert.equal(
      (await restarted.request("workspace.list")).selectedProjectId,
      projectAId,
    );

    const reopenedSnapshot = await restarted.request("context.get", {
      projectId: projectAId,
      contextId,
    });
    assert.deepEqual(reopenedSnapshot, built.snapshot);
    assert.equal(reopenedSnapshot.status, "partial");
    assert.equal(reopenedSnapshot.included, 1);
    assert.equal(reopenedSnapshot.omitted, 1);
    assert.deepEqual(
      reopenedSnapshot.entries.find(
        (entry) => entry.path === OMITTED_SOURCE_PATH,
      ),
      {
        path: OMITTED_SOURCE_PATH,
        origin: "working_tree",
        outcome: "omitted",
        reason: "excluded",
      },
    );

    const reopenedSearch = await restarted.request("context.search", {
      projectId: projectAId,
      scope: "snapshot",
      contextId,
      query: "retomada verificavel",
      offset: 0,
    });
    assert.deepEqual(reopenedSearch, built.searchBeforeRestart);

    const omittedSearch = await restarted.request("context.search", {
      projectId: projectAId,
      scope: "snapshot",
      contextId,
      query: "omitido intencionalmente",
      offset: 0,
    });
    assert.equal(omittedSearch.items.length, 0);

    const reopenedPreview = await restarted.request("context.sourcePreview", {
      projectId: projectAId,
      ...built.sourceRef,
    });
    assert.deepEqual(reopenedPreview, built.previewBeforeRestart);
    assert.equal(reopenedPreview.text, PRESERVED_SOURCE_CONTENT);

    const reopenedResult = await restarted.request(
      "execution.result",
      built.execScope,
    );
    assert.deepEqual(reopenedResult, built.execResult);
    assert.equal(reopenedResult.result?.mode, "mock_development");

    const reopenedChange = await restarted.request("execution.change", {
      ...built.execScope,
      path: MOCK_RESULT_PATH,
    });
    assert.deepEqual(reopenedChange, built.execChange);

    const reopenedReview = await restarted.request(
      "result.reviewStatus",
      built.execScope,
    );
    assert.deepEqual(reopenedReview, built.reviewStatusBeforeRestart);
    assert.equal(reopenedReview.evidence.source, "mock_result");
    assert.equal(reopenedReview.latest?.choice, "approved");
    assert.equal(reopenedReview.latest?.revision, 1);

    // Cross-project refusals on B (original restarted catalog).
    await assert.rejects(
      restarted.request("context.get", {
        projectId: projectBId,
        contextId,
      }),
      { message: "context_not_found" },
    );
    await assert.rejects(
      restarted.request("context.search", {
        projectId: projectBId,
        scope: "snapshot",
        contextId,
        query: "retomada verificavel",
        offset: 0,
      }),
      { message: "context_not_found" },
    );
    const searchBHistory = await restarted.request("context.search", {
      projectId: projectBId,
      scope: "history",
      contextId: null,
      query: "retomada verificavel",
      offset: 0,
    });
    assert.equal(searchBHistory.items.length, 0);
    assert.equal(searchBHistory.eligible, 0);
    assert.equal(searchBHistory.indexed, 0);

    await assert.rejects(
      restarted.request("context.sourcePreview", {
        projectId: projectBId,
        ...built.sourceRef,
      }),
      { message: "context_source_unavailable" },
    );
    assert.deepEqual(
      (
        await restarted.request("context.list", {
          projectId: projectBId,
          before: null,
        })
      ).items,
      [],
    );
    await assert.rejects(
      restarted.request("context.list", {
        projectId: projectBId,
        before: contextId,
      }),
      { message: "context_not_found" },
    );

    await assert.rejects(
      restarted.request("execution.result", {
        ...built.execScope,
        projectId: projectBId,
      }),
      { message: "task_execution_unavailable" },
    );
    await assert.rejects(
      restarted.request("execution.change", {
        ...built.execScope,
        projectId: projectBId,
        path: MOCK_RESULT_PATH,
      }),
      { message: "task_execution_unavailable" },
    );
    await assert.rejects(
      restarted.request("result.reviewStatus", {
        ...built.execScope,
        projectId: projectBId,
      }),
      { message: "task_execution_unavailable" },
    );
    await assert.rejects(
      restarted.request("result.review", {
        ...built.execScope,
        projectId: projectBId,
        requestId: "cross-b-review",
        expectedBase: built.review.evidence.resultDigest,
        expectedRevision: 1,
        choice: "rejected",
      }),
      { message: "task_execution_unavailable" },
    );
    assert.deepEqual(
      (
        await restarted.request("task.list", {
          projectId: projectBId,
          before: null,
        })
      ).items,
      [],
    );
    await assert.rejects(
      restarted.request("task.list", {
        projectId: projectBId,
        before: built.task.taskId,
      }),
      { message: "task_unavailable" },
    );

    await restarted.close();

    // 2. Verify Git HEAD, index, and refs were never mutated on A or B.
    const [gitAfterA, gitAfterB] = await Promise.all([
      readGitInvariantSnapshot(built.projectA.root),
      readGitInvariantSnapshot(built.projectB.root),
    ]);
    assert.deepEqual(gitAfterA, built.projectA.gitBefore);
    assert.deepEqual(gitAfterB, built.projectB.gitBefore);

    // 3. Consistent v10 copy verified right before candidate opening, then opened independently.
    assert.equal(
      readLegacyMigrationOracle(built.copy.copyDatabase, 1).schema.userVersion,
      10,
    );
    assert.equal(
      sha256(await readFile(built.copy.copyDatabase)),
      built.copy.copySha256,
    );

    const fromCopy = built.env.start(built.copy.copyDataDir);
    assert.deepEqual(
      await fromCopy.request("workspace.list"),
      built.expectedList,
    );
    const copySelectedA = await fromCopy.request("project.select", {
      projectId: projectAId,
    });
    assert.equal(copySelectedA.id, projectAId);
    assert.equal(copySelectedA.root, built.projectA.root);
    assert.equal(copySelectedA.cached?.head, built.projectA.head);
    assert.deepEqual(
      await fromCopy.request("context.get", {
        projectId: projectAId,
        contextId,
      }),
      built.snapshot,
    );
    assert.deepEqual(
      await fromCopy.request("context.search", {
        projectId: projectAId,
        scope: "snapshot",
        contextId,
        query: "retomada verificavel",
        offset: 0,
      }),
      built.searchBeforeRestart,
    );
    assert.equal(
      (
        await fromCopy.request("context.search", {
          projectId: projectAId,
          scope: "snapshot",
          contextId,
          query: "omitido intencionalmente",
          offset: 0,
        })
      ).items.length,
      0,
    );
    assert.deepEqual(
      await fromCopy.request("context.sourcePreview", {
        projectId: projectAId,
        ...built.sourceRef,
      }),
      built.previewBeforeRestart,
    );
    assert.deepEqual(
      await fromCopy.request("execution.result", built.execScope),
      built.execResult,
    );
    assert.deepEqual(
      await fromCopy.request("execution.change", {
        ...built.execScope,
        path: MOCK_RESULT_PATH,
      }),
      built.execChange,
    );
    assert.deepEqual(
      await fromCopy.request("result.reviewStatus", built.execScope),
      built.reviewStatusBeforeRestart,
    );

    await assert.rejects(
      fromCopy.request("context.get", {
        projectId: projectBId,
        contextId,
      }),
      { message: "context_not_found" },
    );
    await assert.rejects(
      fromCopy.request("context.search", {
        projectId: projectBId,
        scope: "snapshot",
        contextId,
        query: "retomada verificavel",
        offset: 0,
      }),
      { message: "context_not_found" },
    );
    await assert.rejects(
      fromCopy.request("context.sourcePreview", {
        projectId: projectBId,
        ...built.sourceRef,
      }),
      { message: "context_source_unavailable" },
    );
    await assert.rejects(
      fromCopy.request("execution.result", {
        ...built.execScope,
        projectId: projectBId,
      }),
      { message: "task_execution_unavailable" },
    );
    await assert.rejects(
      fromCopy.request("result.reviewStatus", {
        ...built.execScope,
        projectId: projectBId,
      }),
      { message: "task_execution_unavailable" },
    );
    await fromCopy.close();

    // 4. Assert migration oracle invariants (source schema, counts, links, digests).
    const { oracle } = built;
    assert.equal(oracle.schema.initialUserVersion, 1);
    assert.equal(oracle.schema.userVersion, 10);
    assert.equal(oracle.schema.integrityCheck, "ok");
    assert.equal(oracle.schema.foreignKeyViolations, 0);

    const expectedEventCount = oracle.links.executions[0]?.lastSeq;
    assert.ok(expectedEventCount && expectedEventCount > 0);
    assert.deepEqual(oracle.counts, {
      projects: 2,
      workspace_state: 1,
      git_inspections: 2,
      context_blobs: 3,
      context_snapshots: 1,
      context_entries: 2,
      context_search_indexes: 1,
      context_search_documents: 1,
      context_search_chunks: 1,
      context_fts: 1,
      codex_history: 0,
      tasks: 1,
      task_executions: 1,
      task_execution_events: expectedEventCount,
      task_results: 1,
      task_result_files: 1,
      working_snapshots: 0,
      working_blobs: 0,
      result_reviews: 1,
    });

    assert.equal(oracle.selection.selectedProjectId, LEGACY_PROJECT_A_ID);
    assert.equal(oracle.links.tasks[0]?.taskId, LEGACY_TASK_ID);
    assert.equal(
      oracle.digests.preservedSourceSha256,
      sha256(PRESERVED_SOURCE_CONTENT),
    );
    assert.equal(
      oracle.digests.omittedSourceSha256,
      sha256(OMITTED_SOURCE_CONTENT),
    );
    assert.ok(
      !oracle.digests.blobs.some(
        (blob) => blob.sha256 === oracle.digests.omittedSourceSha256,
      ),
      "Omitted file content must not be stored in context_blobs",
    );
    assert.equal(
      oracle.digests.taskCreateDigest,
      sha256(
        Buffer.from(
          JSON.stringify([
            LEGACY_TASK_TITLE,
            LEGACY_TASK_OBJECTIVE,
            null,
            null,
          ]),
        ),
      ),
    );
    assert.equal(
      oracle.digests.mockBeforeSha256,
      sha256(MOCK_RESULT_BEFORE_CONTENT),
    );
    assert.equal(
      oracle.digests.mockAfterSha256,
      sha256(MOCK_RESULT_AFTER_CONTENT),
    );
    assert.ok(
      oracle.links.snapshots[0]?.entries.some(
        (entry) =>
          entry.path === PRESERVED_SOURCE_PATH &&
          entry.outcome === "included" &&
          entry.blobSha256 === oracle.digests.preservedSourceSha256,
      ),
    );

    t.diagnostic(
      JSON.stringify(
        formatRedactedOracle(oracle, built.copy, built.legacyRuntime),
      ),
    );
  },
);

test(
  "F1-T01: builder da fixture legada e reproduzivel em pastas descartaveis independentes",
  { timeout: 60_000 },
  async (t) => {
    const run1 = await buildF1LegacyFixture(t);
    const run2 = await buildF1LegacyFixture(t);

    assert.notEqual(run1.projectA.root, run2.projectA.root);
    assert.notEqual(run1.projectB.root, run2.projectB.root);

    assert.equal(run1.legacyRuntime.revision, run2.legacyRuntime.revision);
    assert.equal(run1.legacyRuntime.treeDigest, run2.legacyRuntime.treeDigest);
    assert.equal(run1.legacyRuntime.fileCount, run2.legacyRuntime.fileCount);

    assert.equal(
      run1.oracle.schema.initialUserVersion,
      run2.oracle.schema.initialUserVersion,
    );
    assert.equal(
      run1.oracle.schema.userVersion,
      run2.oracle.schema.userVersion,
    );
    assert.equal(
      run1.oracle.schema.integrityCheck,
      run2.oracle.schema.integrityCheck,
    );
    assert.equal(
      run1.oracle.schema.foreignKeyViolations,
      run2.oracle.schema.foreignKeyViolations,
    );
    assert.deepEqual(run1.oracle.counts, run2.oracle.counts);
    assert.deepEqual(run1.oracle.selection, run2.oracle.selection);

    assert.equal(
      run1.oracle.digests.preservedSourceSha256,
      run2.oracle.digests.preservedSourceSha256,
    );
    assert.equal(
      run1.oracle.digests.omittedSourceSha256,
      run2.oracle.digests.omittedSourceSha256,
    );
    assert.equal(
      run1.oracle.digests.taskCreateDigest,
      run2.oracle.digests.taskCreateDigest,
    );
    assert.equal(
      run1.oracle.digests.mockBeforeSha256,
      run2.oracle.digests.mockBeforeSha256,
    );
    assert.equal(
      run1.oracle.digests.mockAfterSha256,
      run2.oracle.digests.mockAfterSha256,
    );
    assert.deepEqual(run1.oracle.digests.blobs, run2.oracle.digests.blobs);

    assert.equal(
      run1.oracle.links.snapshots[0]?.selectedIndexDigest,
      run2.oracle.links.snapshots[0]?.selectedIndexDigest,
    );
    assert.deepEqual(
      run1.oracle.links.snapshots[0]?.entries.map(
        ({ path, outcome, reason }) => ({
          path,
          outcome,
          reason,
        }),
      ),
      run2.oracle.links.snapshots[0]?.entries.map(
        ({ path, outcome, reason }) => ({
          path,
          outcome,
          reason,
        }),
      ),
    );
    assert.equal(
      run1.oracle.links.executions[0]?.mode,
      run2.oracle.links.executions[0]?.mode,
    );
    assert.equal(run1.oracle.links.executions[0]?.mode, "mock_development");
    assert.equal(
      run1.oracle.links.reviews[0]?.choice,
      run2.oracle.links.reviews[0]?.choice,
    );
    assert.equal(
      run1.oracle.links.reviews[0]?.revision,
      run2.oracle.links.reviews[0]?.revision,
    );
    assert.equal(
      run1.reviewStatusBeforeRestart.evidence.source,
      run2.reviewStatusBeforeRestart.evidence.source,
    );
  },
);
