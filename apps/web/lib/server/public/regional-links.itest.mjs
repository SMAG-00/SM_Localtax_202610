// 공개 지역 연결 통합 시험 (W4 13단계 — docs/dev/W4_설계.md 1장 13단계 · 12장 100번~, PRD-01B REG1-10 · LG-14)
// 로컬 Supabase에 anon 키로 읽는다 (RLS가 경계 — 연결은 공개 뷰 public_regional_links, 도착은 공개 기사·공개 기사의 출처·행정구역).
// 시험 세계: 시험용 시·도 1 + 시·군·구 1(접두 99 가짜 코드 — 설계 8장) · 출발 기사 1 · 도착 기사 2 · 검수 공식 자료 1 · 공개 프로젝트 1(시험용 사업 유형).
// 연결: 기사·공식 자료·지역·프로젝트(확인) + 기사(후보) + 기사(지움). 끝나면 만든 행을 모두 지우고 기능 키·사업 유형 설정을 되돌린다.
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
const ACTOR = "user:itest-w4rl";

let db;
let api;
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
const hubs = (on) => setSetting("feature_flags", { ...saved.feature_flags, region_hubs: on });

async function article(key, cols = {}) {
  const row = await insert(
    "articles",
    {
      slug: `it-w4rl-${key}-${RUN}`,
      title: cols.title ?? `시험용 연결 ${key}`,
      summary: "시험용 지역 기사 요약입니다",
      section: "local",
      content_type: cols.type ?? "reported_news",
      status: "published",
      author_id: w.reporter.id,
      editorial_field: "local_finance",
      public_question: "시험용 지역 재정은 어떻게 바뀌나",
      region_codes: [GU],
      first_published_at: hoursAgo(cols.hours ?? 1),
    },
    "articles",
  );
  w[key] = { id: Number(row.id), slug: row.slug, title: row.title };
  return w[key];
}
async function link(toType, toId, over = {}) {
  const status = over.status ?? "confirmed";
  const row = await insert(
    "regional_links",
    {
      from_type: "article",
      from_id: String(w.FROM.id),
      to_type: toType,
      to_id: String(toId),
      relation: over.relation ?? "related_tax",
      origin: "editor",
      status: status === "removed" ? "confirmed" : status,
      reason: "시험용 연결 이유",
      confirmed_by: status === "candidate" ? null : ACTOR,
      confirmed_at: status === "candidate" ? null : hoursAgo(over.hours ?? 1),
      created_by: ACTOR,
    },
    "links",
  );
  if (status === "removed") await db.query("update public.regional_links set status = 'removed' where id = $1", [row.id]);
  return Number(row.id);
}
const linksOf = async () => (await api.getArticleDetail(w.FROM.slug)).links;

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  for (const k of ["feature_flags", "project_types", "project_stage_lists"]) saved[k] = (await one("select value from public.settings where key = $1", [k])).value;
  expect(saved.feature_flags.region_hubs).not.toBe(true);
  expect((await one("select count(*)::int n from public.regions where code like '99%'")).n).toBe(0);

  w.reporter = await insert("people", { slug: `it-w4rl-reporter-${RUN}`, name: "통합 시험 연결 기자", roles: ["reporter"], visibility: "public" }, "people");
  w.sidoSlug = `itest-rl-${RUN}`;
  w.guSlug = `yeongyeol-${RUN}-gu`;
  await insert("regions", { code: SIDO, level: "sido", name: "시험용 연결도", slug: w.sidoSlug }, "regions");
  await insert("regions", { code: GU, parent_code: SIDO, level: "sigungu", name: "시험용 연결구", slug: w.guSlug }, "regions");

  await article("FROM", { title: "시험용 출발 기사" });
  await article("T1", { title: "시험용 도착 기사", hours: 2 });
  await article("T2", { title: "시험용 후보 기사", hours: 3 });
  await article("T3", { title: "시험용 지운 연결 기사", hours: 4 });
  const url = `https://gov.example.test/itest-w4rl-${RUN}/doc`;
  const snap = await insert("raw_snapshots", { source: "itest", url, content_hash: `sha256:w4rl-${RUN}`, payload: "시험용 원문" }, "snapshots");
  w.snapId = Number(snap.id);
  w.src = await insert("article_sources", {
    article_id: w.T1.id,
    kind: "official_doc",
    title: "시험용 연결 공식 자료",
    source_url: url,
    source_name: "시험용 연결도청",
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

  await setSetting("project_types", { siheom_rl: { label: "시험용 사업" } });
  await setSetting("project_stage_lists", { siheom_rl: [{ key: "zone", label: "시험용 구역지정" }, { key: "done", label: "시험용 준공" }] });
  const p = await insert("projects", { slug: `siheom-rl-${RUN}`, name: "시험용 연결 프로젝트", region_code: GU, project_type: "siheom_rl", created_by: ACTOR }, "projects");
  const psnap = await insert("raw_snapshots", { source: "itest", url: `${url}/notice`, content_hash: `sha256:w4rl-p-${RUN}`, payload: "시험용 고시" }, "snapshots");
  await insert("project_events", { project_id: p.id, kind: "stage", stage: "zone", notice_no: "시험용 고시 제1호", notice_date: "2026-01-15", issuer: "시험용 연결구청", source_url: `${url}/notice`, snapshot_id: psnap.id, license_type: "kogl_1", recorded_by: ACTOR });
  await db.query("update public.projects set status = 'public', source_name = '시험용 연결구청', last_verified_at = now() where id = $1", [p.id]);
  w.project = Number(p.id);

  w.l1 = await link("article", w.T1.id, { hours: 1 });
  w.l2 = await link("official_source", w.src.id, { hours: 2 });
  w.l3 = await link("region", GU, { relation: "same_region", hours: 3 });
  w.l4 = await link("project", w.project, { relation: "related_project", hours: 4 });
  w.l5 = await link("article", w.T2.id, { status: "candidate" });
  w.l6 = await link("article", w.T3.id, { status: "removed" });
  await hubs(false);
  api = await import("./index.ts");
});

