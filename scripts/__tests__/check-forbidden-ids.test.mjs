// FND-05 — SM 플랫폼 식별자(Supabase 프로젝트 ref·Vercel 프로젝트 ID·저장소 주소)가 코드·설정에 없음.
// 금지 목록은 CI 비밀값(FORBIDDEN_IDENTIFIERS)으로만 받는다. 시험 값은 실제 SM 값이 아닌 가짜 값이다.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempRepo, runScript } from "./helpers.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "check-forbidden-ids.mjs");
const FAKE_REF = "zzfakeprojectref000001";
const FAKE_VERCEL = "prj_FakeVercelProjectId0001";
const LIST = `${FAKE_REF},${FAKE_VERCEL}`;
const files = {
  "apps/web/lib/a.ts": "export const a = 1;\n",
  "README.md": "# 시험\n",
};

test("금지 값이 없으면 통과", () => {
  const repo = tempRepo(files);
  const r = runScript(SCRIPT, [repo.dir], { env: { FORBIDDEN_IDENTIFIERS: LIST } });
  assert.equal(r.code, 0, r.out);
});

test("금지 값 하나를 넣으면 실패하고, 빼면 다시 통과", () => {
  const repo = tempRepo({ ...files, "apps/web/lib/b.ts": `const url = "https://${FAKE_REF}.supabase.co";\n` });
  let r = runScript(SCRIPT, [repo.dir], { env: { FORBIDDEN_IDENTIFIERS: LIST } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /apps\/web\/lib\/b\.ts:1/);
  repo.write("apps/web/lib/b.ts", "const url = process.env.NEXT_PUBLIC_SUPABASE_URL;\n");
  repo.git("add", "-A");
  r = runScript(SCRIPT, [repo.dir], { env: { FORBIDDEN_IDENTIFIERS: LIST } });
  assert.equal(r.code, 0, r.out);
});

test("실패 메시지에 금지 값 자체를 찍지 않는다 (CI 로그 노출 방지)", () => {
  const repo = tempRepo({ ...files, "vercel.json": `{"projectId":"${FAKE_VERCEL}"}` });
  const r = runScript(SCRIPT, [repo.dir], { env: { FORBIDDEN_IDENTIFIERS: LIST } });
  assert.equal(r.code, 1, r.out);
  assert.ok(!r.out.includes(FAKE_VERCEL), r.out);
  assert.match(r.out, /vercel\.json:1/);
});

test("줄바꿈·공백으로 구분한 목록도 읽는다", () => {
  const repo = tempRepo({ ...files, "x.ts": `// ${FAKE_VERCEL}\n` });
  const r = runScript(SCRIPT, [repo.dir], { env: { FORBIDDEN_IDENTIFIERS: `\n ${FAKE_REF} \n${FAKE_VERCEL}\n` } });
  assert.equal(r.code, 1, r.out);
});

test("커밋 대상이 아닌 파일(.gitignore된 .env.local)은 검사하지 않는다", () => {
  const repo = tempRepo({ ...files, ".gitignore": ".env*.local\n" });
  repo.write(".env.local", `X=${FAKE_REF}\n`);
  const r = runScript(SCRIPT, [repo.dir], { env: { FORBIDDEN_IDENTIFIERS: LIST } });
  assert.equal(r.code, 0, r.out);
});

test("CI에서 금지 목록이 없으면 종료 코드 3 (검사를 건너뛰지 않는다)", () => {
  const repo = tempRepo(files);
  const r = runScript(SCRIPT, [repo.dir], { env: { FORBIDDEN_IDENTIFIERS: "", CI: "true" } });
  assert.equal(r.code, 3, r.out);
});

test("로컬에서 금지 목록이 없으면 경고 후 종료 코드 0", () => {
  const repo = tempRepo(files);
  const r = runScript(SCRIPT, [repo.dir], { env: { FORBIDDEN_IDENTIFIERS: "", CI: "" } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /건너뜀|없습니다/);
});
