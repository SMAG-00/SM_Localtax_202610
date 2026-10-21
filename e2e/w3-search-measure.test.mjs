// 검색·측정 연결 E2E (W3 10단계 — PRD-01A SRCH-01 · 01B TX-01·02·09·17 · 01C BR-03, docs/dev/W3_설계.md 1장 10단계 증거)
// standalone 빌드를 로컬 Supabase에 붙인다. 개정안·원문·해설·칼럼·계약·감수 기록은 전부 '시험용' 가짜 글자다(세율·조문 내용 0).
//  a) 검색 — 트래커('개편안')와 해석 원문(문서 번호·기관)이 결과에 나오고, 열린 화면만 링크(기능 키 켜짐 → 트래커 상세·해설 기사, 꺼짐 → 링크 0 + 원문 링크)
//  b) AI 색인 불허 칼럼 0 — 기고 계약 deny 칼럼은 검색 화면·API·탭 숫자·오피니언 거르개 어디에도 0, allow 칼럼은 결과, 범위를 줄이면 다음 검색부터 0
//  c) 바깥 연결 카드 — 누름 1번 = calculator_card_clicked 1건(/calc·상황 페이지), 속성은 카드 키·화면·차례뿐(표식 값 0), 나가는 요청에 표식 값·Referer 0
//  d) 열람 — 트래커 상세 amendment_viewed 1건(번호·현재 단계) · 원문 블록이 있는 해석 해설 interpretation_viewed 1건(번호·원문 유형), 다른 기사 0
//  e) 감수자 속성 — 서명 기록이 있는 기사만 JSON-LD reviewedBy = 화면 '감수 ○○', 서명 없는 기사 reviewedBy 0, 두 기사 모두 compareRendered 불일치 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { ROOT, buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { importSource } from "./lib/ts-source.mjs";

const ADMIN_EMAIL = "w3-search-measure-e2e@example.test";
const SITE = "https://e2e.example.test";
const MARKER = "MARKERw3sm7731";

let sb, server, staff, db, base, browser, compareRendered, target;
const u = {};
const fx = {};
let linksSnapshot = [];
/** 바깥 연결 대상(가짜 사이트)이 받은 요청 */
const outgoing = [];

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 600);
async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
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
async function setFeatures(patch) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...cur, ...patch } });
  assert.equal(r.status, 200, show(r));
}
const linkId = async (kind, key) => Number((await one("select id from public.official_links where kind = $1 and key = $2", [kind, key])).id);
const setLink = async (id, patch) => {
  const r = await api("POST", "/official-links", u.editor, { op: "update", id, ...patch });
  assert.equal(r.status, 200, show(r));
};
const hitOf = (html, kind, ref) => html.match(new RegExp(`<li data-search-hit=""[^>]*data-kind="${kind}" data-ref="${ref}"[\\s\\S]*?</li>`))?.[0] ?? null;

async function open(url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await context.newPage();
  await pg.goto(url, { waitUntil: "networkidle" });
  return { context, page: pg };
}
const eventsSince = async (name, since) => (await db.query("select * from public.analytics_events where name = $1 and occurred_at >= $2 order by id", [name, since])).rows;
async function waitEvents(name, since, n) {
  for (let i = 0; i < 50; i++) {
    const rows = await eventsSince(name, since);
    if (rows.length >= n) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return eventsSince(name, since);
}
/** 더 오지 않는지 — 잠깐 기다린 뒤 다시 센다 */
const settle = () => new Promise((r) => setTimeout(r, 800));

/** 화면에서 읽은 값 — compareRendered 입력 (site-article E2E와 같은 칸 + 감수 표시 이름) */
async function renderedFacts(pg) {
  const facts = await pg.evaluate(() => {
    const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) ?? undefined;
    return {
      title: document.querySelector("h1")?.textContent?.trim(),
      authorNames: [...document.querySelectorAll('[data-part="byline"] a')].map((x) => x.textContent.trim()),
      datePublished: attr('time[data-date="published"]', "datetime"),
      dateModified: attr('time[data-date="modified"]', "datetime"),
      mainImageUrl: attr('img[data-part="lead-image"]', "src"),
      reviewerName: document.querySelector('[data-part="review-mark"] a, [data-part="review-mark"] span')?.textContent?.trim(),
    };
  });
  return Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined));
}
async function jsonLd(pg) {
  const scripts = await pg.$$eval('script[type="application/ld+json"]', (els) => els.map((e) => e.textContent));
  assert.equal(scripts.length, 1, "JSON-LD 하나");
  const raw = JSON.parse(scripts[0]);
  const nodes = Array.isArray(raw) ? raw : [raw];
  return { raw, main: nodes.find((n) => n["@type"] === "NewsArticle") };
}

