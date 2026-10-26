// W12-h DB - 지방세 통계 시계열 (마이그레이션 179·181, PRD-04 DATA-01)
//  · 수집 쓰기 - 원천이 수집 가능이 아니면 거부(+ 감사 1행), 가능하면 스냅샷(origin stats) + 초안, 같은 점이면 새로 만들지 않음, 점이 바뀌면 새 판
//  · 제약 - 점 모양·출처 주소·국세 이름 거부, 내용 불변·직접 상태 변경·삭제 거부
//  · 승인 - 초안만, 새 기준연도 승인 시 이전 승인본은 superseded, 키마다 승인본 1개, 철회는 이유 필수
//  · 공개 뷰 - 기능 키 data_stories가 켜지고 승인된 행만(초안·철회 0), 스냅샷·승인자 칸 없음
//  · 기사 차트 연결 - 승인된 시계열만, 기준연도는 시계열 값으로 고정, 수정 거부
// 모든 시험은 거래 안에서 돌고 되돌린다. 값·제목·출처는 모두 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { open, helpers } from "./_w10d_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const SRC = "mois_local_tax_stats";
const ACTOR = "admin:test@example.test";
const JOB = "job:stats-collect";
const NATIONAL = ["양", "도"].join("") + "항목";

const allow = () =>
  client.query("update public.data_sources set terms_status = 'allowed', terms_checked_by = 'test', terms_checked_at = now(), contract_verified_by = 'test', contract_verified_at = now() where key = $1", [SRC]);
const flag = (on) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ data_stories: on })]);
const snap = (over = {}) => ({ url: "https://example.test/stats/list", payload: '{"시험용":true}', content_hash: h.uniq("hash"), http_status: 200, external_id: h.uniq("ext"), ...over });
const series = (over = {}) => ({
  series_key: "test_series_a", title: "시험용 시계열", tax_item: "시험세목", region_code: null, unit: "시험단위",
  points: [{ period: "2021", value: 10 }, { period: "2022", value: 12 }], source_name: "시험용 출처", source_url: "https://example.test/about", base_year: 2022, checked_at: "2026-10-01", ...over,
});
const put = async (s = series(), sn = snap(), actor = JOB) => (await h.one("select public.stats_series_put($1, $2::jsonb, $3::jsonb, $4) r", [SRC, JSON.stringify(sn), JSON.stringify(s), actor])).r;
const approve = async (id) => (await h.one("select public.stats_series_approve($1, $2) r", [id, ACTOR])).r;
const anonRows = async (sql = "select id, series_key, base_year, status from public.public_stats_series order by id") => (await h.anon(sql)).rows;

test("원천이 수집 가능이 아니면 거부 + 거부 감사 1행, 스냅샷·시계열 0", () =>
  h.tx(async () => {
    const r = await put();
    assert.equal(r.ok, false);
    assert.equal(r.code, "source_not_runnable");
    assert.equal((await h.one("select count(*)::int n from public.stats_series")).n, 0);
    assert.equal((await h.one("select count(*)::int n from public.stats_audit where outcome = 'refused' and code = 'source_not_runnable'")).n, 1);
    assert.equal((await put(series(), snap(), "bad")).code, "actor_invalid");
  }));

test("수집 가능이면 스냅샷(origin stats) + 초안 1건, 같은 점이면 새로 만들지 않고 점이 바뀌면 새 판", () =>
  h.tx(async () => {
    await allow();
    const a = await put();
    assert.equal(a.ok, true);
    assert.equal(a.created, true);
    const row = await h.one("select s.status, s.version, r.origin from public.stats_series s join public.raw_snapshots r on r.id = s.snapshot_id where s.id = $1", [a.id]);
    assert.deepEqual({ ...row }, { status: "draft", version: 1, origin: "stats" });
    const same = await put(series(), snap());
    assert.equal(same.created, false);
    assert.equal(same.id, a.id);
    const changed = await put(series({ points: [{ period: "2021", value: 10 }, { period: "2022", value: 13 }] }), snap());
    assert.equal(changed.created, true);
    assert.equal((await h.one("select version from public.stats_series where id = $1", [changed.id])).version, 2);
  }));

