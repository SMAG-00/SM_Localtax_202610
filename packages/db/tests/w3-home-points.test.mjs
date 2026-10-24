// W3 9단계 DB — 홈 핵심 메시지 검사 · 허브 "이 분야의 지방세 포인트" (docs/dev/W3_설계.md 1장 9단계 · 2.2 · 2.3 · 2.8, 01B CORE-02)
//  · hub_tax_points: 1~3줄(0줄·4줄 거부)·빈 줄·61자·'50년' 거부 / 기준일 필수(실제 날짜) / 사이트 안 지방세 해설 링크 1~3개 / 분야는 realestate·finance·local
//  · 서명은 저장된 초안에만(내용과 서명을 한 번에 0, 내용을 바꾸면 서명이 지워져야), 새 서명자는 지금 reviewer
//  · 공개 뷰는 서명이 살아 있는 분야만(서명자 역할을 거두면 0), 작성자·서명자 칸 0, anon은 설정 행·검사 함수 0
//  · home_core_message: 60자 이하, 경력 연수 표기 늘 거부
// 문구는 모두 '시험용' 가짜 글자다(세율·금액·조문 0).
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

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const authUser = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
async function staff(role) {
  const id = await authUser();
  await client.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, $2, 'admin:test')", [id, role]);
  return id;
}

const point = (over = {}) => ({
  lines: ["시험용 포인트 첫째 줄입니다.", "시험용 포인트 둘째 줄입니다."],
  base_date: "2026-10-01",
  links: [{ label: "시험용 지방세 해설", href: "/tax" }],
  drafted_by: "user:test-editor",
  drafted_at: "2026-10-21T00:00:00Z",
  reviewed_by: null,
  reviewed_at: null,
  ...over,
});
const setPoints = (value) => attempt("update public.settings set value = $1::jsonb where key = 'hub_tax_points'", [JSON.stringify(value)]);
const setCore = (value) => attempt("update public.settings set value = $1::jsonb where key = 'home_core_message'", [JSON.stringify(value)]);
const publicRows = async () => (await client.query("select section, lines, base_date::text as base_date, links from public.public_hub_tax_points order by section")).rows;

test("씨앗 — hub_tax_points는 빈 객체(문구 0), 공개 뷰 0행", async () => {
  const s = await one("select value from public.settings where key = 'hub_tax_points'");
  assert.ok(s, "설정 씨앗이 있다");
  await tx(async () => {
    await client.query("update public.settings set value = '{}'::jsonb where key = 'hub_tax_points'");
    assert.deepEqual(await publicRows(), []);
  });
});

test("포인트 줄 수 — 1줄·3줄 저장, 0줄·4줄 거부 / 빈 줄·61자·'50년' 거부", async () => {
  await tx(async () => {
    assert.ok((await setPoints({ realestate: point({ lines: ["시험용 한 줄"] }) })).ok);
    assert.ok((await setPoints({ realestate: point({ lines: ["시험용 1", "시험용 2", "시험용 3"] }) })).ok, "3줄");
    const four = await setPoints({ realestate: point({ lines: ["시험용 1", "시험용 2", "시험용 3", "시험용 4"] }) });
    assert.equal(four.ok, false);
    assert.match(four.message, /1~3줄.*4줄/);
    assert.equal(four.code, "23514");
    assert.equal((await setPoints({ realestate: point({ lines: [] }) })).ok, false, "0줄");
    assert.equal((await setPoints({ finance: point({ lines: ["시험용", "   "] }) })).ok, false, "빈 줄");
    assert.equal((await setPoints({ finance: point({ lines: ["가".repeat(61)] }) })).ok, false, "61자");
    assert.ok((await setPoints({ finance: point({ lines: ["가".repeat(60)] }) })).ok, "60자");
    for (const claim of ["시험용 50년 노하우", "시험용 오십 년", "시험용 반세기"]) {
      const r = await setPoints({ local: point({ lines: [claim] }) });
      assert.equal(r.ok, false, claim);
      assert.match(r.message, /경력 연수/);
    }
  });
});

test("기준일 필수(실제 날짜) · 링크 1~3개 사이트 안 지방세 해설만 · 분야 3개만 · 모르는 칸 거부", async () => {
  await tx(async () => {
    const { base_date: _drop, ...noDate } = point();
    assert.match((await setPoints({ realestate: noDate })).message, /기준일/);
    assert.equal((await setPoints({ realestate: point({ base_date: "2026-02-30" }) })).ok, false, "없는 날짜");
    assert.equal((await setPoints({ realestate: point({ base_date: "2026.10.01" }) })).ok, false, "모양");
    assert.equal((await setPoints({ realestate: point({ links: [] }) })).ok, false, "링크 0");
    for (const href of ["https://example.test/tax", "/tax?x=1", "/tax#a", "/news/", "//evil.test", "/calc", "/realestate"]) {
      assert.equal((await setPoints({ realestate: point({ links: [{ label: "시험용", href }] }) })).ok, false, href);
    }
    for (const href of ["/tax", "/tax/amendments", "/tax/interpretations", "/news/e2e-test-slug"]) {
      assert.ok((await setPoints({ realestate: point({ links: [{ label: "시험용", href }] }) })).ok, href);
    }
    const four = Array.from({ length: 4 }, (_, i) => ({ label: `시험용 ${i}`, href: "/tax" }));
    assert.equal((await setPoints({ realestate: point({ links: four }) })).ok, false, "링크 4개");
    assert.match((await setPoints({ tax: point() })).message, /realestate·finance·local/);
    assert.match((await setPoints({ realestate: { ...point(), note: "x" } })).message, /모르는 칸/);
    assert.equal((await setPoints({ realestate: point({ drafted_by: " " }) })).ok, false, "작성자");
  });
});

