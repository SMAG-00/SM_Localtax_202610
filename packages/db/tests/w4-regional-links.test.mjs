// W4 13단계 DB — 지역 연결 regional_links (docs/dev/W4_설계.md 1장 13단계 · 2.1 · 3장 · 12장 100번~, 마이그레이션 20261023000048 · PRD-01B REG1-10 · LG-14)
// 지역·기사·공식 자료·프로젝트는 모두 시험용 가짜다(지역 접두 99, '시험용' 이름 — 설계 8장). 모든 시험은 트랜잭션 안에서 하고 되돌린다.
//  · 값 목록 — from/to 종류·관계·출처·상태 = 설계 2.1 글자(DB check), 관광 항목 3종(설계 2.1 '저장 거부')은 check 밖이고 저장 검사가 거부한다
//  · 관광 항목 종류(출발·도착 모두) 거부 · 행사(W6) 거부 · 관계 규칙 · 번호 모양 · 없는 대상 · 자기 자신
//  · 확인 기록(확인자·시각·이유) 없는 confirmed 거부 · 비공개 목적지 확인 거부(초안·유료·지운 기사·검수 안 된 공식 자료·초안 프로젝트·폐지 지역)
//  · 지역 출발 연결은 그 지역 범위의 대상만 확인 · 상태 흐름(지운 연결 되살리기·확인 → 후보 거부) · 출발·도착·출처 고치기 거부 · 같은 쌍 하나
//  · 공개 뷰 — 확인된 연결만, 목적지(또는 출발)가 비공개가 되면 다음 읽기부터 0행 · 지역 끝은 region_hubs 켜짐일 때만 · 공개 칸 7개(이유·확인자·출처 0)
//  · 같은 지역 자동 후보 — 공개 대상만·같은 지역만·다시 돌려도 0·지운 후보 다시 만들지 않음·후보는 anon 0행
//  · 권한 — anon·authenticated는 표·판정 뷰·함수 0, 공개 뷰만 읽기 · service_role은 표 전권
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

