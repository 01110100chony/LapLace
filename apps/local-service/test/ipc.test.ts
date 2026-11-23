import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import {
  cp,
  mkdir,
  rename,
  readFile,
  stat,
  unlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  contextSearchPageSize,
  maxContextQueryBytes,
  maxContextSearchOffset,
  maxContextSnippetBytes,
  protocolVersion,
  type CodexEvent,
  type CodexMode,
  type TaskRunEvent,
} from "@laplace/contracts";

import { sha256 } from "../src/context.ts";
import { openCatalog, catalogSchemaVersion } from "../src/catalog.ts";
import { CodexQueries, prepareCodex } from "../src/codex.ts";
import { fixture, git } from "./fixtures/ipc-harness.ts";

const dropIdentitySchema =
  "DROP TABLE f3_overlay_blobs; DROP TABLE f3_dirty_overlays; DROP TABLE f3_export_audits; DROP TABLE f3_export_exceptions; DROP TABLE f3_local_feedback; DROP TABLE f3_inbox_proposals; DROP TABLE f3_purge_tombstones; DROP TABLE f3_purge_jobs; DROP TABLE f3_cas_pins; DROP TABLE f3_kgraph_edges; DROP TABLE f3_claim_revisions; DROP TABLE f3_claims; DROP TABLE f2_mcp_access_log; DROP TABLE f2_query_audits; DROP TABLE f2_session_grants; DROP TABLE f2_compiled_manifests; DROP TABLE decision_purge_tombstones; DROP TABLE decision_evidence_links; DROP TABLE decision_revisions; DROP TABLE decisions; DROP TABLE worktrees; DROP TABLE local_repo_bindings; DROP TABLE logical_projects;";
const dropTaskResultSchema = `${dropIdentitySchema} DROP TABLE result_reviews; DROP TABLE working_blobs; DROP TABLE working_snapshots; DROP TABLE task_result_files; DROP TABLE task_results;`;
const dropExecutionSchema = `
  ${dropTaskResultSchema}
  DROP TABLE task_execution_events;
  DROP TABLE task_executions;
  DROP INDEX tasks_project_task;
`;

test(
  "migra C04 e O01, reabre a consulta offline e vincula tarefas somente à origem do projeto",
  { timeout: 30_000 },
  async (t) => {
    const env = await fixture(t);
    const repository = await env.repository("Histórico Codex");
    const otherRepository = await env.repository("Outro histórico");
    const path = "fruta.txt";
    const original = "A fruta é pitanga.\r\n";
    await writeFile(join(repository, path), original);

    const first = env.start();
    const projectId = (
      await first.request("workspace.addLocal", { path: repository })
    ).id;
    const snapshot = await first.request("context.capture", {
      projectId,
      paths: [path],
    });
    const secondSnapshot = await first.request("context.capture", {
      projectId,
      paths: [path],
    });
    const otherProjectId = (
      await first.request("workspace.addLocal", { path: otherRepository })
    ).id;
    await first.close();
    {
      using database = new DatabaseSync(env.database);
      database.exec(
        `${dropExecutionSchema} DROP TABLE tasks; DROP TABLE codex_history; PRAGMA user_version = 4`,
      );
    }

    const scope = { projectId, contextId: snapshot.contextId };
    const mock = env.start(env.dataDir, "completed");
    const entry = snapshot.entries[0];
    assert.ok(entry?.outcome === "included");
    assert.equal(
      (await mock.request("codex.status", { projectId })).mode,
      "mock_development",
    );
    const digest = entry.sha256;
    async function start(
      service: ReturnType<typeof env.start>,
      question: string,
    ) {
      const preview = await service.request("codex.prepare", {
        ...scope,
        selection: [{ path, sha256: digest, chunk: null }],
        snapshotDigest: snapshot.digest,
        question,
      });
      return service.request("codex.start", {
        ...scope,
        confirmed: true,
        grantId: preview.grantId,
        manifestDigest: preview.manifestDigest,
      });
    }
    const question = "Qual era a fruta?";
    const execution = await start(mock, question);
    async function events(service: ReturnType<typeof env.start>) {
      const received: CodexEvent[] = [];
      for (let i = 0; i < 100; i++) {
        const page = await service.request("codex.events", {
          ...execution,
          afterSeq: received.length,
        });
        received.push(...page.events);
        if (!page.more && page.state !== "running") return { received, page };
        if (!page.more) await delay(20);
      }
      assert.fail("A consulta não terminou");
    }
    const live = await events(mock);
    assert.equal(live.page.state, "completed");
    assert.equal(live.page.saved, true);
    await mock.close();
    const closing = env.start(env.dataDir, "cancel");
    const cancelledQuestion = "Posso cancelar esta consulta?";
    const cancelled = await start(closing, cancelledQuestion);
    await closing.close();
    await writeFile(join(repository, path), "A fruta agora é banana.\n");
    {
      using database = new DatabaseSync(env.database);
      database.exec(
        `${dropExecutionSchema} DROP TABLE tasks; PRAGMA user_version = 5`,
      );
    }

    const offline = env.start();
    const result = await offline.request("codex.history", {
      ...scope,
      before: null,
    });
    assert.deepEqual(
      result.items.map(({ question, executionId, mode, state }) => ({
        question,
        executionId,
        mode,
        state,
      })),
      [
        {
          question: cancelledQuestion,
          executionId: cancelled.executionId,
          mode: "mock_development",
          state: "cancelled",
        },
        {
          question,
          executionId: execution.executionId,
          mode: "mock_development",
          state: "completed",
        },
      ],
    );
    assert.deepEqual((await events(offline)).received, live.received);
    const message = live.received.find((event) => event.type === "message");
    assert.deepEqual(message?.citations, {
      sources: [{ id: "source-1", path, verified: true }],
      hasUnknown: false,
    });
    const citation = { ...execution, sourceId: "source-1" };
    assert.equal(
      (await offline.request("codex.citation", citation)).text,
      original,
    );
    await assert.rejects(
      offline.request("codex.citation", { ...citation, sourceId: "source-2" }),
      { message: "context_not_found" },
    );
    for (const otherScope of [
      { projectId: otherProjectId },
      { contextId: secondSnapshot.contextId },
    ]) {
      await assert.rejects(
        offline.request("codex.citation", { ...citation, ...otherScope }),
        { message: "codex_execution_unavailable" },
      );
      await assert.rejects(
        offline.request("codex.events", {
          ...execution,
          ...otherScope,
          afterSeq: 0,
        }),
        { message: "codex_execution_unavailable" },
      );
    }
    const direct = await offline.request("task.create", {
      projectId,
      taskId: "direct-fruit",
      title: "Revisar dados",
      objective: "Validar a entrada atual.",
      source: null,
    });
    assert.equal(direct.revision, 1);
    const linkedDraft = {
      projectId,
      taskId: "linked-fruit",
      title: "Comparar as frutas",
      objective: question,
      source: {
        contextId: execution.contextId,
        executionId: execution.executionId,
      },
    };
    await assert.rejects(
      offline.request("task.create", {
        ...linkedDraft,
        projectId: otherProjectId,
      }),
      { message: "codex_execution_unavailable" },
    );
    await assert.rejects(
      offline.request("task.create", {
        ...linkedDraft,
        source: { ...linkedDraft.source, contextId: secondSnapshot.contextId },
      }),
      { message: "codex_execution_unavailable" },
    );
    await assert.rejects(
      offline.request("task.create", {
        ...linkedDraft,
        source: { ...linkedDraft.source, executionId: cancelled.executionId },
      }),
      { message: "codex_execution_unavailable" },
    );
    const linked = await offline.request("task.create", linkedDraft);
    assert.deepEqual(linked.source, linkedDraft.source);
    const edit = {
      projectId,
      taskId: linked.taskId,
      expectedRevision: 1,
      title: linked.title,
      objective: "Conferir a captura histórica.",
    };
    const updated = await offline.request("task.update", edit);
    assert.equal(updated.revision, 2);
    assert.deepEqual(updated.source, linked.source);
    await assert.rejects(offline.request("task.update", edit), {
      message: "task_conflict",
    });
    assert.deepEqual(
      await offline.request("task.create", linkedDraft),
      updated,
    );
    assert.deepEqual(
      (await offline.request("task.list", { projectId, before: null })).items,
      [updated, direct],
    );
    assert.deepEqual(
      (
        await offline.request("task.list", {
          projectId: otherProjectId,
          before: null,
        })
      ).items,
      [],
    );
    await assert.rejects(
      offline.request("task.list", {
        projectId: otherProjectId,
        before: linked.taskId,
      }),
      { message: "task_unavailable" },
    );
    await offline.close();

    {
      using database = new DatabaseSync(env.database);
      assert.equal(
        database.prepare("PRAGMA user_version").get()?.user_version,
        catalogSchemaVersion,
      );
      for (const table of ["context_snapshots", "codex_history", "tasks"]) {
        assert.equal(
          database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
            ?.count,
          2,
        );
      }
      database
        .prepare("UPDATE context_blobs SET bytes = ? WHERE sha256 = ?")
        .run(Buffer.from("corrompido"), entry.sha256);
    }
    const damaged = env.start();
    assert.deepEqual(
      (await damaged.request("task.list", { projectId, before: null })).items,
      [updated, direct],
    );
    const { received } = await events(damaged);
    assert.equal(
      received.find((event) => event.type === "message")?.citations?.sources[0]
        ?.verified,
      false,
    );
    await assert.rejects(damaged.request("codex.citation", citation), {
      message: "context_not_found",
    });
    await damaged.close();
  },
);

