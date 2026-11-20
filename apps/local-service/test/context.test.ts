import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { openCatalog } from "../src/catalog.ts";
import { browseContext, captureContext } from "../src/context.ts";
import { inspectRepository } from "../src/git.ts";

function git(root: string, ...args: string[]) {
  return execFileSync(
    "git",
    [
      "-C",
      root,
      "-c",
      "user.name=Laplace Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    {
      windowsHide: true,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      },
    },
  ).trim();
}

async function fixture(t: TestContext) {
  const temp = await mkdtemp(join(tmpdir(), "laplace-context-"));
  const data = join(temp, "dados");
  const store = openCatalog(data);
  t.after(async () => {
    store.close();
    await rm(temp, { recursive: true, force: true });
  });
  return {
    temp,
    data,
    store,
    async project(name = "Projeto São João") {
      const root = join(temp, name);
      await mkdir(root, { recursive: true });
      git(root, "init", "--quiet", "-b", "main");
      const inspection = await inspectRepository(root);
      const { id } = store.add(inspection);
      return store.lookup(id);
    },
  };
}

function digest(bytes: string | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("preserva bytes exatos, ordena a seleção e produz um digest reproduzível sem alterar a origem", async (t) => {
  const { store, project } = await fixture(t);
  const checkout = await project();
  const names = ["z final.txt", "Ação com espaços.txt"];
  const content = "Olá, Laplace\r\n";
  for (const name of names) await writeFile(join(checkout.root, name), content);
  const origin = join(checkout.root, names[1]!);
  const before = await stat(origin, { bigint: true });
  const first = store.context.save(await captureContext(checkout, names));
  const second = store.context.save(
    await captureContext(checkout, [...names].reverse()),
  );
  assert.equal(first.status, "complete");
  assert.equal(first.head, null);
  assert.equal(first.branch, "main");
  assert.equal(first.gitRoot, checkout.root);
  assert.equal(first.worktreeIdentity, checkout.identity);
  assert.equal(first.digest, second.digest);
  assert.notEqual(first.contextId, second.contextId);
  assert.deepEqual(
    first.entries.map((entry) => entry.path),
    [...names].sort(),
  );
  for (const entry of first.entries) {
    assert.equal(entry.outcome, "included");
    assert.equal(entry.origin, "working_tree");
    assert.deepEqual(entry.index, []);
    assert.equal(entry.size, Buffer.byteLength(content));
    assert.equal(entry.sha256, digest(content));
    assert.equal(entry.contentRef, `sha256:${digest(content)}`);
    assert.equal(
      Buffer.from(
        store.context.readSource(checkout.id, first.contextId, entry.path),
      ).toString(),
      content,
    );
  }
  assert.deepEqual(store.context.get(checkout.id, first.contextId), first);
  assert.equal((await stat(origin, { bigint: true })).mtimeNs, before.mtimeNs);
  assert.equal(await readFile(origin, "utf8"), content);
});

test(
  "mantém o caminho canônico e evita duplicar um arquivo com outra caixa no Windows",
  {
    skip: process.platform !== "win32",
  },
  async (t) => {
    const { project } = await fixture(t);
    const checkout = await project();
    await writeFile(join(checkout.root, "Código.txt"), "texto");
    git(checkout.root, "add", "--", "Código.txt");
    const { snapshot } = await captureContext(checkout, [
      "código.txt",
      "Código.txt",
    ]);
    assert.equal(snapshot.status, "partial");
    assert.deepEqual(
      snapshot.entries.map((entry) => entry.outcome),
      ["included", "omitted"],
    );
    const [first, second] = snapshot.entries;
    assert.equal(
      first?.outcome === "included" && first.canonicalPath,
      "Código.txt",
    );
    assert.equal(first?.outcome === "included" && first.index.length, 1);
    assert.equal(
      second?.outcome === "omitted" && second.reason,
      "duplicate_path",
    );
    const alias = (await captureContext(checkout, ["código.txt"])).snapshot
      .entries[0];
    assert.equal(
      alias?.outcome === "included" && alias.canonicalPath,
      "Código.txt",
    );
    assert.equal(alias?.outcome === "included" && alias.index.length, 1);
  },
);

test("navega por pasta sem ler bytes e omite binários, caminhos sensíveis, gerados e limites", async (t) => {
  const { project } = await fixture(t);
  const checkout = await project();
  const files = {
    ".env.production": "TOKEN=fake",
    ".envrc": "TOKEN=fake",
    id_ed25519: "fixture",
    "private.pem": "fixture",
    "binário.dat": Buffer.from([0x00, 0xff]),
    "fake.exe": "parece texto",
    "large.txt": "12345678901",
    "a.txt": "1234",
    "b.txt": "1234",
    "manual.txt": "manual",
  };
  for (const [path, content] of Object.entries(files))
    await writeFile(join(checkout.root, path), content);
  for (const folder of ["node_modules", "src"])
    await mkdir(join(checkout.root, folder));
  await writeFile(join(checkout.root, "src", "main.ts"), "ok");
  await writeFile(join(checkout.root, "node_modules", "index.js"), "dep");
  const options = {
    limits: { fileBytes: 10, totalBytes: 6 },
    exclusions: ["manual.txt"],
  };
  const { snapshot } = await captureContext(
    checkout,
    [...Object.keys(files), "node_modules/index.js", "src", "missing.txt"],
    options,
  );
  assert.equal(snapshot.status, "partial");
  assert.deepEqual(
    Object.fromEntries(
      snapshot.entries.map((entry) => [
        entry.path,
        entry.outcome === "omitted" ? entry.reason : entry.outcome,
      ]),
    ),
    {
      ".env.production": "sensitive_path",
      ".envrc": "sensitive_path",
      id_ed25519: "sensitive_path",
      "private.pem": "sensitive_path",
      "binário.dat": "binary",
      "fake.exe": "binary",
      "large.txt": "too_large",
      "a.txt": "included",
      "b.txt": "total_limit",
      "manual.txt": "excluded",
      "node_modules/index.js": "excluded",
      src: "not_file",
      "missing.txt": "missing",
    },
  );
  const root = await browseContext(checkout, "", "", options);
  assert.deepEqual(
    root.items.map((entry) => entry.path),
    ["src", "a.txt", "b.txt", "binário.dat"],
  );
  const scoped = await browseContext(checkout, "src", "ma", options);
  assert.deepEqual(scoped.items, [{ path: "src/main.ts", kind: "file" }]);
});

test("rejeita caminhos arbitrários, junction e hard link e isola checkouts aninhados", async (t) => {
  const { project } = await fixture(t);
  const checkout = await project("Primeiro");
  const nested = await project("Primeiro/Interno");
  const outside = await project("Segundo");
  const sentry = join(outside.root, "sentinela.txt");
  await writeFile(sentry, "somente no outro projeto");
  await writeFile(
    join(nested.root, "sentinela.txt"),
    "somente no checkout interno",
  );
  await symlink(outside.root, join(checkout.root, "atalho"), "junction");
  await link(sentry, join(checkout.root, "hard.txt"));
  for (const path of [
    "../Segundo/sentinela.txt",
    "Interno/../arquivo.txt",
    sentry,
    "/etc/passwd",
    "C:arquivo.txt",
    "arquivo.txt:fluxo",
    "NUL.txt",
  ])
    await assert.rejects(captureContext(checkout, [path]), {
      code: "invalid_request",
    });
  const selected = [
    "atalho/sentinela.txt",
    "hard.txt",
    "Interno/sentinela.txt",
  ];
  const { snapshot, blobs } = await captureContext(checkout, selected, {
    protectedRoots: [nested.root],
  });
  assert.deepEqual(
    snapshot.entries.map(
      (entry) => entry.outcome === "omitted" && entry.reason,
    ),
    ["nested_project", "linked_path", "linked_path"],
  );
  assert.equal(blobs.size, 0);
  assert.deepEqual((await browseContext(checkout, "", "", {})).items, []);
  await assert.rejects(browseContext(checkout, "atalho", "", {}), {
    code: "context_path_unavailable",
  });
});

test("em HEAD destacado registra bytes da árvore e OID separado do índice, sem tocar no índice nem executar filtros", async (t) => {
  const { project } = await fixture(t);
  const checkout = await project();
  const file = join(checkout.root, "tracked.txt");
  await writeFile(file, "commit");
  git(checkout.root, "add", "tracked.txt");
  git(checkout.root, "commit", "--quiet", "-m", "base");
  const head = git(checkout.root, "rev-parse", "HEAD");
  git(checkout.root, "checkout", "--quiet", "--detach");
  await writeFile(file, "staged");
  git(checkout.root, "add", "tracked.txt");
  const oid = git(checkout.root, "rev-parse", ":tracked.txt");
  await writeFile(file, "unstaged");
  await writeFile(
    join(checkout.root, "novo.txt"),
    "explicitamente selecionado",
  );
  await writeFile(
    join(checkout.root, ".gitattributes"),
    "tracked.txt filter=tripwire\n",
  );
  git(
    checkout.root,
    "config",
    "filter.tripwire.clean",
    "echo ran > context-filter-ran.txt",
  );
  git(checkout.root, "config", "core.fsmonitor", "./unexpected-monitor");
  const index = join(checkout.root, ".git", "index");
  const before = await readFile(index);
  const stamp = (await stat(index, { bigint: true })).mtimeNs;
  const { snapshot, blobs } = await captureContext(checkout, [
    "tracked.txt",
    "novo.txt",
  ]);
  assert.equal(snapshot.head, head);
  assert.equal(snapshot.branch, null);
  const [untracked, tracked] = snapshot.entries;
  assert.equal(untracked?.outcome === "included" && untracked.index.length, 0);
  assert.equal(tracked?.outcome, "included");
  assert.equal(tracked.sha256, digest("unstaged"));
  assert.deepEqual(tracked.index, [{ mode: "100644", oid, stage: 0 }]);
  assert.equal(blobs.get(tracked.sha256)?.toString(), "unstaged");
  assert.deepEqual(await readFile(index), before);
  assert.equal((await stat(index, { bigint: true })).mtimeNs, stamp);
  await assert.rejects(stat(join(checkout.root, "context-filter-ran.txt")), {
    code: "ENOENT",
  });
});

test("invalida a geração inteira se uma fonte muda ou desaparece entre leituras", async (t) => {
  const { project, store } = await fixture(t);
  const checkout = await project();
  const a = join(checkout.root, "a.txt");
  const b = join(checkout.root, "b.txt");
  await writeFile(a, "versão 1");
  await writeFile(b, "dois");
  const capture = await captureContext(checkout, ["a.txt", "b.txt"], {
    async afterFirstRead(path) {
      if (path === "a.txt") {
        await writeFile(a, "versão 2");
        await unlink(b);
      }
    },
  });
  assert.equal(capture.snapshot.status, "invalidated");
  assert.equal(capture.snapshot.issue, "source_changed");
  assert.deepEqual(
    capture.snapshot.entries.map(
      (entry) => entry.outcome === "omitted" && entry.reason,
    ),
    ["changed", "changed"],
  );
  assert.equal(capture.blobs.size, 0);
  store.context.save(capture);
  const retry = await captureContext(checkout, ["a.txt", "b.txt"]);
  assert.equal(retry.snapshot.status, "partial");
  assert.deepEqual(retry.snapshot.entries[1], {
    path: "b.txt",
    origin: "working_tree",
    outcome: "omitted",
    reason: "missing",
  });
  assert.equal(retry.blobs.get(digest("versão 2"))?.toString(), "versão 2");
});

test("invalida alterações concorrentes do índice e HEAD e aborta no encerramento", async (t) => {
  const { project, store } = await fixture(t);
  const checkout = await project();
  await writeFile(join(checkout.root, "a.txt"), "original");
  const staged = await captureContext(checkout, ["a.txt"], {
    async afterFirstRead() {
      git(checkout.root, "add", "a.txt");
    },
  });
  assert.equal(staged.snapshot.issue, "repository_changed");
  assert.equal(staged.blobs.size, 0);
  const committed = await captureContext(checkout, ["a.txt"], {
    async afterFirstRead() {
      git(checkout.root, "commit", "--quiet", "-m", "first");
    },
  });
  assert.equal(committed.snapshot.issue, "repository_changed");
  assert.equal(committed.snapshot.head, null);
  const stop = new AbortController();
  await assert.rejects(
    captureContext(checkout, ["a.txt"], {
      signal: stop.signal,
      async afterFirstRead() {
        stop.abort();
      },
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(store.context.list(checkout.id, null).items, []);
  const moved = await captureContext(checkout, ["a.txt"], {
    async afterFirstRead() {
      await rename(checkout.root, join(checkout.root, "..", "movido"));
    },
  });
  assert.equal(moved.snapshot.issue, "repository_changed");
  assert.equal(moved.blobs.size, 0);
});

test("uma falha SQLite reverte entradas, manifesto e blobs; deduplica e verifica integridade no reinício", async (t) => {
  const { project, store, data } = await fixture(t);
  const checkout = await project();
  for (const name of ["a.txt", "b.txt"])
    await writeFile(join(checkout.root, name), "mesmos bytes");
  const capture = await captureContext(checkout, ["a.txt", "b.txt"]);
  using db = new DatabaseSync(join(data, "catalog.sqlite3"));
  db.exec(`CREATE TRIGGER reject_second BEFORE INSERT ON context_entries WHEN NEW.ordinal = 1
    BEGIN SELECT RAISE(ABORT, 'fixture'); END;`);
  assert.throws(() => store.context.save(capture), /fixture/);
  for (const table of ["context_snapshots", "context_entries", "context_blobs"])
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);

  db.exec("DROP TRIGGER reject_second");
  const saved = store.context.save(capture);
  const reopened = openCatalog(data);
  try {
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM context_blobs").get()?.n,
      1,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.deepEqual(reopened.context.get(checkout.id, saved.contextId), saved);
    assert.throws(() => reopened.context.get("b".repeat(64), saved.contextId), {
      code: "context_not_found",
    });
    assert.equal(
      Buffer.from(
        reopened.context.readSource(checkout.id, saved.contextId, "a.txt"),
      ).toString(),
      "mesmos bytes",
    );
    db.prepare("UPDATE context_blobs SET bytes = ?").run(
      Buffer.from("corrupted"),
    );
    assert.throws(
      () => reopened.context.readSource(checkout.id, saved.contextId, "a.txt"),
      /Invalid stored blob/,
    );
    db.prepare("UPDATE context_snapshots SET head = ?").run("f".repeat(40));
    assert.throws(
      () => reopened.context.get(checkout.id, saved.contextId),
      /Invalid context manifest/,
    );
  } finally {
    reopened.close();
  }
});
