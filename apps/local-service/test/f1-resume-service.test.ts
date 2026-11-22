import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { inspectRepository, GitError } from "../src/git.ts";
import { openCatalog } from "../src/catalog.ts";
import { captureContext } from "../src/context.ts";
import { createResumeService } from "../src/resume-service.ts";
import {
  buildF1LegacyFixture,
  PRESERVED_SOURCE_CONTENT,
  seedD04Catalog,
} from "./fixtures/f1-legacy-catalog.ts";
import {
  fixture,
  git,
  readGitInvariantSnapshot,
} from "./fixtures/ipc-harness.ts";

test(
  "F1-T09.A1: descarta publicação obsoleta em corridas A->B, A->B->A, mudança de vínculo e expurgo em voo",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repoA = await env.repository("Resume Race A");
    const repoB = await env.repository("Resume Race B");
    for (const repo of [repoA, repoB]) {
      git(repo, "config", "core.autocrlf", "false");
      await writeFile(join(repo, "README.md"), "base\n");
      git(repo, "add", "README.md");
      git(repo, "commit", "-qm", "base");
    }

    const catalog = openCatalog(env.dataDir);
    try {
      const inspA = await inspectRepository(repoA);
      const inspB = await inspectRepository(repoB);
      const projA = catalog.add(inspA);
      const projB = catalog.add(inspB);

      const scopeA = catalog.identity.resolve(
        projA.id,
        { available: true, inspection: inspA },
        false,
      ).scope;
      const scopeB = catalog.identity.resolve(
        projB.id,
        { available: true, inspection: inspB },
        false,
      ).scope;

      let generation = 1;
      let releaseDelay: (() => void) | null = null;
      let hookArmed = false;

      const service = createResumeService({
        withCatalog: (op) => op(catalog),
        inspect: inspectRepository,
        captureLive: captureContext,
        contextOptions: (id) => ({
          protectedRoots: [
            env.dataDir,
            id === projA.id ? projB.root : projA.root,
          ],
          exclusions: [],
        }),
        getSelectionGeneration: () => generation,
        beforePublishHook: async () => {
          if (!hookArmed) return;
          hookArmed = false;
          await new Promise<void>((resolve) => {
            releaseDelay = resolve;
          });
        },
      });

      // 1. A -> B race: start A, stall before publish, switch to B, complete B, release A.
      catalog.select(projA.id);
      generation++;
      hookArmed = true;
      const pendingA1 = service.resume(scopeA, "race-a-1");
      while (!releaseDelay) {
        await new Promise((r) => setTimeout(r, 10));
      }

      catalog.select(projB.id);
      generation++;
      const summaryB = await service.resume(scopeB, "race-b-1");
      assert.equal(summaryB.scope.projectId, scopeB.projectId);
      assert.equal(summaryB.correlationId, "race-b-1");

      (releaseDelay as () => void)();
      releaseDelay = null;
      await assert.rejects(pendingA1, { code: "resume_stale" });

      // 2. A -> B -> A race: returning to A invalidates delayed B and keeps latest A.
      catalog.select(projB.id);
      generation++;
      hookArmed = true;
      const pendingB = service.resume(scopeB, "race-b-2");
      while (!releaseDelay) {
        await new Promise((r) => setTimeout(r, 10));
      }

      catalog.select(projA.id);
      generation++;
      const summaryA2 = await service.resume(scopeA, "race-a-2");
      assert.equal(summaryA2.scope.projectId, scopeA.projectId);
      assert.equal(summaryA2.correlationId, "race-a-2");

      (releaseDelay as () => void)();
      releaseDelay = null;
      await assert.rejects(pendingB, { code: "resume_stale" });

      // 3. In-flight purge invalidates A before publish so purged decision never leaks.
      const dec = catalog.decisions.record({
        ...scopeA,
        requestId: "inflight-purge-dec",
        assertionId: null,
        expectedRevision: 0,
        content: "Decisão que será expurgada antes de publicar.",
        author: "Operador",
        reason: "Teste corrida expurgo",
        humanConfirmed: true,
        evidence: null,
      });
      hookArmed = true;
      const pendingPurgeA = service.resume(scopeA, "race-purge-a");
      while (!releaseDelay) {
        await new Promise((r) => setTimeout(r, 10));
      }
      catalog.decisions.purge({
        ...scopeA,
        assertionId: dec.assertionId,
        expectedRevision: 1,
        confirmedScope: true,
        reason: "Expurgo em voo",
      });
      (releaseDelay as () => void)();
      releaseDelay = null;
      await assert.rejects(pendingPurgeA, { code: "resume_stale" });

      // 4. In-flight relocate (binding root change) invalidates stalled resume.
      const movedA = join(env.root, "Resume Race A Moved");
      hookArmed = true;
      const pendingRelocateA = service.resume(scopeA, "race-relocate-a");
      while (!releaseDelay) {
        await new Promise((r) => setTimeout(r, 10));
      }
      await rename(repoA, movedA);
      const movedInsp = await inspectRepository(movedA);
      catalog.record(catalog.lookup(projA.id), movedInsp);
      (releaseDelay as () => void)();
      await assert.rejects(pendingRelocateA, { code: "resume_stale" });
      await rename(movedA, repoA);
      catalog.record(catalog.lookup(projA.id), await inspectRepository(repoA));

      // Confirm latest resume of A now succeeds cleanly with empty memory (post-purge).
      const cleanA = await service.resume(scopeA, "race-a-final");
      assert.equal(cleanA.memory.state, "empty");
      assert.equal(cleanA.observation.state, "fresh");

      // 5. git_missing degradation: verification degrades to unavailable (matching project.identity),
      // cached observation preserves original observedAt, and nextAction avoids misleading relocate.
      const gitMissingService = createResumeService({
        withCatalog: (op) => op(catalog),
        inspect: async () => {
          throw new GitError("git_missing");
        },
        captureLive: captureContext,
        contextOptions: () => ({
          protectedRoots: [env.dataDir],
          exclusions: [],
        }),
        getSelectionGeneration: () => generation,
      });
      const missingGitSummary = await gitMissingService.resume(
        scopeA,
        "git-missing-1",
      );
      assert.equal(missingGitSummary.verification, "unavailable");
      assert.equal(missingGitSummary.observation.state, "cached");
      assert.equal(missingGitSummary.observation.gap, "git_missing");
      assert.equal(
        missingGitSummary.observation.observation.observedAt,
        cleanA.observation.observation.observedAt,
      );
      assert.ok(
        missingGitSummary.memory.conflicts.some(
          (c) => c.kind === "git_unavailable" && c.blocking,
        ),
      );
      assert.equal(missingGitSummary.nextAction.kind, "resolve_conflict");
    } finally {
      catalog.close();
    }
  },
);