async function newArticle(tag, { contentType = "explainer", status = "published", authorId = null, title } = {}) {
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body, first_published_at)
     values ($1, $2, '시험용 가짜 요약', 'tax', $3, $4, $5, $6, $7) returning id, slug`,
    [
      `e2e-w3sm-${tag}-${staff.run}`,
      title ?? `시험용 검색측정 기사 ${tag} ${staff.run}`,
      contentType,
      status,
      authorId,
      JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 가짜 본문입니다." }], claims: [] }),
      status === "published" ? new Date(Date.now() - 5 * 3_600_000).toISOString() : null,
    ],
  );
  staff.trackArticle(rows[0].id);
  return { id: Number(rows[0].id), slug: rows[0].slug, href: `/news/${rows[0].slug}` };
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  ({ compareRendered } = await importSource(pathToFileURL(path.join(ROOT, "packages", "structured-data", "src", "compare.ts")).href));
  // 바깥 연결 대상 — 받은 요청의 주소·머리글만 적어 둔다 (TX-02 표식 값 비전달 확인)
  target = http.createServer((req, res) => {
    outgoing.push({ url: req.url, headers: req.headers });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>시험용 바깥 사이트</title><p>시험용</p>");
  });
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
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
  linksSnapshot = (await db.query("select id, url, status, terms_note, active from public.official_links order by id")).rows;
  u.admin = await staff.createUser({ label: "sm-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "sm-editor", roles: ["editor"], person: { name: "검색측정 시험 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "sm-reviewer", roles: ["reviewer"], person: { name: "시험용 검색측정 감수위원", roles: ["reviewer"] } });
  u.reporter = await staff.createUser({ label: "sm-reporter", roles: ["reporter"], person: { name: "시험용 검색측정 기자", roles: ["reporter"] } });
  const run = staff.run;

  // 개정 트래커 — 공개 개정안 + 입법예고 단계 기록
  const am = await one("insert into public.amendments (slug, title, status, law_names, summary) values ($1, $2, 'public', '{시험법}', '시험용 요약') returning id, slug", [
    `e2e-w3sm-am-${run}`,
    `시험용 「2026년 지방세제 개편안」 ${run}`,
  ]);
  staff.trackRow("amendments", am.id);
  const amSnap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e', 'https://example.test/e2e-w3sm-am', 'h', '시험용 원문') returning id");
  await db.query(
    "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, 'pre_notice', current_date - 3, 'https://example.test/e2e-w3sm-am', $2, 'user:e2e')",
    [am.id, amSnap.id],
  );
  fx.amendment = { id: Number(am.id), slug: am.slug };

  // 해석 원문 + 해설 — 원문(권리 확인·필수 칸) → 해설 지정·연결 → 세무 감수 → 발행 (5단계 발행 검사를 그대로 지난다)
  const docSnap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e', 'https://example.test/e2e-w3sm-doc', $1, '시험용 가짜 원문') returning id", [
    `h-${run}`,
  ]);
  fx.docSnap = Number(docSnap.id);
  fx.docNo = `시험번호${run}`;
  const doc = await one(
    `insert into public.legal_docs (doc_type, issuer, doc_no, decided_on, tax_kinds, provisions, source_url, snapshot_id, rights_status, content_hash)
     values ('ruling', '시험용검색기관', $1, '2026-02-03', '{시험세목}', '{시험법 제3조}', 'https://example.test/e2e-w3sm-doc', $2, 'confirmed', $3) returning id`,
    [fx.docNo, fx.docSnap, `h-${run}`],
  );
  fx.doc = Number(doc.id);
  fx.explainer = await newArticle("explainer", { status: "draft", authorId: u.reporter.personId, title: `시험용 해석 해설 ${run}` });
  await db.query("insert into public.interpretation_articles (article_id) values ($1)", [fx.explainer.id]);
  await db.query("insert into public.article_legal_docs (article_id, legal_doc_id, role) values ($1, $2, 'subject')", [fx.explainer.id, fx.doc]);
  await db.query("insert into public.editorial_reviews (article_id, version, kind, reviewer_id, decision) values ($1, 1, 'tax_review', $2, 'approve')", [fx.explainer.id, u.reviewer.personId]);
  await db.query("update public.articles set status = 'published', first_published_at = now() - interval '2 hours' where id = $1", [fx.explainer.id]);

  // 칼럼 — 같은 필자의 기고 계약 2건(AI 색인 deny · allow), 칼럼마다 이해관계·계약 연결
  const writer = await one("insert into public.people (slug, name, roles, visibility) values ($1, '시험용 검색측정 필자', '{writer}', 'public') returning id", [`e2e-w3sm-writer-${run}`]);
  fx.writer = Number(writer.id);
  staff.personIds.add(fx.writer);
  fx.word = `칼럼낱말${run}`;
  const contract = async (scope) =>
    Number(
      (await one("insert into public.column_contracts (person_id, doc_ref, signed_on, reuse_scope, ai_index_scope) values ($1, '시험용 계약 위치', '2026-01-01', '{online}', $2) returning id", [fx.writer, scope])).id,
    );
  fx.contracts = { deny: await contract("deny"), allow: await contract("allow") };
  fx.denied = await newArticle("col-deny", { contentType: "opinion", title: `시험용 칼럼 ${fx.word} 불허` });
  fx.allowed = await newArticle("col-allow", { contentType: "opinion", title: `시험용 칼럼 ${fx.word} 허용` });
  for (const [a, c] of [
    [fx.denied, fx.contracts.deny],
    [fx.allowed, fx.contracts.allow],
  ]) {
    await db.query("insert into public.column_meta (article_id, person_id, interest_state, interest_text, contract_id) values ($1, $2, 'declared', '시험용 이해관계', $3)", [a.id, fx.writer, c]);
  }

  // 감수자 속성 — 서명할 기사·서명 없는 기사 (필자 = 시험 기자)
  fx.signed = await newArticle("signed", { authorId: u.reporter.personId });
  fx.unsigned = await newArticle("unsigned", { authorId: u.reporter.personId });

  // 바깥 연결 — SM 취득세·안심 상속증여계산기 주소를 가짜 사이트로, 상황 페이지 하나가 안심 계산기 카드를 쓴다
  const t = `http://127.0.0.1:${target.address().port}`;
  fx.links = { acquisition: await linkId("sm_calculator", "acquisition"), ansim: await linkId("external_calculator", "inheritance_gift") };
  await setLink(fx.links.acquisition, { url: `${t}/sm-acquisition` });
  await setLink(fx.links.ansim, { url: `${t}/ansim` });
  const sit = await one(
    `insert into public.situations (slug, section, title, subtitle, pictogram, checks, visible, reviewer_id, reviewed_at, updated_by, external_link_id)
     values ($1, 'realestate', '시험용 검색측정 상황', '시험용 부제', 'home-bought', $2, true, $3, now(), 'user:e2e', $4) returning id, slug`,
    [`e2e-w3sm-sit-${run}`, JSON.stringify([{ title: "시험용 확인 1" }, { title: "시험용 확인 2" }, { title: "시험용 확인 3" }]), u.reviewer.personId, fx.links.ansim],
  );
  staff.trackRow("situations", sit.id);
  fx.situation = sit.slug;

  await setFeatures({ search: true, calc: true, sm_calculator: true, amendments: true, interpretations: true });
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    await new Promise((r) => (target ? target.close(r) : r()));
    if (db) {
      for (const s of linksSnapshot) {
        await db.query("update public.official_links set url = $2, status = $3, terms_note = $4, active = $5 where id = $1", [s.id, s.url, s.status, s.terms_note, s.active]);
      }
      // 시험 정리는 외래 키 cascade가 돌지 않는 세션에서 한다(staff.cleanup) — 칼럼 메타·계약·원문 연결·원문·스냅샷은 먼저 직접 지운다
      const ids = [fx.denied?.id, fx.allowed?.id, fx.explainer?.id].filter(Boolean);
      await db.query("delete from public.column_meta where article_id = any($1::bigint[])", [ids]);
      if (fx.writer) await db.query("delete from public.column_contracts where person_id = $1", [fx.writer]);
      await db.query("delete from public.interpretation_articles where article_id = any($1::bigint[])", [ids]);
      await db.query("delete from public.legal_doc_review_queue where article_id = any($1::bigint[])", [ids]);
      await db.query("delete from public.article_legal_docs where article_id = any($1::bigint[])", [ids]);
      if (fx.doc) await db.query("delete from public.legal_docs where id = $1", [fx.doc]);
      if (fx.docSnap) await db.query("delete from public.raw_snapshots where id = $1", [fx.docSnap]);
    }
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("a) 검색 — 트래커·해석 원문이 결과에 나오고, 열린 화면만 링크(꺼지면 링크 0 + 원문 링크)", async () => {
  const run = staff.run;
  const tracker = await searchApi(`개편안 ${run}`);
  const t = tracker.items.find((i) => i.kind === "tracker" && Number(i.ref) === fx.amendment.id);
  assert.ok(t, `개편안 → 트래커 ${JSON.stringify(tracker.items).slice(0, 400)}`);
  assert.equal(t.href, `/tax/amendments/${fx.amendment.slug}`, "기능 키 켜짐 → 트래커 상세");
  assert.equal(t.typeLabel, "개정 트래커");

  for (const q of [fx.docNo, `시험용검색기관 ${fx.docNo}`, `예규 ${fx.docNo}`]) {
    const r = await searchApi(q);
    const hit = r.items.find((i) => i.kind === "interpretation");
    assert.ok(hit && Number(hit.ref) === fx.doc, `'${q}' → 해석 원문`);
    assert.equal(hit.href, fx.explainer.href, "기능 키 켜짐 → 그 원문을 다루는 해설 기사");
    assert.equal(hit.typeLabel, "해석 원문");
    assert.equal(hit.docTypeLabel, "예규");
    assert.equal(hit.decidedOn, "2026-02-03");
    assert.equal(r.counts.interpretation, 1, "탭 숫자");
  }
  const html = (await page(`/search?q=${encodeURIComponent(fx.docNo)}`)).html;
  const item = hitOf(html, "interpretation", fx.doc);
  assert.ok(item, "검색 화면에 해석 원문 결과");
  assert.match(item, new RegExp(`href="${fx.explainer.href}"`));
  assert.match(item, />해석 원문</);
  assert.match(item, />예규</);
  // 해설 기사 자체는 기사 결과(해설) 그대로
  assert.ok((await searchApi(`시험용 해석 해설 ${run}`)).items.some((i) => i.kind === "article" && Number(i.ref) === fx.explainer.id));

  await setFeatures({ amendments: false, interpretations: false });
  const closedDoc = (await searchApi(fx.docNo)).items.find((i) => i.kind === "interpretation");
  assert.equal(closedDoc.href, null, "해설 화면이 닫히면 링크 0");
  assert.equal(closedDoc.sourceUrl, "https://example.test/e2e-w3sm-doc", "대신 원문 링크");
  assert.equal((await searchApi(`개편안 ${run}`)).items.find((i) => i.kind === "tracker" && Number(i.ref) === fx.amendment.id).href, null, "트래커 화면이 닫히면 링크 0");
  const closedItem = hitOf((await page(`/search?q=${encodeURIComponent(fx.docNo)}`)).html, "interpretation", fx.doc);
  assert.ok(!closedItem.includes(`href="${fx.explainer.href}"`), "닫힌 화면 링크 0");
  assert.match(closedItem, /href="https:\/\/example\.test\/e2e-w3sm-doc" target="_blank" rel="noopener noreferrer"/);
  await setFeatures({ amendments: true, interpretations: true });
});

