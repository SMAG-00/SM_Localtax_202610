// W11-d DB - 쟁점 연결 지도 저장·검토·서명·공개(마이그레이션 124) · 연결 조문 개정 신호(마이그레이션 125)  (PRD-03 LINK-01 · AIOPS-11)
//  · 저장 - 노드는 node_id·kind·ref_id뿐, 없는 조문·결정례·가이드 번호 거부, 관계 라벨 4종, 조문↔조문/조문↔결정례 짝 규칙, 초안으로만 생성, 버전 자동, 내용 불변, 삭제 거부
//  · 흐름 - draft -> in_review -> signed -> published. 검토 없이 서명 거부, 서명 없이 공개 거부(감사 1행), 감수위원 아닌 서명 거부
//  · 공개 - 서명 전 anon 0행, 공개 뒤 1행(서명자 계정·시트 위치 칸 없음), 새 버전 공개 시 이전 공개본 retired, 공개 뷰 노드 수 = 해석되는 노드 수
//  · 개정 신호 - 조문 글이 바뀐 개정판이 생기면 검수 항목 1건 + stale 배지, 두 번 돌려도 1건, 같은 글이면 0건, 해시만 바뀜(body_only)이면 0건, 항목이 끝나면 배지 해제
// 모든 시험은 거래 안에서 돌고 되돌린다. 법령·조문·쟁점은 모두 시험용 가짜 글이다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { open, helpers } from "./_w10d_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const ACTOR = "admin:test@example.test";
let seq = 0;
const slug = () => `graph-${process.pid}-${++seq}`;

async function reviewer() {
  const id = (await h.one("insert into auth.users (id) values (gen_random_uuid()) returning id")).id;
  await client.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, 'reviewer', 'test')", [id]);
  return `user:${id}`;
}
async function adminOnly() {
  const id = (await h.one("insert into auth.users (id) values (gen_random_uuid()) returning id")).id;
  await client.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, 'editor', 'test')", [id]);
  return `user:${id}`;
}
/** 시험용 법령 + 개정판 1개 + 조 1·2 */
async function fixture() {
  const law = await h.law(h.uniq("시험용 쟁점법"));
  const v1 = await h.version(law, { effective_on: "2026-01-01" });
  const a1 = await h.article(v1, 1, 0, "① 시험용 조문 글 하나");
  const a2 = await h.article(v1, 2, 0, "① 시험용 조문 글 둘");
  return { law, v1, a1, a2 };
}
const nodes = (...pairs) => pairs.map(([kind, ref], i) => ({ node_id: `n${i + 1}`, kind, ref_id: Number(ref) }));
async function draft(over = {}) {
  const row = { slug: slug(), hub: "trust", title: "시험용 쟁점", summary: "시험용 요약", nodes: [], edges: [], guide_refs: [], ...over };
  return h.attempt(
    "insert into public.issue_graphs (slug, hub, title, summary, nodes, edges, guide_refs, drafted_by) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, 'test') returning *",
    [row.slug, row.hub, row.title, row.summary, JSON.stringify(row.nodes), JSON.stringify(row.edges), JSON.stringify(row.guide_refs)],
  );
}
async function validDraft(f, over = {}) {
  const r = await draft({ nodes: nodes(["law_article", f.a1], ["law_article", f.a2]), edges: [{ from: "n1", to: "n2", relation: "delegation", note: "시험용 관계 설명" }], ...over });
  assert.ok(r.ok, r.message);
  return r.rows[0];
}
const call = async (fn, ...args) => (await h.one(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args)).r;
async function toSigned(id, signer) {
  assert.equal((await call("issue_graph_submit", id, ACTOR)).ok, true);
  const s = await call("issue_graph_sign", id, signer, "시험용 감수 시트");
  assert.equal(s.ok, true, s.message);
}