const SIDO = "9900000000";
const GU = "9901100000";
const GU2 = "9901200000";
const GONE = "9901300000";
const OTHER_SIDO = "9800000000";
const OTHER_GU = "9801100000";
const ACTOR = "user:w4rl-test";
const Q = "시험용 공익적 질문 — 이 지역 지방재정에 어떤 영향을 주나";
const PUBLIC_COLUMNS = ["id", "from_type", "from_id", "to_type", "to_id", "relation", "confirmed_at"];
const TYPES = { siheom_redev: { label: "시험용 재개발" } };
const LISTS = {
  siheom_redev: [
    { key: "zone", label: "시험용 구역지정" },
    { key: "done", label: "시험용 준공" },
  ],
};

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
const uniq = (p) => `w4rl-${p}-${process.pid}-${++seq}`;
const hashOf = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const insertSql = (table, row) => {
  const keys = Object.keys(row);
  return [`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k])];
};
const insert = async (table, row) => (await client.query(...insertSql(table, row))).rows[0];
const tryInsert = (table, row) => attempt(...insertSql(table, row));
const hubs = (on) => client.query("update public.settings set value = jsonb_set(value, '{region_hubs}', $1::jsonb) where key = 'feature_flags'", [JSON.stringify(on)]);
const checkValues = async (constraint) => {
  const def = (await client.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.regional_links'::regclass and conname = $1", [constraint])).rows[0]?.d ?? "";
  return [...def.matchAll(/'([a-z_0-9]+)'::text/g)].map((m) => m[1]);
};

/** 시험용 지역 — 시·도 2 · 시·군·구 3(오늘 유효 2 · 어제 폐지 1) + 다른 시·도의 시·군·구 1 */
async function regions() {
  await insert("regions", { code: SIDO, level: "sido", name: "시험용 연결도", slug: uniq("do") });
  await insert("regions", { code: GU, parent_code: SIDO, level: "sigungu", name: "시험용 연결구", slug: uniq("gu") });
  await insert("regions", { code: GU2, parent_code: SIDO, level: "sigungu", name: "시험용 이웃구", slug: uniq("gu") });
  await client.query(
    "insert into public.regions (code, parent_code, level, name, slug, valid_to, successor_code) values ($1, $2, 'sigungu', '시험용 폐지구', $3, (now() at time zone 'Asia/Seoul')::date - 1, $4)",
    [GONE, SIDO, uniq("gu"), GU],
  );
  await insert("regions", { code: OTHER_SIDO, level: "sido", name: "시험용 다른도", slug: uniq("do") });
  await insert("regions", { code: OTHER_GU, parent_code: OTHER_SIDO, level: "sigungu", name: "시험용 다른구", slug: uniq("gu") });
}

let reporter;
async function people() {
  reporter = await insert("people", { slug: uniq("rep"), name: "시험용 연결 기자", roles: ["reporter"], visibility: "public" });
}

/** 공개 지역 기사 — 이관 모양(발행일을 넣은 공개 행) */
const article = (over = {}) =>
  insert("articles", {
    slug: uniq("a"),
    title: "시험용 연결 기사",
    section: "local",
    content_type: "reported_news",
    status: "published",
    author_id: reporter.id,
    region_codes: [GU],
    editorial_field: "local_finance",
    public_question: Q,
    first_published_at: new Date(Date.now() - 3600_000).toISOString(),
    ...over,
  });

/** 공식 자료 — 카드 칸 전부 + 원본 스냅샷 (over로 빼거나 바꾼다) */
async function source(articleId, over = {}) {
  const url = over.url ?? `https://gov.example.test/w4rl/${uniq("doc")}`;
  const snap = over.snapshot === false ? null : await insert("raw_snapshots", { source: "w4rl", url, content_hash: hashOf(uniq("h")), payload: "시험용 원본" });
  const row = {
    article_id: articleId,
    kind: over.kind ?? "official_doc",
    title: "시험용 공식 자료",
    source_url: url,
    source_name: "시험용 연결도청",
    last_verified_at: new Date(Date.now() - 86_400_000).toISOString(),
    license_status: "공공누리 제1유형",
    license_type: "kogl_1",
    source_type: over.sourceType === undefined ? "local_tax_revenue" : over.sourceType,
    published_on: "2026-09-01",
    reference_date: "2026-08-31",
    region_unit: "시·군·구",
    collected_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    snapshot_id: snap?.id ?? null,
  };
  if (over.supersedes) Object.assign(row, { supersedes_id: over.supersedes, revision_reason: "시험용 수치 고침" });
  return insert("article_sources", row);
}

/** 시험용 사업 유형·단계 목록 + 프로젝트(public = 공개 단계 기록 1건 + 공개) */
async function lists() {
  await client.query("update public.settings set value = $1::jsonb where key = 'project_types'", [JSON.stringify(TYPES)]);
  await client.query("update public.settings set value = $1::jsonb where key = 'project_stage_lists'", [JSON.stringify(LISTS)]);
}
async function project({ region = GU, publish = true } = {}) {
  const p = await insert("projects", { slug: uniq("siheom-pr"), name: "시험용 가상구역 재개발", region_code: region, project_type: "siheom_redev", created_by: ACTOR });
  const url = `https://gov.example.test/w4rl/notice/${uniq("n")}`;
  const snap = await insert("raw_snapshots", { source: "w4rl", url, content_hash: hashOf(uniq("p")), payload: "시험용 고시" });
  await insert("project_events", {
    project_id: p.id,
    kind: "stage",
    stage: "zone",
    notice_no: "시험용 고시 제2026-1호",
    notice_date: "2026-01-15",
    issuer: "시험용 가상구청",
    source_url: url,
    snapshot_id: snap.id,
    license_type: "kogl_1",
    recorded_by: ACTOR,
  });
  if (publish) await client.query("update public.projects set status = 'public', source_name = '시험용 가상구청', last_verified_at = now() where id = $1", [p.id]);
  return p;
}

/** 연결 한 줄 — 기본은 편집자 후보 */
const linkRow = (from, to, over = {}) => ({
  from_type: from[0],
  from_id: String(from[1]),
  to_type: to[0],
  to_id: String(to[1]),
  relation: "related_tax",
  origin: "editor",
  status: "candidate",
  created_by: ACTOR,
  ...over,
});
const CONFIRMED = { status: "confirmed", confirmed_by: ACTOR, confirmed_at: new Date().toISOString(), reason: "시험용 — 같은 세목을 다룬 기사" };
const confirm = (id, over = {}) =>
  attempt("update public.regional_links set status = 'confirmed', confirmed_by = $2, confirmed_at = now(), reason = $3 where id = $1 returning *", [id, over.by ?? ACTOR, over.reason ?? "시험용 확인 이유"]);
const publicRows = async (fromId, role = "anon") => {
  const r = await attempt("select * from public.public_regional_links where from_id = $1 order by id", [String(fromId)], role);
  assert.ok(r.ok, r.message);
  return r.rows;
};

test("값 목록 — from/to 종류 5·관계 6·출처 2·상태 3 = 설계 2.1(DB check), 관광 항목 3종은 check 밖(저장 검사가 거부)", async () => {
  const types = codes("| regional_link.from/to type |");
  assert.deepEqual(types, ["article", "official_source", "project", "region", "local_event"]);
  assert.deepEqual(await checkValues("regional_links_from_type"), types);
  assert.deepEqual(await checkValues("regional_links_to_type"), types);
  assert.deepEqual(await checkValues("regional_links_relation"), codes("| regional_link.relation |"));
  assert.deepEqual(await checkValues("regional_links_origin"), codes("| regional_link.origin |"));
  assert.deepEqual(await checkValues("regional_links_status"), codes("| regional_link.status |"));
  const blocked = codes("| regional_link.blocked type (저장 거부) |");
  assert.deepEqual(blocked, ["attraction", "restaurant", "tour_item"]);
  for (const b of blocked) assert.ok(!types.includes(b), `${b} — 허용 목록 밖`);
  const guard = (await one("select pg_get_functiondef('public.regional_links_guard()'::regprocedure) d")).d;
  for (const b of blocked) assert.ok(guard.includes(`'${b}'`), `저장 검사 함수가 ${b}를 거부 목록에 둔다`);
});

test("관광 항목 종류 거부(도착·출발) · 모르는 종류 · 행사(W6) · 관계 규칙 · 번호 모양 · 없는 대상 · 자기 자신", () =>
  tx(async () => {
    await regions();
    await people();
    const a = await article();
    const b = await article();
    for (const t of codes("| regional_link.blocked type (저장 거부) |")) {
      const to = await tryInsert("regional_links", linkRow(["article", a.id], [t, "1"]));
      assert.equal(to.ok, false, `도착 ${t}`);
      assert.equal(to.code, "23514");
      assert.match(to.message, new RegExp(`관광 항목 종류\\(${t}\\)는 지역 연결에 저장하지 않습니다`));
      const from = await tryInsert("regional_links", linkRow([t, "1"], ["article", a.id]));
      assert.equal(from.ok, false, `출발 ${t}`);
      assert.match(from.message, /관광 항목 종류/);
    }
    const unknown = await tryInsert("regional_links", linkRow(["article", a.id], ["shop", "1"]));
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, "23514");
    assert.match(unknown.message, /regional_links_to_type/, "값 목록 밖 종류 — check 제약");
    const event = await tryInsert("regional_links", linkRow(["article", a.id], ["local_event", "1"]));
    assert.equal(event.ok, false);
    assert.match(event.message, /행사\(local_event\) 연결은 행사 표가 생기는 W6/);
    const relEvent = await tryInsert("regional_links", linkRow(["article", a.id], ["article", b.id], { relation: "related_event" }));
    assert.match(relEvent.message, /related_event는 행사 연결\(W6\)에서만/);
    const relProject = await tryInsert("regional_links", linkRow(["article", a.id], ["article", b.id], { relation: "related_project" }));
    assert.match(relProject.message, /related_project는 한쪽이 프로젝트인 연결에만/);
    const badRelation = await tryInsert("regional_links", linkRow(["article", a.id], ["article", b.id], { relation: "nearby" }));
    assert.match(badRelation.message, /regional_links_relation/);

    for (const [to, msg] of [
      [["region", "99011"], /번호 모양이 틀립니다/],
      [["region", "99011000000"], /번호 모양이 틀립니다/],
      [["article", "abc"], /번호 모양이 틀립니다/],
      [["article", "0"], /번호 모양이 틀립니다/],
      [["article", "-3"], /번호 모양이 틀립니다/],
    ]) {
      const r = await tryInsert("regional_links", linkRow(["article", a.id], to));
      assert.equal(r.ok, false, to.join(":"));
      assert.match(r.message, msg, to.join(":"));
    }
    for (const to of [
      ["article", "999999999999"],
      ["project", "999999999999"],
      ["official_source", "999999999999"],
      ["region", "9909900000"],
    ]) {
      const r = await tryInsert("regional_links", linkRow(["article", a.id], to));
      assert.equal(r.ok, false, to.join(":"));
      assert.equal(r.code, "23503", to.join(":"));
      assert.match(r.message, /연결 대상이 없습니다/);
    }
    // 공식 자료 종류는 official_doc·dataset만 — 보도자료 출처는 '공식 자료'가 아니다
    const press = await insert("article_sources", { article_id: a.id, kind: "press_release", title: "시험용 보도자료", source_url: "https://gov.example.test/w4rl/press", source_name: "시험용 연결도청", last_verified_at: new Date().toISOString(), license_status: "공공누리 제1유형", license_type: "kogl_1" });
    const r = await tryInsert("regional_links", linkRow(["article", a.id], ["official_source", press.id]));
    assert.equal(r.code, "23503", "보도자료 출처 → 연결 대상 아님");
    const deleted = await article({ status: "deleted" });
    assert.equal((await tryInsert("regional_links", linkRow(["article", a.id], ["article", deleted.id]))).code, "23503", "지운 기사");
    const self = await tryInsert("regional_links", linkRow(["article", a.id], ["article", a.id]));
    assert.match(self.message, /regional_links_not_self/);
    const tooLong = await tryInsert("regional_links", linkRow(["article", a.id], ["article", b.id], { reason: "가".repeat(301) }));
    assert.match(tooLong.message, /regional_links_reason_length/);
    assert.ok((await tryInsert("regional_links", linkRow(["article", a.id], ["article", b.id], { reason: "가".repeat(300) }))).ok, "이유 300자 받음");
  }));