test("제약 - 점 모양·출처 주소·국세 이름·필수 칸 거부", () =>
  h.tx(async () => {
    await allow();
    const bad = [
      series({ points: [] }),
      series({ points: [{ period: "2022", value: 1 }, { period: "2021", value: 2 }] }),
      series({ points: [{ period: "22", value: 1 }] }),
      series({ points: [{ period: "2022", value: "1" }] }),
      series({ source_url: "http://example.test/a" }),
      series({ source_url: "https://example.test/a?serviceKey=abc" }),
      series({ source_name: "" }),
      series({ base_year: 1800 }),
      series({ unit: "" }),
      series({ tax_item: NATIONAL }),
      series({ series_key: "Bad Key" }),
    ];
    for (const s of bad) {
      const r = await put(s);
      assert.equal(r.ok, false, JSON.stringify(s).slice(0, 80));
      assert.equal(r.code, "series_invalid");
    }
    assert.equal((await put(series({ tax_item: "지방소득세" }))).ok, true, "지방세 이름은 통과");
    const noSnap = await h.attempt("insert into public.stats_series (series_key, version, title, unit, points, source_name, source_url, base_year, checked_at, created_by) values ('test_series_a', 1, 'x', 'u', '[{\"period\":\"2022\",\"value\":1}]', 's', 'https://example.test', 2022, '2026-10-01', 't')");
    assert.equal(noSnap.ok, false, "스냅샷 NOT NULL");
  }));

test("불변 - 내용 수정·직접 상태 변경·삭제·감사 수정 거부", () =>
  h.tx(async () => {
    await allow();
    const a = await put();
    assert.equal((await h.attempt("update public.stats_series set title = '바꿈' where id = $1", [a.id])).ok, false);
    assert.equal((await h.attempt("update public.stats_series set points = '[{\"period\":\"2022\",\"value\":99}]' where id = $1", [a.id])).ok, false);
    assert.equal((await h.attempt("update public.stats_series set status = 'approved', approved_by = 'x', approved_at = now() where id = $1", [a.id])).ok, false);
    assert.equal((await h.attempt("delete from public.stats_series where id = $1", [a.id])).ok, false);
    assert.equal((await h.attempt("update public.stats_audit set code = 'x'")).ok, false);
    assert.equal((await h.attempt("delete from public.stats_audit")).ok, false);
  }));

test("승인 - 초안만, 새 기준연도를 승인하면 이전 승인본은 superseded, 키마다 승인본 1개", () =>
  h.tx(async () => {
    await allow();
    const a = await put(series({ base_year: 2022 }));
    assert.equal((await h.one("select public.stats_series_approve($1, 'bad') r", [a.id])).r.code, "actor_invalid");
    assert.equal((await approve(a.id)).ok, true);
    assert.equal((await approve(a.id)).code, "not_draft");
    const b = await put(series({ base_year: 2023, points: [{ period: "2022", value: 12 }, { period: "2023", value: 15 }] }));
    assert.equal((await approve(b.id)).ok, true);
    const rows = (await client.query("select base_year, status from public.stats_series order by id")).rows;
    assert.deepEqual(rows.map((r) => r.status), ["superseded", "approved"]);
    assert.equal((await h.one("select count(*)::int n from public.stats_series where series_key = 'test_series_a' and status = 'approved'")).n, 1);
    assert.equal((await approve(99999999)).code, "not_found");
    assert.equal((await h.one("select count(*)::int n from public.stats_audit where action = 'approve' and outcome = 'refused'")).n, 3);
  }));

test("확인일이 오늘보다 뒤인 초안은 승인 거부", () =>
  h.tx(async () => {
    await allow();
    const a = await put(series({ checked_at: "2999-01-01" }));
    assert.equal((await approve(a.id)).code, "checked_future");
  }));