test("저장 — 노드는 번호만: 법령명 같은 다른 칸·없는 조문 번호·없는 결정례 번호·겹친 대상 거부", () =>
  h.tx(async () => {
    const f = await fixture();
    const ok = await validDraft(f);
    assert.equal(ok.status, "draft");
    assert.equal(ok.version, 1);
    assert.match(ok.body_sha256, /^[0-9a-f]{64}$/);
    const extra = await draft({ nodes: [{ node_id: "n1", kind: "law_article", ref_id: Number(f.a1), law_name: "시험용 법" }, { node_id: "n2", kind: "law_article", ref_id: Number(f.a2) }], edges: [{ from: "n1", to: "n2", relation: "delegation" }] });
    assert.equal(extra.ok, false);
    assert.match(extra.message, /node_id·kind·ref_id만/);
    const missingArticle = await draft({ nodes: nodes(["law_article", f.a1], ["law_article", 999999999]), edges: [{ from: "n1", to: "n2", relation: "delegation" }] });
    assert.equal(missingArticle.ok, false);
    assert.match(missingArticle.message, /없는 조문 번호/);
    const missingCase = await draft({ nodes: nodes(["law_article", f.a1], ["case", 999999999]), edges: [{ from: "n1", to: "n2", relation: "precedent" }] });
    assert.equal(missingCase.ok, false);
    assert.match(missingCase.message, /없는 결정례/);
    const dup = await draft({ nodes: nodes(["law_article", f.a1], ["law_article", f.a1]), edges: [] });
    assert.equal(dup.ok, false);
    const badKind = await draft({ nodes: [{ node_id: "n1", kind: "article", ref_id: Number(f.a1) }] });
    assert.equal(badKind.ok, false);
    const strRef = await draft({ nodes: [{ node_id: "n1", kind: "law_article", ref_id: String(f.a1) }] });
    assert.equal(strRef.ok, false, "ref_id는 숫자");
  }));

test("저장 — 연결선: 관계 라벨 4종, 없는 노드·자기 연결·중복 거부, precedent는 조문↔결정례만, 나머지는 조문↔조문만", () =>
  h.tx(async () => {
    const f = await fixture();
    const doc = await h.doc();
    const n = nodes(["law_article", f.a1], ["law_article", f.a2], ["case", doc]);
    for (const rel of ["delegation", "mutatis", "requirement"]) {
      assert.ok((await draft({ nodes: n, edges: [{ from: "n1", to: "n2", relation: rel }] })).ok, rel);
    }
    assert.ok((await draft({ nodes: n, edges: [{ from: "n1", to: "n3", relation: "precedent" }] })).ok, "조문 -> 결정례 precedent");
    const label = await draft({ nodes: n, edges: [{ from: "n1", to: "n2", relation: "cites" }] });
    assert.equal(label.ok, false);
    assert.match(label.message, /관계 라벨/);
    assert.equal((await draft({ nodes: n, edges: [{ from: "n1", to: "n9", relation: "delegation" }] })).ok, false, "없는 노드");
    assert.equal((await draft({ nodes: n, edges: [{ from: "n1", to: "n1", relation: "delegation" }] })).ok, false, "자기 연결");
    assert.equal((await draft({ nodes: n, edges: [{ from: "n1", to: "n2", relation: "delegation" }, { from: "n1", to: "n2", relation: "delegation" }] })).ok, false, "중복 연결선");
    assert.equal((await draft({ nodes: n, edges: [{ from: "n1", to: "n2", relation: "precedent" }] })).ok, false, "조문끼리 precedent 거부");
    assert.equal((await draft({ nodes: n, edges: [{ from: "n1", to: "n3", relation: "delegation" }] })).ok, false, "조문-결정례 delegation 거부");
    assert.equal((await draft({ nodes: n, edges: [{ from: "n1", to: "n2", relation: "delegation", extra: 1 }] })).ok, false, "연결선 다른 칸 거부");
    assert.equal((await draft({ nodes: n, edges: [{ from: "n1", to: "n2", relation: "delegation", note: "가".repeat(201) }] })).ok, false, "note 200자 초과");
  }));

