// W3 수용 E2E (11단계) — PRD-01B 8장 W3 · PRD-01C 9장 W3(브랜드 부분) 증거 전부를 한 시험 자료·한 서버·한 브라우저로 (docs/dev/W3_설계.md 1장 11단계)
// 01B 증거: 2026 개편안 트래커 단계별 재현(PRD_최종 §11.1) · `입법예고` → `국회 제출` 시나리오 · SM 카드 표식 값 0 · 링크 점검 7·8일 경계
// 01C 증거: 증빙 없는 약력 렌더 0 · 서명 기록 없는 '감수 ○○' 0 · '50년' 승인 전 0
// 시험 자료는 전부 '시험용' 가짜다 — 개정안·원문·필자·증빙·동의서·감수 기록·바깥 사이트(이 프로세스의 가짜 서버). 세율·조문 내용·실제 주소 0.
// 자료는 편집국·운영 API로 만든다. API가 없는 PO 몫(개정안 공개 전환)만 DB로 한다.
//  1) 출발점 — PRD 증거 줄 · 기능 키가 모두 꺼진 출하 상태
//  2) TX-07·08 2026 개편안(가짜) 트래커 단계별 재현 — 단계마다 현재 단계·`확정 아님` 칩·타임라인, 시행 예정/시행(KST 날짜), 같은 기록을 새 개정안에 다시 넣으면 같은 화면
//  3) TX-02 입법예고 → 국회 제출 — 연결 기사 3건 갱신 배너·연결 안 한 기사 0·dateModified 불변·공포 뒤 칩 0
//  4) TX-01·06 /calc — 카드 정확히 그 묶음, 이동 주소 = 저장 주소 글자 단위, 표식 값 비전달(쿼리·조각·Referer·iframe·fetch), 누름 1번 = calculator_card_clicked 1건, 빈 주소 카드 0
//  5) TX-03 링크 점검 — ok/broken·같은 실행 키 한 벌·요청에 이용자 정보 0·끊긴 카드 대체 안내·7일 전 경고 0 / 8일 전 1 (배치·관리 화면)
//  6) TX-09 해석 해설 발행 — 원문 0 거부 · 감수 서명 없음 거부 · 갖추면 발행 · 목록·원문 블록
//  7) TX-14~17 칼럼 필자 — 이해관계·필자 검증·계약·고지 하나라도 빠지면 거부 · '없음'은 확인 기록 · 상세 이해관계 줄·고지 1개 · 목록 오피니언 배지
//  8) BR-01·02·03·07 브랜드 — 렌더 약력 = 승인 증빙 · 서명 없는 '감수 ○○' 0 · 오탈자 유지 / 실질 수정 0 + 재감수 큐 · 동의 철회 404 + 사이트맵 원본 0
//  9) BR-01·04 '50년' — 승인 전 0(제목·메타·주소·JSON-LD·사이트맵 원본·검색), 승인 뒤 근거 링크와 함께만
// 10) TX-06 국세 미산출 검사 통과 · 공개 화면 국세 금액 입력 0 · 국세 계산 경로 404
// 11) CORE-02 홈 4대 분야 카드 4장 · 허브 포인트 3줄/4줄 거부/감수 전 숨김
// 12) SRCH·TX-17 검색 — 트래커·해석 원문 결과 · AI 색인 불허 칼럼 0
// 13) 360·1280px 가로 넘침 0 · 접근성 95 (주요 W3 화면)
// 14) 기능 키를 끄면 W3 화면 닫힘(상세 404·목록은 하위 분야 목록)
// 15) 정리 — 표마다 시험 전 행 수, 운영 설정·바깥 연결 값 그대로
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { ROOT, buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { importSource } from "./lib/ts-source.mjs";
import { formControlHits } from "../scripts/check-national-tax.mjs";

const ADMIN_EMAIL = "w3-acceptance-po@example.test";
const SITE = "https://e2e.example.test";
const CRON = "w3-acceptance-cron-secret";
const MARKER = "MARKERw3acc5521";
const TITLE_50 = "시험용 수용 연재 50년";
const REVIEWER_NAME = "시험용 수용 감수위원";
const W3_FLAGS = ["calc", "sm_calculator", "amendments", "interpretations", "tax_columns", "people_pages", "brand_copy"];
/** 시험 전 최대 번호를 기억해 이 시험이 더한 행만 지우는 표 (번호로 고른다 — 프로세스 시계 차이와 상관없이) */
const MARKED = ["agent_runs", "analytics_events", "audit_logs", "audit_log_changes", "official_link_checks", "raw_snapshots", "legal_docs", "legal_doc_review_queue", "column_contracts", "column_meta_history", "author_verifications", "seo_checks"];

let sb, server, staff, db, browser, base, debugPort, target, tBase, hasClaimToken, compareRendered;
const u = {};
const fx = { briefs: [] };
const marks = {};
const before0 = {};
let linksSnapshot = [];
let throttleKeys = new Set();
let cleaned = false;
let editorContext = null;
/** 가짜 바깥 사이트가 받은 요청 (점검 배치·새 창 이동) */
const outgoing = [];

// ── 도우미 ──────────────────────────────────────────────
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const count = async (sql, params) => Number((await one(sql, params)).n);
const show = (r) => JSON.stringify(r.body).slice(0, 900);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kst = (plusDays = 0) => new Date(Date.now() + 9 * 3600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
const visible = (html) =>
  decode(html.replace(/<head[\s\S]*?<\/head>/, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
/** 화면 글자가 아닌 곳 — 머리(제목·메타·공유 미리보기)·JSON-LD·주소(href·src) */
function machineParts(html) {
  const head = html.match(/<head[\s\S]*?<\/head>/)?.[0] ?? "";
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join(" ");
  const urls = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => decode(m[1])).join(" ");
  return { head: decode(head), ld, urls };
}
const jsonLdOf = (html) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, "JSON-LD 스크립트가 없다");
  const raw = JSON.parse(m[1]);
  return Array.isArray(raw) ? raw : [raw];
};
const errorFields = (r) => (r.body.errors ?? []).map((e) => String(e).split(":")[0]);
const auditCount = (action, targetName) => count("select count(*)::int n from public.audit_logs where id > $1 and action = $2 and target = $3", [marks.audit_logs, action, targetName]);

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function expectStatus(promise, status, what) {
  const r = await promise;
  assert.equal(r.status, status, `${what}: ${show(r)}`);
  return r;
}
async function page(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}
async function searchApi(q, extra = "") {
  const res = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}${extra}`);
  assert.equal(res.status, 200, `/api/search ${q}`);
  return res.json();
}
async function setFlags(patch) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  await expectStatus(api("PATCH", "/settings/feature_flags", u.admin, { value: { ...cur, ...patch } }), 200, `기능 키 ${JSON.stringify(patch)}`);
}
const amendments = (body) => api("POST", "/amendments", u.editor, body);
const columns = (user, body) => api("POST", "/columns", user, body);
const brand = (user, body) => api("POST", "/brand", user, body);
const legalDocs = (body) => api("POST", "/legal-docs", u.editor, body);
const linkId = async (kind, key) => Number((await one("select id from public.official_links where kind = $1 and key = $2", [kind, key])).id);
const setLink = (id, patch) => expectStatus(api("POST", "/official-links", u.editor, { op: "update", id, ...patch }), 200, `바깥 연결 ${id}`);
const slugOf = (label) => `e2e-w3acc-${label}-${staff.run}`;
const BODY = (text) => ({ blocks: [{ type: "paragraph", text }], claims: [] });

/** 편집국 API로 기사 만들기 — 원고 → (편집 승인) → (발행). 시험 정리가 지우게 번호를 적어 둔다 */
async function createArticle(label, user, input) {
  const r = await expectStatus(api("POST", "/articles", user, { slug: slugOf(label), legalBasisDate: "2026-10-01", ...input }), 201, `기사 만들기 ${label}`);
  const id = Number(r.body.article.id);
  staff.trackArticle(id);
  return { id, slug: slugOf(label), href: `/news/${slugOf(label)}`, title: input.title };
}
const deskApprove = (a) => expectStatus(api("POST", `/articles/${a.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve" }), 201, `편집 승인 ${a.slug}`);
const taxApprove = (a) => expectStatus(api("POST", `/articles/${a.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" }), 201, `세무 감수 ${a.slug}`);
const publish = (a) => api("POST", `/articles/${a.id}/publish`, u.editor);
const statusOf = async (a) => (await one("select status from public.articles where id = $1", [a.id])).status;
const notPublished = async (a, what) => assert.ok(!["published", "scheduled"].includes(await statusOf(a)), `${what} — 기사는 발행되지 않은 그대로`);

/** 트래커 상세의 진행 단계 영역 — 현재 단계 글자·`확정 아님` 칩·6칸(상태·글자·날짜·원문) */
function timelineSection(html) {
  return html.match(/<section[^>]*data-part="timeline"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? null;
}
function stageView(html) {
  const sec = html.match(/<div data-ui="progress-stage-badge"[\s\S]*?<\/ol>/)?.[0] ?? "";
  return {
    current: sec.match(/data-part="current-label">([^<]*)</)?.[1] ?? null,
    chip: /data-ui="unconfirmed-chip"/.test(sec),
    cells: [...sec.matchAll(/<li[^>]*data-stage-cell="([a-z_]+)" data-state="([a-z]+)"[\s\S]*?<\/li>/g)].map((m) => ({
      stage: m[1],
      state: m[2],
      label: m[0].match(/data-part="stage-label"[^>]*>([^<]*)</)?.[1] ?? null,
      date: m[0].match(/font-mono[^"]*">(\d{4}-\d{2}-\d{2})</)?.[1] ?? null,
      src: m[0].match(/href="([^"]+)"/)?.[1] ?? null,
    })),
  };
}
const STAGES = ["announced", "pre_notice", "submitted", "passed", "promulgated", "effective"];
const LABEL = { announced: "발표", pre_notice: "입법예고", submitted: "국회 제출", passed: "의결", promulgated: "공포", effective: "시행" };
const banner = (html) => html.match(/data-ui="update-banner"[\s\S]{0,3000}?<\/aside>/)?.[0] ?? null;
const modified = (html) => html.match(/"dateModified":"([^"]+)"/)?.[1] ?? null;
const markCount = (html) => (html.match(/data-part="review-mark"/g) ?? []).length;
const cardsOf = (html) => [...html.matchAll(/data-link-card="([^"]+)"/g)].map((m) => m[1]);
/** /calc 묶음 — SM 카드 목록(외부 계산기 절 앞까지)·외부 계산기 목록 */
// W10-b 허브: 세목 카드는 한 목록(tool-cards) - 게이트가 닫힌 동안은 SM 카드만 들어 있다
const smPart = (html) => html.slice(html.indexOf('data-part="tool-cards"'), html.includes('id="calc-external"') ? html.indexOf('id="calc-external"') : undefined);
const externalPart = (html) => (html.includes('data-part="external-cards"') ? html.slice(html.indexOf('data-part="external-cards"')) : "");
/** 카드 하나 — 다음 카드 또는 목록 끝까지 (끊긴 카드 안에는 대체 안내 목록이 들어 있다) */
const cardBlock = (html, key) => html.match(new RegExp(`<li data-link-card="${key}"[\\s\\S]*?</li>\\s*(?=<li data-link-card|</ul>\\s*(?:</section>|</main>))`))?.[0] ?? "";
/** 렌더된 공개 HTML의 국세 금액 입력 칸 — 검사 스크립트와 같은 함수 + 숫자 입력 칸 (W3 설계 2.7) */
const amountInputs = (html) => [...formControlHits(html).map((h) => h.note), ...[...html.matchAll(/<input\b[^>]*>/gi)].filter((m) => /type="number"|inputmode="(numeric|decimal)"/i.test(m[0])).map((m) => m[0])];
const eventsAfter = async (name, mark) => (await db.query("select * from public.analytics_events where id > $1 and name = $2 order by id", [mark, name])).rows;
async function waitEvents(name, mark, n) {
  for (let i = 0; i < 60; i++) {
    const rows = await eventsAfter(name, mark);
    if (rows.length >= n) return rows;
    await sleep(100);
  }
  return eventsAfter(name, mark);
}
const maxId = async (table) => Number((await one(`select coalesce(max(id), 0) m from public.${table}`)).m);
async function runJob() {
  const res = await fetch(`${base}/api/jobs/link-check`, { method: "POST", headers: { authorization: `Bearer ${CRON}`, "x-job-trigger": "scheduler" } });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return (await one("select detail from public.agent_runs where id = $1", [body.runId])).detail;
}

// ── 정리·잔여 ───────────────────────────────────────────
async function residue(client) {
  const tables = (await client.query("select table_name t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).rows.map((r) => r.t);
  const out = {};
  for (const t of tables) out[t] = (await client.query(`select count(*)::int n from public."${t}"`)).rows[0].n;
  out["auth.users"] = (await client.query("select count(*)::int n from auth.users")).rows[0].n;
  out.settings = JSON.stringify((await client.query("select key, value, updated_by from public.settings order by key")).rows);
  out.official_links = JSON.stringify((await client.query("select * from public.official_links order by id")).rows);
  return out;
}
const throttleKey = (r) => `${r.scope}|${r.key_hash}|${new Date(r.window_start).toISOString()}`;
async function removeOwnRows() {
  const articleIds = [...staff.articleIds];
  await db.query("begin");
  try {
    // 트리거·외래 키 검사를 끈 세션 — 이 시험이 만든 행만 (기사 번호·시험 전 최대 번호로 고른다)
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.article_legal_docs where article_id = any($1::bigint[]) or legal_doc_id > $2", [articleIds, marks.legal_docs]);
    await db.query("delete from public.interpretation_articles where article_id = any($1::bigint[])", [articleIds]);
    await db.query("delete from public.column_meta where article_id = any($1::bigint[])", [articleIds]);
    // W10-d 표 — 외래 키 검사를 끈 세션에서는 legal_docs 삭제가 아래 표로 번지지 않는다(제품은 on delete cascade). 이 시험이 만든 문서의 원문·공개 보류를 함께 지운다
    await db.query("delete from public.legal_doc_texts where legal_doc_id > $1", [marks.legal_docs]);
    await db.query("delete from public.legal_doc_holds where legal_doc_id > $1", [marks.legal_docs]);
    for (const t of MARKED) await db.query(`delete from public.${t} where id > $1`, [marks[t]]);
    for (const s of linksSnapshot) {
      const cols = Object.keys(s).filter((k) => k !== "id");
      await db.query(`update public.official_links set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1`, [s.id, ...cols.map((c) => s[c])]);
    }
    const { rows } = await db.query("select scope, key_hash, window_start from public.request_throttles");
    for (const r of rows) if (!throttleKeys.has(throttleKey(r))) await db.query("delete from public.request_throttles where scope = $1 and key_hash = $2 and window_start = $3", [r.scope, r.key_hash, r.window_start]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  ({ hasClaimToken } = await importSource(pathToFileURL(path.join(ROOT, "apps", "web", "lib", "brand", "claim.ts")).href));
  ({ compareRendered } = await importSource(pathToFileURL(path.join(ROOT, "packages", "structured-data", "src", "compare.ts")).href));
  // 가짜 바깥 사이트 — SM 계산기·안심 계산기·위택스·국세청 자리. /missing 은 404, 나머지는 200. 받은 요청의 주소·머리글만 적는다
  target = http.createServer((req, res) => {
    outgoing.push({ method: req.method, url: req.url, headers: req.headers });
    if (req.url.startsWith("/missing")) res.writeHead(404).end("no");
    else res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<!doctype html><title>시험용 바깥 사이트</title><p>시험용</p>");
  });
  // 이 사이트(127.0.0.1)와 다른 호스트 이름(localhost)으로 연다 — 운영의 SM 사이트처럼 다른 사이트라 이 사이트의 쿠키가 가지 않는다
  await new Promise((r) => target.listen(0, r));
  tBase = `http://localhost:${target.address().port}`;
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: CRON,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  for (const t of MARKED) marks[t] = await maxId(t);
  linksSnapshot = (await db.query("select * from public.official_links order by id")).rows;
  throttleKeys = new Set((await db.query("select scope, key_hash, window_start from public.request_throttles")).rows.map(throttleKey));
  Object.assign(before0, await residue(db));
  u.admin = await staff.createUser({ label: "w3acc-po", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w3acc-editor", roles: ["editor"], person: { name: "수용 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w3acc-reporter", roles: ["reporter"], person: { name: "수용 시험 기자", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "w3acc-reviewer", roles: ["reviewer"], person: { name: REVIEWER_NAME, roles: ["reviewer"] } });
  u.writer = await staff.createUser({ label: "w3acc-writer", roles: ["reporter"], person: { name: "시험용 수용 필자", roles: ["writer"] } });
  u.ops = await staff.createUser({ label: "w3acc-ops", roles: ["brand_ops"] });
  u.guest = await staff.createUser({ label: "w3acc-guest", roles: ["reporter"], person: { name: "시험용 동의 철회 인물", roles: ["reporter"], consent: false } });
  fx.writerSlug = (await one("select slug from public.people where id = $1", [u.writer.personId])).slug;
  fx.guestSlug = (await one("select slug from public.people where id = $1", [u.guest.personId])).slug;
  fx.reviewerSlug = (await one("select slug from public.people where id = $1", [u.reviewer.personId])).slug;
  fx.cat = Object.fromEntries((await db.query("select section || '/' || slug k, id from public.categories")).rows.map((r) => [r.k, Number(r.id)]));
  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
});

after(async () => {
  try {
    await editorContext?.close().catch(() => {});
    await browser?.close();
    if (!cleaned && staff) {
      await removeOwnRows();
      await staff.cleanup();
    }
  } finally {
    server?.stop();
    target?.closeAllConnections?.();
    target?.close();
  }
});

// ── 1) 출발점 ───────────────────────────────────────────
test("1) 출발점 — PRD 8장·9장 W3 증거 줄 · 출하 상태는 W3 기능 키가 모두 꺼져 있고 /calc 404·트래커·해석 목록 0", async () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, "docs", "PRD", f), "utf8").split("\n");
  const row01b = read("PRD-01B_1단계_4대분야_콘텐츠.md").find((l) => l.startsWith("| W3 (지방세) |"));
  const row01c = read("PRD-01C_1단계_공통서비스_브랜드_수익.md").find((l) => l.startsWith("| W3 (브랜드 부분) |"));
  for (const phrase of ["2026 개편안 트래커 단계별 재현", "`입법예고` → `국회 제출` 시나리오", "SM 카드 표식 값 0", "링크 점검 7·8일 경계"]) assert.ok(row01b?.includes(phrase), `01B 8장 W3 증거: ${phrase}`);
  for (const phrase of ["증빙 없는 약력 렌더 0", "서명 기록 없는 '감수 김의효' 0", "'50년' 승인 전 0"]) assert.ok(row01c?.includes(phrase), `01C 9장 W3 증거: ${phrase}`);

  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.deepEqual(W3_FLAGS.filter((k) => flags[k] !== false), [], "W3 기능 키는 꺼진 채 출하");
  assert.equal((await page("/calc")).status, 404, "/calc 404");
  const list = await page("/tax/amendments");
  assert.equal(list.status, 200, "트래커 주소는 하위 분야 목록(12장 #20)");
  assert.ok(!list.html.includes('data-part="amendment-list"'), "트래커 목록 0");
  assert.ok(!(await page("/tax/interpretations")).html.includes('data-part="interpretation-list"'), "해석 해설 목록 0");
  const links = (await one("select count(*)::int n from public.official_links where url is not null")).n;
  assert.equal(links, 0, "바깥 연결 주소는 비운 채 출하(코드에 주소 0)");
});

// ── 2) 트래커 단계별 재현 ────────────────────────────────
test("2) TX-07·08 시험용 「2026년 지방세제 개편안」 트래커 단계별 재현 — 단계마다 현재 단계·확정 아님 칩·타임라인, 시행 예정 → 시행(KST 날짜), 같은 기록을 새 개정안에 넣으면 같은 화면", async () => {
  const create = async (key) => {
    const r = await expectStatus(amendments({ op: "create", slug: slugOf(`am-${key}`), title: `시험용 「2026년 지방세제 개편안」(가짜) ${staff.run}`, lawNames: ["시험용 가짜 지방세법"] }), 201, `개정안 ${key}`);
    const am = { id: Number(r.body.amendment.id), slug: r.body.amendment.slug, events: {} };
    staff.trackRow("amendments", am.id);
    assert.equal(r.body.amendment.status, "draft", "만들면 공개 전 초안");
    // 공개 전환은 PO 몫 — 관리 화면이 아직 없어 DB로 (W3 설계 11장 3·4단계 '하지 않은 것')
    await db.query("update public.amendments set status = 'public' where id = $1", [am.id]);
    return am;
  };
  fx.am = await create("a");
  assert.equal((await page(`/tax/amendments/${fx.am.slug}`)).status, 404, "기능 키 amendments 꺼짐 → 상세 404");
  await setFlags({ amendments: true, search: true });
  const empty = stageView((await page(`/tax/amendments/${fx.am.slug}`)).html);
  assert.equal(empty.current, null, "기록 전에는 단계 배지 대신 안내");

  // 개정 브리핑 기사 4건(편집국 API — 원고 → 편집 승인 → 발행), 3건을 개정안에 연결
  for (let i = 1; i <= 4; i++) {
    const a = await createArticle(`brief-${i}`, u.reporter, { title: `시험용 개편안 브리핑 ${i} ${staff.run}`, summary: "시험용 가짜 브리핑입니다", section: "tax", contentType: "explainer", body: BODY("시험용 가짜 브리핑 본문입니다.") });
    await deskApprove(a);
    await expectStatus(publish(a), 200, `발행 ${a.slug}`);
    fx.briefs.push(a);
  }
  // 브리핑 3은 연결 전에 실질 수정 — dateModified가 있는 기사도 배너 때문에 값이 바뀌지 않는지 본다(나머지는 실질 수정 전이라 dateModified 없음)
  await expectStatus(api("PATCH", `/articles/${fx.briefs[2].id}`, u.editor, { summary: "시험용 가짜 브리핑을 보완했습니다", updateKind: "substantive", reason: "시험용 보완" }), 200, "연결 전 실질 수정");
  for (const a of fx.briefs.slice(0, 3)) await expectStatus(amendments({ op: "link", articleId: a.id, amendmentId: fx.am.id }), 201, `연결 ${a.slug}`);
  fx.dateModified = [];
  for (const a of fx.briefs) fx.dateModified.push(modified((await page(a.href)).html));
  assert.deepEqual(fx.dateModified.map(Boolean), [false, false, true, false], "dateModified는 실질 수정한 기사에만");

  // 단계 기록 — 날짜는 시험용(오늘 기준 상대 날짜), 원문 주소·스냅샷도 시험용
  fx.today = kst(0);
  fx.plan = [
    ["announced", kst(-40)],
    ["pre_notice", kst(-30)],
    ["submitted", kst(-20)],
    ["passed", kst(-10)],
    ["promulgated", kst(-5)],
    ["effective", kst(1)],
  ];
  const event = (am, stage, occurredOn, extra = {}) => ({
    op: "event",
    amendmentId: am.id,
    stage,
    occurredOn,
    sourceUrl: `https://example.test/e2e-w3acc-${staff.run}/${stage}`,
    snapshotPayload: `시험용 가짜 원문 ${stage} ${staff.run}`,
    ...extra,
  });
  fx.replay = async (am, check) => {
    for (const [i, [stage, on]] of fx.plan.entries()) {
      const r = await expectStatus(amendments(event(am, stage, on)), 201, `${stage} 기록`);
      am.events[stage] = r.body.event.id;
      if (check) await check(i, stage, on);
    }
    // 시행일 정정 — 내일 → 오늘(KST). D 00:00(KST)부터 '시행'
    await expectStatus(amendments({ ...event(am, "effective", fx.today), op: "correct", correctionOf: am.events.effective, reason: "시험용 시행일 정정" }), 201, "시행일 정정");
  };
  const expectStep = (view, upto, { effectiveLabel = "시행" } = {}) => {
    const stage = STAGES[upto];
    const label = stage === "effective" ? effectiveLabel : LABEL[stage];
    assert.equal(view.current, label, `${stage}: 현재 단계 = 가장 늦은 기록`);
    assert.equal(view.chip, upto < STAGES.indexOf("promulgated"), `${stage}: 공포 전에만 '확정 아님' 칩`);
    assert.deepEqual(
      view.cells.map((c) => [c.stage, c.state]),
      STAGES.map((s, i) => [s, i <= upto ? "done" : "upcoming"]),
      `${stage}: 6칸 상태`,
    );
    for (const [i, c] of view.cells.entries()) {
      if (i > upto) continue;
      const on = c.stage === "effective" && effectiveLabel === "시행" ? fx.today : fx.plan[i][1];
      assert.equal(c.date, on, `${c.stage} 날짜`);
      assert.equal(c.src, `https://example.test/e2e-w3acc-${staff.run}/${c.stage}`, `${c.stage} 원문 링크`);
      assert.equal(c.label, c.stage === "effective" ? effectiveLabel : LABEL[c.stage]);
    }
  };
  await fx.replay(fx.am, async (i, stage) => {
    const detail = stageView((await page(`/tax/amendments/${fx.am.slug}`)).html);
    expectStep(detail, i, { effectiveLabel: "시행 예정" });
    const list = (await page("/tax/amendments")).html;
    const card = stageView(list.match(new RegExp(`<li[^>]*data-amendment="${fx.am.slug}"[\\s\\S]*?</ol>`))?.[0] ?? "");
    assert.equal(card.current, detail.current, `${stage}: 목록 카드도 같은 단계`);
    assert.equal(card.chip, detail.chip, `${stage}: 목록 카드 칩`);
    if (stage === "pre_notice" || stage === "submitted") {
      for (const a of fx.briefs.slice(0, 3)) {
        const p = await page(a.href);
        const b = banner(p.html);
        assert.ok(b?.includes(LABEL[stage]), `${LABEL[stage]} 기록 직후 ${a.slug} 갱신 배너: ${b}`);
        if (stage === "submitted") assert.ok(!b.includes("입법예고"), "배너는 최신 단계 하나");
        assert.equal([...b.matchAll(/href="([^"]+)"/g)].filter((m) => m[1].startsWith("/tax/amendments/")).map((m) => m[1]).join(), `/tax/amendments/${fx.am.slug}`, "트래커 링크 1개");
        assert.ok(/data-ui="unconfirmed-chip"/.test(p.html), "공포 전 기사 머리 '확정 아님' 칩");
      }
      assert.equal(banner((await page(fx.briefs[3].href)).html), null, "연결 안 한 기사 배너 0");
    }
    if (stage === "promulgated") {
      const p = await page(fx.briefs[0].href);
      assert.ok(!/data-ui="unconfirmed-chip"/.test(p.html), "공포 기록 뒤 기사 칩 0");
    }
  });
  const html = (await page(`/tax/amendments/${fx.am.slug}`)).html;
  expectStep(stageView(html), 5, { effectiveLabel: "시행" });
  const dm = [];
  for (const a of fx.briefs) dm.push(modified((await page(a.href)).html));
  assert.deepEqual(dm, fx.dateModified, "배너가 바뀌어도 dateModified 불변 (TX-02)");
  const cur = await one("select current_stage, current_stage_on::text d from public.amendment_current_stages where amendment_id = $1", [fx.am.id]);
  assert.deepEqual([cur.current_stage, cur.d], ["effective", fx.today], "DB 현재 단계 = 정정된 시행 기록");

  // 빈 개정안에 같은 기록을 다시 넣으면 같은 화면 (PRD-01B TX-07 'W3 증거')
  fx.amB = await create("b");
  await fx.replay(fx.amB);
  const again = (await page(`/tax/amendments/${fx.amB.slug}`)).html;
  assert.equal(timelineSection(again), timelineSection(html), "타임라인 HTML 글자 단위 일치");
  assert.ok(timelineSection(html)?.length > 1000, "타임라인이 비어 있지 않다");
  if (kst(0) !== fx.today) console.log("주의: 시험 중 KST 날짜가 바뀌었다 — 시행 판정 재확인 필요");
  // 00:00~09:00(KST)에 돌면 UTC 날짜가 하루 앞이다 — 그때 '시행'이 나왔다면 서버가 UTC가 아니라 KST 날짜로 판정한 것이다
  if (new Date().toISOString().slice(0, 10) !== fx.today) console.log(`KST 경계 확인: UTC 날짜(${new Date().toISOString().slice(0, 10)})와 KST 날짜(${fx.today})가 다른 시각에 시행일 = KST 오늘 → '시행'`);
});

// ── 3) TX-02 갱신 배너 뒤 실질 수정 ─────────────────────────
test("3) TX-02 연결 기사 — 실질 수정 뒤 배너 0, 연결 해제 뒤 배너 0, 다른 연결 기사는 유지", async () => {
  const [a1, a2, a3] = fx.briefs;
  await expectStatus(api("PATCH", `/articles/${a2.id}`, u.editor, { summary: "시험용 실질 수정 요약입니다", updateKind: "substantive", reason: "시험용 실질 수정" }), 200, "실질 수정");
  assert.equal(banner((await page(a2.href)).html), null, "실질 수정 뒤 배너 0");
  await expectStatus(amendments({ op: "unlink", articleId: a1.id, amendmentId: fx.am.id }), 200, "연결 해제");
  assert.equal(banner((await page(a1.href)).html), null, "연결 해제 뒤 배너 0");
  assert.ok(banner((await page(a3.href)).html)?.includes("시행"), "수정하지 않은 연결 기사는 최신 단계 배너");
});

// ── 4) /calc ───────────────────────────────────────────
test("4) TX-01·06 /calc — 카드 묶음 정확히(SM 5 + 외부 1), 이동 주소 = 저장 주소 글자 단위, 표식 값 비전달(쿼리·조각·Referer·iframe·fetch), 누름 1번 = 1건, 국세 배지, 빈 주소 카드 0", async () => {
  fx.urls = {
    acquisition: `${tBase}/sm/acquisition?from=ltr&v=1`,
    property_tax: `${tBase}/sm/%EC%9E%AC%EC%82%B0%EC%84%B8`,
    transfer: `${tBase}/sm/sell/`,
    registration: `${tBase}/missing/registration`,
    comprehensive: `${tBase}/sm/comprehensive#top`,
    inheritance_gift: `${tBase}/ansim/`,
    wetax: `${tBase}/wetax`,
    nts: `${tBase}/nts`,
  };
  fx.links = {};
  for (const [key, kind] of [["acquisition", "sm_calculator"], ["property_tax", "sm_calculator"], ["transfer", "sm_calculator"], ["registration", "sm_calculator"], ["comprehensive", "sm_calculator"], ["inheritance_gift", "external_calculator"], ["wetax", "fallback"], ["nts", "fallback"]]) {
    fx.links[key] = await linkId(kind, key);
    await setLink(fx.links[key], { url: fx.urls[key], ...(kind === "sm_calculator" ? { termsNote: `시험용 이용 조건 ${key}` } : {}) });
  }
  assert.equal((await page("/calc")).status, 404, "calc 꺼짐 → 404");
  await setFlags({ calc: true, sm_calculator: true });
  const { status, html } = await page("/calc");
  assert.equal(status, 200);
  assert.deepEqual(cardsOf(smPart(html)), ["acquisition", "property_tax", "transfer", "registration", "comprehensive"], "SM 카드 정확히 5장·순서");
  assert.deepEqual(cardsOf(externalPart(html)), ["inheritance_gift"], "외부 계산기 1장");
  assert.deepEqual(cardsOf(html).sort(), ["acquisition", "comprehensive", "inheritance_gift", "property_tax", "registration", "transfer"], "화면 전체 카드 = 그 묶음(대체 안내는 카드 아님)");
  assert.ok(!/<iframe/i.test(html), "iframe 0");
  const card = (key) => cardBlock(html, key);
  for (const k of ["transfer", "inheritance_gift"]) assert.match(card(k), /data-tax-kind="national"/, `${k} 국세 배지`);
  for (const k of ["acquisition", "property_tax", "registration", "comprehensive"]) assert.match(card(k), /data-tax-kind="local"/);
  assert.deepEqual(amountInputs(html), [], "/calc 금액 입력 칸 0");

  // 브라우저 — 표식 값을 주소 쿼리·조각·검색 칸에 넣고 카드 누름
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const pg1 = await context.newPage();
    const fromCalc = [];
    pg1.on("request", (r) => fromCalc.push({ url: r.url(), type: r.resourceType(), body: r.postData() ?? "" }));
    await pg1.goto(`${base}/calc?ref=${MARKER}#${MARKER}`, { waitUntil: "networkidle" });
    const hrefs = await pg1.$$eval("[data-link-card] a[data-part=go]", (els) => els.map((a) => [a.closest("[data-link-card]").getAttribute("data-link-card"), a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]));
    const stored = Object.fromEntries((await db.query("select key, url from public.official_links where kind <> 'fallback' and url is not null")).rows.map((r) => [r.key, r.url]));
    assert.equal(hrefs.length, 6);
    for (const [key, href, tgt, rel] of hrefs) {
      assert.equal(href, stored[key], `${key} 이동 주소 = 저장 주소 (글자 단위)`);
      assert.equal(href, fx.urls[key]);
      assert.deepEqual([tgt, rel], ["_blank", "noopener noreferrer"], `${key} 새 창 · noreferrer`);
    }
    assert.equal(await pg1.locator("iframe").count(), 0, "iframe 0");
    const box = pg1.locator('input[name="q"]').first();
    if ((await box.count()) && (await box.isVisible())) await box.fill(MARKER);
    for (const [key, rank] of [["acquisition", 1], ["property_tax", 2]]) {
      const mark = await maxId("analytics_events");
      const before = outgoing.length;
      const [popup] = await Promise.all([context.waitForEvent("page"), pg1.click(`[data-link-card="${key}"] a[data-part="go"]`)]);
      await popup.waitForLoadState("load").catch(() => {});
      await waitEvents("calculator_card_clicked", mark, 1);
      await sleep(800);
      const rows = await eventsAfter("calculator_card_clicked", mark);
      assert.equal(rows.length, 1, `${key} 누름 1번 = 이벤트 1건`);
      assert.deepEqual(rows[0].props, { card: key, screen: "calc", rank }, "속성 = 카드 키·화면·차례");
      assert.ok(!JSON.stringify(rows[0]).includes(MARKER), "이벤트 행에 표식 값 0");
      assert.ok(!JSON.stringify(rows[0]).includes(tBase.replace("http://", "")), "이벤트 행에 바깥 주소 0");
      const sent = outgoing.slice(before).filter((o) => o.url.startsWith("/sm/"));
      const want = new URL(fx.urls[key]);
      assert.deepEqual(sent.map((o) => o.url), [want.pathname + want.search], `${key} 나가는 주소 = 저장 주소(쿼리 그대로·표식 값 0)`);
      for (const o of sent) {
        assert.equal(o.headers.referer, undefined, "Referer 0");
        assert.ok(!JSON.stringify(o.headers).includes(MARKER), "나가는 머리글에 표식 값 0");
        assert.equal(o.headers.cookie, undefined, "쿠키 0");
      }
      await popup.close();
    }
    const toTarget = fromCalc.filter((r) => r.url.startsWith(tBase));
    assert.deepEqual(toTarget, [], "/calc 화면 자체가 바깥 사이트로 보낸 요청(fetch·iframe·이미지) 0");
    const beacons = fromCalc.filter((r) => r.url.includes("/api/events"));
    assert.ok(beacons.length >= 1, "측정 전송");
    assert.ok(beacons.every((b) => !b.body.includes(MARKER) && !b.url.includes(MARKER)), "측정 전송에 표식 값 0");
  } finally {
    await context.close();
  }

  // 빈 주소 → 그 카드만 숨김('준비 중' 0)
  await setLink(fx.links.comprehensive, { url: "" });
  const four = (await page("/calc")).html;
  assert.deepEqual(cardsOf(smPart(four)), ["acquisition", "property_tax", "transfer", "registration"], "빈 주소 카드 0");
  assert.ok(!visible(four).includes("준비 중"), "'준비 중' 0");
  await setLink(fx.links.comprehensive, { url: fx.urls.comprehensive });
});

// ── 5) 링크 점검 ─────────────────────────────────────────
test("5) TX-03 링크 점검 — 2xx ok·404 broken·같은 실행 키 한 벌·요청에 이용자 정보 0·끊긴 카드 대체 안내 · 7일 전 경고 0 / 8일 전 1 (배치·관리 화면)", async () => {
  // 연속 2회 실패에 broken (FAM-04 · WETAX-01) - 지난 주 점검에서도 실패했다고 보고 실패 횟수를 1로 둔다
  await one("with u as (update public.official_links set fail_count = 1 where url is not null returning 1) select count(*)::int n from u");
  const before = outgoing.length;
  const first = await runJob();
  assert.deepEqual([first.targets, first.ok, first.broken, first.skipped], [8, 7, 1, 0], JSON.stringify(first));
  const sent = outgoing.slice(before);
  assert.equal(sent.length, 8, "주소가 있는 활성 연결마다 요청 1번");
  for (const o of sent) {
    for (const h of ["cookie", "referer", "authorization", "x-forwarded-for"]) assert.equal(o.headers[h], undefined, `${o.url} 점검 요청에 ${h} 0`);
    assert.equal(o.headers["user-agent"], "LTR-LinkCheck/1.0", "사이트 식별 문자열만");
  }
  const second = await runJob();
  assert.deepEqual([second.runKey, second.skipped, second.ok + second.broken], [first.runKey, 8, 0], "같은 실행 키 두 번째 = 건너뜀");
  assert.equal(outgoing.length, before + 8, "두 번째에는 바깥 요청 0");
  assert.equal(await count("select count(*)::int n from public.official_link_checks where run_key = $1 and id > $2", [first.runKey, marks.official_link_checks]), 8, "점검 기록 한 벌");
  const calc = (await page("/calc")).html;
  const broken = cardBlock(calc, "registration");
  assert.match(broken, /data-link-status="broken"/);
  assert.ok(!broken.includes('data-part="go"'), "끊긴 카드는 이동 링크 0");
  assert.ok(broken.includes(fx.urls.wetax) && broken.includes(fx.urls.nts), "대체 안내(위택스·국세청) 링크");

  // 7일 전 = 경고 0 / 8일 전 = 경고 1 — 배치(staleBeforeRun)와 관리 화면 경고 줄이 같은 규칙
  editorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ep = await editorContext.newPage();
  await ep.goto(`${base}/admin/login`);
  await ep.fill("#login-email", u.editor.email);
  await ep.fill("#login-password", u.editor.password);
  await ep.getByRole("button", { name: "로그인" }).click();
  await ep.waitForURL((url) => url.pathname !== "/admin/login");
  const acq = fx.links.acquisition;
  const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
  for (const [days, warn] of [[7, 0], [8, 1]]) {
    await db.query("update public.official_links set checked_at = $2 where url is not null and id <> $1", [acq, ago(0)]);
    await db.query("update public.official_links set checked_at = $2 where id = $1", [acq, ago(days)]);
    await db.query("delete from public.official_link_checks where link_id = $1 and run_key = $2 and id > $3", [acq, first.runKey, marks.official_link_checks]);
    await ep.goto(`${base}/admin/links`);
    const line = ep.locator('[data-part="warn-stale"]');
    assert.equal(await line.count(), warn, `${days}일 전 점검 — 관리 화면 경고 ${warn}`);
    if (warn) assert.match(await line.textContent(), /8일 이상 지난 연결이 1건/, "경고 글자 = 규칙(8일 이상)");
    const run = await runJob();
    assert.equal(run.staleBeforeRun, warn, `${days}일 전 점검 — 배치 경고 ${warn}`);
    assert.equal(run.ok, 1, "그 한 건만 다시 점검");
  }
});

// ── 6) 해석 해설 ─────────────────────────────────────────
test("6) TX-09 해석 해설 발행 — 원문 0이면 거부 · 세무 감수 서명 없이도 발행(작성자 책임, 간편 발행) · 서명은 발행 뒤에, 목록 필터·원문 블록", async () => {
  fx.docNo = `시험번호수용${staff.run}`;
  const doc = await expectStatus(
    legalDocs({ op: "create", docType: "ruling", issuer: "시험용수용기관", docNo: fx.docNo, decidedOn: "2026-02-03", taxKinds: ["시험세목"], provisions: ["시험법 제3조"], sourceUrl: "https://example.test/e2e-w3acc-doc", rightsStatus: "confirmed", snapshotPayload: `시험용 가짜 원문 ${staff.run}` }),
    201,
    "원문 입력",
  );
  fx.doc = Number(doc.body.legalDoc.id);
  fx.explainer = await createArticle("explainer", u.reporter, { title: `시험용 수용 해석 해설 ${staff.run}`, summary: "시험용 가짜 해설입니다", section: "tax", contentType: "explainer", body: BODY("시험용 가짜 해설 본문입니다.") });
  await expectStatus(legalDocs({ op: "mark", articleId: fx.explainer.id }), 201, "해설 지정");
  await deskApprove(fx.explainer);
  const noDoc = await publish(fx.explainer);
  assert.ok(noDoc.status === 409 || noDoc.status === 422, `원문 0 발행 거부 ${show(noDoc)}`);
  assert.match(JSON.stringify(noDoc.body), /원문/, "거부 사유 = 원문");
  await notPublished(fx.explainer, "원문 0");
  await expectStatus(legalDocs({ op: "link", articleId: fx.explainer.id, legalDocId: fx.doc, role: "subject" }), 201, "원문 연결");
  // 간편 발행 (2026-10-31 PO 결정) — 세무 감수 서명이 없어도 발행된다(작성자 책임 발행 기록). 서명은 발행 뒤에도 남길 수 있다
  await expectStatus(publish(fx.explainer), 200, "감수 서명 없이 발행 (작성자 책임)");
  const pub = await one("select status, tax_review_status from public.articles where id = $1", [fx.explainer.id]);
  assert.equal(pub.status, "published");
  assert.notEqual(pub.tax_review_status, "approved", "서명 전에는 감수 완료가 아니다");
  await taxApprove(fx.explainer);

  await setFlags({ interpretations: true });
  const list = await page("/tax/interpretations?type=ruling");
  assert.ok(list.html.includes(`data-article="${fx.explainer.slug}"`), "예규 필터에 해설");
  assert.ok(!(await page("/tax/interpretations?type=tribunal")).html.includes(`data-article="${fx.explainer.slug}"`), "심판 필터에는 0");
  const detail = await page(fx.explainer.href);
  assert.ok(detail.html.includes('data-part="legal-docs"') && detail.html.includes(`data-legal-doc="${fx.doc}"`), "원문 블록");
});

// ── 7) 칼럼 필자 ─────────────────────────────────────────
test("7) TX-14~17 칼럼 필자 — 이해관계·필자 검증·계약·고지 하나라도 빠지면 발행 거부, '없음'은 확인 기록, 상세 이해관계 줄·고지 1개, 목록 오피니언 배지", async () => {
  await setFlags({ tax_columns: true });
  const writer = u.writer.personId;
  fx.col = await createArticle("col", u.writer, { title: `시험용 수용 칼럼 ${staff.run}`, summary: "시험용 가짜 칼럼입니다", section: "tax", categoryId: fx.cat["tax/columns"], contentType: "opinion", body: BODY("시험용 가짜 칼럼 본문입니다.") });
  await deskApprove(fx.col);
  const refused = async (what, pattern) => {
    const r = await publish(fx.col);
    assert.ok(r.status === 409 || r.status === 422, `${what} — 발행 거부 ${show(r)}`);
    assert.match(JSON.stringify(r.body), pattern, `${what} — 거부 사유`);
    await notPublished(fx.col, what);
  };
  await refused("이해관계 기록 없음", /이해관계/);
  assert.equal((await columns(u.editor, { op: "meta", articleId: fx.col.id, personId: writer, interestState: "none_confirmed" })).status, 422, "'없음'은 필자 확인 기록이 있어야");
  await expectStatus(columns(u.editor, { op: "meta", articleId: fx.col.id, personId: writer, interestState: "declared", interestText: "시험용 이해관계 문구" }), 200, "이해관계");
  await refused("필자 검증 없음", /필자 검증/);
  await expectStatus(columns(u.editor, { op: "verify", personId: writer, evidenceKind: "license", evidenceRef: "시험용 검증 위치" }), 201, "필자 검증");
  await refused("계약 없음", /계약/);
  assert.equal((await columns(u.editor, { op: "contract", personId: writer, docRef: "시험용 계약 위치", signedOn: "2026-01-10", reuseScope: ["online"], aiIndexScope: "allow", bookTitles: ["시험용 도서"] })).status, 422, "재수록 book 없이 도서 목록 거부");
  const contract = await expectStatus(columns(u.editor, { op: "contract", personId: writer, docRef: "시험용 계약 위치", signedOn: "2026-01-10", reuseScope: ["online"], aiIndexScope: "allow" }), 201, "기고 계약");
  fx.contractAllow = Number(contract.body.contract.id);
  await expectStatus(columns(u.editor, { op: "meta", articleId: fx.col.id, personId: writer, contractId: fx.contractAllow, interestState: "declared", interestText: "시험용 이해관계 문구" }), 200, "계약 연결");
  await expectStatus(columns(u.editor, { op: "signature", articleId: fx.col.id, seriesKey: "signature", episode: 1 }), 201, "시그니처 연재 1회");
  await refused("의견 고지 문구 비어 있음", /의견 고지/);
  // 고지 문구는 PO 감수본 — 운영 설정 화면(설정 API)에서 넣는다 (12장 #8)
  await expectStatus(api("PATCH", "/settings/column_opinion_notice", u.admin, { value: "시험용 의견 고지 문구입니다" }), 200, "고지 문구 입력");
  await expectStatus(publish(fx.col), 200, "모두 갖추면 발행");

  // 같은 필자의 AI 색인 불허 칼럼 (12단계 검색에서 쓴다)
  const deny = await expectStatus(columns(u.editor, { op: "contract", personId: writer, docRef: "시험용 계약 위치 2", signedOn: "2026-01-11", reuseScope: ["online"], aiIndexScope: "deny" }), 201, "불허 계약");
  fx.word = `수용칼럼낱말${staff.run}`;
  fx.colAllow = await createArticle("col-allow", u.writer, { title: `시험용 칼럼 ${fx.word} 허용`, summary: "시험용 가짜 칼럼입니다", section: "tax", categoryId: fx.cat["tax/columns"], contentType: "opinion", body: BODY("시험용 가짜 칼럼 본문입니다.") });
  fx.colDeny = await createArticle("col-deny", u.writer, { title: `시험용 칼럼 ${fx.word} 불허`, summary: "시험용 가짜 칼럼입니다", section: "tax", categoryId: fx.cat["tax/columns"], contentType: "opinion", body: BODY("시험용 가짜 칼럼 본문입니다.") });
  for (const [a, c] of [[fx.colAllow, fx.contractAllow], [fx.colDeny, Number(deny.body.contract.id)]]) {
    await expectStatus(columns(u.editor, { op: "meta", articleId: a.id, personId: writer, contractId: c, interestState: "none_confirmed", confirmedBy: "시험용 필자 확인" }), 200, "이해관계 없음 확인");
    await deskApprove(a);
    await expectStatus(publish(a), 200, `발행 ${a.slug}`);
  }

  const detail = (await page(fx.col.href)).html;
  assert.match(visible(detail), /이해관계: 시험용 이해관계 문구/, "머리 아래 이해관계 줄");
  assert.equal((detail.match(/data-part="column-opinion-notice"/g) ?? []).length, 1, "의견 고지 1개");
  assert.match(visible((await page(fx.colAllow.href)).html), /이해관계: 필자가 밝힌 이해관계 없음/);
  const list = visible((await page("/tax/columns")).html);
  assert.ok(list.includes(fx.col.title) && list.includes("시험용 수용 필자"), "칼럼 목록 — 제목·필자 이름");
  assert.ok(list.includes("오피니언"), "오피니언 배지");
});

// ── 8) 브랜드 ───────────────────────────────────────────
test("8) BR-01·02·03·07 브랜드 — 렌더 약력 = 승인 증빙(증빙 없는 줄 0 — 인물·필자 줄·JSON-LD·메타), 서명 없는 '감수 ○○' 0, 오탈자 유지·실질 수정 0 + 재감수 큐, 동의 철회 404 + 사이트맵 원본 0", async () => {
  const writer = u.writer.personId;
  const e1 = await expectStatus(brand(u.ops, { op: "evidence", personId: writer, kind: "document", docRef: "시험용 증빙 위치 1" }), 201, "증빙 1");
  const e2 = await expectStatus(brand(u.ops, { op: "evidence", personId: writer, kind: "official_record", docRef: "시험용 증빙 위치 2" }), 201, "증빙 2");
  fx.e1 = Number(e1.body.evidence.id);
  fx.e2 = Number(e2.body.evidence.id);
  assert.equal((await brand(u.ops, { op: "evidence_approve", id: fx.e1 })).status, 403, "브랜드 관리 담당은 승인 거부");
  assert.equal(await auditCount("brand.approve.denied", "brand:evidence_approve"), 1, "거부 감사 1건");
  await expectStatus(brand(u.admin, { op: "evidence_approve", id: fx.e1 }), 200, "PO 승인");
  assert.equal((await brand(u.ops, { op: "bio", personId: writer, items: [{ item: "시험용 증빙 없는 약력" }] })).status, 422, "증빙 없는 약력 저장 거부");
  await expectStatus(brand(u.ops, { op: "bio", personId: writer, items: [{ item: "시험용 수용 약력 가", evidenceId: fx.e1 }, { item: "시험용 수용 약력 나 승인 전", evidenceId: fx.e2 }] }), 200, "약력");

  const person = await page(`/people/${fx.writerSlug}`);
  assert.equal(person.status, 200);
  const head = person.html.slice(person.html.indexOf('data-ui="person-header"'));
  const bio = [...(head.match(/<ul aria-label="검증된 약력"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => visible(m[1]));
  const approved = await count("select count(*)::int n from public.people_evidence where person_id = $1 and approved", [writer]);
  assert.deepEqual(bio, ["시험용 수용 약력 가"], "렌더 약력 = 승인 증빙 줄");
  assert.equal(bio.length, approved, "렌더 약력 수 = 증빙 승인 수");
  assert.ok(!person.html.includes("약력 나 승인 전"), "승인 전 줄 — 화면·메타·JSON-LD 어디에도 0");
  const profile = jsonLdOf(person.html).find((n) => n["@type"] === "ProfilePage");
  assert.equal(profile?.mainEntity?.description, "시험용 수용 약력 가");
  assert.deepEqual(compareRendered({ title: visible(head.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ""), description: bio.join(" · ") }, jsonLdOf(person.html)), [], "JSON-LD = 화면");
  const col = (await page(fx.col.href)).html;
  assert.match(col.slice(col.indexOf('data-ui="reporter-block"')), /시험용 수용 약력 가/, "칼럼 필자 줄 = 승인 약력");
  assert.ok(!col.includes("약력 나 승인 전"), "칼럼 화면에 승인 전 줄 0");

  // 감수 표시 — 서명 기록이 있는 해석 해설만 '감수 ○○' 1개
  const mark = `감수 ${REVIEWER_NAME}`;
  for (const a of [...fx.briefs, fx.col]) {
    const { html } = await page(a.href);
    assert.equal(markCount(html), 0, `${a.slug} 감수 표시 0`);
    assert.ok(!visible(html).includes(mark), `${a.slug} 서명 없는 '${mark}' 0`);
  }
  let ex = (await page(fx.explainer.href)).html;
  assert.equal(markCount(ex), 1, "서명한 기사 감수 표시 1개");
  assert.ok(visible(ex).includes(mark));
  await expectStatus(api("PATCH", `/articles/${fx.explainer.id}`, u.editor, { summary: "시험용 가짜 해설입니다.", updateKind: "typo", reason: "시험용 오탈자 수정" }), 200, "오탈자 수정");
  assert.equal(markCount((await page(fx.explainer.href)).html), 1, "오탈자 수정은 감수 표시 유지");
  await expectStatus(api("PATCH", `/articles/${fx.explainer.id}`, u.editor, { summary: "시험용 가짜 해설을 고쳤습니다", updateKind: "substantive", reason: "시험용 실질 수정" }), 200, "실질 수정");
  ex = (await page(fx.explainer.href)).html;
  assert.equal(markCount(ex), 0, "서명 뒤 실질 수정 → 감수 표시 0");
  assert.ok(!ex.includes("reviewedBy"), "JSON-LD 감수자도 0");
  const q = await expectStatus(api("GET", "/brand", u.admin), 200, "재감수 큐");
  assert.equal(q.body.rereviewQueue.filter((x) => Number(x.article_id) === fx.explainer.id).length, 1, "재감수 큐 1건");
  await taxApprove(fx.explainer);
  assert.equal(markCount((await page(fx.explainer.href)).html), 1, "다시 서명 → 1개");

  // 동의서 — 없으면 404, 기록하면 200, 철회 → 다음 요청부터 404 + 사이트맵 원본 0
  assert.equal((await page(`/people/${fx.guestSlug}`)).status, 404, "동의서 없음 → 404");
  const consent = await expectStatus(brand(u.admin, { op: "consent", personId: u.guest.personId, version: `시험용-${staff.run}`, docRef: "시험용 동의서 위치", scope: ["profile_page"] }), 201, "동의서");
  assert.equal((await page(`/people/${fx.guestSlug}`)).status, 200, "동의서(profile_page) → 200");
  assert.equal(await count("select count(*)::int n from public.public_profile_pages where person_id = $1", [u.guest.personId]), 1);
  await expectStatus(brand(u.admin, { op: "consent_withdraw", id: Number(consent.body.consent.id) }), 200, "철회");
  assert.equal((await page(`/people/${fx.guestSlug}`)).status, 404, "철회 → 다음 요청부터 404");
  assert.equal(await count("select count(*)::int n from public.public_profile_pages where person_id = $1", [u.guest.personId]), 0, "사이트맵 원본 0");
  assert.equal(await auditCount("consent_doc.withdraw", `name_likeness_consents:${consent.body.consent.id}`), 1, "철회 감사 1건");
});

// ── 9) '50년' ──────────────────────────────────────────
test("9) BR-01·04 '50년' — 승인 전 0(제목·메타·주소·JSON-LD·사이트맵 원본·검색), 승인 뒤 연재 제목에만 근거 링크와 함께, brand_copy를 끄면 다시 0", async () => {
  for (const title of [TITLE_50, "시험용 수용 연재 오십 년", "시험용 수용 연재 ５０년"]) {
    const r = await columns(u.editor, { op: "series_title", seriesKey: "signature", title });
    assert.equal(r.status, 422, `${title} ${show(r)}`);
    assert.deepEqual(errorFields(r), ["title"]);
  }
  await assert.rejects(db.query("update public.settings set value = to_jsonb($1::text) where key = 'series_title_signature'", [TITLE_50]), /career_claim_approved/, "DB도 거부");
  // 검색 화면은 찾는 말을 그대로 되보여 주므로 화면 글자 대신 결과(아래 검색 API)를 본다
  const pages = ["/", "/tax/columns", fx.col.href, `/people/${fx.writerSlug}`];
  for (const p of pages) {
    const { status, html } = await page(p);
    assert.equal(status, 200, p);
    const parts = machineParts(html);
    assert.equal(hasClaimToken(visible(html)), false, `${p} 화면 글자`);
    assert.equal(hasClaimToken(parts.head), false, `${p} 제목·메타`);
    assert.equal(hasClaimToken(parts.ld), false, `${p} JSON-LD`);
    assert.equal(hasClaimToken(parts.urls), false, `${p} 주소`);
  }
  const ours = [fx.col.id, fx.colAllow.id, fx.colDeny.id, fx.explainer.id, ...fx.briefs.map((b) => b.id)];
  const sitemap = await db.query(
    `select slug v from public.public_articles where id = any($1::bigint[]) union all select title from public.public_articles where id = any($1::bigint[])
     union all select slug from public.public_profile_pages union all select coalesce(title, '') from public.public_signature_series`,
    [ours],
  );
  assert.equal(sitemap.rows.filter((r) => hasClaimToken(r.v)).length, 0, "사이트맵 원본 0");
  const found = await searchApi("50년");
  assert.equal(found.items.filter((i) => hasClaimToken(`${i.title ?? ""} ${i.snippet ?? ""} ${i.href ?? ""}`)).length, 0, "검색 색인 '50년' 0");

  // 승인 — 근거 증빙(인물 페이지 약력 줄) → 경력 승인 → 연재 제목 → 감수 기록 → brand_copy
  await expectStatus(brand(u.admin, { op: "career_claim", value: true, basisEvidenceId: fx.e1 }), 200, "경력 표시 승인");
  await expectStatus(columns(u.editor, { op: "series_title", seriesKey: "signature", title: TITLE_50 }), 200, "승인 뒤 연재 제목");
  assert.equal(hasClaimToken(visible((await page("/")).html)), false, "brand_copy 전에는 화면 0");
  await expectStatus(brand(u.admin, { op: "brand_review", value: true, recordRef: "시험용 감수 기록 위치" }), 200, "광고 규정 감수 기록");
  await expectStatus(brand(u.admin, { op: "brand_copy", value: true }), 200, "brand_copy 켜기");
  const href = `/people/${fx.writerSlug}#evidence-${fx.e1}`;
  const withLink = new RegExp(`연재 「${TITLE_50}」(?: \\d+회)?(?:<!-- -->)?<a\\b[^>]*data-part="claim-basis"`, "g");
  for (const p of ["/", "/tax/columns", fx.col.href]) {
    const { html } = await page(p);
    const shown = visible(html).split(`연재 「${TITLE_50}」`).length - 1;
    const links = [...html.matchAll(/<a\b[^>]*data-part="claim-basis"[^>]*>/g)].map((m) => decode(m[0].match(/href="([^"]*)"/)?.[1] ?? ""));
    assert.ok(shown >= 1, `${p} 연재 제목이 보인다`);
    assert.equal((html.match(withLink) ?? []).length, shown, `${p} 보이는 '50년'마다 바로 뒤 근거 링크`);
    assert.deepEqual([...new Set(links)], [href], `${p} 근거 링크 → 인물 페이지 증빙 줄`);
    assert.equal(links.length, shown);
    assert.equal(hasClaimToken(visible(html.replace(withLink, " "))), false, `${p} 링크 없는 '50년' 0`);
    const parts = machineParts(html);
    assert.equal(hasClaimToken(parts.head), false, `${p} 제목·메타 0`);
    assert.equal(hasClaimToken(parts.ld), false, `${p} JSON-LD 0`);
  }
  assert.match((await page(`/people/${fx.writerSlug}`)).html, new RegExp(`<li[^>]*id="evidence-${fx.e1}"[^>]*>\\s*시험용 수용 약력 가`), "근거 링크가 가리키는 약력 줄");
  await expectStatus(brand(u.admin, { op: "brand_copy", value: false }), 200, "brand_copy 끄기");
  for (const p of ["/", "/tax/columns", fx.col.href]) {
    const { html } = await page(p);
    assert.equal(hasClaimToken(visible(html)), false, `${p} 끄면 다시 0`);
    assert.equal((html.match(/data-part="claim-basis"/g) ?? []).length, 0);
  }
});

// ── 10) 국세 미산출 ──────────────────────────────────────
test("10) TX-06 국세 미산출 — 저장소 검사 통과 · 공개 W3 화면 국세 금액 입력·숫자 입력 0 · 국세 계산 경로 404", async () => {
  // 기다리는 동안 이벤트 루프를 막지 않는다(막으면 서버가 닫은 keep-alive 연결을 다음 fetch가 다시 써 ECONNRESET)
  const r = await new Promise((resolve) =>
    execFile(process.execPath, [path.join(ROOT, "scripts", "check-national-tax.mjs"), ROOT], { encoding: "utf8" }, (err, stdout, stderr) => resolve({ status: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })),
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /국세 미산출 검사 통과/);
  for (const p of ["/", "/tax", "/realestate", "/calc", "/tax/amendments", `/tax/amendments/${fx.am.slug}`, "/tax/interpretations", fx.explainer.href, fx.col.href]) {
    const { status, html } = await page(p);
    assert.equal(status, 200, p);
    assert.deepEqual(amountInputs(html), [], `${p} 국세 금액 입력 칸 0`);
  }
  for (const p of ["/calc/transfer", "/calc/inheritance-acquisition", "/calc/gift-acquisition"]) assert.equal((await page(p)).status, 404, p);
});

// ── 11) 홈·허브 ─────────────────────────────────────────
test("11) CORE-02 홈 4대 분야 카드 4장(같은 크기) · 허브 지방세 포인트 4줄 거부 / 감수 전 숨김 / 서명 뒤 3줄·기준일 · 홈 카드 첫 줄", async () => {
  const fieldCards = (html) => html.match(/<nav aria-label="4대 분야" data-ui="field-cards">[\s\S]*?<\/nav>/)?.[0] ?? "";
  const pointBlock = (html) => html.match(/<section data-ui="field-tax-point"[\s\S]*?<\/section>/)?.[0] ?? null;
  const home = (await page("/")).html;
  const hrefs = [...fieldCards(home).matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["/tax", "/realestate", "/finance", "/local"], "카드 정확히 4장");
  for (const h of hrefs) assert.equal((await page(h)).status, 200, `${h} 404 0`);
  const lines = ["시험용 수용 포인트 첫째 줄", "시험용 수용 포인트 둘째 줄", "시험용 수용 포인트 셋째 줄"];
  const draft = (l) => ({ op: "draft", section: "realestate", lines: l, baseDate: "2026-10-01", links: [{ label: "시험용 지방세 해설", href: "/tax" }] });
  const four = await api("POST", "/hub-points", u.editor, draft([...lines, "시험용 넷째 줄"]));
  assert.equal(four.status, 422, show(four));
  assert.deepEqual(errorFields(four), ["lines"], "4줄 거부");
  await expectStatus(api("POST", "/hub-points", u.editor, draft(lines)), 200, "3줄 초안");
  assert.equal(pointBlock((await page("/realestate")).html), null, "감수 전 블록째 0");
  assert.ok(!visible(await (await page("/")).html).includes(lines[0]), "감수 전 홈 카드 줄 0");
  assert.equal((await api("POST", "/hub-points", u.editor, { op: "review", section: "realestate" })).status, 403, "편집 책임자 서명 거부");
  await expectStatus(api("POST", "/hub-points", u.reviewer, { op: "review", section: "realestate" }), 200, "감수위원 서명");
  const block = pointBlock((await page("/realestate")).html);
  assert.ok(block, "서명 뒤 블록");
  assert.deepEqual([...block.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => decode(m[1])), lines, "3줄");
  assert.match(visible(block), /기준일 2026-10-01/);
  const card = visible(fieldCards((await page("/")).html).match(/<li[^>]*data-field="realestate"[\s\S]*?<\/li>/)?.[0] ?? "");
  assert.ok(card.includes(lines[0]) && !card.includes(lines[1]), "홈 카드 = 첫 줄 하나");
  for (const width of [360, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${base}/`);
    const boxes = await p.$$eval('[data-ui="field-cards"] li[data-field] > a', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`));
    assert.equal(boxes.length, 4);
    assert.equal(new Set(boxes).size, 1, `${width}px 4장 같은 크기 ${boxes}`);
    await ctx.close();
  }
});

// ── 12) 검색 ────────────────────────────────────────────
test("12) SRCH·TX-17 검색 — 트래커·해석 원문 결과(열린 화면 링크), AI 색인 불허 칼럼 0(화면·API·탭 숫자)", async () => {
  const tracker = await searchApi(`개편안 ${staff.run}`);
  const t = tracker.items.find((i) => i.kind === "tracker" && Number(i.ref) === fx.am.id);
  assert.ok(t, `개편안 → 트래커 ${JSON.stringify(tracker.items).slice(0, 300)}`);
  assert.equal(t.href, `/tax/amendments/${fx.am.slug}`);
  const doc = (await searchApi(fx.docNo)).items.find((i) => i.kind === "interpretation");
  assert.ok(doc && Number(doc.ref) === fx.doc, "문서 번호 → 해석 원문");
  assert.equal(doc.href, fx.explainer.href, "해설 기사로 링크");
  const refs = (r) => r.items.filter((i) => i.kind === "article").map((i) => Number(i.ref));
  const cols = await searchApi(fx.word);
  assert.deepEqual(refs(cols), [fx.colAllow.id], "불허 칼럼 0 · 허용 칼럼만");
  assert.equal(cols.counts.article, 1, "탭 숫자에도 0");
  const html = (await page(`/search?q=${encodeURIComponent(fx.word)}`)).html;
  assert.ok(!html.includes(fx.colDeny.slug) && html.includes(fx.colAllow.slug), "검색 화면 — 불허 0·허용 1");
  assert.equal((await page(fx.colDeny.href)).status, 200, "칼럼 자체는 공개 그대로");
});

// ── 13) 화면 ────────────────────────────────────────────
test("13) 360·1280px 가로 넘침 0 · 접근성 95 — /calc·트래커 목록/상세·해석 해설 목록/상세·칼럼 목록/상세·인물 페이지·홈·부동산 허브", async () => {
  await setFlags({ people_pages: true });
  const urls = ["/calc", "/tax/amendments", `/tax/amendments/${fx.am.slug}`, "/tax/interpretations", fx.explainer.href, "/tax/columns", fx.col.href, `/people/${fx.writerSlug}`, "/", "/realestate"];
  for (const width of [360, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    try {
      const p = await ctx.newPage();
      for (const url of urls) {
        const res = await p.goto(`${base}${url}`, { waitUntil: "networkidle" });
        assert.equal(res.status(), 200, url);
        const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `${url} ${width}px 가로 넘침 ${over}px`);
      }
    } finally {
      await ctx.close();
    }
  }
  const people = (await page(`/people/${fx.writerSlug}`)).html;
  assert.ok(people.includes('data-person-part="columns"'), "people_pages 켜짐 — 필자 칼럼 블록");
  for (const url of urls.slice(0, 8)) {
    const r = await accessibility(`${base}${url}`, debugPort);
    assert.equal(new URL(r.finalUrl).pathname, url.split("?")[0], "잰 주소");
    assert.ok(r.score >= A11Y_MIN, `${url} 접근성 ${r.score} — ${r.failing.join(", ")}`);
  }
});

// ── 14) 기능 키 꺼짐 ─────────────────────────────────────
test("14) 기능 키를 끄면 W3 화면 닫힘 — /calc·트래커 상세 404, 트래커·해석 주소는 하위 분야 목록, 원문 블록·칼럼 고지·홈 칼럼 영역·인물 역할 블록·검색 링크 0", async () => {
  await setFlags(Object.fromEntries(W3_FLAGS.map((k) => [k, false])));
  assert.equal((await page("/calc")).status, 404, "/calc 404");
  assert.equal((await page(`/tax/amendments/${fx.am.slug}`)).status, 404, "트래커 상세 404");
  const list = await page("/tax/amendments");
  assert.ok(list.status === 200 && !list.html.includes('data-part="amendment-list"'), "트래커 목록 0");
  const interp = await page("/tax/interpretations");
  assert.ok(interp.status === 200 && !interp.html.includes('data-part="interpretation-list"'), "해석 해설 목록 0");
  assert.ok(!(await page(fx.explainer.href)).html.includes('data-part="legal-docs"'), "원문 블록 0");
  assert.ok(!(await page(fx.col.href)).html.includes('data-part="column-disclosure"'), "칼럼 고지 블록 0");
  assert.ok(!(await page("/")).html.includes('data-home-section="column"'), "홈 칼럼 영역 0");
  assert.ok(!(await page(`/people/${fx.writerSlug}`)).html.includes('data-person-part="columns"'), "인물 역할 블록 0");
  assert.ok(banner((await page(fx.briefs[2].href)).html) === null, "트래커가 닫히면 갱신 배너 0(링크할 곳 없음)");
  assert.equal((await searchApi(`개편안 ${staff.run}`)).items.find((i) => i.kind === "tracker" && Number(i.ref) === fx.am.id)?.href, null, "검색 트래커 링크 0");
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[public\]|\[db\]/, "예상 못 한 서버 오류 0");
});

// ── 15) 정리 ────────────────────────────────────────────
test("15) 정리 — 이 시험이 만든 행을 지우면 표마다 시험 전 행 수, 운영 설정·바깥 연결 값 그대로", async () => {
  await editorContext?.close().catch(() => {});
  editorContext = null;
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
