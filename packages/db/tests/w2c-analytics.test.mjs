// W2-c 1단계 측정 기반 — docs/dev/W2-c_설계.md 2·3장과 DB가 같다 (FND-06 · GROW-01 · ART-11 · HOME-05)
//  · 2.1 값 목록: 표의 값은 모두 저장되고, 목록 밖 값(없는 값·대문자·빈 글자)은 check 제약 위반, 제약의 값 집합 = 표
//  · 칸 검사 (FND-06 스키마 검사): analytics_events 칸 = PRD-01A 6.1 14칸 그대로, 개인정보·원문 모양 이름 0,
//    방문자 ID 칸이 있는 표는 이 표 하나이고 그 표에 회원 ID·IP·User-Agent 칸 0, `events` 이름 관계 0
//  · props 제약(객체·평평함·크기·금지 이름), article_stats 제약(UTC 정시·사람 ≤ 전체·0 이상·기사와 함께 지워짐)
//  · RLS: anon·authenticated 읽기·쓰기 0, service_role 전권 · 설정 씨앗 = 설계 2.5 (코드 상수 0 — HOT 가중치 조회 1·공유 5·30초 열람 2)
// 모든 시험은 트랜잭션 안에서 하고 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-c_설계.md");

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

const MD = fs.readFileSync(DESIGN, "utf8");

/** 설계 문서 2장의 소절(### 2.n) → Map(이름 첫 낱말 → 값 배열) — 칸 2개짜리 표만 읽는다 */
function valueTables() {
  const sec = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  assert.ok(sec, "설계 문서 2장을 찾지 못했다");
  const out = new Map();
  for (const sub of sec.split(/^### /m).slice(1)) {
    const key = sub.match(/^(2\.\d)/)?.[1];
    const lists = new Map();
    for (const line of sub.split("\n")) {
      const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
      if (!m || m[1] === "이름" || /^-+$/.test(m[1])) continue;
      lists.set(m[1].split(/\s/)[0], [...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1]));
    }
    if (key) out.set(key, lists);
  }
  return out;
}