test("확인 기록 — 확인자·시각·이유 하나라도 없으면 confirmed 거부 · 다 있으면 받음", () =>
  tx(async () => {
    await regions();
    await people();
    const a = await article();
    const b = await article();
    for (const missing of ["confirmed_by", "confirmed_at", "reason"]) {
      const row = linkRow(["article", a.id], ["article", b.id], { ...CONFIRMED, [missing]: missing === "confirmed_at" ? null : "  " });
      const r = await tryInsert("regional_links", row);
      assert.equal(r.ok, false, missing);
      assert.equal(r.code, "23514");
      assert.match(r.message, /regional_links_confirmed_record/, missing);
    }
    const cand = await insert("regional_links", linkRow(["article", a.id], ["article", b.id]));
    const noRecord = await attempt("update public.regional_links set status = 'confirmed' where id = $1", [cand.id]);
    assert.match(noRecord.message, /regional_links_confirmed_record/, "후보 → 확인도 기록 필수");
    const ok = await confirm(cand.id);
    assert.ok(ok.ok, ok.message);
    assert.equal(ok.rows[0].status, "confirmed");
  }));

test("비공개 목적지 확인 거부 — 초안·유료·검수 안 된 공식 자료 6종·초안 프로젝트·폐지 지역 · 공개 목적지는 받음 · 후보로는 넣을 수 있다", () =>
  tx(async () => {
    await regions();
    await people();
    await lists();
    const from = await article();
    const pub = await article();
    const draft = await article({ status: "draft", first_published_at: null });
    const paid = await article({ section: "tax", region_codes: [], editorial_field: null, public_question: null, is_paid: true });
    const goodSrc = await source(pub.id);
    const draftSrc = await source(draft.id);
    const noSnap = await source(pub.id, { snapshot: false });
    const noType = await source(pub.id, { sourceType: null });
    const oldSrc = await source(pub.id);
    await source(pub.id, { supersedes: oldSrc.id }); // 새 판 — 옛 판은 검수 공식 자료가 아니다
    const dataset = await source(pub.id, { kind: "dataset" });
    const sponsored = await article({ content_type: "sponsored", label: "ad", editorial_field: null, public_question: null });
    const sponsoredSrc = await source(sponsored.id);
    const pubProject = await project();
    const draftProject = await project({ publish: false });

    const refused = [
      ["article", draft.id, "초안 기사"],
      ["article", paid.id, "유료 기사"],
      ["official_source", draftSrc.id, "초안 기사의 공식 자료"],
      ["official_source", noSnap.id, "원본 스냅샷 없음"],
      ["official_source", noType.id, "자료 종류 빔"],
      ["official_source", oldSrc.id, "대체된 옛 판"],
      ["official_source", sponsoredSrc.id, "광고 기사의 출처"],
      ["project", draftProject.id, "초안 프로젝트"],
      ["region", GONE, "어제 폐지된 지역"],
    ];
    for (const [t, id, what] of refused) {
      const direct = await tryInsert("regional_links", linkRow(["article", from.id], [t, id], CONFIRMED));
      assert.equal(direct.ok, false, `${what} — 확인으로 넣기`);
      assert.match(direct.message, /비공개 목적지\(.+\)는 확인하지 않습니다/, what);
      const cand = await tryInsert("regional_links", linkRow(["article", from.id], [t, id]));
      assert.ok(cand.ok, `${what} — 후보로는 넣는다 (${cand.message})`);
      const later = await confirm(cand.rows[0].id);
      assert.equal(later.ok, false, `${what} — 후보 → 확인`);
      assert.match(later.message, /비공개 목적지/);
    }
    for (const [t, id, what] of [
      ["article", pub.id, "공개 기사"],
      ["official_source", goodSrc.id, "검수 공식 자료"],
      ["official_source", dataset.id, "검수 통계 자료(dataset)"],
      ["project", pubProject.id, "공개 프로젝트"],
      ["region", GU, "오늘 유효한 지역"],
    ]) {
      const r = await tryInsert("regional_links", linkRow(["article", from.id], [t, id], { ...CONFIRMED, relation: t === "project" ? "related_project" : "same_region" }));
      assert.ok(r.ok, `${what} — ${r.message}`);
    }
    // 출발은 비공개여도 된다(공개 전 기사에 미리 연결) — 공개 뷰가 출발 공개를 본다
    assert.ok((await tryInsert("regional_links", linkRow(["article", draft.id], ["article", pub.id], CONFIRMED))).ok, "초안 기사에서 출발하는 확인");
  }));

