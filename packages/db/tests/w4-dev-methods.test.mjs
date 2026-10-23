// W4 18단계 DB — 개발방법 DB (docs/dev/W4_설계.md 1장 18단계 · 2.1 · 2.4 · 2.11 · 2.13 · 3장 · 12장 #151~, 마이그레이션 20261023000052 · PRD-01B PR-09 · PR-10 · PR-11)
// 개발방법 내용·숫자 요건 값·법령 문구는 모두 시험용 가짜다('시험용' 글 — 설계 8장). 실제 요건 값·법령 조건 0. 모든 시험은 트랜잭션 안에서 하고 되돌린다.
//  · 값 — slug·종류·비교 항목·감수 상태·자리 채움 = 2.1 · 씨앗 7행 = PRD-01B 3.2 화면 초안 이름·고정 순서, 신속통합기획만 planning_support(사업 유형 6개) · 내용 빈 값
//  · 7행 고정 — 더하기·지우기·slug·이름·종류·순서 바꾸기 거부
//  · 점수·순위 칸 0 — 2.13 사전 = 설계 줄 · 실제 DB 위반 0 · 위반 칸 이름·한글 칸·칸 설명·뷰를 넣으면 검사가 잡는다
//  · 금지 표현 사전 새 판 — 2.11 낱말 6개 · 기존 낱말 그대로 · '시험용 방식이 유리합니다' 저장 거부(방법·비교 항목·사실 행)
//  · 저장 검사 — 절차 단계 모양 · 자리 채움 글 거부 · 박스 모양(16단계와 같은 한도)·세액 표현 · 숫자 요건 표현은 경고(저장됨)
//  · 서명 흐름 — 방법·비교 항목: 새 행·내용과 함께 서명 0 · reviewer만 · 한 줄 설명·절차 전 서명 0 · 고치면 서명 지움(rereview_needed) · 상태만 바꾸기 0
//  · 사실 행 — 새 판 + 사유, 옛 판 그대로 · 고치기·지우기 0 · 최신 판만 고친다 · 같은 열쇠 첫 판 두 번 0 · 서명은 최신 판·기준일·reviewer
//  · 공개 준비·기능 키 — 서명·6칸 없이 켜기 거부(사유에 방법 slug) · 켜진 뒤 칸 하나 고치면 그 방법만 0 · reviewer를 잃으면 0
//  · 공개 사실 행 — 서명 전 0 · 기준일 없음 0(서명도 거부) · 서명자 공개 이름 없음 0 · 새 판은 서명 뒤에만, 옛 판으로 대신 0
//  · 원문 다시 받기 — 최신 판 해시 바뀜 → 큐 1건(dev_method_fact) · 옛 판 0 · 같은 해시 0 · 같은 새 해시 다시 0 · 공개 뷰 under_review
//  · 권한 — anon은 표·준비 판정 뷰 42501 · 공개 뷰는 읽기만 · 새 함수 anon 실행 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";
import { RANK_TABLES, RANK_WORDS, rankWordsIn, scanRankFields } from "../scripts/check-rank-fields.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(HERE, "..", "..", "..", "docs");
const DESIGN = fs.readFileSync(path.join(DOCS, "dev", "W4_설계.md"), "utf8");
const PRD01B = fs.readFileSync(path.join(DOCS, "PRD", "PRD-01B_1단계_4대분야_콘텐츠.md"), "utf8");
const lines = DESIGN.split("\n");
const line = (prefix) => {
  const l = lines.find((x) => x.startsWith(prefix));
  assert.ok(l, `설계 문서에 '${prefix}' 줄이 없다`);
  return l;
};
const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const codes = (prefix) => ticks(line(prefix).split("|")[2]);

const ITEMS = ["legal_basis", "actor", "target", "procedure", "numeric_requirements", "tax_issues"];
const ACTOR = "user:w4dm-test";
const URL_A = "https://gasang.example/dm/law-a";

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
const all = async (sql, params) => (await client.query(sql, params)).rows;
const authUser = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
async function staffUser(role, person = null) {
  const id = await authUser();
  if (role) await client.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, $2, 'admin:test')", [id, role]);
  if (person) await client.query("insert into public.people (slug, name, roles, staff_user_id, visibility) values ($1, $2, array['reviewer'], $3, $4)", [`siheom-dm-${id.slice(0, 8)}`, person.name, id, person.visibility ?? "public"]);
  return id;
}
const methodId = async (slug) => Number((await one("select id from public.dev_methods where slug = $1", [slug])).id);
const flag = (on) => attempt("update public.settings set value = value || jsonb_build_object('dev_methods', $1::boolean) where key = 'feature_flags'", [on]);
async function withNotices(fn) {
  const notices = [];
  const onNotice = (n) => notices.push(n.message);
  client.on("notice", onNotice);
  try {
    const r = await fn();
    return { r, notices };
  } finally {
    client.off("notice", onNotice);
  }
}

/** 시험용 방법 내용 — 실제 법령·요건 0 */
const CONTENT = { legal_basis_name: "시험용 근거 법령", summary: "시험용 한 줄 설명", steps: ["시험용 첫 단계", "시험용 둘째 단계"] };
const LENS = (over = {}) => ({ topics: ["시험용 세목"], points: ["시험용 포인트"], links: [{ kind: "explainer", label: "시험용 해설", url: "/tax" }], base_date: "2026-01-01", ...over });
const draftMethod = (slug, c = CONTENT, lens = null) =>
  attempt("update public.dev_methods set legal_basis_name = $2, summary = $3, steps = $4::jsonb, lens = $5::jsonb, drafted_by = $6 where slug = $1 returning *", [
    slug,
    c.legal_basis_name ?? null,
    c.summary ?? null,
    c.steps === undefined || c.steps === null ? null : JSON.stringify(c.steps),
    lens === null ? null : JSON.stringify(lens),
    ACTOR,
  ]);
