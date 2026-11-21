import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { parseGitHubRepository } from "@laplace/contracts";
import { canonicalPath } from "../src/git.ts";
import { GitHubClones, type CloneRunner } from "../src/github-clone.ts";

const repository = "https://github.com/laplace-fixture/fruta";
const exec = promisify(execFile);
const windows = { skip: process.platform !== "win32", timeout: 20_000 };

test("only canonical HTTPS repository URLs are accepted for cloning", () => {
  assert.deepEqual(parseGitHubRepository(repository + "/"), {
    url: repository + ".git",
    name: "fruta",
  });
  for (const bad of [
    "https://github.com.evil.invalid/laplace-fixture/fruta",
    "https://github.com@evil.invalid/laplace-fixture/fruta",
    "https://user:password@github.com/laplace-fixture/fruta",
    "http://github.com/laplace-fixture/fruta",
    repository + "/tree/main",
    repository + "?x=1",
    "https://github.com/laplace-fixture/CON.txt",
    "https://github.com/laplace-fixture/..",
    "https://github.com/laplace-fixture/.laplace-clone-1",
  ]) {
    assert.equal(parseGitHubRepository(bad), undefined, bad);
  }
});

async function withFixture(fn: (root: string) => Promise<void>) {
  const base = await canonicalPath(tmpdir());
  const root = await mkdtemp(join(base, "laplace-clone-test-"));
  try {
    await fn(root);
  } finally {
    assert.equal(await canonicalPath(root), root);
    assert.ok(basename(root).startsWith("laplace-clone-test-"));
    assert.equal(dirname(root), base);
    assert.equal(relative(base, root), basename(root));
    await rm(root, { recursive: true, force: true });
  }
}

test(
  "clone checks the destination at prepare and preserves a directory created during transfer",
  windows,
  async () => {
    await withFixture(async (root) => {
      const target = join(root, "fruta");
      const sentinel = join(target, "original.txt");
      const runner: CloneRunner = async (_url, stage) => {
        await exec("git", ["init", "-q", "--template=", stage]);
        await mkdir(target);
        await writeFile(sentinel, "pasta existente");
        return "success";
      };
      const clones = new GitHubClones(runner);
      const plan = await clones.prepare(repository, root);
      const job = clones.start(plan.grantId, () =>
        assert.fail("unexpected registration"),
      );
      while (
        ["cloning", "cancelling"].includes(clones.status(job.cloneId).state)
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(
        clones.status(job.cloneId).failure,
        "clone_destination_exists",
      );
      assert.equal(await readFile(sentinel, "utf8"), "pasta existente");
      assert.deepEqual(await readdir(root), ["fruta"]);
      await assert.rejects(clones.prepare(repository, root), {
        code: "clone_destination_exists",
      });
    });
  },
);

test(
  "cancellation waits for the clone runner before deleting staging",
  windows,
  async () => {
    await withFixture(async (root) => {
      let ready!: () => void;
      const staged = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const clones = new GitHubClones(async (_url, stage, signal) => {
        await writeFile(join(stage, "partial"), "clone parcial");
        ready();
        if (!signal.aborted) await once(signal, "abort");
        assert.equal(
          await readFile(join(stage, "partial"), "utf8"),
          "clone parcial",
        );
        return "cancelled";
      });
      const plan = await clones.prepare(repository, root);
      const job = clones.start(plan.grantId, () =>
        assert.fail("unexpected registration"),
      );
      await staged;
      assert.equal(clones.cancel(job.cloneId).state, "cancelling");
      await clones.close();
      assert.equal(clones.status(job.cloneId).state, "cancelled");
      assert.deepEqual(await readdir(root), []);
    });
  },
);