test("지역 출발 연결 — 그 지역 범위의 대상만 확인 (시·군·구 = 자기 · 시·도 = 자기 + 하위 · 다른 지역 0)", () =>
  tx(async () => {
    await regions();
    await people();
    await lists();
    const inGu = await article({ region_codes: [GU] });
    const inGu2 = await article({ region_codes: [GU2] });
    const inOther = await article({ region_codes: [OTHER_GU] });
    const otherSrc = await source(inOther.id);
    const guSrc = await source(inGu.id);
    const otherProject = await project({ region: OTHER_GU });
    const guProject = await project({ region: GU });
    const refused = [
      [["region", GU], ["article", inGu2.id], "시·군·구 → 이웃 시·군·구 기사"],
      [["region", GU], ["article", inOther.id], "시·군·구 → 다른 시·도 기사"],
      [["region", GU], ["official_source", otherSrc.id], "다른 지역 기사의 공식 자료"],
      [["region", GU], ["project", otherProject.id], "다른 지역 프로젝트"],
      [["region", SIDO], ["article", inOther.id], "시·도 → 다른 시·도 하위 기사"],
      [["region", GU], ["region", GU2], "시·군·구 → 이웃 지역"],
    ];
    for (const [from, to, what] of refused) {
      const r = await tryInsert("regional_links", linkRow(from, to, { ...CONFIRMED, relation: to[0] === "project" ? "related_project" : "same_region" }));
      assert.equal(r.ok, false, what);
      assert.match(r.message, /그 지역 범위.*의 대상만 확인합니다/, what);
    }
    for (const [from, to, what] of [
      [["region", GU], ["article", inGu.id], "자기 태그 기사"],
      [["region", GU], ["official_source", guSrc.id], "자기 지역 기사의 공식 자료"],
      [["region", GU], ["project", guProject.id], "자기 지역 프로젝트"],
      [["region", SIDO], ["article", inGu2.id], "시·도 → 하위 시·군·구 기사"],
      [["region", SIDO], ["region", GU], "시·도 → 하위 지역"],
    ]) {
      const r = await tryInsert("regional_links", linkRow(from, to, { ...CONFIRMED, relation: to[0] === "project" ? "related_project" : "same_region" }));
      assert.ok(r.ok, `${what} — ${r.message}`);
    }
  }));