const signMethod = (slug, userId) => attempt("update public.dev_methods set reviewed_by = $2 where slug = $1 returning *", [slug, `user:${userId}`]);
const putItem = async (slug, item, body) =>
  attempt("insert into public.dev_method_compare (method_id, item, body, drafted_by) values ($1, $2, $3, $4) returning *", [await methodId(slug), item, body, ACTOR]);
const editItem = async (slug, item, set, params = []) =>
  attempt(`update public.dev_method_compare set ${set} where method_id = $1 and item = $2 returning *`, [await methodId(slug), item, ...params]);
const signItem = (slug, item, userId) => editItem(slug, item, "reviewed_by = $3", [`user:${userId}`]);
async function snapshot(url = URL_A, text = "시험용 근거 원문") {
  return Number((await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('시험용', $1, $2, $3) returning id", [url, hashOf(text), text])).id);
}
async function putFact(slug, over = {}) {
  const snap = over.snapshot_id ?? (await snapshot(over.source_url ?? URL_A));
  return attempt(
    `insert into public.dev_method_facts (method_id, fact_key, label, value, unit, law_ref, reference_date, source_url, snapshot_id, supersedes_id, reason, recorded_by, version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
    [
      await methodId(slug),
      over.fact_key ?? "siheom_req",
      over.label ?? "시험용 요건",
      over.value ?? "시험용 99",
      over.unit === undefined ? "시험용 단위" : over.unit,
      over.law_ref ?? "시험용 조문",
      over.reference_date === undefined ? "2026-01-01" : over.reference_date,
      over.source_url ?? URL_A,
      snap,
      over.supersedes_id ?? null,
      over.reason ?? null,
      ACTOR,
      over.version ?? 1,
    ],
  );
}
const signFact = (id, userId) => attempt("update public.dev_method_facts set reviewed_by = $2 where id = $1 returning *", [id, `user:${userId}`]);

/** 7개 방법 모두 시험용 내용 + 6칸 + 서명 — 공개 준비 */
async function readyAll(reviewer, except = []) {
  for (const { slug } of await all("select slug from public.dev_methods order by sort")) {
    assert.ok((await draftMethod(slug)).ok, slug);
    for (const item of ITEMS) {
      assert.ok((await putItem(slug, item, `시험용 ${item} 글`)).ok, `${slug} ${item}`);
      if (!except.includes(`${slug}:${item}`)) assert.ok((await signItem(slug, item, reviewer)).ok, `${slug} ${item} 서명`);
    }
    const s = await signMethod(slug, reviewer);
    assert.ok(s.ok, s.message);
  }
}

test("값 = 2.1 · 씨앗 7행 = PRD-01B 3.2 화면 초안 이름·고정 순서 · 신속통합기획만 계획 지원 절차(사업 유형 6개) · 내용 빈 값 · 표 칸 = 3장", async () => {
  const slugs = codes("| dev_method.slug ");
  assert.equal(slugs.length, 7);
  const names = codes("| dev_method.name ");
  const prd = PRD01B.split("\n").find((l) => /^방법\s+재개발/.test(l));
  assert.ok(prd, "PRD-01B 3.2 화면 초안의 '방법' 줄이 없다");
  assert.match(prd, /신속통합기획 \[계획 지원 절차\]/);
  assert.deepEqual(
    prd
      .replace(/^방법\s+/, "")
      .split(" · ")
      .map((s) => s.replace(/\s*\[[^\]]+\]\s*$/, "").trim()),
    names,
    "설계 2.1 이름 = PRD 화면 초안 글자",
  );
  const rows = await all("select slug, name, kind, sort, legal_basis_name, summary, steps, lens, drafted_by, drafted_at, reviewed_by, reviewed_at, review_status from public.dev_methods order by sort");
  assert.deepEqual(rows.map((r) => r.slug), slugs, "고정 편집 순서 = 2.1 slug 순서");
  assert.deepEqual(rows.map((r) => r.name), names);
  assert.deepEqual(rows.map((r) => r.sort), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(rows.filter((r) => r.kind === "planning_support").map((r) => r.slug), ["rapid-planning"], "계획 지원 절차는 신속통합기획 하나");
  assert.equal(rows.filter((r) => r.kind === "project_type").length, 6, "사업 유형 개수 집계에 신속통합기획이 들지 않는다");
  assert.deepEqual([...new Set(rows.map((r) => r.kind))].sort(), [...codes("| dev_method.kind ")].sort());
  for (const r of rows) {
    assert.deepEqual([r.legal_basis_name, r.summary, r.steps, r.lens, r.drafted_by, r.drafted_at, r.reviewed_by, r.reviewed_at, r.review_status], [null, null, null, null, null, null, null, null, "draft"], `${r.slug} 내용은 빈 값`);
  }
  assert.equal(Number((await one("select count(*)::int n from public.dev_method_compare")).n), 0, "비교 항목 씨앗 0");
  assert.equal(Number((await one("select count(*)::int n from public.dev_method_facts")).n), 0, "사실 행 씨앗 0");
  assert.deepEqual((await all("select * from public.public_dev_methods")).length, 0, "씨앗만으로 공개 0");
  // 값 목록 — DB check가 2.1 밖 값을 거부한다
  const checks = (await all("select pg_get_constraintdef(oid) d from pg_constraint where conrelid in ('public.dev_methods'::regclass, 'public.dev_method_compare'::regclass)")).map((r) => r.d).join("\n");
  for (const v of [...slugs, ...codes("| dev_method.compare_item "), ...codes("| dev_method.review_status ")]) assert.ok(checks.includes(`'${v}'`), `DB check에 ${v}`);
  // 3장 칸 (53단계 special_law_basis 제외)
  const cols = async (t) => (await all("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [t])).map((r) => r.column_name);
  for (const t of ["dev_methods", "dev_method_compare", "dev_method_facts"]) {
    const row = line(`| \`${t}\` (52)`).split("|")[2];
    const want = row
      .split("·")
      .map((s) => s.trim())
      .filter((s) => s && !s.includes("(53)"))
      .flatMap((s) => (s.endsWith("/at") ? [s.replace("/at", ""), s.replace(/_by\/at$/, "_at")] : [s.replace(/\(json\)$/, "")]));
    const have = await cols(t);
    for (const c of want) assert.ok(have.includes(c), `${t}.${c} (3장)`);
  }
});

