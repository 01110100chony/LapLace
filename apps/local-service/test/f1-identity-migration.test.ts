import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openCatalog, catalogSchemaVersion } from "../src/catalog.ts";
import {
  buildF1LegacyFixture,
  createConsistentCatalogCopy,
  PRESERVED_SOURCE_CONTENT,
  readLegacyMigrationOracle,
  seedD04Catalog,
} from "./fixtures/f1-legacy-catalog.ts";
import { fixture, git, gitReadOnly } from "./fixtures/ipc-harness.ts";

function stripSchemaVersion(
  oracle: ReturnType<typeof readLegacyMigrationOracle>,
) {
  const { userVersion: _ignored, ...restSchema } = oracle.schema;
  void _ignored;
  return { ...oracle, schema: restSchema };
}

test(
  "F1-T03.A1: migra cópia v10 para v11 com paridade integral, idempotência no reinício e restauração v10 isolada",
  { timeout: 60_000 },
  async (t) => {
    const built = await buildF1LegacyFixture(t);
    const {
      env,
      legacyRuntime,
      projectA,
      projectB,
      expectedList,
      snapshot,
      sourceRef,
      previewBeforeRestart,
      review,
      reviewStatusBeforeRestart,
      copy,
      oracle,
    } = built;

    assert.equal(catalogSchemaVersion, 13);

    // Preserve an untouched v10 backup before the candidate mutates copy.copyDataDir.
    const restoreBackup = await createConsistentCatalogCopy(
      copy.copyDataDir,
      copy.copyDatabase,
      join(env.root, "restore-v10-isolated"),
    );

    const firstCandidate = env.start(copy.copyDataDir, "completed");
    assert.deepEqual(
      await firstCandidate.request("workspace.list"),
      expectedList,
    );
    assert.deepEqual(
      await firstCandidate.request("context.get", {
        projectId: projectA.id,
        contextId: snapshot.contextId,
      }),
      snapshot,
    );
    assert.deepEqual(
      await firstCandidate.request("context.sourcePreview", {
        projectId: projectA.id,
        ...sourceRef,
      }),
      previewBeforeRestart,
    );
    await assert.rejects(
      firstCandidate.request("context.sourcePreview", {
        projectId: projectB.id,
        ...sourceRef,
      }),
      { message: "context_source_unavailable" },
    );
    assert.deepEqual(
      await firstCandidate.request("result.reviewStatus", {
        projectId: projectA.id,
        taskId: review.taskId,
        executionId: review.executionId,
      }),
      reviewStatusBeforeRestart,
    );
    await assert.rejects(
      firstCandidate.request("result.reviewStatus", {
        projectId: projectB.id,
        taskId: review.taskId,
        executionId: review.executionId,
      }),
      { message: "task_execution_unavailable" },
    );

    const identityA1 = await firstCandidate.request("project.identity", {
      projectId: projectA.id,
    });
    const identityB1 = await firstCandidate.request("project.identity", {
      projectId: projectB.id,
    });
    assert.equal(identityA1.verification, "verified");
    assert.equal(identityA1.requiresConfirmation, false);
    assert.equal(identityA1.legacyProjectId, projectA.id);
    assert.equal(identityA1.root, projectA.root);
    assert.notEqual(identityA1.scope.projectId, projectA.id);
    assert.notEqual(identityA1.scope.bindingId, identityA1.scope.projectId);
    assert.notEqual(identityA1.scope.worktreeId, identityA1.scope.bindingId);

    assert.equal(identityB1.verification, "verified");
    assert.equal(identityB1.requiresConfirmation, false);
    assert.equal(identityB1.legacyProjectId, projectB.id);
    assert.notEqual(identityB1.scope.projectId, identityA1.scope.projectId);
    assert.notEqual(identityB1.scope.bindingId, identityA1.scope.bindingId);
    assert.notEqual(identityB1.scope.worktreeId, identityA1.scope.worktreeId);
    await firstCandidate.close();

    {
      using database = new DatabaseSync(copy.copyDatabase, { readOnly: true });
      assert.equal(
        database.prepare("PRAGMA user_version").get()?.user_version,
        catalogSchemaVersion,
      );
      assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM logical_projects").get()?.c,
        2,
      );
      assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM local_repo_bindings").get()
          ?.c,
        2,
      );
      assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM worktrees").get()?.c,
        2,
      );
    }

    const migratedOracle = readLegacyMigrationOracle(copy.copyDatabase, 1);
    assert.equal(migratedOracle.schema.userVersion, catalogSchemaVersion);
    assert.equal(migratedOracle.schema.integrityCheck, "ok");
    assert.equal(migratedOracle.schema.foreignKeyViolations, 0);
    assert.deepEqual(
      stripSchemaVersion(migratedOracle),
      stripSchemaVersion(oracle),
    );

    // Second open must be idempotent: exact same IDs and row counts.
    const secondCandidate = env.start(copy.copyDataDir);
    const identityA2 = await secondCandidate.request("project.identity", {
      projectId: projectA.id,
    });
    const identityB2 = await secondCandidate.request("project.identity", {
      projectId: projectB.id,
    });
    assert.deepEqual(identityA2.scope, identityA1.scope);
    assert.deepEqual(identityB2.scope, identityB1.scope);
    assert.equal(
      (
        await secondCandidate.request("context.sourcePreview", {
          projectId: projectA.id,
          ...sourceRef,
        })
      ).text,
      PRESERVED_SOURCE_CONTENT,
    );
    await secondCandidate.close();

    {
      using database = new DatabaseSync(copy.copyDatabase, { readOnly: true });
      assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM logical_projects").get()?.c,
        2,
      );
      assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM local_repo_bindings").get()
          ?.c,
        2,
      );
      assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM worktrees").get()?.c,
        2,
      );
    }

    // Reopen the isolated v10 backup against the legacy 9254b50 sidecar runtime.
    const restoredLegacy = env.start(restoreBackup.copyDataDir, "completed", {
      entry: legacyRuntime.entry,
    });
    assert.deepEqual(
      await restoredLegacy.request("workspace.list"),
      expectedList,
    );
    assert.deepEqual(
      await restoredLegacy.request("context.sourcePreview", {
        projectId: projectA.id,
        ...sourceRef,
      }),
      previewBeforeRestart,
    );
    assert.deepEqual(
      await restoredLegacy.request("result.reviewStatus", {
        projectId: projectA.id,
        taskId: review.taskId,
        executionId: review.executionId,
      }),
      reviewStatusBeforeRestart,
    );
    await restoredLegacy.close();
  },
);

