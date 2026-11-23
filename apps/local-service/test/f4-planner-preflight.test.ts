import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  fixture,
  git,
  readGitInvariantSnapshot,
} from "./fixtures/ipc-harness.ts";

test(
  "F4-M01.A1: explore, planCreate e Pre-Flight observam Git passivamente e invalidam sob drift",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repo = await env.repository("planner-preflight-repo");
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "README.md"), "# Repo F4\n", "utf8");
    await writeFile(join(repo, "src", "a.txt"), "versao-1\n", "utf8");
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "Commit inicial");

    const client = env.start();
    const added = await client.request("workspace.addLocal", { path: repo });
    const identity = await client.request("project.identity", {
      projectId: added.id,
    });
    const scope = identity.scope;

    const snapshotBefore = await readGitInvariantSnapshot(repo);

    const explore = await client.request("planner.explore", {
      ...scope,
      watchedPaths: ["src/a.txt"],
    });
    assert.equal(explore.base.branch, "main");
    assert.ok(explore.base.head);
    assert.deepEqual(explore.dirtyPaths, []);
    assert.equal(explore.dedicatedWorktreeCount, 0);

    const plan = await client.request("planner.planCreate", {
      ...scope,
      requestId: "req-f4-m01-plan-1",
      title: "Editar src/a.txt isoladamente",
      objective: "Atualizar src/a.txt sem alterar checkout de origem",
      operationKind: "worktree_edit",
      backendMode: "mock_supervised",
      targetPaths: ["src/a.txt"],
      proposedEdits: [
        { path: "src/a.txt", action: "modify", content: "versao-2\n" },
      ],
    });
    assert.equal(plan.mutatesOrigin, false);
    assert.equal(plan.status, "ready");
    assert.equal(plan.preflightStatus, "valid");
    assert.ok(plan.predictedEffects.every((e) => e.mutatesOrigin === false));

    const validPreflight = await client.request("planner.planPreflight", {
      ...scope,
      planId: plan.planId,
    });
    assert.equal(validPreflight.status, "valid");
    assert.equal(validPreflight.driftDetected, false);
    assert.equal(validPreflight.executionAllowed, true);

    assert.deepEqual(await readGitInvariantSnapshot(repo), snapshotBefore);

    // 1. Drift na worktree de origem invalida o Pre-Flight e bloqueia grant.
    await writeFile(join(repo, "src", "a.txt"), "edicao-externa\n", "utf8");
    const dirtyDrift = await client.request("planner.planPreflight", {
      ...scope,
      planId: plan.planId,
    });
    assert.equal(dirtyDrift.status, "invalidated_by_drift");
    assert.equal(dirtyDrift.driftDetected, true);
    assert.ok(dirtyDrift.driftReasons.includes("worktree_dirty_changed"));
    assert.equal(dirtyDrift.executionAllowed, false);

    await assert.rejects(
      client.request("planner.grantIssue", {
        ...scope,
        planId: plan.planId,
        expectedBaseDigest: plan.baseDigest,
        backendMode: "mock_supervised",
        allowedEffects: ["create_worktree", "write_worktree"],
        humanConfirmed: true,
      }),
      /planner_drift_detected/,
    );

    // 2. Staging no indice altera indexStamp e 3. novo commit altera HEAD.
    const cleanPlan = await client.request("planner.planCreate", {
      ...scope,
      requestId: "req-f4-m01-plan-2",
      title: "Plano apos sujar arquivo",
      objective: "Detectar index_changed e head_changed",
      operationKind: "worktree_edit",
      backendMode: "mock_supervised",
      targetPaths: ["src/a.txt"],
    });
    git(repo, "add", "src/a.txt");
    const indexDrift = await client.request("planner.planPreflight", {
      ...scope,
      planId: cleanPlan.planId,
    });
    assert.equal(indexDrift.status, "invalidated_by_drift");
    assert.ok(indexDrift.driftReasons.includes("index_changed"));

    git(repo, "commit", "--quiet", "-m", "Commit externo");
    const headDrift = await client.request("planner.planPreflight", {
      ...scope,
      planId: cleanPlan.planId,
    });
    assert.equal(headDrift.status, "invalidated_by_drift");
    assert.ok(headDrift.driftReasons.includes("head_changed"));
    assert.equal(headDrift.executionAllowed, false);

    await client.close();
  },
);