test(
  "F1-T09.A1: valida project.resume e decision.comparePresent via IPC sem alterar Git, com cache datado, pasta ausente, HEAD nulo e memória vazia",
  { timeout: 60_000 },
  async (t) => {
    const built = await buildF1LegacyFixture(t);
    const { env, projectA, projectB, copy, sourceRef } = built;

    const service = env.start(copy.copyDataDir, "completed");
    const idA = await service.request("project.identity", {
      projectId: projectA.id,
    });
    const idB = await service.request("project.identity", {
      projectId: projectB.id,
    });

    // Selecting B then requesting project.resume(scopeA) must fail with resume_stale.
    await service.request("project.select", { projectId: projectB.id });
    await assert.rejects(
      service.request("project.resume", {
        ...idA.scope,
        correlationId: "stale-after-select-b",
      }),
      { message: "resume_stale" },
    );

    // Inconsistent trio rejects with project_unavailable.
    await assert.rejects(
      service.request("project.resume", {
        projectId: idA.scope.projectId,
        bindingId: idB.scope.bindingId,
        worktreeId: idA.scope.worktreeId,
      }),
      { message: "project_unavailable" },
    );

    // Record a human decision with verified evidence in A, select A, and inspect Git before/after.
    await service.request("project.select", { projectId: projectA.id });
    const recorded = await service.request("decision.record", {
      ...idA.scope,
      requestId: "ipc-resume-dec-1",
      assertionId: null,
      expectedRevision: 0,
      content: "Decisão verificada para retomada IPC.",
      author: "Operador A",
      reason: "Teste F1-T09",
      humanConfirmed: true,
      promoteCanonical: true,
      evidence: sourceRef,
    });

    const gitBefore = await readGitInvariantSnapshot(projectA.root);
    const resumedA = await service.request("project.resume", {
      ...idA.scope,
      correlationId: "ipc-resume-1",
    });
    const gitAfter = await readGitInvariantSnapshot(projectA.root);
    assert.deepEqual(gitAfter, gitBefore);

    assert.equal(resumedA.verification, "verified");
    assert.equal(resumedA.correlationId, "ipc-resume-1");
    assert.equal(resumedA.observation.state, "fresh");
    assert.equal(resumedA.memory.state, "available");
    assert.equal(resumedA.memory.decision.assertionId, recorded.assertionId);
    assert.equal(resumedA.memory.decision.evidence.state, "verified");
    assert.equal(
      resumedA.memory.decision.evidence.sourceOrigin,
      "context_search",
    );
    assert.equal(resumedA.activity.lastCapture?.contextId, sourceRef.contextId);
    assert.equal(resumedA.activity.lastExecution?.mode, "mock_development");
    assert.equal(resumedA.activity.lastExecution?.isLegacyAttemptNote, true);
    assert.equal(resumedA.nextAction.advisory, true);

    // Compare present against unchanged file -> matches.
    const compareMatch = await service.request("decision.comparePresent", {
      ...idA.scope,
      ...sourceRef,
    });
    assert.equal(compareMatch.comparison, "matches");
    assert.equal(compareMatch.present.state, "available");
    assert.equal(compareMatch.present.text, PRESERVED_SOURCE_CONTENT);
    assert.deepEqual(await readGitInvariantSnapshot(projectA.root), gitBefore);

    // Edit live file -> comparePresent shows "differs" while keeping historical excerpt intact.
    await writeFile(
      join(projectA.root, sourceRef.path),
      "// Conteúdo alterado no working tree.\n",
    );
    const compareDiff = await service.request("decision.comparePresent", {
      ...idA.scope,
      ...sourceRef,
    });
    assert.equal(compareDiff.comparison, "differs");
    assert.equal(
      compareDiff.historical.excerpt?.text,
      PRESERVED_SOURCE_CONTENT,
    );
    assert.equal(
      compareDiff.present.text,
      "// Conteúdo alterado no working tree.\n",
    );

    // Gap historical must block disk access and report blocked_by_gap.
    const blockedGap = await service.request("decision.comparePresent", {
      ...idA.scope,
      ...sourceRef,
      sha256: "0".repeat(64),
    });
    assert.equal(blockedGap.historical.evidence.state, "gap");
    assert.equal(blockedGap.present.state, "blocked_by_gap");
    assert.equal(blockedGap.comparison, "unavailable");

    // Missing folder on A falls back to dated cache while preserving original observedAt.
    const originalObservedAt =
      resumedA.observation.state === "fresh"
        ? resumedA.observation.observation.observedAt
        : "";
    const missingPathA = join(env.root, "Projeto-A-Sumido");
    await rename(projectA.root, missingPathA);

    const cachedA = await service.request("project.resume", {
      ...idA.scope,
      correlationId: "ipc-resume-cached",
    });
    assert.equal(cachedA.observation.state, "cached");
    assert.equal(cachedA.observation.gap, "folder_unavailable");
    assert.equal(
      cachedA.observation.observation.observedAt,
      originalObservedAt,
    );
    assert.equal(cachedA.memory.state, "available");
    assert.equal(cachedA.memory.decision.evidence.state, "verified");
    assert.equal(cachedA.nextAction.kind, "relocate_project");

    const compareMissing = await service.request("decision.comparePresent", {
      ...idA.scope,
      ...sourceRef,
    });
    assert.equal(compareMissing.historical.evidence.state, "verified");
    assert.equal(compareMissing.present.state, "unavailable");
    assert.equal(compareMissing.comparison, "unavailable");

    await rename(missingPathA, projectA.root);

    // Empty memory + HEAD: null in a brand new repository with no commits.
    const nullHeadRepo = await env.repository("Projeto HEAD Nulo");
    git(nullHeadRepo, "config", "core.autocrlf", "false");
    await mkdir(join(nullHeadRepo, "src"), { recursive: true });
    await writeFile(join(nullHeadRepo, "src", "draft.ts"), "export {};\n");
    const nullHeadProj = await service.request("workspace.addLocal", {
      path: nullHeadRepo,
    });
    const idNullHead = await service.request("project.identity", {
      projectId: nullHeadProj.id,
    });
    const resumedNullHead = await service.request("project.resume", {
      ...idNullHead.scope,
    });
    assert.equal(resumedNullHead.observation.state, "fresh");
    assert.equal(resumedNullHead.observation.observation.head, null);
    assert.equal(resumedNullHead.memory.state, "empty");
    assert.equal(resumedNullHead.nextAction.kind, "record_decision");

    // D04 migrated without prior inspection and missing folder -> observation "unavailable" (observation: null).
    await service.close();
    const d04Repo = await env.repository("D04 Ausente");
    const d04Id = "f".repeat(64);
    const d04DataDir = join(env.root, "d04-unavailable");
    const d04Db = join(d04DataDir, "catalog.sqlite3");
    await seedD04Catalog(d04DataDir, d04Db, {
      id: d04Id,
      root: d04Repo,
      name: "D04 Ausente",
    });
    await rename(d04Repo, join(env.root, "D04 Movido Fora"));
    const d04Service = env.start(d04DataDir);
    const idD04 = await d04Service.request("project.identity", {
      projectId: d04Id,
    });
    const resumedD04 = await d04Service.request("project.resume", {
      ...idD04.scope,
    });
    assert.equal(resumedD04.observation.state, "unavailable");
    assert.equal(resumedD04.observation.observation, null);
    assert.equal(resumedD04.observation.gap, "folder_unavailable");
    assert.equal(resumedD04.memory.state, "empty");
    await d04Service.close();
  },
);

