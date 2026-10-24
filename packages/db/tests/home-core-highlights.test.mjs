// 홈 핵심 메시지 강조 낱말 (마이그레이션 20261024000071 — PO 결정 2026-10-24, HOME-01 · CORE-02)
//  · 씨앗: 새 핵심 메시지 + ["지방세", "부동산 세금", "재테크"]
//  · 저장 검사: 글자 목록 · 1~5개 · 비지 않음 · 30자 이하 · 중복 0 · 지금 핵심 메시지 안에 있는 글자
//  · anon은 이 키 한 줄을 읽는다 (settings_public_core_highlights)
// 문구는 '시험용' 가짜 글자다(세율·금액·조문 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const NEW_MESSAGE = "취득·보유·상속·증여·양도 등 모든 순간 — 지방세와 부동산 세금을 알면 재테크가 보입니다";
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
const setHighlights = (value) => attempt("update public.settings set value = $1::jsonb where key = 'home_core_highlights'", [JSON.stringify(value)]);
const setMessage = (value) => attempt("update public.settings set value = $1::jsonb where key = 'home_core_message'", [JSON.stringify(value)]);

test("씨앗 — 핵심 메시지는 새 문구, 강조 낱말은 지방세·부동산 세금·재테크 (PO가 이미 고친 값이면 그 메시지에 남은 낱말만)", async () => {
  const rows = (await client.query("select key, value from public.settings where key in ('home_core_message', 'home_core_highlights')")).rows;
  const message = rows.find((r) => r.key === "home_core_message").value;
  const highlights = rows.find((r) => r.key === "home_core_highlights").value;
  assert.ok(Array.isArray(highlights));
  for (const w of highlights) assert.ok(message.includes(w), `메시지 안에 있는 낱말: ${w}`);
  if (message === NEW_MESSAGE) assert.deepEqual(highlights, ["지방세", "부동산 세금", "재테크"]);
});

test("저장 — 메시지 안 낱말 1~5개는 통과", async () => {
  await tx(async () => {
    await client.query("update public.settings set value = to_jsonb($1::text) where key = 'home_core_message'", [NEW_MESSAGE]);
    assert.ok((await setHighlights(["지방세"])).ok, "1개");
    assert.ok((await setHighlights(["지방세", "부동산 세금", "재테크", "양도", "증여"])).ok, "5개");
    assert.ok((await setHighlights([" 재테크 "])).ok, "앞뒤 공백은 잘라 본다");
  });
});

test("저장 — 낱말이 핵심 메시지 안에 없으면 거부", async () => {
  await tx(async () => {
    await client.query("update public.settings set value = to_jsonb($1::text) where key = 'home_core_message'", [NEW_MESSAGE]);
    const r = await setHighlights(["지방세", "시험용없는낱말"]);
    assert.equal(r.ok, false);
    assert.match(r.message, /핵심 메시지 안에 없는 낱말/);
    assert.equal(r.code, "23514");
  });
});

test("저장 — 0개·6개·글자 목록 아님·빈 낱말·글자 아닌 칸·31자·같은 낱말 두 번은 거부", async () => {
  await tx(async () => {
    await client.query("update public.settings set value = to_jsonb($1::text) where key = 'home_core_message'", [NEW_MESSAGE]);
    assert.match((await setHighlights([])).message, /1~5개/);
    assert.match((await setHighlights(["지", "방", "세", "재", "테", "크"])).message, /1~5개/);
    assert.match((await setHighlights("지방세")).message, /글자 목록/);
    assert.match((await setHighlights(["  "])).message, /비어 있을 수 없습니다/);
    assert.match((await setHighlights([3])).message, /글자여야 합니다/);
    assert.match((await setHighlights(["지방세", "지방세"])).message, /같은 낱말/);
    await client.query("update public.settings set value = to_jsonb($1::text) where key = 'home_core_message'", ["가".repeat(31)]);
    assert.match((await setHighlights(["가".repeat(31)])).message, /30자 이하/);
  });
});

test("핵심 메시지를 먼저 바꾸면 새 메시지의 낱말로 맞출 수 있다 (옛 낱말은 거부)", async () => {
  await tx(async () => {
    assert.ok((await setMessage("시험용 메시지 — 시험용 낱말을 알면 보입니다")).ok);
    assert.equal((await setHighlights(["지방세"])).ok, false);
    assert.ok((await setHighlights(["시험용 낱말"])).ok);
  });
});

test("anon은 강조 낱말 한 줄을 읽고, 다른 비공개 설정 행은 못 읽는다", async () => {
  await tx(async () => {
    const r = await attempt("select value from public.settings where key = 'home_core_highlights'", [], "anon");
    assert.ok(r.ok);
    assert.equal(r.rows.length, 1);
    assert.ok(Array.isArray(r.rows[0].value));
    const hidden = await attempt("select key from public.settings where key = 'forbidden_phrases'", [], "anon");
    assert.equal(hidden.rows.length, 0);
  });
});