test(
  "O02 persiste tentativas, coordena cancelamento e recupera queda sem repetir a execução",
  { timeout: 30_000 },
  async (t) => {
    const env = await fixture(t);
    const repository = await env.repository("Supervisor local");
    const setup = env.start();
    const { id: projectId } = await setup.request("workspace.addLocal", {
      path: repository,
    });
    for (const taskId of ["first-task", "second-task"]) {
      await setup.request("task.create", {
        projectId,
        taskId,
        title: taskId,
        objective: "Exercitar o supervisor local.",
        source: null,
      });
    }
    await setup.close();
    {
      using database = new DatabaseSync(env.database);
      database.exec(`${dropExecutionSchema} PRAGMA user_version = 6`);
    }

    const worker = env.start(env.dataDir, "cancel");
    const observer = env.start(env.dataDir, "cancel");
    const first = {
      projectId,
      taskId: "first-task",
      requestId: "same-request",
      expectedRevision: 1,
    };
    assert.equal(
      (await worker.request("execution.latest", first)).availableMode,
      "mock_development",
    );
    const attempt = await worker.request("task.start", first);
    const ref = {
      projectId,
      taskId: first.taskId,
      executionId: attempt.executionId,
    };
    assert.equal(
      (await observer.request("task.start", first)).executionId,
      ref.executionId,
    );
    const second = {
      ...first,
      taskId: "second-task",
      requestId: "second-request",
    };
    await assert.rejects(observer.request("task.start", second), {
      message: "task_busy",
    });
    await assert.rejects(
      observer.request("task.start", { ...second, requestId: first.requestId }),
      { message: "task_conflict" },
    );
    await assert.rejects(
      observer.request("execution.events", {
        ...ref,
        taskId: second.taskId,
        afterSeq: 0,
      }),
      { message: "task_execution_unavailable" },
    );
    assert.equal(
      (await observer.request("execution.cancel", ref)).state,
      "cancelling",
    );

    async function collect(
      service: ReturnType<typeof env.start>,
      scope: typeof ref,
    ) {
      const events: TaskRunEvent[] = [];
      for (let i = 0; i < 150; i++) {
        const page = await service.request("execution.events", {
          ...scope,
          afterSeq: events.length,
        });
        events.push(...page.events);
        if (!page.more && page.finishedAt) return { page, events };
        if (!page.more) await delay(20);
      }
      assert.fail("Tentativa sem estado terminal");
    }
    const cancelled = await collect(observer, ref);
    assert.equal(cancelled.page.state, "cancelled");
    assert.equal(
      (await observer.request("execution.result", ref)).result,
      null,
    );
    assert.equal(cancelled.events[0]?.type, "queued");
    assert.equal(
      cancelled.events.filter(({ type }) => type === "cancel_requested").length,
      1,
    );
    assert.equal(
      cancelled.events.filter(({ type }) => type === "terminal").length,
      1,
    );
    assert.equal(
      (await observer.request("execution.cancel", ref)).state,
      "cancelled",
    );

    const performing = await worker.request("task.start", second);
    assert.equal(performing.state, "running");
    await worker.crash();
    await observer.close();
    const restarted = env.start();
    const status = await restarted.request("execution.latest", second);
    assert.equal(status.availableMode, null);
    assert.equal(status.latest?.executionId, performing.executionId);
    assert.equal(status.latest?.state, "interrupted");
    assert.deepEqual(
      await restarted.request("task.start", second),
      status.latest,
    );
    await assert.rejects(
      restarted.request("task.start", {
        ...second,
        requestId: "explicit-retry",
      }),
      { message: "task_runner_unavailable" },
    );
    const recovered = await collect(restarted, {
      projectId,
      taskId: second.taskId,
      executionId: performing.executionId,
    });
    assert.equal(
      (
        await restarted.request("execution.result", {
          projectId,
          taskId: second.taskId,
          executionId: performing.executionId,
        })
      ).result,
      null,
    );
    assert.equal(
      recovered.events.filter(({ type }) => type === "terminal").length,
      1,
    );
    assert.deepEqual(
      recovered.events.map(({ seq }) => seq),
      recovered.events.map((_, index) => index + 1),
    );
    await restarted.close();
  },
);

test(
  "O03 preserva o diff da simulação sem tocar no checkout e reabre os bytes offline",
  { timeout: 25_000 },
  async (t) => {
    const env = await fixture(t);
    const folder = await env.repository("Resultado local");
    const path = "resultado.txt";
    const original = "Arquivo do usuário.\n";
    const sourceFile = join(folder, path);
    await writeFile(sourceFile, original);
    git(folder, "add", "--", path);
    git(folder, "commit", "-qm", "Arquivo inicial");
    const worker = env.start(env.dataDir, "completed");
    const { id: projectId } = await worker.request("workspace.addLocal", {
      path: folder,
    });
    const task = await worker.request("task.create", {
      projectId,
      taskId: "result-task",
      title: "Resultado",
      objective: "Preservar o diff.",
      source: null,
    });
    const input = {
      projectId,
      taskId: task.taskId,
      expectedRevision: task.revision,
    };

    async function complete(service: typeof worker, requestId: string) {
      const { executionId } = await service.request("task.start", {
        ...input,
        requestId,
      });
      const ref = { projectId, taskId: task.taskId, executionId };
      for (let i = 0; i < 150; i++) {
        const { latest } = await service.request("execution.latest", input);
        if (latest?.finishedAt) {
          assert.equal(latest.state, "completed");
          return ref;
        }
        await delay(20);
      }
      assert.fail("Resultado sem estado terminal");
    }

    const old = await complete(worker, "legacy-result");
    await worker.close();
    {
      using database = new DatabaseSync(env.database);
      database.exec(`${dropTaskResultSchema} PRAGMA user_version = 7`);
    }
    const migrated = env.start(env.dataDir, "completed");
    assert.equal(
      (await migrated.request("execution.result", old)).result,
      null,
    );
    const scope = await complete(migrated, "preserve-result");
    const captured = await migrated.request("execution.result", scope);
    assert.ok(captured.result);
    assert.equal(captured.result.mode, "mock_development");
    assert.deepEqual(
      captured.result.changes.map((item) => item.path),
      [path],
    );
    const request = { ...scope, path };
    const content = await migrated.request("execution.change", request);
    assert.equal(content.beforeText, "Resultado inicial da simulação.\n");
    assert.equal(content.afterText, "Execução simulada concluída.\n");
    assert.equal(content.change.before?.sha256, sha256(content.beforeText));
    assert.equal(content.change.after?.sha256, sha256(content.afterText));
    assert.equal(await readFile(sourceFile, "utf8"), original);
    assert.equal(git(folder, "status", "--porcelain"), "");
    await migrated.close();
    await writeFile(sourceFile, "Edição posterior do usuário.\n");
    {
      using database = new DatabaseSync(env.database);
      database.exec(
        `${dropIdentitySchema} DROP TABLE result_reviews; PRAGMA user_version = 9`,
      );
    }

    const offline = env.start();
    assert.deepEqual(
      await offline.request("execution.result", scope),
      captured,
    );
    assert.deepEqual(
      await offline.request("execution.change", request),
      content,
    );
    await assert.rejects(
      offline.request("execution.change", { ...request, path: "unlisted.txt" }),
      { message: "task_result_unavailable" },
    );
    await assert.rejects(
      offline.request("execution.change", {
        ...request,
        path: "../resultado.txt",
      }),
      { message: "invalid_request" },
    );
    await assert.rejects(
      offline.request("execution.change", { ...request, taskId: "other-task" }),
      { message: "task_execution_unavailable" },
    );
    const reviewStatus = await offline.request("result.reviewStatus", scope);
    assert.equal(reviewStatus.latest, null);
    const source = {
      ...scope,
      expectedBase: reviewStatus.evidence.resultDigest,
      expectedRevision: 0,
      choice: "approved",
      requestId: "first-decision",
    };
    await assert.rejects(
      offline.request("result.review", {
        ...source,
        expectedBase: "0".repeat(64),
      }),
      { message: "result_review_conflict" },
    );
    const approved = await offline.request("result.review", source);
    assert.deepEqual(await offline.request("result.review", source), approved);
    await assert.rejects(
      offline.request("result.review", {
        ...source,
        requestId: "second-decision",
        choice: "rejected",
      }),
      { message: "result_review_conflict" },
    );
    const rejected = await offline.request("result.review", {
      ...source,
      requestId: "second-decision",
      choice: "rejected",
      expectedRevision: 1,
    });
    assert.equal(rejected.revision, 2);
    assert.equal(rejected.choice, "rejected");
    assert.equal(
      await readFile(sourceFile, "utf8"),
      "Edição posterior do usuário.\n",
    );
    await offline.close();
    const reviewed = env.start();
    assert.equal(
      (await reviewed.request("result.reviewStatus", scope)).latest?.recordedAt,
      rejected.recordedAt,
    );
    await reviewed.close();
    {
      using database = new DatabaseSync(env.database);
      assert.equal(
        database.prepare("SELECT COUNT(*) AS count FROM result_reviews").get()
          ?.count,
        2,
      );
      database
        .prepare("UPDATE context_blobs SET bytes = ? WHERE sha256 = ?")
        .run(
          Buffer.alloc(content.change.after!.bytes, "x"),
          content.change.after!.sha256,
        );
    }
    const damaged = env.start();
    await assert.rejects(damaged.request("execution.change", request), {
      message: "task_result_unavailable",
    });
    await assert.rejects(damaged.request("result.reviewStatus", scope), {
      message: "task_result_unavailable",
    });
    await damaged.close();
  },
);