test(
  "F1 review: multi-chunk comparePresent sem falso diff, branch alterada entre observações e isolamento entre worktrees vinculadas",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repo = await env.repository("Projeto MultiChunk e Worktree");
    git(repo, "config", "core.autocrlf", "false");
    await mkdir(join(repo, "src"), { recursive: true });

    // > 24 lines (> 1 KiB) file so chunk 0 is strictly a subset of the full file.
    const lines = Array.from(
      { length: 40 },
      (_, idx) =>
        `export const linha_${String(idx + 1).padStart(2, "0")} = "conteúdo-verificável-${idx + 1}";`,
    );
    const largePath = "src/grande.ts";
    await writeFile(join(repo, largePath), lines.join("\n") + "\n");
    git(repo, "add", "--", largePath);
    git(repo, "commit", "-qm", "commit inicial grande");
    const initialHead = git(repo, "rev-parse", "HEAD");

    const service = env.start();
    const added = await service.request("workspace.addLocal", { path: repo });
    const idMain = await service.request("project.identity", {
      projectId: added.id,
    });
    const capture = await service.request("context.capture", {
      projectId: added.id,
      paths: [largePath],
    });
    const included = capture.entries[0];
    assert.ok(included?.outcome === "included");
    const ref = {
      contextId: capture.contextId,
      path: included.path,
      sha256: included.sha256,
      chunk: 0,
    };

    // 1. Multi-chunk unchanged file: comparison === "matches" and present.text matches historical excerpt (no false diff).
    const compareUnchanged = await service.request("decision.comparePresent", {
      ...idMain.scope,
      ...ref,
    });
    assert.equal(compareUnchanged.comparison, "matches");
    assert.equal(compareUnchanged.present.state, "available");
    assert.ok(compareUnchanged.historical.excerpt);
    assert.notEqual(
      compareUnchanged.historical.excerpt.sha256,
      included.sha256,
    );
    assert.equal(
      compareUnchanged.present.text,
      compareUnchanged.historical.excerpt.text,
    );

    // 2. Edit outside chunk 0 (line 35): comparison === "differs" (file hash differs) while chunk 0 text matches.
    const editedTail = [...lines];
    editedTail[34] = 'export const linha_35 = "alterada-no-final";';
    await writeFile(join(repo, largePath), editedTail.join("\n") + "\n");
    const compareTailEdit = await service.request("decision.comparePresent", {
      ...idMain.scope,
      ...ref,
    });
    assert.equal(compareTailEdit.comparison, "differs");
    assert.equal(
      compareTailEdit.present.text,
      compareTailEdit.historical.excerpt?.text,
    );

    // 3. Edit inside chunk 0 (line 2): comparison === "differs" and present.text reflects line 2 change while historical stays immutable.
    const editedHead = [...editedTail];
    editedHead[1] = 'export const linha_02 = "alterada-no-inicio";';
    await writeFile(join(repo, largePath), editedHead.join("\n") + "\n");
    const compareHeadEdit = await service.request("decision.comparePresent", {
      ...idMain.scope,
      ...ref,
    });
    assert.equal(compareHeadEdit.comparison, "differs");
    assert.ok(compareHeadEdit.present.text?.includes("alterada-no-inicio"));
    assert.ok(
      !compareHeadEdit.historical.excerpt?.text.includes("alterada-no-inicio"),
    );

    // Record a decision on main worktree.
    const mainDecision = await service.request("decision.record", {
      ...idMain.scope,
      requestId: "wt-main-dec",
      assertionId: null,
      expectedRevision: 0,
      content: "Decisão exclusiva da worktree principal.",
      author: "Autor Principal",
      reason: "Teste de isolamento de worktree",
      humanConfirmed: true,
      evidence: ref,
    });

    // 4. Switch branch and commit between observations: resume updates branch/HEAD while historical capture keeps original HEAD.
    git(repo, "checkout", "--quiet", "-b", "feat/nova-branch");
    git(repo, "add", "--", largePath);
    git(repo, "commit", "-qm", "alteração na nova branch");
    const newHead = git(repo, "rev-parse", "HEAD");
    assert.notEqual(newHead, initialHead);

    const gitBefore = await readGitInvariantSnapshot(repo);
    const resumedNewBranch = await service.request(
      "project.resume",
      idMain.scope,
    );
    assert.deepEqual(await readGitInvariantSnapshot(repo), gitBefore);
    assert.equal(resumedNewBranch.observation.state, "fresh");
    assert.equal(
      resumedNewBranch.observation.observation.branch,
      "feat/nova-branch",
    );
    assert.equal(resumedNewBranch.observation.observation.head, newHead);
    assert.equal(resumedNewBranch.activity.lastCapture?.head, initialHead);
    assert.equal(resumedNewBranch.memory.state, "available");
    assert.equal(
      resumedNewBranch.memory.decision.assertionId,
      mainDecision.assertionId,
    );

    // 5. Linked worktree shares projectId + bindingId, but has distinct worktreeId and isolated decisions/resume.
    const linkedPath = join(env.root, "Worktree Isolada");
    git(
      repo,
      "worktree",
      "add",
      "--quiet",
      "-b",
      "feat/wt-isolada",
      linkedPath,
    );
    const addedLinked = await service.request("workspace.addLocal", {
      path: linkedPath,
    });
    const idLinked = await service.request("project.identity", {
      projectId: addedLinked.id,
    });
    assert.equal(idLinked.scope.projectId, idMain.scope.projectId);
    assert.equal(idLinked.scope.bindingId, idMain.scope.bindingId);
    assert.notEqual(idLinked.scope.worktreeId, idMain.scope.worktreeId);

    const resumedLinked = await service.request(
      "project.resume",
      idLinked.scope,
    );
    assert.equal(resumedLinked.memory.state, "empty");
    assert.equal(resumedLinked.observation.state, "fresh");
    assert.equal(
      resumedLinked.observation.observation.branch,
      "feat/wt-isolada",
    );
    await assert.rejects(
      service.request("decision.get", {
        ...idLinked.scope,
        assertionId: mainDecision.assertionId,
      }),
      { message: "decision_unavailable" },
    );

    await service.close();
  },
);
