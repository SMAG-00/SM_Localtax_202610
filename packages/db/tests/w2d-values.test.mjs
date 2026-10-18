// W2-d 값 목록 — docs/dev/W2-d_설계.md 2장 표와 DB가 같다 (w2a·w2b-values와 같은 방식 — 문서를 읽어 대조한다)
//  2.1 결과 종류·기사 유형·인물 역할 — 함수 몸의 값 목록이 표와 같고(종류는 차례까지), 표의 값은 받고 표 밖 값은 22023
//  2.2 정규화 견본 — 입력마다 검색 함수가 쓴 낱말(query_terms)이 '찾는 낱말'과 같고, 붙여서 0건이면 '다시 찾는 낱말'로 찾는다
//  2.3 한도 — 함수 몸의 상수·기본값이 표와 같고, 경계 값은 받고 한 칸 밖은 거부(검색어 글자는 앞 100글자까지만 읽는다)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-d_설계.md");
const MD = fs.readFileSync(DESIGN, "utf8");

function section(no) {
  const sec = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  assert.ok(sec, "설계 문서 2장을 찾지 못했다");
  const sub = sec.split(/^### /m).find((s) => s.startsWith(no));
  assert.ok(sub, `설계 문서 ${no} 소절이 없다`);
  return sub;
}
const ticks = (s) => [...s.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const rowsOf = (sub) => sub.split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

/** 2.1·2.3 — 이름(첫 낱말) → 값 배열 */
function lists(no) {
  const out = new Map();
  for (const [name, values] of rowsOf(section(no)).slice(1)) out.set(name.split(/\s/)[0], ticks(values));
  return out;
}
const VALUES = lists("2.1");
const LIMITS = lists("2.3");
/** 2.2 — [{ input, terms, split }] — split null이면 다시 찾지 않는다 */
const GOLDEN = rowsOf(section("2.2"))
  .slice(1)
  .map(([input, terms, split]) => ({ input: ticks(input)[0], terms: ticks(terms), split: split === "—" ? null : ticks(split) }));
const limit = (name, i = 0) => {
  const v = LIMITS.get(name);
  assert.ok(v?.length, `설계 2.3에 '${name}'이 없다`);
  return Number(v[i]);
};

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
    return { ok: false, code: err.code, message: err.message };
  }
}
/** search_public 이름 붙인 인자로 부르기 */
function search(query, args = {}) {
  const names = Object.keys(args);
  const sql = `select * from public.search_public(p_query => $1${names.map((n, i) => `, ${n} => $${i + 2}`).join("")})`;
  return attempt(sql, [query, ...names.map((n) => args[n])]);
}
let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
/** 공개 용어 한 줄 (3단계 — 숨긴 용어는 검색 0, w2d-glossary 시험) */
async function glossary(input) {
  const cols = { visible: true, ...input };
  const keys = Object.keys(cols);
  const sql = `insert into public.glossary_terms (term, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) returning id`;
  return (await client.query(sql, [uniq("zzgold"), ...keys.map((k) => cols[k])])).rows[0].id;
}
async function functionSource() {
  const { rows } = await client.query("select pg_get_functiondef('public.search_public(text, text[], text, text, text, date, date, integer, integer, integer)'::regprocedure) as def");
  return rows[0].def;
}
const constArray = (src, name) => {
  const m = src.match(new RegExp(`${name} constant text\\[\\] := array\\[([^\\]]+)\\]`));
  assert.ok(m, `함수 몸에 ${name}이 없다`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
const constInt = (src, name) => {
  const m = src.match(new RegExp(`${name} constant integer := (\\d+)`));
  assert.ok(m, `함수 몸에 ${name}이 없다`);
  return Number(m[1]);
};

test("설계 문서 2장의 표를 모두 읽었다", () => {
  assert.deepEqual(VALUES.get("search.kind"), ["region", "situation", "tracker", "glossary", "category", "article", "person"]);
  assert.equal(VALUES.get("search.content_type").length, 5);
  assert.ok(!VALUES.get("search.content_type").includes("digest"), "금주 핫뉴스는 기사 유형 거르개에 없다");
  assert.deepEqual(VALUES.get("search.person_roles"), ["reporter", "editor", "writer", "reviewer"]);
  assert.equal(VALUES.get("search.tab").length, 7, "SRCH-02 탭 7개 (전체·기사·트래커·지역·행사·용어·전문가)");
  assert.ok(GOLDEN.length >= 15, "정규화 견본이 15줄 이상");
  for (const name of ["query_chars", "max_terms", "page_size", "max_offset", "max_per_kind", "synonym_limits", "alias_limits"]) assert.ok(LIMITS.has(name), name);
});

test("2.1 결과 종류 — 함수 몸의 목록·차례가 표와 같고, 표의 종류는 받고 표 밖 종류(뒤 작업의 event 포함)는 22023", () =>
  tx(async () => {
    const src = await functionSource();
    assert.deepEqual(constArray(src, "c_kinds"), VALUES.get("search.kind"));
    for (const k of VALUES.get("search.kind")) {
      const r = await search("시험", { p_kinds: [k] });
      assert.ok(r.ok, `${k}: ${r.message}`);
    }
    for (const bad of [["event"], ["ARTICLE"], [""], []]) {
      const r = await search("시험", { p_kinds: bad });
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "22023", r.message);
    }
  }));

test("2.1 기사 유형 — 함수 몸의 목록이 표와 같고, digest·목록 밖 값은 22023", () =>
  tx(async () => {
    const src = await functionSource();
    assert.deepEqual(constArray(src, "c_content_types"), VALUES.get("search.content_type"));
    for (const t of VALUES.get("search.content_type")) assert.ok((await search("시험", { p_content_type: t })).ok, t);
    for (const bad of ["digest", "news", "REPORTED_NEWS"]) {
      const r = await search("시험", { p_content_type: bad });
      assert.equal(r.code, "22023", `${bad}: ${r.message}`);
    }
  }));

test("2.1 인물 역할 — 함수 몸이 표의 역할로 거른다", async () => {
  const src = await functionSource();
  const m = src.match(/p\.roles && array\[([^\]]+)\]/);
  assert.ok(m, "인물 역할 거르개가 없다");
  assert.deepEqual([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]), VALUES.get("search.person_roles"));
});

