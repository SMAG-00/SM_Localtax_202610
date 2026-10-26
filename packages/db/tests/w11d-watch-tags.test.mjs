// W11-d DB - 감시 법령 확대 씨앗(마이그레이션 122) · 쟁점 태그 사전과 결정례 태그(마이그레이션 123)  (PRD-03 AIOPS-11 · AIOPS-12 · TRU-05 · RDV-08)
//  · 감시 씨앗 19행(scope related, 이름만), 상속세·증여세 법령은 어떤 이름도 거부, 기존 씨앗 15행 불변
//  · 태그 사전 - 제안으로만 생성, 버전 자동, 승인 시 이전 승인본 retired, 내용·상태 직접 변경 거부, 삭제 거부, 같은 키 허브 변경 거부
//  · 결정례 태그 - 승인된 태그에만, origin editor만, 같은 결정례에 같은 태그 키 중복 0, 승인 전 공개 뷰 0행, 폐기하면 뷰에서 빠지고 연결 행은 남음
// 모든 시험은 거래 안에서 돌고 되돌린다. 법령·태그 이름은 모두 시험용 가짜다.
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
const key = () => `tag_${h.uniq("k").replace(/[^a-z0-9]/gi, "_").toLowerCase()}`.slice(0, 39);
async function propose(over = {}) {
  const row = { tag_key: key(), label: "시험용 태그", hub: "trust", synonyms: ["시험용 동의어"], ...over };
  return h.attempt("insert into public.issue_tags (tag_key, label, hub, synonyms, proposed_by) values ($1, $2, $3, $4, 'test') returning *", [row.tag_key, row.label, row.hub, row.synonyms]);
}
const approve = async (id, who = ACTOR) => (await h.one("select public.issue_tag_approve($1, $2) r", [id, who])).r;
async function approvedTag(over = {}) {
  const p = await propose(over);
  assert.ok(p.ok, p.message);
  const r = await approve(p.rows[0].id);
  assert.equal(r.ok, true);
  return p.rows[0];
}

test("감시 씨앗 — scope related 19행, 기존 15행 불변, 상속세·증여세 법령 0", () =>
  h.tx(async () => {
    const rows = (await client.query("select name, scope, tier, watch, law_key from public.laws")).rows;
    const related = rows.filter((r) => r.scope === "related");
    assert.equal(related.length, 19);
    assert.equal(rows.filter((r) => r.scope === "local").length, 12);
    assert.equal(rows.filter((r) => r.scope === "linked_national").length, 3);
    assert.ok(related.every((r) => r.watch === true && r.law_key === null), "이름만 있고 법제처 ID는 비어 있다");
    assert.ok(rows.filter((r) => r.scope !== "national_igt").every((r) => !/상속세|증여세/.test(r.name)));
    assert.ok(related.some((r) => r.tier === "statute") && related.some((r) => r.tier === "decree") && related.some((r) => r.tier === "rule"));
    const bad = await h.attempt("insert into public.laws (name, tier, scope) values ('상속세 및 증여세법', 'statute', 'related')");
    assert.equal(bad.ok, false);
    assert.match(bad.message, /laws_name_not_excluded/);
    const badScope = await h.attempt("insert into public.laws (name, tier, scope) values ('시험용 법', 'statute', 'national_igt')");
    assert.equal(badScope.ok, false, "national_igt는 W11-g(138)에서 연다");
  }));

test("태그 사전 — 제안으로만 생성, 버전 번호 자동, 승인된 상태로는 만들 수 없다", () =>
  h.tx(async () => {
    const k = key();
    const a = await propose({ tag_key: k });
    assert.ok(a.ok, a.message);
    assert.equal(a.rows[0].version, 1);
    assert.equal(a.rows[0].status, "proposed");
    const b = await propose({ tag_key: k, label: "시험용 태그 고침" });
    assert.equal(b.rows[0].version, 2);
    const direct = await h.attempt("insert into public.issue_tags (tag_key, label, hub, proposed_by, status, approved_by, approved_at) values ($1, '시험용', 'trust', 't', 'approved', 'x', now())", [key()]);
    assert.equal(direct.ok, false);
    const hubChange = await propose({ tag_key: k, hub: "redevelopment" });
    assert.equal(hubChange.ok, false, "같은 키의 허브는 바꿀 수 없다");
    const badHub = await propose({ hub: "tax_law" });
    assert.equal(badHub.ok, false);
  }));

test("태그 사전 — 내용·상태 직접 변경 거부, 삭제 거부, 승인하면 이전 승인본은 retired, 키마다 승인본 1개", () =>
  h.tx(async () => {
    const v1 = await approvedTag();
    assert.equal((await h.attempt("update public.issue_tags set label = '바꿈' where id = $1", [v1.id])).ok, false);
    assert.equal((await h.attempt("update public.issue_tags set status = 'retired', retired_at = now() where id = $1", [v1.id])).ok, false, "상태는 함수로만");
    assert.equal((await h.attempt("delete from public.issue_tags where id = $1", [v1.id])).ok, false);
    const v2 = (await propose({ tag_key: v1.tag_key, label: "시험용 태그 2판" })).rows[0];
    assert.equal((await approve(v2.id)).ok, true);
    const rows = (await client.query("select version, status from public.issue_tags where tag_key = $1 order by version", [v1.tag_key])).rows;
    assert.deepEqual(rows.map((r) => `${r.version}:${r.status}`), ["1:retired", "2:approved"]);
    const again = await approve(v2.id);
    assert.equal(again.code, "already_approved");
    const old = await approve(v1.id);
    assert.equal(old.code, "retired");
  }));

