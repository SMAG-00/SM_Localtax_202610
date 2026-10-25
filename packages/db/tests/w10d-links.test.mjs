// W10-d 1단계 DB - links · law_delegations · quality_samples (마이그레이션 89~90)  (PRD-02 CASE-03 · LAW-05 · LAW-06 · TX-10)
//  · links - 없는 대상 저장 거부, 허용 짝만, 후보 넣기 멱등(반려 되살리기 0), 상태 전이 규칙, 공개 뷰는 확인된 것 + 양 끝 공개일 때만
//  · law_delegations - 방향(법률 -> 시행령 -> 시행규칙)·같은 묶음·없는 조문 거부, 출처 필수
//  · quality_samples - 위임 50건 중 48 합격 / 47 보류, 조문 인용 100건 중 95 합격 / 94 보류, 크기 부족, 최근 표본이 기준, 위임 공개 뷰는 관문 통과 때만
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

/** 법률 + 시행령 + 시행규칙 묶음과 각 개정판 1개, 조 1~3 */
async function family() {
  const base = h.uniq("시험용법");
  const ids = { statute: await h.law(base, "statute"), decree: await h.law(`${base} 시행령`, "decree"), rule: await h.law(`${base} 시행규칙`, "rule"), base };
  for (const k of ["statute", "decree", "rule"]) {
    const v = await h.version(ids[k]);
    for (const no of [1, 2, 3]) await h.article(v, no);
  }
  return ids;
}

test("연결 - 없는 대상(문서·기사·조문)을 가리키면 저장 거부, 짝 규칙 밖(문서 -> 문서)도 거부", () =>
  h.tx(async () => {
    const f = await family();
    const d = await h.doc();
    const missingDoc = await h.link({ src_id: 999999999, dst_id: f.statute, dst_article_no: 1, dst_branch_no: 0 });
    assert.equal(missingDoc.ok, false);
    assert.match(missingDoc.message, /없는 대상/);
    const missingArticle = await h.link({ src_id: d, dst_id: f.statute, dst_article_no: 99, dst_branch_no: 0 });
    assert.equal(missingArticle.ok, false, "없는 조문");
    assert.match(missingArticle.message, /없는 대상/);
    const noArticle = await h.link({ src_kind: "article", src_id: 999999999, dst_id: f.statute, dst_article_no: 1, dst_branch_no: 0 });
    assert.equal(noArticle.ok, false, "없는 기사");
    const docToDoc = await h.link({ src_id: d, dst_kind: "legal_doc", dst_id: await h.doc() });
    assert.equal(docToDoc.ok, false);
    assert.match(docToDoc.message, /links_pair/);
    assert.ok((await h.link({ src_id: d, dst_id: f.statute, dst_article_no: 1, dst_branch_no: 0 })).ok);
  }));

test("연결 후보 넣기 - 같은 연결은 한 행(멱등), 반려된 연결은 되살리지 않는다, 확인 칸은 확인 상태와 함께만", () =>
  h.tx(async () => {
    const f = await family();
    const d = await h.doc();
    const call = () => h.one("select public.link_add_candidate('legal_doc', $1, 'law_provision', $2, 1, 0, 'cites', '시험용 표기', 'w10d-test') as id", [d, f.statute]);
    const a = await call();
    const b = await call();
    assert.equal(a.id, b.id);
    assert.equal((await h.one("select count(*)::int n from public.links where src_id = $1", [d])).n, 1);
    assert.equal((await h.one("select status, origin from public.links where id = $1", [a.id])).status, "candidate");
    await client.query("update public.links set status = 'rejected' where id = $1", [a.id]);
    assert.equal((await call()).id, a.id);
    assert.equal((await h.one("select status from public.links where id = $1", [a.id])).status, "rejected");
    assert.equal((await h.attempt("update public.links set status = 'confirmed', confirmed_by = 'x', confirmed_at = now() where id = $1", [a.id])).ok, false, "반려 -> 확인 거부");
    const c = await h.link({ src_id: d, dst_id: f.statute, dst_article_no: 2, dst_branch_no: 0 });
    assert.equal((await h.attempt("update public.links set status = 'confirmed' where id = $1", [c.rows[0].id])).ok, false, "확인한 사람·시각 없이 확인 거부");
    await h.confirm(c.rows[0].id);
    assert.equal((await h.attempt("update public.links set status = 'candidate', confirmed_by = null, confirmed_at = null where id = $1", [c.rows[0].id])).ok, false, "확인 -> 후보 거부");
    assert.equal((await h.attempt("update public.links set dst_article_no = 3 where id = $1", [c.rows[0].id])).ok, false, "끝점 수정 거부");
  }));

