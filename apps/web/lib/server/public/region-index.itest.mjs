// 지역 색인 판정·메타 설명·/local 시범·색인 표시 통합 시험 (W4 11단계 — docs/dev/W4_설계.md 1장 11단계 · 2.2 · 12장 #27·#81~, PRD-01B REG-09 · REG1-12 · 9.2)
// 로컬 Supabase에 anon 키로 읽는다 (RLS가 경계 — 판정은 뷰 public_region_index, 시범 지역은 설정 pilot_regions 한 줄).
// 시험 세계: 시험용 시·도 1 + 시·군·구 2(접두 99 가짜 코드 — 설계 8장). 충족구 = 편집 승인 보도기사 1 + 검수 공식 자료 1, 미달구 = 해설 1 + 검수 자료 1.
// 끝나면 만든 행을 모두 지우고 기능 키·시범 지역·임계값을 되돌린다. 실행: pnpm --filter @ltr/web test:integration
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const SIDO = "9900000000";
const MET = "9901100000";
const BELOW = "9902100000";
const DESK_FULL = { evidence: true, relation: true, ad_independence: true };

let db;
let api;
const saved = {};
const w = {};
const made = { people: [], articles: [], snapshots: [], regions: [] };

function localSupabase() {
  const out = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: path.resolve(HERE, "../../../../../packages/db"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  for (const u of [j.API_URL, j.DB_URL]) {
    const host = new URL(u).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("이 시험은 로컬 Supabase에서만 돈다");
  }
  return j;
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
async function insert(table, cols, bucket) {
  const keys = Object.keys(cols);
  const row = await one(`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => cols[k]));
  if (bucket) made[bucket].push(row.id ?? row.code);
  return row;
}
const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const setSetting = (key, value) => db.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);

/** 공개 지역 기사 — 이관 모양(발행일을 넣은 공개 행). approve = 편집 승인 기록 */
async function article(key, cols, { approve = false } = {}) {
  const row = await insert(
    "articles",
    {
      slug: `it-w4ri-${key}-${RUN}`,
      title: cols.title ?? `시험용 ${key}`,
      summary: "시험용 지역 기사 요약입니다",
      section: "local",
      content_type: cols.type ?? "reported_news",
      status: "published",
      author_id: w.reporter.id,
      editorial_field: "local_finance",
      public_question: "시험용 지역 재정은 어떻게 바뀌나",
      region_codes: cols.codes,
      first_published_at: hoursAgo(cols.hours ?? 1),
    },
    "articles",
  );
  if (approve) await db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, checklist) values ($1, 'desk_edit', $2, 'approve', $3)", [row.id, w.desk.id, JSON.stringify(DESK_FULL)]);
  w[key] = { id: Number(row.id), title: row.title };
  return w[key];
}

async function source(articleKey, key) {
  const url = `https://gov.example.test/itest-w4ri-${RUN}/${key}`;
  const snap = await insert("raw_snapshots", { source: "itest", url, content_hash: `sha256:${key}-${RUN}`, payload: "시험용 원문" }, "snapshots");
  await insert("article_sources", {
    article_id: w[articleKey].id,
    kind: "official_doc",
    title: `시험용 공식 자료 ${key}`,
    source_url: url,
    source_name: "시험용 색인도청",
    last_verified_at: hoursAgo(30),
    license_status: "공공누리 제1유형",
    license_type: "kogl_1",
    source_type: "local_tax_revenue",
    published_on: "2026-09-01",
    reference_date: "2026-08-31",
    region_unit: "시·군·구",
    collected_at: hoursAgo(40),
    snapshot_id: snap.id,
  });
}

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  for (const k of ["feature_flags", "pilot_regions", "region_index_threshold"]) saved[k] = (await one("select value from public.settings where key = $1", [k])).value;
  expect(saved.feature_flags.region_hubs).not.toBe(true);
  expect((await one("select count(*)::int n from public.regions where code like '99%'")).n).toBe(0);

  w.reporter = await insert("people", { slug: `it-w4ri-reporter-${RUN}`, name: "통합 시험 색인 기자", roles: ["reporter"], visibility: "public" }, "people");
  w.desk = await insert("people", { slug: `it-w4ri-desk-${RUN}`, name: "통합 시험 편집 책임자", roles: ["editor"] }, "people");
  w.sidoSlug = `itest-ri-${RUN}`;
  await insert("regions", { code: SIDO, level: "sido", name: "시험용 색인도", slug: w.sidoSlug }, "regions");
  await insert("regions", { code: MET, parent_code: SIDO, level: "sigungu", name: "시험용 충족구", slug: `chungjok-${RUN}-gu` }, "regions");
  await insert("regions", { code: BELOW, parent_code: SIDO, level: "sigungu", name: "시험용 미달구", slug: `midal-${RUN}-gu` }, "regions");

  // 충족구 — 편집 승인 보도 R1(충족구만 태그)·R2(충족구 + 시·도 두 태그 — 메타 설명 재료 밖) + 검수 자료 · 미달구 — 해설 E1 + 검수 자료
  await article("R1", { codes: [MET], title: "시험용 충족구 세수 보도", hours: 1 }, { approve: true });
  await article("R2", { codes: [MET, SIDO], title: "시험용 두 지역 보도", hours: 0.5 }, { approve: true });
  await article("E1", { codes: [BELOW], type: "explainer", hours: 2 });
  await source("R1", "S1");
  await source("E1", "S2");

  await setSetting("pilot_regions", [MET, "1100000000"]);
  await setSetting("region_index_threshold", { reported_news: 1, official_sources: 1 });
  await setSetting("feature_flags", { ...saved.feature_flags, region_hubs: true, sm_calculator: false });
  api = await import("./index.ts");
});

afterAll(async () => {
  if (!db) return;
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const ids = made.articles;
    await db.query("delete from public.article_sources where article_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.editorial_reviews where article_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.article_revisions where article_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [ids]);
    await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [made.snapshots]);
    await db.query("delete from public.people where id = any($1::bigint[])", [made.people]);
    await db.query("delete from public.regions where code = any($1::text[])", [made.regions]);
    for (const [k, v] of Object.entries(saved)) await setSetting(k, v);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    await db.end();
  }
});

