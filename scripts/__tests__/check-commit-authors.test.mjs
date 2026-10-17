// FND-01 — 커밋 작성자 이메일이 모두 새 플랫폼 계정이다 (SM 계정 0)
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempRepo, runScript } from "./helpers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-commit-authors.mjs");
const CONFIG = { authors: ["admin@sunmyung.kr"], committers: ["admin@sunmyung.kr", "noreply@github.com"] };

function repoWith(commits) {
  const repo = tempRepo({ "scripts/commit-authors.json": CONFIG });
  for (const c of commits) repo.commit(c.msg ?? "c", c);
  return repo;
}

test("모든 커밋이 허용된 작성자면 통과", () => {
  const repo = repoWith([{}, {}]);
  const r = runScript(SCRIPT, [repo.dir]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2개/);
});

test("다른 이메일로 작성한 커밋이 하나라도 있으면 실패하고 그 커밋을 알려 준다", () => {
  const repo = repoWith([{}, { authorEmail: "someone@example.com", msg: "다른 계정" }, {}]);
  const r = runScript(SCRIPT, [repo.dir]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /someone@example\.com/);
  assert.match(r.out, /다른 계정/);
});

test("GitHub 웹에서 병합한 커밋(커미터 noreply@github.com)은 허용", () => {
  const repo = repoWith([{}, { committerEmail: "noreply@github.com" }]);
  const r = runScript(SCRIPT, [repo.dir]);
  assert.equal(r.code, 0, r.out);
});

test("noreply@github.com이 작성자이면 실패 (작성자 허용 목록에는 없다)", () => {
  const repo = repoWith([{ authorEmail: "noreply@github.com" }]);
  const r = runScript(SCRIPT, [repo.dir]);
  assert.equal(r.code, 1, r.out);
});

test("이메일 대소문자가 달라도 같은 계정으로 본다", () => {
  const repo = repoWith([{ authorEmail: "Admin@Sunmyung.kr", committerEmail: "ADMIN@sunmyung.kr" }]);
  const r = runScript(SCRIPT, [repo.dir]);
  assert.equal(r.code, 0, r.out);
});

test("커밋이 없는 저장소는 통과 (0개)", () => {
  const repo = tempRepo({ "scripts/commit-authors.json": CONFIG });
  const r = runScript(SCRIPT, [repo.dir]);
  assert.equal(r.code, 0, r.out);
});

test("이 저장소 — 지금까지의 커밋 작성자가 모두 admin@sunmyung.kr", () => {
  const r = runScript(SCRIPT, [ROOT]);
  assert.equal(r.code, 0, r.out);
});
