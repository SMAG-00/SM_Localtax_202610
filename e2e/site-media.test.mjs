// 형식·제휴 콘텐츠 E2E (W2-c 4단계 — ART-07 인포그래픽 · ART-08 동영상 · ART-09 포토 · ART-10 제휴사, docs/dev/W2-c_설계.md 1장 4단계 증거·8.4)
// standalone 빌드를 로컬 Supabase에 붙인다. 시험하는 기사(인포그래픽·동영상·포토)는 편집국 API로 쓰고 발행한다 — 저장 검사(422)와 발행 판정(422)을 지난다.
// 목록 비교용 기사·제휴 기사는 DB에 직접 넣는다(첫 화면 요청 전에 — 공개 데이터 캐시 30초). 제휴사는 광고·협찬 담당이 운영 API로 만든다.
// 그림은 https://e2e.example.test/… 주소다 — 브라우저 가로채기가 정해진 크기의 PNG를 돌려준다(원본 비율 검사), youtube-nocookie 플레이어는 빈 쪽으로 받는다(바깥 네트워크 0).
//  a) 인포그래픽 저장 — 대체 텍스트·같은 내용의 표 없으면 API 422(칸 경로), 형식 인포그래픽인데 블록 없으면 발행 422, 다 갖추면 발행
//  b) 인포그래픽 화면 — 표는 기본 접힘·키보드(Enter)로 펼침·대체 텍스트, 그림 원본 비율(자르지 않음), 기사 카드의 '인포그래픽' 배지
//  c) 동영상 저장·발행 — youtube-nocookie가 아닌 주소 저장 422, 요약 없음·'자막 있음' 미확인·썸네일 4:3이면 발행 422, 다 갖추면 발행(정리한 주소로 저장)
//  d) 동영상 화면 — 재생을 누르기 전 유튜브·구글 주소 요청 0(네트워크 기록), 썸네일 16:9 원본 비율, 누르면 nocookie 플레이어 · video_played 정확히 1건
//  e) 포토 — 사진 출처·이용 조건·대체 텍스트 중 하나라도 없으면 발행 422(그 항목), 다 갖추면 발행 · 사진마다 표기 줄 · 원본 비율(가로·세로 사진)
//  f) 목록 — /news/video는 기능 키가 꺼지면 404·켜면 형식 동영상만, /news/photo는 형식 포토만 · 예약 이름 video는 기사 주소가 될 수 없다
//  g) 제휴사 — 그 제휴사 기사만·카드와 상세의 같은 배지 글자 · 상세의 제휴 배지 → 프로필 · partner_content_viewed 1건 · 비공개·없는 제휴사 404 · 계약 끝난 제휴사는 기존 기사 배지 그대로
//  g-2) 제휴사를 비공개로 내려도 공동 기획 배지는 '공동 기획 ○○' 그대로(유형 배지 '광고' 0) · 프로필 링크 0 · partner_content_viewed 0 (W2-c 5단계)
//  h) 편집 화면 — 템플릿 3종 · 사진마다 표기 상태 · 동영상 확인 줄 · 대체 텍스트를 지우거나 youtube.com 주소면 저장 요청 0
//  i) R1~R3 — 동영상·포토 기사 360·640·1024 (R1은 360×740), 360px 가로 스크롤 0
//  j) 접근성 95점 이상 — 동영상·포토·인포그래픽 기사
// 만든 계정·기사·이미지·제휴사·측정 행·감사 로그는 끝나면 지우고, 운영 설정(기능 키)은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { chromium } from "playwright";
import { accessibility, A11Y_MIN } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "site-media-e2e@example.test";
const SITE = "https://e2e.example.test";
const VIDEO_ID = "dQw4w9WgXcQ";
const NOCOOKIE = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`;
/** 재생 전에 요청이 0이어야 하는 유튜브·구글 도메인 (ART-08 '재생을 누르기 전에는 유튜브 도메인으로 요청 0') */
const YOUTUBE_GOOGLE = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|ggpht\.com|googlevideo\.com|google\.com|google\.co\.kr|googleapis\.com|gstatic\.com|doubleclick\.net|googlesyndication\.com|google-analytics\.com|googletagmanager\.com)$/;

let sb, server, staff, db, browser, base, debugPort;
const u = {};
const fx = {};
/** 그림 주소(경로) → 원본 크기 — 브라우저 가로채기가 이 크기의 PNG를 돌려준다 */
const IMAGES = new Map();

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const kstDay = (days) => new Date(Date.now() + 9 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
const slugOf = (label) => `e2e-media-${label}-${staff.run}`;

async function api(method, apiPath, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${apiPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const show = (r) => JSON.stringify(r.body).slice(0, 1500);

// ── 그림 (PNG — 한 색, 정해진 크기) ─────────────────────────

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
  ihdr[8] = 8; // 8비트
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3, 0xdd);
  row[0] = 0; // 필터 없음
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG_CACHE = new Map();

/** 이미지 기록 (DB에 직접 — 이미지 등록 API는 아직 없다) */
async function insertMedia(label, { width, height, kind = "photo", confirmed = true, credit = "가온시청", photographer = kind === "photo" ? "김가온" : null, license = "공공누리 제1유형", licenseType = "kogl_1", alt = `${label} 그림` }) {
  const path = `e2e/${staff.run}/${label}.png`;
  // 공공누리 유형(W4 5단계 PR-07) — 권리 확인 이미지는 필수, 미확인 이미지는 비운다
  const row = await one(
    `insert into public.media (path, alt, kind, rights_status, credit, photographer, license, checked_at, width, height, license_type)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [path, alt, kind, confirmed ? "confirmed" : "unconfirmed", credit, photographer, license, confirmed ? new Date() : null, width ?? null, height ?? null, confirmed ? licenseType : null],
  );
  staff.trackRow("media", row.id);
  if (width && height) IMAGES.set(`/${path}`, { width, height });
  return { id: Number(row.id), mediaId: String(row.id), path, width, height, alt };
}

