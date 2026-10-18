// W2-c 수용 E2E (6단계) — PRD-01A 9장 W2-c 증거 전부를 한 시험 자료·한 서버·한 브라우저로 (docs/dev/W2-c_설계.md 1장 6단계 · 8.6)
// 9장 증거: 봇 제외·168시간 경계 테스트 · 유효 방문 29초·30초 테스트 · 규정 미확정 시 `요건 미확정` — 그리고 4장 수용 기준
// (FND-06 · GROW-01 · ART-07 · ART-08 · ART-09 · ART-10 · ART-11 · HOME-05 · NAV-13 · NAV-14)
//  1) FND-06 — analytics_events 칸 = PRD 14칸·개인정보 모양 칸 0·`events` 표 0(DB·마이그레이션 검사), DB가 끊기면 /api/health 503 + 실패 항목 db
//  2~4) ART-07·08·09 — 인포그래픽·동영상·포토 기사를 편집국 API로 쓰고(저장 422) 발행(발행 422 조건을 하나씩 지나), 화면(접힘·재생 전 유튜브 요청 0·원본 비율)·목록
//  5) ART-10 — 공동 기획 기사를 광고·협찬 담당이 쓰고 편집 책임자가 발행 → 프로필·배지·partner_content_viewed → 제휴사를 비공개로 내려도 카드·상세·JSON-LD 배지 그대로
//  6~8) ART-11 · HOME-05 — 수집 API로 받은 조회(봇 100 + 사람 3 · 사람 5 · 같은 방문자 반복)를 끝난 시간대로 옮기고, 시각을 정한 경계 자료(168·169시간)와 함께
//       1시간 집계 배치(인증된 작업 경로)를 돌린다. HOT 고정 API · 가중치 설정 API → 다음 집계
//  9) GROW-01 — 실제 브라우저(새 브라우저 · 측정 거부 · GPC · 편집자 로그인 · 자동화 브라우저=봇)와 가짜 시계(29초 0 · 30초 1), 지난 주 자료(재방문 30·31일째) → /admin/metrics 숫자
//  10) NAV-13·14 — 빈 규정 표 → 대시보드·기사 할당량 `요건 미확정`, 규정 API로 버전 등록·확정 → 공식·내부 정의 따로, 확정 버전 그대로(API 409·DB 트리거), 저장소 검사
//  11~13) 새 관리자 화면·API 권한 표 · 360px 가로 스크롤 0 · 접근성 95
// 자료는 끝나면 모두 지운다 — 표마다 시험 전 행 수, 운영 설정 값 그대로.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import pg from "pg";
import { chromium } from "playwright";
import { lintMigrationDir, lintMigrations } from "../packages/db/scripts/lint-migrations.mjs";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { ROOT, buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w2c-acceptance-e2e@example.test";
const SITE = "https://e2e.example.test";
const SECRET = crypto.randomBytes(24).toString("hex");
const HUMAN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
/** 자동화 브라우저 — 설정 bot_user_agents의 'headlesschrome'에 걸려 봇으로 저장된다 (설계 9장 #15). 공개 화면을 여는 시험 브라우저는 모두 이것 — 사람 조회는 사람 브라우저(HUMAN_UA)만 */
const HEADLESS_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36";
const VIDEO_ID = "dQw4w9WgXcQ";
const NOCOOKIE = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`;
/** 재생 전에 요청이 0이어야 하는 유튜브·구글 도메인 (ART-08) */
const YOUTUBE_GOOGLE = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|ggpht\.com|googlevideo\.com|google\.com|google\.co\.kr|googleapis\.com|gstatic\.com|doubleclick\.net|googlesyndication\.com|google-analytics\.com|googletagmanager\.com)$/;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 360, height: 740 };
const BANNED = ["인정", "예상 점수", "예측", "판정", "선정 예정", "제휴 확정", "네이버 제휴 언론사"];
const shell = process.platform === "win32";
const execFileAsync = promisify(execFile);

// ── 기준 — 문서에서 읽는다 (문서와 다르면 문서가 맞다) ─────────────────

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DESIGN = read("docs", "dev", "W2-c_설계.md");
const PRD_01A = read("docs", "PRD", "PRD-01A_1단계_기반_편집_유입.md");
const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
function lineOf(doc, marker) {
  const line = doc.split("\n").find((l) => l.includes(marker));
  assert.ok(line, `문서에 '${marker}' 줄이 없다`);
  return line;
}
/** analytics_events 칸 — 설계 3장 'PRD-01A 6.1 그대로 14개' */
const PRD_COLUMNS = ticks(lineOf(DESIGN, "그대로 14개다").split("14개다:")[1]);
/** 편집국 역할 7종 — 권한 표가 빠짐없이 도는지 (lib/access.ts STAFF_ROLES) */
const STAFF_ROLES = ticks(read("apps", "web", "lib", "access.ts").match(/STAFF_ROLES = \[([^\]]+)\]/)[1].replaceAll('"', "`"));

let sb, server, serverEnv, staff, db, browser, base, debugPort;
const u = {};
const fx = {};
const IMAGES = new Map();
const PNG_CACHE = new Map();
const seededSessions = [];
const contexts = [];
const before0 = {};
let cleaned = false;
let H0; // 집계 기준 시간대 (UTC 정시) — 배치가 도는 시간대의 시작

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const countOf = async (sql, params) => Number((await one(sql, params)).n);
const show = (r) => JSON.stringify(r.body).slice(0, 1500);
const iso = (ms) => new Date(ms).toISOString();
const minutesAgo = (m) => iso(Date.now() - m * 60_000);
const kstToday = () => new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10);
const kstDay = (days) => new Date(Date.now() + 9 * HOUR + days * DAY).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const kst = (date, hms) => new Date(`${date}T${hms}+09:00`).toISOString();
const monthIndex = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const firstDay = (i) => `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}-01`;
const slugOf = (label) => `e2e-w2c-${label}-${staff.run}`.toLowerCase();
const sorted = (...xs) => xs.sort((a, b) => a - b);

async function api(method, apiPath, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${apiPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function expectStatus(promise, status, what) {
  const r = await promise;
  assert.equal(r.status, status, `${what}: ${show(r)}`);
  return r;
}

// ── 수집 API (서버 사이 요청 — 같은 사이트 머리글) ────────────────────

/** Set-Cookie 줄 → { 이름: 값 } */
const setCookies = (res) => Object.fromEntries(res.headers.getSetCookie().map((l) => l.split(";")[0]).map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
async function sendEvent(body, { ua = HUMAN_UA, cookie, headers = {} } = {}) {
  const res = await fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": ua, origin: base, "sec-fetch-site": "same-origin", ...(cookie ? { cookie } : {}), ...headers },
    body: JSON.stringify(body),
  });
  await res.arrayBuffer();
  return { status: res.status, cookies: setCookies(res) };
}
const viewEvent = (a, section = "tax") => ({ name: "article_viewed", section, props: { article_id: a.id, format: "general", content_type: a.contentType ?? "explainer" } });

/** 인증된 작업 경로로 배치 한 번 (사내 스케줄러 경로) */
async function runJob(job) {
  const res = await fetch(`${base}/api/jobs/${job}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "x-job-trigger": "scheduler" } });
  const body = await res.json();
  const run = await one("select status, detail, error from public.agent_runs where id = $1", [body.runId]);
  assert.equal(res.status, 200, `${job}: ${res.status} ${run?.error ?? ""}`);
  assert.equal(run.status, "succeeded");
  return run.detail;
}

// ── 시험 자료 — DB에 직접 넣는 기사 (첫 공개 화면 요청 전에 — 공개 데이터 캐시 30초) ─────────

async function insertArticle(label, over = {}) {
  const contentType = over.contentType ?? "explainer";
  const status = over.status ?? "published";
  const cols = {
    slug: slugOf(label),
    title: over.title ?? `수용 시험 ${label}`,
    summary: "무엇이 바뀌고 누구에게 영향이 있는지 정리했습니다",
    section: over.section ?? "tax",
    content_type: contentType,
    reporting_method: over.reportingMethod ?? (contentType === "reported_news" ? "quantitative" : null),
    status,
    author_id: over.authorId === undefined ? u.reporter.personId : over.authorId,
    category_id: over.categoryId ?? null,
    subtype: over.solvedCase ? "solved_case" : "general",
    solved_case: over.solvedCase ? JSON.stringify(over.solvedCase) : null,
    label: over.label ?? (contentType === "sponsored" ? "ad" : "none"),
    partner_id: over.partnerId ?? null,
    body: JSON.stringify({ blocks: [{ type: "paragraph", text: "본문 문장입니다." }], claims: [] }),
    first_published_at: status === "published" ? (over.publishedAt ?? minutesAgo(30)) : null,
  };
  const keys = Object.keys(cols);
  const { rows } = await db.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id, slug`, Object.values(cols));
  const id = Number(rows[0].id);
  staff.trackArticle(id);
  fx[label] = { id, slug: rows[0].slug, href: `/news/${rows[0].slug}`, contentType };
  return fx[label];
}
const SOLVED = (n) => ({
  situation: `한 납세자는 잔금 뒤 ${n}일이 지나 신고했다.`,
  issue: "신고 기간을 언제부터 세는지가 쟁점이었다.",
  result: "심판기관은 잔금일을 취득일로 보았다.",
  lesson: "신고 기간은 잔금일과 등기일 중 빠른 날부터 셉니다.",
  resultEvidence: [{ kind: "decision", number: `조심2025지00${20 + n}`, url: `https://decisions.example.kr/tt/2025-ji-00${20 + n}` }],
  conclusion: "rejected",
});

const PROPS = {
  article_viewed: (id) => ({ article_id: id, format: "general", content_type: "explainer" }),
  article_engaged: (id) => ({ article_id: id, format: "general", content_type: "explainer" }),
  article_shared: (id) => ({ article_id: id, channel: "copy_link" }),
};
/** 시각을 정한 측정 이벤트 (지난 시간대 — 수집 API로는 지난 시각을 보낼 수 없다). 넣은 행 번호를 돌려준다 */
async function seedEvents(rows) {
  if (rows.length === 0) return [];
  const c = { name: [], at: [], sid: [], vid: [], props: [], bot: [], staff: [] };
  for (const r of rows) {
    const name = r.name ?? "article_viewed";
    c.name.push(name);
    c.at.push(iso(r.at));
    c.sid.push(crypto.randomUUID());
    c.vid.push(r.visitor === undefined ? crypto.randomUUID() : r.visitor);
    c.props.push(JSON.stringify(PROPS[name](r.article)));
    c.bot.push(r.bot === true);
    c.staff.push(r.staff === true);
  }
  const { rows: ids } = await db.query(
    `insert into public.analytics_events (name, occurred_at, session_id, visitor_id, first_visit, stage, entry, section, props, is_bot, is_staff)
     select n, a, s, v, false, 1, 'direct', 'tax', p::jsonb, b, st
     from unnest($1::text[], $2::timestamptz[], $3::uuid[], $4::uuid[], $5::text[], $6::boolean[], $7::boolean[]) as t(n, a, s, v, p, b, st) returning id`,
    [c.name, c.at, c.sid, c.vid, c.props, c.bot, c.staff],
  );
  return ids.map((r) => Number(r.id));
}
const humans = (article, n, at, name = "article_viewed") => Array.from({ length: n }, (_, i) => ({ article: article.id, at: at + i * 1000, name }));

const statSums = async (a) => {
  const r = await one("select coalesce(sum(views_all), 0)::int a, coalesce(sum(views_human), 0)::int h, coalesce(sum(shares), 0)::int s from public.article_stats where article_id = $1", [a.id]);
  return { all: r.a, human: r.h, shares: r.s };
};
const ranking = async (list) => (await db.query("select article_id, rank, score, pinned from public.article_rankings where list = $1 order by rank", [list])).rows.map((r) => ({ id: Number(r.article_id), rank: r.rank, score: Number(r.score), pinned: r.pinned }));

// ── 그림 (PNG — 한 색, 정해진 크기) · 이미지 기록 ─────────────────────

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
  const row = Buffer.alloc(1 + width * 3, 0xdd);
  row[0] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}