test("저장 — 가이드 참조는 있는 주소만, 슬러그 cases 예약, 초안으로만 생성, 버전 자동, 내용 불변, 삭제 거부", () =>
  h.tx(async () => {
    const f = await fixture();
    const g = await h.one("insert into public.guides (hub, topic, slug, created_by) values ('trust', $1, $2, 'test') returning slug", [`t_${process.pid}_${++seq}`, h.uniq("guide")]);
    assert.ok((await draft({ nodes: nodes(["law_article", f.a1], ["law_article", f.a2]), edges: [{ from: "n1", to: "n2", relation: "requirement" }], guide_refs: [{ slug: g.slug, anchor: "section-1" }] })).ok);
    assert.equal((await draft({ guide_refs: [{ slug: "no-such-guide" }] })).ok, false);
    assert.equal((await draft({ slug: "cases" })).ok, false, "cases는 목록 경로 예약");
    const direct = await h.attempt("insert into public.issue_graphs (slug, hub, title, drafted_by, status) values ($1, 'trust', '시험용', 't', 'published')", [slug()]);
    assert.equal(direct.ok, false);
    const v1 = await validDraft(f, { slug: "same-issue" });
    const v2 = (await draft({ slug: "same-issue", nodes: nodes(["law_article", f.a1], ["law_article", f.a2]), edges: [{ from: "n1", to: "n2", relation: "mutatis" }] })).rows[0];
    assert.equal(v2.version, 2);
    assert.equal((await draft({ slug: "same-issue", hub: "redevelopment" })).ok, false, "허브 변경 거부");
    for (const sql of ["update public.issue_graphs set title = '바꿈' where id = $1", "update public.issue_graphs set nodes = '[]'::jsonb where id = $1",
      "update public.issue_graphs set status = 'published' where id = $1", "update public.issue_graphs set stale_reason = 'x' where id = $1", "delete from public.issue_graphs where id = $1"]) {
      assert.equal((await h.attempt(sql, [v1.id])).ok, false, sql);
    }
  }));

test("흐름 — 서명 없이 공개 거부(감사 1행), 검토 없이 서명 거부, 감수위원 아닌 서명 거부, 빈 지도 검토 요청 거부, 순서대로면 공개", () =>
  h.tx(async () => {
    const f = await fixture();
    const g = await validDraft(f);
    const early = await call("issue_graph_publish", g.id, ACTOR);
    assert.equal(early.ok, false);
    assert.equal(early.code, "not_signed");
    assert.equal((await h.one("select count(*)::int n from public.issue_audit where subject = 'issue_graph' and target_id = $1 and action = 'publish' and outcome = 'refused'", [g.id])).n, 1);
    const rev = await reviewer();
    assert.equal((await call("issue_graph_sign", g.id, rev, "시험용 시트")).code, "not_in_review", "검토 요청 전 서명 거부");
    const empty = (await draft({})).rows[0];
    assert.equal((await call("issue_graph_submit", empty.id, ACTOR)).code, "graph_empty");
    assert.equal((await call("issue_graph_submit", g.id, "아무개")).code, "actor_invalid");
    assert.equal((await call("issue_graph_submit", g.id, ACTOR)).ok, true);
    assert.equal((await call("issue_graph_submit", g.id, ACTOR)).code, "not_draft");
    assert.equal((await call("issue_graph_sign", g.id, await adminOnly(), "시험용 시트")).code, "signer_not_reviewer", "관리자도 서명 못 함");
    assert.equal((await call("issue_graph_sign", g.id, rev, "")).code, "sheet_missing");
    assert.equal((await call("issue_graph_sign", g.id, rev, "시험용 시트")).ok, true);
    assert.equal((await call("issue_graph_publish", g.id, "아무개")).code, "publisher_invalid");
    assert.equal((await call("issue_graph_publish", g.id, ACTOR)).ok, true);
    assert.equal((await call("issue_graph_publish", g.id, ACTOR)).code, "already_published");
    const row = await h.one("select status, signed_by, published_by from public.issue_graphs where id = $1", [g.id]);
    assert.equal(row.status, "published");
    assert.equal(row.signed_by, rev);
  }));

