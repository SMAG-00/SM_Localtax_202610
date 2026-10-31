// 지역 기사 편집 게이트 E2E (W4 7단계 — docs/dev/W4_설계.md 1장 7단계 · 2.1 · 2.2 · 6장 · 12장 #7·#30, PRD-01B REG1-17)
// standalone 빌드를 띄우고 로컬 Supabase에 붙인다. 지역·사업자·기사 내용은 모두 시험용 가짜다(시험용 가상군·*.example — 설계 8장).
//  a) 지자체뉴스 지역 태그 0 → 새 발행 422(regionCodes) + DB 직접 발행 거부 · 지역 태그만 → 편집 분야·공익적 질문 422(칸 이름) + DB 거부 ·
//     채우면 발행 200 · 이미 공개된 태그 없는 기사는 그대로 공개
//  b) '축제 예산의 지방재정 영향'(시험용) — 축제 + 관계 0 → 보류(relation-required · 판정 상태 held) · 관계 1 + 근거 0 → 보류(relation-evidence) ·
//     근거 더하고 승인 → 후보 · 발행 200 · 공개
//  c) 편집자 판정 — '이번 주말 축제 10선'(여행 후기)·'맛집 순위'(맛집 추천) → 별도 상품 상태 · 보도·해설 발행 422 · 공개 렌더 0 ·
//     광고 담당·기자 판정 403 + 거부 감사 1건 · 편집 책임자 판정 감사 1건 · 1인 체제 관리자 판정 200 · 공개 중인 보도·해설에 비보도 판정 409 + DB 거부
//  d) 지역 기사 편집 승인 checklist 3항목 중 하나라도 빠지면 422(checklist.<키>) + DB 직접 승인 거부
//  e) 광고 계약 기록이 있는 지역 사업자(시험용)를 다룬 원고 — 이해관계 표시 없이 승인 422(interestDisclosure) → 표시하면 승인·발행
//  f) 광고 담당 — 편집 분야 바꾸기·편집 분야를 넣은 새 원고 403 + 거부 감사 1건씩, 칸 그대로
//  g) 편집 화면 — 소재·관계 유형·이해관계 표시 칸, 지역 기사 판정 줄(보류 이유), 판정 폼 → 별도 상품, 이해관계 표시 501자 저장 → 칸 오류, 편집 승인 폼 3항목
// 만든 계정·기사·제휴사·근거·승인 기록은 끝나면 지운다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-regional-gate-e2e@example.test";
const SEOUL = "1100000000";
const REGIONAL = { evidence: true, relation: true, ad_independence: true };
const JUDGE_SEED = ["local_tax", "realestate", "local_finance", "urban_policy"];

