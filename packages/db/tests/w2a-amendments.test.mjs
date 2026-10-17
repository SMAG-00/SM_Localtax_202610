// 개정 트래커(amendments · amendment_events) — 01B TX-07 · TX-08, CAT-04.
// 단계 기록은 날짜·원문 URL·원본 스냅샷이 모두 있어야 저장되고(건너뛴 단계는 사유로), 앞 순서로 돌아가는 기록은 거부,
// 잘못된 기록은 사유가 있는 정정 기록으로만 고친다. 현재 단계는 가장 늦은 순서의 유효 기록에서 계산한다(기사에 저장하지 않는다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

async function attempt(sql, params = [], role = null) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    if (role) await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const amendment = async () => (await client.query("insert into public.amendments (slug, title) values ($1, '2026년 지방세제 개편안') returning id", [uniq("am")])).rows[0].id;
const snapshot = async () =>
  (await client.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('mois', 'https://www.mois.go.kr/a', 'h', '원문') returning id")).rows[0].id;
async function record(amendmentId, stage, over = {}, role = "service_role") {
  const cols = {
    amendment_id: amendmentId,
    stage,
    occurred_on: "2026-08-01",
    source_url: "https://www.mois.go.kr/frt/bbs/a.do",
    snapshot_id: await snapshot(),
    recorded_by: "user:편집자",
    ...over,
  };
  const keys = Object.keys(cols);
  return attempt(
    `insert into public.amendment_events (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    keys.map((k) => cols[k]),
    role,
  );
}
const current = async (id) => (await client.query("select current_stage, current_stage_on::text from public.amendment_current_stages where amendment_id = $1", [id])).rows[0];

for (const field of ["occurred_on", "source_url", "snapshot_id"]) {
  test(`단계 기록 — ${field}가 비면 거부 (소유자도)`, () =>
    tx(async () => {
      const am = await amendment();
      for (const role of ["service_role", null]) {
        const blanks = field === "source_url" ? [null, "", "  "] : [null];
        for (const b of blanks) assert.equal((await record(am, "announced", { [field]: b }, role)).ok, false, `${field}=${JSON.stringify(b)}`);
      }
    }));
}

test("건너뛴 단계(해당 없음)는 사유가 있어야 하고, 날짜·원문 없이 저장된다", () =>
  tx(async () => {
    const am = await amendment();
    assert.ok((await record(am, "announced")).ok);
    assert.equal((await record(am, "pre_notice", { skipped: true, occurred_on: null, source_url: null, snapshot_id: null })).ok, false, "사유 없음");
    const r = await record(am, "pre_notice", { skipped: true, skip_reason: "시행령 개정 — 입법예고 생략", occurred_on: null, source_url: null, snapshot_id: null });
    assert.ok(r.ok, r.message);
    assert.equal((await current(am)).current_stage, "announced", "건너뛴 단계는 현재 단계가 아니다");
  }));

test("현재 단계는 가장 늦은 순서의 기록이다", () =>
  tx(async () => {
    const am = await amendment();
    assert.equal(await current(am), undefined, "기록이 없으면 현재 단계 없음");
    await record(am, "announced", { occurred_on: "2026-07-25" });
    await record(am, "pre_notice", { occurred_on: "2026-08-10" });
    assert.equal((await current(am)).current_stage, "pre_notice");
    await record(am, "submitted", { occurred_on: "2026-09-02" });
    const c = await current(am);
    assert.equal(c.current_stage, "submitted");
    assert.equal(c.current_stage_on, "2026-09-02");
  }));

test("앞 순서로 돌아가는 기록은 거부 (입법예고 → 국회 제출 뒤 발표)", () =>
  tx(async () => {
    const am = await amendment();
    await record(am, "pre_notice");
    await record(am, "submitted");
    const r = await record(am, "announced");
    assert.equal(r.ok, false);
    assert.equal((await current(am)).current_stage, "submitted");
  }));

test("이미 기록된 단계를 다시 기록하면 거부 — 고치려면 정정 기록으로", () =>
  tx(async () => {
    const am = await amendment();
    await record(am, "announced");
    assert.equal((await record(am, "announced", { occurred_on: "2026-08-02" })).ok, false);
  }));

test("정정 기록은 사유가 있어야 하고, 정정된 기록 대신 정정 기록이 쓰인다", () =>
  tx(async () => {
    const am = await amendment();
    await record(am, "announced");
    const wrong = await record(am, "passed", { occurred_on: "2026-09-30" });
    assert.equal((await current(am)).current_stage, "passed");
    assert.equal((await record(am, "submitted", { correction_of: wrong.rows[0].id })).ok, false, "사유 없는 정정");
    const fix = await record(am, "submitted", { correction_of: wrong.rows[0].id, reason: "의결이 아니라 국회 제출 — 잘못 기록" });
    assert.ok(fix.ok, fix.message);
    assert.equal((await current(am)).current_stage, "submitted");
    assert.equal((await record(am, "submitted", { correction_of: wrong.rows[0].id, reason: "두 번째 정정" })).ok, false, "같은 기록을 두 번 정정할 수 없다");
  }));

test("정정 대상은 같은 개정안의 기록이어야 한다", () =>
  tx(async () => {
    const a = await amendment();
    const b = await amendment();
    const ev = await record(a, "announced");
    assert.equal((await record(b, "announced", { correction_of: ev.rows[0].id, reason: "x" })).ok, false);
  }));

test("단계 기록은 추가만 — 수정·삭제·비우기는 소유자도 거부", () =>
  tx(async () => {
    const am = await amendment();
    const ev = (await record(am, "announced")).rows[0].id;
    for (const role of ["service_role", null]) {
      assert.equal((await attempt("update public.amendment_events set occurred_on = '2026-01-01' where id = $1", [ev], role)).ok, false, `update ${role}`);
      assert.equal((await attempt("delete from public.amendment_events where id = $1", [ev], role)).ok, false, `delete ${role}`);
    }
    assert.equal((await attempt("truncate public.amendment_events cascade")).ok, false);
  }));

test("개정안 공개 상태는 draft·public·hidden만", () =>
  tx(async () => {
    assert.equal((await attempt("insert into public.amendments (slug, title, status) values ($1, 't', 'live')", [uniq("am")])).ok, false);
    assert.ok((await attempt("insert into public.amendments (slug, title, status) values ($1, 't', 'public')", [uniq("am")])).ok);
  }));
