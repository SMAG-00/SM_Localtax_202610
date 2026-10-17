// 서비스 역할(staff_roles)과 인물(people) — ACC-04 · NAV-19 · BR-01.
// 편집 승인 역할(editor)과 편집국 외 역할(ad_ops·store_ops·brand_ops·expert_ops)을 한 사람에게 함께 주면 DB가 거부한다.
// 관리자(PO)도 예외가 없다 (PO 결정 2026-10-17) — 서버 경로(service_role)와 테이블 소유자(postgres) 모두 거부.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

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

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const authUser = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
const GRANT = "insert into public.staff_roles (user_id, role, granted_by) values ($1, $2, 'admin:admin@sunmyung.kr')";
const NON_NEWSROOM = ["ad_ops", "store_ops", "brand_ops", "expert_ops"];

for (const other of NON_NEWSROOM) {
  for (const role of ["service_role", null]) {
    const who = role ?? "테이블 소유자(postgres)";
    test(`editor가 있는 사람에게 ${other}를 주면 거부 — ${who}`, () =>
      tx(async () => {
        const u = await authUser();
        assert.ok((await attempt(GRANT, [u, "editor"], role)).ok);
        const r = await attempt(GRANT, [u, other], role);
        assert.equal(r.ok, false, `${other} 부여가 통과됨`);
        assert.match(r.message, /editor/);
        assert.equal((await client.query("select count(*)::int n from public.staff_roles where user_id = $1", [u])).rows[0].n, 1);
      }));

    test(`${other}가 있는 사람에게 editor를 주면 거부 — ${who}`, () =>
      tx(async () => {
        const u = await authUser();
        assert.ok((await attempt(GRANT, [u, other], role)).ok);
        const r = await attempt(GRANT, [u, "editor"], role);
        assert.equal(r.ok, false, "editor 부여가 통과됨");
      }));
  }

  test(`이미 있는 역할 행을 editor로 바꿔 ${other}와 겹치게 해도 거부 (UPDATE 경로)`, () =>
    tx(async () => {
      const u = await authUser();
      await client.query(GRANT, [u, "reporter"]);
      await client.query(GRANT, [u, other]);
      const r = await attempt("update public.staff_roles set role = 'editor' where user_id = $1 and role = 'reporter'", [u], "service_role");
      assert.equal(r.ok, false);
    }));
}

test("editor와 편집국 역할(reporter·reviewer)은 함께 줄 수 있다", () =>
  tx(async () => {
    const u = await authUser();
    for (const role of ["editor", "reporter", "reviewer"]) assert.ok((await attempt(GRANT, [u, role], "service_role")).ok, role);
  }));

test("편집국 외 역할끼리는 함께 줄 수 있다 (막는 것은 editor 조합뿐)", () =>
  tx(async () => {
    const u = await authUser();
    for (const role of NON_NEWSROOM) assert.ok((await attempt(GRANT, [u, role], "service_role")).ok, role);
  }));

test("다른 사람의 editor는 겸직 판정에 섞이지 않는다", () =>
  tx(async () => {
    const a = await authUser();
    const b = await authUser();
    assert.ok((await attempt(GRANT, [a, "editor"])).ok);
    assert.ok((await attempt(GRANT, [b, "ad_ops"])).ok);
  }));

test("editor를 회수한 뒤에는 ad_ops를 줄 수 있다", () =>
  tx(async () => {
    const u = await authUser();
    await client.query(GRANT, [u, "editor"]);
    await client.query("delete from public.staff_roles where user_id = $1 and role = 'editor'", [u]);
    assert.ok((await attempt(GRANT, [u, "ad_ops"])).ok);
  }));

test("같은 역할을 두 번 줄 수 없다 · 부여자(granted_by)가 비면 거부 · 부여 시각이 찍힌다", () =>
  tx(async () => {
    const u = await authUser();
    const first = await attempt(`${GRANT} returning granted_at`, [u, "reporter"]);
    assert.ok(first.rows[0].granted_at instanceof Date);
    assert.equal((await attempt(GRANT, [u, "reporter"])).ok, false);
    for (const by of [null, "", "  "]) {
      const r = await attempt("insert into public.staff_roles (user_id, role, granted_by) values ($1, 'reviewer', $2)", [u, by]);
      assert.equal(r.ok, false, JSON.stringify(by));
    }
  }));