test(
  "G01 preserva HEAD, índice e disco, com renome, exclusão e arquivos novos opt-in",
  { timeout: 50_000 },
  async (t) => {
    const env = await fixture(t);
    const root = await env.repository("Git em três estados");
    const path = "versão [literal].txt";
    const moveFrom = "antigo nome.txt";
    const moveTo = "novo nome.txt";
    const removedPath = "removido.txt";
    const newPath = "arquivo novo.txt";
    const binaryPath = "blob.bin";
    const secretPath = ".env";
    const head = "Estado comitado.\n";
    const index = "Estado no índice.\r\n";
    const disk = "Estado no disco.\n";
    git(root, "config", "core.autocrlf", "false");
    await writeFile(join(root, path), head);
    await writeFile(join(root, moveFrom), "Conteúdo da renomeação.\n");
    await writeFile(join(root, removedPath), "Conteúdo removido.\n");
    git(root, "add", "--", ".");
    git(root, "commit", "-qm", "Base");
    await writeFile(join(root, path), index);
    git(root, "--literal-pathspecs", "add", "--", path);
    await writeFile(join(root, path), disk);
    git(root, "mv", "--", moveFrom, moveTo);
    git(root, "rm", "--", removedPath);
    await writeFile(join(root, binaryPath), Buffer.from([0, 1, 255]));
    git(root, "add", "--", binaryPath);
    await writeFile(join(root, newPath), "Arquivo escolhido depois.\n");
    await writeFile(join(root, secretPath), "DADO_FICTICIO=omitido\n");
    const originalIndex = await readFile(join(root, ".git", "index"));
    const service = env.start();
    const { id: projectId } = await service.request("workspace.addLocal", {
      path: root,
    });
    const live = await service.request("working.list", { projectId });
    assert.equal(
      live.changes.find((change) => change.path === path)?.status,
      "MM",
    );
    assert.equal(
      live.changes.find((change) => change.path === moveTo)?.from,
      moveFrom,
    );
    assert.equal(
      live.changes.find((change) => change.path === newPath)?.kind,
      "untracked",
    );
    assert.ok(!live.changes.some((change) => change.path === secretPath));
    await assert.rejects(
      service.request("working.capture", { projectId, paths: [secretPath] }),
      { message: "working_changed" },
    );
    const saved = await service.request("working.capture", {
      projectId,
      paths: [path, moveTo, removedPath, binaryPath],
    });
    assert.ok(!saved.files.some((file) => file.path === newPath));
    const ref = { projectId, snapshotId: saved.snapshotId };
    const staged = await service.request("working.compare", {
      ...ref,
      path,
      layer: "staged",
    });
    assert.deepEqual([staged.beforeText, staged.afterText], [head, index]);
    const unstaged = await service.request("working.compare", {
      ...ref,
      path,
      layer: "unstaged",
    });
    assert.deepEqual([unstaged.beforeText, unstaged.afterText], [index, disk]);
    const moved = await service.request("working.compare", {
      ...ref,
      path: moveTo,
      layer: "staged",
    });
    assert.equal(moved.beforeText, "Conteúdo da renomeação.\n");
    assert.equal(moved.afterText, moved.beforeText);
    const removed = await service.request("working.compare", {
      ...ref,
      path: removedPath,
      layer: "staged",
    });
    assert.equal(removed.beforeText, "Conteúdo removido.\n");
    assert.equal(removed.after.kind, "absent");
    const binary = await service.request("working.compare", {
      ...ref,
      path: binaryPath,
      layer: "staged",
    });
    assert.equal(binary.after.kind, "omitted");
    assert.equal(binary.afterText, null);
    await assert.rejects(
      service.request("working.compare", {
        ...ref,
        path: newPath,
        layer: "unstaged",
      }),
      { message: "working_unavailable" },
    );
    const explicit = await service.request("working.capture", {
      projectId,
      paths: [newPath],
    });
    const newFile = await service.request("working.compare", {
      projectId,
      snapshotId: explicit.snapshotId,
      path: newPath,
      layer: "unstaged",
    });
    assert.equal(newFile.before.kind, "absent");
    assert.equal(newFile.afterText, "Arquivo escolhido depois.\n");
    assert.deepEqual(
      await readFile(join(root, ".git", "index")),
      originalIndex,
    );
    assert.equal(await readFile(join(root, path), "utf8"), disk);
    await service.close();
    await writeFile(join(root, path), "Nova edição após a captura.\n");
    const offline = env.start();
    assert.deepEqual(await offline.request("working.latest", { projectId }), {
      projectId,
      snapshot: explicit,
    });
    assert.deepEqual(
      await offline.request("working.compare", {
        ...ref,
        path,
        layer: "unstaged",
      }),
      unstaged,
    );
    assert.ok(staged.before.kind === "text" && staged.before.oid);
    assert.ok(staged.after.kind === "text" && staged.after.oid);
    const both = [
      `0 ${"0".repeat(staged.before.oid.length)}\t${path}`,
      `100644 ${staged.before.oid} 1\t${path}`,
      `100644 ${staged.before.oid} 2\t${path}`,
      `100644 ${staged.after.oid} 3\t${path}`,
    ];
    execFileSync("git", ["-C", root, "update-index", "--index-info"], {
      input: `${both.join("\n")}\n`,
      windowsHide: true,
    });
    const conflicted = await offline.request("working.capture", {
      projectId,
      paths: [path],
    });
    assert.equal(conflicted.files[0]?.kind, "conflicted");
    assert.deepEqual(
      conflicted.files[0]?.index.map(({ stage }) => stage),
      [1, 2, 3],
    );
    await assert.rejects(
      offline.request("working.compare", {
        projectId,
        snapshotId: conflicted.snapshotId,
        path,
        layer: "unstaged",
      }),
      { message: "working_conflict" },
    );
    await offline.close();
  },
);

