// 기사 생산·제휴 준비 대시보드 통합 시험 (NAV-13 · NAV-14 — docs/dev/W2-c_설계.md 8.5) — 로컬 Supabase에 정해 둔 기사·규정 버전을 넣고,
// 대시보드 읽기(lib/server/readiness/dashboard.ts)를 service_role 클라이언트로 불러 DB 함수(news_production_facts) → 세는 규칙까지 이어서 본다.
// 다른 자료와 겹치지 않게 '오늘'을 2003-01-15로 두고(기간은 2002년) 기대값은 넣은 자료에서 손으로 센 값이다. 넣은 행은 끝나면 지운다. 로컬 DB에서만 돈다.
// 실행: pnpm --filter @ltr/web test:integration (scripts/ci/db-e2e.sh)
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2003-01-15T03:00:00Z"); // 한국 2003-01-15 12:00 — 3개월 = 2002-10-01 ~ 2002-12-31
const RUN = crypto.randomBytes(4).toString("hex");
let db;
let sb;
let load;
const ids = { articles: [], people: [], requirements: [] };

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

const kst = (local) => new Date(`${local}+09:00`).toISOString();

async function article(label, cols) {
  const all = { slug: `it-readiness-${label}-${RUN}`, title: `생산 통합 ${label}`, section: "tax", content_type: "reported_news", reporting_method: "quantitative", status: "published", ...cols };
  const keys = Object.keys(all);
  const { rows } = await db.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(all));
  ids.articles.push(Number(rows[0].id));
  return Number(rows[0].id);
}

const ITEMS = [
  {
    key: "own_ratio",
    label: "자체 생산 기사 비율",
    metric: "ratio",
    numerator: { contentTypes: ["reported_news"] },
    denominator: {},
    numeratorText: "보도기사",
    denominatorText: "전체 발행 기사",
    exclusionsText: "없음",
    criterion: { comparator: "gte", value: 50, per: "period" },
  },
  {
    key: "monthly",
    label: "월 발행량",
    metric: "count",
    numerator: { contentTypes: ["reported_news"] },
    numeratorText: "보도기사",
    exclusionsText: "칼럼·금주 핫뉴스",
    criterion: { comparator: "gte", value: 2, per: "month" },
  },
];