test("공개 뷰 public_links - 확인된 연결만, 후보·반려 0, 문서가 공개 보류면 연결도 빠짐, 조문은 개정판이 늘어도 유지", () =>
  h.tx(async () => {
    await h.flags({ law_viewer: true, case_db: true });
    const f = await family();
    const d1 = await h.doc();
    const d2 = await h.doc();
    const cand = (await h.link({ src_id: d1, dst_id: f.statute, dst_article_no: 1, dst_branch_no: 0 })).rows[0].id;
    const ok = (await h.link({ src_id: d2, dst_id: f.statute, dst_article_no: 1, dst_branch_no: 0 })).rows[0].id;
    await h.confirm(ok);
    const ids = async () => (await h.anon("select id from public.public_links where dst_id = $1 order by id", [f.statute])).rows.map((r) => Number(r.id));
    assert.deepEqual(await ids(), [Number(ok)]);
    assert.ok(!(await ids()).includes(Number(cand)));
    // 개정판이 새 행으로 늘어도 같은 (법령, 조, 가지) 연결은 그대로
    await h.article(await h.version(f.statute, { promulgation_no: h.uniq("시험용"), effective_on: "2027-01-01", promulgated_on: "2026-10-01" }), 1);
    assert.deepEqual(await ids(), [Number(ok)]);
    // 문서에 실명 보류가 걸리면 연결도 공개에서 빠진다
    await client.query("insert into public.legal_doc_holds (legal_doc_id, snapshot_id, reason) select id, snapshot_id, 'real_name' from public.legal_docs where id = $1", [d2]);
    assert.deepEqual(await ids(), []);
    // 기능 키가 꺼지면 조문도 문서도 공개가 아니라 연결 0
    await h.flags({});
    assert.deepEqual(await ids(), []);
  }));

