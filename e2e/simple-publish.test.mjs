// 간편 발행 E2E (2026-10-31 PO 결정 — "기사는 전문기자·회계사·세무사가 써서 올린다, 복잡한 절차는 모두 뺀다") — docs/dev/F4_설계.md 2.2
// standalone 빌드를 로컬 Supabase에 붙인다. 기사는 편집국 API로 쓰고, 화면의 [발행]을 실제로 눌러 공개까지 간다.
//  a) 기자가 자기 기사를 열어 요약을 고치고(저장 안 함) [발행] 한 번 → 요청 순서 PATCH → publish · 고친 요약으로 게재 · 공개 200
//     · 편집 승인 1행(작성자 본인, checklist publishApproval·authorPublish) · 발행 기록 authorPublish · 감사 로그 '작성자 발행'
//     · 화면: 단계표·검토 요청 없음, 칸 바로 가기는 기본 정보·본문·저장·그 밖의 칸
//  b) 세금 내용(법률 주장) 기사를 작성 기자가 [발행] → authorResponsibility · 세무 감수 상태 pending 그대로 · 감사 로그 '작성자 책임 발행 (세무 감수 대체)'
//     · 공개 화면에 '감수 ○○' 표시(data-part="review-mark") 없음
//  c) 편집 책임자가 기자의 기사를 [발행] → publishApproval만(authorPublish 없음) · 감사 로그 '발행'
//  d) 기자는 남의 기사를 발행할 수 없다 — API 403 + 감사 로그, 화면에 [발행] 없음 · 저작권 막힘(사진 권리 미확인)은 '발행 전에 고칠 것'에 보이고 발행 422
//  e) 발행 기사 빠른 수정 — 칸 바로 가기·접힘·요약만 고친 뒤 수정 종류만 고르면 사유 '요약 수정'이 자동으로 남는다
// 만든 계정·기사·감사 로그는 끝나면 지운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

// W4 5단계 (REG1-09 · PR-07) — 공식 자료 출처의 공공누리 유형·발표일·기준일·지역 단위·수집일 (시험용 값, site-article.test.mjs와 같다)
const OFFICIAL_W4 = { licenseType: "kogl_1", publishedOn: "2026-10-01", referenceDate: "2026-10-01", regionUnit: "전국", collectedAt: "2026-10-10T09:00:00+09:00" };

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

