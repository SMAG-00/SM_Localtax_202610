// ② 확인 한 버튼 끝까지 E2E (F4 · 2026-10-31 PO 결정) — docs/dev/F4_설계.md 2장
// standalone 빌드를 로컬 Supabase에 붙인다. 기사는 편집국 API로 쓰고(저장 판정을 지난다), 화면의 버튼을 실제로 눌러 발행까지 간다.
//  a) [승인하고 발행] — 편집 책임자가 기자 기사(세무 감수 대상 아님)를 연다 → 편집 확인 4항목 체크 → 누름
//     → 요청 순서 reviews → publish · 기사 published · 공개 /news/<주소> 200에 제목 · desk_edit 승인 1행(selfPublish 없음) · 발행 기록·감사 로그 '발행'
//  b) [본인 발행] — 작성자인 편집 책임자가 자기 기사(세무 감수 대상 아님)를 연다 → 누름
//     → desk_edit 승인 1행 checklist.selfPublish = true · check_log.publish.selfPublish = true · 감사 로그 사유 '본인 발행'(편집 승인·발행 둘 다)
//  c) [감수하고 발행] — 감수위원+편집 책임자 계정이 법률 주장이 있는 기자 기사(세무 감수 대상)를 연다 → 감수 2항목 + 편집 4항목 → 누름
//     → 요청 순서 reviews(tax_review) → reviews(desk_edit) → publish · tax_review·desk_edit 승인 행 · 세무 감수 상태 approved · published
// 만든 계정·기사·감사 로그는 끝나면 지운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

// W4 5단계 (REG1-09 · PR-07) — 공식 자료 출처의 공공누리 유형·발표일·기준일·지역 단위·수집일 (시험용 값, site-article.test.mjs와 같다)
const OFFICIAL_W4 = { licenseType: "kogl_1", publishedOn: "2026-10-01", referenceDate: "2026-10-01", regionUnit: "전국", collectedAt: "2026-10-10T09:00:00+09:00" };
const DESK_IDS = ["sourcesChecked", "claimsChecked", "titleChecked", "imagesChecked"];
const TAX_IDS = ["lawBasisChecked", "taxStatementsChecked"];

let sb, server, staff, db, base, browser;
const u = {};
const fx = {};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (sql, params) => (await db.query(sql, params)).rows;

