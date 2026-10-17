// 편집국 API E2E (W2-a 3단계 — 역할별 403·감사 로그, 발행 판정) — ACC-04 · ADM-01 · ART-01 · ART-05 · NAV-02~06 · NAV-09~12 · CORE-01
// standalone 빌드를 실제로 띄우고 로컬 Supabase(Auth·DB)에 붙인다. 계정은 Auth Admin API로 만들고 비밀번호 로그인으로 받은 토큰을 쓴다.
// 시험이 만든 계정·기사·기록은 끝나면 지운다 (e2e/lib/staff.mjs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "admin-e2e@example.test";
const SITE = "https://e2e.example.test";
const NON_NEWSROOM = ["ad_ops", "store_ops", "brand_ops", "expert_ops"];

let sb, server, staff, db;
const u = {};
const categories = {};

async function api(method, path, user, body) {
  const headers = {};
  if (user) headers.authorization = `Bearer ${typeof user === "string" ? user : user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${server.base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body: json };
}

const show = (r) => JSON.stringify(r.body).slice(0, 1500);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

async function auditCount(userId, action, target) {
  const r = await one("select count(*)::int n from public.audit_logs where actor = $1 and action = $2 and target = $3", [`user:${userId}`, action, target]);
  return r.n;
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
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);

  u.reporter = await staff.createUser({ label: "reporter", roles: ["reporter"], person: { name: "시험 기자", roles: ["reporter"] } });
  u.editorA = await staff.createUser({ label: "editor-a", roles: ["editor"], person: { name: "시험 편집자", roles: ["editor"] } });
  u.editorB = await staff.createUser({ label: "editor-b", roles: ["editor", "reporter"], person: { name: "시험 편집기자", roles: ["editor", "reporter"] } });
  u.reviewer = await staff.createUser({ label: "reviewer", roles: ["reviewer"], person: { name: "시험 감수위원", roles: ["reviewer"] } });
  for (const role of NON_NEWSROOM) u[role] = await staff.createUser({ label: role.replace("_", "-"), roles: [role] });
  u.admin = await staff.createUser({ label: "admin", email: ADMIN_EMAIL });
  u.target = await staff.createUser({ label: "role-target" });
  u.target2 = await staff.createUser({ label: "role-target-2" });

  for (const r of (await db.query("select id, section, slug from public.categories")).rows) categories[`${r.section}/${r.slug}`] = Number(r.id);
});

after(async () => {
  try {
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

// ── 원고 견본 (가상 도시 가온시 — 실제 기사·통계 아님) ─────────────────

const QUANT_BLOCKS = [
  {
    type: "key_summary",
    lines: [
      "가온시 상반기 취득세 징수액은 1,284억 원으로 1년 전보다 18.4% 줄었습니다.",
      "같은 기간 아파트 매매 거래는 21.6% 줄었습니다.",
      "거래 감소만으로 세수 감소를 설명할 수는 없습니다.",
    ],
  },
  { type: "paragraph", text: "편집국이 가온시 세목별 징수 실적을 집계해 보니 올해 1~6월 취득세 징수액은 1,284억 원이었다. 지난해 같은 기간보다 290억 원 적다." },
  {
    type: "table",
    caption: "가온시 구별 취득세 징수액(1~6월)",
    rows: [["구", "2026년(억 원)"], ["한빛구", "512"], ["누리구", "431"], ["가람구", "341"]],
    chart: { axis: "구", unit: "억 원", source: "가온시 세목별 징수 실적(편집국 집계)" },
  },
  { type: "paragraph", text: "이 수치는 거래량과 세수가 함께 줄었다는 사실만 보여 준다. 감면 확대 같은 다른 요인은 따로 떼어 보지 않았다." },
];

const PRESS_RELEASE = "가온시는 15일 상반기 지방세 징수 동향을 발표했다. 시 관계자는 부동산 경기 둔화로 세입 여건이 어렵다고 밝혔다. 시는 하반기에 체납액 일제 정리 기간을 운영할 계획이다.";

const DATASET = {
  definition: "취득세 징수액 — 신고·납부가 끝난 취득세(지방교육세 제외)",
  period: "2025년·2026년 각 1월 1일~6월 30일",
  unit: "억 원",
  regionUnit: "시·구",
  denominator: "2025년 같은 기간 징수액(1,574억 원)",
  exclusions: "지방교육세·농어촌특별세, 과오납 환급분",
  transform: "구별 징수액 합산, 증감률 = (2026년 − 2025년) ÷ 2025년",
  reproFileHash: "sha256:3f6c1a9d0b7e45c2a8f1d6e9b4c7a2e5f8d1c4b7a0e3f6c9d2b5a8e1f4c7d0b3",
  provider: "가온시 세정과",
  sourceUrl: "https://www.gaon-si.example/open-data/local-tax-collection-2026-06",
  collectedAt: "2026-10-07",
  license: "공공누리 제1유형",
};

const EXPLAINER_BLOCKS = [
  {
    type: "key_summary",
    lines: ["주택을 사면 취득일부터 60일 안에 취득세를 신고합니다.", "취득일은 잔금일과 등기일 중 빠른 날입니다.", "신고와 납부는 함께 합니다."],
  },
  { type: "paragraph", text: "취득일은 잔금을 치른 날과 등기를 마친 날 중 빠른 날이다. 이날부터 60일 안에 주택이 있는 시·군·구에 신고하고 세금을 낸다." },
  {
    type: "faq",
    items: [
      { question: "취득세는 어디에 신고하나요?", answer: "주택이 있는 시·군·구청이나 위택스에 신고합니다." },
      { question: "신고와 납부를 따로 하나요?", answer: "신고하면서 함께 냅니다." },
    ],
  },
];

const slug = (name) => `e2e-${name}-${staff.run}`;
const ids = {};

// ── 로그인·가입 메타데이터 (ACC-04) ─────────────────────────

test("로그인하지 않았거나 토큰이 틀리면 401", async () => {
  for (const auth of [undefined, "not-a-real-token"]) {
    const r = await api("GET", "/me", auth);
    assert.equal(r.status, 401, show(r));
    assert.equal(typeof r.body.error, "string");
  }
  const res = await fetch(`${server.base}/api/admin/me`, { headers: { authorization: "Basic abc" } });
  assert.equal(res.status, 401);
  assert.equal((await api("POST", "/articles", undefined, { title: "x" })).status, 401);
});

test("다른 사이트에서 온 쿠키 요청은 403, JSON이 아닌 본문은 415 (CSRF 방어)", async () => {
  const cross = await fetch(`${server.base}/api/admin/articles/1/publish`, { method: "POST", headers: { origin: "https://evil.example" } });
  assert.equal(cross.status, 403);
  const plain = await fetch(`${server.base}/api/admin/articles`, {
    method: "POST",
    headers: { authorization: `Bearer ${u.reporter.token}`, "content-type": "text/plain" },
    body: JSON.stringify({ slug: slug("plain"), title: "t", section: "tax", contentType: "explainer" }),
  });
  assert.equal(plain.status, 415);
});

test("가입 메타데이터에 역할·관리자 값을 넣어도 권한이 없다 (ACC-04)", async () => {
  const email = staff.email("signup");
  const { id, token } = await staff.signUp(email, crypto.randomBytes(12).toString("base64url"), {
    role: "editor",
    roles: ["editor", "reporter"],
    staff_roles: ["editor"],
    is_admin: true,
    admin: true,
  });
  const me = await api("GET", "/me", token);
  assert.equal(me.status, 200, show(me));
  assert.deepEqual(me.body.roles, []);
  assert.equal(me.body.isAdmin, false);
  assert.deepEqual(me.body.actions, []);
  const create = await api("POST", "/articles", token, { slug: slug("forged"), title: "위조 시도", section: "tax", contentType: "explainer" });
  assert.equal(create.status, 403, show(create));
  const grant = await api("POST", "/roles", token, { userId: id, role: "editor" });
  assert.equal(grant.status, 403, show(grant));
  assert.equal((await one("select count(*)::int n from public.staff_roles where user_id = $1", [id])).n, 0);
});

test("역할은 staff_roles에서, 관리자는 ADMIN_EMAILS에서 읽는다", async () => {
  const me = await api("GET", "/me", u.editorB);
  assert.equal(me.status, 200, show(me));
  assert.deepEqual(me.body.roles, ["editor", "reporter"]);
  assert.equal(me.body.isAdmin, false);
  assert.ok(me.body.actions.includes("article.publish"));
  const admin = await api("GET", "/me", u.admin);
  assert.equal(admin.body.isAdmin, true);
  assert.deepEqual(admin.body.roles, []);
  assert.ok(admin.body.actions.includes("role.grant"));
  assert.ok(!admin.body.actions.includes("article.publish"), "editor 없는 관리자에게 발행 권한이 없다");
});

// ── 정량형 보도기사: 작성 → 독립 승인 → 불완전 발행 422 → 채운 뒤 200 (NAV-10 · NAV-12 · CORE-01) ──

test("기자가 정량형 보도기사 초안을 쓰고 출처·근거를 붙인다", async () => {
  const r = await api("POST", "/articles", u.reporter, {
    slug: slug("quant"),
    title: `가온시 상반기 취득세 18.4% 감소 ${staff.run}`,
    summary: "가온시의 올해 상반기 취득세 징수액이 1년 전보다 18.4% 줄었습니다.",
    section: "local",
    categoryId: categories["local/reporting"],
    contentType: "reported_news",
    reportingMethod: "quantitative",
    body: { blocks: QUANT_BLOCKS, claims: [] },
    checklists: {
      quantitative: {
        sourceCrossCheck: "징수 실적 파일 구별 합계를 재정공시 화면 값과 2026-10-09에 대조함",
        limitations: "상관관계만 확인 — 감면 확대·신고 시점 요인은 분리하지 않음",
      },
    },
  });
  assert.equal(r.status, 201, show(r));
  ids.quant = r.body.article.id;
  staff.trackArticle(ids.quant);
  assert.equal(r.body.article.status, "draft");
  assert.equal(r.body.article.version, 1);
  assert.ok(Array.isArray(r.body.checks));
  const row = await one("select author_id, status from public.articles where id = $1", [ids.quant]);
  assert.equal(Number(row.author_id), u.reporter.personId, "작성자 = 로그인한 계정의 인물");
  assert.equal((await one("select count(*)::int n from public.article_revisions where article_id = $1 and version = 1", [ids.quant])).n, 1);
  assert.equal(await auditCount(u.reporter.id, "article.create", `articles:${ids.quant}`), 1);

  const official = await api("POST", `/articles/${ids.quant}/sources`, u.reporter, {
    kind: "dataset",
    title: "가온시 지방세 세목별 징수 실적(2026년 6월 말)",
    url: DATASET.sourceUrl,
    sourceName: "가온시 세정과",
    lastVerifiedAt: "2026-10-07T10:00:00+09:00",
    licenseStatus: "공공누리 제1유형",
  });
  assert.equal(official.status, 201, show(official));
  ids.quantSource = official.body.source.ref;

  const incompleteOfficial = await api("POST", `/articles/${ids.quant}/sources`, u.reporter, { kind: "official_doc", title: "URL 없는 공식 문서" });
  assert.equal(incompleteOfficial.status, 422, show(incompleteOfficial));
  assert.match(incompleteOfficial.body.error, /FND-04/);

  const press = await api("POST", `/articles/${ids.quant}/sources`, u.reporter, {
    kind: "press_release",
    title: "가온시, 상반기 지방세 징수 동향 발표",
    url: "https://www.gaon-si.example/news/press/2026-0715",
    sourceName: "가온시 대변인실",
    snapshot: { text: PRESS_RELEASE },
  });
  assert.equal(press.status, 201, show(press));
  assert.ok(press.body.source.snapshot_id, "보도자료 원문 스냅샷");

  const ev = await api("POST", `/articles/${ids.quant}/evidence`, u.reporter, {
    evidenceType: "dataset",
    location: "편집국 자료실/2026/e2e/징수실적_2026H1.xlsx",
    rightsStatus: "confirmed",
    verificationStatus: "verified",
    verifiedAt: "2026-10-09T10:00:00+09:00",
    retentionUntil: "2031-10-09",
    dataset: DATASET,
  });
  assert.equal(ev.status, 201, show(ev));
  ids.quantEvidence = ev.body.evidence.ref;
  assert.match(ids.quantEvidence, /^ev:\d+$/);
});

test("기자는 자기 기사를 편집 승인할 수 없다 — 기자 역할 403, 작성자인 편집자도 403 (NAV-12)", async () => {
  const r = await api("POST", `/articles/${ids.quant}/reviews`, u.reporter, { kind: "desk_edit", decision: "approve" });
  assert.equal(r.status, 403, show(r));
  assert.equal(await auditCount(u.reporter.id, "review.desk_edit.denied", `articles:${ids.quant}`), 1);

  const own = await api("POST", "/articles", u.editorB, { slug: slug("self"), title: `편집기자 본인 기사 ${staff.run}`, section: "tax", contentType: "explainer" });
  assert.equal(own.status, 201, show(own));
  staff.trackArticle(own.body.article.id);
  const self = await api("POST", `/articles/${own.body.article.id}/reviews`, u.editorB, { kind: "desk_edit", decision: "approve" });
  assert.equal(self.status, 403, show(self));
  assert.match(self.body.error, /NAV-12/);
  assert.equal(await auditCount(u.editorB.id, "review.desk_edit.denied", `articles:${own.body.article.id}`), 1);
  assert.equal((await one("select count(*)::int n from public.editorial_reviews where article_id = $1", [own.body.article.id])).n, 0);
});

test("편집국 외 역할 4종 — 기사 승인·정렬·발행 API는 각각 403이고 감사 로그에 남는다 (ACC-04 · NAV-06)", async () => {
  const target = `articles:${ids.quant}`;
  for (const role of NON_NEWSROOM) {
    const who = u[role];
    const approve = await api("POST", `/articles/${ids.quant}/reviews`, who, { kind: "desk_edit", decision: "approve" });
    const sort = await api("POST", `/articles/${ids.quant}/placement`, who, { navCandidate: true });
    const publish = await api("POST", `/articles/${ids.quant}/publish`, who);
    for (const [name, r] of [["approve", approve], ["sort", sort], ["publish", publish]]) assert.equal(r.status, 403, `${role} ${name}: ${show(r)}`);
    assert.equal(await auditCount(who.id, "review.desk_edit.denied", target), 1, `${role} 승인 거부 기록`);
    assert.equal(await auditCount(who.id, "article.sort.denied", target), 1, `${role} 정렬 거부 기록`);
    assert.equal(await auditCount(who.id, "article.publish.denied", target), 1, `${role} 발행 거부 기록`);
    const log = await one("select after, reason from public.audit_logs where actor = $1 and action = 'article.publish.denied' and target = $2", [`user:${who.id}`, target]);
    assert.deepEqual(log.after.roles, [role]);
    assert.match(log.reason, /editor/);
  }
  const ad = await api("POST", "/articles", u.ad_ops, { slug: slug("ad-news"), title: "광고 담당의 보도기사", section: "local", contentType: "reported_news", reportingMethod: "quantitative" });
  assert.equal(ad.status, 403, show(ad));
  assert.equal((await one("select status from public.articles where id = $1", [ids.quant])).status, "draft", "거부된 호출은 기사를 바꾸지 않는다");
});

test("editor 없는 관리자의 발행은 403 — 편집 신뢰 규칙은 관리자에게도 같다", async () => {
  const r = await api("POST", `/articles/${ids.quant}/publish`, u.admin);
  assert.equal(r.status, 403, show(r));
  assert.equal(await auditCount(u.admin.id, "article.publish.denied", `articles:${ids.quant}`), 1);
});

test("다른 편집자의 편집 승인 → 불완전한 정량형 원고는 422, 빠진 NAV-10 묶음이 실패 항목에 있다", async () => {
  const review = await api("POST", `/articles/${ids.quant}/reviews`, u.editorA, { kind: "desk_edit", decision: "approve", checklist: { noCausalClaim: true } });
  assert.equal(review.status, 201, show(review));
  assert.equal(review.body.article.editorialStatus, "approved");
  assert.equal(review.body.article.status, "approved");

  const check = await api("GET", `/articles/${ids.quant}/check`, u.reporter);
  assert.equal(check.status, 200, show(check));
  assert.equal(check.body.canPublish, false);

  const r = await api("POST", `/articles/${ids.quant}/publish`, u.editorA);
  assert.equal(r.status, 422, show(r));
  assert.ok(r.body.failed.includes("nav10.related-party-check"), show(r));
  assert.ok(r.body.failed.includes("core01.box-or-reason"), show(r));
  assert.ok(!r.body.failed.includes("nav10.source-data"), "채운 묶음은 실패 항목에 없다");
  assert.ok(!r.body.failed.includes("nav03.desk-edit-required"));
  assert.deepEqual([...r.body.failed].sort(), [...check.body.failed].sort(), "점검 패널과 발행 API가 같은 판정");
  assert.equal(r.body.similarity.status, "pass", "보도자료 원문과 비교해 통과");
  const seo = await one("select blocking_failures, checked_by, published_with_warnings from public.seo_checks where id = $1", [r.body.seoCheckId]);
  assert.ok(seo.blocking_failures.includes("nav10.related-party-check"));
  assert.equal(seo.published_with_warnings, false);
  const row = await one("select status, first_published_at from public.articles where id = $1", [ids.quant]);
  assert.equal(row.status, "approved");
  assert.equal(row.first_published_at, null);
});

test("빠진 칸을 채우면 편집 승인을 다시 받아야 하고, 승인 뒤 발행 200", async () => {
  const skipByReporter = await api("PATCH", `/articles/${ids.quant}`, u.reporter, { taxLens: { topics: [], points: [], links: [], omissionReason: "세금 영향은 후속 기사에서 다룬다" } });
  assert.equal(skipByReporter.status, 403, "「지방세로 읽기」 생략 사유는 편집 책임자만");

  const fill = await api("PATCH", `/articles/${ids.quant}`, u.reporter, {
    body: { blocks: QUANT_BLOCKS, claims: [{ id: "claim-1", text: "올해 1~6월 가온시 취득세 징수액은 1,284억 원이다.", kind: "fact", evidenceIds: [ids.quantEvidence, ids.quantSource], blockIndex: 1 }] },
    checklists: { quantitative: { sourceCrossCheck: "징수 실적 파일 구별 합계를 재정공시 화면 값과 2026-10-09에 대조함", limitations: "상관관계만 확인 — 감면 확대·신고 시점 요인은 분리하지 않음", relatedPartyCheck: "가온시 세정과 관계자 전화 확인(2026-10-08)" } },
  });
  assert.equal(fill.status, 200, show(fill));
  assert.equal(fill.body.article.version, 2);
  assert.equal(fill.body.article.editorialStatus, "pending", "새 버전은 편집 승인을 다시 받는다");

  const skip = await api("PATCH", `/articles/${ids.quant}`, u.editorA, { taxLens: { topics: [], points: [], links: [], omissionReason: "세금 영향은 후속 기사에서 다룬다" } });
  assert.equal(skip.status, 200, show(skip));
  assert.equal(skip.body.article.version, 3);
  const skipAudit = await one("select after from public.audit_logs where actor = $1 and action = 'article.edit' and target = $2 order by id desc limit 1", [`user:${u.editorA.id}`, `articles:${ids.quant}`]);
  assert.equal(skipAudit.after.tax_lens.skip_reason, "세금 영향은 후속 기사에서 다룬다", "생략 사유·편집자·시각이 감사 로그에 남는다 (CORE-01)");

  const stale = await api("POST", `/articles/${ids.quant}/publish`, u.editorA);
  assert.equal(stale.status, 422, show(stale));
  assert.ok(stale.body.failed.includes("nav03.desk-edit-required"), "이전 버전의 승인은 세지 않는다");
  assert.ok(!stale.body.failed.includes("nav10.related-party-check"));

  const again = await api("POST", `/articles/${ids.quant}/reviews`, u.editorA, { kind: "desk_edit", decision: "approve", checklist: { noCausalClaim: true } });
  assert.equal(again.status, 201, show(again));
  const r = await api("POST", `/articles/${ids.quant}/publish`, u.editorA);
  assert.equal(r.status, 200, show(r));
  assert.equal(r.body.article.status, "published");
  assert.ok(r.body.article.firstPublishedAt);
  const row = await one("select status, first_published_at, substantive_updated_at, check_log from public.articles where id = $1", [ids.quant]);
  assert.equal(row.status, "published");
  assert.ok(row.first_published_at);
  assert.equal(row.substantive_updated_at, null);
  assert.equal(row.check_log.publish.seoCheckId, r.body.seoCheckId);
  assert.equal(await auditCount(u.editorA.id, "article.publish", `articles:${ids.quant}`), 1);
  const seo = await one("select blocking_failures, published_with_warnings, warnings from public.seo_checks where id = $1", [r.body.seoCheckId]);
  assert.deepEqual(seo.blocking_failures, []);
  assert.equal(seo.published_with_warnings, seo.warnings.length > 0);
  ids.quantPublishedAt = row.first_published_at.toISOString();

  const twice = await api("POST", `/articles/${ids.quant}/publish`, u.editorA);
  assert.equal(twice.status, 409, show(twice));
});

// ── 세법 해설: 편집 승인과 세무 감수는 다른 상태 (NAV-03 · ART-01) ─────────

test("세법 해설 — 편집 승인만 있으면 422(세무 감수 없음), 세무 감수위원이 서명하면 발행 200", async () => {
  const created = await api("POST", "/articles", u.reporter, {
    slug: slug("explainer"),
    title: `주택 취득세 신고, 취득일부터 60일 안에 ${staff.run}`,
    summary: "주택을 사면 취득일부터 60일 안에 취득세를 신고하고 내야 합니다.",
    section: "tax",
    categoryId: categories["tax/interpretations"],
    contentType: "explainer",
    legalBasisDate: "2026-10-01",
    body: { blocks: EXPLAINER_BLOCKS, claims: [] },
  });
  assert.equal(created.status, 201, show(created));
  ids.explainer = created.body.article.id;
  staff.trackArticle(ids.explainer);
  const law = await api("POST", `/articles/${ids.explainer}/sources`, u.reporter, {
    kind: "official_doc",
    title: "지방세법 제20조(신고 및 납부)",
    url: "https://www.law.go.kr/법령/지방세법/제20조",
    sourceName: "법제처 국가법령정보센터",
    lastVerifiedAt: "2026-10-10T09:00:00+09:00",
    licenseStatus: "공공저작물 자유이용",
  });
  assert.equal(law.status, 201, show(law));
  const withClaims = await api("PATCH", `/articles/${ids.explainer}`, u.reporter, {
    body: { blocks: EXPLAINER_BLOCKS, claims: [{ id: "claim-1", text: "취득일부터 60일 안에 신고하고 납부해야 한다.", kind: "legal", evidenceIds: [law.body.source.ref], blockIndex: 1 }] },
  });
  assert.equal(withClaims.status, 200, show(withClaims));
  assert.equal(withClaims.body.article.taxReviewStatus, "pending", "세무 감수 대상");

  const desk = await api("POST", `/articles/${ids.explainer}/reviews`, u.editorA, { kind: "desk_edit", decision: "approve" });
  assert.equal(desk.status, 201, show(desk));
  const r = await api("POST", `/articles/${ids.explainer}/publish`, u.editorA);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(r.body.failed, ["nav03.tax-review-required"], show(r));
  assert.ok(r.body.taxReviewReasons.length >= 2);

  const byEditor = await api("POST", `/articles/${ids.explainer}/reviews`, u.editorA, { kind: "tax_review", decision: "approve" });
  assert.equal(byEditor.status, 403, "세무 감수 서명은 reviewer만");
  const tax = await api("POST", `/articles/${ids.explainer}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
  assert.equal(tax.status, 201, show(tax));
  const states = await one("select editorial_status, tax_review_status from public.articles where id = $1", [ids.explainer]);
  assert.deepEqual(states, { editorial_status: "approved", tax_review_status: "approved" }, "두 상태가 따로 있다");

  const ok = await api("POST", `/articles/${ids.explainer}/publish`, u.editorA);
  assert.equal(ok.status, 200, show(ok));
  assert.equal(ok.body.article.status, "published");
});

