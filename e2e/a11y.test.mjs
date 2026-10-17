// W1-c 완료 증거 — 견본 페이지 접근성 95점 이상 (Lighthouse 접근성 점수, PRD-01A 9장·10.1)
// W2-b 2단계 — 공개 홈(/)을 내용이 찬 모습(최신 자체 취재·개정 트래커 하이라이트·해설 스토리·검색 폼과 추천 검색어)으로 잰다 (PRD-01A 8.1 주요 화면 · PRD_최종 §9.5 접근성 95)
// W2-b 3단계 — 지방세 허브(/tax — 탭·최신 목록·상황 카드·용어)와 상황 페이지(먼저 확인할 것 3·자주 틀리는 점·기사·다음 행동)도 같은 기준으로 잰다
// W2-b 4단계 — 기사 상세(본문 블록·기자 소개·면책·관련 기사·다음 행동)와 카드뉴스(5장 슬라이드·키보드 넘김)도 같은 기준으로 잰다
// Playwright Chromium을 원격 디버깅으로 띄우고 Lighthouse를 붙인다. 측정이 문제를 잡는지 역검사 견본(일부러 망가뜨린 페이지)도 잰다.
// 로컬에서는 standalone 빌드를 로컬 Supabase에 붙이고 시험 자료를 DB에 넣는다(끝나면 지우고 설정은 되돌린다 — 남는 행 0).
// E2E_BASE_URL(배포된 시험 주소)이면 자료를 넣지 않고 그 주소의 지금 모습을 잰다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import lighthouse from "lighthouse";
import { chromium } from "playwright";
import { ROOT, buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const MIN = 0.95;
let server;
let base;
let fixtureServer;
let fixtureBase;
let browser;
let port;
let staff;
let situationPath = null;
let articlePath = null;
let cardNewsPath = null;

/** 홈의 모든 섹션이 보이게 — 편집 승인된 보도 2 · 해설 스토리 3(형식 배지 포함) · 확정 전 트래커 1(지정) · 검색 폼과 추천 검색어 */
async function seedHome() {
  const db = staff.db;
  const editor = await staff.createUser({ label: "a11y-editor", roles: ["editor"], person: { name: "접근성 시험 편집자", roles: ["editor"] } });
  const reporter = await staff.createUser({ label: "a11y-reporter", roles: ["reporter"], person: { name: "김가온", roles: ["reporter"] } });
  const article = async (label, contentType, format, hours) => {
    const { rows } = await db.query(
      `insert into public.articles (slug, title, summary, section, content_type, reporting_method, status, author_id, format, first_published_at)
       values ($1, $2, '무엇이 바뀌고 누구에게 영향이 있는지 쉬운 말로 정리했습니다.', 'tax', $3, $4, 'published', $5, $6, now() - ($7 || ' hours')::interval) returning id`,
      [`e2e-a11y-${label}-${staff.run}`, `접근성 시험 ${label}`, contentType, contentType === "reported_news" ? "qualitative" : null, reporter.personId, format, String(hours)],
    );
    staff.trackArticle(rows[0].id);
    return rows[0].id;
  };
  for (const [i, label] of ["report1", "report2"].entries()) {
    const id = await article(label, "reported_news", "general", i + 1);
    await db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision) values ($1, 'desk_edit', $2, 'approve')", [id, editor.personId]);
  }
  for (const [i, format] of ["cardnews", "general", "infographic"].entries()) await article(`story${i + 1}`, "explainer", format, 10 + i);
  const am = (await db.query("insert into public.amendments (slug, title, status, law_names) values ($1, '접근성 시험 개정안', 'public', '{지방세법}') returning id", [`e2e-a11y-am-${staff.run}`])).rows[0].id;
  staff.trackRow("amendments", am);
  const snap = (await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e', 'https://www.mois.go.kr/e2e', 'h', '원문') returning id")).rows[0].id;
  await db.query(
    "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, 'pre_notice', current_date - 3, 'https://www.mois.go.kr/e2e', $2, 'user:e2e')",
    [am, snap],
  );
  const cur = await db.query("insert into public.home_curations (kind, amendment_id, starts_on, sort, created_by) values ('tracker', $1, current_date - 1, 10, 'user:e2e') returning id", [am]);
  staff.trackRow("home_curations", cur.rows[0].id);
  // 지방세 허브·상황 페이지 — 해석 하위 분야의 가이드 기사(홈 해설 스토리에 섞이지 않게 해설이 아닌 유형) · 용어 · 허브 1번 자리의 공개(감수된) 상황
  const interpretations = (await db.query("select id from public.categories where section = 'tax' and slug = 'interpretations'")).rows[0].id;
  const { rows: guide } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, category_id, first_published_at)
     values ($1, '접근성 시험 자동차세 환급 안내', '차를 판 뒤 돌려받는 자동차세를 쉬운 말로 정리했습니다.', 'tax', 'guide', 'published', $2, $3, now() - interval '20 hours') returning id`,
    [`e2e-a11y-guide-${staff.run}`, reporter.personId, interpretations],
  );
  staff.trackArticle(guide[0].id);
  const termRow = (await db.query("insert into public.glossary_terms (term, plain, section) values ($1, '세금을 매기는 기준 금액', '{tax}') returning id", [`접근성 과세표준 ${staff.run}`])).rows[0];
  staff.trackRow("glossary_terms", termRow.id);
  const checks = JSON.stringify([{ title: "자동차세를 1년치 미리 냈는지", when: "판 날", note: "납부 내역을 찾아 둡니다" }, { title: "등록 말소일" }, { title: "환급 받을 계좌" }]);
  const situation = (
    await db.query(
      `insert into public.situations (slug, section, title, subtitle, pictogram, checks, mistakes, article_ids, glossary_ids, hub_slot, visible, reviewer_id, reviewed_at, updated_by)
       values ($1, 'tax', '차를 팔았어요·폐차했어요', '돌려받을 자동차세가 있는지 확인합니다', 'car-sold', $2, '{"판 날이 아니라 말소일 기준입니다"}', $3, $4, 1, true, $5, now(), 'user:e2e') returning id, slug`,
      [`e2e-a11y-car-sold-${staff.run}`, checks, [guide[0].id], [termRow.id], editor.personId],
    )
  ).rows[0];
  staff.trackRow("situations", situation.id);
  situationPath = `/situations/${situation.slug}`;
  // 기사 상세 — 블록이 고루 든 세법 해설(면책 대상 하위 분야 '해석') · 카드뉴스 5장
  const detailBody = {
    blocks: [
      { type: "key_summary", lines: ["차를 판 뒤에는 남은 기간의 자동차세를 돌려받습니다.", "등록 말소일까지 계산합니다."] },
      { type: "paragraph", text: "연세액을 미리 냈다면 차를 판 날 이후 몫을 돌려받는다. 자세한 흐름은 [지방세 허브](/tax)에서 볼 수 있다." },
      { type: "table", caption: "돌려받는 몫", rows: [["낸 때", "돌려받는 몫"], ["1월", "판 날 이후 남은 날 몫"]], chart: { axis: "낸 때", unit: "원", source: "편집국" } },
      { type: "quote", text: "말소일 기준으로 계산합니다.", speaker: "구청 세무과", origin: "document", refId: null },
      { type: "callout", kind: "tip", title: "절세 체크포인트", text: "연세액을 미리 내면 깎아 줍니다." },
      { type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "판 날이 아니라 등록 말소일 기준입니다." },
      { type: "faq", items: [{ question: "언제 돌려받나요?", answer: "말소 뒤 한두 달 안에 돌려받습니다." }, { question: "신청해야 하나요?", answer: "구청이 알아서 돌려줍니다." }] },
    ],
    claims: [],
  };
  const { rows: detail } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, category_id, body, legal_basis_date, first_published_at)
     values ($1, '접근성 시험 자동차세 돌려받기', '차를 판 뒤 돌려받는 자동차세를 정리했습니다.', 'tax', 'explainer', 'published', $2, $3, $4, '2026-10-01', now() - interval '30 hours') returning id, slug`,
    [`e2e-a11y-detail-${staff.run}`, reporter.personId, interpretations, JSON.stringify(detailBody)],
  );
  staff.trackArticle(detail[0].id);
  articlePath = `/news/${detail[0].slug}`;
  const slides = Array.from({ length: 5 }, (_, i) => ({ type: "slide", title: `${i + 1}. 자동차세 환급`, text: "말소일까지 계산합니다.", alt: `${i + 1}번째 장 — 자동차 그림` }));
  const { rows: cards } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, format, body, first_published_at)
     values ($1, '접근성 시험 카드뉴스', '자동차세 환급을 다섯 장으로 정리했습니다.', 'tax', 'guide', 'published', $2, 'cardnews', $3, now() - interval '31 hours') returning id, slug`,
    [`e2e-a11y-cards-${staff.run}`, reporter.personId, JSON.stringify({ blocks: slides, claims: [] })],
  );
  staff.trackArticle(cards[0].id);
  cardNewsPath = `/news/${cards[0].slug}`;
  await db.query("update public.settings set value = jsonb_set(value, '{search}', 'true') where key = 'feature_flags'");
  await db.query(`update public.settings set value = '["취득세", "개편안", "책임준공"]'::jsonb where key = 'home_search_chips'`);
}

before(async () => {
  if (process.env.E2E_BASE_URL) base = process.env.E2E_BASE_URL.replace(/\/$/, "");
  else {
    const sb = localSupabase();
    buildWeb();
    staff = new StaffFixture(sb);
    await staff.connect();
    await staff.snapshotOperations();
    await seedHome();
    server = await startServer({ NEXT_PUBLIC_SUPABASE_URL: sb.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey });
    base = server.base;
  }
  fixtureServer = http.createServer((req, res) => {
    const file = path.join(ROOT, "e2e", "fixtures", "a11y", path.basename(req.url));
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(fs.readFileSync(file));
  });
  await new Promise((r) => fixtureServer.listen(0, "127.0.0.1", r));
  fixtureBase = `http://127.0.0.1:${fixtureServer.address().port}`;
  port = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
});