test("7행 고정 — 더하기·지우기·slug·이름·종류·순서 바꾸기 거부", () =>
  tx(async () => {
    const add = await attempt("insert into public.dev_methods (slug, name, kind, sort) values ('trust', '시험용 방법', 'project_type', 8)");
    assert.equal(add.ok, false);
    assert.match(add.message, /정확히 7행/);
    const del = await attempt("delete from public.dev_methods where slug = 'renewal'");
    assert.equal(del.ok, false);
    assert.match(del.message, /정확히 7행/);
    assert.equal((await attempt("truncate public.dev_methods cascade")).ok, false, "비우기 거부");
    for (const set of ["slug = 'renewal'", "name = '시험용 이름'", "kind = 'planning_support'", "sort = 7"]) {
      const r = await attempt(`update public.dev_methods set ${set} where slug = 'redevelopment'`);
      assert.equal(r.ok, false, set);
    }
    // 제약도 순서·종류를 묶는다 (트리거를 건너뛴 쓰기 — 설계 8장)
    await client.query("alter table public.dev_methods disable trigger dev_methods_guard");
    assert.equal((await attempt("update public.dev_methods set sort = 9 where slug = 'redevelopment'")).ok, false, "순서 제약");
    assert.equal((await attempt("update public.dev_methods set kind = 'project_type' where slug = 'rapid-planning'")).ok, false, "종류 제약");
    await client.query("alter table public.dev_methods enable trigger dev_methods_guard");
  }));

test("점수·순위 칸 0 — 2.13 사전 = 설계 줄 · 실제 DB 위반 0 · 위반 칸·한글 칸·칸 설명·뷰를 넣으면 잡는다", async () => {
  const head = lines.findIndex((l) => l.startsWith("### 2.13 점수·순위 칸 검사 사전"));
  assert.ok(head >= 0, "설계 문서에 2.13 머리가 없다");
  const body = lines.slice(head + 1).find((l) => l.startsWith("낱말("));
  assert.deepEqual(ticks(body.split("판정 방식")[0]), [...RANK_WORDS]);
  assert.deepEqual(ticks(lines[head]).filter((w) => RANK_TABLES.includes(w)), [...RANK_TABLES]);
  assert.deepEqual(ticks(lines[head]).filter((w) => w.startsWith("dev_method")), [...RANK_TABLES], "머리의 표 이름 = 대상 표");
  assert.deepEqual(rankWordsIn("Expert_Score"), ["score"]);
  assert.deepEqual(rankWordsIn("re_commend_flag"), ["recommend"], "밑줄로 쪼개도 잡는다");
  assert.deepEqual(rankWordsIn("방식_순위"), ["순위"]);
  for (const ok of ["sort", "slug", "kind", "summary", "steps", "lens", "review_status", "reference_date", "item_position", "under_review", "fact_key", "law_ref"]) assert.deepEqual(rankWordsIn(ok), [], ok);

  const real = await scanRankFields(client);
  for (const rel of ["dev_methods", "dev_method_compare", "dev_method_facts", "dev_method_readiness", "public_dev_methods", "public_dev_method_compare", "public_dev_method_facts"]) {
    assert.ok(real.relations.includes(rel), `${rel}를 보지 않았다`);
  }
  assert.deepEqual(real.missingTables, []);
  assert.deepEqual(real.hits, []);

  const probes = [
    ["칸 이름 (expert_score)", "alter table public.dev_methods add column expert_score integer", ["dev_methods", "expert_score", "name"]],
    ["대소문자 섞인 칸 (Best_Pick)", 'alter table public.dev_method_compare add column "Best_Pick" boolean', ["dev_method_compare", "Best_Pick", "name"]],
    ["한글 칸 (순위)", 'alter table public.dev_method_facts add column "방식순위" integer', ["dev_method_facts", "방식순위", "name"]],
    ["칸 설명 (추천)", "comment on column public.dev_method_facts.label is '시험용 추천 표시'", ["dev_method_facts", "label", "comment"]],
    ["뷰 칸 (rank)", "create view public.w4_rank_probe as select p.slug, 1 as method_rank from public.public_dev_methods p", ["w4_rank_probe", "method_rank", "name"]],
  ];
  for (const [what, ddl, [rel, col, where]] of probes) {
    await tx(async () => {
      await client.query(ddl);
      const r = await scanRankFields(client);
      assert.ok(r.hits.some((h) => h.relation === rel && h.column === col && h.where === where), `${what}를 잡지 못했다 — ${JSON.stringify(r.hits)}`);
    });
  }
});

