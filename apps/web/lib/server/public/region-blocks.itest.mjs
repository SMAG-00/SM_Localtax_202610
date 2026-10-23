// 지자체 허브 ⑤ 공식 자료/해설·지역 세금 연결 블록·/local 전국 화면·지역 기사 API 통합 시험 (W4 9단계 — docs/dev/W4_설계.md 1장 9단계 · 2.3 · 2.8)
// 로컬 Supabase에 anon 키로 읽는다 (RLS가 경계). 공개·비공개·미검수 자료를 섞은 시험 세계를 DB에 직접 넣고(커밋 — anon 요청은 다른 연결),
// 공개 데이터 함수 결과에 검수 공식 자료·감수 해설·그 지역 기사만 나오는지 본다. 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드(설계 8장).
// 끝나면 만든 행을 모두 지우고 기능 키를 되돌린다. 실행: pnpm --filter @ltr/web test:integration
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const SIDO = "9900000000";
const GU = "9901100000";
const OTHER_GU = "9902100000";
const docUrl = (k) => `https://gov.example.test/itest-${RUN}/${k}`;

let db;
let api;
let flags0;
const w = {};
const made = { people: [], articles: [], snapshots: [], regions: [], reviews: [] };

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
const kst = (iso) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
const setFlags = async (patch) => {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  await db.query("update public.settings set value = $1 where key = 'feature_flags'", [{ ...cur, ...patch }]);
};

/** 공개 지역 기사 — 이관처럼 발행일을 넣은 공개 행 (7·8단계 새 발행 검사 밖 — 읽기 시험 재료) */
async function article(key, cols) {
  const at = hoursAgo(cols.hours ?? 1);
  const row = await insert(
    "articles",
    {
      slug: `it-w4b-${key}-${RUN}`,
      title: `시험용 ${key}`,
      summary: "시험용 지역 기사 요약입니다",
      section: cols.section ?? "local",
      content_type: cols.type ?? "explainer",
      status: cols.status ?? "published",
      author_id: w.reporter.id,
      editorial_field: cols.field === undefined ? "local_tax" : cols.field,
      public_question: cols.field === null ? null : "시험용 지역 재정은 어떻게 바뀌나",
      region_codes: cols.codes ?? [GU],
      first_published_at: cols.status === "draft" ? null : at,
      ...(cols.type === "sponsored" ? { label: "ad" } : {}),
    },
    "articles",
  );
  w[key] = { id: Number(row.id), slug: row.slug, at };
  return w[key];
}

/** 공식 자료 출처 — 카드 칸 전부 + 원본 스냅샷 (over로 빼거나 바꾼다) */
async function source(articleKey, key, over = {}) {
  const snap = over.snapshot === false ? null : await insert("raw_snapshots", { source: "itest", url: docUrl(key), content_hash: `sha256:${key}-${RUN}`, payload: "시험용 원문" }, "snapshots");
  const verified = over.verified ?? hoursAgo(30);
  const row = await insert("article_sources", {
    article_id: w[articleKey].id,
    kind: over.kind ?? "official_doc",
    title: over.title ?? `시험용 공식 자료 ${key}`,
    source_url: over.url ?? docUrl(key),
    source_name: over.issuer ?? "시험용 통합도청",
    last_verified_at: verified,
    license_status: "공공누리 제1유형",
    license_type: "kogl_1",
    source_type: over.sourceType === undefined ? "local_tax_revenue" : over.sourceType,
    published_on: "2026-09-01",
    reference_date: over.referenceDate ?? "2026-08-31",
    region_unit: "시·군·구",
    collected_at: hoursAgo(40),
    snapshot_id: snap ? snap.id : null,
    supersedes_id: over.supersedes ?? null,
    revision_reason: over.supersedes ? "시험용 수치 고침" : null,
  });
  w[key] = { id: Number(row.id), url: row.source_url, verifiedOn: kst(verified) };
  return w[key];
}