test(
  "primeiro início cria o catálogo vazio e o sidecar encerra com EOF",
  { timeout: 12_000 },
  async (t) => {
    const env = await fixture(t);
    const service = env.start();
    const bad = await service.exchange({
      version: protocolVersion,
      id: "bad-1",
      operation: "shell",
    });
    assert.deepEqual(bad, {
      version: protocolVersion,
      id: "bad-1",
      ok: false,
      error: { code: "invalid_request" },
    });
    assert.equal(
      (await service.request("health")).nodeVersion,
      process.versions.node,
    );
    assert.deepEqual(await service.request("workspace.list"), {
      projects: [],
      selectedProjectId: null,
    });
    await service.close();

    const database = new DatabaseSync(env.database, { readOnly: true });
    try {
      assert.equal(
        database.prepare("PRAGMA user_version").get()?.user_version,
        catalogSchemaVersion,
      );
    } finally {
      database.close();
    }
  },
);

test(
  "importações concorrentes, subpasta e caminho alternativo reutilizam a raiz canônica",
  { timeout: 20_000 },
  async (t) => {
    const env = await fixture(t);
    const root = await env.repository("Projeto São João");
    const nested = join(root, "subpasta");
    const alias = join(env.root, "Atalho Git");
    await mkdir(nested);
    await symlink(root, alias, "junction");
    const first = env.start();
    const second = env.start();

    const [a, b] = await Promise.all([
      first.request("workspace.addLocal", { path: root }),
      second.request("workspace.addLocal", { path: nested }),
    ]);
    const aliased = await second.request("workspace.addLocal", { path: alias });
    for (const project of [b, aliased]) {
      assert.equal(project.id, a.id);
      assert.equal(project.root, a.root);
    }
    if (process.platform === "win32") {
      const otherCase = await first.request("workspace.addLocal", {
        path: root.toUpperCase(),
      });
      assert.equal(otherCase.id, a.id);
    }

    const { id, name, root: canonical } = a;
    assert.deepEqual(await first.request("workspace.list"), {
      projects: [{ id, name, root: canonical }],
      selectedProjectId: id,
    });
    await Promise.all([first.close(), second.close()]);
  },
);

test(
  "dois projetos e a seleção sobrevivem ao reinício e à reexecução das migrações",
  { timeout: 20_000 },
  async (t) => {
    const env = await fixture(t);
    const first = env.start();
    const alpha = await env.repository("Projeto Alpha");
    const beta = await env.repository("Projeto Beta");
    git(alpha, "commit", "--quiet", "--allow-empty", "-m", "Antes do reinício");

    const a = await first.request("workspace.addLocal", { path: alpha });
    const b = await first.request("workspace.addLocal", { path: beta });
    assert.notEqual(a.id, b.id);
    await first.request("project.select", { projectId: a.id });
    await first.request("project.inspect", { projectId: b.id });
    const saved = await first.request("workspace.list");
    assert.deepEqual(saved, {
      projects: [a, b].map(({ id, name, root }) => ({ id, name, root })),
      selectedProjectId: a.id,
    });
    await first.close();

    git(alpha, "branch", "-m", "depois-do-reinicio");
    git(alpha, "commit", "--quiet", "--allow-empty", "-m", "Novo HEAD");
    await writeFile(join(alpha, "novo.txt"), "Alteração externa");
    const newHead = git(alpha, "rev-parse", "HEAD");
    assert.notEqual(newHead, a.head);

    const second = env.start();
    const restored = await second.request("workspace.list");
    assert.deepEqual(restored, saved);
    const { cached } = await second.request("project.select", {
      projectId: a.id,
    });
    assert.equal(cached?.source, "git.status");
    assert.equal(cached.summaryVersion, 1);
    assert.equal(cached.head, a.head);
    assert.equal(cached.changes.untracked, 0);
    const fresh = await second.request("project.inspect", {
      projectId: restored.selectedProjectId!,
    });
    assert.equal(fresh.branch, "depois-do-reinicio");
    assert.equal(fresh.head, newHead);
    assert.equal(fresh.changes.untracked, 1);
    assert.equal(
      (await second.request("project.select", { projectId: a.id })).cached
        ?.head,
      newHead,
    );
    await second.close();

    const third = env.start();
    assert.deepEqual(await third.request("workspace.list"), saved);
    await third.close();
  },
);

test(
  "pasta indisponível preserva o registro e permite abrir outro projeto ou atualizar",
  { timeout: 20_000 },
  async (t) => {
    const env = await fixture(t);
    const available = await env.repository("Disponível");
    const missing = await env.repository("Indisponível");
    const first = env.start();
    const a = await first.request("workspace.addLocal", { path: available });
    const b = await first.request("workspace.addLocal", { path: missing });
    const saved = await first.request("workspace.list");
    await first.close();
    const moved = join(env.root, "Pasta movida");
    await rename(missing, moved);

    const second = env.start();
    assert.deepEqual(await second.request("workspace.list"), saved);
    await assert.rejects(
      second.request("project.inspect", { projectId: b.id }),
      { message: "project_unavailable" },
    );
    assert.deepEqual(await second.request("workspace.list"), saved);

    const invalid = await second.exchange({
      version: protocolVersion,
      id: "path-only",
      operation: "project.inspect",
      path: available,
    });
    assert.deepEqual(invalid, {
      version: protocolVersion,
      id: "path-only",
      ok: false,
      error: { code: "invalid_request" },
    });
    await assert.rejects(
      second.request("project.inspect", { projectId: "0".repeat(64) }),
      { message: "project_unavailable" },
    );
    assert.deepEqual(await second.request("workspace.list"), saved);

    assert.equal(
      (await second.request("project.select", { projectId: a.id })).id,
      a.id,
    );
    assert.equal(
      (await second.request("workspace.list")).selectedProjectId,
      a.id,
    );
    await rename(moved, missing);
    await second.request("project.select", { projectId: b.id });
    assert.equal(
      (await second.request("project.inspect", { projectId: b.id })).id,
      b.id,
    );
    assert.deepEqual(await second.request("workspace.list"), saved);
    await second.close();
  },
);

test(
  "rejeita cache inválido ou de outra origem, versão e localização e o recompõe pelo Git",
  { timeout: 20_000 },
  async (t) => {
    const env = await fixture(t);
    const root = await env.repository("Repositório com cache");
    const service = env.start();
    const added = await service.request("workspace.addLocal", { path: root });
    const projectId = added.id;
    const project = await service.request("project.select", { projectId });
    assert.ok(project.cached);
    const database = new DatabaseSync(env.database, { timeout: 2_000 });
    try {
      const update = database.prepare(
        "UPDATE git_inspections SET payload = ? WHERE project_id = ?",
      );
      for (const invalid of [
        "{",
        JSON.stringify({ ...project.cached, source: "outra" }),
        JSON.stringify({ ...project.cached, summaryVersion: 99 }),
        JSON.stringify({ ...project.cached, observedAt: "sem data" }),
      ]) {
        update.run(invalid, projectId);
        assert.equal(
          (await service.request("project.select", { projectId })).cached,
          null,
        );
      }
      update.run(JSON.stringify(project.cached), projectId);
      database
        .prepare("UPDATE git_inspections SET root = ? WHERE project_id = ?")
        .run(env.root, projectId);
      assert.equal(
        (await service.request("project.select", { projectId })).cached,
        null,
      );
    } finally {
      database.close();
    }
    await writeFile(join(root, "externo.txt"), "Novo");
    assert.equal(
      (await service.request("project.inspect", { projectId })).changes
        .untracked,
      1,
    );
    assert.equal(
      (await service.request("project.select", { projectId })).cached?.changes
        .untracked,
      1,
    );
    await service.close();
  },
);