test("금지 표현 사전 새 판 — 2.11 낱말 6개 · 기존 낱말 그대로 · 중복 0 · '시험용 방식이 유리합니다' 저장 거부", () =>
  tx(async () => {
    const head = lines.findIndex((l) => l.startsWith("### 2.11 추천·유리 단정 표현"));
    const words = ticks(lines[head + 2].split(".")[0]);
    assert.deepEqual(words, ["방식이 유리", "방식을 추천", "추천 방식", "가장 좋은 방식", "이 구역에 맞는 방식", "유리합니다"]);
    const dict = (await one("select value from public.settings where key = 'forbidden_phrases'")).value;
    for (const w of [...words, "무료 상담", "투자 추천", "현지 1위"]) assert.ok(dict.phrases.includes(w), w);
    assert.equal(new Set(dict.phrases).size, dict.phrases.length, "중복 0");
    assert.equal(dict.version, "2026-10-23.1");

    const reviewer = await staffUser("reviewer");
    const m = await draftMethod("redevelopment", { ...CONTENT, summary: "시험용 방식이 유리합니다" });
    assert.equal(m.ok, false);
    assert.match(m.message, /금지 표현 .*PR-11/);
    const step = await draftMethod("redevelopment", { ...CONTENT, steps: ["시험용 단계", "가장 좋은 방식 단계"] });
    assert.equal(step.ok, false, "절차 단계도 같은 사전");
    const lens = await draftMethod("redevelopment", CONTENT, LENS({ points: ["이 구역에 맞는 방식입니다"] }));
    assert.equal(lens.ok, false, "박스도 같은 사전");
    const item = await putItem("reconstruction", "actor", "시험용 방식을 추천합니다");
    assert.equal(item.ok, false);
    assert.match(item.message, /금지 표현/);
    assert.ok((await putItem("reconstruction", "actor", "시험용 사업 주체 글")).ok);
    const itemEdit = await editItem("reconstruction", "actor", "body = '시험용 추천 방식'");
    assert.equal(itemEdit.ok, false, "고치기도 같은 사전");
    const fact = await putFact("trust", { label: "시험용 방식이 유리" });
    assert.equal(fact.ok, false);
    assert.match(fact.message, /금지 표현/);
    // 띄어쓰기를 늘려도 잡는다 (공백 정리) · 사전 밖 말은 저장된다
    assert.equal((await draftMethod("redevelopment", { ...CONTENT, summary: "시험용  방식이   유리" })).ok, false, "공백 여러 칸 = 한 칸");
    assert.equal((await draftMethod("redevelopment", { ...CONTENT, summary: "시험용 방식의 절차를 설명한다" })).ok, true, "사전 밖 말");
    // 편집국이 사전에 더한 낱말도 바로 쓴다
    await client.query("update public.settings set value = jsonb_set(value, '{phrases}', (value -> 'phrases') || '[\"시험용금지\"]'::jsonb) where key = 'forbidden_phrases'");
    assert.equal((await putItem("public", "actor", "시험용금지 글")).ok, false);
    assert.ok(reviewer);
  }));

test("방법 내용 저장 검사 — 절차 단계 모양 · 자리 채움 글 거부 · 박스 모양·세액 표현 · 숫자 요건 표현은 경고(저장됨)", () =>
  tx(async () => {
    for (const [what, c] of [
      ["단계 0개", { ...CONTENT, steps: [] }],
      ["단계 16개", { ...CONTENT, steps: Array.from({ length: 16 }, (_, i) => `시험용 단계 ${i}`) }],
      ["단계 61자", { ...CONTENT, steps: ["가".repeat(61)] }],
      ["같은 단계 두 번", { ...CONTENT, steps: ["시험용 단계", "시험용 단계"] }],
      ["단계가 글자 아님", { ...CONTENT, steps: [{ label: "시험용" }] }],
      ["설명 301자", { ...CONTENT, summary: "가".repeat(301) }],
      ["근거 법령 121자", { ...CONTENT, legal_basis_name: "가".repeat(121) }],
    ]) {
      assert.equal((await draftMethod("redevelopment", c)).ok, false, what);
    }
    assert.ok((await draftMethod("redevelopment", { ...CONTENT, steps: Array.from({ length: 15 }, (_, i) => `시험용 단계 ${i}`) })).ok, "단계 15개");
    for (const ph of ["확인 중", "준비중", "미정", " - ", "TBD", "추후 확인", "(검토 중)"]) {
      const r = await draftMethod("redevelopment", { ...CONTENT, summary: ph });
      assert.equal(r.ok, false, `자리 채움 '${ph}'`);
      assert.match(r.message, /자리 채움 글/);
    }
    assert.equal((await draftMethod("redevelopment", { ...CONTENT, steps: ["시험용 단계", "확인 중"] })).ok, false, "단계에도 자리 채움 0");
    assert.ok((await draftMethod("redevelopment", { ...CONTENT, summary: "시험용 확인 중인 내용을 설명한다" })).ok, "문장 속 낱말은 자리 채움이 아니다");
    // 박스 — 16단계 단계 템플릿과 같은 한도
    for (const [what, lens] of [
      ["포인트 0줄", LENS({ points: [] })],
      ["포인트 4줄", LENS({ points: ["시험용 1", "시험용 2", "시험용 3", "시험용 4"] })],
      ["세목 0개", LENS({ topics: [] })],
      ["링크 0개", LENS({ links: [] })],
      ["계산기 링크", LENS({ links: [{ kind: "calculator", label: "시험용", url: "/calc" }] })],
      ["바깥 주소", LENS({ links: [{ kind: "explainer", label: "시험용", url: "https://gasang.example" }] })],
      ["기준일 없음", { topics: ["시험용"], points: ["시험용"], links: [{ kind: "book", label: "시험용", url: "/store" }] }],
      ["세액 표현", LENS({ points: ["시험용 세금 100만 원"] })],
      ["모르는 칸", { ...LENS(), extra: 1 }],
    ]) {
      assert.equal((await draftMethod("redevelopment", CONTENT, lens)).ok, false, what);
    }
    assert.ok((await draftMethod("redevelopment", CONTENT, LENS({ points: ["시험용 원문 보기", "시험용 2", "시험용 3"] }))).ok, "포인트 3줄·'원문'은 금액 아님");
    // 숫자 요건 표현 — 경고만 (저장됨)
    const { r, notices } = await withNotices(() => draftMethod("reconstruction", { ...CONTENT, summary: "시험용 99% 이상 3분의 2" }));
    assert.ok(r.ok, r.message);
    assert.ok(notices.some((n) => /숫자 요건 표현이 있습니다/.test(n)), notices.join(" | "));
    const year = await withNotices(() => draftMethod("small-scale", { ...CONTENT, summary: "시험용 2026년 설명" }));
    assert.ok(year.r.ok);
    assert.equal(year.notices.filter((n) => /숫자 요건/.test(n)).length, 0, "연도만 있는 날짜는 경고 0");
    // 내용을 저장한 사람이 없으면 거부
    assert.equal((await attempt("update public.dev_methods set summary = '시험용', drafted_by = null where slug = 'trust'")).ok, false);
  }));

