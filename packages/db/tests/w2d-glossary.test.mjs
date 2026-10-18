// W2-d 3단계 — 용어사전 공개 상태·쉬운 풀이 한도 (docs/dev/W2-d_설계.md 2.5 · 8.2, PRD-01A GLO-01 · GLO-02, W2-b 설계 9장 #12)
//  · glossary_terms.visible — 새 용어는 숨김(기본값 false, 설계 2.5 glossary.visible_default). 편집국이 공개로 바꾼 용어만
//    anon·authenticated가 읽는다(용어사전 화면·허브와 상황의 용어 칩·검색·본문 툴팁이 모두 이 경계를 쓴다)
//  · 검색 함수 search_public도 함수 안에서 공개 용어만 고른다 — service_role·소유자가 불러도 숨긴 용어 0 (심층 방어)
//  · 쉬운 풀이 61자는 저장된다(GLO-01 '61자는 저장 경고' — 경고는 편집 화면·API가 낸다), 한도(설계 2.5 glossary.plain_max)를 넘으면 DB가 거부
//  · 운영 설정 기능 키 glossary 씨앗은 false — 용어사전 화면은 공개 승인 전 404·링크 0
// 모두 한 트랜잭션 안에서 넣고 되돌린다. 로컬 DB에서만 돈다. 용어는 시험용 가짜 낱말이다(실제 용어 풀이를 넣지 않는다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-d_설계.md");
const MD = fs.readFileSync(DESIGN, "utf8");

