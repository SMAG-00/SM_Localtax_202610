// 사진 보관함 E2E (F1) — docs/dev/F1_설계.md
// standalone 빌드를 로컬 Supabase(Auth·DB·Storage)에 붙인다. 실제 PNG 파일을 multipart로 올린다.
//  a) 올리기 — 기자가 올리면 201·'권리 미확인'·저장소 공개 경로·가로세로 자동 기록, 올린 파일이 공개 주소에서 같은 바이트로 열린다
//  b) 거부 — 글자 파일(.png 이름)·대체 텍스트 없음·4,000,000바이트 초과·JSON 본문·광고 담당(403)·로그인 없음(401)
//  c) 권리 — 기자 확인 403(+거부 감사) · 공공누리 유형 없이 확인 422(빠진 칸 안내) · 채운 뒤 편집 책임자 확인 200(확인일·감사) ·
//     확인된 사진의 출처는 기자가 못 고치고(403) 대체 텍스트는 고칠 수 있다 · 반려·되돌리기
//  d) 공개 화면 — 소제목(h2·h3)·문단 링크(rel)·권리 확인된 사진(저장소 주소)은 나오고 권리 미확인 사진은 안 나온다
//  e) 화면 — /admin/media 올리기 폼으로 사진을 올리면 목록에 나오고, 360px에서 가로 스크롤 0
// 만든 계정·사진·기사·감사 로그·저장소 파일은 끝나면 지운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "admin-media-e2e@example.test";
let sb, server, staff, db, base, browser;
const u = {};
const objectNames = [];
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3, 0xcc);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function call(method, path, user, { json, form } = {}) {
  const headers = {};
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: json !== undefined ? JSON.stringify(json) : form });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const show = (r) => JSON.stringify(r.body).slice(0, 1200);

