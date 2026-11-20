import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { realpathSync } from "node:fs";
import {
  cp,
  mkdtemp,
  mkdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isResponse,
  protocolVersion,
  type Operation,
  type Results,
} from "@laplace/contracts";

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
        3,
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
      database.exec("PRAGMA user_version = 4");
      const second = env.start();
      await assert.rejects(second.request("workspace.list"), {
        message: "catalog_unavailable",
      });
      await second.close();
      assert.equal(
        database.prepare("PRAGMA user_version").get()?.user_version,
        4,
      );
      database.exec("PRAGMA user_version = 3");
    } finally {
      database.close();
    }

    const third = env.start();
    assert.deepEqual(await third.request("workspace.list"), saved);
    await third.close();
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
