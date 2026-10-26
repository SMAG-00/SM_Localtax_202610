// W11-d 수용 E2E - 감시 법령 확대·쟁점 태그·쟁점 연결 지도 (docs/dev/W11-d_설계.md - PRD-03 AIOPS-11·12 · TRU-04·05 · RDV-05·08 · LINK-01)
// standalone 빌드를 로컬 Supabase에 붙인다. 법령·조문·결정례·쟁점·태그는 전부 시험용 가짜 글이다 (실제 법령·쟁점 내용 없음). 기능 키는 시험 동안만 켠다.
//  a) 키 꺼짐(기본) - 쟁점 목록·상세·판례 모음이 모두 404
//  b) 태그 - 기자 제안 403 · 편집자 제안 201 · 승인 전 태그를 결정례에 붙이기 거부 · 승인 전 목록(TRU-05) 0건 -> 태그 승인·붙이기·연결 승인 뒤 1건 -> 태그 폐기하면 목록에서 빠짐
//  c) 지도 저장 - 없는 조문 번호 422 · 번호 외 칸 422 · 관계 라벨 밖 422 · 정상 초안 201 (서명 전 상세 404)
//  d) 서명 흐름 - 서명 없이 공개 409(not_signed, 거부 감사 1행) · 검토 요청 전 서명 409 · 관리자 서명 403 · 감수위원 서명 200 · 공개 200
//  e) 공개 화면 - SVG 상자 수 = 노드 표 행 수, SVG 연결선 수 = 연결선 표 행 수, 고정 문구, 조문 이름은 원문 DB 값, 배지 없음
//  f) 개정 신호 - 조문 글이 바뀐 개정판 주입 -> 작업 issue-graph-stale -> "개정 반영 검토 중" 배지 + 검수 항목 정확히 1건, 작업을 한 번 더 돌려도 1건
//  g) AI SDK import 0 - 이 단위의 서버 소스에 AI 라이브러리 가져오기가 없다
// 만든 행은 끝나면 지우고 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w11d-acceptance-e2e@example.test";
const SITE = "https://e2e-w11d.example.test";
const CRON = "e2e-w11d-cron";
const GUARD = "e2e-w11d-guard-secret";
const ROOT = path.resolve(import.meta.dirname, "..");

let sb, server, staff, db, base, saved, run;
const u = {};
const ids = { snapshots: [], laws: [], versions: [], articles: [], docs: [], tags: [], graphs: [] };

