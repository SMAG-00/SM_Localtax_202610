// 분양 정보 공개 화면 통합 시험 (W4 17단계 — docs/dev/W4_설계.md 1장 17단계 · 2.3 · 5장 · 12장 #11 · #140~, PRD-01B PR-04 · PR-01 · PR-05)
// 로컬 Supabase에 anon 키로 읽는다 (경계 = 공개 뷰 public_supply_notices — 기능 키 supply_notices · 공개 + 확인일 + 공급 규모, 연결 프로젝트는 public_projects).
// 시험 세계: 시험용 시·도 1 + 시·군·구 2(접두 99 가짜 코드 — 설계 8장) · 시험용 사업 유형 1 · 공개 프로젝트 P · 공개 분양 정보 8(마감 2026-10-01 · 11-04 ×2 · 11-10 · 11-11~14) ·
// 초안 1 · 내림 1. 청약 마감 경계는 화면 함수에 시각(now)을 넘겨 마감일 23:59(KST)와 다음 날 00:00(KST)으로 본다. 끝나면 만든 행을 모두 지우고 설정을 되돌린다.
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
const ACTOR = "user:itest-w4sn";
const TYPE = "siheom_sn";
const PRICE = ["price", "cost", "contribution", "yield", "return", "profit", "premium", "market", "appraisal", "sale_amount", "bunyang", "분양가", "분담금", "수익", "시세", "프리미엄"];
/** 한국 시각 → Date */
const kst = (local) => new Date(`${local}+09:00`);
const LAST_MINUTE = kst("2026-11-04T23:59:00");
const NEXT_DAY = kst("2026-11-05T00:00:00");

let db;
let api;
let supply;
let projects;
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
const flags = (over) => setSetting("feature_flags", { ...saved.feature_flags, region_hubs: false, realestate_projects: false, supply_notices: false, ...over });
const keysOf = (v) => (Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
const priceKeys = (v) => keysOf(v).filter((k) => PRICE.some((p) => k.toLowerCase().replaceAll("_", "").includes(p.replaceAll("_", ""))));
const ids = (cards) => cards.map((c) => c.id);

async function notice(key, over) {
  const row = await insert(
    "supply_notices",
    {
      name: `시험용 ${key} 분양`,
      region_code: GU,
      supply_scale: "총 820세대 중 일반공급 410세대",
      apply_start: "2026-11-02",
      apply_end: "2026-11-04",
      notice_date: "2026-10-26",
      notice_issuer: "시험용 분양구청",
      official_notice_url: `https://gov.example.test/itest-w4sn-${RUN}/${key}`,
      license_type: "kogl_1",
      status: "public",
      verified_at: "2026-10-27T01:00:00Z",
      created_by: ACTOR,
      updated_by: ACTOR,
      ...over,
    },
    "notices",
  );
  w[key] = Number(row.id);
  return w[key];
}

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  for (const k of ["feature_flags", "project_types", "project_stage_lists"]) saved[k] = (await one("select value from public.settings where key = $1", [k])).value;
  expect(saved.feature_flags.supply_notices).toBe(false);
  expect((await one("select count(*)::int n from public.regions where code like '99%'")).n).toBe(0);

  w.sidoSlug = `itest-sn-${RUN}`;
  w.guSlug = `bunyang-${RUN}-gu`;
  await insert("regions", { code: SIDO, level: "sido", name: "시험용 분양도", slug: w.sidoSlug }, "regions");
  await insert("regions", { code: GU, parent_code: SIDO, level: "sigungu", name: "시험용 분양구", slug: w.guSlug }, "regions");
  await insert("regions", { code: GU2, parent_code: SIDO, level: "sigungu", name: "시험용 옆구", slug: `yeop-${RUN}-gu` }, "regions");
  await setSetting("project_types", { [TYPE]: { label: "시험용 정비사업" } });
  await setSetting("project_stage_lists", { [TYPE]: [{ key: "zone", label: "시험용 구역지정" }, { key: "done", label: "시험용 준공" }] });
  const p = await insert("projects", { slug: `siheom-sn-p-${RUN}`, name: "시험용 하늘구역 정비", region_code: GU, project_type: TYPE, created_by: ACTOR }, "projects");
  const url = `https://gov.example.test/itest-w4sn-${RUN}/p`;
  const snap = await insert("raw_snapshots", { source: "itest", url, content_hash: `sha256:w4sn-${RUN}`, payload: "시험용 고시 원문" }, "snapshots");
  await insert("project_events", { project_id: p.id, kind: "stage", stage: "zone", notice_no: "시험용 고시 제1호", notice_date: "2026-01-15", issuer: "시험용 분양구청", source_url: url, snapshot_id: snap.id, license_type: "kogl_1", recorded_by: ACTOR });
  await db.query("update public.projects set status = 'public', source_name = '시험용 분양구청', last_verified_at = now() where id = $1", [p.id]);
  w.P = { id: Number(p.id), slug: p.slug };

  await notice("closed", { project_id: p.id, apply_start: "2026-09-28", apply_end: "2026-10-01", notice_date: "2026-09-20" });
  await notice("deadline", { project_id: p.id });
  await notice("deadline-sido", { region_code: SIDO, name: "시험용 시도 분양", apply_start: "2026-11-03" });
  await notice("later", { region_code: GU2, apply_start: "2026-11-08", apply_end: "2026-11-10", notice_issuer: "시험용 옆구청", notice_date: "2026-11-01", verified_at: "2026-10-29T02:00:00Z" });
  for (const d of [11, 12, 13, 14]) await notice(`gu-${d}`, { apply_start: "2026-11-09", apply_end: `2026-11-${d}` });
  await notice("draft", { status: "draft" });
  await notice("hidden", {});
  await db.query("update public.supply_notices set status = 'hidden' where id = $1", [w.hidden]);
  await flags({});
  api = await import("./index.ts");
  supply = await import("./supply.ts");
  projects = await import("./projects.ts");
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
    for (const [k, v] of Object.entries(saved)) await setSetting(k, v);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    await db.end();
  }
});

