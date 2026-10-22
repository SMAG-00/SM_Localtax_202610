// W4 15단계 DB — 프로젝트 공개 화면·검색 (docs/dev/W4_설계.md 1장 15단계 · 2.1 search.kind · 2.4 · 12장 #99 · #120~, 마이그레이션 20261023000049 · PRD-01B PR-02 · PR-05)
// 사업 유형·단계 목록·지역·프로젝트·고시는 모두 시험용 가짜다(지역 접두 99, '시험용' 이름 — 설계 8장). 모든 시험은 트랜잭션 안에서 하고 되돌린다.
//  · 값 — 기능 키 realestate_projects 씨앗 false(2.4 신규) · 검색 함수 c_kinds = 2.1 search.kind(project 맨 뒤) · 새 공개 뷰 칸 정확 비교 · 가격 사전 낱말 칸 0
//  · 검색(anon) — 기능 키 꺼짐 0행 · 켜짐 공개 프로젝트만(초안·숨김·공개 단계를 거둔 프로젝트 0) · 이름·요약 낱말 · 등급 0·1·2 · 고친 이름을 다음 검색부터 ·
//    거르개(분야·기사 유형·지역 시·도 하위 포함·기간 = 현재 단계 고시일) · 결과 칸(분야·날짜·meta — 가격 칸 0) · 다른 종류 결과 그대로
//  · 전체 단계 목록 뷰 — 공개 프로젝트가 쓰는 유형만 · 기록 없는 단계까지 차례대로 · 목록 순서를 바꾸면 다음 읽기부터 · 공개 프로젝트가 없으면 0행
//  · 권한 — anon은 projects 표(찾는 글 칸 포함) 42501 · 새 뷰 읽기만(쓰기 42501)
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

const TYPES = { siheom_ps: { label: "시험용 정비" }, siheom_pt: { label: "시험용 소규모" }, siheom_pu: { label: "시험용 안 쓰는 유형" } };
const LISTS = {
  siheom_ps: [
    { key: "zone", label: "시험용 구역지정" },
    { key: "plan", label: "시험용 계획인가" },
    { key: "build", label: "시험용 착공" },
    { key: "done", label: "시험용 준공" },
  ],
  siheom_pt: [
    { key: "zone", label: "시험용 소규모 구역" },
    { key: "done", label: "시험용 소규모 준공" },
  ],
  siheom_pu: [
    { key: "zone", label: "시험용 안 쓰는 구역" },
    { key: "done", label: "시험용 안 쓰는 준공" },
  ],
};
const SEARCH_COLUMNS = ["id", "slug", "name", "region_code", "landmark", "current_stage_notice_date", "search_text", "search_names"];
const STAGE_LIST_COLUMNS = ["project_type", "stage_position", "stage", "stage_label"];
const ACTOR = "user:w4ps-test";
const SIG = "text, text[], text, text, text, date, date, integer, integer, integer";

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
const hashOf = (t) => `sha256:${createHash("sha256").update(t).digest("hex")}`;
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const setSetting = async (key, value) => assert.ok((await attempt("update public.settings set value = $1::jsonb where key = $2", [JSON.stringify(value), key])).ok, key);
const flag = async (on) => client.query("update public.settings set value = value || jsonb_build_object('realestate_projects', $1::boolean) where key = 'feature_flags'", [on]);

/** anon으로 검색 — 결과 행 */
async function search(q, o = {}) {
  const r = await attempt(`select * from public.search_public($1, $2, $3, $4, $5, $6, $7, $8, 0, null)`, [q, o.kinds ?? null, o.section ?? null, o.contentType ?? null, o.region ?? null, o.from ?? null, o.to ?? null, o.limit ?? 50], "anon");
  assert.ok(r.ok, r.message);
  return r.rows;
}
const projectRefs = (rows) => rows.filter((r) => r.kind === "project").map((r) => Number(r.ref));

/** 시험용 지역 → 사업 유형·단계 목록 (다른 W4 DB 시험과 같은 차례 — 지역 먼저, 설정 다음. 차례가 다르면 함께 돌 때 잠금이 엇갈린다) */
async function seedBase() {
  await client.query("insert into public.regions (code, level, name, slug) values ('9900000000', 'sido', '시험용 검색도', 'siheom-ps-do')");
  await client.query(
    "insert into public.regions (code, parent_code, level, name, slug) values ('9901100000', '9900000000', 'sigungu', '시험용 검색구', 'siheom-ps-gu'), ('9901200000', '9900000000', 'sigungu', '시험용 옆구', 'siheom-ps-yeop')",
  );
  await setSetting("project_types", TYPES);
  await setSetting("project_stage_lists", LISTS);
}

