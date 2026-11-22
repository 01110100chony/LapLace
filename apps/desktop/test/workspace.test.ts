import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  GitObservation,
  ProjectIdentityResult,
  ProjectRecord,
  ResumeSummary,
} from "@laplace/contracts";
import {
  createLatestRequest,
  createProjectLoader,
  createResumeLoader,
} from "../src/workspace.ts";

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("uma troca rápida só apresenta o projeto selecionado mais recentemente", async () => {
  const latest = createLatestRequest();
  const first = pending<string>();
  const second = pending<string>();
  const shown: string[] = [];
  const show = (name: string) => shown.push(name);
  const fail = () => assert.fail("falha inesperada");
  const a = latest.run(() => first.promise, show, fail);
  const b = latest.run(() => second.promise, show, fail);
  second.resolve("Projeto B");
  await b;
  first.resolve("Projeto A");
  await a;
  assert.deepEqual(shown, ["Projeto B"]);
});

test("voltar à Home invalida erros e respostas da visão anterior", async () => {
  const latest = createLatestRequest();
  const previous = pending<string>();
  const unexpected = () => assert.fail("projeto já descartado");
  const request = latest.run(() => previous.promise, unexpected, unexpected);
  latest.invalidate();
  previous.reject(new Error("atrasado"));
  await request;
});

test("cache, Git e seleção persistida continuam associados ao projeto certo em uma alternância rápida", async () => {
  const observation: GitObservation = {
    source: "git.status",
    summaryVersion: 1,
    observedAt: "2026-01-01T12:00:00.000Z",
    branch: "main",
    head: null,
    changes: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
  };
  const a: ProjectRecord = { id: "a", name: "Alpha", root: "/alpha" };
  const b: ProjectRecord = { id: "b", name: "Beta", root: "/beta" };
  const projects = new Map([
    [a.id, a],
    [b.id, b],
  ]);
  const firstRead = pending<typeof observation>();
  const firstStarted = pending<void>();
  const selected: string[] = [];
  const visible: string[] = [];
  const loader = createProjectLoader({
    select: async (id) => {
      selected.push(id);
      return { ...projects.get(id)!, cached: observation };
    },
    inspect: async (id) => {
      if (id === a.id) firstStarted.resolve();
      return {
        ...projects.get(id)!,
        ...(id === a.id
          ? await firstRead.promise
          : { ...observation, branch: "beta-atual" }),
      };
    },
  });
  function open(id: string) {
    return loader.open(
      id,
      (value) => visible.push(`${value.id}:cache`),
      (value) => visible.push(`${value.id}:${value.branch}`),
      () => assert.fail("falha inesperada"),
    );
  }

  const first = open(a.id);
  await firstStarted.promise;
  await open(b.id);
  firstRead.resolve({ ...observation, branch: "alpha-atrasado" });
  await first;
  assert.deepEqual(visible, ["a:cache", "b:cache", "b:beta-atual"]);
  assert.deepEqual(selected, [a.id, b.id]);
});

