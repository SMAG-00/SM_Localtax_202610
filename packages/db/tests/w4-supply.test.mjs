// W4 17단계 DB — 분양 정보 (docs/dev/W4_설계.md 1장 17단계 · 2.1 · 2.3 · 2.4 · 2.10 · 3장 · 12장 #11·#12·#140~, 마이그레이션 20261023000051 · PRD-01B PR-04 · PR-01 · PR-05)
// 지역·프로젝트·분양 정보·기사는 모두 시험용 가짜다(지역 접두 99, '시험용' 이름 — 설계 8장). 모든 시험은 트랜잭션 안에서 하고 되돌린다.
//  · 값 — supply_notice.status·article_source.kind(sponsor_material) = 2.1 = DB check · 기능 키 supply_notices 씨앗 false(2.4) · 표·공개 뷰 칸 정확 비교
//  · 분양 홍보 원고 — sponsor_material 출처가 있는 기사는 sponsored로만 발행(보도·해설·가이드·오피니언 거부) · 공개 중인 그 기사의 유형 바꾸기 거부 ·
//    공개 중인 sponsored 밖 기사에 그 출처 달기·종류 바꾸기 거부 · 대체된 옛 판은 보지 않는다(발행 서비스 판정 입력과 같다)
//  · supply_notices — 필수 칸(공식 공고 URL·공고 기관·모집공고일·청약 일정·공공누리) · 모양 · 공개 조건(확인일·공급 규모) · 지역 오늘 유효 · 금액·가격 글자 거부(웹 규칙과 같은 견본)
//  · 공개 뷰 — 기능 키 꺼짐 0행 · 공개 + 확인일만 · 청약이 끝난 항목도 남는다(프로젝트 화면 기록) · 연결 프로젝트는 공개일 때만 · 자체 취재 집계 0
//  · 권한 — anon·authenticated는 표 42501·뷰 읽기만 · 새 함수 anon 실행 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";
import { priceWordsIn } from "../scripts/check-price-fields.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.join(HERE, "..", "..", "..", "docs", "dev", "W4_설계.md"), "utf8");
const line = (prefix) => {
  const l = DESIGN.split("\n").find((x) => x.startsWith(prefix));
  assert.ok(l, `설계 문서에 '${prefix}' 줄이 없다`);
  return l;
};
const codes = (prefix, col = 2) => [...line(prefix).split("|")[col].matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** 금액·가격 표현 견본 — 웹 규칙 시험(apps/web/lib/admin/supply-rules.test.ts PRICE_TEXT_SAMPLES)과 같은 견본 */
const PRICE_TEXT_SAMPLES = [
  ["총 820세대 중 일반공급 410세대", false],
  ["시험용 하늘마을 1단지", false],
  ["3억 5,000만원", true],
  ["5,000만 원부터", true],
  ["12,000원", true],
  ["원문 3건 확인", false],
  ["원본 2부", false],
  ["분양가 공개 예정", true],
  ["시세보다 낮게", true],
  ["프리미엄 단지", true],
  ["웃돈 기대", true],
  ["수익 보장", true],
  ["가격 안내", true],
  ["전용 84㎡ 120세대", false],
  ["청약 경쟁률 12%", false],
];
const TABLE_COLUMNS = [
  "id",
  "name",
  "region_code",
  "project_id",
  "supply_scale",
  "apply_start",
  "apply_end",
  "notice_date",
  "notice_issuer",
  "official_notice_url",
  "verified_at",
  "license_type",
  "status",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at",
  "source_key", // W10-h 원천 연동 칸(마이그레이션 100)
  "source_item_id",
  "source_value_hash",
];
const VIEW_COLUMNS = ["id", "name", "region_code", "supply_scale", "apply_start", "apply_end", "notice_date", "notice_issuer", "official_notice_url", "verified_at", "license_type", "project_id", "project_slug", "project_name"];
const ACTOR = "user:w4sn-test";
const SIDO = "9900000000";
const GU = "9901100000";

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
let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const flag = (on) => client.query("update public.settings set value = value || jsonb_build_object('supply_notices', $1::boolean) where key = 'feature_flags'", [on]);
const kstToday = async () => (await one("select ((now() at time zone 'Asia/Seoul')::date)::text d")).d;
const kstDay = async (offset) => (await one("select (((now() at time zone 'Asia/Seoul')::date) + $1::int)::text d", [offset])).d;

async function seedRegions() {
  await client.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', '시험용 분양도', 'siheom-sn-do')", [SIDO]);
  await client.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', '시험용 분양구', 'siheom-sn-gu')", [GU, SIDO]);
}

const FULL = {
  name: "시험용 하늘마을 분양",
  region_code: GU,
  supply_scale: "총 820세대 중 일반공급 410세대",
  apply_start: "2026-11-02",
  apply_end: "2026-11-04",
  notice_date: "2026-10-26",
  notice_issuer: "시험용 분양구청",
  official_notice_url: "https://gasang.example/supply/1",
  license_type: "kogl_1",
  created_by: ACTOR,
  updated_by: ACTOR,
};
function insertSql(cols) {
  const keys = Object.keys(cols);
  return { sql: `insert into public.supply_notices (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, params: keys.map((k) => cols[k]) };
}
const tryNotice = (over = {}) => {
  const cols = Object.fromEntries(Object.entries({ ...FULL, ...over }).filter(([, v]) => v !== undefined));
  const { sql, params } = insertSql(cols);
  return attempt(sql, params);
};
async function notice(over = {}) {
  const r = await tryNotice(over);
  assert.ok(r.ok, r.message);
  return r.rows[0];
}
const publicNotice = (over = {}) => notice({ status: "public", verified_at: "2026-10-23T01:00:00Z", ...over });

async function article(over = {}) {
  return one("insert into public.articles (slug, title, section, content_type, label) values ($1, '시험용 분양 기사', 'realestate', $2, $3) returning *", [uniq("w4sn"), over.content_type ?? "explainer", over.label ?? "none"]);
}
const material = (articleId, over = {}) =>
  attempt("insert into public.article_sources (article_id, kind, title, source_name) values ($1, $2, '시험용 하늘마을 분양 홍보 원고', '시험용 분양대행사') returning *", [articleId, over.kind ?? "sponsor_material"]);
const publish = (id) => attempt("update public.articles set status = 'published' where id = $1 returning id", [id]);

// ─────────────────────────────────────────────────────────────
test("값 — supply_notice.status·article_source.kind = 2.1 = DB check · 기능 키 씨앗 false(2.4) · 표·공개 뷰 칸 · 가격 사전 낱말 칸 0", async () => {
  const check = async (table, column) => {
    const { rows } = await client.query(
      `select pg_get_constraintdef(c.oid) def from pg_constraint c
        where c.conrelid = $1::regclass and c.contype = 'c'
          and c.conkey = array[(select attnum from pg_attribute where attrelid = $1::regclass and attname = $2)]::smallint[]`,
      [`public.${table}`, column],
    );
    const withList = rows.filter((r) => /ARRAY\[/.test(r.def));
    assert.equal(withList.length, 1, `${table}.${column} 값 목록 제약 1개`);
    return [...withList[0].def.matchAll(/'((?:[^']|'')*)'::text/g)].map((m) => m[1]);
  };
  assert.deepEqual(await check("supply_notices", "status"), codes("| supply_notice.status |"));
  assert.deepEqual(codes("| supply_notice.status |"), ["draft", "public", "hidden"]);
  assert.deepEqual(await check("article_sources", "kind"), codes("| article_source.kind (W2-a 7개 + 17단계) |"));
  assert.equal(codes("| article_source.kind (W2-a 7개 + 17단계) |").at(-1), "sponsor_material");
  assert.deepEqual(await check("supply_notices", "license_type"), codes("| article_source.license_type · media.license_type (공공누리) |"));
  assert.ok(line("| `supply_notices` (신규) |"));
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.equal(flags.supply_notices, false, "꺼진 채로 넣는다 — 분양 광고 표시 기준 법률 검토 기록(12장 #12) 전 꺼짐");
  const cols = async (rel) => (await client.query("select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum", [`public.${rel}`])).rows.map((r) => r.attname);
  assert.deepEqual(await cols("supply_notices"), TABLE_COLUMNS);
  assert.deepEqual(await cols("public_supply_notices"), VIEW_COLUMNS);
  for (const c of [...TABLE_COLUMNS, ...VIEW_COLUMNS]) assert.deepEqual(priceWordsIn(c), [], c);
  // 3장 표 줄의 칸이 모두 있다 (설계 줄 = 최소 칸)
  for (const c of line("| `supply_notices` (51) |").split("|")[2].split("·").map((x) => x.trim())) assert.ok(TABLE_COLUMNS.includes(c), `3장 칸 ${c}`);
});

test("금액·가격 표현 식 — 견본 15 (웹 규칙 SUPPLY_PRICE_*와 같은 견본)", async () => {
  for (const [t, expected] of PRICE_TEXT_SAMPLES) {
    assert.equal((await one("select public.supply_text_has_price($1) v", [t])).v, expected, t);
  }
  assert.equal((await one("select public.supply_text_has_price(null) v")).v, false);
});

// ─────────────────────────────────────────────────────────────
test("분양 홍보 원고 — sponsor_material 출처가 있는 기사는 sponsored로만 발행 (보도·해설·가이드·오피니언 거부, 광고 표기 sponsored 받음)", () =>
  tx(async () => {
    for (const type of ["reported_news", "explainer", "guide", "opinion"]) {
      const a = await article({ content_type: type });
      assert.ok((await material(a.id)).ok, "초안에는 달 수 있다");
      const r = await publish(a.id);
      assert.equal(r.code, "23514", `${type}: ${r.message}`);
      assert.match(r.message, /분양 홍보 원고.*sponsored.*PR-04/);
      assert.match(r.message, new RegExp(`지금 유형 ${type}`));
      const scheduled = await attempt("update public.articles set status = 'scheduled', publish_at = now() + interval '1 day' where id = $1", [a.id]);
      assert.equal(scheduled.code, "23514", `${type} 예약도 거부`);
    }
    const ad = await article({ content_type: "sponsored", label: "ad" });
    assert.ok((await material(ad.id)).ok);
    assert.ok((await publish(ad.id)).ok, "광고 표기 sponsored는 발행된다");
    // 공개 중인 sponsored 기사의 유형을 보도·해설로 바꾸기 — 거부 (표기 칸은 그대로 두고 유형만 바꿔도 이 검사가 먼저)
    const flip = await attempt("update public.articles set content_type = 'explainer', label = 'none' where id = $1", [ad.id]);
    assert.equal(flip.code, "23514", flip.message);
    assert.match(flip.message, /PR-04/);
    // 홍보 원고가 없는 보도는 그대로 발행된다
    const plain = await article({ content_type: "explainer" });
    assert.ok((await publish(plain.id)).ok);
  }));

test("분양 홍보 원고 — 공개 중인 sponsored 밖 기사에 그 출처를 달거나 다른 출처를 그 종류로 바꾸면 거부 · 대체된 옛 판은 보지 않는다", () =>
  tx(async () => {
    const a = await article({ content_type: "explainer" });
    assert.ok((await publish(a.id)).ok);
    const add = await material(a.id);
    assert.equal(add.code, "23514", add.message);
    assert.match(add.message, /공개\(예약\) 중인 기사.*sponsor_material.*PR-04/);
    const other = await material(a.id, { kind: "other" });
    assert.ok(other.ok);
    const turn = await attempt("update public.article_sources set kind = 'sponsor_material' where id = $1", [other.rows[0].id]);
    assert.equal(turn.code, "23514", turn.message);
    // 공개 중인 sponsored 기사에는 단다
    const ad = await article({ content_type: "sponsored", label: "ad" });
    assert.ok((await publish(ad.id)).ok);
    assert.ok((await material(ad.id)).ok);
    // 대체된 옛 판(새 판 + 수정 사유) — 발행 서비스 판정 입력처럼 최신 판만 본다
    const b = await article({ content_type: "explainer" });
    const old = (await material(b.id)).rows[0];
    assert.ok((await attempt("insert into public.article_sources (article_id, kind, title, supersedes_id, revision_reason) values ($1, 'other', '시험용 자체 취재 메모', $2, '시험용 — 홍보 원고 대신 자체 취재로 다시 씀')", [b.id, old.id])).ok);
    assert.ok((await publish(b.id)).ok, "최신 판에 홍보 원고가 없으면 발행된다");
  }));

// ─────────────────────────────────────────────────────────────
test("supply_notices — 필수 칸(공식 공고 URL·공고 기관·모집공고일·청약 일정·공공누리·사업명) · 모양 · 저장되는 값", () =>
  tx(async () => {
    await seedRegions();
    assert.ok((await tryNotice()).ok, "빠짐없는 초안");
    assert.ok((await tryNotice({ supply_scale: undefined })).ok, "공급 규모는 초안에서 비워도 된다");
    for (const k of ["name", "region_code", "apply_start", "apply_end", "notice_date", "notice_issuer", "official_notice_url", "license_type", "created_by", "updated_by"]) {
      const r = await tryNotice({ [k]: undefined });
      assert.equal(r.ok, false, `${k} 없이 저장됐다`);
      assert.ok(["23502", "23514"].includes(r.code), `${k}: ${r.code} ${r.message}`);
    }
    for (const [label, over] of [
      ["빈 사업명", { name: " " }],
      ["121자 사업명", { name: "가".repeat(121) }],
      ["빈 공고 기관", { notice_issuer: "" }],
      ["81자 공고 기관", { notice_issuer: "가".repeat(81) }],
      ["http(s) 밖 주소", { official_notice_url: "ftp://gasang.example/x" }],
      ["공백 든 주소", { official_notice_url: "https://gasang.example/a b" }],
      ["501자 주소", { official_notice_url: `https://gasang.example/${"a".repeat(478)}` }],
      ["마감 < 시작", { apply_end: "2026-11-01" }],
      ["공공누리 목록 밖", { license_type: "kogl_5" }],
      ["상태 목록 밖", { status: "closed" }],
      ["201자 공급 규모", { supply_scale: "가".repeat(201) }],
    ]) {
      const r = await tryNotice(over);
      assert.equal(r.code, "23514", `${label}: ${r.message}`);
    }
    assert.ok((await tryNotice({ name: "가".repeat(120), apply_end: "2026-11-02" })).ok, "120자·마감 = 시작은 받는다");
    assert.equal((await tryNotice({ project_id: 987654321 })).code, "23503", "없는 프로젝트");
  }));