test("b) AI 색인 불허 칼럼 0 — 검색 화면·API·탭 숫자·오피니언 거르개 0, allow 칼럼은 결과, 범위를 줄이면 다음 검색부터 0", async () => {
  const refs = (r) => r.items.filter((i) => i.kind === "article").map((i) => Number(i.ref));
  let r = await searchApi(fx.word);
  assert.deepEqual(refs(r), [fx.allowed.id], "불허 칼럼만 빠진다");
  assert.equal(r.counts.article, 1, "탭 숫자에도 0");
  assert.deepEqual(refs(await searchApi(fx.word, "&tab=article&type=opinion")), [fx.allowed.id], "기사 탭·오피니언 거르개");
  const html = (await page(`/search?q=${encodeURIComponent(fx.word)}`)).html;
  assert.ok(!html.includes(fx.denied.slug), "검색 화면에 불허 칼럼 주소 0");
  assert.ok(html.includes(fx.allowed.slug), "허용 칼럼은 결과");
  assert.equal((await page(fx.denied.href)).status, 200, "칼럼 자체는 공개 그대로(색인만 제외)");

  await db.query("update public.column_contracts set ai_index_scope = 'deny' where id = $1", [fx.contracts.allow]);
  r = await searchApi(fx.word);
  assert.deepEqual(refs(r), [], "계약 범위를 줄이면 다음 검색부터 0");
  await db.query("update public.column_contracts set ai_index_scope = 'allow' where id = $1", [fx.contracts.allow]);
  assert.deepEqual(refs(await searchApi(fx.word)), [fx.allowed.id], "되돌리면 다시 결과");
});

