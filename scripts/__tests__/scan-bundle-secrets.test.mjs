// ENV-03·ENV-06 — 빌드 산출물(브라우저 번들·서버 번들)에 서버 전용 비밀값 0, 브라우저 번들에 서버 전용 변수 이름 0, 키 형식 문자열 0
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanBuild, makeCanaries, looksLikeServiceRoleJwt } from "../scan-bundle-secrets.mjs";

const SERVER_SECRETS = ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "RESEND_API_KEY", "CRON_SECRET"];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", role })}.c2lnbmF0dXJlc2lnbmF0dXJl`;

function build(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ltr-build-"));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
const canaries = makeCanaries(SERVER_SECRETS);
const run = (files) => scanBuild({ nextDir: build(files), canaries, serverSecretNames: SERVER_SECRETS });
const CLEAN = {
  "static/chunks/app.js": 'var u="https://abc.supabase.co";fetch(u)',
  "server/app/page.js": "const k=process.env.SUPABASE_SERVICE_ROLE_KEY;",
};

test("가짜 비밀값(카나리아)은 이름마다 다르고 서로 겹치지 않는다", () => {
  const values = Object.values(canaries);
  assert.equal(values.length, SERVER_SECRETS.length);
  assert.equal(new Set(values).size, values.length);
});

test("깨끗한 빌드는 오류 0 (서버 번들이 변수 이름을 읽는 것은 허용)", () => {
  assert.deepEqual(run(CLEAN).errors, []);
});

test("브라우저 번들에 서버 전용 비밀값(카나리아)이 있으면 오류", () => {
  const r = run({ ...CLEAN, "static/chunks/x.js": `var k="${canaries.SUPABASE_SERVICE_ROLE_KEY}"` });
  assert.ok(r.errors.some((e) => /static\/chunks\/x\.js/.test(e) && /SUPABASE_SERVICE_ROLE_KEY/.test(e)), r.errors.join("\n"));
});

test("서버 번들에 비밀값이 박혀 있어도 오류 (빌드 때 값이 들어가면 안 된다)", () => {
  const r = run({ ...CLEAN, "server/chunks/y.js": `const s="${canaries.CRON_SECRET}"` });
  assert.ok(r.errors.some((e) => /server\/chunks\/y\.js/.test(e) && /CRON_SECRET/.test(e)), r.errors.join("\n"));
});

test("브라우저 번들에 서버 전용 변수 이름이 있으면 오류", () => {
  const r = run({ ...CLEAN, "static/chunks/z.js": 'console.log(process.env.ANTHROPIC_API_KEY)' });
  assert.ok(r.errors.some((e) => /ANTHROPIC_API_KEY/.test(e) && /이름/.test(e)), r.errors.join("\n"));
});

test("service_role JWT 형식 문자열이 있으면 오류, anon JWT는 허용 (공개 키)", () => {
  assert.equal(looksLikeServiceRoleJwt(jwt("service_role")), true);
  assert.equal(looksLikeServiceRoleJwt(jwt("anon")), false);
  const bad = run({ ...CLEAN, "static/chunks/j.js": `var t="${jwt("service_role")}"` });
  assert.ok(bad.errors.some((e) => /service_role/.test(e)), bad.errors.join("\n"));
  const ok = run({ ...CLEAN, "static/chunks/j.js": `var t="${jwt("anon")}"` });
  assert.deepEqual(ok.errors, []);
});

for (const [label, sample] of [
  ["Supabase 새 비밀 키(sb_secret_)", "sb_secret_" + "A".repeat(30)],
  ["Anthropic 키(sk-ant-)", "sk-ant-api03-" + "B".repeat(40)],
  ["Resend 키(re_)", "re_" + "C1d2".repeat(8)],
  ["GitHub 토큰(ghp_)", "ghp_" + "D".repeat(36)],
]) {
  test(`${label} 형식 문자열이 있으면 오류`, () => {
    const r = run({ ...CLEAN, "server/app/k.js": `x="${sample}"` });
    assert.ok(r.errors.some((e) => /server\/app\/k\.js/.test(e) && /키 형식/.test(e)), r.errors.join("\n"));
  });
}

test("오류 메시지에 비밀값 자체를 찍지 않는다", () => {
  const r = run({ ...CLEAN, "static/chunks/x.js": `var k="${canaries.RESEND_API_KEY}"` });
  assert.ok(!r.errors.join("\n").includes(canaries.RESEND_API_KEY));
});

test("빌드 폴더가 없으면 오류 (검사를 건너뛰지 않는다)", () => {
  const r = scanBuild({ nextDir: path.join(os.tmpdir(), "no-such-next-" + Date.now()), canaries, serverSecretNames: SERVER_SECRETS });
  assert.ok(r.errors.some((e) => /빌드 폴더/.test(e)));
});
