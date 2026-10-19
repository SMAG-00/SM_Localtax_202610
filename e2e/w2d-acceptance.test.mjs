// W2-d 수용 E2E (5단계) — PRD-01A 9장 W2-d 증거 전부를 한 시험 자료·한 서버·한 브라우저로 (docs/dev/W2-d_설계.md 1장 5단계 · 11.5)
// 9장 증거: 검색 정규화 테스트 통과, p95 ≤ 800ms — 그리고 4장 수용 기준 SRCH-01 · SRCH-02 · SRCH-03 · GLO-01 · GLO-02 (+ REG-08/REG1-11 지역 검색 · LG-10 축제는 검색 결과 목록 0 중 W2-d 범위)
// 기준 값(종류·탭 글자·정규화 견본·가림 견본·숫자+단위 견본·한도)은 설계 문서 2장 표를 읽어 쓴다. 문서와 다르면 문서가 맞다.
//  1) 자료·출발점 — 9장 증거 줄 = 이 시험이 증명하는 것
//  2) SRCH-01 "취득세"="취득 세", "재건축"="재 건축" — 2.2 정규화 견본 전체: TypeScript 규칙 · 실제 API(DB가 쓴 낱말) · 다시 찾기(띄어 쓴 낱말) · 결과 같음(API·화면) · 한도 경계
//  3) SRCH-01 "차 팔았" → "차를 팔았어요·폐차했어요" 상황(다시 찾기 → 편집국이 검색 별칭을 더하면 바로 별칭으로) · "개편안" → 「2026년 지방세제 개편안」 트래커(링크 0·현재 단계 원문·확정 아님)
//  4) SRCH-01 비공개 0 — 초안·유료·금주 핫뉴스·권리 미확인 이미지·감수 전 상황·비공개 트래커·숨긴 인물·숨긴 용어 / 결과 유형 표시 / 명소·맛집 유형 0 · 행사(01B W6 전)는 결과 목록 0 · LG-10
//  5) SRCH-01 편집국이 쓰고(API) 발행한 기사가 검색에 나오고, 삭제 정정하면 바로 빠진다(410)
//  6) REG-08/REG1-11 지역 — 지역명만 쓰면 지역이 첫 결과 · 옛 이름(별칭)으로 현재 지역 · "성동구 재개발"·"경주 취득세" · 지역 거르개
//  7) SRCH-02 탭(URL 쿼리·JS 꺼도 링크)·거르개(분야·기간·지역·기사 유형 reported_news만 → 다른 유형 0)·쪽
//  8) SRCH-02 결과 0건 — 추천 검색어 3개 · 상황 카드 · 도우미 답변·[AI 도우미에게 묻기] 0 / API 틀린 입력 400 · 500 0
//  9) SRCH-03 가림 견본(2.8) 실서버 · 같은 정규형 한 행 · 공개 이벤트·기록·화면 원문 0 · 세지 않는 검색 · 편집국 검색어 화면 → 동의어 더하기 → 공개 검색 반영
// 10) GLO-01 쉬운 풀이 60/61/121자 · 숫자+단위 견본(2.6) · 사전 화면 경고·공개하기/숨기기 · 용어 200개 가나다 색인 모두 · 4대 분야마다 1개 이상 · 용어 쪽
// 11) GLO-02 본문 풀이 — 한 기사 용어마다 한 번 · 제목·링크 안 0 · 긴 용어 먼저 · 키보드 Tab 포커스로 열림 · Esc 닫힘
// 12) p95 ≤ 800ms — 실제 /api/search·/search 경로, 기사 3,000건 규모(CI 시간 안). 2만 건 하네스는 pnpm test:search-perf (CI 밖)
// 13) 화면 규칙 R1~R3 · 360px 가로 스크롤 0 · 접근성 95 / 14) 기능 키 끄면 404·링크 0·서버 오류 0 / 15) 정리 — 표마다 시험 전 행 수
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { ROOT, buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { importSource } from "./lib/ts-source.mjs";

const ADMIN_EMAIL = "w2d-acceptance-e2e@example.test";
const SITE = "https://e2e.example.test";
const HUMAN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const RUN = Array.from(crypto.randomBytes(8), (b) => String.fromCharCode(97 + (b % 26))).join("");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const P95_LIMIT_MS = 800;
const FILL_ARTICLES = 3000;
const SLUG_PREFIX = "e2e-w2d";

// ── 기준 — 설계 문서에서 읽는다 ──────────────────────────
const MD = fs.readFileSync(path.join(ROOT, "docs", "dev", "W2-d_설계.md"), "utf8");
const PRD_01A = fs.readFileSync(path.join(ROOT, "docs", "PRD", "PRD-01A_1단계_기반_편집_유입.md"), "utf8");
function section(no) {
  const sec = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  const sub = sec.split(/^### /m).find((s) => s.startsWith(no));
  assert.ok(sub, `설계 문서 ${no} 소절이 없다`);
  return sub;
}
const ticks = (s) => [...s.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const rowsOf = (sub) => sub.split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim())).slice(1);
const listsOf = (no) => new Map(rowsOf(section(no)).map(([name, values]) => [name.split(/\s/)[0], ticks(values)]));
const V21 = listsOf("2.1");
const V24 = listsOf("2.4");
const V25 = listsOf("2.5");
const KINDS = V21.get("search.kind");
const TAB_LABELS = V24.get("screen.tab_labels");
const SUGGESTIONS = Number(V24.get("screen.suggestions")[0]);
const PLAIN_GUIDE = Number(V25.get("glossary.plain_guide")[0]);
const PLAIN_MAX = Number(V25.get("glossary.plain_max")[0]);
const INITIALS = V25.get("glossary.initials");
const GOLDEN = rowsOf(section("2.2")).map(([input, terms, split]) => ({ input: ticks(input)[0], terms: ticks(terms), split: split === "—" ? null : ticks(split) }));
const NUMBER_ROWS = rowsOf(section("2.6")).map(([plain, found]) => ({ plain: ticks(plain)[0], found: found === "—" ? null : ticks(found)[0] }));
const MASK_ROWS = rowsOf(section("2.8")).map(([q, masked, normalized]) => ({ q: ticks(q)[0], masked: ticks(masked)[0], normalized: normalized === "—" ? null : ticks(normalized)[0] }));

let sb, server, staff, db, browser, base, debugPort, normalize;
const u = {};
const fx = {};
const T = {};
const contexts = [];
const before0 = {};
let cleaned = false;
let M, H, M2, ipSeq = 0, qtMark, evMark;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 800);
const hoursAgo = (h) => new Date(Date.now() - h * HOUR).toISOString();
const kstDay = (n) => new Date(Date.now() + 9 * HOUR + n * DAY).toISOString().slice(0, 10);
const nextIp = () => `10.88.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
const sortedRefs = (items) => items.map((i) => `${i.kind}:${i.ref}`).sort();

/** 이 실행만의 한글 표식 — 실행 번호를 한글 음절로 (가짜 낱말이 진짜 용어와 겹치지 않게) */
function hangulTag(run) {
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  return [...run.slice(-4)].map((c) => String.fromCodePoint(0xac00 + ((digits.indexOf(c) % 19) * 21 + Math.floor(digits.indexOf(c) / 19) * 4) * 28)).join("");
}

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function ok(promise, status, what) {
  const r = await promise;
  assert.equal(r.status, status, `${what}: ${show(r)}`);
  return r;
}
async function setSetting(key, value) {
  await ok(api("PATCH", `/settings/${key}`, u.admin, { value }), 200, `설정 ${key}`);
}
async function setFeatures(on) {
  const current = (await one("select value from public.settings where key = 'feature_flags'")).value;
  await setSetting("feature_flags", Object.fromEntries(Object.keys(current).map((k) => [k, on.includes(k)])));
}

/** 공개 검색 API — 요청마다 다른 IP(1분 120번 상한). 기본 User-Agent는 스크립트라 검색어 집계에서 빠진다 */
async function searchApi(qs, { ua, headers = {} } = {}) {
  const res = await fetch(`${base}/api/search?${qs}`, { headers: { "x-real-ip": nextIp(), ...(ua ? { "user-agent": ua } : {}), ...headers } });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}
const q = (s, extra = "") => `q=${encodeURIComponent(s)}${extra}`;
async function refsOf(s, extra = "") {
  const r = await searchApi(q(s, extra));
  assert.equal(r.status, 200, `${s}: ${JSON.stringify(r.body)}`);
  return r.body;
}

async function insertArticle(label, over = {}) {
  let leadMedia = null;
  if (over.unconfirmedImage) {
    const m = await one(
      "insert into public.media (path, alt, kind, rights_status, credit, license, width, height) values ($1, '시험 그림', 'thumbnail', 'unconfirmed', '편집국', '자체 제작', 1280, 720) returning id",
      [`e2e/${staff.run}/w2d-${label}.png`],
    );
    staff.trackRow("media", m.id);
    leadMedia = m.id;
  }
  const blocks = over.blocks ?? [{ type: "paragraph", text: over.text ?? "본문 첫 문단입니다." }];
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, reporting_method, status, author_id, body, region_codes, first_published_at, is_paid, lead_media_id, digest_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id, slug`,
    [
      `${SLUG_PREFIX}-${label}-${staff.run}`.toLowerCase(),
      over.title,
      over.summary ?? "무엇이 바뀌고 누구에게 영향이 있는지 정리했습니다.",
      over.section ?? "tax",
      over.contentType ?? "explainer",
      over.contentType === "reported_news" ? "qualitative" : null,
      over.status ?? "published",
      u.reporter.personId,
      JSON.stringify({ blocks, claims: [] }),
      over.regionCodes ?? [],
      (over.status ?? "published") === "published" ? (over.publishedAt ?? hoursAgo(24)) : null,
      over.paid ?? false,
      leadMedia,
      over.contentType === "digest" ? 1 : null,
    ],
  );
  staff.trackArticle(rows[0].id);
  return { id: Number(rows[0].id), slug: rows[0].slug };
}
async function insertAmendment(label, title, status) {
  const am = await one("insert into public.amendments (slug, title, status, law_names) values ($1, $2, $3, '{지방세법}') returning id", [`${SLUG_PREFIX}-am-${label}-${staff.run}`.toLowerCase(), title, status]);
  staff.trackRow("amendments", am.id);
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e', 'https://www.mois.go.kr/e2e-w2d', 'h', '원문') returning id");
  await db.query("insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, 'pre_notice', current_date - 3, 'https://www.mois.go.kr/e2e-w2d', $2, 'user:e2e')", [am.id, snap.id]);
  return Number(am.id);
}
async function createSituation(label, body, publish) {
  const checks = [{ title: "자동차세를 미리 냈는지" }, { title: "등록 말소일" }, { title: "돌려받을 계좌" }];
  const r = await ok(api("POST", "/situations", u.editor, { slug: `${SLUG_PREFIX}-${label}-${staff.run}`.toLowerCase(), section: "tax", pictogram: "car-sold", checks, ...body }), 201, `상황 ${label}`);
  const id = r.body.situation.id;
  staff.trackRow("situations", id);
  if (publish) {
    const row = await one("select updated_at from public.situations where id = $1", [id]);
    await ok(api("POST", `/situations/${id}/review`, u.reviewer, { updatedAt: row.updated_at.toISOString() }), 200, "감수");
    await ok(api("PATCH", `/situations/${id}`, u.editor, { visible: true }), 200, "공개");
  }
  return { id, slug: r.body.situation.slug };
}
async function createTerm(key, body) {
  const r = await ok(api("POST", "/glossary", u.editor, body), 201, `용어 ${key}`);
  staff.trackRow("glossary_terms", r.body.term.id);
  T[key] = { id: Number(r.body.term.id), term: body.term };
  return r;
}