test("F1-T10.A1: createResumeLoader descarta respostas atrasadas em A->B, A->B->A e retorno à Home", async () => {
  const observation: GitObservation = {
    source: "git.status",
    summaryVersion: 1,
    observedAt: "2026-11-22T05:00:00.000Z",
    branch: "main",
    head: null,
    changes: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
  };
  const makeScope = (ch: string) => ({
    projectId: ch.repeat(64),
    bindingId: ch.repeat(64),
    worktreeId: ch.repeat(64),
  });
  const legA = "1".repeat(64);
  const legB = "2".repeat(64);
  const scopeA = makeScope("a");
  const scopeB = makeScope("b");

  const delayedResumeA = pending<ResumeSummary>();
  const startedResumeA = pending<void>();
  const delayedResumeB = pending<ResumeSummary>();
  const startedResumeB = pending<void>();
  let delayNextB = false;

  const summary = (
    scope: typeof scopeA,
    name: string,
    correlationId?: string,
  ): ResumeSummary => ({
    scope,
    projectName: name,
    root: `C:\\${name}`,
    verification: "verified",
    computedAt: "2026-11-22T06:00:00.000Z",
    correlationId,
    observation: {
      state: "fresh",
      observation,
      attemptedAt: "2026-11-22T06:00:00.000Z",
      gap: null,
    },
    memory: { state: "empty", decision: null, conflicts: [] },
    activity: { lastCapture: null, lastExecution: null },
    nextAction: {
      advisory: true,
      kind: "record_decision",
      label: "Registrar decisão",
      rationale: "Memória vazia",
      blockedByConflict: false,
    },
  });

  const shown: string[] = [];
  let delayNextA = true;
  const loader = createResumeLoader({
    select: async (id) => ({
      id,
      name: id === legA ? "Projeto A" : "Projeto B",
      root: id === legA ? "C:\\A" : "C:\\B",
      cached: observation,
    }),
    identity: async (id): Promise<ProjectIdentityResult> => ({
      scope: id === legA ? scopeA : scopeB,
      legacyProjectId: id,
      root: id === legA ? "C:\\A" : "C:\\B",
      verification: "verified",
      requiresConfirmation: false,
      worktrees: [],
      candidates: [],
    }),
    resume: async (scope, correlationId) => {
      if (scope.projectId === scopeA.projectId && delayNextA) {
        delayNextA = false;
        startedResumeA.resolve();
        return delayedResumeA.promise;
      }
      if (scope.projectId === scopeB.projectId && delayNextB) {
        delayNextB = false;
        startedResumeB.resolve();
        return delayedResumeB.promise;
      }
      return summary(
        scope,
        scope.projectId === scopeA.projectId ? "Projeto A" : "Projeto B",
        correlationId,
      );
    },
  });

  const pendingA = loader.open(
    legA,
    (s) => shown.push(`selected:${s.name}`),
    (i) => shown.push(`identity:${i.scope.projectId[0]}`),
    (r) => shown.push(`resume:${r.projectName}`),
    () => assert.fail("erro inesperado A"),
  );
  await startedResumeA.promise;

  // Switch A -> B: only B should complete with a resume payload.
  await loader.open(
    legB,
    (s) => shown.push(`selected:${s.name}`),
    (i) => shown.push(`identity:${i.scope.projectId[0]}`),
    (r) => shown.push(`resume:${r.projectName}`),
    () => assert.fail("erro inesperado B"),
  );
  delayedResumeA.resolve(summary(scopeA, "Projeto A", "resume-1"));
  await pendingA;

  assert.deepEqual(shown, [
    "selected:Projeto A",
    "identity:a",
    "selected:Projeto B",
    "identity:b",
    "resume:Projeto B",
  ]);

  // Switch A -> B -> A: returning to A while delayed B resolves late discards B.
  shown.length = 0;
  delayNextB = true;
  const pendingB = loader.open(
    legB,
    (s) => shown.push(`selected:${s.name}`),
    (i) => shown.push(`identity:${i.scope.projectId[0]}`),
    (r) => shown.push(`resume:${r.projectName}`),
    () => assert.fail("erro inesperado B2"),
  );
  await startedResumeB.promise;

  await loader.open(
    legA,
    (s) => shown.push(`selected:${s.name}`),
    (i) => shown.push(`identity:${i.scope.projectId[0]}`),
    (r) => shown.push(`resume:${r.projectName}`),
    () => assert.fail("erro inesperado A2"),
  );
  delayedResumeB.resolve(summary(scopeB, "Projeto B", "resume-3"));
  await pendingB;

  assert.deepEqual(shown, [
    "selected:Projeto B",
    "identity:b",
    "selected:Projeto A",
    "identity:a",
    "resume:Projeto A",
  ]);

  // Navigating to Home invalidates pending open without calling callbacks or errors.
  shown.length = 0;
  const homeCancel = loader.open(
    legB,
    () => assert.fail("deveria descartar seleção após Home"),
    () => assert.fail("deveria descartar identidade após Home"),
    () => assert.fail("deveria descartar retomada após Home"),
    () => assert.fail("deveria descartar erro após Home"),
  );
  loader.invalidate();
  await homeCancel;
  assert.deepEqual(shown, []);
});
