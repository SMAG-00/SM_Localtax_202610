// 형식별 목록·제휴사 프로필 통합 시험 (W2-c 4단계 — ART-08 · ART-09 · ART-10) — 로컬 Supabase에 anon 키로 읽는다 (RLS가 경계).
//  · 동영상 목록: 기능 키 video_list가 꺼지면 null, 켜면 형식 동영상만 — 썸네일은 공개 기사의 권리 확인 그림만(크기 칸 포함), 그릴 수 없는 동영상은 기사 카드 자리
//  · 포토 목록: 형식 포토만 · 제휴사: 공개 제휴사만(비공개 null), 그 제휴사의 공개 기사만, 계약 기간 칸은 읽지 않는다
// 시험 세계는 DB에 직접 넣고(커밋 — anon 요청은 다른 연결) 끝나면 지운다. 기능 키는 시험 전 값으로 되돌린다. 로컬 DB에서만 돈다.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const NOCOOKIE = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";

let db;
let api;
let flagsBefore;
const w = {};
const made = { articles: [], media: [], partners: [], people: [] };

function localSupabase() {
  const out = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: path.resolve(HERE, "../../../../../packages/db"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  for (const u of [j.API_URL, j.DB_URL]) {
    const host = new URL(u).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("이 시험은 로컬 Supabase에서만 돈다");
  }
  return j;
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
async function insert(table, cols, bucket) {
  const keys = Object.keys(cols);
  const row = await one(`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => cols[k]));
  made[bucket].push(Number(row.id));
  return row;
}
const media = (label, over = {}) =>
  insert("media", { path: `it/${RUN}/${label}.png`, alt: label, kind: "thumbnail", rights_status: "confirmed", credit: "편집국", license: "자체 제작", checked_at: new Date(), width: 1280, height: 720, ...over }, "media");
const videoBody = (thumbId, embedUrl = NOCOOKIE) =>
  JSON.stringify({ blocks: [{ type: "video", embedUrl, caption: "", summary: "요약", captions: true, thumbnailMediaId: thumbId === null ? null : String(thumbId), durationSeconds: 75 }], claims: [] });
const article = (label, over) =>
  insert("articles", { slug: `it-media-${label}-${RUN}`, title: `통합 형식 ${label}`, section: "tax", content_type: "explainer", author_id: w.reporter.id, status: "published", first_published_at: new Date(), ...over }, "articles");

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  flagsBefore = (await one("select value from public.settings where key = 'feature_flags'")).value;

  w.reporter = await insert("people", { slug: `it-media-reporter-${RUN}`, name: "통합 형식 기자", roles: ["reporter"], visibility: "public" }, "people");
  w.thumb = await media("thumb");
  w.loose = await media("loose", { rights_status: "unconfirmed", checked_at: null });
  w.draftThumb = await media("draft-thumb");
  w.video = await article("video", { format: "video", body: videoBody(w.thumb.id) });
  w.videoLoose = await article("video-loose", { format: "video", body: videoBody(w.loose.id) });
  w.videoBadUrl = await article("video-bad", { format: "video", body: videoBody(w.thumb.id, "https://www.youtube.com/embed/dQw4w9WgXcQ") });
  await article("video-draft", { format: "video", status: "draft", first_published_at: null, body: videoBody(w.draftThumb.id) });
  w.photo = await article("photo", { format: "photo" });
  w.general = await article("general", {});

  w.partnerOn = await insert("partners", { name: `통합제휴${RUN}`, kind: "tax_firm", intro: "공동 기획 제휴사", url: "https://partner.example", visible: true, contract_from: "2026-01-01", contract_to: "2026-02-01" }, "partners");
  w.partnerOff = await insert("partners", { name: `통합숨은제휴${RUN}`, kind: "media", visible: false }, "partners");
  w.coOn = await article("co-on", { content_type: "sponsored", label: "co_planned", partner_id: w.partnerOn.id });
  w.adOn = await article("ad-on", { content_type: "sponsored", label: "ad", partner_id: w.partnerOn.id });
  await article("co-on-draft", { content_type: "sponsored", label: "co_planned", partner_id: w.partnerOn.id, status: "draft", first_published_at: null });
  w.coOff = await article("co-off", { content_type: "sponsored", label: "co_planned", partner_id: w.partnerOff.id });

  api = await import("./index.ts");
});

afterAll(async () => {
  if (!db) return;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify(flagsBefore)]);
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query("delete from public.article_revisions where article_id = any($1::bigint[])", [made.articles]);
  await db.query("delete from public.articles where id = any($1::bigint[])", [made.articles]);
  await db.query("delete from public.media where id = any($1::bigint[])", [made.media]);
  await db.query("delete from public.partners where id = any($1::bigint[])", [made.partners]);
  await db.query("delete from public.people where id = any($1::bigint[])", [made.people]);
  await db.query("commit");
  await db.end();
});

const ours = (ids) => ids.filter((id) => [...made.articles].includes(id)).sort((a, b) => a - b);
const sorted = (...xs) => xs.map(Number).sort((a, b) => a - b);

describe("동영상 목록 (/news/video — ART-08)", () => {
  test("기능 키 video_list가 꺼져 있으면 null (화면 404 — 동영상 채널 결정 전)", async () => {
    await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...flagsBefore, video_list: false })]);
    expect(await api.getVideoList()).toBeNull();
  });

  test("켜면 형식 동영상 공개 기사만 — 권리 확인 썸네일이 읽히는 기사만 동영상 카드(크기 칸 포함), 나머지는 기사 카드 자리", async () => {
    await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...flagsBefore, video_list: true })]);
    const list = await api.getVideoList();
    expect(list).not.toBeNull();
    const byId = new Map(list.items.map((e) => [e.item.id, e]));
    expect(ours([...byId.keys()])).toEqual(sorted(w.video.id, w.videoLoose.id, w.videoBadUrl.id));
    expect(byId.get(Number(w.video.id)).video).toMatchObject({ durationSeconds: 75, captions: true, thumbnail: { id: Number(w.thumb.id), width: 1280, height: 720, src: `https://e2e.example.test/it/${RUN}/thumb.png` } });
    expect(byId.get(Number(w.videoLoose.id)).video, "권리 미확인 썸네일은 anon이 읽지 못한다").toBeNull();
    expect(byId.get(Number(w.videoBadUrl.id)).video, "youtube.com 주소는 동영상 카드로 그리지 않는다").toBeNull();
  });
});