test("c) 바깥 연결 카드 — 누름 1번 = calculator_card_clicked 1건(/calc·상황 페이지), 속성은 카드 키·화면·차례뿐, 표식 값 0", async () => {
  const { context, page: pg } = await open(`${base}/calc?ref=${MARKER}#${MARKER}`);
  try {
    // 표식 값을 화면 곳곳에 넣는다 — 주소 쿼리·조각, 머리 검색 칸
    const box = pg.locator('input[name="q"]').first();
    if ((await box.count()) && (await box.isVisible())) await box.fill(MARKER);
    const rank = await pg.getAttribute('[data-link-card="acquisition"]', "data-link-rank");
    assert.equal(rank, "1", "SM 첫 카드 차례 1");
    let since = new Date();
    const [popup] = await Promise.all([context.waitForEvent("page"), pg.click('[data-link-card="acquisition"] a[data-part="go"]')]);
    await popup.waitForLoadState("load").catch(() => {});
    let rows = await waitEvents("calculator_card_clicked", since, 1);
    await settle();
    rows = await eventsSince("calculator_card_clicked", since);
    assert.equal(rows.length, 1, "누름 1번 = 이벤트 1건");
    assert.deepEqual(rows[0].props, { card: "acquisition", screen: "calc", rank: 1 });
    assert.equal(rows[0].section, null, "/calc는 분야 없음");
    assert.ok(!JSON.stringify(rows[0]).includes(MARKER), "이벤트 행에 표식 값 0");
    // 두 번째 누름 → 정확히 1건 더
    since = new Date();
    const [popup2] = await Promise.all([context.waitForEvent("page"), pg.click('[data-link-card="acquisition"] a[data-part="go"]')]);
    await popup2.waitForLoadState("load").catch(() => {});
    await waitEvents("calculator_card_clicked", since, 1);
    await settle();
    assert.equal((await eventsSince("calculator_card_clicked", since)).length, 1, "두 번째 누름도 1건");
  } finally {
    await context.close();
  }
  const sm = outgoing.filter((o) => o.url.startsWith("/sm-acquisition"));
  assert.ok(sm.length >= 1, "새 창이 바깥 사이트로 갔다");
  for (const o of sm) {
    assert.equal(o.url, "/sm-acquisition", "나가는 주소에 쿼리·표식 값 0");
    assert.equal(o.headers.referer, undefined, "Referer 0");
    assert.ok(!JSON.stringify(o.headers).includes(MARKER), "나가는 머리글에 표식 값 0");
  }

  const s = await open(`${base}/situations/${fx.situation}?ref=${MARKER}`);
  try {
    const since = new Date();
    const [popup] = await Promise.all([s.context.waitForEvent("page"), s.page.click('[data-link-card="inheritance_gift"] a[data-part="go"]')]);
    await popup.waitForLoadState("load").catch(() => {});
    await waitEvents("calculator_card_clicked", since, 1);
    await settle();
    const rows = await eventsSince("calculator_card_clicked", since);
    assert.equal(rows.length, 1, "상황 페이지 누름 1번 = 1건");
    assert.deepEqual(rows[0].props, { card: "inheritance_gift", screen: "situation", rank: 1 });
    assert.equal(rows[0].section, "realestate", "상황 페이지 분야");
    assert.ok(!JSON.stringify(rows[0]).includes(MARKER));
  } finally {
    await s.context.close();
  }
  assert.ok(outgoing.some((o) => o.url === "/ansim" && o.headers.referer === undefined), "안심 계산기로 Referer 없이");
});

