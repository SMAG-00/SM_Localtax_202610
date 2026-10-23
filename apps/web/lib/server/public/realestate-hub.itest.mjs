// /realestate 허브 확장 통합 시험 (W4 22단계 — docs/dev/W4_설계.md 1장 22단계 · 5장, PRD-01B PR-01)
// 로컬 Supabase에 anon 키로 읽는다 (새 표·뷰 0 — 기존 공개 뷰 public_projects·public_supply_notices와 설정 feature_flags·pilot_regions).
// 시험 세계: 시험용 시·도 1 + 시·군·구 2(접두 99 가짜 코드 — 설계 8장) · 시험용 사업 유형 1 · 공개 프로젝트 대표 L·비대표 N · 공개 분양 정보 1.
// 끝나면 만든 행을 모두 지우고 설정(feature_flags·pilot_regions·project_types·project_stage_lists)을 시험 전 값으로 되돌린다.
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
const ACTOR = "user:itest-w4reh";
const TYPE = "siheom_reh";
const ANCHORED = /^\/local\/[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)?#realestate$/;
const kstDay = (offset) => new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);

let db;
let hub;
const saved = {};
const w = {};
const made = { notices: [], snapshots: [], regions: [], projects: [] };

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
const setSetting = (key, value) => db.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
const flags = (over) =>
  setSetting("feature_flags", { ...saved.feature_flags, region_hubs: false, realestate_projects: false, supply_notices: false, dev_methods: false, inheritance_gift: false, ...over });

async function project(key, landmark) {
  const p = await insert("projects", { slug: `siheom-reh-${key}-${RUN}`, name: `시험용 ${key} 정비`, region_code: GU, project_type: TYPE, created_by: ACTOR }, "projects");
  const url = `https://gov.example.test/itest-w4reh-${RUN}/${key}`;
  const snap = await insert("raw_snapshots", { source: "itest", url, content_hash: `sha256:w4reh-${key}-${RUN}`, payload: "시험용 고시 원문" }, "snapshots");
  await insert("project_events", { project_id: p.id, kind: "stage", stage: "zone", notice_no: `시험용 고시 ${key}`, notice_date: "2026-01-15", issuer: "시험용 구청", source_url: url, snapshot_id: snap.id, license_type: "kogl_1", recorded_by: ACTOR });
  await db.query("update public.projects set status = 'public', landmark = $2, source_name = '시험용 구청', last_verified_at = now() where id = $1", [p.id, landmark]);
  w[key] = Number(p.id);
}

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  for (const k of ["feature_flags", "pilot_regions", "project_types", "project_stage_lists"]) saved[k] = (await one("select value from public.settings where key = $1", [k])).value;
  expect(saved.feature_flags.realestate_projects).toBe(false);
  // 상속·증여 키 켜기 조건(W4 26단계) — 세무 감수 승인된 입문 기사 1건. 발행 절차는 다른 시험 몫이라 트리거를 끈 세션으로 직접 넣는다
  {
    const cat = await one("select id from public.categories where section = 'realestate' and slug = 'inheritance-gift'");
    const person = await one("insert into public.people (name, slug, roles) values ('시험용 감수위원', $1, '{reviewer}') returning id", [`itest-reh-rv-${RUN}`]);
    w.person = Number(person.id);
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      const a = await one(
        `insert into public.articles (slug, title, summary, section, content_type, status, category_id, tax_review_status, first_published_at)
         values ($1, '시험용 입문 기사', '시험용 요약', 'realestate', 'explainer', 'published', $2, 'approved', now()) returning id`,
        [`itest-reh-intro-${RUN}`, cat.id],
      );
      w.intro = Number(a.id);
      await db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, at) values ($1, 'tax_review', $2, 'approve', now())", [w.intro, w.person]);
      await db.query("commit");
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
  }
  expect((await one("select count(*)::int n from public.regions where code like '99%'")).n).toBe(0);

  w.sidoSlug = `itest-reh-${RUN}`;
  w.guSlug = `gu-${RUN}-a`;
  await insert("regions", { code: SIDO, level: "sido", name: "시험용 허브도", slug: w.sidoSlug }, "regions");
  await insert("regions", { code: GU, parent_code: SIDO, level: "sigungu", name: "시험용 허브구", slug: w.guSlug }, "regions");
  await insert("regions", { code: GU2, parent_code: SIDO, level: "sigungu", name: "시험용 옆구", slug: `gu-${RUN}-b` }, "regions");
  await setSetting("project_types", { [TYPE]: { label: "시험용 정비사업" } });
  await setSetting("project_stage_lists", { [TYPE]: [{ key: "zone", label: "시험용 구역지정" }, { key: "done", label: "시험용 준공" }] });
  await project("landmark", true);
  await project("plain", false);
  const n = await insert(
    "supply_notices",
    {
      name: "시험용 허브 분양",
      region_code: GU,
      supply_scale: "총 820세대 중 일반공급 410세대",
      apply_start: kstDay(1),
      apply_end: kstDay(3),
      notice_date: kstDay(-5),
      notice_issuer: "시험용 허브구청",
      official_notice_url: `https://gov.example.test/itest-w4reh-${RUN}/notice`,
      license_type: "kogl_1",
      status: "public",
      verified_at: "2026-10-27T01:00:00Z",
      created_by: ACTOR,
      updated_by: ACTOR,
    },
    "notices",
  );
  w.notice = Number(n.id);
  await flags({});
  hub = await import("./realestate-hub.ts");
});

