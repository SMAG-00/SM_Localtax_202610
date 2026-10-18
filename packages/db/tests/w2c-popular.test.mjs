// W2-c 2단계 DB — 많이 본 기사·상담 사례 HOT 순위 · 집계 함수 · 보존 기한 정리 (ART-11 · HOME-05 · FND-06, docs/dev/W2-c_설계.md 3·8장)
//  · article_rankings: 값 제약(목록 2종·순위 1~100·같은 목록에 같은 기사 하나·고정은 HOT만·UTC 정시 창)·기사와 함께 지워짐
//  · 최소 권한: anon·authenticated는 지금 공개된 기사의 순위·고정·집계 시각 칸만 — 비공개로 바뀐 기사는 바로 0행, 점수·창 칸·쓰기는 권한 거부,
//    원본 analytics_events·집계 article_stats는 그대로 0. 집계 함수 6개는 service_role만 실행 (anon 실행은 health_ping뿐)
//  · 집계 함수 동작: 시간 단위 집계 바꾸기(범위 안만·멱등·없는 기사 뺌) · 창 합계(시작 포함·끝 제외) · 순위 바꾸기(다시 세기·다른 목록 그대로) ·
//    바뀐 이벤트 시간대 찾기(번호 뒤·기사 이벤트만) · 보존 기한 정리(기준 시각 앞만·한 번에 최대 건수)
// 모든 시험은 트랜잭션 안에서 하고 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}

let seq = 0;
async function article({ status = "published" } = {}) {
  const { rows } = await client.query(
    "insert into public.articles (slug, title, section, content_type, status) values ($1, '순위 시험 기사', 'tax', 'explainer', $2) returning id",
    [`w2c-rank-${process.pid}-${++seq}`, status],
  );
  return Number(rows[0].id);
}

const W_START = "2026-10-11T00:00:00Z";
const W_END = "2026-10-18T00:00:00Z";
const COMPUTED = "2026-10-18T00:05:00Z";

