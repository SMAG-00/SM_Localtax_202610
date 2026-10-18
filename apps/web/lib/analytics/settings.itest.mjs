// 수집 설정·저장 통합 시험 (docs/dev/W2-c_설계.md 2.5·5장) — 로컬 Supabase의 씨앗 설정을 수집 API와 같은 검사로 읽고,
// 수집 함수(lib/server/analytics/collect.ts)를 진짜 요청 객체로 불러 service_role 저장까지 본다. 만든 행은 지운다. 로컬 DB에서만 돈다.
// 실행: pnpm --filter @ltr/web test:integration (scripts/ci/db-e2e.sh)
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ANALYTICS_SETTING_CHECKS, ANALYTICS_SETTING_KEYS, parseCollectSettings } from "./settings";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 itest-marker";
const IP = "198.51.100.231";
let db;
let collect;
const sessions = [];

function localSupabase() {
  const out = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: path.resolve(HERE, "../../../../packages/db"),
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

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = sb.SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  ({ collect } = await import("@/lib/server/analytics/collect"));
});

afterAll(async () => {
  if (sessions.length) await db.query("delete from public.analytics_events where session_id = any($1::uuid[])", [sessions]);
  await db?.end();
});

describe("씨앗 설정 (로컬 DB)", () => {
  test("수집·집계 설정 5개가 DB에 있고 관리자 화면·수집 API와 같은 검사를 지난다", async () => {
    const { rows } = await db.query("select key, value from public.settings where key = any($1::text[]) order by key", [[...ANALYTICS_SETTING_KEYS]]);
    expect(rows.map((r) => r.key)).toEqual([...ANALYTICS_SETTING_KEYS].sort());
    for (const r of rows) expect(ANALYTICS_SETTING_CHECKS[r.key](r.value), r.key).toEqual([]);
    const read = parseCollectSettings(rows);
    expect(read.ok).toBe(true);
  });
});

const post = (body, headers = {}) =>
  new Request("http://127.0.0.1:3001/api/events", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "user-agent": UA, "x-forwarded-for": IP, origin: "http://127.0.0.1:3001", "sec-fetch-site": "same-origin", ...headers },
  });

describe("수집 → 저장 (service_role · PostgREST)", () => {
  test("기사 열람 이벤트가 PRD 칸으로 저장되고, User-Agent·IP 글자는 어느 칸에도 없다", async () => {
    const r = await collect(post({ name: "article_viewed", section: "finance", props: { article_id: 987654, format: "cardnews", content_type: "guide" }, referrer: "search.naver.com" }));
    expect(r.status).toBe(202);
    const sid = r.cookies.find((c) => c.startsWith("ltr_sid="))?.slice("ltr_sid=".length, "ltr_sid=".length + 36);
    const vid = r.cookies.find((c) => c.startsWith("ltr_vid="))?.slice("ltr_vid=".length, "ltr_vid=".length + 36);
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    sessions.push(sid);
    const { rows } = await db.query("select * from public.analytics_events where session_id = $1", [sid]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({ name: "article_viewed", visitor_id: vid, first_visit: true, stage: 1, mode: "general", tier: "guest", entry: "naver", section: "finance", is_bot: false, is_staff: false });
    expect(row.props).toEqual({ article_id: 987654, format: "cardnews", content_type: "guide" });
    const text = JSON.stringify(row);
    for (const leak of ["itest-marker", "Chrome", IP, "search.naver"]) expect(text).not.toContain(leak);
  });

  test("거부 쿠키·GPC 요청은 204이고 행이 생기지 않는다", async () => {
    const before = (await db.query("select count(*)::int n from public.analytics_events")).rows[0].n;
    expect((await collect(post({ name: "hub_viewed", section: "tax" }, { cookie: "ltr_optout=1" }))).status).toBe(204);
    expect((await collect(post({ name: "hub_viewed", section: "tax" }, { "sec-gpc": "1" }))).status).toBe(204);
    expect((await db.query("select count(*)::int n from public.analytics_events")).rows[0].n).toBe(before);
  });
});
