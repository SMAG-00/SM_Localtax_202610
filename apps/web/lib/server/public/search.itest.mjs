// 통합 검색 서버 함수 통합 시험 (W2-d 1단계 — docs/dev/W2-d_설계.md 7·8장) — 로컬 Supabase의 실제 API(PostgREST)에 anon 키로 search_public을 부른다.
// 공개·비공개 행을 DB에 직접 넣고(커밋 — anon 요청은 다른 연결) searchSite 결과를 본다: 띄어쓰기 변형 같은 결과 · 구어 검색 · 비공개 0 ·
// 주소는 열린 화면만(기능 키) · 탭·종류별 묶음 · 캐시하지 않음(no-store, 비공개로 바꾸면 다음 검색에 바로 0) · 부를 것이 없으면 요청 0.
// 끝나면 만든 행을 지우고 기능 공개 목록을 되돌린다. 로컬 DB에서만 돈다. 실행: pnpm --filter @ltr/web test:integration
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const M = `통합검색${RUN.replace(/[^a-z]/g, "").slice(0, 4)}표식`;

let db;
let api;
let savedFlags;
const w = {};
const made = { people: [], articles: [], situations: [], amendments: [], snapshots: [], glossary: [], regions: [] };
const calls = [];
const realFetch = globalThis.fetch;

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

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
async function insert(table, cols, bucket) {
  const keys = Object.keys(cols);
  const row = await one(`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => cols[k]));
  made[bucket].push(row.id ?? row.code);
  return row;
}
const para = (text) => JSON.stringify({ blocks: [{ type: "paragraph", text }], claims: [] });
const setFlags = (flags) => db.query("update public.settings set value = $1 where key = 'feature_flags'", [JSON.stringify(flags)]);
const options = (over = {}) => ({ q: "", tab: "all", section: null, contentType: null, region: null, from: null, to: null, page: 1, ...over });
const refs = (r) => r.items.map((i) => `${i.kind}:${i.ref}`).sort();
const rpcCalls = () => calls.filter((c) => c.url.includes("/rpc/search_public"));

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  savedFlags = (await one("select value from public.settings where key = 'feature_flags'")).value;

  w.reporter = await insert("people", { slug: `it-search-${RUN}`, name: "검색 통합 기자", roles: ["reporter"], visibility: "public" }, "people");
  w.reviewer = await insert("people", { slug: `it-search-rv-${RUN}`, name: "검색 통합 감수", roles: ["reviewer"] }, "people");
  const article = (slug, over) =>
    insert("articles", { slug: `it-search-${slug}-${RUN}`, title: `${M} 기사`, section: "tax", content_type: "explainer", status: "published", author_id: w.reporter.id, body: para("본문"), ...over }, "articles");
  w.title = await article("title", { title: `${M} 취득세 감면 안내`, first_published_at: "2026-10-01T15:30:00Z" });
  w.body = await article("body", { title: `${M} 부동산 거래`, body: para("주택을 사면 취득 세 신고를 60일 안에") });
  w.notIt = await article("not", { title: `${M} 취득 시 세율` });
  w.draft = await article("draft", { title: `${M} 취득세 초안`, status: "draft" });
  w.held = await article("held", { title: `${M} 취득세 곧 보류` });
  w.reported = await article("reported", { title: `${M} 취득세 보도`, content_type: "reported_news", reporting_method: "qualitative" });

  w.situation = await insert(
    "situations",
    {
      slug: `it-search-car-${RUN}`,
      section: "tax",
      title: `차를 팔았어요·폐차했어요 ${M}`,
      pictogram: "car-sold",
      checks: JSON.stringify([{ title: "하나" }, { title: "둘" }, { title: "셋" }]),
      visible: true,
      reviewer_id: w.reviewer.id,
      reviewed_at: new Date(),
    },
    "situations",
  );
  w.tracker = await insert("amendments", { slug: `it-search-reform-${RUN}`, title: `2026년 지방세제 개편안 ${M}`, status: "public" }, "amendments");
  const snap = await insert("raw_snapshots", { source: "mois", url: "https://www.mois.go.kr/it", content_hash: "h", payload: "원문" }, "snapshots");
  await db.query("insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, 'announced', '2026-08-01', 'https://www.mois.go.kr/it', $2, 'user:시험')", [
    w.tracker.id,
    snap.id,
  ]);
  w.term = await insert("glossary_terms", { term: `${M} 취득세`, plain: "부동산을 살 때 내는 지방세" }, "glossary");
  w.region = await insert("regions", { code: "1179700000", parent_code: "1100000000", level: "sigungu", slug: `it-search-gu-${RUN}`, name: `${M}구` }, "regions");

  globalThis.fetch = (input, init) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), init: init ?? {} });
    return realFetch(input, init);
  };
  api = await import("./index.ts");
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (!db) return;
  await db.query("begin");
  try {
    if (savedFlags !== undefined) await setFlags(savedFlags);
    await db.query("set local session_replication_role = replica"); // 추가만 되는 단계 기록을 지운다
    await db.query("delete from public.situations where id = any($1::bigint[])", [made.situations]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [made.articles]);
    await db.query("delete from public.amendment_events where amendment_id = any($1::bigint[])", [made.amendments]);
    await db.query("delete from public.amendments where id = any($1::bigint[])", [made.amendments]);
    await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [made.snapshots]);
    await db.query("delete from public.glossary_terms where id = any($1::bigint[])", [made.glossary]);
    await db.query("delete from public.regions where code = any($1::text[])", [made.regions]);
    await db.query("delete from public.people where id = any($1::bigint[])", [made.people]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    await db.end();
  }
});

describe("검색 결과 (SRCH-01 — 실제 API·anon 키)", () => {
  test("'취득세'와 '취득 세'는 같은 결과 — 공개 행만(초안 0), '취득 시 세율' 0", async () => {
    const a = await api.searchSite(options({ q: `${M} 취득세` }));
    const b = await api.searchSite(options({ q: `${M} 취득 세` }));
    expect(refs(a)).toEqual(refs(b));
    expect(refs(a)).toEqual(
      [`article:${w.title.id}`, `article:${w.body.id}`, `article:${w.held.id}`, `article:${w.reported.id}`, `glossary:${w.term.id}`].sort(),
    );
    expect(b.terms).toEqual([M.toLowerCase(), "취득세"]);
  });

  test("기사 보기 값 — /news 주소·유형 배지·한국 날짜, 용어는 용어사전 화면 전이라 링크 0, 같은 등급 안 용어가 기사보다 먼저", async () => {
    const r = await api.searchSite(options({ q: `${M} 취득세` }));
    const art = r.items.find((i) => i.ref === String(w.title.id));
    expect(art).toMatchObject({ kind: "article", href: `/news/it-search-title-${RUN}`, typeLabel: "해설", publishedOn: "2026-10-02", sectionName: "지방세", tier: 1 });
    const term = r.items.find((i) => i.kind === "glossary");
    expect(term).toMatchObject({ href: null, typeLabel: "용어", snippet: "부동산을 살 때 내는 지방세", tier: 0 });
    expect(r.items[0].kind).toBe("glossary");
    expect(r.counts).toMatchObject({ article: 4, glossary: 1, tracker: 0 });
  });

  test("'차 팔았' → 상황, '개편안' → 트래커(기능 키가 꺼지면 링크 0 + 현재 단계 원문, 켜면 트래커 주소)", async () => {
    const car = await api.searchSite(options({ q: `차 팔았 ${M}` }));
    expect(car.items.map((i) => `${i.kind}:${i.ref}`)).toEqual([`situation:${w.situation.id}`]);
    expect(car.items[0]).toMatchObject({ href: `/situations/it-search-car-${RUN}`, typeLabel: "상황" });
    const reform = await api.searchSite(options({ q: `개편안 ${M}` }));
    expect(reform.items.map((i) => `${i.kind}:${i.ref}`)).toEqual([`tracker:${w.tracker.id}`]);
    expect(reform.items[0]).toMatchObject({ href: null, stage: "announced", stageOn: "2026-08-01", sourceUrl: "https://www.mois.go.kr/it", typeLabel: "개정 트래커" });
    await setFlags({ ...savedFlags, amendments: true, region_hubs: true });
    try {
      expect((await api.searchSite(options({ q: `개편안 ${M}` }))).items[0].href).toBe(`/tax/amendments/it-search-reform-${RUN}`);
      const gu = (await api.searchSite(options({ q: `${M}구` }))).items.find((i) => i.kind === "region");
      expect(gu).toMatchObject({ href: `/local/seoul/it-search-gu-${RUN}`, parentName: "서울특별시", tier: 0 });
    } finally {
      await setFlags(savedFlags);
    }
    const closed = (await api.searchSite(options({ q: `${M}구` }))).items.find((i) => i.kind === "region");
    expect(closed.href).toBeNull();
  });

  test("기사 유형·탭·종류별 묶음 — reported_news만 고르면 다른 유형 0, 용어 탭은 용어만이지만 탭 숫자는 모든 종류", async () => {
    const reported = await api.searchSite(options({ q: `${M} 취득세`, contentType: "reported_news" }));
    expect(reported.items.map((i) => [i.kind, i.contentType])).toEqual([["article", "reported_news"]]);
    const tab = await api.searchSite(options({ q: `${M} 취득세`, tab: "glossary" }));
    expect(tab.items.map((i) => i.kind)).toEqual(["glossary"]);
    expect(tab.total).toBe(1);
    expect(tab.counts.article).toBe(4);
    const grouped = await api.searchSite(options({ q: M }), { perKind: 2 });
    expect(grouped.items.map((i) => i.kind)).toEqual(["region", "situation", "tracker", "glossary", "article", "article"]);
    expect(grouped.hasMore).toBe(false);
    const page = await api.searchSite(options({ q: M, tab: "article" }), { pageSize: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });
});

describe("캐시·요청 (설계 8장)", () => {
  test("검색 요청은 no-store이고 공개 데이터 태그(next)가 없다 — 공개로 읽힌 기사를 보류로 바꾸면 다음 검색에 바로 0", async () => {
    calls.length = 0;
    const before = await api.searchSite(options({ q: `${M} 곧 보류` }));
    expect(refs(before)).toEqual([`article:${w.held.id}`]);
    const [call] = rpcCalls();
    expect(call.init.cache).toBe("no-store");
    expect(call.init.next).toBeUndefined();
    await db.query("update public.articles set status = 'held' where id = $1", [w.held.id]);
    expect((await api.searchSite(options({ q: `${M} 곧 보류` }))).items).toEqual([]);
  });

  test("부를 것이 없으면 DB 요청 0 — 남는 글자 없는 검색어 · 종류 없는 탭(행사·전문가) · 건너뛰기 한도를 넘는 쪽", async () => {
    calls.length = 0;
    for (const o of [options({ q: "  ?!·  " }), options({ q: M, tab: "event" }), options({ q: M, tab: "expert" }), options({ q: M, page: 52 })]) {
      const r = await api.searchSite(o);
      expect(r).toMatchObject({ total: 0, items: [], hasMore: false });
    }
    expect(rpcCalls()).toHaveLength(0);
  });
});