async function taxReview(articleKey) {
  const r = await insert("editorial_reviews", { article_id: w[articleKey].id, kind: "tax_review", reviewer_id: w.reviewer.id, decision: "approve", at: hoursAgo(0.5) });
  made.reviews.push(r.id);
}

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  flags0 = (await one("select value from public.settings where key = 'feature_flags'")).value;
  expect(flags0.region_hubs).not.toBe(true);
  expect((await one("select count(*)::int n from public.regions where code like '99%'")).n).toBe(0);

  w.reporter = await insert("people", { slug: `it-w4b-reporter-${RUN}`, name: "통합 시험 지역 기자", roles: ["reporter"], visibility: "public" }, "people");
  w.reviewer = await insert("people", { slug: `it-w4b-reviewer-${RUN}`, name: "통합 시험 감수위원", roles: ["reviewer"], visibility: "public" }, "people");
  w.sidoSlug = `itest-do-${RUN}`;
  await insert("regions", { code: SIDO, level: "sido", name: "시험용 통합도", slug: w.sidoSlug }, "regions");
  await insert("regions", { code: GU, parent_code: SIDO, level: "sigungu", name: "시험용 통합구", slug: `tonghap-${RUN}-gu` }, "regions");
  await insert("regions", { code: OTHER_GU, parent_code: SIDO, level: "sigungu", name: "시험용 이웃구", slug: `iut-${RUN}-gu` }, "regions");

  // 기사 — 공개 지역 기사 A1(통합구)·A2(통합도 자기 태그)·A6(이웃구), 비공개 A3(초안)·광고 A4·편집 분야 없는 A5
  await article("A1", { type: "explainer", hours: 1 });
  await article("A2", { type: "reported_news", field: "realestate", codes: [SIDO], hours: 2 });
  await article("A3", { status: "draft" });
  await article("A4", { type: "sponsored", hours: 3 });
  await article("A5", { field: null, hours: 4 });
  await article("A6", { codes: [OTHER_GU], hours: 5 });
  // 해설 — E1 지자체뉴스 해설(감수) · E2 지방세 분야 해설(감수) · E3 가이드(감수 전) · E4 감수 뒤 실질 수정
  await article("E1", { hours: 6 });
  await article("E2", { section: "tax", hours: 7 });
  await article("E3", { type: "guide", field: "urban_policy", hours: 8 });
  await article("E4", { hours: 9 });

  await source("A1", "S1", { verified: hoursAgo(20) });
  await source("A1", "S2", { snapshot: false });
  await source("A1", "S3", { sourceType: null });
  await source("A1", "S4", { title: "시험용 옛 판" });
  await source("A1", "S5", { supersedes: w.S4.id, url: docUrl("S4"), title: "시험용 새 판", verified: hoursAgo(25) });
  await source("A1", "S6", { kind: "press_release", sourceType: null });
  await source("A2", "S7", { url: docUrl("S1"), issuer: "시험용 통합도청", verified: hoursAgo(10) });
  await source("A3", "S8");
  await source("A4", "S9");
  await source("A5", "S10");
  await source("A6", "S11", { issuer: "시험용 이웃구청", referenceDate: "2026-03-31" });
  // A2의 S7에 열린 시점 만료 검수 항목 (6단계 — 공개 '검토 중')
  await db.query("insert into public.source_review_queue (target_type, target_id, article_id, reason, basis_on, run_key, opened_by) values ('article_source', $1, $2, 'expired', '2025-10-01', '2026-10-22', 'job:itest')", [w.S7.id, w.A2.id]);

  for (const k of ["E1", "E2", "E4"]) await taxReview(k);
  await db.query("update public.articles set substantive_updated_at = now(), updated_reason = '시험용 실질 수정' where id = $1", [w.E4.id]);

  await setFlags({ region_hubs: true, sm_calculator: false });
  api = await import("./index.ts");
});

afterAll(async () => {
  if (!db) return;
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const ids = made.articles;
    await db.query("delete from public.source_review_queue where article_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.article_sources where article_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.editorial_reviews where article_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.article_revisions where article_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [ids]);
    await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [made.snapshots]);
    await db.query("delete from public.people where id = any($1::bigint[])", [made.people]);
    await db.query("delete from public.regions where code = any($1::text[])", [made.regions]);
    if (flags0) await db.query("update public.settings set value = $1 where key = 'feature_flags'", [flags0]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    await db.end();
  }
});