/** 시험 세계 — 시험용 시·도 1 + 시·군·구 2 · 공개 프로젝트 2(시·군·구·시·도) · 초안 1 · 숨김 1 */
async function seed({ base = true } = {}) {
  if (base) await seedBase();
  const make = async (key, over = {}) => {
    const p = await one(
      "insert into public.projects (slug, name, summary, region_code, project_type, landmark, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [uniq(`siheom-ps-${key}`), over.name, over.summary, over.region ?? "9901100000", over.type ?? "siheom_ps", over.landmark ?? false, ACTOR],
    );
    const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('시험용', $1, $2, '시험용 고시') returning id", [`https://gasang.example/ps/${key}`, hashOf(key)]);
    const e = await one(
      "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', 'zone', '시험용 고시 제1호', $2, '시험용 검색구청', $3, $4, 'kogl_1', $5) returning id",
      [p.id, over.noticeDate ?? "2026-02-10", `https://gasang.example/ps/${key}`, snap.id, ACTOR],
    );
    if (over.status !== "draft") await client.query("update public.projects set status = 'public', source_name = '시험용 검색구청', last_verified_at = now() where id = $1", [p.id]);
    if (over.status === "hidden") await client.query("update public.projects set status = 'hidden' where id = $1", [p.id]);
    return { id: Number(p.id), eventId: Number(e.id) };
  };
  return {
    gu: await make("ga", { name: "시험용 누리가구역 정비", summary: "시험용 요약 하늘가마을 단계" }),
    sido: await make("na", { name: "시험용 누리나구역 정비", summary: "시험용 요약 하늘나마을", region: "9900000000", type: "siheom_pt", noticeDate: "2026-05-20", landmark: true }),
    draft: await make("da", { name: "시험용 누리다구역 정비", summary: "시험용 요약 하늘다마을", status: "draft" }),
    hidden: await make("ra", { name: "시험용 누리라구역 정비", summary: "시험용 요약 하늘라마을", status: "hidden" }),
  };
}

test("값 — 기능 키 realestate_projects 씨앗 false(2.4 신규) · c_kinds = 2.1 search.kind · 새 공개 뷰 칸 · 가격 사전 칸 0", async () => {
  assert.ok(line("| `realestate_projects` (신규) |"));
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.equal(flags.realestate_projects, false, "꺼진 채로 넣는다 (2.4 — 켜기 조건: 사업 유형·단계 목록 감수 + 공개 프로젝트 1건 이상)");
  const kinds = codes("| search.kind (W2-d + 15단계) |");
  assert.equal(kinds.at(-1), "project");
  const src = (await one(`select pg_get_functiondef('public.search_public(${SIG})'::regprocedure) d`)).d;
  const arr = src.match(/c_kinds constant text\[\] := array\[([^\]]+)\]/);
  assert.deepEqual([...arr[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), kinds);
  const cols = async (v) => (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [v])).rows.map((r) => r.column_name);
  assert.deepEqual(await cols("public_project_search"), SEARCH_COLUMNS);
  assert.deepEqual(await cols("public_project_stage_lists"), STAGE_LIST_COLUMNS);
  assert.equal(PRICE_WORDS.length, 16);
  for (const c of [...SEARCH_COLUMNS, ...STAGE_LIST_COLUMNS]) assert.deepEqual(priceWordsIn(c), [], c);
  const r = await scanPriceFields(client);
  for (const rel of ["public_project_search", "public_project_stage_lists"]) assert.ok(r.relations.includes(rel), `가격 칸 검사가 ${rel}를 본다 (대상 표를 읽는 뷰)`);
  assert.deepEqual(r.hits, []);
});