// ── 브라우저 ─────────────────────────────────────────────
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
    throw new Error(`요청 ${pending.size}개가 끝나지 않았다`);
  };
}
async function open(url, { viewport = { width: 1280, height: 800 }, javaScriptEnabled = true, hasTouch = false, userAgent } = {}) {
  const context = await browser.newContext({ viewport, javaScriptEnabled, hasTouch, ...(userAgent ? { userAgent } : {}) });
  contexts.push(context);
  const page = await context.newPage();
  const res = await page.goto(url, { waitUntil: javaScriptEnabled ? "networkidle" : "load" });
  return { context, page, res };
}
async function interactive(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(로그아웃|로그인)$/.test(b.textContent.trim()) && !b.disabled));
}
async function loginPage(user, { viewport = { width: 1280, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, userAgent: HUMAN_UA });
  contexts.push(context);
  const page = await context.newPage();
  // 로그인 직후 편집국 첫 화면의 화면 전환 요청이 끝난 뒤에 돌려준다 (W2-c 1f96ef8)
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
const searchUrl = (s, extra = "") => `${base}/search?q=${encodeURIComponent(s)}${extra}`;
const hitsOf = (page) => page.$$eval("[data-search-hit]", (els) => els.map((e) => `${e.getAttribute("data-kind")}:${e.getAttribute("data-ref")}`));
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const eventsSince = async (name, mark) => (await db.query("select * from public.analytics_events where name = $1 and id > $2 order by id", [name, mark])).rows;
async function waitEvents(name, mark, n) {
  for (let i = 0; i < 60; i++) {
    const rows = await eventsSince(name, mark);
    if (rows.length >= n) return rows;
    await sleep(100);
  }
  return eventsSince(name, mark);
}
const eventMark = async () => Number((await one("select coalesce(max(id), 0)::bigint m from public.analytics_events")).m);

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];

