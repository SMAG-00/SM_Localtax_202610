// W2-c 5단계 DB — 공동 기획 배지의 제휴사 이름 articles.partner_badge_name (ART-10 '이미 붙은 배지는 남는다', docs/dev/W2-c_설계.md 9장 #52·#56)
//  · 공동 기획(co_planned) + 제휴사 → 그 제휴사 이름, 광고(ad)·표기 없음 → 비움. 넣은 값과 상관없이 트리거가 다시 계산한다
//  · 제휴사를 비공개로 내려도 anon은 공개 기사의 배지 이름을 읽는다 — 비공개 제휴사 행(소개·누리집·계약)은 그대로 0행
//  · 제휴사 이름을 고치면 그 제휴사의 공동 기획 기사 배지 이름도 같이 바뀐다 · 제휴사를 바꾸면 이름도 따라간다
// 모든 시험은 트랜잭션 안에서 하고 되돌린다 (남는 행 0).
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

async function as(role, sql, params = []) {
  await client.query("savepoint t");
  try {
    await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const partner = async (name, visible = true) => (await client.query("insert into public.partners (name, kind, visible) values ($1, 'tax_firm', $2) returning id", [name, visible])).rows[0].id;
async function article(cols) {
  const all = { slug: uniq("badge"), title: "배지 시험", section: "tax", content_type: "sponsored", status: "published", first_published_at: "2026-10-01T00:00:00Z", ...cols };
  const keys = Object.keys(all);
  return (await client.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id, partner_badge_name`, Object.values(all))).rows[0];
}
const badge = async (id) => (await client.query("select partner_badge_name from public.articles where id = $1", [id])).rows[0].partner_badge_name;

test("공동 기획 + 제휴사 → 제휴사 이름, 광고·표기 없음 → 비움 — 넣은 값과 상관없이 다시 계산", async () => {
  await tx(async () => {
    const p = await partner("가온세무법인");
    const co = await article({ label: "co_planned", partner_id: p });
    assert.equal(co.partner_badge_name, "가온세무법인");
    const ad = await article({ label: "ad", partner_id: p });
    assert.equal(ad.partner_badge_name, null, "광고는 이름 0 — 유형 배지 '광고'");
    const none = await article({ content_type: "explainer", label: "none" });
    assert.equal(none.partner_badge_name, null);
    const forged = await article({ label: "co_planned", partner_id: p, partner_badge_name: "꾸민 이름" });
    assert.equal(forged.partner_badge_name, "가온세무법인", "넣은 이름은 무시");
    await client.query("update public.articles set partner_badge_name = '꾸민 이름' where id = $1", [co.id]);
    assert.equal(await badge(co.id), "가온세무법인", "고친 이름도 무시");
    await client.query("update public.articles set label = 'ad' where id = $1", [co.id]);
    assert.equal(await badge(co.id), null, "공동 기획 → 광고로 바꾸면 비움");
  });
});

test("제휴사 이름을 고치면 공동 기획 기사 배지도 같이, 제휴사를 바꾸면 그 제휴사 이름으로", async () => {
  await tx(async () => {
    const a = await partner("가온세무법인");
    const b = await partner("누리회계");
    const co = await article({ label: "co_planned", partner_id: a });
    const ad = await article({ label: "ad", partner_id: a });
    await client.query("update public.partners set name = '가온세무법인 서울' where id = $1", [a]);
    assert.equal(await badge(co.id), "가온세무법인 서울");
    assert.equal(await badge(ad.id), null);
    await client.query("update public.articles set partner_id = $2 where id = $1", [co.id, b]);
    assert.equal(await badge(co.id), "누리회계");
  });
});

test("제휴사를 비공개로 내려도 anon은 공개 기사의 배지 이름을 읽는다 — 비공개 제휴사 행은 그대로 0행", async () => {
  await tx(async () => {
    const p = await partner("숨는제휴");
    const co = await article({ label: "co_planned", partner_id: p });
    await client.query("update public.partners set visible = false, contract_to = '2026-01-01', contract_from = '2025-01-01' where id = $1", [p]);
    for (const role of ["anon", "authenticated"]) {
      const view = await as(role, "select partner_badge_name, partner_id from public.public_articles where id = $1", [co.id]);
      assert.ok(view.ok, view.message);
      assert.deepEqual(view.rows, [{ partner_badge_name: "숨는제휴", partner_id: p }]);
      const table = await as(role, "select partner_badge_name from public.articles where id = $1", [co.id]);
      assert.deepEqual(table.rows, [{ partner_badge_name: "숨는제휴" }], `${role} 기사 표 칸 권한`);
      const hidden = await as(role, "select id, name from public.partners where id = $1", [p]);
      assert.deepEqual(hidden.rows, [], `${role} 비공개 제휴사 행 0`);
    }
    // 초안 기사의 배지 이름은 anon 0 (기사 공개 범위 그대로)
    const draft = await article({ label: "co_planned", partner_id: p, status: "draft", first_published_at: null });
    const r = await as("anon", "select partner_badge_name from public.articles where id = $1", [draft.id]);
    assert.deepEqual(r.rows, []);
  });
});
