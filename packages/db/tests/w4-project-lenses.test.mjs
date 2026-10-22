// W4 16단계 DB — 단계별 「지방세로 읽기」 (docs/dev/W4_설계.md 1장 16단계 · 2.1 · 2.3 · 2.10 · 3장 · 12장 #129~, 마이그레이션 20261023000050 · PRD-01B PR-08 · CORE-01)
// 사업 유형·단계 목록·지역·프로젝트·문구는 모두 시험용 가짜다(지역 접두 99, '시험용' 이름 — 설계 8장). 세무 문장·세율·금액 0. 모든 시험은 트랜잭션 안에서 하고 되돌린다.
//  · 값 — review_status = 2.1 · 링크 종류 = 2.1 · 표 칸 = 3장 줄 · 공개 뷰 칸 정확 비교 · 가격 사전 낱말 칸 0 · 가격 칸 검사가 새 표·뷰를 본다
//  · 저장 검사 — 설정 밖 유형·단계 · 유형·단계 바꾸기 · 세목 0개 · 포인트 0줄·4줄 거부, 1·3줄 저장 · 링크 0개·계산기·바깥 주소·같은 종류 · 기준일 ·
//    세액 표현(숫자 + 원) 거부('원문'은 금액 아님) · 금지 표현(감면 단정) 거부 · 숫자 + % 경고(저장됨)
//  · 서명 흐름 — 새 템플릿에 서명 0 · reviewer 아닌 서명 거부 · 서명 → reviewed · 내용을 고치면 서명 지움(rereview_needed) · 내용 + 새 서명 한 번에 거부 · 상태만 바꾸기 거부
//  · 공개 뷰(anon) — 서명 전 0행 · 서명 뒤 1행(서명자 공개 이름) · 고치면 0행 → 다시 서명하면 새 문구 · 서명자가 reviewer를 잃으면 0행 · 공개 프로젝트가 안 쓰는 유형 0행
//  · 권한 — anon은 표 42501 · 뷰는 읽기만(쓰기 권한 0) · 새 함수 anon 실행 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";
import { PRICE_WORDS, priceWordsIn, scanPriceFields } from "../scripts/check-price-fields.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.join(HERE, "..", "..", "..", "docs", "dev", "W4_설계.md"), "utf8");
const line = (prefix) => {
  const l = DESIGN.split("\n").find((x) => x.startsWith(prefix));
  assert.ok(l, `설계 문서에 '${prefix}' 줄이 없다`);
  return l;
};
const codes = (prefix, col = 2) => [...line(prefix).split("|")[col].matchAll(/`([^`]+)`/g)].map((m) => m[1]);

const TYPES = { siheom_pl: { label: "시험용 정비" }, siheom_pm: { label: "시험용 안 쓰는 유형" } };
const LISTS = {
  siheom_pl: [
    { key: "zone", label: "시험용 구역지정" },
    { key: "plan", label: "시험용 계획인가" },
    { key: "done", label: "시험용 준공" },
  ],
  siheom_pm: [
    { key: "zone", label: "시험용 다른 구역" },
    { key: "done", label: "시험용 다른 준공" },
  ],
};
const TABLE_COLUMNS = ["project_type", "stage", "lens", "drafted_by", "drafted_at", "reviewed_by", "reviewed_at", "review_status"];
const VIEW_COLUMNS = ["project_type", "stage", "stage_position", "topics", "points", "links", "base_date", "reviewed_at", "reviewer_name"];
const ACTOR = "user:w4pl-test";

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

const hashOf = (t) => `sha256:${createHash("sha256").update(t).digest("hex")}`;
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const setSetting = async (key, value) => assert.ok((await attempt("update public.settings set value = $1::jsonb where key = $2", [JSON.stringify(value), key])).ok, key);
const authUser = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
async function staffUser(role, person = null) {
  const id = await authUser();
  if (role) await client.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, $2, 'admin:test')", [id, role]);
  if (person) await client.query("insert into public.people (slug, name, roles, staff_user_id, visibility) values ($1, $2, array['reviewer'], $3, $4)", [`siheom-pl-${id.slice(0, 8)}`, person.name, id, person.visibility ?? "public"]);
  return id;
}

/** 시험용 박스 내용 — 세무 문장 0 (가짜 낱말) */
const LENS = (over = {}) => ({
  topics: ["시험용 세목"],
  points: ["시험용 포인트 첫째 줄"],
  links: [{ kind: "explainer", label: "시험용 해설", url: "/tax" }],
  base_date: "2026-01-01",
  ...over,
});
const insertLens = (type, stage, lens) =>
  attempt("insert into public.project_stage_lenses (project_type, stage, lens, drafted_by) values ($1, $2, $3::jsonb, $4) returning *", [type, stage, JSON.stringify(lens), ACTOR]);
const updateLens = (type, stage, set, params = []) => attempt(`update public.project_stage_lenses set ${set} where project_type = $1 and stage = $2 returning *`, [type, stage, ...params]);
const sign = (type, stage, userId) => updateLens(type, stage, "reviewed_by = $3", [`user:${userId}`]);

/** 시험용 지역 → 사업 유형·단계 목록 → 공개 프로젝트 1건(유형 siheom_pl) — 다른 W4 DB 시험과 같은 차례(지역 먼저, 설정 다음) */
async function seed() {
  await client.query("insert into public.regions (code, level, name, slug) values ('9900000000', 'sido', '시험용 렌즈도', 'siheom-pl-do')");
  await client.query("insert into public.regions (code, parent_code, level, name, slug) values ('9901100000', '9900000000', 'sigungu', '시험용 렌즈구', 'siheom-pl-gu')");
  await setSetting("project_types", TYPES);
  await setSetting("project_stage_lists", LISTS);
  const p = await one("insert into public.projects (slug, name, region_code, project_type, created_by) values ('siheom-pl-1', '시험용 렌즈 프로젝트', '9901100000', 'siheom_pl', $1) returning id", [ACTOR]);
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('시험용', 'https://gasang.example/pl/zone', $1, '시험용 고시') returning id", [hashOf("pl-zone")]);
  await client.query(
    "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', 'zone', '시험용 고시 제1호', '2026-02-10', '시험용 렌즈구청', 'https://gasang.example/pl/zone', $2, 'kogl_1', $3)",
    [p.id, snap.id, ACTOR],
  );
  await client.query("update public.projects set status = 'public', source_name = '시험용 렌즈구청', last_verified_at = now() where id = $1", [p.id]);
  return { projectId: Number(p.id) };
}

/** anon으로 공개 뷰 읽기 */
async function publicLenses() {
  const r = await attempt("select * from public.public_project_stage_lenses where project_type like 'siheom_p%' order by project_type, stage_position", [], "anon");
  assert.ok(r.ok, r.message);
  return r.rows;
}

test("값 — review_status = 2.1 · 링크 종류 = 2.1 · 표 칸 = 3장 · 공개 뷰 칸 · 가격 사전 칸 0 · 가격 칸 검사가 새 표·뷰를 본다", async () => {
  const statuses = codes("| project_stage_lens.review_status |");
  assert.deepEqual(statuses, ["draft", "reviewed", "rereview_needed"]);
  const check = (await one("select pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = 'public.project_stage_lenses'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%review_status = ANY%'")).d;
  assert.deepEqual([...check.matchAll(/'([^']+)'::text/g)].map((m) => m[1]), statuses);
  const kinds = codes("| project_stage_lens.link_kind");
  assert.deepEqual(kinds, ["explainer", "book", "expert"]);
  const guard = (await one("select pg_get_functiondef('public.project_stage_lenses_guard()'::regprocedure) d")).d;
  assert.ok(guard.includes(`not in (${kinds.map((k) => `'${k}'`).join(", ")})`), "트리거의 링크 종류 = 2.1");
  const row3 = line("| `project_stage_lenses` (50) |").split("|")[2];
  assert.deepEqual(row3.split("·").map((s) => s.trim().replace("drafted_by/at", "drafted_by").replace("reviewed_by/at", "reviewed_by")), ["project_type", "stage", "lens(json)", "drafted_by", "reviewed_by", "review_status"]);
  const cols = async (v) => (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [v])).rows.map((r) => r.column_name);
  assert.deepEqual(await cols("project_stage_lenses"), TABLE_COLUMNS);
  assert.deepEqual(await cols("public_project_stage_lenses"), VIEW_COLUMNS);
  assert.equal(PRICE_WORDS.length, 16);
  for (const c of [...TABLE_COLUMNS, ...VIEW_COLUMNS]) assert.deepEqual(priceWordsIn(c), [], c);
  const r = await scanPriceFields(client);
  for (const rel of ["project_stage_lenses", "public_project_stage_lenses"]) assert.ok(r.relations.includes(rel), `가격 칸 검사가 ${rel}를 본다`);
  assert.ok(!r.missingTables.includes("project_stage_lenses"));
  assert.deepEqual(r.hits, []);
  assert.equal((await one("select count(*)::int n from public.project_stage_lenses")).n, 0, "씨앗 행 0 — 문구는 편집국 초안 + 감수");
});

test("세액 표현 식 — @ltr/editorial TAX_AMOUNT와 같은 견본 (숫자 + 원 잡음 · 원문·원칙 0)", async () => {
  const samples = [
    ["시험용 300만 원", true],
    ["시험용 1,000원", true],
    ["시험용 2.5억원", true],
    ["시험용 3 천 원", true],
    ["시험용 원문 3건", false],
    ["시험용 제1원칙", false],
    ["시험용 10원리", false],
    ["시험용 2원본", false],
    ["시험용 4%", false],
  ];
  for (const [text, expected] of samples) assert.equal((await one("select public.lens_text_has_tax_amount($1) v", [text])).v, expected, text);
});

test("저장 검사 — 설정 밖 유형·단계 · 유형·단계 바꾸기 · 세목·포인트·링크·기준일 한도", () =>
  tx(async () => {
    await seed();
    const outType = await insertLens("siheom_zz", "zone", LENS());
    assert.equal(outType.ok, false);
    assert.match(outType.message, /사업 유형 siheom_zz가 project_types에 없습니다/);
    const outStage = await insertLens("siheom_pl", "build", LENS());
    assert.equal(outStage.ok, false);
    assert.match(outStage.message, /단계 build는 사업 유형 siheom_pl의 단계 목록/);

    // 포인트 0줄·4줄 거부, 1·3줄 저장 (CORE-01)
    for (const n of [0, 4]) {
      const r = await insertLens("siheom_pl", "zone", LENS({ points: Array.from({ length: n }, (_, i) => `시험용 포인트 ${i + 1}`) }));
      assert.equal(r.ok, false, `${n}줄`);
      assert.match(r.message, n === 0 ? /핵심 포인트는 1~3줄입니다 \(지금 0줄\)/ : /핵심 포인트는 1~3줄입니다 \(지금 4줄\)/);
    }
    const one1 = await insertLens("siheom_pl", "zone", LENS());
    assert.ok(one1.ok, one1.message);
    assert.equal(one1.rows[0].review_status, "draft");
    const three = await insertLens("siheom_pl", "plan", LENS({ points: ["시험용 하나", "시험용 둘", "시험용 셋"] }));
    assert.ok(three.ok, three.message);
    const blank = await updateLens("siheom_pl", "plan", "lens = $3::jsonb", [JSON.stringify(LENS({ points: ["시험용 하나", " "] }))]);
    assert.equal(blank.ok, false);
    assert.match(blank.message, /1~120자 글자입니다 \(빈 줄 0\)/);
    const long = await updateLens("siheom_pl", "plan", "lens = $3::jsonb", [JSON.stringify(LENS({ points: ["가".repeat(121)] }))]);
    assert.equal(long.ok, false, "121자");
    assert.ok((await updateLens("siheom_pl", "plan", "lens = $3::jsonb", [JSON.stringify(LENS({ points: ["가".repeat(120)] }))])).ok, "120자 저장");

    // 세목 0개·6개·같은 세목 거부
    for (const [topics, msg] of [
      [[], /관련 세목은 1~5개입니다/],
      [["가", "나", "다", "라", "마", "바"], /관련 세목은 1~5개입니다/],
      [["시험용 세목", "시험용 세목"], /관련 세목 시험용 세목가 두 번 있습니다/],
      [["가".repeat(21)], /관련 세목은 1~20자 글자입니다/],
    ]) {
      const r = await updateLens("siheom_pl", "zone", "lens = $3::jsonb", [JSON.stringify(LENS({ topics }))]);
      assert.equal(r.ok, false, JSON.stringify(topics));
      assert.match(r.message, msg);
    }
    // 링크 0개 · 계산기 종류 · 바깥 주소 · // 주소 · 조각 · 같은 종류 두 번 · 4개
    for (const [links, msg] of [
      [[], /링크는 1~3개입니다 \(링크 0개 저장 거부\)/],
      [[{ kind: "calculator", label: "시험용 계산기", url: "/calc" }], /계산기는 SM 취득세 카드가 붙습니다/],
      [[{ kind: "explainer", label: "시험용 해설", url: "https://gasang.example/x" }], /사이트 안 주소/],
      [[{ kind: "explainer", label: "시험용 해설", url: "//gasang.example/x" }], /사이트 안 주소/],
      [[{ kind: "explainer", label: "시험용 해설", url: "/tax#a" }], /사이트 안 주소/],
      [[{ kind: "explainer", label: "", url: "/tax" }], /label: 1~40자/],
      [[{ kind: "explainer", label: "시험용 해설", url: "/tax", extra: 1 }], /링크는 \{ kind/],
      [
        [
          { kind: "explainer", label: "시험용 해설 1", url: "/tax" },
          { kind: "explainer", label: "시험용 해설 2", url: "/tax/columns" },
        ],
        /링크 종류 explainer가 두 번 있습니다/,
      ],
    ]) {
      const r = await updateLens("siheom_pl", "zone", "lens = $3::jsonb", [JSON.stringify(LENS({ links }))]);
      assert.equal(r.ok, false, JSON.stringify(links));
      assert.match(r.message, msg);
    }
    const threeLinks = LENS({
      links: [
        { kind: "explainer", label: "시험용 해설", url: "/tax" },
        { kind: "book", label: "시험용 도서", url: "/store/siheom" },
        { kind: "expert", label: "시험용 전문가", url: "/experts?field=siheom" },
      ],
    });
    assert.ok((await updateLens("siheom_pl", "zone", "lens = $3::jsonb", [JSON.stringify(threeLinks)])).ok, "해설·도서·전문가 3개(쿼리 있는 전문가 주소) 저장");
    // 기준일 · 모르는 칸
    for (const [lens, msg] of [
      [LENS({ base_date: "" }), /법령 기준일\(base_date, YYYY-MM-DD\)이 필요합니다/],
      [LENS({ base_date: "2026-02-30" }), /법령 기준일이 날짜가 아닙니다/],
      [{ ...LENS(), skip_reason: "시험용" }, /네 칸입니다/],
    ]) {
      const r = await updateLens("siheom_pl", "zone", "lens = $3::jsonb", [JSON.stringify(lens)]);
      assert.equal(r.ok, false);
      assert.match(r.message, msg);
    }
    // 유형·단계 바꾸기 거부
    const moved = await updateLens("siheom_pl", "zone", "stage = 'done'");
    assert.equal(moved.ok, false);
    assert.match(moved.message, /사업 유형·단계\(siheom_pl · zone\)는 바꿀 수 없습니다/);
  }));

test("저장 검사 — 세액 표현(숫자 + 원) 거부 · 금지 표현(감면 단정) 거부 · 숫자 + % 저장 경고", () =>
  tx(async () => {
    await seed();
    for (const lens of [LENS({ points: ["시험용 세액은 300만 원입니다"] }), LENS({ topics: ["시험용 1,000원"] }), LENS({ links: [{ kind: "explainer", label: "시험용 2억원 해설", url: "/tax" }] })]) {
      const r = await insertLens("siheom_pl", "zone", lens);
      assert.equal(r.ok, false, JSON.stringify(lens));
      assert.match(r.message, /세액을 쓰지 않습니다 — 숫자 \+ 원 표현을 빼 주세요 \(CORE-01\)/);
    }
    assert.ok((await insertLens("siheom_pl", "zone", LENS({ points: ["시험용 원문 3건을 확인합니다"] }))).ok, "원문은 금액이 아니다");
    const phrases = (await one("select value -> 'phrases' p from public.settings where key = 'forbidden_phrases'")).p;
    const phrase = phrases.find((p) => p === "절세 보장");
    assert.ok(phrase, "금지 표현 사전에 감면 단정 표현이 있다");
    const banned = await updateLens("siheom_pl", "zone", "lens = $3::jsonb", [JSON.stringify(LENS({ points: [`시험용  ${phrase.replace(" ", "   ")} 문장`] }))]);
    assert.equal(banned.ok, false);
    assert.match(banned.message, /금지 표현 '절세 보장' — 감면 해당 여부를 단정하지 않습니다/);
    // 숫자 + % — 저장되고 경고(차단 아님 — PR-05)
    const notices = [];
    const onNotice = (n) => notices.push(n);
    client.on("notice", onNotice);
    try {
      const pct = await updateLens("siheom_pl", "zone", "lens = $3::jsonb", [JSON.stringify(LENS({ points: ["시험용 비율 4% 확인"] }))]);
      assert.ok(pct.ok, pct.message);
    } finally {
      client.off("notice", onNotice);
    }
    assert.deepEqual(
      notices.map((n) => [n.severity, n.message]),
      [["WARNING", "「지방세로 읽기」(siheom_pl · zone)에 숫자와 % 표현이 있습니다 — 저장은 됩니다. 세율·비율은 감수된 기사에서만 씁니다 (PR-05)"]],
    );
  }));

test("서명 흐름 — 새 템플릿 서명 0 · reviewer 아닌 서명 거부 · 서명 · 고치면 서명 지움 · 내용 + 새 서명 한 번에 거부 · 상태만 바꾸기 거부", () =>
  tx(async () => {
    await seed();
    const reviewer = await staffUser("reviewer", { name: "시험용 감수위원" });
    const editor = await staffUser("editor");
    const preSigned = await attempt("insert into public.project_stage_lenses (project_type, stage, lens, drafted_by, reviewed_by, reviewed_at, review_status) values ('siheom_pl', 'zone', $1::jsonb, $2, $3, now(), 'reviewed')", [
      JSON.stringify(LENS()),
      ACTOR,
      `user:${reviewer}`,
    ]);
    assert.equal(preSigned.ok, false);
    assert.match(preSigned.message, /서명은 저장된 초안에만 합니다/);
    assert.ok((await insertLens("siheom_pl", "zone", LENS())).ok);
    const byEditor = await sign("siheom_pl", "zone", editor);
    assert.equal(byEditor.ok, false);
    assert.match(byEditor.message, /감수 서명은 세무 감수위원\(reviewer\)만 합니다/);
    const badFormat = await updateLens("siheom_pl", "zone", "reviewed_by = 'people:1'");
    assert.equal(badFormat.ok, false);
    const signed = await sign("siheom_pl", "zone", reviewer);
    assert.ok(signed.ok, signed.message);
    assert.equal(signed.rows[0].review_status, "reviewed");
    assert.equal(signed.rows[0].reviewed_by, `user:${reviewer}`);
    assert.ok(signed.rows[0].reviewed_at instanceof Date);
    // 같은 내용 쓰기 — 서명 그대로
    const same = await updateLens("siheom_pl", "zone", "lens = $3::jsonb, drafted_by = 'user:w4pl-other'", [JSON.stringify(LENS())]);
    assert.ok(same.ok);
    assert.equal(same.rows[0].review_status, "reviewed", "내용이 같으면 서명이 남는다");
    // 고치면 서명 지움 → rereview_needed
    const edited = await updateLens("siheom_pl", "zone", "lens = $3::jsonb", [JSON.stringify(LENS({ points: ["시험용 고친 포인트"] }))]);
    assert.ok(edited.ok, edited.message);
    assert.deepEqual([edited.rows[0].review_status, edited.rows[0].reviewed_by, edited.rows[0].reviewed_at], ["rereview_needed", null, null]);
    // 고친 뒤 또 고쳐도 rereview_needed
    const again = await updateLens("siheom_pl", "zone", "lens = $3::jsonb", [JSON.stringify(LENS({ points: ["시험용 또 고친 포인트"] }))]);
    assert.equal(again.rows[0].review_status, "rereview_needed");
    // 내용 + 새 서명 한 번에 거부
    const both = await updateLens("siheom_pl", "zone", "lens = $3::jsonb, reviewed_by = $4", [JSON.stringify(LENS({ points: ["시험용 몰래 고침"] })), `user:${reviewer}`]);
    assert.equal(both.ok, false);
    assert.match(both.message, /서명은 저장된 내용에만 합니다/);
    // 상태만 바꾸기 거부
    for (const set of ["review_status = 'draft'", "review_status = 'reviewed'"]) {
      const r = await updateLens("siheom_pl", "zone", set);
      assert.equal(r.ok, false, set);
    }
    const resigned = await sign("siheom_pl", "zone", reviewer);
    assert.equal(resigned.rows[0].review_status, "reviewed");
    // 서명 지우기만(내용 그대로) 거부
    const unsign = await updateLens("siheom_pl", "zone", "reviewed_by = null, reviewed_at = null, review_status = 'draft'");
    assert.equal(unsign.ok, false);
    assert.match(unsign.message, /감수 상태는 서명으로만 바뀝니다/);
    // 서명 전 초안을 고치면 draft 그대로
    assert.ok((await insertLens("siheom_pl", "plan", LENS())).ok);
    const draftEdit = await updateLens("siheom_pl", "plan", "lens = $3::jsonb", [JSON.stringify(LENS({ points: ["시험용 초안 고침"] }))]);
    assert.equal(draftEdit.rows[0].review_status, "draft");
  }));

test("공개 뷰(anon) — 서명 전 0 · 서명 뒤 1행 + 서명자 공개 이름 · 고치면 0 → 다시 서명하면 새 문구 · reviewer를 잃으면 0 · 안 쓰는 유형 0", () =>
  tx(async () => {
    await seed();
    const reviewer = await staffUser("reviewer", { name: "시험용 감수위원" });
    const hiddenPerson = await staffUser("reviewer", { name: "시험용 비공개 감수위원", visibility: "hidden" });
    assert.ok((await insertLens("siheom_pl", "zone", LENS({ topics: ["시험용 세목 가", "시험용 세목 나"], points: ["시험용 첫 줄", "시험용 둘째 줄"] }))).ok);
    assert.ok((await insertLens("siheom_pl", "plan", LENS())).ok);
    assert.ok((await insertLens("siheom_pm", "zone", LENS())).ok);
    assert.deepEqual(await publicLenses(), [], "서명 전 0행");

    await sign("siheom_pl", "zone", reviewer);
    await sign("siheom_pm", "zone", reviewer);
    let rows = await publicLenses();
    assert.equal(rows.length, 1, "공개 프로젝트가 쓰는 유형의 서명된 템플릿만 (siheom_pm 0)");
    const r = rows[0];
    assert.deepEqual(Object.keys(r), VIEW_COLUMNS);
    assert.deepEqual([r.project_type, r.stage, r.stage_position], ["siheom_pl", "zone", 1]);
    assert.deepEqual(r.topics, ["시험용 세목 가", "시험용 세목 나"], "세목 차례 그대로");
    assert.deepEqual(r.points, ["시험용 첫 줄", "시험용 둘째 줄"]);
    assert.deepEqual(r.links, [{ kind: "explainer", label: "시험용 해설", url: "/tax" }]);
    assert.equal(r.reviewer_name, "시험용 감수위원");
    assert.ok(r.reviewed_at instanceof Date);

    // 비공개 인물의 서명 — 행은 있고 이름은 null (웹이 박스를 그리지 않는다 — BR-03)
    await sign("siheom_pl", "plan", hiddenPerson);
    rows = await publicLenses();
    assert.deepEqual(
      rows.map((x) => [x.stage, x.reviewer_name]),
      [
        ["zone", "시험용 감수위원"],
        ["plan", null],
      ],
    );

    // 고치면 다음 읽기부터 0 → 다시 서명하면 새 문구
    await updateLens("siheom_pl", "zone", "lens = $3::jsonb", [JSON.stringify(LENS({ points: ["시험용 새 문구"] }))]);
    assert.deepEqual((await publicLenses()).map((x) => x.stage), ["plan"]);
    await sign("siheom_pl", "zone", reviewer);
    assert.deepEqual((await publicLenses()).find((x) => x.stage === "zone").points, ["시험용 새 문구"]);

    // 서명자가 reviewer를 잃으면 0
    await client.query("delete from public.staff_roles where user_id = $1 and role = 'reviewer'", [reviewer]);
    assert.deepEqual((await publicLenses()).map((x) => x.stage), ["plan"]);
    await client.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, 'reviewer', 'admin:test')", [reviewer]);
    assert.deepEqual((await publicLenses()).map((x) => x.stage), ["zone", "plan"]);

    // 프로젝트를 내리면 그 유형의 템플릿도 0
    await client.query("update public.projects set status = 'hidden' where slug = 'siheom-pl-1'");
    assert.deepEqual(await publicLenses(), []);
  }));

test("권한 — anon·authenticated 표 42501 · 뷰 읽기만(쓰기 권한 0) · 새 함수 anon 실행 0", () =>
  tx(async () => {
    await seed();
    for (const role of ["anon", "authenticated"]) {
      const read = await attempt("select * from public.project_stage_lenses", [], role);
      assert.equal(read.code, "42501", `${role} 표 읽기`);
      const write = await attempt("insert into public.project_stage_lenses (project_type, stage, lens, drafted_by) values ('siheom_pl', 'zone', '{}'::jsonb, 'x')", [], role);
      assert.equal(write.code, "42501", `${role} 표 쓰기`);
      const view = await one("select has_table_privilege($1, 'public.public_project_stage_lenses', 'select') r, has_table_privilege($1, 'public.public_project_stage_lenses', 'insert, update, delete') w", [role]);
      assert.deepEqual([view.r, view.w], [true, false], `${role} 뷰 — 읽기만, 쓰기 권한 0`);
    }
    for (const fn of ["lens_text_has_tax_amount(text)", "project_stage_lenses_guard()"]) {
      const r = await one(`select has_function_privilege('anon', 'public.${fn}', 'execute') a, has_function_privilege('authenticated', 'public.${fn}', 'execute') b`);
      assert.deepEqual([r.a, r.b], [false, false], fn);
    }
  }));