// ── 발행 뒤 수정 (ART-05 · OPT-07) ─────────────────────────

const editedBlocks = (text) => [QUANT_BLOCKS[0], { type: "paragraph", text }, QUANT_BLOCKS[2], QUANT_BLOCKS[3]];

test("발행 뒤 수정 — 기자는 403, 수정 종류·사유 없이 저장하면 422", async () => {
  const byReporter = await api("PATCH", `/articles/${ids.quant}`, u.reporter, { body: { blocks: editedBlocks("기자가 고친 문장이다."), claims: [] }, updateKind: "typo", reason: "오탈자" });
  assert.equal(byReporter.status, 403, show(byReporter));
  const r = await api("PATCH", `/articles/${ids.quant}`, u.editorA, { body: { blocks: editedBlocks("사유 없이 고친 문장이다."), claims: [] } });
  assert.equal(r.status, 422, show(r));
  assert.deepEqual([...r.body.failed].sort(), ["art05.reason-required", "art05.update-kind-required"]);
  const noReason = await api("PATCH", `/articles/${ids.quant}`, u.editorA, { body: { blocks: editedBlocks("종류만 고른 문장이다."), claims: [] }, updateKind: "substantive" });
  assert.equal(noReason.status, 422, show(noReason));
  assert.deepEqual(noReason.body.failed, ["art05.reason-required"]);
  const slugChange = await api("PATCH", `/articles/${ids.quant}`, u.editorA, { slug: slug("moved"), updateKind: "substantive", reason: "주소 변경" });
  assert.equal(slugChange.status, 409, show(slugChange));
  const fear = await api("PATCH", `/articles/${ids.quant}`, u.editorA, { body: { blocks: editedBlocks("놓치면 끝이라는 말은 사실이 아니다."), claims: [] }, updateKind: "substantive", reason: "문장 보강" });
  assert.equal(fear.status, 422, show(fear));
  assert.ok(fear.body.failed.includes("ux03.fear-phrase") || fear.body.failed.includes("ux01.forbidden-phrase"), show(fear));
});