after(async () => {
  try {
    await browser?.close();
    await staff?.cleanup();
  } finally {
    server?.stop();
    fixtureServer?.close();
  }
});

async function accessibility(url) {
  const r = await lighthouse(url, { port, output: "json", logLevel: "error", onlyCategories: ["accessibility"] });
  const cat = r.lhr.categories.accessibility;
  const failing = cat.auditRefs
    .map((ref) => r.lhr.audits[ref.id])
    .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode === "binary")
    .map((a) => a.id);
  console.log(`접근성 ${Math.round(cat.score * 100)}점 — ${url.replace(/^https?:\/\/[^/]+/, "")}${failing.length ? ` (미흡: ${failing.join(", ")})` : ""}`);
  return { score: cat.score, failing };
}

test("역검사 — 일부러 문제를 넣은 견본은 95점 미만이고 문제 항목을 잡는다", async () => {
  const r = await accessibility(`${fixtureBase}/bad.html`);
  assert.ok(r.score < MIN, `점수 ${r.score}`);
  for (const id of ["image-alt", "color-contrast", "html-has-lang", "button-name"]) assert.ok(r.failing.includes(id), `${id} 미검출: ${r.failing}`);
});

test("디자인 견본(/_design) 접근성 95점 이상", async () => {
  const r = await accessibility(`${base}/_design`);
  assert.ok(r.score >= MIN, `점수 ${r.score} — 실패 항목: ${r.failing.join(", ")}`);
});

