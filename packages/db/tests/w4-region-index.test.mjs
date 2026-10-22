// W4 11단계 DB — 지역 색인 임계값·시범 지역·색인 판정 뷰 (docs/dev/W4_설계.md 1장 11단계 · 2.2 · 3장 · 12장 #26·#81~, 마이그레이션 20261023000046, PRD-01B REG-09 · REG1-12 · 9.2)
//  · 씨앗 = 설계 2.2 (region_index_threshold 9.2 최소선 · pilot_regions PO 승인 서울·부산) · 저장 검사(트리거 — TypeScript region-index-logic.ts와 같은 견본)
//  · 권한 — anon은 pilot_regions 한 줄·public_region_index만 읽는다(임계값·region_index_status 0, 쓰기 0)
//  · region_index_status — 자체 취재 수(지자체뉴스 + 지역 태그 + 편집 분야 + 편집 승인 공개 보도기사, 보도자료 재게시 경고·보류·초안·해설·칼럼·핫뉴스·다른 지역 0) ·
//    검수 공식 자료 수(대체되지 않은 판 · 자료 종류 · 스냅샷 · 카드 칸 · 같은 원문 하나 · 비공개 기사 0) · 범위(시·도 = 자기 + 하위, 시·군·구 = 자기) ·
//    판정 경계(n-1 미달 · n 충족) · 임계값을 바꾸면 다음 읽기부터 · 유일한 보도기사 held → 미달, 되돌리면 충족 · 유일한 공식 자료를 스냅샷 없는 새 판으로 대체 → 미달 · 폐지 지역 0
//  · public_region_index — 색인 대상만 · region_hubs 꺼지면 0행 · 주소 모양
// 모든 시험은 거래 안에서 하고 되돌린다(남는 행 0). 시험용 지역은 접두 99 가짜 코드다(설계 8장).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.join(HERE, "..", "..", "..", "docs", "dev", "W4_설계.md"), "utf8");
const seedOf = (key) => {
  const l = DESIGN.split("\n").find((x) => x.startsWith(`| \`${key}\` |`));
  assert.ok(l, `설계 2.2에 '${key}' 줄이 없다`);
  return JSON.parse(l.split("|")[2].match(/`([[{][^`]+)`/)[1]);
};
const THRESHOLD = seedOf("region_index_threshold");
const PILOTS = seedOf("pilot_regions");

const SIDO = "9900000000";
const GU = "9901100000";
const GU2 = "9902100000";
const GONE = "9903100000";
const Q = "시험용 공익적 질문 — 이 지역 지방재정에 어떤 영향을 주나";
const DESK_FULL = { evidence: true, relation: true, ad_independence: true };
const REPOST = "reg1_14.press-release-repost";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

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

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

let seq = 0;
const uniq = (p) => `w4ri-${p}-${process.pid}-${++seq}`;
const insertSql = (table, row) => {
  const keys = Object.keys(row);
  return [`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k])];
};
const insert = async (table, row) => (await client.query(...insertSql(table, row))).rows[0];
const setSetting = (key, value) => attempt("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
const status = async (code) => (await client.query("select * from public.region_index_status where code = $1", [code])).rows[0];
const indexRows = async (role = null) => {
  const r = await attempt("select code, level, name, path, own_reported, official_sources from public.public_region_index where code like '99%' order by code", [], role);
  assert.ok(r.ok, r.message);
  return r.rows;
};
const hubs = (on) => client.query("update public.settings set value = jsonb_set(value, '{region_hubs}', $1::jsonb) where key = 'feature_flags'", [JSON.stringify(on)]);

/** 시험용 지역(접두 99) — 시·도 1 · 시·군·구 2 · 폐지 시·군·구 1 */
async function regions() {
  await insert("regions", { code: SIDO, level: "sido", name: "시험용 색인도", slug: uniq("do") });
  await insert("regions", { code: GU, parent_code: SIDO, level: "sigungu", name: "시험용 색인구", slug: uniq("gu") });
  await insert("regions", { code: GU2, parent_code: SIDO, level: "sigungu", name: "시험용 이웃구", slug: uniq("gu") });
  await insert("regions", { code: GONE, parent_code: SIDO, level: "sigungu", name: "시험용 폐지구", slug: uniq("gu"), valid_to: "2020-12-31", successor_code: GU });
}

const people = {};
async function staff() {
  people.reporter = await insert("people", { slug: uniq("rep"), name: "시험용 색인 기자", roles: ["reporter"], visibility: "public" });
  people.desk = await insert("people", { slug: uniq("desk"), name: "시험용 편집 책임자", roles: ["editor"] });
}

/** 공개 지역 기사 — 이관 모양(발행일을 넣은 공개 행). approve = 편집 승인 기록(desk_edit 3항목) */
async function article(over = {}, { approve = false } = {}) {
  const row = await insert("articles", {
    slug: uniq("a"),
    title: "시험용 색인 기사",
    section: "local",
    content_type: "reported_news",
    status: "published",
    author_id: people.reporter.id,
    region_codes: [GU],
    editorial_field: "local_finance",
    public_question: Q,
    first_published_at: new Date(Date.now() - 3600_000).toISOString(),
    ...over,
  });
  if (approve) {
    await client.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, checklist) values ($1, 'desk_edit', $2, 'approve', $3)", [row.id, people.desk.id, JSON.stringify(DESK_FULL)]);
  }
  return row;
}