/** 그림·플레이어 요청을 받는 브라우저 문맥 — 모든 요청을 기록한다 */
async function mediaContext(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const requests = [];
  context.on("request", (req) => requests.push(req.url()));
  await context.route(`${SITE}/**`, async (route) => {
    const size = IMAGES.get(new URL(route.request().url()).pathname);
    if (!size) return route.fulfill({ status: 404, body: "" });
    const key = `${size.width}x${size.height}`;
    if (!PNG_CACHE.has(key)) PNG_CACHE.set(key, png(size.width, size.height));
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG_CACHE.get(key) });
  });
  // 누른 뒤의 플레이어 — 바깥 네트워크 없이 빈 쪽 (요청이 생겼는지만 본다)
  await context.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>player</title>" }));
  return { context, requests };
}

async function openPage(path, viewport) {
  const { context, requests } = await mediaContext(viewport);
  const page = await context.newPage();
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  return { page, context, requests, status: res.status() };
}

/** 그림마다 원본 비율 = 화면 비율 (1% 안), 자르기(object-fit cover)·배경 그림 0 — 늦게 읽는 그림은 보이는 자리로 옮겨 기다린다 */
async function imageRatios(page, selector) {
  const imgs = page.locator(selector);
  const n = await imgs.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const img = imgs.nth(i);
    await img.scrollIntoViewIfNeeded();
    await img.evaluate((el) => (el.complete && el.naturalWidth > 0 ? null : new Promise((ok) => el.addEventListener("load", ok, { once: true }))));
    out.push(
      await img.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { nw: el.naturalWidth, nh: el.naturalHeight, w: r.width, h: r.height, fit: getComputedStyle(el).objectFit, bg: getComputedStyle(el).backgroundImage };
      }),
    );
  }
  return out;
}
function assertOriginalRatio(list, where) {
  assert.ok(list.length > 0, `${where}: 그림 0`);
  for (const r of list) {
    assert.ok(r.nw > 0 && r.nh > 0, `${where}: 그림을 읽지 못함 ${JSON.stringify(r)}`);
    const natural = r.nw / r.nh;
    assert.ok(Math.abs(r.w / r.h - natural) / natural < 0.01, `${where}: 원본 비율 ${natural.toFixed(3)} ≠ 화면 비율 ${(r.w / r.h).toFixed(3)}`);
    assert.notEqual(r.fit, "cover", `${where}: object-fit cover(자르기) 0`);
    assert.equal(r.bg, "none", `${where}: 배경 그림 0`);
  }
}

// ── 발행 판정을 지나는 기사 (세법 해설 — 출처 · 핵심 요약 · 문단 · 표 · 문서 인용 · 상자 · FAQ · 핵심 주장) ──

// W4 5단계 (REG1-09 · PR-07) — 공식 자료는 공공누리 유형·발표일·기준일·지역 단위·수집일이 있어야 발행된다 (시험용 값)
const OFFICIAL_W4 = { licenseType: "kogl_1", publishedOn: "2026-10-01", referenceDate: "2026-10-01", regionUnit: "전국", collectedAt: "2026-10-10T09:00:00+09:00" };
const LAW = { kind: "official_doc", title: "지방세법 제20조(신고 및 납부)", url: "https://www.law.go.kr/법령/지방세법/제20조", sourceName: "법제처 국가법령정보센터", lastVerifiedAt: "2026-10-10T09:00:00+09:00", licenseStatus: "공공저작물 자유이용", ...OFFICIAL_W4 };
const baseBlocks = (srcRef) => [
  { type: "key_summary", lines: ["주택을 사면 취득일부터 60일 안에 신고합니다.", "취득일은 잔금일과 등기일 중 빠른 날입니다.", "신고와 납부는 함께 합니다."] },
  { type: "paragraph", text: "취득일은 잔금을 치른 날과 등기를 마친 날 중 빠른 날이다. 자세한 흐름은 [지방세 허브](/tax)에서 볼 수 있다." },
  { type: "table", caption: "취득일 정하는 법", rows: [["경우", "취득일"], ["잔금이 먼저", "잔금일"], ["등기가 먼저", "등기일"]], chart: { axis: "경우", unit: "날짜", source: "지방세법 시행령" } },
  { type: "quote", text: "취득세는 취득일부터 60일 이내에 신고하고 납부하여야 한다.", speaker: "지방세법 제20조", origin: "document", refId: srcRef },
  { type: "callout", kind: "tip", title: "절세 체크포인트", text: "생애 첫 주택이면 감면 요건을 먼저 확인하세요." },
  { type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "계약일이 아니라 잔금일이나 등기일이 취득일입니다." },
  { type: "faq", items: [{ question: "취득세는 어디에 신고하나요?", answer: "주택이 있는 시·군·구청이나 위택스에 신고합니다." }, { question: "신고와 납부를 따로 하나요?", answer: "신고하면서 함께 냅니다." }] },
];
const EXTRA_AT = 7; // 더한 블록의 위치 (기본 블록 7개 뒤)
const claims = (srcRef) => [{ id: "claim-1", text: "취득일부터 60일 안에 신고하고 납부해야 한다.", kind: "legal", evidenceIds: [srcRef], blockIndex: 1 }];

