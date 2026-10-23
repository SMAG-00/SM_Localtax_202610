// 법안 상태를 다룬 기사 발행 검사 E2E (W4 20단계 뒷부분 — docs/dev/W4_설계.md 1장 20단계 · 11.20 · 12장 #169, PRD-01B PR-13)
// standalone 빌드를 띄우고 로컬 Supabase에 붙인다. 지역·기사·출처는 모두 시험용 가짜다(시험용 가상군 · *.example).
//  a) 표시 켬 + 공식 자료 없음(보도자료 출처만) → 발행 422(pr13.bill-status-source · 칸 coversBillStatus · 빠진 것 문장) + DB 직접 발행 거부 · 공개 0 →
//     출처 주소·확인일 있는 공식 자료를 더하면 발행 200 · 공개
//  b) 표시 끔 + 같은 출처 구성 → 발행 200 (달라진 것 없음)
//  c) 표시 값이 아닌 것(문자열) 422 · 편집 화면 체크박스 '법안 상태를 다룸' → 켜고 저장 → DB 값 true → 발행 422
// 만든 계정·기사·승인 기록은 끝나면 지운다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-bill-status-e2e@example.test";
const SEOUL = "1100000000";
const REGIONAL = { evidence: true, relation: true, ad_independence: true };
const JUDGE_SEED = ["local_tax", "realestate", "local_finance", "urban_policy"];

let sb, server, staff, db, browser, base;
const u = {};
const fx = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const slugOf = (label) => `e2e-w4bs-${label}-${staff.run}`;
const show = (r) => JSON.stringify(r.body).slice(0, 1500);

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const regionalFailed = (r) => (r.body.failed ?? []).filter((id) => id.startsWith("reg1_17."));
const auditCount = (action, target, actorId) =>
  one("select count(*)::int n from public.audit_logs where action = $1 and target = $2 and actor = $3 and at >= $4", [action, target, `user:${actorId}`, staff.startedAt]).then((r) => r.n);

// ── 발행 판정을 지나는 지자체뉴스 해설 (시험용 법령 출처 · 핵심 요약 · 문단 · 표 · 문서 인용 · 상자 · FAQ · 핵심 주장) ──
const LAW = {
  kind: "official_doc",
  title: "시험용 법령 조문(신고 및 납부)",
  url: "https://law.example/gasang/20",
  sourceName: "시험용 법령 정보 창구",
  lastVerifiedAt: "2026-10-10T09:00:00+09:00",
  licenseStatus: "출처표시",
  licenseType: "kogl_1",
  publishedOn: "2026-10-01",
  referenceDate: "2026-10-01",
  regionUnit: "전국",
  collectedAt: "2026-10-10T09:00:00+09:00",
};
const blocks = (srcRef) => [
  { type: "key_summary", lines: ["주택을 사면 취득일부터 60일 안에 신고합니다.", "취득일은 잔금일과 등기일 중 빠른 날입니다.", "신고와 납부는 함께 합니다."] },
  { type: "paragraph", text: "취득일은 잔금을 치른 날과 등기를 마친 날 중 빠른 날이다. 자세한 흐름은 [지방세 허브](/tax)에서 볼 수 있다." },
  { type: "table", caption: "취득일 정하는 법", rows: [["경우", "취득일"], ["잔금이 먼저", "잔금일"], ["등기가 먼저", "등기일"]], chart: { axis: "경우", unit: "날짜", source: "시험용 법령 조문" } },
  { type: "quote", text: "취득세는 취득일부터 60일 이내에 신고하고 납부하여야 한다.", speaker: "시험용 법령 조문", origin: "document", refId: srcRef },
  { type: "callout", kind: "tip", title: "절세 체크포인트", text: "생애 첫 주택이면 감면 요건을 먼저 확인하세요." },
  { type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "계약일이 아니라 잔금일이나 등기일이 취득일입니다." },
  { type: "faq", items: [{ question: "취득세는 어디에 신고하나요?", answer: "주택이 있는 시·군·구청이나 위택스에 신고합니다." }, { question: "신고와 납부를 따로 하나요?", answer: "신고하면서 함께 냅니다." }] },
];
const claims = (srcRef) => [{ id: "claim-1", text: "취득일부터 60일 안에 신고하고 납부해야 한다.", kind: "legal", evidenceIds: [srcRef], blockIndex: 1 }];