test("상태 흐름·고치지 못하는 칸 — 지운 연결 되살리기·확인 → 후보 거부 · 출발·도착·출처 고치기 거부 · 자동 후보는 후보로만 · 같은 쌍 하나(지운 뒤 새로)", () =>
  tx(async () => {
    await regions();
    await people();
    const a = await article();
    const b = await article();
    const c = await article();
    const link = await insert("regional_links", linkRow(["article", a.id], ["article", b.id]));
    for (const [set, params] of [
      ["to_id = $2", [String(c.id)]],
      ["from_id = $2", [String(c.id)]],
      ["to_type = $2", ["region"]],
      ["origin = $2", ["auto_candidate"]],
      ["created_by = $2", ["user:other"]],
    ]) {
      const r = await attempt(`update public.regional_links set ${set} where id = $1`, [link.id, ...params]);
      assert.equal(r.ok, false, set);
      assert.match(r.message, /출발·도착·출처는 바꾸지 않습니다/, set);
    }
    assert.ok((await attempt("update public.regional_links set relation = 'related_policy' where id = $1", [link.id])).ok, "관계는 바꾼다");
    const dup = await tryInsert("regional_links", linkRow(["article", a.id], ["article", b.id], { relation: "same_region" }));
    assert.equal(dup.code, "23505", "같은 쌍의 살아 있는 연결은 하나");
    assert.ok((await confirm(link.id)).ok);
    const back = await attempt("update public.regional_links set status = 'candidate' where id = $1", [link.id]);
    assert.match(back.message, /확인된 연결\(\d+\)을 후보로 돌리지 않습니다/);
    assert.ok((await attempt("update public.regional_links set status = 'removed' where id = $1", [link.id])).ok, "확인 → 지움");
    for (const s of ["candidate", "confirmed"]) {
      const r = await attempt("update public.regional_links set status = $2 where id = $1", [link.id, s]);
      assert.match(r.message, /지운 연결\(\d+\)은 되살리지 않습니다/, s);
    }
    assert.ok((await tryInsert("regional_links", linkRow(["article", a.id], ["article", b.id]))).ok, "지운 뒤 같은 쌍 새로");
    const removedInsert = await tryInsert("regional_links", linkRow(["article", a.id], ["article", c.id], { status: "removed" }));
    assert.match(removedInsert.message, /지운 상태\(removed\)로는 넣지 않습니다/);
    const autoConfirmed = await tryInsert("regional_links", linkRow(["article", a.id], ["article", c.id], { ...CONFIRMED, origin: "auto_candidate" }));
    assert.match(autoConfirmed.message, /자동 후보는 후보\(candidate\)로만/);
    const auto = await insert("regional_links", linkRow(["article", a.id], ["article", c.id], { origin: "auto_candidate", relation: "same_region" }));
    assert.ok((await confirm(auto.id)).ok, "자동 후보도 편집자가 확인하면 확인된 연결 (출처는 그대로)");
    assert.equal((await one("select origin from public.regional_links where id = $1", [auto.id])).origin, "auto_candidate");
  }));