afterAll(async () => {
  if (!db) return;
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.supply_notices where id = any($1::bigint[])", [made.notices]);
    await db.query("delete from public.project_events where project_id = any($1::bigint[])", [made.projects]);
    await db.query("delete from public.projects where id = any($1::bigint[])", [made.projects]);
    await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [made.snapshots]);
    await db.query("delete from public.regions where code = any($1::text[])", [made.regions]);
    if (w.intro) {
      await db.query("delete from public.editorial_reviews where article_id = $1", [w.intro]);
      await db.query("delete from public.articles where id = $1", [w.intro]);
    }
    if (w.person) await db.query("delete from public.people where id = $1", [w.person]);
    for (const [k, v] of Object.entries(saved)) await setSetting(k, v);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    await db.end();
  }
});

describe("기능 키가 모두 꺼짐 — 칩 0 · 프로젝트 0 · 분양 0 · 링크 카드 0", () => {
  test("region_hubs·realestate_projects·supply_notices·dev_methods·inheritance_gift 꺼짐 → 빈 값", async () => {
    await flags({});
    const v = await hub.readRealEstateHub();
    expect(v.chips).toEqual({ pilot: [], sido: [] });
    expect(v.projects).toEqual({ cards: [], all: null });
    expect(v.supply).toEqual({ cards: [], all: null });
    expect(v.links).toEqual([]);
  });
});

describe("지역 칩 — 시범 지역 + 시·도 전부, 모두 지역 허브 ③ 앵커", () => {
  test("region_hubs 켜짐 — 시·도 칩 수 = 오늘 유효한 시·도 수, 시험용 시·도 포함, 주소 전수 /local/…#realestate", async () => {
    await flags({ region_hubs: true });
    await setSetting("pilot_regions", [GU]);
    const v = await hub.readRealEstateHub();
    const today = kstDay(0);
    const expected = (await db.query("select code from public.regions where level = 'sido' and (valid_from is null or valid_from <= $1) and (valid_to is null or valid_to >= $1)", [today])).rows.length;
    expect(v.chips.sido).toHaveLength(expected);
    expect(v.chips.sido.length).toBeGreaterThanOrEqual(17); // 실제 시·도 16 + 시험용 1
    expect(v.chips.sido.map((c) => c.code)).toContain(SIDO);
    for (const c of [...v.chips.pilot, ...v.chips.sido]) expect(c.href, c.label).toMatch(ANCHORED);
    expect(v.chips.sido.find((c) => c.code === SIDO).href).toBe(`/local/${w.sidoSlug}#realestate`);
    expect(v.chips.pilot).toEqual([{ code: GU, label: "시험용 허브도 시험용 허브구", href: `/local/${w.sidoSlug}/${w.guSlug}#realestate`, kind: "pilot" }]);
  });

  test("시범 지역 설정이 비면 시범 칩 0, 시·도 칩은 그대로", async () => {
    await setSetting("pilot_regions", []);
    const v = await hub.readRealEstateHub();
    expect(v.chips.pilot).toEqual([]);
    expect(v.chips.sido.length).toBeGreaterThanOrEqual(17); // 실제 시·도 16 + 시험용 1
  });

  test("region_hubs를 끄면 칩 0 (404 링크 0)", async () => {
    await flags({});
    expect((await hub.readRealEstateHub()).chips).toEqual({ pilot: [], sido: [] });
  });
});

