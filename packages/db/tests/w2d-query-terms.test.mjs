// W2-d 4단계 — 검색어 집계 query_terms (docs/dev/W2-d_설계.md 2.7 · 2.8 · 8.3, PRD-01A SRCH-03 · OPT-04 · 6.1)
//  · 칸 = 설계 2.7 query_terms.columns(PRD-01A 6.1 그대로, 차례까지) — 원문·방문자·IP·User-Agent·회원 모양 칸 0
//  · 출처 값 목록 = 설계 2.7 (제약의 값 집합까지) — 목록 밖 값 거부
//  · DB가 막는다(심층 방어): 2.8 견본의 '검색어' 원문 가운데 가림이 필요한 것은 그대로 넣으면 check 위반, '가린 값'은 들어간다.
//    9자리 숫자 줄 거부 · 8자리(날짜) 받음 · 이메일 모양 거부 · 전각 숫자도 같은 모양 · 정규형은 남기는 글자 낱말 1~8개만
//  · 더하기 함수 — 같은 (정규형, 출처, 기간)은 한 행으로 횟수를 합친다 · 처음·마지막 시각은 넓힌다 · 가린 값은 첫 값 · 기간·출처가 다르면 다른 행
//  · 보고 함수 — 기간 안 날 행 합계 · 최소 횟수 아래는 rows에서 빼고 수만 · 차례 · 기간 양 끝 포함 · 다른 출처 0 · 틀린 인자 22023
//  · 보존 기한 정리 함수 — 기준 날 앞 행만 · 한 번에 p_limit건
//  · RLS: anon·authenticated 읽기·쓰기 0, 함수 실행 0 · service_role 전권 · 설정 씨앗 = 설계 2.7(공개 설정 키 아님)
// 모든 시험은 트랜잭션 안에서 하고 되돌린다 (남는 행 0). 로컬 DB에서만 돈다.
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