test("공개 뷰 — 서명 전 anon 0행, 공개 뒤 1행(서명자·시트 칸 없음), 노드 수는 공개로 풀리는 노드 수, 새 버전 공개 시 이전 공개본 retired", () =>
  h.tx(async () => {
    await h.flags({ law_viewer: true, case_db: true });
    const f = await fixture();
    const doc = await h.doc();
    const g = await validDraft(f, { nodes: nodes(["law_article", f.a1], ["law_article", f.a2], ["case", doc]), edges: [{ from: "n1", to: "n2", relation: "delegation" }, { from: "n1", to: "n3", relation: "precedent" }] });
    const view = () => h.anon("select * from public.public_issue_graphs where slug = $1", [g.slug]);
    const nodeView = () => h.anon("select node_id, kind, law_name, article_no, doc_no from public.public_issue_graph_nodes where slug = $1 order by ord", [g.slug]);
    assert.equal((await view()).rows.length, 0, "초안 0행");
    const rev = await reviewer();
    await toSigned(g.id, rev);
    assert.equal((await view()).rows.length, 0, "서명만 된 상태 0행");
    assert.equal((await nodeView()).rows.length, 0);
    assert.equal((await call("issue_graph_publish", g.id, ACTOR)).ok, true);
    const shown = await view();
    assert.equal(shown.rows.length, 1);
    assert.equal(shown.rows[0].stale, false);
    assert.ok(!("signed_by" in shown.rows[0]) && !("sheet_ref" in shown.rows[0]) && !("stale_reason" in shown.rows[0]));
    const nv = await nodeView();
    assert.equal(nv.rows.length, 3, "조문 2 + 결정례 1");
    assert.deepEqual(nv.rows.map((r) => r.node_id), ["n1", "n2", "n3"]);
    assert.equal(nv.rows[0].article_no, 1);
    assert.equal((await h.anon("select 1 from public.issue_graphs")).ok, false, "표 직접 읽기 0");
    // 법령 열람 기능 키가 꺼지면 조문 노드는 풀리지 않는다 - 그림과 표가 함께 줄어드는 근거
    await h.flags({ law_viewer: false, case_db: true });
    assert.equal((await nodeView()).rows.length, 1);
    await h.flags({ law_viewer: true, case_db: true });
    const v2 = (await draft({ slug: g.slug, nodes: nodes(["law_article", f.a1], ["law_article", f.a2]), edges: [{ from: "n1", to: "n2", relation: "requirement" }] })).rows[0];
    assert.equal(v2.version, 2);
    await toSigned(v2.id, rev);
    assert.equal((await call("issue_graph_publish", v2.id, ACTOR)).ok, true);
    assert.equal((await h.one("select status from public.issue_graphs where id = $1", [g.id])).status, "retired");
    const now = await view();
    assert.equal(now.rows.length, 1);
    assert.equal(now.rows[0].version, 2);
    assert.equal((await call("issue_graph_retire", v2.id, ACTOR)).ok, true);
    assert.equal((await view()).rows.length, 0, "내리면 0행");
    assert.equal((await call("issue_graph_retire", v2.id, ACTOR)).code, "not_published");
  }));

test("개정 신호 — 조문 글이 달라진 개정판 -> 검수 항목 1건 + stale, 두 번 돌려도 1건, 항목이 끝나면 배지 해제", () =>
  h.tx(async () => {
    const f = await fixture();
    const g = await validDraft(f);
    await toSigned(g.id, await reviewer());
    assert.equal((await call("issue_graph_publish", g.id, ACTOR)).ok, true);
    const run = async () => (await client.query("select * from public.issue_graph_stale_detect()")).rows[0];
    const first = await run();
    assert.equal(first.items_created, 0, "개정판이 없으면 신호 0");
    assert.equal((await h.one("select stale_reason from public.issue_graphs where id = $1", [g.id])).stale_reason, null);

    // 새 개정판: 1조는 글이 달라지고 2조는 그대로
    const v2 = await h.version(f.law, { effective_on: "2026-06-01" });
    await h.article(v2, 1, 0, "① 시험용 조문 글 하나 - 고침");
    await h.article(v2, 2, 0, "① 시험용 조문 글 둘");
    await client.query("insert into public.law_events (law_id, kind, event_key, version_id, snapshot_id) values ($1, 'revision', $2, $3, $4)", [f.law, h.uniq("ev"), v2, await h.snapshot()]);
    const second = await run();
    assert.equal(second.items_created, 1);
    assert.equal(second.graphs_stale, 1);
    const third = await run();
    assert.equal(third.items_created, 0, "재실행 중복 0");
    assert.equal(third.items_existing, 1);
    const items = (await client.query("select id, status, payload from public.review_items where kind = 'issue_graph_stale' and (payload ->> 'graphId')::bigint = $1", [g.id])).rows;
    assert.equal(items.length, 1);
    assert.equal(items[0].payload.nodes.length, 1, "바뀐 조문(n1)만");
    assert.equal(items[0].payload.nodes[0].nodeId, "n1");
    assert.equal((await h.one("select count(*)::int n from public.issue_graph_signals where graph_id = $1", [g.id])).n, 1);
    assert.equal((await h.one("select stale_reason from public.issue_graphs where id = $1", [g.id])).stale_reason, "law_article_amended");
    await h.flags({ law_viewer: true });
    assert.equal((await h.anon("select stale from public.public_issue_graphs where slug = $1", [g.slug])).rows[0].stale, true, "공개 화면 배지");

    // 검수 항목을 반려로 끝내면 배지가 풀리고 다시 만들지 않는다
    await client.query("select public.review_item_transition($1, 'in_review', 'test', null, null, null)", [items[0].id]);
    await client.query("select public.review_item_transition($1, 'rejected', 'test', '시험용 사유', null, null)", [items[0].id]);
    const closed = await run();
    assert.equal(closed.items_created, 0);
    assert.equal(closed.graphs_stale, 0);
    assert.equal((await h.one("select stale_reason from public.issue_graphs where id = $1", [g.id])).stale_reason, null);
  }));

