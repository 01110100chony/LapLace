import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { openCatalog } from "../src/catalog.ts";
import { createProactivityService } from "../src/proactivity-service.ts";
import {
  fixture,
  git,
  readGitInvariantSnapshot,
} from "./fixtures/ipc-harness.ts";

test(
  "F5-M04.A1 / A2: Proatividade avalia sinais reais F3/F4 sem mutacao, aplica snooze/dismiss/restore reversivel, e agenda respeita opt-in, janela UTC, idempotencia e recuperacao apos crash",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repo = await env.repository("Proactivity-F5");
    git(repo, "config", "core.autocrlf", "false");
    await writeFile(join(repo, "README.md"), "# Proatividade F5\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "base proatividade");

    const client = env.start(env.dataDir);
    const project = await client.request("workspace.addLocal", { path: repo });
    const scope = (
      await client.request("project.identity", { projectId: project.id })
    ).scope;

    // 1. Semeia sinais reais F3 (proposta pendente) + F4 (diff aguardando revisao).
    const inbox = await client.request("memory.inboxSubmit", {
      ...scope,
      title: "Validar migracao v16 pendente",
      content: "Proposta aguardando triagem humana",
      targetKind: "claim",
      originLabel: "sessao-f5",
    });

    const plan = await client.request("planner.planCreate", {
      ...scope,
      requestId: "proact-plan-1",
      title: "Edicao para sinal F4",
      objective: "Gerar diff aguardando revisao",
      operationKind: "worktree_edit",
      backendMode: "mock_supervised",
      targetPaths: ["note.txt"],
      proposedEdits: [
        { path: "note.txt", action: "create", content: "nota\n" },
      ],
    });
    const grant = await client.request("planner.grantIssue", {
      ...scope,
      planId: plan.planId,
      expectedBaseDigest: plan.baseDigest,
      backendMode: "mock_supervised",
      allowedEffects: ["create_worktree", "write_worktree"],
      humanConfirmed: true,
    });
    const exec = await client.request("planner.executionStart", {
      ...scope,
      requestId: "proact-exec-1",
      planId: plan.planId,
      grantId: grant.grantId,
      expectedBaseDigest: plan.baseDigest,
      mockBehavior: "complete",
    });
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const ev = await client.request("planner.executionEvents", {
        ...scope,
        executionId: exec.executionId,
        afterSeq: 0,
      });
      if (ev.execution.state === "completed") break;
    }

    const gitBefore = await readGitInvariantSnapshot(repo);

    // 2. proactivity.evaluate opera de forma passiva e prioriza sugestoes com sourceRefs.
    const evaluated = await client.request("proactivity.evaluate", scope);
    assert.equal(evaluated.mutatedOrigin, false);
    assert.ok(evaluated.suggestions.length >= 2);
    const inboxSuggestion = evaluated.suggestions.find(
      (s) =>
        s.signalKind === "inbox_pending_critical" &&
        s.sourceRefs.some((r) => r.id === inbox.proposalId),
    );
    const diffSuggestion = evaluated.suggestions.find(
      (s) =>
        s.signalKind === "diff_awaiting_review" &&
        s.sourceRefs.some((r) => r.id === exec.executionId),
    );
    assert.ok(inboxSuggestion && diffSuggestion);
    assert.equal(inboxSuggestion.autoExecutable, false);
    assert.deepEqual(await readGitInvariantSnapshot(repo), gitBefore);

    // 3. Respostas reversiveis + telemetria local, sem auto-execucao.
    const snoozed = await client.request("proactivity.suggestionRespond", {
      ...scope,
      suggestionId: inboxSuggestion.suggestionId,
      action: "snooze",
      snoozeUntil: "2026-12-01T12:00:00.000Z",
    });
    assert.equal(snoozed.suggestion.status, "snoozed");
    assert.equal(snoozed.autoExecuted, false);

    const restoredFromSnooze = await client.request(
      "proactivity.suggestionRespond",
      {
        ...scope,
        suggestionId: inboxSuggestion.suggestionId,
        action: "restore",
      },
    );
    assert.equal(restoredFromSnooze.suggestion.status, "active");

    const dismissed = await client.request("proactivity.suggestionRespond", {
      ...scope,
      suggestionId: inboxSuggestion.suggestionId,
      action: "dismiss",
      reason: "Ja verificado manualmente",
    });
    assert.equal(dismissed.suggestion.status, "dismissed");

    const restoredFromDismiss = await client.request(
      "proactivity.suggestionRespond",
      {
        ...scope,
        suggestionId: inboxSuggestion.suggestionId,
        action: "restore",
      },
    );
    assert.equal(restoredFromDismiss.suggestion.status, "active");

    const accepted = await client.request("proactivity.suggestionRespond", {
      ...scope,
      suggestionId: diffSuggestion.suggestionId,
      action: "accept_proposal",
    });
    assert.equal(accepted.suggestion.status, "accepted");
    assert.equal(accepted.autoExecuted, false);
    assert.ok(accepted.telemetry.acceptedCount >= 1);
    assert.ok(accepted.telemetry.estimatedSavedSeconds > 0);

    // 4. F5-M04.A2: Opt-in, fronteira app fechado e janela UTC estrita.
    await assert.rejects(
      client.request("proactivity.scheduleUpsert", {
        ...scope,
        label: "Sem opt-in",
        optInConfirmed: false,
        windowStartUtc: "09:00",
        windowEndUtc: "18:00",
        allowedDaysUtc: [2],
        minIntervalMinutes: 30,
      }),
      { message: "proactivity_opt_in_required" },
    );
    await assert.rejects(
      client.request("proactivity.scheduleUpsert", {
        ...scope,
        label: "Tentativa com app fechado",
        optInConfirmed: true,
        windowStartUtc: "09:00",
        windowEndUtc: "18:00",
        allowedDaysUtc: [2],
        minIntervalMinutes: 30,
        runWhenAppClosed: true,
      }),
      { message: "proactivity_opt_in_required" },
    );

    const schedule = await client.request("proactivity.scheduleUpsert", {
      ...scope,
      scheduleId: "sched-f5-1",
      label: "Janela matinal opt-in",
      optInConfirmed: true,
      windowStartUtc: "09:00",
      windowEndUtc: "18:00",
      allowedDaysUtc: [2], // 2026-11-24 e terca-feira (UTC day = 2)
      minIntervalMinutes: 30,
      appClosedMode: "disabled_deferred",
      runWhenAppClosed: false,
    });
    assert.equal(schedule.appClosedMode, "disabled_deferred");
    assert.equal(schedule.optInActive, true);

    // Fora da janela UTC (22:00Z > 18:00Z) e dia nao permitido -> bloqueado.
    await assert.rejects(
      client.request("proactivity.scheduleControl", {
        ...scope,
        scheduleId: schedule.scheduleId,
        action: "trigger_window",
        evaluatedAt: "2026-11-24T22:00:00.000Z",
      }),
      { message: "proactivity_opt_in_required" },
    );

    // Dentro da janela UTC (10:15Z) -> executa e registra run completed.
    const inWindowAt = "2026-11-24T10:15:00.000Z";
    const run1 = await client.request("proactivity.scheduleControl", {
      ...scope,
      scheduleId: schedule.scheduleId,
      action: "trigger_window",
      evaluatedAt: inWindowAt,
    });
    assert.ok("runId" in run1);
    assert.equal(run1.state, "completed");
    assert.equal(run1.duplicateSuppressed, false);

    // Disparo duplicado na mesma janela eh suprimido idempotentemente.
    const runDup = await client.request("proactivity.scheduleControl", {
      ...scope,
      scheduleId: schedule.scheduleId,
      action: "trigger_window",
      evaluatedAt: "2026-11-24T10:20:00.000Z",
    });
    assert.ok("runId" in runDup);
    assert.equal(runDup.runId, run1.runId);
    assert.equal(runDup.duplicateSuppressed, true);

    // Revogacao interrompe janelas futuras.
    const revoked = await client.request("proactivity.scheduleControl", {
      ...scope,
      scheduleId: schedule.scheduleId,
      action: "revoke",
      reason: "Revogado pelo usuario",
      humanConfirmed: true,
    });
    assert.ok("status" in revoked);
    assert.equal(revoked.status, "revoked");
    await assert.rejects(
      client.request("proactivity.scheduleControl", {
        ...scope,
        scheduleId: schedule.scheduleId,
        action: "trigger_window",
        evaluatedAt: "2026-11-24T11:30:00.000Z",
      }),
      { message: "proactivity_opt_in_required" },
    );

    await client.close();

    // 5. Recuperacao apos crash em janela ativa via openCatalog().
    const catalogCrash = openCatalog(env.dataDir);
    try {
      const proactCrash = createProactivityService({
        withCatalog: (op) => op(catalogCrash),
        simulateCrashBeforeFinish: true,
      });
      const sched2 = proactCrash.scheduleUpsert({
        ...scope,
        scheduleId: "sched-crash-2",
        label: "Janela crash test",
        optInConfirmed: true,
        windowStartUtc: "09:00",
        windowEndUtc: "18:00",
        allowedDaysUtc: [2],
        minIntervalMinutes: 30,
      });
      const stuck = proactCrash.scheduleControl({
        ...scope,
        scheduleId: sched2.scheduleId,
        action: "trigger_window",
        evaluatedAt: "2026-11-24T14:00:00.000Z",
      });
      assert.ok("runId" in stuck);
      assert.equal(stuck.state, "running");
    } finally {
      catalogCrash.close();
    }

    const catalogRecovered = openCatalog(env.dataDir);
    try {
      const proactRecovered = createProactivityService({
        withCatalog: (op) => op(catalogRecovered),
      });
      const list = proactRecovered.scheduleList(scope);
      assert.equal(list.appClosedSupported, false);
      const recoveredRun = list.runs.find(
        (r) => r.scheduleId === "sched-crash-2",
      );
      assert.ok(recoveredRun);
      assert.equal(recoveredRun.state, "interrupted_recovered");
      assert.equal(recoveredRun.recoveredAfterRestart, true);
    } finally {
      catalogRecovered.close();
    }
  },
);
