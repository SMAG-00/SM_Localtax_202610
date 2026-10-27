// F1 — 사진 보관(Storage) 버킷 media와 media 표 규칙 (docs/dev/F1_설계.md)
//  · 버킷은 공개 읽기·4,000,000바이트·jpeg/png/webp만 · 쓰기 정책 0(anon·authenticated는 올리기·지우기 불가, service_role만)
//  · media 표: 권리 확인(confirmed)은 출처·이용 조건·확인일·(사진은 촬영자)·공공누리 유형이 있어야 하고, 권리 미확인 사진은 anon이 읽지 못한다
// 모든 시험은 트랜잭션 안에서 하고 되돌린다. 로컬 DB에서만 돈다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돈다");
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
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (e) {
    await client.query("rollback to savepoint t");
    return { ok: false, code: e.code, constraint: e.constraint, message: e.message };
  }
}

test("버킷 media: 공개 읽기 · 4,000,000바이트 · jpeg/png/webp만", async () => {
  const r = await client.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'media'");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].public, true);
  assert.equal(Number(r.rows[0].file_size_limit), 4000000);
  assert.deepEqual([...r.rows[0].allowed_mime_types].sort(), ["image/jpeg", "image/png", "image/webp"]);
});

test("저장소 객체에 media 버킷 쓰기 정책이 없다 — anon·authenticated는 올리기를 못 한다", () =>
  tx(async () => {
    const pol = await client.query("select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') ilike '%media%' or coalesce(with_check, '') ilike '%media%') and (coalesce(qual, '') not ilike '%inquiry%')");
    assert.deepEqual(pol.rows, []);
    for (const role of ["anon", "authenticated"]) {
      const r = await attempt("insert into storage.objects (bucket_id, name) values ('media', 'f1-test.png')", [], role);
      assert.equal(r.ok, false, `${role}가 올릴 수 있다`);
      assert.match(r.code, /^(42501|P0001)$/, role);
    }
  }));

test("media 표: 공공누리 유형 없이는 권리 확인 불가, 모두 갖추면 확인 가능", () =>
  tx(async () => {
    const ins = await client.query("insert into public.media (path, alt, credit, photographer, license, kind) values ('storage/v1/object/public/media/t.png', '시험', '가온시청', '홍길동', '자체 촬영', 'photo') returning id");
    const id = ins.rows[0].id;
    const noType = await attempt("update public.media set rights_status = 'confirmed', checked_at = now() where id = $1", [id]);
    assert.equal(noType.ok, false);
    assert.equal(noType.constraint, "media_license_required");
    const ok = await attempt("update public.media set license_type = 'not_applicable', rights_status = 'confirmed', checked_at = now() where id = $1", [id]);
    assert.equal(ok.ok, true);
  }));

test("media 표: 사진은 촬영자 없이 확인 불가(썸네일은 가능), 확인일 없이도 불가", () =>
  tx(async () => {
    const photo = await client.query("insert into public.media (path, alt, credit, license, license_type, kind) values ('storage/v1/object/public/media/p.png', '시험', '출처', '이용', 'not_applicable', 'photo') returning id");
    const noPhotographer = await attempt("update public.media set rights_status = 'confirmed', checked_at = now() where id = $1", [photo.rows[0].id]);
    assert.equal(noPhotographer.constraint, "media_confirmed_complete");
    const thumb = await client.query("insert into public.media (path, alt, credit, license, license_type, kind) values ('storage/v1/object/public/media/q.png', '시험', '출처', '이용', 'not_applicable', 'thumbnail') returning id");
    assert.equal((await attempt("update public.media set rights_status = 'confirmed', checked_at = now() where id = $1", [thumb.rows[0].id])).ok, true);
    const noDate = await client.query("insert into public.media (path, alt, credit, photographer, license, license_type, kind) values ('storage/v1/object/public/media/r.png', '시험', '출처', '작가', '이용', 'not_applicable', 'photo') returning id");
    assert.equal((await attempt("update public.media set rights_status = 'confirmed' where id = $1", [noDate.rows[0].id])).constraint, "media_confirmed_complete");
  }));

test("anon은 기사에 쓰이지 않은 사진(권리 미확인 포함)을 읽지 못한다", () =>
  tx(async () => {
    const ins = await client.query("insert into public.media (path, alt) values ('storage/v1/object/public/media/hidden.png', '숨김 시험') returning id");
    const r = await attempt("select id from public.media where id = $1", [ins.rows[0].id], "anon");
    assert.equal(r.ok, true);
    assert.equal(r.rowCount, 0);
  }));