function uploadForm(bytes, fields = {}, filename = "사진.png", type = "image/png") {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type }), filename);
  for (const [k, v] of Object.entries({ alt: "가온시청 전경", credit: "가온시청", photographer: "김가온", license: "자체 촬영", ...fields })) form.set(k, v);
  return form;
}
async function upload(user, bytes, fields, filename, type) {
  const r = await call("POST", "/media", user, { form: uploadForm(bytes, fields, filename, type) });
  if (r.status === 201) {
    staff.trackRow("media", r.body.media.id);
    objectNames.push(r.body.media.path.split("/").pop());
  }
  return r;
}
const auditCount = async (userId, action, target) => (await one("select count(*)::int n from public.audit_logs where actor = $1 and action = $2 and target = $3", [`user:${userId}`, action, target])).n;

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: "https://e2e.example.test",
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  u.reporter = await staff.createUser({ label: "media-rep", roles: ["reporter"], person: { name: "보관함 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "media-ed", roles: ["editor"], person: { name: "보관함 편집자", roles: ["editor"] } });
  u.adOps = await staff.createUser({ label: "media-ad", roles: ["ad_ops"] });
  u.admin = await staff.createUser({ label: "media-admin", email: ADMIN_EMAIL });
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    for (const name of objectNames) await fetch(`${sb.url}/storage/v1/object/media/${name}`, { method: "DELETE", headers: { authorization: `Bearer ${sb.serviceRoleKey}`, apikey: sb.serviceRoleKey } }).catch(() => {});
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

const fx = {};

test("a) 기자가 올리면 201·권리 미확인·저장소 공개 경로·가로세로 자동 기록, 올린 파일이 공개 주소에서 같은 바이트로 열린다", async () => {
  const bytes = png(64, 36);
  const r = await upload(u.reporter, bytes);
  assert.equal(r.status, 201, show(r));
  const m = r.body.media;
  fx.a = m;
  assert.equal(m.rights_status, "unconfirmed");
  assert.equal(m.kind, "photo");
  assert.equal(m.width, 64);
  assert.equal(m.height, 36);
  assert.match(m.path, /^storage\/v1\/object\/public\/media\/[0-9a-f-]{36}\.png$/);
  assert.equal(m.url, `${sb.url}/${m.path}`);
  const file = await fetch(m.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  assert.equal(await auditCount(u.reporter.id, "media.create", `media:${m.id}`), 1);
  const list = await call("GET", "/media", u.reporter);
  assert.equal(list.status, 200);
  assert.ok(list.body.media.some((x) => x.id === m.id));
});

test("b) 거부 — 글자 파일·대체 텍스트 없음·4,000,000바이트 초과·JSON 본문·광고 담당 403·로그인 없음 401", async () => {
  const text = await call("POST", "/media", u.reporter, { form: uploadForm(Buffer.from("이름만 png인 글자 파일입니다. ".repeat(10)), {}, "가짜.png") });
  assert.equal(text.status, 422, show(text));
  assert.ok(text.body.errors.some((e) => e.startsWith("file:")), show(text));
  const noAlt = await call("POST", "/media", u.reporter, { form: uploadForm(png(8, 8), { alt: "  " }) });
  assert.equal(noAlt.status, 422);
  assert.ok(noAlt.body.errors.includes("alt: 대체 텍스트(사진 설명)가 필요합니다"), show(noAlt));
  const badUrl = await call("POST", "/media", u.reporter, { form: uploadForm(png(8, 8), { source_url: "javascript:alert(1)" }) });
  assert.equal(badUrl.status, 422, show(badUrl));
  const big = Buffer.concat([png(8, 8), Buffer.alloc(4_000_001)]);
  const tooBig = await call("POST", "/media", u.reporter, { form: uploadForm(big) });
  assert.ok([413, 422].includes(tooBig.status), show(tooBig));
  const asJson = await call("POST", "/media", u.reporter, { json: { alt: "x" } });
  assert.equal(asJson.status, 415, show(asJson));
  const denied = await call("POST", "/media", u.adOps, { form: uploadForm(png(8, 8)) });
  assert.equal(denied.status, 403, show(denied));
  const anon = await call("POST", "/media", null, { form: uploadForm(png(8, 8)) });
  assert.equal(anon.status, 401);
  assert.equal((await call("GET", "/media", u.adOps)).status, 403);
  assert.equal((await one("select count(*)::int n from public.media where alt = '가온시청 전경' and id <> $1", [fx.a.id])).n, 0, "거부된 요청이 행을 남기지 않는다");
});

test("c) 권리 — 기자 403(거부 감사) · 유형 없이 확인 422 · 채운 뒤 편집 책임자 확인 · 확인된 사진의 출처는 기자가 못 고침 · 반려·되돌리기", async () => {
  const id = fx.a.id;
  const target = `media:${id}`;
  const byReporter = await call("POST", `/media/${id}/rights`, u.reporter, { json: { decision: "confirmed" } });
  assert.equal(byReporter.status, 403, show(byReporter));
  assert.equal(await auditCount(u.reporter.id, "media.rights.denied", target), 1);

  const bad = await call("POST", `/media/${id}/rights`, u.editor, { json: { decision: "nonsense" } });
  assert.equal(bad.status, 422);
  const missing = await call("POST", `/media/${id}/rights`, u.editor, { json: { decision: "confirmed" } });
  assert.equal(missing.status, 422, show(missing));
  assert.match(missing.body.error, /공공누리 유형/);
  assert.equal((await one("select rights_status from public.media where id = $1", [id])).rights_status, "unconfirmed");

  const patched = await call("PATCH", `/media/${id}`, u.reporter, { json: { license_type: "not_applicable" } });
  assert.equal(patched.status, 200, show(patched));
  const ok = await call("POST", `/media/${id}/rights`, u.editor, { json: { decision: "confirmed" } });
  assert.equal(ok.status, 200, show(ok));
  assert.equal(ok.body.media.rights_status, "confirmed");
  assert.ok(ok.body.media.checked_at);
  assert.equal(await auditCount(u.editor.id, "media.rights.confirmed", target), 1);

  const credit = await call("PATCH", `/media/${id}`, u.reporter, { json: { credit: "몰래 바꾼 출처" } });
  assert.equal(credit.status, 403, show(credit));
  assert.equal((await one("select credit from public.media where id = $1", [id])).credit, "가온시청");
  const alt = await call("PATCH", `/media/${id}`, u.reporter, { json: { alt: "고친 설명" } });
  assert.equal(alt.status, 200, show(alt));
  assert.equal((await call("PATCH", `/media/${id}`, u.reporter, { json: {} })).status, 422);
  assert.equal((await call("PATCH", `/media/999999999`, u.reporter, { json: { alt: "x" } })).status, 404);

  const rejected = await call("POST", `/media/${id}/rights`, u.editor, { json: { decision: "rejected" } });
  assert.equal(rejected.body.media.rights_status, "rejected");
  const reverted = await call("POST", `/media/${id}/rights`, u.editor, { json: { decision: "unconfirmed" } });
  assert.equal(reverted.body.media.rights_status, "unconfirmed");
  assert.equal(reverted.body.media.checked_at, null);
  const again = await call("POST", `/media/${id}/rights`, u.editor, { json: { decision: "confirmed" } });
  assert.equal(again.status, 200, show(again));
  const adminOk = await call("POST", `/media/${id}/rights`, u.admin, { json: { decision: "confirmed" } });
  assert.equal(adminOk.status, 200, "관리자도 권리 확인을 할 수 있다");
});

test("d) 공개 화면 — 소제목 h2·h3 · 문단 링크 rel · 권리 확인된 사진은 저장소 주소로, 미확인 사진은 나오지 않는다", async () => {
  const unconfirmed = await upload(u.reporter, png(32, 32), { alt: "미확인 사진 설명" });
  assert.equal(unconfirmed.status, 201);
  const confirmedId = fx.a.id;
  const slug = `e2e-media-heading-${staff.run}`;
  const blocks = [
    { type: "heading", level: 2, text: "큰 소제목입니다" },
    { type: "paragraph", text: "자세한 내용은 [법령정보](https://www.law.go.kr/a)와 [이상한](javascript:alert(1))를 봅니다." },
    { type: "heading", level: 3, text: "작은 소제목입니다" },
    { type: "image", mediaId: String(confirmedId), alt: "", caption: "확인된 사진" },
    { type: "image", mediaId: String(unconfirmed.body.media.id), alt: "", caption: "미확인 사진" },
  ];
  const a = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, format, label, body, first_published_at)
     values ($1, '소제목 시험 기사', '소제목과 사진을 그립니다.', 'tax', 'explainer', 'published', $2, 'general', 'none', $3, now() - interval '1 day') returning id`,
    [slug, u.reporter.personId, JSON.stringify({ blocks, claims: [] })],
  );
  staff.trackArticle(a.id);
  const res = await fetch(`${base}/news/${slug}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h2[^>]*>큰 소제목입니다<\/h2>/);
  assert.match(html, /<h3[^>]*>작은 소제목입니다<\/h3>/);
  assert.match(html, /<a [^>]*href="https:\/\/www\.law\.go\.kr\/a"[^>]*rel="noopener noreferrer"|<a [^>]*rel="noopener noreferrer"[^>]*href="https:\/\/www\.law\.go\.kr\/a"/);
  assert.ok(!/href="javascript:/i.test(html), "javascript: 링크 0");
  assert.ok(html.includes(`${sb.url}/${fx.a.path}`), "권리 확인된 사진은 저장소 공개 주소로 그려진다");
  assert.ok(!html.includes(unconfirmed.body.media.path), "권리 미확인 사진의 주소는 화면에 없다");
});

test("e) /admin/media — 올리기 폼으로 올리면 목록에 나오고 360px에서 가로 스크롤이 없다", async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  try {
    const page = await context.newPage();
    await page.goto(`${base}/admin/login?next=${encodeURIComponent("/admin/media")}`);
    await page.fill("#login-email", u.editor.email);
    await page.fill("#login-password", u.editor.password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL((url) => url.pathname === "/admin/media");
    await page.getByRole("button", { name: "사진 올리기" }).waitFor();
    await page.waitForFunction(() => !document.querySelector('form[aria-label="사진 올리기"] button[type="submit"]')?.disabled);
    await page.setInputFiles("#media-new-file", { name: "화면.png", mimeType: "image/png", buffer: png(40, 40) });
    await page.fill("#media-new-alt", "화면에서 올린 사진");
    await page.getByRole("button", { name: "사진 올리기" }).click();
    await page.getByText("사진을 올렸습니다").waitFor();
    const row = await one("select id, path, rights_status from public.media where alt = '화면에서 올린 사진'");
    assert.ok(row, "화면에서 올린 사진이 저장됐다");
    staff.trackRow("media", row.id);
    objectNames.push(row.path.split("/").pop());
    assert.equal(row.rights_status, "unconfirmed");
    await page.getByTestId(`media-${row.id}`).waitFor();
    assert.ok(await page.getByRole("button", { name: /화면에서 올린 사진 권리 확인/ }).isVisible(), "편집 책임자에게 권리 확인 단추가 보인다");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    assert.ok(scrollWidth <= clientWidth, `가로 스크롤 ${scrollWidth} > ${clientWidth}`);
  } finally {
    await context.close();
  }
});
