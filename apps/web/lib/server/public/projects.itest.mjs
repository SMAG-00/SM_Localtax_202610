// 프로젝트 공개 화면 통합 시험 (W4 15단계 — docs/dev/W4_설계.md 1장 15단계 · 4장 · 5장 · 12장 #99 · #103 · #120~, PRD-01B PR-01 · PR-02 · PR-03 · PR-05)
// 로컬 Supabase에 anon 키로 읽는다 (경계 = 공개 뷰 public_projects · public_project_events · public_project_stage_lists · public_project_search · public_regional_links).
// 시험 세계: 시험용 시·도 1 + 시·군·구 2(접두 99 가짜 코드 — 설계 8장) · 시험용 사업 유형 1(단계 4) · 공개 프로젝트 2(시·군·구 A·B) · 초안 프로젝트 1 ·
// 공개 기사 2(프로젝트 → 기사 · 기사 → 프로젝트 연결) · 지역 → 프로젝트 확인된 연결 1. 끝나면 만든 행을 모두 지우고 기능 키·사업 유형 설정을 되돌린다.
// 실행: pnpm --filter @ltr/web test:integration
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const SIDO = "9900000000";
const GU = "9901100000";
const GU2 = "9901200000";
const ACTOR = "user:itest-w4pp";
const TYPE = "siheom_pp";
const PRICE = ["price", "cost", "contribution", "yield", "return", "profit", "premium", "market", "appraisal", "sale_amount", "bunyang", "분양가", "분담금", "수익", "시세", "프리미엄"];