/** 설계 2.5 — `#### \`키\`` 다음 json 블록 → Map(키 → 값) */
function seedBlocks() {
  const sec = MD.split(/^### /m).find((s) => s.startsWith("2.5"));
  assert.ok(sec, "설계 문서 2.5를 찾지 못했다");
  const out = new Map();
  for (const m of sec.matchAll(/^#### `([a-z_]+)`\s*\n+```json\n([\s\S]*?)\n```/gm)) out.set(m[1], JSON.parse(m[2]));
  return out;
}

const TABLES = valueTables();
const VALUES = TABLES.get("2.1");
const PROPS_VALUES = TABLES.get("2.3");
const SEEDS = seedBlocks();

/** PRD-01A 6.1 analytics_events 칸 — 순서까지 그대로 */
const PRD_COLUMNS = ["id", "name", "occurred_at", "session_id", "visitor_id", "first_visit", "stage", "mode", "tier", "entry", "section", "props", "is_bot", "is_staff"];
/** 개인정보·원문을 담을 수 있는 칸 이름 모양 (FND-06 · GROW-01 · PRD-01A 8.2 개인정보) */
const FORBIDDEN_COLUMN = /(^|_)(ip|ips|ip_addr|ipaddr|ua|user_agent|useragent|agent|email|mail|phone|tel|mobile|address|addr|lat|lng|lon|latitude|longitude|coord|coords|coordinates|geo|location|query|keyword|search_term|term_raw|question|answer|prompt|message|input|inputs|amount|price|user|user_id|member|member_id|profile|profile_id|account|rrn|ssn|birth|referrer|referer|url)(_|$)/;

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
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}

const uuid = () => crypto.randomUUID();
const BASE_EVENT = () => ({
  name: "article_viewed",
  session_id: uuid(),
  visitor_id: uuid(),
  first_visit: true,
  stage: 1,
  entry: "direct",
  section: "tax",
  props: JSON.stringify({ article_id: 1, format: "general", content_type: "explainer" }),
  is_bot: false,
  is_staff: false,
});

function insertSql(table, cols) {
  const keys = Object.keys(cols);
  return {
    sql: `insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    params: keys.map((k) => cols[k]),
  };
}
function tryInsert(table, cols, role = null) {
  const { sql, params } = insertSql(table, cols);
  return attempt(sql, params, role);
}
const tryEvent = (over = {}, role = null) => tryInsert("analytics_events", { ...BASE_EVENT(), ...over }, role);

let seq = 0;
async function article() {
  const { rows } = await client.query("insert into public.articles (slug, title, section, content_type) values ($1, '측정 시험 기사', 'tax', 'explainer') returning id", [
    `w2c-${process.pid}-${++seq}`,
  ]);
  return Number(rows[0].id);
}

async function checkValues(table, column) {
  const { rows } = await client.query(
    `select pg_get_constraintdef(c.oid) as def
     from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.conrelid = $1::regclass and c.contype = 'c' and cardinality(c.conkey) = 1 and a.attname = $2`,
    [`public.${table}`, column],
  );
  const withList = rows.filter((r) => /ARRAY\[/.test(r.def));
  assert.equal(withList.length, 1, `${table}.${column}의 값 목록 제약이 1개가 아니다: ${JSON.stringify(rows)}`);
  return [...withList[0].def.matchAll(/'((?:[^']|'')*)'::text/g)].map((m) => m[1]).sort();
}

// ── 설계 문서 ─────────────────────────────────────────────

test("설계 문서 2장의 표·씨앗 블록을 모두 읽었다 — 이벤트 78종(PRD-01A 19종 + W3 10단계 3종 + W4 24단계 7종 + W8 2종 + W10 0차 34종 + W11 0차 13종), 설정 키 5개", () => {
  assert.ok(VALUES && PROPS_VALUES, "2.1·2.3 소절이 있어야 한다");
  for (const name of VALUES.keys()) assert.match(name, /^analytics_events\./, `2.1 '${name}'은 analytics_events 칸이어야 한다`);
  assert.equal(VALUES.get("analytics_events.name").length, 78, "PRD-01A 12장 이벤트 19종 + W3 10단계 3종 + W4 24단계 7종 + W8 2종 + W10 0차 34종 + W11 0차 13종");
  assert.deepEqual(VALUES.get("analytics_events.section"), ["tax", "realestate", "finance", "local"]);
  assert.deepEqual([...SEEDS.keys()].sort(), [...PROPS_VALUES.get("settings.analytics_keys")].sort(), "2.3 설정 키 = 2.5 씨앗 블록");
});

// ── 값 목록 ───────────────────────────────────────────────

for (const column of ["name", "mode", "tier", "entry", "section"]) {
  test(`analytics_events.${column} — 2.1 값은 모두 저장되고 목록 밖 값은 거부, 제약 값 집합 = 표`, () =>
    tx(async () => {
      const values = VALUES.get(`analytics_events.${column}`);
      assert.ok(values?.length, `설계 문서에 analytics_events.${column} 목록이 없다`);
      for (const v of values) {
        const r = await tryEvent({ [column]: v });
        assert.ok(r.ok, `${v}: ${r.message}`);
      }
      for (const bad of ["__not_in_list__", values[0].toUpperCase(), ""]) {
        const r = await tryEvent({ [column]: bad });
        assert.equal(r.ok, false, `목록 밖 값 '${bad}'가 저장됐다`);
        assert.equal(r.code, "23514", `'${bad}': check 제약 위반이어야 한다 (${r.message})`);
      }
      assert.deepEqual(await checkValues("analytics_events", column), [...values].sort());
    }));
}

test("analytics_events.section은 비울 수 있다 (분야 없는 이벤트 — 가입·문의·정책 페이지), 그 밖의 분류 칸은 필수", () =>
  tx(async () => {
    assert.ok((await tryEvent({ section: null, name: "signup_completed", props: JSON.stringify({ interest_count: 2, region_count: 1 }) })).ok);
    for (const column of ["name", "session_id", "first_visit", "stage", "entry", "is_bot", "is_staff"]) {
      const r = await tryEvent({ [column]: null });
      assert.equal(r.ok, false, `${column} 없이 저장됐다`);
      assert.equal(r.code, "23502", `${column}: not null 위반 (${r.message})`);
    }
  }));

test("analytics_events.stage — 1~5만 (0·6 거부, 1·5 저장)", () =>
  tx(async () => {
    for (const ok of [1, 5]) assert.ok((await tryEvent({ stage: ok })).ok, `단계 ${ok}`);
    for (const bad of [0, 6, -1]) {
      const r = await tryEvent({ stage: bad });
      assert.equal(r.code, "23514", `단계 ${bad}: ${r.message}`);
    }
  }));

test("analytics_events — 모드·회원 등급 기본값은 일반·비회원, 시각은 DB 시각(now) 기본값", () =>
  tx(async () => {
    const e = BASE_EVENT();
    const r = await tryInsert("analytics_events", e);
    assert.ok(r.ok, r.message);
    const row = r.rows[0];
    assert.equal(row.mode, "general");
    assert.equal(row.tier, "guest");
    const { rows } = await client.query("select now() as now");
    assert.equal(row.occurred_at.getTime(), rows[0].now.getTime(), "같은 트랜잭션의 now()");
  }));

// ── 칸 검사 (FND-06 · GROW-01 스키마 검사) ───────────────

test("analytics_events 칸 = PRD-01A 6.1 그대로 14칸 (순서 포함), 방문자·세션은 uuid 칸 — 다른 글자를 넣을 수 없다", async () => {
  const { rows } = await client.query(
    "select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'analytics_events' order by ordinal_position",
  );
  assert.deepEqual(
    rows.map((r) => r.column_name),
    PRD_COLUMNS,
  );
  const type = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
  assert.equal(type.session_id, "uuid");
  assert.equal(type.visitor_id, "uuid");
  assert.equal(type.props, "jsonb");
  assert.equal(type.occurred_at, "timestamp with time zone");
  assert.equal(type.is_bot, "boolean");
  assert.equal(type.is_staff, "boolean");
  assert.equal(rows.find((r) => r.column_name === "visitor_id").is_nullable, "YES", "측정 거부 시 비움 (6.1)");
  assert.equal(rows.find((r) => r.column_name === "session_id").is_nullable, "NO");
  await tx(async () => {
    const r = await tryEvent({ visitor_id: "user@example.com" });
    assert.equal(r.code, "22P02", `uuid가 아닌 방문자 값은 거부: ${r.message}`);
  });
});

test("analytics_events·article_stats에 개인정보·원문 모양 칸 이름 0 (IP·User-Agent·이메일·주소·좌표·검색어·질문·계산 입력값·회원 ID)", async () => {
  const { rows } = await client.query(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('analytics_events', 'article_stats') order by 1, ordinal_position",
  );
  assert.ok(rows.length >= PRD_COLUMNS.length + 7, "두 표의 칸을 읽었다");
  const bad = rows.filter((r) => FORBIDDEN_COLUMN.test(r.column_name)).map((r) => `${r.table_name}.${r.column_name}`);
  assert.deepEqual(bad, []);
  // 검사가 실제로 잡는지 — 금지 모양 이름의 견본
  for (const name of ["ip", "client_ip", "user_agent", "email", "detail_address", "lat", "search_query", "question_text", "calc_inputs", "user_id", "referrer_url"]) {
    assert.ok(FORBIDDEN_COLUMN.test(name), `견본 '${name}'을 잡아야 한다`);
  }
});

test("방문자 ID 칸이 있는 표는 analytics_events 하나이고, 그 표에 회원 ID·IP·User-Agent 칸 0 (GROW-01 '함께 저장하지 않는다')", async () => {
  const { rows } = await client.query(
    "select table_name from information_schema.columns where table_schema = 'public' and column_name in ('visitor_id', 'anonymous_id', 'vid') order by 1",
  );
  assert.deepEqual(
    rows.map((r) => r.table_name),
    ["analytics_events"],
  );
  const { rows: cols } = await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'analytics_events'");
  const joinable = cols.map((c) => c.column_name).filter((c) => /(^|_)(user|member|profile|ip|ua|agent)(_|$)/.test(c));
  assert.deepEqual(joinable, []);
});

test("이름이 `events`인 표·뷰가 public에 0 (v1.2 이름 충돌 — FND-06), 측정 표는 analytics_events", async () => {
  const { rows } = await client.query(
    "select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('events', 'analytics_events') order by 1",
  );
  assert.deepEqual(
    rows.map((r) => r.relname),
    ["analytics_events"],
  );
});

// ── props 제약 ────────────────────────────────────────────

test("props — JSON 객체·값은 글자·숫자·참거짓만, 2,048바이트 이하", () =>
  tx(async () => {
    assert.ok((await tryEvent({ props: JSON.stringify({ article_id: 7, pinned: true, channel: "copy_link" }) })).ok);
    assert.ok((await tryEvent({ props: "{}" })).ok, "빈 객체");
    for (const [label, props] of [
      ["배열", "[1, 2]"],
      ["글자", '"article"'],
      ["안에 객체", JSON.stringify({ article_id: 1, extra: { a: 1 } })],
      ["안에 배열", JSON.stringify({ article_id: 1, list: [1] })],
      ["안에 빈 배열", JSON.stringify({ article_id: 1, list: [] })],
      ["null 값", JSON.stringify({ article_id: 1, topic: null })],
    ]) {
      const r = await tryEvent({ props });
      assert.equal(r.code, "23514", `${label}: ${r.message}`);
    }
    // 경계 — DB가 글자로 바꾼 크기(jsonb 글자는 띄어쓰기를 더한다)가 정확히 2,048바이트면 저장, 2,049바이트면 거부
    const shell = (await client.query(`select octet_length('{"article_id":1,"pad":""}'::jsonb::text) n`)).rows[0].n;
    const sized = (bytes) => JSON.stringify({ article_id: 1, pad: "x".repeat(bytes - shell) });
    const fit = (await client.query("select octet_length($1::jsonb::text) n", [sized(2048)])).rows[0].n;
    assert.equal(fit, 2048, "시험 값 크기");
    assert.ok((await tryEvent({ props: sized(2048) })).ok, "2,048바이트");
    const over = await tryEvent({ props: sized(2049) });
    assert.equal(over.code, "23514", `2,049바이트: ${over.message}`);
  }));

test("props — 개인정보·원문 이름의 칸(ip·user_agent·email·address·lat·query·question·input·user_id …)은 DB가 거부", () =>
  tx(async () => {
    for (const key of ["ip", "user_agent", "email", "phone", "address", "lat", "lng", "query", "q", "search_term", "question", "input", "amount", "user_id", "referrer", "url"]) {
      const r = await tryEvent({ props: JSON.stringify({ article_id: 1, [key]: "x" }) });
      assert.equal(r.ok, false, `props.${key}가 저장됐다`);
      assert.equal(r.code, "23514", `props.${key}: ${r.message}`);
    }
    // 금지 이름을 품은 다른 이름은 막지 않는다 (속성 이름은 수집 API가 이벤트마다 정한다)
    assert.ok((await tryEvent({ props: JSON.stringify({ query_length: 4, result_count: 0 }) })).ok);
  }));

// ── article_stats ─────────────────────────────────────────

test("article_stats — hour는 UTC 정시만 (세션 시간대와 상관없이), 사람 조회 ≤ 전체 조회, 음수 0, (기사, 시각) 하나", () =>
  tx(async () => {
    const id = await article();
    const row = (hour, over = {}) => tryInsert("article_stats", { article_id: id, hour, views_all: 10, views_human: 3, shares: 1, engaged_views: 2, ...over });
    await client.query("set local timezone = 'Asia/Kolkata'"); // +05:30 — date_trunc가 세션 시간대를 쓰면 정시 판정이 틀어진다
    assert.ok((await row("2026-10-18T10:00:00Z")).ok, "UTC 10시");
    assert.ok((await row("2026-10-18T10:30:00+05:30")).ok, "UTC 05시와 같은 순간");
    for (const bad of ["2026-10-18T10:00:00+05:30", "2026-10-18T11:30:00Z", "2026-10-18T12:00:01Z"]) {
      const r = await row(bad);
      assert.equal(r.code, "23514", `${bad}: ${r.message}`);
    }
    assert.equal((await row("2026-10-18T13:00:00Z", { views_all: 2, views_human: 3 })).code, "23514", "사람 > 전체");
    assert.ok((await row("2026-10-18T14:00:00Z", { views_all: 3, views_human: 3 })).ok, "사람 = 전체");
    for (const col of ["views_all", "views_human", "shares", "engaged_views"]) {
      assert.equal((await row("2026-10-18T15:00:00Z", { [col]: -1 })).code, "23514", `${col} 음수`);
    }
    assert.equal((await row("2026-10-18T10:00:00Z")).code, "23505", "같은 기사·같은 시각 두 번");
    await client.query("delete from public.articles where id = $1", [id]);
    const { rows } = await client.query("select count(*)::int n from public.article_stats where article_id = $1", [id]);
    assert.equal(rows[0].n, 0, "기사를 지우면 집계도 지워진다");
  }));

// ── RLS ───────────────────────────────────────────────────

test("anon·authenticated — analytics_events·article_stats 읽기·쓰기·고치기·지우기 0 (권한 거부)", () =>
  tx(async () => {
    const ev = await tryEvent();
    assert.ok(ev.ok, ev.message);
    const id = await article();
    assert.ok((await tryInsert("article_stats", { article_id: id, hour: "2026-10-18T10:00:00Z", views_all: 1, views_human: 1 })).ok);
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["analytics_events", "article_stats"]) {
        for (const sql of [`select count(*) from public.${table}`, `update public.${table} set computed_at = now()`, `delete from public.${table}`]) {
          const q = table === "analytics_events" ? sql.replace("computed_at = now()", "is_bot = true") : sql;
          const r = await attempt(q, [], role);
          assert.equal(r.code, "42501", `${role}: ${q} → ${r.ok ? `${r.rowCount}행` : r.message}`);
        }
      }
      const ins = await tryEvent({}, role);
      assert.equal(ins.code, "42501", `${role}: 이벤트 쓰기 → ${ins.message}`);
      const st = await tryInsert("article_stats", { article_id: id, hour: "2026-10-18T11:00:00Z" }, role);
      assert.equal(st.code, "42501", `${role}: 집계 쓰기 → ${st.message}`);
    }
  }));

test("service_role — 이벤트·집계를 쓰고·읽고·고치고·지운다 (수집 API·집계 배치·보존 기한 정리)", () =>
  tx(async () => {
    const id = await article();
    const ins = await tryEvent({ props: JSON.stringify({ article_id: id, format: "general", content_type: "explainer" }) }, "service_role");
    assert.ok(ins.ok, ins.message);
    const eventId = ins.rows[0].id;
    for (const sql of [
      ["select count(*)::int n from public.analytics_events where id = $1", [eventId]],
      ["update public.analytics_events set is_staff = true where id = $1", [eventId]],
      ["insert into public.article_stats (article_id, hour, views_all, views_human) values ($1, '2026-10-18T10:00:00Z', 2, 1)", [id]],
      ["update public.article_stats set views_all = 3 where article_id = $1", [id]],
      ["delete from public.article_stats where article_id = $1", [id]],
      ["delete from public.analytics_events where id = $1", [eventId]],
    ]) {
      const r = await attempt(sql[0], sql[1], "service_role");
      assert.ok(r.ok, `${sql[0]}: ${r.message}`);
      if (!sql[0].startsWith("select")) assert.equal(r.rowCount, 1, sql[0]);
    }
  }));

test("RLS가 켜져 있고 공개 읽기 정책이 없다 (두 표)", async () => {
  const { rows } = await client.query(
    "select c.relname, c.relrowsecurity, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('analytics_events', 'article_stats') order by 1",
  );
  assert.deepEqual(rows, [
    { relname: "analytics_events", relrowsecurity: true, policies: 0 },
    { relname: "article_stats", relrowsecurity: true, policies: 0 },
  ]);
});

// ── 설정 씨앗 ─────────────────────────────────────────────

test("설정 씨앗 5개 = 설계 2.5 블록 (값 그대로), anon은 많이 본 기사 건수 규칙(popular_rules)만 읽는다 — 수집 설정·봇 목록·리퍼러·HOT 가중치 0", async () => {
  const keys = [...SEEDS.keys()];
  const { rows } = await client.query("select key, value from public.settings where key = any($1::text[]) order by key", [keys]);
  assert.deepEqual(
    rows.map((r) => r.key),
    [...keys].sort(),
  );
  for (const r of rows) assert.deepEqual(r.value, SEEDS.get(r.key), `settings.${r.key}`);
  await tx(async () => {
    const r = await attempt("select key from public.settings where key = any($1::text[]) order by key", [keys], "anon");
    assert.ok(r.ok, r.message);
    assert.deepEqual(r.rows.map((x) => x.key), ["popular_rules"], "화면이 사이드바·목록 건수를 읽는 키만 공개 (2단계 — 마이그레이션 15)");
  });
});

test("HOT 가중치 씨앗 = HOME-05 초안 (조회 1 · 공유 5 · 30초 이상 열람 2, 최근 7일, 고정 최대 2건), 많이 본 기사 = ART-11 (168시간·30분 중복 제거·사이드바 5·목록 20)", async () => {
  const get = async (key) => (await client.query("select value from public.settings where key = $1", [key])).rows[0]?.value;
  const hot = await get("hot_weights");
  assert.deepEqual([hot.view, hot.share, hot.engaged, hot.window_days, hot.max_pins], [1, 5, 2, 7, 2]);
  const popular = await get("popular_rules");
  assert.deepEqual([popular.window_hours, popular.dedupe_minutes, popular.sidebar_size, popular.list_size], [168, 30, 5, 20]);
  assert.deepEqual(popular.exclude_content_types, ["digest", "sponsored"], "ART-11 [결정 안건] 초안 — 제외");
  const analytics = await get("analytics");
  assert.equal(analytics.session_idle_minutes, 30, "GROW-01 세션 경계 30분 무활동");
  assert.equal(analytics.respect_dnt, false, "설계 9장 #3 기본값");
  const bots = await get("bot_user_agents");
  for (const human of ["kakaotalk", "naver", "daum"]) assert.ok(!bots.patterns.includes(human), `사람 앱 브라우저 낱말 '${human}'은 봇 목록에 없다`);
  assert.ok(bots.patterns.every((p) => p === p.toLowerCase() && p.trim() === p && p.length > 0), "소문자 조각");
});