test("오탈자 수정은 실질 수정일을 바꾸지 않고, 실질 수정은 바꾼다 (OPT-07)", async () => {
  const before = await one("select version, first_published_at from public.articles where id = $1", [ids.quant]);
  const typo = await api("PATCH", `/articles/${ids.quant}`, u.editorA, {
    body: { blocks: editedBlocks("편집국이 가온시 세목별 징수 실적을 집계해 보니 올해 1~6월 취득세 징수액은 1,284억 원이었다. 작년 같은 기간보다 290억 원 적다."), claims: [] },
    updateKind: "typo",
    reason: "‘지난해’를 ‘작년’으로 바꿈",
  });
  assert.equal(typo.status, 200, show(typo));
  let row = await one("select version, first_published_at, substantive_updated_at, update_kind from public.articles where id = $1", [ids.quant]);
  assert.equal(row.version, before.version + 1);
  assert.equal(row.substantive_updated_at, null, "오탈자는 dateModified를 바꾸지 않는다");
  assert.equal(row.update_kind, "typo");
  assert.equal(row.first_published_at.toISOString(), ids.quantPublishedAt, "최초 발행일 그대로");
  const rev = await one("select update_kind, reason from public.article_revisions where article_id = $1 and version = $2", [ids.quant, row.version]);
  assert.deepEqual(rev, { update_kind: "typo", reason: "‘지난해’를 ‘작년’으로 바꿈" });

  const sub = await api("PATCH", `/articles/${ids.quant}`, u.editorA, {
    body: { blocks: editedBlocks("편집국이 가온시 세목별 징수 실적을 집계해 보니 올해 1~6월 취득세 징수액은 1,284억 원이었다. 7월 확정치도 같았다."), claims: [] },
    updateKind: "substantive",
    reason: "7월 확정치 반영",
  });
  assert.equal(sub.status, 200, show(sub));
  row = await one("select substantive_updated_at, first_published_at, update_kind from public.articles where id = $1", [ids.quant]);
  assert.ok(row.substantive_updated_at, "실질 수정은 dateModified를 바꾼다");
  assert.ok(row.substantive_updated_at >= row.first_published_at);
  assert.equal(row.update_kind, "substantive");
  assert.equal(row.first_published_at.toISOString(), ids.quantPublishedAt);
});