test(
  "F1-T03.A1: falha injetada na migração v11 faz rollback completo e D04 sem identidade mantém estado não confirmado",
  { timeout: 60_000 },
  async (t) => {
    const built = await buildF1LegacyFixture(t);
    const { env, copy, oracle } = built;

    const faultCopy = await createConsistentCatalogCopy(
      copy.copyDataDir,
      copy.copyDatabase,
      join(env.root, "fault-injection-v10"),
    );

    {
      using database = new DatabaseSync(faultCopy.copyDatabase);
      database.exec(
        "CREATE TABLE worktrees (blocked INTEGER PRIMARY KEY) STRICT;",
      );
    }

    assert.throws(() => openCatalog(faultCopy.copyDataDir));

    {
      using database = new DatabaseSync(faultCopy.copyDatabase, {
        readOnly: true,
      });
      assert.equal(
        database.prepare("PRAGMA user_version").get()?.user_version,
        10,
      );
      const tables = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('logical_projects', 'local_repo_bindings')",
        )
        .all();
      assert.equal(tables.length, 0);
    }

    const postRollbackOracle = readLegacyMigrationOracle(
      faultCopy.copyDatabase,
      1,
    );
    assert.deepEqual(postRollbackOracle, oracle);

    // Clean D04 catalog (schema v1, no git_identity) must preserve unverified_legacy until inspect.
    const d04Repo = await env.repository("Projeto D04 Sem Identidade");
    await writeFile(join(d04Repo, "README.md"), "D04 sintetico\n");
    git(d04Repo, "add", "README.md");
    git(d04Repo, "commit", "-qm", "D04 base");
    const d04Root = realpathSync.native(d04Repo);
    const d04Id = "d".repeat(64);
    const d04DataDir = join(env.root, "d04-legacy");
    const d04Db = join(d04DataDir, "catalog.sqlite3");
    await seedD04Catalog(d04DataDir, d04Db, {
      id: d04Id,
      root: d04Root,
      name: "Projeto D04 Sem Identidade",
    });

    const service = env.start(d04DataDir);
    const listed = await service.request("workspace.list");
    assert.equal(listed.selectedProjectId, d04Id);
    assert.deepEqual(listed.projects, [
      { id: d04Id, name: "Projeto D04 Sem Identidade", root: d04Root },
    ]);

    const unverified = await service.request("project.identity", {
      projectId: d04Id,
    });
    assert.equal(unverified.verification, "unverified_legacy");
    assert.equal(unverified.requiresConfirmation, true);
    assert.equal(unverified.candidates.length, 1);
    assert.equal(unverified.candidates[0]?.verification, "unverified_legacy");

    await assert.rejects(
      service.request("project.relocate", { projectId: d04Id, path: d04Root }),
      { message: "project_identity_unknown" },
    );

    const inspected = await service.request("project.inspect", {
      projectId: d04Id,
    });
    assert.equal(inspected.root, d04Root);

    const verified = await service.request("project.identity", {
      projectId: d04Id,
    });
    assert.equal(verified.verification, "verified");
    assert.equal(verified.requiresConfirmation, false);
    assert.deepEqual(verified.scope, unverified.scope);
    await service.close();
  },
);