test("태그 승인 — 승인자 표시 없으면 거부하고 거부도 감사 1행", () =>
  h.tx(async () => {
    const p = (await propose()).rows[0];
    const r = await approve(p.id, "누구나");
    assert.equal(r.ok, false);
    assert.equal(r.code, "actor_invalid");
    const audit = await h.one("select count(*)::int n from public.issue_audit where subject = 'issue_tag' and target_id = $1 and outcome = 'refused' and code = 'actor_invalid'", [p.id]);
    assert.equal(audit.n, 1);
    assert.equal((await h.one("select public.issue_tag_approve(-1, $1) r", [ACTOR])).r.code, "not_found");
  }));

test("결정례 태그 — 승인된 태그에만 붙고 origin은 editor뿐, 같은 결정례에 같은 태그 키 중복 0", () =>
  h.tx(async () => {
    const doc = await h.doc();
    const proposed = (await propose()).rows[0];
    const early = await h.attempt("insert into public.case_issue_tags (case_id, issue_tag_id, applied_by) values ($1, $2, 'test')", [doc, proposed.id]);
    assert.equal(early.ok, false, "승인 전 태그에는 못 붙인다");
    const tag = await approvedTag();
    const ok = await h.attempt("insert into public.case_issue_tags (case_id, issue_tag_id, applied_by) values ($1, $2, 'test') returning *", [doc, tag.id]);
    assert.ok(ok.ok, ok.message);
    assert.equal(ok.rows[0].status, "proposed");
    assert.equal(ok.rows[0].tag_key, tag.tag_key);
    assert.equal((await h.attempt("insert into public.case_issue_tags (case_id, issue_tag_id, applied_by) values ($1, $2, 'test')", [doc, tag.id])).ok, false, "중복 0");
    assert.equal((await h.attempt("insert into public.case_issue_tags (case_id, issue_tag_id, applied_by, origin) values ($1, $2, 'test', 'ai')", [await h.doc(), tag.id])).ok, false, "ai 출처는 4단계");
    assert.equal((await h.attempt("update public.case_issue_tags set status = 'approved', approved_by = 'x', approved_at = now() where id = $1", [ok.rows[0].id])).ok, false, "승인은 함수로만");
    assert.equal((await h.attempt("delete from public.case_issue_tags where id = $1", [ok.rows[0].id])).ok, false);
  }));

test("공개 뷰 — 승인 전 연결 0행, 승인 뒤 1행, 태그 폐기하면 뷰에서 빠지고 연결 행은 이력으로 남는다", () =>
  h.tx(async () => {
    await h.flags({ case_db: true });
    const doc = await h.doc();
    const tag = await approvedTag({ label: "시험용 공개 태그" });
    const link = (await h.one("insert into public.case_issue_tags (case_id, issue_tag_id, applied_by) values ($1, $2, 'test') returning id", [doc, tag.id]));
    const view = () => h.anon("select case_id, tag_key, label from public.public_case_issue_tags where case_id = $1", [doc]);
    assert.equal((await view()).rows.length, 0, "승인 전 목록 0");
    assert.equal((await h.one("select public.case_issue_tag_approve($1, $2) r", [link.id, ACTOR])).r.ok, true);
    const shown = await view();
    assert.equal(shown.rows.length, 1);
    assert.equal(shown.rows[0].label, "시험용 공개 태그");
    assert.equal((await h.anon("select * from public.public_issue_tags where tag_key = $1", [tag.tag_key])).rows.length, 1);
    assert.equal((await h.anon("select count(*)::int from public.case_issue_tags")).ok, false, "표 직접 읽기 0");
    assert.equal((await h.one("select public.issue_tag_retire($1, $2) r", [tag.id, ACTOR])).r.ok, true);
    assert.equal((await view()).rows.length, 0, "폐기하면 목록에서 빠진다");
    assert.equal((await h.one("select count(*)::int n from public.case_issue_tags where id = $1", [link.id])).n, 1, "연결 이력은 남는다");
    assert.equal((await h.anon("select * from public.public_issue_tags where tag_key = $1", [tag.tag_key])).rows.length, 0);
  }));

test("공개 뷰 — 공개 불가 결정례(case_db 꺼짐)에 붙은 승인 태그는 0행, 새 태그 버전을 승인하면 연결이 이어진다", () =>
  h.tx(async () => {
    const doc = await h.doc();
    const tag = await approvedTag();
    const link = await h.one("insert into public.case_issue_tags (case_id, issue_tag_id, applied_by) values ($1, $2, 'test') returning id", [doc, tag.id]);
    await h.one("select public.case_issue_tag_approve($1, $2) r", [link.id, ACTOR]);
    await h.flags({ case_db: false });
    assert.equal((await h.anon("select * from public.public_case_issue_tags where case_id = $1", [doc])).rows.length, 0);
    await h.flags({ case_db: true });
    assert.equal((await h.anon("select * from public.public_case_issue_tags where case_id = $1", [doc])).rows.length, 1);
    const v2 = (await propose({ tag_key: tag.tag_key, label: "시험용 태그 새 이름" })).rows[0];
    await approve(v2.id);
    const after = await h.anon("select label from public.public_case_issue_tags where case_id = $1", [doc]);
    assert.equal(after.rows.length, 1);
    assert.equal(after.rows[0].label, "시험용 태그 새 이름", "연결은 이어지고 이름은 지금 승인본");
  }));

test("태그 표 권한 — anon·authenticated는 표 직접 읽기 0", () =>
  h.tx(async () => {
    for (const t of ["issue_tags", "case_issue_tags", "issue_audit"]) {
      assert.equal((await h.anon(`select 1 from public.${t}`)).ok, false, t);
    }
  }));