/** 설계 2.5 표 — 이름 → 값 배열 */
function values() {
  const sec = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  const sub = sec?.split(/^### /m).find((s) => s.startsWith("2.5"));
  assert.ok(sub, "설계 문서 2.5 소절이 없다");
  const out = new Map();
  for (const line of sub.split("\n").filter((l) => /^\| glossary\./.test(l))) {
    const [name, cell] = line.split("|").slice(1, -1).map((c) => c.trim());
    out.set(name.split(/\s/)[0], [...cell.matchAll(/`([^`]*)`/g)].map((m) => m[1]));
  }
  return out;
}
const V = values();
const one = (name) => {
  const v = V.get(name);
  assert.ok(v?.length, `설계 2.5에 '${name}'이 없다`);
  return v[0];
};
const PLAIN_GUIDE = Number(one("glossary.plain_guide"));
const PLAIN_MAX = Number(one("glossary.plain_max"));

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
    return { ok: false, code: err.code, message: err.message };
  }
}
let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
async function insert(table, cols) {
  const k = Object.keys(cols);
  const sql = `insert into public.${table} (${k.join(", ")}) values (${k.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return (await client.query(sql, k.map((x) => cols[x]))).rows[0];
}
const ids = (rows) => rows.map((r) => Number(r.id)).sort((a, b) => a - b);
const keys = (rows) => rows.map((r) => `${r.kind}:${r.ref}`).sort();

/** 공개 용어 하나와 숨긴 용어 하나 — 같은 표식 낱말이 든 가짜 용어 */
async function world(fn) {
  return tx(async () => {
    const M = `가짜용어표식${process.pid}${++seq}`;
    const shown = await insert("glossary_terms", { term: `${M} 갑`, plain: "시험용 풀이 하나", section: ["tax"], visible: true });
    const hidden = await insert("glossary_terms", { term: `${M} 을`, plain: "시험용 풀이 둘", section: ["tax"] });
    return fn({ M, shown, hidden });
  });
}

test(`새 용어는 숨김으로 저장된다 — 칸 기본값 ${one("glossary.visible_default")} (설계 2.5 glossary.visible_default)`, () =>
  tx(async () => {
    const { rows } = await client.query(
      "select column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'glossary_terms' and column_name = 'visible'",
    );
    assert.equal(rows.length, 1, "visible 칸이 있다");
    assert.equal(rows[0].column_default, one("glossary.visible_default"));
    assert.equal(rows[0].is_nullable, "NO");
    const t = await insert("glossary_terms", { term: uniq("가짜용어") });
    assert.equal(t.visible, false);
    assert.equal((await attempt("insert into public.glossary_terms (term, visible) values ($1, null)", [uniq("가짜용어")])).ok, false, "공개 상태는 비울 수 없다");
  }));

test(`쉬운 풀이 ${PLAIN_GUIDE + 1}자는 저장된다(경고는 편집 화면이 낸다) — ${PLAIN_MAX}자까지 저장, ${PLAIN_MAX + 1}자는 DB가 거부 (GLO-01)`, () =>
  tx(async () => {
    assert.ok(PLAIN_GUIDE < PLAIN_MAX, "경고 기준이 저장 한도보다 작다");
    for (const n of [PLAIN_GUIDE, PLAIN_GUIDE + 1, PLAIN_MAX]) {
      const r = await attempt("insert into public.glossary_terms (term, plain) values ($1, $2) returning char_length(plain) as n", [uniq("가짜용어"), "가".repeat(n)]);
      assert.ok(r.ok, `${n}자: ${r.message}`);
      assert.equal(r.rows[0].n, n);
    }
    const over = await attempt("insert into public.glossary_terms (term, plain) values ($1, $2)", [uniq("가짜용어"), "가".repeat(PLAIN_MAX + 1)]);
    assert.equal(over.ok, false);
    assert.equal(over.code, "23514");
    assert.match(over.message, /glossary_terms_plain_max/);
    // 공백도 한 글자로 센다 (편집 화면과 같은 셈)
    assert.equal((await attempt("insert into public.glossary_terms (term, plain) values ($1, $2)", [uniq("가짜용어"), `${"가".repeat(PLAIN_MAX)} `])).ok, false);
  }));

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 공개 용어만 읽힌다, 숨긴 용어는 0행 (번호로 골라도)`, () =>
    world(async ({ M, shown, hidden }) => {
      const all = await attempt("select id, term, plain, definition, related, section, source from public.glossary_terms where term like $1", [`${M}%`], role);
      assert.ok(all.ok, all.message);
      assert.deepEqual(ids(all.rows), [Number(shown.id)]);
      const byId = await attempt("select id from public.glossary_terms where id = $1", [hidden.id], role);
      assert.ok(byId.ok, byId.message);
      assert.equal(byId.rows.length, 0, "숨긴 용어는 번호로도 0");
      const flag = await attempt("select visible from public.glossary_terms where term like $1", [`${M}%`], role);
      assert.ok(flag.ok, flag.message);
      assert.deepEqual(flag.rows.map((r) => r.visible), [true], "공개 상태 칸은 읽히지만 늘 true다");
      assert.equal((await attempt("select jargon from public.glossary_terms limit 1", [], role)).ok, false, "전문 용어 표시는 내부 칸");
    }));

  test(`${role} — 공개 상태를 바꾸지 못한다`, () =>
    world(async ({ hidden }) => {
      const r = await attempt("update public.glossary_terms set visible = true where id = $1", [hidden.id], role);
      assert.equal(r.ok, false);
      assert.equal(r.code, "42501");
    }));
}

test("service_role(서버 — 편집국 API·발행 점검)은 숨긴 용어도 읽는다", () =>
  world(async ({ M, shown, hidden }) => {
    const r = await attempt("select id from public.glossary_terms where term like $1", [`${M}%`], "service_role");
    assert.ok(r.ok, r.message);
    assert.deepEqual(ids(r.rows), [Number(shown.id), Number(hidden.id)].sort((a, b) => a - b));
  }));

test("검색 함수 — 숨긴 용어는 anon·authenticated·service_role·소유자 모두 0 (함수 안에서도 공개 조건 — 심층 방어), 공개 용어는 찾힌다", () =>
  world(async ({ M, shown, hidden }) => {
    for (const role of ["anon", "authenticated", "service_role", null]) {
      const r = await attempt("select kind, ref from public.search_public(p_query => $1, p_kinds => array['glossary'])", [M], role);
      assert.ok(r.ok, `${role ?? "소유자"}: ${r.message}`);
      assert.deepEqual(keys(r.rows), [`glossary:${shown.id}`], `${role ?? "소유자"}: 공개 용어만`);
      assert.ok(!keys(r.rows).includes(`glossary:${hidden.id}`));
    }
    // 공개로 바꾸면 다음 검색부터 찾힌다 (색인·생성 칸을 다시 만들 필요 없다)
    await client.query("update public.glossary_terms set visible = true where id = $1", [hidden.id]);
    const after = await attempt("select kind, ref from public.search_public(p_query => $1, p_kinds => array['glossary'])", [M], "anon");
    assert.deepEqual(keys(after.rows), [`glossary:${shown.id}`, `glossary:${hidden.id}`].sort());
  }));

test("상황 카드의 용어 칩 — 숨긴 용어 번호가 걸려 있어도 anon에게는 공개 용어만", () =>
  world(async ({ shown, hidden }) => {
    const r = await attempt("select id from public.glossary_terms where id = any($1::bigint[])", [[shown.id, hidden.id]], "anon");
    assert.ok(r.ok, r.message);
    assert.deepEqual(ids(r.rows), [Number(shown.id)]);
  }));

test(`운영 설정 기능 키 ${one("glossary.feature")} 씨앗은 false — 용어사전 화면은 공개 승인 전 닫힘`, async () => {
  const { rows } = await client.query("select value from public.settings where key = 'feature_flags'");
  assert.equal(rows[0].value[one("glossary.feature")], false);
});