let db;
let api;
let projects;
const saved = {};
const w = {};
const made = { people: [], articles: [], snapshots: [], regions: [], projects: [], links: [] };

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
const flags = (over) => setSetting("feature_flags", { ...saved.feature_flags, region_hubs: false, realestate_projects: false, ...over });
const keysOf = (v) => (Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
const priceKeys = (v) => keysOf(v).filter((k) => PRICE.some((p) => k.toLowerCase().replaceAll("_", "").includes(p.replaceAll("_", ""))));

async function project(key, cols) {
  const p = await insert("projects", { slug: `siheom-pp-${key.toLowerCase()}-${RUN}`, name: cols.name, summary: cols.summary ?? null, region_code: cols.region, project_type: TYPE, landmark: cols.landmark ?? false, created_by: ACTOR }, "projects");
  for (const [i, e] of (cols.events ?? []).entries()) {
    const url = `https://gov.example.test/itest-w4pp-${RUN}/${key}/${i}`;
    const snap = await insert("raw_snapshots", { source: "itest", url, content_hash: `sha256:w4pp-${key}-${i}-${RUN}`, payload: "시험용 고시 원문" }, "snapshots");
    const row = await insert("project_events", {
      project_id: p.id,
      kind: "stage",
      stage: e.stage,
      notice_no: `시험용 고시 제${i + 1}호`,
      notice_date: e.date,
      issuer: "시험용 사업구청",
      source_url: url,
      snapshot_id: snap.id,
      license_type: e.license ?? "kogl_1",
      recorded_by: ACTOR,
    });
    e.id = Number(row.id);
    e.url = url;
  }
  if (cols.public) await db.query("update public.projects set status = 'public', source_name = '시험용 사업구청', last_verified_at = $2 where id = $1", [p.id, hoursAgo(5)]);
  w[key] = { id: Number(p.id), slug: p.slug, events: cols.events ?? [] };
  return w[key];
}
async function link(fromType, fromId, toType, toId, hours) {
  const row = await insert(
    "regional_links",
    {
      from_type: fromType,
      from_id: String(fromId),
      to_type: toType,
      to_id: String(toId),
      relation: toType === "project" || fromType === "project" ? "related_project" : "same_region",
      origin: "editor",
      status: "confirmed",
      reason: "시험용 연결 이유",
      confirmed_by: ACTOR,
      confirmed_at: hoursAgo(hours),
      created_by: ACTOR,
    },
    "links",
  );
  return Number(row.id);
}

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  for (const k of ["feature_flags", "project_types", "project_stage_lists"]) saved[k] = (await one("select value from public.settings where key = $1", [k])).value;
  expect(saved.feature_flags.realestate_projects).toBe(false);
  expect((await one("select count(*)::int n from public.regions where code like '99%'")).n).toBe(0);

  w.reporter = await insert("people", { slug: `it-w4pp-reporter-${RUN}`, name: "통합 시험 프로젝트 기자", roles: ["reporter"], visibility: "public" }, "people");
  w.sidoSlug = `itest-pp-${RUN}`;
  await insert("regions", { code: SIDO, level: "sido", name: "시험용 사업도", slug: w.sidoSlug }, "regions");
  await insert("regions", { code: GU, parent_code: SIDO, level: "sigungu", name: "시험용 사업구", slug: `saeop-${RUN}-gu` }, "regions");
  await insert("regions", { code: GU2, parent_code: SIDO, level: "sigungu", name: "시험용 옆구", slug: `yeop-${RUN}-gu` }, "regions");
  await setSetting("project_types", { [TYPE]: { label: "시험용 정비사업" } });
  await setSetting("project_stage_lists", {
    [TYPE]: [
      { key: "zone", label: "시험용 구역지정" },
      { key: "plan", label: "시험용 계획인가" },
      { key: "build", label: "시험용 착공" },
      { key: "done", label: "시험용 준공" },
    ],
  });
  await project("A", {
    name: "시험용 하늘가구역 정비",
    summary: "시험용 요약 — 편집자가 쓴 한 줄",
    region: GU,
    public: true,
    events: [
      { stage: "zone", date: "2026-01-15" },
      { stage: "plan", date: "2026-03-02", license: "unmarked" },
    ],
  });
  await project("B", { name: "시험용 하늘나구역 정비", region: GU2, public: true, landmark: true, events: [{ stage: "zone", date: "2026-02-01" }] });
  await project("C", { name: "시험용 하늘다구역 정비(초안)", region: GU, public: false, events: [{ stage: "zone", date: "2026-02-03" }] });

  for (const [key, hours] of [
    ["N1", 1],
    ["N2", 2],
  ]) {
    const row = await insert(
      "articles",
      {
        slug: `it-w4pp-${key}-${RUN}`,
        title: `시험용 프로젝트 기사 ${key}`,
        summary: "시험용 부동산 기사 요약입니다",
        section: "realestate",
        content_type: "reported_news",
        status: "published",
        author_id: w.reporter.id,
        first_published_at: hoursAgo(hours),
      },
      "articles",
    );
    w[key] = { id: Number(row.id), slug: row.slug };
  }
  w.lFrom = await link("project", w.A.id, "article", w.N1.id, 3);
  w.lTo = await link("article", w.N2.id, "project", w.A.id, 1);
  w.lRegion = await link("region", SIDO, "project", w.A.id, 2);
  await flags({});
  api = await import("./index.ts");
  projects = await import("./projects.ts");
});

