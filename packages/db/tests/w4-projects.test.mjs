// W4 12단계 DB — 프로젝트 트래커 (docs/dev/W4_설계.md 1장 12단계 · 2.1 · 2.2 · 3장 · 12장 #10, 마이그레이션 20261023000047 · PRD-01B PR-02 · PR-03 · PR-05)
// 사업 유형·단계 목록·지역·프로젝트·고시는 모두 시험용 가짜다(지역 접두 99, '시험용' 이름 — 설계 8장). 모든 시험은 트랜잭션 안에서 하고 되돌린다.
//  · 값 목록 — project.status·project_event.kind·공공누리 유형 = 설계 2.1 글자(DB check), 설정 씨앗 project_types·project_stage_lists = 2.2({})
//  · 설정 저장 검사 — 모양 · 단계 목록의 유형은 project_types에 · 쓰는 유형·단계는 빼지 못함(글자·순서는 바꿈)
//  · 프로젝트 — 단계 목록 없는 유형 거부 · 지역 코드는 오늘(KST) 유효한 regions만(폐지 어제·시작 내일 거부, 폐지 오늘 받음) · 단계 기록이 있으면 유형 못 바꿈
//  · 단계 기록 — 목록 밖 단계 거부 · 고시 번호·고시일·고시 기관·원문 URL·스냅샷·공공누리 유형 하나라도 없으면 거부 · 같은 단계·앞 순서 거부 ·
//    해당 없음은 사유 필수 · 정정은 사유 필수·한 번만·같은 프로젝트만 · 추가만(고치기·지우기·비우기 거부)
//  · 현재 단계 = 가장 늦은 순서의 공개 기록(비공개·정정된 기록 빼고) · 단계 목록 순서를 바꾸면 다음 읽기부터
//  · 공개 — 공개 단계 0건·데이터 출처·확인일 없으면 거부 · 메모의 숫자 + 원·% → 저장 경고(저장은 된다)
//  · 원문 해시 바뀜 → 검수 큐 1건(project_event) + 공개 단계 `검토 중` · 같은 해시 0 · 같은 주소의 기사 공식 자료도 함께 · 대상 검사
//  · 권한 — anon은 표·현재 단계 뷰 거부, 공개 뷰는 공개 프로젝트의 공개 칸만
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.join(HERE, "..", "..", "..", "docs", "dev", "W4_설계.md"), "utf8");
const line = (prefix) => {
  const l = DESIGN.split("\n").find((x) => x.startsWith(prefix));
  assert.ok(l, `설계 문서에 '${prefix}' 줄이 없다`);
  return l;
};
const codes = (prefix, col = 2) => [...line(prefix).split("|")[col].matchAll(/`([^`]+)`/g)].map((m) => m[1]);

// 시험용 사업 유형·단계 목록 (가짜 — 실제 목록은 편집국 초안 + 감수 뒤 설정에 넣는다)
const TYPES = { siheom_redev: { label: "시험용 재개발" }, siheom_small: { label: "시험용 소규모" } };
const LISTS = {
  siheom_redev: [
    { key: "zone", label: "시험용 구역지정" },
    { key: "plan", label: "시험용 계획인가" },
    { key: "build", label: "시험용 착공" },
    { key: "done", label: "시험용 준공" },
  ],
  siheom_small: [
    { key: "zone", label: "시험용 구역지정" },
    { key: "done", label: "시험용 준공" },
  ],
};
const URL_A = "https://gasang.example/notice/siheom-1";
const ACTOR = "user:w4pr-test";
const PUBLIC_PROJECT_COLUMNS = [
  "id",
  "slug",
  "name",
  "region_code",
  "project_type",
  "project_type_label",
  "landmark",
  "summary",
  "source_name",
  "last_verified_at",
  "current_stage",
  "current_stage_label",
  "current_stage_position",
  "current_stage_notice_date",
];
const PUBLIC_EVENT_COLUMNS = [
  "id",
  "project_id",
  "kind",
  "stage",
  "stage_label",
  "stage_position",
  "notice_no",
  "notice_date",
  "issuer",
  "source_url",
  "license_type",
  "verified_at",
  "under_review",
  "recorded_at",
];

let client;
const notices = [];
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
  client.on("notice", (n) => notices.push(n));
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
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const hashOf = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const insertRow = async (table, row) => {
  const keys = Object.keys(row);
  return (await client.query(`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]))).rows[0];
};
const tryInsert = (table, row) => {
  const keys = Object.keys(row);
  return attempt(`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]));
};
const setSetting = (key, value) => attempt("update public.settings set value = $1::jsonb where key = $2", [JSON.stringify(value), key]);

/** 시험용 사업 유형·단계 목록 넣기 (유형 먼저) */
async function seedLists(types = TYPES, lists = LISTS) {
  assert.ok((await setSetting("project_types", types)).ok);
  const r = await setSetting("project_stage_lists", lists);
  assert.ok(r.ok, r.message);
}

/** 시험용 행정구역 — 시·도 1 + 시·군·구 3(오늘 유효 · 어제 폐지 · 내일 시작) + 오늘 폐지 */
async function seedRegions() {
  await client.query("insert into public.regions (code, level, name, slug) values ('9900000000', 'sido', '시험용 프로젝트도', 'siheom-pr-do')");
  await client.query(
    `insert into public.regions (code, parent_code, level, name, slug, valid_from, valid_to) values
       ('9901100000', '9900000000', 'sigungu', '시험용 가상구', 'siheom-gasang-gu', null, null),
       ('9901200000', '9900000000', 'sigungu', '시험용 폐지구', 'siheom-pyeji-gu', null, (now() at time zone 'Asia/Seoul')::date - 1),
       ('9901300000', '9900000000', 'sigungu', '시험용 새구', 'siheom-sae-gu', (now() at time zone 'Asia/Seoul')::date + 1, null),
       ('9901400000', '9900000000', 'sigungu', '시험용 오늘폐지구', 'siheom-oneul-gu', null, (now() at time zone 'Asia/Seoul')::date)`,
  );
}

const project = (over = {}) =>
  insertRow("projects", { slug: uniq("siheom-pr"), name: "시험용 가상구역 재개발", region_code: "9901100000", project_type: "siheom_redev", created_by: ACTOR, ...over });

const snapshot = (url, text) => insertRow("raw_snapshots", { source: "시험용", url, content_hash: hashOf(text), payload: text });

/** 단계 기록 한 건 — 증거 칸이 모두 찬 모양(가짜 고시) */
const eventRow = (projectId, snapId, over = {}) => ({
  project_id: projectId,
  kind: "stage",
  stage: "zone",
  notice_no: "시험용 고시 제2026-1호",
  notice_date: "2026-01-15",
  issuer: "시험용 가상구청",
  source_url: URL_A,
  snapshot_id: snapId,
  license_type: "kogl_1",
  recorded_by: ACTOR,
  ...over,
});

const currentOf = async (projectId) => (await one("select current_stage from public.project_current_stages where project_id = $1", [projectId]))?.current_stage ?? null;

const checkValues = async (table, constraint) => {
  const def = (await client.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and conname = $2", [`public.${table}`, constraint])).rows[0]?.d ?? "";
  return [...def.matchAll(/'([a-z_0-9]+)'::text/g)].map((m) => m[1]);
};

test("값 목록 — project.status 3종·project_event.kind 3종·공공누리 6종 = 설계 2.1(DB check), 설정 씨앗 = 2.2 빈 값", async () => {
  assert.deepEqual(codes("| project.status |"), ["draft", "public", "hidden"]);
  assert.deepEqual(codes("| project_event.kind |"), ["stage", "not_applicable", "correction"]);
  assert.deepEqual(await checkValues("projects", "projects_status_check"), codes("| project.status |"));
  assert.deepEqual(await checkValues("project_events", "project_events_kind_check"), codes("| project_event.kind |"));
  assert.deepEqual(await checkValues("project_events", "project_events_license_type_check"), codes("| article_source.license_type · media.license_type (공공누리) |"));
  const seed = codes("| `project_types` · `project_stage_lists` |");
  assert.deepEqual(seed.map((s) => JSON.parse(s)), [{}]);
  const rows = (await client.query("select key, value, updated_by from public.settings where key in ('project_types', 'project_stage_lists') order by key")).rows;
  assert.deepEqual(
    rows.map((r) => [r.key, r.value]),
    [
      ["project_stage_lists", {}],
      ["project_types", {}],
    ],
    "씨앗은 빈 값 — 실제 목록은 편집국 초안 + 감수 뒤(12장 #10)",
  );
});

test("설정 저장 검사 — 모양 거부 10종 · 단계 목록의 유형은 project_types에 · 시험용 목록 저장", () =>
  tx(async () => {
    const badTypes = [
      [[], /객체/],
      [{ Bad: { label: "시험용" } }, /영문 소문자/],
      [{ a: { label: "시험용" } }, /2~40자/],
      [{ siheom_a: "시험용" }, /label/],
      [{ siheom_a: { label: "" } }, /label/],
      [{ siheom_a: { label: "가".repeat(41) } }, /label/],
      [{ siheom_a: { label: "시험용", sort: 1 } }, /label/],
      [{ siheom_a: { label: "시험용" }, siheom_b: { label: "시험용" } }, /두 번/],
    ];
    for (const [value, re] of badTypes) {
      const r = await setSetting("project_types", value);
      assert.equal(r.code, "23514", JSON.stringify(value));
      assert.match(r.message, re, JSON.stringify(value));
    }
    assert.match((await setSetting("project_types", Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`siheom_${i}`, { label: `시험용 ${i}` }])))).message, /30개/);

    // 유형이 없는데 단계 목록 → 거부
    assert.match((await setSetting("project_stage_lists", { siheom_redev: LISTS.siheom_redev })).message, /project_types에 없습니다/);
    assert.ok((await setSetting("project_types", TYPES)).ok);
    const badLists = [
      [{ siheom_redev: [{ key: "zone", label: "시험용 구역지정" }] }, /2~40단계/],
      [{ siheom_redev: { zone: "시험용" } }, /2~40단계/],
      [{ siheom_redev: Array.from({ length: 41 }, (_, i) => ({ key: `s_${i}`, label: `시험용 ${i}` })) }, /2~40단계/],
      [{ siheom_redev: [{ key: "zone", label: "시험용 1" }, { key: "zone", label: "시험용 2" }] }, /단계 키 zone가 두 번/],
      [{ siheom_redev: [{ key: "zone", label: "시험용" }, { key: "done", label: "시험용" }] }, /단계 글자/],
      [{ siheom_redev: [{ key: "Zone", label: "시험용 1" }, { key: "done", label: "시험용 2" }] }, /단계는/],
      [{ siheom_redev: [{ key: "zone" }, { key: "done", label: "시험용 2" }] }, /단계는/],
      [{ siheom_redev: [{ key: "zone", label: "시험용 1", date: "x" }, { key: "done", label: "시험용 2" }] }, /단계는/],
    ];
    for (const [value, re] of badLists) {
      const r = await setSetting("project_stage_lists", value);
      assert.equal(r.code, "23514", JSON.stringify(value));
      assert.match(r.message, re, JSON.stringify(value));
    }
    assert.ok((await setSetting("project_stage_lists", LISTS)).ok, "시험용 목록 저장");
    // 단계 목록이 있는 유형은 project_types에서 먼저 빼지 못한다
    assert.match((await setSetting("project_types", { siheom_redev: TYPES.siheom_redev })).message, /단계 목록이 있는 사업 유형 siheom_small/);
    assert.ok((await setSetting("project_stage_lists", { siheom_redev: LISTS.siheom_redev })).ok);
    assert.ok((await setSetting("project_types", { siheom_redev: TYPES.siheom_redev })).ok, "목록을 먼저 빼면 유형도 뺀다");
  }));

test("프로젝트 — 단계 목록 없는 유형 거부 · 지역 코드는 오늘(KST) 유효한 행정구역만 · 단계 기록이 생기면 유형을 못 바꾼다", () =>
  tx(async () => {
    await seedRegions();
    // 씨앗(빈 값) 그대로면 어떤 유형도 만들 수 없다
    const empty = await tryInsert("projects", { slug: uniq("siheom-pr"), name: "시험용", region_code: "9901100000", project_type: "siheom_redev", created_by: ACTOR });
    assert.equal(empty.code, "23514");
    assert.match(empty.message, /단계 목록이 없습니다/);
    await seedLists();
    assert.match((await tryInsert("projects", { slug: uniq("siheom-pr"), name: "시험용", region_code: "9901100000", project_type: "siheom_none", created_by: ACTOR })).message, /단계 목록이 없습니다/);

    for (const [code, label] of [
      ["9901200000", "어제 폐지"],
      ["9901300000", "내일 시작"],
      ["9909900000", "없는 코드"],
    ]) {
      const r = await tryInsert("projects", { slug: uniq("siheom-pr"), name: "시험용", region_code: code, project_type: "siheom_redev", created_by: ACTOR });
      assert.equal(r.ok, false, label);
      assert.match(r.message, /오늘 유효한 행정구역/, label);
    }
    assert.ok(await project({ region_code: "9901400000" }), "오늘 폐지 = 오늘은 아직 유효");
    const sido = await project({ region_code: "9900000000" });
    assert.equal(sido.region_code, "9900000000", "시·도 단위 프로젝트도 받는다");

    const p = await project();
    assert.equal(p.status, "draft");
    assert.equal(p.landmark, false);
    assert.match((await attempt("update public.projects set region_code = '9901200000' where id = $1", [p.id])).message, /오늘 유효한 행정구역/, "폐지 지역으로 옮기기 거부");
    assert.ok((await attempt("update public.projects set project_type = 'siheom_small' where id = $1", [p.id])).ok, "기록 전에는 유형을 바꾼다");
    assert.ok((await attempt("update public.projects set project_type = 'siheom_redev' where id = $1", [p.id])).ok);
    const snap = await snapshot(URL_A, "시험용 고시 원문 1");
    await insertRow("project_events", eventRow(p.id, snap.id));
    assert.match((await attempt("update public.projects set project_type = 'siheom_small' where id = $1", [p.id])).message, /사업 유형을 바꿀 수 없습니다/);
    assert.ok((await attempt("update public.projects set summary = '시험용 요약', landmark = true where id = $1", [p.id])).ok, "다른 칸은 고친다");

    // 쓰고 있는 유형·단계는 설정에서 빼지 못한다 (글자·순서는 바꾼다)
    assert.match((await setSetting("project_stage_lists", { siheom_small: LISTS.siheom_small })).message, /쓰고 있는 사업 유형 siheom_redev/);
    assert.match(
      (await setSetting("project_stage_lists", { ...LISTS, siheom_redev: LISTS.siheom_redev.filter((s) => s.key !== "zone") })).message,
      /단계 기록이 쓰고 있는 단계\(siheom_redev · zone\)/,
    );
    const relabeled = LISTS.siheom_redev.map((s) => (s.key === "zone" ? { ...s, label: "시험용 정비구역 지정" } : s));
    assert.ok((await setSetting("project_stage_lists", { ...LISTS, siheom_redev: relabeled })).ok, "글자는 바꾼다");
    assert.match((await setSetting("project_types", { siheom_small: TYPES.siheom_small })).message, /뺄 수 없습니다/);
  }));

test("단계 기록 — 고시 번호·고시일·고시 기관·원문 URL·스냅샷·공공누리 유형 중 하나라도 없으면 거부, 목록 밖 단계 거부", () =>
  tx(async () => {
    await seedRegions();
    await seedLists();
    const p = await project();
    const snap = await snapshot(URL_A, "시험용 고시 원문 1");
    for (const [label, over] of [
      ["고시 번호", { notice_no: null }],
      ["고시 번호 빈칸", { notice_no: "  " }],
      ["고시일", { notice_date: null }],
      ["고시 기관", { issuer: "" }],
      ["원문 URL", { source_url: null }],
      ["원문 URL 모양", { source_url: "gasang.example/notice" }],
      ["스냅샷", { snapshot_id: null }],
      ["공공누리 유형", { license_type: null }],
    ]) {
      const r = await tryInsert("project_events", eventRow(p.id, snap.id, over));
      assert.equal(r.code, "23514", label);
      assert.match(r.message, /project_events_evidence/, label);
    }
    // 정정으로 바꿔 적는 기록도 같은 증거가 필요하다
    const first = await insertRow("project_events", eventRow(p.id, snap.id));
    const corrNoEvidence = await tryInsert("project_events", eventRow(p.id, snap.id, { kind: "correction", correction_of: first.id, reason: "시험용 정정", notice_no: null }));
    assert.match(corrNoEvidence.message, /project_events_evidence/);

    const outside = await tryInsert("project_events", eventRow(p.id, snap.id, { stage: "siheom_unknown" }));
    assert.equal(outside.code, "23514");
    assert.match(outside.message, /단계 목록\(project_stage_lists\)에 없습니다/);
    // 다른 유형의 단계 키(목록에 없는 키)는 거부 — 같은 키 이름이 다른 유형에 있어도 이 유형 목록만 본다
    const small = await project({ project_type: "siheom_small" });
    assert.match((await tryInsert("project_events", eventRow(small.id, snap.id, { stage: "plan" }))).message, /siheom_small의 단계 목록/);
    assert.equal((await tryInsert("project_events", eventRow(p.id, snap.id, { kind: "stage", stage: null }))).code, "23514", "단계 없는 단계 기록");
    assert.match((await tryInsert("project_events", eventRow(p.id, snap.id, { kind: "siheom", stage: "plan" }))).message, /project_events_kind_check/, "kind 값 목록 밖");
    assert.match((await tryInsert("project_events", eventRow(p.id, snap.id, { stage: "plan", license_type: "kogl_9" }))).message, /project_events_license_type_check/, "공공누리 값 목록 밖");
    assert.equal((await tryInsert("project_events", eventRow(999999999, snap.id))).ok, false, "없는 프로젝트");
  }));

test("단계 기록 — 같은 단계·앞 순서 거부, 해당 없음은 사유 필수(순서 검사 밖), 정정은 사유 필수·한 번만·같은 프로젝트만", () =>
  tx(async () => {
    await seedRegions();
    await seedLists();
    const p = await project();
    const q = await project();
    const snap = await snapshot(URL_A, "시험용 고시 원문 1");
    const zone = await insertRow("project_events", eventRow(p.id, snap.id));
    const build = await insertRow("project_events", eventRow(p.id, snap.id, { stage: "build", notice_no: "시험용 고시 제2026-3호", notice_date: "2026-06-01" }));

    const same = await tryInsert("project_events", eventRow(p.id, snap.id, { stage: "build" }));
    assert.equal(same.code, "23514");
    assert.match(same.message, /이미 기록된 단계/);
    const back = await tryInsert("project_events", eventRow(p.id, snap.id, { stage: "plan" }));
    assert.equal(back.code, "23514");
    assert.match(back.message, /앞 순서 단계로 돌아가는 기록은 거부합니다 \(현재 build → 새 기록 plan\)/);

    // 해당 없음 — 사유 필수, 앞 순서여도 받는다(현재 단계를 바꾸지 않는다), 같은 단계 두 번은 거부
    assert.match((await tryInsert("project_events", { project_id: p.id, kind: "not_applicable", stage: "plan", recorded_by: ACTOR })).message, /project_events_reason/);
    const na = await insertRow("project_events", { project_id: p.id, kind: "not_applicable", stage: "plan", reason: "시험용 — 이 사업에는 계획인가 단계가 없음", recorded_by: ACTOR });
    assert.equal(na.kind, "not_applicable");
    assert.match((await tryInsert("project_events", { project_id: p.id, kind: "not_applicable", stage: "plan", reason: "시험용 다시", recorded_by: ACTOR })).message, /이미 기록된 단계/);
    assert.equal(await currentOf(p.id), "build", "해당 없음은 현재 단계를 바꾸지 않는다");

    // 정정 — 사유 필수
    assert.match((await tryInsert("project_events", { project_id: p.id, kind: "correction", correction_of: build.id, recorded_by: ACTOR })).message, /project_events_reason/);
    assert.match((await tryInsert("project_events", eventRow(p.id, snap.id, { stage: "done", correction_of: build.id, reason: "시험용" }))).message, /project_events_correction/, "정정 대상은 정정 기록에만");
    // 다른 프로젝트의 기록은 정정하지 못한다
    assert.match((await tryInsert("project_events", { project_id: q.id, kind: "correction", correction_of: build.id, reason: "시험용", recorded_by: ACTOR })).message, /같은 프로젝트의 기록/);
    // 거두기(단계 없음) — 착공 기록이 잘못 → 현재 단계는 구역지정으로
    const retract = await insertRow("project_events", { project_id: p.id, kind: "correction", correction_of: build.id, reason: "시험용 — 착공 고시가 아니었음", recorded_by: ACTOR });
    assert.equal(await currentOf(p.id), "zone");
    // 한 번만
    const twice = await tryInsert("project_events", { project_id: p.id, kind: "correction", correction_of: build.id, reason: "시험용 두 번째", recorded_by: ACTOR });
    assert.equal(twice.code, "23514");
    assert.match(twice.message, /이미 정정된 기록/);
    // 정정을 다시 고치려면 정정 기록을 정정한다 — 거두기가 잘못이었다: 착공을 바꿔 적기로 되살린다(증거 필수)
    const fix = await insertRow("project_events", eventRow(p.id, snap.id, { kind: "correction", correction_of: retract.id, stage: "build", reason: "시험용 — 착공 고시가 맞았음(고시 번호 고침)", notice_no: "시험용 고시 제2026-3-1호" }));
    assert.equal(fix.stage, "build");
    assert.equal(await currentOf(p.id), "build", "정정을 정정 — 바꿔 적은 착공이 현재 단계");
    // 바꿔 적기도 같은 단계 중복은 거부 — 구역지정 기록을 해당 없음으로 남은 계획인가(plan)로는 거부, 자기 단계(zone)로는 받는다
    assert.match((await tryInsert("project_events", eventRow(p.id, snap.id, { kind: "correction", correction_of: zone.id, stage: "plan", reason: "시험용" }))).message, /이미 기록된 단계/);
    assert.ok(await insertRow("project_events", eventRow(p.id, snap.id, { kind: "correction", correction_of: zone.id, stage: "zone", reason: "시험용 — 고시 번호 오기", notice_no: "시험용 고시 제2026-1-1호" })));
    // 바꿔 적은 착공이 살아 있으니 새 착공 기록은 같은 단계로 거부, 다음 단계(준공)는 받는다
    assert.match((await tryInsert("project_events", eventRow(p.id, snap.id, { stage: "build", notice_no: "시험용 고시 제2026-4호" }))).message, /이미 기록된 단계/);
    await insertRow("project_events", eventRow(p.id, snap.id, { stage: "done", notice_no: "시험용 고시 제2026-5호" }));
    assert.equal(await currentOf(p.id), "done");
  }));

test("단계 기록은 추가만 — service_role·소유자 모두 고치기·지우기·비우기 거부", () =>
  tx(async () => {
    await seedRegions();
    await seedLists();
    const p = await project();
    const snap = await snapshot(URL_A, "시험용 고시 원문 1");
    const e = await insertRow("project_events", eventRow(p.id, snap.id));
    for (const role of ["service_role", null]) {
      assert.equal((await attempt("update public.project_events set notice_no = '시험용 고침' where id = $1", [e.id], role)).ok, false, `${role ?? "postgres"} update`);
      assert.equal((await attempt("update public.project_events set public = false where id = $1", [e.id], role)).ok, false, `${role ?? "postgres"} 공개 표시 고치기`);
      assert.equal((await attempt("delete from public.project_events where id = $1", [e.id], role)).ok, false, `${role ?? "postgres"} delete`);
    }
    assert.equal((await attempt("truncate public.project_events cascade")).ok, false, "truncate");
    const priv = await one(
      "select has_table_privilege('service_role', 'public.project_events', 'INSERT') i, has_table_privilege('service_role', 'public.project_events', 'UPDATE') u, has_table_privilege('service_role', 'public.project_events', 'DELETE') d",
    );
    assert.deepEqual([priv.i, priv.u, priv.d], [true, false, false]);
  }));

test("현재 단계 = 가장 늦은 순서의 공개 기록 — 비공개·정정된 기록 빼고, 단계 목록 순서를 바꾸면 다음 읽기부터", () =>
  tx(async () => {
    await seedRegions();
    await seedLists();
    const p = await project();
    const snap = await snapshot(URL_A, "시험용 고시 원문 1");
    assert.equal(await currentOf(p.id), null, "기록 0 → 현재 단계 없음");
    await insertRow("project_events", eventRow(p.id, snap.id));
    await insertRow("project_events", eventRow(p.id, snap.id, { stage: "plan", notice_date: "2026-03-01" }));
    const hiddenBuild = await insertRow("project_events", eventRow(p.id, snap.id, { stage: "build", public: false }));
    const row = await one("select current_stage, current_stage_position, current_stage_label, current_stage_notice_date::text d from public.project_current_stages where project_id = $1", [p.id]);
    assert.deepEqual(
      [row.current_stage, row.current_stage_position, row.current_stage_label, row.d],
      ["plan", 2, "시험용 계획인가", "2026-03-01"],
      "비공개 착공 기록은 현재 단계가 아니다",
    );
    // 비공개 기록도 순서 검사에는 든다 — 앞 순서(계획인가 다음 구역지정) 거부는 위, 비공개 착공 뒤 공개 계획인가 재기록도 같은 단계라 거부
    assert.match((await tryInsert("project_events", eventRow(p.id, snap.id, { stage: "build" }))).message, /이미 기록된 단계/);
    // 비공개 기록을 공개로 바꾸려면 정정(바꿔 적기, public true)
    await insertRow("project_events", eventRow(p.id, snap.id, { kind: "correction", correction_of: hiddenBuild.id, stage: "build", reason: "시험용 — 공개 전환", public: true }));
    assert.equal(await currentOf(p.id), "build");
    // 단계 목록 순서를 바꾸면(감수 뒤) 다음 읽기부터 새 순서로 — 착공을 맨 앞으로 옮기면 계획인가가 가장 늦은 공개 기록
    const reordered = [LISTS.siheom_redev[2], LISTS.siheom_redev[0], LISTS.siheom_redev[1], LISTS.siheom_redev[3]];
    assert.ok((await setSetting("project_stage_lists", { ...LISTS, siheom_redev: reordered })).ok);
    assert.equal(await currentOf(p.id), "plan");
  }));

test("공개 — 공개 단계 0건·데이터 출처·정보 확인일 없으면 거부, 갖추면 공개 / 메모의 숫자 + 원·%는 저장 경고(저장은 된다)", () =>
  tx(async () => {
    await seedRegions();
    await seedLists();
    const direct = await tryInsert("projects", { slug: uniq("siheom-pr"), name: "시험용", region_code: "9901100000", project_type: "siheom_redev", created_by: ACTOR, status: "public", source_name: "시험용 가상구청", last_verified_at: "2026-10-20T10:00:00+09:00" });
    assert.match(direct.message, /공개 단계 기록이 0건/, "처음부터 공개로 넣기 거부");
    const p = await project();
    const snap = await snapshot(URL_A, "시험용 고시 원문 1");
    const publish = () => attempt("update public.projects set status = 'public' where id = $1", [p.id]);
    assert.match((await publish()).message, /공개 단계 기록이 0건/, "기록 0");
    await insertRow("project_events", eventRow(p.id, snap.id, { public: false }));
    await insertRow("project_events", { project_id: p.id, kind: "not_applicable", stage: "plan", reason: "시험용", recorded_by: ACTOR });
    assert.match((await publish()).message, /공개 단계 기록이 0건/, "비공개 단계 기록·해당 없음만");
    await insertRow("project_events", eventRow(p.id, snap.id, { stage: "build" }));
    assert.match((await publish()).message, /데이터 출처\(source_name\)와 정보 확인일/, "출처·확인일 없음");
    await client.query("update public.projects set source_name = '시험용 가상구청' where id = $1", [p.id]);
    assert.match((await publish()).message, /정보 확인일/);
    await client.query("update public.projects set last_verified_at = '2026-10-20T10:00:00+09:00' where id = $1", [p.id]);
    assert.ok((await publish()).ok, "공개");
    assert.ok((await attempt("update public.projects set status = 'hidden' where id = $1", [p.id])).ok, "내리기");

    // 메모 경고 — DB가 경고(WARNING)를 내고 저장은 된다. 금액·비율이 아닌 숫자는 경고 0
    const q = await project();
    const memo = async (note, stage) => {
      notices.length = 0;
      const row = await insertRow("project_events", eventRow(q.id, snap.id, { stage, note }));
      assert.ok(row.id, "저장은 된다");
      return notices.filter((n) => n.severity === "WARNING" && /PR-05 저장 경고/.test(n.message)).length;
    };
    assert.equal(await memo("시험용 메모 — 추정 3억 원", "zone"), 1);
    assert.equal(await memo("시험용 메모 — 고시 제2026-15호 원문 2건 확인", "plan"), 0);
    assert.equal(await memo("시험용 메모 — 공정률 10%", "build"), 1);
    assert.equal(await memo(null, "done"), 0);
  }));

// 웹 규칙(apps/web/lib/admin/project-rules.test.ts)과 같은 견본 — 두 식이 같은 답을 내는지 본다
const NOTE_SAMPLES = [
  ["시험용 3억 원", true],
  ["시험용 5,000만원", true],
  ["시험용 1억5천만 원", true],
  ["시험용 12.5%", true],
  ["시험용 3 %p", true],
  ["시험용 7％", true],
  ["시험용 1000원에", true],
  ["시험용 고시 제2026-15호 원문", false],
  ["시험용 원문 3 원본", false],
  ["시험용 2단계 원문 확인", false],
  ["시험용 2026-10-20 고시", false],
  ["시험용 금액 없음", false],
];

test("메모 금액 식 — 견본 12개 (웹 규칙 NOTE_AMOUNT_RE와 같은 견본)", async () => {
  for (const [note, expected] of NOTE_SAMPLES) {
    assert.equal((await one("select public.project_note_has_amount($1) r", [note])).r, expected, note);
  }
  assert.equal((await one("select public.project_note_has_amount(null) r")).r, false);
});

test("원문 해시 바뀜 → 검수 큐 1건(project_event) + 공개 단계 `검토 중` · 같은 해시 0 · 같은 주소의 기사 공식 자료도 함께 · 대상 검사", () =>
  tx(async () => {
    await seedRegions();
    await seedLists();
    const p = await project({ source_name: "시험용 가상구청", last_verified_at: "2026-10-20T10:00:00+09:00" });
    const OLD = "시험용 고시 원문 1";
    const snap = await snapshot(URL_A, OLD);
    const zone = await insertRow("project_events", eventRow(p.id, snap.id));
    const other = await insertRow("project_events", eventRow(p.id, (await snapshot("https://gasang.example/notice/siheom-2", "시험용 다른 원문")).id, { stage: "plan", source_url: "https://gasang.example/notice/siheom-2" }));
    await client.query("update public.projects set status = 'public' where id = $1", [p.id]);
    // 같은 주소를 쓴 기사 공식 자료 1건
    const a = await insertRow("articles", { slug: uniq("w4pr"), title: "시험용 프로젝트 기사", section: "local", content_type: "reported_news", status: "draft", region_codes: ["9901100000"], editorial_field: "realestate", public_question: "시험용 공익적 질문" });
    const src = await insertRow("article_sources", {
      article_id: a.id, kind: "official_doc", title: "시험용 고시", source_url: URL_A, source_name: "시험용 가상구청", last_verified_at: "2026-10-20T10:00:00+09:00",
      license_status: "공공누리 제1유형", license_type: "kogl_1", source_type: "notice", published_on: "2026-01-15", reference_date: "2026-01-15", region_unit: "시·군·구", collected_at: "2026-10-15T09:00:00+09:00", snapshot_id: snap.id,
    });
    const refetch = (text) => one("select public.source_snapshot_refetched($1, $2, $3, '시험용 다시 받기', $4) r", [URL_A, hashOf(text), text, ACTOR]).then((x) => x.r);
    const reviewOf = async (id) => (await one("select under_review from public.public_project_events where id = $1", [id])).under_review;

    const same = await refetch(OLD);
    assert.deepEqual([same.projectTargets, same.projectOpened, same.projectUnchanged, same.targets, same.opened], [1, 0, 1, 1, 0], "같은 해시 → 0건");
    assert.equal(await reviewOf(zone.id), false);

    const changed = await refetch("시험용 고시 원문 1 — 바뀜");
    assert.deepEqual([changed.projectTargets, changed.projectOpened, changed.targets, changed.opened], [1, 1, 1, 1], "단계 기록 1건 + 같은 주소의 공식 자료 1건");
    const items = (await client.query("select target_type, target_id, article_id, reason, old_hash, new_hash, status from public.source_review_queue where target_type = 'project_event' and target_id = any($1::bigint[])", [[zone.id, other.id]])).rows;
    assert.deepEqual(items, [{ target_type: "project_event", target_id: String(zone.id), article_id: null, reason: "snapshot_changed", old_hash: hashOf(OLD), new_hash: hashOf("시험용 고시 원문 1 — 바뀜"), status: "open" }]);
    assert.equal(await reviewOf(zone.id), true, "공개 단계 `검토 중`");
    assert.equal(await reviewOf(other.id), false, "다른 주소의 단계는 그대로");
    assert.ok((await one("select count(*)::int n from public.source_review_queue where target_type = 'article_source' and target_id = $1", [src.id])).n === 1);
    const again = await refetch("시험용 고시 원문 1 — 바뀜");
    assert.deepEqual([again.projectOpened, again.projectAlreadyQueued], [0, 1], "같은 새 해시로 다시 0");
    // 해결하면 `검토 중` 사라짐
    await client.query("update public.source_review_queue set status = 'resolved', resolved_by = $2, resolved_at = now() where target_type = 'project_event' and target_id = $1", [zone.id, ACTOR]);
    assert.equal(await reviewOf(zone.id), false);
    // 정정된(거둬진) 기록은 비교하지 않는다
    await insertRow("project_events", { project_id: p.id, kind: "correction", correction_of: other.id, reason: "시험용 거두기", recorded_by: ACTOR });
    const otherUrl = await one("select public.source_snapshot_refetched('https://gasang.example/notice/siheom-2', $1, 'x', '시험용', $2) r", [hashOf("시험용 다른 원문 — 바뀜"), ACTOR]);
    assert.equal(otherUrl.r.projectTargets, 0);

    // 대상 검사 — 없는 단계 기록 · 스냅샷 없는 기록(해당 없음) · 기사 번호를 넣은 항목 · 개발방법 사실 행은 아직
    const na = await insertRow("project_events", { project_id: p.id, kind: "not_applicable", stage: "build", reason: "시험용", recorded_by: ACTOR });
    const ins = (over) =>
      tryInsert("source_review_queue", { target_type: "project_event", target_id: zone.id, reason: "expired", basis_on: "2026-01-01", run_key: "2027-01-02", opened_by: ACTOR, ...over });
    assert.equal((await ins({ target_id: 999999999 })).code, "23503");
    assert.match((await ins({ target_id: na.id })).message, /원본 스냅샷이 있는 단계 기록만/);
    assert.match((await ins({ article_id: a.id })).message, /기사 번호를 넣지 않습니다/);
    assert.ok((await ins({})).ok, "단계 기록 만료 항목은 받는다");
    assert.equal((await ins({ target_type: "dev_method_fact", target_id: 999999999 })).code, "23503", "개발방법 사실 행은 18단계(…52)가 받는다 — 없는 행 거부");
  }));

test("권한 — anon은 표·현재 단계 뷰 거부, 공개 뷰는 공개 프로젝트의 공개 칸·정정되지 않은 공개 기록만", () =>
  tx(async () => {
    await seedRegions();
    await seedLists();
    const snap = await snapshot(URL_A, "시험용 고시 원문 1");
    const pub = await project({ source_name: "시험용 가상구청", last_verified_at: "2026-10-20T10:00:00+09:00", summary: "시험용 요약" });
    const zone = await insertRow("project_events", eventRow(pub.id, snap.id, { note: "시험용 내부 메모" }));
    const hidden = await insertRow("project_events", eventRow(pub.id, snap.id, { stage: "plan", public: false }));
    const wrong = await insertRow("project_events", eventRow(pub.id, snap.id, { stage: "build" }));
    await insertRow("project_events", { project_id: pub.id, kind: "correction", correction_of: wrong.id, reason: "시험용 거두기", recorded_by: ACTOR });
    const na = await insertRow("project_events", { project_id: pub.id, kind: "not_applicable", stage: "done", reason: "시험용 사유", recorded_by: ACTOR });
    await client.query("update public.projects set status = 'public' where id = $1", [pub.id]);
    const draft = await project();
    await insertRow("project_events", eventRow(draft.id, snap.id));
    const hid = await project({ source_name: "시험용", last_verified_at: "2026-10-20T10:00:00+09:00" });
    await insertRow("project_events", eventRow(hid.id, snap.id));
    await client.query("update public.projects set status = 'public' where id = $1", [hid.id]);
    await client.query("update public.projects set status = 'hidden' where id = $1", [hid.id]);

    for (const role of ["anon", "authenticated"]) {
      for (const rel of ["projects", "project_events", "project_current_stages"]) {
        const r = await attempt(`select count(*) from public.${rel}`, [], role);
        assert.equal(r.code, "42501", `${role} ${rel}`);
      }
      const projects = await attempt("select * from public.public_projects where region_code like '99%' order by id", [], role);
      assert.ok(projects.ok, projects.message);
      assert.deepEqual(projects.rows.map((r) => Number(r.id)), [Number(pub.id)], `${role}: 공개 프로젝트만 (초안·내린 것 0)`);
      assert.deepEqual(Object.keys(projects.rows[0]), PUBLIC_PROJECT_COLUMNS, "공개 칸만 — 기록자·상태 칸 0");
      assert.deepEqual(
        [projects.rows[0].project_type_label, projects.rows[0].current_stage, projects.rows[0].current_stage_label],
        ["시험용 재개발", "zone", "시험용 구역지정"],
        "비공개 계획인가·거둔 착공은 현재 단계가 아니다",
      );
      const events = await attempt("select * from public.public_project_events where project_id = any($1::bigint[]) order by stage_position", [[pub.id, draft.id, hid.id]], role);
      assert.ok(events.ok, events.message);
      assert.deepEqual(Object.keys(events.rows[0]), PUBLIC_EVENT_COLUMNS, "메모·사유·기록자·정정 관계·스냅샷 번호 칸 0");
      assert.deepEqual(
        events.rows.map((r) => [Number(r.id), r.kind, r.stage]),
        [
          [Number(zone.id), "stage", "zone"],
          [Number(na.id), "not_applicable", "done"],
        ],
        "비공개·거둔 기록·거두기 기록·다른 프로젝트 0",
      );
      assert.equal(events.rows[0].source_url, URL_A, "원문 링크");
      assert.ok(events.rows[0].verified_at, "확인일 = 스냅샷 받은 시각");
      assert.ok(!events.rows.some((r) => Number(r.id) === Number(hidden.id)));
      for (const fn of ["project_note_has_amount('x')", "project_stage_position('{}'::jsonb, 'a', 'b')"]) {
        assert.equal((await attempt(`select public.${fn}`, [], role)).code, "42501", `${role} ${fn}`);
      }
      assert.equal((await attempt("insert into public.projects (slug, name, region_code, project_type, created_by) values ('siheom-anon', '시험용', '9901100000', 'siheom_redev', 'anon')", [], role)).code, "42501");
    }
  }));
