// W10-c 1단계 DB — 원천 등록부 · 공통 검수 큐 · 원문 스냅샷 칸 (마이그레이션 86, PRD-02 REV-01~03 · PIPE-07 · PIPE-08)
//  · 원천 씨앗 6행 모두 unchecked → 수집 불가, allowed 라도 견본 계약 확인 없으면 불가, 둘 다 있어야 가능, 확인자 없는 allowed 거부
//  · 검수 항목 — 종류 밖 거부, 필수 체크 키는 종류로 정해짐(입력 무시), (종류, 키) 중복 1건, 만들 때 기록 1건
//  · 허용 전이 drafted→in_review→approved→published, 허용 밖 전이(drafted→published 등) 거부, 끝 상태는 더 못 감
//  · 승인은 체크 키를 다 확인해야, 부분 승인은 단위 안에서만, 반려·실패는 사유 필수
//  · 실패 → 재시도 3회까지, 4번째 거부, 실패 직전 상태로 돌아감
//  · 표 직접 UPDATE·DELETE 거부(소유자·service_role), 후보 내용 불변, 전이 기록(추가만)
//  · 72시간 경고 — 71시간 59분 0건, 72시간 넘으면 1건, 끝난 항목은 제외
//  · raw_snapshots — 수집기 행은 고칠 수 없고 지울 수 없음, 같은 원천·번호·해시는 1행, 주소에 인증키 모양 거부, 기존 방식 행은 그대로 고칠 수 있음
//  · anon·authenticated는 새 표 접근 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { open, helpers } from "./_w10c_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const ALL_CHECKS = ["original_compared", "numbers_dates_links", "no_personal_info", "promulgation_effective_match"];
const item = async (over = {}) => {
  const row = { kind: "law_change", source_key: h.uniq("k"), title: "시험용 후보", ...over };
  const keys = Object.keys(row);
  return h.one(`insert into public.review_items (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]));
};
const go = (id, to, over = {}) => {
  const a = { actor: "user:w10c", reason: null, checked: null, parts: null, ...over };
  return h.attempt("select * from public.review_item_transition($1, $2, $3, $4, $5, $6)", [id, to, a.actor, a.reason, a.checked, a.parts]);
};
const statusOf = async (id) => await h.one("select status, attempts, failed_from from public.review_items where id = $1", [id]);

test("원천 씨앗 6행은 모두 unchecked이고 수집할 수 없다", () =>
  h.tx(async () => {
    const rows = (await client.query("select key, terms_status, public.data_source_runnable(key) as runnable from public.data_sources order by key")).rows;
    assert.deepEqual(rows.map((r) => r.key), ["admrul", "court_case", "law_api", "mois_interpretation", "nts_interpretation", "tribunal_decision"]);
    assert.ok(rows.every((r) => r.terms_status === "unchecked" && r.runnable === false));
  }));

test("원천 수집 가능 = 이용 조건 allowed AND 견본 계약 확인 — 하나라도 없으면 불가", () =>
  h.tx(async () => {
    const runnable = async () => (await h.one("select public.data_source_runnable('law_api') as r")).r;
    await client.query("update public.data_sources set terms_status = 'allowed', terms_checked_by = 'user:po', terms_checked_at = now() where key = 'law_api'");
    assert.equal(await runnable(), false, "allowed만으로는 불가");
    await client.query("update public.data_sources set contract_verified_by = 'user:po', contract_verified_at = now() where key = 'law_api'");
    assert.equal(await runnable(), true);
    await client.query("update public.data_sources set terms_status = 'link_only' where key = 'law_api'");
    assert.equal(await runnable(), false, "link_only는 수집 불가");
    assert.equal((await h.one("select public.data_source_runnable('없는_원천') as r")).r, false);
  }));

test("확인자·시각 없이 allowed로 바꾸기 거부, 견본 확인자만 있고 시각 없음 거부", () =>
  h.tx(async () => {
    const a = await h.attempt("update public.data_sources set terms_status = 'allowed' where key = 'admrul'");
    assert.equal(a.ok, false);
    assert.match(a.message, /data_sources_terms_checked/);
    const b = await h.attempt("update public.data_sources set contract_verified_by = 'user:po' where key = 'admrul'");
    assert.equal(b.ok, false);
    assert.match(b.message, /data_sources_contract_pair/);
  }));

test("검수 항목 — 종류 8종 밖 거부, 필수 체크 키는 종류로 정해지고 입력은 무시, 만들 때 기록 1건", () =>
  h.tx(async () => {
    assert.equal((await h.attempt("insert into public.review_items (kind, source_key, title) values ('free_text', 'k', 't')")).ok, false);
    const r = await item({ kind: "link_error", status: "approved", attempts: 2, required_checks: ["x"] });
    assert.equal(r.status, "drafted");
    assert.equal(r.attempts, 0);
    assert.deepEqual(r.required_checks, ["original_compared", "numbers_dates_links", "no_personal_info", "link_opened"]);
    const ev = (await client.query("select action, from_status, to_status, actor from public.review_item_events where item_id = $1", [r.id])).rows;
    assert.deepEqual(ev, [{ action: "create", from_status: null, to_status: "drafted", actor: "system" }]);
    const kinds = ["law_change", "legal_doc", "link_error", "link_candidates", "amendment_stage", "field_data", "ai_draft", "pipeline_failure"];
    for (const k of kinds) assert.ok((await item({ kind: k })).required_checks.length >= 1, k);
  }));

test("같은 (종류, 키)는 1건 — 재감지는 충돌로 무시되고 기존 항목은 그대로", () =>
  h.tx(async () => {
    const first = await item({ source_key: "law:1:20260101:20260201" });
    const dup = await h.attempt("insert into public.review_items (kind, source_key, title) values ('law_change', 'law:1:20260101:20260201', '또') on conflict (kind, source_key) do nothing returning id");
    assert.ok(dup.ok);
    assert.equal(dup.rowCount, 0);
    const raw = await h.attempt("insert into public.review_items (kind, source_key, title) values ('law_change', 'law:1:20260101:20260201', '또')");
    assert.equal(raw.ok, false);
    const n = (await h.one("select count(*)::int n from public.review_items where kind = 'law_change' and source_key = 'law:1:20260101:20260201'")).n;
    assert.equal(n, 1);
    assert.equal((await statusOf(first.id)).status, "drafted");
  }));

test("정상 흐름 drafted → in_review → approved → published, 전이마다 기록", () =>
  h.tx(async () => {
    const r = await item();
    assert.ok((await go(r.id, "in_review")).ok);
    const ap = await go(r.id, "approved", { checked: ALL_CHECKS });
    assert.ok(ap.ok, ap.message);
    assert.equal(ap.rows[0].decided_by, "user:w10c");
    const pub = await go(r.id, "published");
    assert.ok(pub.ok, pub.message);
    assert.equal(pub.rows[0].status, "published");
    const ev = (await client.query("select from_status, to_status from public.review_item_events where item_id = $1 order by id", [r.id])).rows;
    assert.deepEqual(ev.map((e) => `${e.from_status ?? "-"}>${e.to_status}`), ["->drafted", "drafted>in_review", "in_review>approved", "approved>published"]);
  }));

test("허용 밖 전이 거부 — drafted→published·approved, in_review→published, 끝 상태에서 어디로도 못 감", () =>
  h.tx(async () => {
    const r = await item();
    for (const to of ["published", "approved", "drafted", "bogus"]) {
      const res = await go(r.id, to, { checked: ALL_CHECKS });
      assert.equal(res.ok, false, `drafted→${to}`);
    }
    await go(r.id, "in_review");
    assert.equal((await go(r.id, "published")).ok, false);
    await go(r.id, "approved", { checked: ALL_CHECKS });
    await go(r.id, "published");
    for (const to of ["in_review", "rejected", "failed", "approved", "retry"]) {
      assert.equal((await go(r.id, to, { reason: "x", checked: ALL_CHECKS })).ok, false, `published→${to}`);
    }
    const rej = await item();
    await go(rej.id, "rejected", { reason: "근거 부족" });
    assert.equal((await go(rej.id, "in_review")).ok, false);
    assert.equal((await statusOf(rej.id)).status, "rejected");
  }));

test("체크리스트 키가 하나라도 빠지면 승인 거부, 결정한 사람이 비면 거부", () =>
  h.tx(async () => {
    const r = await item();
    await go(r.id, "in_review");
    const partial = await go(r.id, "approved", { checked: ALL_CHECKS.slice(0, 3) });
    assert.equal(partial.ok, false);
    assert.match(partial.message, /promulgation_effective_match/);
    assert.equal((await go(r.id, "approved", { checked: null })).ok, false);
    assert.equal((await go(r.id, "approved", { checked: ALL_CHECKS, actor: "  " })).ok, false);
    assert.equal((await statusOf(r.id)).status, "in_review");
    assert.ok((await go(r.id, "approved", { checked: [...ALL_CHECKS, "extra_note"] })).ok, "추가 키는 허용");
  }));

test("부분 승인 — 단위 안의 부분만 가능, 단위 밖·단위 없는 항목의 부분 승인 거부", () =>
  h.tx(async () => {
    const r = await item({ parts: ["a", "b", "c"] });
    await go(r.id, "in_review");
    assert.equal((await go(r.id, "approved", { checked: ALL_CHECKS, parts: ["z"] })).ok, false);
    assert.equal((await go(r.id, "approved", { checked: ALL_CHECKS, parts: [] })).ok, false);
    const ok = await go(r.id, "approved", { checked: ALL_CHECKS, parts: ["a", "c"] });
    assert.ok(ok.ok, ok.message);
    assert.deepEqual(ok.rows[0].approved_parts, ["a", "c"]);
    const plain = await item();
    await go(plain.id, "in_review");
    assert.equal((await go(plain.id, "approved", { checked: ALL_CHECKS, parts: ["a"] })).ok, false);
  }));

test("반려는 사유 필수(공백 거부), 실패는 오류 요약 필수", () =>
  h.tx(async () => {
    const r = await item();
    assert.equal((await go(r.id, "rejected")).ok, false);
    assert.equal((await go(r.id, "rejected", { reason: "   " })).ok, false);
    assert.equal((await go(r.id, "failed")).ok, false);
    const rej = await go(r.id, "rejected", { reason: "원문과 번호가 다릅니다" });
    assert.ok(rej.ok);
    assert.equal(rej.rows[0].reject_reason, "원문과 번호가 다릅니다");
  }));

test("실패 → 재시도 3회까지 허용, 4번째 재시도 거부, 실패 직전 상태로 돌아간다", () =>
  h.tx(async () => {
    const r = await item();
    await go(r.id, "in_review");
    await go(r.id, "approved", { checked: ALL_CHECKS });
    for (let n = 1; n <= 3; n++) {
      const f = await go(r.id, "failed", { reason: `게시 실패 ${n}` });
      assert.ok(f.ok, f.message);
      assert.equal(f.rows[0].failed_from, "approved");
      const re = await go(r.id, "retry");
      assert.ok(re.ok, re.message);
      assert.equal(re.rows[0].status, "approved");
      assert.equal(re.rows[0].attempts, n);
    }
    await go(r.id, "failed", { reason: "게시 실패 4" });
    const fourth = await go(r.id, "retry");
    assert.equal(fourth.ok, false);
    assert.match(fourth.message, /최대 3회/);
    assert.deepEqual(await statusOf(r.id), { status: "failed", attempts: 3, failed_from: "approved" });
    assert.equal((await go((await item()).id, "retry")).ok, false, "실패하지 않은 항목의 retry 거부");
  }));

test("표를 직접 고치거나 지울 수 없다 — 소유자(트리거)·service_role(권한) 모두, 후보 내용도 함수 안에서 불변", () =>
  h.tx(async () => {
    const r = await item({ payload: { n: 1 } });
    const owner = await h.attempt("update public.review_items set status = 'published' where id = $1", [r.id]);
    assert.equal(owner.ok, false);
    assert.match(owner.message, /review_item_transition/);
    assert.equal((await h.attempt("update public.review_items set status = 'published' where id = $1", [r.id], "service_role")).ok, false);
    assert.equal((await h.attempt("delete from public.review_items where id = $1", [r.id])).ok, false);
    assert.equal((await h.attempt("delete from public.review_item_events where item_id = $1", [r.id])).ok, false);
    await client.query("select set_config('ltr.review_write', '1', true)");
    const forced = await h.attempt("update public.review_items set payload = '{\"n\":2}' where id = $1", [r.id]);
    await client.query("select set_config('ltr.review_write', '', true)");
    assert.equal(forced.ok, false);
    assert.equal((await statusOf(r.id)).status, "drafted");
    const svc = await h.attempt("insert into public.review_items (kind, source_key, title) values ('ai_draft', 'sr', '서비스 계정 입력')", [], "service_role");
    assert.ok(svc.ok, svc.message);
  }));

test("72시간 경고 — 71시간 59분 0건, 72시간 넘으면 1건, 끝난 항목은 제외, 배정은 열린 항목만", () =>
  h.tx(async () => {
    const young = await item();
    const old = await item();
    const done = await item();
    await go(done.id, "rejected", { reason: "시험" });
    await client.query("select set_config('ltr.review_write', '1', true)");
    await client.query("update public.review_items set status_changed_at = now() - interval '71 hours 59 minutes' where id = $1", [young.id]);
    await client.query("update public.review_items set status_changed_at = now() - interval '72 hours 1 minute' where id = $1", [old.id]);
    await client.query("update public.review_items set status_changed_at = now() - interval '200 hours' where id = $1", [done.id]);
    await client.query("select set_config('ltr.review_write', '', true)");
    const stale = (await client.query("select id from public.review_items_stale(now())")).rows.map((r) => String(r.id));
    assert.deepEqual(stale, [String(old.id)]);
    const asg = await h.attempt("select * from public.review_item_assign($1, 'user:담당', 'user:w10c')", [old.id]);
    assert.ok(asg.ok, asg.message);
    assert.equal(asg.rows[0].assignee, "user:담당");
    assert.equal((await h.attempt("select * from public.review_item_assign($1, 'user:담당', 'user:w10c')", [done.id])).ok, false);
  }));

test("원문 스냅샷 — 수집기 행은 고치기·지우기 거부, 같은 원천·번호·해시는 1행, 기존 방식 행은 그대로", () =>
  h.tx(async () => {
    const id = await h.snapshot({ source_key: "law_api", external_id: "L1", content_hash: "same", http_status: 200 });
    assert.equal((await h.attempt("update public.raw_snapshots set payload = '바꿈' where id = $1", [id])).ok, false);
    assert.equal((await h.attempt("delete from public.raw_snapshots where id = $1", [id])).ok, false);
    const dup = await h.attempt("insert into public.raw_snapshots (source, url, content_hash, payload, source_key, external_id) values ('t', 'https://example.test/x', 'same', 'p', 'law_api', 'L1')");
    assert.equal(dup.ok, false);
    const other = await h.attempt("insert into public.raw_snapshots (source, url, content_hash, payload, source_key, external_id) values ('t', 'https://example.test/x', 'other', 'p', 'law_api', 'L1')");
    assert.ok(other.ok, "해시가 다르면 새 행");
    const legacy = await h.snapshot();
    assert.ok((await h.attempt("update public.raw_snapshots set payload = '고침' where id = $1", [legacy])).ok);
    assert.ok((await h.attempt("delete from public.raw_snapshots where id = $1", [legacy])).ok);
  }));

test("원문 스냅샷 주소에 인증키 모양(OC·serviceKey·apikey)이 있으면 새 행 거부, 일반 쿼리는 허용", () =>
  h.tx(async () => {
    for (const bad of ["https://example.test/a?OC=abc123", "https://example.test/a?x=1&serviceKey=zzz", "https://example.test/a?apikey=1", "https://example.test/a;key=1"]) {
      const res = await h.attempt("insert into public.raw_snapshots (source, url, content_hash, payload) values ('t', $1, $2, 'p')", [bad, h.uniq("hh")]);
      assert.equal(res.ok, false, bad);
      assert.match(res.message, /raw_snapshots_url_no_credential/);
    }
    const good = await h.attempt("insert into public.raw_snapshots (source, url, content_hash, payload) values ('t', 'https://example.test/a?ID=001&type=JSON', $1, 'p')", [h.uniq("hh")]);
    assert.ok(good.ok, good.message);
  }));

test("anon·authenticated는 검수 큐·원천 등록부·전이 함수에 접근할 수 없다", () =>
  h.tx(async () => {
    const r = await item();
    for (const role of ["anon", "authenticated"]) {
      for (const sql of ["select * from public.review_items", "select * from public.data_sources", "select * from public.review_item_events"]) {
        assert.equal((await h.attempt(sql, [], role)).ok, false, `${role}: ${sql}`);
      }
      assert.equal((await h.attempt("select * from public.review_item_transition($1, 'rejected', 'x', 'y')", [r.id], role)).ok, false);
      assert.equal((await h.attempt("select * from public.review_items_stale(now())", [], role)).ok, false);
    }
    assert.equal((await statusOf(r.id)).status, "drafted");
  }));
