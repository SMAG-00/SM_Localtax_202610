// 기사 상세·카드뉴스·칼럼·인물 E2E (W2-b 4단계 — ART-02 · ART-03 · ART-04 · ART-05 · ART-06 · ART-10 · CAT-05 · CORE-01 · NAV-05 · NAV-06 · OPT-02 · OPT-07 · FND-09, docs/dev/W2-b_설계.md 1장 4단계 증거)
// standalone 빌드를 로컬 Supabase에 붙인다. 핵심 기사(세법 해설·카드뉴스·「지방세로 읽기」 기사)는 편집국 API로 만들고 발행한다 — 발행 판정을 지난다.
// 목록·비교용 기사(칼럼 연재·광고·공동 기획·해결 사례·5장 카드뉴스 등)는 DB에 직접 넣는다(첫 화면 요청 전에 — 공개 데이터 캐시 30초).
//  a) ART-02 — 머리(분야 칩·유형 배지 = content_type 글자·제목·요약·기자·최초 발행일·법령 기준일) · 본문 블록 · 면책(면책 대상 하위 분야만) · 기자 소개 → /people
//  b) 정정 블록 0 → 정정 1건이면 1 (일시·무엇을) · 업데이트 표시는 다른 라벨 · 오탈자는 날짜·JSON-LD dateModified 그대로, 실질 수정은 바뀐다 (ART-05 · OPT-07)
//  c) JSON-LD — 화면 값(제목·저자·발행일·수정일·대표 이미지)과 compareRendered 불일치 0 (공동 기획 기사의 표기 제목 포함)
//  d) 표기 배지 — 목록 카드와 상세가 같은 글자 (광고 · 공동 기획 ○○), 둘을 섞지 않는다
//  e) 「지방세로 읽기」 — 감수 서명 기록이 있는 박스만, 본문 뒤·기자 소개 앞, '감수 ○○'는 서명한 감수위원 / 생략 사유 기사는 박스 0
//  f) 삭제된 기사 410 + 삭제 안내 · 초안 404 · 예약 목록 경로 404 · 비공개 인물 404
//  g) 카드뉴스 — 4장·8장·대체 텍스트 없는 장은 발행 422, 5장·7장이 HTML 글자 장으로, 키보드 ←/→
//  h) 칼럼 — 연재 회차 순서·의견 고지, 뉴스 전체에 0 · 인물 페이지는 그 사람의 공개 기사만
//  i) 다음 행동 띠 — 비슷한 사례에 자기 자신 0, 버튼 2개 이하(후보 3개 → 앞의 2개), 닫힌 기능 버튼 0 · 해결 사례 카드(4칸·결론 배지·근거 새 창)
//  j) 정책 링크 — 공개 승인된 것만 (꺼진 것 링크 0), 기자 소개의 정정·편집 원칙 링크도 같다
//  k) 화면 전환 — 허브 → 기사 상세 → 뒤로, 문서 새로고침 0
//  l) R1~R3 (360·640·1024) · 360px 가로 스크롤 0 · 다음 행동 버튼 328px · R1 최악 견본(제목 40자·요약 60자 + 알림 — 휴대폰 첫 화면은 머리뿐, W2-b 설계 9장)
// 만든 계정·기사·이미지·상황·제휴사·감사 로그는 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer, ROOT } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { publishPolicies } from "./lib/policy-fixture.mjs";
import { importSource } from "./lib/ts-source.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";

// W4 5단계 (REG1-09 · PR-07) — 공식 자료는 공공누리 유형·발표일·기준일·지역 단위·수집일이 있어야 발행된다 (시험용 값)
const OFFICIAL_W4 = { licenseType: "kogl_1", publishedOn: "2026-10-01", referenceDate: "2026-10-01", regionUnit: "전국", collectedAt: "2026-10-10T09:00:00+09:00" };

const ADMIN_EMAIL = "site-article-e2e@example.test";
const SITE = "https://e2e.example.test";

let sb, server, staff, db, browser, base, compareRendered;
/** 정책 키는 게시본이 있어야 켜진다(W2-e 6.3) — j)가 켜는 회사 소개·정정 창구의 가짜 게시본을 지우는 함수 */
let removePolicies;
const u = {};
const fx = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const slugOf = (label) => `e2e-art-${label}-${staff.run}`;

