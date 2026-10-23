// W6 DB — 지자체뉴스 (docs/dev/W6_설계.md 1장 1·2단계 · 2장, 마이그레이션 20261024000063 · 64 · PRD-01B LG-01~03 · LG-05 · LG-06 · LG-09 · LG-11~14)
//  · 씨앗 — 설정 5개 · 표 행 0 · 기능 키 꺼짐 · 공개 뷰 0행
//  · ISO 주 — 발표일 2027-01-01(금)은 2026-53, 2027-01-04(월)은 2027-01, 2027-53은 존재하지 않는 주
//  · 기능 키 켜기 — 시·도 2곳 미만이면 거부
//  · 후보 — 허용 근거 없는 출처 거부 · 같은 원문 주소 한 번만 · 조회수 칸 없음
//  · 주간 페이지 — 항목 0건·유사도 기록 없음·요약 변경 뒤 재검사 없음·수치 확인 없음은 발행 거부, 발행 뒤 고치기·되돌리기 거부, 기획 전환 한 번만
//  · 행사 — 공식 주소 규칙 · 기간 · 영리 주최 sponsored · 취소 출처 · 상태 이력 추가만 · 끝난 회차 날짜 고치기 거부 · 공개 뷰 상태 계산
//  · 권한 — anon은 표 읽기 0, 공개 뷰만 (키 꺼짐 0행)
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 내용은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
let sidoA, sidoB, sigunguA;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
  const sidos = (await client.query("select code from public.regions where level = 'sido' and valid_to is null order by code limit 2")).rows;
  sidoA = sidos[0].code;
  sidoB = sidos[1].code;
  sigunguA = (await client.query("select code from public.regions where parent_code = $1 and valid_to is null order by code limit 1", [sidoA])).rows[0].code;
});
after(async () => client?.end());

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
async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
async function asAnon(sql, params = []) {
  await client.query("set local role anon");
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.query("reset role");
  }
}
const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
const setSetting = (key, value) => client.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
async function flag(key, on) {
  const cur = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  return attempt("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, [key]: on })]);
}
const SOURCE = { id: "src_test", name: "시험 출처", host: "press.example.test", kind: "board", basis: "시험용 허용 근거 문장", checked_on: "2026-10-24" };
async function allowSource() {
  await setSetting("digest_sources", [SOURCE]);
}
async function newDigest(week = "2026-53", sido = sidoA) {
  return (await client.query("insert into public.weekly_digests (sido_code, week_key) values ($1, $2) returning *", [sido, week])).rows[0];
}
let seq = 0;
async function newItem(digestId, over = {}) {
  seq += 1;
  const v = { announced_on: "2027-01-01", summary: "시험용 요약 문장입니다", ...over };
  return attempt(
    `insert into public.digest_items (digest_id, region_code, title, source_url, press_org, announced_on, summary, figures_checked, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'test') returning *`,
    [digestId, v.region_code ?? sidoA, `시험 항목 ${seq}`, v.source_url ?? `https://press.example.test/item-${seq}`, v.press_org ?? "시험 기관", v.announced_on, v.summary, v.figures_checked ?? false],
  );
}
const pass = (id, summary) =>
  client.query("update public.digest_items set sim_status = 'pass', sim_max = 0.2, sim_ratio = 0, sim_checked_hash = $2, sim_checked_at = now(), sim_rules_version = 'test' where id = $1", [id, md5(summary)]);

const HOUR = 3600_000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
async function newEvent(over = {}) {
  seq += 1;
  const v = {
    slug: `ev-test-${seq}`,
    series_key: `series-test-${seq}`,
    title: `시험 행사 ${seq}`,
    category: "tax_finance",
    organizer: "시험 주최",
    organizer_type: "government",
    venue: "시험 장소",
    region_code: sidoA,
    starts_at: iso(24 * HOUR),
    ends_at: iso(26 * HOUR),
    official_url: "https://event.example.test/a",
    source_name: "시험 출처",
    confirmed_on: new Date().toISOString().slice(0, 10),
    sponsored: false,
    published: true,
    ...over,
  };
  const cols = Object.keys(v);
  return attempt(`insert into public.local_events (${cols.join(", ")}, edited_by) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}, 'test') returning *`, cols.map((c) => v[c]));
}

test("씨앗 - 설정 5개 있고 표 행 0, 기능 키 꺼짐, 공개 뷰 anon 0행", () =>
  tx(async () => {
    const keys = (await client.query("select key from public.settings where key = any($1)", [["digest_sidos", "digest_summary_max_chars", "digest_sources", "event_url_blocked_domains", "event_recheck"]])).rows;
    assert.equal(keys.length, 5);
    for (const t of ["hot_news_candidates", "weekly_digests", "digest_items", "local_events", "event_status_history", "event_links"]) {
      assert.equal((await client.query(`select count(*)::int as n from public.${t}`)).rows[0].n, 0, `${t} 씨앗 0행`);
    }
    const flags = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
    assert.equal(flags.weekly_digest, false);
    assert.equal(flags.local_events, false);
    const denied = await attempt("select 1");
    assert.ok(denied.ok);
    for (const t of ["hot_news_candidates", "weekly_digests", "digest_items", "local_events", "event_status_history", "event_links"]) {
      await client.query("set local role anon");
      const r = await attempt(`select * from public.${t}`);
      await client.query("reset role");
      assert.equal(r.ok, false, `anon은 ${t}를 읽지 못한다`);
    }
  }));

test("ISO 주 - 2027-01-01은 2026-53, 2027-01-04는 2027-01, 2027-53은 존재하지 않는 주", () =>
  tx(async () => {
    const q = async (sql) => (await client.query(sql)).rows[0].v;
    assert.equal(await q("select public.iso_week_key('2027-01-01'::date) as v"), "2026-53");
    assert.equal(await q("select public.iso_week_key('2027-01-04'::date) as v"), "2027-01");
    assert.equal(String(await q("select to_char(public.iso_week_start('2026-53'), 'YYYY-MM-DD') as v")), "2026-12-28");
    assert.equal(await q("select public.iso_week_start('2027-53') as v"), null);
    assert.equal(await q("select public.iso_week_start('2027-00') as v"), null);
    assert.equal(await q("select public.iso_week_start('abc') as v"), null);
    const bad = await attempt("insert into public.weekly_digests (sido_code, week_key) values ($1, '2027-53')", [sidoA]);
    assert.equal(bad.ok, false);
    assert.match(bad.message, /존재하지 않는 주/);
    const d = await newDigest("2026-53");
    assert.equal(String(d.week_key), "2026-53");
    const range = (await client.query("select to_char(starts_on, 'YYYY-MM-DD') as s, to_char(ends_on, 'YYYY-MM-DD') as e from public.weekly_digests where id = $1", [d.id])).rows[0];
    assert.deepEqual({ ...range }, { s: "2026-12-28", e: "2027-01-03" });
    assert.equal(d.status, "draft");
  }));

test("기능 키 weekly_digest - 시·도 2곳 미만이면 켜기 거부, 2곳이면 켜짐", () =>
  tx(async () => {
    assert.equal((await flag("weekly_digest", true)).ok, false);
    await setSetting("digest_sidos", [sidoA]);
    const one = await flag("weekly_digest", true);
    assert.equal(one.ok, false);
    assert.match(one.message, /2곳 이상/);
    await setSetting("digest_sidos", [sidoA, sidoB]);
    assert.equal((await flag("weekly_digest", true)).ok, true);
  }));

test("설정 저장 검사 - 없는 시·도·같은 시·도 두 번·길이 상한 범위·근거 없는 출처·재확인 일수 거부", () =>
  tx(async () => {
    const put = (key, value) => attempt("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
    assert.equal((await put("digest_sidos", ["9999999999"])).ok, false);
    assert.equal((await put("digest_sidos", [sidoA, sidoA])).ok, false);
    assert.equal((await put("digest_sidos", [sigunguA])).ok, false, "시·군·구 코드는 거부");
    assert.equal((await put("digest_summary_max_chars", 10)).ok, false);
    assert.equal((await put("digest_summary_max_chars", 3000)).ok, false);
    assert.equal((await put("digest_summary_max_chars", 120)).ok, true);
    assert.equal((await put("digest_sources", [{ ...SOURCE, basis: "" }])).ok, false);
    assert.equal((await put("digest_sources", [{ ...SOURCE, checked_on: "어제" }])).ok, false);
    assert.equal((await put("digest_sources", [SOURCE, SOURCE])).ok, false, "id 겹침");
    assert.equal((await put("digest_sources", [SOURCE])).ok, true);
    assert.equal((await put("event_recheck", { days: 0, hide_stale: false })).ok, false);
    assert.equal((await put("event_recheck", { days: 7 })).ok, false);
    assert.equal((await put("event_recheck", { days: 14, hide_stale: true })).ok, true);
    assert.equal((await put("event_url_blocked_domains", ["not a domain"])).ok, false);
  }));

test("후보 - 허용 근거 없는 출처 거부, 같은 원문 주소 한 번만, 조회수 칸 없음", () =>
  tx(async () => {
    const ins = (src, url) =>
      attempt(
        "insert into public.hot_news_candidates (sido_code, region_code, source_id, title, press_org, announced_at, source_url, created_by) values ($1, $1, $2, '시험 후보', '시험 기관', now(), $3, 'test')",
        [sidoA, src, url],
      );
    const none = await ins("src_test", "https://press.example.test/c1");
    assert.equal(none.ok, false);
    assert.match(none.message, /허용 근거/);
    await allowSource();
    assert.equal((await ins("src_test", "https://press.example.test/c1")).ok, true);
    const dup = await ins("src_test", "https://press.example.test/c1");
    assert.equal(dup.ok, false);
    assert.equal(dup.code, "23505");
    const other = await attempt(
      "insert into public.hot_news_candidates (sido_code, region_code, source_id, title, press_org, announced_at, source_url, created_by) values ($1, $2, 'src_test', '시험', '기관', now(), 'https://press.example.test/c2', 'test')",
      [sidoA, sidoB],
    );
    assert.equal(other.ok, false, "다른 시·도 지역 코드 거부");
    const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'hot_news_candidates'")).rows.map((r) => r.column_name);
    assert.ok(!cols.some((c) => /view|click|hit|count|popular|rank/.test(c)), `후보 표에 조회수 계열 칸 없음: ${cols.join(",")}`);
  }));

test("항목 - 발표일이 주 밖이면 거부, 요약 상한 초과 거부, 원문 주소·발표기관 빈 값 거부", () =>
  tx(async () => {
    const d = await newDigest("2026-53");
    assert.equal((await newItem(d.id, { announced_on: "2027-01-01" })).ok, true, "2027-01-01(금)은 2026-53 주");
    const next = await newItem(d.id, { announced_on: "2027-01-04" });
    assert.equal(next.ok, false);
    assert.match(next.message, /주.*밖/);
    await setSetting("digest_summary_max_chars", 50);
    const long = await newItem(d.id, { summary: "가".repeat(51) });
    assert.equal(long.ok, false);
    assert.match(long.message, /길이 상한/);
    assert.equal((await newItem(d.id, { summary: "가".repeat(50) })).ok, true);
    assert.equal((await newItem(d.id, { source_url: "원문없음" })).ok, false);
    assert.equal((await newItem(d.id, { press_org: " " })).ok, false);
    assert.equal((await newItem(d.id, { region_code: sidoB })).ok, false, "다른 시·도 지역 거부");
    assert.equal((await newItem(d.id, { region_code: sigunguA })).ok, true, "그 시·도 아래 시·군·구는 허용");
    const w2 = await newDigest("2027-01");
    assert.equal((await newItem(w2.id, { announced_on: "2027-01-04" })).ok, true, "2027-01-04(월)은 2027-01 주");
  }));

test("발행 - 시·도 설정 밖·항목 0건·유사도 기록 없음·요약 변경 뒤 재검사 없음·수치 확인 없음은 거부, 통과하면 발행되고 고칠 수 없다", () =>
  tx(async () => {
    const publish = (id) => attempt("update public.weekly_digests set status = 'published', published_by = 'user:test' where id = $1 returning *", [id]);
    const d = await newDigest("2026-53");
    const notListed = await publish(d.id);
    assert.equal(notListed.ok, false);
    assert.match(notListed.message, /digest_sidos/);
    await setSetting("digest_sidos", [sidoA, sidoB]);
    const empty = await publish(d.id);
    assert.equal(empty.ok, false);
    assert.match(empty.message, /0건/);

    const it = (await newItem(d.id, { summary: "시험용 요약 문장입니다" })).rows[0];
    const noSim = await publish(d.id);
    assert.equal(noSim.ok, false);
    assert.match(noSim.message, /유사도/);

    await client.query("update public.digest_items set sim_status = 'blocked', sim_checked_hash = $2 where id = $1", [it.id, md5(it.summary)]);
    assert.equal((await publish(d.id)).ok, false, "차단 상태는 발행 불가");
    await client.query("update public.digest_items set sim_status = 'no_sources' where id = $1", [it.id]);
    assert.equal((await publish(d.id)).ok, false, "비교 원문 없음은 통과가 아니다");

    await pass(it.id, it.summary);
    // 요약을 고치면 유사도 기록이 지워진다
    await client.query("update public.digest_items set summary = '고친 요약 문장입니다' where id = $1", [it.id]);
    const cleared = (await client.query("select sim_status, sim_checked_hash from public.digest_items where id = $1", [it.id])).rows[0];
    assert.equal(cleared.sim_status, null);
    assert.equal(cleared.sim_checked_hash, null);
    assert.equal((await publish(d.id)).ok, false);

    // 해시가 현재 요약과 다르면(검사 뒤 바뀜) 거부
    await client.query("update public.digest_items set sim_status = 'pass', sim_checked_hash = $2 where id = $1", [it.id, md5("다른 요약")]);
    assert.equal((await publish(d.id)).ok, false);

    // 수치가 있는 요약은 편집자 확인이 있어야 한다
    await client.query("update public.digest_items set summary = '예산 120억 원 규모입니다' where id = $1", [it.id]);
    await pass(it.id, "예산 120억 원 규모입니다");
    const figures = await publish(d.id);
    assert.equal(figures.ok, false);
    assert.match(figures.message, /수치/);
    await client.query("update public.digest_items set figures_checked = true where id = $1", [it.id]);
    const done = await publish(d.id);
    assert.equal(done.ok, true);
    assert.equal(done.rows[0].status, "published");
    assert.ok(done.rows[0].published_at);

    // 발행 뒤 - 항목 수정·삭제·추가, 되돌리기 거부 / 기획 전환 연결만 가능
    assert.equal((await attempt("update public.digest_items set summary = '또 고침' where id = $1", [it.id])).ok, false);
    assert.equal((await attempt("delete from public.digest_items where id = $1", [it.id])).ok, false);
    assert.equal((await newItem(d.id, { announced_on: "2027-01-02" })).ok, false);
    assert.equal((await attempt("update public.weekly_digests set status = 'draft', published_at = null, published_by = null where id = $1", [d.id])).ok, false);
    const first = (await client.query("select public.digest_item_to_assignment($1, 'user:test') as id", [it.id])).rows[0].id;
    const again = (await client.query("select public.digest_item_to_assignment($1, 'user:test') as id", [it.id])).rows[0].id;
    assert.equal(first, again, "같은 항목을 다시 전환하면 기존 카드");
    const card = (await client.query("select status, section, region_code from public.story_assignments where id = $1", [first])).rows[0];
    assert.deepEqual({ ...card }, { status: "idea", section: "local", region_code: sidoA });
  }));

test("주간 페이지 공개 뷰 - 키 꺼짐 0행, 켜짐 + 발행만 보이고 유사도·원문·기획 칸 없음", () =>
  tx(async () => {
    await setSetting("digest_sidos", [sidoA, sidoB]);
    const d = await newDigest("2026-53");
    const it = (await newItem(d.id)).rows[0];
    await pass(it.id, it.summary);
    await attempt("update public.weekly_digests set status = 'published', published_by = 'user:test' where id = $1", [d.id]);
    assert.equal((await asAnon("select * from public.public_weekly_digests")).length, 0, "키 꺼짐");
    assert.equal((await flag("weekly_digest", true)).ok, true);
    const w = await asAnon("select * from public.public_weekly_digests");
    assert.equal(w.length, 1);
    assert.equal(w[0].week_key, "2026-53");
    const items = await asAnon("select * from public.public_digest_items");
    assert.equal(items.length, 1);
    for (const hidden of ["sim_status", "sim_max", "original_text", "assignment_id", "sim_matches", "created_by"]) assert.ok(!(hidden in items[0]), `${hidden} 공개 뷰에 없음`);
    const draft = await newDigest("2027-01");
    await newItem(draft.id, { announced_on: "2027-01-04" });
    assert.equal((await asAnon("select * from public.public_weekly_digests")).length, 1, "초안 주는 공개 0");
    assert.equal((await asAnon("select * from public.public_digest_items")).length, 1);
  }));

test("행사 - 공식 주소 규칙 거부(단축·개인 블로그·형식), 기간·영리 주최·취소 출처 규칙", () =>
  tx(async () => {
    assert.equal((await newEvent()).ok, true);
    for (const url of ["https://bit.ly/abc", "https://myname.tistory.com/1", "https://blog.naver.com/x/1", "ftp://x.example.test", "event.example.test", "https://a b.example.test"]) {
      const r = await newEvent({ official_url: url });
      assert.equal(r.ok, false, `${url} 거부`);
    }
    assert.equal((await newEvent({ official_url: "http://event.example.test/plain" })).ok, true, "http도 공식 주소로 허용");
    const period = await newEvent({ starts_at: iso(48 * HOUR), ends_at: iso(24 * HOUR) });
    assert.equal(period.ok, false);
    assert.equal(period.code, "23514");
    assert.equal((await newEvent({ region_code: "9999999999" })).ok, false, "없는 지역 거부");
    const commercial = await newEvent({ organizer_type: "commercial", sponsored: false });
    assert.equal(commercial.ok, false);
    assert.match(commercial.message, /local_events_commercial_sponsored/);
    assert.equal((await newEvent({ organizer_type: "commercial", sponsored: true })).ok, true);
    assert.equal((await newEvent({ category: "commercial", sponsored: false })).ok, false);
    const nullTitle = await attempt("insert into public.local_events (slug, series_key, category, organizer, organizer_type, venue, region_code, starts_at, ends_at, official_url, source_name, confirmed_on, edited_by) values ('x1', 'x1', 'other', 'o', 'government', 'v', $1, now(), now(), 'https://e.example.test/', 's', current_date, 't')", [sidoA]);
    assert.equal(nullTitle.ok, false, "행사명 누락은 저장 불가");
    const dupSeries = (await newEvent({ series_key: "dup-series", starts_at: iso(72 * HOUR), ends_at: iso(74 * HOUR) })).rows[0];
    assert.ok(dupSeries);
    assert.equal((await newEvent({ series_key: "dup-series", starts_at: dupSeries.starts_at, ends_at: iso(80 * HOUR) })).ok, false, "같은 행사 같은 회차 시작 시각 중복 거부");
    const cancel = await newEvent({ status_override: "cancelled" });
    assert.equal(cancel.ok, false, "취소는 출처 주소·확인 시각 필수");
  }));

test("행사 상태 이력 - 지정 상태가 바뀔 때마다 1행, 수정·삭제 거부, 끝난 회차 날짜 고치기 거부", () =>
  tx(async () => {
    const ev = (await newEvent()).rows[0];
    const hist = async () => (await client.query("select from_state, to_state, source_url, changed_by from public.event_status_history where event_id = $1 order by id", [ev.id])).rows;
    assert.equal((await hist()).length, 0);
    const toChanging = await attempt("update public.local_events set status_override = 'changing', edited_by = 'user:a' where id = $1", [ev.id]);
    assert.equal(toChanging.ok, true);
    const cancel = await attempt("update public.local_events set status_override = 'cancelled', status_source_url = 'https://event.example.test/notice', status_confirmed_at = now(), edited_by = 'user:b' where id = $1", [ev.id]);
    assert.equal(cancel.ok, true);
    assert.deepEqual(
      (await hist()).map((h) => [h.from_state, h.to_state, h.changed_by]),
      [["normal", "changing", "user:a"], ["changing", "cancelled", "user:b"]],
    );
    assert.equal((await hist())[1].source_url, "https://event.example.test/notice");
    // 같은 상태로 다시 저장하면 이력이 늘지 않는다
    await client.query("update public.local_events set title = '제목만 고침', edited_by = 'user:c' where id = $1", [ev.id]);
    assert.equal((await hist()).length, 2);
    assert.equal((await attempt("update public.event_status_history set changed_by = 'x' where event_id = $1", [ev.id])).ok, false);
    assert.equal((await attempt("delete from public.event_status_history where event_id = $1", [ev.id])).ok, false);

    const past = (await newEvent({ starts_at: iso(-72 * HOUR), ends_at: iso(-48 * HOUR) })).rows[0];
    const redate = await attempt("update public.local_events set starts_at = starts_at + interval '365 days', ends_at = ends_at + interval '365 days' where id = $1", [past.id]);
    assert.equal(redate.ok, false);
    assert.match(redate.message, /새 회차는 새 행/);
    assert.equal((await attempt("update public.local_events set venue = '장소만 고침' where id = $1", [past.id])).ok, true, "날짜 말고는 고칠 수 있다");
  }));

test("행사 공개 뷰 - 키 꺼짐 0행, 상태 예정·진행·종료·취소·변경 확인 중 계산, 재확인 필요 = 확인일 + N일 초과, 미공개 행 0", () =>
  tx(async () => {
    const upcoming = (await newEvent({ starts_at: iso(24 * HOUR), ends_at: iso(30 * HOUR) })).rows[0];
    const ongoing = (await newEvent({ starts_at: iso(-2 * HOUR), ends_at: iso(2 * HOUR) })).rows[0];
    const ended = (await newEvent({ starts_at: iso(-30 * HOUR), ends_at: iso(-24 * HOUR) })).rows[0];
    const changing = (await newEvent({ status_override: "changing" })).rows[0];
    const cancelled = (await newEvent({ status_override: "cancelled", status_source_url: "https://event.example.test/n", status_confirmed_at: iso(0) })).rows[0];
    const draft = (await newEvent({ published: false })).rows[0];
    assert.equal((await asAnon("select * from public.public_local_events")).length, 0, "키 꺼짐");
    assert.equal((await flag("local_events", true)).ok, true);
    const rows = await asAnon("select id, status, recheck_due from public.public_local_events");
    const by = Object.fromEntries(rows.map((r) => [String(r.id), r.status]));
    assert.equal(by[upcoming.id], "upcoming");
    assert.equal(by[ongoing.id], "ongoing");
    assert.equal(by[ended.id], "ended");
    assert.equal(by[changing.id], "changing");
    assert.equal(by[cancelled.id], "cancelled");
    assert.ok(!(draft.id in by) && !(String(draft.id) in by), "미공개 행사 0");

    // 재확인 - 기본 7일: 확인 후 7일째는 정상, 8일째는 재확인 필요
    const kst = (days) => new Date(Date.now() + 9 * HOUR - days * 24 * HOUR).toISOString().slice(0, 10);
    const d7 = (await newEvent({ confirmed_on: kst(7) })).rows[0];
    const d8 = (await newEvent({ confirmed_on: kst(8) })).rows[0];
    const due = Object.fromEntries((await asAnon("select id, recheck_due from public.public_local_events")).map((r) => [String(r.id), r.recheck_due]));
    assert.equal(due[d7.id], false);
    assert.equal(due[d8.id], true);
    await setSetting("event_recheck", { days: 10, hide_stale: false });
    const due10 = Object.fromEntries((await asAnon("select id, recheck_due from public.public_local_events")).map((r) => [String(r.id), r.recheck_due]));
    assert.equal(due10[d8.id], false, "설정을 바꾸면 다음 조회부터 적용");
  }));

test("행사 연결 - 없는 대상 거부, 같은 연결 두 번 거부", () =>
  tx(async () => {
    const ev = (await newEvent()).rows[0];
    const ins = (kind, id) => attempt("insert into public.event_links (event_id, target_kind, target_id, reason, confirmed_by) values ($1, $2, $3, '시험 연결 이유', 'user:test')", [ev.id, kind, id]);
    assert.equal((await ins("project", 987654321)).ok, false);
    assert.equal((await ins("article", 987654321)).ok, false);
    assert.equal((await ins("amendment", 1)).ok, false, "개정안 종류는 MVP 이후");
  }));