test("개정 신호 — 글이 같은 개정판·해시만 바뀐 사건(body_only)·초안 지도에는 신호 0, 조가 사라지면 removed", () =>
  h.tx(async () => {
    const f = await fixture();
    const g = await validDraft(f);
    await toSigned(g.id, await reviewer());
    const drafted = await validDraft(f);
    const run = async () => (await client.query("select * from public.issue_graph_stale_detect()")).rows[0];
    // 글이 같은 개정판
    const same = await h.version(f.law, { effective_on: "2026-05-01" });
    await h.article(same, 1, 0, "① 시험용 조문 글 하나");
    await h.article(same, 2, 0, "① 시험용 조문 글 둘");
    await client.query("insert into public.law_events (law_id, kind, event_key, version_id, snapshot_id) values ($1, 'revision', $2, $3, $4)", [f.law, h.uniq("ev"), same, await h.snapshot()]);
    assert.equal((await run()).items_created, 0, "글이 같으면 신호 0");
    // 해시만 바뀐 사건은 개정판이 없는 body_only
    await client.query("insert into public.law_events (law_id, kind, event_key, snapshot_id) values ($1, 'body_only', $2, $3)", [f.law, h.uniq("ev"), await h.snapshot()]);
    assert.equal((await run()).items_created, 0);
    // 2조가 사라진 새 개정판 -> removed. 초안 지도(drafted)는 대상이 아니다
    const dropped = await h.version(f.law, { effective_on: "2026-09-01" });
    await h.article(dropped, 1, 0, "① 시험용 조문 글 하나");
    await client.query("insert into public.law_events (law_id, kind, event_key, version_id, snapshot_id) values ($1, 'revision', $2, $3, $4)", [f.law, h.uniq("ev"), dropped, await h.snapshot()]);
    const r = await run();
    assert.equal(r.items_created, 1);
    const sig = await h.one("select change, node_id from public.issue_graph_signals where graph_id = $1", [g.id]);
    assert.equal(sig.change, "removed");
    assert.equal(sig.node_id, "n2");
    assert.equal((await h.one("select count(*)::int n from public.issue_graph_signals where graph_id = $1", [drafted.id])).n, 0);
    assert.equal((await h.attempt("update public.issue_graph_signals set change = 'text_changed'")).ok, false, "신호 기록은 추가만");
  }));

test("권한 — 지도 함수는 anon·authenticated가 실행 못 함, 감사 표 직접 읽기 0", () =>
  h.tx(async () => {
    for (const fn of ["issue_graph_submit(1, 'admin:x')", "issue_graph_publish(1, 'admin:x')", "issue_graph_stale_detect()", "issue_tag_approve(1, 'admin:x')"]) {
      assert.equal((await h.anon(`select public.${fn}`)).ok, false, fn);
    }
    assert.equal((await h.anon("select 1 from public.issue_audit")).ok, false);
    assert.equal((await h.anon("select 1 from public.issue_graph_signals")).ok, false);
    assert.equal((await h.anon("select 1 from public.issue_graph_changes")).ok, false);
  }));