test("공개 뷰 — 확인된 연결만 · 목적지·출발이 비공개가 되면 다음 읽기부터 0행 · 지역 끝은 region_hubs 켜짐일 때만 · 공개 칸 7개", () =>
  tx(async () => {
    await regions();
    await people();
    await lists();
    await hubs(false);
    const from = await article();
    const target = await article();
    const other = await article();
    const src = await source(other.id);
    const proj = await project();
    const confirmedLink = await insert("regional_links", linkRow(["article", from.id], ["article", target.id], CONFIRMED));
    await insert("regional_links", linkRow(["article", from.id], ["article", other.id])); // 후보
    const removed = await insert("regional_links", linkRow(["article", from.id], ["official_source", src.id], CONFIRMED));
    await client.query("update public.regional_links set status = 'removed' where id = $1", [removed.id]);
    await insert("regional_links", linkRow(["article", from.id], ["project", proj.id], { ...CONFIRMED, relation: "related_project" }));
    await insert("regional_links", linkRow(["article", from.id], ["region", GU], { ...CONFIRMED, relation: "same_region" }));

    for (const role of ["anon", "authenticated"]) {
      const rows = await publicRows(from.id, role);
      assert.deepEqual(rows.map((r) => [r.to_type, r.to_id]), [["article", String(target.id)], ["project", String(proj.id)]], `${role} — 확인된 것만(후보·지운 것 0), 지역 끝은 region_hubs 꺼짐이라 0`);
      assert.deepEqual(Object.keys(rows[0]), PUBLIC_COLUMNS, "공개 칸 = 번호·종류·관계·확인 시각 — 이유·확인자·출처 0");
    }
    await hubs(true);
    assert.deepEqual((await publicRows(from.id)).map((r) => r.to_type), ["article", "project", "region"], "region_hubs 켜짐 → 지역 끝 보임");

    // 목적지가 비공개가 되면 다음 읽기부터 0 (404 링크 0)
    await client.query("update public.articles set status = 'draft' where id = $1", [target.id]);
    assert.deepEqual((await publicRows(from.id)).map((r) => r.to_type), ["project", "region"], "기사 목적지 초안 → 0");
    await client.query("update public.projects set status = 'hidden' where id = $1", [proj.id]);
    assert.deepEqual((await publicRows(from.id)).map((r) => r.to_type), ["region"], "프로젝트 숨김 → 0");
    await client.query("update public.regions set valid_to = (now() at time zone 'Asia/Seoul')::date - 1, successor_code = $2 where code = $1", [GU, GU2]);
    assert.deepEqual(await publicRows(from.id), [], "지역 폐지 → 0");
    // 되돌리면 다시 (확인 기록은 그대로)
    await client.query("update public.articles set status = 'published' where id = $1", [target.id]);
    assert.deepEqual((await publicRows(from.id)).map((r) => r.id), [confirmedLink.id], "다시 공개 → 다음 읽기부터 보임");
    // 출발이 비공개가 되어도 0 (그 화면이 없다)
    await client.query("update public.articles set status = 'draft' where id = $1", [from.id]);
    assert.deepEqual(await publicRows(from.id), [], "출발 기사 초안 → 0");
  }));