afterAll(async () => {
  if (!db) return;
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.regional_links where id = any($1::bigint[]) or (from_type = 'article' and from_id = any($2::text[]))", [made.links, made.articles.map(String)]);
    await db.query("delete from public.project_events where project_id = any($1::bigint[])", [made.projects]);
    await db.query("delete from public.projects where id = any($1::bigint[])", [made.projects]);
    const ids = made.articles;
    await db.query("delete from public.article_sources where article_id = any($1::bigint[])", [ids]);
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

describe("기사 상세 '확인된 연결' — 확인된 연결 중 도착 화면이 지금 열린 것만 (anon)", () => {
  test("region_hubs·realestate_projects 꺼짐 — 기사·공식 원문만 · 후보·지운 연결 0 · 프로젝트(기능 키 꺼짐) 0 · 지역 허브 0", async () => {
    const links = await linksOf();
    expect(links.map((l) => [l.id, l.kind, l.href, l.external])).toEqual([
      [w.l1, "article", `/news/${w.T1.slug}`, false],
      [w.l2, "official_source", `https://gov.example.test/itest-w4rl-${RUN}/doc`, true],
    ]);
    expect(links[0]).toMatchObject({ title: "시험용 도착 기사", relationLabel: "관련 세금", kindLabel: "기사" });
    expect(links[1]).toMatchObject({ title: "시험용 연결 공식 자료", meta: "시험용 연결도청 · 기준일 2026-08-31", underReview: false });
    for (const hidden of [w.l4, w.l5, w.l6]) expect(links.some((l) => l.id === hidden)).toBe(false);
  });

  test("region_hubs 켜짐 → 지역 허브 링크(시·도 slug/시·군·구 slug) · 끄면 다음 읽기부터 0", async () => {
    await hubs(true);
    try {
      const links = await linksOf();
      expect(links.map((l) => l.kind)).toEqual(["article", "official_source", "region"]);
      expect(links[2]).toMatchObject({ id: w.l3, href: `/local/${w.sidoSlug}/${w.guSlug}`, title: "시험용 연결도 시험용 연결구", relationLabel: "같은 지역" });
    } finally {
      await hubs(false);
    }
    expect((await linksOf()).some((l) => l.kind === "region")).toBe(false);
  });

  test("realestate_projects 켜짐 (W4 15단계 — 12장 103번) → 프로젝트 링크 /realestate/projects/[slug] · 끄면 다음 읽기부터 0 · 프로젝트를 내리면 0", async () => {
    const flags = (on) => setSetting("feature_flags", { ...saved.feature_flags, region_hubs: false, realestate_projects: on });
    await flags(true);
    try {
      const links = await linksOf();
      expect(links.map((l) => l.kind)).toEqual(["article", "official_source", "project"]);
      expect(links[2]).toMatchObject({ id: w.l4, href: `/realestate/projects/siheom-rl-${RUN}`, title: "시험용 연결 프로젝트", kindLabel: "프로젝트", meta: "현재 단계 시험용 구역지정", external: false });
      await db.query("update public.projects set status = 'hidden' where id = $1", [w.project]);
      expect((await linksOf()).some((l) => l.kind === "project")).toBe(false);
      await db.query("update public.projects set status = 'public' where id = $1", [w.project]);
      expect((await linksOf()).some((l) => l.kind === "project")).toBe(true);
    } finally {
      await flags(false);
    }
    expect((await linksOf()).some((l) => l.kind === "project")).toBe(false);
  });

  test("목적지가 비공개가 되면 다음 읽기부터 링크 0 (404 링크 0) · 되돌리면 다시 · 원문 검수 중이면 '검토 중'", async () => {
    await db.query("update public.articles set status = 'draft' where id = $1", [w.T1.id]);
    try {
      // 도착 기사 초안 → 그 기사 링크 0, 그 기사의 공식 자료도 공개 기사 출처가 아니라 0
      expect(await linksOf()).toEqual([]);
    } finally {
      await db.query("update public.articles set status = 'published' where id = $1", [w.T1.id]);
    }
    expect((await linksOf()).map((l) => l.id)).toEqual([w.l1, w.l2]);
    const q = await one(
      "insert into public.source_review_queue (target_type, target_id, article_id, reason, old_hash, new_hash, new_snapshot_id, opened_by) values ('article_source', $1, $2, 'snapshot_changed', $3, $4, $5, $6) returning id",
      [w.src.id, w.T1.id, `sha256:${"b".repeat(64)}`, `sha256:${"a".repeat(64)}`, w.snapId, ACTOR],
    );
    try {
      expect((await linksOf()).find((l) => l.id === w.l2)).toMatchObject({ underReview: true });
    } finally {
      await db.query("delete from public.source_review_queue where id = $1", [q.id]);
    }
  });

  test("연결을 지우면 다음 읽기부터 0 · 연결 없는 기사는 빈 목록(자리 0)", async () => {
    await db.query("update public.regional_links set status = 'removed' where id = $1", [w.l1]);
    expect((await linksOf()).map((l) => l.id)).toEqual([w.l2]);
    expect((await api.getArticleDetail(w.T2.slug)).links).toEqual([]);
  });
});