// ── 정정 (NAV-06) ─────────────────────────────────────────

test("정정 — 이유가 없으면 422, 이유가 있으면 전후 버전과 함께 기록된다. 결정은 편집 책임자만", async () => {
  const changes = { body: { blocks: editedBlocks("편집국이 가온시 세목별 징수 실적을 집계해 보니 올해 1~6월 취득세 징수액은 1,248억 원이었다."), claims: [] } };
  const noReason = await api("POST", `/articles/${ids.quant}/corrections`, u.editorA, { kind: "correction", changes });
  assert.equal(noReason.status, 422, show(noReason));
  assert.deepEqual(noReason.body.failed, ["nav06.reason-required"]);
  assert.equal((await one("select count(*)::int n from public.article_corrections where article_id = $1", [ids.quant])).n, 0);

  const byReporter = await api("POST", `/articles/${ids.quant}/corrections`, u.reporter, { kind: "correction", reason: "수치 오류", changes });
  assert.equal(byReporter.status, 403, show(byReporter));
  assert.equal(await auditCount(u.reporter.id, "correction.decide.denied", `articles:${ids.quant}`), 1);
  const request = await api("POST", `/articles/${ids.quant}/correction-requests`, u.reporter, { reason: "징수액 1,284억 원은 1,248억 원의 오기입니다" });
  assert.equal(request.status, 201, show(request));
  const inquiryId = request.body.request.id;

  const before = await one("select version, substantive_updated_at from public.articles where id = $1", [ids.quant]);
  const ok = await api("POST", `/articles/${ids.quant}/corrections`, u.editorA, {
    kind: "correction",
    reason: "징수액 오기 정정 (1,284억 원 → 1,248억 원)",
    readerNotice: "수정 2026-10-17: 징수액 수치를 바로잡았습니다",
    inquiryId,
    changes,
  });
  assert.equal(ok.status, 201, show(ok));
  const c = await one("select kind, reason, reader_notice, before_revision_id, after_revision_id, decided_by, published_at, inquiry_id from public.article_corrections where id = $1", [ok.body.correction.id]);
  assert.equal(c.kind, "correction");
  assert.equal(c.reason, "징수액 오기 정정 (1,284억 원 → 1,248억 원)");
  assert.equal(c.decided_by, `user:${u.editorA.id}`);
  assert.ok(c.published_at);
  assert.equal(Number(c.inquiry_id), inquiryId);
  const revs = (await db.query("select id, version from public.article_revisions where id = any($1::bigint[]) order by version", [[c.before_revision_id, c.after_revision_id]])).rows;
  assert.deepEqual(revs.map((x) => x.version), [before.version, before.version + 1], "전후 버전");
  const row = await one("select update_kind, updated_reason, substantive_updated_at, status from public.articles where id = $1", [ids.quant]);
  assert.equal(row.update_kind, "correction");
  assert.ok(row.substantive_updated_at > before.substantive_updated_at, "정정은 dateModified를 바꾼다");
  assert.equal(row.status, "published", "정정해도 영속 URL·게재 상태 유지");
  const inquiry = await one("select status, resolution from public.inquiries where id = $1", [inquiryId]);
  assert.deepEqual(inquiry, { status: "done", resolution: "correction_published" });
  assert.equal(await auditCount(u.editorA.id, "correction.decide", `articles:${ids.quant}`), 1);
});