/** 편집국 API로 해설 기사를 쓴다 — 분야 없음·세법 기준일 있음 */
async function createExplainer(user, label, over = {}) {
  const slug = `simple-e2e-${label}-${staff.run}`;
  const title = `간편 발행 시험 ${label} ${staff.run}`;
  const r = await api("POST", "/articles", user, {
    slug,
    title,
    summary: "작성자가 버튼 하나로 바로 발행하는지 봅니다.",
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
  u.reporter = await staff.createUser({ label: "simple-rep", roles: ["reporter"], person: { name: "간편 발행 기자", roles: ["reporter"] } });
  u.other = await staff.createUser({ label: "simple-rep2", roles: ["reporter"], person: { name: "간편 발행 다른 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "simple-editor", roles: ["editor"], person: { name: "간편 발행 편집자", roles: ["editor"] } });

  // a) 기자 기사 — 세무 감수 대상 아님
  fx.own = await createExplainer(u.reporter, "own");
  // b) 기자 기사 — 법률 주장(근거 = 공식 문서 출처) → 세무 감수 대상
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
  assert.equal(claimed.body.article.taxReviewStatus, "pending", "세무 감수 대상");
  // c) 편집 책임자가 발행할 기자 기사
  fx.byEditor = await createExplainer(u.reporter, "by-editor");
  // d) 다른 기자의 기사 · 사진 권리 미확인 대표 사진이 붙은 기자 기사
  fx.others = await createExplainer(u.other, "others");
  const photo = await one(
    "insert into public.media (path, alt, kind, rights_status, credit, photographer, license, license_type) values ($1, '취득세 신고 창구', 'photo', 'unconfirmed', '편집국', '김가온', '자체 제작', 'not_applicable') returning id",
    [`e2e/simple-${staff.run}.jpg`],
  );
  fx.photoId = Number(photo.id);
  fx.photo = await createExplainer(u.reporter, "photo", { leadMediaId: fx.photoId });
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    if (fx.photoId) await db.query("delete from public.media where id = $1", [fx.photoId]).catch(() => {});
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

/** 기사 편집 화면을 열고(필요하면 요약을 고친 뒤) [발행]을 누른다 — 브라우저가 보낸 기사 요청(메서드·경로)과 발행 응답 본문을 돌려준다 */
async function clickPublish(user, article, { summary } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const path = `/admin/articles/${article.id}`;
    await loginAt(page, user, path);
    const button = page.locator("#publish-now");
    await button.waitFor();
    assert.equal(await button.innerText(), "발행");
    if (summary !== undefined) await page.fill("#meta-summary", summary);
    const sent = [];
    page.on("request", (req) => {
      const p = new URL(req.url()).pathname;
      if (["PATCH", "POST"].includes(req.method()) && p.startsWith(`/api/admin/articles/${article.id}`) && !p.endsWith("/check")) sent.push(`${req.method()} ${p.slice(`/api/admin/articles/${article.id}`.length) || "/"}`);
    });
    const published = page.waitForResponse((res) => res.request().method() === "POST" && new URL(res.url()).pathname === `/api/admin/articles/${article.id}/publish`);
    await button.click();
    const res = await published;
    assert.equal(res.status(), 200, `발행 응답: ${(await res.text()).slice(0, 1500)}`);
    await page.getByText("발행했습니다 — 공개 화면에 올라갔습니다").waitFor();
    return { sent, body: await res.json(), context };
  } catch (err) {
    await context.close();
    throw err;
  }
}

/** 공개 기사 화면 — 200이고 제목이 있다. HTML을 돌려준다 */
async function publicHtml(article) {
  const res = await fetch(`${base}/news/${encodeURIComponent(article.slug)}`);
  assert.equal(res.status, 200, `공개 화면 /news/${article.slug}`);
  const html = await res.text();
  assert.ok(html.includes(article.title), "공개 화면에 기사 제목");
  return html;
}

const deskOf = (id) => rows("select reviewer_id, decision, checklist from public.editorial_reviews where article_id = $1 and kind = 'desk_edit' order by id", [id]);
const auditOf = (id) => rows("select actor, action, reason from public.audit_logs where target = $1 and action in ('review.desk_edit', 'article.publish') order by id", [`articles:${id}`]);
/** 발행 감사 로그 사유 — 경고는 막지 않고 발행 기록에 남는다(경고 수는 판정 규칙에 따라 바뀌므로 발행 응답의 목록 길이로 맞춘다) */
const publishReason = (head, warnings) => `${head}${warnings.length ? ` — 경고 ${warnings.length}개 기록` : ""}`;

test("a) 기자가 자기 기사를 [발행] 한 번 — 저장 안 한 요약까지 저장하고 공개, 편집 승인·발행 기록·감사 로그에 '작성자 발행'", async () => {
  const summary = "작성자가 고친 요약으로 바로 발행합니다.";
  const { sent, body, context } = await clickPublish(u.reporter, fx.own, { summary });
  try {
    assert.deepEqual(sent, ["PATCH /", "POST /publish"], "저장한 뒤 발행 — 검토 요청·승인 요청은 보내지 않는다");
  } finally {
    await context.close();
  }
  const row = await one("select status, summary, editorial_status, check_log -> 'publish' as pub from public.articles where id = $1", [fx.own.id]);
  assert.equal(row.status, "published");
  assert.equal(row.summary, summary, "저장하지 않았던 요약으로 게재");
  assert.equal(row.editorial_status, "approved", "발행할 때 편집 승인이 함께 남는다");
  assert.equal(row.pub.authorPublish, true);
  assert.equal("authorResponsibility" in row.pub, false, "세무 감수 대상이 아니면 작성자 책임 표시 없음");
  assert.equal(row.pub.by, `user:${u.reporter.id}`);
  const desk = await deskOf(fx.own.id);
  assert.deepEqual(
    desk.map((d) => [Number(d.reviewer_id), d.decision, d.checklist]),
    [[u.reporter.personId, "approve", { publishApproval: true, authorPublish: true }]],
  );
  assert.deepEqual(
    (await auditOf(fx.own.id)).map((x) => [x.action, x.reason]),
    [
      ["review.desk_edit", "작성자 발행 — 발행과 함께 편집 승인"],
      ["article.publish", publishReason("작성자 발행", body.warnings)],
    ],
  );
  await publicHtml(fx.own);
});

test("a') 기사 편집 화면 — 단계표·검토 요청 없이 기본 정보·본문·저장·그 밖의 칸, 점검 결과는 접혀 있다", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const path = `/admin/articles/${fx.byEditor.id}`;
    await loginAt(page, u.reporter, path);
    await page.locator("#publish-now").waitFor();
    assert.deepEqual(await page.locator('nav[aria-label="편집 화면 칸"] a').allInnerTexts(), ["기본 정보", "본문", "저장", "그 밖의 칸"]);
    assert.equal(await page.getByTestId("publish-steps").count(), 0, "발행 단계표 없음");
    assert.equal(await page.getByRole("button", { name: "검토 요청" }).count(), 0, "발행할 수 있는 작성자에게 검토 요청 없음");
    assert.equal(await page.locator("details#more-sections").evaluate((d) => d.open), false);
    assert.equal(await page.getByTestId("check-panel").isVisible(), false, "점검 결과는 접혀 있다");
    assert.equal(await page.getByTestId("publish-blockers").count(), 0, "막힘이 없으면 '발행 전에 고칠 것'도 없다");
  } finally {
    await context.close();
  }
});

test("b) 세금 내용 기사를 작성 기자가 [발행] — 작성자 책임 발행(세무 감수 대체) 기록, 감수 상태는 그대로, 공개 화면에 감수 표시 없음", async () => {
  const { body, context } = await clickPublish(u.reporter, fx.tax);
  await context.close();
  const row = await one("select status, tax_review_status, check_log -> 'publish' as pub from public.articles where id = $1", [fx.tax.id]);
  assert.equal(row.status, "published");
  assert.equal(row.tax_review_status, "pending", "감수 기록이 없으니 감수 완료가 아니다");
  assert.equal(row.pub.authorPublish, true);
  assert.equal(row.pub.authorResponsibility, true);
  assert.ok(body.warnings.includes("nav03.tax-review-required"), "빠진 세무 감수는 경고로 발행 기록에 남는다");
  assert.equal((await one("select count(*)::int n from public.editorial_reviews where article_id = $1 and kind = 'tax_review'", [fx.tax.id])).n, 0, "세무 감수 서명 행 0");
  assert.deepEqual((await deskOf(fx.tax.id)).map((d) => d.checklist), [{ publishApproval: true, authorPublish: true, authorResponsibility: true }]);
  assert.deepEqual(
    (await auditOf(fx.tax.id)).map((x) => x.reason),
    ["작성자 발행 — 발행과 함께 편집 승인", publishReason("작성자 책임 발행 (세무 감수 대체)", body.warnings)],
  );
  const html = await publicHtml(fx.tax);
  assert.equal(html.includes('data-part="review-mark"'), false, "감수 서명이 없으면 공개 화면에 '감수 ○○' 표시가 없다");
});

test("c) 편집 책임자가 기자의 기사를 [발행] — 편집 승인은 편집 책임자 이름(publishApproval), 작성자 발행 표시 없음, 감사 로그 '발행'", async () => {
  const { body, context } = await clickPublish(u.editor, fx.byEditor);
  await context.close();
  const row = await one("select status, check_log -> 'publish' as pub from public.articles where id = $1", [fx.byEditor.id]);
  assert.equal(row.status, "published");
  assert.equal("authorPublish" in row.pub, false);
  assert.equal(row.pub.by, `user:${u.editor.id}`);
  assert.deepEqual(
    (await deskOf(fx.byEditor.id)).map((d) => [Number(d.reviewer_id), d.checklist]),
    [[u.editor.personId, { publishApproval: true }]],
  );
  assert.deepEqual(
    (await auditOf(fx.byEditor.id)).map((x) => [x.actor, x.reason]),
    [
      [`user:${u.editor.id}`, "편집 책임자 발행 — 발행과 함께 편집 승인"],
      [`user:${u.editor.id}`, publishReason("발행", body.warnings)],
    ],
  );
  await publicHtml(fx.byEditor);
});

test("d) 기자는 남의 기사를 발행할 수 없다(403·감사 로그·화면에 [발행] 없음), 사진 권리 미확인은 '발행 전에 고칠 것'에 보이고 발행 422", async () => {
  const denied = await api("POST", `/articles/${fx.others.id}/publish`, u.reporter);
  assert.equal(denied.status, 403, show(denied));
  assert.match(denied.body.error, /편집 책임자/);
  assert.equal((await one("select count(*)::int n from public.audit_logs where actor = $1 and action = 'article.publish.denied' and target = $2", [`user:${u.reporter.id}`, `articles:${fx.others.id}`])).n, 1);
  assert.equal((await one("select status from public.articles where id = $1", [fx.others.id])).status, "draft");

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await loginAt(page, u.reporter, `/admin/articles/${fx.photo.id}`);
    const blockers = page.getByTestId("publish-blockers");
    await blockers.waitFor();
    assert.match(await blockers.innerText(), /발행 전에 고칠 것 \d+개/);
    const r = page.waitForResponse((res) => res.request().method() === "POST" && new URL(res.url()).pathname === `/api/admin/articles/${fx.photo.id}/publish`);
    await page.locator("#publish-now").click();
    assert.equal((await r).status(), 422);
    await page.locator("#publish-failure").waitFor();
  } finally {
    await context.close();
  }
  const r = await api("POST", `/articles/${fx.photo.id}/publish`, u.reporter);
  assert.equal(r.status, 422, show(r));
  assert.ok(r.body.failed.includes("nav04.image-rights"), "사진 권리 미확인은 간편 발행에서도 막는다(저작권)");
  assert.equal((await one("select status from public.articles where id = $1", [fx.photo.id])).status, "draft");

  // 남의 기사 화면에는 [발행]이 없다
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await ctx2.newPage();
    await loginAt(page, u.other, `/admin/articles/${fx.photo.id}`);
    await page.locator("#meta").waitFor();
    assert.equal(await page.locator("#publish-now").count(), 0);
  } finally {
    await ctx2.close();
  }
});

test("e) 발행 기사 빠른 수정 — 고칠 칸만 보이고, 요약만 고친 뒤 수정 종류만 고르면 사유 '요약 수정'이 자동으로 남는다", async () => {
  const before = await one("select version, status from public.articles where id = $1", [fx.byEditor.id]);
  assert.equal(before.status, "published", "c)에서 발행된 기사");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const path = `/admin/articles/${fx.byEditor.id}`;
    await loginAt(page, u.editor, path);
    const nav = page.locator('nav[aria-label="편집 화면 칸"] a');
    await nav.first().waitFor();
    assert.deepEqual(await nav.allInnerTexts(), ["기본 정보", "본문", "저장", "그 밖의 칸"]);
    // 핵심 주장·「지방세로 읽기」는 접힌 '그 밖의 칸' 안 — 화면에 없다가 펼치면 보인다
    const more = page.locator("details#more-sections");
    assert.equal(await more.evaluate((d) => d.open), false);
    assert.equal(await page.locator("#claims").isVisible(), false);
    assert.equal(await page.getByTestId("check-panel").isVisible(), false, "발행 점검 결과는 접혀 있다");
    // 저장 칸은 본문 바로 다음 (그 밖의 칸보다 앞)
    assert.equal(await page.evaluate(() => document.querySelector("#save").compareDocumentPosition(document.querySelector("#more-sections")) & Node.DOCUMENT_POSITION_FOLLOWING), 4);

    const summary = "요약 문구를 다듬었습니다. 본문은 그대로입니다.";
    await page.fill("#meta-summary", summary);
    await page.selectOption("#save-update-kind", "typo");
    await page.getByText('비워 두면 "요약 수정"(으)로 남깁니다').waitFor();
    const saved = page.waitForResponse((res) => res.request().method() === "PATCH" && new URL(res.url()).pathname === `/api/admin/articles/${fx.byEditor.id}`);
    await page.locator("#save").getByRole("button", { name: "저장" }).click();
    const res = await saved;
    assert.equal(res.status(), 200, `저장 응답: ${(await res.text()).slice(0, 1500)}`);
  } finally {
    await context.close();
  }
  const after = await one("select version, status, summary from public.articles where id = $1", [fx.byEditor.id]);
  assert.equal(after.status, "published", "발행 기사는 고쳐도 게재 유지");
  assert.equal(after.version, before.version + 1);
  assert.equal(after.summary, "요약 문구를 다듬었습니다. 본문은 그대로입니다.");
  const rev = await one("select reason, update_kind from public.article_revisions where article_id = $1 and version = $2", [fx.byEditor.id, after.version]);
  assert.deepEqual({ reason: rev.reason, kind: rev.update_kind }, { reason: "요약 수정", kind: "typo" });
});