async function draftExplainer(label, { title, summary = "취득세 신고 순서를 형식에 맞게 정리했습니다.", format, author = u.reporter }) {
  const created = await api("POST", "/articles", author, { slug: slugOf(label), title: `${title} ${staff.run}`, summary, section: "tax", categoryId: fx.interpretations, contentType: "explainer", legalBasisDate: "2026-10-01", format });
  assert.equal(created.status, 201, show(created));
  const id = created.body.article.id;
  staff.trackArticle(id);
  const src = await api("POST", `/articles/${id}/sources`, author, LAW);
  assert.equal(src.status, 201, show(src));
  fx[label] = { id, slug: slugOf(label), href: `/news/${slugOf(label)}`, srcRef: src.body.source.ref };
  return fx[label];
}
/** 본문 저장 — 기본 블록 뒤에 extra */
const writeBody = (a, extra, user = u.reporter) => api("PATCH", `/articles/${a.id}`, user, { body: { blocks: [...baseBlocks(a.srcRef), ...extra], claims: claims(a.srcRef) } });
async function approve(a) {
  const desk = await api("POST", `/articles/${a.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve" });
  assert.equal(desk.status, 201, show(desk));
  const tax = await api("POST", `/articles/${a.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
  assert.equal(tax.status, 201, show(tax));
}
/** 저장 → 점검(GET check) — 간편 발행(2026-10-31 PO 결정)에서 형식 규칙은 막지 않고 경고로 남는다. 차단·경고 ID를 돌려준다 */
async function saveAndCheck(a, extra) {
  const saved = await writeBody(a, extra);
  assert.equal(saved.status, 200, show(saved));
  const c = await api("GET", `/articles/${a.id}/check`, u.editor);
  assert.equal(c.status, 200, show(c));
  return { failed: c.body.failed, warnings: c.body.warnings, findings: c.body.findings };
}
/** 저장 → 승인 → 발행 시도 (저장마다 새 버전이라 승인을 다시 받는다) */
async function saveAndPublish(a, extra) {
  const saved = await writeBody(a, extra);
  assert.equal(saved.status, 200, show(saved));
  await approve(a);
  return api("POST", `/articles/${a.id}/publish`, u.editor);
}

const infographic = (media, over = {}) => ({
  type: "infographic",
  mediaId: media.mediaId,
  alt: "계약 → 잔금 → 신고 → 납부 4단계를 화살표로 이은 그림",
  caption: "취득세 신고 4단계",
  chart: null,
  template: "flow",
  data: { kind: "list", items: ["계약", "잔금 치르기", "60일 안에 신고", "신고하면서 납부"] },
  ...over,
});
const video = (thumb, over = {}) => ({
  type: "video",
  embedUrl: NOCOOKIE,
  caption: "위택스로 취득세 신고 따라 하기",
  summary: "위택스에 로그인해 취득세 신고서를 쓰고 내는 순서를 화면으로 보여 줍니다. 잔금일과 등기일을 확인하는 곳도 짚습니다.",
  captions: true,
  thumbnailMediaId: thumb?.mediaId ?? null,
  durationSeconds: 95,
  ...over,
});
const photo = (media, n, over = {}) => ({ type: "image", mediaId: media.mediaId, alt: `${n}번째 사진 — 구청 세무과 신고 창구`, caption: `신고 창구 ${n}`, ...over });

/** 비교용 기사 (DB에 직접 — 발행 판정을 지나지 않는다) */
async function insertArticle(label, over = {}) {
  const contentType = over.contentType ?? "explainer";
  const cols = {
    slug: slugOf(label),
    title: over.title ?? `형식 시험 ${label}`,
    summary: over.summary ?? "목록 비교용 기사입니다.",
    section: over.section ?? "tax",
    content_type: contentType,
    status: over.status ?? "published",
    author_id: u.reporter.personId,
    category_id: over.categoryId ?? null,
    format: over.format ?? "general",
    label: over.label ?? (contentType === "sponsored" ? "ad" : "none"),
    partner_id: over.partnerId ?? null,
    body: JSON.stringify(over.body ?? { blocks: [{ type: "paragraph", text: "본문 문장입니다." }], claims: [] }),
    first_published_at: (over.status ?? "published") === "published" ? (over.publishedAt ?? hoursAgo(24)) : null,
  };
  const keys = Object.keys(cols);
  const { rows } = await db.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id, slug`, Object.values(cols));
  const id = Number(rows[0].id);
  staff.trackArticle(id);
  fx[label] = { id, slug: rows[0].slug, href: `/news/${rows[0].slug}` };
  return fx[label];
}

async function eventCount(name, articleId) {
  return (await one("select count(*)::int n from public.analytics_events where name = $1 and props ->> 'article_id' = $2 and occurred_at >= $3", [name, String(articleId), staff.startedAt])).n;
}
async function waitForCount(name, articleId, expected) {
  const end = Date.now() + 10_000;
  let n = 0;
  while (Date.now() < end) {
    n = await eventCount(name, articleId);
    if (n >= expected) return n;
    await new Promise((r) => setTimeout(r, 200));
  }
  return n;
}
const flagsNow = async () => (await one("select value from public.settings where key = 'feature_flags'")).value;
const cardIds = (page, part) => page.$$eval(`[data-part="${part}"] [data-article-id]`, (els) => els.map((e) => Number(e.getAttribute("data-article-id"))).sort((a, b) => a - b));
const sorted = (...xs) => xs.sort((a, b) => a - b);

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.editor = await staff.createUser({ label: "media-editor", roles: ["editor"], person: { name: "형식 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "media-reporter", roles: ["reporter"], person: { name: "형식 시험 기자", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "media-reviewer", roles: ["reviewer"], person: { name: "형식 시험 감수위원", roles: ["reviewer"] } });
  u.adOps = await staff.createUser({ label: "media-ad", roles: ["ad_ops"], person: { name: "형식 시험 광고 담당", roles: ["writer"] } });
  u.admin = await staff.createUser({ label: "media-admin", email: ADMIN_EMAIL });
  fx.interpretations = Number((await one("select id from public.categories where section = 'tax' and slug = 'interpretations'")).id);

  // 이미지 기록 — 16:9·4:3 썸네일, 가로·세로 사진, 표기가 빠진 사진 3종, 인포그래픽 그림
  fx.thumb169 = await insertMedia("thumb-169", { width: 1280, height: 720, kind: "thumbnail", credit: "편집국", license: "자체 제작" });
  fx.thumb43 = await insertMedia("thumb-43", { width: 1200, height: 900, kind: "thumbnail", credit: "편집국", license: "자체 제작" });
  fx.photoWide = await insertMedia("photo-wide", { width: 1200, height: 900 });
  fx.photoTall = await insertMedia("photo-tall", { width: 600, height: 800 });
  fx.photoNoCredit = await insertMedia("photo-no-credit", { width: 800, height: 600, confirmed: false, credit: null });
  fx.photoNoLicense = await insertMedia("photo-no-license", { width: 800, height: 600, confirmed: false, license: null });
  fx.photoNoAlt = await insertMedia("photo-no-alt", { width: 800, height: 600, alt: null });
  fx.chart = await insertMedia("infographic", { width: 1600, height: 1000, credit: "편집국", photographer: "편집국 그래픽팀", license: "자체 제작" });

  // 제휴사 — 광고·협찬 담당이 운영 API로 (공개 A·B, 비공개 C, 계약이 끝난 공개 D)
  const partner = async (key, body) => {
    const r = await api("POST", "/partners", u.adOps, { kind: "tax_firm", intro: "지방세 실무를 함께 기획합니다.", ...body });
    assert.equal(r.status, 201, show(r));
    staff.trackRow("partners", r.body.partner.id);
    fx[key] = { id: Number(r.body.partner.id), name: body.name };
  };
  await partner("partnerA", { name: `가온세무법인${staff.run}`, visible: true, url: "https://gaon-tax.example" });
  await partner("partnerB", { name: `누리회계${staff.run}`, visible: true });
  await partner("partnerC", { name: `숨은제휴${staff.run}`, visible: false });
  await partner("partnerD", { name: `끝난제휴${staff.run}`, visible: true, contractFrom: kstDay(-120), contractTo: kstDay(-1) });

  // DB에 넣는 비교용 기사 — 목록·제휴사 (첫 화면 요청 전에)
  await insertArticle("coA", { contentType: "sponsored", label: "co_planned", partnerId: fx.partnerA.id, title: "공동 기획 취득세 실무", publishedAt: hoursAgo(2) });
  await insertArticle("adA", { contentType: "sponsored", label: "ad", partnerId: fx.partnerA.id, title: "광고 세무 상담 안내", publishedAt: hoursAgo(3) });
  await insertArticle("draftA", { contentType: "sponsored", label: "co_planned", partnerId: fx.partnerA.id, status: "draft", title: "아직 초안인 공동 기획" });
  await insertArticle("coB", { contentType: "sponsored", label: "co_planned", partnerId: fx.partnerB.id, title: "다른 제휴사 공동 기획" });
  await insertArticle("coC", { contentType: "sponsored", label: "co_planned", partnerId: fx.partnerC.id, title: "숨은 제휴사 공동 기획" });
  await insertArticle("coD", { contentType: "sponsored", label: "co_planned", partnerId: fx.partnerD.id, title: "계약 끝난 제휴사 공동 기획", publishedAt: hoursAgo(48) });
  await insertArticle("plain", { title: "일반 형식 기사" });
  await insertArticle("photoDirect", { format: "photo", title: "DB에 넣은 포토 기사" });
  await insertArticle("videoDirect", { format: "video", title: "썸네일 없는 동영상 기사" });
  await insertArticle("infographicDirect", { format: "infographic", title: "DB에 넣은 인포그래픽 기사", categoryId: fx.interpretations });

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
});

after(async () => {
  try {
    await browser?.close();
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("a) 인포그래픽 저장 — 대체 텍스트·같은 내용의 표가 없으면 API 422(칸 경로), 형식 인포그래픽인데 블록이 없으면 경고(간편 발행), 다 갖추면 발행", async () => {
  const a = await draftExplainer("infographic", { title: "그림으로 보는 취득세 신고 4단계", format: "infographic" });
  // 블록 없이 점검 → 형식 판정은 경고로 남는다 (간편 발행 — 발행은 막지 않음)
  const c = await saveAndCheck(a, []);
  assert.ok(!c.failed.includes("art07.infographic-required") && c.warnings.includes("art07.infographic-required"), JSON.stringify(c.warnings));

  const noAlt = await writeBody(a, [infographic(fx.chart, { alt: "  " })]);
  assert.equal(noAlt.status, 422, show(noAlt));
  assert.deepEqual(noAlt.body.errors.map((e) => e.split(":")[0]), [`body.blocks[${EXTRA_AT}].alt`]);
  const noTable = await writeBody(a, [infographic(fx.chart, { template: "compare", data: { kind: "table", columns: ["구분", "올해"], rows: [] } })]);
  assert.equal(noTable.status, 422, show(noTable));
  assert.deepEqual(noTable.body.errors.map((e) => e.split(":")[0]), [`body.blocks[${EXTRA_AT}].data`]);
  const noData = await writeBody(a, [infographic(fx.chart, { data: null })]);
  assert.equal(noData.status, 422, show(noData));
  // 새 기사 작성(POST)도 같은 규칙 — 저장된 행 0
  const created = await api("POST", "/articles", u.reporter, { slug: slugOf("ig-bad"), title: `거부될 인포그래픽 ${staff.run}`, section: "tax", contentType: "explainer", format: "infographic", body: { blocks: [infographic(fx.chart, { alt: "", data: null })], claims: [] } });
  assert.equal(created.status, 422, show(created));
  assert.equal((await one("select count(*)::int n from public.articles where slug = $1", [slugOf("ig-bad")])).n, 0);
  assert.equal(Number((await one("select version from public.articles where id = $1", [a.id])).version), 2, "거부된 저장은 새 버전을 만들지 않는다");

  const r = await saveAndPublish(a, [infographic(fx.chart, { chart: { axis: "단계", unit: "단계", source: "지방세법" } })]);
  assert.equal(r.status, 200, show(r));
});

test("b) 인포그래픽 화면 — 같은 내용의 목록은 기본 접힘·키보드(Enter)로 펼침, 대체 텍스트, 원본 비율 · 기사 카드의 '인포그래픽' 배지", async () => {
  const { page, context, status } = await openPage(fx.infographic.href);
  assert.equal(status, 200);
  const block = page.locator('[data-block="infographic"] [data-ui="infographic-block"]');
  assert.equal(await block.count(), 1);
  assert.equal(await block.getAttribute("data-template"), "flow");
  assert.equal(await block.locator("img").getAttribute("alt"), "계약 → 잔금 → 신고 → 납부 4단계를 화살표로 이은 그림");
  const details = block.locator("details");
  assert.equal(await details.evaluate((d) => d.open), false, "기본 접힘");
  assert.equal(await block.locator("ol li").first().isVisible(), false, "접힌 동안 목록은 보이지 않는다");
  await block.locator("summary").focus();
  await page.keyboard.press("Enter");
  assert.equal(await details.evaluate((d) => d.open), true, "키보드로 펼친다");
  assert.deepEqual(await block.locator("ol li").allTextContents(), ["계약", "잔금 치르기", "60일 안에 신고", "신고하면서 납부"], "절차 흐름은 번호 목록");
  await page.keyboard.press("Enter");
  assert.equal(await details.evaluate((d) => d.open), false, "다시 접는다");
  assert.match(await block.locator('[data-part="infographic-notes"]').textContent(), /단위 단계 · 출처 지방세법.*그림 편집국/);
  assertOriginalRatio(await imageRatios(page, '[data-block="infographic"] img'), "인포그래픽");
  await context.close();

  // 형식이 인포그래픽인 기사 카드에 배지 (하위 분야 목록 — 해석)
  const list = await openPage("/tax/interpretations");
  for (const id of [fx.infographic.id, fx.infographicDirect.id]) {
    assert.equal((await list.page.locator(`[data-article-id="${id}"] [data-format-badge]`).textContent()).trim(), "인포그래픽", `기사 ${id}`);
  }
  await list.context.close();
});

test("c) 동영상 저장·발행 — youtube-nocookie가 아닌 주소 저장 422, 요약·'자막 있음'·16:9 썸네일이 없으면 경고(간편 발행), 다 갖추면 발행", async () => {
  const a = await draftExplainer("video", { title: "동영상으로 보는 취득세 신고", format: "video" });
  for (const embedUrl of [`https://www.youtube.com/embed/${VIDEO_ID}`, `http://www.youtube-nocookie.com/embed/${VIDEO_ID}`, `https://www.youtube-nocookie.com.evil.example/embed/${VIDEO_ID}`, `https://youtu.be/${VIDEO_ID}`, `${NOCOOKIE}?autoplay=1`]) {
    const r = await writeBody(a, [video(fx.thumb169, { embedUrl })]);
    assert.equal(r.status, 422, `${embedUrl}: ${show(r)}`);
    assert.deepEqual(r.body.errors.map((e) => e.split(":")[0]), [`body.blocks[${EXTRA_AT}].embedUrl`], embedUrl);
  }
  assert.equal(Number((await one("select version from public.articles where id = $1", [a.id])).version), 1, "거부된 저장은 새 버전을 만들지 않는다");

  const art08 = (c) => ({ failed: c.failed.filter((id) => id.startsWith("art08")), warnings: c.warnings.filter((id) => id.startsWith("art08")) });
  let c = await saveAndCheck(a, [video(fx.thumb169, { summary: "", captions: false })]);
  assert.deepEqual(art08(c), { failed: [], warnings: ["art08.summary-required", "art08.captions-unconfirmed"] });
  assert.ok(!c.failed.includes("nav04.image-rights") && !c.warnings.some((id) => id.startsWith("art08.thumbnail")), "썸네일은 갖췄다");

  c = await saveAndCheck(a, [video(fx.thumb169, { captions: false })]);
  assert.deepEqual(art08(c), { failed: [], warnings: ["art08.captions-unconfirmed"] }, "요약을 쓰면 '자막 있음'만 남는다");

  c = await saveAndCheck(a, [video(fx.thumb43)]);
  assert.deepEqual(art08(c), { failed: [], warnings: ["art08.thumbnail-ratio"] }, "4:3 썸네일");

  const r = await saveAndPublish(a, [video(fx.thumb169, { embedUrl: ` HTTPS://WWW.YOUTUBE-NOCOOKIE.COM/embed/${VIDEO_ID}?cc_load_policy=1 ` })]);
  assert.equal(r.status, 200, show(r));
  const stored = (await one("select body from public.articles where id = $1", [a.id])).body.blocks[EXTRA_AT];
  assert.equal(stored.embedUrl, `${NOCOOKIE}?cc_load_policy=1`, "정리한 주소로 저장");
});

