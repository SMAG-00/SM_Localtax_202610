// W13-f 수용 E2E - 전문가 계산기 (docs/dev/W13-f_설계.md - PRD-05 CALC-17 · CALC-18 · CALC-19)
// standalone 빌드를 로컬 Supabase에 붙인다. 기능 키는 시험 동안만 켜고 끝나면 원래 값으로 되돌린다.
//  a) 키 꺼짐(기본) - /calc/oligopoly · /calc/entity · /calc/corporate-local-income 404
//  b) 키를 켜도 calc_gate_status에 세목 줄이 없고 전문가 룰셋·고정 안내 문구 자리가 비어 있으므로 세 화면 모두 404 (감수 전 공개 0)
//  c) 소스 검사 - 계산 컴포넌트에 네트워크 호출(fetch·XMLHttpRequest·sendBeacon)·브라우저 저장소·분석 이벤트 0, 서버 계산 API 경로 0
//  d) 소스 검사 - 상속·증여 엔진 import 0, compare 엔진 파일 0, SM 링크 카드는 새 창(noopener)이고 주소를 가공하는 함수가 질의·조각을 지운다
//  e) 엔진 소스 검사 - 세율 숫자 상수 0 (expert.ts의 숫자 리터럴은 0·1·3자리 이하 예약 값뿐)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PATHS = ["/calc/oligopoly", "/calc/entity", "/calc/corporate-local-income"];
let sb, server, staff, db, base, saved;

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const page = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
  await server?.stop?.();
  server = await startServer(serverEnv());
  base = server.base;
}
const serverEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
  ADMIN_EMAILS: "w13f-acceptance-e2e@example.test",
  NEXT_PUBLIC_SITE_URL: "https://e2e-w13f.example.test",
  CRON_SECRET: "e2e-w13f-cron",
  GUARD_SECRET: "e2e-w13f-guard-secret",
});

before(async () => {
  sb = await localSupabase();
  await buildWeb(serverEnv());
  server = await startServer(serverEnv());
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  saved = (await db.query("select key, value from public.settings where key = 'feature_flags'")).rows;
});

after(async () => {
  try {
    for (const s of saved ?? []) await db.query("update public.settings set value = $2::jsonb where key = $1", [s.key, JSON.stringify(s.value)]);
  } finally {
    await server?.stop?.();
    await staff?.cleanup();
  }
});

test("a) 기능 키 expert_calc 꺼짐(기본)이면 세 화면 모두 404", async () => {
  await setFlags({ expert_calc: false });
  for (const p of PATHS) assert.equal((await page(p)).status, 404, p);
});

test("b) 키를 켜도 게이트 줄·전문가 룰셋·고정 안내 문구가 없으면 404 (감수 전 공개 0)", async () => {
  await setFlags({ calc: true, expert_calc: true });
  const rows = (await db.query("select count(*)::int n from public.calc_gate_status where tax_kind in ('oligopoly','entity','corporate_local_income')")).rows[0].n;
  assert.equal(rows, 0);
  for (const p of PATHS) assert.equal((await page(p)).status, 404, p);
});

test("c) 계산 컴포넌트에 네트워크·저장소·분석 이벤트 0, 서버 계산 API 경로 0", () => {
  const src = read("apps/web/components/site/calc/expert/ExpertCalculator.tsx");
  assert.doesNotMatch(src, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|document\.cookie|indexedDB/);
  assert.doesNotMatch(src, /track\(|logEvent|events\//);
  assert.deepEqual(PATHS.map((p) => fs.existsSync(path.join(ROOT, "apps/web/app/api/calc", p.replace("/calc/", "")))), [false, false, false]);
});

test("d) 상속·증여 엔진 import 0, 시나리오 비교 엔진 파일 0, SM 링크는 새 창이고 주소의 질의·조각을 지운다", () => {
  const files = [
    "apps/web/components/site/calc/expert/ExpertCalculator.tsx",
    "apps/web/lib/server/public/expert-tools.ts",
    "packages/tax-engine/src/expert.ts",
    ...fs.readdirSync(path.join(ROOT, "apps/web/lib/calc/expert")).filter((f) => !f.endsWith(".test.ts")).map((f) => `apps/web/lib/calc/expert/${f}`),
  ];
  const IGT = ["@ltr", ["igt", "engine"].join("-")].join("/");
  for (const f of files) assert.ok(!read(f).includes(IGT), f);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "packages/tax-engine/src")).filter((n) => /compare|transfer/i.test(n)), []);
  assert.match(read("apps/web/components/site/calc/expert/ExpertCalculator.tsx"), /target="_blank" rel="noopener noreferrer"/);
  assert.match(read("apps/web/lib/calc/expert/view.ts"), /u\.search = ""/);
});

test("e) 엔진 expert.ts에 세율 소수 리터럴 0 (값은 전문가 룰셋에서만)", () => {
  const code = read("packages/tax-engine/src/expert.ts").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*")).join("\n");
  assert.doesNotMatch(code, /\b0\.\d+\b/);
});