// ── 역할 부여 (ACC-04) ────────────────────────────────────

test("관리자는 역할을 부여한다 — editor와 편집국 외 역할 겸직은 4조합 모두 409 + 감사 로그", async () => {
  const editor = await api("POST", "/roles", u.admin, { userId: u.target.id, role: "editor" });
  assert.equal(editor.status, 201, show(editor));
  assert.deepEqual(editor.body.roles, ["editor"]);
  for (const role of NON_NEWSROOM) {
    const r = await api("POST", "/roles", u.admin, { userId: u.target.id, role });
    assert.equal(r.status, 409, `${role}: ${show(r)}`);
    assert.match(r.body.error, /editor/);
    assert.ok(!/violates|stack|\n\s+at /.test(JSON.stringify(r.body)), "DB 원문·스택을 내보내지 않는다");
  }
  const rejected = await one("select count(*)::int n from public.audit_logs where actor = $1 and action = 'role.grant.rejected' and target = $2", [`user:${u.admin.id}`, `staff_roles:${u.target.id}`]);
  assert.equal(rejected.n, 4);
  const roles = (await db.query("select role from public.staff_roles where user_id = $1", [u.target.id])).rows.map((x) => x.role);
  assert.deepEqual(roles, ["editor"]);

  const reverse1 = await api("POST", "/roles", u.admin, { userId: u.target2.id, role: "ad_ops" });
  assert.equal(reverse1.status, 201, show(reverse1));
  const reverse2 = await api("POST", "/roles", u.admin, { userId: u.target2.id, role: "editor" });
  assert.equal(reverse2.status, 409, show(reverse2));

  const badRole = await api("POST", "/roles", u.admin, { userId: u.target.id, role: "admin" });
  assert.equal(badRole.status, 422);
  const revoke = await api("POST", "/roles", u.admin, { userId: u.target.id, role: "editor", op: "revoke" });
  assert.equal(revoke.status, 200, show(revoke));
  assert.deepEqual(revoke.body.roles, []);
  assert.equal(await auditCount(u.admin.id, "role.grant", `staff_roles:${u.target.id}`), 1);
  assert.equal(await auditCount(u.admin.id, "role.revoke", `staff_roles:${u.target.id}`), 1);
});