/** 2.7 — 이름(첫 낱말) → 값 배열 */
const VALUES = new Map(rowsOf(section("2.7")).slice(1).map(([name, cell]) => [name.split(/\s/)[0], ticks(cell)]));
const value = (name) => {
  const v = VALUES.get(name);
  assert.ok(v?.length, `설계 2.7에 '${name}'이 없다`);
  return v;
};
const COLUMNS = value("query_terms.columns");
const SOURCES = value("query_terms.source");
const LABELS = value("query_terms.mask_labels");
const DIGIT_RUN = Number(value("query_terms.digit_run")[0]);
const TERM_CHARS = Number(value("query_terms.term_chars")[0]);
/** 2.7 설정 씨앗 블록 */
const SEED = JSON.parse(section("2.7").match(/^#### `query_terms`\s*\n+```json\n([\s\S]*?)\n```/m)[1]);
/** 2.8 — [{ input, masked, normalized }] — normalized null이면 저장 0 */
const GOLDEN = rowsOf(section("2.8"))
  .slice(1)
  .map(([input, masked, normalized]) => ({ input: ticks(input)[0], masked: ticks(masked)[0], normalized: normalized === "—" ? null : ticks(normalized)[0] }));

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

const AT = "2026-10-19T03:00:00Z";
const insert = (row = {}) =>
  attempt(
    `insert into public.query_terms (source, term_masked, normalized, period, count, first_seen, last_seen)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [row.source ?? "site_search", row.masked ?? "취득세", row.normalized ?? "취득세", row.period ?? "2026-10-19", row.count ?? 1, row.first ?? AT, row.last ?? row.first ?? AT],
  );
const add = (source, masked, normalized, period, at, count = 1, role = null) =>
  attempt("select public.query_terms_add($1, $2, $3, $4, $5, $6) n", [source, masked, normalized, period, at, count], role);
const report = (args, role = null) =>
  attempt("select public.query_terms_report($1, $2, $3, $4, $5) r", [args.source ?? "site_search", args.from, args.to, args.min ?? 1, args.limit ?? 100], role);

test("칸 — 설계 2.7 query_terms.columns(PRD-01A 6.1) 그대로·차례까지, 원문·개인 식별 모양 칸 0", async () => {
  assert.deepEqual(COLUMNS, ["id", "source", "term_masked", "normalized", "period", "count", "cluster_id", "first_seen", "last_seen"], "설계 표가 PRD-01A 6.1 칸과 같다");
  const { rows } = await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'query_terms' order by ordinal_position");
  const cols = rows.map((r) => r.column_name);
  assert.deepEqual(cols, COLUMNS);
  const forbidden = /(^|_)(raw|query|q|text|ip|ua|user_agent|agent|visitor|session|user|member|email|phone|referrer|url)(_|$)/;
  assert.deepEqual(cols.filter((c) => forbidden.test(c)), []);
  const unique = await client.query(
    "select pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = 'public.query_terms'::regclass and c.contype = 'u'",
  );
  assert.deepEqual(unique.rows.map((r) => r.d), ["UNIQUE (normalized, source, period)"], "PRD-01A 6.1 '(normalized, source, period) unique'");
});

test("출처 — 설계 2.7 값은 모두 들어가고, 목록 밖(없는 값·대문자·빈 글자)은 check 위반, 제약의 값 집합 = 표", async () => {
  await tx(async () => {
    for (const s of SOURCES) assert.equal((await insert({ source: s })).ok, true, s);
    for (const bad of ["site", "SITE_SEARCH", "", "chat"]) assert.equal((await insert({ source: bad, normalized: `x${bad.length}` })).code, "23514", bad);
  });
  const { rows } = await client.query(
    "select pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = 'public.query_terms'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%source%'",
  );
  assert.equal(rows.length, 1);
  assert.deepEqual([...rows[0].d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort(), [...SOURCES].sort());
});

test("DB가 막는다 — 2.8 견본의 '가린 값'·'정규형'은 들어가고, 가림이 필요한 원문을 그대로 넣으면 check 위반 (전각 숫자 포함)", async () => {
  assert.ok(GOLDEN.length >= 20, "견본 표를 읽었다");
  const labelled = GOLDEN.filter((g) => LABELS.some((l) => g.masked.includes(l)));
  const plain = GOLDEN.filter((g) => !LABELS.some((l) => g.masked.includes(l)));
  assert.ok(labelled.length >= 10 && plain.length >= 5);
  await tx(async () => {
    for (const [i, g] of GOLDEN.entries()) {
      const normalized = g.normalized ?? `견본${i}`;
      const ok = await insert({ masked: g.masked, normalized, period: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` });
      assert.equal(ok.ok, true, `가린 값 '${g.masked}' / '${normalized}': ${ok.message}`);
    }
    for (const [i, g] of labelled.entries()) {
      const raw = g.input.trim().replace(/\s+/g, " ");
      const r = await insert({ masked: raw, normalized: `원문${i}` });
      assert.equal(r.code, "23514", `가림이 필요한 원문 '${g.input}'을 그대로 넣으면 거부`);
      assert.match(r.message, /query_terms_no_(digit_run|email)/, `개인정보 모양 제약이 막는다: ${r.message}`);
    }
    for (const [i, g] of plain.entries()) {
      const r = await insert({ masked: g.masked, normalized: `닮은꼴${i}`, period: "2026-02-01" });
      assert.equal(r.ok, true, `닮은꼴 '${g.masked}'은 그대로 들어간다: ${r.message}`);
    }
  });
});

test(`숫자 줄 경계 — ${DIGIT_RUN - 1}자리는 받고 ${DIGIT_RUN}자리는 거부(띄어쓰기·하이픈·점·괄호가 끼어도 한 줄), 글자가 끼면 따로`, async () => {
  await tx(async () => {
    const accept = ["12345678", "1234-5678", "2026.10.19 개편", "(02)123-456", "제111조 제2항 제3호 12345", "1세대 1주택 2주택 3주택 4주택 5주택 6주택 7주택 8주택 9주택"];
    const reject = ["123456789", "1234-56789", "02 123 4567", "(02)123-4567", "1234 5678 9", "+82 10 1234 5678", "０１０１２３４５６７８"];
    for (const [i, s] of accept.entries()) assert.equal((await insert({ masked: s, normalized: `받음${i}` })).ok, true, s);
    for (const [i, s] of reject.entries()) assert.equal((await insert({ masked: s, normalized: `거부${i}` })).code, "23514", s);
    // 정규형도 같은 검사 — 낱말 사이 띄어쓰기로 이어진 9자리
    assert.equal((await insert({ masked: "번호", normalized: "010 1234 5678" })).code, "23514");
    assert.equal((await insert({ masked: "날짜", normalized: "2026 10 19 개편안" })).ok, true);
  });
});