describe("포토 목록 (/news/photo — ART-09)", () => {
  test("형식 포토 공개 기사만", async () => {
    const list = await api.getPhotoList();
    expect(ours(list.items.map((i) => i.id))).toEqual(sorted(w.photo.id));
    expect(list.items.find((i) => i.id === Number(w.photo.id)).format).toBe("photo");
  });
});

describe("제휴사 프로필 (/partners/[id] — ART-10)", () => {
  test("공개 제휴사 — 공개 칸(이름·종류·소개·누리집)과 그 제휴사의 공개 기사만, 표기 배지는 목록 카드 값 그대로", async () => {
    const page = await api.getPartnerPage(Number(w.partnerOn.id));
    expect(page.partner).toEqual({ id: Number(w.partnerOn.id), name: `통합제휴${RUN}`, kindName: "세무법인", intro: "공동 기획 제휴사", siteUrl: "https://partner.example/" });
    expect(page.partner).not.toHaveProperty("contractTo");
    expect(page.items.map((i) => i.id).sort((a, b) => a - b)).toEqual(sorted(w.coOn.id, w.adOn.id));
    expect(page.items.find((i) => i.id === Number(w.coOn.id)).sponsor).toEqual({ kind: "co_planned", partner: `통합제휴${RUN}` });
    expect(page.items.find((i) => i.id === Number(w.adOn.id)).sponsor).toEqual({ kind: "ad" });
  });

  test("비공개·없는 제휴사는 null (화면 404)", async () => {
    expect(await api.getPartnerPage(Number(w.partnerOff.id))).toBeNull();
    expect(await api.getPartnerPage(999_999_999)).toBeNull();
  });
});
