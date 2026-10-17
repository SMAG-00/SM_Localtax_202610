// FND-04 — RLS를 켜지 않은 테이블을 만드는 마이그레이션은 CI가 실패시킨다.
// FND-06 — `events`라는 이름의 표는 만들지 않는다 (측정 표 analytics_events · 행사 표 local_events).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintMigrations, lintMigrationDir } from "../scripts/lint-migrations.mjs";

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const f = (name, sql) => ({ name, sql });

test("RLS를 켠 테이블은 통과", () => {
  const r = lintMigrations([f("001.sql", "create table public.foo (id int);\nalter table public.foo enable row level security;")]);
  assert.deepEqual(r.errors, []);
});

test("RLS를 켜지 않은 테이블은 그 이름과 파일로 오류", () => {
  const r = lintMigrations([f("001.sql", "create table public.foo (id int);")]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /public\.foo/);
  assert.match(r.errors[0], /001\.sql/);
});

test("뒤 마이그레이션에서 RLS를 켜도 통과", () => {
  const r = lintMigrations([
    f("001.sql", "create table foo (id int);"),
    f("002.sql", "alter table only public.foo enable row level security;"),
  ]);
  assert.deepEqual(r.errors, []);
});

test("if not exists·따옴표 이름·대소문자도 같은 테이블로 본다", () => {
  const r = lintMigrations([
    f("001.sql", 'CREATE TABLE IF NOT EXISTS "public"."Bar" (id int);\nALTER TABLE "public"."Bar" ENABLE ROW LEVEL SECURITY;'),
  ]);
  assert.deepEqual(r.errors, []);
});

test("다른 테이블의 RLS로 대신할 수 없다", () => {
  const r = lintMigrations([
    f("001.sql", "create table public.a (id int);\ncreate table public.b (id int);\nalter table public.a enable row level security;"),
  ]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /public\.b/);
});

test("RLS를 껐다면(disable) 오류", () => {
  const r = lintMigrations([
    f("001.sql", "create table public.a (id int);\nalter table public.a enable row level security;"),
    f("002.sql", "alter table public.a disable row level security;"),
  ]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /disable/);
});

test("주석 안의 create table은 세지 않는다", () => {
  const r = lintMigrations([f("001.sql", "-- create table public.x (id int);\n/* create table public.y (id int); */ select 1;")]);
  assert.deepEqual(r.errors, []);
});

for (const name of ["events", "public.events", '"events"']) {
  test(`events 이름의 표(${name})는 이름 충돌 오류`, () => {
    const r = lintMigrations([f("001.sql", `create table ${name} (id int);\nalter table ${name} enable row level security;`)]);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /events/);
    assert.match(r.errors[0], /analytics_events|local_events/);
  });
}

test("analytics_events·local_events는 이름 충돌이 아니다", () => {
  const r = lintMigrations([
    f(
      "001.sql",
      "create table public.analytics_events (id int);\nalter table public.analytics_events enable row level security;\ncreate table public.local_events (id int);\nalter table public.local_events enable row level security;",
    ),
  ]);
  assert.deepEqual(r.errors, []);
});

test("저장소의 실제 마이그레이션 폴더는 통과", () => {
  const r = lintMigrationDir(MIGRATIONS);
  assert.ok(r.files > 0, "마이그레이션 파일이 1개 이상 있어야 한다");
  assert.deepEqual(r.errors, []);
});