test("d) 열람 — 트래커 상세 amendment_viewed 1건 · 해석 해설 interpretation_viewed 1건, 원문 블록 없는 기사 0", async () => {
  let since = new Date();
  let v = await open(`${base}/tax/amendments/${fx.amendment.slug}`);
  try {
    await waitEvents("amendment_viewed", since, 1);
    await settle();
    const rows = await eventsSince("amendment_viewed", since);
    assert.equal(rows.length, 1, "트래커 상세 열람 1건");
    assert.deepEqual(rows[0].props, { amendment_id: fx.amendment.id, stage: "pre_notice" });
    assert.equal(rows[0].section, "tax");
  } finally {
    await v.context.close();
  }

  since = new Date();
  v = await open(`${base}${fx.explainer.href}`);
  try {
    assert.equal(await v.page.locator('[data-part="legal-docs"]').count(), 1, "원문 블록");
    await waitEvents("interpretation_viewed", since, 1);
    await settle();
    const rows = await eventsSince("interpretation_viewed", since);
    assert.equal(rows.length, 1, "해석 해설 열람 1건");
    assert.deepEqual(rows[0].props, { article_id: fx.explainer.id, doc_type: "ruling" });
    assert.equal(rows[0].section, "tax");
  } finally {
    await v.context.close();
  }

  since = new Date();
  v = await open(`${base}${fx.unsigned.href}`);
  try {
    await waitEvents("article_viewed", since, 1);
    await settle();
    assert.equal((await eventsSince("interpretation_viewed", since)).length, 0, "원문 블록 없는 기사 0");
  } finally {
    await v.context.close();
  }
});