test("supply_notices — 공개는 확인일 + 공급 규모 (초안→공개 바꾸기도) · 지역 오늘 유효 · 금액·가격 글자 거부", () =>
  tx(async () => {
    await seedRegions();
    assert.equal((await tryNotice({ status: "public" })).code, "23514", "확인일 없이 공개");
    assert.equal((await tryNotice({ status: "public", verified_at: "2026-10-23T00:00:00Z", supply_scale: undefined })).code, "23514", "공급 규모 없이 공개");
    const n = await notice();
    assert.equal((await attempt("update public.supply_notices set status = 'public' where id = $1", [n.id])).code, "23514");
    assert.ok((await attempt("update public.supply_notices set status = 'public', verified_at = now() where id = $1", [n.id])).ok);
    assert.equal((await attempt("update public.supply_notices set verified_at = null where id = $1", [n.id])).code, "23514", "공개 중 확인일 지우기");
    // 지역 — 폐지 어제 거부 · 폐지 오늘 받음 · 시작 내일 거부 · 없는 코드 거부(트리거가 먼저)
    const yesterday = await kstDay(-1);
    const today = await kstToday();
    const tomorrow = await kstDay(1);
    await client.query("insert into public.regions (code, parent_code, level, name, slug, valid_to, successor_code) values ('9901200000', $1, 'sigungu', '시험용 폐지구', 'siheom-sn-old', $2, $3)", [SIDO, yesterday, GU]);
    await client.query("insert into public.regions (code, parent_code, level, name, slug, valid_to, successor_code) values ('9901300000', $1, 'sigungu', '시험용 오늘끝구', 'siheom-sn-today', $2, $3)", [SIDO, today, GU]);
    await client.query("insert into public.regions (code, parent_code, level, name, slug, valid_from) values ('9901400000', $1, 'sigungu', '시험용 새구', 'siheom-sn-new', $2)", [SIDO, tomorrow]);
    assert.equal((await tryNotice({ region_code: "9901200000" })).code, "23514");
    assert.ok((await tryNotice({ region_code: "9901300000" })).ok);
    assert.equal((await tryNotice({ region_code: "9901400000" })).code, "23514");
    assert.equal((await tryNotice({ region_code: "9909900000" })).code, "23514");
    assert.ok((await tryNotice({ region_code: SIDO })).ok, "시·도 지역도 받는다");
    // 금액·가격 글자 — 사업명·공급 규모·공고 기관 (고치기도)
    for (const [k, v] of [
      ["name", "시험용 하늘마을 분양가 3억"],
      ["supply_scale", "84㎡ 5억 2,000만원"],
      ["notice_issuer", "시세 안내 센터"],
    ]) {
      const r = await tryNotice({ [k]: v });
      assert.equal(r.code, "23514", `${k}: ${r.message}`);
      assert.match(r.message, /금액·가격 표현/);
    }
    assert.equal((await attempt("update public.supply_notices set name = '시험용 하늘마을 프리미엄 분양' where id = $1", [n.id])).code, "23514");
  }));