async function api(method, apiPath, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${apiPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const show = (r) => JSON.stringify(r.body).slice(0, 1500);

/** 발행 — 막히면 점검 결과를 함께 보인다 */
async function publish(id) {
  const r = await api("POST", `/articles/${id}/publish`, u.editor);
  assert.equal(r.status, 200, `발행 ${id}: ${show(r)}`);
  return r;
}

async function insertArticle(label, over = {}) {
  const contentType = over.contentType ?? "explainer";
  const cols = {
    slug: slugOf(label),
    title: over.title ?? `기사 시험 ${label}`,
    summary: over.summary ?? "무엇이 바뀌고 누구에게 영향이 있는지 정리했습니다",
    section: over.section ?? "tax",
    content_type: contentType,
    reporting_method: contentType === "reported_news" ? "qualitative" : null,
    status: over.status ?? "published",
    author_id: over.authorId ?? u.reporter.personId,
    category_id: over.categoryId ?? null,
    format: over.format ?? "general",
    subtype: over.subtype ?? "general",
    solved_case: over.solvedCase ? JSON.stringify(over.solvedCase) : null,
    label: over.label ?? (contentType === "sponsored" ? "ad" : "none"),
    partner_id: over.partnerId ?? null,
    body: JSON.stringify(over.body ?? { blocks: [{ type: "paragraph", text: "본문 문장입니다." }], claims: [] }),
    series_title: over.series?.[0] ?? null,
    series_episode: over.series?.[1] ?? null,
    tax_lens: over.taxLens ? JSON.stringify(over.taxLens) : null,
    legal_basis_date: over.legalBasisDate ?? null,
    first_published_at: (over.status ?? "published") === "published" ? (over.publishedAt ?? hoursAgo(24)) : null,
  };
  const keys = Object.keys(cols);
  const { rows } = await db.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id, slug`, Object.values(cols));
  const id = Number(rows[0].id);
  staff.trackArticle(id);
  fx[label] = { id, slug: rows[0].slug, href: `/news/${rows[0].slug}` };
  return fx[label];
}

const categoryId = async (section, slug) => Number((await one("select id from public.categories where section = $1 and slug = $2", [section, slug])).id);

async function open(p, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  return { page, status: res.status() };
}

/** 화면에서 읽은 값 — compareRendered 입력 (seo-lint가 페이지에서 뽑는 것과 같은 칸) */
async function renderedFacts(page) {
  const facts = await page.evaluate(() => {
    const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) ?? undefined;
    return {
      title: document.querySelector("h1")?.textContent?.trim(),
      authorNames: [...document.querySelectorAll('[data-part="byline"] a')].map((x) => x.textContent.trim()),
      datePublished: attr('time[data-date="published"]', "datetime"),
      dateModified: attr('time[data-date="modified"]', "datetime"),
      mainImageUrl: attr('img[data-part="lead-image"]', "src"),
      // 감수 표시 '감수 ○○'의 이름 — 서명 기록이 있을 때만 화면에 있고, 그때만 JSON-LD reviewedBy가 있다 (W3 10단계)
      reviewerName: document.querySelector('[data-part="review-mark"] a, [data-part="review-mark"] span')?.textContent?.trim(),
    };
  });
  return Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined));
}
/** JSON-LD — 생성기가 만든 스크립트 하나(노드 목록). raw는 compareRendered 입력, main은 주 노드(NewsArticle·ProfilePage) */
async function jsonLd(page) {
  const scripts = await page.$$eval('script[type="application/ld+json"]', (els) => els.map((e) => e.textContent));
  assert.equal(scripts.length, 1, "JSON-LD 하나");
  const raw = JSON.parse(scripts[0]);
  const nodes = Array.isArray(raw) ? raw : [raw];
  return { raw, main: nodes.find((n) => n["@type"] === "NewsArticle" || n["@type"] === "ProfilePage") };
}
const partsOf = (page) => page.$$eval("[data-article-part]", (els) => els.map((e) => e.getAttribute("data-article-part")));

// ── 원고 ────────────────────────────────────────────────

const slide = (n, over = {}) => ({ type: "slide", title: `${n}. 취득세 신고`, text: `${n}번째 장 글입니다.\n잔금일과 등기일 중 빠른 날부터 셉니다.`, alt: `${n}번째 장 — 달력 그림 위에 날짜를 표시했습니다`, ...over });
const slides = (n) => Array.from({ length: n }, (_, i) => slide(i + 1));

before(async () => {
  sb = localSupabase();
  buildWeb();
  ({ compareRendered } = await importSource(pathToFileURL(path.join(ROOT, "packages", "structured-data", "src", "compare.ts")).href));
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
  removePolicies = await publishPolicies(staff.db, staff.run, ["about", "corrections"]);
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.editor = await staff.createUser({ label: "art-editor", roles: ["editor"], person: { name: "기사 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "art-reporter", roles: ["reporter"], person: { name: "김가온", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "art-reviewer", roles: ["reviewer"], person: { name: "이감수 세무사", roles: ["reviewer"] } });
  u.writer = await staff.createUser({ label: "art-writer", roles: ["reporter"], person: { name: "박필자", roles: ["writer"] } });
  u.hidden = await staff.createUser({ label: "art-hidden", roles: ["reporter"], person: { name: "숨긴 기자", roles: ["reporter"] } });
  u.admin = await staff.createUser({ label: "art-admin", email: ADMIN_EMAIL });
  await db.query("update public.people set visibility = 'hidden' where id = $1", [u.hidden.personId]);
  await db.query("update public.people set beat = '지방세' where id = $1", [u.reporter.personId]);
  fx.reporterSlug = (await one("select slug from public.people where id = $1", [u.reporter.personId])).slug;
  fx.writerSlug = (await one("select slug from public.people where id = $1", [u.writer.personId])).slug;
  fx.hiddenSlug = (await one("select slug from public.people where id = $1", [u.hidden.personId])).slug;

  const interpretations = await categoryId("tax", "interpretations");
  const columns = await categoryId("tax", "columns");
  const projects = await categoryId("realestate", "projects");
  const media = await one(
    "insert into public.media (path, alt, kind, rights_status, credit, photographer, license, checked_at, license_type) values ($1, '취득세 신고 절차를 그린 그림', 'photo', 'confirmed', '편집국', '김가온', '자체 제작', now(), 'not_applicable') returning id, path",
    [`e2e/${staff.run}/lead.png`],
  );
  staff.trackRow("media", media.id);
  fx.media = { id: Number(media.id), url: `${SITE}/${media.path}` };

  // ── A. 세법 해설 — 편집국 API로 작성 → 출처 → 편집 승인 → 세무 감수 → 발행 (면책 대상 하위 분야 '해석') ──
  const created = await api("POST", "/articles", u.reporter, {
    slug: slugOf("main"),
    title: `주택 취득세, 잔금일부터 60일 안에 신고 ${staff.run}`,
    summary: "주택을 사면 취득일부터 60일 안에 취득세를 신고하고 냅니다.",
    section: "tax",
    categoryId: interpretations,
    contentType: "explainer",
    legalBasisDate: "2026-10-01",
    leadMediaId: fx.media.id,
  });
  assert.equal(created.status, 201, show(created));
  fx.main = { id: created.body.article.id, slug: slugOf("main"), href: `/news/${slugOf("main")}` };
  staff.trackArticle(fx.main.id);
  const law = await api("POST", `/articles/${fx.main.id}/sources`, u.reporter, {
    kind: "official_doc",
    title: "지방세법 제20조(신고 및 납부)",
    url: "https://www.law.go.kr/법령/지방세법/제20조",
    sourceName: "법제처 국가법령정보센터",
    lastVerifiedAt: "2026-10-10T09:00:00+09:00",
    licenseStatus: "공공저작물 자유이용",
    ...OFFICIAL_W4,
  });
  assert.equal(law.status, 201, show(law));
  fx.mainBlocks = [
    { type: "key_summary", lines: ["주택을 사면 취득일부터 60일 안에 신고합니다.", "취득일은 잔금일과 등기일 중 빠른 날입니다.", "신고와 납부는 함께 합니다."] },
    { type: "paragraph", text: "취득일은 잔금을 치른 날과 등기를 마친 날 중 빠른 날이다. 자세한 흐름은 [지방세 허브](/tax)에서 볼 수 있다." },
    { type: "table", caption: "취득일 정하는 법", rows: [["경우", "취득일"], ["잔금이 먼저", "잔금일"], ["등기가 먼저", "등기일"]], chart: { axis: "경우", unit: "날짜", source: "지방세법 시행령" } },
    { type: "image", mediaId: String(fx.media.id), alt: "취득세 신고 절차 그림", caption: "신고 절차" },
    { type: "quote", text: "취득세는 취득일부터 60일 이내에 신고하고 납부하여야 한다.", speaker: "지방세법 제20조", origin: "document", refId: law.body.source.ref },
    { type: "callout", kind: "tip", title: "절세 체크포인트", text: "생애 첫 주택이면 감면 요건을 먼저 확인하세요." },
    { type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "계약일이 아니라 잔금일이나 등기일이 취득일입니다." },
    { type: "faq", items: [{ question: "취득세는 어디에 신고하나요?", answer: "주택이 있는 시·군·구청이나 위택스에 신고합니다." }, { question: "신고와 납부를 따로 하나요?", answer: "신고하면서 함께 냅니다." }] },
  ];
  const body = await api("PATCH", `/articles/${fx.main.id}`, u.reporter, {
    body: { blocks: fx.mainBlocks, claims: [{ id: "claim-1", text: "취득일부터 60일 안에 신고하고 납부해야 한다.", kind: "legal", evidenceIds: [law.body.source.ref], blockIndex: 1 }] },
  });
  assert.equal(body.status, 200, show(body));
  assert.equal((await api("POST", `/articles/${fx.main.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve" })).status, 201);
  assert.equal((await api("POST", `/articles/${fx.main.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" })).status, 201);
  await publish(fx.main.id);

  // ── L. 「지방세로 읽기」 기사 — 부동산 해설, 박스 → 편집 승인 → 세무 감수(서명 기록) → 발행 ──
  const lens = await api("POST", "/articles", u.reporter, {
    slug: slugOf("lens"),
    title: `재건축 입주권, 취득세는 언제 내나 ${staff.run}`,
    summary: "관리처분인가 뒤 입주권을 사면 취득세가 어떻게 되는지 정리했습니다.",
    section: "realestate",
    categoryId: projects,
    contentType: "explainer",
    legalBasisDate: "2026-10-01",
    body: { blocks: [{ type: "paragraph", text: "입주권은 토지에 대한 권리로 봅니다. 준공 뒤에는 건물분 취득세를 따로 냅니다." }], claims: [] },
    taxLens: { topics: ["취득세"], points: ["입주권 취득은 토지분 취득세 대상입니다.", "준공 뒤 건물분은 따로 신고합니다."], links: [{ kind: "explainer", label: "해설 읽기", url: fx.main.href }], omissionReason: null },
  });
  assert.equal(lens.status, 201, show(lens));
  fx.lens = { id: lens.body.article.id, href: `/news/${slugOf("lens")}` };
  staff.trackArticle(fx.lens.id);
  assert.equal((await api("POST", `/articles/${fx.lens.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve" })).status, 201);
  assert.equal((await api("POST", `/articles/${fx.lens.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" })).status, 201);
  await publish(fx.lens.id);
  // 생략 사유 기사 · 서명자가 비공개인 박스 기사
  await insertArticle("lens-skip", { section: "realestate", categoryId: projects, taxLens: { topics: [], points: [], links: [], skip_reason: "세금 영향은 후속 기사에서", reviewed: false, reviewed_for_version: null } });
  await insertArticle("lens-hidden", {
    section: "realestate",
    categoryId: projects,
    legalBasisDate: "2026-10-01",
    taxLens: { topics: ["취득세"], points: ["한 줄입니다."], links: [{ kind: "explainer", label: "해설", url: fx.main.href }], skip_reason: null, reviewed: true, reviewed_for_version: 1, reviewed_by: u.hidden.personId, reviewed_at: hoursAgo(2) },
  });

  // ── W. 머리 글자 최악 견본 (R1 — W2-b 설계 9장): 제목 40자·요약 60자 꽉 채운 기사(고정 글자 — 무작위 꼬리 0) + 실질 수정·정정 알림.
  //    자연 문장 하나, 공백 없는 글자 하나(줄바꿈이 가장 촘촘한 경우). 편집국 API로 쓰고 발행한 뒤 고친다 — 저장 검사(40·60자)를 지난다 ──
  const HEAD_WORST = {
    worst: { title: "착한 임대인 재산세 감면 신청 기간, 올해부터 한 달 늘리고 창구도 넓혀", summary: "착한 임대인 재산세 감면은 다음 달 말까지 신청하면 됩니다. 올해부터는 위택스와 구청 창구에서 함께 받습니다" },
    dense: { title: "취득세신고기한".repeat(6).slice(0, 40), summary: "주택을사면취득일부터육십일안에신고합니다".repeat(3).slice(0, 60) },
  };
  for (const [label, head] of Object.entries(HEAD_WORST)) {
    assert.equal([...head.title].length, 40, `${label} 제목 40자`);
    assert.equal([...head.summary].length, 60, `${label} 요약 60자`);
    const made = await api("POST", "/articles", u.reporter, {
      slug: slugOf(label),
      ...head,
      section: "tax",
      categoryId: interpretations,
      contentType: "explainer",
      legalBasisDate: "2026-10-01",
      leadMediaId: fx.media.id,
    });
    assert.equal(made.status, 201, show(made));
    const id = made.body.article.id;
    fx[label] = { id, href: `/news/${slugOf(label)}` };
    staff.trackArticle(id);
    const src = await api("POST", `/articles/${id}/sources`, u.reporter, { kind: "official_doc", title: "지방세법 제20조(신고 및 납부)", url: "https://www.law.go.kr/법령/지방세법/제20조", sourceName: "법제처 국가법령정보센터", lastVerifiedAt: "2026-10-10T09:00:00+09:00", licenseStatus: "공공저작물 자유이용", ...OFFICIAL_W4 });
    assert.equal(src.status, 201, show(src));
    const headBlocks = (text) => [fx.mainBlocks[0], { type: "paragraph", text }];
    const written = await api("PATCH", `/articles/${id}`, u.reporter, {
      body: { blocks: headBlocks("취득일은 잔금일과 등기일 중 빠른 날이다. 자세한 흐름은 [지방세 허브](/tax)에서 볼 수 있다."), claims: [{ id: "claim-1", text: "취득일부터 60일 안에 신고하고 납부해야 한다.", kind: "legal", evidenceIds: [src.body.source.ref], blockIndex: 1 }] },
    });
    assert.equal(written.status, 200, show(written));
    assert.equal((await api("POST", `/articles/${id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve" })).status, 201);
    assert.equal((await api("POST", `/articles/${id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" })).status, 201);
    await publish(id);
    const update = await api("PATCH", `/articles/${id}`, u.editor, { body: { blocks: headBlocks("취득일은 잔금일과 등기일 중 빠른 날이다. 2026년 개편안도 같은 기준을 쓴다."), claims: [] }, updateKind: "substantive", reason: "2026년 개편안 기준 보강" });
    assert.equal(update.status, 200, show(update));
    const fix = await api("POST", `/articles/${id}/corrections`, u.editor, { kind: "correction", reason: "신고 기한 표기 오기", readerNotice: "신고 기한을 60일로 바로잡았습니다", changes: { body: { blocks: headBlocks("취득일은 잔금일과 등기일 중 빠른 날이다. 이날부터 60일 안에 신고한다."), claims: [] } } });
    assert.equal(fix.status, 201, show(fix));
  }

  // ── C. 카드뉴스 — 4장으로 만들어 발행 시도 (판정은 시험 g에서) ──
  const card = await api("POST", "/articles", u.reporter, {
    slug: slugOf("cards"),
    title: `카드뉴스로 보는 취득세 신고 ${staff.run}`,
    summary: "취득세 신고를 일곱 장으로 정리했습니다.",
    section: "tax",
    contentType: "explainer",
    format: "cardnews",
    legalBasisDate: "2026-10-01",
    body: { blocks: slides(4), claims: [] },
  });
  assert.equal(card.status, 201, show(card));
  fx.cards = { id: card.body.article.id, href: `/news/${slugOf("cards")}` };
  staff.trackArticle(fx.cards.id);
  assert.equal((await api("POST", `/articles/${fx.cards.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve" })).status, 201);

  // ── DB에 넣는 비교용 기사 ──
  await insertArticle("cards5", { format: "cardnews", title: "다섯 장 카드뉴스", body: { blocks: slides(5), claims: [] }, publishedAt: hoursAgo(30) });
  await insertArticle("draft", { status: "draft", title: "아직 초안" });
  await insertArticle("gone", { title: "삭제될 기사", publishedAt: hoursAgo(40) });
  // 정정·삭제는 지금 판의 수정 이력이 있어야 한다(전후 버전) — 편집국 API로 만든 기사처럼 첫 판 이력을 둔다
  await db.query("insert into public.article_revisions (article_id, version, title, body, edited_by) values ($1, 1, '삭제될 기사', '[]'::jsonb, 'user:e2e')", [fx.gone.id]);
  await insertArticle("ad", { contentType: "sponsored", label: "ad", title: "광고 기사 시험", publishedAt: hoursAgo(1) });
  const partner = await one("insert into public.partners (name, kind, visible) values ($1, 'tax_firm', true) returning id, name", [`가온세무법인${staff.run}`]);
  staff.trackRow("partners", partner.id);
  fx.partnerName = partner.name;
  await insertArticle("co", { contentType: "sponsored", label: "co_planned", partnerId: Number(partner.id), title: "공동 기획 기사 시험", publishedAt: hoursAgo(1.5) });
  // 공동 기획 뒤 제휴사가 비공개·계약 종료로 바뀐 기사 (W2-a 4-2 '이미 붙은 배지는 남는다' — W2-c 5단계 회귀)
  const hiddenLater = await one("insert into public.partners (name, kind, visible, contract_from, contract_to) values ($1, 'tax_firm', true, now() - interval '200 days', now() + interval '30 days') returning id, name", [`누리회계법인${staff.run}`]);
  staff.trackRow("partners", hiddenLater.id);
  fx.hiddenPartner = { id: Number(hiddenLater.id), name: hiddenLater.name };
  await insertArticle("coHidden", { section: "finance", contentType: "sponsored", label: "co_planned", partnerId: fx.hiddenPartner.id, title: "제휴사가 내려간 공동 기획", publishedAt: hoursAgo(1) });
  await db.query("update public.partners set visible = false, contract_to = (now() - interval '1 day')::date where id = $1", [fx.hiddenPartner.id]);
  await insertArticle("solved", {
    subtype: "solved_case",
    title: "계약일부터 세다 신고가 늦은 사례",
    publishedAt: hoursAgo(50),
    solvedCase: {
      situation: "한 납세자는 계약일부터 60일을 세어 신고했다.",
      issue: "신고 기간을 계약일부터 세는지가 쟁점이었다.",
      result: "심판기관은 잔금일을 취득일로 보았다.",
      lesson: "신고 기간은 잔금일과 등기일 중 빠른 날부터 셉니다.",
      resultEvidence: [{ kind: "decision", number: "조심2025지0001", url: "https://decisions.example.kr/tt/2025-ji-0001" }],
      conclusion: "rejected",
    },
  });
  // 칼럼 — 연재 「그때와 지금」 2회(먼저 발행)·1회·3회, 단독 칼럼 하나, 초안 칼럼 하나 (필자 박필자)
  const writer = u.writer.personId;
  await insertArticle("col2", { contentType: "opinion", categoryId: columns, authorId: writer, series: ["그때와 지금", 2], title: "그때와 지금 2회", publishedAt: hoursAgo(12) });
  await insertArticle("col1", { contentType: "opinion", categoryId: columns, authorId: writer, series: ["그때와 지금", 1], title: "그때와 지금 1회", publishedAt: hoursAgo(10) });
  await insertArticle("col3", { contentType: "opinion", categoryId: columns, authorId: writer, series: ["그때와 지금", 3], title: "그때와 지금 3회", publishedAt: hoursAgo(3) });
  await insertArticle("col-single", { contentType: "opinion", categoryId: columns, authorId: writer, title: "단독 칼럼 하나", publishedAt: hoursAgo(5) });
  await insertArticle("col-draft", { contentType: "opinion", categoryId: columns, authorId: writer, status: "draft", title: "초안 칼럼" });
  await insertArticle("hidden-author", { authorId: u.hidden.personId, title: "숨긴 기자의 기사" });
  // 상황 — 핵심 기사(A)를 잇는 공개 상황 (다음 행동 [이 상황 모아 보기])
  const sit = await one(
    `insert into public.situations (slug, section, title, subtitle, pictogram, checks, article_ids, solved_case_ids, visible, reviewer_id, reviewed_at, updated_by)
     values ($1, 'tax', '집을 샀어요', '취득세 신고를 확인합니다', 'home-bought', $2, $3, $4, true, $5, now(), 'user:e2e') returning id, slug`,
    [`e2e-art-sit-${staff.run}`, JSON.stringify([{ title: "잔금일" }, { title: "등기일" }, { title: "신고 기한" }]), [fx.main.id], [fx.solved.id], u.reviewer.personId],
  );
  staff.trackRow("situations", sit.id);
  fx.situation = { slug: sit.slug, href: `/situations/${sit.slug}` };
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    await removePolicies?.(); // cleanup()이 DB 연결을 닫기 전에
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("a) ART-02 — 머리·본문 블록·면책·기자 소개, 유형 배지 글자 = content_type, 출처 링크는 새 창", async () => {
  const { page, status } = await open(fx.main.href);
  assert.equal(status, 200);
  assert.deepEqual(await partsOf(page), ["head", "body", "reporter", "disclaimer", "related", "next"], "부분 순서 — 알림·「지방세로 읽기」·정책 링크는 내용이 없어 0");
  const head = page.locator('[data-article-part="head"]');
  assert.equal((await head.locator("h1").textContent()).trim(), `주택 취득세, 잔금일부터 60일 안에 신고 ${staff.run}`);
  assert.match(await head.textContent(), /주택을 사면 취득일부터 60일 안에/);
  assert.equal(await head.locator('[data-ui="article-type-badge"]').textContent(), "해설", "유형 배지 글자 = explainer");
  assert.equal(await head.locator('[data-ui="chip"]').first().textContent(), "지방세 › 해석");
  assert.equal(await head.locator('[data-part="byline"] a').getAttribute("href"), `/people/${fx.reporterSlug}`);
  assert.equal(await head.locator('time[data-date="basis"]').textContent(), "2026-10-01");
  assert.equal(await head.locator('time[data-date="modified"]').count(), 0, "발행 직후에는 실질 수정일 0");
  // 본문 블록 — 핵심 요약 · 문단(사이트 안 링크) · 표 · 이미지(대체 텍스트·출처) · 인용 · 상태 상자 2 · FAQ
  const types = await page.$$eval('[data-part="blocks"] > [data-block-type]', (els) => els.map((e) => e.getAttribute("data-block-type")));
  assert.deepEqual(types, fx.mainBlocks.map((b) => b.type));
  assert.equal(await page.locator('[data-part="blocks"] [data-ui="key-summary"] li').count(), 3);
  assert.equal(await page.locator('[data-part="blocks"] a[href="/tax"]').count(), 1, "문단 링크 [글](주소)");
  assert.equal(await page.locator('[data-part="blocks"] table th').count(), 2);
  assert.equal(await page.locator('[data-part="blocks"] figure[data-block="image"] img').getAttribute("alt"), "취득세 신고 절차 그림");
  assert.match(await page.locator('[data-part="blocks"] figure[data-block="image"]').textContent(), /사진·그림 편집국/);
  assert.deepEqual(await page.$$eval('[data-part="blocks"] [data-ui="status-box"]', (els) => els.map((e) => e.getAttribute("data-kind"))), ["tip", "mistake"]);
  assert.equal(await page.locator('[data-part="blocks"] [data-ui="faq-block"] [data-part="question"]').count(), 2);
  // 칸이 모두 찬 공식 자료는 공식 자료 원문 카드로 (W4 5단계 — 원문 링크 새 창 · 공공누리 유형 글자)
  assert.equal(await page.locator('[data-part="official-sources"] a').getAttribute("target"), "_blank");
  assert.equal(await page.locator('[data-part="official-sources"] [data-part="license-badge"]').innerText(), "공공누리 제1유형 (출처표시)");
  // 면책(면책 대상 하위 분야 '해석') · 기자 소개 → /people, 평문 이메일 0 · 정정 이력 0
  assert.equal(await page.locator('[data-part="disclaimer"]').count(), 1);
  assert.equal(await page.locator('[data-ui="reporter-block"] a').first().getAttribute("href"), `/people/${fx.reporterSlug}`);
  assert.doesNotMatch(await page.locator('[data-ui="reporter-block"]').textContent(), /@/);
  assert.equal(await page.locator('[data-ui="correction-history"]').count(), 0, "정정 0건 — 블록 요소 0");
  assert.equal(await page.locator('[data-ui="product-card"]').count(), 0, "자사 상품 카드 0 (01C 전)");
  await page.close();

  // 면책 대상이 아닌 기사(하위 분야 없음)에는 면책 0
  const cards5 = await open(fx.cards5.href);
  assert.equal(await cards5.page.locator('[data-part="disclaimer"]').count(), 0);
  await cards5.page.close();
});

test("b) 오탈자 수정은 날짜·JSON-LD 그대로, 실질 수정은 바꾸고 업데이트 표시 · 정정 1건이면 정정 이력 블록 1 (다른 라벨)", async () => {
  const blocks = (text) => fx.mainBlocks.map((b, i) => (i === 1 ? { ...b, text } : b));
  const before = await one("select first_published_at, substantive_updated_at from public.articles where id = $1", [fx.main.id]);
  const typo = await api("PATCH", `/articles/${fx.main.id}`, u.editor, { body: { blocks: blocks("취득일은 잔금을 치른 날과 등기를 마친 날 가운데 빠른 날이다. 자세한 흐름은 [지방세 허브](/tax)에서 볼 수 있다."), claims: [] }, updateKind: "typo", reason: "‘중’을 ‘가운데’로" });
  assert.equal(typo.status, 200, show(typo));
  let { page } = await open(fx.main.href);
  assert.equal(await page.locator('time[data-date="modified"]').count(), 0, "오탈자 — 화면 실질 수정일 그대로(없음)");
  assert.equal((await jsonLd(page)).main.dateModified, undefined, "오탈자 — JSON-LD dateModified 그대로(없음)");
  assert.equal(Date.parse(await page.locator('time[data-date="published"]').getAttribute("datetime")), before.first_published_at.getTime(), "최초 발행일 그대로");
  assert.equal(await page.locator('[data-part="update-notes"]').count(), 0, "오탈자는 업데이트 표시 0");
  await page.close();
  assert.equal((await one("select substantive_updated_at from public.articles where id = $1", [fx.main.id])).substantive_updated_at, before.substantive_updated_at);

  const sub = await api("PATCH", `/articles/${fx.main.id}`, u.editor, { body: { blocks: blocks("취득일은 잔금일과 등기일 중 빠른 날이다. 2026년 개편안도 같은 기준을 쓴다."), claims: [] }, updateKind: "substantive", reason: "2026년 개편안 기준 보강" });
  assert.equal(sub.status, 200, show(sub));
  const row = await one("select substantive_updated_at from public.articles where id = $1", [fx.main.id]);
  ({ page } = await open(fx.main.href));
  const modified = await page.locator('time[data-date="modified"]').getAttribute("datetime");
  assert.equal(Date.parse(modified), row.substantive_updated_at.getTime(), "실질 수정 — 화면 수정일 = DB 실질 수정일");
  assert.equal(Date.parse((await jsonLd(page)).main.dateModified), row.substantive_updated_at.getTime(), "실질 수정 — JSON-LD dateModified 같은 시각");
  const notes = await page.$$eval('[data-part="update-notes"] li', (els) => els.map((e) => e.textContent));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^수정 \d{4}-\d{2}-\d{2}: 2026년 개편안 기준 보강$/);
  assert.equal(await page.locator('[data-ui="correction-history"]').count(), 0, "업데이트 표시는 정정 이력 블록이 아니다");
  await page.close();

  const corr = await api("POST", `/articles/${fx.main.id}/corrections`, u.editor, {
    kind: "correction",
    reason: "신고 기한 표기 오기",
    readerNotice: "신고 기한을 60일로 바로잡았습니다",
    changes: { body: { blocks: blocks("취득일은 잔금일과 등기일 중 빠른 날이다. 이날부터 60일 안에 신고한다."), claims: [] } },
  });
  assert.equal(corr.status, 201, show(corr));
  ({ page } = await open(fx.main.href));
  const history = page.locator('[data-ui="correction-history"]');
  assert.equal(await history.count(), 1, "정정 1건 — 블록 1");
  assert.match(await history.locator("h2").textContent(), /정정 이력 1건/);
  assert.match(await history.textContent(), /신고 기한을 60일로 바로잡았습니다/);
  assert.equal(await history.locator("time").count(), 1, "정정 일시");
  const parts = await partsOf(page);
  assert.ok(parts.indexOf("notices") < parts.indexOf("body"), "알림(업데이트·정정)은 본문 위");
  // 정정 뒤 다른 기사(5장 카드뉴스)는 여전히 정정 블록 0
  await page.close();
  const other = await open(fx.cards5.href);
  assert.equal(await other.page.locator('[data-ui="correction-history"]').count(), 0);
  await other.page.close();
});

test("c) JSON-LD — 화면 값과 불일치 0 (해설·공동 기획·광고·카드뉴스), 대표 이미지 주소가 같다, 생성기가 만든 스크립트 하나", async () => {
  for (const href of [fx.main.href, fx.co.href, fx.ad.href, fx.cards5.href, fx.lens.href, fx.coHidden.href]) {
    const { page } = await open(href);
    const facts = await renderedFacts(page);
    const { raw, main: ld } = await jsonLd(page);
    assert.deepEqual(compareRendered(facts, raw), [], `${href}: ${JSON.stringify({ facts, headline: ld?.headline, author: ld?.author, image: ld?.image })}`);
    assert.equal(ld["@type"], "NewsArticle");
    if (href === fx.main.href) assert.equal(facts.mainImageUrl, fx.media.url, "대표 이미지 — 화면과 JSON-LD가 같은 절대 주소");
    if (href === fx.co.href) assert.equal(ld.headline, `[공동 기획 ${fx.partnerName}] 공동 기획 기사 시험`);
    // 제휴사가 비공개·계약 종료로 바뀌어도 JSON-LD 표기 제목은 '공동 기획 ○○' 그대로 ('광고'·이름 없는 '공동 기획' 0)
    if (href === fx.coHidden.href) assert.equal(ld.headline, `[공동 기획 ${fx.hiddenPartner.name}] 제휴사가 내려간 공동 기획`);
    await page.close();
  }
});

test("d) 표기 배지 — 목록 카드와 상세가 같은 글자 (광고 · 공동 기획 ○○), 둘을 섞지 않는다", async () => {
  const { page } = await open("/tax");
  const card = async (id) =>
    page.$eval(`[data-hub-part="latest"] [data-article-id="${id}"]`, (li) => ({
      type: [...li.querySelectorAll('[data-ui="article-type-badge"]')].map((e) => e.textContent),
      partner: [...li.querySelectorAll('[data-ui="partner-badge"]')].map((e) => e.textContent),
    }));
  const adCard = await card(fx.ad.id);
  const coCard = await card(fx.co.id);
  await page.close();
  assert.deepEqual(adCard, { type: ["광고"], partner: [] });
  assert.deepEqual(coCard, { type: [], partner: [`공동 기획 ${fx.partnerName}`] });
  for (const [href, expected] of [
    [fx.ad.href, adCard],
    [fx.co.href, coCard],
  ]) {
    const d = await open(href);
    const head = d.page.locator('[data-article-part="head"]');
    assert.deepEqual(
      { type: await head.locator('[data-ui="article-type-badge"]').allTextContents(), partner: await head.locator('[data-ui="partner-badge"]').allTextContents() },
      expected,
      `${href}: 상세 배지 = 목록 카드 배지`,
    );
    await d.page.close();
  }
});

test("d-2) 공동 기획 뒤 제휴사가 비공개·계약 종료로 바뀌어도 카드·상세 배지는 '공동 기획 ○○' 그대로 — '광고' 0, 숨은 제휴사 프로필 링크 0 (ART-10 · W2-a 4-2)", async () => {
  const expected = { type: [], partner: [`공동 기획 ${fx.hiddenPartner.name}`] };
  const { page } = await open("/finance");
  const card = await page.$eval(`[data-hub-part="latest"] [data-article-id="${fx.coHidden.id}"]`, (li) => ({
    type: [...li.querySelectorAll('[data-ui="article-type-badge"]')].map((e) => e.textContent),
    partner: [...li.querySelectorAll('[data-ui="partner-badge"]')].map((e) => e.textContent),
  }));
  await page.close();
  assert.deepEqual(card, expected, "목록 카드");
  const d = await open(fx.coHidden.href);
  const head = d.page.locator('[data-article-part="head"]');
  assert.deepEqual({ type: await head.locator('[data-ui="article-type-badge"]').allTextContents(), partner: await head.locator('[data-ui="partner-badge"]').allTextContents() }, expected, "기사 상세 머리");
  assert.equal(await head.locator('[data-part="partner-link"]').count(), 0, "비공개 제휴사 프로필로 가는 링크 0");
  assert.equal(await d.page.locator(`a[href="/partners/${fx.hiddenPartner.id}"]`).count(), 0);
  const ogTitle = await d.page.locator('meta[property="og:title"]').getAttribute("content");
  assert.ok(ogTitle.includes(`[공동 기획 ${fx.hiddenPartner.name}]`), `공유 제목: ${ogTitle}`);
  await d.page.close();
  assert.equal((await fetch(`${base}/partners/${fx.hiddenPartner.id}`)).status, 404, "프로필은 그대로 비공개");
});

test("e) 「지방세로 읽기」 — 서명 기록이 있는 박스만, 본문 뒤·기자 소개 앞, '감수 ○○'는 서명한 감수위원 / 생략 사유·비공개 서명자 박스 0", async () => {
  const row = await one("select tax_lens from public.articles where id = $1", [fx.lens.id]);
  assert.equal(row.tax_lens.reviewed_by, u.reviewer.personId, "세무 감수 승인이 서명자를 박스에 남긴다");
  const { page } = await open(fx.lens.href);
  const box = page.locator('[data-ui="tax-lens-box"]');
  assert.equal(await box.count(), 1);
  assert.match(await box.textContent(), /감수 이감수 세무사 · 기준일 2026-10-01/);
  assert.equal(await box.locator(`a[href="${fx.main.href}"]`).count(), 1, "해설 링크");
  const order = await page.evaluate(() => {
    const at = (sel) => {
      const el = document.querySelector(sel);
      return el ? [...document.querySelectorAll("[data-article-part]")].indexOf(el.closest("[data-article-part]")) : -1;
    };
    return { body: at('[data-part="article-body"]'), box: at('[data-ui="tax-lens-box"]'), reporter: at('[data-ui="reporter-block"]'), next: at('[data-ui="next-action-band"]') };
  });
  assert.ok(order.body < order.box && order.box < order.reporter, JSON.stringify(order));
  if (order.next !== -1) assert.ok(order.box < order.next, "박스는 다음 행동 띠 앞");
  await page.close();
  for (const href of [fx["lens-skip"].href, fx["lens-hidden"].href]) {
    const p = await open(href);
    assert.equal(p.status, 200);
    assert.equal(await p.page.locator('[data-ui="tax-lens-box"]').count(), 0, `${href}: 박스 요소 0`);
    assert.equal(await p.page.locator('[data-article-part="tax-lens"]').count(), 0);
    await p.page.close();
  }
});

test("f) 삭제된 기사 410 + 삭제 안내 · 초안 404 · 예약 목록 경로 404 · 비공개 인물 404", async () => {
  const del = await api("POST", `/articles/${fx.gone.id}/corrections`, u.editor, { kind: "deletion", reason: "권리 문제로 내림" });
  assert.equal(del.status, 201, show(del));
  const gone = await fetch(`${base}${fx.gone.href}`);
  assert.equal(gone.status, 410);
  assert.equal(gone.headers.get("cache-control"), "no-store");
  const html = await gone.text();
  assert.match(html, /삭제된 기사입니다/);
  assert.match(html, /편집국이 내렸습니다/);
  assert.doesNotMatch(html, /삭제될 기사|권리 문제/, "삭제된 기사의 제목·사유는 보이지 않는다");
  for (const p of [fx.draft.href, "/news/no-such-article", "/news/video", `/people/${fx.hiddenSlug}`, "/people/no-such-person"]) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 404, p);
  }
});

test("g) 카드뉴스 — 4장·8장·대체 텍스트 없는 장은 발행 422, 7장은 발행, 5장·7장 모두 HTML 글자 장 · 키보드 ←/→", async () => {
  let r = await api("POST", `/articles/${fx.cards.id}/publish`, u.editor);
  assert.equal(r.status, 422, show(r));
  assert.ok(r.body.failed.includes("art03.slide-count"), show(r));
  const save = async (blocks) => {
    const s = await api("PATCH", `/articles/${fx.cards.id}`, u.reporter, { body: { blocks, claims: [] } });
    assert.equal(s.status, 200, show(s));
    assert.equal((await api("POST", `/articles/${fx.cards.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve" })).status, 201);
  };
  await save(slides(8));
  r = await api("POST", `/articles/${fx.cards.id}/publish`, u.editor);
  assert.equal(r.status, 422);
  assert.ok(r.body.failed.includes("art03.slide-count"), show(r));
  const noAlt = slides(7);
  noAlt[3] = slide(4, { alt: "" });
  await save(noAlt);
  r = await api("POST", `/articles/${fx.cards.id}/publish`, u.editor);
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.failed.filter((id) => id.startsWith("art03.")), ["art03.slide-alt"], show(r));
  await save(slides(7));
  await publish(fx.cards.id);

  for (const [href, n] of [
    [fx.cards.href, 7],
    [fx.cards5.href, 5],
  ]) {
    const { page, status } = await open(href, { width: 360, height: 740 });
    assert.equal(status, 200);
    const deck = page.locator('[data-ui="card-news"]');
    assert.equal(await deck.getAttribute("data-slide-count"), String(n));
    const items = await page.$$eval('[data-ui="card-news"] [data-slide]', (lis) =>
      lis.map((li) => ({ label: li.getAttribute("aria-label"), text: li.textContent, images: li.querySelectorAll("img, svg, canvas").length })),
    );
    assert.equal(items.length, n);
    items.forEach((it, i) => {
      assert.equal(it.images, 0, `${n}장 ${i + 1}: 글자는 이미지가 아니다`);
      assert.ok(it.text.includes(`${i + 1}번째 장 글입니다.`), `${n}장 ${i + 1}: HTML 글자`);
      assert.equal(it.label, `${i + 1} / ${n} — ${i + 1}번째 장 — 달력 그림 위에 날짜를 표시했습니다`, "장마다 대체 텍스트");
    });
    assert.equal(await page.locator('[data-ui="card-news"] [data-part="slide-status"]').textContent(), `1 / ${n}`);
    // 키보드 — 장 목록에 초점을 두고 → 두 번, ← 한 번
    await page.locator('[data-ui="card-news"] [data-part="slide-track"]').focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector('[data-ui="card-news"] [data-part="slide-status"]')?.textContent === `3 / ${document.querySelectorAll('[data-ui="card-news"] [data-slide]').length}`);
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => document.querySelector('[data-ui="card-news"] [data-slide][aria-current="true"]')?.getAttribute("data-slide") === "2");
    // 장이 실제로 화면에 들어온다 (가로로 넘어갔다)
    await page.waitForFunction(() => {
      const li = document.querySelector('[data-ui="card-news"] [data-slide="2"]');
      const r = li.getBoundingClientRect();
      return r.left >= -1 && r.right <= window.innerWidth + 1;
    });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${href}: 360px 화면 가로 스크롤 0`);
    // 공유 미리보기 — 첫 장의 글이 설명으로 (og:image는 대표 이미지 — 첫 장 그림 만들기는 설계 9장)
    assert.match((await page.getAttribute('meta[property="og:description"]', "content")) ?? "", /^1\. 취득세 신고 1번째 장 글입니다\./);
    await page.close();
  }
});

test("h) 칼럼 — 연재 회차 순서·의견 고지, 단독 칼럼은 끝 · 뉴스 전체에 0 · 인물 페이지는 그 사람의 공개 기사만", async () => {
  const { page, status } = await open("/tax/columns");
  assert.equal(status, 200);
  assert.match(await page.locator('[data-part="opinion-notice"]').textContent(), /의견이며 개별 자문이 아닙니다/);
  const groups = await page.$$eval("[data-column-series]", (els) => els.map((g) => [g.getAttribute("data-column-series"), [...g.querySelectorAll("[data-article-id]")].map((li) => [Number(li.getAttribute("data-article-id")), li.getAttribute("data-episode")])]));
  assert.deepEqual(groups, [
    ["그때와 지금", [[fx.col1.id, "1"], [fx.col2.id, "2"], [fx.col3.id, "3"]]],
    ["", [[fx["col-single"].id, ""]]],
  ]);
  assert.deepEqual(await page.$$eval('[data-column-series="그때와 지금"] [data-episode] > p', (ps) => ps.map((p) => p.textContent)), ["1회", "2회", "3회"]);
  assert.ok((await page.$$eval('[data-part="writer-link"]', (as) => as.map((a) => a.getAttribute("href")))).includes(`/people/${fx.writerSlug}`), "필자 링크");
  assert.ok(!(await page.content()).includes(fx["col-draft"].slug), "초안 칼럼 0");
  await page.close();
  // 칼럼 상세 — 연재 줄·필자·의견 고지 1개
  const col = await open(fx.col2.href);
  assert.equal(await col.page.locator('[data-part="series"]').textContent(), "연재 「그때와 지금」 2회");
  assert.equal(await col.page.locator('[data-ui="article-type-badge"]').first().textContent(), "오피니언");
  assert.equal(await col.page.getByText("의견이며 개별 자문이 아닙니다").count(), 1, "칼럼 상세마다 고지 1개");
  assert.match(await col.page.locator('[data-ui="reporter-block"]').textContent(), /필자/);
  await col.page.close();
  // 뉴스 전체에 칼럼 0
  const news = await fetch(`${base}/news`).then((r) => r.text());
  for (const k of ["col1", "col2", "col3", "col-single"]) assert.ok(!news.includes(fx[k].slug), `뉴스 전체에 칼럼 ${k} 0`);
  // 인물 페이지 — 그 사람의 공개 기사만 (초안 0, 다른 기자 기사 0)
  const person = await open(`/people/${fx.writerSlug}`);
  assert.equal(person.status, 200);
  assert.equal((await person.page.locator("h1").textContent()).trim(), "박필자");
  const ids = (await person.page.$$eval('[data-part="person-articles"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id"))))).sort();
  assert.deepEqual(ids, [fx.col1.id, fx.col2.id, fx.col3.id, fx["col-single"].id].sort());
  assert.equal((await jsonLd(person.page)).main["@type"], "ProfilePage");
  assert.doesNotMatch(await person.page.evaluate(() => document.querySelector("main").innerText), /@/, "평문 이메일 0 (화면 글자 — 구조화 데이터 스크립트 제외)");
  await person.page.close();
  const reporter = await open(`/people/${fx.reporterSlug}`);
  const reporterIds = await reporter.page.$$eval('[data-part="person-articles"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id"))));
  assert.ok(reporterIds.includes(fx.main.id) && !reporterIds.includes(fx.col1.id) && !reporterIds.includes(fx.draft.id), JSON.stringify(reporterIds));
  await reporter.page.close();
});

test("i) 다음 행동 띠 — 자기 자신 0·해결 사례 먼저, 버튼 후보 3개면 앞의 2개, 닫힌 기능 0 · 해결 사례 카드 4칸·결론 배지·근거 새 창", async () => {
  // 전문가 찾기를 열어 버튼 후보를 3개(이 상황 모아 보기 · 같은 분야 더 보기 · 전문가 찾기)로 만든다
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  let r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...flags, expert_finder: true } });
  assert.equal(r.status, 200, show(r));
  const { page } = await open(fx.main.href);
  const band = page.locator('[data-ui="next-action-band"]');
  const cases = await band.locator("ul[aria-labelledby] a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  assert.ok(cases.length >= 1 && cases.length <= 3, JSON.stringify(cases));
  assert.ok(!cases.includes(fx.main.href), "비슷한 사례에 자기 자신 0");
  assert.equal(cases[0], fx.solved.href, "해결 사례 먼저");
  assert.ok(!cases.includes(fx.draft.href), "비공개 기사 0");
  const buttons = await band.locator("[data-next-action]").evaluateAll((lis) => lis.map((li) => [li.getAttribute("data-next-action"), li.querySelector("a")?.getAttribute("href")]));
  assert.deepEqual(buttons, [
    ["situation", fx.situation.href],
    ["same_section", "/tax/interpretations"],
  ]);
  assert.equal(await page.locator('[data-ui="primary-button"]').count(), 0, "띠 안 주 버튼 0 (R2)");
  await page.close();
  r = await api("PATCH", "/settings/feature_flags", u.admin, { value: flags });
  assert.equal(r.status, 200);

  // 해결 사례 상세 — 카드 4칸·결론 배지 '기각'·근거 칩은 새 창 · 재구성 고지
  const solved = await open(fx.solved.href);
  const card = solved.page.locator('[data-part="solved-case"] [data-ui="solved-case-card"]');
  assert.equal(await card.count(), 1);
  assert.deepEqual(await card.locator("[data-step-label]").allTextContents(), ["상황", "쟁점", "결과", "교훈"]);
  assert.equal(await card.locator("[data-conclusion]").textContent(), "기각");
  const basis = card.locator('a[href="https://decisions.example.kr/tt/2025-ji-0001"]');
  assert.equal(await basis.getAttribute("target"), "_blank");
  assert.match(await card.textContent(), /다시 구성한 사례입니다/);
  await solved.page.close();
  // 상황 페이지의 해결 사례도 같은 카드
  const sit = await open(fx.situation.href);
  assert.equal(await sit.page.locator(`[data-part="solved-cases"] [data-article-id="${fx.solved.id}"][data-solved-card="true"] [data-conclusion="rejected"]`).count(), 1);
  await sit.page.close();
});

test("j) 정책 링크 — 공개 승인된 것만 (꺼진 것 0), 기자 소개의 정정·편집 원칙 링크도 같은 기준", async () => {
  let p = await open(fx.main.href);
  assert.equal(await p.page.locator('[data-article-part="policy"]').count(), 0, "모두 꺼짐 — 정책 링크 자리 0");
  assert.equal(await p.page.locator('[data-ui="reporter-block"] a[href^="/about"]').count(), 0);
  await p.page.close();
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...flags, page_about: true, page_corrections: true } });
  assert.equal(r.status, 200, show(r));
  p = await open(fx.main.href);
  assert.deepEqual(await p.page.$$eval('[data-article-part="policy"] a', (as) => as.map((a) => [a.textContent, a.getAttribute("href")])), [
    ["회사 소개", "/about"],
    ["정정·반론 창구", "/about/corrections"],
  ]);
  assert.deepEqual(await p.page.$$eval('[data-ui="reporter-block"] a[href^="/about"]', (as) => as.map((a) => a.getAttribute("href"))), ["/about/corrections"]);
  await p.page.close();
  assert.equal((await api("PATCH", "/settings/feature_flags", u.admin, { value: flags })).status, 200);
});

test("k) 화면 전환 — 허브 → 기사 상세 → 인물 → 뒤로·뒤로, 문서 새로고침 0·페이지 표식 유지", async () => {
  const { page } = await open("/tax");
  await page.evaluate(() => (window.__e2eMarker = "kept"));
  const documents = [];
  page.on("request", (r) => {
    if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
  });
  await page.locator(`[data-hub-part="latest"] a[href="${fx.main.href}"]`).click();
  await page.waitForURL(`${base}${fx.main.href}`);
  await page.locator('[data-ui="article-page"]').waitFor();
  await page.locator('[data-ui="reporter-block"] a').first().click();
  await page.waitForURL(`${base}/people/${fx.reporterSlug}`);
  await page.locator('[data-ui="person-page"]').waitFor();
  await page.goBack();
  await page.locator('[data-ui="article-page"]').waitFor();
  await page.goBack();
  await page.waitForURL(`${base}/tax`);
  await page.locator('[data-ui="hub"][data-hub="tax"]').waitFor();
  assert.equal(await page.evaluate(() => window.__e2eMarker), "kept");
  assert.deepEqual(documents, []);
  await page.close();
});

test("l) 화면 규칙 R1·R2·R3 — 기사 상세 폭 360·640·1024 (R1은 360×740), 360px 가로 스크롤 0·다음 행동 버튼 328px", async () => {
  for (const width of [360, 640, 1024]) {
    const r = await measurePage(browser, `${base}${fx.main.href}`, { width, height: 740 });
    if (width === 360) assert.ok(r.r1.pass, `${width}px R1 ${r.r1.chars}자 > 150`);
    assert.ok(r.r2.pass, `${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
    assert.ok(r.r3.pass, `${width}px R3 오렌지 ${r.r3.ratio}`);
  }
  for (const href of [fx.main.href, fx.cards.href, fx.solved.href, fx.lens.href, "/tax/columns", `/people/${fx.writerSlug}`]) {
    const { page } = await open(href, { width: 360, height: 740 });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${href}: 가로 스크롤`);
    const small = await page.$$eval('main [data-ui="next-action-band"] a, main [data-part="share"] button, main [data-ui="card-news"] button, main [data-part="byline"] a', (els) =>
      els.map((a) => ({ t: a.textContent, ...a.getBoundingClientRect().toJSON() })).filter((x) => x.height < 44 || x.width < 44),
    );
    assert.deepEqual(small, [], `${href}: 터치 영역 44px 미만`);
    if (href === fx.main.href) {
      const box = await page.locator('[data-ui="next-action-band"] [data-ui="dark-button"]').first().boundingBox();
      assert.equal(Math.round(box.width), 328, "다음 행동 버튼 너비 = 화면 폭 − 32px");
    }
    await page.close();
  }
});

test("l) R1 최악 견본 — 제목 40자·요약 60자(자연 문장·공백 없는 글자) + 실질 수정·정정 알림: 360×740 첫 화면 150자 이하, 첫 화면은 머리(칩·제목·요약·기자)뿐 — 날짜·공유·알림은 첫 화면 바로 아래", async () => {
  for (const label of ["worst", "dense", "main"]) {
    const href = fx[label].href;
    const r = await measurePage(browser, `${base}${href}`, { width: 360, height: 740 });
    assert.ok(r.r1.pass, `${label}: 360px R1 ${r.r1.chars}자 > 150`);
    const { page } = await open(href, { width: 360, height: 740 });
    const tops = await page.evaluate(() => {
      const top = (sel) => {
        const el = document.querySelector(sel);
        return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
      };
      return { byline: top('[data-part="byline"]'), dates: top('[data-part="dates"]'), share: top('[data-part="share"]'), notices: top('[data-article-part="notices"]'), scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    assert.ok(tops.byline !== null && tops.byline < 740, `${label}: 기자 줄은 첫 화면 안 (${tops.byline})`);
    for (const k of ["dates", "notices"]) assert.ok(tops[k] !== null && tops[k] >= 740, `${label}: ${k}는 첫 화면 아래 (${tops[k]})`);
    assert.ok(tops.scroll <= 0, `${label}: 가로 스크롤 ${tops.scroll}px (공백 없는 긴 요약도 줄을 바꾼다)`);
    await page.close();
  }
  // 넓은 화면은 그대로 흐른다 — 기자 · 날짜 · 공유가 이어지고 알림이 머리 바로 뒤
  const { page } = await open(fx.worst.href, { width: 1024, height: 740 });
  const wide = await page.evaluate(() => ["byline", "dates", "share"].map((p) => Math.round(document.querySelector(`[data-part="${p}"]`).getBoundingClientRect().top)));
  assert.ok(wide[0] < wide[1] && wide[1] < wide[2] && wide[2] < 740, `1024px 머리 순서·첫 화면: ${wide}`);
  await page.close();
});

test("시험 동안 예상 못 한 서버 오류가 없었다", () => {
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[public\]|⨯/);
});