test("e) 감수자 속성 — 서명 기록이 있는 기사만 reviewedBy = 화면 '감수 ○○', 서명 없는 기사 0, 둘 다 compareRendered 불일치 0", async () => {
  const r = await api("POST", `/articles/${fx.signed.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
  assert.equal(r.status, 201, show(r));
  const reviewerSlug = (await one("select slug from public.people where id = $1", [u.reviewer.personId])).slug;

  const s = await open(`${base}${fx.signed.href}`);
  try {
    const facts = await renderedFacts(s.page);
    assert.equal(facts.reviewerName, "시험용 검색측정 감수위원", "화면 감수 표시");
    const { raw, main } = await jsonLd(s.page);
    assert.deepEqual(main.mainEntityOfPage.reviewedBy, { "@type": "Person", name: "시험용 검색측정 감수위원", url: `${SITE}/people/${reviewerSlug}` });
    assert.deepEqual(compareRendered(facts, raw), [], JSON.stringify({ facts, page: main.mainEntityOfPage }));
  } finally {
    await s.context.close();
  }

  const n = await open(`${base}${fx.unsigned.href}`);
  try {
    const facts = await renderedFacts(n.page);
    assert.equal(facts.reviewerName, undefined, "서명 없는 기사 감수 표시 0");
    const { raw, main } = await jsonLd(n.page);
    assert.equal(main.mainEntityOfPage.reviewedBy, undefined, "서명 없는 기사 reviewedBy 0");
    assert.ok(!JSON.stringify(raw).includes("reviewedBy"));
    assert.deepEqual(compareRendered(facts, raw), []);
  } finally {
    await n.context.close();
  }

  // 같은 원천 — 서명 뒤 실질 수정이면(감수 표시 hidden_changed) 다음 요청부터 화면 표시와 reviewedBy가 함께 0
  const { version } = await one("select version from public.articles where id = $1", [fx.signed.id]);
  await db.query("insert into public.article_revisions (article_id, version, title, body, edited_by, reason, update_kind) values ($1, $2, '시험용', '{}'::jsonb, 'admin:e2e-setup', '시험용 수정', 'substantive')", [
    fx.signed.id,
    Number(version) + 1,
  ]);
  await db.query("update public.articles set version = $2, substantive_updated_at = now(), update_kind = 'substantive', updated_reason = '시험용 수정' where id = $1", [fx.signed.id, Number(version) + 1]);
  await setFeatures({}); // 운영 설정 쓰기 — 공개 데이터 캐시를 바로 만료한다
  const changed = await page(fx.signed.href);
  assert.ok(!changed.html.includes('data-part="review-mark"'), "서명 뒤 실질 수정 → 감수 표시 0");
  assert.ok(!changed.html.includes("reviewedBy"), "서명 뒤 실질 수정 → reviewedBy 0");
});