test("서명 흐름 — 방법: 내용과 함께 서명 0 · reviewer만 · 한 줄 설명·절차 전 서명 0 · 고치면 서명 지움 · 상태만 바꾸기 0", () =>
  tx(async () => {
    const reviewer = await staffUser("reviewer");
    const editor = await staffUser("editor");
    const empty = await signMethod("trust", reviewer);
    assert.equal(empty.ok, false);
    assert.match(empty.message, /한 줄 설명과 절차 단계를 저장한 뒤에 서명합니다/);
    const partial = await draftMethod("trust", { summary: "시험용 설명만" });
    assert.ok(partial.ok);
    assert.equal((await signMethod("trust", reviewer)).ok, false, "절차 단계 전 서명 0");
    const both = await attempt("update public.dev_methods set summary = '시험용 고침', steps = '[\"시험용 단계\"]'::jsonb, drafted_by = $2, reviewed_by = $3 where slug = $1", ["trust", ACTOR, `user:${reviewer}`]);
    assert.equal(both.ok, false);
    assert.match(both.message, /서명은 저장된 내용에만/);
    assert.ok((await draftMethod("trust")).ok);
    const byEditor = await signMethod("trust", editor);
    assert.equal(byEditor.ok, false);
    assert.match(byEditor.message, /세무 감수위원\(reviewer\)만/);
    assert.equal((await attempt("update public.dev_methods set reviewed_by = 'people:1' where slug = 'trust'")).ok, false, "서명자 형식");
    const signed = await signMethod("trust", reviewer);
    assert.ok(signed.ok, signed.message);
    assert.equal(signed.rows[0].review_status, "reviewed");
    assert.ok(signed.rows[0].reviewed_at instanceof Date);
    const same = await draftMethod("trust");
    assert.equal(same.rows[0].review_status, "reviewed", "같은 내용 쓰기 — 서명 그대로");
    const edited = await draftMethod("trust", { ...CONTENT, summary: "시험용 고친 설명" });
    assert.deepEqual([edited.rows[0].review_status, edited.rows[0].reviewed_by, edited.rows[0].reviewed_at], ["rereview_needed", null, null]);
    for (const set of ["review_status = 'reviewed'", "review_status = 'draft'", "drafted_at = now() - interval '1 day'"]) {
      assert.equal((await attempt(`update public.dev_methods set ${set} where slug = 'trust'`)).ok, false, set);
    }
    assert.ok((await signMethod("trust", reviewer)).ok);
    const unsign = await attempt("update public.dev_methods set reviewed_by = null, reviewed_at = null, review_status = 'draft' where slug = 'trust'");
    assert.equal(unsign.ok, false);
    assert.match(unsign.message, /감수 상태는 서명으로만 바뀝니다/);
    // 박스를 고쳐도 서명 지움
    const lensEdit = await draftMethod("trust", CONTENT, LENS());
    assert.equal(lensEdit.rows[0].review_status, "rereview_needed");
  }));

test("비교 항목 — 6칸 값 · 칸 바꾸기 0 · 자리 채움·빈 글 거부 · 서명 흐름(고치면 지움) · 지우기 0", () =>
  tx(async () => {
    const reviewer = await staffUser("reviewer");
    assert.equal((await putItem("public", "score", "시험용")).ok, false, "2.1 밖 항목");
    for (const body of ["", "   ", "확인 중", "준비 중…", "가".repeat(301)]) assert.equal((await putItem("public", "actor", body)).ok, false, JSON.stringify(body));
    const preSigned = await attempt("insert into public.dev_method_compare (method_id, item, body, drafted_by, reviewed_by, reviewed_at, review_status) values ($1, 'actor', '시험용', $2, $3, now(), 'reviewed')", [
      await methodId("public"),
      ACTOR,
      `user:${reviewer}`,
    ]);
    assert.equal(preSigned.ok, false);
    assert.match(preSigned.message, /서명은 저장된 글에만/);
    assert.ok((await putItem("public", "actor", "시험용 사업 주체")).ok);
    assert.equal((await putItem("public", "actor", "시험용 두 번째")).ok, false, "같은 칸 두 번 0");
    assert.equal((await editItem("public", "actor", "item = 'target'")).ok, false, "항목 바꾸기 0");
    assert.equal((await editItem("public", "actor", "method_id = $3", [await methodId("trust")])).ok, false, "방법 바꾸기 0");
    assert.equal((await signItem("public", "actor", await staffUser("editor"))).ok, false, "reviewer만");
    const s = await signItem("public", "actor", reviewer);
    assert.equal(s.rows[0].review_status, "reviewed");
    const edited = await editItem("public", "actor", "body = '시험용 고친 사업 주체'");
    assert.deepEqual([edited.rows[0].review_status, edited.rows[0].reviewed_by], ["rereview_needed", null]);
    const both = await editItem("public", "actor", "body = '시험용 또', reviewed_by = $3", [`user:${reviewer}`]);
    assert.equal(both.ok, false);
    assert.equal((await editItem("public", "actor", "review_status = 'reviewed'")).ok, false, "상태만 0");
    assert.equal((await attempt("delete from public.dev_method_compare where item = 'actor'")).ok, false, "지우기 0");
    const { r, notices } = await withNotices(() => putItem("public", "numeric_requirements", "시험용 99㎡ 이상"));
    assert.ok(r.ok);
    assert.ok(notices.some((n) => /숫자 요건 표현/.test(n)), "숫자 요건 표현은 경고");
  }));