test(
  "relocaliza o mesmo checkout e preserva o catálogo e o cache ao rejeitar destinos incorretos",
  { timeout: 25_000 },
  async (t) => {
    const env = await fixture(t);
    const root = await env.repository("Projeto original");
    const other = await env.repository("Projeto diferente");
    const copy = join(env.root, "Cópia com o mesmo HEAD");
    const relocated = join(env.root, "Projeto relocalizado");
    const empty = join(env.root, "Pasta sem Git");
    git(
      root,
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "Commit compartilhado",
    );
    await cp(root, copy, { recursive: true });
    await mkdir(empty);
    const service = env.start();
    await service.request("workspace.addLocal", { path: other });
    const original = await service.request("workspace.addLocal", {
      path: root,
    });
    const projectId = original.id;
    const before = await service.request("workspace.list");
    const cached = await service.request("project.select", { projectId });
    await rename(root, relocated);
    await service.close();

    const reopened = env.start();
    assert.deepEqual(await reopened.request("workspace.list"), before);
    await assert.rejects(reopened.request("project.inspect", { projectId }), {
      message: "project_unavailable",
    });
    await assert.rejects(
      reopened.request("project.relocate", { projectId, path: empty }),
      { message: "not_repository" },
    );
    await assert.rejects(
      reopened.request("project.relocate", { projectId, path: copy }),
      { message: "project_identity_mismatch" },
    );
    await assert.rejects(
      reopened.request("project.relocate", { projectId, path: other }),
      { message: "project_already_registered" },
    );
    await assert.rejects(
      reopened.request("workspace.addLocal", { path: relocated }),
      { message: "project_already_registered" },
    );

    await rename(copy, root);
    await assert.rejects(reopened.request("project.inspect", { projectId }), {
      message: "project_identity_mismatch",
    });
    await assert.rejects(
      reopened.request("workspace.addLocal", { path: root }),
      { message: "project_identity_mismatch" },
    );
    assert.deepEqual(await reopened.request("workspace.list"), before);
    assert.deepEqual(
      await reopened.request("project.select", { projectId }),
      cached,
    );

    await writeFile(join(relocated, "mudança"), "Modificado fora do Laplace");
    const corrected = await reopened.request("project.relocate", {
      projectId,
      path: relocated,
    });
    assert.equal(corrected.id, projectId);
    assert.equal(corrected.name, original.name);
    assert.equal(corrected.head, original.head);
    assert.equal(corrected.changes.untracked, 1);
    assert.notEqual(corrected.root, original.root);
    assert.equal(
      (await reopened.request("workspace.addLocal", { path: relocated })).id,
      projectId,
    );
    await reopened.close();

    const again = env.start();
    const after = await again.request("workspace.list");
    assert.equal(after.selectedProjectId, projectId);
    assert.equal(after.projects.length, 2);
    assert.equal(
      after.projects.find(({ id }) => id === projectId)?.root,
      corrected.root,
    );
    assert.equal(
      (await again.request("project.select", { projectId })).cached?.changes
        .untracked,
      1,
    );
    assert.equal(
      (await again.request("project.inspect", { projectId })).head,
      original.head,
    );
    await again.close();
  },
);

