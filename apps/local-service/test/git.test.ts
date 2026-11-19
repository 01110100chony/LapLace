import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { GitError, inspectRepository } from "../src/git.ts";

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    },
  }).trim();
}

async function temporary(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "laplace-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function repository(t: TestContext) {
  const root = join(await temporary(t), "Projeto São João");
  await mkdir(root);
  git(root, "init", "--quiet", "-b", "main");
  git(root, "config", "user.name", "Laplace Test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "commit.gpgSign", "false");
  return root;
}

async function commitFixture(root: string) {
  await writeFile(join(root, "base.txt"), "original");
  git(root, "add", "base.txt");
  git(root, "commit", "--quiet", "-m", "Fixture");
}

async function snapshot(root: string) {
  const entries: Record<string, [string, number]> = {};
  const names = await readdir(root, { recursive: true });
  for (const name of names) {
    const path = join(root, name);
    const metadata = await stat(path);
    if (metadata.isFile()) {
      entries[name] = [
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
        metadata.mtimeMs,
      ];
    }
  }
  return entries;
}

test("lê branch e HEAD reais de uma subpasta com espaços e acentos", async (t) => {
  const root = await repository(t);
  await commitFixture(root);
  git(root, "branch", "-m", "feat/açúcar");
  const nested = join(root, "subpasta com espaço");
  await mkdir(nested);
  const result = await inspectRepository(nested);
  assert.equal(result.root, await realpath(root));
  assert.equal(result.name, "Projeto São João");
  assert.equal(result.branch, "feat/açúcar");
  assert.equal(result.head, git(root, "rev-parse", "HEAD"));
  assert.equal(result.root, (await inspectRepository(root)).root);
  assert.deepEqual(result.changes, {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  });
});

test("retorna branch e HEAD nulo em repositório sem commits", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, "adição.txt"), "nova");
  git(root, "add", "adição.txt");
  const result = await inspectRepository(root);
  assert.equal(result.branch, "main");
  assert.equal(result.head, null);
  assert.deepEqual(result.changes, {
    staged: 1,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  });
});

test("distingue índice, trabalho e arquivos não rastreados sem alterar a fixture", async (t) => {
  const root = await repository(t);
  await commitFixture(root);
  await writeFile(join(root, "base.txt"), "no índice");
  await writeFile(join(root, "arquivo preparado.txt"), "adicionado");
  git(root, "add", "base.txt", "arquivo preparado.txt");
  await writeFile(join(root, "base.txt"), "na árvore de trabalho");
  await mkdir(join(root, "exemplos"));
  await writeFile(join(root, "exemplos", "outro.txt"), "novo");
  await writeFile(join(root, "exemplos", "com acento õ.txt"), "novo");
  const before = await snapshot(root);
  const result = await inspectRepository(root);
  assert.deepEqual(result.changes, {
    staged: 2,
    unstaged: 1,
    untracked: 2,
    conflicted: 0,
  });
  assert.deepEqual(await snapshot(root), before);
});

test("lê HEAD destacado e contabiliza uma renomeação uma única vez", async (t) => {
  const root = await repository(t);
  await commitFixture(root);
  git(root, "checkout", "--quiet", "--detach");
  git(root, "mv", "base.txt", "novo nome ç.txt");
  const result = await inspectRepository(root);
  assert.equal(result.branch, null);
  assert.equal(result.head, git(root, "rev-parse", "HEAD"));
  assert.deepEqual(result.changes, {
    staged: 1,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  });
});

test("reconhece worktree vinculada pela raiz e branch próprias", async (t) => {
  const root = await repository(t);
  await commitFixture(root);
  const linked = join(root, "..", "Outra cópia");
  git(root, "worktree", "add", "--quiet", "-b", "outra", linked);
  const [original, worktree] = await Promise.all([
    inspectRepository(root),
    inspectRepository(linked),
  ]);
  assert.notEqual(original.root, worktree.root);
  assert.equal(worktree.root, await realpath(linked));
  assert.equal(worktree.branch, "outra");
  assert.equal(worktree.head, original.head);
});

test("não executa hooks FSMonitor nem filtros Git configurados na fixture", async (t) => {
  const root = await repository(t);
  await writeFile(join(root, ".gitattributes"), "*.txt filter=laplace=externo");
  git(root, "add", ".gitattributes");
  await commitFixture(root);
  await writeFile(
    join(root, "fsmonitor.sh"),
    "#!/bin/sh\necho forbidden > fsmonitor-ran\n",
  );
  git(root, "config", "core.fsmonitor", "./fsmonitor.sh");
  git(
    root,
    "config",
    "filter.laplace=externo.clean",
    "echo forbidden > filter-ran",
  );
  git(
    root,
    "config",
    "filter.laplace=externo.process",
    "echo forbidden > filter-ran",
  );
  git(root, "config", "filter.laplace=externo.required", "true");
  await writeFile(join(root, "base.txt"), "alterado");
  const before = await snapshot(root);
  const result = await inspectRepository(root, {
    env: { ...process.env, GIT_DIR: "diretório incorreto" },
  });
  assert.equal(result.changes.unstaged, 1);
  assert.deepEqual(await snapshot(root), before);
});

test("diferencia caminho inválido, pasta comum e binário Git ausente", async (t) => {
  const root = await temporary(t);
  const file = join(root, "arquivo");
  await writeFile(file, "");
  await assert.rejects(inspectRepository(file), { code: "invalid_folder" });
  await assert.rejects(inspectRepository(join(root, "inexistente")), {
    code: "invalid_folder",
  });
  await assert.rejects(inspectRepository(root), { code: "not_repository" });
  await assert.rejects(inspectRepository(root, { env: { PATH: "" } }), {
    code: "git_missing",
  });
});

test("aplica um prazo à inspeção Git", async (t) => {
  const root = await repository(t);
  await assert.rejects(
    inspectRepository(root, { timeoutMs: 0 }),
    (error) => error instanceof GitError && error.code === "git_timeout",
  );
});