async function rank(cols) {
  const row = { list: "popular", rank: 1, pinned: false, score: 1, window_start: W_START, window_end: W_END, computed_at: COMPUTED, settings_version: "v1", ...cols };
  const keys = Object.keys(row);
  return attempt(`insert into public.article_rankings (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, keys.map((k) => row[k]));
}

const uuid = () => crypto.randomUUID();
async function event({ name = "article_viewed", at, articleId = 1, visitor = uuid() }) {
  const { rows } = await client.query(
    `insert into public.analytics_events (name, occurred_at, session_id, visitor_id, first_visit, stage, entry, section, props, is_bot, is_staff)
     values ($1, $2, $3, $4, false, 1, 'direct', 'tax', $5, false, false) returning id`,
    [name, at, uuid(), visitor, JSON.stringify(name === "hub_viewed" ? {} : name === "article_shared" ? { article_id: articleId, channel: "copy_link" } : { article_id: articleId, format: "general", content_type: "explainer" })],
  );
  return Number(rows[0].id);
}

const FUNCTIONS = [
  ["analytics_article_changes", "select public.analytics_article_changes(0, now() - interval '1 day', now())"],
  ["article_stats_replace", "select public.article_stats_replace('2026-10-18T00:00:00Z', '2026-10-18T01:00:00Z', '[]'::jsonb, now())"],
  ["article_stats_totals", "select public.article_stats_totals('2026-10-11T00:00:00Z', '2026-10-18T00:00:00Z')"],
  ["article_rankings_replace", "select public.article_rankings_replace('popular', '[]'::jsonb, '2026-10-11T00:00:00Z', '2026-10-18T00:00:00Z', now(), 'v1')"],
  ["analytics_events_purge", "select public.analytics_events_purge('2000-01-01T00:00:00Z', 10)"],
  ["article_stats_purge", "select public.article_stats_purge('2000-01-01T00:00:00Z', 10)"],
];

// ── article_rankings 값 제약 ───────────────────────────────

test("article_rankings — 목록은 popular·hot만, 순위 1~100 (0·101 거부), 같은 목록에 같은 기사·같은 순위 하나", () =>
  tx(async () => {
    const a = await article();
    const b = await article();
    assert.ok((await rank({ article_id: a, rank: 1 })).ok);
    assert.ok((await rank({ article_id: a, rank: 1, list: "hot" })).ok, "다른 목록에는 같은 기사가 있어도 된다");
    for (const [cols, why] of [
      [{ article_id: b, list: "latest" }, "목록 밖 이름"],
      [{ article_id: b, rank: 0 }, "순위 0"],
      [{ article_id: b, rank: 101 }, "순위 101"],
      [{ article_id: a, rank: 2 }, "같은 목록에 같은 기사 둘"],
      [{ article_id: b, rank: 1 }, "같은 목록에 같은 순위 둘"],
      [{ article_id: b, rank: 3, score: -1 }, "음수 점수"],
    ]) {
      const r = await rank(cols);
      assert.equal(r.ok, false, why);
    }
    assert.ok((await rank({ article_id: b, rank: 100 })).ok, "순위 100은 된다");
  }));

test("article_rankings — 편집자 고정은 HOT 목록만, 집계 창은 UTC 정시이고 시작 < 끝, 기사를 지우면 순위 행도 지워진다", () =>
  tx(async () => {
    const a = await article();
    assert.equal((await rank({ article_id: a, pinned: true })).ok, false, "많이 본 기사에 고정 0");
    assert.ok((await rank({ article_id: a, list: "hot", pinned: true })).ok);
    const b = await article();
    assert.equal((await rank({ article_id: b, rank: 2, window_end: "2026-10-18T00:30:00Z" })).ok, false, "정시가 아닌 창 끝");
    assert.equal((await rank({ article_id: b, rank: 2, window_start: W_END, window_end: W_START })).ok, false, "시작이 끝보다 뒤");
    await client.query("delete from public.articles where id = $1", [a]);
    const { rows } = await client.query("select count(*)::int n from public.article_rankings where article_id = $1", [a]);
    assert.equal(rows[0].n, 0);
  }));

// ── 최소 권한 ─────────────────────────────────────────────

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 지금 공개된 기사의 순위·고정·집계 시각만 읽는다. 초안·보류·삭제 기사의 행 0, 발행 기사를 보류로 바꾸면 바로 0`, () =>
    tx(async () => {
      const pub = await article();
      const draft = await article({ status: "draft" });
      const gone = await article({ status: "deleted" });
      await rank({ article_id: pub, rank: 1 });
      await rank({ article_id: draft, rank: 2 });
      await rank({ article_id: gone, rank: 3 });
      const read = async () => {
        const r = await attempt("select list, rank, article_id, pinned, computed_at from public.article_rankings where article_id = any($1::bigint[]) order by rank", [[pub, draft, gone]], role);
        assert.ok(r.ok, r.message);
        return r.rows.map((x) => Number(x.article_id));
      };
      assert.deepEqual(await read(), [pub]);
      await client.query("update public.articles set status = 'held' where id = $1", [pub]);
      assert.deepEqual(await read(), [], "비공개로 바뀐 기사는 다음 집계를 기다리지 않고 빠진다 (ART-11)");
    }));

  test(`${role} — 점수·집계 창·설정 버전 칸은 권한 거부, 쓰기·고치기·지우기 0, 원본 이벤트·시간 단위 집계는 그대로 0`, () =>
    tx(async () => {
      const pub = await article();
      await rank({ article_id: pub });
      for (const col of ["score", "window_start", "window_end", "settings_version", "*"]) {
        const r = await attempt(`select ${col} from public.article_rankings limit 1`, [], role);
        assert.equal(r.ok, false, col);
        assert.equal(r.code, "42501", col);
      }
      for (const sql of [
        `insert into public.article_rankings (list, rank, article_id, score, window_start, window_end, computed_at, settings_version) values ('hot', 1, ${pub}, 1, '${W_START}', '${W_END}', now(), 'x')`,
        "update public.article_rankings set rank = 2",
        "delete from public.article_rankings",
        "select count(*) from public.article_stats",
        "select count(*) from public.analytics_events",
      ]) {
        const r = await attempt(sql, [], role);
        assert.equal(r.ok, false, sql);
      }
    }));

  test(`${role} — 집계 함수 6개 실행 권한 0`, () =>
    tx(async () => {
      for (const [name, sql] of FUNCTIONS) {
        const r = await attempt(sql, [], role);
        assert.equal(r.ok, false, name);
        assert.equal(r.code, "42501", name);
      }
    }));
}