// ─────────────────────────────────────────────────────────────
test("공개 뷰 — 기능 키 꺼짐 0행 · 공개 + 확인일만(초안·내림 0) · 청약이 끝난 항목도 남는다 · 연결 프로젝트는 공개일 때만 · 칸", () =>
  tx(async () => {
    await seedRegions();
    await client.query("update public.settings set value = $1::jsonb where key = 'project_types'", [JSON.stringify({ siheom_sn: { label: "시험용 정비" } })]);
    await client.query("update public.settings set value = $1::jsonb where key = 'project_stage_lists'", [JSON.stringify({ siheom_sn: [{ key: "zone", label: "시험용 구역지정" }, { key: "done", label: "시험용 준공" }] })]);
    const p = await one("insert into public.projects (slug, name, region_code, project_type, created_by) values ($1, '시험용 하늘구역 정비', $2, 'siheom_sn', $3) returning id, slug", [uniq("siheom-sn"), GU, ACTOR]);
    const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('시험용', 'https://gasang.example/sn/p', 'sha256:w4sn', '시험용 고시') returning id");
    await client.query(
      "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', 'zone', '시험용 고시 제1호', '2026-01-10', '시험용 분양구청', 'https://gasang.example/sn/p', $2, 'kogl_1', $3)",
      [p.id, snap.id, ACTOR],
    );
    const past = await kstDay(-30);
    const pastStart = await kstDay(-33);
    const live = await publicNotice({ project_id: p.id, apply_start: await kstDay(1), apply_end: await kstDay(3) });
    const today = await publicNotice({ name: "시험용 오늘마감 분양", apply_start: await kstDay(-2), apply_end: await kstToday() });
    const closed = await publicNotice({ name: "시험용 지난 분양", project_id: p.id, apply_start: pastStart, apply_end: past });
    const draft = await notice({ name: "시험용 초안 분양", verified_at: "2026-10-23T01:00:00Z" });
    const hidden = await publicNotice({ name: "시험용 내린 분양" });
    await client.query("update public.supply_notices set status = 'hidden' where id = $1", [hidden.id]);
    const ids = async () => {
      const r = await attempt("select * from public.public_supply_notices where id = any($1::bigint[]) order by id", [[live.id, today.id, closed.id, draft.id, hidden.id]], "anon");
      assert.ok(r.ok, r.message);
      return r.rows;
    };
    await flag(false);
    assert.deepEqual(await ids(), [], "기능 키 꺼짐 0행");
    await flag(true);
    const rows = await ids();
    assert.deepEqual(rows.map((r) => Number(r.id)), [live.id, today.id, closed.id].map(Number).sort((a, b) => a - b), "공개만 — 마감 지난 항목도 남는다(프로젝트 기록)");
    assert.deepEqual(Object.keys(rows[0]), VIEW_COLUMNS);
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    assert.deepEqual([byId.get(Number(live.id)).project_id, byId.get(Number(live.id)).project_slug], [null, null], "초안 프로젝트에는 잇지 않는다");
    await client.query("update public.projects set status = 'public', source_name = '시험용 분양구청', last_verified_at = now() where id = $1", [p.id]);
    const linked = new Map((await ids()).map((r) => [Number(r.id), r]));
    assert.deepEqual([Number(linked.get(Number(live.id)).project_id), linked.get(Number(live.id)).project_slug, linked.get(Number(live.id)).project_name], [Number(p.id), p.slug, "시험용 하늘구역 정비"]);
    assert.equal(Number(linked.get(Number(closed.id)).project_id), Number(p.id), "지난 항목도 프로젝트 기록으로 이어진다");
    // 예정 목록 거르기(화면 함수와 같은 조건 — 마감일 ≥ 오늘 KST)
    const upcoming = await attempt("select id from public.public_supply_notices where id = any($1::bigint[]) and apply_end >= (now() at time zone 'Asia/Seoul')::date order by id", [[live.id, today.id, closed.id]], "anon");
    assert.deepEqual(upcoming.rows.map((r) => Number(r.id)), [live.id, today.id].map(Number).sort((a, b) => a - b), "오늘 마감 = 남음 · 지난 마감 = 빠짐");
    // 공개 중 내리기 → 다음 읽기부터 0 · 다시 끄면 0
    await client.query("update public.supply_notices set status = 'hidden' where id = $1", [live.id]);
    assert.ok(!(await ids()).some((r) => Number(r.id) === Number(live.id)));
    await flag(false);
    assert.deepEqual(await ids(), []);
  }));