beforeAll(async () => {
  const j = localSupabase();
  db = new pg.Client({ connectionString: j.DB_URL });
  await db.connect();
  sb = createClient(j.API_URL, j.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  ({ loadReadinessDashboard: load } = await import("@/lib/server/readiness/dashboard"));
  const person = (await db.query("insert into public.people (slug, name, roles, employment) values ($1, '통합 시험 기자', '{reporter}', 'staff') returning id", [`it-readiness-${RUN}`])).rows[0];
  ids.people.push(Number(person.id));
  const author = Number(person.id);
  await article("start", { first_published_at: kst("2002-10-01T00:00:00"), author_id: author }); // 3개월 시작일 0시 — 포함
  await article("day-before", { first_published_at: kst("2002-09-30T23:59:59"), author_id: author }); // 시작일 하루 전 — 3개월 제외, 6개월 포함
  await article("explainer", { first_published_at: kst("2002-11-05T09:00:00"), content_type: "explainer", reporting_method: null, author_id: author });
  await article("opinion", { first_published_at: kst("2002-11-06T09:00:00"), content_type: "opinion", reporting_method: null });
  await article("digest", { first_published_at: kst("2002-11-07T09:00:00"), content_type: "digest", reporting_method: null, digest_id: 1 });
  await article("held", { first_published_at: kst("2002-11-08T09:00:00"), status: "held" });
  await article("legacy", { first_published_at: kst("2002-11-09T09:00:00"), origin: "legacy" });
  await article("this-month", { first_published_at: kst("2003-01-02T09:00:00") }); // 이번 달 — 완결된 달 기간 밖
}, 120_000);

afterAll(async () => {
  try {
    await db.query("begin");
    await db.query("set local session_replication_role = replica"); // 확정 버전은 트리거가 지우기를 막는다 — 이 시험이 넣은 행만 지운다
    if (ids.requirements.length) await db.query("delete from public.news_partner_requirements where id = any($1::bigint[])", [ids.requirements]);
    if (ids.articles.length) await db.query("delete from public.articles where id = any($1::bigint[])", [ids.articles]);
    if (ids.people.length) await db.query("delete from public.people where id = any($1::bigint[])", [ids.people]);
    await db.query("commit");
  } finally {
    await db?.end();
  }
});

describe("대시보드 읽기 — 넣은 자료의 손 계산과 같다", () => {
  test("확정 버전 없음 — 두 플랫폼 모두 공식 숫자 0(요건 미확정), 내부 정의 3·6·12개월 숫자", async () => {
    const dash = await load(sb, {}, NOW);
    expect(dash.today).toBe("2003-01-15");
    expect(dash.windows.map((w) => [w.months, w.from, w.to])).toEqual([
      [3, "2002-10-01", "2002-12-31"],
      [6, "2002-07-01", "2002-12-31"],
      [12, "2002-01-01", "2002-12-31"],
    ]);
    for (const p of dash.platforms) {
      expect(p.state).not.toBe("confirmed");
      expect("rows" in p).toBe(false);
    }
    const [m3, m6] = dash.internal;
    // 3개월: start·explainer·opinion·digest = 총 4, 자체 취재 후보 1(start) · 보류 1·이관 1 뺌
    expect([m3.total, m3.own, m3.methods.quantitative, m3.excluded.notPublished, m3.excluded.legacy]).toEqual([4, 1, 1, 1, 1]);
    // 6개월: + day-before (자체 취재 후보 2)
    expect([m6.total, m6.own]).toEqual([5, 2]);
    const me = dash.reporters.find((r) => r.name === "통합 시험 기자");
    expect(me).toMatchObject({ published: [2, 3, 3], own: [1, 2, 2], open: 0 });
    expect(dash.trace.window.months).toBe(3);
    expect(dash.trace.total).toBe(1);
  });

  test("네이버 버전을 확정하면 공식 정의 숫자·심사 기간(3개월) 비교·인력 보강 안내 — 카카오는 그대로 요건 미확정", async () => {
    const { rows } = await db.query(
      `insert into public.news_partner_requirements (platform, title, created_by, media_type, source_url, checked_at, effective_from, review_period, requirements)
       values ('naver', $1, 'user:it', '인터넷신문', 'https://example.test/rules/2002', '2002-12-20', '2002-01-01', $2, $3) returning id`,
      [`통합 시험 규정 ${RUN}`, JSON.stringify({ months: 3, basis: "closed_months", text: "최근 3개월" }), JSON.stringify(ITEMS)],
    );
    ids.requirements.push(Number(rows[0].id));
    await db.query("update public.news_partner_requirements set status = 'confirmed', approved_by = 'user:it-approver', approved_at = '2002-12-21T00:00:00Z' where id = $1", [rows[0].id]);
    const dash = await load(sb, { window: "6" }, NOW);
    const naver = dash.platforms.find((p) => p.platform === "naver");
    expect(naver.state).toBe("confirmed");
    expect(naver.reviewWindow).toMatchObject({ months: 3, from: "2002-10-01", to: "2002-12-31" });
    const byKey = Object.fromEntries(naver.rows.map((r) => [r.item.key, r]));
    // 공식 비율: 보도 1 / 공개 기사 4 = 25% → 50% 이상 미달 · 6개월 2/5
    expect(byKey.own_ratio.values.map((v) => [v.numerator, v.denominator])).toEqual([[1, 4], [2, 5], [2, 5]]);
    expect(byKey.own_ratio.comparison).toEqual({ kind: "short", compared: 25 });
    // 월평균 보도 1/3건 → 2건 이상 미달
    expect(byKey.monthly.review).toEqual({ numerator: 1, denominator: null, value: 1 });
    expect(byKey.monthly.comparison.kind).toBe("short");
    expect(naver.capacityGuidance).toBe(true);
    const kakao = dash.platforms.find((p) => p.platform === "kakao");
    expect(kakao.state === "confirmed").toBe(false);
    expect(dash.trace.window.months).toBe(6);
    expect(dash.trace.total).toBe(2);
  });
});
