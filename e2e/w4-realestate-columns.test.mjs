// 부동산 칼럼 이해관계 E2E (W4 21단계 — PRD-01B PR-14, docs/dev/W4_설계.md 1장 21단계 · 11.21 · 12장 #170)
// standalone 빌드를 로컬 Supabase에 붙인다. 필자·칼럼·프로젝트·이해관계 글자는 전부 시험용 가짜다(*.example).
//  a) 입력 — 기자 403 · 부동산 칼럼 아닌 기사 422 · '없음' 확인자 없음 422 · 내용 없는 declared 422 · 같은 항목 두 번 422 · 없는 기사 404
//  b) 발행 — 3항목 중 비면 DB 직접 발행 거부(빠진 항목 문장) → 하나씩 채움 → 모두 갖추면 발행 · 다른 분야 칼럼은 3항목 없이 발행(달라진 것 없음)
//  c) 화면 — /realestate/columns 200 + 칼럼 · 칼럼 머리 이해관계 줄 = 프로젝트 페이지 관련 칼럼 줄(글자 같음) · 관련 기사에는 칼럼 0 · 기능 키 꺼짐이면 두 곳 모두 줄 0
// 만든 계정·기사·프로젝트·설정은 끝나면 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-realestate-columns-e2e@example.test";
const SITE = "https://e2e.example.test";
const NOTICE_TEXT = "시험용 의견 고지 문구입니다";
const ACTOR = "migration:e2e-w4rc";
const TYPE = "siheom_rc";
const GU = { code: "9801100000", sido: "9800000000" };