test("d) 동영상 화면 — 재생을 누르기 전 유튜브·구글 주소 요청 0, 썸네일 16:9 원본 비율, 누르면 nocookie 플레이어 · video_played 1건", async () => {
  const { page, context, requests, status } = await openPage(fx.video.href);
  assert.equal(status, 200);
  const card = page.locator('[data-block="video"] [data-ui="video-card"]');
  assert.equal(await card.count(), 1);
  assert.equal(await card.locator("iframe").count(), 0, "누르기 전 플레이어 0");
  assert.equal(await card.locator("[data-video-facade]").getAttribute("aria-label"), "동영상 재생: 위택스로 취득세 신고 따라 하기");
  assert.equal((await card.locator('[data-ui="chip"]').textContent()).trim(), "자막 있음");
  assert.match(await card.textContent(), /잔금일과 등기일을 확인하는 곳도 짚습니다/, "요약 텍스트");
  assertOriginalRatio(await imageRatios(page, '[data-block="video"] img'), "썸네일");
  const thumb = await card.locator("img").evaluate((el) => el.naturalWidth / el.naturalHeight);
  assert.ok(Math.abs(thumb - 16 / 9) < 0.01, `썸네일 16:9 (${thumb})`);
  await page.waitForTimeout(1500);
  const before = requests.filter((url) => YOUTUBE_GOOGLE.test(new URL(url).hostname));
  assert.deepEqual(before, [], "재생 전 유튜브·구글 요청 0");
  assert.equal(await eventCount("video_played", fx.video.id), 0, "누르기 전 video_played 0");

  await card.locator("[data-video-facade]").click();
  const iframe = card.locator("iframe");
  await iframe.waitFor();
  const src = new URL(await iframe.getAttribute("src"));
  assert.equal(src.origin + src.pathname, NOCOOKIE);
  assert.equal(src.searchParams.get("autoplay"), "1");
  await page.waitForTimeout(500);
  const after = requests.filter((url) => YOUTUBE_GOOGLE.test(new URL(url).hostname)).map((url) => new URL(url).hostname);
  assert.ok(after.length >= 1 && after.every((h) => h === "www.youtube-nocookie.com"), `누른 뒤 요청은 nocookie만: ${after}`);
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "IFRAME", "초점이 플레이어로");
  assert.equal(await waitForCount("video_played", fx.video.id, 1), 1);
  await page.waitForTimeout(1000);
  assert.equal(await eventCount("video_played", fx.video.id), 1, "정확히 1건");
  const row = await one("select section, props from public.analytics_events where name = 'video_played' and props ->> 'article_id' = $1 and occurred_at >= $2", [String(fx.video.id), staff.startedAt]);
  assert.equal(row.section, "tax");
  assert.deepEqual(row.props, { article_id: fx.video.id });
  assert.equal(await eventCount("partner_content_viewed", fx.video.id), 0, "제휴 기사가 아니면 partner_content_viewed 0");
  await context.close();
});