for (const g of GOLDEN) {
  test(`2.2 정규화 견본 '${g.input}' → ${g.terms.length ? g.terms.join("·") : "(없음)"}${g.split ? ` / 0건이면 ${g.split.join("·")}` : ""}`, () =>
    tx(async () => {
      if (g.terms.length === 0) {
        await glossary({ definition: "취득세 재건축" });
        const r = await search(g.input);
        assert.ok(r.ok, r.message);
        assert.deepEqual(r.rows, [], "남는 글자가 없으면 결과 0");
        return;
      }
      // 찾는 낱말이 모두 든 글 → 붙인 낱말 그대로 찾는다
      const hit = await glossary({ definition: g.terms.join(" ") });
      const r = await search(g.input, { p_kinds: ["glossary"] });
      assert.ok(r.ok, r.message);
      assert.ok(r.rows.some((x) => x.ref === String(hit)), "찾는 낱말이 든 용어가 결과에 있다");
      for (const row of r.rows) assert.deepEqual(row.query_terms, g.terms);
      if (!g.split) return;
      // 붙인 낱말이 없고 띄어 쓴 낱말만 칸을 나눠 든 글 → 다시 찾는다
      await client.query("delete from public.glossary_terms where id = $1", [hit]);
      const splitOnly = await glossary({ related: g.split });
      const again = await search(g.input, { p_kinds: ["glossary"] });
      assert.ok(again.ok, again.message);
      assert.deepEqual(again.rows.map((x) => x.ref), [String(splitOnly)]);
      assert.deepEqual(again.rows[0].query_terms, g.split);
    }));
}

test("2.3 한도 — 함수 상수·기본값이 표와 같다", async () => {
  const src = await functionSource();
  assert.equal(constInt(src, "c_query_chars"), limit("query_chars"));
  assert.equal(constInt(src, "c_max_terms"), limit("max_terms"));
  assert.equal(constInt(src, "c_max_limit"), limit("page_size", 1));
  assert.equal(constInt(src, "c_max_offset"), limit("max_offset"));
  assert.equal(constInt(src, "c_max_per_kind"), limit("max_per_kind"));
  assert.match(src, new RegExp(`p_limit integer DEFAULT ${limit("page_size", 0)}\\b`));
});

