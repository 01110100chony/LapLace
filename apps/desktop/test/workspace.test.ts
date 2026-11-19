import assert from "node:assert/strict";
import { test } from "node:test";
import { createLatestRequest } from "../src/workspace.ts";

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