test("anon이 실행할 수 있는 public 함수는 health_ping 하나 (verify-rls-remote 기준과 같다)", async () => {
  const { rows } = await client.query(
    "select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1",
  );
  assert.deepEqual(rows.map((r) => r.name), ["health_ping"]);
});

test("service_role — 집계 함수 6개를 실행하고 순위 표를 쓰고·읽고·고치고·지운다", () =>
  tx(async () => {
    for (const [name, sql] of FUNCTIONS) {
      const r = await attempt(sql, [], "service_role");
      assert.ok(r.ok, `${name}: ${r.message}`);
    }
    const a = await article();
    await client.query("set local role service_role");
    await client.query(
      "insert into public.article_rankings (list, rank, article_id, score, window_start, window_end, computed_at, settings_version) values ('hot', 1, $1, 3, $2, $3, now(), 'v1')",
      [a, W_START, W_END],
    );
    assert.equal((await client.query("update public.article_rankings set score = 4 where article_id = $1", [a])).rowCount, 1);
    assert.equal((await client.query("select score from public.article_rankings where article_id = $1", [a])).rows[0].score, "4");
    assert.equal((await client.query("delete from public.article_rankings where article_id = $1", [a])).rowCount, 1);
    await client.query("reset role");
  }));

// ── 집계 함수 동작 ─────────────────────────────────────────

const statRow = (articleId, hour, n = 1) => ({ article_id: articleId, hour, views_all: n + 1, views_human: n, shares: 0, engaged_views: 0 });
const statsOf = async (ids) =>
  (await client.query("select article_id, hour, views_all, views_human from public.article_stats where article_id = any($1::bigint[]) order by hour, article_id", [ids])).rows.map((r) => [
    Number(r.article_id),
    r.hour.toISOString(),
    r.views_all,
    r.views_human,
  ]);
const replaceStats = (from, to, rows) =>
  attempt("select public.article_stats_replace($1, $2, $3::jsonb, now()) as n", [from, to, JSON.stringify(rows)], "service_role");

test("article_stats_replace — [시작, 끝) 안의 행만 새 행으로 바꾸고 범위 밖 행은 그대로, 같은 행으로 다시 돌려도 같은 결과(멱등)", () =>
  tx(async () => {
    const a = await article();
    await client.query("insert into public.article_stats (article_id, hour, views_all, views_human) values ($1, '2026-10-18T00:00:00Z', 9, 9), ($1, '2026-10-18T01:00:00Z', 9, 9), ($1, '2026-10-18T03:00:00Z', 9, 9)", [a]);
    const rows = [statRow(a, "2026-10-18T01:00:00Z", 2), statRow(a, "2026-10-18T02:00:00Z", 5)];
    for (let i = 0; i < 2; i++) {
      const r = await replaceStats("2026-10-18T01:00:00Z", "2026-10-18T03:00:00Z", rows);
      assert.ok(r.ok, r.message);
      assert.equal(r.rows[0].n, 2);
      assert.deepEqual(await statsOf([a]), [
        [a, "2026-10-18T00:00:00.000Z", 9, 9],
        [a, "2026-10-18T01:00:00.000Z", 3, 2],
        [a, "2026-10-18T02:00:00.000Z", 6, 5],
        [a, "2026-10-18T03:00:00.000Z", 9, 9],
      ], `${i + 1}번째 실행`);
    }
    // 그 시간대에 더는 조회가 없으면(빈 배열) 범위 안 행이 지워진다 — 남은 숫자 0
    assert.ok((await replaceStats("2026-10-18T02:00:00Z", "2026-10-18T03:00:00Z", [])).ok);
    assert.deepEqual((await statsOf([a])).map((r) => r[1]), ["2026-10-18T00:00:00.000Z", "2026-10-18T01:00:00.000Z", "2026-10-18T03:00:00.000Z"]);
  }));