test("같은 지역 자동 후보 — 공개 대상·같은 지역만 · 종류 3 · 다시 돌려도 0 · 지운 후보는 다시 만들지 않음 · anon 0행", () =>
  tx(async () => {
    await regions();
    await people();
    await lists();
    const guA = await article({ region_codes: [GU] });
    const guB = await article({ region_codes: [GU], first_published_at: new Date(Date.now() - 7200_000).toISOString() });
    await article({ region_codes: [GU], status: "draft", first_published_at: null }); // 초안 — 후보 0
    await article({ region_codes: [GU2] }); // 이웃 — 시·군·구 프로젝트의 후보 0
    await article({ region_codes: [OTHER_GU] }); // 다른 시·도 — 0
    const sidoArticle = await article({ region_codes: [SIDO] });
    const guProject = await project({ region: GU });
    const gu2Project = await project({ region: GU2 });
    await project({ region: GU, publish: false }); // 초안 프로젝트 — 후보 0
    await project({ region: OTHER_GU });

    const suggest = async (type, id) => (await one("select public.regional_link_suggest($1, $2, $3) n", [type, String(id), ACTOR])).n;
    const candidates = async (type, id) =>
      (await client.query("select to_type, to_id, relation, origin, status, created_by from public.regional_links where from_type = $1 and from_id = $2 order by to_type, to_id", [type, String(id)])).rows;

    // 프로젝트(시·군·구) → 같은 시·군·구 공개 기사(최근 순) + 그 지역
    assert.equal(await suggest("project", guProject.id), 3);
    const pc = await candidates("project", guProject.id);
    assert.deepEqual(pc.map((r) => [r.to_type, r.to_id]), [["article", String(guA.id)], ["article", String(guB.id)], ["region", GU]].sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1])));
    assert.ok(pc.every((r) => r.relation === "same_region" && r.origin === "auto_candidate" && r.status === "candidate" && r.created_by === ACTOR));
    assert.equal(await suggest("project", guProject.id), 0, "다시 돌려도 0");
    await client.query("update public.regional_links set status = 'removed' where from_type = 'project' and from_id = $1 and to_type = 'article' and to_id = $2", [String(guProject.id), String(guA.id)]);
    assert.equal(await suggest("project", guProject.id), 0, "지운 후보는 다시 만들지 않는다");

    // 기사(시·도 태그) → 하위 시·군·구 공개 프로젝트 + 시·도 지역 / 기사(시·군·구) → 그 지역 프로젝트 + 지역
    assert.equal(await suggest("article", sidoArticle.id), 3);
    assert.deepEqual((await candidates("article", sidoArticle.id)).map((r) => [r.to_type, r.to_id]), [["project", String(guProject.id)], ["project", String(gu2Project.id)], ["region", SIDO]]);
    assert.equal(await suggest("article", guA.id), 2);
    assert.deepEqual((await candidates("article", guA.id)).map((r) => [r.to_type, r.to_id]), [["project", String(guProject.id)], ["region", GU]]);

    // 지역(시·도) → 범위 안 공개 프로젝트
    assert.equal(await suggest("region", SIDO), 2);
    assert.equal(await suggest("region", OTHER_GU), 1);

    for (const [args, msg] of [
      [["official_source", "1", ACTOR], /프로젝트·기사·지역에서만/],
      [["attraction", "1", ACTOR], /프로젝트·기사·지역에서만/],
      [["project", "abc", ACTOR], /번호 모양/],
      [["project", "999999999999", ACTOR], /프로젝트 999999999999가 없습니다/],
      [["region", "9909900000", ACTOR], /지역 9909900000가 없습니다/],
      [["article", String(guA.id), " "], /찾는 사람이 필요합니다/],
    ]) {
      const r = await attempt("select public.regional_link_suggest($1, $2, $3)", args);
      assert.equal(r.ok, false, args.join(","));
      assert.match(r.message, msg, args.join(","));
    }
    // 자동 후보는 편집 화면에만 — anon·authenticated 공개 뷰 0행
    for (const role of ["anon", "authenticated"]) {
      const r = await attempt("select count(*)::int n from public.public_regional_links where from_id = any($1)", [[String(guProject.id), String(sidoArticle.id), String(guA.id), SIDO]], role);
      assert.equal(r.rows[0].n, 0, role);
    }
  }));