test("공개 홈(/) 접근성 95점 이상 — 내용이 찬 모습(최신 자체 취재·트래커 하이라이트·해설 스토리·검색 폼)", async () => {
  if (!process.env.E2E_BASE_URL) {
    // 시험 자료가 홈에 실제로 보이는지 먼저 확인한다 — 빈 홈을 재고 통과하지 않게
    const page = await browser.newPage();
    await page.goto(`${base}/`, { waitUntil: "load" });
    const sections = await page.$$eval("[data-home-section]", (els) => els.map((e) => e.getAttribute("data-home-section")));
    assert.deepEqual(sections, ["hero", "fields", "latest_reports", "amendments"]);
    assert.equal(await page.locator('form[role="search"]').count(), 1);
    assert.equal(await page.locator('[data-part="stories"] [data-story-id]').count(), 3);
    await page.close();
  }
  const r = await accessibility(`${base}/`);
  assert.ok(r.score >= MIN, `점수 ${r.score} — 실패 항목: ${r.failing.join(", ")}`);
});

test("지방세 허브(/tax) 접근성 95점 이상 — 탭·최신 목록·상황 카드·관련 용어가 찬 모습", async () => {
  if (!process.env.E2E_BASE_URL) {
    const page = await browser.newPage();
    await page.goto(`${base}/tax`, { waitUntil: "load" });
    const parts = await page.$$eval("[data-hub-part]", (els) => els.map((e) => e.getAttribute("data-hub-part")));
    assert.deepEqual(parts, ["head", "latest", "situations", "terms"]);
    assert.ok((await page.locator('[data-ui="tab-nav"] a').count()) >= 2);
    await page.close();
  }
  const r = await accessibility(`${base}/tax`);
  assert.ok(r.score >= MIN, `점수 ${r.score} — 실패 항목: ${r.failing.join(", ")}`);
});