describe("지역 허브 — 색인 판정(anon 뷰 public_region_index) · 사유 · 메타 설명", () => {
  test("충족구(보도 2 · 자료 1) → 색인 대상, 사유 없음 · 메타 설명 = 그 지역 코드 하나만 단 보도 제목(두 지역 태그 보도는 밖)", async () => {
    const page = await api.getRegionPage(w.sidoSlug, `chungjok-${RUN}-gu`);
    expect(page).toMatchObject({ code: MET, indexable: true, noindexReason: null, noindex: false, description: "시험용 충족구 세수 보도" });
  });

  test("미달구(해설만 — 자체 취재 0) → noindex 사유 below_minimum · 메타 설명 없음(템플릿 문장 0)", async () => {
    const page = await api.getRegionPage(w.sidoSlug, `midal-${RUN}-gu`);
    expect(page).toMatchObject({ code: BELOW, empty: false, indexable: false, noindexReason: "below_minimum", noindex: true, description: null });
  });

  test("시·도 = 자기 + 하위 범위로 충족 · 메타 설명은 시·도 코드 하나만 단 기사 0 → 없음 (하위 허브와 같은 설명 0)", async () => {
    const page = await api.getRegionPage(w.sidoSlug, null);
    expect(page).toMatchObject({ code: SIDO, indexable: true, noindexReason: null, description: null });
  });

  test("임계값을 바꾸면 다음 읽기부터 — 자체 취재 3 필요 → 충족구도 미달, 되돌리면 충족", async () => {
    await setSetting("region_index_threshold", { reported_news: 3, official_sources: 1 });
    try {
      // 공개 데이터 캐시(30초)는 Next 서버 안에만 있다 — 이 시험은 캐시 밖에서 바로 읽는다
      expect((await api.getRegionPage(w.sidoSlug, `chungjok-${RUN}-gu`)).noindexReason).toBe("below_minimum");
    } finally {
      await setSetting("region_index_threshold", { reported_news: 1, official_sources: 1 });
    }
    expect((await api.getRegionPage(w.sidoSlug, `chungjok-${RUN}-gu`)).noindexReason).toBeNull();
  });
});

describe("/local 시·도 카드 — '시범 지역'·'색인 대상' 표시", () => {
  test("시범 지역(충족구 → 상위 시험용 색인도, 서울) · 색인 대상(시험용 색인도) — 다른 시·도는 표시 0", async () => {
    const hub = await api.getHubData("local");
    const card = (code) => hub.local.sido.find((c) => c.code === code);
    expect(card(SIDO)).toMatchObject({ pilot: true, indexed: true });
    expect(card("1100000000")).toMatchObject({ name: "서울특별시", pilot: true, indexed: false });
    expect(card("2600000000")).toMatchObject({ pilot: false, indexed: false });
    expect(hub.local.sido.filter((c) => c.pilot).map((c) => c.code).sort()).toEqual(["1100000000", SIDO]);
    expect(hub.local.sido.filter((c) => c.indexed).map((c) => c.code)).toEqual([SIDO]);
  });

  test("region_hubs 꺼지면 색인 대상 0(사이트맵 원본 0행) — 시범 지역 표시는 그대로", async () => {
    await setSetting("feature_flags", { ...saved.feature_flags, region_hubs: false });
    try {
      const hub = await api.getHubData("local");
      expect(hub.local.sido.filter((c) => c.indexed)).toEqual([]);
      expect(hub.local.sido.find((c) => c.code === SIDO)).toMatchObject({ href: null, pilot: true });
    } finally {
      await setSetting("feature_flags", { ...saved.feature_flags, region_hubs: true, sm_calculator: false });
    }
  });
});