describe("기능 키 supply_notices 꺼짐 — 화면 함수 null·0장 (2.4 · 12장 #12 — 법률 검토 기록 전)", () => {
  test("목록 null(화면은 하위 분야 목록) · 지역 허브 0장 · 프로젝트 화면 0장", async () => {
    await flags({ realestate_projects: true });
    expect(await supply.getSupplyList({ region: null }, LAST_MINUTE)).toBeNull();
    expect(await supply.readRegionSupply(SIDO, [SIDO, GU, GU2], LAST_MINUTE)).toEqual({ cards: [], more: null });
    expect(await supply.readProjectSupply(w.P.id, LAST_MINUTE)).toEqual([]);
    expect((await projects.getProject(w.P.slug, LAST_MINUTE)).supply).toEqual([]);
  });
});

describe("예정 목록 — 청약 마감일 23:59(KST) 있음 · 다음 날 00:00(KST) 0 (2.3)", () => {
  test("마감일 23:59 — 마감 이른 순 · 공개만(초안·내림 0) · 지난 마감 0 · 카드 칸 전수 · 칩 · 출처 줄 · BreadcrumbList", async () => {
    await flags({ supply_notices: true, region_hubs: true });
    const v = await supply.getSupplyList({ region: null }, LAST_MINUTE);
    expect(ids(v.items)).toEqual([w.deadline, w["deadline-sido"], w.later, w["gu-11"], w["gu-12"], w["gu-13"], w["gu-14"]]);
    expect(v.total).toBe(7);
    expect(v.today).toBe("2026-11-04");
    for (const c of v.items) {
      expect([c.name, c.region.name, c.region.code, c.phase.label, c.supplyScale, c.applyStart, c.applyEnd, c.issuer, c.noticeDate, c.verifiedOn, c.noticeUrl].every((x) => typeof x === "string" && x.length > 0)).toBe(true);
      expect(c.noticeUrl).toMatch(/^https:\/\//);
    }
    const first = v.items[0];
    expect([first.region.name, first.region.href, first.phase.label, first.verifiedOn, first.license]).toEqual(["시험용 분양도 시험용 분양구", `/local/${w.sidoSlug}/${w.guSlug}`, "청약 접수 중", "2026-10-27", expect.stringContaining("제1유형")]);
    expect(v.items.find((c) => c.id === w.later).phase.label).toBe("청약 예정");
    expect(v.chips.map((c) => [c.label, c.count])).toEqual([
      ["전체", 0],
      ["시험용 분양도", 7],
    ]);
    expect(v.sourceLine).toEqual({ source: "시험용 분양구청 · 시험용 옆구청", baseDate: "2026-10-26", checkedAt: "2026-10-27" });
    expect(v.breadcrumb.items.map((i) => i.url)).toEqual(["https://e2e.example.test/", "https://e2e.example.test/realestate", "https://e2e.example.test/realestate/supply"]);
    expect(priceKeys(v)).toEqual([]);
  });
  test("다음 날 00:00 — 마감일이 어제인 두 항목은 0, 나머지 그대로", async () => {
    await flags({ supply_notices: true });
    const v = await supply.getSupplyList({ region: null }, NEXT_DAY);
    expect(ids(v.items)).toEqual([w.later, w["gu-11"], w["gu-12"], w["gu-13"], w["gu-14"]]);
    expect(v.items.some((c) => c.id === w.deadline || c.id === w["deadline-sido"])).toBe(false);
  });
  test("거르개 ?region= — 시·도 코드는 그 아래 포함 · 시·군·구 코드는 그것만", async () => {
    await flags({ supply_notices: true });
    expect(ids((await supply.getSupplyList({ region: GU2 }, LAST_MINUTE)).items)).toEqual([w.later]);
    expect((await supply.getSupplyList({ region: SIDO }, LAST_MINUTE)).items).toHaveLength(7);
    const gu = await supply.getSupplyList({ region: GU }, LAST_MINUTE);
    expect(ids(gu.items)).toEqual([w.deadline, w["gu-11"], w["gu-12"], w["gu-13"], w["gu-14"]]);
    expect(gu.total).toBe(7);
  });
});

describe("지역 허브 ③ 분양 정보 카드 (12장 #143)", () => {
  test("그 지역 범위 예정 카드 최대 4장 + 더 보기(목록 지역 거르개) · 시·도는 하위 포함 · 마감 다음 날 0", async () => {
    await flags({ supply_notices: true });
    const gu = await supply.readRegionSupply(GU, [GU], LAST_MINUTE);
    expect([ids(gu.cards), gu.more]).toEqual([[w.deadline, w["gu-11"], w["gu-12"], w["gu-13"]], `/realestate/supply?region=${GU}`]);
    const gu2 = await supply.readRegionSupply(GU2, [GU2], LAST_MINUTE);
    expect([ids(gu2.cards), gu2.more]).toEqual([[w.later], null]);
    expect(ids((await supply.readRegionSupply(SIDO, [SIDO, GU, GU2], LAST_MINUTE)).cards)).toEqual([w.deadline, w["deadline-sido"], w.later, w["gu-11"]]);
    expect(ids((await supply.readRegionSupply(GU, [GU], NEXT_DAY)).cards)).toEqual([w["gu-11"], w["gu-12"], w["gu-13"], w["gu-14"]]);
  });
  test("지역 허브 화면 ③ 블록에 묶음 카드 · 분야 필터로 ③이 빠지면 0 · 기능 키 끄면 0", async () => {
    await flags({ supply_notices: true, region_hubs: true });
    const page = await api.getRegionPage(w.sidoSlug, w.guSlug, { now: LAST_MINUTE });
    const re = page.blocks.find((b) => b.key === "realestate");
    expect([ids(re.supply), re.supplyMore]).toEqual([[w.deadline, w["gu-11"], w["gu-12"], w["gu-13"]], `/realestate/supply?region=${GU}`]);
    expect(page.blocks.filter((b) => b.key !== "realestate").flatMap((b) => b.supply)).toEqual([]);
    const filtered = await api.getRegionPage(w.sidoSlug, w.guSlug, { now: LAST_MINUTE, topic: "local_tax" });
    expect(filtered.blocks.flatMap((b) => b.supply)).toEqual([]);
    await flags({ supply_notices: false, region_hubs: true });
    expect((await api.getRegionPage(w.sidoSlug, w.guSlug, { now: LAST_MINUTE })).blocks.flatMap((b) => b.supply)).toEqual([]);
  });
});

describe("프로젝트 화면 분양 정보 — 청약이 끝난 항목도 기록으로 남는다 (PR-04)", () => {
  test("예정·접수 중 먼저, 마감 기록은 최근 마감 위 · 마감 다음 날엔 둘 다 '청약 마감' 기록 · 연결 프로젝트 링크는 realestate_projects 켜짐일 때만", async () => {
    await flags({ supply_notices: true, realestate_projects: true });
    const before = await supply.readProjectSupply(w.P.id, LAST_MINUTE);
    expect(before.map((c) => [c.id, c.phase.label])).toEqual([
      [w.deadline, "청약 접수 중"],
      [w.closed, "청약 마감"],
    ]);
    expect(before[0].project).toEqual({ name: "시험용 하늘구역 정비", href: `/realestate/projects/${w.P.slug}` });
    const after = await supply.readProjectSupply(w.P.id, NEXT_DAY);
    expect(after.map((c) => [c.id, c.phase.label])).toEqual([
      [w.deadline, "청약 마감"],
      [w.closed, "청약 마감"],
    ]);
    const detail = await projects.getProject(w.P.slug, NEXT_DAY);
    expect(ids(detail.supply)).toEqual([w.deadline, w.closed]);
    await flags({ supply_notices: true, realestate_projects: false });
    expect((await supply.readProjectSupply(w.P.id, NEXT_DAY)).every((c) => c.project === null)).toBe(true);
  });
  test("프로젝트를 내리면 분양 정보 카드의 프로젝트 링크 0 (뷰가 공개 프로젝트만 잇는다) — 되돌리면 다시", async () => {
    await flags({ supply_notices: true, realestate_projects: true });
    await db.query("update public.projects set status = 'hidden' where id = $1", [w.P.id]);
    try {
      const v = await supply.getSupplyList({ region: GU }, LAST_MINUTE);
      expect(v.items.find((c) => c.id === w.deadline).project).toBeNull();
    } finally {
      await db.query("update public.projects set status = 'public' where id = $1", [w.P.id]);
    }
    expect((await supply.getSupplyList({ region: GU }, LAST_MINUTE)).items.find((c) => c.id === w.deadline).project).not.toBeNull();
  });
});