test("사실 행 — 새 판 + 사유(옛 판 그대로) · 고치기·지우기 0 · 최신 판만 고친다 · 첫 판 두 번 0 · 서명은 최신 판·기준일·reviewer", () =>
  tx(async () => {
    const reviewer = await staffUser("reviewer");
    for (const [what, over] of [
      ["값 자리 채움", { value: "확인 중" }],
      ["근거 조문 자리 채움", { law_ref: "미정" }],
      ["주소 아님", { source_url: "gasang.example/x" }],
      ["열쇠 형식", { fact_key: "Siheom-Req" }],
      ["값 41자", { value: "가".repeat(41) }],
    ]) {
      assert.equal((await putFact("redevelopment", over)).ok, false, what);
    }
    assert.equal((await attempt("insert into public.dev_method_facts (method_id, fact_key, label, value, law_ref, source_url, snapshot_id, recorded_by) values ($1, 'siheom_nosnap', '시험용', '시험용', '시험용', $2, null, $3)", [await methodId("redevelopment"), URL_A, ACTOR])).ok, false, "스냅샷 필수");
    const v1 = await putFact("redevelopment", { version: 5 });
    assert.ok(v1.ok, v1.message);
    assert.equal(v1.rows[0].version, 1, "판 번호는 저장 검사가 매긴다");
    const dup = await putFact("redevelopment");
    assert.equal(dup.ok, false);
    assert.match(dup.message, /이미 있습니다 — 고치려면 최신 판/);
    assert.equal((await putFact("redevelopment", { supersedes_id: v1.rows[0].id })).ok, false, "둘째 판은 사유 필수");
    const v2 = await putFact("redevelopment", { supersedes_id: v1.rows[0].id, value: "시험용 98", reason: "시험용 고친 사유" });
    assert.ok(v2.ok, v2.message);
    assert.equal(v2.rows[0].version, 2);
    const old = await one("select * from public.dev_method_facts where id = $1", [v1.rows[0].id]);
    assert.deepEqual([old.value, old.version, old.reviewed_by], ["시험용 99", 1, null], "옛 판 그대로");
    const branch = await putFact("redevelopment", { supersedes_id: v1.rows[0].id, reason: "시험용 갈래" });
    assert.equal(branch.ok, false, "옛 판을 다시 고치기 0 (최신 판만)");
    const other = await putFact("reconstruction", { supersedes_id: v2.rows[0].id, reason: "시험용 다른 방법" });
    assert.equal(other.ok, false, "다른 방법의 판 0");
    for (const set of ["value = '시험용 바꿈'", "reference_date = '2027-01-01'", "reason = '시험용'", "version = 9"]) {
      const r = await attempt(`update public.dev_method_facts set ${set} where id = $1`, [v2.rows[0].id]);
      assert.equal(r.ok, false, set);
      assert.match(r.message, /고치지 않습니다 — 새 판/);
    }
    assert.equal((await attempt("delete from public.dev_method_facts where id = $1", [v1.rows[0].id])).ok, false, "지우기 0");
    // 서명 — 옛 판 0 · 기준일 없는 판 0 · reviewer만 · 한 번만
    assert.match((await signFact(v1.rows[0].id, reviewer)).message, /최신 판이 아닙니다/);
    assert.equal((await signFact(v2.rows[0].id, await staffUser("editor"))).ok, false, "reviewer만");
    const signed = await signFact(v2.rows[0].id, reviewer);
    assert.ok(signed.ok, signed.message);
    assert.ok(signed.rows[0].reviewed_at instanceof Date);
    assert.equal((await signFact(v2.rows[0].id, reviewer)).ok, false, "서명은 한 번");
    assert.equal((await attempt("update public.dev_method_facts set reviewed_by = null, reviewed_at = null where id = $1", [v2.rows[0].id])).ok, false, "서명 지우기 0");
    const noDate = await putFact("small-scale", { fact_key: "siheom_nodate", reference_date: null });
    assert.ok(noDate.ok, "기준일 없는 초안은 저장된다");
    const noDateSign = await signFact(noDate.rows[0].id, reviewer);
    assert.equal(noDateSign.ok, false);
    assert.match(noDateSign.message, /기준일이 없어 서명하지 않습니다/);
    const preSigned = await attempt(
      "insert into public.dev_method_facts (method_id, fact_key, label, value, law_ref, reference_date, source_url, snapshot_id, recorded_by, reviewed_by, reviewed_at) values ($1, 'siheom_pre', '시험용', '시험용', '시험용', '2026-01-01', $2, $3, $4, $5, now())",
      [await methodId("small-scale"), URL_A, await snapshot(), ACTOR, `user:${reviewer}`],
    );
    assert.equal(preSigned.ok, false, "새 판에 서명 0");
  }));