async function api(method, p, user, body) {
  const headers = { origin: base };
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const graphs = (user, body) => api("POST", "/api/admin/issues", user, body);
const tags = (user, body) => api("POST", "/api/admin/issue-tags", user, body);
const page = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
const count = (html, re) => (html.match(re) ?? []).length;
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
async function snapshot() {
  const r = await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('w11d-e2e', $1, $2, '시험용 원문') returning id", [`https://example.test/w11d/${run}/${ids.snapshots.length}`, `h-${run}-${ids.snapshots.length}`]);
  ids.snapshots.push(r.rows[0].id);
  return r.rows[0].id;
}
async function version(lawId, effectiveOn) {
  const r = await db.query(
    "insert into public.law_versions (law_id, promulgation_no, promulgated_on, effective_on, body_hash, snapshot_id) values ($1, $2, '2026-01-01', $3, $4, $5) returning id",
    [lawId, `시험용-${run}-${ids.versions.length}`, effectiveOn, `bh-${run}-${ids.versions.length}`, await snapshot()],
  );
  ids.versions.push(r.rows[0].id);
  return r.rows[0].id;
}
async function article(versionId, no, body) {
  const r = await db.query("insert into public.law_articles (version_id, article_no, branch_no, body) values ($1, $2, 0, $3) returning id", [versionId, no, body]);
  ids.articles.push(r.rows[0].id);
  return r.rows[0].id;
}

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const g = (await db.query("select id from public.issue_graphs where slug like $1", [`e2e-w11d-${run}%`])).rows.map((r) => r.id);
    const items = (await db.query("select id from public.review_items where kind = 'issue_graph_stale' and payload ->> 'slug' like $1", [`e2e-w11d-${run}%`])).rows.map((r) => r.id);
    if (g.length) await db.query("delete from public.issue_graph_signals where graph_id = any($1::bigint[])", [g]);
    if (items.length) {
      await db.query("delete from public.review_item_events where item_id = any($1::bigint[])", [items]);
      await db.query("delete from public.review_items where id = any($1::bigint[])", [items]);
    }
    if (g.length) await db.query("delete from public.issue_audit where subject = 'issue_graph' and target_id = any($1::bigint[])", [g]);
    await db.query("delete from public.issue_graphs where slug like $1", [`e2e-w11d-${run}%`]);
    const t = (await db.query("select id from public.issue_tags where tag_key like $1", [`e2e_w11d_${run}%`])).rows.map((r) => r.id);
    if (t.length) {
      await db.query("delete from public.issue_audit where subject in ('issue_tag', 'case_issue_tag')");
      await db.query("delete from public.case_issue_tags where issue_tag_id = any($1::bigint[])", [t]);
      await db.query("delete from public.issue_tags where id = any($1::bigint[])", [t]);
    }
    if (ids.docs.length) {
      await db.query("delete from public.legal_doc_texts where legal_doc_id = any($1::bigint[])", [ids.docs]);
      await db.query("delete from public.legal_docs where id = any($1::bigint[])", [ids.docs]);
    }
    await db.query("delete from public.law_events where law_id = any($1::bigint[])", [ids.laws]);
    await db.query("delete from public.law_articles where id = any($1::bigint[])", [ids.articles]);
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
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: CRON,
    GUARD_SECRET: GUARD,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  saved = (await db.query("select key, value from public.settings where key = 'feature_flags'")).rows;
  u.admin = await staff.createUser({ label: "w11d-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w11d-editor", roles: ["editor"], person: { name: "시험용 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w11d-reviewer", roles: ["reviewer"], person: { name: "시험용 감수위원", roles: ["reviewer"] } });
  u.reporter = await staff.createUser({ label: "w11d-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  await setFlags({ issue_graph: false, law_viewer: false, case_db: false });
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

const SLUG = () => `e2e-w11d-${run}`;
let fx;

test("a) 키 꺼짐(기본) - 쟁점 목록·상세·판례 모음 404", async () => {
  for (const p of ["/realestate/issues", `/realestate/issues/${SLUG()}`, "/realestate/issues/cases/trust"]) {
    assert.equal((await page(p)).status, 404, p);
  }
});

test("b) 태그 - 권한·승인 전 목록 0건·승인 뒤 1건·폐기하면 빠짐", async () => {
  await setFlags({ issue_graph: true, law_viewer: true, case_db: true });
  const snap = await snapshot();
  const doc = await db.query(
    `insert into public.legal_docs (doc_type, issuer, doc_no, decided_on, tax_kinds, source_url, rights_status, anonymity_check, content_hash, snapshot_id)
     values ('interpretation', '시험용 기관', $1, '2026-03-01', array['취득세'], 'https://example.test/w11d/doc', 'confirmed', 'confirmed', $2, $3) returning id`,
    [`시험용-번호-${run}`, `ch-${run}`, snap],
  );
  fx = { docId: doc.rows[0].id, docNo: `시험용-번호-${run}` };
  ids.docs.push(fx.docId);
  const key = `e2e_w11d_${run}`;
  assert.equal((await tags(u.reporter, { op: "propose", tag_key: key, label: "시험용 태그", hub: "trust" })).status, 403, "기자 제안 403");
  const proposed = await tags(u.editor, { op: "propose", tag_key: key, label: "시험용 태그", hub: "trust", synonyms: "시험용 동의어" });
  assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
  fx.tagId = proposed.body.created.id;
  const early = await tags(u.editor, { op: "apply", case_id: fx.docId, issue_tag_id: fx.tagId });
  assert.notEqual(early.status, 201, "승인 전 태그는 붙일 수 없다");
  assert.equal((await tags(u.reporter, { op: "approve", id: fx.tagId })).status, 403);
  assert.equal((await tags(u.editor, { op: "approve", id: fx.tagId })).status, 200);
  const applied = await tags(u.editor, { op: "apply", case_id: fx.docId, issue_tag_id: fx.tagId });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  assert.equal((await tags(u.editor, { op: "apply", case_id: fx.docId, issue_tag_id: fx.tagId })).status, 409, "같은 결정례에 같은 태그 중복 0");
  const before = await page("/realestate/issues/cases/trust");
  assert.equal(before.status, 200);
  assert.equal(before.html.includes(fx.docNo), false, "연결 승인 전 목록 0건");
  assert.equal((await tags(u.editor, { op: "approve_case", id: applied.body.created.id })).status, 200);
  const after = await page("/realestate/issues/cases/trust");
  assert.equal(after.html.includes(fx.docNo), true, "승인 뒤 1건");
  assert.equal((await page("/realestate/issues/cases/redevelopment")).html.includes(fx.docNo), false, "다른 허브 목록에는 없다");
  assert.equal((await tags(u.editor, { op: "retire", id: fx.tagId })).status, 200);
  assert.equal((await page("/realestate/issues/cases/trust")).html.includes(fx.docNo), false, "폐기하면 목록에서 빠진다");
});

test("c) 지도 저장 - 없는 조문 번호·번호 외 칸·관계 라벨 밖 거부, 정상 초안은 서명 전 404", async () => {
  const law = await db.query("insert into public.laws (name, tier, scope) values ($1, 'statute', 'related') returning id", [`시험용 쟁점법 ${run}`]);
  fx.lawId = law.rows[0].id;
  ids.laws.push(fx.lawId);
  fx.v1 = await version(fx.lawId, "2026-01-01");
  fx.a1 = await article(fx.v1, 1, "① 시험용 조문 글 하나");
  fx.a2 = await article(fx.v1, 2, "① 시험용 조문 글 둘");
  const nodes = [{ node_id: "n1", kind: "law_article", ref_id: Number(fx.a1) }, { node_id: "n2", kind: "law_article", ref_id: Number(fx.a2) }, { node_id: "n3", kind: "case", ref_id: Number(fx.docId) }];
  const edges = [{ from: "n1", to: "n2", relation: "delegation", note: "시험용 관계" }, { from: "n1", to: "n3", relation: "precedent" }];
  const draft = { op: "create", slug: SLUG(), hub: "trust", title: "시험용 쟁점", summary: "시험용 요약", as_of: "2026-06-30", nodes, edges };
  assert.equal((await graphs(u.reporter, draft)).status, 403);
  const missing = await graphs(u.editor, { ...draft, nodes: [nodes[0], { node_id: "n2", kind: "law_article", ref_id: 999999999 }], edges: [edges[0]] });
  assert.equal(missing.status, 422, "없는 조문 번호 거부");
  assert.match(JSON.stringify(missing.body), /없는 조문/);
  const extra = await graphs(u.editor, { ...draft, nodes: [{ ...nodes[0], law_name: "시험용" }, nodes[1]], edges: [edges[0]] });
  assert.equal(extra.status, 422, "번호 외 칸 거부");
  const rel = await graphs(u.editor, { ...draft, edges: [{ from: "n1", to: "n2", relation: "cites" }] });
  assert.equal(rel.status, 422, "관계 라벨 4종 밖 거부");
  const ok = await graphs(u.editor, draft);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  fx.graphId = ok.body.created.id;
  assert.equal((await page(`/realestate/issues/${SLUG()}`)).status, 404, "서명 전 상세 404");
  assert.equal((await page("/realestate/issues")).html.includes(SLUG()), false, "서명 전 목록 0");
});

test("d) 서명 흐름 - 서명 없이 공개 409+감사, 검토 전 서명 409, 관리자 서명 403, 감수위원 서명 뒤 공개", async () => {
  const early = await graphs(u.editor, { op: "publish", id: fx.graphId });
  assert.equal(early.status, 409);
  assert.equal(early.body.code, "not_signed");
  const audit = await db.query("select count(*)::int n from public.issue_audit where subject = 'issue_graph' and target_id = $1 and action = 'publish' and outcome = 'refused'", [fx.graphId]);
  assert.equal(audit.rows[0].n, 1, "거부 감사 1행");
  const preSign = await graphs(u.reviewer, { op: "sign", id: fx.graphId, sheet_ref: "시험용 감수 시트" });
  assert.equal(preSign.status, 409, "검토 요청 전 서명 거부");
  assert.equal((await graphs(u.reporter, { op: "submit", id: fx.graphId })).status, 403);
  assert.equal((await graphs(u.editor, { op: "submit", id: fx.graphId })).status, 200);
  assert.equal((await graphs(u.admin, { op: "sign", id: fx.graphId, sheet_ref: "시험용 감수 시트" })).status, 403, "관리자도 서명 못 한다");
  assert.equal((await graphs(u.reviewer, { op: "sign", id: fx.graphId, sheet_ref: "" })).status, 422, "감수 시트 위치 필수");
  assert.equal((await graphs(u.reviewer, { op: "sign", id: fx.graphId, sheet_ref: "시험용 감수 시트" })).status, 200);
  assert.equal((await page(`/realestate/issues/${SLUG()}`)).status, 404, "서명만 된 상태는 아직 비공개");
  assert.equal((await graphs(u.editor, { op: "publish", id: fx.graphId })).status, 200);
});

test("e) 공개 화면 - SVG 상자·연결선 수 = 표 행 수, 고정 문구, 원문 DB 값, 배지 없음", async () => {
  const { status, html } = await page(`/realestate/issues/${SLUG()}`);
  assert.equal(status, 200);
  assert.equal(count(html, /data-node="n\d+"/g), 3, "SVG 상자 3");
  assert.equal(count(html, /data-node-row="n\d+"/g), 3, "노드 표 행 3");
  assert.equal(count(html, /data-edge="n\d+(?:>|&gt;)n\d+"/g), 2, "SVG 연결선 2");
  assert.equal(count(html, /data-edge-row="\d+"/g), 2, "연결선 표 행 2");
  assert.ok(html.includes("이 지도는 조문 사이의 관계를 보여 주는 참고 자료입니다. 개별 사안은 원문과 전문가 확인이 필요합니다."), "고정 문구");
  assert.ok(html.includes(`시험용 쟁점법 ${run}`) && html.includes("제1조"), "법령 이름·조 번호는 원문 DB 값");
  for (const label of ["위임", "판례"]) assert.ok(html.includes(label), label);
  const plain = html.replace(/<!-- -->/g, ""); // React가 글자 사이에 넣는 주석 제거
  assert.ok(/기준일 2026-06-30/.test(plain) && /지도 버전 1/.test(plain) && /감수일 \d{4}-\d{2}-\d{2}/.test(plain), "기준일·버전·감수일");
  assert.equal(html.includes('data-part="stale-badge"'), false);
  assert.equal((await page("/realestate/issues")).html.includes(SLUG()), true, "목록에 오른다");
});

test("f) 개정 신호 - 조문 글이 바뀐 개정판 -> 작업 -> 배지 + 검수 항목 1건, 재실행해도 1건", async () => {
  const v2 = await version(fx.lawId, "2026-07-01");
  await article(v2, 1, "① 시험용 조문 글 하나 - 고침");
  await article(v2, 2, "① 시험용 조문 글 둘");
  await db.query("insert into public.law_events (law_id, kind, event_key, version_id, snapshot_id) values ($1, 'revision', $2, $3, $4)", [fx.lawId, `ev-${run}`, v2, await snapshot()]);
  const jobRun = () => fetch(`${base}/api/jobs/issue-graph-stale`, { headers: { authorization: `Bearer ${CRON}` } });
  assert.equal((await jobRun()).status, 200);
  const items = () => db.query("select count(*)::int n from public.review_items where kind = 'issue_graph_stale' and (payload ->> 'graphId')::bigint = $1", [fx.graphId]);
  assert.equal((await items()).rows[0].n, 1);
  assert.equal((await jobRun()).status, 200);
  assert.equal((await items()).rows[0].n, 1, "재실행 중복 0");
  const { html } = await page(`/realestate/issues/${SLUG()}`);
  assert.ok(html.includes('data-part="stale-badge"') && html.includes("개정 반영 검토 중"), "화면 배지");
  assert.equal(count(html, /data-node="n\d+"/g), count(html, /data-node-row="n\d+"/g), "배지가 있어도 상자 수 = 표 행 수");
  const list = await page("/realestate/issues");
  assert.ok(list.html.includes("개정 반영 검토 중"), "목록에도 배지");
});

test("g) AI SDK import 0 - 이 단위의 감시·태그·지도 서버 소스에 AI 라이브러리 가져오기가 없다", () => {
  const files = [
    "apps/web/lib/server/issue-graph/stale.ts",
    "apps/web/lib/server/issues/board.ts",
    "apps/web/lib/server/public/issues.ts",
    "apps/web/lib/issues/input.ts",
    "apps/web/lib/issues/diagram.ts",
    "apps/web/app/api/admin/issues/route.ts",
    "apps/web/app/api/admin/issue-tags/route.ts",
    "apps/web/components/site/IssueMapView.tsx",
  ];
  const AI = /from\s+["'](ai|@ai-sdk\/[^"']+|@anthropic-ai\/[^"']+|openai|@google\/[^"']+|@langchain\/[^"']+)["']|require\(["'](ai|openai|@anthropic-ai\/[^"']+)["']\)/;
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.equal(AI.test(src), false, `${f}에 AI 라이브러리 가져오기가 있다`);
  }
});