test("공개 뷰 - 키 꺼짐 0행, 켜짐이면 승인·이전 기준연도만(초안·철회 0), 스냅샷·승인자 칸 없음", () =>
  h.tx(async () => {
    await allow();
    await flag(false);
    const a = await put(series({ base_year: 2022 }));
    const b = await put(series({ base_year: 2023, points: [{ period: "2023", value: 15 }] }));
    const c = await put(series({ series_key: "test_series_c", base_year: 2022 }));
    await approve(a.id);
    await approve(b.id);
    assert.equal((await anonRows()).length, 0, "키 꺼짐");
    await flag(true);
    const rows = await anonRows();
    assert.deepEqual(rows.map((r) => [r.base_year, r.status]), [[2022, "superseded"], [2023, "approved"]], "초안(c) 0");
    assert.ok(!rows.some((r) => r.id === c.id));
    const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_stats_series'")).rows.map((r) => r.column_name);
    assert.ok(!cols.includes("snapshot_id") && !cols.includes("approved_by") && !cols.includes("created_by"));
    assert.equal((await h.one("select public.stats_series_withdraw($1, $2, '') r", [b.id, ACTOR])).r.code, "reason_required");
    assert.equal((await h.one("select public.stats_series_withdraw($1, $2, '시험용 이유') r", [b.id, ACTOR])).r.ok, true);
    assert.deepEqual((await anonRows()).map((r) => r.base_year), [2022]);
    assert.equal((await h.attempt("select * from public.stats_series", [], "anon")).ok, false, "표 직접 읽기 거부");
  }));

test("기사 차트 연결 - 승인된 시계열만, 기준연도 고정, 수정 거부", () =>
  h.tx(async () => {
    await allow();
    const person = (await client.query("insert into public.people (slug, name, roles, visibility) values ($1, '시험 기자', array['reporter'], 'public') returning id", [h.uniq("p")])).rows[0];
    const art = (
      await client.query(
        "insert into public.articles (slug, title, section, content_type, status, author_id, body, first_published_at) values ($1, '시험용 기사', 'tax', 'explainer', 'published', $2, $3, now()) returning id",
        [h.uniq("art"), person.id, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 본문" }], claims: [] })],
      )
    ).rows[0];
    const a = await put(series({ base_year: 2022 }));
    const early = await h.attempt("insert into public.article_data_charts (article_id, series_id, base_year, created_by) values ($1, $2, 2000, 't')", [art.id, a.id]);
    assert.equal(early.ok, false, "초안 연결 거부");
    await approve(a.id);
    const ok = await h.attempt("insert into public.article_data_charts (article_id, series_id, base_year, created_by) values ($1, $2, 2000, 't') returning id, base_year", [art.id, a.id]);
    assert.equal(ok.ok, true);
    assert.equal(ok.rows[0].base_year, 2022, "자리값은 시험 시계열의 기준연도로 덮어쓴다");
    assert.equal((await h.attempt("update public.article_data_charts set caption = '바꿈' where id = $1", [ok.rows[0].id])).ok, false);
    assert.equal((await h.attempt("insert into public.article_data_charts (article_id, series_id, base_year, created_by) values ($1, $2, 2000, 't')", [art.id, a.id])).ok, false, "같은 쌍 중복 거부");
    await flag(true);
    const b = await put(series({ base_year: 2023, points: [{ period: "2023", value: 15 }] }));
    await approve(b.id);
    const pub = await anonRows("select series_id, base_year, newer_base_year from public.public_article_data_charts");
    assert.equal(pub.length, 1);
    assert.equal(Number(pub[0].base_year), 2022);
    assert.equal(Number(pub[0].newer_base_year), 2023, "새 기준연도 표시");
  }));

test("새 함수는 anon·authenticated 실행 불가", () =>
  h.tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await h.attempt("select public.stats_series_approve(1, 'admin:x')", [], role)).ok, false, role);
      assert.equal((await h.attempt("select public.stats_series_put('k', '{}'::jsonb, '{}'::jsonb, 'job:x')", [], role)).ok, false, role);
      assert.equal((await h.attempt("select public.stats_points_problem('[]'::jsonb)", [], role)).ok, false, role);
    }
  }));
