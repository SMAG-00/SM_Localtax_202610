// ENV-04 버전 고정 — .nvmrc의 Node 버전이 Dockerfile·CI·engines와 같다 · pnpm 버전 고정 · 코드에 모델 ID 문자열 상수 0
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempRepo, runScript } from "./helpers.mjs";
import { checkPins } from "../check-pins.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-pins.mjs");
const base = {
  ".nvmrc": "24.7.0\n",
  "package.json": { name: "r", packageManager: "pnpm@9.15.9", engines: { node: ">=24.7.0 <25" } },
  "deploy/Dockerfile": "ARG NODE_VERSION=24.7.0\nFROM node:${NODE_VERSION}-alpine AS build\n",
  ".github/workflows/ci.yml": "jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v7.0.0\n        with:\n          node-version-file: .nvmrc\n",
  "apps/web/lib/model.ts": "export const model = process.env.ANTHROPIC_MODEL_ANSWER;\n",
  ".env.example": "ANTHROPIC_MODEL_ANSWER=   # [서버] 권고값 claude-sonnet-5-5\n",
};
const run = (over = {}) => checkPins({ root: tempRepo({ ...base, ...over }).dir });

test("모두 맞으면 오류 0 (.env.example 주석의 모델 ID는 허용)", () => {
  assert.deepEqual(run().errors, []);
});

test("Dockerfile의 Node 버전이 .nvmrc와 다르면 오류", () => {
  const r = run({ "deploy/Dockerfile": "ARG NODE_VERSION=22.11.0\nFROM node:${NODE_VERSION}-alpine\n" });
  assert.ok(r.errors.some((e) => /Dockerfile/.test(e) && /22\.11\.0/.test(e)), r.errors.join("\n"));
});

test("Dockerfile이 버전 변수 없이 다른 태그를 직접 쓰면 오류", () => {
  const r = run({ "deploy/Dockerfile": "FROM node:20-alpine\n" });
  assert.ok(r.errors.some((e) => /Dockerfile/.test(e)), r.errors.join("\n"));
});

test("CI가 .nvmrc 대신 다른 node-version을 직접 쓰면 오류", () => {
  const r = run({ ".github/workflows/ci.yml": "jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v7.0.0\n        with:\n          node-version: 22\n" });
  assert.ok(r.errors.some((e) => /ci\.yml/.test(e)), r.errors.join("\n"));
});

test("engines.node가 .nvmrc 버전을 허용하지 않으면 오류", () => {
  const r = run({ "package.json": { name: "r", packageManager: "pnpm@9.15.9", engines: { node: ">=26" } } });
  assert.ok(r.errors.some((e) => /engines/.test(e)), r.errors.join("\n"));
});

test("packageManager에 pnpm 정확한 버전이 없으면 오류", () => {
  const r = run({ "package.json": { name: "r", packageManager: "pnpm@9", engines: { node: ">=24.7.0 <25" } } });
  assert.ok(r.errors.some((e) => /packageManager/.test(e)), r.errors.join("\n"));
});

for (const id of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"]) {
  test(`코드에 모델 ID 문자열(${id})이 있으면 오류`, () => {
    const r = run({ "packages/assistant/src/model.ts": `export const m = "${id}";\n` });
    assert.ok(r.errors.some((e) => /packages\/assistant\/src\/model\.ts/.test(e)), r.errors.join("\n"));
  });
}

test("문서(docs)와 범위 목록·.env.example의 모델 ID는 허용", () => {
  const r = run({ "docs/x.md": "권고 claude-sonnet-5-5\n", "scripts/env-scopes.json": '{"$comment":"claude-haiku-5-5"}' });
  assert.deepEqual(r.errors, []);
});

test("저장소 전체 — 스크립트가 종료 코드 0", () => {
  const r = runScript(SCRIPT, [], { cwd: ROOT });
  assert.equal(r.code, 0, r.out);
});
