// 검색어 집계 통합 시험 (SRCH-03 — docs/dev/W2-d_설계.md 8.3) — 서버 함수(lib/server/analytics/query-terms.ts)를 service_role 클라이언트로 불러
// DB 함수(query_terms_add · query_terms_report · query_terms_purge)와 인자 이름·결과 모양이 맞는지 본다. 기대값은 넣은 자료에서 손으로 센 값이다.
// 시험 낱말은 이 실행만의 글자(영문 소문자)를 붙여 다른 자료와 겹치지 않게 하고, 넣은 행·동의어 줄은 끝나면 지운다. 로컬 DB에서만 돈다.
// 실행: pnpm --filter @ltr/web test:integration (scripts/ci/db-e2e.sh)
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
const RUN = Array.from(crypto.randomBytes(8), (b) => String.fromCharCode(97 + (b % 26))).join("");
let db;
let sb;
let m;
let settings;

function localSupabase() {
  const out = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: path.resolve(HERE, "../../../../../packages/db"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  for (const u of [j.API_URL, j.DB_URL]) {
    if (!["127.0.0.1", "localhost", "::1"].includes(new URL(u).hostname)) throw new Error("이 시험은 로컬 Supabase에서만 돈다");
  }
  return j;
}

/** 한국 날짜 — 오늘 + n일 */
const kstDay = (n) => new Date(Date.now() + 9 * 3_600_000 + n * DAY).toISOString().slice(0, 10);
const rowsOf = async (normalized) => (await db.query("select term_masked, period::text p, count from public.query_terms where normalized = $1 order by period", [normalized])).rows;

beforeAll(async () => {
  const j = localSupabase();
  db = new pg.Client({ connectionString: j.DB_URL });
  await db.connect();
  sb = createClient(j.API_URL, j.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  m = await import("@/lib/server/analytics/query-terms");
  settings = (await db.query("select value from public.settings where key = 'query_terms'")).rows[0].value;
}, 120_000);

afterAll(async () => {
  await db.query("delete from public.query_terms where normalized like $1", [`%${RUN}%`]);
  await db.query("delete from public.search_synonyms where term like $1", [`%${RUN}%`]);
  await db?.end();
});

describe("더하기 → 보고 → 정리 (서버 함수 ↔ DB 함수)", () => {
  const A = `취득세 ${RUN}`;
  const B = `재산세 ${RUN}`;
  const D1 = kstDay(-200);
  const D2 = kstDay(-199);

  test("storeSiteSearch — 같은 정규형·같은 날은 한 행으로 합치고, 날이 다르면 다른 행. 가린 값은 첫 값", async () => {
    expect(await m.storeSiteSearch({ term: `취득세 [전화번호] ${RUN}`, normalized: A, period: D1, at: `${D1}T01:00:00+09:00` }, sb)).toBe(true);
    expect(await m.storeSiteSearch({ term: `취득세 ${RUN}`, normalized: A, period: D1, at: `${D1}T02:00:00+09:00` }, sb)).toBe(true);
    expect(await m.storeSiteSearch({ term: `취득세 ${RUN}`, normalized: A, period: D2, at: `${D2}T02:00:00+09:00` }, sb)).toBe(true);
    expect(await m.storeSiteSearch({ term: `재산세 ${RUN}`, normalized: B, period: D1, at: `${D1}T03:00:00+09:00` }, sb)).toBe(true);
    expect(await rowsOf(A)).toEqual([
      { term_masked: `취득세 [전화번호] ${RUN}`, p: D1, count: 2 },
      { term_masked: `취득세 ${RUN}`, p: D2, count: 1 },
    ]);
  });

  test("storeSiteSearch — 가리지 않은 값은 DB가 거부해 false, 행 0 (서버 기록에는 오류 코드만)", async () => {
    const raw = `010-1234-5678 ${RUN}`;
    expect(await m.storeSiteSearch({ term: raw, normalized: `전화 ${RUN}`, period: D1, at: `${D1}T04:00:00+09:00` }, sb)).toBe(false);
    expect(await rowsOf(`전화 ${RUN}`)).toEqual([]);
  });

  test("loadQueryTermsReport — 고른 기간의 합계·찾은 날 수, 최소 횟수(설정) 아래는 수만, 동의어 사전에 같은 열쇠가 있으면 그 줄", async () => {
    await db.query("insert into public.search_synonyms (term, synonyms, updated_by) values ($1, $2, 'it:query-terms')", [A, [`과세${RUN}`]]);
    const report = await m.loadQueryTermsReport(sb, { from: D1, to: D2 }, new Date());
    expect(report.period).toEqual({ from: D1, to: D2, days: 2, preset: null });
    expect(report.minCount).toBe(settings.display_min_count);
    expect(report.retentionDays).toBe(settings.retention_days);
    const mine = report.rows.filter((r) => r.normalized.includes(RUN));
    expect(mine.map((r) => [r.normalized, r.termMasked, r.count, r.days])).toEqual([[A, `취득세 [전화번호] ${RUN}`, 3, 2]]);
    expect(mine[0].synonym).toMatchObject({ enabled: true });
    expect(new Date(mine[0].firstSeen).toISOString()).toBe(new Date(`${D1}T01:00:00+09:00`).toISOString());
    expect(new Date(mine[0].lastSeen).toISOString()).toBe(new Date(`${D2}T02:00:00+09:00`).toISOString());
    // 1회 '재산세'는 rows 0 — 최소 횟수 2(씨앗)일 때. 정규형 수에는 든다
    expect(report.rows.some((r) => r.normalized === B)).toBe(settings.display_min_count <= 1);
    expect(report.terms - report.shown).toBeGreaterThanOrEqual(settings.display_min_count > 1 ? 1 : 0);
  });

  test("loadQueryTermsReport — 쓸 수 없는 기간은 최근 7일 + 이유", async () => {
    const report = await m.loadQueryTermsReport(sb, { from: D2, to: D1 }, new Date());
    expect(report.period.preset).toBe(7);
    expect(report.periodError).toContain("늦습니다");
  });

  test("purgeQueryTerms — 보존 일수(설정)보다 오래된 날 행만 지운다: 보존 일수 + 1일 전 0, 보존 일수일 전은 남는다", async () => {
    const old = kstDay(-(settings.retention_days + 1));
    const edge = kstDay(-settings.retention_days);
    await m.storeSiteSearch({ term: `오래된 ${RUN}`, normalized: `오래된 ${RUN}`, period: old, at: `${old}T12:00:00+09:00` }, sb);
    await m.storeSiteSearch({ term: `경계 ${RUN}`, normalized: `경계 ${RUN}`, period: edge, at: `${edge}T12:00:00+09:00` }, sb);
    const detail = await m.purgeQueryTerms(sb, new Date());
    expect(detail).toMatchObject({ retentionDays: settings.retention_days, before: edge, done: true });
    expect(detail.removed).toBeGreaterThanOrEqual(1);
    expect(await rowsOf(`오래된 ${RUN}`)).toEqual([]);
    expect((await rowsOf(`경계 ${RUN}`)).length).toBe(1);
    expect((await rowsOf(A)).length).toBe(2);
  });
});
