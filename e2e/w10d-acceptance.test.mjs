// W10-d 수용 E2E (docs/dev/W10-d_설계.md - PRD-02 LAW-01~05 · LAW-06 · CASE-01~03 · TX-10 · TX-11)
// standalone 빌드를 로컬 Supabase에 붙인다. 법령·문서는 전부 시험용 가짜(지어낸 글)이고 외부 요청은 없다. 끝나면 만든 행을 모두 지운다(남는 행 0).
//  a) 기능 키 꺼짐 - /law · /law/[id] · /law/[id]/three · /cases 모두 404
//  b) 기준일 - 개정 시행일 전날은 옛 개정판, 당일은 새 개정판, 첫 개정판 앞은 "이 날짜의 원문이 없어요" + 가장 이른 개정판 링크, 시행 예정 배지
//  c) 3단 보기 - 위임 표본 47/50이면 404, 48/50이면 열림(3열 같은 기준일), 위임 없는 조문은 "위임 조문 없음"
//  d) 해석 DB - 로그인 없이 검색·상세, 스냅샷 없는 문서·실명 보류 문서 404, 결정 유형 칩 필터, 유형별 개수
//  e) 조문 인용 자동 링크 - 조문 인용 표본 94/100이면 링크 0, 95/100이면 DB에 있는 조문만 결정일을 기준일로 링크
//  f) 관련 자료 패널 - 확인된 연결만, 개수 = public_links, 0건 안내 문구
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e-w10d.example.test";
let sb, server, staff, db, base, run, name, decreeName, lawId, decreeId, docA, docHeld, docNoSnap, docCited;