test("권한 — anon·authenticated: 표·판정 뷰 42501 · 쓰기 0 · 함수 실행 0 · 공개 뷰만 읽기 / service_role: 표 전권·판정 뷰·후보 함수", () =>
  tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const rel of ["regional_links", "regional_link_status"]) {
        const r = await attempt(`select * from public.${rel} limit 1`, [], role);
        assert.equal(r.code, "42501", `${role} ${rel}`);
      }
      const w = await attempt("insert into public.regional_links (from_type, from_id, to_type, to_id, relation, origin, created_by) values ('article', '1', 'article', '2', 'same_region', 'editor', 'x')", [], role);
      assert.equal(w.code, "42501", `${role} 쓰기`);
      for (const fn of ["regional_link_suggest('article', '1', 'x')", "regional_link_ref_exists('article', '1')"]) {
        const r = await attempt(`select public.${fn}`, [], role);
        assert.equal(r.code, "42501", `${role} ${fn}`);
      }
      assert.ok((await attempt("select count(*) from public.public_regional_links", [], role)).ok, `${role} 공개 뷰`);
    }
    const { rows } = await client.query(
      "select has_table_privilege('service_role', 'public.regional_links', 'SELECT,INSERT,UPDATE,DELETE') t, has_table_privilege('service_role', 'public.regional_link_status', 'SELECT') v, has_function_privilege('service_role', 'public.regional_link_suggest(text,text,text)', 'EXECUTE') f",
    );
    assert.deepEqual(rows[0], { t: true, v: true, f: true });
    const rls = await one("select relrowsecurity from pg_class where oid = 'public.regional_links'::regclass");
    assert.equal(rls.relrowsecurity, true, "RLS 켜짐 (기본 거부)");
  }));