let sb, server, staff, db, browser, base;
const u = {};
const fx = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const slugOf = (label) => `e2e-w4rg-${label}-${staff.run}`;
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
async function draftLocal(label, title, over = {}) {
  const created = await api("POST", "/articles", u.reporter, { slug: slugOf(label), title: `${title} ${staff.run}`.slice(0, 40), summary: "시험용 가상군 자료로 지방세 흐름을 정리했습니다.", section: "local", contentType: "explainer", legalBasisDate: "2026-10-01", ...over });
  assert.equal(created.status, 201, show(created));
  const id = created.body.article.id;
  staff.trackArticle(id);
  const law = await api("POST", `/articles/${id}/sources`, u.reporter, LAW);
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

  u.admin = await staff.createUser({ label: "w4rg-admin", email: ADMIN_EMAIL, person: { name: "시험용 1인 편집국 관리자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w4rg-reporter", roles: ["reporter"], person: { name: "시험용 지역 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w4rg-editor", roles: ["editor"], person: { name: "시험용 지역 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4rg-reviewer", roles: ["reviewer"], person: { name: "시험용 지역 감수위원", roles: ["reviewer"] } });
  u.adOps = await staff.createUser({ label: "w4rg-adops", roles: ["ad_ops"], person: { name: "시험용 광고 담당", roles: ["writer"] } });
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

test("a) 지자체뉴스 지역 태그 0 → 새 발행 422 + DB 거부 · 태그만 → 편집 분야·공익적 질문 422(칸 이름) + DB 거부 · 채우면 200 · 이미 공개된 기사는 그대로", async () => {
  const a = await draftLocal("tagless", "시험용 가상군 취득세 신고 흐름");
  await approve(a);
  let r = await publish(a);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(regionalFailed(r), ["reg1_17.region-tag-required"], show(r));
  assert.deepEqual(r.body.findings.filter((f) => f.id === "reg1_17.region-tag-required").map((f) => f.location.field), ["regionCodes"]);
  await assert.rejects(dbPublish(a.id), /지역 태그\(regionCodes\)가 있어야 새로 발행/, "DB 직접 발행도 거부");

  await patch(a, u.reporter, { regionCodes: [SEOUL] });
  await approve(a);
  r = await publish(a);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(regionalFailed(r), ["reg1_17.editorial-field", "reg1_17.public-question"], show(r));
  assert.deepEqual(r.body.findings.filter((f) => f.id.startsWith("reg1_17.")).map((f) => f.location.field), ["editorialField", "publicQuestion"]);
  await assert.rejects(dbPublish(a.id), /편집 분야\(editorialField/, "DB 직접 발행도 거부");
  assert.equal(await page200(a.href), 404, "발행 전 공개 0");

  await patch(a, u.reporter, { editorialField: "local_tax", publicQuestion: "취득세 신고 기한을 놓친 주민은 무엇을 해야 하는가" });
  await approve(a);
  r = await publish(a);
  assert.equal(r.status, 200, show(r));
  assert.equal(await page200(a.href), 200);

  // 이미 공개된 지자체뉴스 기사(태그 없음 — 이관 자료처럼 발행일을 넣어 온 행)는 그대로 공개 (12장 #30)
  const old = await one(
    "insert into public.articles (slug, title, summary, section, content_type, status, author_id, first_published_at) values ($1, '시험용 옛 지자체뉴스 기사', '옛 기사 요약입니다', 'local', 'explainer', 'published', $2, now() - interval '30 days') returning id",
    [slugOf("old"), u.reporter.personId],
  );
  staff.trackArticle(Number(old.id));
  assert.equal(await page200(`/news/${slugOf("old")}`), 200, "이미 공개분 유지");
});

test("b) '축제 예산의 지방재정 영향'(시험용) — 관계 0 → 보류 · 관계 1 + 근거 0 → 보류 · 근거 더하고 승인 → 후보·발행 200", async () => {
  const b = await draftLocal("festival-budget", "시험용 가상군 축제 예산의 지방재정 영향", {
    regionCodes: [SEOUL],
    editorialField: "local_finance",
    publicQuestion: "축제 예산이 시험용 가상군 지방재정에 어떤 영향을 주는가",
    subjectKind: "festival",
  });
  await approve(b);
  let r = await publish(b);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(regionalFailed(r), ["reg1_17.relation-required", "reg1_17.relation-evidence"], show(r));
  assert.equal((await regionalOf(b)).state, "held");

  await patch(b, u.reporter, { relationTypes: ["budget"] });
  await approve(b);
  r = await publish(b);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(regionalFailed(r), ["reg1_17.relation-evidence"], show(r));
  const held = await regionalOf(b);
  assert.equal(held.state, "held");
  assert.ok(held.reasons.some((x) => /근거 1건 이상/.test(x)), JSON.stringify(held));

  const ev = await api("POST", `/articles/${b.id}/evidence`, u.reporter, { evidenceType: "document", location: "편집국 자료실/시험용 가상군 축제 예산서 사본", rightsStatus: "confirmed", verificationStatus: "verified", verifiedAt: "2026-10-14T10:00:00+09:00" });
  assert.equal(ev.status, 201, show(ev));
  await approve(b);
  assert.deepEqual(await regionalOf(b), { state: "candidate", reasons: [] }, "관계 + 근거 + 승인 = 기사 후보");
  r = await publish(b);
  assert.equal(r.status, 200, show(r));
  assert.equal(await page200(b.href), 200);
});

test("c) 편집자 판정 — 여행 후기·맛집 추천 → 별도 상품 · 발행 422 · 공개 0 · 광고 담당·기자 403 + 감사 · 편집 책임자·1인 관리자 판정 · 공개 중 비보도 판정 409", async () => {
  const ten = await draftLocal("ten-picks", "이번 주말 축제 10선", { regionCodes: [SEOUL], editorialField: "local_finance", publicQuestion: "시험용 질문", subjectKind: "festival" });
  // 광고 담당·기자 판정 → 403 + 거부 감사 1건씩, 칸 그대로
  for (const who of [u.adOps, u.reporter]) {
    const denied = await api("POST", "/regions", who, { op: "judge", articleId: ten.id, judgement: "news_candidate" });
    assert.equal(denied.status, 403, show(denied));
    assert.equal(await auditCount("regional.judge.denied", ten.target, who.id), 1, "거부 감사 1건");
  }
  assert.equal((await one("select editorial_judgement from public.articles where id = $1", [ten.id])).editorial_judgement, null);
  // 편집 책임자 판정 → 감사 1건, 별도 상품 상태
  const judged = await api("POST", "/regions", u.editor, { op: "judge", articleId: ten.id, judgement: "travel_review", note: "주말 나들이 목록 — 여행 후기" });
  assert.equal(judged.status, 200, show(judged));
  assert.equal(judged.body.article.editorialJudgement, "travel_review");
  assert.equal(await auditCount("article.regional_judgement", ten.target, u.editor.id), 1);
  const row = await one("select editorial_judgement, judged_by, judged_at from public.articles where id = $1", [ten.id]);
  assert.deepEqual([row.editorial_judgement, row.judged_by, row.judged_at !== null], ["travel_review", `user:${u.editor.id}`, true]);
  assert.equal((await regionalOf(ten)).state, "separate_product", "기사 후보 0");
  await approve(ten);
  const r = await publish(ten);
  assert.equal(r.status, 422, show(r));
  assert.ok(regionalFailed(r).includes("reg1_17.non-news-judgement"), show(r));
  assert.equal(await page200(ten.href), 404, "공개 렌더 0");
  await assert.rejects(dbPublish(ten.id), /보도기사·해설로 발행할 수 없습니다/, "DB 직접 발행도 거부");
  const bad = await api("POST", "/regions", u.editor, { op: "judge", articleId: ten.id, judgement: "tour" });
  assert.equal(bad.status, 422, show(bad));
  assert.ok(bad.body.errors.some((e) => e.startsWith("judgement: ")), show(bad));

  // '맛집 순위' — 1인 체제 관리자(PO)가 판정
  const rank = await draftLocal("restaurant-rank", "맛집 순위", { regionCodes: [SEOUL], editorialField: "local_tax", publicQuestion: "시험용 질문", subjectKind: "commerce", relationTypes: ["tax_revenue"] });
  const byAdmin = await api("POST", "/regions", u.admin, { op: "judge", articleId: rank.id, judgement: "restaurant_pick" });
  assert.equal(byAdmin.status, 200, show(byAdmin));
  assert.equal((await regionalOf(rank)).state, "separate_product");
  await approve(rank);
  assert.ok(regionalFailed(await publish(rank)).includes("reg1_17.non-news-judgement"));

  // 공개 중인 해설(a)에 행사 홍보 판정 → 409, DB도 거부
  const onAir = await api("POST", "/regions", u.editor, { op: "judge", articleId: fx.tagless.id, judgement: "event_promo" });
  assert.equal(onAir.status, 409, show(onAir));
  await assert.rejects(db.query("update public.articles set editorial_judgement = 'event_promo', judged_by = 'user:x', judged_at = now() where id = $1", [fx.tagless.id]), /먼저 내린 뒤 판정하세요/);
});

test("d) 지역 기사 편집 승인 — 3항목 중 하나라도 빠지면 422(checklist.<키>) + DB 직접 승인 거부", async () => {
  const d = fx["festival-budget"];
  for (const key of Object.keys(REGIONAL)) {
    const checklist = { ...REGIONAL, [key]: false };
    const r = await api("POST", `/articles/${d.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve", checklist });
    assert.equal(r.status, 422, show(r));
    assert.deepEqual(r.body.errors.map((e) => e.split(": ")[0]), [`checklist.${key}`], show(r));
  }
  const before = (await one("select count(*)::int n from public.editorial_reviews where article_id = $1", [d.id])).n;
  await assert.rejects(
    db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, checklist) values ($1, 'desk_edit', $2, 'approve', '{\"evidence\": true}')", [d.id, u.editor.personId]),
    /근거·관계·광고 독립성 세 항목/,
  );
  assert.equal((await one("select count(*)::int n from public.editorial_reviews where article_id = $1", [d.id])).n, before, "승인 기록 0");
});

test("e) 광고 계약 기록이 있는 지역 사업자를 다룬 원고 — 이해관계 표시 없이 승인 422 → 표시하면 승인·발행", async () => {
  const e = await draftLocal("advertiser", "시험용 가상상회 상권 세수 변화", { regionCodes: [SEOUL], editorialField: "local_tax", publicQuestion: "상권 변화가 지방세 세수에 어떤 영향을 주는가", coveredPartnerIds: [fx.partner] });
  const r = await api("POST", `/articles/${e.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve", checklist: REGIONAL });
  assert.equal(r.status, 422, show(r));
  assert.equal(r.body.errors.length, 1, show(r));
  assert.match(r.body.errors[0], /^interestDisclosure: .*시험용 가상상회/);
  await patch(e, u.reporter, { interestDisclosure: "시험용 가상상회는 이 매체와 광고 계약이 있습니다" });
  await approve(e);
  const p = await publish(e);
  assert.equal(p.status, 200, show(p));
});

test("f) 광고 담당 — 편집 분야 바꾸기·편집 분야를 넣은 새 원고 403 + 거부 감사 1건씩, 칸 그대로", async () => {
  const ad = await api("POST", "/articles", u.adOps, { slug: slugOf("ad"), title: `시험용 광고 ${staff.run}`, section: "local", contentType: "sponsored", label: "ad", regionCodes: [SEOUL] });
  assert.equal(ad.status, 201, show(ad));
  staff.trackArticle(ad.body.article.id);
  const target = `articles:${ad.body.article.id}`;
  const change = await api("PATCH", `/articles/${ad.body.article.id}`, u.adOps, { editorialField: "local_tax" });
  assert.equal(change.status, 403, show(change));
  assert.match(change.body.error, /REG1-17/);
  assert.equal(await auditCount("article.regional_fields.denied", target, u.adOps.id), 1);
  assert.equal((await one("select editorial_field from public.articles where id = $1", [ad.body.article.id])).editorial_field, null, "칸 그대로");
  const subject = await api("PATCH", `/articles/${ad.body.article.id}`, u.adOps, { subjectKind: "festival", relationTypes: ["budget"] });
  assert.equal(subject.status, 403, show(subject));
  assert.equal(await auditCount("article.regional_fields.denied", target, u.adOps.id), 2);
  const created = await api("POST", "/articles", u.adOps, { slug: slugOf("ad2"), title: `시험용 광고 둘 ${staff.run}`, section: "local", contentType: "sponsored", label: "ad", regionCodes: [SEOUL], editorialField: "local_tax" });
  assert.equal(created.status, 403, show(created));
  assert.equal(await auditCount("article.regional_fields.denied", "articles:new", u.adOps.id), 1);
  assert.equal((await one("select count(*)::int n from public.articles where slug = $1", [slugOf("ad2")])).n, 0);
  // 광고 담당이 고칠 수 있는 칸(제목)은 그대로 된다
  assert.equal((await api("PATCH", `/articles/${ad.body.article.id}`, u.adOps, { title: `시험용 광고 고침 ${staff.run}` })).status, 200);
});

test("g) 편집 화면 — 지역 칸·판정 줄(보류 이유)·판정 폼 → 별도 상품·이해관계 표시 501자 칸 오류·편집 승인 3항목", async () => {
  const g = await draftLocal("screen", "시험용 가상군 축제 세수", { regionCodes: [SEOUL], editorialField: "local_finance", publicQuestion: "축제가 세수에 어떤 영향을 주는가", subjectKind: "festival" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}/admin/login`);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그인" && !b.disabled));
    await page.fill("#login-email", u.editor.email);
    await page.fill("#login-password", u.editor.password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL((url) => url.pathname !== "/admin/login");
    await page.goto(`${base}/admin/articles/${g.id}`);
    // 지역 기사 판정 칸은 접힌 '그 밖의 칸' 안에 있다 (간편 발행 2026-10-31) — 눌러서 편다
    await page.locator("details#more-sections > summary").click();
    const panel = page.locator('[data-part="regional-judge"]');
    await panel.waitFor();
    assert.equal(await panel.getAttribute("data-state"), "held");
    assert.match(await panel.locator('[data-part="regional-state"]').innerText(), /보류\(held\)/);
    assert.match(await panel.locator('[data-part="regional-reasons"]').innerText(), /관계 유형/);
    // 지역 칸 — 소재 종류 선택값·관계 유형 6개·이해관계 표시 칸
    assert.equal(await page.locator("#meta-subject-kind").inputValue(), "festival");
    assert.equal(await page.locator('[data-relation]').count(), 6);
    assert.ok(await page.locator("#meta-interest-disclosure").isVisible());

    // 판정 폼 → 여행 후기 → 별도 상품 상태
    await page.waitForFunction(() => [...document.querySelectorAll("form[aria-label='지역 기사 판정'] button")].some((b) => !b.disabled));
    await page.locator("#regional-judgement").selectOption("travel_review");
    await page.getByRole("form", { name: "지역 기사 판정" }).getByRole("button", { name: "판정 저장" }).click();
    await page.locator('[data-part="regional-judge"][data-state="separate_product"]').waitFor();
    assert.equal(await auditCount("article.regional_judgement", g.target, u.editor.id), 1);

    // 이해관계 표시 501자 → 저장 → 칸 오류(서버 422 칸 이름 → 칸)
    await page.locator("#meta-interest-disclosure").fill("가".repeat(501));
    await page.getByRole("form", { name: "기사 저장" }).getByRole("button", { name: "저장", exact: true }).click();
    const err = page.locator("#meta-interest-disclosure-error");
    await err.waitFor();
    assert.match(await err.innerText(), /500자 이하/);
    assert.equal((await one("select interest_disclosure from public.articles where id = $1", [g.id])).interest_disclosure, null, "저장 0");

    // 편집 승인 폼 — 지역 기사 3항목이 확인 항목에 있다
    await page.goto(`${base}/admin/reviews/${g.id}`);
    const form = page.getByRole("form", { name: "편집 승인 결정" });
    await form.waitFor();
    for (const key of Object.keys(REGIONAL)) assert.equal(await form.locator(`#review-desk_edit-check-${key}`).count(), 1, key);
  } finally {
    await ctx.close();
  }
});