test("이메일 모양 — '@' 앞뒤에 글자가 붙으면 거부(띄어쓰기·전각 ＠ 포함), '@' 앞이 비면(별칭 표기) 받음", async () => {
  await tx(async () => {
    for (const [i, s] of ["a@b", "hong.gil@example.com", "hong @ example.com", "tax_help+1@mail.co.kr", "홍길동@회사.한국", "hong＠example.com"].entries()) {
      assert.equal((await insert({ masked: s, normalized: `메일${i}` })).code, "23514", s);
    }
    for (const [i, s] of ["@지방세 질문", "[이메일] 재산세", "100%@"].entries()) assert.equal((await insert({ masked: s, normalized: `별칭${i}` })).ok, true, s);
  });
});

test(`정규형·가린 값 모양 — 정규형은 남기는 글자 낱말 1~8개를 띄어쓰기 하나로, 가린 값은 앞뒤 공백 없이 1~${TERM_CHARS}자`, async () => {
  await tx(async () => {
    const goodNorm = ["취득세", "취득세 감면", "pf 대출", "1 2 3 4 5 6 7 8", "ᄀ ㄱ 一"];
    const badNorm = ["", "취득세  감면", " 취득세", "취득세 ", "PF", "취득세!", "a b c d e f g h i", "[전화번호]"];
    for (const [i, n] of goodNorm.entries()) assert.equal((await insert({ normalized: n, period: `2026-03-${String(i + 1).padStart(2, "0")}` })).ok, true, n);
    for (const n of badNorm) assert.equal((await insert({ normalized: n })).code, "23514", JSON.stringify(n));
    assert.equal((await insert({ masked: "가".repeat(TERM_CHARS), normalized: "가백" })).ok, true, `${TERM_CHARS}자`);
    for (const m of ["가".repeat(TERM_CHARS + 1), "", " 취득세", "취득세 "]) assert.equal((await insert({ masked: m, normalized: "모양" })).code, "23514", JSON.stringify(m));
    assert.equal((await insert({ count: 0, normalized: "영" })).code, "23514", "횟수 0");
    assert.equal((await insert({ first: "2026-10-19T05:00:00Z", last: "2026-10-19T04:59:59Z", normalized: "거꾸로" })).code, "23514", "처음 > 마지막");
  });
});

test("더하기 — 같은 (정규형·출처·기간)은 한 행으로 합친다, 처음·마지막 시각은 넓히고 가린 값은 첫 값, 기간·출처가 다르면 다른 행", async () => {
  await tx(async () => {
    assert.equal((await add("site_search", "취득세 감면", "취득세 감면", "2026-10-19", "2026-10-19T01:00:00Z")).rows[0].n, 1);
    assert.equal((await add("site_search", "취득 세 감면", "취득세 감면", "2026-10-19", "2026-10-19T00:30:00Z")).rows[0].n, 2, "앞선 시각이 와도 합친다");
    assert.equal((await add("site_search", "취득세감면!", "취득세 감면", "2026-10-19", "2026-10-19T09:00:00Z", 3)).rows[0].n, 5, "횟수 3 더하기");
    await add("site_search", "취득세 감면", "취득세 감면", "2026-10-20", "2026-10-19T15:00:00Z");
    await add("search_console", "취득세 감면", "취득세 감면", "2026-10-19", "2026-10-19T02:00:00Z", 40);
    const { rows } = await client.query(
      "select source, term_masked, period::text p, count, first_seen, last_seen from public.query_terms where normalized = '취득세 감면' order by source, period",
    );
    assert.deepEqual(
      rows.map((r) => [r.source, r.term_masked, r.p, r.count, r.first_seen.toISOString(), r.last_seen.toISOString()]),
      [
        ["search_console", "취득세 감면", "2026-10-19", 40, "2026-10-19T02:00:00.000Z", "2026-10-19T02:00:00.000Z"],
        ["site_search", "취득세 감면", "2026-10-19", 5, "2026-10-19T00:30:00.000Z", "2026-10-19T09:00:00.000Z"],
        ["site_search", "취득세 감면", "2026-10-20", 1, "2026-10-19T15:00:00.000Z", "2026-10-19T15:00:00.000Z"],
      ],
    );
    for (const [args, why] of [
      [["site_search", "x", "x", "2026-10-19", AT, 0], "횟수 0"],
      [["site_search", "x", "x", "2026-10-19", AT, -1], "횟수 음수"],
      [["site_search", "x", "x", null, AT, 1], "기간 없음"],
      [["site_search", "x", "x", "2026-10-19", null, 1], "시각 없음"],
    ]) assert.equal((await add(...args)).code, "22023", why);
    assert.equal((await add("site_search", "010-1234-5678", "전화", "2026-10-19", AT)).code, "23514", "가리지 않은 값은 더하기 함수로도 거부");
    assert.equal((await add("chat", "x", "x", "2026-10-19", AT)).code, "23514", "출처 목록 밖");
  });
});