test("article_stats_replace — 범위 밖 시각의 행·빈 범위는 거부(아무것도 바뀌지 않음), 지금 없는 기사의 행은 넣지 않는다", () =>
  tx(async () => {
    const a = await article();
    await client.query("insert into public.article_stats (article_id, hour, views_all, views_human) values ($1, '2026-10-18T01:00:00Z', 9, 9)", [a]);
    const outside = await replaceStats("2026-10-18T01:00:00Z", "2026-10-18T02:00:00Z", [statRow(a, "2026-10-18T02:00:00Z")]);
    assert.equal(outside.ok, false, "끝 시각(2시)은 범위 밖");
    assert.equal((await replaceStats("2026-10-18T02:00:00Z", "2026-10-18T02:00:00Z", [])).ok, false, "빈 범위");
    assert.deepEqual(await statsOf([a]), [[a, "2026-10-18T01:00:00.000Z", 9, 9]], "거부된 실행은 지우지도 않았다");
    const missing = (await client.query("select coalesce(max(id), 0) + 1000000 as id from public.articles")).rows[0].id;
    const r = await replaceStats("2026-10-18T01:00:00Z", "2026-10-18T02:00:00Z", [statRow(a, "2026-10-18T01:00:00Z", 4), statRow(Number(missing), "2026-10-18T01:00:00Z", 7)]);
    assert.ok(r.ok, r.message);
    assert.equal(r.rows[0].n, 1, "없는 기사는 빼고 1행");
  }));

test("article_stats_totals — 창 [시작, 끝) 기사별 합계: 시작 시간대 포함, 끝 시간대 제외", () =>
  tx(async () => {
    const a = await article();
    const b = await article();
    await client.query(
      `insert into public.article_stats (article_id, hour, views_all, views_human, shares, engaged_views) values
        ($1, '2026-10-10T23:00:00Z', 50, 50, 5, 5),
        ($1, '2026-10-11T00:00:00Z', 4, 3, 1, 2),
        ($1, '2026-10-17T23:00:00Z', 4, 4, 0, 1),
        ($1, '2026-10-18T00:00:00Z', 70, 70, 7, 7),
        ($2, '2026-10-12T05:00:00Z', 2, 2, 0, 0)`,
      [a, b],
    );
    const r = await attempt("select public.article_stats_totals($1, $2) as t", [W_START, W_END], "service_role");
    assert.ok(r.ok, r.message);
    const mine = r.rows[0].t.filter((x) => [a, b].includes(Number(x.article_id)));
    assert.deepEqual(mine, [
      { article_id: a, views_human: 7, shares: 1, engaged_views: 3 },
      { article_id: b, views_human: 2, shares: 0, engaged_views: 0 },
    ]);
  }));

test("article_rankings_replace — 그 목록만 통째로 바꾸고, 지금 없는 기사는 빼고 순위를 1부터 다시 센다", () =>
  tx(async () => {
    const [a, b, c] = [await article(), await article(), await article()];
    await rank({ article_id: c, list: "hot", rank: 1, pinned: true });
    await rank({ article_id: a, list: "popular", rank: 1 });
    const missing = Number((await client.query("select coalesce(max(id), 0) + 1000000 as id from public.articles")).rows[0].id);
    const rows = [
      { rank: 1, article_id: b, pinned: false, score: 9 },
      { rank: 2, article_id: missing, pinned: false, score: 8 },
      { rank: 3, article_id: a, pinned: false, score: 7 },
    ];
    const r = await attempt("select public.article_rankings_replace('popular', $1::jsonb, $2, $3, $4, 'popular-v2') as n", [JSON.stringify(rows), W_START, W_END, COMPUTED], "service_role");
    assert.ok(r.ok, r.message);
    assert.equal(r.rows[0].n, 2);
    const { rows: now } = await client.query("select list, rank, article_id, settings_version from public.article_rankings where article_id = any($1::bigint[]) order by list, rank", [[a, b, c]]);
    assert.deepEqual(now.map((x) => [x.list, x.rank, Number(x.article_id), x.settings_version]), [
      ["hot", 1, c, "v1"],
      ["popular", 1, b, "popular-v2"],
      ["popular", 2, a, "popular-v2"],
    ]);
  }));

