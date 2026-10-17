// 상황 카드·상황 페이지 situations (PRD-01A UX-05 · PRD-01B FAM-02) — docs/dev/W2-b_설계.md 3장
// ① section 없이 저장 불가 ② 먼저 확인할 것: 3개 이하·항목마다 제목, 공개면 정확히 3개(2개·4개 거부) + 세무 감수 기록
// ③ 감수 대상 칸을 고치면 감수 기록이 지워진다 — 공개 행은 다시 감수하거나 내려야 저장 ④ 허브 자리: 상한(settings, 초기값 4) 초과·같은 자리 거부,
//    상한을 바꾸면 배포 없이 다음 저장부터 ⑤ 일반적 체크리스트는 항목 1개 이상 + 고지 ⑥ 자주 틀리는 점 3개 이하·빈 글자 없음
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

async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
function insertSql(table, cols) {
  const keys = Object.keys(cols);
  return { sql: `insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, params: keys.map((k) => cols[k]) };
}
const insert = async (table, cols) => {
  const { sql, params } = insertSql(table, cols);
  return (await client.query(sql, params)).rows[0];
};
const tryInsert = (table, cols) => {
  const { sql, params } = insertSql(table, cols);
  return attempt(sql, params);
};

const checks = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ title: `확인 ${i + 1}`, note: "할 일 한 줄" })));
const reviewer = () => insert("people", { slug: uniq("rv"), name: "세무 감수위원", roles: ["reviewer"] });
const base = (over = {}) => ({ slug: uniq("sit"), section: "tax", title: "차를 팔았어요·폐차했어요", pictogram: "car-sold", ...over });
async function published(over = {}) {
  const rv = await reviewer();
  return insert("situations", base({ checks: checks(3), reviewer_id: rv.id, reviewed_at: new Date(), visible: true, ...over }));
}

test("분야(section) 없이는 저장 불가, slug는 영문 소문자·숫자·'-'만", () =>
  tx(async () => {
    const noSection = await tryInsert("situations", { slug: uniq("s"), title: "고지서를 받았어요", pictogram: "notice-received" });
    assert.equal(noSection.ok, false);
    assert.equal(noSection.code, "23502", "section not null");
    for (const slug of ["Car-Sold", "car sold", "car_sold", "-car", "차를-팔았어요"]) {
      assert.equal((await tryInsert("situations", base({ slug }))).ok, false, slug);
    }
    assert.ok((await tryInsert("situations", base({ slug: "car-sold-2" }))).ok);
    assert.equal((await tryInsert("situations", base({ pictogram: "Car Sold" }))).ok, false, "픽토그램 이름 형식");
  }));

test("먼저 확인할 것 — 초안은 0~3개, 4개는 저장 거부, 항목마다 제목 글자 필수", () =>
  tx(async () => {
    for (const n of [0, 1, 2, 3]) assert.ok((await tryInsert("situations", base({ checks: checks(n) }))).ok, `${n}개 초안`);
    const four = await tryInsert("situations", base({ checks: checks(4) }));
    assert.equal(four.ok, false, "4개");
    assert.equal(four.code, "23514");
    for (const bad of [[{ note: "제목 없음" }], [{ title: "  " }], ["글자만"], [{ title: 3 }], { title: "객체" }]) {
      const r = await tryInsert("situations", base({ checks: JSON.stringify(bad) }));
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "23514", r.message);
    }
  }));

test("공개 — 정확히 3개 + 세무 감수 기록이 있어야 한다 (2개·감수 없음 거부)", () =>
  tx(async () => {
    const rv = await reviewer();
    const two = await tryInsert("situations", base({ checks: checks(2), reviewer_id: rv.id, reviewed_at: new Date(), visible: true }));
    assert.equal(two.ok, false, "2개는 공개 불가");
    assert.equal(two.code, "23514");
    const noReview = await tryInsert("situations", base({ checks: checks(3), visible: true }));
    assert.equal(noReview.ok, false, "감수 기록 없이 공개 불가");
    const halfReview = await tryInsert("situations", base({ checks: checks(3), reviewer_id: rv.id, visible: true }));
    assert.equal(halfReview.ok, false, "감수자만 있고 감수 시각이 없다");
    const ok = await published();
    assert.equal(ok.visible, true);
    const toTwo = await attempt("update public.situations set checks = $2::jsonb, reviewed_at = now() + interval '1 second' where id = $1", [ok.id, checks(2)]);
    assert.equal(toTwo.ok, false, "공개 상황을 2개로 줄일 수 없다");
  }));

test("감수 대상 칸을 고치면 감수 기록이 지워진다 — 공개 행은 다시 감수해야 저장, 초안은 저장되고 감수가 비워진다", () =>
  tx(async () => {
    const live = await published();
    const edited = await attempt("update public.situations set checks = $2::jsonb where id = $1", [live.id, JSON.stringify([{ title: "바꾼 1" }, { title: "바꾼 2" }, { title: "바꾼 3" }])]);
    assert.equal(edited.ok, false, "감수 없이 공개 문장을 바꿀 수 없다");
    const rereviewed = await attempt(
      "update public.situations set checks = $2::jsonb, reviewed_at = now() + interval '1 minute' where id = $1 returning reviewer_id, reviewed_at",
      [live.id, JSON.stringify([{ title: "바꾼 1" }, { title: "바꾼 2" }, { title: "바꾼 3" }])],
    );
    assert.ok(rereviewed.ok, rereviewed.message);
    assert.ok(rereviewed.rows[0].reviewer_id !== null);
    for (const [col, value] of [
      ["mistakes", ["자주 틀리는 점 하나"]],
      ["checklist", JSON.stringify({ items: ["등기부 확인"], notice: "일반적인 안내이며 개별 사건의 확정 안내가 아닙니다" })],
    ]) {
      const r = await attempt(`update public.situations set ${col} = $2 where id = $1`, [live.id, value]);
      assert.equal(r.ok, false, `${col}도 감수 대상`);
    }
    const title = await attempt("update public.situations set title = '차를 팔았어요' where id = $1 returning reviewer_id", [live.id]);
    assert.ok(title.ok, "제목은 감수 대상이 아니다");
    assert.ok(title.rows[0].reviewer_id !== null);

    const draft = await insert("situations", base({ checks: checks(3), reviewer_id: (await reviewer()).id, reviewed_at: new Date() }));
    const draftEdit = await attempt("update public.situations set checks = $2::jsonb where id = $1 returning reviewer_id, reviewed_at", [draft.id, checks(2)]);
    assert.ok(draftEdit.ok, draftEdit.message);
    assert.deepEqual(draftEdit.rows[0], { reviewer_id: null, reviewed_at: null });
  }));

test("허브 자리 — 상한 4에서 1~4는 저장, 5번째는 거부, 같은 분야 같은 자리 거부, 다른 분야는 같은 자리 허용, 허브 밖 공개는 막지 않는다", () =>
  tx(async () => {
    for (const slot of [1, 2, 3, 4]) assert.ok((await tryInsert("situations", base({ hub_slot: slot }))).ok, `자리 ${slot}`);
    const fifth = await tryInsert("situations", base({ hub_slot: 5 }));
    assert.equal(fifth.ok, false);
    assert.match(fifth.message, /4장까지/);
    const same = await tryInsert("situations", base({ hub_slot: 2 }));
    assert.equal(same.ok, false);
    assert.equal(same.code, "23505");
    assert.ok((await tryInsert("situations", base({ section: "realestate", hub_slot: 2 }))).ok, "분야마다 따로");
    assert.equal((await tryInsert("situations", base({ hub_slot: 0 }))).ok, false);
    assert.ok((await published({ hub_slot: null })).visible, "허브에 내지 않는 상황 페이지 공개는 막지 않는다");
  }));

test("허브 상한은 settings 값 — 바꾸면 다음 저장부터 적용 (배포 없이)", () =>
  tx(async () => {
    await client.query("update public.settings set value = '2'::jsonb where key = 'hub_situation_limit'");
    assert.ok((await tryInsert("situations", base({ section: "finance", hub_slot: 2 }))).ok);
    assert.equal((await tryInsert("situations", base({ section: "finance", hub_slot: 3 }))).ok, false, "상한 2");
    await client.query("update public.settings set value = '5'::jsonb where key = 'hub_situation_limit'");
    assert.ok((await tryInsert("situations", base({ section: "finance", hub_slot: 5 }))).ok, "상한 5");
    await client.query("update public.settings set value = '\"많이\"'::jsonb where key = 'hub_situation_limit'");
    assert.equal((await tryInsert("situations", base({ section: "local", hub_slot: 5 }))).ok, false, "숫자가 아니면 기본값 4");
  }));

test("일반적 체크리스트 — 항목 1개 이상과 고지 글자, 자주 틀리는 점은 3개 이하·빈 글자 없음, 연결 칸은 { feature } 목록", () =>
  tx(async () => {
    const NOTICE = "일반적인 안내이며 개별 사건의 확정 안내가 아닙니다";
    assert.ok((await tryInsert("situations", base({ checklist: JSON.stringify({ items: ["상속 등기 기한 확인"], notice: NOTICE }) }))).ok);
    for (const bad of [{ items: [], notice: NOTICE }, { items: ["항목"] }, { items: ["항목"], notice: " " }, { items: [""], notice: NOTICE }, { items: [1], notice: NOTICE }, ["항목"]]) {
      const r = await tryInsert("situations", base({ checklist: JSON.stringify(bad) }));
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "23514", r.message);
    }
    assert.ok((await tryInsert("situations", base({ mistakes: ["하나", "둘", "셋"] }))).ok);
    assert.equal((await tryInsert("situations", base({ mistakes: ["하나", "둘", "셋", "넷"] }))).ok, false);
    assert.equal((await tryInsert("situations", base({ mistakes: ["  "] }))).ok, false);
    assert.ok((await tryInsert("situations", base({ tool_links: JSON.stringify([{ feature: "sm_calculator" }]) }))).ok);
    assert.equal((await tryInsert("situations", base({ tool_links: JSON.stringify(["sm_calculator"]) }))).ok, false);
  }));