test("e) 포토 — 출처·이용 조건이 없는 사진은 발행 422(저작권 — 간편 발행에서도), 사진 없음·대체 텍스트 없음은 경고, 다 갖추면 발행 · 사진마다 표기 줄 · 원본 비율", async () => {
  const a = await draftExplainer("photo", { title: "사진으로 보는 취득세 신고 창구", format: "photo" });
  const none = await saveAndCheck(a, []);
  assert.ok(!none.failed.includes("art09.photos-required") && none.warnings.includes("art09.photos-required"), "사진 없음은 경고");
  let r;
  for (const [media, id] of [
    [fx.photoNoCredit, "art09.photo-credit"],
    [fx.photoNoLicense, "art09.photo-license"],
  ]) {
    r = await saveAndPublish(a, [photo(fx.photoWide, 1), photo(media, 2)]);
    assert.equal(r.status, 422, show(r));
    assert.deepEqual(r.body.failed.filter((f) => f.startsWith("art09")), [id], `${id}: ${show(r)}`);
    const finding = r.body.findings.find((f) => f.id === id);
    assert.deepEqual(finding.location, { field: "blocks", blockIndex: EXTRA_AT + 1, phrase: media.mediaId });
  }
  const noAlt = await saveAndCheck(a, [photo(fx.photoWide, 1), photo(fx.photoNoAlt, 2, { alt: "" })]);
  assert.deepEqual(noAlt.failed.filter((f) => f.startsWith("art09")), [], "대체 텍스트 없음은 막지 않는다");
  assert.deepEqual(noAlt.findings.find((f) => f.id === "art09.photo-alt").location, { field: "blocks", blockIndex: EXTRA_AT + 1, phrase: fx.photoNoAlt.mediaId });
  r = await saveAndPublish(a, [photo(fx.photoWide, 1), { type: "paragraph", text: "두 번째 사진은 세로로 찍었다." }, photo(fx.photoTall, 2)]);
  assert.equal(r.status, 200, show(r));

  const { page, context } = await openPage(fx.photo.href);
  const credits = await page.$$eval('[data-block="image"] [data-part="photo-credit"]', (els) => els.map((e) => e.textContent));
  assert.deepEqual(credits, ["촬영 김가온 · 출처 가온시청 · 이용 조건 공공누리 제1유형", "촬영 김가온 · 출처 가온시청 · 이용 조건 공공누리 제1유형"]);
  assert.deepEqual(await page.$$eval('[data-block="image"] img', (els) => els.map((e) => e.getAttribute("alt"))), ["1번째 사진 — 구청 세무과 신고 창구", "2번째 사진 — 구청 세무과 신고 창구"]);
  const ratios = await imageRatios(page, '[data-block="image"] img');
  assertOriginalRatio(ratios, "포토");
  assert.deepEqual(ratios.map((x) => [x.nw, x.nh]), [[1200, 900], [600, 800]], "가로 사진·세로 사진 그대로");
  await context.close();
});

