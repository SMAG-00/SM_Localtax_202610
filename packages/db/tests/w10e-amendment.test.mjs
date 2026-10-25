// W10-e e1 DB - 개정 자동 감지 (마이그레이션 91, PRD-02 AIOPS-01 · TX-05)
//  · 감지 -> 검수 후보 1건 (공포 후보는 항상, 시행 후보는 시행일 당일부터), 재감지도 1건
//  · 후보는 amendment_events에 들어가지 않는다(승인 전 반영 0) / 승인 전 반영 함수 거부 / 승인 뒤 origin=auto 1건 + 처리 완료 / 두 번 불러도 같은 기록
//  · origin=auto는 후보 번호 필수, 익명은 새 칸을 읽을 수 없다
// 값은 모두 시험용이고 거래 안에서 돌고 되돌린다.
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

const ALL_CHECKS = ["original_compared", "numbers_dates_links", "no_personal_info", "stage_matches_source"];

/** 시험용 개정판 + 개정 감지 기록 하나 */
async function revision({ promulgatedOn = "2099-01-05", effectiveOn = "2099-02-10" } = {}) {
  const law = (await h.one("select id from public.laws where name = '지방세법'")).id;
  const snap = await h.snapshot();
  const no = h.uniq("시험용공포");
  const v = await h.one("insert into public.law_versions (law_id, promulgation_no, promulgated_on, effective_on, body_hash, snapshot_id) values ($1, $2, $3, $4, $5, $6) returning id", [law, no, promulgatedOn, effectiveOn, h.uniq("bh"), snap]);
  const e = await h.one("insert into public.law_events (law_id, kind, event_key, version_id, snapshot_id) values ($1, 'revision', $2, $3, $4) returning id", [law, `${no}|${effectiveOn}`, v.id, snap]);
  return { eventId: Number(e.id), snap };
}
const candidates = async (eventId) => (await client.query("select id, source_key, status, payload from public.review_items where kind = 'amendment_stage' and source_key like $1 order by source_key", [`law_event:${eventId}:%`])).rows;
const detect = async (today) => (await h.one("select created, existing from public.amendment_candidates_detect($1::date)", [today]));
const amendment = async () => Number((await h.one("insert into public.amendments (slug, title) values ($1, '시험용 개정안') returning id", [h.uniq("w10e-am")])).id);
async function approve(id) {
  await client.query("select public.review_item_transition($1, 'in_review', 'w10e-test')", [id]);
  await client.query("select public.review_item_transition($1, 'approved', 'w10e-test', null, $2::text[])", [id, ALL_CHECKS]);
}

test("감지 - 시행일 전날에는 공포 후보 1건, 시행일 당일부터 시행 후보가 더해진다 (경계)", () =>
  h.tx(async () => {
    const { eventId } = await revision();
    await detect("2099-02-09");
    assert.deepEqual((await candidates(eventId)).map((c) => c.source_key), [`law_event:${eventId}:promulgated`]);
    await detect("2099-02-10");
    assert.deepEqual((await candidates(eventId)).map((c) => c.source_key), [`law_event:${eventId}:effective`, `law_event:${eventId}:promulgated`]);
    const [eff] = (await candidates(eventId)).filter((c) => c.source_key.endsWith(":effective"));
    assert.equal(eff.payload.stage, "effective");
    assert.equal(eff.payload.occurredOn, "2099-02-10");
    assert.equal(eff.status, "drafted");
  }));

test("재감지해도 후보는 1건 - 두 번째 실행은 새로 만든 것 0", () =>
  h.tx(async () => {
    const { eventId } = await revision();
    await detect("2099-01-06");
    const before = (await candidates(eventId)).length;
    const again = await h.one("select created, existing from public.amendment_candidates_detect('2099-01-06'::date) ");
    assert.equal(before, 1);
    assert.equal((await candidates(eventId)).length, 1);
    assert.ok(Number(again.existing) >= 1);
    // 이 개정 기록에서 새 후보가 생기지 않았다 - 다른 시험의 행이 있어도 이 사건 키는 그대로 1건
  }));