// ── 남은 행 ─────────────────────────────────────────────
async function residue(client = db) {
  const tables = ["articles", "article_revisions", "article_sources", "article_corrections", "article_tombstones", "editorial_reviews", "seo_checks", "raw_snapshots", "people", "staff_roles", "audit_logs", "media", "analytics_events", "agent_runs", "glossary_terms", "situations", "amendments", "amendment_events", "search_synonyms", "regions", "query_terms"];
  const out = {};
  for (const t of tables) out[t] = (await client.query(`select count(*)::int n from public.${t}`)).rows[0].n;
  out["auth.users"] = (await client.query("select count(*)::int n from auth.users")).rows[0].n;
  out.settings = JSON.stringify((await client.query("select key, value from public.settings order by key")).rows);
  return out;
}
async function removeOwnRows() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.articles where slug like $1", [`${SLUG_PREFIX}-fill-%-${staff.run}`.toLowerCase()]);
    await db.query("delete from public.regions where slug like $1", [`${SLUG_PREFIX}-%-${staff.run}`.toLowerCase()]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

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
  Object.assign(before0, await residue());
  qtMark = staff.queryTermsMark;
  evMark = await eventMark();
  M = `수용검색${staff.run}`;
  M2 = `분리${staff.run}가`;
  H = hangulTag(staff.run);
  normalize = await importSource(pathToFileURL(path.join(ROOT, "apps", "web", "lib", "server", "public", "search-normalize.ts")).href);
  u.admin = await staff.createUser({ label: "w2d-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w2d-editor", roles: ["editor"], person: { name: "수용 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w2d-reporter", roles: ["reporter"], person: { name: "수용 시험 기자", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "w2d-reviewer", roles: ["reviewer"], person: { name: "수용 시험 감수위원", roles: ["reviewer"] } });
  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
});

after(async () => {
  try {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    if (!cleaned && staff) {
      await removeOwnRows();
      await staff.cleanup();
    }
  } finally {
    server?.stop();
  }
});

// ── 1) 자료 ─────────────────────────────────────────────
test("1) 9장 증거 줄 = 이 시험이 증명하는 것 · 출발점(기사 0·용어 0·기능 키 꺼짐) · 공개 자료는 첫 공개 요청 전에 넣는다", async () => {
  const row = PRD_01A.split("\n").find((l) => l.includes("| W2-d |"));
  assert.ok(row?.includes("검색 정규화 테스트 통과, p95 ≤ 800ms"), "PRD-01A 9장 W2-d 증거");
  assert.ok(MD.split("\n").find((l) => l.startsWith("| 5 수용 E2E"))?.includes("w2d-acceptance.test.mjs"));
  assert.equal(before0.articles, 0, "로컬 DB에 기사가 남아 있다");
  assert.equal(before0.glossary_terms, 0, "로컬 DB에 용어가 남아 있다");
  assert.equal(before0.query_terms, 0);
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.deepEqual([flags.search, flags.glossary, flags.amendments, flags.region_hubs], [false, false, false, false]);

  // 기사 — 공개 · 비공개(초안·유료·금주 핫뉴스·권리 미확인 대표 이미지)
  fx.explainer = await insertArticle("explainer", { title: `${M} 취득세 감면 안내`, text: "경주 지역의 취득세 감면 안내입니다.", publishedAt: hoursAgo(2) });
  fx.guide = await insertArticle("guide", { title: `${M} 부동산 거래 신고`, section: "realestate", contentType: "guide", text: "주택을 사면 취득 세 신고를 60일 안에 합니다." });
  fx.report = await insertArticle("report", { title: `${M} 취득세 보도`, contentType: "reported_news", regionCodes: ["1100000000"], publishedAt: hoursAgo(1) });
  fx.reportOld = await insertArticle("reportold", { title: `${M} 오래된 보도 취득세`, contentType: "reported_news", section: "finance", publishedAt: new Date(Date.now() - 400 * DAY).toISOString() });
  fx.rebuild = await insertArticle("rebuild", { title: `${M} 재건축 조합원이 내는 세금`, contentType: "reported_news", section: "realestate", text: `성동구 재개발 구역의 ${M} 조합원 세금입니다.` });
  fx.draft = await insertArticle("draft", { title: `${M} 초안 취득세`, status: "draft" });
  fx.paid = await insertArticle("paid", { title: `${M} 유료 취득세`, paid: true });
  fx.digest = await insertArticle("digest", { title: `${M} 금주 핫뉴스 취득세`, contentType: "digest" });
  fx.noRights = await insertArticle("norights", { title: `${M} 권리 미확인 취득세`, unconfirmedImage: true });
  fx.pages = [];
  for (let i = 1; i <= 22; i++) fx.pages.push((await insertArticle(`page${i}`, { title: `${M} 쪽넘김 시험 ${i}`, publishedAt: hoursAgo(30 + i) })).id);
  // 정규화 시험용 — 모든 찾는 낱말이 든 글(붙인 낱말). 띄어 쓴 낱말용 글은 2번 시험이 칸(제목·요약·본문)을 나눠 따로 넣는다
  const joined = "취득세 재건축 차팔았 성동구 재개발 경주 2026년 지방세제 개편안 pf abs 대출 세감면 지방교육세 교육세 차 가나 다라 마바 사아 자차 카타 파하 거너";
  fx.magnet = await insertArticle("magnet", { title: `${M} 정규화 자석`, blocks: [{ type: "paragraph", text: joined }] });

  fx.tracker = await insertAmendment("reform", `2026년 지방세제 개편안 ${M}`, "public");
  fx.privateTracker = await insertAmendment("private", `${M} 비공개 개편안`, "draft");
  fx.hiddenPerson = Number((await one("insert into public.people (slug, name, roles, visibility) values ($1, $2, '{reporter}', 'hidden') returning id", [`${SLUG_PREFIX}-hidden-${staff.run}`.toLowerCase(), `${M} 숨은 기자`])).id);
  staff.personIds.add(fx.hiddenPerson);
  // 지역 — 성동구(서울)·경주시(경북), 옛 이름 별칭
  for (const [code, parent, name, slug, aliases] of [["1179900000", "1100000000", "성동구", "sd", [`${H}옛성동`]], ["4779900000", "4700000000", "경주시", "gj", []]]) {
    await db.query("insert into public.regions (code, parent_code, level, name, slug, aliases) values ($1, $2, 'sigungu', $3, $4, $5)", [code, parent, name, `${SLUG_PREFIX}-${slug}-${staff.run}`.toLowerCase(), aliases]);
  }
  // 용어 200개(가나다 색인·4대 분야) — 가짜 낱말·가짜 풀이. 공개 요청 전에 DB에 직접
  const sylls = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하"];
  const { rows: bulk } = await db.query(
    `insert into public.glossary_terms (term, definition, plain, section, source, visible)
     select ($1::text[])[1 + i % 14] || $2 || '용어' || i, '시험용 가짜 뜻 ' || i, '시험용 가짜 풀이 ' || i,
            array[(array['tax', 'realestate', 'finance', 'local'])[1 + i % 4]], '시험용 가짜 출처', true
     from generate_series(1, 200) i returning id, term, section`,
    [sylls, H],
  );
  fx.bulk = bulk.map((r) => ({ id: Number(r.id), term: r.term, section: r.section[0] }));
  for (const b of fx.bulk) staff.trackRow("glossary_terms", b.id);
  assert.equal(fx.bulk.length, 200);

  // 상황 카드·용어는 편집국 API로 (검색 별칭 칸은 3번에서 더한다)
  fx.car = await createSituation("car", { title: "차를 팔았어요·폐차했어요", subtitle: "돌려받을 자동차세가 있는지 확인합니다" }, true);
  fx.hiddenSituation = await createSituation("hidden", { title: `${M} 감수 전 상황` }, false);
  await createTerm("search", { term: `${M} 취득세`, plain: "부동산을 살 때 내는 지방세", jargon: true, section: ["tax"], visible: true });
  await createTerm("hiddenSearch", { term: `${M} 숨김용어 취득세`, plain: "숨겨 둔 시험 풀이", jargon: true, section: ["tax"] });
  assert.equal((await one("select visible from public.glossary_terms where id = $1", [T.hiddenSearch.id])).visible, false, "새 용어는 숨김");
  // 본문 풀이(GLO-02) 용어 — site-glossary와 같은 구성
  const plain = (n) => `시험용 가짜 풀이 ${n}`;
  await createTerm("short", { term: `${H}세`, plain: plain("하나"), definition: "시험용 가짜 뜻 하나", related: [`${H}세율`], section: ["tax"], source: "시험용 가짜 출처", visible: true });
  await createTerm("long", { term: `${H}세율`, plain: plain("둘"), section: ["tax"], visible: true });
  await createTerm("prefix", { term: `지방${H}세`, plain: plain("셋"), section: ["local"], visible: true });
  await createTerm("latin", { term: `Qz${staff.run}`, plain: plain("다섯"), section: ["realestate"], visible: true });
  await createTerm("hidden", { term: `${H}숨김말`, plain: plain("여섯"), section: ["tax"] });
  const blocks = [
    { type: "paragraph", text: `[${T.short.term} 안내](/news) 목록을 먼저 보세요.` },
    { type: "paragraph", text: `${T.long.term}은 ${T.short.term}를 매기는 비율이다. ${T.short.term}는 두 번 나온다.` },
    { type: "paragraph", text: `${T.prefix.term}와 ${T.short.term} 그리고 ${T.hidden.term}도 있다.` },
    { type: "quote", text: "인용 글입니다.", speaker: `${T.latin.term} 담당자` },
    { type: "paragraph", text: `줄 끝 가까이에 영문 용어가 나오는 문단입니다 ${T.latin.term}` },
  ];
  fx.tipArticle = await insertArticle("tip", { title: `${T.short.term} 시험 기사`, blocks });
  await setSetting("home_search_chips", ["취득세", "개편안", "책임준공", "재산세"]);
  await setFeatures(["search", "glossary"]);
});

// ── 2) 정규화 ───────────────────────────────────────────
test("2) SRCH-01 정규화 — 설계 2.2 견본 전체: TypeScript 규칙 · 실제 API가 DB에서 받은 낱말 · 0건이면 띄어 쓴 낱말로 다시 찾기", async () => {
  assert.ok(GOLDEN.length >= 19, "견본 표를 읽었다");
  for (const g of GOLDEN) {
    const r = normalize.queryTerms(g.input);
    assert.deepEqual(r.terms, g.terms, `TS 찾는 낱말: ${g.input}`);
    assert.deepEqual(r.split, g.split, `TS 다시 찾는 낱말: ${g.input}`);
  }
  // 실제 API — 결과 행의 query_terms(DB가 쓴 낱말)가 견본의 찾는 낱말과 같다 (모든 낱말이 든 글이 있다)
  for (const g of GOLDEN.filter((x) => x.terms.length > 0)) {
    const r = await searchApi(q(g.input));
    assert.equal(r.status, 200, g.input);
    assert.deepEqual(r.body.terms, g.terms, `API 낱말: ${g.input}`);
    assert.ok(r.body.items.some((i) => i.ref === String(fx.magnet.id)), `${g.input}: 모든 낱말이 든 글이 결과에 있다`);
  }
  // 남는 글자가 없는 검색어 — 빈 결과(기호만) · 입력 없음은 400
  const symbols = await searchApi(q("?!·"));
  assert.deepEqual([symbols.status, symbols.body.items, symbols.body.terms], [200, [], []]);
  assert.equal((await searchApi(q("   "))).status, 400);
  // 다시 찾기 — 붙인 낱말이 0건이면 띄어 쓴 낱말(칸 사이는 줄바꿈이라 낱말이 이어지지 않는다 — 제목·요약·본문에 나눠 담은 글)로
  const splitRows = GOLDEN.filter((x) => x.split && x.terms.length < 8);
  const splitDocs = [];
  try {
    for (const [i, g] of splitRows.entries()) {
      splitDocs.push(await insertArticle(`split${i}`, { title: `${M2} ${g.split[0]}`, summary: g.split[1], text: g.split[2] ?? "본문 첫 문단입니다." }));
    }
    for (const [i, g] of splitRows.entries()) {
      const r = await searchApi(q(`${M2} ${g.input}`));
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.terms, [M2.toLowerCase(), ...g.split], `다시 찾은 낱말: ${g.input}`);
      assert.ok(r.body.items.some((it) => it.ref === String(splitDocs[i].id)), `${g.input}: 칸마다 나눠 담은 글이 찾힌다`);
    }
  } finally {
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.articles where id = any($1::bigint[])", [[fx.magnet.id, ...splitDocs.map((d) => d.id)]]);
    await db.query("commit");
  }
  // 한도 — 검색어 100자까지, 101자는 400
  assert.equal((await searchApi(q("가".repeat(100)))).status, 200);
  assert.equal((await searchApi(q("가".repeat(101)))).status, 400);
});

test("2) SRCH-01 \"취득세\"와 \"취득 세\", \"재건축\"과 \"재 건축\"은 같은 결과 — API와 화면 모두", async () => {
  for (const [a, b] of [[`${M} 취득세`, `${M} 취득 세`], [`${M} 재건축`, `${M} 재 건축`], ["취득세", "취득 세"], ["재건축", "재 건축"]]) {
    const ra = await refsOf(a);
    const rb = await refsOf(b);
    assert.ok(ra.items.length > 0, `${a}: 결과가 있다`);
    assert.deepEqual(sortedRefs(rb.items), sortedRefs(ra.items), `API '${a}' = '${b}'`);
    assert.deepEqual(rb.counts, ra.counts);
    const pa = await open(searchUrl(a));
    const pb = await open(searchUrl(b));
    assert.deepEqual((await hitsOf(pb.page)).sort(), (await hitsOf(pa.page)).sort(), `화면 '${a}' = '${b}'`);
  }
  assert.ok((await refsOf("취득 세")).items.some((i) => i.ref === String(fx.guide.id)), "본문의 \"취득 세\"(띄어 쓴 글)도 \"취득세\"로 찾힌다");
});

