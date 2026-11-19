import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
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
          args: { path?: string; projectId?: string } = {},
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
      version: 1,
      id: "bad-1",
      operation: "shell",
    });
    assert.deepEqual(bad, {
      version: 1,
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
        1,
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
    await first.request("project.inspect", { projectId: a.id });
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
    const fresh = await second.request("project.inspect", {
      projectId: restored.selectedProjectId!,
    });
    assert.equal(fresh.branch, "depois-do-reinicio");
    assert.equal(fresh.head, newHead);
    assert.equal(fresh.changes.untracked, 1);
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
      version: 1,
      id: "path-only",
      operation: "project.inspect",
      path: available,
    });
    assert.deepEqual(invalid, {
      version: 1,
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
      (await second.request("project.inspect", { projectId: a.id })).id,
      a.id,
    );
    assert.equal(
      (await second.request("workspace.list")).selectedProjectId,
      a.id,
    );
    await rename(moved, missing);
    assert.equal(
      (await second.request("project.inspect", { projectId: b.id })).id,
      b.id,
    );
    assert.deepEqual(await second.request("workspace.list"), saved);
    await second.close();
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
      database.exec("PRAGMA user_version = 2");
      const second = env.start();
      await assert.rejects(second.request("workspace.list"), {
        message: "catalog_unavailable",
      });
      await second.close();
      assert.equal(
        database.prepare("PRAGMA user_version").get()?.user_version,
        2,
      );
      database.exec("PRAGMA user_version = 1");
    } finally {
      database.close();
    }

    const third = env.start();
    assert.deepEqual(await third.request("workspace.list"), saved);
    await third.close();
  },
);