test(
  "F1-T04.A1: valida movimento, rejeição de destino divergente, cópia separada, worktree vinculada, remote igual e rebase",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repoA = await env.repository("Projeto Origem A");
    git(repoA, "config", "core.autocrlf", "false");
    git(repoA, "remote", "add", "origin", "https://example.invalid/shared.git");
    await mkdir(join(repoA, "src"), { recursive: true });
    await writeFile(join(repoA, "src", "main.ts"), "export const v = 1;\n");
    git(repoA, "add", "--", "src/main.ts");
    git(repoA, "commit", "-qm", "commit inicial");

    const service = env.start();
    const addedA = await service.request("workspace.addLocal", { path: repoA });
    const idBefore = await service.request("project.identity", {
      projectId: addedA.id,
    });
    assert.equal(idBefore.verification, "verified");
    assert.equal(idBefore.requiresConfirmation, false);

    // Copy before moving so destination has identical HEAD, history and remote URL,
    // but distinct directory/git inodes.
    const separateCopy = join(env.root, "Copia Mesmo HEAD e Remote");
    await cp(repoA, separateCopy, { recursive: true });
    const separateRoot = realpathSync.native(separateCopy);

    // Move original repoA -> movedA and relocate.
    const movedA = join(env.root, "Projeto Movido A");
    await service.close();
    await rename(repoA, movedA);
    const movedRoot = realpathSync.native(movedA);

    const relocatedService = env.start();
    await assert.rejects(
      relocatedService.request("project.relocate", {
        projectId: addedA.id,
        path: separateCopy,
      }),
      { message: "project_identity_mismatch" },
    );

    const divergentCheck = await relocatedService.request("project.identity", {
      projectId: addedA.id,
      path: separateCopy,
    });
    assert.equal(divergentCheck.verification, "divergent");
    assert.equal(divergentCheck.requiresConfirmation, true);
    assert.equal(divergentCheck.candidates[0]?.reason, "identity_mismatch");

    const relocated = await relocatedService.request("project.relocate", {
      projectId: addedA.id,
      path: movedA,
    });
    assert.equal(relocated.root, movedRoot);

    const idAfterMove = await relocatedService.request("project.identity", {
      projectId: addedA.id,
    });
    assert.equal(idAfterMove.verification, "verified");
    assert.equal(idAfterMove.requiresConfirmation, false);
    assert.equal(idAfterMove.root, movedRoot);
    assert.deepEqual(idAfterMove.scope, idBefore.scope);

    // Adding the separate copy keeps distinct project/binding/worktree IDs even with same HEAD & remote.
    const addedCopy = await relocatedService.request("workspace.addLocal", {
      path: separateCopy,
    });
    assert.notEqual(addedCopy.id, addedA.id);
    assert.equal(addedCopy.root, separateRoot);
    const idCopy = await relocatedService.request("project.identity", {
      projectId: addedCopy.id,
    });
    assert.notEqual(idCopy.scope.projectId, idBefore.scope.projectId);
    assert.notEqual(idCopy.scope.bindingId, idBefore.scope.bindingId);
    assert.notEqual(idCopy.scope.worktreeId, idBefore.scope.worktreeId);

    // Linked worktree shares projectId + bindingId, owns distinct worktreeId, and triggers ambiguity when passed to main.
    const linkedWt = join(env.root, "Worktree Vinculada A");
    git(movedA, "worktree", "add", "--quiet", "-b", "feat/worktree", linkedWt);
    const linkedRoot = realpathSync.native(linkedWt);
    const addedLinked = await relocatedService.request("workspace.addLocal", {
      path: linkedWt,
    });
    assert.notEqual(addedLinked.id, addedA.id);
    assert.equal(addedLinked.root, linkedRoot);

    const idLinked = await relocatedService.request("project.identity", {
      projectId: addedLinked.id,
    });
    assert.equal(idLinked.verification, "verified");
    assert.equal(idLinked.scope.projectId, idBefore.scope.projectId);
    assert.equal(idLinked.scope.bindingId, idBefore.scope.bindingId);
    assert.notEqual(idLinked.scope.worktreeId, idBefore.scope.worktreeId);
    assert.equal(idLinked.worktrees.length, 2);

    const ambiguous = await relocatedService.request("project.identity", {
      projectId: addedA.id,
      path: linkedWt,
    });
    assert.equal(ambiguous.verification, "ambiguous");
    assert.equal(ambiguous.requiresConfirmation, true);
    assert.ok(ambiguous.candidates.length >= 2);
    assert.ok(
      ambiguous.candidates.every((c) => c.reason === "shared_common_git"),
    );

    // Amending commit & changing remote URL on movedA preserves (projectId, bindingId, worktreeId).
    const statusBefore = gitReadOnly(movedA, "status", "--porcelain");
    git(
      movedA,
      "remote",
      "set-url",
      "origin",
      "https://example.invalid/new.git",
    );
    await writeFile(join(movedA, "src", "main.ts"), "export const v = 2;\n");
    git(movedA, "add", "--", "src/main.ts");
    git(movedA, "commit", "--quiet", "--amend", "-m", "commit reescrito");
    const newHead = gitReadOnly(movedA, "rev-parse", "HEAD");
    assert.notEqual(newHead, addedA.head);

    const inspectedAfterRebase = await relocatedService.request(
      "project.inspect",
      { projectId: addedA.id },
    );
    assert.equal(inspectedAfterRebase.head, newHead);
    const idAfterRebase = await relocatedService.request("project.identity", {
      projectId: addedA.id,
    });
    assert.deepEqual(idAfterRebase.scope, idBefore.scope);
    assert.equal(gitReadOnly(movedA, "status", "--porcelain"), statusBefore);

    // Replacing registered root with a junction pointing to another path must NOT silently mutate worktrees.root.
    const movedViaLink = join(env.root, "Projeto A Real Alvo");
    await rename(movedA, movedViaLink);
    await symlink(
      movedViaLink,
      movedA,
      process.platform === "win32" ? "junction" : "dir",
    );
    const viaJunction = await relocatedService.request("project.identity", {
      projectId: addedA.id,
    });
    assert.equal(viaJunction.verification, "unavailable");
    assert.equal(viaJunction.root, movedRoot);
    await unlink(movedA);
    await rename(movedViaLink, movedA);

    const restoredAfterJunction = await relocatedService.request(
      "project.identity",
      { projectId: addedA.id },
    );
    assert.equal(restoredAfterJunction.verification, "verified");
    assert.equal(restoredAfterJunction.root, movedRoot);

    await relocatedService.close();

    // Repeated openCatalog calls must remain strictly idempotent without duplicating identity rows.
    for (let i = 0; i < 3; i++) {
      const reopened = openCatalog(env.dataDir);
      reopened.close();
    }
    {
      using database = new DatabaseSync(env.database, { readOnly: true });
      assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM logical_projects").get()?.c,
        2,
      );
      assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM local_repo_bindings").get()
          ?.c,
        2,
      );
      assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM worktrees").get()?.c,
        3,
      );
    }
  },
);