test("공개 준비·기능 키 — 서명·6칸 없이 켜기 거부(사유에 방법) · 켜진 뒤 칸 하나 고치면 그 방법만 0 · '확인 중' 채움 0 · reviewer를 잃으면 0", () =>
  tx(async () => {
    const reviewer = await staffUser("reviewer", { name: "시험용 감수위원" });
    const off = await flag(true);
    assert.equal(off.ok, false, "내용 0으로 켜기 거부");
    assert.match(off.message, /7개 방법의 비교 항목 6칸과 세무 감수 서명이 모두 있어야 켭니다 — 아직: redevelopment, reconstruction/);
    await readyAll(reviewer, ["renewal:tax_issues"]);
    const r1 = await one("select ready, method_signed, compare_unsigned from public.dev_method_readiness where slug = 'renewal'");
    assert.deepEqual([r1.ready, r1.method_signed, r1.compare_unsigned], [false, true, ["tax_issues"]], "6칸 중 하나 서명 전");
    const oneMissing = await flag(true);
    assert.equal(oneMissing.ok, false);
    assert.match(oneMissing.message, /아직: renewal$/);
    assert.equal((await all("select * from public.public_dev_methods")).length, 0, "키 꺼짐 → 공개 0");
    assert.ok((await signItem("renewal", "tax_issues", reviewer)).ok);
    const on = await flag(true);
    assert.ok(on.ok, on.message);
    const pub = await all("select * from public.public_dev_methods order by sort");
    assert.deepEqual(pub.map((p) => p.slug), codes("| dev_method.slug "), "7개 고정 순서");
    assert.deepEqual(pub.map((p) => p.kind).filter((k) => k === "planning_support").length, 1);
    assert.deepEqual(Object.keys(pub[0]), ["slug", "name", "kind", "sort", "legal_basis_name", "summary", "steps", "lens", "reviewed_at", "reviewer_name"]);
    assert.deepEqual([pub[0].steps, pub[0].reviewer_name], [CONTENT.steps, "시험용 감수위원"]);
    const cmp = await all("select * from public.public_dev_method_compare order by sort, item_position");
    assert.equal(cmp.length, 42, "7 × 6");
    assert.deepEqual(cmp.slice(0, 6).map((c) => c.item), ITEMS, "항목 순서 = 2.1");
    assert.deepEqual(Object.keys(cmp[0]), ["slug", "sort", "item", "item_position", "body", "reviewed_at", "reviewer_name"]);
    assert.equal(cmp.filter((c) => /확인\s*중|준비\s*중/.test(c.body)).length, 0, "'확인 중' 채움 0");
    // 켜진 뒤 한 칸 고침 → 그 방법만 0 (다른 방법·켜진 키는 그대로)
    assert.ok((await editItem("trust", "procedure", "body = '시험용 고친 절차'")).ok);
    assert.deepEqual((await all("select slug from public.public_dev_methods order by sort")).map((r) => r.slug), codes("| dev_method.slug ").filter((s) => s !== "trust"));
    assert.equal((await all("select * from public.public_dev_method_compare where slug = 'trust'")).length, 0);
    assert.ok((await flag(false)).ok, "끄기는 언제나");
    assert.ok((await signItem("trust", "procedure", reviewer)).ok);
    assert.ok((await flag(true)).ok, "다시 모두 준비 → 켜기");
    // 방법 내용 고침 → 그 방법 0
    assert.ok((await draftMethod("public", { ...CONTENT, summary: "시험용 고친 설명" })).ok);
    assert.equal((await all("select * from public.public_dev_methods where slug = 'public'")).length, 0);
    // 서명자가 reviewer를 잃으면 모두 0
    await client.query("delete from public.staff_roles where user_id = $1 and role = 'reviewer'", [reviewer]);
    assert.equal((await all("select * from public.public_dev_methods")).length, 0);
    assert.equal((await all("select * from public.public_dev_method_compare")).length, 0);
    assert.equal(Number((await one("select count(*)::int n from public.dev_method_readiness where ready")).n), 0);
  }));

test("공개 사실 행 — 서명 전 0 · 기준일 없음 0 · 서명자 공개 이름 없음 0 · 새 판은 서명 뒤에만(옛 판으로 대신 0) · 방법이 0이면 0", () =>
  tx(async () => {
    const reviewer = await staffUser("reviewer", { name: "시험용 감수위원" });
    const hidden = await staffUser("reviewer", { name: "시험용 비공개 감수위원", visibility: "hidden" });
    await readyAll(reviewer);
    assert.ok((await flag(true)).ok);
    const facts = () => all("select * from public.public_dev_method_facts order by slug, fact_key");
    const v1 = await putFact("redevelopment");
    assert.equal((await facts()).length, 0, "서명 전 0");
    assert.ok((await signFact(v1.rows[0].id, reviewer)).ok);
    const shown = await facts();
    assert.equal(shown.length, 1);
    assert.deepEqual(Object.keys(shown[0]), ["slug", "sort", "fact_key", "label", "value", "unit", "law_ref", "reference_date", "source_url", "version", "reviewed_at", "reviewer_name", "under_review"]);
    assert.deepEqual([shown[0].value, shown[0].version, shown[0].reviewer_name, shown[0].under_review], ["시험용 99", 1, "시험용 감수위원", false]);
    // 새 판 → 서명 전에는 그 요건 0 (옛 판으로 대신하지 않는다) → 서명 뒤 새 값·새 기준일
    const v2 = await putFact("redevelopment", { supersedes_id: v1.rows[0].id, value: "시험용 98", reference_date: "2026-06-01", reason: "시험용 고친 사유" });
    assert.equal((await facts()).length, 0, "새 판 서명 전 0");
    assert.ok((await signFact(v2.rows[0].id, reviewer)).ok);
    const after = await all("select value, version, reference_date::text d from public.public_dev_method_facts");
    assert.deepEqual(after.map((f) => [f.value, f.version, f.d]), [["시험용 98", 2, "2026-06-01"]], "다음 렌더부터 새 값·새 기준일");
    // 기준일 없는 판 0 · 비공개 인물 서명자 0
    await putFact("reconstruction", { fact_key: "siheom_nodate", reference_date: null });
    const hiddenSigned = await putFact("reconstruction", { fact_key: "siheom_hidden" });
    assert.ok((await signFact(hiddenSigned.rows[0].id, hidden)).ok);
    assert.deepEqual((await facts()).map((f) => f.fact_key), ["siheom_req"], "기준일 없음·공개 이름 없음 0");
    // 방법이 공개에서 빠지면 그 사실 행도 0
    assert.ok((await draftMethod("redevelopment", { ...CONTENT, summary: "시험용 고친 설명" })).ok);
    assert.equal((await facts()).length, 0);
  }));

