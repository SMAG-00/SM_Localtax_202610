// W9 준비 DB — 옛 주소 이동표 redirects (docs/dev/W9_설계.md 3장, 마이그레이션 20261025000077, PRD-01A MIG-02)
//  · 상태·새 주소 짝 · 404/410 사유 필수 · 제자리 이동 0 · 새 홈('/')은 옛 홈 주소만 · 옛 주소 중복 0 · 연쇄 0(양방향) · anon/authenticated 접근 0
// 이 마이그레이션은 W9 실행 전까지 원격에 적용하지 않는다 — 로컬에 아직 없으면 시험이 한 거래 안에서 직접 적용하고 되돌린다 (남는 행·표 0).
// 내용은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const SQL = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations", "20261025000077_w9_redirects.sql"), "utf8");

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
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
    const exists = (await client.query("select to_regclass('public.redirects') as t")).rows[0].t;
    if (!exists) await client.query(SQL);
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
const ins = (oldPath, newPath, status, reason = null, origin = "legacy_site") =>
  attempt("insert into public.redirects (old_path, new_path, status, reason, origin) values ($1, $2, $3, $4, $5) returning id", [oldPath, newPath, status, reason, origin]);

test("301은 새 주소 필수, 404·410은 새 주소 없음 + 사유 필수", () =>
  tx(async () => {
    assert.equal((await ins("/news/articleView.html?idxno=1", "/news/legacy-1", 301)).ok, true);
    assert.equal((await ins("/a", "/b", 308)).ok, true);
    assert.equal((await ins("/c", null, 301)).ok, false, "301인데 새 주소 없음");
    assert.equal((await ins("/d", "/e", 410, "사유")).ok, false, "410인데 새 주소 있음");
    assert.equal((await ins("/f", null, 410)).ok, false, "410 사유 없음");
    assert.equal((await ins("/g", null, 404, "  ")).ok, false, "404 공백 사유");
    assert.equal((await ins("/h", null, 410, "삭제된 기사")).ok, true);
    assert.equal((await ins("/i", "/j", 302)).ok, false, "허용 밖 상태");
    assert.equal((await ins("/k", "/l", 301, null, "other")).ok, false, "허용 밖 origin");
  }));

test("제자리 이동·옛 기사 주소의 새 홈 이동·형식 오류·옛 주소 중복을 거부한다", () =>
  tx(async () => {
    assert.equal((await ins("/same", "/same", 301)).ok, false, "제자리");
    assert.equal((await ins("/news/articleView.html?idxno=2", "/", 301)).ok, false, "새 홈으로");
    assert.equal((await ins("/", "/news", 301)).ok, true, "옛 홈은 가능");
    assert.equal((await ins("noslash", "/x", 301)).ok, false, "옛 주소가 '/'로 시작하지 않음");
    assert.equal((await ins("/p", "https://evil.example.test/", 301)).ok, false, "바깥 주소");
    assert.equal((await ins("/q", "/r?x=1", 301)).ok, false, "새 주소에 쿼리");
    assert.equal((await ins("/dup", "/z1", 301)).ok, true);
    assert.equal((await ins("/dup", "/z2", 301)).ok, false, "옛 주소 중복");
  }));

test("연쇄 이동 0: 도착이 다른 행의 옛 주소이거나, 이 행의 옛 주소가 다른 행의 도착이면 거부", () =>
  tx(async () => {
    assert.equal((await ins("/old-a", "/mid", 301)).ok, true);
    const next = await ins("/mid", "/end", 301);
    assert.equal(next.ok, false, "도착(/mid)이 다른 행의 옛 주소 쪽에서 막혀야 한다");
    assert.match(next.message, /연쇄/);
    const before = await ins("/start", "/old-a", 301);
    assert.equal(before.ok, false, "도착(/old-a)이 다른 행의 옛 주소");
    assert.match(before.message, /연쇄/);
    assert.equal((await ins("/old-b", "/mid", 301)).ok, true, "같은 도착으로 여러 옛 주소가 모이는 것은 연쇄가 아니다");
    const upd = await attempt("update public.redirects set new_path = '/old-b' where old_path = '/old-a'");
    assert.equal(upd.ok, false, "수정으로 연쇄를 만들 수 없다");
  }));

test("anon·authenticated는 표를 읽거나 쓸 수 없고 RLS가 켜져 있다", () =>
  tx(async () => {
    const rls = (await client.query("select relrowsecurity from pg_class where oid = 'public.redirects'::regclass")).rows[0];
    assert.equal(rls.relrowsecurity, true);
    for (const role of ["anon", "authenticated"]) {
      await client.query(`set local role ${role}`);
      const read = await attempt("select * from public.redirects");
      assert.equal(read.ok, false, `${role} 읽기`);
      const write = await attempt("insert into public.redirects (old_path, new_path, status, origin) values ('/x', '/y', 301, 'legacy_site')");
      assert.equal(write.ok, false, `${role} 쓰기`);
      await client.query("reset role");
    }
  }));

test("행 0으로 시작한다 (씨앗 없음)", () =>
  tx(async () => {
    const n = (await client.query("select count(*)::int as n from public.redirects")).rows[0].n;
    assert.equal(n, 0);
  }));

test("scripts/migration이 만든 redirects.sql(가짜 기사 3건 + 제외 1건)이 그대로 적재되고, 두 번 돌려도 같은 결과다", () =>
  tx(async () => {
    const { runDryRun } = await import("../../../scripts/migration/run.mjs");
    const rec = (id, over = {}) => ({ legacy_id: String(id), title: `가상 제목 ${id}`, category: "S1N2", author_name: "가상필자", published_at: "2026-10-01T09:00:00+09:00", body_text: "본문", status: "published", ...over });
    const out = runDryRun({ format: "ltr-legacy-articles", version: 1, articles: [rec(1), rec(2), rec(3, { category: "S1N5" }), rec(4, { status: "deleted" })] }, { now: new Date("2026-10-25T00:00:00+09:00") });
    assert.equal(out.ok, true);
    const body = out.redirectsSql.replace(/^begin;\n/m, "").replace(/^commit;\n?/m, "");
    await client.query(body);
    await client.query(body);
    const rows = (await client.query("select old_path, new_path, status from public.redirects where old_path like '/news/articleView.html?idxno=%' order by old_path")).rows;
    assert.deepEqual(rows, [
      { old_path: "/news/articleView.html?idxno=1", new_path: "/news/legacy-1", status: 301 },
      { old_path: "/news/articleView.html?idxno=2", new_path: "/news/legacy-2", status: 301 },
      { old_path: "/news/articleView.html?idxno=3", new_path: "/news/legacy-3", status: 301 },
      { old_path: "/news/articleView.html?idxno=4", new_path: null, status: 410 },
    ]);
    const total = (await client.query("select count(*)::int as n from public.redirects")).rows[0].n;
    assert.equal(total, out.urlMap.length);
  }));