test("상황 페이지 접근성 95점 이상 — 먼저 확인할 것 3·자주 틀리는 점·기사·용어·다음 행동", async (t) => {
  if (process.env.E2E_BASE_URL) return t.skip("배포 주소에는 시험용 상황이 없다 — 로컬 시험 자료로만 잰다");
  const page = await browser.newPage();
  await page.goto(`${base}${situationPath}`, { waitUntil: "load" });
  assert.equal(await page.locator('[data-situation-part="checks"] [data-ui="step-timeline"] > li').count(), 3);
  assert.equal(await page.locator('[data-ui="status-box"]').count(), 1);
  assert.equal(await page.locator('[data-ui="next-action-band"]').count(), 1);
  await page.close();
  const r = await accessibility(`${base}${situationPath}`);
  assert.ok(r.score >= MIN, `점수 ${r.score} — 실패 항목: ${r.failing.join(", ")}`);
});

test("기사 상세 접근성 95점 이상 — 본문 블록(핵심 요약·표·인용·상태 상자·FAQ)·기자 소개·면책·다음 행동", async (t) => {
  if (process.env.E2E_BASE_URL) return t.skip("배포 주소에는 시험용 기사가 없다 — 로컬 시험 자료로만 잰다");
  const page = await browser.newPage();
  await page.goto(`${base}${articlePath}`, { waitUntil: "load" });
  assert.deepEqual(await page.$$eval('[data-part="blocks"] > [data-block-type]', (els) => els.map((e) => e.getAttribute("data-block-type"))), ["key_summary", "paragraph", "table", "quote", "callout", "callout", "faq"]);
  assert.equal(await page.locator('[data-ui="reporter-block"]').count(), 1);
  assert.equal(await page.locator('[data-part="disclaimer"]').count(), 1);
  await page.close();
  const r = await accessibility(`${base}${articlePath}`);
  assert.ok(r.score >= MIN, `점수 ${r.score} — 실패 항목: ${r.failing.join(", ")}`);
});

test("카드뉴스 접근성 95점 이상 — 5장 슬라이드(장마다 이름)·이전/다음 버튼", async (t) => {
  if (process.env.E2E_BASE_URL) return t.skip("배포 주소에는 시험용 카드뉴스가 없다 — 로컬 시험 자료로만 잰다");
  const page = await browser.newPage();
  await page.goto(`${base}${cardNewsPath}`, { waitUntil: "load" });
  assert.equal(await page.locator('[data-ui="card-news"] [data-slide]').count(), 5);
  await page.close();
  const r = await accessibility(`${base}${cardNewsPath}`);
  assert.ok(r.score >= MIN, `점수 ${r.score} — 실패 항목: ${r.failing.join(", ")}`);
});