test("f) 목록 — /news/video는 기능 키가 꺼지면 404·켜면 형식 동영상만(재생 전 유튜브 요청 0), /news/photo는 형식 포토만 · 'video'는 기사 주소가 될 수 없다", async () => {
  assert.equal((await fetch(`${base}/news/video`)).status, 404, "동영상 채널 결정 전 — 숨김");
  const flags = await flagsNow();
  let r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...flags, video_list: true } });
  assert.equal(r.status, 200, show(r));
  try {
    const v = await openPage("/news/video");
    assert.equal(v.status, 200);
    assert.equal(await v.page.locator('[data-ui="video-list"]').count(), 1, "기사 상세가 아니라 목록");
    assert.deepEqual(await cardIds(v.page, "video-articles"), sorted(fx.video.id, fx.videoDirect.id), "형식 동영상 기사만");
    assert.equal(await v.page.locator(`[data-article-id="${fx.video.id}"]`).getAttribute("data-card"), "video");
    assert.equal(await v.page.locator(`[data-article-id="${fx.videoDirect.id}"]`).getAttribute("data-card"), "article", "썸네일 없는 동영상 기사는 기사 카드로");
    assert.equal(await v.page.locator(`[data-article-id="${fx.video.id}"] a`).getAttribute("href"), fx.video.href);
    assert.equal(await v.page.locator("iframe").count(), 0);
    await v.page.waitForTimeout(1000);
    assert.deepEqual(v.requests.filter((url) => YOUTUBE_GOOGLE.test(new URL(url).hostname)), [], "목록에서도 유튜브 요청 0");
    assertOriginalRatio(await imageRatios(v.page, `[data-article-id="${fx.video.id}"] img`), "목록 썸네일");
    await v.context.close();
  } finally {
    r = await api("PATCH", "/settings/feature_flags", u.admin, { value: flags });
    assert.equal(r.status, 200, show(r));
  }
  assert.equal((await fetch(`${base}/news/video`)).status, 404, "다시 끄면 404");

  const p = await openPage("/news/photo");
  assert.equal(p.status, 200);
  assert.deepEqual(await cardIds(p.page, "photo-articles"), sorted(fx.photo.id, fx.photoDirect.id), "형식 포토 기사만");
  assert.deepEqual(await p.page.$$eval('[data-part="photo-articles"] [data-format-badge]', (els) => [...new Set(els.map((e) => e.textContent.trim()))]), ["포토"]);
  await p.context.close();

  const reserved = await api("POST", "/articles", u.reporter, { slug: "video", title: `예약 이름 시험 ${staff.run}`, section: "tax", contentType: "explainer" });
  assert.ok([409, 422].includes(reserved.status), show(reserved));
  assert.equal((await one("select count(*)::int n from public.articles where slug = 'video'")).n, 0);
});