async function insertMedia(label, { width, height, kind = "photo", confirmed = true, credit = "가온시청", photographer = kind === "photo" ? "김가온" : null, license = "공공누리 제1유형", alt = `${label} 그림` }) {
  const p = `e2e/${staff.run}/${label}.png`;
  const row = await one(
    `insert into public.media (path, alt, kind, rights_status, credit, photographer, license, checked_at, width, height)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [p, alt, kind, confirmed ? "confirmed" : "unconfirmed", credit, photographer, license, confirmed ? new Date() : null, width ?? null, height ?? null],
  );
  staff.trackRow("media", row.id);
  if (width && height) IMAGES.set(`/${p}`, { width, height });
  return { id: Number(row.id), mediaId: String(row.id) };
}

/**
 * 끝나지 않은 요청이 0인 채 300ms — 화면 전환(RSC 응답)은 문서 load 상태를 다시 내지 않아 networkidle로 기다릴 수 없다.
 * 문맥을 닫거나 다음 문서로 가기 전에 부른다 (보내는 중인 응답을 끊으면 서버가 'destination stream closed early'를 남긴다)
 */
function pendingTracker(context) {
  const pending = new Set();
  context.on("request", (r) => pending.add(r));
  for (const ev of ["requestfinished", "requestfailed"]) context.on(ev, (r) => pending.delete(r));
  return async () => {
    const end = Date.now() + 15_000;
    let quietSince = Date.now();
    while (Date.now() < end) {
      if (pending.size > 0) quietSince = Date.now();
      else if (Date.now() - quietSince >= 300) return;
      await sleep(50);
    }
    throw new Error(`요청 ${pending.size}개가 끝나지 않았다: ${[...pending].map((r) => r.url()).join(", ")}`);
  };
}

/** 공개 화면 브라우저 문맥 — 모든 요청을 기록, 그림은 정해진 크기의 PNG, nocookie 플레이어는 빈 쪽 (바깥 네트워크 0) */
async function siteContext({ viewport = DESKTOP, ...options } = {}) {
  const context = await browser.newContext({ viewport, userAgent: HEADLESS_UA, ...options });
  contexts.push(context);
  const requests = [];
  context.on("request", (req) => requests.push(req.url()));
  await context.route(`${SITE}/**`, async (route) => {
    const size = IMAGES.get(new URL(route.request().url()).pathname);
    if (!size) return route.fulfill({ status: 404, body: "" });
    const key = `${size.width}x${size.height}`;
    if (!PNG_CACHE.has(key)) PNG_CACHE.set(key, png(size.width, size.height));
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG_CACHE.get(key) });
  });
  await context.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>player</title>" }));
  return { context, requests, idle: pendingTracker(context) };
}
async function openSite(p, options) {
  const { context, requests, idle } = await siteContext(options);
  const page = await context.newPage();
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  return { page, context, requests, idle, status: res.status() };
}
async function imageRatios(page, selector) {
  const imgs = page.locator(selector);
  const out = [];
  for (let i = 0; i < (await imgs.count()); i++) {
    const img = imgs.nth(i);
    await img.scrollIntoViewIfNeeded();
    await img.evaluate((el) => (el.complete && el.naturalWidth > 0 ? null : new Promise((ok) => el.addEventListener("load", ok, { once: true }))));
    out.push(await img.evaluate((el) => ({ nw: el.naturalWidth, nh: el.naturalHeight, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, fit: getComputedStyle(el).objectFit })));
  }
  return out;
}
function assertOriginalRatio(list, where) {
  assert.ok(list.length > 0, `${where}: 그림 0`);
  for (const r of list) {
    assert.ok(r.nw > 0 && r.nh > 0, `${where}: 그림을 읽지 못함`);
    assert.ok(Math.abs(r.w / r.h - r.nw / r.nh) / (r.nw / r.nh) < 0.01, `${where}: 원본 비율 ${(r.nw / r.nh).toFixed(3)} ≠ 화면 비율 ${(r.w / r.h).toFixed(3)}`);
    assert.notEqual(r.fit, "cover", `${where}: 자르기(object-fit cover) 0`);
  }
}
const horizontalOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const cardIds = (page, part) => page.$$eval(`[data-part="${part}"] [data-article-id]`, (els) => els.map((e) => Number(e.getAttribute("data-article-id"))).sort((a, b) => a - b));
async function eventsOf(name, article, since = staff.startedAt) {
  return (await db.query("select section, props, is_bot from public.analytics_events where name = $1 and props ->> 'article_id' = $2 and occurred_at >= $3 order by id", [name, String(article.id), since])).rows;
}
/**
 * 지금까지 넣은 측정 행의 마지막 번호 — 이 뒤에 수집 API가 넣는 행은 번호가 더 크다(analytics_events.id는 넣은 차례의 identity).
 * 수집 API로 보낸 바로 그 행을 고를 때는 시각 대신 이 번호를 쓴다: occurred_at은 웹 서버 프로세스의 Date.now()이고, Windows의 Node(V8)는
 * 프로세스마다 시스템 시각을 60초마다 다시 읽어 고해상도 틱으로 이어 가므로 두 프로세스의 시계가 1~2ms(시스템 틱만큼까지) 어긋난다.
 * 시험 프로세스의 new Date() 바로 뒤에 보낸 첫 요청이 그보다 1ms 이른 시각으로 저장되는 것을 재현했다(30회 중 1회 — 202·저장은 됐다)
 */
const eventMark = async () => Number((await one("select coalesce(max(id), 0)::bigint m from public.analytics_events")).m);
async function waitForEvents(name, article, expected, since) {
  const end = Date.now() + 10_000;
  let rows = [];
  while (Date.now() < end) {
    rows = await eventsOf(name, article, since);
    if (rows.length >= expected) return rows;
    await sleep(200);
  }
  return rows;
}

// ── 편집국 API로 쓰는 형식 기사 (발행 판정을 지나는 세법 해설 — 출처·핵심 요약·문단·표·인용·상자·FAQ·핵심 주장) ──

const LAW = { kind: "official_doc", title: "지방세법 제20조(신고 및 납부)", url: "https://www.law.go.kr/법령/지방세법/제20조", sourceName: "법제처 국가법령정보센터", lastVerifiedAt: "2026-10-10T09:00:00+09:00", licenseStatus: "공공저작물 자유이용" };
const baseBlocks = (srcRef) => [
  { type: "key_summary", lines: ["주택을 사면 취득일부터 60일 안에 신고합니다.", "취득일은 잔금일과 등기일 중 빠른 날입니다.", "신고와 납부는 함께 합니다."] },
  { type: "paragraph", text: "취득일은 잔금을 치른 날과 등기를 마친 날 중 빠른 날이다. 자세한 흐름은 [지방세 허브](/tax)에서 볼 수 있다." },
  { type: "table", caption: "취득일 정하는 법", rows: [["경우", "취득일"], ["잔금이 먼저", "잔금일"], ["등기가 먼저", "등기일"]], chart: { axis: "경우", unit: "날짜", source: "지방세법 시행령" } },
  { type: "quote", text: "취득세는 취득일부터 60일 이내에 신고하고 납부하여야 한다.", speaker: "지방세법 제20조", origin: "document", refId: srcRef },
  { type: "callout", kind: "tip", title: "절세 체크포인트", text: "생애 첫 주택이면 감면 요건을 먼저 확인하세요." },
  { type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "계약일이 아니라 잔금일이나 등기일이 취득일입니다." },
  { type: "faq", items: [{ question: "취득세는 어디에 신고하나요?", answer: "주택이 있는 시·군·구청이나 위택스에 신고합니다." }, { question: "신고와 납부를 따로 하나요?", answer: "신고하면서 함께 냅니다." }] },
];
const EXTRA_AT = 7;
const claims = (srcRef) => [{ id: "claim-1", text: "취득일부터 60일 안에 신고하고 납부해야 한다.", kind: "legal", evidenceIds: [srcRef], blockIndex: 1 }];

async function draftExplainer(label, { title, format }) {
  const created = await expectStatus(
    api("POST", "/articles", u.reporter, { slug: slugOf(label), title: `${title} ${staff.run}`, summary: "취득세 신고 순서를 형식에 맞게 정리했습니다.", section: "tax", categoryId: fx.interpretations, contentType: "explainer", legalBasisDate: "2026-10-01", format }),
    201,
    `기사 만들기 ${label}`,
  );
  const id = created.body.article.id;
  staff.trackArticle(id);
  const src = await expectStatus(api("POST", `/articles/${id}/sources`, u.reporter, LAW), 201, `출처 ${label}`);
  fx[label] = { id, slug: slugOf(label), href: `/news/${slugOf(label)}`, srcRef: src.body.source.ref, contentType: "explainer" };
  return fx[label];
}
const writeBody = (a, extra) => api("PATCH", `/articles/${a.id}`, u.reporter, { body: { blocks: [...baseBlocks(a.srcRef), ...extra], claims: claims(a.srcRef) } });
const versionOf = async (a) => Number((await one("select version from public.articles where id = $1", [a.id])).version);
async function saveAndPublish(a, extra) {
  await expectStatus(writeBody(a, extra), 200, `저장 ${a.slug}`);
  await expectStatus(api("POST", `/articles/${a.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve" }), 201, "편집 승인");
  await expectStatus(api("POST", `/articles/${a.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" }), 201, "세무 감수");
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
  thumbnailMediaId: thumb.mediaId,
  durationSeconds: 95,
  ...over,
});
const photo = (media, n, over = {}) => ({ type: "image", mediaId: media.mediaId, alt: `${n}번째 사진 — 구청 세무과 신고 창구`, caption: `신고 창구 ${n}`, ...over });

// ── 측정 지표 대시보드용 지난 주 자료 (admin-metrics와 같은 손 계산) ─────────────

const METRIC_PROPS = {
  hub_viewed: {},
  article_viewed: { article_id: 1, format: "general", content_type: "explainer" },
  article_engaged: { article_id: 1, format: "general", content_type: "explainer" },
  home_entry_clicked: {},
  next_action_clicked: { action: "same_section", screen: "article" },
};
async function seedSession({ visitor = crypto.randomUUID(), firstVisit = false, bot = false, staff: isStaff = false, events }) {
  const sid = crypto.randomUUID();
  seededSessions.push(sid);
  for (const [name, date, hms, section = "tax"] of events) {
    await db.query(
      `insert into public.analytics_events (name, occurred_at, session_id, visitor_id, first_visit, stage, entry, section, props, is_bot, is_staff)
       values ($1, $2, $3, $4, $5, 1, 'direct', $6, $7, $8, $9)`,
      [name, kst(date, hms), sid, visitor, firstVisit, name === "next_action_clicked" ? null : section, JSON.stringify(METRIC_PROPS[name]), bot, isStaff],
    );
  }
  return visitor;
}
/** 지난 날 가운데 앞뒤 40일 안에 측정 이벤트가 하나도 없는 주 */
async function emptyWeek() {
  for (let i = 0; i < 20; i++) {
    const day = kstDay(-(120 + Math.floor(Math.random() * 160)));
    if ((await countOf("select count(*)::int n from public.analytics_events where occurred_at >= $1 and occurred_at < $2", [kst(addDays(day, -2), "00:00:00"), kst(addDays(day, 40), "00:00:00")])) === 0) return day;
  }
  throw new Error("비어 있는 시험 주를 찾지 못했다");
}

// ── 관리자 화면 (실제 로그인) ───────────────────────────

async function interactive(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(로그아웃|로그인)$/.test(b.textContent.trim()) && !b.disabled));
}
async function adminOpen(page, p) {
  const res = await page.goto(`${base}${p}`);
  await interactive(page);
  assert.equal(await page.locator('[data-ui="assistant-launcher"]').count(), 0, `${p}: AI 도우미 런처`);
  return res;
}
async function loginPage(user, { viewport = DESKTOP, userAgent } = {}) {
  const context = await browser.newContext({ viewport, ...(userAgent ? { userAgent } : {}) });
  contexts.push(context);
  const page = await context.newPage();
  // 로그인 뒤 편집국 첫 화면은 화면 전환 요청(RSC)을 더 보낸다 — 그것이 끝나기 전에 다음 문서로 가면 끊긴 요청이
  // 'requestfailed' 없이 남아(리눅스 CI) 뒤의 pendingTracker가 15초를 기다리다 실패했다. 돌려주기 전에 조용해질 때까지 기다린다
  const quiet = pendingTracker(context);
  await page.goto(`${base}/admin/login`);
  await interactive(page);
  await page.fill("#login-email", user.email);
  await page.fill("#login-password", user.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
  await interactive(page);
  await quiet();
  return page;
}
const text = async (page, sel) => (await page.locator(sel).innerText()).trim();
async function metricCell(page, segment, metric, row, name) {
  return text(page, `[data-segment="${segment}"] [data-metric="${metric}"]${row === null ? "" : ` [data-row="${row}"]`} [data-cell="${name}"]`);
}
async function metricTable(page, segment, metric, rows, names) {
  const out = {};
  for (const r of rows) {
    out[r] = [];
    for (const n of names) out[r].push(await metricCell(page, segment, metric, r, n));
  }
  return out;
}
/** 오늘 포함 최근 7일 — 깔때기 세 칸 · 지방세 유효 방문(허브 방문 세션·유효 방문 세션) · 첫 방문 문제해결 */
async function todayNumbers(page) {
  await adminOpen(page, "/admin/metrics?period=7");
  const funnel = [];
  for (const r of ["1", "2", "3"]) funnel.push(Number(await metricCell(page, "trial", "funnel", r, "count")));
  const tax = [Number(await metricCell(page, "trial", "valid-visits", "tax", "denominator")), Number(await metricCell(page, "trial", "valid-visits", "tax", "numerator"))];
  return { funnel, tax, solved: Number(await metricCell(page, "trial", "solved", null, "numerator")) };
}

/** 측정 요청을 기록하는 사람 브라우저 — loginAs면 편집국 로그인부터 */
async function trackingContext({ userAgent = HUMAN_UA, loginAs = null, ...options } = {}) {
  let page;
  if (loginAs) page = await loginPage(loginAs, { userAgent });
  else {
    const context = await browser.newContext({ viewport: DESKTOP, userAgent, ...options });
    contexts.push(context);
    page = await context.newPage();
  }
  const context = page.context();
  const idle = pendingTracker(context);
  const sent = [];
  const answered = [];
  context.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/events") sent.push(JSON.parse(r.postData() ?? "{}").name);
  });
  context.on("response", (r) => {
    if (new URL(r.url()).pathname === "/api/events") answered.push(r.status());
  });
  const settled = async (n) => {
    const end = Date.now() + 15_000;
    while (answered.length < n && Date.now() < end) await sleep(50);
    assert.ok(answered.length >= n, `/api/events 응답 ${answered.length}/${n}: ${sent}`);
  };
  return { context, page, sent, answered, settled, idle };
}
/**
 * 기사를 열고 가짜 시계로 화면에 머문 시간을 정한다 — 열람 이벤트를 받은 바로 뒤 시계를 멈추고(열린 뒤 흐른 진짜 시간 0.4초 미만),
 * 멈춘 시계를 정확히 그만큼만 앞으로 돌린다 (30초 열람 = 화면이 보인 시간 30,000ms — 설계 6장)
 */
async function openArticleWithClock(t, href, already) {
  await t.page.clock.install();
  await t.page.goto(`${base}${href}`, { waitUntil: "domcontentloaded" });
  await t.page.locator('[data-ui="next-action-band"]').waitFor();
  await t.settled(already + 1);
  assert.equal(t.sent.at(-1), "article_viewed");
  const now = await t.page.evaluate(() => Date.now());
  await t.page.clock.pauseAt(now + 250);
}

// ── 규정 버전 ───────────────────────────────────────────

/** 한국 달력의 완결된 달 n개 [첫날 0시, 이번 달 1일 0시) — 설정 씨앗 closed_months (설계 2.8) */
function closedMonths(n) {
  const cur = monthIndex(kstToday());
  return { from: firstDay(cur - n), fromMs: Date.parse(kst(firstDay(cur - n), "00:00:00")), toMs: Date.parse(kst(firstDay(cur), "00:00:00")) };
}
/** 손 계산 — 이 시험이 만든 기사 가운데 지금 공개 중이고 그 기간에 처음 발행된 기사: 총 발행 · 자체 취재 후보(보도) */
async function production(n) {
  const w = closedMonths(n);
  const rows = (await db.query("select content_type, status, first_published_at from public.articles where id = any($1::bigint[])", [[...staff.articleIds]])).rows;
  const inside = rows.filter((r) => r.status === "published" && r.first_published_at && r.first_published_at.getTime() >= w.fromMs && r.first_published_at.getTime() < w.toMs);
  return { total: inside.length, own: inside.filter((r) => r.content_type === "reported_news").length };
}
const pct1 = (n, d) => Math.round((n / d) * 1000) / 10;
const ratioText = (n, d) => (d === 0 ? `${n} / 0 · —` : `${n} / ${d} · ${Number.isInteger(pct1(n, d)) ? pct1(n, d).toFixed(0) : pct1(n, d).toFixed(1)}%`);
const OWN_RATIO = (value) => ({
  key: "own_ratio",
  label: "자체 생산 기사 비율",
  metric: "ratio",
  numerator: { contentTypes: ["reported_news"] },
  denominator: {},
  numeratorText: "규정이 정한 자체 취재 보도기사 (수용 시험 문구)",
  denominatorText: "규정이 정한 전체 송고 기사 (수용 시험 문구)",
  exclusionsText: "규정이 정한 제외 기사 (수용 시험 문구)",
  criterion: { comparator: "gte", value, per: "period" },
  sourceRef: "시험 규정 제3조",
});

// ── 로그인 쿠키로 화면을 받는 요청 (권한 표) ─────────────────────────

const cookieJar = new Map();
async function sessionCookie(user) {
  if (!cookieJar.has(user.email)) {
    const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ email: user.email, password: user.password }) });
    assert.equal(res.status, 200, `로그인 ${user.email}`);
    cookieJar.set(user.email, Object.entries(setCookies(res)).filter(([k]) => k.startsWith("sb-")).map(([k, v]) => `${k}=${v}`).join("; "));
  }
  return cookieJar.get(user.email);
}
async function pageAs(user, p) {
  const res = await fetch(`${base}${p}`, { headers: user ? { cookie: await sessionCookie(user) } : {}, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") ?? "", html: await res.text() };
}
const menuHrefs = (html) => [...(html.match(/aria-label="편집국 메뉴"[\s\S]*?<\/nav>/)?.[0] ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

// ── 남은 행 ─────────────────────────────────────────────

async function residue(client = db) {
  const tables = [
    "articles",
    "article_revisions",
    "article_sources",
    "article_corrections",
    "article_tombstones",
    "editorial_reviews",
    "seo_checks",
    "raw_snapshots",
    "people",
    "staff_roles",
    "audit_logs",
    "media",
    "partners",
    "analytics_events",
    "article_stats",
    "article_rankings",
    "agent_runs",
    "news_partner_requirements",
    "news_partner_checks",
  ];
  const out = {};
  for (const t of tables) out[t] = (await client.query(`select count(*)::int n from public.${t}`)).rows[0].n;
  out["auth.users"] = (await client.query("select count(*)::int n from auth.users")).rows[0].n;
  out.settings = JSON.stringify((await client.query("select key, value from public.settings order by key")).rows);
  return out;
}

async function removeTestRuns() {
  await db.query("delete from public.agent_runs where job in ('popular-hourly', 'analytics-retention') and started_at >= $1", [staff.startedAt]);
  if (seededSessions.length) await db.query("delete from public.analytics_events where session_id = any($1::uuid[])", [seededSessions]);
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  serverEnv = {
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: SECRET,
  };
  server = await startServer(serverEnv);
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  Object.assign(before0, await residue());

  // 출발점 — 기사 0 · 순위 0 · 규정 버전 0 · 동영상 목록 꺼짐 · 전환일 없음 (순위·대시보드 숫자가 이 시험 자료로만 정해진다)
  assert.equal(await countOf("select count(*)::int n from public.articles"), 0, "로컬 DB에 기사가 남아 있다");
  assert.equal(await countOf("select count(*)::int n from public.article_rankings"), 0, "로컬 DB에 순위 행이 남아 있다");
  assert.equal(await countOf("select count(*)::int n from public.news_partner_requirements"), 0, "로컬 DB에 규정 버전이 있다 — '요건 미확정' 시험을 할 수 없다");
  const settings = Object.fromEntries((await db.query("select key, value from public.settings")).rows.map((r) => [r.key, r.value]));
  assert.equal(settings.feature_flags.video_list, false, "동영상 목록은 씨앗대로 꺼진 채 시작한다");
  assert.equal(settings.domain_cutover.date, null, "전환일 없음 — 모두 시험 기간");
  assert.deepEqual({ months: settings.news_readiness_windows.months, basis: settings.news_readiness_windows.basis }, { months: [3, 6, 12], basis: "closed_months" });

  // 계정 — 편집국 역할 7종 + 관리자 (권한 표)
  u.admin = await staff.createUser({ label: "w2c-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w2c-editor", roles: ["editor"], person: { name: "수용 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w2c-reporter", roles: ["reporter"], person: { name: "수용 시험 기자", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "w2c-reviewer", roles: ["reviewer"], person: { name: "수용 시험 감수위원", roles: ["reviewer"] } });
  u.adOps = await staff.createUser({ label: "w2c-ad", roles: ["ad_ops"], person: { name: "수용 시험 광고 담당", roles: ["writer"] } });
  u.storeOps = await staff.createUser({ label: "w2c-store", roles: ["store_ops"] });
  u.brandOps = await staff.createUser({ label: "w2c-brand", roles: ["brand_ops"] });
  u.expertOps = await staff.createUser({ label: "w2c-expert", roles: ["expert_ops"] });
  fx.interpretations = Number((await one("select id from public.categories where section = 'tax' and slug = 'interpretations'")).id);

  // 이미지 기록 — 16:9·4:3 썸네일, 가로·세로 사진, 표기가 빠진 사진 3종, 인포그래픽 그림 (이미지 등록 API는 아직 없다 — DB에 직접)
  fx.thumb169 = await insertMedia("thumb-169", { width: 1280, height: 720, kind: "thumbnail", credit: "편집국", license: "자체 제작" });
  fx.thumb43 = await insertMedia("thumb-43", { width: 1200, height: 900, kind: "thumbnail", credit: "편집국", license: "자체 제작" });
  fx.photoWide = await insertMedia("photo-wide", { width: 1200, height: 900 });
  fx.photoTall = await insertMedia("photo-tall", { width: 600, height: 800 });
  fx.photoNoCredit = await insertMedia("photo-no-credit", { width: 800, height: 600, confirmed: false, credit: null });
  fx.photoNoLicense = await insertMedia("photo-no-license", { width: 800, height: 600, confirmed: false, license: null });
  fx.photoNoAlt = await insertMedia("photo-no-alt", { width: 800, height: 600, alt: null });
  fx.chart = await insertMedia("chart", { width: 1600, height: 1000, credit: "편집국", photographer: "편집국 그래픽팀", license: "자체 제작" });

  // 제휴사 — 광고·협찬 담당이 운영 API로 (공개 A·B, 처음부터 비공개 C)
  for (const [key, body] of [
    ["partnerA", { name: `가온세무법인${staff.run}`, visible: true, url: "https://gaon-tax.example" }],
    ["partnerB", { name: `누리회계${staff.run}`, visible: true }],
    ["partnerC", { name: `숨은제휴${staff.run}`, visible: false }],
  ]) {
    const r = await expectStatus(api("POST", "/partners", u.adOps, { kind: "tax_firm", intro: "지방세 실무를 함께 기획합니다.", ...body }), 201, `제휴사 ${key}`);
    staff.trackRow("partners", r.body.partner.id);
    fx[key] = { id: Number(r.body.partner.id), name: body.name };
  }

  // DB에 넣는 기사 — 발행 시각은 몇 분 전으로 서로 다르게 (동점이면 최신 발행이 앞)
  let m = 5;
  const next = () => minutesAgo((m += 3));
  // 많이 본 기사 (지방세)
  for (const label of ["A", "B", "R", "D168", "D169", "staffOnly", "gone"]) await insertArticle(label, { publishedAt: next() });
  // 삭제 정정은 지금 판의 수정 이력이 있어야 전후 판을 남긴다 (W2-a — 편집국 API로 쓴 기사처럼)
  await db.query("insert into public.article_revisions (article_id, version, title, body, edited_by) values ($1, 1, $2, '[]'::jsonb, 'user:e2e')", [fx.gone.id, "수용 시험 gone"]);
  for (let i = 1; i <= 8; i++) await insertArticle(`f${i}`, { section: "realestate", publishedAt: next() });
  // 상담 사례(지방세 › 해석) — 해결 사례 4 · 일반 5 · 고정 1 · 가중치 시험 2
  for (let i = 1; i <= 4; i++) await insertArticle(`sc${i}`, { categoryId: fx.interpretations, solvedCase: SOLVED(i), publishedAt: next() });
  for (let i = 1; i <= 5; i++) await insertArticle(`g${i}`, { categoryId: fx.interpretations, publishedAt: next() });
  for (const label of ["pin", "wView", "wShare"]) await insertArticle(label, { categoryId: fx.interpretations, publishedAt: next() });
  // 제휴사 A의 공동 기획·광고 기사 (부동산개발금융)
  await insertArticle("coA", { section: "finance", contentType: "sponsored", label: "co_planned", partnerId: fx.partnerA.id, title: "공동 기획 취득세 실무", publishedAt: next() });
  await insertArticle("adA", { section: "finance", contentType: "sponsored", label: "ad", partnerId: fx.partnerA.id, title: "광고 세무 상담 안내", publishedAt: next() });
  // 측정 시나리오 기사 (지방세 해설 — 다음 행동 띠 [같은 분야 더 보기])
  await insertArticle("mArticle", { title: `측정 시나리오 기사 ${staff.run}`, publishedAt: next() });
  // 기사 생산 대시보드 — 완결된 3개월의 첫날 0시 보도(정량) · 그 하루 전 보도(정성) · 3개월 안 해설
  const w3 = closedMonths(3);
  await insertArticle("rStart", { contentType: "reported_news", reportingMethod: "quantitative", publishedAt: kst(w3.from, "00:00:00") });
  await insertArticle("rBefore", { contentType: "reported_news", reportingMethod: "qualitative", publishedAt: kst(addDays(w3.from, -1), "12:00:00") });
  await insertArticle("rExplainer", { publishedAt: kst(addDays(w3.from, 20), "11:00:00") });

  // 지표 대시보드 — 비어 있는 지난 주 (손 계산은 9c)
  fx.D1 = await emptyWeek();
  const d = (n) => addDays(fx.D1, n);
  const v1 = await seedSession({
    firstVisit: true,
    events: [
      ["home_entry_clicked", d(0), "10:00:00"],
      ["hub_viewed", d(0), "10:00:05"],
      ["article_viewed", d(0), "10:01:00"],
      ["article_engaged", d(0), "10:01:31"],
      ["next_action_clicked", d(0), "10:02:00"],
    ],
  });
  const v2 = await seedSession({ events: [["hub_viewed", d(0), "23:59:00"], ["article_viewed", d(0), "23:59:59"]] }); // 29초 — 30초 열람 이벤트 0
  const v3 = await seedSession({ events: [["hub_viewed", d(2), "12:00:00", "finance"], ["article_engaged", d(2), "12:01:00", "realestate"]] });
  await seedSession({ bot: true, firstVisit: true, events: [["hub_viewed", d(0), "14:00:00"], ["article_engaged", d(0), "14:01:00"]] });
  await seedSession({ staff: true, events: [["hub_viewed", d(0), "15:00:00"], ["article_engaged", d(0), "15:01:00"]] });
  await seedSession({ visitor: null, events: [["hub_viewed", d(1), "09:00:00", "local"]] });
  await seedSession({ events: [["hub_viewed", d(7), "00:00:00"]] }); // 끝날 다음 날 0시 정각 — 기간 밖
  await seedSession({ visitor: v1, events: [["article_viewed", d(30), "23:00:00"]] }); // 30일째 — 포함
  await seedSession({ visitor: v2, events: [["hub_viewed", d(31), "00:00:00"]] }); // 31일째 — 제외
  await seedSession({ visitor: v3, events: [["hub_viewed", d(10), "08:00:00", "finance"]] });

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
});

after(async () => {
  try {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    if (!cleaned && staff) {
      await removeTestRuns();
      await staff.cleanup();
    }
  } finally {
    server?.stop();
  }
});

// ── 1) FND-06 ───────────────────────────────────────────

test("1) FND-06 — analytics_events 칸 = PRD 14칸, 개인정보·IP·User-Agent·좌표·주소·계산 입력값 모양 칸 0, DB도 금지 속성을 막는다 · `events` 표 0(DB·마이그레이션 검사) · DB가 끊기면 /api/health 503 + 실패 항목 db", async () => {
  // 9장 증거 줄이 이 시험이 증명하는 것과 같은지 (PRD가 바뀌면 이 시험을 고친다)
  const row = lineOf(PRD_01A, "| W2-c |");
  for (const evidence of ["봇 제외·168시간 경계 테스트", "유효 방문 29초·30초 테스트", "규정 미확정 시 `요건 미확정`"]) assert.ok(row.includes(evidence), evidence);
  assert.equal(PRD_COLUMNS.length, 14);

  const cols = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'analytics_events' order by ordinal_position")).rows.map((r) => r.column_name);
  assert.deepEqual(cols, PRD_COLUMNS, "칸 = 설계 3장(PRD-01A 6.1)");
  const forbidden = /(^|_)(ip|ua|user_agent|agent|email|phone|address|addr|lat|lng|coord|geo|location|query|keyword|search_term|question|prompt|answer|input|amount|calc|user|user_id|member|profile|referrer|url)(_|$)/;
  assert.deepEqual(cols.filter((c) => forbidden.test(c)), []);
  const visitorTables = (await db.query("select distinct c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema = 'public' and c.column_name = 'visitor_id' and t.table_type = 'BASE TABLE'")).rows.map((r) => r.table_name);
  assert.deepEqual(visitorTables, ["analytics_events"], "방문자 ID 칸이 있는 표는 하나 — 회원 ID·IP·UA와 같은 행 0");
  // DB가 막는다 — 같은 행에서 속성 이름만 email이면 거부 (정상 행은 들어간다 = 대조군)
  const insert = (props) =>
    db.query("insert into public.analytics_events (name, session_id, first_visit, stage, entry, section, props, is_bot, is_staff) values ('article_viewed', $1, false, 1, 'direct', 'tax', $2, false, false) returning id", [crypto.randomUUID(), JSON.stringify(props)]);
  const ok = await insert({ article_id: 1, format: "general", content_type: "explainer" });
  await db.query("delete from public.analytics_events where id = $1", [ok.rows[0].id]);
  await assert.rejects(insert({ article_id: 1, format: "general", content_type: "explainer", email: "hong@example.com" }), (e) => e.code === "23514", "금지 속성 이름 → check 제약");

  // `events` 표 0 — DB(public 관계)와 마이그레이션 검사(lint-migrations — 역검사로 검사가 잡는지도)
  assert.equal(await countOf("select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'events'"), 0);
  const lint = lintMigrationDir(path.join(ROOT, "packages", "db", "supabase", "migrations"));
  assert.ok(lint.files > 0, "마이그레이션을 읽었다");
  assert.deepEqual(lint.errors, []);
  assert.match(lintMigrations([{ name: "x.sql", sql: "create table public.events (id int); alter table public.events enable row level security;" }]).errors.join(), /'events'/, "역검사 — events 표를 만들면 잡는다");

  // /api/health — 지금 서버 200, DB에 닿지 않는 서버 503 + 실패 항목 이름 (api-health-jobs와 같은 판정)
  const healthy = await fetch(`${base}/api/health`);
  assert.equal(healthy.status, 200);
  assert.equal((await healthy.json()).checks.db, "ok");
  const dead = await startServer({ ...serverEnv, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${await freePort()}` });
  try {
    const res = await fetch(`${dead.base}/api/health`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.deepEqual([body.status, body.failed], ["fail", ["db"]]);
  } finally {
    dead.stop();
  }
});

// ── 2~4) ART-07·08·09 ───────────────────────────────────

test("2) ART-07 인포그래픽 — 대체 텍스트·같은 내용의 표가 없으면 저장 422(칸 경로·새 버전 0), 블록 없는 형식 인포그래픽은 발행 422 → 다 갖추면 발행 · 화면: 표 기본 접힘·Enter로 펼침·대체 텍스트·원본 비율 · 카드 '인포그래픽' 배지", async () => {
  const a = await draftExplainer("infographic", { title: "그림으로 보는 취득세 신고", format: "infographic" });
  let r = await saveAndPublish(a, []);
  assert.equal(r.status, 422, show(r));
  assert.ok(r.body.failed.includes("art07.infographic-required"), show(r));
  const version = await versionOf(a);
  const noAlt = await writeBody(a, [infographic(fx.chart, { alt: "  " })]);
  assert.equal(noAlt.status, 422, show(noAlt));
  assert.deepEqual(noAlt.body.errors.map((e) => e.split(":")[0]), [`body.blocks[${EXTRA_AT}].alt`]);
  const noTable = await writeBody(a, [infographic(fx.chart, { template: "compare", data: { kind: "table", columns: ["구분", "올해"], rows: [] } })]);
  assert.equal(noTable.status, 422, show(noTable));
  assert.deepEqual(noTable.body.errors.map((e) => e.split(":")[0]), [`body.blocks[${EXTRA_AT}].data`]);
  assert.equal(await versionOf(a), version, "거부된 저장은 새 버전을 만들지 않는다");
  r = await saveAndPublish(a, [infographic(fx.chart, { chart: { axis: "단계", unit: "단계", source: "지방세법" } })]);
  assert.equal(r.status, 200, show(r));

  const { page, context } = await openSite(a.href);
  const block = page.locator('[data-block="infographic"] [data-ui="infographic-block"]');
  assert.equal(await block.locator("img").getAttribute("alt"), "계약 → 잔금 → 신고 → 납부 4단계를 화살표로 이은 그림");
  const details = block.locator("details");
  assert.equal(await details.evaluate((el) => el.open), false, "기본 접힘");
  await block.locator("summary").focus();
  await page.keyboard.press("Enter");
  assert.equal(await details.evaluate((el) => el.open), true, "키보드로 펼친다");
  assert.deepEqual(await block.locator("ol li").allTextContents(), ["계약", "잔금 치르기", "60일 안에 신고", "신고하면서 납부"]);
  assertOriginalRatio(await imageRatios(page, '[data-block="infographic"] img'), "인포그래픽");
  await context.close();
  const list = await openSite("/tax/interpretations");
  assert.equal((await list.page.locator(`[data-part="category-articles"] [data-article-id="${a.id}"] [data-format-badge]`).textContent()).trim(), "인포그래픽");
  await list.context.close();
});

test("3) ART-08 동영상 저장·발행 — youtube-nocookie 임베드가 아닌 주소는 저장 422, 요약 없음·'자막 있음' 미확인·4:3 썸네일은 발행 422 → 다 갖추면 발행(정리한 nocookie 주소로 저장)", async () => {
  const a = await draftExplainer("video", { title: "동영상으로 보는 취득세 신고", format: "video" });
  for (const embedUrl of [`https://www.youtube.com/embed/${VIDEO_ID}`, `http://www.youtube-nocookie.com/embed/${VIDEO_ID}`, `https://www.youtube-nocookie.com.evil.example/embed/${VIDEO_ID}`, `https://youtu.be/${VIDEO_ID}`, `${NOCOOKIE}?autoplay=1`]) {
    const r = await writeBody(a, [video(fx.thumb169, { embedUrl })]);
    assert.equal(r.status, 422, `${embedUrl}: ${show(r)}`);
    assert.deepEqual(r.body.errors.map((e) => e.split(":")[0]), [`body.blocks[${EXTRA_AT}].embedUrl`], embedUrl);
  }
  assert.equal(await versionOf(a), 1, "거부된 저장은 새 버전을 만들지 않는다");
  let r = await saveAndPublish(a, [video(fx.thumb169, { summary: "", captions: false })]);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(r.body.failed.filter((id) => id.startsWith("art08")).sort(), ["art08.captions-unconfirmed", "art08.summary-required"]);
  r = await saveAndPublish(a, [video(fx.thumb169, { captions: false })]);
  assert.deepEqual([r.status, r.body.failed?.filter((id) => id.startsWith("art08"))], [422, ["art08.captions-unconfirmed"]], "요약을 쓰면 '자막 있음'만 남는다");
  r = await saveAndPublish(a, [video(fx.thumb43)]);
  assert.deepEqual([r.status, r.body.failed?.filter((id) => id.startsWith("art08"))], [422, ["art08.thumbnail-ratio"]], "4:3 썸네일");
  r = await saveAndPublish(a, [video(fx.thumb169, { embedUrl: ` HTTPS://WWW.YOUTUBE-NOCOOKIE.COM/embed/${VIDEO_ID}?cc_load_policy=1 ` })]);
  assert.equal(r.status, 200, show(r));
  assert.equal((await one("select body from public.articles where id = $1", [a.id])).body.blocks[EXTRA_AT].embedUrl, `${NOCOOKIE}?cc_load_policy=1`);
});

test("3b) ART-08 동영상 화면 — 재생을 누르기 전 유튜브·구글 주소 요청 0(네트워크 기록), 썸네일 16:9 원본 비율, 누르면 nocookie 플레이어만 · video_played 정확히 1건 · /news/video는 기능 키로(꺼짐 404·켜면 형식 동영상만)", async () => {
  const { page, context, requests } = await openSite(fx.video.href);
  const card = page.locator('[data-block="video"] [data-ui="video-card"]');
  assert.equal(await card.locator("iframe").count(), 0, "누르기 전 플레이어 0");
  assert.equal((await card.locator('[data-ui="chip"]').textContent()).trim(), "자막 있음");
  assertOriginalRatio(await imageRatios(page, '[data-block="video"] img'), "썸네일");
  assert.ok(Math.abs((await card.locator("img").evaluate((el) => el.naturalWidth / el.naturalHeight)) - 16 / 9) < 0.01, "썸네일 16:9");
  await page.waitForTimeout(1500);
  assert.deepEqual(requests.filter((url) => YOUTUBE_GOOGLE.test(new URL(url).hostname)), [], "재생 전 유튜브·구글 요청 0");
  assert.equal((await eventsOf("video_played", fx.video)).length, 0);
  await card.locator("[data-video-facade]").click();
  const src = new URL(await card.locator("iframe").getAttribute("src"));
  assert.equal(src.origin + src.pathname, NOCOOKIE);
  await page.waitForTimeout(500);
  const hosts = requests.filter((url) => YOUTUBE_GOOGLE.test(new URL(url).hostname)).map((url) => new URL(url).hostname);
  assert.ok(hosts.length >= 1 && hosts.every((h) => h === "www.youtube-nocookie.com"), `누른 뒤 요청은 nocookie만: ${hosts}`);
  assert.equal((await waitForEvents("video_played", fx.video, 1)).length, 1);
  await page.waitForTimeout(1000);
  const played = await eventsOf("video_played", fx.video);
  assert.deepEqual(played.map((r) => [r.section, r.props]), [["tax", { article_id: fx.video.id }]], "정확히 1건");
  await context.close();

  assert.equal((await fetch(`${base}/news/video`)).status, 404, "동영상 채널 결정 전 — 숨김");
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  await expectStatus(api("PATCH", "/settings/feature_flags", u.admin, { value: { ...flags, video_list: true } }), 200, "동영상 목록 켜기");
  try {
    const list = await openSite("/news/video");
    assert.equal(list.status, 200);
    assert.deepEqual(await cardIds(list.page, "video-articles"), [fx.video.id], "형식 동영상 기사만");
    assert.equal(await list.page.locator("iframe").count(), 0);
    await list.page.waitForTimeout(1000);
    assert.deepEqual(list.requests.filter((url) => YOUTUBE_GOOGLE.test(new URL(url).hostname)), [], "목록에서도 유튜브 요청 0");
    await list.context.close();
  } finally {
    await expectStatus(api("PATCH", "/settings/feature_flags", u.admin, { value: flags }), 200, "동영상 목록 끄기");
  }
  assert.equal((await fetch(`${base}/news/video`)).status, 404, "다시 끄면 404");
});

test("4) ART-09 포토 — 사진 출처·이용 조건·대체 텍스트 중 하나라도 없으면 발행 422(그 사진 위치), 다 갖추면 발행 · 사진마다 표기 줄 · 원본 비율(가로·세로) · /news/photo는 형식 포토만", async () => {
  const a = await draftExplainer("photo", { title: "사진으로 보는 신고 창구", format: "photo" });
  let r = await saveAndPublish(a, []);
  assert.equal(r.status, 422, show(r));
  assert.ok(r.body.failed.includes("art09.photos-required"));
  for (const [media, id, over] of [
    [fx.photoNoCredit, "art09.photo-credit", {}],
    [fx.photoNoLicense, "art09.photo-license", {}],
    [fx.photoNoAlt, "art09.photo-alt", { alt: "" }],
  ]) {
    r = await saveAndPublish(a, [photo(fx.photoWide, 1), photo(media, 2, over)]);
    assert.equal(r.status, 422, show(r));
    assert.deepEqual(r.body.failed.filter((f) => f.startsWith("art09")), [id]);
    assert.deepEqual(r.body.findings.find((f) => f.id === id).location, { field: "blocks", blockIndex: EXTRA_AT + 1, phrase: media.mediaId });
  }
  r = await saveAndPublish(a, [photo(fx.photoWide, 1), { type: "paragraph", text: "두 번째 사진은 세로로 찍었다." }, photo(fx.photoTall, 2)]);
  assert.equal(r.status, 200, show(r));
  const { page, context } = await openSite(a.href);
  assert.deepEqual(await page.$$eval('[data-block="image"] [data-part="photo-credit"]', (els) => els.map((e) => e.textContent)), [
    "촬영 김가온 · 출처 가온시청 · 이용 조건 공공누리 제1유형",
    "촬영 김가온 · 출처 가온시청 · 이용 조건 공공누리 제1유형",
  ]);
  const ratios = await imageRatios(page, '[data-block="image"] img');
  assertOriginalRatio(ratios, "포토");
  assert.deepEqual(ratios.map((x) => [x.nw, x.nh]), [[1200, 900], [600, 800]]);
  await context.close();
  const list = await openSite("/news/photo");
  assert.equal(list.status, 200);
  assert.deepEqual(await cardIds(list.page, "photo-articles"), [a.id], "형식 포토 기사만");
  await list.context.close();
});

// ── 5) ART-10 ────────────────────────────────────────────

test("5) ART-10 제휴 — 공동 기획 기사를 광고·협찬 담당이 쓰고 편집 책임자가 발행, 프로필에 그 제휴사 공개 기사만·카드와 상세가 같은 배지, 상세 배지 → 프로필(화면 전환), partner_content_viewed 1건, 비공개 제휴사 404", async () => {
  const created = await expectStatus(
    api("POST", "/articles", u.adOps, {
      slug: slugOf("coB"),
      title: `공동 기획 재산세 고지서 읽기 ${staff.run}`,
      summary: "재산세 고지서의 칸을 하나씩 읽는 법을 정리했습니다.",
      section: "finance",
      contentType: "sponsored",
      label: "co_planned",
      partnerId: fx.partnerB.id,
      body: {
        blocks: [
          { type: "paragraph", text: "재산세 고지서에는 과세표준과 세율, 낼 세액이 차례로 적혀 있다." },
          { type: "paragraph", text: "고지서를 받으면 낼 날짜와 나눠 낼 수 있는지를 먼저 확인하세요." },
        ],
        claims: [],
      },
    }),
    201,
    "공동 기획 기사 쓰기 (광고·협찬 담당)",
  );
  const coB = { id: created.body.article.id, slug: slugOf("coB"), href: `/news/${slugOf("coB")}` };
  staff.trackArticle(coB.id);
  fx.coB = coB;
  await expectStatus(api("POST", `/articles/${coB.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve" }), 201, "편집 승인");
  await expectStatus(api("POST", `/articles/${coB.id}/publish`, u.editor), 200, "발행 (편집 책임자)");
  assert.equal((await one("select partner_badge_name from public.articles where id = $1", [coB.id])).partner_badge_name, fx.partnerB.name);

  const A = fx.partnerA;
  const profile = await openSite(`/partners/${A.id}`);
  assert.equal(profile.status, 200);
  assert.equal((await profile.page.locator("h1").textContent()).trim(), A.name);
  assert.equal((await profile.page.locator('[data-part="partner-meta"] [data-ui="partner-badge"]').textContent()).trim(), `공동 기획 ${A.name}`);
  assert.match(await profile.page.locator('[data-part="partner-independence"]').textContent(), /관여하지 않습니다/);
  assert.deepEqual(await cardIds(profile.page, "partner-articles"), sorted(fx.coA.id, fx.adA.id), "그 제휴사의 공개 기사만");
  assert.equal((await profile.page.locator(`[data-article-id="${fx.coA.id}"] [data-ui="partner-badge"]`).textContent()).trim(), `공동 기획 ${A.name}`);
  assert.deepEqual(
    [await profile.page.locator(`[data-article-id="${fx.adA.id}"] [data-ui="article-type-badge"]`).allTextContents(), await profile.page.locator(`[data-article-id="${fx.adA.id}"] [data-ui="partner-badge"]`).count()],
    [["광고"], 0],
    "광고와 공동 기획을 섞지 않는다",
  );
  await profile.context.close();
  const profileB = await openSite(`/partners/${fx.partnerB.id}`);
  assert.deepEqual(await cardIds(profileB.page, "partner-articles"), [coB.id]);
  const cardBadge = (await profileB.page.locator(`[data-article-id="${coB.id}"] [data-ui="partner-badge"]`).textContent()).trim();
  assert.equal(cardBadge, `공동 기획 ${fx.partnerB.name}`);
  await profileB.context.close();

  const since = new Date();
  const detail = await openSite(coB.href);
  const headBadge = detail.page.locator('[data-article-part="head"] [data-part="partner-link"]');
  assert.equal((await headBadge.locator('[data-ui="partner-badge"]').textContent()).trim(), cardBadge, "목록 카드와 상세의 같은 배지 글자");
  assert.equal(await headBadge.getAttribute("href"), `/partners/${fx.partnerB.id}`);
  assert.equal((await waitForEvents("partner_content_viewed", coB, 1, since)).length, 1);
  await detail.page.waitForTimeout(800);
  assert.deepEqual((await eventsOf("partner_content_viewed", coB, since)).map((r) => r.props), [{ partner_id: fx.partnerB.id, article_id: coB.id }], "한 번 열면 1건");
  await detail.page.evaluate(() => (window.__e2eMarker = "kept"));
  await headBadge.click();
  await detail.page.waitForURL(`${base}/partners/${fx.partnerB.id}`);
  await detail.page.locator('[data-ui="partner-page"]').waitFor();
  assert.equal(await detail.page.evaluate(() => window.__e2eMarker), "kept", "화면 전환 (FND-09)");
  await detail.idle();
  await detail.context.close();
  for (const p of [`/partners/${fx.partnerC.id}`, "/partners/abc", "/partners/0"]) assert.equal((await fetch(`${base}${p}`)).status, 404, p);
});

test("5b) ART-10 제휴사를 운영 API로 비공개·계약 종료로 내려도 공동 기획 배지는 '공동 기획 ○○' 그대로 — 목록 카드·상세·JSON-LD 제목·공유 제목, '광고' 0 · 프로필 링크 0 · partner_content_viewed 0", async () => {
  const B = fx.partnerB;
  await expectStatus(api("PATCH", `/partners/${B.id}`, u.adOps, { visible: false, contractFrom: kstDay(-200), contractTo: kstDay(-1) }), 200, "제휴사 비공개");
  const expected = { type: [], partner: [`공동 기획 ${B.name}`] };
  const hub = await openSite("/finance");
  const card = await hub.page.$eval(`[data-hub-part="latest"] [data-article-id="${fx.coB.id}"]`, (li) => ({
    type: [...li.querySelectorAll('[data-ui="article-type-badge"]')].map((e) => e.textContent),
    partner: [...li.querySelectorAll('[data-ui="partner-badge"]')].map((e) => e.textContent),
  }));
  assert.deepEqual(card, expected, "부동산개발금융 허브 목록 카드");
  await hub.context.close();
  const since = new Date();
  const d = await openSite(fx.coB.href);
  const head = d.page.locator('[data-article-part="head"]');
  assert.deepEqual({ type: await head.locator('[data-ui="article-type-badge"]').allTextContents(), partner: await head.locator('[data-ui="partner-badge"]').allTextContents() }, expected, "기사 상세 머리");
  assert.equal(await d.page.locator(`a[href="/partners/${B.id}"]`).count(), 0, "숨은 제휴사 프로필 링크 0");
  const scripts = await d.page.$$eval('script[type="application/ld+json"]', (els) => els.map((e) => e.textContent));
  assert.equal(scripts.length, 1);
  const nodes = [JSON.parse(scripts[0])].flat();
  assert.equal(nodes.find((n) => n["@type"] === "NewsArticle").headline, `[공동 기획 ${B.name}] 공동 기획 재산세 고지서 읽기 ${staff.run}`, "JSON-LD 제목");
  assert.ok((await d.page.locator('meta[property="og:title"]').getAttribute("content")).includes(`[공동 기획 ${B.name}]`), "공유 제목");
  await d.page.waitForTimeout(1000);
  assert.equal((await eventsOf("partner_content_viewed", fx.coB, since)).length, 0, "비공개 제휴사 기사 — 제휴 콘텐츠 측정 0");
  await d.context.close();
  assert.equal((await fetch(`${base}/partners/${B.id}`)).status, 404, "프로필은 비공개");
});

// ── 6~8) ART-11 · HOME-05 ───────────────────────────────

const hotView = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-hub-part="hot"]');
    if (!root) return null;
    return {
      cards: [...root.querySelectorAll('[data-part="hot-cards"] > li')].map((li) => Number(li.getAttribute("data-article-id"))),
      list: [...root.querySelectorAll('[data-part="hot-list"] > li')].map((li) => ({ id: Number(li.getAttribute("data-article-id")), hot: li.getAttribute("data-hot") === "true", pinned: li.getAttribute("data-pinned") === "true", badge: li.querySelectorAll('[data-ui="hot-badge"]').length })),
    };
  });
const idOfHref = (href) => Object.values(fx).find((f) => f?.href === href)?.id ?? null;
const popularIds = async (page, scope = "") => (await page.$$eval(`${scope} [data-ui="popular-articles"] a[data-rank]`, (as) => as.map((a) => a.getAttribute("href")))).map(idOfHref);

test("6) HOME-05 집계 전 — /news/popular는 빈 목록 안내, 지방세 허브 HOT은 최신 상담 사례로 채우고 HOT 배지 0(카드 3 + 목록 5, 겹침 0), 홈에 HOT 블록 0", async () => {
  const pop = await openSite("/news/popular");
  assert.equal(pop.status, 200);
  assert.match(await pop.page.locator('[data-part="empty-guide"]').textContent(), /아직 집계된 기사가 없습니다/);
  await pop.context.close();
  const tax = await openSite("/tax");
  const v = await hotView(tax.page);
  assert.ok(v, "지방세 허브에 상담 사례 HOT 자리");
  assert.deepEqual([v.cards.length, v.list.length], [3, 5]);
  assert.ok(v.list.every((x) => !x.hot && x.badge === 0), "점수·고정이 없으면 배지 없이 최신 상담 사례");
  assert.equal(new Set([...v.cards, ...v.list.map((x) => x.id)]).size, 8, "카드와 목록에 같은 기사 0");
  await tax.context.close();
  const home = await fetch(`${base}/`).then((r) => r.text());
  assert.ok(!home.includes('data-part="hot-block"') && !home.includes('data-ui="hot-badge"'), "홈 HTML에 HOT 블록 0");
});

test("7) ART-11 — 수집 API로 받은 조회(봇 User-Agent 100 + 사람 3 · 사람 5 · 같은 방문자 30분 안 반복) + 경계 자료 → 1시간 집계: 사람 5 > 봇 100 + 사람 3, 반복 1회, 168시간 전 포함·169시간 전 제외, 편집국·광고 0", async () => {
  // 받은 행은 번호로 고른다(eventMark — 시험 프로세스와 웹 서버의 시계는 몇 ms 어긋난다, occurred_at >= 지금 시각으로 고르면 첫 요청을 놓칠 수 있다)
  const mark = await eventMark();
  // 수집 API — 봇은 User-Agent로 서버가 표시한다(원문 0). 사람은 쿠키 없는 새 브라우저마다 새 방문자
  const statuses = [];
  for (let i = 0; i < 100; i += 20) statuses.push(...(await Promise.all(Array.from({ length: 20 }, () => sendEvent(viewEvent(fx.A), { ua: GOOGLEBOT_UA })))).map((r) => r.status));
  for (let i = 0; i < 3; i++) statuses.push((await sendEvent(viewEvent(fx.A))).status);
  for (let i = 0; i < 5; i++) statuses.push((await sendEvent(viewEvent(fx.B))).status);
  const first = await sendEvent(viewEvent(fx.R));
  const visitor = `ltr_vid=${first.cookies.ltr_vid}; ltr_sid=${first.cookies.ltr_sid}`;
  statuses.push(first.status);
  for (let i = 0; i < 2; i++) statuses.push((await sendEvent(viewEvent(fx.R), { cookie: visitor })).status);
  assert.deepEqual([...new Set(statuses)], [202], "모두 저장");
  const received = (await db.query("select id, props ->> 'article_id' aid, is_bot, visitor_id from public.analytics_events where id > $1 and name = 'article_viewed' and props ->> 'article_id' = any($2)", [mark, [fx.A, fx.B, fx.R].map((a) => String(a.id))])).rows;
  const of = (a) => received.filter((r) => r.aid === String(a.id));
  assert.deepEqual([of(fx.A).length, of(fx.A).filter((r) => r.is_bot).length, of(fx.B).filter((r) => r.is_bot).length], [103, 100, 0], "봇 표시는 서버가 User-Agent로");
  assert.equal(new Set(of(fx.R).map((r) => r.visitor_id)).size, 1, "같은 방문자 3번");
  // 끝난 시간대로 옮긴다 — 배치는 끝난 시간대만 센다(지금 시간대는 끝난 뒤 다음 실행이 — 설계 8.2). 번호는 새것이라 다음 집계가 그 시간대를 센다
  await db.query("update public.analytics_events set occurred_at = occurred_at - interval '2 hours' where id = any($1::bigint[])", [received.map((r) => r.id)]);

  // 시각을 정한 자료 (기준 시간대 H0에서) — 정시를 넘으면 지우고 다시
  const repeat = crypto.randomUUID();
  const seedAt = async (h0) => {
    const ids = await seedEvents([
      ...[0, 10, 29].map((min) => ({ article: fx.R.id, at: h0 - 3 * HOUR + min * 60_000, visitor: repeat })), // 같은 방문자 0·10·29분 → 1회
      ...humans(fx.D168, 2, h0 - 168 * HOUR + 10 * 60_000),
      ...humans(fx.D169, 9, h0 - 169 * HOUR + 10 * 60_000),
      ...Array.from({ length: 50 }, (_, i) => ({ article: fx.staffOnly.id, at: h0 - 3 * HOUR + i * 1000, staff: true })),
      ...humans(fx.coA, 30, h0 - 2 * HOUR),
      ...humans(fx.gone, 4, h0 - 2 * HOUR),
      ...Array.from({ length: 8 }, (_, i) => ({ article: fx[`f${i + 1}`].id, at: h0 - 4 * HOUR + i * 1000 })),
      // 상담 사례 — 조회·공유·30초 열람 (씨앗 가중치 1·5·2: wShare 22 > wView 20 > g2 12 > sc1 10 > g1 8 > g3 7 > sc2 6 > g4 3 = g5 3 > sc3 1)
      ...humans(fx.wView, 20, h0 - 5 * HOUR),
      ...humans(fx.wShare, 2, h0 - 5 * HOUR),
      ...humans(fx.wShare, 4, h0 - 5 * HOUR + 60_000, "article_shared"),
      ...humans(fx.g2, 2, h0 - 6 * HOUR),
      ...humans(fx.g2, 2, h0 - 6 * HOUR + 60_000, "article_shared"),
      ...humans(fx.sc1, 10, h0 - 7 * HOUR),
      ...humans(fx.g1, 8, h0 - 8 * HOUR),
      ...humans(fx.g3, 7, h0 - 9 * HOUR),
      ...humans(fx.sc2, 6, h0 - 10 * HOUR),
      ...humans(fx.g4, 3, h0 - 11 * HOUR),
      ...humans(fx.g5, 1, h0 - 12 * HOUR),
      ...humans(fx.g5, 1, h0 - 12 * HOUR + 60_000, "article_engaged"),
      ...humans(fx.sc3, 1, h0 - 13 * HOUR),
    ]);
    // 169시간 전 시간대는 그때 집계됐던 행으로 둔다 — 순위 창(168시간) 밖이라 9회여도 순위에 들지 않아야 한다
    await db.query("insert into public.article_stats (article_id, hour, views_all, views_human) values ($1, $2, 9, 9)", [fx.D169.id, iso(h0 - 169 * HOUR)]);
    return ids;
  };
  let detail;
  for (let attempt = 1; ; attempt++) {
    H0 = Math.floor(Date.now() / HOUR) * HOUR;
    const ids = await seedAt(H0);
    detail = await runJob("popular-hourly");
    if (detail.windowEnd === iso(H0)) break;
    assert.ok(attempt < 2, "정시 경계를 두 번 넘었다");
    // 자료를 넣는 사이 정시를 넘었다(드묾) — 시각을 정한 자료와 이 시험의 집계를 지우고 새 기준 시간대로 다시
    await db.query("delete from public.analytics_events where id = any($1::bigint[])", [ids]);
    await db.query("delete from public.article_stats where article_id = any($1::bigint[])", [[...staff.articleIds]]);
    await db.query("delete from public.agent_runs where job = 'popular-hourly' and started_at >= $1", [staff.startedAt]);
  }
  assert.equal(detail.popular.settings, (await one("select value from public.settings where key = 'popular_rules'")).value.version, "쓴 순위 설정 버전이 실행 기록에");

  // 시간 단위 집계 — 전체 = 봇·편집국 포함, 사람 = 제외·30분 안 반복 1회
  assert.deepEqual([(await statSums(fx.A)).all, (await statSums(fx.A)).human], [103, 3], "A — 전체 103(봇 포함), 사람 3(봇 0회)");
  assert.deepEqual([(await statSums(fx.B)).all, (await statSums(fx.B)).human], [5, 5]);
  assert.deepEqual([(await statSums(fx.R)).all, (await statSums(fx.R)).human], [6, 2], "R — 수집 API로 3번 + 0·10·29분 3번 = 두 방문자 각 1회");
  assert.deepEqual([(await statSums(fx.staffOnly)).all, (await statSums(fx.staffOnly)).human], [50, 0], "편집국 조회는 사람 0");

  const popular = await ranking("popular");
  const at = (a) => popular.find((r) => r.id === a.id);
  assert.ok(at(fx.B).rank < at(fx.A).rank, "사람 5회 B가 봇 100 + 사람 3 A보다 위");
  assert.deepEqual([at(fx.B).score, at(fx.A).score, at(fx.R).score], [5, 3, 2], "점수 = 사람 조회 (봇 0회 · 반복 1회)");
  assert.equal(at(fx.D168)?.score, 2, "168시간 전 시간대 포함");
  for (const [a, why] of [
    [fx.D169, "169시간 전 시간대 제외 (9회여도)"],
    [fx.staffOnly, "편집국 세션 조회는 순위에 들지 않는다"],
    [fx.coA, "광고·협찬(sponsored)은 순위에서 뺀다 — 사람 30회여도"],
  ]) assert.equal(at(a), undefined, why);
  assert.deepEqual((await db.query("select hour from public.article_stats where article_id = $1", [fx.D169.id])).rows.map((r) => r.hour.toISOString()), [iso(H0 - 169 * HOUR)], "169시간 전 행은 그대로 — 창이 뺀다");
  // 화면 — /news/popular도 B가 A 위
  const pop = await openSite("/news/popular");
  const ids = await popularIds(pop.page);
  assert.ok(ids.indexOf(fx.B.id) >= 0 && ids.indexOf(fx.B.id) < ids.indexOf(fx.A.id), JSON.stringify(ids));
  await pop.context.close();
  // 원본·집계는 anon 키로 읽을 수 없다
  for (const p of ["article_stats?select=article_id", "analytics_events?select=id", "article_rankings?select=score"]) {
    const r = await fetch(`${sb.url}/rest/v1/${p}`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
    assert.ok(r.status === 401 || r.status === 403, `${p}: ${r.status}`);
  }
});

test("7b) ART-11 화면 — /news/popular 20건 + 집계 시각, 기사 사이드바 5건(지금 기사 제외·1280px 오른쪽·360px 본문 뒤), 누르면 popular_article_clicked 1건, 비공개로 바뀐 기사는 바로 빠지고 다음 집계는 순위 표에서도 뺀다", async () => {
  const pop = await openSite("/news/popular");
  assert.equal((await popularIds(pop.page)).length, 20, "목록 20 (popular_rules.list_size)");
  assert.match(await pop.page.locator('[data-part="computed-at"]').textContent(), /^최근 7일 기준 · 집계 \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(한국 시간\)$/);
  assert.ok((await popularIds(pop.page)).includes(fx.gone.id));
  const since = new Date();
  const second = pop.page.locator('[data-ui="popular-articles"] a[data-rank="2"]');
  const target = idOfHref(await second.getAttribute("href"));
  const targetHref = await second.getAttribute("href");
  await Promise.all([pop.page.waitForResponse((r) => r.url().endsWith("/api/events") && r.request().postData()?.includes("popular_article_clicked")), second.click()]);
  await pop.page.waitForURL(`${base}${targetHref}`);
  await pop.page.locator('[data-ui="article-page"]').waitFor();
  await pop.idle();
  await pop.context.close();
  const clicks = (await db.query("select section, props from public.analytics_events where occurred_at >= $1 and name = 'popular_article_clicked'", [since])).rows;
  assert.deepEqual(clicks.map((r) => r.props), [{ article_id: target, rank: 2, position: "list" }]);

  for (const [viewport, place] of [
    [DESKTOP, "right"],
    [MOBILE, "below"],
  ]) {
    const a = await openSite(fx.wView.href, { viewport });
    const side = await popularIds(a.page, '[data-part="popular-sidebar"]');
    assert.equal(side.length, 5, "사이드바 5 (popular_rules.sidebar_size)");
    assert.ok(!side.includes(fx.wView.id), "지금 보는 기사(1위)는 뺀다");
    const bodyBox = await a.page.locator('[data-part="article-body"]').first().boundingBox();
    const sideBox = await a.page.locator('[data-part="popular-sidebar"]').first().boundingBox();
    if (place === "right") assert.ok(sideBox.x >= bodyBox.x + bodyBox.width, "1280px — 본문 오른쪽 열");
    else assert.ok(sideBox.y >= bodyBox.y + bodyBox.height, "360px — 본문 뒤");
    await a.context.close();
  }

  await expectStatus(api("POST", `/articles/${fx.gone.id}/corrections`, u.editor, { kind: "deletion", reason: "권리 문제로 내림" }), 201, "삭제");
  const after = await openSite("/news/popular");
  const ids = await popularIds(after.page);
  assert.ok(!ids.includes(fx.gone.id), "삭제된 기사 0 — 다음 집계 전에도");
  assert.equal(ids.length, 20, "20건은 그대로 채운다");
  await after.context.close();
  await runJob("popular-hourly");
  assert.equal(await countOf("select count(*)::int n from public.article_rankings where article_id = $1", [fx.gone.id]), 0, "다음 집계는 순위 표에서도 뺀다");
});

const EXPECT_DEFAULT = () => ({ cards: [fx.sc1.id, fx.sc2.id, fx.sc3.id], list: [fx.pin.id, fx.wShare.id, fx.wView.id, fx.g2.id, fx.g1.id] });
async function readHot(p = "/tax") {
  const { page, context } = await openSite(p);
  const v = await hotView(page);
  await context.close();
  return v;
}

test("8) HOME-05 — HOT 고정은 상담 사례 2건까지(3번째 409·다른 분야 422) → 집계: 카드 3 + HOT 5(고정 맨 앞·배지·겹침 0, 지방세 허브·상담 사례 목록) · 가중치를 설정 API로 바꾸면 다음 집계부터 순서가 바뀐다(바꾼 직후는 그대로)", async () => {
  const until = iso(Date.now() + 7 * DAY);
  await expectStatus(api("POST", `/articles/${fx.pin.id}/placement`, u.editor, { hotPinUntil: until }), 200, "고정 1");
  await expectStatus(api("POST", `/articles/${fx.g4.id}/placement`, u.editor, { hotPinUntil: until }), 200, "고정 2");
  const third = await api("POST", `/articles/${fx.g3.id}/placement`, u.editor, { hotPinUntil: until });
  assert.equal(third.status, 409, show(third));
  assert.match(third.body.error, /최대 2건/);
  assert.equal((await api("POST", `/articles/${fx.B.id}/placement`, u.editor, { hotPinUntil: until })).status, 422, "상담 사례가 아닌 기사");
  await expectStatus(api("POST", `/articles/${fx.g4.id}/placement`, u.editor, { hotPinUntil: null }), 200, "고정 풀기");
  assert.equal((await one("select hot_pin_until from public.articles where id = $1", [fx.g3.id])).hot_pin_until, null, "막힌 고정은 저장 0");

  await runJob("popular-hourly");
  for (const p of ["/tax", "/tax/interpretations"]) {
    const v = await readHot(p);
    assert.deepEqual({ cards: v.cards, list: v.list.map((x) => x.id) }, EXPECT_DEFAULT(), p);
    assert.deepEqual(v.list.map((x) => [x.hot, x.badge, x.pinned]), [[true, 1, true], [true, 1, false], [true, 1, false], [true, 1, false], [true, 1, false]], `${p}: HOT 배지 · 고정 맨 앞`);
    assert.equal(new Set([...v.cards, ...v.list.map((x) => x.id)]).size, 8, `${p}: 카드와 목록에 같은 기사 0`);
  }
  const score = async (a) => (await ranking("hot")).find((r) => r.id === a.id)?.score;
  assert.deepEqual([await score(fx.wShare), await score(fx.wView), await score(fx.g2)], [22, 20, 12], "점수 = 조회×1 + 공유×5 + 30초 열람×2 (설정 hot_weights)");

  const current = (await one("select value from public.settings where key = 'hot_weights'")).value;
  const changed = { ...current, version: `${current.version}-w2c`, share: 1 };
  await expectStatus(api("PATCH", "/settings/hot_weights", u.admin, { value: changed }), 200, "가중치 고치기 (관리자 설정 API)");
  const unchanged = await readHot();
  assert.deepEqual({ cards: unchanged.cards, list: unchanged.list.map((x) => x.id) }, EXPECT_DEFAULT(), "바꾼 직후·집계 전 — 그대로 (코드 상수 0, 배치가 매긴다)");
  const detail = await runJob("popular-hourly");
  assert.equal(detail.hot.settings, changed.version, "다음 집계가 바꾼 가중치 버전을 쓴다");
  // 공유 5 → 1: wShare 2+4=6, g2 2+2=4 → 고정 → wView 20 → (sc1 10 카드) → g1 8 → g3 7 → (sc2 6 카드) → wShare 6
  const v = await readHot();
  assert.deepEqual({ cards: v.cards, list: v.list.map((x) => x.id) }, { cards: [fx.sc1.id, fx.sc2.id, fx.sc3.id], list: [fx.pin.id, fx.wView.id, fx.g1.id, fx.g3.id, fx.wShare.id] });
  assert.equal(await score(fx.wShare), 6);
  // HOT 배지는 이 블록에만 — 많이 본 기사·홈에는 0
  assert.ok(!(await fetch(`${base}/news/popular`).then((r) => r.text())).includes('data-ui="hot-badge"'));
  assert.ok(!(await fetch(`${base}/`).then((r) => r.text())).includes('data-part="hot-block"'));
});

// ── 9) GROW-01 ───────────────────────────────────────────

test("9) GROW-01 실제 브라우저·가짜 시계 — 지방세 허브 → 기사 29초는 유효 방문 0, 새 브라우저 홈 → 4대 분야 카드 → 허브 → 기사 30초 → 다음 행동은 유효 방문 1·깔때기 세 칸 +1(첫 방문·같은 세션), 편집자 로그인·자동화 브라우저(봇)는 같은 길을 걸어도 대시보드 0", async () => {
  const admin = await loginPage(u.admin);
  const n0 = await todayNumbers(admin);

  // 새 브라우저 A — 허브 → 기사 29초 → 닫음
  const A = await trackingContext();
  await A.page.goto(`${base}/tax`, { waitUntil: "networkidle" });
  await A.settled(1);
  await openArticleWithClock(A, fx.mArticle.href, 1);
  await A.page.clock.fastForward(29_000);
  await sleep(700);
  assert.deepEqual(A.sent, ["hub_viewed", "article_viewed"], "29초 — 30초 열람 이벤트 0");
  await A.idle();
  await A.context.close();
  const n1 = await todayNumbers(admin);
  assert.deepEqual(n1.tax, [n0.tax[0] + 1, n0.tax[1]], `29초 — 허브 방문 세션 +1, 유효 방문 +0 (${n0.tax} → ${n1.tax})`);
  assert.deepEqual(n1.funnel, [n0.funnel[0] + 1, n0.funnel[1], n0.funnel[2]], "첫 방문 +1, 카드·검색 0");

  // 새 브라우저 B — 홈 → 4대 분야 카드 → 허브 → 기사 29초(0) → 30초(1) → 다음 행동
  const B = await trackingContext();
  await B.page.goto(`${base}/`, { waitUntil: "networkidle" });
  await B.page.locator('[data-ui="field-cards"] a[href="/tax"]').click();
  await B.page.locator('[data-ui="hub"][data-hub="tax"]').waitFor();
  await B.settled(2);
  await openArticleWithClock(B, fx.mArticle.href, 2);
  await B.page.clock.fastForward(29_000);
  await sleep(700);
  assert.ok(!B.sent.includes("article_engaged"), `29초 — 0 (${B.sent})`);
  await B.page.clock.fastForward(1_000);
  await B.settled(4);
  assert.equal(B.sent.at(-1), "article_engaged", "30초 — 1건");
  await B.page.clock.resume();
  await B.page.locator('[data-ui="next-action-band"] [data-next-action] a').first().click();
  await B.settled(5);
  assert.deepEqual(B.sent.slice(0, 5), ["home_entry_clicked", "hub_viewed", "article_viewed", "article_engaged", "next_action_clicked"]);
  assert.ok(B.answered.every((s) => s === 202), `모두 저장: ${B.answered}`);
  const vid = (await B.context.cookies()).find((c) => c.name === "ltr_vid");
  assert.ok(vid?.httpOnly, "새 브라우저 — 방문자 ID 쿠키(스크립트가 못 읽음)");
  const rows = (await db.query("select name, first_visit, is_bot, is_staff, session_id from public.analytics_events where visitor_id = $1 order by id", [vid.value])).rows;
  assert.ok(rows.length >= 5 && rows.every((r) => r.first_visit && !r.is_bot && !r.is_staff), "첫 방문 · 사람");
  assert.equal(new Set(rows.map((r) => r.session_id)).size, 1, "한 세션");
  // 다음 행동 [같은 분야 더 보기] → 지방세 허브 화면 전환이 끝날 때까지
  await B.page.waitForURL(`${base}/tax`);
  await B.page.locator('[data-ui="hub"][data-hub="tax"]').waitFor();
  await B.settled(6);
  await B.idle();
  await B.context.close();
  const n2 = await todayNumbers(admin);
  assert.deepEqual(n2.funnel, n1.funnel.map((n) => n + 1), `깔때기 세 칸 +1: ${n1.funnel} → ${n2.funnel}`);
  assert.deepEqual(n2.tax, [n1.tax[0] + 1, n1.tax[1] + 1], "30초 — 허브 방문 세션 +1, 유효 방문 +1");
  assert.equal(n2.solved, n1.solved + 1, "첫 방문 문제해결 +1");

  // 편집자 로그인 · 자동화 브라우저 — 30초 넘게 읽어도 대시보드에서 빠진다 (이벤트는 표시를 달고 저장)
  for (const [who, options, flag] of [
    ["편집자", { loginAs: u.editor }, "is_staff"],
    ["봇", { userAgent: HEADLESS_UA }, "is_bot"],
  ]) {
    const t = await trackingContext(options);
    const since = new Date();
    await t.page.goto(`${base}/tax`, { waitUntil: "networkidle" });
    await t.settled(1);
    await openArticleWithClock(t, fx.mArticle.href, 1);
    await t.page.clock.fastForward(31_000);
    await t.settled(3);
    assert.equal(t.sent.at(-1), "article_engaged", `${who}: 30초 열람 이벤트는 보낸다`);
    const flags = (await db.query(`select ${flag} f from public.analytics_events where occurred_at >= $1 and name in ('hub_viewed', 'article_viewed', 'article_engaged')`, [since])).rows;
    assert.ok(flags.length === 3 && flags.every((r) => r.f === true), `${who}: ${flag}=true로 저장 ${JSON.stringify(flags)}`);
    await t.idle();
    await t.context.close();
  }
  assert.deepEqual(await todayNumbers(admin), n2, "편집자·봇 세션은 대시보드 0");
});

test("9b) GROW-01 측정 거부·GPC — 측정 거부 화면에서 거부하거나 브라우저 GPC 신호가 있으면 홈 → 카드 → 허브 → 기사를 다녀도 /api/events 요청 0·저장 0·방문자 ID 0, 서버도 거부 쿠키·Sec-GPC는 204·저장 0", async () => {
  const R = await trackingContext();
  await R.page.goto(`${base}/about/measurement`, { waitUntil: "networkidle" });
  assert.equal(await R.page.locator('[data-ui="measurement-page"]').getAttribute("data-state"), "measuring");
  await R.page.getByRole("button", { name: "측정 거부하기" }).click();
  await R.page.waitForURL(`${base}/about/measurement?done=refuse`);
  assert.equal(await R.page.locator('[data-ui="measurement-page"]').getAttribute("data-state"), "refused");
  const sentBefore = R.sent.length;
  const since = new Date();
  const G = await trackingContext({ extraHTTPHeaders: { "Sec-GPC": "1" } });
  await G.context.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  for (const t of [R, G]) {
    await t.page.goto(`${base}/`, { waitUntil: "networkidle" });
    await t.page.locator('[data-ui="field-cards"] a[href="/tax"]').click();
    await t.page.locator('[data-ui="hub"][data-hub="tax"]').waitFor();
    await t.idle();
    await t.page.goto(`${base}${fx.mArticle.href}`, { waitUntil: "networkidle" });
    await t.page.waitForTimeout(500);
  }
  assert.equal(R.sent.length - sentBefore, 0, "측정 거부 뒤 전송 0");
  assert.equal(G.sent.length, 0, "GPC — 전송 0");
  assert.ok(!(await R.context.cookies()).some((c) => c.name === "ltr_vid") && !(await G.context.cookies()).some((c) => c.name === "ltr_vid"), "방문자 ID 0");
  assert.match(await (await G.page.goto(`${base}/about/measurement`)).text(), /data-state="gpc"/);
  // 서버 이중 방어
  assert.equal((await sendEvent(viewEvent(fx.mArticle), { cookie: "ltr_optout=1" })).status, 204);
  assert.equal((await sendEvent(viewEvent(fx.mArticle), { headers: { "sec-gpc": "1" } })).status, 204);
  assert.equal(await countOf("select count(*)::int n from public.analytics_events where occurred_at >= $1", [since]), 0, "저장 0");
  for (const t of [R, G]) {
    await t.idle();
    await t.context.close();
  }
});

test("9c) GROW-01 /admin/metrics = 지난 주 자료 손 계산 — 유효 방문(29초 0·31초 1·다른 분야 0) · 재방문(30일째 포함·31일째 제외·방문자 ID 없는 세션 분모 0) · 깔때기 · 봇·편집국 0 · 지표마다 정의·분모·분자·소유 ID / 전환일 → 시험 기간·운영 따로 / 다른 문서 지표 '수집 전'", async () => {
  const page = await loginPage(u.admin);
  const week = `/admin/metrics?period=custom&from=${fx.D1}&to=${addDays(fx.D1, 6)}`;
  assert.equal((await adminOpen(page, week)).status(), 200);
  assert.deepEqual(await page.locator("[data-segment]").evaluateAll((els) => els.map((e) => e.getAttribute("data-segment"))), ["trial"], "전환일 없음 — 모두 시험 기간");
  const exclusions = (segment) => Promise.all(["sessions", "bot", "staff"].map((n) => text(page, `[data-segment="${segment}"] [data-part="exclusions"] [data-cell="${n}"]`)));
  assert.deepEqual(await exclusions("trial"), ["6", "1", "1"], "시작한 세션 6 — 봇 1·편집국 1 (끝날 다음 날 0시 세션은 기간 밖)");
  assert.deepEqual(await metricTable(page, "trial", "valid-visits", ["tax", "realestate", "finance", "local", "total"], ["denominator", "numerator", "rate"]), {
    tax: ["2", "1", "50%"],
    realestate: ["0", "0", "—"],
    finance: ["1", "0", "0%"],
    local: ["1", "0", "0%"],
    total: ["4", "1", "25%"],
  });
  assert.deepEqual(await metricTable(page, "trial", "revisits", ["tax", "finance", "local", "total"], ["visitors", "revisited", "rate", "pending"]), {
    tax: ["2", "1", "50%", "0"],
    finance: ["1", "1", "100%", "0"],
    local: ["0", "0", "—", "0"],
    total: ["3", "2", "66.7%", "0"],
  });
  assert.equal(await text(page, '[data-segment="trial"] [data-cell="without-visitor"]'), "1", "방문자 ID 없는 세션은 분모 밖에 따로");
  assert.deepEqual(await metricTable(page, "trial", "funnel", ["1", "2", "3"], ["count"]), { 1: ["1"], 2: ["1"], 3: ["1"] });
  const defs = await page.locator('[data-segment="trial"] [data-part="definition"]').allInnerTexts();
  assert.equal(defs.length, 4);
  for (const d of defs) for (const word of ["분모", "분자", "제외", "소유", "GROW-01", "봇·편집국·관리자"]) assert.ok(d.includes(word), `정의에 '${word}'`);
  const other = await page.locator('[data-metric="other"] [data-row]').evaluateAll((els) => els.map((e) => e.querySelector('[data-cell="status"]').textContent.trim()));
  assert.ok(other.length >= 6 && other.every((s) => s === "수집 전" || s === "2단계부터"), `다른 문서 지표: ${other}`);
  assert.equal(await page.locator('[data-metric="other"] [data-cell]:not([data-cell="status"])').count(), 0, "추정 숫자 0");

  const cutover = addDays(fx.D1, 2);
  await expectStatus(api("PATCH", "/settings/domain_cutover", u.admin, { value: { version: "w2c-acceptance-2", date: cutover } }), 200, "전환일 적기");
  await adminOpen(page, week);
  assert.deepEqual(await page.locator("[data-segment]").evaluateAll((els) => els.map((e) => e.getAttribute("data-segment"))), ["trial", "live"]);
  assert.deepEqual([await exclusions("trial"), await exclusions("live")], [["5", "1", "1"], ["1", "0", "0"]], "전환일 앞날까지 시험 기간 · 그날부터 운영");
  assert.deepEqual(await metricTable(page, "live", "revisits", ["finance"], ["visitors", "revisited"]), { finance: ["1", "1"] });
  await expectStatus(api("PATCH", "/settings/domain_cutover", u.admin, { value: { version: "w2c-acceptance-3", date: null } }), 200, "전환일 비우기");
});

// ── 10) NAV-13·14 ────────────────────────────────────────

test("10) NAV-13·14 규정 표가 비면 — 대시보드 두 플랫폼 `요건 미확정`(카카오 '검토 전')·공식 숫자·충족·미달 0, 기사 기획 캘린더의 기사 할당량도 `요건 미확정`(입력 칸 0) · 내부 정의 숫자 = 손 계산(시작일 0시 포함·하루 전 제외)", async () => {
  const page = await loginPage(u.editor);
  assert.equal((await adminOpen(page, "/admin/news-readiness")).status(), 200);
  for (const p of ["naver", "kakao"]) {
    assert.equal(await page.locator(`[data-platform="${p}"]`).getAttribute("data-state"), "none", p);
    assert.equal(await text(page, `[data-platform="${p}"] [data-part="undetermined"] [data-cell="status"]`), "요건 미확정", p);
  }
  assert.match(await text(page, '[data-platform="kakao"] [data-part="undetermined"]'), /검토 전/);
  assert.equal(await page.locator('[data-part="official"], [data-metric="official"], [data-part="capacity-guidance"]').count(), 0, "공식 숫자·기준 비교 0");
  const body = await page.locator("main").innerText();
  for (const w of ["충족", "미달", "규정 기준", ...BANNED]) assert.ok(!body.includes(w), `요건 미확정인데 '${w}'`);
  // 내부 정의 — 기간 [완결된 n개월 첫날 0시, 이번 달 1일 0시)
  for (const [n, cell] of [
    [3, "w3"],
    [6, "w6"],
  ]) {
    const e = await production(n);
    assert.equal(await text(page, `[data-section="internal"] [data-metric="production"] [data-row="total"] [data-cell="${cell}"]`), String(e.total), `${n}개월 총 발행`);
    assert.equal(await text(page, `[data-section="internal"] [data-metric="production"] [data-row="own"] [data-cell="${cell}"]`), ratioText(e.own, e.total), `${n}개월 자체 취재 후보`);
  }
  // 경계 — 3개월 자체 취재 후보 추적은 시작일 0시 기사 하나, 6개월은 하루 전 기사까지
  const traced = async (q) => {
    await adminOpen(page, `/admin/news-readiness${q}`);
    return page.locator('[data-metric="trace"] tbody tr').evaluateAll((rs) => rs.map((r) => Number(r.getAttribute("data-row"))));
  };
  assert.deepEqual(await traced(""), [fx.rStart.id], "3개월 — 시작일 0시 포함 · 하루 전 제외");
  assert.deepEqual(await traced("?window=6"), [fx.rStart.id, fx.rBefore.id], "6개월 — 하루 전 기사 포함");
  const defs = await page.locator('[data-section="internal"] [data-part="definition"]').allInnerTexts();
  for (const d of defs) for (const word of ["분자", "분모", "제외"]) assert.ok(d.includes(word), `지표마다 '${word}' 글자`);
  for (const user of [u.editor, u.reporter]) {
    const p = user === u.editor ? page : await loginPage(user);
    await adminOpen(p, "/admin/stories");
    for (const platform of ["naver", "kakao"]) {
      assert.equal(await p.locator(`[data-part="quota"] [data-platform="${platform}"]`).getAttribute("data-confirmed"), "false");
      assert.match(await text(p, `[data-part="quota"] [data-platform="${platform}"]`), /요건 미확정/);
    }
    assert.equal(await p.locator('[data-part="quota"] input, [data-part="quota"] textarea').count(), 0, "임의 할당량 입력 0");
  }
});

test("10b) NAV-13 규정 버전 — 원문·확인일·등록 유형이 없는 버전은 확정 422(API)·DB도 거부, 담당자 확인 표시 없이 422 → 확정 → 공식 정의(규정 글자·심사 기간)와 내부 정의를 따로, 미달이면 인력 보강·신청 연기 안내 / 확정 버전은 API 409·DB 트리거로 그대로, 새 버전을 확정해도 앞 버전이 남는다", async () => {
  const bare = await expectStatus(api("POST", "/news-readiness/requirements", u.editor, { platform: "kakao", title: "카카오 검토 메모" }), 201, "작성 중 버전");
  const bareId = bare.body.requirement.id;
  const bareConfirm = await api("POST", `/news-readiness/requirements/${bareId}/confirm`, u.editor, { attested: true });
  assert.equal(bareConfirm.status, 422, show(bareConfirm));
  assert.deepEqual(bareConfirm.body.errors.map((e) => e.split(":")[0]), ["requirement.sourceUrl", "requirement.checkedAt", "requirement.mediaType", "requirement.effectiveFrom", "requirement.reviewPeriod", "requirement.items"]);
  await assert.rejects(db.query("update public.news_partner_requirements set status = 'confirmed', approved_by = 'user:e2e', approved_at = now() where id = $1", [bareId]), (e) => e.code === "23514", "DB도 확정 조건을 막는다");

  const today = kstToday();
  const w3 = closedMonths(3);
  const v1 = await expectStatus(
    api("POST", "/news-readiness/requirements", u.editor, {
      platform: "naver",
      title: `시험 뉴스 검색 제휴 규정 ${staff.run}`,
      mediaType: "인터넷신문",
      sourceUrl: "https://example.test/naver/news-partner-rules",
      sourceTextRef: "공유 드라이브 제휴/규정 원문 제3조",
      checkedAt: today,
      effectiveFrom: closedMonths(12).from,
      reviewPeriod: { months: 3, basis: "closed_months", text: "최근 3개월 (수용 시험 문구)" },
      items: [OWN_RATIO(60)],
    }),
    201,
    "네이버 1번",
  );
  const v1Id = v1.body.requirement.id;
  const noAttest = await api("POST", `/news-readiness/requirements/${v1Id}/confirm`, u.editor, {});
  assert.deepEqual([noAttest.status, noAttest.body.errors], [422, ["requirement.attested: 공식 규정 원문과 우리 매체의 실제 등록 유형을 확인했다는 표시가 필요합니다"]]);
  await expectStatus(api("POST", `/news-readiness/requirements/${v1Id}/confirm`, u.editor, { attested: true }), 200, "확정 (담당자 승인)");
  const row = await one("select status, approved_by, approved_at from public.news_partner_requirements where id = $1", [v1Id]);
  assert.deepEqual([row.status, row.approved_by, Boolean(row.approved_at)], ["confirmed", `user:${u.editor.id}`, true]);

  const e3 = await production(3);
  const e6 = await production(6);
  const outcome = (value) => (pct1(e3.own, e3.total) >= value ? "충족" : "미달");
  const page = await loginPage(u.editor);
  const officialCell = (key, cell) => text(page, `[data-platform="naver"] [data-metric="official"] [data-row="${key}"] [data-cell="${cell}"]`);
  const expectOfficial = async (version, value) => {
    await adminOpen(page, "/admin/news-readiness");
    assert.equal(await page.locator('[data-platform="naver"]').getAttribute("data-state"), "confirmed");
    assert.equal(await text(page, '[data-platform="naver"] [data-cell="version"]'), `${version}번`);
    assert.equal(await text(page, '[data-platform="naver"] [data-cell="media-type"]'), "인터넷신문");
    assert.equal(await officialCell("own_ratio", "w3"), ratioText(e3.own, e3.total));
    assert.equal(await officialCell("own_ratio", "w6"), ratioText(e6.own, e6.total));
    assert.equal(await officialCell("own_ratio", "review"), ratioText(e3.own, e3.total), "심사 기간 = 규정 버전의 완결된 3개월");
    assert.equal(await officialCell("own_ratio", "criterion"), `${value}% 이상`);
    assert.equal(await officialCell("own_ratio", "result"), `${outcome(value)} (${pct1(e3.own, e3.total)}%)`);
    assert.equal(await page.locator('[data-platform="naver"] [data-part="capacity-guidance"]').count(), outcome(value) === "미달" ? 1 : 0, "미달이면 인력 보강·신청 연기 안내");
    if (outcome(value) === "미달") assert.match(await text(page, '[data-platform="naver"] [data-part="capacity-guidance"]'), /인력.*보강.*신청을 미루.*비슷한 기사/);
    // 공식 정의는 규정 버전 글자, 내부 정의는 따로 (분모·제외 조건이 다르다)
    const official = await page.locator('[data-platform="naver"] [data-part="definition"]').allInnerTexts();
    for (const w of ["규정이 정한 자체 취재 보도기사 (수용 시험 문구)", "규정이 정한 전체 송고 기사 (수용 시험 문구)", "규정이 정한 제외 기사 (수용 시험 문구)"]) assert.ok(official.join().includes(w), w);
    assert.equal(await text(page, '[data-section="internal"] [data-metric="production"] [data-row="own"] [data-cell="w3"]'), ratioText(e3.own, e3.total), "내부 정의 숫자는 그대로 따로");
    const internalDefs = (await page.locator('#internal-production [data-part="definition"]').allInnerTexts()).join();
    assert.ok(internalDefs.includes("보도(reported_news)") && !internalDefs.includes("수용 시험 문구"), "내부 정의 글자는 규정 글자와 다르다");
    assert.equal(await page.locator('[data-platform="kakao"]').getAttribute("data-state"), "unconfirmed", "작성 중 카카오 버전만 — 요건 미확정");
    const body = await page.locator("main").innerText();
    for (const w of BANNED) assert.ok(!body.includes(w), `'${w}' 0`);
  };
  await expectOfficial(1, 60);
  await adminOpen(page, "/admin/stories");
  assert.equal(await text(page, '[data-part="quota"] [data-platform="naver"]'), "네이버 규정 1번 — 기사 수 기준이 없습니다", "기사 할당량 — 확정 버전에서 (비율 요건뿐)");
  assert.match(await text(page, '[data-part="quota"] [data-platform="kakao"]'), /요건 미확정/);

  // 확정 버전은 그대로 — API 409, DB 트리거(직접 SQL 고치기·지우기 거부)
  const frozen = await one("select title, requirements, updated_at from public.news_partner_requirements where id = $1", [v1Id]);
  const edit = await api("PATCH", `/news-readiness/requirements/${v1Id}`, u.editor, { title: "확정 뒤 고친 제목" });
  assert.equal(edit.status, 409, show(edit));
  await assert.rejects(db.query("update public.news_partner_requirements set title = 'SQL로 고친 제목' where id = $1", [v1Id]), "DB 트리거 — 고치기 거부");
  await assert.rejects(db.query("delete from public.news_partner_requirements where id = $1", [v1Id]), "DB 트리거 — 지우기 거부");
  assert.deepEqual(await one("select title, requirements, updated_at from public.news_partner_requirements where id = $1", [v1Id]), frozen, "확정 버전 그대로");

  // 새 버전(이어받기) → 확정 — 두 버전 모두 확정으로 남고, 대시보드는 새 버전
  const v2 = await expectStatus(
    api("POST", "/news-readiness/requirements", u.editor, {
      platform: "naver",
      supersedesId: v1Id,
      title: `시험 규정 개정판 ${staff.run}`,
      mediaType: "인터넷신문",
      sourceUrl: "https://example.test/naver/news-partner-rules",
      checkedAt: today,
      effectiveFrom: w3.from,
      reviewPeriod: { months: 3, basis: "closed_months", text: "최근 3개월 (수용 시험 문구)" },
      items: [OWN_RATIO(50)],
    }),
    201,
    "네이버 2번",
  );
  await expectStatus(api("POST", `/news-readiness/requirements/${v2.body.requirement.id}/confirm`, u.admin, { attested: true }), 200, "2번 확정 (관리자)");
  const list = await expectStatus(api("GET", "/news-readiness/requirements", u.editor), 200, "목록");
  assert.deepEqual(list.body.requirements.filter((r) => r.platform === "naver").map((r) => [r.version, r.status]), [[1, "confirmed"], [2, "confirmed"]], "앞 버전이 남는다");
  await expectOfficial(2, 50);
});

test("10c) NAV-13 저장소 검사 — 코드·설정 기본값·마이그레이션에 심사 점수·합격선·요건 기준 숫자·규정 씨앗 0 (lib/readiness/no-criteria.test.ts를 그대로 돌린다)", async () => {
  // 비동기로 기다린다 — execFileSync로 이벤트 루프를 10초 넘게 막으면 그동안 웹 서버가 keep-alive(5초)로 닫은 소켓을 fetch 연결 풀이 알지 못해,
  // 다음 시험의 첫 요청이 그 소켓을 다시 써서 ECONNRESET으로 끝난다(재현: 7초 막으면 3번 중 2번, 비동기로 같은 시간 기다리면 0번)
  const { stdout: out } = await execFileAsync("pnpm", ["--filter", "@ltr/web", "exec", "vitest", "run", "lib/readiness/no-criteria.test.ts"], {
    cwd: ROOT,
    encoding: "utf8",
    shell,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" },
  });
  assert.match(out, /Tests\s+5 passed \(5\)/, out.slice(-800));
});

// ── 11~13) 권한 · 360px · 접근성 ────────────────────────

test("11) 권한 표 — /admin/metrics는 관리자만, /admin/news-readiness·규정 화면·규정 API는 편집 책임자·관리자만: 나머지 편집국 역할 6종은 화면 403·API 403(새 버전 거부는 감사 로그)·메뉴 0, 로그인 안 하면 로그인 화면·401", async () => {
  const roles = [
    ["reporter", u.reporter],
    ["editor", u.editor],
    ["reviewer", u.reviewer],
    ["ad_ops", u.adOps],
    ["store_ops", u.storeOps],
    ["brand_ops", u.brandOps],
    ["expert_ops", u.expertOps],
  ];
  assert.deepEqual(roles.map(([r]) => r), STAFF_ROLES, "편집국 역할 7종 모두 (lib/access.ts)");
  const ALLOWED = { "/admin/metrics": ["admin"], "/admin/news-readiness": ["editor", "admin"], "/admin/news-readiness/requirements": ["editor", "admin"] };
  const matrix = {};
  for (const [role, user] of [...roles, ["admin", u.admin]]) {
    matrix[role] = {};
    for (const [p, allowed] of Object.entries(ALLOWED)) {
      const r = await pageAs(user, p);
      matrix[role][p] = r.status;
      if (r.status === 403) assert.ok(r.html.includes("이 화면을 쓸 권한이 없습니다") && !r.html.includes('data-segment="') && !r.html.includes('data-platform="'), `${role} ${p}: 403 화면에 숫자 0`);
      assert.equal(r.status, allowed.includes(role) ? 200 : 403, `${role} ${p}`);
    }
    const menu = menuHrefs((await pageAs(user, "/admin")).html);
    assert.ok(menu.length > 0, `${role}: 메뉴를 읽었다`);
    assert.deepEqual([menu.includes("/admin/metrics"), menu.includes("/admin/news-readiness")], [role === "admin", ["editor", "admin"].includes(role)], `${role} 메뉴 ${menu}`);
    const get = await api("GET", "/news-readiness/requirements", user);
    assert.equal(get.status, ["editor", "admin"].includes(role) ? 200 : 403, `${role} 규정 API 읽기`);
    if (!["editor", "admin"].includes(role)) {
      assert.equal((await api("POST", "/news-readiness/requirements", user, { platform: "naver", title: "권한 없는 버전" })).status, 403, `${role} 새 버전`);
      assert.equal(await countOf("select count(*)::int n from public.audit_logs where actor = $1 and action = 'readiness.requirements.denied'", [`user:${user.id}`]), 1, `${role} 거부 감사 로그`);
    }
  }
  console.log(`권한 표 ${JSON.stringify(matrix)}`);
  assert.equal(await countOf("select count(*)::int n from public.news_partner_requirements where title = '권한 없는 버전'"), 0);
  for (const p of Object.keys(ALLOWED)) {
    const r = await pageAs(null, p);
    assert.ok([302, 303, 307].includes(r.status) && /\/admin\/login/.test(r.location), `로그인 안 함 ${p}: ${r.status}`);
  }
  assert.equal((await fetch(`${base}/api/admin/news-readiness/requirements`)).status, 401);
});

test("12) 360px — 새 화면 가로 스크롤 0: /admin/metrics(기간·표)·/admin/news-readiness(3·12개월)·규정 화면(폼 펼침), /news/popular·/news/video·/news/photo·/partners/[id]·/about/measurement·동영상·포토·인포그래픽 기사·사이드바 기사", async () => {
  const admin = await loginPage(u.admin, { viewport: MOBILE });
  for (const p of ["/admin/metrics?period=7", `/admin/metrics?period=custom&from=${fx.D1}&to=${addDays(fx.D1, 6)}`, "/admin/news-readiness", "/admin/news-readiness?window=12", "/admin/news-readiness/requirements"]) {
    await adminOpen(admin, p);
    if (p.endsWith("requirements")) for (const s of await admin.locator("summary").all()) await s.click();
    await admin.waitForLoadState("networkidle");
    assert.ok((await horizontalOverflow(admin)) <= 0, `${p}: 가로 스크롤 ${await horizontalOverflow(admin)}px`);
  }
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  await expectStatus(api("PATCH", "/settings/feature_flags", u.admin, { value: { ...flags, video_list: true } }), 200, "동영상 목록 켜기");
  try {
    for (const p of ["/news/popular", "/news/video", "/news/photo", `/partners/${fx.partnerA.id}`, "/about/measurement", fx.video.href, fx.photo.href, fx.infographic.href, fx.wView.href]) {
      const { page, context, status } = await openSite(p, { viewport: MOBILE });
      assert.equal(status, 200, p);
      assert.ok((await horizontalOverflow(page)) <= 0, `${p}: 가로 스크롤 ${await horizontalOverflow(page)}px`);
      await context.close();
    }
  } finally {
    await expectStatus(api("PATCH", "/settings/feature_flags", u.admin, { value: flags }), 200, "동영상 목록 끄기");
  }
});

test("13) 접근성 95점 이상 — /admin/metrics·/admin/news-readiness(관리자 로그인 상태로 잰다) · /news/video·/news/photo·/partners/[id] · 동영상·포토·인포그래픽 기사 (Lighthouse)", async () => {
  // Lighthouse는 브라우저 기본 창에서 잰다 — 관리자 로그인 쿠키를 그 창에 넣는다 (Lighthouse는 쿠키를 지우지 않는다)
  const admin = await loginPage(u.admin);
  await adminOpen(admin, "/admin/news-readiness");
  assert.equal(await admin.locator('[data-platform="naver"]').getAttribute("data-state"), "confirmed", "규정 버전이 찬 대시보드를 잰다");
  const cookies = (await admin.context().cookies()).filter((c) => c.name.startsWith("sb-"));
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send("Storage.setCookies", { cookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, ...(c.expires > 0 ? { expires: c.expires } : {}) })) });
  const results = [];
  try {
    for (const p of [`/admin/metrics?period=custom&from=${fx.D1}&to=${addDays(fx.D1, 6)}`, "/admin/news-readiness"]) {
      const r = await accessibility(`${base}${p}`, debugPort);
      assert.equal(new URL(r.finalUrl).pathname, new URL(`${base}${p}`).pathname, `${p}: 로그인 화면이 아니라 그 화면을 쟀다`);
      results.push([p, r]);
    }
  } finally {
    await cdp.send("Storage.clearCookies", {});
  }
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  await expectStatus(api("PATCH", "/settings/feature_flags", u.admin, { value: { ...flags, video_list: true } }), 200, "동영상 목록 켜기");
  try {
    for (const p of ["/news/video", "/news/photo", `/partners/${fx.partnerA.id}`, fx.video.href, fx.photo.href, fx.infographic.href]) results.push([p, await accessibility(`${base}${p}`, debugPort)]);
  } finally {
    await expectStatus(api("PATCH", "/settings/feature_flags", u.admin, { value: flags }), 200, "동영상 목록 끄기");
  }
  const low = results.filter(([, r]) => r.score < A11Y_MIN).map(([p, r]) => `${p} ${Math.round(r.score * 100)}점 (${r.failing.join(", ")})`);
  assert.deepEqual(low, []);
  // 이 시험이 찾아 고친 흠 — 동영상·포토 목록이 머리 h1에서 카드 제목 h3으로 건너뛰었다(98점, heading-order). 목록 부분 제목(h2)을 두었다
  for (const [p, r] of results.filter(([p]) => p === "/news/video" || p === "/news/photo")) assert.ok(!r.failing.includes("heading-order"), `${p}: 제목 단계 건너뜀`);
});

test("시험 동안 예상 못 한 서버 오류가 없었다", () => {
  const log = server.log();
  for (const mark of ["[api] 처리 중 오류", "[public]", "[analytics]", "[db] ", "[audit] ", "⨯"]) assert.ok(!log.includes(mark), `${mark}: ${log.slice(-3000)}`);
});

test("정리 — 만든 계정·기사·이미지·제휴사·측정 행·집계·순위·실행 기록·규정 버전·감사 로그를 지우면 표마다 시험 전 행 수, 운영 설정 값 그대로", async () => {
  for (const c of contexts) await c.close().catch(() => {});
  await removeTestRuns();
  await staff.cleanup();
  cleaned = true;
  const client = new pg.Client({ connectionString: sb.dbUrl });
  await client.connect();
  try {
    assert.deepEqual(await residue(client), before0);
  } finally {
    await client.end();
  }
});