test("analytics_article_changes — 번호 뒤의 기사 이벤트(조회·30초 열람·공유)만: 시간대 목록·끝나지 않은 시간대의 가장 작은 번호·가장 큰 번호", () =>
  tx(async () => {
    const before = Number((await client.query("select coalesce(max(id), 0) as id from public.analytics_events")).rows[0].id);
    const e1 = await event({ at: "2026-10-17T10:15:00Z" });
    await event({ name: "article_engaged", at: "2026-10-17T10:45:00Z" });
    const e3 = await event({ name: "article_shared", at: "2026-10-17T13:59:59Z" });
    await event({ name: "hub_viewed", at: "2026-10-17T11:30:00Z" });
    const pending = await event({ at: "2026-10-17T14:00:00Z" });
    const late = await event({ at: "2026-10-16T08:00:00Z" });
    const r = await attempt("select public.analytics_article_changes($1, $2, $3) as c", [before, "2026-10-16T09:00:00Z", "2026-10-17T14:00:00Z"], "service_role");
    assert.ok(r.ok, r.message);
    const c = r.rows[0].c;
    assert.deepEqual(c.hours.map((h) => new Date(h).toISOString()), ["2026-10-17T10:00:00.000Z", "2026-10-17T13:00:00.000Z"], "허브 이벤트·창 밖(앞) 이벤트 0, 끝 시각 이후 0");
    assert.equal(Number(c.pending_min_id), pending, "끝나지 않은 시간대(14시)의 가장 작은 번호");
    assert.equal(Number(c.max_id), late);
    const after = await attempt("select public.analytics_article_changes($1, $2, $3) as c", [e3, "2026-10-16T00:00:00Z", "2026-10-17T14:00:00Z"], "service_role");
    assert.deepEqual(after.rows[0].c.hours.map((h) => new Date(h).toISOString()), ["2026-10-16T08:00:00.000Z"], "번호가 e3 뒤인 늦은 이벤트의 시간대");
    assert.ok(e1 > before);
  }));

test("analytics_events_purge — 기준 시각보다 앞선 이벤트만 오래된 것부터 한 번에 최대 건수, 기준 시각과 같은 이벤트는 남는다", () =>
  tx(async () => {
    const cutoff = "2025-09-18T00:00:00Z";
    const old = [await event({ at: "2025-09-10T00:00:00Z" }), await event({ at: "2025-09-12T00:00:00Z" }), await event({ at: "2025-09-17T23:59:59Z" })];
    const keep = [await event({ at: cutoff }), await event({ at: "2025-09-19T00:00:00Z" })];
    const ids = [...old, ...keep];
    const left = async () => (await client.query("select id from public.analytics_events where id = any($1::bigint[]) order by id", [ids])).rows.map((r) => Number(r.id));
    const others = Number((await client.query("select count(*)::int n from public.analytics_events where occurred_at < $1 and id <> all($2::bigint[])", [cutoff, ids])).rows[0].n);
    const first = await attempt("select public.analytics_events_purge($1, $2) as n", [cutoff, others + 2], "service_role");
    assert.ok(first.ok, first.message);
    assert.equal(first.rows[0].n, others + 2, "한 번에 최대 건수");
    assert.deepEqual(await left(), [old[2], ...keep], "오래된 것부터");
    const second = await attempt("select public.analytics_events_purge($1, 100) as n", [cutoff], "service_role");
    assert.equal(second.rows[0].n, 1);
    assert.deepEqual(await left(), keep, "기준 시각 이후는 남는다");
    assert.equal((await attempt("select public.analytics_events_purge($1, 0)", [cutoff], "service_role")).ok, false, "건수 0 거부");
  }));

test("article_stats_purge — 기준 시각보다 앞선 시간대 행만 지운다", () =>
  tx(async () => {
    const a = await article();
    await client.query(
      "insert into public.article_stats (article_id, hour, views_all, views_human) values ($1, '2025-09-17T22:00:00Z', 1, 1), ($1, '2025-09-17T23:00:00Z', 1, 1), ($1, '2025-09-18T00:00:00Z', 1, 1)",
      [a],
    );
    const r = await attempt("select public.article_stats_purge('2025-09-18T00:00:00Z', 100000) as n", [], "service_role");
    assert.ok(r.ok, r.message);
    assert.ok(r.rows[0].n >= 2);
    assert.deepEqual((await statsOf([a])).map((x) => x[1]), ["2025-09-18T00:00:00.000Z"]);
  }));