test("편집 책임자의 역할 부여는 403 + 감사 로그", async () => {
  const r = await api("POST", "/roles", u.editorA, { userId: u.target.id, role: "reporter" });
  assert.equal(r.status, 403, show(r));
  assert.equal(await auditCount(u.editorA.id, "role.grant.denied", `staff_roles:${u.target.id}`), 1);
  assert.equal((await one("select count(*)::int n from public.staff_roles where user_id = $1", [u.target.id])).n, 0);
});

// ── 기사 기획 캘린더 (NAV-09) ─────────────────────────────

test("기획 상태 — 담당·이해관계 없이 assigned 409, fact_check·review 없이 published 409, 순서대로면 200", async () => {
  const denied = await api("POST", "/assignments", u.ad_ops, { section: "local" });
  assert.equal(denied.status, 403);
  const created = await api("POST", "/assignments", u.reporter, { section: "local", hypothesis: "취득세 감소는 거래량 감소와 같이 움직였다", method: "quantitative" });
  assert.equal(created.status, 201, show(created));
  const id = created.body.assignment.id;
  staff.trackAssignment(id);
  assert.equal(created.body.assignment.status, "idea");

  const badValue = await api("PATCH", `/assignments/${id}`, u.reporter, { status: "done" });
  assert.equal(badValue.status, 422);
  const early = await api("PATCH", `/assignments/${id}`, u.reporter, { status: "assigned" });
  assert.equal(early.status, 409, show(early));
  assert.match(early.body.error, /NAV-09/);
  const ready = await api("PATCH", `/assignments/${id}`, u.reporter, {
    reporterId: u.reporter.personId,
    editorId: u.editorA.personId,
    conflicts: "없음",
    relevance: "지방세 세수와 부동산 거래의 관계 — 전문 분야",
    status: "assigned",
  });
  assert.equal(ready.status, 200, show(ready));
  const skip = await api("PATCH", `/assignments/${id}`, u.reporter, { status: "published" });
  assert.equal(skip.status, 409, show(skip));
  assert.match(skip.body.error, /fact_check/);
  for (const status of ["reporting", "fact_check", "review", "published"]) {
    const r = await api("PATCH", `/assignments/${id}`, u.editorA, { status });
    assert.equal(r.status, 200, `${status}: ${show(r)}`);
  }
  const events = (await db.query("select to_status from public.story_assignment_events where assignment_id = $1 order by id", [id])).rows.map((e) => e.to_status);
  assert.deepEqual(events, ["idea", "assigned", "reporting", "fact_check", "review", "published"]);
  const audits = (await one("select count(*)::int n from public.audit_logs where target = $1 and action like 'assignment.%'", [`story_assignments:${id}`])).n;
  assert.equal(audits, 6, "등록 1 + 바뀐 저장 5");
});

test("시험 동안 예상 못 한 서버 오류(500)가 없었고, 응답에 키·스택이 없다", async () => {
  const log = server.log();
  assert.ok(!log.includes("[api] 처리 중 오류"), log.slice(-2000));
  assert.ok(!log.includes("[db] "), log.slice(-2000));
  assert.ok(!log.includes("[audit] "), log.slice(-2000));
  const r = await api("POST", `/articles/${ids.quant}/publish`, u.editorA);
  const text = JSON.stringify(r.body);
  for (const secret of [sb.serviceRoleKey, sb.anonKey, u.editorA.token]) assert.ok(!text.includes(secret));
});