test("원문 다시 받기 — 사실 행 최신 판 해시 바뀜 → 큐 1건 · 옛 판 0 · 같은 해시 0 · 같은 새 해시 다시 0 · 공개 뷰 under_review", () =>
  tx(async () => {
    const reviewer = await staffUser("reviewer", { name: "시험용 감수위원" });
    await readyAll(reviewer);
    assert.ok((await flag(true)).ok);
    const snap = await snapshot(URL_A, "시험용 옛 원문");
    const v1 = await putFact("redevelopment", { snapshot_id: snap });
    const v2 = await putFact("redevelopment", { snapshot_id: snap, supersedes_id: v1.rows[0].id, reason: "시험용 사유" });
    assert.ok((await signFact(v2.rows[0].id, reviewer)).ok);
    const refetch = (text) => one("select public.source_snapshot_refetched($1, $2, $3, '시험용 다시 받기', $4) r", [URL_A, hashOf(text), text, ACTOR]).then((x) => x.r);
    const same = await refetch("시험용 옛 원문");
    assert.deepEqual([same.methodTargets, same.methodOpened, same.methodUnchanged, same.methodAlreadyQueued], [1, 0, 1, 0], "같은 해시 → 0건 (최신 판 하나만 본다)");
    const changed = await refetch("시험용 바뀐 원문");
    assert.deepEqual([changed.methodTargets, changed.methodOpened], [1, 1]);
    const queue = await all("select target_type, target_id, reason, status, article_id from public.source_review_queue where target_type = 'dev_method_fact'");
    assert.deepEqual(queue.map((q) => [q.target_id, q.reason, q.status, q.article_id].map(String)), [[String(v2.rows[0].id), "snapshot_changed", "open", "null"]], "최신 판 1건, 옛 판 0");
    const again = await refetch("시험용 바뀐 원문");
    assert.deepEqual([again.methodOpened, again.methodAlreadyQueued], [0, 1], "같은 새 해시로 다시 0");
    assert.equal((await one("select under_review from public.public_dev_method_facts where fact_key = 'siheom_req'")).under_review, true, "공개 뷰 검토 중");
    const other = await one("select public.source_snapshot_refetched('https://gasang.example/dm/other', $1, 'x', '시험용', $2) r", [hashOf("시험용 다른"), ACTOR]);
    assert.equal(other.r.methodTargets, 0, "다른 주소 0");
    // 검수 큐 대상 검사 — 없는 사실 행·기사 번호 거부
    assert.equal((await attempt("insert into public.source_review_queue (target_type, target_id, reason, old_hash, new_hash, new_snapshot_id, opened_by) values ('dev_method_fact', -1, 'snapshot_changed', 'a', 'b', $1, 'user:t')", [snap])).ok, false);
  }));

test("권한 — anon은 표·준비 판정 뷰 42501 · 공개 뷰는 읽기만 · 새 함수 anon 실행 0", () =>
  tx(async () => {
    for (const t of ["dev_methods", "dev_method_compare", "dev_method_facts", "dev_method_readiness"]) {
      for (const role of ["anon", "authenticated"]) {
        const r = await attempt(`select * from public.${t} limit 1`, [], role);
        assert.equal(r.code, "42501", `${role} ${t}`);
      }
    }
    for (const v of ["public_dev_methods", "public_dev_method_compare", "public_dev_method_facts"]) {
      assert.ok((await attempt(`select * from public.${v} limit 1`, [], "anon")).ok, `anon ${v} 읽기`);
      const privs = await one("select has_table_privilege('anon', $1, 'insert') i, has_table_privilege('anon', $1, 'update') u, has_table_privilege('anon', $1, 'delete') d", [`public.${v}`]);
      assert.deepEqual([privs.i, privs.u, privs.d], [false, false, false], v);
    }
    const fns = await all(
      "select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'dev_method%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))",
    );
    assert.deepEqual(fns, [], "새 함수 anon·authenticated 실행 0");
    // service_role(관리자 전권 — admin-rights 시험) — 방법 더하기·지우기·비교 항목 지우기는 권한이 있어도 트리거가 막는다. 사실 행은 지우기 권한 0
    assert.equal((await one("select has_table_privilege('service_role', 'public.dev_method_facts', 'delete') d")).d, false, "사실 행 지우기 권한 0");
    assert.ok((await putItem("trust", "actor", "시험용 사업 주체")).ok);
    for (const [what, sql] of [
      ["방법 더하기", "insert into public.dev_methods (slug, name, kind, sort) values ('trust', '시험용', 'project_type', 5)"],
      ["방법 지우기", "delete from public.dev_methods where slug = 'trust'"],
      ["비교 항목 지우기", "delete from public.dev_method_compare where item = 'actor'"],
    ]) {
      const r = await attempt(sql, [], "service_role");
      assert.equal(r.ok, false, what);
      assert.doesNotMatch(r.message, /permission denied/, `${what} — 권한이 아니라 트리거가 막는다`);
      assert.match(r.message, /정확히 7행|추가만 할 수 있습니다/, what);
    }
    assert.equal(Number((await one("select count(*)::int n from public.dev_method_compare where item = 'actor'")).n), 1, "지우기 0");
  }));