afterAll(async () => {
  if (!db) return;
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.regional_links where id = any($1::bigint[])", [made.links]);
    await db.query("delete from public.source_review_queue where target_type = 'project_event' and target_id in (select id from public.project_events where project_id = any($1::bigint[]))", [made.projects]);
    await db.query("delete from public.project_events where project_id = any($1::bigint[])", [made.projects]);
    await db.query("delete from public.projects where id = any($1::bigint[])", [made.projects]);
    await db.query("delete from public.article_revisions where article_id = any($1::bigint[])", [made.articles]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [made.articles]);
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

describe("기능 키 realestate_projects 꺼짐 — 화면 함수 null · 검색 0 · 허브 카드 0 (2.4)", () => {
  test("목록·상세 null(화면은 하위 분야 목록·404) · 지역 허브 카드 0 · 검색 결과 프로젝트 0", async () => {
    expect(await projects.getProjectList()).toBeNull();
    expect(await projects.getProject(w.A.slug)).toBeNull();
    expect(await projects.readRegionProjects(SIDO, [SIDO, GU, GU2])).toEqual({ cards: [], more: null });
    const r = await api.searchSite({ q: "시험용 하늘", tab: "tracker", section: null, contentType: null, region: null, from: null, to: null, page: 1 });
    expect(r.counts.project).toBe(0);
    expect(r.items.filter((h) => h.kind === "project")).toEqual([]);
  });
});

describe("기능 키 켜짐 — 공개 프로젝트만 (anon)", () => {
  test("목록 — 공개 2(초안 0) · 대표 먼저 · 카드 전수 지역·단계·출처·기준일·확인일 · 거르개 칩(있는 값만)", async () => {
    await flags({ realestate_projects: true });
    try {
      const v = await projects.getProjectList();
      expect(v.items.map((c) => c.slug)).toEqual([w.B.slug, w.A.slug]);
      expect(v.total).toBe(2);
      for (const c of v.items) {
        expect(c.region.code).toMatch(/^99\d{8}$/);
        expect(c.region.name).toMatch(/^시험용 사업도 시험용/);
        expect(c.stage.label).toMatch(/^시험용 /);
        expect(c.stage.noticeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(c.source).toBe("시험용 사업구청");
        expect(c.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(c.region.href).toBeNull(); // region_hubs 꺼짐 — 허브 링크 0
      }
      expect(v.items.find((c) => c.slug === w.A.slug).stage).toEqual({ key: "plan", label: "시험용 계획인가", noticeDate: "2026-03-02" });
      expect(v.chips.regions.map((c) => [c.value, c.count])).toEqual([
        [null, 0],
        [SIDO, 2],
      ]);
      expect(v.chips.types.map((c) => c.value)).toEqual([null, TYPE]);
      expect(v.breadcrumb.items.map((i) => i.name)).toEqual(["홈", "부동산", "프로젝트 트래커"]);
      expect(v.sourceLine).toMatchObject({ source: "시험용 사업구청", baseDate: "2026-02-01" });
      const byRegion = await projects.getProjectList({ region: GU2, type: null, stage: null });
      expect(byRegion.items.map((c) => c.slug)).toEqual([w.B.slug]);
      const byStage = await projects.getProjectList({ region: null, type: TYPE, stage: "plan" });
      expect(byStage.items.map((c) => c.slug)).toEqual([w.A.slug]);
      expect(byStage.chips.stages.map((c) => c.value)).toEqual([null, "zone", "plan"]);
      expect(priceKeys(v)).toEqual([]);
    } finally {
      await flags({});
    }
  });

  test("상세 — 전체 단계 4(기록 2·기록 없음 2) · 원문 연결률 100% · 공공누리 · 관련 기사 두 방향(최근 확인 순) · 초안 null · API 모양", async () => {
    await flags({ realestate_projects: true });
    try {
      const v = await projects.getProject(w.A.slug);
      expect(v.timeline.map((s) => [s.key, s.status])).toEqual([
        ["zone", "recorded"],
        ["plan", "recorded"],
        ["build", "none"],
        ["done", "none"],
      ]);
      expect(v.timeline[0].record).toMatchObject({ noticeNo: "시험용 고시 제1호", noticeDate: "2026-01-15", issuer: "시험용 사업구청", sourceUrl: w.A.events[0].url, licenseType: "kogl_1", underReview: false });
      expect(v.timeline[1].record.licenseType).toBe("unmarked");
      expect(v.coverage).toEqual({ recorded: 2, linked: 2 });
      expect(v.articles.map((a) => a.slug)).toEqual([w.N2.slug, w.N1.slug]);
      expect(v.links).toEqual([]); // 기사 연결은 관련 기사 자리 — 확인된 연결 자리에는 공식 원문·프로젝트·지역만
      expect(v.breadcrumb.items.map((i) => i.name)).toEqual(["홈", "부동산", "프로젝트 트래커", "시험용 하늘가구역 정비"]);
      expect(await projects.getProject(w.C.slug)).toBeNull();
      expect(await projects.getProject(`siheom-pp-none-${RUN}`)).toBeNull();
      expect(priceKeys(v)).toEqual([]);
      // 원문을 다시 받아 해시가 달라지면 그 단계 '검토 중'
      const q = await one(
        "insert into public.source_review_queue (target_type, target_id, reason, old_hash, new_hash, new_snapshot_id, opened_by) values ('project_event', $1, 'snapshot_changed', $2, $3, (select snapshot_id from public.project_events where id = $1), $4) returning id",
        [w.A.events[1].id, `sha256:${"b".repeat(64)}`, `sha256:${"a".repeat(64)}`, ACTOR],
      );
      try {
        const again = await projects.getProject(w.A.slug);
        expect(again.timeline[1].record.underReview).toBe(true);
      } finally {
        await db.query("delete from public.source_review_queue where id = $1", [q.id]);
      }
      // 마지막 공개 단계를 거두면 현재 단계가 앞으로(다음 읽기부터)
      await insert("project_events", { project_id: w.A.id, kind: "correction", correction_of: w.A.events[1].id, reason: "시험용 거두기", recorded_by: ACTOR });
      const after = await projects.getProject(w.A.slug);
      expect(after.card.stage.key).toBe("zone");
      expect(after.timeline.map((s) => s.status)).toEqual(["recorded", "none", "none", "none"]);
    } finally {
      await flags({});
    }
  });

  test("지역 허브 ③ 카드 — 시·도 범위 = 자기 + 하위 · 지역 출발 확인된 연결 먼저 · 시·군·구는 그 지역만 · 검색 결과 프로젝트(열린 화면 링크)", async () => {
    await flags({ realestate_projects: true });
    try {
      // region_hubs 꺼짐 — 지역 끝 연결은 공개 뷰에 없다 → 목록 차례(대표 B 먼저)
      const sido = await projects.readRegionProjects(SIDO, [SIDO, GU, GU2]);
      expect(sido.cards.map((c) => c.slug)).toEqual([w.B.slug, w.A.slug]);
      expect(sido.more).toBeNull();
      // region_hubs 켜짐 — 그 지역에서 출발한 확인된 연결의 프로젝트(A)가 먼저
      await flags({ realestate_projects: true, region_hubs: true });
      expect((await projects.readRegionProjects(SIDO, [SIDO, GU, GU2])).cards.map((c) => c.slug)).toEqual([w.A.slug, w.B.slug]);
      expect((await projects.readRegionProjects(SIDO, [SIDO, GU, GU2])).cards[0].region.href).toBe(`/local/${w.sidoSlug}/saeop-${RUN}-gu`);
      await flags({ realestate_projects: true });
      const gu = await projects.readRegionProjects(GU, [GU]);
      expect(gu.cards.map((c) => c.slug)).toEqual([w.A.slug]);
      const r = await api.searchSite({ q: "시험용 하늘", tab: "tracker", section: null, contentType: null, region: null, from: null, to: null, page: 1 });
      const hits = r.items.filter((h) => h.kind === "project");
      expect(hits.map((h) => h.href).sort()).toEqual([`/realestate/projects/${w.A.slug}`, `/realestate/projects/${w.B.slug}`].sort());
      expect(r.counts.project).toBe(2);
      expect(hits.find((h) => h.href.endsWith(w.B.slug))).toMatchObject({ typeLabel: "프로젝트", stageLabel: "시험용 구역지정", projectTypeLabel: "시험용 정비사업", regionCode: GU2 });
    } finally {
      await flags({});
    }
  });
});