test("감지는 amendment_events를 건드리지 않는다 (승인 전 반영 0)", () =>
  h.tx(async () => {
    const { eventId } = await revision();
    const countBefore = Number((await h.one("select count(*) from public.amendment_events")).count);
    await detect("2099-03-01");
    assert.equal(Number((await h.one("select count(*) from public.amendment_events")).count), countBefore);
    assert.equal(Number((await h.one("select count(*) from public.amendment_events where review_item_id is not null")).count), 0);
    assert.ok((await candidates(eventId)).length >= 1);
  }));

test("승인 전 반영 거부, 승인 뒤 반영하면 origin=auto 기록 1건과 처리 완료, 다시 불러도 같은 기록", () =>
  h.tx(async () => {
    const { eventId, snap } = await revision();
    await detect("2099-01-06");
    const [cand] = await candidates(eventId);
    const am = await amendment();
    const early = await h.attempt("select public.amendment_candidate_apply($1, $2, 'w10e-test')", [cand.id, am]);
    assert.equal(early.ok, false);
    assert.match(early.message, /승인된 후보만/);
    await approve(cand.id);
    const ev = Number((await h.one("select public.amendment_candidate_apply($1, $2, 'w10e-test') as id", [cand.id, am])).id);
    const row = await h.one("select origin, review_item_id, stage, occurred_on::text as occurred_on, snapshot_id, amendment_id from public.amendment_events where id = $1", [ev]);
    assert.deepEqual({ ...row, review_item_id: Number(row.review_item_id), snapshot_id: Number(row.snapshot_id), amendment_id: Number(row.amendment_id) }, { origin: "auto", review_item_id: Number(cand.id), stage: "promulgated", occurred_on: "2099-01-05", snapshot_id: Number(snap), amendment_id: am });
    assert.equal((await h.one("select status from public.review_items where id = $1", [cand.id])).status, "published");
    const again = Number((await h.one("select public.amendment_candidate_apply($1, $2, 'w10e-test') as id", [cand.id, am])).id);
    assert.equal(again, ev);
    assert.equal(Number((await h.one("select count(*) from public.amendment_events where review_item_id = $1", [cand.id])).count), 1);
  }));

test("반려된 후보는 반영할 수 없다", () =>
  h.tx(async () => {
    const { eventId } = await revision();
    await detect("2099-01-06");
    const [cand] = await candidates(eventId);
    await client.query("select public.review_item_transition($1, 'rejected', 'w10e-test', '시험용 반려')", [cand.id]);
    const res = await h.attempt("select public.amendment_candidate_apply($1, $2, 'w10e-test')", [cand.id, await amendment()]);
    assert.equal(res.ok, false);
  }));

test("origin 제약 - auto는 후보 번호가 필요하고 manual은 후보 번호를 가질 수 없다", () =>
  h.tx(async () => {
    const am = await amendment();
    const snap = await h.snapshot();
    const base = "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by, origin, review_item_id) values ($1, 'announced', '2099-01-01', 'https://example.test/s', $2, 't', $3, $4)";
    const noItem = await h.attempt(base, [am, snap, "auto", null]);
    assert.equal(noItem.ok, false);
    assert.match(noItem.message, /amendment_events_origin_item/);
    const { eventId } = await revision();
    await detect("2099-01-06");
    const [cand] = await candidates(eventId);
    const manualWithItem = await h.attempt(base, [am, snap, "manual", cand.id]);
    assert.equal(manualWithItem.ok, false);
  }));

test("익명은 origin·review_item_id 칸을 읽을 수 없고 기존 공개 칸은 그대로 읽는다", () =>
  h.tx(async () => {
    const hidden = await h.attempt("select origin from public.amendment_events limit 1", [], "anon");
    assert.equal(hidden.ok, false);
    assert.match(hidden.message, /permission denied/);
    const hidden2 = await h.attempt("select review_item_id from public.amendment_events limit 1", [], "anon");
    assert.equal(hidden2.ok, false);
    assert.ok((await h.attempt("select id, stage, occurred_on from public.amendment_events limit 1", [], "anon")).ok);
  }));

test("새 함수는 anon·authenticated가 실행할 수 없다", () =>
  h.tx(async () => {
    for (const sql of ["select * from public.amendment_candidates_detect('2099-01-01'::date)", "select public.amendment_candidate_apply(1, 1, 'x')"]) {
      for (const role of ["anon", "authenticated"]) {
        const res = await h.attempt(sql, [], role);
        assert.equal(res.ok, false, `${role}: ${sql}`);
        assert.match(res.message, /permission denied/);
      }
    }
  }));
