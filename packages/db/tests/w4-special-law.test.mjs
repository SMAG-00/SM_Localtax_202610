// W4 20단계 DB — 특례법 확인 기록 (docs/dev/W4_설계.md 1장 20단계 · 12장 #14, 마이그레이션 20261023000053 · PRD-01B PR-13)
// 특례법 이름·요건·법령 문구는 모두 시험용 가짜다. 모든 시험은 트랜잭션 안에서 하고 되돌린다.
//  · 확인 기록은 추가만 · 공포 확인(enacted)은 원문 주소·공포일 필수 · 표시를 켠 행은 공포 확인 없이 저장 거부
//  · 공개 뷰 — 행 확인 전 false · 확인 뒤 true · 글을 고치거나 새 판이면 false · 철회하면 전부 사라짐 · anon 표 접근 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

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

const URL_LAW = "https://gasang.example/dm/special-law";
const ADMIN = "user:11111111-2222-3333-4444-555555555555";
const lawIn = (status = "enacted", over = {}) =>
  attempt(
    "insert into public.special_law_confirmations (target_type, status, promulgation_url, promulgated_on, confirmed_by, reason) values ('law', $1, $2, $3, $4, $5) returning *",
    [status, over.url === undefined ? (status === "enacted" ? URL_LAW : null) : over.url, over.on === undefined ? (status === "enacted" ? "2026-01-02" : null) : over.on, ADMIN, over.reason ?? "시험용 사유"],
  );
const rowIn = (type, ref, version, lawId, status = "enacted") =>
  attempt(
    "insert into public.special_law_confirmations (target_type, target_ref, target_version, law_confirmation_id, status, confirmed_by, reason) values ($1, $2, $3, $4, $5, $6, '시험용 사유') returning *",
    [type, String(ref), String(version), status === "enacted" ? lawId : null, status, ADMIN],
  );
const cmpVersion = async (slug, item) =>
  (await one("select public.special_law_compare_version(c.body, c.special_law_basis, c.drafted_at) v from public.dev_method_compare c where method_id = $1 and item = $2", [await methodId(slug), item])).v;
const pubCmp = (slug, item) => one("select special_law_basis from public.public_dev_method_compare where slug = $1 and item = $2", [slug, item]);
const factIns = async (slug, v, sup, basis, snap) =>
  attempt(
    `insert into public.dev_method_facts (method_id, fact_key, label, value, law_ref, reference_date, source_url, snapshot_id, recorded_by, version, special_law_basis, supersedes_id, reason)
     values ($1, 'siheom_req', '시험용 요건', '시험용 ' || ($2::int)::text, '시험용 조문', '2026-01-01', $3, $4, $5, $2::int, $6, $7, $8) returning *`,
    [await methodId(slug), v, URL_A, snap ?? (await snapshot()), ACTOR, basis, sup, sup ? "시험용 사유" : null],
  );

test("공포 확인(enacted)은 공포 원문 주소·공포일이 있어야 하고, 철회는 확인됨일 때만 되며, 기록은 고치기·지우기·비우기가 거부된다", async () => {
  await tx(async () => {
    assert.equal((await lawIn("enacted", { url: null })).ok, false, "주소 없는 확인");
    assert.equal((await lawIn("enacted", { on: null })).ok, false, "공포일 없는 확인");
    assert.equal((await lawIn("enacted", { url: "ftp://x" })).ok, false, "http 아닌 주소");
    assert.equal((await lawIn("enacted", { reason: "  " })).ok, false, "사유 공백");
    assert.equal((await lawIn("withdrawn")).ok, false, "확인 전 철회");
    const ok = await lawIn("enacted");
    assert.ok(ok.ok, ok.message);
    assert.equal(String((await one("select public.special_law_current() id")).id), String(ok.rows[0].id));
    assert.equal((await attempt("update public.special_law_confirmations set reason = '바꿈' where id = $1", [ok.rows[0].id])).ok, false);
    assert.equal((await attempt("delete from public.special_law_confirmations where id = $1", [ok.rows[0].id])).ok, false);
    assert.equal((await attempt("truncate public.special_law_confirmations")).ok, false);
    assert.equal((await lawIn("withdrawn")).ok, true);
    assert.equal((await one("select public.special_law_current() id")).id, null, "철회 뒤 확인됨 아님");
    assert.equal((await lawIn("withdrawn")).ok, false, "이미 철회");
  });
});