const official = (page) => page.blocks.find((b) => b.key === "official");

describe("⑤ 공식 자료/해설 — 검수 공식 자료 카드 + 감수 해설만 (REG1-02 · REG1-07 · REG1-13)", () => {
  test("시·군·구 허브 — 그 지역 공개 기사의 검수 자료만 (스냅샷 없음·자료 종류 빔·옛 판·보도자료·초안·광고·편집 분야 없음·다른 시·군·구 0)", async () => {
    const page = await api.getRegionPage(w.sidoSlug, `tonghap-${RUN}-gu`);
    const block = official(page);
    expect(block.sources.map((c) => c.href).sort()).toEqual([docUrl("S1"), docUrl("S4")].sort());
    const s1 = block.sources.find((c) => c.href === docUrl("S1"));
    expect(s1).toMatchObject({ id: w.S1.id, issuer: "시험용 통합도청", license: "공공누리 제1유형 (출처표시)", typeLabel: "지방세 세수", underReview: false, verifiedOn: w.S1.verifiedOn });
    expect(s1.articles).toEqual([{ id: w.A1.id, title: "시험용 A1", href: `/news/${w.A1.slug}` }]);
    expect(block.sources.find((c) => c.href === docUrl("S4")).title).toBe("시험용 새 판");
    expect(block.items.map((a) => a.id)).toEqual([w.E1.id]);
    expect(block.empty).toBeNull();
    // 데이터 출처 줄 — 공식 자료 발표기관 · 가장 이른 기준일 · 가장 이른 확인일
    expect(page.source).toEqual({ source: "시험용 통합도청", baseDate: "2026-08-31", checkedAt: [w.S1.verifiedOn, w.S5.verifiedOn].sort()[0] });
  });

  test("시·도 허브 — 자기 + 하위 시·군·구 태그, 같은 원문 주소는 카드 한 장(다룬 기사 함께)·열린 검수 → 검토 중", async () => {
    const page = await api.getRegionPage(w.sidoSlug, null);
    const block = official(page);
    expect(block.sources.map((c) => c.href).sort()).toEqual([docUrl("S1"), docUrl("S11"), docUrl("S4")].sort());
    const same = block.sources.find((c) => c.href === docUrl("S1"));
    expect(same.id).toBe(w.S7.id);
    expect(same.underReview).toBe(true);
    expect(same.articles.map((a) => a.id).sort()).toEqual([w.A1.id, w.A2.id].sort());
    expect(page.source.source).toBe("시험용 통합도청·시험용 이웃구청");
    expect(page.source.baseDate).toBe("2026-03-31");
  });

  test("지역 세금 연결 블록 — 지방세 감수 해설·공식 원문(검토 중 표시), SM 카드는 sm_calculator 꺼짐이면 0, 상황 카드는 지자체뉴스·부동산 줄만", async () => {
    const page = await api.getRegionPage(w.sidoSlug, `tonghap-${RUN}-gu`);
    expect(page.taxLinks).not.toBeNull();
    expect(page.taxLinks.explainers.map((a) => a.id)).toEqual([w.E2.id]);
    expect(page.taxLinks.originals.map((o) => o.href).sort()).toEqual([docUrl("S1"), docUrl("S4")].sort());
    expect(page.taxLinks.sm).toBeNull();
    for (const s of page.taxLinks.situations) expect(["local", "realestate"]).toContain(s.section);
    const sido = await api.getRegionPage(w.sidoSlug, null);
    expect(sido.taxLinks.originals.find((o) => o.href === docUrl("S1")).underReview).toBe(true);
  });
});