const get = async (path) => {
  const res = await fetch(`${base}${path}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
// 공개 데이터는 서버가 30초 동안 디스크 캐시에 둔다(설계 7.1) - 키를 바꾼 직후에는 서버를 다시 띄워 새 배포와 같은 출발점에서 읽는다 (w10b·w10i와 같다)
async function startAll() {
  server = await startServer({ NEXT_PUBLIC_SUPABASE_URL: sb.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey, ADMIN_EMAILS: "w10d-acceptance-e2e@example.test", NEXT_PUBLIC_SITE_URL: SITE });
  base = server.base;
}
async function restart() {
  await server?.stop?.();
  await startAll();
}
const flags = async (on) => {
  await db.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ law_viewer: !!on.law, law_three: !!on.three, case_db: !!on.cases })]);
  await restart();
};
const snapshot = async (payload) =>
  (await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w10d', $1, $2, $3) returning id", [`https://example.test/시험용/${run}/${Math.random()}`, `h-${run}-${Math.random()}`, payload])).rows[0].id;
async function version(law, over = {}) {
  const row = { law_id: law, promulgation_no: `시험용-${run}-${Math.random().toString(36).slice(2, 7)}`, promulgated_on: "2025-10-01", effective_on: "2026-01-01", ...over };
  return (await db.query("insert into public.law_versions (law_id, promulgation_no, promulgated_on, effective_on, body_hash, snapshot_id) values ($1, $2, $3, $4, $5, $6) returning id", [row.law_id, row.promulgation_no, row.promulgated_on, row.effective_on, `bh-${Math.random()}`, await snapshot("시험용 개정판")])).rows[0].id;
}
const article = (v, no, body) => db.query("insert into public.law_articles (version_id, article_no, body) values ($1, $2, $3)", [v, no, body]);
async function doc(over = {}, payload = "시험용 원문 글") {
  const r = { doc_type: "tribunal", doc_no: `시험용-${run}-${Math.random().toString(36).slice(2, 7)}`, decided_on: "2026-03-01", decision_kind: "rejected", ...over };
  const snap = r.noSnap ? null : await snapshot(payload);
  return (await db.query(
    "insert into public.legal_docs (doc_type, issuer, doc_no, decided_on, tax_kinds, source_url, snapshot_id, rights_status, anonymity_check, content_hash, decision_kind) values ($1, '시험용 기관', $2, $3, array['취득세'], 'https://example.test/시험용/doc', $4, 'confirmed', 'confirmed', $5, $6) returning id",
    [r.doc_type, r.doc_no, r.decided_on, snap, `ch-${Math.random()}`, r.decision_kind],
  )).rows[0].id;
}
const sample = (kind, size, matched) => db.query("insert into public.quality_samples (kind, sample_size, matched, sampled_by) values ($1, $2, $3, 'e2e-w10d')", [kind, size, matched]);

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.links where created_by = 'e2e-w10d'");
    await db.query("delete from public.law_delegations where created_by = 'e2e-w10d'");
    await db.query("delete from public.quality_samples where sampled_by = 'e2e-w10d'");
    await db.query("delete from public.legal_doc_holds where legal_doc_id in (select id from public.legal_docs where doc_no like $1)", [`시험용-${run}-%`]);
    await db.query("delete from public.legal_doc_texts where legal_doc_id in (select id from public.legal_docs where doc_no like $1)", [`시험용-${run}-%`]);
    await db.query("delete from public.review_item_events where item_id in (select id from public.review_items where source_key like 'pii_hold:%' and created_by = 'system:pii_hold' and title like '%실명%')");
    await db.query("delete from public.review_items where source_key like 'pii_hold:%' and created_by = 'system:pii_hold' and snapshot_id in (select id from public.raw_snapshots where source = 'e2e-w10d')");
    await db.query("delete from public.legal_docs where doc_no like $1", [`시험용-${run}-%`]);
    await db.query("delete from public.law_articles where version_id in (select id from public.law_versions where promulgation_no like $1)", [`시험용-${run}-%`]);
    await db.query("delete from public.law_versions where promulgation_no like $1", [`시험용-${run}-%`]);
    await db.query("delete from public.laws where name like $1", [`시험용e2e-${run}%`]);
    await db.query("delete from public.raw_snapshots where source = 'e2e-w10d'");
    await db.query("update public.settings set value = value || '{\"law_viewer\": false, \"law_three\": false, \"case_db\": false}'::jsonb where key = 'feature_flags'");
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
  name = `시험용e2e-${run}법`;
  decreeName = `${name} 시행령`;
  lawId = (await db.query("insert into public.laws (name, tier) values ($1, 'statute') returning id", [name])).rows[0].id;
  decreeId = (await db.query("insert into public.laws (name, tier) values ($1, 'decree') returning id", [decreeName])).rows[0].id;
  // 법률: 개정판 둘(시행 2026-01-01 / 2027-01-01) · 시행령: 개정판 하나. 조 1은 두 번째 개정판에서 글자가 바뀐다
  const v1 = await version(lawId, { effective_on: "2026-01-01" });
  const v2 = await version(lawId, { effective_on: "2027-01-01", promulgated_on: "2026-10-01" });
  await article(v1, 1, "① 시험용 옛 글");
  await article(v2, 1, "① 시험용 새 글");
  await article(v1, 2, "① 시험용 둘째 조");
  await article(v2, 2, "① 시험용 둘째 조");
  const dv = await version(decreeId, { effective_on: "2026-01-01" });
  await article(dv, 1, "① 시험용 시행령 글");
  docA = await doc({ doc_type: "tribunal", decision_kind: "rejected" }, `이 문서는 ${name} 제1조를 인용하고 ${name} 제99조도 적었다 쟁점${run}`);
  docCited = docA;
  await doc({ doc_type: "case", decision_kind: "accepted" }, `판례 쟁점${run} 다른 글`);
  docHeld = await doc({ doc_type: "case" }, `원고 김철수가 쟁점${run}을 청구한다`);
  docNoSnap = await doc({ noSnap: true });
});

after(async () => {
  // 실패해도 서버를 끄고 DB 연결을 닫는다 - 연결이 열려 있으면 시험 프로세스가 끝나지 않는다
  try {
    await purge().catch((e) => console.error("purge 실패", e));
  } finally {
    await server?.stop?.();
    await staff?.cleanup?.();
  }
});

test("a) 기능 키가 꺼져 있으면 법령·3단·해석 화면은 모두 404", async () => {
  await flags({});
  for (const p of ["/law", `/law/${encodeURIComponent(name)}`, `/law/${encodeURIComponent(name)}/1`, `/law/${encodeURIComponent(name)}/three`, "/cases", `/cases/tribunal/${docA}`]) {
    assert.equal((await get(p)).status, 404, p);
  }
});

