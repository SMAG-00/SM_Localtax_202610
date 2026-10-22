// W2-c 4단계 DB — 형식 콘텐츠 (ART-07 · ART-08 · ART-09, docs/dev/W2-c_설계.md 8.4 · 마이그레이션 20261018000017_w2c_media_formats.sql)
//  · media.width·height — 둘 다 있거나 둘 다 없다, 1~20000. anon은 공개 그림의 크기를 읽는다(쓰기 0)
//  · articles.body_media_ids — 동영상 블록의 썸네일 번호가 들어간다 → 공개 기사의 권리 확인 썸네일만 anon이 읽는다(초안·미확인 0)
//  · settings.feature_flags.video_list — 동영상 목록(/news/video) 기능 키, 씨앗 false (동영상 채널 결정 전 — PRD-01A 1.3)
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
function insertSql(table, cols) {
  const keys = Object.keys(cols);
  return { sql: `insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, params: keys.map((k) => cols[k]) };
}
const tryInsert = (table, cols, role) => {
  const { sql, params } = insertSql(table, cols);
  return attempt(sql, params, role);
};
async function insert(table, cols) {
  const { sql, params } = insertSql(table, cols);
  return (await client.query(sql, params)).rows[0];
}
const confirmed = (over = {}) => ({ path: `${uniq("m")}.jpg`, kind: "photo", rights_status: "confirmed", credit: "가온시청", photographer: "김가온", license: "공공누리 제1유형", license_type: "kogl_1", checked_at: new Date(), ...over });

test("media 크기 — 가로·세로는 함께 있거나 함께 없고, 1~20000 픽셀만", () =>
  tx(async () => {
    assert.ok((await tryInsert("media", confirmed({ width: 1920, height: 1080 }))).ok, "둘 다");
    assert.ok((await tryInsert("media", confirmed())).ok, "둘 다 없음 (크기 모름)");
    assert.ok((await tryInsert("media", confirmed({ width: 1, height: 20000 }))).ok, "경계 1·20000");
    for (const [w, h, why] of [
      [1920, null, "세로 없음"],
      [null, 1080, "가로 없음"],
      [0, 1080, "가로 0"],
      [1920, 20001, "세로 20001"],
      [-16, 9, "음수"],
    ]) {
      const r = await tryInsert("media", confirmed({ width: w, height: h }));
      assert.equal(r.ok, false, why);
      assert.equal(r.code, "23514", why);
    }
  }));

test("동영상 블록의 썸네일 번호가 body_media_ids에 들어간다 — 썸네일 없는 동영상(null)은 넣지 않는다", () =>
  tx(async () => {
    const body = {
      blocks: [
        { type: "image", mediaId: "11", alt: "사진", caption: "" },
        { type: "infographic", mediaId: "12", alt: "그림", caption: "", chart: null, template: "flow", data: { kind: "list", items: ["a"] } },
        { type: "video", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", caption: "", summary: "요약", captions: true, thumbnailMediaId: "13", durationSeconds: 60 },
        { type: "video", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", caption: "", summary: "", captions: false, thumbnailMediaId: null, durationSeconds: null },
        { type: "paragraph", text: "본문" },
      ],
      claims: [],
    };
    const a = await insert("articles", { slug: uniq("a"), title: "기사", section: "tax", content_type: "explainer", body: JSON.stringify(body) });
    assert.deepEqual(a.body_media_ids, ["11", "12", "13"]);
    const forged = await attempt("update public.articles set body_media_ids = '[]'::jsonb where id = $1", [a.id], null);
    assert.equal(forged.ok, false, "계산 칸은 직접 쓸 수 없다");
  }));

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 공개 기사의 권리 확인 썸네일만 읽는다(크기 칸 포함), 초안 기사·권리 미확인 썸네일은 0행`, () =>
    tx(async () => {
      const thumb = await insert("media", confirmed({ kind: "thumbnail", photographer: null, width: 1280, height: 720 }));
      const draftThumb = await insert("media", confirmed({ kind: "thumbnail", photographer: null, width: 1920, height: 1080 }));
      const loose = await insert("media", { path: `${uniq("u")}.jpg`, kind: "thumbnail", width: 1920, height: 1080 });
      const video = (mediaId) => JSON.stringify({ blocks: [{ type: "video", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", caption: "", summary: "요약", captions: true, thumbnailMediaId: String(mediaId), durationSeconds: 30 }], claims: [] });
      await insert("articles", { slug: uniq("pub"), title: "동영상", section: "tax", content_type: "explainer", format: "video", status: "published", body: video(thumb.id) });
      await insert("articles", { slug: uniq("pub2"), title: "동영상 2", section: "tax", content_type: "explainer", format: "video", status: "published", body: video(loose.id) });
      await insert("articles", { slug: uniq("draft"), title: "초안", section: "tax", content_type: "explainer", format: "video", status: "draft", body: video(draftThumb.id) });
      const r = await attempt("select id, width, height from public.media where id = any($1::bigint[]) order by id", [[thumb.id, draftThumb.id, loose.id]], role);
      assert.ok(r.ok, r.message);
      assert.deepEqual(r.rows.map((x) => [Number(x.id), x.width, x.height]), [[Number(thumb.id), 1280, 720]]);
    }));

  test(`${role} — 그림 크기를 고치지 못한다`, () =>
    tx(async () => {
      const m = await insert("media", confirmed({ width: 1920, height: 1080 }));
      const r = await attempt("update public.media set width = 1, height = 1 where id = $1", [m.id], role);
      assert.equal(r.ok, false);
      assert.equal(r.code, "42501");
    }));
}

test("기능 키 video_list(동영상 목록) 씨앗은 false — 동영상 채널 결정 전에는 동영상 목록을 숨긴다", async () => {
  const { rows } = await client.query("select value from public.settings where key = 'feature_flags'");
  assert.equal(rows[0].value.video_list, false);
});