test("g) 제휴사 — 그 제휴사 기사만·카드와 상세가 같은 배지 글자, 상세 배지 → 프로필, partner_content_viewed 1건, 비공개·없는 제휴사 404, 계약 끝난 제휴사는 기존 기사 배지 그대로", async () => {
  const A = fx.partnerA;
  const { page, context, status } = await openPage(`/partners/${A.id}`);
  assert.equal(status, 200);
  assert.equal((await page.locator("h1").textContent()).trim(), A.name);
  assert.equal((await page.locator('[data-part="partner-meta"] [data-ui="partner-badge"]').textContent()).trim(), `공동 기획 ${A.name}`);
  assert.match(await page.locator('[data-part="partner-independence"]').textContent(), /관여하지 않습니다/);
  assert.equal(await page.locator('a[href="https://gaon-tax.example/"]').getAttribute("target"), "_blank");
  assert.deepEqual(await cardIds(page, "partner-articles"), sorted(fx.coA.id, fx.adA.id), "그 제휴사의 공개 기사만 (초안·다른 제휴사 0)");
  const cardBadge = (await page.locator(`[data-article-id="${fx.coA.id}"] [data-ui="partner-badge"]`).textContent()).trim();
  assert.equal(cardBadge, `공동 기획 ${A.name}`);
  assert.equal((await page.locator(`[data-article-id="${fx.adA.id}"] [data-ui="article-type-badge"]`).textContent()).trim(), "광고");
  assert.equal(await page.locator(`[data-article-id="${fx.adA.id}"] [data-ui="partner-badge"]`).count(), 0, "광고와 공동 기획을 섞지 않는다");
  await context.close();

  // 기사 상세 — 같은 배지 글자, 배지는 제휴사 프로필로 (사이트 안 링크), 열면 partner_content_viewed 1건
  const detail = await openPage(fx.coA.href);
  const headBadge = detail.page.locator('[data-article-part="head"] [data-part="partner-link"]');
  assert.equal((await headBadge.locator('[data-ui="partner-badge"]').textContent()).trim(), cardBadge, "목록 카드와 상세의 같은 배지 글자");
  assert.equal(await headBadge.getAttribute("href"), `/partners/${A.id}`);
  assert.equal(await waitForCount("partner_content_viewed", fx.coA.id, 1), 1);
  await detail.page.waitForTimeout(1000);
  assert.equal(await eventCount("partner_content_viewed", fx.coA.id), 1, "한 번 열면 1건");
  const row = await one("select props from public.analytics_events where name = 'partner_content_viewed' and props ->> 'article_id' = $1 and occurred_at >= $2", [String(fx.coA.id), staff.startedAt]);
  assert.deepEqual(row.props, { partner_id: A.id, article_id: fx.coA.id });
  // 배지를 누르면 새로고침 없이 프로필로
  await detail.page.evaluate(() => (window.__e2eMarker = "kept"));
  await headBadge.click();
  await detail.page.waitForURL(`${base}/partners/${A.id}`);
  await detail.page.locator('[data-ui="partner-page"]').waitFor();
  assert.equal(await detail.page.evaluate(() => window.__e2eMarker), "kept", "화면 전환 (FND-09)");
  await detail.context.close();

  for (const path of [`/partners/${fx.partnerC.id}`, "/partners/abc", "/partners/0", "/partners/999999999"]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  const ended = await openPage(`/partners/${fx.partnerD.id}`);
  assert.equal(ended.status, 200, "계약이 끝나도 공개로 두면 프로필이 보인다");
  assert.deepEqual(await cardIds(ended.page, "partner-articles"), [fx.coD.id]);
  assert.equal((await ended.page.locator(`[data-article-id="${fx.coD.id}"] [data-ui="partner-badge"]`).textContent()).trim(), `공동 기획 ${fx.partnerD.name}`, "기존 기사 배지는 남는다");
  await ended.context.close();
});

test("g-2) 공동 기획 뒤 제휴사를 비공개로 내려도(운영 API) 배지는 '공동 기획 ○○' 그대로 — '광고' 0, 프로필 링크 0, partner_content_viewed 0 (W2-a 4-2 · W2-c 5단계)", async () => {
  const B = fx.partnerB;
  const hide = await api("PATCH", `/partners/${B.id}`, u.adOps, { visible: false, contractTo: kstDay(-1), contractFrom: kstDay(-200) });
  assert.equal(hide.status, 200, show(hide));
  const expectBadge = async (page, where) => {
    const head = page.locator('[data-article-part="head"]');
    assert.deepEqual(
      { type: await head.locator('[data-ui="article-type-badge"]').allTextContents(), partner: await head.locator('[data-ui="partner-badge"]').allTextContents(), link: await head.locator('[data-part="partner-link"]').count() },
      { type: [], partner: [`공동 기획 ${B.name}`], link: 0 },
      where,
    );
  };
  const detail = await openPage(fx.coB.href);
  assert.equal(detail.status, 200);
  await expectBadge(detail.page, "비공개로 내린 뒤 상세");
  await detail.page.waitForTimeout(1000);
  assert.equal(await eventCount("partner_content_viewed", fx.coB.id), 0, "비공개 제휴사 기사 — 제휴 콘텐츠 측정 0");
  await detail.context.close();
  // 처음부터 비공개였던 제휴사의 공동 기획 기사도 같은 배지
  const hidden = await openPage(fx.coC.href);
  const head = hidden.page.locator('[data-article-part="head"]');
  assert.deepEqual(await head.locator('[data-ui="partner-badge"]').allTextContents(), [`공동 기획 ${fx.partnerC.name}`]);
  assert.equal(await head.locator('[data-ui="article-type-badge"]').count(), 0, "유형 배지 '광고' 0");
  await hidden.context.close();
  assert.equal((await fetch(`${base}/partners/${B.id}`)).status, 404, "프로필은 비공개");
});

test("h) 편집 화면 — 템플릿 3종 · 사진마다 표기 상태 · 동영상 확인 줄, 대체 텍스트를 지우거나 youtube.com 주소면 저장 요청 0", async () => {
  const a = await draftExplainer("editor", { title: "편집 화면 시험 기사", format: "photo" });
  const saved = await writeBody(a, [photo(fx.photoNoCredit, 1), video(fx.thumb43, { captions: false }), infographic(fx.chart)]);
  assert.equal(saved.status, 200, show(saved));
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/admin/login`);
  await page.fill("#login-email", u.reporter.email);
  await page.fill("#login-password", u.reporter.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
  await page.goto(`${base}/admin/articles/${a.id}`);
  const saveButton = page.locator('form[aria-label="기사 저장"] [data-ui="primary-button"]');
  await page.waitForFunction(() => {
    const b = document.querySelector('form[aria-label="기사 저장"] button[type="submit"]');
    return b && !b.disabled;
  });
  assert.match(await page.locator('[data-testid="photo-set-summary"]').textContent(), /사진 1장 · 표기가 빠진 사진 1장/);
  const photoBlock = page.locator(`[data-testid="block-${EXTRA_AT}"]`);
  assert.equal(await photoBlock.locator('[data-check="credit"]').getAttribute("data-ok"), "false");
  assert.equal(await photoBlock.locator('[data-check="license"]').getAttribute("data-ok"), "true");
  const videoBlock = page.locator(`[data-testid="block-${EXTRA_AT + 1}"]`);
  assert.equal(await videoBlock.locator('[data-check="ratio"]').getAttribute("data-ok"), "false", "4:3 썸네일");
  assert.equal(await videoBlock.locator('[data-check="captions"]').getAttribute("data-ok"), "false");
  await videoBlock.getByLabel(/자막 있음/).check();
  assert.equal(await videoBlock.locator('[data-check="captions"]').getAttribute("data-ok"), "true", "체크하면 바로 '됨'");
  const igBlock = page.locator(`[data-testid="block-${EXTRA_AT + 2}"]`);
  assert.deepEqual(await igBlock.locator("select").first().locator("option").allTextContents(), ["절차 흐름", "비교", "핵심 숫자"]);

  const patches = [];
  page.on("request", (req) => {
    if (req.method() === "PATCH" && req.url().includes(`/api/admin/articles/${a.id}`)) patches.push(req.url());
  });
  await igBlock.getByLabel(/^대체 텍스트/).fill("");
  await videoBlock.getByLabel(/^동영상 주소/).fill(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  await saveButton.click();
  await page.locator("#save-failure").waitFor();
  assert.match(await igBlock.textContent(), /인포그래픽의 대체 텍스트를 적어 주세요/);
  assert.match(await videoBlock.textContent(), /유튜브 개인정보 보호 주소/);
  await page.waitForTimeout(500);
  assert.deepEqual(patches, [], "저장 전에 막는다 — 저장 요청 0");
  await context.close();
});

test("i) R1~R3 — 동영상·포토 기사 360·640·1024 (R1은 360×740) · 360px 가로 스크롤 0 (기사·목록·제휴사)", async () => {
  for (const href of [fx.video.href, fx.photo.href]) {
    for (const width of [360, 640, 1024]) {
      const r = await measurePage(browser, `${base}${href}`, { width, height: 740 });
      if (width === 360) assert.ok(r.r1.pass, `${href} ${width}px R1 ${r.r1.chars}자 > 150`);
      assert.ok(r.r2.pass, `${href} ${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
      assert.ok(r.r3.pass, `${href} ${width}px R3 오렌지 ${r.r3.ratio}`);
    }
  }
  for (const href of [fx.video.href, fx.photo.href, fx.infographic.href, "/news/photo", `/partners/${fx.partnerA.id}`]) {
    const { page, context } = await openPage(href, { width: 360, height: 740 });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${href}: 가로 스크롤`);
    const small = await page.$$eval('main [data-video-facade], main [data-ui="infographic-block"] summary, main [data-part="partner-link"]', (els) =>
      els.map((e) => ({ ...e.getBoundingClientRect().toJSON() })).filter((x) => x.height < 44 || x.width < 44),
    );
    assert.deepEqual(small, [], `${href}: 누르는 자리 44px 미만`);
    await context.close();
  }
});

test("j) 접근성 95점 이상 — 동영상·포토·인포그래픽 기사", async () => {
  for (const href of [fx.video.href, fx.photo.href, fx.infographic.href]) {
    const r = await accessibility(`${base}${href}`, debugPort);
    assert.ok(r.score >= A11Y_MIN, `${href}: 접근성 ${Math.round(r.score * 100)}점 (${r.failing.join(", ")})`);
  }
});

test("시험 동안 예상 못 한 서버 오류가 없었다", () => {
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[public\]|⨯/);
});