test("자체 취재 집계 0 — 공개 분양 정보는 지역 색인 판정(자체 취재 수·공식 자료 수)을 바꾸지 않는다", () =>
  tx(async () => {
    await seedRegions();
    const before = await one("select own_reported, official_sources from public.region_index_status where code = $1", [GU]);
    await flag(true);
    await publicNotice();
    await publicNotice({ name: "시험용 둘째 분양" });
    assert.deepEqual(await one("select own_reported, official_sources from public.region_index_status where code = $1", [GU]), before);
  }));

test("권한 — anon·authenticated는 표 42501·뷰 읽기만(쓰기 42501) · service_role 전권 · RLS · 새 함수 anon 실행 0", () =>
  tx(async () => {
    await seedRegions();
    const n = await notice();
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await attempt("select * from public.supply_notices", [], role)).code, "42501", `${role} 표 읽기`);
      assert.equal((await attempt("insert into public.supply_notices (name) values ('x')", [], role)).code, "42501", `${role} 표 쓰기`);
      assert.ok((await attempt("select * from public.public_supply_notices", [], role)).ok, `${role} 뷰 읽기`);
      for (const priv of ["insert", "update", "delete"]) {
        assert.equal((await one("select has_table_privilege($1, 'public.public_supply_notices', $2) v", [role, priv])).v, false, `${role} 뷰 ${priv} 권한 0`);
      }
    }
    assert.ok((await attempt("update public.supply_notices set supply_scale = '총 10세대' where id = $1", [n.id], "service_role")).ok);
    assert.equal((await one("select relrowsecurity r from pg_class where oid = 'public.supply_notices'::regclass")).r, true);
    for (const fn of ["supply_text_has_price(text)", "sponsor_material_problem(public.articles)", "articles_sponsor_material_guard()", "article_sources_sponsor_material_guard()", "supply_notices_guard()"]) {
      for (const role of ["anon", "authenticated"]) {
        assert.equal((await one(`select has_function_privilege($1, 'public.${fn}', 'execute') v`, [role])).v, false, `${role} ${fn}`);
      }
    }
  }));