test("보고 — 기간 안 날 행 합계·찾은 날 수, 최소 횟수 아래는 rows에서 빼고 수만, 많이 찾은 차례, 기간 양 끝 포함, 다른 출처 0, 틀린 인자 22023", async () => {
  await tx(async () => {
    await client.query("delete from public.query_terms");
    const seed = [
      ["site_search", "재산세 분납", "재산세 분납", "2026-10-01", "2026-10-01T01:00:00Z", 1],
      ["site_search", "재산세분납", "재산세 분납", "2026-10-02", "2026-10-02T01:00:00Z", 4],
      ["site_search", "재산세 분납", "재산세 분납", "2026-10-03", "2026-10-03T01:00:00Z", 2],
      ["site_search", "취득세 [전화번호]", "취득세", "2026-10-02", "2026-10-02T03:00:00Z", 3],
      ["site_search", "홍길동 세무사", "홍길동 세무사", "2026-10-02", "2026-10-02T05:00:00Z", 1],
      ["site_search", "밖", "밖", "2026-09-30", "2026-09-30T05:00:00Z", 50],
      ["site_search", "밖", "밖", "2026-10-04", "2026-10-04T05:00:00Z", 50],
      ["search_console", "재산세 분납", "재산세 분납", "2026-10-02", "2026-10-02T01:00:00Z", 900],
    ];
    for (const s of seed) assert.equal((await add(...s)).ok, true);
    const r = (await report({ from: "2026-10-01", to: "2026-10-03", min: 2 })).rows[0].r;
    assert.deepEqual([r.terms, r.shown, r.searches], [3, 2, 11], "기간 안 정규형 3(재산세 분납·취득세·홍길동 세무사) · 2회 이상 2 · 합계 7+3+1");
    assert.deepEqual(
      r.rows.map((x) => [x.normalized, x.term_masked, x.count, x.days]),
      [
        ["재산세 분납", "재산세분납", 7, 3],
        ["취득세", "취득세 [전화번호]", 3, 1],
      ],
      "가린 값 = 가장 많이 찾은 날 행의 값 · 1회 '홍길동 세무사'는 rows 0",
    );
    assert.equal(new Date(r.rows[0].first_seen).toISOString(), "2026-10-01T01:00:00.000Z");
    assert.equal(new Date(r.rows[0].last_seen).toISOString(), "2026-10-03T01:00:00.000Z");
    const all = (await report({ from: "2026-09-30", to: "2026-10-04", min: 1, limit: 2 })).rows[0].r;
    assert.deepEqual([all.terms, all.shown, all.rows.map((x) => x.normalized)], [4, 4, ["밖", "재산세 분납"]], "양 끝 날 포함 · 앞 2개");
    const one = (await report({ from: "2026-10-02", to: "2026-10-02", min: 1 })).rows[0].r;
    assert.deepEqual(one.rows.map((x) => [x.normalized, x.count]), [["재산세 분납", 4], ["취득세", 3], ["홍길동 세무사", 1]]);
    const console_ = (await report({ source: "search_console", from: "2026-10-01", to: "2026-10-31" })).rows[0].r;
    assert.deepEqual([console_.terms, console_.searches], [1, 900], "출처마다 따로");
    const empty = (await report({ from: "2025-01-01", to: "2025-01-31" })).rows[0].r;
    assert.deepEqual(empty, { terms: 0, shown: 0, searches: 0, rows: [] });
    for (const [args, why] of [
      [{ from: "2026-10-03", to: "2026-10-01" }, "기간 거꾸로"],
      [{ from: null, to: "2026-10-01" }, "시작 없음"],
      [{ from: "2026-10-01", to: "2026-10-03", min: 0 }, "최소 0"],
      [{ from: "2026-10-01", to: "2026-10-03", limit: 0 }, "보일 건수 0"],
      [{ from: "2026-10-01", to: "2026-10-03", limit: 501 }, "보일 건수 501"],
      [{ source: "chat", from: "2026-10-01", to: "2026-10-03" }, "출처 목록 밖"],
    ]) assert.equal((await report(args)).code, "22023", why);
  });
});