/** 발행 검사 밖 옛 행(이관 모양 — 칼럼 동의서·폐지 지역 태그 등 새 발행 검사를 거치지 않은 공개 행). 트리거를 끈 세션으로 넣는다 */
async function legacy(over) {
  await client.query("set local session_replication_role = replica");
  try {
    return await article(over);
  } finally {
    await client.query("set local session_replication_role = origin");
  }
}

/** 공식 자료 — 카드 칸 전부 + 원본 스냅샷 (over로 빼거나 바꾼다) */
async function source(articleId, over = {}) {
  const url = over.url ?? `https://gov.example.test/w4ri/${uniq("doc")}`;
  const snap = over.snapshot === false ? null : await insert("raw_snapshots", { source: "w4ri", url, content_hash: `sha256:${uniq("h")}`, payload: "시험용 원본" });
  return insert("article_sources", {
    article_id: articleId,
    kind: over.kind ?? "official_doc",
    title: "시험용 공식 자료",
    source_url: url,
    source_name: "시험용 색인도청",
    last_verified_at: new Date(Date.now() - 86_400_000).toISOString(),
    license_status: "공공누리 제1유형",
    license_type: "kogl_1",
    source_type: over.sourceType === undefined ? "local_tax_revenue" : over.sourceType,
    published_on: "2026-09-01",
    reference_date: "2026-08-31",
    region_unit: "시·군·구",
    collected_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    snapshot_id: snap?.id ?? null,
    supersedes_id: over.supersedes ?? null,
    revision_reason: over.supersedes ? "시험용 수치 고침" : null,
  });
}

test("씨앗 — region_index_threshold = 설계 2.2(9.2 최소선) · pilot_regions = PO 승인 서울·부산(W2-b 씨앗 코드) · 마이그레이션 기록", async () => {
  assert.deepEqual(THRESHOLD, { reported_news: 1, official_sources: 1 });
  assert.deepEqual(PILOTS, ["1100000000", "2600000000"]);
  const { rows } = await client.query("select key, value, updated_by from public.settings where key in ('region_index_threshold', 'pilot_regions') order by key");
  assert.deepEqual(
    rows.map((r) => [r.key, r.value, r.updated_by]),
    [
      ["pilot_regions", PILOTS, "migration:20261023000046"],
      ["region_index_threshold", THRESHOLD, "migration:20261023000046"],
    ],
  );
  const names = (await client.query("select name from public.regions where code = any($1::text[]) order by code", [PILOTS])).rows.map((r) => r.name);
  assert.deepEqual(names, ["서울특별시", "부산광역시"]);
});