test("b) 기준일 - 시행일 전날은 옛 개정판, 당일은 새 개정판, 첫 개정판 앞은 원문 없음 안내, 시행 예정 배지", async () => {
  await flags({ law: true });
  const list = await get("/law");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes(name), "법령 목록에 시험용 법령");
  const at = (date) => get(`/law/${encodeURIComponent(name)}/1?date=${date}`);
  const before = await at("2026-12-31");
  const on = await at("2027-01-01");
  // 본문(article-body)만 본다 - 신구조문 대비(compare)에는 직전 개정판의 글이 같이 나오는 것이 설계다
  const bodyOf = (html) => /<article data-part="article-body"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
  assert.ok(bodyOf(before.html).includes("시험용 옛 글") && !bodyOf(before.html).includes("시험용 새 글"), "전날은 옛 개정판");
  assert.ok(bodyOf(on.html).includes("시험용 새 글") && !bodyOf(on.html).includes("시험용 옛 글"), "당일은 새 개정판");
  assert.ok(on.html.includes('data-part="compare"') && on.html.includes("시험용 옛 글"), "신구조문 대비에는 옛 글이 같이 나온다");
  const early = await at("2025-12-31");
  assert.ok(early.html.includes("이 날짜의 원문이 없어요"));
  assert.ok(early.html.includes("date=2026-01-01"), "가장 이른 개정판 링크");
  assert.ok(early.html.includes("data-part=\"no-text\""));
  assert.equal((await get(`/law/${encodeURIComponent(name)}/1?date=2026-02-30`)).status, 200, "달력에 없는 날짜는 오늘 기준으로");
  assert.equal((await get(`/law/${encodeURIComponent(name)}/0`)).status, 404, "조 번호 형식 밖");
  assert.equal((await get(`/law/${encodeURIComponent(name)}/1?date=2026-06-01`)).html.includes("2027.1.1 시행 예정"), true, "공포 뒤 시행 전 개정판 배지");
  const full = await get(`/law/${encodeURIComponent(name)}?date=2026-06-01`);
  assert.ok(full.html.includes('id="p1"'), "항 앵커");
  assert.ok(full.html.includes("data-part=\"toc\""), "조문 목차");
});

test("c) 3단 보기 - 위임 표본 47/50이면 404, 48/50이면 열림, 위임 없는 조문은 위임 조문 없음", async () => {
  await flags({ law: true, three: true });
  await db.query("insert into public.law_delegations (parent_law_id, parent_article_no, child_law_id, child_article_no, source, source_ref, status, confirmed_by, confirmed_at, created_by) values ($1, 1, $2, 1, 'editor', '시험용', 'confirmed', 'e2e', now(), 'e2e-w10d')", [lawId, decreeId]);
  const path = `/law/${encodeURIComponent(name)}/three?date=2026-06-01`;
  await sample("delegation_mapping", 50, 47);
  assert.equal((await get(path)).status, 404, "47건 - 보류");
  await sample("delegation_mapping", 50, 48);
  await restart();
  const open = await get(path);
  assert.equal(open.status, 200, "48건 - 공개");
  assert.ok(open.html.includes("시험용 시행령 글"), "위임된 시행령 조문이 같은 행에");
  assert.ok(open.html.includes("위임 조문 없음"), "조 2는 위임 없음");
  assert.ok(open.html.includes('data-part="three-head"'));
  await flags({ law: true });
  assert.equal((await get(path)).status, 404, "3단 키가 꺼지면 404");
});