test("anon·authenticated는 역할을 스스로 줄 수 없다 (가입 메타데이터로 위조 불가)", () =>
  tx(async () => {
    const u = await authUser();
    for (const role of ["anon", "authenticated"]) assert.equal((await attempt(GRANT, [u, "editor"], role)).ok, false, role);
    assert.ok((await attempt(GRANT, [u, "editor"], "service_role")).ok, "서버 경로로는 부여된다");
  }));

test("people에 평문 이메일·연락처 칸이 없다 (NAV-19 · PRD-01A 6.1)", async () => {
  const all = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'people'")).rows.map((r) => r.column_name);
  for (const col of ["slug", "name", "roles", "affiliation", "bio_items", "consent_doc_version", "visibility", "last_verified_at", "employment", "beat", "staff_user_id", "conflicts", "registered_at"]) {
    assert.ok(all.includes(col), `people.${col} 칸이 없다 (PRD-01C 5장 · PRD-01A 6.1)`);
  }
  const { rows } = await client.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'people' and column_name ~* '(mail|phone|tel|mobile|contact)'",
  );
  assert.deepEqual(rows, []);
});

test("people 역할 값은 reporter·editor·writer·reviewer·expert 안에서만, 1개 이상", () =>
  tx(async () => {
    const ins = "insert into public.people (slug, name, roles) values ($1, '시험', $2)";
    assert.ok((await attempt(ins, [uniq("p"), ["reporter", "editor", "writer", "reviewer", "expert"]])).ok);
    assert.equal((await attempt(ins, [uniq("p"), ["reporter", "ad_ops"]])).ok, false);
    assert.equal((await attempt(ins, [uniq("p"), []])).ok, false);
    const ok = await attempt("insert into public.people (slug, name, roles, employment) values ($1, '외부 필자', '{writer}', 'external') returning visibility", [uniq("p")]);
    assert.equal(ok.rows[0].visibility, "hidden", "새 인물은 비공개로 시작한다");
    assert.equal((await attempt("insert into public.people (slug, name, roles, employment) values ($1, 'x', '{writer}', 'freelance')", [uniq("p")])).ok, false);
  }));

test("한 계정(staff_user_id)에는 인물 행 하나 — 같은 계정의 두 번째 인물 행은 거부", () =>
  tx(async () => {
    const u = await authUser();
    const ins = "insert into public.people (slug, name, roles, staff_user_id) values ($1, '기자', '{reporter}', $2)";
    assert.ok((await attempt(ins, [uniq("p"), u])).ok);
    assert.equal((await attempt(ins, [uniq("p"), u])).ok, false);
  }));

test("증빙 ID 없는 약력 항목은 공개 약력(bio_items_public)에서 빠진다 (BR-01)", () =>
  tx(async () => {
    const bio = [
      { item: "세무사 등록", evidence_id: "EV-001", verified_by: "PO", verified_at: "2026-10-01" },
      { item: "경력 50년", evidence_id: null },
      { item: "저서 10권" },
      { item: "수상", evidence_id: "   " },
      { item: "교육원 강사", evidence_id: "EV-002" },
    ];
    const r = await attempt("insert into public.people (slug, name, roles, bio_items) values ($1, '김시험', '{writer}', $2) returning bio_items_public", [
      uniq("p"),
      JSON.stringify(bio),
    ]);
    assert.ok(r.ok, r.message);
    assert.deepEqual(r.rows[0].bio_items_public.map((b) => b.item), ["세무사 등록", "교육원 강사"]);
    const direct = await attempt("update public.people set bio_items_public = '[]' where slug like 'p-%'");
    assert.equal(direct.ok, false, "공개 약력은 직접 고칠 수 없다 (계산 칸)");
  }));

test("기사 인터뷰 기록(article_interviews)에 연락처·녹취 원문 칸이 없다 (NAV-11·NAV-12)", async () => {
  const { rows } = await client.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'article_interviews' and column_name ~* '(mail|phone|^tel|mobile|contact(?!ed_at$)|address|transcript|recording_text)'",
  );
  assert.deepEqual(rows, []);
  const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'article_interviews'")).rows.map(
    (r) => r.column_name,
  );
  assert.ok(cols.includes("record_location"), "보존 위치 칸은 있다");
});