test("표시를 켠 비교 항목·사실 행은 공포 확인이 없으면 저장이 거부되고, 확인 뒤에는 저장된다", async () => {
  await tx(async () => {
    assert.equal((await attempt("insert into public.dev_method_compare (method_id, item, body, drafted_by, special_law_basis) values ($1, 'legal_basis', '시험용 글', $2, true)", [await methodId("redevelopment"), ACTOR])).ok, false);
    assert.equal((await factIns("redevelopment", 1, null, true)).ok, false);
    assert.ok((await putItem("redevelopment", "actor", "시험용 글")).ok, "표시 없는 저장은 확인 없이도 된다");
    assert.equal((await editItem("redevelopment", "actor", "special_law_basis = true")).ok, false, "표시만 켜기도 거부");
    assert.ok((await lawIn("enacted")).ok);
    assert.ok((await editItem("redevelopment", "actor", "special_law_basis = true")).ok);
    assert.ok((await factIns("redevelopment", 1, null, true)).ok);
  });
});

test("비교 항목 표시만 바꿔도 감수 서명이 지워지고, 행 확인은 표시된 행의 현재 판·현재 공포 확인 기준일 때만 들어간다", async () => {
  await tx(async () => {
    const reviewer = await staffUser("reviewer", { name: "시험 감수위원" });
    assert.ok((await putItem("trust", "target", "시험용 글")).ok);
    assert.ok((await signItem("trust", "target", reviewer)).ok);
    const law = (await lawIn("enacted")).rows[0];
    const on = await editItem("trust", "target", "special_law_basis = true");
    assert.ok(on.ok, on.message);
    assert.equal(on.rows[0].reviewed_by, null, "서명 지움");
    assert.equal(on.rows[0].review_status, "rereview_needed");
    const ver = await cmpVersion("trust", "target");
    assert.equal((await rowIn("dev_method_compare", "trust:target", "엉뚱한판", law.id)).ok, false, "판 불일치");
    assert.equal((await rowIn("dev_method_compare", "trust:actor", ver, law.id)).ok, false, "표시 안 된 칸");
    assert.equal((await rowIn("dev_method_compare", "trust:target", ver, Number(law.id) + 999)).ok, false, "다른 공포 확인 기준");
    assert.equal((await rowIn("dev_method_compare", "trust:target", ver, null, "withdrawn")).ok, false, "확인 없이 철회");
    const ok = await rowIn("dev_method_compare", "trust:target", ver, law.id);
    assert.ok(ok.ok, ok.message);
    assert.equal((await rowIn("dev_method_compare", "trust:target", ver, null, "withdrawn")).ok, true, "철회는 된다");
  });
});

test("공개 뷰 — 행 확인 전 false, 확인 뒤 true, 글을 고치면 false, 철회하면 전부 사라지고 공포 확인이 없으면 public_special_law 0행", async () => {
  await tx(async () => {
    const reviewer = await staffUser("reviewer", { name: "시험 감수위원" });
    assert.equal((await all("select * from public.public_special_law")).length, 0, "확인 전 0행");
    const law = (await lawIn("enacted")).rows[0];
    const pl = await all("select * from public.public_special_law");
    assert.equal(pl.length, 1);
    assert.equal(pl[0].promulgation_url, URL_LAW);
    assert.deepEqual(Object.keys(pl[0]).sort(), ["confirmed_at", "promulgated_on", "promulgation_url"], "확인자·사유 칸 0");
    await readyAll(reviewer);
    const m = await methodId("redevelopment");
    await client.query("update public.dev_method_compare set special_law_basis = true where method_id = $1 and item = 'legal_basis'", [m]);
    assert.ok((await signItem("redevelopment", "legal_basis", reviewer)).ok);
    const f1 = (await factIns("redevelopment", 1, null, false)).rows[0];
    assert.ok((await signFact(f1.id, reviewer)).ok);
    assert.equal((await attempt("update public.dev_method_facts set special_law_basis = true where id = $1", [f1.id])).ok, false, "사실 행 표시는 새 판으로만");
    assert.ok((await flag(true)).ok);
    assert.equal((await pubCmp("redevelopment", "legal_basis")).special_law_basis, false, "행 확인 전");
    const ver = await cmpVersion("redevelopment", "legal_basis");
    assert.ok((await rowIn("dev_method_compare", "redevelopment:legal_basis", ver, law.id)).ok);
    assert.equal((await pubCmp("redevelopment", "legal_basis")).special_law_basis, true, "행 확인 뒤");
    assert.equal((await pubCmp("redevelopment", "actor")).special_law_basis, false, "표시 안 된 칸은 언제나 false");
    // 철회 → 공포 확인 없음 → 보이는 행 0
    assert.ok((await lawIn("withdrawn")).ok);
    assert.equal((await pubCmp("redevelopment", "legal_basis")).special_law_basis, false, "철회 뒤");
    assert.equal((await all("select * from public.public_special_law")).length, 0);
    assert.equal((await all("select * from public.special_law_visible")).length, 0);
  });
});