test("d) 해석 DB - 로그인 없이 검색·상세, 스냅샷 없는 문서·실명 보류 문서 404, 결정 유형 필터·유형별 개수", async () => {
  await flags({ cases: true });
  const q = encodeURIComponent(`쟁점${run}`);
  const res = await get(`/cases?q=${q}`);
  assert.equal(res.status, 200);
  assert.ok(res.html.includes(`/cases/tribunal/${docA}`));
  assert.ok(!res.html.includes(`/cases/case/${docHeld}`), "실명 보류 문서는 목록에 없다");
  assert.ok(res.html.includes('data-type="tribunal" data-count="1"') && res.html.includes('data-type="case" data-count="1"'), "유형별 개수(보류 문서 제외)");
  assert.ok(res.html.includes('data-type="ruling" data-count="0"'), "0건 유형도 표시");
  const rejected = await get(`/cases?q=${q}&decision=rejected`);
  assert.ok(rejected.html.includes(`/cases/tribunal/${docA}`) && !rejected.html.includes("data-doc-type=\"case\""), "기각 필터");
  assert.equal((await get(`/cases/tribunal/${docA}`)).status, 200);
  assert.equal((await get(`/cases/case/${docHeld}`)).status, 404, "실명 보류");
  assert.equal((await get(`/cases/tribunal/${docNoSnap}`)).status, 404, "스냅샷 없음");
  assert.equal((await get(`/cases/case/${docA}`)).status, 404, "유형이 다르면 404");
  const detail = await get(`/cases/tribunal/${docA}`);
  assert.match(detail.html.replace(/<!-- -->/g, ""), /수집일 \d{4}-\d{2}-\d{2} · 확인일 \d{4}-\d{2}-\d{2}/); // React가 값 사이에 넣는 빈 주석은 화면 글자가 아니다
  assert.equal((await get(`/cases?q=${encodeURIComponent("!!!")}`)).html.includes("data-doc-id"), false);
});

test("e) 조문 인용 자동 링크 - 표본 94/100이면 링크 0, 95/100이면 DB에 있는 조문만 결정일을 기준일로 링크", async () => {
  await flags({ law: true, cases: true });
  await sample("case_citation", 100, 94);
  const closed = await get(`/cases/tribunal/${docCited}`);
  assert.ok(!closed.html.includes('data-citation="article"'), "94건 - 링크 0");
  assert.ok(closed.html.includes(`${name} 제1조`), "글자는 그대로");
  await sample("case_citation", 100, 95);
  await restart();
  const open = await get(`/cases/tribunal/${docCited}`);
  const links = [...open.html.matchAll(/data-citation="article"/g)];
  assert.equal(links.length, 1, "DB에 있는 조문(제1조)만, 없는 제99조는 글자");
  assert.ok(open.html.includes("date=2026-03-01"), "결정일을 기준일로");
});

test("f) 관련 자료 패널 - 확인된 연결만, 개수 = public_links, 0건 안내", async () => {
  await flags({ law: true, cases: true });
  const empty = await get(`/law/${encodeURIComponent(name)}/2?date=2026-06-01`);
  assert.ok(empty.html.includes("아직 연결된 자료가 없어요"));
  const ins = (src, status) => db.query("insert into public.links (src_kind, src_id, dst_kind, dst_id, dst_article_no, dst_branch_no, relation, origin, status, confirmed_by, confirmed_at, created_by) values ('legal_doc', $1, 'law_provision', $2, 1, 0, 'cites', 'auto', $3, $4, $5, 'e2e-w10d')", [src, lawId, status, status === "confirmed" ? "e2e" : null, status === "confirmed" ? new Date() : null]);
  const second = await doc({ doc_type: "interpretation", decision_kind: null }, "시험용 해석 글");
  await ins(docA, "confirmed");
  await ins(second, "candidate");
  const page = await get(`/law/${encodeURIComponent(name)}/1?date=2026-06-01`);
  const shown = [...page.html.matchAll(/data-link-id="(\d+)"/g)].length;
  const expected = (await db.query("select count(*)::int n from public.public_links where dst_id = $1 and dst_article_no = 1", [lawId])).rows[0].n;
  assert.equal(expected, 1);
  assert.equal(shown, expected, "화면의 연결 수 = 공개 뷰의 연결 수(후보는 제외)");
  assert.ok(page.html.includes("이 조문을 인용한 심판 결정례"), "이유 한 줄은 관계 값에서");
  assert.ok(page.html.includes("자동 추출 · 편집자 확인"));
  assert.ok(!page.html.includes(`/cases/interpretation/${second}`), "후보 연결의 문서는 패널에 없다");
});