test(
  "migra um catálogo D04 e só habilita relocalização após verificar o checkout na raiz cadastrada",
  { timeout: 20_000 },
  async (t) => {
    const env = await fixture(t);
    const root = await env.repository("Legado");
    // D04 persisted the canonical Git root, including on-disk casing on Windows.
    const legacyRoot = realpathSync.native(root);
    const moved = join(env.root, "Legado movido");
    const projectId = "b".repeat(64);
    await mkdir(env.dataDir);
    const legacy = new DatabaseSync(env.database);
    try {
      legacy.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, root TEXT NOT NULL UNIQUE, name TEXT NOT NULL) STRICT;
        CREATE TABLE workspace_state (
          id INTEGER PRIMARY KEY CHECK (id = 1), selected_project_id TEXT REFERENCES projects(id)
        ) STRICT;
        PRAGMA user_version = 1;
      `);
      legacy
        .prepare("INSERT INTO projects VALUES (?, ?, ?)")
        .run(projectId, legacyRoot, "Legado");
      legacy
        .prepare("INSERT INTO workspace_state VALUES (1, ?)")
        .run(projectId);
    } finally {
      legacy.close();
    }

    await rename(root, moved);
    const service = env.start();
    assert.deepEqual(await service.request("workspace.list"), {
      projects: [{ id: projectId, name: "Legado", root: legacyRoot }],
      selectedProjectId: projectId,
    });
    assert.equal(
      (await service.request("project.select", { projectId })).cached,
      null,
    );
    await assert.rejects(
      service.request("project.relocate", { projectId, path: moved }),
      { message: "project_identity_unknown" },
    );
    await rename(moved, root);
    const inspected = await service.request("project.inspect", { projectId });
    assert.equal(inspected.id, projectId);
    assert.equal(inspected.root, legacyRoot);
    await rename(root, moved);
    const relocated = await service.request("project.relocate", {
      projectId,
      path: moved,
    });
    assert.equal(relocated.id, projectId);
    assert.equal(relocated.root, realpathSync.native(moved));
    await service.close();
  },
);

test(
  "rejeita um esquema mais recente e preserva os dados existentes",
  { timeout: 12_000 },
  async (t) => {
    const env = await fixture(t);
    const repository = await env.repository("Persistente");
    const first = env.start();
    await first.request("workspace.addLocal", { path: repository });
    const saved = await first.request("workspace.list");
    await first.close();

    const database = new DatabaseSync(env.database);
    try {
      const futureVersion = catalogSchemaVersion + 1;
      database.exec(`PRAGMA user_version = ${futureVersion}`);
      const second = env.start();
      await assert.rejects(second.request("workspace.list"), {
        message: "catalog_unavailable",
      });
      await second.close();
      assert.equal(
        database.prepare("PRAGMA user_version").get()?.user_version,
        futureVersion,
      );
      database.exec(`PRAGMA user_version = ${catalogSchemaVersion}`);
    } finally {
      database.close();
    }

    const third = env.start();
    assert.deepEqual(await third.request("workspace.list"), saved);
    await third.close();
  },
);

test(
  "migra o catálogo C01 e pesquisa revisões preservadas por projeto, inclusive após reiniciar",
  { timeout: 45_000 },
  async (t) => {
    const env = await fixture(t);
    const root = await env.repository("Projeto C02");
    const secondRoot = await env.repository("Outro projeto");
    const path = "Ação com espaços.ts";
    const otherPath = "notes.ts";
    const original =
      "export function calcularTotal() {\r\n  return 'revisão antiga';\r\n}\r\n";
    const newer =
      "export function calcularTotal() {\n  return 'revisão nova';\n}\n";
    await writeFile(join(root, path), original);
    await writeFile(join(root, otherPath), "Ação com espaços\n");
    await writeFile(
      join(secondRoot, path),
      original.replace("antiga", "privada"),
    );
    git(root, "add", "--", path, otherPath);
    git(root, "commit", "--quiet", "-m", "base");
    const indexPath = join(root, ".git", "index");
    const indexBytes = await readFile(indexPath);
    const indexTime = (await stat(indexPath, { bigint: true })).mtimeNs;
    const first = env.start();
    const project = await first.request("workspace.addLocal", { path: root });
    const projectId = project.id;
    const paths = [path, otherPath];
    const old = await first.request("context.capture", { projectId, paths });
    await first.close();

    // Restore the C01 schema in this disposable copy with real receipts and blobs.
    using database = new DatabaseSync(env.database);
    database.exec(`
    ${dropExecutionSchema}
    DROP TABLE tasks;
    DROP TABLE codex_history;
    DROP TRIGGER context_search_delete_chunk;
    DROP TABLE context_fts;
    DROP TABLE context_search_chunks;
    DROP TABLE context_search_documents;
    DROP TABLE context_search_indexes;
    DROP INDEX context_entries_search_source;
    PRAGMA user_version = 3;
  `);
    const service = env.start();
    assert.deepEqual(
      await service.request("context.get", {
        projectId,
        contextId: old.contextId,
      }),
      old,
    );
    assert.equal(
      (await service.request("workspace.list")).selectedProjectId,
      projectId,
    );
    assert.equal(
      database.prepare("PRAGMA user_version").get()?.user_version,
      catalogSchemaVersion,
    );
    assert.equal(
      database
        .prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled")
        .get()?.enabled,
      1,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

    const search = (
      scope: "snapshot" | "latest" | "history",
      query: string,
      contextId: string | null = null,
    ) =>
      service.request("context.search", {
        projectId,
        scope,
        contextId,
        query,
        offset: 0,
      });
    const build = (contextId: string, force = false) =>
      service.request("context.index", { projectId, contextId, force });
    assert.equal(
      (
        await service.request("context.indexStatus", {
          projectId,
          contextId: null,
        })
      ).indexedAt,
      null,
    );
    await assert.rejects(search("latest", "calcularTotal"), {
      message: "context_not_indexed",
    });
    const ready = await build(old.contextId);
    assert.equal(ready.files, 2);
    assert.equal(ready.chunks, 2);
    assert.deepEqual(await build(old.contextId), ready);
    const duplicate = await service.request("context.capture", {
      projectId,
      paths,
    });
    await build(duplicate.contextId);
    await build(old.contextId, true);
    assert.equal(
      database.prepare("SELECT count(*) AS n FROM context_fts").get()?.n,
      2,
    );
    assert.equal(
      database
        .prepare("SELECT count(*) AS n FROM context_search_documents")
        .get()?.n,
      2,
    );

    const ranked = await search("snapshot", "acao com espacos", old.contextId);
    assert.deepEqual(
      ranked.items.map((item) => item.path),
      [path, otherPath],
    );
    const [hit] = (await search("snapshot", "revisao antiga", old.contextId))
      .items;
    assert.ok(hit);
    assert.equal(hit.contextId, old.contextId);
    assert.equal(hit.origin, "historical");
    assert.equal(hit.snapshot.head, old.head);
    assert.equal(hit.text, original);
    assert.deepEqual([hit.firstLine, hit.lastLine], [1, 3]);
    const ref = {
      projectId,
      contextId: hit.contextId,
      path,
      sha256: hit.sha256,
      chunk: hit.chunk,
    };
    assert.equal(
      (await service.request("context.sourcePreview", ref)).text,
      original,
    );
    assert.equal(await readFile(join(root, path), "utf8"), original);
    assert.deepEqual(await readFile(indexPath), indexBytes);
    assert.equal((await stat(indexPath, { bigint: true })).mtimeNs, indexTime);

    await unlink(join(root, path));
    assert.equal((await search("history", "calcularTotal")).items.length, 2);
    assert.equal(
      (await service.request("context.sourcePreview", ref)).text,
      original,
    );
    await writeFile(join(root, path), newer);
    const recent = await service.request("context.capture", {
      projectId,
      paths,
    });
    await assert.rejects(search("latest", "calcularTotal"), {
      message: "context_not_indexed",
    });
    await build(recent.contextId);
    const latest = await search("latest", "calcularTotal");
    assert.equal(latest.snapshot?.contextId, recent.contextId);
    assert.deepEqual(
      latest.items.map((item) => [item.origin, item.text]),
      [["latest", newer]],
    );
    const historical = await search("history", "calcularTotal");
    assert.deepEqual(
      new Set(historical.items.map((item) => item.contextId)),
      new Set([old.contextId, duplicate.contextId, recent.contextId]),
    );

    const other = await service.request("workspace.addLocal", {
      path: secondRoot,
    });
    const otherSnapshot = await service.request("context.capture", {
      projectId: other.id,
      paths: [path],
    });
    await service.request("context.index", {
      projectId: other.id,
      contextId: otherSnapshot.contextId,
      force: false,
    });
    assert.equal((await search("history", "privada")).items.length, 0);
    assert.equal(
      (
        await service.request("context.search", {
          projectId: other.id,
          scope: "history",
          contextId: null,
          query: "calcularTotal",
          offset: 0,
        })
      ).items[0]?.contextId,
      otherSnapshot.contextId,
    );
    await assert.rejects(
      search("snapshot", "calcularTotal", otherSnapshot.contextId),
      { message: "context_not_found" },
    );
    await assert.rejects(
      service.request("context.sourcePreview", { ...ref, projectId: other.id }),
      { message: "context_source_unavailable" },
    );
    await assert.rejects(
      service.request("context.sourcePreview", {
        ...ref,
        sha256: "0".repeat(64),
      }),
      {
        message: "context_source_unavailable",
      },
    );
    await service.close();
    const restarted = env.start();
    assert.deepEqual(
      await restarted.request("context.search", {
        projectId,
        scope: "latest",
        contextId: null,
        query: "calcularTotal",
        offset: 0,
      }),
      latest,
    );
    await restarted.close();
  },
);

test(
  "limita a busca e a paginação, trata sintaxe como texto e recupera falhas de indexação",
  { timeout: 35_000 },
  async (t) => {
    const env = await fixture(t);
    const root = await env.repository("Limites");
    const path = "linhas.ts";
    const contents =
      "alvo\r\n".repeat(24 * (contextSearchPageSize + 2)) +
      "é".repeat(511) +
      "\r\n" +
      "😀".repeat(512) +
      " final UNICO\n";
    await writeFile(join(root, path), contents);
    await writeFile(join(root, "outro.txt"), "NEAR OR");
    await writeFile(join(root, ".env"), "omissaoteste");
    const service = env.start();
    const { id: projectId } = await service.request("workspace.addLocal", {
      path: root,
    });
    const capture = await service.request("context.capture", {
      projectId,
      paths: [path, "outro.txt", ".env"],
    });
    const args = { projectId, contextId: capture.contextId };
    const search = (query: string, offset = 0) =>
      service.request("context.search", {
        ...args,
        scope: "snapshot",
        query,
        offset,
      });
    const index = (force = false) =>
      service.request("context.index", { ...args, force });
    assert.equal(capture.status, "partial");
    using database = new DatabaseSync(env.database, {
      enableForeignKeyConstraints: false,
    });
    function failWrite() {
      database.exec(`CREATE TRIGGER reject_chunk BEFORE INSERT ON context_search_chunks WHEN NEW.ordinal = 2
      BEGIN SELECT RAISE(ABORT, 'fixture'); END;`);
    }
    failWrite();
    await assert.rejects(index(), { message: "context_index_failed" });
    assert.equal(
      database.prepare("SELECT count(*) AS n FROM context_fts").get()?.n,
      0,
    );
    assert.equal(
      database
        .prepare("SELECT count(*) AS n FROM context_search_documents")
        .get()?.n,
      0,
    );
    assert.equal(
      (await service.request("context.indexStatus", args)).indexedAt,
      null,
    );
    database.exec("DROP TRIGGER reject_chunk");
    const ready = await index();
    assert.equal(ready.files, 2);
    failWrite();
    await assert.rejects(index(true), { message: "context_index_failed" });
    assert.deepEqual(await service.request("context.indexStatus", args), ready);
    database.exec("DROP TRIGGER reject_chunk");

    const first = await search("alvo");
    assert.equal(first.items.length, contextSearchPageSize);
    assert.equal(first.nextOffset, contextSearchPageSize);
    const next = await search("alvo", first.nextOffset!);
    assert.equal(next.items.length, 2);
    assert.equal(next.nextOffset, null);
    assert.deepEqual(
      [...first.items, ...next.items]
        .map((item) => item.firstLine)
        .sort((a, b) => a - b),
      Array.from({ length: contextSearchPageSize + 2 }, (_, i) => 1 + 24 * i),
    );
    const one = (await search("UNICO")).items[0]!;
    assert.ok(one.splitLine);
    assert.equal(one.firstLine, one.lastLine);
    assert.ok(!one.text.includes("\ufffd"));
    assert.ok(Buffer.byteLength(one.text) <= maxContextSnippetBytes);
    assert.match(one.text, / final UNICO\n$/);
    assert.equal((await search('NEAR("OR"*):{}')).items[0]?.path, "outro.txt");
    for (const term of ["omissaoteste", "env"])
      assert.equal((await search(term)).items.length, 0);
    await assert.rejects(search('(*")'), { message: "context_search_query" });
    await assert.rejects(search("alvo ".repeat(13)), {
      message: "context_search_query",
    });
    await assert.rejects(search("á".repeat(maxContextQueryBytes / 2 + 1)), {
      message: "invalid_request",
    });
    await assert.rejects(search("alvo", 1), { message: "invalid_request" });
    await assert.rejects(
      search("alvo", maxContextSearchOffset + contextSearchPageSize),
      { message: "invalid_request" },
    );

    const empty = await service.request("context.capture", {
      projectId,
      paths: ["ausente.ts"],
    });
    await assert.rejects(
      service.request("context.index", {
        projectId,
        contextId: empty.contextId,
        force: false,
      }),
      {
        message: "context_not_eligible",
      },
    );
    const latest = await service.request("context.indexStatus", {
      projectId,
      contextId: null,
    });
    assert.equal(latest.contextId, capture.contextId);
    const { contextId, sha256, chunk } = one;
    const ref = { projectId, contextId, path, sha256, chunk };
    const saved = database
      .prepare("SELECT bytes FROM context_blobs WHERE sha256 = ?")
      .get(sha256)?.bytes as Uint8Array;
    // Same-length damage still fails the digest check.
    database
      .prepare("UPDATE context_blobs SET bytes = ? WHERE sha256 = ?")
      .run(Buffer.alloc(saved.length, 65), sha256);
    await assert.rejects(service.request("context.sourcePreview", ref), {
      message: "context_source_unavailable",
    });
    await assert.rejects(search("UNICO"), {
      message: "context_source_unavailable",
    });
    database.prepare("DELETE FROM context_blobs WHERE sha256 = ?").run(sha256);
    await assert.rejects(service.request("context.sourcePreview", ref), {
      message: "context_source_unavailable",
    });
    await assert.rejects(index(true), {
      message: "context_source_unavailable",
    });
    await service.close();
  },
);

test(
  "IPC de contexto resiste a reinício, movimento e troca de projeto",
  { timeout: 30_000 },
  async (t) => {
    const env = await fixture(t);
    const a = await env.repository("origem");
    const b = await env.repository("outro projeto");
    await writeFile(join(a, "readme.txt"), "primeira versão");
    await writeFile(join(b, "readme.txt"), "outro conteúdo");
    const service = env.start();
    const addedA = await service.request("workspace.addLocal", { path: a });
    const addedB = await service.request("workspace.addLocal", { path: b });
    const projectId = addedA.id;
    const otherId = addedB.id;
    const list = await service.request("context.browse", {
      projectId,
      folder: "",
      prefix: "",
    });
    assert.deepEqual(list.items, [{ path: "readme.txt", kind: "file" }]);
    await assert.rejects(
      service.request("context.capture", {
        projectId: "f".repeat(64),
        paths: ["readme.txt"],
      }),
      { message: "project_unavailable" },
    );
    await assert.rejects(
      service.request("context.capture", {
        projectId,
        paths: ["../outro projeto/readme.txt"],
      }),
      { message: "invalid_request" },
    );
    const capture = await service.request("context.capture", {
      projectId,
      paths: ["readme.txt"],
    });
    const contextId = capture.contextId;
    const getArgs = { projectId, contextId };
    assert.equal(
      (await service.request("context.validate", getArgs)).state,
      "matches",
    );
    await service.request("project.select", { projectId: otherId });
    assert.deepEqual(
      (
        await service.request("context.list", {
          projectId: otherId,
          before: null,
        })
      ).items,
      [],
    );
    await assert.rejects(
      service.request("context.get", { projectId: otherId, contextId }),
      { message: "context_not_found" },
    );
    await assert.rejects(
      service.request("context.list", {
        projectId: otherId,
        before: contextId,
      }),
      { message: "context_not_found" },
    );
    await writeFile(join(a, "readme.txt"), "segunda versão");
    assert.equal(
      (await service.request("context.validate", getArgs)).state,
      "differs",
    );
    const newer = await service.request("context.capture", {
      projectId,
      paths: ["readme.txt"],
    });
    assert.notEqual(newer.digest, capture.digest);
    await service.close();

    const moved = join(env.root, "movido");
    await rename(a, moved);
    const reopened = env.start();
    const history = await reopened.request("context.list", {
      projectId,
      before: null,
    });
    assert.deepEqual(
      history.items.map((item) => item.contextId),
      [newer.contextId, contextId],
    );
    assert.deepEqual(await reopened.request("context.get", getArgs), capture);
    await assert.rejects(reopened.request("context.validate", getArgs), {
      message: "project_unavailable",
    });
    await reopened.close();
    const store = new DatabaseSync(env.database, { readOnly: true });
    try {
      const bytes = store
        .prepare(
          `SELECT b.bytes FROM context_blobs AS b
      JOIN context_entries AS e ON e.blob_sha256 = b.sha256 WHERE e.context_id = ?`,
        )
        .get(contextId)?.bytes as Uint8Array;
      assert.equal(Buffer.from(bytes).toString(), "primeira versão");
    } finally {
      store.close();
    }
  },
);

test(
  "prepara exclusivamente bytes históricos e exige confirmação e confinamento",
  { timeout: 30_000 },
  async (t) => {
    const env = await fixture(t);
    const root = await env.repository("Consulta A");
    const other = await env.repository("Consulta B");
    const path = "função.ts";
    const historical =
      "\uFEFF// registro histórico\r\n".repeat(25) +
      "export const exemplo = 73;\r\n";
    await writeFile(join(root, path), historical);
    await writeFile(join(root, "fora.txt"), "Omitido do envio");
    await writeFile(join(other, path), "Outro projeto");
    const service = env.start();
    const { id: projectId } = await service.request("workspace.addLocal", {
      path: root,
    });
    const { id: otherProject } = await service.request("workspace.addLocal", {
      path: other,
    });
    const snapshot = await service.request("context.capture", {
      projectId,
      paths: [path, "fora.txt"],
    });
    const second = await service.request("context.capture", {
      projectId: otherProject,
      paths: [path],
    });
    assert.notEqual(snapshot.contextId, second.contextId);
    const scope = { projectId, contextId: snapshot.contextId };
    await service.request("context.index", { ...scope, force: false });
    await writeFile(join(root, path), "A versão atual não pertence à captura.");
    const originalState = git(root, "status", "--porcelain");
    const search = await service.request("context.search", {
      ...scope,
      scope: "snapshot",
      query: "exemplo",
      offset: 0,
    });
    const hit = search.items[0]!;
    assert.ok(hit.text.includes("exemplo = 73"));
    const request = {
      ...scope,
      question: "Qual é o valor histórico de exemplo?",
      snapshotDigest: snapshot.digest,
      selection: [{ path, sha256: hit.sha256, chunk: hit.chunk }],
    };
    await assert.rejects(
      service.request("codex.prepare", { ...request, projectId: otherProject }),
      { message: "context_not_found" },
    );
    await assert.rejects(
      service.request("codex.prepare", {
        ...request,
        snapshotDigest: "0".repeat(64),
      }),
      { message: "codex_selection_invalid" },
    );
    await assert.rejects(
      service.request("codex.prepare", {
        ...request,
        selection: [{ path, sha256: "0".repeat(64), chunk: null }],
      }),
      { message: "codex_selection_invalid" },
    );
    await assert.rejects(
      service.request("codex.prepare", {
        ...request,
        selection: [{ path: "../canary.txt", sha256: hit.sha256, chunk: null }],
      }),
      { message: "invalid_request" },
    );

    const preview = await service.request("codex.prepare", request);
    assert.equal(preview.provider, "openai");
    assert.equal(preview.sources[0]?.range?.firstLine, hit.firstLine);
    assert.equal(preview.sources[0]?.bytes, Buffer.byteLength(hit.text));
    assert.deepEqual(preview.omissions, [
      { path: "fora.txt", reason: "not_selected" },
      { path, reason: "outside_excerpt" },
    ]);
    const approval = {
      ...scope,
      grantId: preview.grantId,
      manifestDigest: preview.manifestDigest,
    };
    await assert.rejects(service.request("codex.start", approval), {
      message: "invalid_request",
    });
    await assert.rejects(
      service.request("codex.start", {
        ...approval,
        confirmed: true,
        projectId: otherProject,
      }),
      { message: "codex_authorization_required" },
    );
    await assert.rejects(
      service.request("codex.start", {
        ...approval,
        confirmed: true,
        manifestDigest: "0".repeat(64),
      }),
      { message: "codex_authorization_required" },
    );
    await assert.rejects(
      service.request("codex.start", { ...approval, confirmed: true }),
      { message: "codex_unavailable" },
    );
    assert.equal(git(root, "status", "--porcelain"), originalState);
    assert.equal(
      await readFile(join(root, path), "utf8"),
      "A versão atual não pertence à captura.",
    );
    const beforeRestart = await service.request("codex.prepare", request);
    await service.close();
    const restarted = env.start();
    await assert.rejects(
      restarted.request("codex.start", {
        ...approval,
        grantId: beforeRestart.grantId,
        confirmed: true,
      }),
      { message: "codex_authorization_required" },
    );
    const reopened = await restarted.request("codex.prepare", request);
    assert.equal(reopened.manifestDigest, preview.manifestDigest);
    assert.notEqual(reopened.grantId, preview.grantId);
    await restarted.close();
  },
);

test(
  "materializa o trecho histórico e supervisiona uma tentativa autorizada com processo fictício",
  { timeout: 30_000 },
  async (t) => {
    const env = await fixture(t);
    const root = await env.repository("Seleção materializada");
    const sourcePath = "src/registro.ts";
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, sourcePath),
      "// histórico\r\n".repeat(24) + "export const valor = 73;\r\n",
    );
    await writeFile(join(root, "outro.txt"), "outro arquivo");
    const service = env.start();
    const { id: projectId } = await service.request("workspace.addLocal", {
      path: root,
    });
    const snapshot = await service.request("context.capture", {
      projectId,
      paths: [sourcePath, "outro.txt"],
    });
    const scope = { projectId, contextId: snapshot.contextId };
    await service.request("context.index", { ...scope, force: false });
    const page = await service.request("context.search", {
      ...scope,
      query: "valor",
      scope: "snapshot",
      offset: 0,
    });
    const result = page.items[0]!;
    assert.equal(result.firstLine, 25);
    await writeFile(join(root, sourcePath), "// versão atual\n");
    const tree = git(root, "status", "--porcelain");
    await service.close();

    function prepare(mode: CodexMode) {
      const catalog = openCatalog(env.dataDir);
      try {
        return prepareCodex(
          catalog,
          {
            ...scope,
            snapshotDigest: snapshot.digest,
            question: "Qual era o valor?",
            selection: [
              { path: sourcePath, sha256: result.sha256, chunk: result.chunk },
            ],
          },
          env.dataDir,
          mode,
        );
      } finally {
        catalog.close();
      }
    }
    const prepared = prepare("verified_isolated");
    const detect = async () => ({
      availability: {
        state: "confinement_unverified" as const,
        version: "0.141.0",
      },
      installation: { executable: process.execPath, version: "0.141.0" },
    });
    let workspacePath = "";
    let launched = 0;
    const queries = new CodexQueries({
      detect,
      boundary: {
        async verify() {
          return true;
        },
        start(file, args, { cwd, workspace }) {
          workspacePath = workspace;
          launched++;
          assert.deepEqual(readdirSync(cwd), []);
          assert.deepEqual(readdirSync(join(workspace, "sources")), ["src"]);
          assert.deepEqual(
            readFileSync(join(workspace, "sources", sourcePath)),
            Buffer.from(result.text),
          );
          const saved = JSON.parse(
            readFileSync(join(workspace, "selection.json"), "utf8"),
          );
          assert.equal(saved.manifestDigest, prepared.preview.manifestDigest);
          assert.equal(saved.grantId, undefined);
          assert.ok(!args.includes(prepared.preview.question));
          const child = spawn(
            file,
            [
              "-e",
              `
          const bytes = [];
          process.stdin.on('data', (part) => bytes.push(part));
          process.stdin.on('end', () => {
            const data = JSON.parse(Buffer.concat(bytes).toString('utf8').split('\\n\\n')[1]);
            if (data.sources.length !== 1 || data.sources[0].text !== 'export const valor = 73;\\r\\n') process.exit(7);
            console.log(JSON.stringify({ type: 'thread.started', thread_id: 'mock-process' }));
            console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'O valor histórico era 73.' } }));
            console.log(JSON.stringify({ type: 'turn.completed' }));
          });
        `,
            ],
            { cwd, stdio: "pipe", windowsHide: true },
          );
          return {
            child,
            stop: () => {
              child.kill();
            },
          };
        },
      },
    });
    t.after(() => queries.close());
    const preview = queries.prepare(prepared);
    const approval = {
      ...scope,
      operation: "codex.start",
      confirmed: true,
      grantId: preview.grantId,
      manifestDigest: preview.manifestDigest,
    } as const;
    const execution = await queries.start(approval);
    await assert.rejects(queries.start(approval), {
      message: "codex_authorization_required",
    });
    const events: CodexEvent[] = [];
    for (let i = 0; i < 100; i++) {
      const batch = queries.events({
        ...execution,
        operation: "codex.events",
        afterSeq: events.length,
      });
      events.push(...batch.events);
      if (!batch.more && batch.state !== "running") break;
      await delay(20);
    }
    assert.equal(launched, 1);
    assert.ok(
      events.some(
        (event) =>
          event.type === "message" &&
          event.text === "O valor histórico era 73.",
      ),
    );
    assert.deepEqual(events.at(-1), {
      seq: events.length,
      type: "terminal",
      state: "completed",
      failure: null,
    });
    await assert.rejects(stat(workspacePath), { code: "ENOENT" });
    assert.equal(git(root, "status", "--porcelain"), tree);
    assert.equal(
      await readFile(join(root, sourcePath), "utf8"),
      "// versão atual\n",
    );

    const blocked = new CodexQueries({ detect });
    t.after(() => blocked.close());
    assert.equal(
      (await blocked.status(projectId)).state,
      "confinement_unverified",
    );
    assert.throws(
      () => blocked.prepare(prepare("unconfined_workspace_development")),
      {
        message: "codex_selection_invalid",
      },
    );
    const strict = blocked.prepare(prepared);
    await assert.rejects(
      blocked.start({
        ...approval,
        grantId: strict.grantId,
        unconfinedConfirmed: true,
      }),
      {
        message: "codex_unavailable",
      },
    );

    const workspace = new CodexQueries({
      development: {
        mode: "unconfined_workspace_development",
        helper: join(env.root, "missing.exe"),
      },
      detect: async (_cwd, options) => {
        assert.equal(options?.workspace, true);
        return detect();
      },
    });
    t.after(() => workspace.close());
    const workspacePreview = workspace.prepare(prepare(workspace.mode));
    const workspaceRequest = {
      ...approval,
      grantId: workspacePreview.grantId,
      manifestDigest: workspacePreview.manifestDigest,
    };
    const details = workspace.approval({
      ...workspaceRequest,
      operation: "codex.approval",
    });
    assert.equal(details.mode, "unconfined_workspace_development");
    assert.equal(details.snapshotDigest, snapshot.digest);
    assert.deepEqual(details.sources, [
      { path: sourcePath, bytes: Buffer.byteLength(result.text) },
    ]);
    assert.equal((await workspace.status(projectId)).state, "workspace_ready");
    await assert.rejects(workspace.start(workspaceRequest), {
      message: "codex_authorization_required",
    });
    const real = await workspace.start({
      ...workspaceRequest,
      unconfinedConfirmed: true,
    });
    assert.equal(real.mode, "unconfined_workspace_development");
    await assert.rejects(
      workspace.start({ ...workspaceRequest, unconfinedConfirmed: true }),
      { message: "codex_authorization_required" },
    );
    let failed = workspace.events({
      ...real,
      operation: "codex.events",
      afterSeq: 0,
    });
    while (failed.state === "running") {
      await delay(10);
      failed = workspace.events({
        ...real,
        operation: "codex.events",
        afterSeq: 0,
      });
    }
    assert.deepEqual(failed.events.at(-1), {
      seq: 1,
      type: "terminal",
      state: "failed",
      failure: "launch_failed",
    });
    assert.equal(git(root, "status", "--porcelain"), tree);
    assert.equal(
      await readFile(join(root, sourcePath), "utf8"),
      "// versão atual\n",
    );

    const mock = new CodexQueries({
      development: { mode: "mock_development", scenario: "late_after_cancel" },
      detect: async () => assert.fail("mock called the CLI detector"),
    });
    t.after(() => mock.close());
    assert.deepEqual(await mock.status(projectId), {
      projectId,
      mode: "mock_development",
      state: "mock_ready",
      version: null,
    });
    const simulatedPreview = mock.prepare(prepare(mock.mode));
    assert.equal(simulatedPreview.provider, "mock");
    const simulated = await mock.start({
      ...approval,
      grantId: simulatedPreview.grantId,
      manifestDigest: simulatedPreview.manifestDigest,
    });
    const poll = {
      ...simulated,
      operation: "codex.events",
      afterSeq: 0,
    } as const;
    assert.throws(() => mock.events({ ...poll, projectId: "b".repeat(64) }), {
      message: "codex_execution_unavailable",
    });
    assert.throws(
      () => mock.events({ ...poll, executionId: real.executionId }),
      {
        message: "codex_execution_unavailable",
      },
    );
    mock.cancel({ ...simulated, operation: "codex.cancel" });
    await delay(0);
    const cancelled = mock.events(poll);
    assert.equal(cancelled.mode, "mock_development");
    assert.equal(cancelled.state, "cancelled");
    assert.deepEqual(
      cancelled.events.map(({ type }) => type),
      ["started", "session", "progress", "terminal"],
    );
  },
);
