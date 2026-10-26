// W12-f 수용 E2E - 편집국 AI (docs/dev/W12-f_설계.md - PRD-04 AIOPS-07~10 · CASE-05 · ART-13·14)
// standalone 빌드를 로컬 Supabase에 붙인다. AI 키·예산은 설정하지 않는다(AI 끈 상태) - 초안은 DB 함수로 넣은 시험용 가짜 글이다. 법령·결정례·기사는 전부 시험용 가짜 글이다.
//  a) 키 꺼짐(기본) - 승인된 요지·상자·배너가 있어도 공개 화면에 안 나온다
//  b) 요지 - 기자 승인 403 · 체크리스트 없이 승인 422 · 승인 전 요지 0 -> 승인 뒤 "검수 완료" 배지 + 원문 사건번호 · AI 태그 후보는 승인 전 목록 0
//  c) 요약 상자 - 승인 전 노출 0 -> 승인 뒤 노출 + AI 활용 표기 -> 기사 버전이 바뀌면 사라짐
//  d) 개정 영향 배너 - 작업 consistency-watch가 AI 없이 경고 + 제안 -> 확인 전 노출 0 -> 편집자 확인 뒤 노출, 재실행 중복 0
//  e) AI 끈 상태 작업 - case-summary-draft는 후보만 세고 초안 0
//  f) 이 단위 서버 소스에 AI 라이브러리·국세 엔진 가져오기가 없다
// 만든 행은 끝나면 지우고 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w12f-acceptance-e2e@example.test";
const SITE = "https://e2e-w12f.example.test";
const CRON = "e2e-w12f-cron";
const GUARD = "e2e-w12f-guard-secret";
const ROOT = path.resolve(import.meta.dirname, "..");

let sb, server, staff, db, base, saved, run;
const u = {};
const ids = { snapshots: [], laws: [], versions: [], lawArticles: [], docs: [], tags: [], articles: [], people: [] };
const CHECKS = { original_compared: true, numbers_dates_links: true, no_personal_info: true, case_facts_from_source: true };
const BOX_CHECKS = { original_compared: true, numbers_dates_links: true, no_personal_info: true, box_matches_article: true };