test("글을 고치면 그 칸의 행 확인이 맞지 않아 다시 확인하기 전까지 공개 뷰에서 false다 (같은 거래 안에서 고쳐도)", async () => {
  await tx(async () => {
    const reviewer = await staffUser("reviewer", { name: "시험 감수위원" });
    const law = (await lawIn("enacted")).rows[0];
    await readyAll(reviewer);
    const m = await methodId("public");
    await client.query("update public.dev_method_compare set special_law_basis = true where method_id = $1 and item = 'target'", [m]);
    assert.ok((await signItem("public", "target", reviewer)).ok);
    assert.ok((await flag(true)).ok);
    assert.ok((await rowIn("dev_method_compare", "public:target", await cmpVersion("public", "target"), law.id)).ok);
    assert.equal((await pubCmp("public", "target")).special_law_basis, true);
    await client.query("update public.dev_method_compare set body = '시험용 고친 글', drafted_by = $2 where method_id = $1 and item = 'target'", [m, ACTOR]);
    assert.equal((await one("select count(*)::int n from public.special_law_visible where target_ref = 'public:target'")).n, 0, "고친 뒤 보이지 않는다");
    assert.ok((await signItem("public", "target", reviewer)).ok);
    assert.equal((await pubCmp("public", "target")).special_law_basis, false, "다시 서명해도 다시 확인 전에는 false");
    assert.ok((await rowIn("dev_method_compare", "public:target", await cmpVersion("public", "target"), law.id)).ok);
    assert.equal((await pubCmp("public", "target")).special_law_basis, true, "다시 확인 뒤");
  });
});

test("사실 행 확인 — 표시된 최신 판만, 새 판이 생기면 앞 판 확인은 보이지 않는다", async () => {
  await tx(async () => {
    const law = (await lawIn("enacted")).rows[0];
    const snap = await snapshot();
    const a = (await factIns("small-scale", 1, null, true, snap)).rows[0];
    assert.equal((await rowIn("dev_method_fact", a.id, Number(a.id) + 1, law.id)).ok, false, "판 불일치");
    assert.ok((await rowIn("dev_method_fact", a.id, a.id, law.id)).ok);
    assert.equal((await one("select count(*)::int n from public.special_law_visible where target_type = 'dev_method_fact' and target_ref = $1", [String(a.id)])).n, 1);
    const b = (await factIns("small-scale", 2, a.id, true, snap)).rows[0];
    assert.equal((await one("select count(*)::int n from public.special_law_visible where target_ref = $1", [String(b.id)])).n, 0, "새 판은 다시 확인해야 보인다");
    assert.equal((await rowIn("dev_method_fact", a.id, a.id, law.id)).ok, false, "앞 판은 최신 판이 아니다");
    assert.ok((await rowIn("dev_method_fact", b.id, b.id, law.id)).ok);
    assert.equal((await one("select count(*)::int n from public.special_law_visible where target_ref = $1", [String(b.id)])).n, 1);
  });
});

test("권한 — anon은 확인 기록 표·보이는 행 뷰를 못 읽고 공개 뷰는 읽기만 되며, 새 함수는 anon이 실행하지 못한다", async () => {
  await tx(async () => {
    for (const rel of ["special_law_confirmations", "special_law_visible"]) {
      const r = await attempt(`select * from public.${rel}`, [], "anon");
      assert.equal(r.ok, false, rel);
      assert.equal(r.code, "42501", rel);
    }
    const pa = await attempt("select * from public.public_special_law", [], "anon");
    assert.equal(pa.ok, true, pa.message);
    assert.equal((await attempt("insert into public.special_law_confirmations (target_type, status, confirmed_by, reason) values ('law', 'withdrawn', 'x', 'x')", [], "anon")).code, "42501");
    for (const fn of ["special_law_current()", "special_law_compare_version(text, boolean, timestamptz)"]) {
      assert.equal((await one(`select has_function_privilege('anon', 'public.${fn}', 'execute') p`)).p, false, fn);
    }
  });
});
