// W2-c 3단계 DB — 지표 대시보드 읽기 함수 analytics_metric_sessions · 운영 도메인 전환일 설정 (GROW-01, docs/dev/W2-c_설계.md 2.6·8.3)
//  · 최소 권한: anon·authenticated 실행 0(42501), service_role만 실행. 전환일 설정은 공개 키가 아니다(anon 0행)
//  · 고르는 세션: 첫 이벤트가 [p_from, p_to)에 든 세션(p_from 전 하루 안에 이벤트가 있으면 앞에서 시작한 세션이라 뺀다)
//    + 그 방문자가 [p_to, p_until)에 새로 시작한 세션. 다른 방문자의 기간 뒤 세션·p_until 이후는 0
//  · 세션 줄 = [방문자 번호, 첫 방문, 봇, 편집국, 시작(ms), 지표 이벤트 [이름 번호, 분야, 시각(ms)]] — 방문자 UUID는 응답에 0, 봇·편집국은 세션 안 하나라도 있으면 참
//  · 세션이 상한을 넘으면 {over: true, count}, 범위·상한·이름 목록이 틀리면 오류
// 모든 시험은 트랜잭션 안에서 하고 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-c_설계.md");
const MD = fs.readFileSync(DESIGN, "utf8");

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

/** 설계 2.6 — `#### \`키\`` 다음 json 블록 */
function seeds26() {
  const sec = MD.split(/^### /m).find((s) => s.startsWith("2.6"));
  assert.ok(sec, "설계 문서 2.6을 찾지 못했다");
  const out = new Map();
  for (const m of sec.split(/^## /m)[0].matchAll(/^#### `([a-z_]+)`\s*\n+```json\n([\s\S]*?)\n```/gm)) out.set(m[1], JSON.parse(m[2]));
  return out;
}

const NAMES = ["hub_viewed", "article_viewed", "article_engaged", "home_entry_clicked", "situation_card_clicked", "search_submitted", "next_action_clicked"];
const FROM = "2026-03-01T15:00:00Z"; // 한국 2026-03-02 0시
const TO = "2026-03-02T15:00:00Z"; // 한국 2026-03-03 0시
const UNTIL = "2026-04-02T15:00:00Z"; // 끝날 + 31일 0시
const at = (base, ms) => new Date(Date.parse(base) + ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;
const uuid = () => crypto.randomUUID();
const PROPS = {
  hub_viewed: {},
  article_viewed: { article_id: 1, format: "general", content_type: "explainer" },
  article_engaged: { article_id: 1, format: "general", content_type: "explainer" },
  policy_page_viewed: { policy: "ethics" },
  next_action_clicked: { action: "same_section", screen: "article" },
};

async function event({ name, when, session, visitor, firstVisit = false, section = "tax", bot = false, staff = false }) {
  await client.query(
    `insert into public.analytics_events (name, occurred_at, session_id, visitor_id, first_visit, stage, entry, section, props, is_bot, is_staff)
     values ($1, $2, $3, $4, $5, 1, 'direct', $6, $7, $8, $9)`,
    [name, when, session, visitor, firstVisit, name === "policy_page_viewed" ? null : section, JSON.stringify(PROPS[name] ?? {}), bot, staff],
  );
}

/** 이 시험 범위의 다른 행이 끼지 않게 — 범위 안 이벤트를 트랜잭션 안에서 비운다(되돌린다) */
const clearWindow = () => client.query("delete from public.analytics_events where occurred_at >= $1::timestamptz - interval '2 days' and occurred_at < $2::timestamptz + interval '2 days'", [FROM, UNTIL]);

const read = (role, limit = 100, args = [FROM, TO, UNTIL, NAMES]) =>
  attempt("select public.analytics_metric_sessions($1, $2, $3, $4, $5) as j", [...args, limit], role);

// ── 권한 ─────────────────────────────────────────────────

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 지표 읽기 함수 실행 권한 0 (42501), 전환일 설정 읽기 0행`, () =>
    tx(async () => {
      const r = await read(role);
      assert.equal(r.ok, false);
      assert.equal(r.code, "42501");
      const s = await attempt("select key from public.settings where key = 'domain_cutover'", [], role);
      assert.ok(s.ok, s.message);
      assert.deepEqual(s.rows, [], "공개 키가 아니다");
    }));
}

test("service_role — 실행된다 (빈 범위는 세션 0)", () =>
  tx(async () => {
    await clearWindow();
    const r = await read("service_role");
    assert.ok(r.ok, r.message);
    assert.deepEqual(r.rows[0].j, { over: false, count: 0, sessions: [] });
  }));

test("security invoker · search_path 빈칸 · public에 실행 권한 0", async () => {
  const { rows } = await client.query(
    "select p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'EXECUTE') as pub from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'analytics_metric_sessions'",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].prosecdef, false, "security invoker");
  assert.deepEqual(rows[0].proconfig, ['search_path=""']);
  assert.equal(rows[0].pub, false);
});

// ── 고르기·묶기 ─────────────────────────────────────────

test("기간 안에서 시작한 세션 + 그 방문자의 기간 뒤 30일 세션만, 세션 줄 모양·방문자 번호·봇·편집국 표시 (방문자 UUID 0)", () =>
  tx(async () => {
    await clearWindow();
    const vA = uuid();
    const vD = uuid();
    const vG = uuid();
    const s = { A: uuid(), B: uuid(), C: uuid(), D: uuid(), E: uuid(), F: uuid(), G: uuid(), H: uuid(), I: uuid(), J: uuid() };
    // A — 기간 첫 순간에 시작(정책 열람은 지표 이름이 아니라 목록에 없지만 시작 시각은 정한다), 허브 → 30초 열람, 첫 방문
    await event({ name: "policy_page_viewed", when: FROM, session: s.A, visitor: vA, firstVisit: true });
    await event({ name: "hub_viewed", when: at(FROM, 10 * MIN), session: s.A, visitor: vA, firstVisit: true });
    await event({ name: "article_engaged", when: at(FROM, 11 * MIN), session: s.A, visitor: vA, firstVisit: true, section: "realestate" });
    // B — 기간 앞(1시간 전)에 시작해 기간 안으로 이어진 세션 → 0 (앞 기간의 세션)
    await event({ name: "hub_viewed", when: at(FROM, -60 * MIN), session: s.B, visitor: uuid() });
    await event({ name: "hub_viewed", when: at(FROM, 5 * MIN), session: s.B, visitor: null });
    // C — A의 방문자가 기간 뒤 30일째에 새 세션 → 들어간다 (재방문 보기)
    await event({ name: "article_viewed", when: at(TO, 29 * DAY), session: s.C, visitor: vA });
    // D — 다른 방문자의 기간 뒤 세션 → 0
    await event({ name: "hub_viewed", when: at(TO, 1 * DAY), session: s.D, visitor: vD });
    // E — 방문자 ID 없는 세션 (측정 동의 아님)
    await event({ name: "hub_viewed", when: at(FROM, 2 * 3_600_000), session: s.E, visitor: null });
    // F — 한 이벤트만 봇 표시 → 세션이 봇. G — 한 이벤트만 편집국 표시
    await event({ name: "hub_viewed", when: at(FROM, 3 * 3_600_000), session: s.F, visitor: uuid() });
    await event({ name: "article_viewed", when: at(FROM, 3 * 3_600_000 + MIN), session: s.F, visitor: null, bot: true });
    await event({ name: "hub_viewed", when: at(FROM, 4 * 3_600_000), session: s.G, visitor: vG, staff: true });
    await event({ name: "next_action_clicked", when: at(FROM, 4 * 3_600_000 + MIN), session: s.G, visitor: vG, section: null });
    // H — 끝 시각 정각에 시작 → 기간 밖. I — A 방문자의 p_until 정각 세션 → 0
    await event({ name: "hub_viewed", when: TO, session: s.H, visitor: uuid() });
    await event({ name: "hub_viewed", when: UNTIL, session: s.I, visitor: vA });
    // J — 끝 시각 1ms 전에 시작 → 기간 안
    await event({ name: "hub_viewed", when: at(TO, -1), session: s.J, visitor: uuid() });

    const r = await read("service_role");
    assert.ok(r.ok, r.message);
    const j = r.rows[0].j;
    for (const v of [vA, vD, vG]) assert.ok(!JSON.stringify(j).includes(v), "방문자 UUID를 내보내지 않는다");
    assert.equal(j.over, false);
    assert.equal(j.count, 6, "A·E·F·G·J + C");
    const [a, e, f, g, jj, c] = j.sessions; // 시작 시각 순
    assert.deepEqual(a.slice(1), [true, false, false, 0, [[0, "tax", 10 * MIN], [2, "realestate", 11 * MIN]]], "A — 시작은 정책 열람 시각, 목록은 지표 이름만");
    assert.equal(typeof a[0], "number");
    assert.deepEqual(e, [null, false, false, false, 2 * 3_600_000, [[0, "tax", 2 * 3_600_000]]], "E — 방문자 번호 없음");
    assert.deepEqual(f.slice(2, 4), [true, false], "F — 봇 표시가 하나라도 있으면 봇");
    assert.deepEqual(g.slice(2, 4), [false, true], "G — 편집국 표시");
    assert.deepEqual(g[5], [[0, "tax", 4 * 3_600_000], [6, null, 4 * 3_600_000 + MIN]], "분야 없는 다음 행동 클릭은 분야 null");
    assert.equal(jj[4], Date.parse(TO) - 1 - Date.parse(FROM), "J — 끝 시각 1ms 전");
    assert.equal(c[0], a[0], "C — A와 같은 방문자 번호");
    assert.deepEqual(c.slice(1), [false, false, false, Date.parse(TO) + 29 * DAY - Date.parse(FROM), [[1, "tax", Date.parse(TO) + 29 * DAY - Date.parse(FROM)]]]);
    const numbers = j.sessions.map((x) => x[0]).filter((x) => x !== null);
    assert.ok(numbers.every((n) => Number.isInteger(n) && n >= 1), "방문자 번호는 1부터");
  }));

test("p_until = p_to면 기간 뒤 세션 0 · 상한을 넘으면 세션 목록 없이 {over, count}", () =>
  tx(async () => {
    await clearWindow();
    const v = uuid();
    for (let i = 0; i < 3; i++) await event({ name: "hub_viewed", when: at(FROM, i * 3_600_000), session: uuid(), visitor: v });
    await event({ name: "hub_viewed", when: at(TO, DAY), session: uuid(), visitor: v });
    const noLater = await read("service_role", 100, [FROM, TO, TO, NAMES]);
    assert.equal(noLater.rows[0].j.count, 3);
    const over = await read("service_role", 3);
    assert.deepEqual(over.rows[0].j, { over: true, count: 4 }, "기간 3 + 뒤 1 = 4 > 3");
    const fits = await read("service_role", 4);
    assert.equal(fits.rows[0].j.sessions.length, 4);
  }));

test("범위·상한·이름 목록이 틀리면 오류 (조용히 빈 값 0)", () =>
  tx(async () => {
    for (const [args, limit, label] of [
      [[TO, FROM, UNTIL, NAMES], 10, "from > to"],
      [[FROM, FROM, UNTIL, NAMES], 10, "from = to"],
      [[FROM, TO, FROM, NAMES], 10, "until < to"],
      [[FROM, TO, UNTIL, NAMES], 0, "상한 0"],
      [[FROM, TO, UNTIL, []], 10, "이름 0개"],
    ]) {
      const r = await read("service_role", limit, args);
      assert.equal(r.ok, false, label);
      assert.equal(r.code, "P0001", `${label}: ${r.message}`);
    }
  }));

// ── 전환일 설정 ─────────────────────────────────────────

test("전환일 설정 씨앗 = 설계 2.6 블록 (전환 전 — date null)", async () => {
  const seeds = seeds26();
  assert.deepEqual([...seeds.keys()], ["domain_cutover"]);
  const { rows } = await client.query("select value from public.settings where key = 'domain_cutover'");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].value, seeds.get("domain_cutover"));
  assert.equal(rows[0].value.date, null);
});