test("보존 기한 정리 — 기준 날 앞의 날 행만, 한 번에 p_limit건, 기준 날 행은 남는다", async () => {
  await tx(async () => {
    await client.query("delete from public.query_terms");
    for (const [p, n] of [["2025-09-18", "가"], ["2025-09-19", "나"], ["2025-09-20", "다"], ["2025-09-21", "라"]]) await add("site_search", n, n, p, `${p}T00:00:00Z`);
    assert.equal((await attempt("select public.query_terms_purge('2025-09-21', 2) n")).rows[0].n, 2, "앞선 날부터 2건");
    assert.equal((await attempt("select public.query_terms_purge('2025-09-21', 10) n")).rows[0].n, 1);
    assert.deepEqual((await client.query("select period::text p from public.query_terms order by period")).rows.map((r) => r.p), ["2025-09-21"], "기준 날은 남는다");
    for (const args of [[null, 10], ["2025-09-21", 0]]) assert.equal((await attempt("select public.query_terms_purge($1, $2) n", args)).code, "22023");
  });
});

test("RLS·권한 — anon·authenticated는 표 읽기·쓰기·함수 실행 0, service_role 전권", async () => {
  const rls = await client.query("select relrowsecurity r from pg_class where oid = 'public.query_terms'::regclass");
  assert.equal(rls.rows[0].r, true);
  await tx(async () => {
    assert.equal((await add("site_search", "보임", "보임", "2026-10-19", AT)).ok, true);
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await attempt("select count(*) from public.query_terms", [], role)).code, "42501", `${role} 읽기`);
      assert.equal((await attempt("insert into public.query_terms (source, term_masked, normalized, period, count, first_seen, last_seen) values ('site_search','x','x','2026-10-19',1,now(),now())", [], role)).code, "42501", `${role} 쓰기`);
      assert.equal((await add("site_search", "y", "y", "2026-10-19", AT, 1, role)).code, "42501", `${role} 더하기 함수`);
      assert.equal((await report({ from: "2026-10-01", to: "2026-10-31" }, role)).code, "42501", `${role} 보고 함수`);
      assert.equal((await attempt("select public.query_terms_purge('2026-01-01', 1)", [], role)).code, "42501", `${role} 정리 함수`);
    }
    const sr = await attempt("select count(*)::int n from public.query_terms where normalized = '보임'", [], "service_role");
    assert.deepEqual([sr.ok, sr.rows?.[0].n], [true, 1]);
    assert.equal((await add("site_search", "보임", "보임", "2026-10-19", AT, 1, "service_role")).rows[0].n, 2);
    assert.equal((await report({ from: "2026-10-19", to: "2026-10-19" }, "service_role")).ok, true);
    assert.equal((await attempt("delete from public.query_terms where normalized = '보임'", [], "service_role")).ok, true);
  });
});

test("설정 씨앗 query_terms = 설계 2.7 블록, 공개 설정 키가 아니다(anon 0)", async () => {
  const { rows } = await client.query("select value from public.settings where key = 'query_terms'");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].value, SEED);
  assert.ok(Number.isInteger(SEED.retention_days) && SEED.retention_days > 0 && Number.isInteger(SEED.display_min_count) && SEED.display_min_count >= 1);
  await tx(async () => {
    const r = await attempt("select key from public.settings where key = 'query_terms'", [], "anon");
    assert.deepEqual([r.ok, r.rows?.length], [true, 0]);
  });
});
