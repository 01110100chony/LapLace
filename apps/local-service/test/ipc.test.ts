import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import {
  cp,
  mkdtemp,
  mkdir,
  rename,
  readFile,
  stat,
  unlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isResponse,
  contextSearchPageSize,
  maxContextQueryBytes,
  maxContextSearchOffset,
  maxContextSnippetBytes,
  protocolVersion,
  type CodexEvent,
  type Operation,
  type Results,
} from "@laplace/contracts";

import { openCatalog } from "../src/catalog.ts";
import { CodexQueries, prepareCodex } from "../src/codex.ts";

const entry = fileURLToPath(new URL("../src/main.ts", import.meta.url));

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "laplace-ipc-"));
  const dataDir = join(root, "dados do aplicativo");
  const stores = new Set<() => Promise<unknown>>();
  t.after(async () => {
    await Promise.all([...stores].map((stop) => stop()));
    await rm(root, { recursive: true, force: true });
  });

  return {
    root,
    dataDir,
    database: join(dataDir, "catalog.sqlite3"),
    start(path = dataDir) {
      const child = spawn(process.execPath, [entry, path], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "inherit"],
      });
      const closed = once(child, "close");
      const lines = createInterface({ input: child.stdout })[
        Symbol.asyncIterator
      ]();
      const stop = () => {
        if (child.exitCode === null) child.kill();
        return closed;
      };
      stores.add(stop);
      let sequence = 0;
      return {
        async exchange(value: object): Promise<unknown> {
          child.stdin.write(JSON.stringify(value) + "\n");
          return JSON.parse((await lines.next()).value ?? "null");
        },
        async request<K extends Operation>(
          operation: K,
          args: Record<string, unknown> = {},
        ): Promise<Results[K]> {
          const id = `request-${++sequence}`;
          const response = await this.exchange({
            version: protocolVersion,
            id,
            operation,
            ...args,
          });
          assert.ok(
            isResponse(response, id, operation),
            JSON.stringify(response),
          );
          if (!response.ok) throw new Error(response.error.code);
          return response.data;
        },
        async close() {
          child.stdin.end();
          assert.deepEqual(await closed, [0, null]);
          stores.delete(stop);
        },
      };
    },
    async repository(name: string) {
      const path = join(root, name);
      await mkdir(path);
      git(path, "init", "--quiet", "-b", "main");
      return path;
    },
  };
}

function git(path: string, ...args: string[]) {
  return execFileSync(
    "git",
    [
      "-C",
      path,
      "-c",
      "user.name=Laplace Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      },
    },
  ).trim();
}

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
        4,
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
      database.exec("PRAGMA user_version = 5");
      const second = env.start();
      await assert.rejects(second.request("workspace.list"), {
        message: "catalog_unavailable",
      });
      await second.close();
      assert.equal(
        database.prepare("PRAGMA user_version").get()?.user_version,
        5,
      );
      database.exec("PRAGMA user_version = 4");
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
      4,
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

    const catalog = openCatalog(env.dataDir);
    const prepared = (() => {
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
        );
      } finally {
        catalog.close();
      }
    })();
    let workspacePath = "";
    let launched = 0;
    const queries = new CodexQueries({
      detect: async () => ({
        availability: { state: "confinement_unverified", version: "0.141.0" },
        installation: { executable: process.execPath, version: "0.141.0" },
      }),
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
  },
);