test("저장 검사 — 틀린 임계값·시범 지역은 거부(check_violation), 맞는 값은 저장 (TypeScript 검사와 같은 견본)", () =>
  tx(async () => {
    await regions();
    const badThreshold = [
      [[1, 1], /객체여야/],
      [{ reported_news: 1 }, /official_sources는 1~1000 정수/],
      [{ ...THRESHOLD, digest: 1 }, /reported_news\(자체 취재 기사\)·official_sources\(검수 공식 자료\)뿐/],
      [{ reported_news: 0, official_sources: 1 }, /reported_news는 1~1000 정수여야 합니다 — 0이면 빈 지역/],
      [{ reported_news: 1.5, official_sources: 1 }, /reported_news는 1~1000 정수/],
      [{ reported_news: "1", official_sources: 1 }, /reported_news는 1~1000 정수/],
      [{ reported_news: 1, official_sources: 1001 }, /official_sources는 1~1000 정수/],
    ];
    for (const [value, msg] of badThreshold) {
      const r = await setSetting("region_index_threshold", value);
      assert.equal(r.ok, false, JSON.stringify(value));
      assert.equal(r.code, "23514", JSON.stringify(value));
      assert.match(r.message, msg, JSON.stringify(value));
    }
    for (const value of [{ reported_news: 1000, official_sources: 3 }, THRESHOLD]) assert.equal((await setSetting("region_index_threshold", value)).ok, true, JSON.stringify(value));

    const badPilots = [
      [{ a: SIDO }, /0~20개 목록/],
      [Array.from({ length: 21 }, (_, i) => `99${String(i).padStart(2, "0")}000000`), /0~20개 목록/],
      [["990000000"], /10자리 숫자/],
      [[9900000000], /10자리 숫자/],
      [[SIDO, SIDO], /두 번/],
      [["9800000000"], /오늘 유효한 행정구역\(regions\)이 아닙니다/], // 없는 코드
      [[GONE], /오늘 유효한 행정구역/], // 폐지 지역을 새로 넣기
    ];
    for (const [value, msg] of badPilots) {
      const r = await setSetting("pilot_regions", value);
      assert.equal(r.ok, false, JSON.stringify(value));
      assert.equal(r.code, "23514", JSON.stringify(value));
      assert.match(r.message, msg, JSON.stringify(value));
    }
    for (const value of [[], [SIDO, GU], PILOTS]) assert.equal((await setSetting("pilot_regions", value)).ok, true, JSON.stringify(value));
    // 이미 있던 코드는 폐지돼도 남는다 — 넣은 뒤 폐지, 다른 코드를 더해도 저장
    assert.equal((await setSetting("pilot_regions", [GU2])).ok, true);
    await client.query("update public.regions set valid_to = '2021-01-01', successor_code = $2 where code = $1", [GU2, GU]);
    assert.equal((await setSetting("pilot_regions", [GU2, SIDO])).ok, true, "있던 폐지 코드 + 새 유효 코드");
  }));

test("권한 — anon은 pilot_regions 한 줄과 public_region_index만 읽는다 · 임계값·region_index_status 0 · 쓰기 0 · 검사 함수 실행 0", () =>
  tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      const s = await attempt("select key, value from public.settings where key in ('pilot_regions', 'region_index_threshold')", [], role);
      assert.ok(s.ok, s.message);
      assert.deepEqual(s.rows.map((r) => r.key), ["pilot_regions"], `${role} — 시범 지역 한 줄만`);
      assert.equal((await attempt("select count(*) from public.region_index_status", [], role)).ok, false, `${role} — 판정 뷰 0`);
      assert.ok((await attempt("select count(*) from public.public_region_index", [], role)).ok, `${role} — 사이트맵 원본 읽기`);
      const w = await attempt("update public.settings set value = '[]'::jsonb where key = 'pilot_regions'", [], role);
      assert.ok(!w.ok || w.rowCount === 0, `${role} — 쓰기 0`);
      assert.equal((await attempt("select public.region_index_settings_guard()", [], role)).ok, false, `${role} — 검사 함수 실행 0`);
    }
    assert.ok((await attempt("select count(*) from public.region_index_status", [], "service_role")).ok, "service_role — 판정 뷰 읽기");
  }));