// ── 3) 구어·별칭·트래커 ──────────────────────────────────
test("3) SRCH-01 \"차 팔았\" → 상황 페이지(다시 찾기), 편집국이 검색 별칭을 더하면 바로 별칭으로 · \"개편안\" → 트래커(링크 0·현재 단계 원문·확정 아님)", async () => {
  let body = await refsOf("차 팔았");
  assert.deepEqual(body.terms, ["차", "팔았"], "붙인 낱말 0건 → 띄어 쓴 낱말");
  assert.ok(body.items.some((i) => i.kind === "situation" && i.ref === String(fx.car.id)), "차 팔았 → 상황");
  const row = await one("select updated_at from public.situations where id = $1", [fx.car.id]);
  const patched = await ok(api("PATCH", `/situations/${fx.car.id}`, u.editor, { aliases: ["차 팔았어요", "폐차"] }), 200, "별칭");
  assert.equal(patched.body.reviewCleared, false, "별칭은 감수 대상 칸이 아니다 — 공개·감수 그대로");
  assert.ok(row);
  body = await refsOf("차 팔았");
  assert.deepEqual(body.terms, ["차팔았"], "별칭에서 바로 찾는다");
  const car = body.items.find((i) => i.kind === "situation" && i.ref === String(fx.car.id));
  assert.ok(car, "별칭으로 찾힌 상황");
  assert.equal(car.href, `/situations/${fx.car.slug}`);
  const page = await open(searchUrl("차 팔았"));
  const hit = page.page.locator(`[data-search-hit][data-kind="situation"][data-ref="${fx.car.id}"]`);
  assert.equal(await hit.count(), 1);
  assert.equal(await hit.locator('[data-part="type-label"]').textContent(), "상황");

  const t = await open(searchUrl("개편안"));
  const tracker = t.page.locator(`[data-search-hit][data-kind="tracker"][data-ref="${fx.tracker}"]`);
  assert.equal(await tracker.count(), 1, "개편안 → 트래커");
  assert.equal(await t.page.locator(`[data-search-hit][data-ref="${fx.privateTracker}"]`).count(), 0, "비공개 트래커 0");
  assert.equal(await tracker.locator('a[href^="/tax/amendments"]').count(), 0, "트래커 화면(기능 키 amendments 꺼짐) — 링크 0");
  assert.equal(await tracker.locator('a[target="_blank"]').getAttribute("href"), "https://www.mois.go.kr/e2e-w2d");
  assert.equal(await tracker.locator('[data-ui="unconfirmed-chip"]').textContent(), "확정 아님");
});

// ── 4) 비공개 0 · 유형 표시 · 명소·맛집·행사 ────────────────
test("4) SRCH-01 비공개 0 — 초안·유료·금주 핫뉴스·권리 미확인 이미지·감수 전 상황·비공개 트래커·숨긴 인물·숨긴 용어는 API·화면 어디에도 없다", async () => {
  const hidden = [`article:${fx.draft.id}`, `article:${fx.paid.id}`, `article:${fx.digest.id}`, `article:${fx.noRights.id}`, `situation:${fx.hiddenSituation.id}`, `tracker:${fx.privateTracker}`, `person:${fx.hiddenPerson}`, `glossary:${T.hiddenSearch.id}`];
  for (const tab of ["all", "article", "tracker", "glossary"]) {
    const body = await refsOf(M, `&tab=${tab}`);
    const refs = body.items.map((i) => `${i.kind}:${i.ref}`);
    for (const h of hidden) assert.ok(!refs.includes(h), `API ${tab}: ${h} 0`);
  }
  const all = await refsOf(M, "&tab=article");
  for (const a of [fx.explainer, fx.guide, fx.report, fx.rebuild]) assert.ok(all.items.some((i) => i.ref === String(a.id)), `공개 기사 ${a.id}`);
  const { page } = await open(searchUrl(M));
  const hits = await hitsOf(page);
  for (const h of hidden) assert.ok(!hits.includes(h), `화면 ${h} 0`);
  assert.equal((await refsOf("감수전", "")).items.length, 0);
});