async function api(method, p, user, body) {
  const headers = { origin: base };
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const desk = (user, body) => api("POST", "/api/admin/ai-desk", user, body);
const page = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
const serverEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
  ADMIN_EMAILS: ADMIN_EMAIL,
  NEXT_PUBLIC_SITE_URL: SITE,
  CRON_SECRET: CRON,
  GUARD_SECRET: GUARD,
});
async function startAll() {
  server = await startServer(serverEnv());
  base = server.base;
}
/** 공개 데이터 캐시(30초)를 새로 시작하려고 서버를 다시 띄운다 - 새 배포와 같은 출발점 */
async function restart() {
  await server?.stop?.();
  await startAll();
}
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
async function snapshot(payload = "시험용 원문") {
  const r = await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('w12f-e2e', $1, $2, $3) returning id", [`https://example.test/w12f/${run}/${ids.snapshots.length}`, `h-${run}-${ids.snapshots.length}`, payload]);
  ids.snapshots.push(r.rows[0].id);
  return r.rows[0].id;
}
async function doc(no) {
  const snap = await snapshot("시험용 결정례 본문");
  const r = await db.query(
    `insert into public.legal_docs (doc_type, issuer, doc_no, decided_on, tax_kinds, source_url, rights_status, anonymity_check, content_hash, snapshot_id)
     values ('interpretation', '시험용 기관', $1, '2026-03-01', array['취득세'], 'https://example.test/w12f/doc', 'confirmed', 'confirmed', $2, $3) returning id, content_hash`,
    [no, `ch-${run}-${no}`, snap],
  );
  ids.docs.push(r.rows[0].id);
  return r.rows[0];
}
async function publishedArticle(slug) {
  const person = (await db.query("insert into public.people (slug, name, roles, visibility) values ($1, '시험 기자', array['reporter'], 'public') returning id", [`e2e-w12f-p-${run}-${ids.people.length}`])).rows[0];
  ids.people.push(person.id);
  const a = (
    await db.query(
      `insert into public.articles (slug, title, section, content_type, status, author_id, body, first_published_at)
       values ($1, '시험용 기사 제목', 'tax', 'explainer', 'published', $2, $3, now()) returning id, version, slug`,
      [slug, person.id, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 본문입니다." }], claims: [] })],
    )
  ).rows[0];
  ids.articles.push(a.id);
  return a;
}

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const arts = ids.articles;
    const items = (await db.query(
      `select id from public.review_items where created_by like 'job:%' and (payload ->> 'caseId')::bigint = any($1::bigint[])
       union select id from public.review_items where (payload ->> 'articleId')::bigint = any($2::bigint[])
       union select id from public.review_items where kind = 'consistency_alert' and source_key like 'consistency:event:%' and (payload ->> 'lawEventId')::bigint in (select id from public.law_events where law_id = any($3::bigint[]))`,
      [ids.docs, arts, ids.laws],
    )).rows.map((r) => r.id);
    await db.query("delete from public.impact_banners where article_id = any($1::bigint[])", [arts]);
    await db.query("delete from public.article_ai_boxes where article_id = any($1::bigint[])", [arts]);
    await db.query("delete from public.case_summaries where case_id = any($1::bigint[])", [ids.docs]);
    if (items.length) {
      await db.query("delete from public.review_item_events where item_id = any($1::bigint[])", [items]);
      await db.query("delete from public.review_items where id = any($1::bigint[])", [items]);
    }
    await db.query("delete from public.issue_audit where subject in ('case_summary', 'article_ai_box', 'impact_banner', 'case_issue_tag', 'issue_tag')");
    await db.query("delete from public.case_issue_tags where case_id = any($1::bigint[])", [ids.docs]);
    await db.query("delete from public.issue_tags where tag_key like $1", [`e2e_w12f_${run}%`]);
    await db.query("delete from public.links where src_kind = 'article' and src_id = any($1::bigint[])", [arts]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [arts]);
    await db.query("delete from public.people where id = any($1::bigint[])", [ids.people]);
    await db.query("delete from public.legal_doc_texts where legal_doc_id = any($1::bigint[])", [ids.docs]);
    await db.query("delete from public.legal_docs where id = any($1::bigint[])", [ids.docs]);
    await db.query("delete from public.law_events where law_id = any($1::bigint[])", [ids.laws]);
    await db.query("delete from public.law_articles where id = any($1::bigint[])", [ids.lawArticles]);
    await db.query("delete from public.law_versions where id = any($1::bigint[])", [ids.versions]);
    await db.query("delete from public.laws where id = any($1::bigint[])", [ids.laws]);
    await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [ids.snapshots]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  saved = (await db.query("select key, value from public.settings where key in ('feature_flags', 'ops_ai_budget')")).rows;
  u.admin = await staff.createUser({ label: "w12f-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w12f-editor", roles: ["editor"], person: { name: "시험용 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w12f-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  await setFlags({ case_db: false, case_summaries: false, article_ai_box: false, impact_banner: false, ai_ops: false });
  await db.query("update public.settings set value = '{}'::jsonb where key = 'ops_ai_budget'");
  await purge();
});

after(async () => {
  try {
    await purge();
    for (const s of saved ?? []) await db.query("update public.settings set value = $2::jsonb where key = $1", [s.key, JSON.stringify(s.value)]);
  } finally {
    await staff?.cleanup();
    await server?.stop();
  }
});

let fx = {};
// 국세 엔진 가져오기 금지는 check-national-tax(NT9)가 맡는다 - 여기서는 지방세 엔진 밖 세액 패키지 이름만 본다
const NATIONAL_ENGINE = new RegExp("@ltr/tax-engine-national");

test("a) 키 꺼짐(기본) - 승인된 요지·상자가 있어도 공개 화면에 나오지 않는다", async () => {
  const d = await doc(`시험용-번호-${run}-a`);
  const add = await db.query("select public.case_summary_draft_add($1, $2, $3, 'dismissed', 30, 'fake-model', 'job:case-summary-draft', '{}'::jsonb) r", [d.id, d.content_hash, ["키 꺼짐 요지 첫째.", "키 꺼짐 요지 둘째.", "키 꺼짐 요지 셋째."]]);
  const s = add.rows[0].r;
  await db.query("select public.review_item_transition($1, 'in_review', 'admin:e2e')", [s.reviewItemId]);
  await db.query("select public.review_item_transition($1, 'approved', 'admin:e2e', null, $2)", [s.reviewItemId, ["original_compared", "numbers_dates_links", "no_personal_info", "case_facts_from_source"]]);
  assert.equal((await db.query("select public.case_summary_approve($1, 'admin:e2e') r", [s.id])).rows[0].r.ok, true);
  await setFlags({ case_db: true });
  const off = await page(`/cases/interpretation/${d.id}`);
  assert.equal(off.status, 200);
  assert.equal(off.html.includes("키 꺼짐 요지"), false, "case_summaries 키가 꺼지면 요지 0");
  assert.equal(off.html.includes('data-part="case-summary"'), false);
});

test("b) 요지 - 기자 403 · 체크리스트 없이 승인 422 · 승인 전 노출 0 -> 승인 뒤 검수 완료 배지 + 원문 사건번호 · AI 태그 후보는 승인 전 목록 0", async () => {
  await setFlags({ case_db: true, case_summaries: true });
  const no = `시험용-번호-${run}-b`;
  const d = await doc(no);
  fx.docId = d.id;
  const add = (await db.query("select public.case_summary_draft_add($1, $2, $3, 'accepted', 55, 'fake-model', 'job:case-summary-draft', $4::jsonb) r", [d.id, d.content_hash, ["승인 전 요지 첫째.", "승인 전 요지 둘째.", "승인 전 요지 셋째."], JSON.stringify({ facts: { docNo: no }, warnings: [] })])).rows[0].r;
  fx.summaryId = add.id;
  const pre = await page(`/cases/interpretation/${d.id}`);
  assert.equal(pre.html.includes("승인 전 요지 첫째"), false, "승인 전 요지 노출 0");
  assert.equal((await desk(u.reporter, { op: "approve_summary", id: add.id, ...CHECKS })).status, 403);
  const noChecks = await desk(u.editor, { op: "approve_summary", id: add.id });
  assert.equal(noChecks.status, 422, JSON.stringify(noChecks.body));
  assert.equal((await db.query("select status from public.case_summaries where id = $1", [add.id])).rows[0].status, "draft");
  const part = await desk(u.editor, { op: "approve_summary", id: add.id, original_compared: true });
  assert.equal(part.status, 422, "일부만 체크해도 거부");
  const ok = await desk(u.editor, { op: "approve_summary", id: add.id, ...CHECKS });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const post = await page(`/cases/interpretation/${d.id}`);
  assert.equal(post.html.includes("승인 전 요지 첫째"), true);
  assert.equal(post.html.includes("검수 완료"), true);
  assert.equal(post.html.includes(no), true, "사건번호는 원문 정보에서");
  assert.equal((await db.query("select status from public.review_items where id = $1", [add.reviewItemId])).rows[0].status, "published", "검수 항목은 처리 완료로 닫힌다");

  // AI 태그 후보 - 승인 전 목록 0, 편집자 승인 뒤 1행. 편집자(origin editor) 행은 그대로
  const key = `e2e_w12f_${run}_t`;
  const tag = (await db.query("insert into public.issue_tags (tag_key, label, hub, proposed_by) values ($1, '시험용 태그', 'trust', 'e2e') returning id", [key])).rows[0];
  await db.query("select public.issue_tag_approve($1, 'admin:e2e')", [tag.id]);
  const prop = (await db.query("select public.case_issue_tag_ai_propose($1, $2, 'job:case-summary-draft') r", [d.id, key])).rows[0].r;
  assert.equal(prop.ok, true);
  assert.equal((await db.query("select count(*)::int n from public.public_case_issue_tags where case_id = $1", [d.id])).rows[0].n, 0);
  assert.equal((await desk(u.reporter, { op: "approve_tag", id: prop.id })).status, 403);
  assert.equal((await desk(u.editor, { op: "approve_tag", id: prop.id })).status, 200);
  assert.equal((await db.query("select count(*)::int n from public.public_case_issue_tags where case_id = $1", [d.id])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from public.case_issue_tags where case_id = $1 and origin = 'editor'", [d.id])).rows[0].n, 0, "AI가 editor 행을 만들지 않는다");
});

test("c) 요약 상자 - 승인 전 노출 0 -> 승인 뒤 노출 + AI 활용 표기 -> 기사 버전이 바뀌면 사라진다", async () => {
  await setFlags({ article_ai_box: true });
  const art = await publishedArticle(`e2e-w12f-${run}-box`);
  fx.art = art;
  const add = (await db.query("select public.article_ai_box_add($1, $2, $3, '독자에게 주는 시험용 의미입니다.', 'fake-model', 'job:article-ai-box', '{}'::jsonb) r", [art.id, art.version, ["상자 요약 첫째입니다.", "상자 요약 둘째입니다.", "상자 요약 셋째입니다."]])).rows[0].r;
  const early = await page(`/news/${art.slug}`);
  assert.equal(early.status, 200);
  assert.equal(early.html.includes("상자 요약 첫째"), false, "승인 전 노출 0");
  assert.equal((await desk(u.reporter, { op: "approve_box", id: add.id, ...BOX_CHECKS })).status, 403);
  assert.equal((await desk(u.editor, { op: "approve_box", id: add.id })).status, 422, "체크리스트 없이 승인 422");
  assert.equal((await desk(u.editor, { op: "approve_box", id: add.id, ...BOX_CHECKS })).status, 200);
  const shown = await page(`/news/${art.slug}`);
  assert.equal(shown.html.includes("상자 요약 첫째"), true);
  assert.equal(shown.html.includes("AI 활용"), true, "AI 활용 표기");
  assert.equal(shown.html.includes("내게 무슨 의미?"), true);
  await db.query("update public.articles set version = version + 1 where id = $1", [art.id]);
  await restart();
  assert.equal((await page(`/news/${art.slug}`)).html.includes("상자 요약 첫째"), false, "기사가 바뀌면 상자는 사라진다");
});

test("d) 개정 영향 배너 - 작업이 AI 없이 경고와 제안을 만들고 재실행은 중복 0, 확인 전 노출 0 -> 편집자 확인 뒤 노출", async () => {
  await setFlags({ impact_banner: true });
  const law = (await db.query("insert into public.laws (name, tier, scope) values ($1, 'statute', 'related') returning id", [`시험용 정합성법 ${run}`])).rows[0];
  ids.laws.push(law.id);
  const mkVersion = async (eff) => {
    const v = (await db.query("insert into public.law_versions (law_id, promulgation_no, promulgated_on, effective_on, body_hash, snapshot_id) values ($1, $2, '2026-01-01', $3, $4, $5) returning id", [law.id, `시험용-${run}-${eff}`, eff, `bh-${run}-${eff}`, await snapshot()])).rows[0];
    ids.versions.push(v.id);
    return v.id;
  };
  const v1 = await mkVersion("2026-01-01");
  const v2 = await mkVersion("2026-06-01");
  for (const [v, body] of [[v1, "① 시험용 옛 조문 글"], [v2, "① 시험용 새 조문 글"]]) {
    const a = (await db.query("insert into public.law_articles (version_id, article_no, branch_no, body) values ($1, 1, 0, $2) returning id", [v, body])).rows[0];
    ids.lawArticles.push(a.id);
  }
  const ev = (await db.query("insert into public.law_events (law_id, kind, event_key, version_id, snapshot_id) values ($1, 'revision', $2, $3, $4) returning id", [law.id, `ek-${run}`, v2, await snapshot()])).rows[0];
  const art = await publishedArticle(`e2e-w12f-${run}-banner`);
  fx.bannerArt = art;
  await db.query("insert into public.links (src_kind, src_id, dst_kind, dst_id, dst_article_no, dst_branch_no, relation, origin, status, confirmed_by, confirmed_at) values ('article', $1, 'law_provision', $2, 1, 0, 'cites', 'editor', 'confirmed', 'e2e', now())", [art.id, law.id]);

  const job = () => fetch(`${base}/api/jobs/consistency-watch`, { headers: { authorization: `Bearer ${CRON}` } });
  assert.equal((await fetch(`${base}/api/jobs/consistency-watch`)).status, 401, "Cron 비밀값 없으면 401");
  assert.equal((await job()).status, 200);
  const count = async () => (await db.query("select count(*)::int n from public.impact_banners where article_id = $1", [art.id])).rows[0].n;
  assert.equal(await count(), 1, "AI 없이도 배너 제안이 만들어진다");
  assert.equal((await db.query("select count(*)::int n from public.review_items where kind = 'consistency_alert' and source_key = $1", [`consistency:event:${ev.id}`])).rows[0].n, 1);
  assert.equal((await job()).status, 200);
  assert.equal(await count(), 1, "재실행 중복 0");
  assert.equal((await page(`/news/${art.slug}`)).html.includes("개정 전 기준"), false, "확인 전 노출 0");
  const banner = (await db.query("select id from public.impact_banners where article_id = $1", [art.id])).rows[0];
  assert.equal((await desk(u.reporter, { op: "approve_banner", id: banner.id })).status, 403);
  assert.equal((await desk(u.editor, { op: "reject_banner", id: banner.id })).status, 422, "반려 사유 필수");
  assert.equal((await desk(u.editor, { op: "approve_banner", id: banner.id })).status, 200);
  const shown = await page(`/news/${art.slug}`);
  assert.equal(shown.html.includes("개정 전 기준"), true);
  assert.equal(shown.html.includes(`시험용 정합성법 ${run}`), true, "법령명은 원문 값");
  assert.equal(shown.html.includes("2026-06-01"), true, "시행일은 원문 값");
});

test("e) AI 끈 상태 - case-summary-draft는 후보만 세고 초안·태그 후보를 만들지 않는다", async () => {
  const d = await doc(`시험용-번호-${run}-e`);
  const before = (await db.query("select (select count(*)::int from public.case_summaries where case_id = $1) s, (select count(*)::int from public.case_issue_tags where case_id = $1) t", [d.id])).rows[0];
  const res = await fetch(`${base}/api/jobs/case-summary-draft`, { headers: { authorization: `Bearer ${CRON}` } });
  assert.equal(res.status, 200);
  const after = (await db.query("select (select count(*)::int from public.case_summaries where case_id = $1) s, (select count(*)::int from public.case_issue_tags where case_id = $1) t", [d.id])).rows[0];
  assert.deepEqual(after, before, "AI가 꺼져 있으면 초안 0");
  assert.equal((await api("GET", "/api/admin/ai-desk", u.reporter)).status, 403);
  const board = await api("GET", "/api/admin/ai-desk", u.editor);
  assert.equal(board.status, 200);
  assert.ok(Array.isArray(board.body.summaries));
});

test("f) 이 단위 서버 소스에 AI 라이브러리·국세 엔진 가져오기가 없다", () => {
  const files = ["apps/web/lib/server/ops-ai/editorial.ts", "apps/web/lib/server/ops-ai/desk-board.ts", "apps/web/app/api/admin/ai-desk/route.ts", "workflows/src/ops/editorial-ai.ts", "apps/web/lib/ai-desk/input.ts"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.equal(/from\s+["'](@anthropic-ai|openai|ai["'/]|@ai-sdk|@google)/.test(src), false, `${f}: AI 라이브러리 import 0`);
    assert.equal(NATIONAL_ENGINE.test(src.replace(/\/\/.*$/gm, "")), false, `${f}: 국세 엔진 패키지 import 0`);
  }
});