test("감수 서명 — 저장된 초안에만, reviewer만 / 내용과 서명 한 번에 0 / 서명 남긴 채 내용 바꾸기 0 / 공개 뷰는 서명 분야만", async () => {
  await tx(async () => {
    const reviewer = await staff("reviewer");
    const editor = await staff("editor");
    const now = new Date().toISOString();
    const draft = point();
    // 초안 저장 → 공개 0
    assert.ok((await setPoints({ realestate: draft, finance: point({ lines: ["시험용 금융 줄"] }) })).ok);
    assert.deepEqual(await publicRows(), []);
    // 내용과 서명을 한 번에 — 새 분야(local)에 서명까지
    const both = await setPoints({ realestate: draft, finance: point({ lines: ["시험용 금융 줄"] }), local: point({ reviewed_by: `user:${reviewer}`, reviewed_at: now }) });
    assert.equal(both.ok, false);
    assert.match(both.message, /저장된 초안에만/);
    // 편집 책임자의 서명 거부
    const byEditor = await setPoints({ realestate: { ...draft, reviewed_by: `user:${editor}`, reviewed_at: now }, finance: point({ lines: ["시험용 금융 줄"] }) });
    assert.match(byEditor.message, /reviewer/);
    // 서명자만 있고 시각 없음
    assert.match((await setPoints({ realestate: { ...draft, reviewed_by: `user:${reviewer}` }, finance: point({ lines: ["시험용 금융 줄"] }) })).message, /함께/);
    // 감수위원 서명 → 공개 뷰에 그 분야만, 줄 순서 그대로
    const signed = { ...draft, reviewed_by: `user:${reviewer}`, reviewed_at: now };
    assert.ok((await setPoints({ realestate: signed, finance: point({ lines: ["시험용 금융 줄"] }) })).ok);
    assert.deepEqual(await publicRows(), [{ section: "realestate", lines: draft.lines, base_date: "2026-10-01", links: draft.links }]);
    // 서명을 남긴 채 문구를 바꾸면 거부
    const edited = await setPoints({ realestate: { ...signed, lines: ["시험용 바뀐 줄"] }, finance: point({ lines: ["시험용 금융 줄"] }) });
    assert.match(edited.message, /저장된 초안에만/);
    assert.equal((await setPoints({ realestate: { ...signed, base_date: "2026-10-02" }, finance: point({ lines: ["시험용 금융 줄"] }) })).ok, false, "기준일도 내용");
    // 다른 분야만 고치면 서명 분야는 그대로
    assert.ok((await setPoints({ realestate: signed, finance: point({ lines: ["시험용 금융 줄 고침"] }) })).ok);
    assert.equal((await publicRows()).length, 1);
    // 서명자의 감수위원 역할을 거두면 공개 0 — 그래도 다른 분야 쓰기는 막히지 않는다(서명이 바뀌지 않음)
    await client.query("delete from public.staff_roles where user_id = $1 and role = 'reviewer'", [reviewer]);
    assert.deepEqual(await publicRows(), []);
    assert.ok((await setPoints({ realestate: signed, finance: point({ lines: ["시험용 금융 줄 다시"] }) })).ok);
    // 서명을 지우고 내용을 바꾸면 저장(감수 전 → 공개 0)
    await client.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, 'reviewer', 'admin:test')", [reviewer]);
    assert.ok((await setPoints({ realestate: point({ lines: ["시험용 바뀐 줄"] }) })).ok);
    assert.deepEqual(await publicRows(), []);
  });
});

test("공개 뷰 칸 — 작성자·서명자 0 / anon은 뷰만 읽고 설정 행·검사 함수 0", async () => {
  const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_hub_tax_points' order by ordinal_position")).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ["section", "lines", "base_date", "links", "reviewed_at"]);
  await tx(async () => {
    const reviewer = await staff("reviewer");
    await client.query("update public.settings set value = $1::jsonb where key = 'hub_tax_points'", [JSON.stringify({ local: point() })]);
    await client.query("update public.settings set value = $1::jsonb where key = 'hub_tax_points'", [JSON.stringify({ local: point({ reviewed_by: `user:${reviewer}`, reviewed_at: new Date().toISOString() }) })]);
    const anonView = await attempt("select section, lines from public.public_hub_tax_points", [], "anon");
    assert.ok(anonView.ok, anonView.message);
    assert.deepEqual(anonView.rows.map((r) => r.section), ["local"]);
    const anonSetting = await attempt("select key from public.settings where key = 'hub_tax_points'", [], "anon");
    assert.ok(!anonSetting.ok || anonSetting.rows.length === 0, "anon은 초안 설정 행을 못 읽는다");
    const fn = await attempt("select public.home_points_settings_guard()", [], "anon");
    assert.equal(fn.ok, false, "anon은 검사 함수를 못 부른다");
  });
});

test("홈 핵심 메시지 — PRD 문장 저장, 61자·글자 아님·경력 연수 표기 거부", async () => {
  await tx(async () => {
    assert.ok((await setCore("취득·보유·상속·증여·양도 등 모든 순간 — 지방세와 부동산 세금을 알면 재테크가 보입니다")).ok);
    assert.ok((await setCore("가".repeat(60))).ok, "60자");
    assert.match((await setCore("가".repeat(61))).message, /60자/);
    assert.equal((await setCore(["시험용"])).ok, false, "글자 아님");
    for (const claim of ["지방세 50년 시험용 메시지", "시험용 ５０년 경험", "Fifty Years 시험용"]) {
      const r = await setCore(claim);
      assert.equal(r.ok, false, claim);
      assert.match(r.message, /경력 연수/);
    }
    assert.ok((await setCore("1950년 이후 시험용 메시지")).ok, "연도는 막지 않는다");
  });
});
