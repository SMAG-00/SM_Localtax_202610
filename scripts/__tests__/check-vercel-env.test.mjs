// FND-02·ENV-05·ENV-06 — Vercel 환경변수 설정 검사: Production↔prod DB, Preview·Development↔staging DB, CI 전용 변수 0
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateVercelEnv, parseDotenv } from "../check-vercel-env.mjs";

const REFS = { production: "vvwiuwrbvvpsmbzsjkiy", staging: "fvnhqbtdviknitetjuxr" };
const CI_ONLY = ["SUPABASE_DB_URL", "SUPABASE_ACCESS_TOKEN", "VERCEL_TOKEN", "FORBIDDEN_IDENTIFIERS"];
const url = (ref) => `https://${ref}.supabase.co`;
const good = () => ({
  production: { NEXT_PUBLIC_SUPABASE_URL: url(REFS.production), SITE_INDEXING: "off" },
  preview: { NEXT_PUBLIC_SUPABASE_URL: url(REFS.staging) },
  development: { NEXT_PUBLIC_SUPABASE_URL: url(REFS.staging) },
});
const run = (envs) => evaluateVercelEnv(envs, REFS, CI_ONLY);

test("Production=prod, Preview·Development=staging이면 오류 0", () => {
  assert.deepEqual(run(good()).errors, []);
});

test("Preview가 prod DB를 가리키면 오류", () => {
  const e = good();
  e.preview.NEXT_PUBLIC_SUPABASE_URL = url(REFS.production);
  const r = run(e);
  assert.ok(r.errors.some((x) => /preview/.test(x) && /운영/.test(x)), r.errors.join("\n"));
});

test("Production이 staging DB를 가리키면 오류", () => {
  const e = good();
  e.production.NEXT_PUBLIC_SUPABASE_URL = url(REFS.staging);
  assert.ok(run(e).errors.some((x) => /production/.test(x)));
});

test("Production에 Supabase 주소가 없으면 오류", () => {
  const e = good();
  delete e.production.NEXT_PUBLIC_SUPABASE_URL;
  assert.ok(run(e).errors.some((x) => /production/.test(x) && /없/.test(x)));
});

test("Development가 prod DB를 가리키면 오류", () => {
  const e = good();
  e.development.NEXT_PUBLIC_SUPABASE_URL = url(REFS.production);
  assert.ok(run(e).errors.some((x) => /development/.test(x)));
});

for (const name of CI_ONLY) {
  test(`CI 전용 변수 ${name}가 Vercel에 있으면 오류 (ENV-05)`, () => {
    const e = good();
    e.preview[name] = "x";
    assert.ok(run(e).errors.some((x) => x.includes(name) && /preview/.test(x)));
  });
}

test("오류 메시지에 변수 값(키·주소 전체)을 찍지 않는다 — ref만", () => {
  const e = good();
  e.preview.NEXT_PUBLIC_SUPABASE_URL = url(REFS.production);
  e.preview.SUPABASE_DB_URL = "postgresql://postgres:supersecret@db.example:5432/postgres";
  const text = run(e).errors.join("\n");
  assert.ok(!text.includes("supersecret"));
  assert.ok(!text.includes("https://"));
});

test("dotenv 파싱 — 따옴표·주석·빈 줄", () => {
  const v = parseDotenv('# 주석\nA="1"\nB=two\n\nC=\'x y\'\nVERCEL_OIDC_TOKEN="t"\n');
  assert.deepEqual(v, { A: "1", B: "two", C: "x y", VERCEL_OIDC_TOKEN: "t" });
});