describe("대표 프로젝트 카드 — 대표만, 지역·단계·출처·기준일·확인일 전수", () => {
  test("realestate_projects 켜짐 — 비대표는 0, 대표 카드 칸이 모두 채워져 있고 전체 보기 주소", async () => {
    await flags({ region_hubs: true, realestate_projects: true });
    const v = await hub.readRealEstateHub();
    const mine = v.projects.cards.filter((c) => [w.landmark, w.plain].includes(c.id));
    expect(mine.map((c) => c.id)).toEqual([w.landmark]);
    const c = mine[0];
    expect([c.region.name, c.region.code, c.stage.label, c.stage.noticeDate, c.source, c.verifiedOn].every((x) => typeof x === "string" && x.length > 0)).toBe(true);
    expect([c.region.name, c.region.code, c.stage.label, c.stage.noticeDate, c.source]).toEqual(["시험용 허브도 시험용 허브구", GU, "시험용 구역지정", "2026-01-15", "시험용 구청"]);
    expect(v.projects.all).toBe("/realestate/projects");
    expect(v.projects.cards.length).toBeLessThanOrEqual(4);
  });

  test("대표 표시를 내리면 그 카드 0", async () => {
    await db.query("update public.projects set landmark = false where id = $1", [w.landmark]);
    const v = await hub.readRealEstateHub();
    expect(v.projects.cards.map((c) => c.id)).not.toContain(w.landmark);
    await db.query("update public.projects set landmark = true where id = $1", [w.landmark]);
  });
});

describe("분양 정보 카드 — 청약 마감 전만, 지역·단계·출처·기준일 전수", () => {
  test("supply_notices 켜짐 — 카드 칸이 모두 채워져 있고, 꺼짐이면 0장", async () => {
    await flags({ supply_notices: true });
    const v = await hub.readRealEstateHub();
    const c = v.supply.cards.find((x) => x.id === w.notice);
    expect(c).toBeTruthy();
    expect([c.region.name, c.region.code, c.phase.label, c.issuer, c.noticeDate, c.verifiedOn, c.noticeUrl].every((x) => typeof x === "string" && x.length > 0)).toBe(true);
    expect([c.region.code, c.phase.label, c.issuer, c.verifiedOn]).toEqual([GU, "청약 예정", "시험용 허브구청", "2026-10-27"]);
    expect(v.supply.all).toBe("/realestate/supply");
    expect(v.supply.cards.length).toBeLessThanOrEqual(4);
    await flags({});
    expect((await hub.readRealEstateHub()).supply).toEqual({ cards: [], all: null });
  });

  test("청약 마감이 지난 항목은 허브에 0", async () => {
    await flags({ supply_notices: true });
    await db.query("update public.supply_notices set apply_start = $2, apply_end = $3 where id = $1", [w.notice, kstDay(-6), kstDay(-1)]);
    expect((await hub.readRealEstateHub()).supply.cards.map((c) => c.id)).not.toContain(w.notice);
  });
});

describe("링크 카드 — 열린 기능만", () => {
  test("inheritance_gift 켜짐 → 상속·증여 카드만, 꺼지면 0 (dev_methods는 꺼짐이라 카드 0)", async () => {
    await flags({ inheritance_gift: true });
    const on = await hub.readRealEstateHub();
    expect(on.links.map((l) => [l.key, l.href])).toEqual([["inheritance_gift", "/realestate/inheritance-gift"]]);
    await flags({});
    expect((await hub.readRealEstateHub()).links).toEqual([]);
  });
});
