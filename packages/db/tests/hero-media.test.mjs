// 히어로 배경 설정 hero_media (마이그레이션 20261025000078 — PO 결정 2026-10-25)
//  · 씨앗: 홈은 영상+포스터, 네 허브는 포스터만, aiLabel 켜짐
//  · 저장 검사: 아는 키만 · /media/hero/ 안의 파일 경로만(외부 주소·상위 폴더·하위 폴더 불가) · 영상/그림 확장자 구분 · aiLabel은 참/거짓
//  · anon은 이 키 한 줄을 읽는다 (settings_public_hero_media)
// 경로는 '시험용' 가짜 파일 이름이다.
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
const setHero = (value) => attempt("update public.settings set value = $1::jsonb where key = 'hero_media'", [JSON.stringify(value)]);

test("씨앗 — 홈은 영상·포스터, 네 허브는 포스터만(영상 없음), aiLabel 켜짐", async () => {
  const v = (await client.query("select value from public.settings where key = 'hero_media'")).rows[0].value;
  assert.equal(v.aiLabel, true);
  assert.equal(v.home.video, "/media/hero/home.mp4");
  assert.equal(v.home.videoMobile, "/media/hero/home-m.mp4");
  for (const k of ["tax", "realestate", "finance", "local"]) {
    assert.equal(v[k].poster, `/media/hero/${k}.avif`);
    assert.equal(v[k].video, undefined, `${k}: 영상 없음`);
  }
});

test("저장 — 영상·포스터·빈 칸(null·빈 글자)·aiLabel false는 통과", async () => {
  await tx(async () => {
    assert.ok((await setHero({ home: { video: "/media/hero/a.mp4", videoMobile: "/media/hero/a-m.webm", poster: "/media/hero/a.avif", posterMobile: "/media/hero/a-m.WEBP", card: "/media/hero/a.jpg" }, aiLabel: false })).ok);
    assert.ok((await setHero({ tax: { video: null, poster: "" } })).ok, "null·빈 글자는 없음");
    assert.ok((await setHero({})).ok, "빈 객체 = 전부 그라데이션");
  });
});

test("저장 — 외부 주소·상위 폴더·하위 폴더·쿼리·폴더 밖은 거부", async () => {
  await tx(async () => {
    for (const bad of ["https://evil.example/a.mp4", "//evil.example/a.mp4", "/media/hero/../x.mp4", "/media/hero/sub/a.mp4", "/media/hero/a.mp4?x=1", "/media/other/a.mp4", "media/hero/a.mp4", "/media/hero/.hidden.mp4", "/media/hero/a b.mp4"]) {
      const r = await setHero({ home: { video: bad } });
      assert.equal(r.ok, false, `거부돼야 함: ${bad}`);
      assert.equal(r.code, "23514");
    }
  });
});

test("저장 — 영상 칸에 그림, 그림 칸에 영상 확장자는 거부", async () => {
  await tx(async () => {
    assert.equal((await setHero({ home: { video: "/media/hero/a.avif" } })).ok, false);
    assert.equal((await setHero({ home: { poster: "/media/hero/a.mp4" } })).ok, false);
    assert.equal((await setHero({ home: { poster: "/media/hero/a.svg" } })).ok, false, "svg는 그림 목록에 없다");
  });
});

test("저장 — 모르는 키·모르는 칸·모양 틀림은 거부", async () => {
  await tx(async () => {
    assert.equal((await setHero({ news: { poster: "/media/hero/a.avif" } })).ok, false);
    assert.equal((await setHero({ home: { autoplay: "/media/hero/a.mp4" } })).ok, false);
    assert.equal((await setHero({ home: "/media/hero/a.avif" })).ok, false);
    assert.equal((await setHero({ home: { poster: 3 } })).ok, false);
    assert.equal((await setHero({ aiLabel: "yes" })).ok, false);
    assert.equal((await setHero(["home"])).ok, false);
  });
});

test("공개 읽기 — anon이 hero_media 한 줄을 읽는다 (다른 비공개 설정은 못 읽는다)", async () => {
  await tx(async () => {
    const hero = await attempt("select key from public.settings where key = 'hero_media'", [], "anon");
    assert.equal(hero.rows.length, 1);
    const secret = await attempt("select key from public.settings where key = 'billing_retry_policy'", [], "anon");
    assert.equal(secret.rows.length, 0);
  });
});