test("4) SRCH-01 결과마다 유형 표시(기사 유형 배지·상황·용어) · 명소·맛집 유형 0 · 행사는 결과 목록 0(LG-10) · 모르는 종류는 DB도 거부", async () => {
  const { page } = await open(searchUrl(`${M} 취득세`));
  const badges = await page.$$eval('[data-part="hit-group"][data-kind="article"] [data-search-hit]', (els) => els.map((e) => [e.getAttribute("data-content-type"), e.querySelector('[data-ui="article-type-badge"]')?.textContent]));
  assert.deepEqual(new Map(badges), new Map([["reported_news", "보도"], ["explainer", "해설"], ["guide", "가이드"]]));
  assert.deepEqual(await page.$$eval('[data-part="hit-group"][data-kind="glossary"] [data-part="type-label"]', (els) => els.map((e) => e.textContent)), ["용어"]);
  assert.equal(await page.locator('[data-search-hit][data-kind="glossary"] h3 a').getAttribute("href"), `/glossary/${T.search.id}`, "용어사전이 열려 있으면 용어 쪽으로");
  // 광고(sponsored)·유형 없는 이관 기사 표시
  // 어떤 검색어에도 종류는 설계 2.1 목록 안 — 장소·맛집·행사 종류 0
  for (const s of ["강릉 축제", "맛집", "명소", "행사", M, "취득세", "성동구", "축제"]) {
    const body = await refsOf(s);
    for (const i of body.items) assert.ok(KINDS.includes(i.kind), `${s}: 모르는 종류 ${i.kind}`);
    assert.equal(body.counts.event ?? 0, 0);
    assert.deepEqual(Object.keys(body.counts).sort(), [...KINDS].sort());
  }
  assert.equal((await searchApi(q("a", "&tab=place"))).status, 400);
  assert.equal((await searchApi(q("a", "&tab=food"))).status, 400);
  const ev = await searchApi(q("강릉 축제", "&tab=event"));
  assert.deepEqual([ev.status, ev.body.items, ev.body.total], [200, [], 0], "행사 탭(01B W6 전) — 결과 0");
  const rpc = await fetch(`${sb.url}/rest/v1/rpc/search_public`, { method: "POST", headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}`, "content-type": "application/json" }, body: JSON.stringify({ p_query: "축제", p_kinds: ["event"] }) });
  assert.equal(rpc.status, 400, "DB 검색 함수는 모르는 종류(event)를 거부");
});

// ── 5) 편집국 → 공개 → 검색 → 내림 ────────────────────────
const LAW = { kind: "official_doc", title: "지방세법 제20조(신고 및 납부)", url: "https://www.law.go.kr/법령/지방세법/제20조", sourceName: "법제처 국가법령정보센터", lastVerifiedAt: "2026-10-10T09:00:00+09:00", licenseStatus: "공공저작물 자유이용" };
test("5) SRCH-01 편집국 API로 쓴 기사 — 발행 판정을 지나 공개하면 검색에 나오고, 삭제 정정하면 바로 빠지며 주소는 410", async () => {
  const category = Number((await one("select id from public.categories where section = 'tax' and slug = 'interpretations'")).id);
  const title = `${M} 편집국발 신고기한`;
  const created = await ok(api("POST", "/articles", u.reporter, { slug: `${SLUG_PREFIX}-api-${staff.run}`.toLowerCase(), title, summary: "취득세 신고 순서를 정리했습니다.", section: "tax", categoryId: category, contentType: "explainer", legalBasisDate: "2026-10-01" }), 201, "기사 만들기");
  const id = created.body.article.id;
  staff.trackArticle(id);
  const src = await ok(api("POST", `/articles/${id}/sources`, u.reporter, LAW), 201, "출처");
  const ref = src.body.source.ref;
  const blocks = [
    { type: "key_summary", lines: ["주택을 사면 취득일부터 60일 안에 신고합니다.", "취득일은 잔금일과 등기일 중 빠른 날입니다.", "신고와 납부는 함께 합니다."] },
    { type: "paragraph", text: "취득일은 잔금을 치른 날과 등기를 마친 날 중 빠른 날이다. 자세한 흐름은 [지방세 허브](/tax)에서 볼 수 있다." },
    { type: "table", caption: "취득일 정하는 법", rows: [["경우", "취득일"], ["잔금이 먼저", "잔금일"], ["등기가 먼저", "등기일"]], chart: { axis: "경우", unit: "날짜", source: "지방세법 시행령" } },
    { type: "quote", text: "취득세는 취득일부터 60일 이내에 신고하고 납부하여야 한다.", speaker: "지방세법 제20조", origin: "document", refId: ref },
    { type: "callout", kind: "tip", title: "절세 체크포인트", text: "생애 첫 주택이면 감면 요건을 먼저 확인하세요." },
    { type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "계약일이 아니라 잔금일이나 등기일이 취득일입니다." },
    { type: "faq", items: [{ question: "취득세는 어디에 신고하나요?", answer: "주택이 있는 시·군·구청이나 위택스에 신고합니다." }, { question: "신고와 납부를 따로 하나요?", answer: "신고하면서 함께 냅니다." }] },
  ];
  await ok(api("PATCH", `/articles/${id}`, u.reporter, { body: { blocks, claims: [{ id: "claim-1", text: "취득일부터 60일 안에 신고하고 납부해야 한다.", kind: "legal", evidenceIds: [ref], blockIndex: 1 }] } }), 200, "본문");
  assert.equal((await refsOf(`${M} 편집국발`)).items.length, 0, "발행 전에는 검색에 없다");
  await ok(api("POST", `/articles/${id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve" }), 201, "편집 승인");
  await ok(api("POST", `/articles/${id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" }), 201, "세무 감수");
  await ok(api("POST", `/articles/${id}/publish`, u.editor), 200, "발행");
  const found = await refsOf(`${M} 편집국발`);
  assert.deepEqual(found.items.map((i) => [i.kind, i.ref, i.contentType]), [["article", String(id), "explainer"]]);
  assert.ok((await refsOf("잔금일 등기일 위택스 신고")).items.some((i) => i.ref === String(id)), "본문(표·FAQ 포함) 글로도 찾힌다");
  await ok(api("POST", `/articles/${id}/corrections`, u.editor, { kind: "deletion", reason: "시험 — 내림" }), 201, "삭제 정정");
  assert.equal((await refsOf(`${M} 편집국발`)).items.length, 0, "삭제하면 다음 검색부터 0 (30초 창 없음)");
  assert.equal((await fetch(`${base}/news/${SLUG_PREFIX}-api-${staff.run}`.toLowerCase())).status, 410);
});

// ── 6) 지역 ─────────────────────────────────────────────
test("6) REG-08/REG1-11 지역 — 지역명만 쓰면 지역이 첫 결과 · 옛 이름(별칭)으로 현재 지역 · \"성동구 재개발\"·\"경주 취득세\" · 지역 거르개 · 축제 검색에 행사 0", async () => {
  const first = (await refsOf("성동구")).items[0];
  assert.deepEqual([first.kind, first.ref], ["region", "1179900000"], "지역명만 — 지역이 첫 결과");
  const byAlias = (await refsOf(`${H}옛성동`)).items[0];
  assert.deepEqual([byAlias.kind, byAlias.ref], ["region", "1179900000"], "옛 이름으로 검색하면 현재 지역");
  assert.ok((await refsOf("성동구 재개발")).items.some((i) => i.ref === String(fx.rebuild.id)), "성동구 재개발 → 두 낱말이 든 기사");
  assert.ok((await refsOf("경주 취득세")).items.some((i) => i.ref === String(fx.explainer.id)), "경주 취득세 → 두 낱말이 든 기사");
  const filtered = await refsOf("성동구", "&region=1100000000");
  assert.ok(filtered.items.some((i) => i.kind === "region" && i.ref === "1179900000"), "시·도 거르개는 그 아래 시·군·구 포함");
  assert.equal((await refsOf("성동구", "&region=4700000000")).items.some((i) => i.kind === "region"), false, "다른 시·도 거르개에는 없다");
  const body = await refsOf("강릉 축제");
  assert.ok(body.items.every((i) => KINDS.includes(i.kind) && i.kind !== "place"), "강릉 축제 — 관광·행사 종류 0");
});

// ── 7) 탭·거르개 ────────────────────────────────────────
test("7) SRCH-02 탭은 URL 쿼리이고 JS를 꺼도 링크로 동작 · 거르개 reported_news만 → 다른 유형 0 · 분야·기간·지역 거르개 · 쪽 넘김", async () => {
  const { page } = await open(searchUrl(`${M} 취득세`), { javaScriptEnabled: false });
  const documents = [];
  page.on("request", (r) => r.resourceType() === "document" && documents.push(new URL(r.url()).search));
  const labels = await page.$$eval('[data-ui="tab-nav"] a', (as) => as.map((a) => a.textContent.split(" ")[0]));
  assert.deepEqual(labels, ["전체", "기사", "용어"], "결과 있는 탭만");
  assert.ok(labels.every((l) => TAB_LABELS.includes(l)));
  assert.deepEqual(labels.map((l) => TAB_LABELS.indexOf(l)), [...labels.map((l) => TAB_LABELS.indexOf(l))].sort((a, b) => a - b), "설계의 탭 차례");
  await page.locator('[data-ui="tab-nav"] a', { hasText: "기사" }).click();
  await page.waitForURL((url) => url.searchParams.get("tab") === "article");
  assert.equal(documents.length, 1, "탭 링크 — 문서를 새로 받았다");
  assert.ok((await hitsOf(page)).every((h) => h.startsWith("article:")));
  await page.locator('[data-part="search-filters"] summary').click();
  await page.selectOption("#search-type", "reported_news");
  await page.locator('[data-part="filter-form"] button[type="submit"]').click();
  await page.waitForURL((url) => url.searchParams.get("type") === "reported_news");
  assert.deepEqual((await hitsOf(page)).sort(), [`article:${fx.report.id}`, `article:${fx.reportOld.id}`].sort(), "reported_news만 — 다른 유형 0");
  // API로 거르개 조합
  const typed = await refsOf(`${M} 취득세`, "&type=reported_news");
  assert.ok(typed.items.every((i) => i.kind === "article" && i.contentType === "reported_news"));
  assert.deepEqual(sortedRefs(typed.items), [`article:${fx.report.id}`, `article:${fx.reportOld.id}`].sort());
  assert.deepEqual(sortedRefs((await refsOf(`${M} 취득세`, "&section=realestate")).items), [`article:${fx.guide.id}`], "분야 거르개");
  assert.deepEqual(sortedRefs((await refsOf(`${M} 취득세`, `&from=${kstDay(-30)}`)).items), [`article:${fx.explainer.id}`, `article:${fx.guide.id}`, `article:${fx.report.id}`].sort(), "기간 — 날짜 없는 용어 0·오래된 보도 0");
  assert.deepEqual(sortedRefs((await refsOf(`${M} 취득세`, `&from=${kstDay(-500)}&to=${kstDay(-300)}`)).items), [`article:${fx.reportOld.id}`], "기간 안의 보도");
  assert.deepEqual(sortedRefs((await refsOf(`${M} 취득세`, "&region=1100000000")).items), [`article:${fx.report.id}`], "지역 거르개");
  // 쪽 넘김 — 22건, 20개씩
  await page.goto(searchUrl(`${M} 쪽넘김`, "&tab=article"), { waitUntil: "load" });
  assert.equal((await hitsOf(page)).length, 20);
  await page.getByRole("link", { name: "다음 쪽" }).click();
  await page.waitForURL((url) => url.searchParams.get("page") === "2");
  assert.equal((await hitsOf(page)).length, 2);
});

test("8) SRCH-02 결과 0건 — 추천 검색어 3개 · 상황 카드 · 도우미 답변·[AI 도우미에게 묻기] 0 · 결과 목록에 도우미 요소 0 · 틀린 입력 400·500 0", async () => {
  const { page } = await open(searchUrl(`없는낱말${M}`));
  const chips = await page.$$eval('[data-part="search-suggestions"] a', (as) => as.map((a) => a.textContent));
  assert.deepEqual(chips, ["취득세", "개편안", "책임준공"]);
  assert.equal(chips.length, SUGGESTIONS);
  const cards = await page.$$eval('[data-part="search-situations"] [data-situation-slug]', (els) => els.map((e) => e.getAttribute("data-situation-slug")));
  assert.ok(cards.includes(fx.car.slug) && !cards.includes(fx.hiddenSituation.slug), "공개 상황 카드만");
  assert.equal(await page.getByText("AI 도우미에게 묻기").count(), 0);
  const res = await open(searchUrl(`${M} 취득세`));
  for (const sel of ['[data-ui="answer-card"]', '[data-ui="assistant-panel"]', '[data-ui="assistant-launcher"]']) assert.equal(await res.page.locator(`main ${sel}`).count(), 0, sel);
  assert.equal(await res.page.locator("main").getByText("AI 답변").count(), 0);
  for (const bad of ["", "q=", "q=a&tab=place", "q=a&page=0", "q=a&type=digest", "q=a&region=12", "q=a&from=2026-10-20&to=2026-10-19", "q=a&q=b", "q=a&unknown=1"]) {
    const r = await searchApi(bad);
    assert.equal(r.status, 400, bad);
    assert.ok(r.body.errors.length > 0);
  }
  for (const odd of ["'; drop table articles; --", '"()|*\\', "%E0%A4%A"]) assert.equal((await searchApi(odd.startsWith("%") ? `q=${odd}` : q(odd))).status, 200, odd);
});

// ── 9) SRCH-03 ──────────────────────────────────────────
const kstToday = () => kstDay(0);
async function countedSearch(s, via = "api") {
  const url = via === "api" ? `${base}/api/search?${q(s)}` : `${base}/search?${q(s)}`;
  const res = await fetch(url, { headers: { "user-agent": HUMAN_UA, "x-real-ip": nextIp() } });
  await res.arrayBuffer();
  assert.equal(res.status, 200, s);
}
async function waitRows(want) {
  const norms = [...want.keys()];
  let rows = [];
  for (let i = 0; i < 100; i++) {
    rows = (await db.query("select term_masked, normalized, count from public.query_terms where source = 'site_search' and period = $1 and normalized = any($2::text[])", [kstToday(), norms])).rows;
    if (rows.length === norms.length && rows.every((r) => r.count >= want.get(r.normalized))) break;
    await sleep(100);
  }
  return new Map(rows.map((r) => [r.normalized, r]));
}
test("9) SRCH-03 가림 견본(설계 2.8) — 전화·이메일·주민등록번호·긴 숫자는 가린 값·정규형으로만, 같은 정규형은 하루 한 행으로 합산, 닮은꼴은 그대로, 정규형이 없으면 저장 0", async () => {
  const expected = new Map();
  const stored = MASK_ROWS.filter((r) => r.normalized !== null);
  for (const [i, r] of stored.entries()) {
    const norm = `${r.normalized} ${RUN}`;
    const e = expected.get(norm) ?? { masked: `${r.masked} ${RUN}`, count: 0 };
    e.count++;
    expected.set(norm, e);
    await countedSearch(`${r.q} ${RUN}`, i % 2 ? "page" : "api");
  }
  const rows = await waitRows(new Map([...expected].map(([k, e]) => [k, e.count])));
  for (const [norm, e] of expected) assert.deepEqual([rows.get(norm)?.term_masked, rows.get(norm)?.count], [e.masked, e.count], `정규형 '${norm}'`);
  for (const r of MASK_ROWS.filter((x) => x.normalized === null)) await countedSearch(r.q);
  await countedSearch(`대조군 ${RUN}`);
  await waitRows(new Map([[`대조군 ${RUN}`, 1]]));
  const all = (await db.query("select term_masked, normalized from public.query_terms where id > $1", [qtMark])).rows;
  assert.equal(all.length, expected.size + 1, "정규형이 없는 검색어(번호뿐)는 저장 0 — 같은 정규형은 한 행");
  // 원문 조각 0 — 9자리 이상 숫자 줄·이메일
  const pieces = MASK_ROWS.flatMap((r) => [...r.q.normalize("NFKC").matchAll(/\d[\d\s.\-()]{6,}\d|[\w.+-]+\s*@\s*[\w.-]+/g)].map((m) => m[0])).filter((p) => p.includes("@") || p.replace(/\D/g, "").length >= 9);
  assert.ok(pieces.length >= 8, `원문 조각 ${pieces.length}`);
  const text = all.map((r) => `${r.term_masked}\n${r.normalized}`).join("\n");
  for (const p of pieces) assert.ok(!text.includes(p), `DB에 원문 조각 '${p}'`);
  for (const mark of ["[전화번호]", "[이메일]", "[주민등록번호]", "[번호]"]) assert.ok(text.includes(mark), `${mark} 가림 글자가 저장됐다`);
  fx.maskPieces = pieces;
});

test("9) SRCH-03 세지 않는 검색(봇·측정 거부·2쪽) · 실제 브라우저에서 이벤트 속성 4칸·검색어 원문 0 · 편집국 검색어 화면(원문 0) → 동의어 더하기 → 공개 검색에 바로 반영", async () => {
  const skip = [`${H}봇말`, `${H}거부말`, `${H}둘째쪽말`];
  const ipOf = () => ({ "x-real-ip": nextIp() });
  await fetch(`${base}/api/search?${q(skip[0])}`, { headers: { "user-agent": GOOGLEBOT_UA, ...ipOf() } }).then((r) => r.arrayBuffer());
  await fetch(`${base}/api/search?${q(skip[1])}`, { headers: { "user-agent": HUMAN_UA, cookie: "ltr_optout=1", ...ipOf() } }).then((r) => r.arrayBuffer());
  await fetch(`${base}/api/search?${q(skip[2], "&tab=article&page=2")}`, { headers: { "user-agent": HUMAN_UA, ...ipOf() } }).then((r) => r.arrayBuffer());
  const W = `${H}동의말`;
  await countedSearch(W);
  await countedSearch(W, "page");
  assert.equal((await waitRows(new Map([[W, 2]]))).get(W)?.count, 2, "다른 사람 두 번");
  const skipped = (await db.query("select normalized from public.query_terms where normalized = any($1::text[])", [skip.map((s) => s.toLowerCase())])).rows;
  assert.deepEqual(skipped, [], "봇·측정 거부·2쪽은 세지 않는다");

  // 실제 브라우저(사람 User-Agent) — 가려야 하는 검색어
  const mark = await eventMark();
  const raw = "010-2222-3333";
  const ctx = await browser.newContext({ userAgent: HUMAN_UA, extraHTTPHeaders: { "x-real-ip": nextIp() } });
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.goto(searchUrl(`${M} 취득세 ${raw}`), { waitUntil: "networkidle" });
  const submitted = await waitEvents("search_submitted", mark, 1);
  assert.equal(submitted.length, 1);
  assert.deepEqual(Object.keys(submitted[0].props).sort(), ["query_length", "region_classified", "result_count", "result_type_count"]);
  const evText = (await db.query("select props::text p from public.analytics_events where id > $1", [mark])).rows.map((r) => r.p).join("\n");
  for (const piece of [raw, "2222", M, "취득세"]) assert.ok(!evText.includes(piece), `측정 이벤트에 '${piece}'`);

  // 편집국 — 검색어 화면
  const editor = await loginPage(u.editor);
  await editor.goto(`${base}/admin/query-terms?days=7`, { waitUntil: "networkidle" });
  const html = await editor.content();
  assert.ok(await editor.locator(`tr[data-normalized="${W}"]`).count() === 1, "2회 찾은 검색어는 목록에 있다");
  assert.equal(await editor.locator(`tr[data-normalized="${skip[0].toLowerCase()}"]`).count(), 0);
  for (const p of fx.maskPieces) assert.ok(!html.includes(p), `편집국 화면에 원문 '${p}'`);
  // 권한 — 기자는 403
  const forbidden = await fetch(`${base}/admin/query-terms`, { headers: { cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") }, redirect: "manual" });
  assert.notEqual(forbidden.status, 200);
  const reporterPage = await loginPage(u.reporter);
  assert.equal((await reporterPage.goto(`${base}/admin/query-terms`)).status(), 403);
  // 동의어 더하기 → 사전 → 저장 → 검색 반영
  fx.synArticle = await insertArticle("syn", { title: `${H}양도말 안내 ${M}` });
  assert.equal((await refsOf(W)).items.length, 0, "동의어 전에는 0");
  await editor.locator(`tr[data-normalized="${W}"] a[data-part="synonym-add"]`).click();
  await editor.waitForURL((url) => url.pathname === "/admin/dictionaries");
  await interactive(editor);
  assert.equal(await editor.locator("#synonym-new-term").inputValue(), W, "낱말을 채운 더하기 폼");
  await editor.fill("#synonym-new-synonyms", `${H}양도말`);
  await editor.getByRole("button", { name: "동의어 더하기" }).click();
  await editor.getByRole("status").filter({ hasText: "동의어 사전에 더했습니다" }).waitFor();
  const syn = await one("select id from public.search_synonyms where updated_by = $1 and term = $2", [`user:${u.editor.id}`, W]);
  staff.trackRow("search_synonyms", syn.id);
  assert.deepEqual((await refsOf(W)).items.map((i) => `${i.kind}:${i.ref}`), [`article:${fx.synArticle.id}`], "더하자마자 동의어로 찾힌다");
});

// ── 10) GLO-01 ──────────────────────────────────────────
test("10) GLO-01 쉬운 풀이 60자는 경고 0 · 61자는 저장+경고 · 121자는 거부 · 기자 403 · 숫자+단위 견본(설계 2.6)", async () => {
  assert.deepEqual([PLAIN_GUIDE, PLAIN_MAX], [60, 120]);
  const mk = (term, plain, user = u.editor) => api("POST", "/glossary", user, { term: `${H}${term}`, plain, jargon: true, section: ["tax"], visible: false });
  const r60 = await ok(mk("육십", "가".repeat(PLAIN_GUIDE)), 201, "60자");
  staff.trackRow("glossary_terms", r60.body.term.id);
  assert.deepEqual(r60.body.warnings, []);
  const r61 = await ok(mk("육십일", "가".repeat(PLAIN_GUIDE + 1)), 201, "61자");
  staff.trackRow("glossary_terms", r61.body.term.id);
  assert.deepEqual(r61.body.warnings.map((w) => [w.id, w.field]), [["glo01.plain-long", "plain"]]);
  assert.equal((await one("select char_length(plain) n from public.glossary_terms where id = $1", [r61.body.term.id])).n, 61, "61자 그대로 저장");
  assert.equal((await mk("넘침", "가".repeat(PLAIN_MAX + 1))).status, 422);
  assert.equal((await mk("기자", "가", u.reporter)).status, 403);
  for (const [i, row] of NUMBER_ROWS.entries()) {
    const r = await ok(mk(`숫자${i}`, row.plain), 201, row.plain);
    staff.trackRow("glossary_terms", r.body.term.id);
    const hits = r.body.warnings.filter((w) => w.id === "glo01.number-unit");
    if (row.found === null) assert.deepEqual(hits, [], `경고 0: ${row.plain}`);
    else {
      assert.equal(hits.length, 1, `경고: ${row.plain}`);
      assert.ok(hits[0].message.includes(`‘${row.found}’`), `${row.plain} → ${row.found}: ${hits[0].message}`);
    }
  }
});

test("10) GLO-01 사전 화면 — 61자·숫자 경고가 입력 중 보이고 저장은 숨김으로 되며, [공개하기] 뒤에야 용어사전·검색에 나오고 [숨기기]하면 사라진다", async () => {
  const term = `${H}화면용어`;
  const page = await loginPage(u.editor);
  await page.goto(`${base}/admin/dictionaries?tab=glossary`);
  await interactive(page);
  await page.locator("#glossary-add summary").click();
  await page.fill("#glossary-new-term", term);
  await page.fill("#glossary-new-plain", "가".repeat(60));
  assert.equal(await page.locator("#glossary-new-warnings").count(), 0, "60자는 경고 0");
  await page.fill("#glossary-new-plain", "가".repeat(61));
  await page.locator("#glossary-new-warnings").filter({ hasText: "쉬운 풀이가 61자입니다" }).waitFor();
  await page.fill("#glossary-new-definition", "가짜 뜻 3%와 2단계");
  await page.locator("#glossary-new-warnings").filter({ hasText: "뜻에 숫자와 단위가 있습니다 (‘3%’)" }).waitFor();
  await page.getByRole("button", { name: "용어 더하기" }).click();
  await page.getByRole("status").filter({ hasText: `용어를 더했습니다 — ${term} (숨김` }).waitFor();
  const row = await one("select id, char_length(plain) n, visible from public.glossary_terms where term = $1", [term]);
  staff.trackRow("glossary_terms", row.id);
  assert.deepEqual([row.n, row.visible], [61, false]);
  const onIndex = async () => (await (await fetch(`${base}/glossary`)).text()).includes(`data-glossary-term="${row.id}"`);
  const inSearch = async () => (await refsOf(term, "&tab=glossary")).items.some((i) => i.ref === String(row.id));
  assert.deepEqual([await onIndex(), await inSearch(), (await fetch(`${base}/glossary/${row.id}`)).status], [false, false, 404], "숨김 — 색인·검색 0, 용어 쪽 404");
  await page.getByRole("button", { name: `용어 ‘${term}’ 공개하기` }).click();
  await page.getByRole("button", { name: `용어 ‘${term}’ 숨기기` }).waitFor();
  assert.deepEqual([await onIndex(), await inSearch(), (await fetch(`${base}/glossary/${row.id}`)).status], [true, true, 200], "공개 — 바로 나온다");
  await page.getByRole("button", { name: `용어 ‘${term}’ 숨기기` }).click();
  await page.getByRole("button", { name: `용어 ‘${term}’ 공개하기` }).waitFor();
  assert.deepEqual([await onIndex(), await inSearch()], [false, false]);
});

test("10) GLO-01 용어 200개가 가나다 색인에서 모두 찾힌다 · 묶음은 첫소리 · 4대 분야마다 1개 이상 · 용어 쪽에 정의·쉬운 풀이·관련 용어·출처", async () => {
  const { page, res } = await open(`${base}/glossary`);
  assert.equal(res.status(), 200);
  const visible = (await db.query("select id from public.glossary_terms where visible")).rows.map((r) => Number(r.id)).sort((a, b) => a - b);
  assert.ok(visible.length >= 200, `공개 용어 ${visible.length}개`);
  const onPage = (await page.$$eval("[data-glossary-term]", (els) => els.map((e) => Number(e.getAttribute("data-glossary-term"))))).sort((a, b) => a - b);
  assert.deepEqual(onPage, visible, "공개 용어마다 한 칸 — 빠짐·겹침 0");
  for (const b of fx.bulk) assert.ok(onPage.includes(b.id), b.term);
  const CHO = ["ㄱ", "ㄱ", "ㄴ", "ㄷ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅂ", "ㅅ", "ㅅ", "ㅇ", "ㅈ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  for (const b of fx.bulk) {
    const group = await page.locator(`[data-glossary-term="${b.id}"]`).evaluate((el) => el.closest("[data-glossary-group]").getAttribute("data-glossary-group"));
    assert.equal(group, CHO[Math.floor((b.term.codePointAt(0) - 0xac00) / 588)], `${b.term} 묶음`);
    assert.ok(INITIALS.includes(group));
  }
  const nav = await page.$$eval('[data-part="glossary-index"] li', (lis) => lis.map((li) => li.textContent.trim()));
  assert.deepEqual(nav.slice(0, 14), INITIALS.slice(0, 14));
  // 4대 분야마다 1개 이상 (탭 = JS 없이 링크)
  for (const [key, label] of [["tax", "지방세"], ["realestate", "부동산"], ["finance", "부동산개발금융"], ["local", "지자체뉴스"]]) {
    const sec = await open(`${base}/glossary?section=${key}`, { javaScriptEnabled: false });
    const ids = await sec.page.$$eval("[data-glossary-term]", (els) => els.map((e) => Number(e.getAttribute("data-glossary-term"))));
    const expected = (await db.query("select id from public.glossary_terms where visible and $1 = any(section)", [key])).rows.map((r) => Number(r.id)).sort((a, b) => a - b);
    assert.ok(expected.length >= 1, `${label} 용어 1개 이상`);
    assert.deepEqual([...ids].sort((a, b) => a - b), expected, `${label} 분야 탭`);
  }
  // 용어 쪽 — 정의·쉬운 풀이·관련 용어·출처
  const t = await open(`${base}/glossary/${T.short.id}`);
  assert.equal((await t.page.locator("h1").textContent()).trim(), T.short.term);
  assert.equal((await t.page.locator('[data-term-part="plain"]').textContent()).trim(), "시험용 가짜 풀이 하나");
  assert.equal((await t.page.locator('[data-term-part="definition"] dd').textContent()).trim(), "시험용 가짜 뜻 하나");
  assert.equal((await t.page.locator('[data-term-part="source"] dd').textContent()).trim(), "시험용 가짜 출처");
  assert.deepEqual(await t.page.$$eval('[data-part="glossary-related"] li a', (as) => as.map((a) => a.getAttribute("href"))), [`/glossary/${T.long.id}`]);
});

// ── 11) GLO-02 ──────────────────────────────────────────
const articleUrl = () => `${base}/news/${fx.tipArticle.slug}`;
test("11) GLO-02 본문 풀이 — 용어마다 한 번 · 숨긴 용어 0 · 제목·링크 안 0 · 긴 용어 먼저 · 본문 글자 그대로", async () => {
  const { page } = await open(articleUrl());
  const counts = await page.$$eval("[data-glossary-tip]", (els) => {
    const o = {};
    for (const e of els) o[e.getAttribute("data-term-id")] = (o[e.getAttribute("data-term-id")] ?? 0) + 1;
    return o;
  });
  for (const k of ["short", "long", "prefix", "latin"]) assert.equal(counts[T[k].id], 1, `${k}: 한 번`);
  assert.equal(counts[T.hidden.id], undefined, "숨긴 용어 0");
  assert.equal(await page.locator("h1 [data-glossary-tip], a [data-glossary-tip]").count(), 0, "제목·링크 안 0");
  const where = (id) => page.locator(`[data-glossary-tip][data-term-id="${id}"]`).evaluate((el) => [el.closest("[data-block-index]").getAttribute("data-block-index"), el.querySelector("[data-tip-trigger]").textContent]);
  assert.deepEqual(await where(T.short.id), ["1", T.short.term], "링크 안(0번 문단)이 아니라 1번 문단");
  assert.deepEqual(await where(T.long.id), ["1", T.long.term], "긴 용어(…세율)가 짧은 용어(…세)보다 먼저");
  assert.deepEqual(await where(T.prefix.id), ["2", T.prefix.term], "'지방…세' 안의 '…세'에는 붙지 않는다");
  const para = await page.locator('[data-block-index="1"] p').evaluate((p) => {
    const c = p.cloneNode(true);
    c.querySelectorAll("[data-tip-pop]").forEach((x) => x.remove());
    return c.textContent;
  });
  assert.equal(para, `${T.long.term}은 ${T.short.term}를 매기는 비율이다. ${T.short.term}는 두 번 나온다.`);
});

test("11) GLO-02 키보드 — Tab 포커스로 열리고 Esc로 닫힌다(포커스는 용어 단추) · JS가 꺼져도 포커스로 열림 · glossary_opened 1건", async () => {
  const mark = await eventMark();
  const { page } = await open(articleUrl());
  const root = page.locator(`[data-glossary-tip][data-term-id="${T.short.id}"]`);
  const trigger = root.locator("[data-tip-trigger]");
  const pop = root.locator("[data-tip-pop]");
  assert.equal(await pop.isVisible(), false, "평소 숨김");
  await page.locator('[data-block-index="0"] a[href="/news"]').focus();
  for (let i = 0; i < 12 && !(await trigger.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  assert.ok(await trigger.evaluate((el) => el === document.activeElement), "Tab으로 용어 단추에 닿는다");
  await pop.waitFor({ state: "visible" });
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  assert.match(await pop.textContent(), /시험용 가짜 풀이 하나/);
  assert.equal(await pop.locator("a").getAttribute("href"), `/glossary/${T.short.id}`);
  await page.keyboard.press("Escape");
  await pop.waitFor({ state: "hidden" });
  assert.ok(await trigger.evaluate((el) => el === document.activeElement), "Esc 뒤에도 포커스는 용어 단추");
  const opened = await waitEvents("glossary_opened", mark, 1);
  assert.deepEqual(opened.filter((e) => e.props.term_id === T.short.id).map((e) => e.section), ["tax"]);
  const off = await open(articleUrl(), { javaScriptEnabled: false });
  const r2 = off.page.locator(`[data-glossary-tip][data-term-id="${T.short.id}"]`);
  await r2.locator("[data-tip-trigger]").focus();
  await r2.locator("[data-tip-pop]").waitFor({ state: "visible" });
});

// ── 12) p95 ─────────────────────────────────────────────
test("12) 검색 응답 p95 ≤ 800ms — 실제 GET /api/search · /search 화면 경로, 기사 3,000건을 더한 자료 (2만 건 하네스는 pnpm test:search-perf)", { timeout: 10 * 60_000 }, async () => {
  const lit = (xs) => `array[${xs.map((x) => `'${x.replaceAll("'", "''")}'`).join(", ")}]::text[]`;
  const SENT = ["올해 지방세 세입 예산은 지난해보다 소폭 늘어난 것으로 집계됐다.", "주택을 산 사람은 취득일로부터 60일 안에 취득세를 신고하고 납부해야 한다.", "재건축 조합원 입주권을 물려받는 경우 상속세와 취득세를 함께 따져야 한다.", "재개발 구역의 관리처분 인가 이후에는 세금 부담이 달라질 수 있다.", "재산세 과세표준은 공시가격에 공정시장가액비율을 곱해 정한다.", "자동차를 팔거나 폐차하면 남은 기간의 자동차세를 돌려받을 수 있다.", "행정안전부는 지방세제 개편안을 발표하고 의견을 듣는다고 밝혔다.", "부모님 집을 증여받을 때에는 증여세 외에 취득세도 내야 한다.", "지방세 감면 조례는 지자체마다 내용이 다르므로 확인이 필요하다.", "세금을 돌려받으려면 경정청구 기한 안에 신청해야 한다.", "신속통합기획 대상지로 선정되면 정비계획 수립 기간이 줄어든다.", "이 사업장은 신탁사의 책임준공 확약 이행 여부를 두고 소송이 진행 중이다."];
  const WORDS = ["취득세", "재산세", "지방세", "재건축", "재개발", "상속", "증여", "개편안", "감면", "신탁"];
  await db.query("select setseed(0.42)");
  const t0 = Date.now();
  await db.query(
    `insert into public.articles (slug, title, summary, body, section, content_type, status, author_id, first_published_at)
     select '${SLUG_PREFIX}-fill-' || g || '-' || $2::text, (${lit(WORDS)})[1 + g % ${WORDS.length}] || ' ' || (${lit(WORDS)})[1 + (g * 3) % ${WORDS.length}] || ' 시험 ' || g,
            (${lit(SENT)})[1 + (g * 7) % ${SENT.length}],
            jsonb_build_object('claims', '[]'::jsonb, 'blocks', (select jsonb_agg(jsonb_build_object('type', 'paragraph', 'text', (select string_agg((${lit(SENT)})[1 + floor(random() * ${SENT.length})::int], ' ') from generate_series(1, 5)) || n::text)) from generate_series(1, 9) n)),
            (array['tax', 'realestate', 'finance', 'local'])[1 + g % 4], 'explainer', 'published', $1::bigint, now() - make_interval(hours => g % 4000)
     from generate_series(1, $3::int) g`,
    [u.reporter.personId, staff.run.toLowerCase(), FILL_ARTICLES],
  );
  await db.query("analyze public.articles");
  const seedMs = Date.now() - t0;
  const queries = ["지방세", "취득세", "취득 세", "재건축", "재 건축", "개편안", "차 팔았", "성동구 재개발", "책임준공 확약", "없는낱말큐엑스", "세"];
  try {
    const timed = async (url, headers) => {
      const s = performance.now();
      const res = await fetch(url, { headers });
      await res.arrayBuffer();
      const ms = performance.now() - s;
      assert.equal(res.status, 200, url);
      return ms;
    };
    const api = [];
    const screen = [];
    for (const s of queries) {
      await timed(`${base}/api/search?${q(s)}`, { "x-real-ip": nextIp(), "user-agent": HUMAN_UA });
      for (let i = 0; i < 12; i++) api.push(await timed(`${base}/api/search?${q(s)}`, { "x-real-ip": nextIp(), "user-agent": HUMAN_UA }));
      for (let i = 0; i < 4; i++) screen.push(await timed(searchUrl(s), { "x-real-ip": nextIp(), "user-agent": HUMAN_UA }));
    }
    const big = await refsOf("지방세", "&tab=article");
    assert.ok(big.total >= FILL_ARTICLES / 4, `흔한 낱말의 결과 ${big.total}건 — 최악의 결과 수 규모`);
    console.log(`수용 시험 p95 — 기사 ${FILL_ARTICLES.toLocaleString()}건 추가(넣기 ${(seedMs / 1000).toFixed(1)}초) · API ${api.length}회 p50 ${pct(api, 50).toFixed(0)}ms p95 ${pct(api, 95).toFixed(0)}ms 최대 ${Math.max(...api).toFixed(0)}ms · 화면 ${screen.length}회 p50 ${pct(screen, 50).toFixed(0)}ms p95 ${pct(screen, 95).toFixed(0)}ms 최대 ${Math.max(...screen).toFixed(0)}ms`);
    assert.ok(pct(api, 95) <= P95_LIMIT_MS, `API p95 ${pct(api, 95).toFixed(0)}ms`);
    assert.ok(pct(screen, 95) <= P95_LIMIT_MS, `화면 p95 ${pct(screen, 95).toFixed(0)}ms`);
  } finally {
    await removeOwnRows();
    await db.query("vacuum public.articles");
  }
});

// ── 13) 화면 품질 ────────────────────────────────────────
test("13) 화면 규칙 R1~R3(360·640·1024) · 360px 가로 스크롤 0 · 접근성 95 — 검색 결과·결과 없음·용어사전·용어 쪽·풀이가 든 기사", async () => {
  const urls = [searchUrl(`${M} 취득세`), searchUrl(`없는낱말${M}`), `${base}/glossary`, `${base}/glossary/${T.short.id}`, articleUrl()];
  for (const url of urls) {
    for (const width of [360, 640, 1024]) {
      const r = await measurePage(browser, url, { width, height: 740 });
      if (width === 360) assert.ok(r.r1.pass, `${url} R1 ${r.r1.chars}자`);
      assert.ok(r.r2.pass, `${url} ${width}px R2`);
      assert.ok(r.r3.pass, `${url} ${width}px R3`);
    }
    const { page } = await open(url, { viewport: { width: 360, height: 740 } });
    assert.ok((await overflowOf(page)) <= 0, `${url}: 360px 가로 스크롤`);
  }
  for (const url of urls) {
    const r = await accessibility(url, debugPort);
    assert.ok(r.score >= A11Y_MIN, `${url} 접근성 ${r.score} — ${r.failing.join(", ")}`);
  }
});

// ── 14) 기능 키 ─────────────────────────────────────────
test("14) 기능 키를 끄면 바로 /search·/api/search·/glossary 404, 검색 폼·용어사전 링크 0 · 서버 기록에 예상 못 한 오류·검색어 원문 0", async () => {
  await setFeatures([]);
  assert.equal((await fetch(searchUrl(M))).status, 404);
  assert.equal((await searchApi(q(M))).status, 404);
  assert.equal((await fetch(`${base}/glossary`)).status, 404);
  assert.equal((await fetch(`${base}/glossary/${T.short.id}`)).status, 404);
  for (const p of ["/", "/tax", `/news/${fx.tipArticle.slug}`]) {
    const { page } = await open(`${base}${p}`);
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    assert.deepEqual(hrefs.filter((h) => /^\/(search|glossary)([/?#]|$)/.test(h)), [], `${p}: 검색·용어사전 링크 0`);
    assert.equal(await page.locator('form[action="/search"]').count(), 0);
  }
  const log = server.log();
  assert.doesNotMatch(log, /\[search\]|\[api\] 처리 중 오류|\[public\]|\[db\]|\[analytics\]/, "예상 못 한 서버 오류 0");
  for (const p of [RUN, ...fx.maskPieces]) assert.ok(!log.includes(p), `서버 기록에 '${p}'`);
});

// ── 15) 정리 ────────────────────────────────────────────
test("15) 정리 — 만든 계정·기사·용어·상황·트래커·지역·동의어·검색어 행·측정 이벤트를 지우면 표마다 시험 전 행 수, 운영 설정 값 그대로", async () => {
  for (const c of contexts) await c.close().catch(() => {});
  await removeOwnRows();
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