let sb, server, staff, db, base;
const u = {};
const fx = { people: [], articles: [], projects: [], snaps: [] };
let saved;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 600);
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (user, body) => api("POST", "/columns", user, body);
const setting = (key, value) => api("PATCH", `/settings/${key}`, u.admin, { value });
const flags = async (over) => {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await setting("feature_flags", { ...cur, ...over });
  assert.equal(r.status, 200, show(r));
};
const publish = (id) => db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [id]);
const get = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
async function newPerson(tag) {
  const { rows } = await db.query("insert into public.people (slug, name, roles, employment) values ($1, $2, array['writer'], 'external') returning id", [`e2e-rc-${tag}-${staff.run}`, `시험용 필자 ${tag}`]);
  fx.people.push(Number(rows[0].id));
  await staff.addTestConsent(Number(rows[0].id));
  return Number(rows[0].id);
}
async function newColumn(personId, tag, section = "realestate") {
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body)
     values ($1, $2, '시험용 가짜 칼럼', $3, 'opinion', 'draft', $4, $5) returning id, slug`,
    [`e2e-rc-art-${tag}-${staff.run}`, `시험용 부동산 칼럼 ${tag} ${staff.run}`, section, personId, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 가짜 칼럼 본문입니다." }], claims: [] })],
  );
  staff.trackArticle(rows[0].id);
  fx.articles.push(Number(rows[0].id));
  return { id: Number(rows[0].id), slug: rows[0].slug, title: `시험용 부동산 칼럼 ${tag} ${staff.run}` };
}
const items = (id, extra) => post(u.editor, { op: "interest_items", articleId: id, items: extra });
const UNION = { item: "union", state: "declared", interestText: "시험용 조합 자문 관계 설명" };
const CONTRACTOR = { item: "contractor", state: "none_confirmed", confirmedBy: "시험용 확인자" };
const TRUST = { item: "trust_company", state: "none_confirmed", confirmedBy: "시험용 확인자" };

async function removeProjects() {
  const ids = (await db.query("select id from public.projects where created_by = $1", [ACTOR])).rows.map((r) => Number(r.id));
  await db.query("delete from public.regional_links where created_by = $1 or (to_type = 'project' and to_id = any($2::text[]))", [ACTOR, ids.map(String)]);
  if (!ids.length) return;
  const snaps = (await db.query("select snapshot_id from public.project_events where project_id = any($1::bigint[]) and snapshot_id is not null", [ids])).rows.map((r) => Number(r.snapshot_id));
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.source_review_queue where target_type = 'project_event' and target_id in (select id from public.project_events where project_id = any($1::bigint[]))", [ids]);
    await db.query("delete from public.project_events where project_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.projects where id = any($1::bigint[])", [ids]);
    if (snaps.length) await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [snaps]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
async function removeRegions() {
  await db.query("delete from public.regions where code = any($1::text[])", [[GU.code, GU.sido]]);
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await removeProjects();
  await removeRegions();
  await staff.snapshotOperations();
  u.editor = await staff.createUser({ label: "rc-editor", roles: ["editor"], person: { name: "칼럼 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "rc-reporter", roles: ["reporter"], person: { name: "칼럼 시험 기자", roles: ["reporter"] } });
  u.admin = await staff.createUser({ label: "rc-admin", email: ADMIN_EMAIL });
  saved = Object.fromEntries((await db.query("select key, value from public.settings where key in ('feature_flags', 'column_opinion_notice', 'project_types', 'project_stage_lists')")).rows.map((r) => [r.key, r.value]));
  fx.p1 = await newPerson("a");
  // 필자 검증·계약·고지 문구 (W3 발행 검사가 요구한다)
  assert.equal((await post(u.editor, { op: "verify", personId: fx.p1, evidenceKind: "license", evidenceRef: "시험용 증빙 위치" })).status, 201);
  const con = await post(u.editor, { op: "contract", personId: fx.p1, docRef: "시험용 계약 위치", signedOn: "2026-01-10", reuseScope: ["print", "online"], aiIndexScope: "allow" });
  assert.equal(con.status, 201, show(con));
  fx.contractId = Number(con.body.contract.id);
  await db.query("update public.settings set value = $1::jsonb where key = 'column_opinion_notice'", [JSON.stringify(NOTICE_TEXT)]);
});

after(async () => {
  try {
    await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify(saved.feature_flags)]);
    await db.query("update public.settings set value = $1::jsonb where key = 'column_opinion_notice'", [JSON.stringify(saved.column_opinion_notice)]);
    await removeProjects();
    await removeRegions();
    await db.query("update public.settings set value = $1::jsonb where key = 'project_stage_lists'", [JSON.stringify(saved.project_stage_lists)]);
    await db.query("update public.settings set value = $1::jsonb where key = 'project_types'", [JSON.stringify(saved.project_types)]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [fx.articles]);
    await db.query("delete from public.column_contracts where person_id = any($1::bigint[])", [fx.people]);
    await db.query("delete from public.author_verifications where person_id = any($1::bigint[])", [fx.people]);
    await db.query("delete from public.people where id = any($1::bigint[])", [fx.people]);
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

test("a) 입력 — 권한·부동산 칼럼 아님·'없음' 확인자·내용·중복·없는 기사", async () => {
  const art = await newColumn(fx.p1, "input");
  const tax = await newColumn(fx.p1, "tax", "tax");
  assert.equal((await post(u.reporter, { op: "interest_items", articleId: art.id, items: [UNION] })).status, 403);
  const notRe = await items(tax.id, [UNION]);
  assert.equal(notRe.status, 422, show(notRe));
  assert.match(JSON.stringify(notRe.body), /부동산 칼럼/);
  const noBy = await items(art.id, [{ item: "union", state: "none_confirmed" }]);
  assert.equal(noBy.status, 422, show(noBy));
  assert.match(JSON.stringify(noBy.body), /confirmedBy/);
  assert.equal((await items(art.id, [{ item: "union", state: "declared" }])).status, 422, "내용 없는 declared");
  assert.equal((await items(art.id, [{ item: "architect", state: "declared", interestText: "x" }])).status, 422, "모르는 항목");
  const dup = await items(art.id, [UNION, UNION]);
  assert.equal(dup.status, 422, show(dup));
  assert.equal((await items(art.id, [])).status, 422, "항목 0개");
  assert.equal((await items(999999999, [UNION])).status, 404);
  assert.equal((await one("select count(*)::int n from public.column_interest_items where article_id = $1", [art.id])).n, 0, "거부된 입력은 저장 0");
});

test("b) 발행 — 3항목 중 비면 거부(빠진 항목 문장), 모두 갖추면 발행 / 다른 분야 칼럼은 그대로", async () => {
  const art = await newColumn(fx.p1, "pub");
  assert.equal((await post(u.editor, { op: "meta", articleId: art.id, personId: fx.p1, contractId: fx.contractId, interestState: "declared", interestText: "시험용 이해관계 문구" })).status, 200);
  await assert.rejects(publish(art.id), /빠진 항목: 조합 자문 관계·시공사 자문 관계·신탁사 자문 관계/);
  const first = await items(art.id, [UNION]);
  assert.equal(first.status, 200, show(first));
  await assert.rejects(publish(art.id), /빠진 항목: 시공사 자문 관계·신탁사 자문 관계/);
  assert.equal((await items(art.id, [CONTRACTOR])).status, 200);
  await assert.rejects(publish(art.id), /빠진 항목: 신탁사 자문 관계\./);
  assert.equal((await one("select status from public.articles where id = $1", [art.id])).status, "draft");
  const last = await items(art.id, [TRUST]);
  assert.equal(last.status, 200, show(last));
  const saved3 = await db.query("select item, state, interest_text, confirmed_by, confirmed_at is not null as has_at from public.column_interest_items where article_id = $1 order by item", [art.id]);
  assert.deepEqual(saved3.rows, [
    { item: "contractor", state: "none_confirmed", interest_text: null, confirmed_by: "시험용 확인자", has_at: true },
    { item: "trust_company", state: "none_confirmed", interest_text: null, confirmed_by: "시험용 확인자", has_at: true },
    { item: "union", state: "declared", interest_text: "시험용 조합 자문 관계 설명", confirmed_by: null, has_at: false },
  ]);
  assert.equal((await one("select count(*)::int n from public.audit_logs where action = 'column.contract_edit' and target = $1", [`column_interest_items:${art.id}`])).n, 3, "저장마다 감사 1건");
  await publish(art.id);
  assert.equal((await one("select status from public.articles where id = $1", [art.id])).status, "published");
  fx.pub = art;

  // 다른 분야 칼럼 — W3 규칙 그대로(이해관계 3항목 없이도 같은 조건이면 발행)
  const tax = await newColumn(fx.p1, "taxok", "tax");
  assert.equal((await post(u.editor, { op: "meta", articleId: tax.id, personId: fx.p1, contractId: fx.contractId, interestState: "none_confirmed", confirmedBy: "시험용 확인자" })).status, 200);
  await publish(tax.id);
  assert.equal((await one("select status from public.articles where id = $1", [tax.id])).status, "published", "다른 분야 칼럼은 3항목 없이 발행");
});

test("c) 화면 — 칼럼 목록 200 · 칼럼 머리 줄 = 프로젝트 관련 칼럼 줄 · 기능 키 꺼짐이면 줄 0", async () => {
  // 프로젝트 (공개) + 칼럼 ↔ 프로젝트 확인된 연결
  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', '시험용 칼럼도', $2)", [GU.sido, `rc-sido-${staff.run}`]);
  await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', '시험용 칼럼구', $3)", [GU.code, GU.sido, `rc-gu-${staff.run}`]);
  assert.equal((await setting("project_types", { [TYPE]: { label: "시험용 정비사업" } })).status, 200);
  assert.equal((await setting("project_stage_lists", { [TYPE]: [{ key: "zone", label: "시험용 구역지정" }, { key: "plan", label: "시험용 계획인가" }, { key: "build", label: "시험용 착공" }, { key: "done", label: "시험용 준공" }] })).status, 200);
  const p = await one("insert into public.projects (slug, name, region_code, project_type, landmark, created_by) values ($1, '시험용 칼럼구역 정비', $2, $3, false, $4) returning id, slug", [`siheom-rc-${staff.run}`, GU.code, TYPE, ACTOR]);
  const url = `https://gov.example.test/w4rc/${staff.run}`;
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload, fetched_at) values ('e2e-w4rc', $1, $2, '시험용 고시 원문', now()) returning id", [url, `sha256:w4rc-${staff.run}`]);
  await db.query(
    "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', 'zone', '시험용 고시 제1호', '2026-01-15', '시험용 칼럼구청', $2, $3, 'kogl_1', $4)",
    [p.id, url, snap.id, ACTOR],
  );
  await db.query("update public.projects set status = 'public', source_name = '시험용 칼럼구청', last_verified_at = now() where id = $1", [p.id]);
  fx.projects.push(Number(p.id));
  await db.query(
    "insert into public.regional_links (from_type, from_id, to_type, to_id, relation, reason, origin, status, confirmed_by, confirmed_at, created_by) values ('article', $1, 'project', $2, 'related_project', '시험용 연결 이유', 'editor', 'confirmed', $3, now(), $3)",
    [String(fx.pub.id), String(p.id), ACTOR],
  );
  await flags({ tax_columns: true, realestate_projects: true });

  const head = await get(`/news/${fx.pub.slug}`);
  assert.equal(head.status, 200);
  const headLine = /data-part="column-interest-items"[^>]*>([^<]+)</.exec(head.html)?.[1];
  assert.equal(headLine, "조합 자문: 시험용 조합 자문 관계 설명 · 시공사 자문: 필자가 밝힌 관계 없음 · 신탁사 자문: 필자가 밝힌 관계 없음");

  const page = await get(`/realestate/projects/${p.slug}`);
  assert.equal(page.status, 200);
  const colBlock = /data-project-part="columns"[\s\S]*?<\/ul>/.exec(page.html)?.[0] ?? "";
  assert.ok(colBlock.includes(fx.pub.title), "관련 칼럼 목록에 칼럼");
  const projLine = /data-part="column-interest-items"[^>]*>([^<]+)</.exec(colBlock)?.[1];
  assert.equal(projLine, headLine, "칼럼 머리와 프로젝트 관련 칼럼 줄의 글자가 같다");
  const articlesBlock = /data-project-part="articles"[\s\S]*?(?=data-project-part="columns"|$)/.exec(page.html)?.[0] ?? "";
  assert.ok(!articlesBlock.includes(`data-article-id="${fx.pub.id}"`), "관련 기사 자리에는 칼럼 0");

  const list = await get("/realestate/columns");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes(fx.pub.title), "칼럼 있을 때 목록에 칼럼");

  await flags({ tax_columns: false });
  const headOff = await get(`/news/${fx.pub.slug}`);
  assert.ok(!headOff.html.includes('data-part="column-interest-items"'), "기능 키 꺼짐 — 머리 줄 0");
  const pageOff = await get(`/realestate/projects/${p.slug}`);
  assert.ok(!pageOff.html.includes('data-part="column-interest-items"'), "기능 키 꺼짐 — 프로젝트 줄 0");
  assert.ok(pageOff.html.includes(fx.pub.title), "칼럼 목록 자체는 그대로");
});