test("검색 — 기능 키 꺼짐 0행 · 켜짐 공개 프로젝트만(초안·숨김 0) · 이름·요약 낱말 · 결과 칸 · 등급", () =>
  tx(async () => {
    const w = await seed();
    await flag(false);
    assert.deepEqual(projectRefs(await search("시험용 누리")), [], "꺼짐 — 프로젝트 0");
    assert.deepEqual((await attempt("select count(*)::int n from public.public_project_search", [], "anon")).rows[0].n, 0, "꺼짐 — 검색 뷰 0행");
    await flag(true);
    const rows = await search("시험용 누리");
    assert.deepEqual(projectRefs(rows).sort((a, b) => a - b), [w.gu.id, w.sido.id], "공개 2 — 초안·숨김 0");
    const hit = rows.find((r) => Number(r.ref) === w.gu.id);
    assert.match(hit.slug, /^siheom-ps-ga-/);
    assert.equal(hit.title, "시험용 누리가구역 정비");
    assert.equal(hit.snippet, "시험용 요약 하늘가마을 단계");
    assert.equal(hit.section, "realestate");
    assert.equal(hit.content_type, null);
    assert.equal(new Date(hit.published_at).toISOString(), "2026-02-09T15:00:00.000Z", "날짜 = 현재 단계 고시일(KST 자정)");
    assert.deepEqual(Object.keys(hit.meta).sort(), ["landmark", "project_type", "project_type_label", "region_code", "stage", "stage_label", "stage_on"]);
    assert.deepEqual(hit.meta, { stage: "zone", stage_label: "시험용 구역지정", stage_on: "2026-02-10", project_type: "siheom_ps", project_type_label: "시험용 정비", region_code: "9901100000", landmark: false });
    for (const k of Object.keys(hit.meta)) assert.deepEqual(priceWordsIn(k), [], `meta 칸 ${k}`);
    assert.equal(hit.kind_counts.project, 2);
    // 요약 낱말로도 찾는다 · 등급 — 이름 같음 0 · 이름에 있음 1 · 요약에만 2
    assert.deepEqual(projectRefs(await search("하늘가마을")), [w.gu.id]);
    assert.equal((await search("시험용 누리가구역 정비")).find((r) => r.kind === "project").tier, 0);
    assert.equal((await search("누리가구역")).find((r) => r.kind === "project").tier, 1);
    assert.equal((await search("하늘가마을")).find((r) => r.kind === "project").tier, 2);
    // 고친 이름을 다음 검색부터 (생성 칸)
    await client.query("update public.projects set name = '시험용 바다가구역 정비' where id = $1", [w.gu.id]);
    assert.deepEqual(projectRefs(await search("바다가구역")), [w.gu.id]);
    assert.deepEqual(projectRefs(await search("누리가구역")), []);
    // 공개 중 마지막 공개 단계를 거두면 공개 뷰에서 빠진다(#93) → 검색 0
    await client.query("insert into public.project_events (project_id, kind, correction_of, reason, recorded_by) values ($1, 'correction', $2, '시험용 거두기', $3)", [w.gu.id, w.gu.eventId, ACTOR]);
    assert.deepEqual(projectRefs(await search("바다가구역")), []);
    // 내리기(hidden) → 0
    await client.query("update public.projects set status = 'hidden' where id = $1", [w.sido.id]);
    assert.deepEqual(projectRefs(await search("시험용 누리")), []);
  }));

test("검색 거르개 — 분야·기사 유형·지역(시·도는 하위 포함)·기간(현재 단계 고시일) · 종류 거르개 · 다른 종류 결과 그대로", () =>
  tx(async () => {
    const w = await seed();
    await flag(true);
    const q = "시험용 누리";
    assert.deepEqual(projectRefs(await search(q, { section: "realestate" })).length, 2);
    assert.deepEqual(projectRefs(await search(q, { section: "tax" })), []);
    assert.deepEqual(projectRefs(await search(q, { contentType: "reported_news" })), [], "기사 유형을 고르면 기사만");
    assert.deepEqual(projectRefs(await search(q, { region: "9900000000" })).sort((a, b) => a - b), [w.gu.id, w.sido.id], "시·도 = 자기 + 하위");
    assert.deepEqual(projectRefs(await search(q, { region: "9901100000" })), [w.gu.id]);
    assert.deepEqual(projectRefs(await search(q, { region: "9901200000" })), []);
    assert.deepEqual(projectRefs(await search(q, { region: "1100000000" })), [], "다른 시·도 0");
    assert.deepEqual(projectRefs(await search(q, { from: "2026-02-10", to: "2026-02-10" })), [w.gu.id], "고시일 당일 포함");
    assert.deepEqual(projectRefs(await search(q, { from: "2026-02-11" })), [w.sido.id]);
    assert.deepEqual(projectRefs(await search(q, { to: "2026-02-09" })), []);
    const only = await search(q, { kinds: ["project"] });
    assert.ok(only.length === 2 && only.every((r) => r.kind === "project"), "종류 거르개 project");
    assert.deepEqual(projectRefs(await search(q, { kinds: ["tracker"] })), [], "개정 트래커 종류만 고르면 0");
    // 대표 프로젝트가 같은 등급·같은 날짜 안에서 앞 — 날짜가 다르면 날짜 순(최신 먼저)
    assert.deepEqual(projectRefs(only), [w.sido.id, w.gu.id]);
    // 다른 종류는 그대로 — 지역 이름 검색은 지역 결과(등급 0)
    const region = await search("시험용 검색구");
    assert.ok(region.some((r) => r.kind === "region" && r.ref === "9901100000" && r.tier === 0), "지역 결과 그대로");
  }));

