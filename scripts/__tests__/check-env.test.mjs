// ENV-02 파일 규칙 · ENV-03 노출 차단(NEXT_PUBLIC_) · ENV-05 변수 범위 — 임시 저장소를 실제로 만들어 검사한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkEnv } from "../check-env.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-env.mjs");

const SCOPES = {
  vars: {
    NEXT_PUBLIC_SITE_URL: "public",
    SITE_INDEXING: "server",
    SUPABASE_SERVICE_ROLE_KEY: "server-secret",
    SUPABASE_DB_URL: "ci",
  },
  platform: ["NODE_ENV"],
};
const EXAMPLE = [
  "# 주석 줄",
  "NEXT_PUBLIC_SITE_URL=          # [공개] 서비스 주소",
  "SITE_INDEXING=                 # [서버] 권고값 off",
  "SUPABASE_SERVICE_ROLE_KEY=     # [서버 전용] 비밀",
  "SUPABASE_DB_URL=               # [CI 전용] 마이그레이션",
  "",
].join("\n");
const CODE = [
  "export const a = process.env.NEXT_PUBLIC_SITE_URL;",
  'export const b = process.env["SITE_INDEXING"];',
  "const { SUPABASE_SERVICE_ROLE_KEY } = process.env;",
  "export const c = process.env.NODE_ENV;",
  "export const d = process.env.SUPABASE_DB_URL;",
].join("\n");

/** 임시 저장소: { example, scopes, gitignore, code, extraTracked } 일부를 바꿔 만든다 */
function repo(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ltr-env-"));
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  w(".env.example", over.example ?? EXAMPLE);
  w("scripts/env-scopes.json", JSON.stringify(over.scopes ?? SCOPES));
  w(".gitignore", over.gitignore ?? ".env\n.env*.local\nnode_modules/\n");
  w("apps/web/lib/env.ts", over.code ?? CODE);
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  for (const [rel, text] of Object.entries(over.extraTracked ?? {})) {
    w(rel, text);
    git("add", "-f", rel);
  }
  return dir;
}

const run = (dir) => checkEnv({ root: dir });

test("규칙을 지킨 저장소는 오류 0", () => {
  const r = run(repo());
  assert.deepEqual(r.errors, []);
});

test("ENV-02 — .env.example에 값이 있으면 오류", () => {
  const r = run(repo({ example: EXAMPLE.replace("SITE_INDEXING=  ", "SITE_INDEXING=off") }));
  assert.ok(r.errors.some((e) => /SITE_INDEXING/.test(e) && /값/.test(e)), r.errors.join("\n"));
});

test("ENV-05 — 범위 주석이 없으면 오류", () => {
  const r = run(repo({ example: EXAMPLE.replace("# [서버] 권고값 off", "# 권고값 off") }));
  assert.ok(r.errors.some((e) => /SITE_INDEXING/.test(e) && /범위/.test(e)), r.errors.join("\n"));
});

test("ENV-05 — .env.example의 범위와 범위 목록 파일이 다르면 오류", () => {
  const r = run(repo({ example: EXAMPLE.replace("# [서버 전용] 비밀", "# [서버] 비밀") }));
  assert.ok(r.errors.some((e) => /SUPABASE_SERVICE_ROLE_KEY/.test(e)), r.errors.join("\n"));
});

test("ENV-05 — 범위 목록에만 있고 .env.example에 없는 변수는 오류", () => {
  const r = run(repo({ example: EXAMPLE.replace(/SUPABASE_DB_URL=.*\n/, "") }));
  assert.ok(r.errors.some((e) => /SUPABASE_DB_URL/.test(e)), r.errors.join("\n"));
});

test("ENV-03 — 서버 전용 이름에 NEXT_PUBLIC_이 붙으면 오류 (NEXT_PUBLIC_ANTHROPIC_API_KEY)", () => {
  const scopes = { ...SCOPES, vars: { ...SCOPES.vars, NEXT_PUBLIC_ANTHROPIC_API_KEY: "server-secret" } };
  const example = EXAMPLE + "NEXT_PUBLIC_ANTHROPIC_API_KEY=   # [서버 전용] 비밀\n";
  const r = run(repo({ scopes, example }));
  assert.ok(r.errors.some((e) => /NEXT_PUBLIC_ANTHROPIC_API_KEY/.test(e) && /NEXT_PUBLIC_/.test(e)), r.errors.join("\n"));
});

test("ENV-03 — 공개 범위인데 NEXT_PUBLIC_이 없으면 오류 (브라우저에서 읽을 수 없다)", () => {
  const scopes = { ...SCOPES, vars: { ...SCOPES.vars, SITE_INDEXING: "public" } };
  const r = run(repo({ scopes, example: EXAMPLE.replace("# [서버] 권고값", "# [공개] 권고값") }));
  assert.ok(r.errors.some((e) => /SITE_INDEXING/.test(e)), r.errors.join("\n"));
});

test("ENV-02·05 — 코드가 범위 목록에 없는 변수를 읽으면 오류", () => {
  const r = run(repo({ code: CODE + "\nexport const x = process.env.SECRET_THING;" }));
  assert.ok(r.errors.some((e) => /SECRET_THING/.test(e)), r.errors.join("\n"));
});

test("ENV-05 — 소문자가 섞인 이름(SystemRoot)도 이름 전체로 판정한다", () => {
  const r = run(repo({ code: CODE + "\nexport const s = process.env.SystemRoot;" }));
  assert.ok(r.errors.some((e) => /SystemRoot/.test(e)), r.errors.join("\n"));
  assert.ok(!r.errors.some((e) => /변수 S를/.test(e)), r.errors.join("\n"));
});

test("ENV-02 — 아무 코드도 읽지 않는 변수는 경고만", () => {
  const r = run(repo({ code: "export const a = process.env.NEXT_PUBLIC_SITE_URL;" }));
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /SITE_INDEXING/.test(w)), r.warnings.join("\n"));
});

test("ENV-02 — .env.local이 커밋 대상이면 오류", () => {
  const r = run(repo({ extraTracked: { ".env.local": "SITE_INDEXING=off\n" } }));
  assert.ok(r.errors.some((e) => /\.env\.local/.test(e)), r.errors.join("\n"));
});

test("ENV-02 — 하위 폴더의 .env도 커밋 대상이면 오류", () => {
  const r = run(repo({ extraTracked: { "apps/web/.env": "X=1\n" } }));
  assert.ok(r.errors.some((e) => /apps\/web\/\.env/.test(e)), r.errors.join("\n"));
});

test("ENV-02 — .gitignore에 .env*.local이 없으면 오류", () => {
  const r = run(repo({ gitignore: ".env\nnode_modules/\n" }));
  assert.ok(r.errors.some((e) => /\.gitignore/.test(e)), r.errors.join("\n"));
});

test("저장소 전체 — 스크립트가 종료 코드 0", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