describe("GET /api/regions/{code}/articles 데이터 (5.6)", () => {
  test("시·군·구 — 그 지역 공개 지역 기사만(초안·광고·편집 분야 없음·다른 시·군·구 0) · source·verifiedAt·status", async () => {
    const body = await api.getRegionArticles(GU, null, 1);
    expect(body.region).toEqual({ code: GU, name: "시험용 통합구", level: "sigungu" });
    expect(body.items.map((a) => a.id)).toEqual([w.A1.id, w.E1.id, w.E2.id, w.E3.id, w.E4.id]);
    expect(body).toMatchObject({ topic: null, page: 1, pageSize: 20, total: 5, hasMore: false });
    const a1 = body.items[0];
    expect(a1).toMatchObject({ source: "시험용 통합도청", status: "published", url: `/news/${w.A1.slug}`, editorialField: "local_tax", author: "통합 시험 지역 기자" });
    expect(a1.verifiedAt).toBe([w.S1.verifiedOn, w.S5.verifiedOn].sort()[0]);
    expect(body.items.find((a) => a.id === w.E1.id)).toMatchObject({ source: "편집국", verifiedAt: null, status: "published" });
  });

  test("topic = 그 편집 분야만 · 시·도 = 자기 + 하위 · 열린 검수가 있는 기사는 under_review", async () => {
    expect((await api.getRegionArticles(GU, "urban_policy", 1)).items.map((a) => a.id)).toEqual([w.E3.id]);
    const sido = await api.getRegionArticles(SIDO, "realestate", 1);
    expect(sido.items.map((a) => [a.id, a.status])).toEqual([[w.A2.id, "under_review"]]);
    expect((await api.getRegionArticles(SIDO, null, 1)).items.map((a) => a.id)).toEqual([w.A1.id, w.A2.id, w.A6.id, w.E1.id, w.E2.id, w.E3.id, w.E4.id]);
  });

  test("끝을 넘긴 쪽·없는 지역·기능 키 꺼짐 → null (404)", async () => {
    expect(await api.getRegionArticles(GU, null, 2)).toBeNull();
    expect(await api.getRegionArticles("9909900000", null, 1)).toBeNull();
    await setFlags({ region_hubs: false });
    try {
      expect(await api.getRegionArticles(GU, null, 1)).toBeNull();
    } finally {
      await setFlags({ region_hubs: true });
    }
  });
});

describe("/local 전국 화면 (5장 /local 줄 · REG-10)", () => {
  test("시·도 카드 — 오늘 유효한 시·도 전부(실제 16 + 시험용), region_hubs가 켜졌을 때만 링크", async () => {
    const hub = await api.getHubData("local");
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const seed = (
      await db.query("select code from public.regions where level = 'sido' and code not like '99%' and (valid_from is null or valid_from <= $1) and (valid_to is null or valid_to >= $1) order by code", [today])
    ).rows.map((r) => r.code);
    expect(seed).toHaveLength(16); // 전국 적재(2026-07-29 원본) — 광주·전남은 전남광주통합특별시로 통합
    expect(hub.local.sido.map((c) => c.code)).toEqual([...seed, SIDO].sort());
    expect(hub.local.sido.find((c) => c.code === SIDO).href).toBe(`/local/${w.sidoSlug}`);
    await setFlags({ region_hubs: false });
    try {
      const closed = await api.getHubData("local");
      expect(closed.local.sido.every((c) => c.href === null)).toBe(true);
    } finally {
      await setFlags({ region_hubs: true });
    }
  });

  test("⑤ 전국 — 검수 공식 자료(지역 태그 공개 기사)·감수 해설 · 분야를 고르면 블록·시·도 카드 0, 출처 줄은 그대로", async () => {
    const hub = await api.getHubData("local");
    const hrefs = hub.blocks.official.cards.map((c) => c.href);
    for (const k of ["S1", "S4", "S11"]) expect(hrefs).toContain(docUrl(k));
    for (const k of ["S2", "S3", "S8", "S9", "S10"]) expect(hrefs).not.toContain(docUrl(k));
    expect(hub.blocks.official.explainers.map((a) => a.id)).toContain(w.E1.id);
    expect(hub.blocks.official.explainers.map((a) => a.id)).not.toContain(w.E4.id);
    expect(hub.local.source).toHaveProperty("checkedAt");
    const topic = await api.getHubData("local", { topic: "urban_policy" });
    expect(topic.blocks).toBeNull();
    expect(topic.local.sido).toEqual([]);
    expect(topic.local.source).toHaveProperty("source");
  });
});