test("전체 단계 목록 뷰 — 공개 프로젝트가 쓰는 유형만 · 기록 없는 단계까지 차례 · 목록 순서를 바꾸면 다음 읽기부터", () =>
  tx(async () => {
    const read = async () => (await attempt("select * from public.public_project_stage_lists where project_type like 'siheom_p%' order by project_type, stage_position", [], "anon")).rows;
    await seedBase();
    assert.deepEqual(await read(), [], "공개 프로젝트가 없으면 0행");
    const w = await seed({ base: false });
    const rows = await read();
    assert.deepEqual(
      rows.map((r) => [r.project_type, r.stage_position, r.stage, r.stage_label]),
      [
        ["siheom_ps", 1, "zone", "시험용 구역지정"],
        ["siheom_ps", 2, "plan", "시험용 계획인가"],
        ["siheom_ps", 3, "build", "시험용 착공"],
        ["siheom_ps", 4, "done", "시험용 준공"],
        ["siheom_pt", 1, "zone", "시험용 소규모 구역"],
        ["siheom_pt", 2, "done", "시험용 소규모 준공"],
      ],
      "안 쓰는 유형(siheom_pu)·초안·숨김만 쓰는 유형 0 · 기록 없는 단계(계획·착공·준공)도",
    );
    await setSetting("project_stage_lists", { ...LISTS, siheom_ps: [LISTS.siheom_ps[0], LISTS.siheom_ps[2], LISTS.siheom_ps[1], LISTS.siheom_ps[3]] });
    assert.deepEqual((await read()).filter((r) => r.project_type === "siheom_ps").map((r) => r.stage), ["zone", "build", "plan", "done"], "순서를 바꾸면 다음 읽기부터");
    await client.query("update public.projects set status = 'hidden' where id = any($1::bigint[])", [[w.gu.id, w.sido.id]]);
    assert.deepEqual(await read(), [], "공개 프로젝트를 내리면 0행");
  }));

test("권한 — anon은 projects 표(찾는 글 칸 포함) 42501 · 새 뷰 읽기만 · 새 anon 실행 함수 0", () =>
  tx(async () => {
    await seed();
    await flag(true);
    for (const role of ["anon", "authenticated"]) {
      for (const sql of ["select id from public.projects limit 1", "select search_text from public.projects limit 1", "select search_names from public.projects limit 1"]) {
        assert.equal((await attempt(sql, [], role)).code, "42501", `${role}: ${sql}`);
      }
      assert.ok((await attempt("select count(*) from public.public_project_search", [], role)).ok);
      assert.ok((await attempt("select count(*) from public.public_project_stage_lists", [], role)).ok);
      for (const view of ["public_project_search", "public_project_stage_lists"]) {
        for (const priv of ["insert", "update", "delete"]) {
          assert.equal((await one("select has_table_privilege($1, $2, $3) ok", [role, `public.${view}`, priv])).ok, false, `${role}: ${view} ${priv} 권한 0`);
        }
      }
      for (const sql of ["insert into public.public_project_search (id) values (1)", "delete from public.public_project_search", "update public.public_project_stage_lists set stage_label = 'x'"]) {
        assert.equal((await attempt(sql, [], role)).ok, false, `${role}: ${sql} 거부`);
      }
    }
    const anonFns = (
      await client.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
          order by 1`,
      )
    ).rows.map((r) => r.proname);
    for (const f of ["search_public", "search_classify"]) assert.ok(anonFns.includes(f), f);
    assert.ok(!anonFns.some((f) => /project/.test(f)), `프로젝트 함수 anon 실행 0 — ${anonFns.filter((f) => /project/.test(f)).join(",")}`);
  }));