/** 지자체뉴스 해설 초안 — 출처·본문·「지방세로 읽기」 생략 사유(편집 책임자)까지. over = 지역 칸 */
async function draftLocal(label, title, over = {}, lawOver = {}) {
  const created = await api("POST", "/articles", u.reporter, { slug: slugOf(label), title: `${title} ${staff.run}`.slice(0, 40), summary: "시험용 가상군 자료로 지방세 흐름을 정리했습니다.", section: "local", contentType: "explainer", legalBasisDate: "2026-10-01", ...over });
  assert.equal(created.status, 201, show(created));
  const id = created.body.article.id;
  staff.trackArticle(id);
  const law = await api("POST", `/articles/${id}/sources`, u.reporter, { ...LAW, ...lawOver });
  assert.equal(law.status, 201, show(law));
  const a = { id, slug: slugOf(label), href: `/news/${slugOf(label)}`, srcRef: law.body.source.ref, target: `articles:${id}` };
  const body = await api("PATCH", `/articles/${id}`, u.reporter, { body: { blocks: blocks(a.srcRef), claims: claims(a.srcRef) } });
  assert.equal(body.status, 200, show(body));
  const skip = await api("PATCH", `/articles/${id}`, u.editor, { taxLens: { topics: [], points: [], links: [], omissionReason: "세금 흐름은 본문 표로 대신한다" } });
  assert.equal(skip.status, 200, show(skip));
  fx[label] = a;
  return a;
}
const patch = async (a, user, body) => {
  const r = await api("PATCH", `/articles/${a.id}`, user, body);
  assert.equal(r.status, 200, show(r));
  return r;
};
async function approve(a, checklist = REGIONAL) {
  const desk = await api("POST", `/articles/${a.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve", checklist });
  assert.equal(desk.status, 201, show(desk));
  const tax = await api("POST", `/articles/${a.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
  assert.equal(tax.status, 201, show(tax));
}
const publish = (a) => api("POST", `/articles/${a.id}/publish`, u.editor);
const regionalOf = async (a) => (await api("GET", `/articles/${a.id}`, u.editor)).body.regional;
const page200 = async (href) => (await fetch(`${base}${href}`, { redirect: "manual" })).status;
const dbPublish = (id) => db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [id]);

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
  await staff.snapshotOperations();
  for (const t of ["articles", "editorial_reviews", "article_evidence", "partners"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  assert.deepEqual((await one("select value from public.settings where key = 'regional_judge_fields'")).value, JUDGE_SEED, "시험 전 판정 책임자 분야 = 씨앗(12장 #7)");

  u.admin = await staff.createUser({ label: "w4bs-admin", email: ADMIN_EMAIL, person: { name: "시험용 1인 편집국 관리자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w4bs-reporter", roles: ["reporter"], person: { name: "시험용 지역 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w4bs-editor", roles: ["editor"], person: { name: "시험용 지역 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4bs-reviewer", roles: ["reviewer"], person: { name: "시험용 지역 감수위원", roles: ["reviewer"] } });
  u.adOps = await staff.createUser({ label: "w4bs-adops", roles: ["ad_ops"], person: { name: "시험용 광고 담당", roles: ["writer"] } });
  const partner = await one("insert into public.partners (name, kind, contract_from, contract_to) values ('시험용 가상상회', 'local_business', '2026-01-01', '2026-12-31') returning id");
  fx.partner = Number(partner.id);
  staff.trackRow("partners", fx.partner);
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    await staff?.cleanup();
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        assert.deepEqual((await c.query("select value from public.settings where key = 'regional_judge_fields'")).rows[0].value, JUDGE_SEED, "판정 책임자 분야 그대로");
      } finally {
        await c.end();
      }
    }
  }
});


const billFailed = (r) => (r.body.failed ?? []).filter((id) => id === "pr13.bill-status-source");
const OFFICIAL_BILL = { ...LAW, title: "시험용 가상 법안 진행 현황", url: "https://law.example/gasang/bill-1", lastVerifiedAt: "2026-10-20T09:00:00+09:00" };
const PRESS = { kind: "press_release", url: "https://press.example/gasang/1", sourceName: "시험용 보도자료 창구" };

test("a) 표시 켬 + 공식 자료 없음 → 발행 422 + DB 거부 + 공개 0 → 공식 자료(출처 주소·확인일)를 더하면 발행 200", async () => {
  const a = await draftLocal("bill-on", "시험용 가상군 법안 진행 상태", { regionCodes: [SEOUL], editorialField: "local_tax", publicQuestion: "시험용 법안은 어느 단계에 와 있는가", coversBillStatus: true }, PRESS);
  await approve(a);
  let r = await publish(a);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(billFailed(r), ["pr13.bill-status-source"], show(r));
  const f = r.body.findings.find((x) => x.id === "pr13.bill-status-source");
  assert.equal(f.location.field, "coversBillStatus");
  assert.match(f.message, /빠진 것: 공식 자료 출처/);
  await assert.rejects(dbPublish(a.id), /법안 상태를 다룬 기사는 공식 자료 출처가 1건 이상/, "DB 직접 발행도 거부");
  assert.equal(await page200(a.href), 404, "발행 전 공개 0");

  const src = await api("POST", `/articles/${a.id}/sources`, u.reporter, OFFICIAL_BILL);
  assert.equal(src.status, 201, show(src));
  await approve(a);
  r = await publish(a);
  assert.equal(r.status, 200, show(r));
  assert.equal(await page200(a.href), 200);
});

test("b) 표시 끔 + 같은 출처 구성(보도자료만) → 발행 200 — 표시 없는 기사는 달라진 것 없음", async () => {
  const b = await draftLocal("bill-off", "시험용 가상군 세수 흐름", { regionCodes: [SEOUL], editorialField: "local_tax", publicQuestion: "시험용 세수는 어떻게 움직였는가" }, PRESS);
  assert.equal((await one("select covers_bill_status from public.articles where id = $1", [b.id])).covers_bill_status, false);
  await approve(b);
  const r = await publish(b);
  assert.equal(r.status, 200, show(r));
});

test("c) 표시 값 검사 · 편집 화면 체크박스 저장 → DB true → 발행 422", async () => {
  const c = await draftLocal("bill-screen", "시험용 가상군 법안 화면", { regionCodes: [SEOUL], editorialField: "local_tax", publicQuestion: "시험용 법안 화면 질문" }, PRESS);
  const bad = await api("PATCH", `/articles/${c.id}`, u.reporter, { coversBillStatus: "yes" });
  assert.equal(bad.status, 422, show(bad));
  assert.match(JSON.stringify(bad.body), /coversBillStatus/);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}/admin/login`);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그인" && !b.disabled));
    await page.fill("#login-email", u.editor.email);
    await page.fill("#login-password", u.editor.password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL((url) => url.pathname !== "/admin/login");
    await page.goto(`${base}/admin/articles/${c.id}`);
    const box = page.locator("#meta-covers-bill-status");
    await box.waitFor();
    assert.equal(await box.isChecked(), false);
    assert.match(await page.locator("body").innerText(), /법안 상태를 다룸/);
    await box.check();
    await page.getByRole("form", { name: "기사 저장" }).getByRole("button", { name: "저장", exact: true }).click();
    for (let i = 0; i < 40; i++) {
      if ((await one("select covers_bill_status from public.articles where id = $1", [c.id])).covers_bill_status) break;
      await new Promise((res) => setTimeout(res, 250));
    }
    assert.equal((await one("select covers_bill_status from public.articles where id = $1", [c.id])).covers_bill_status, true, "저장 뒤 DB 값");
  } finally {
    await ctx.close();
  }
  await approve(c);
  const r = await publish(c);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(billFailed(r), ["pr13.bill-status-source"], show(r));
});