test("자체 취재 수 — 지자체뉴스 + 지역 태그 + 편집 분야 + 편집 승인 공개 보도기사만 (9.2 '세지 않는다' 줄 전부 0)", () =>
  tx(async () => {
    await regions();
    await staff();
    // 센다 — 실제 단계(초안 → 편집 승인 → 승인 → 발행)를 밟은 보도기사 1 + 이관 모양 공개 보도기사(편집 승인) 1
    const staged = await article({ status: "draft", first_published_at: null });
    await client.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, checklist) values ($1, 'desk_edit', $2, 'approve', $3)", [staged.id, people.desk.id, JSON.stringify(DESK_FULL)]);
    await client.query("update public.articles set status = 'approved' where id = $1", [staged.id]);
    await client.query("update public.articles set status = 'published' where id = $1", [staged.id]);
    await article({}, { approve: true });
    // 세지 않는다
    await article({}); // 편집 승인 없음 (reported_approved = false)
    await article({ content_type: "explainer" }, { approve: true }); // 해설
    await legacy({ content_type: "opinion" }); // 칼럼 (TX-16 — 이관 모양 옛 칼럼)
    await article({ content_type: "digest", digest_id: 1 }, { approve: true }); // 금주 핫뉴스 (LG-04 — 주간 회차 번호는 시험용)
    await article({ status: "draft", first_published_at: null }, { approve: true }); // 초안
    await article({ section: "realestate" }, { approve: true }); // 지자체뉴스 밖 (허브 ②③에 없다)
    await article({ region_codes: [GU2] }, { approve: true }); // 다른 지역
    await article({ check_log: JSON.stringify({ publish: { warnings: [REPOST, "nav04.example"] } }) }, { approve: true }); // 보도자료 재게시 경고
    const held = await article({}, { approve: true });
    await client.query("update public.articles set status = 'held' where id = $1", [held.id]); // 보류(held)
    const s = await status(GU);
    assert.equal(s.own_reported, 2, "센 것 = 단계를 밟은 보도 + 편집 승인 이관 보도");
    assert.equal((await status(GU2)).own_reported, 1, "이웃구는 자기 태그만");
    assert.equal((await status(SIDO)).own_reported, 3, "시·도 = 자기 + 하위 시·군·구 태그 (12장 #26)");
    // 편집 분야 없는 보도기사는 지역 기사가 아니다 (발행 검사 밖 이관 행이어도 0)
    await legacy({ editorial_field: null, public_question: null });
    assert.equal((await status(GU)).own_reported, 2, "편집 분야 없음 0");
  }));

test("공식 자료 수 — 검수 공식 자료만(대체되지 않은 판 · 자료 종류 · 스냅샷 · 카드 칸), 같은 원문 하나, 비공개 기사 자료 0", () =>
  tx(async () => {
    await regions();
    await staff();
    const a = await article({ content_type: "explainer" });
    const col = await legacy({ content_type: "opinion", section: "tax" }); // 칼럼·다른 분야여도 지역 기사면 그 자료를 센다(⑤와 같은 범위)
    const draft = await article({ status: "draft", first_published_at: null });
    const s1 = await source(a.id);
    await source(a.id, { url: s1.source_url }); // 같은 원문 — 하나로
    await source(col.id);
    await source(a.id, { snapshot: false }); // 스냅샷 없음
    await source(a.id, { sourceType: null }); // 자료 종류 빔 (법령 인용)
    await source(a.id, { kind: "dataset" });
    const old = await source(a.id);
    await source(a.id, { supersedes: old.id, url: old.source_url }); // 옛 판(old)은 빠지고 새 판이 남는다 — 원문 같음
    await source(draft.id); // 초안 기사의 자료
    await insert("article_sources", { article_id: a.id, kind: "press_release", title: "시험용 보도자료", source_url: "https://gov.example.test/w4ri/pr", source_name: "시험용 색인도청", license_type: "kogl_1" });
    const s = await status(GU);
    assert.equal(s.official_sources, 4, "s1(같은 원문 둘) · 칼럼 자료 · dataset · 새 판 = 4");
    assert.equal(s.own_reported, 0);
    assert.equal(s.indexable, false, "자체 취재 0 — 미달");
    assert.equal((await status(SIDO)).official_sources, 4, "시·도 = 하위 태그 기사의 자료까지");
    assert.equal((await status(GU2)).official_sources, 0);
  }));