test("위임 매핑 - 방향·같은 묶음·없는 조문 거부, 출처와 출처 기록 필수, 확인은 확인한 사람과 함께", () =>
  h.tx(async () => {
    const f = await family();
    const other = await h.law(h.uniq("다른시험용법"), "statute");
    await h.article(await h.version(other), 1);
    const ins = (over) => {
      const row = { parent_law_id: f.statute, parent_article_no: 1, child_law_id: f.decree, child_article_no: 1, source: "editor", source_ref: "시험용 편집자", ...over };
      const keys = Object.keys(row);
      return h.attempt(`insert into public.law_delegations (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => row[k]));
    };
    assert.ok((await ins({})).ok);
    assert.equal((await ins({})).ok, false, "같은 위임 중복");
    assert.ok((await ins({ child_law_id: f.rule, child_article_no: 2 })).ok, "법률 -> 시행규칙 직접 위임");
    assert.ok((await ins({ parent_law_id: f.decree, child_law_id: f.rule, child_article_no: 3 })).ok, "시행령 -> 시행규칙");
    assert.match((await ins({ parent_law_id: f.decree, child_law_id: f.statute })).message, /방향/);
    assert.match((await ins({ child_law_id: other })).message, /방향|같은 법령 묶음/);
    assert.match((await ins({ child_law_id: f.rule, child_article_no: 77 })).message, /없는 하위 조문/);
    assert.match((await ins({ parent_article_no: 77 })).message, /없는 상위 조문/);
    assert.equal((await ins({ source: "ai", child_article_no: 3 })).ok, false, "출처 구분 값 밖");
    assert.equal((await ins({ source_ref: "  ", child_article_no: 3 })).ok, false, "출처 기록 없음");
    const row = (await ins({ child_article_no: 3 })).rows[0].id;
    assert.equal((await h.attempt("update public.law_delegations set status = 'confirmed' where id = $1", [row])).ok, false);
    assert.ok((await h.attempt("update public.law_delegations set status = 'confirmed', confirmed_by = '시험 편집자', confirmed_at = now() where id = $1", [row])).ok);
    assert.equal((await h.attempt("update public.law_delegations set child_article_no = 2 where id = $1", [row])).ok, false, "끝점 수정 거부");
  }));

test("표본 검사 관문 - 위임 50건 중 48 합격 · 47 보류 · 49건 표본은 크기 부족, 조문 인용 100건 중 95 합격 · 94 보류, 일치가 표본보다 많으면 거부", () =>
  h.tx(async () => {
    const passed = async (kind, size, matched) => (await h.sample(kind, size, matched)).rows?.[0]?.passed;
    assert.equal(await passed("delegation_mapping", 50, 48), true);
    assert.equal(await passed("delegation_mapping", 50, 47), false);
    assert.equal(await passed("delegation_mapping", 49, 49), false);
    assert.equal(await passed("case_citation", 100, 95), true);
    assert.equal(await passed("case_citation", 100, 94), false);
    assert.equal(await passed("article_pattern", 100, 100), true);
    assert.equal((await h.sample("case_citation", 10, 11)).ok, false);
    assert.equal((await h.attempt("update public.quality_samples set matched = 1")).ok, false, "추가만");
  }));

test("공개 뷰 public_law_delegations - 표본 검사 관문을 통과하고 3단 보기 키가 켜져야만 확인된 위임이 보이고, 더 나쁜 표본을 나중에 넣으면 다시 닫힌다", () =>
  h.tx(async () => {
    await h.flags({ law_viewer: true, law_three: true });
    const f = await family();
    const mk = async (status) => {
      const r = await h.one("insert into public.law_delegations (parent_law_id, parent_article_no, child_law_id, child_article_no, source, source_ref) values ($1, 1, $2, 1, 'editor', '시험용') returning id", [f.statute, f.decree]);
      if (status === "confirmed") await client.query("update public.law_delegations set status = 'confirmed', confirmed_by = 'w10d', confirmed_at = now() where id = $1", [r.id]);
      return r.id;
    };
    const confirmed = await mk("confirmed");
    const count = async () => (await h.anon("select count(*)::int n from public.public_law_delegations where parent_law_id = $1", [f.statute])).rows[0].n;
    assert.equal(await count(), 0, "표본 검사 전");
    await h.sample("delegation_mapping", 50, 47);
    assert.equal(await count(), 0, "47건 - 보류");
    await h.sample("delegation_mapping", 50, 48);
    assert.equal(await count(), 1, "48건 - 공개");
    assert.ok(confirmed);
    await h.flags({ law_viewer: true });
    assert.equal(await count(), 0, "3단 보기 키가 꺼지면 0");
    await h.flags({ law_viewer: true, law_three: true });
    await h.sample("delegation_mapping", 50, 40);
    assert.equal(await count(), 0, "더 나쁜 최근 표본 - 다시 닫힘");
    const gate = (await h.anon("select kind, passed, sample_size, matched from public.public_quality_gates where kind = 'delegation_mapping'")).rows[0];
    assert.deepEqual(gate, { kind: "delegation_mapping", passed: false, sample_size: 50, matched: 40 });
  }));

test("anon은 links·law_delegations·quality_samples 표를 직접 읽을 수 없다", () =>
  h.tx(async () => {
    for (const t of ["links", "law_delegations", "quality_samples", "legal_doc_texts", "legal_doc_holds"]) {
      const r = await h.anon(`select count(*) from public.${t}`);
      assert.equal(r.ok, false, t);
      assert.equal(r.code, "42501", t);
    }
  }));