test("2.3 검색어 — 앞 100글자까지만 읽는다 (100번째 글자는 들어가고 101번째는 빠진다)", () =>
  tx(async () => {
    const n = limit("query_chars");
    await glossary({ definition: `${"a".repeat(n)}b` });
    const exact = await search(`${"a".repeat(n - 1)}b`);
    assert.deepEqual(exact.rows[0]?.query_terms, [`${"a".repeat(n - 1)}b`]);
    const over = await search(`${"a".repeat(n)}b`);
    assert.deepEqual(over.rows[0]?.query_terms, ["a".repeat(n)]);
  }));

test("2.3 쪽·건너뛰기·종류별 묶음 — 경계 값은 받고 한 칸 밖은 22023, 기본 한 쪽은 20개", () =>
  tx(async () => {
    const size = limit("page_size", 0);
    const max = limit("page_size", 1);
    for (let i = 0; i < size + 5; i++) await glossary({ definition: "경계시험낱말" });
    const def = await search("경계시험낱말");
    assert.equal(def.rows.length, size);
    assert.equal(Number(def.rows[0].total_count), size + 5);
    for (const [args, ok] of [
      [{ p_limit: max }, true],
      [{ p_limit: max + 1 }, false],
      [{ p_limit: 0 }, false],
      [{ p_limit: null }, false],
      [{ p_offset: limit("max_offset") }, true],
      [{ p_offset: limit("max_offset") + 1 }, false],
      [{ p_offset: -1 }, false],
      [{ p_per_kind: limit("max_per_kind") }, true],
      [{ p_per_kind: limit("max_per_kind") + 1 }, false],
      [{ p_per_kind: 0 }, false],
    ]) {
      const r = await search("경계시험낱말", args);
      assert.equal(r.ok, ok, `${JSON.stringify(args)}: ${r.message ?? ""}`);
      if (!ok) assert.equal(r.code, "22023", r.message);
    }
  }));

test("2.3 동의어 사전 한도 — 낱말 50자·동의어 10개·동의어 50자까지, 한 칸 넘으면 check 위반", () =>
  tx(async () => {
    const [termMax, countMax, synMax] = LIMITS.get("synonym_limits").map(Number);
    const put = (term, synonyms) =>
      attempt("insert into public.search_synonyms (term, synonyms, updated_by) values ($1, $2, 'user:시험')", [term, synonyms]);
    const many = (n) => Array.from({ length: n }, (_, i) => `동의어${i}`);
    assert.ok((await put("가".repeat(termMax), ["나"])).ok);
    assert.equal((await put("다".repeat(termMax + 1), ["나"])).code, "23514");
    assert.ok((await put("라마", many(countMax))).ok);
    assert.equal((await put("바사", many(countMax + 1))).code, "23514");
    assert.ok((await put("아자", ["차".repeat(synMax)])).ok);
    assert.equal((await put("카타", ["파".repeat(synMax + 1)])).code, "23514");
  }));

test("2.3 상황 검색 별칭 한도 — 20개·50자까지, 넘거나 빈 별칭은 check 위반", () =>
  tx(async () => {
    const [countMax, charMax] = LIMITS.get("alias_limits").map(Number);
    const put = (aliases) =>
      attempt("insert into public.situations (slug, section, title, pictogram, aliases) values ($1, 'tax', '별칭 시험', 'car-sold', $2)", [uniq("s"), aliases]);
    const many = (n) => Array.from({ length: n }, (_, i) => `별칭${i}`);
    assert.ok((await put(many(countMax))).ok);
    assert.equal((await put(many(countMax + 1))).code, "23514");
    assert.ok((await put(["가".repeat(charMax)])).ok);
    assert.equal((await put(["가".repeat(charMax + 1)])).code, "23514");
    assert.equal((await put(["  "])).code, "23514");
  }));