test("판정 경계 — n-1 미달 · n 충족, 임계값을 바꾸면 다음 읽기부터, 유일한 보도 held → 미달 → 되돌리면 충족, 유일한 자료를 스냅샷 없는 새 판으로 대체 → 미달", () =>
  tx(async () => {
    await regions();
    await staff();
    const r1 = await article({}, { approve: true });
    const s = await source(r1.id);
    let st = await status(GU);
    assert.deepEqual([st.own_reported, st.official_sources, st.reported_ok, st.official_ok, st.indexable, st.current], [1, 1, true, true, true, true], "1·1 = 최소선 1·1 충족");
    assert.equal(Number(st.min_reported), 1);

    // 임계값 2 — 1건이면 미달(n-1), 2건이면 충족(n)
    assert.equal((await setSetting("region_index_threshold", { reported_news: 2, official_sources: 1 })).ok, true);
    st = await status(GU);
    assert.deepEqual([st.reported_ok, st.official_ok, st.indexable], [false, true, false], "자체 취재 1 < 2 — 미달");
    await article({}, { approve: true });
    st = await status(GU);
    assert.deepEqual([st.own_reported, st.reported_ok, st.indexable], [2, true, true], "2 = 2 — 충족");
    assert.equal((await setSetting("region_index_threshold", THRESHOLD)).ok, true);

    // 유일한 보도 — 둘째를 지우고 첫째를 held → 미달, 되돌리면 충족
    await client.query("delete from public.articles where region_codes = $1::text[] and id <> $2 and content_type = 'reported_news'", [[GU], r1.id]);
    assert.equal((await status(GU)).indexable, true);
    await client.query("update public.articles set status = 'held' where id = $1", [r1.id]);
    assert.deepEqual([(await status(GU)).own_reported, (await status(GU)).indexable], [0, false], "held — 미달");
    await client.query("update public.articles set status = 'published' where id = $1", [r1.id]);
    assert.equal((await status(GU)).indexable, true, "되돌리면 충족");

    // 유일한 공식 자료 — 스냅샷 없는 새 판으로 대체(원자료 새 버전, 원본을 아직 받지 않음) → 미달
    await source(r1.id, { supersedes: s.id, url: s.source_url, snapshot: false });
    st = await status(GU);
    assert.deepEqual([st.official_sources, st.official_ok, st.indexable], [0, false, false], "검수 공식 자료 0 — 미달");

    // 임계값 설정이 없으면 미달(닫힌 쪽) — 트리거를 끈 세션으로 모양을 깨 본다
    await source(r1.id);
    assert.equal((await status(GU)).indexable, true);
    await client.query("set local session_replication_role = replica");
    await client.query("update public.settings set value = '{}'::jsonb where key = 'region_index_threshold'");
    await client.query("set local session_replication_role = origin");
    st = await status(GU);
    assert.deepEqual([st.min_reported, st.reported_ok, st.indexable], [null, false, false], "임계값 없음 — 미달");
  }));

test("public_region_index — 색인 대상만 · region_hubs 꺼지면 0행 · 주소 모양 · 폐지 지역 0 · 시범 표시는 판정과 별개", () =>
  tx(async () => {
    await regions();
    await staff();
    const r1 = await article({}, { approve: true });
    await source(r1.id);
    const gone = await legacy({ region_codes: [GONE] }); // 폐지 지역 태그(폐지 전에 단 기사 — 이관 모양)
    await client.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, checklist) values ($1, 'desk_edit', $2, 'approve', $3)", [gone.id, people.desk.id, JSON.stringify(DESK_FULL)]);
    await source(gone.id);
    await hubs(false);
    assert.deepEqual(await indexRows("anon"), [], "region_hubs 꺼짐 — 0행 (지역 허브 404)");
    await hubs(true);
    const rows = await indexRows("anon");
    const sidoSlug = (await client.query("select slug from public.regions where code = $1", [SIDO])).rows[0].slug;
    const guSlug = (await client.query("select slug from public.regions where code = $1", [GU])).rows[0].slug;
    assert.deepEqual(
      rows.map((r) => [r.code, r.level, r.path, r.own_reported, r.official_sources]),
      [
        [SIDO, "sido", `/local/${sidoSlug}`, 2, 2],
        [GU, "sigungu", `/local/${sidoSlug}/${guSlug}`, 1, 1],
      ],
      "시·도(하위 + 폐지 하위 태그) · 시·군·구 — 이웃구(0)·폐지구(오늘 유효하지 않음) 0",
    );
    const goneStatus = await status(GONE);
    assert.deepEqual([goneStatus.current, goneStatus.reported_ok, goneStatus.indexable], [false, true, false], "폐지 지역 — 수는 차도 판정 0");
    // 시범 지역 표시는 판정과 별개 — 시범이어도 미달이면 사이트맵 원본 0
    assert.equal((await setSetting("pilot_regions", [GU2, SIDO])).ok, true);
    assert.deepEqual([(await status(GU2)).pilot, (await status(GU2)).indexable, (await status(SIDO)).pilot, (await status(GU)).pilot], [true, false, true, false]);
    assert.ok(!(await indexRows("anon")).some((r) => r.code === GU2));
  }));