async function api(method, apiPath, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${apiPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const show = (r) => JSON.stringify(r.body).slice(0, 1500);

/** 편집국 API로 해설 기사를 쓴다 — 분야 없음·세법 기준일 있음(저장·최적화 판정을 지난다) */
async function createExplainer(user, label, over = {}) {
  const slug = `confirm-e2e-${label}-${staff.run}`;
  const title = `한 버튼 발행 시험 ${label} ${staff.run}`;
  const r = await api("POST", "/articles", user, {
    slug,
    title,
    summary: "확인 항목을 체크하고 버튼 하나로 발행까지 가는지 봅니다.",
    section: "tax",
    contentType: "explainer",
    legalBasisDate: "2026-10-01",
    body: { blocks: [{ type: "paragraph", text: "주택을 사면 취득일부터 60일 안에 취득세를 신고합니다." }], claims: [] },
    ...over,
  });
  assert.equal(r.status, 201, `기사 만들기 ${label}: ${show(r)}`);
  const id = Number(r.body.article.id);
  staff.trackArticle(id);
  return { id, slug, title };
}

/** 발행 판정이 남긴 막힘 ID — 시험 준비가 맞는지(① 쓰기 막힘 0) 확인한다 */
async function failedIds(id, user) {
  const r = await api("GET", `/articles/${id}/check`, user);
  assert.equal(r.status, 200, show(r));
  return { failed: [...r.body.failed].sort(), taxReviewReasons: r.body.taxReviewReasons };
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    NEXT_PUBLIC_SITE_URL: "https://e2e.example.test",
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  u.reporter = await staff.createUser({ label: "confirm-rep", roles: ["reporter"], person: { name: "한버튼 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "confirm-editor", roles: ["editor"], person: { name: "한버튼 편집자", roles: ["editor"] } });
  u.selfEditor = await staff.createUser({ label: "confirm-self", roles: ["editor"], person: { name: "한버튼 본인 발행 편집자", roles: ["editor"] } });
  u.reviewEditor = await staff.createUser({ label: "confirm-rv-ed", roles: ["reviewer", "editor"], person: { name: "한버튼 감수 편집자", roles: ["reviewer", "editor"] } });

  // a) 기자 기사 — 세무 감수 대상 아님
  fx.plain = await createExplainer(u.reporter, "plain");
  // b) 편집 책임자 본인 기사 — 세무 감수 대상 아님
  fx.own = await createExplainer(u.selfEditor, "own");
  // c) 기자 기사 — 법률 주장(근거 = 공식 문서 출처) → 세무 감수 대상
  fx.tax = await createExplainer(u.reporter, "tax");
  const law = await api("POST", `/articles/${fx.tax.id}/sources`, u.reporter, {
    kind: "official_doc",
    title: "지방세법 제20조(신고 및 납부)",
    url: "https://www.law.go.kr/법령/지방세법/제20조",
    sourceName: "법제처 국가법령정보센터",
    lastVerifiedAt: "2026-10-10T09:00:00+09:00",
    licenseStatus: "공공저작물 자유이용",
    ...OFFICIAL_W4,
  });
  assert.equal(law.status, 201, show(law));
  const claimed = await api("PATCH", `/articles/${fx.tax.id}`, u.reporter, {
    body: {
      blocks: [{ type: "paragraph", text: "주택을 사면 취득일부터 60일 안에 취득세를 신고하고 납부해야 합니다." }],
      claims: [{ id: "claim-1", text: "취득일부터 60일 안에 신고하고 납부해야 한다.", kind: "legal", evidenceIds: [law.body.source.ref], blockIndex: 0 }],
    },
  });
  assert.equal(claimed.status, 200, show(claimed));

  // 준비 확인 — 남은 막힘은 ② 확인 항목뿐이다 (① 쓰기 막힘이 있으면 버튼이 꺼져 이 시험이 뜻을 잃는다)
  assert.deepEqual(await failedIds(fx.plain.id, u.editor), { failed: ["nav03.desk-edit-required"], taxReviewReasons: [] });
  assert.deepEqual(await failedIds(fx.own.id, u.selfEditor), { failed: ["nav03.desk-edit-required"], taxReviewReasons: [] });
  assert.deepEqual(await failedIds(fx.tax.id, u.reviewEditor), { failed: ["nav03.desk-edit-required", "nav03.tax-review-required"], taxReviewReasons: ["세금 계산·법률 주장 (NAV-12)"] });
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

async function loginAt(page, user, next) {
  await page.goto(`${base}/admin/login?next=${encodeURIComponent(next)}`);
  await page.fill("#login-email", user.email);
  await page.fill("#login-password", user.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname === next);
}

/**
 * 기사 편집 화면을 열고 한 버튼 칸의 확인 항목을 모두 체크한 뒤 버튼을 누른다.
 * 브라우저가 보낸 검토·발행 요청(경로·본문)을 순서대로, 발행 응답의 경고 목록과 함께 돌려준다
 */
async function clickConfirm(user, article, { mode, label, deskIds, taxIds }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const path = `/admin/articles/${article.id}`;
    await loginAt(page, user, path);
    const box = page.locator('[data-step="confirm"]').getByTestId("confirm-publish");
    await box.waitFor();
    assert.equal(await box.getAttribute("data-mode"), mode);
    const button = box.getByTestId("confirm-publish-button");
    assert.equal(await button.innerText(), label);
    assert.deepEqual(await box.locator('input[id^="confirm-desk-"]').evaluateAll((els) => els.map((e) => e.id.slice("confirm-desk-".length))), deskIds);
    assert.deepEqual(await box.locator('input[id^="confirm-tax-"]').evaluateAll((els) => els.map((e) => e.id.slice("confirm-tax-".length))), taxIds);

    const boxes = await box.locator('input[type="checkbox"]').all();
    // 하나라도 비면 버튼은 꺼져 있다 — 마지막 항목을 체크해야 켜진다
    for (const c of boxes.slice(0, -1)) await c.check();
    assert.equal(await button.isDisabled(), true, "확인 항목이 하나 남으면 꺼짐");
    await boxes[boxes.length - 1].check();
    await page.waitForFunction(() => document.querySelector('[data-testid="confirm-publish-button"]')?.disabled === false);

    const sent = [];
    page.on("request", (req) => {
      const p = new URL(req.url()).pathname;
      if (req.method() === "POST" && p.startsWith(`/api/admin/articles/${article.id}/`)) sent.push({ path: p.slice(`/api/admin/articles/${article.id}`.length), body: req.postDataJSON() });
    });
    const published = page.waitForResponse((res) => res.request().method() === "POST" && new URL(res.url()).pathname === `/api/admin/articles/${article.id}/publish`);
    await button.click();
    const res = await published;
    assert.equal(res.status(), 200, `발행 응답: ${(await res.text()).slice(0, 1500)}`);
    const publishBody = await res.json();
    // 성공하면 서버가 화면을 새로 그린다 — 발행된 기사에는 단계표가 없다
    await page.getByTestId("publish-steps").waitFor({ state: "detached" });
    return { sent, warnings: publishBody.warnings };
  } finally {
    await context.close();
  }
}

/** 공개 기사 화면 — 200이고 제목이 있다 */
async function assertPublic(article) {
  const res = await fetch(`${base}/news/${encodeURIComponent(article.slug)}`);
  assert.equal(res.status, 200, `공개 화면 /news/${article.slug}`);
  const html = await res.text();
  assert.ok(html.includes(article.title), "공개 화면에 기사 제목");
}

const reviewsOf = (id) => rows("select kind, decision, reviewer_id, version, checklist from public.editorial_reviews where article_id = $1 order by id", [id]);
const auditOf = (id) => rows("select actor, action, reason, after from public.audit_logs where target = $1 and action in ('review.desk_edit', 'review.tax_review', 'article.publish') order by id", [`articles:${id}`]);
const allTrue = (ids) => Object.fromEntries(ids.map((k) => [k, true]));
/** 발행 감사 로그 사유 — 경고는 막지 않고 발행 기록에 남는다(경고 수는 판정 규칙에 따라 바뀌므로 발행 기록의 목록 길이로 맞춘다) */
const publishReason = (head, warnings) => `${head}${warnings.length ? ` — 경고 ${warnings.length}개 기록` : ""}`;

test("a) [승인하고 발행] — 편집 책임자가 기자 기사를 편집 확인 4항목 체크 후 한 번 눌러 발행한다 (본인 발행 표시 없음)", async () => {
  const { sent, warnings } = await clickConfirm(u.editor, fx.plain, { mode: "combined", label: "승인하고 발행", deskIds: DESK_IDS, taxIds: [] });
  assert.deepEqual(
    sent.map((s) => s.path),
    ["/reviews", "/publish"],
    "편집 승인 → 발행 순서로 두 번만 보낸다",
  );
  assert.deepEqual(sent[0].body, { kind: "desk_edit", decision: "approve", checklist: allTrue(DESK_IDS) });

  const row = await one("select status, first_published_at, editorial_status, tax_review_status, check_log -> 'publish' as pub from public.articles where id = $1", [fx.plain.id]);
  assert.equal(row.status, "published");
  assert.ok(row.first_published_at !== null, "최초 발행일 기록");
  assert.equal(row.editorial_status, "approved");
  assert.equal(row.tax_review_status, "not_required");
  assert.equal(row.pub.by, `user:${u.editor.id}`);
  assert.equal("selfPublish" in row.pub, false, "다른 사람이 승인한 발행 기록에는 본인 발행 표시가 없다");
  assert.deepEqual(row.pub.warnings, warnings, "발행 응답의 경고 = 발행 기록의 경고");

  const reviews = await reviewsOf(fx.plain.id);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].kind, "desk_edit");
  assert.equal(reviews[0].decision, "approve");
  assert.equal(Number(reviews[0].reviewer_id), u.editor.personId);
  assert.deepEqual(reviews[0].checklist, allTrue(DESK_IDS), "checklist에 selfPublish 없음");

  const audit = await auditOf(fx.plain.id);
  assert.deepEqual(
    audit.map((x) => [x.action, x.reason]),
    [
      ["review.desk_edit", "desk_edit approve"],
      ["article.publish", publishReason("발행", warnings)],
    ],
  );
  assert.ok(audit.every((x) => x.actor === `user:${u.editor.id}` && !("selfPublish" in x.after)));
  await assertPublic(fx.plain);
});

test("b) [본인 발행] — 작성자인 편집 책임자가 자기 기사를 혼자 승인·발행하고 '본인 발행'이 편집 승인·발행 기록·감사 로그에 남는다", async () => {
  const { sent, warnings } = await clickConfirm(u.selfEditor, fx.own, { mode: "self", label: "본인 발행", deskIds: DESK_IDS, taxIds: [] });
  assert.deepEqual(
    sent.map((s) => s.path),
    ["/reviews", "/publish"],
  );
  assert.deepEqual(sent[0].body, { kind: "desk_edit", decision: "approve", checklist: { ...allTrue(DESK_IDS), selfPublish: true } });

  const row = await one("select status, editorial_status, check_log -> 'publish' as pub from public.articles where id = $1", [fx.own.id]);
  assert.equal(row.status, "published");
  assert.equal(row.editorial_status, "approved", "본인 발행 승인이 편집 승인으로 셈해진다");
  assert.equal(row.pub.selfPublish, true, "발행 기록(check_log.publish)에 본인 발행");
  assert.equal(row.pub.by, `user:${u.selfEditor.id}`);

  const reviews = await reviewsOf(fx.own.id);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].kind, "desk_edit");
  assert.equal(Number(reviews[0].reviewer_id), u.selfEditor.personId, "승인자 = 작성자 본인");
  assert.equal(reviews[0].checklist.selfPublish, true);

  const audit = await auditOf(fx.own.id);
  assert.deepEqual(
    audit.map((x) => [x.action, x.reason]),
    [
      ["review.desk_edit", "본인 발행 — 작성자 본인이 편집 승인 (desk_edit approve)"],
      ["article.publish", publishReason("본인 발행", warnings)],
    ],
  );
  assert.ok(audit.every((x) => x.actor === `user:${u.selfEditor.id}` && x.after.selfPublish === true));
  await assertPublic(fx.own);
});

test("c) [감수하고 발행] — 감수위원+편집 책임자가 법률 주장 기사를 감수 2항목·편집 4항목 체크 후 한 번 눌러 감수·승인·발행한다", async () => {
  const { sent, warnings } = await clickConfirm(u.reviewEditor, fx.tax, { mode: "combined", label: "감수하고 발행", deskIds: DESK_IDS, taxIds: TAX_IDS });
  assert.deepEqual(
    sent.map((s) => [s.path, s.body?.kind ?? null]),
    [
      ["/reviews", "tax_review"],
      ["/reviews", "desk_edit"],
      ["/publish", null],
    ],
    "세무 감수 → 편집 승인 → 발행 순서",
  );
  assert.deepEqual(sent[0].body, { kind: "tax_review", decision: "approve", checklist: allTrue(TAX_IDS) });

  const row = await one("select status, editorial_status, tax_review_status, check_log -> 'publish' as pub from public.articles where id = $1", [fx.tax.id]);
  assert.equal(row.status, "published");
  assert.equal(row.editorial_status, "approved");
  assert.equal(row.tax_review_status, "approved", "세무 감수 상태는 감수 기록으로 approved");
  assert.equal("selfPublish" in row.pub, false);

  const reviews = await reviewsOf(fx.tax.id);
  assert.deepEqual(
    reviews.map((r) => [r.kind, r.decision, Number(r.reviewer_id)]),
    [
      ["tax_review", "approve", u.reviewEditor.personId],
      ["desk_edit", "approve", u.reviewEditor.personId],
    ],
  );
  const version = (await one("select version from public.articles where id = $1", [fx.tax.id])).version;
  assert.ok(reviews.every((r) => r.version === version), "두 서명 모두 발행한 버전에 묶인다");
  assert.deepEqual(
    (await auditOf(fx.tax.id)).map((x) => [x.action, x.reason]),
    [
      ["review.tax_review", "tax_review approve"],
      ["review.desk_edit", "desk_edit approve"],
      ["article.publish", publishReason("발행", warnings)],
    ],
  );
  await assertPublic(fx.tax);
});
