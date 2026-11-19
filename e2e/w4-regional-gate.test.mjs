// 지자체뉴스는 일반 기사와 같다 E2E (W4 7단계 — PO 2026-11-18 "지역 기사 판정(REG1-17)을 걷어냄")
// 옛 시험(지역 태그·편집 분야·공익적 질문 필수 · 소재·관계 유형 보류 · 비보도 판정 → 별도 상품 · 승인 3항목 · 광고 담당 편집 분야 403)은 기능과 함께 없앴다.
// 지금 약속: 지자체뉴스(section=local) 기사도 지역 칸이 비어 있어도 일반 기사와 같은 길로 승인·발행된다. 판정 API는 없다.
//  a) 지역 태그·편집 분야·공익적 질문이 모두 비어도 승인 → 발행 200 · 공개 200 · 발행 실패 목록에 reg1_17 항목 0 · DB 직접 발행도 막지 않음
//  b) 축제 소재 + 관계 유형·근거 0 도 보류 없이 승인 → 발행 200 · 편집 승인에서 확인 3항목을 빼도 201
//  c) 판정 API(/api/admin/regions op=judge) 405
//  d) 광고 담당 — 편집 분야를 넣는 것은 그대로 403 + 거부 감사 (이 막기는 남았다)
// 만든 계정·기사·승인 기록은 끝나면 지운다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-regional-gate-e2e@example.test";
const SEOUL = "1100000000";

let sb, server, staff, db, base;
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
const auditCount = (action, target, actorId) =>
  one("select count(*)::int n from public.audit_logs where action = $1 and target = $2 and actor = $3 and at >= $4", [action, target, `user:${actorId}`, staff.startedAt]).then((r) => r.n);
const regionalFailed = (r) => (r.body.failed ?? []).filter((id) => id.startsWith("reg1_17."));

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
async function approve(a, checklist) {
  const desk = await api("POST", `/articles/${a.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve", ...(checklist ? { checklist } : {}) });
  assert.equal(desk.status, 201, show(desk));
  const tax = await api("POST", `/articles/${a.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
  assert.equal(tax.status, 201, show(tax));
}
const publish = (a) => api("POST", `/articles/${a.id}/publish`, u.editor);
const page200 = async (href) => (await fetch(`${base}${href}`, { redirect: "manual" })).status;

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
  for (const t of ["articles", "editorial_reviews", "article_evidence"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;

  u.admin = await staff.createUser({ label: "w4rg-admin", email: ADMIN_EMAIL, person: { name: "시험용 1인 편집국 관리자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w4rg-reporter", roles: ["reporter"], person: { name: "시험용 지역 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w4rg-editor", roles: ["editor"], person: { name: "시험용 지역 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4rg-reviewer", roles: ["reviewer"], person: { name: "시험용 지역 감수위원", roles: ["reviewer"] } });
  u.adOps = await staff.createUser({ label: "w4rg-adops", roles: ["ad_ops"], person: { name: "시험용 광고 담당", roles: ["writer"] } });
});

after(async () => {
  try {
    await staff?.cleanup();
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 지역 태그·편집 분야·공익적 질문이 비어도 승인 → 발행 200 · 공개 200 · 지역 판정 실패 항목 0", async () => {
  const a = await draftLocal("tagless", "시험용 가상군 취득세 신고 흐름");
  assert.equal(await page200(a.href), 404, "발행 전 공개 0");
  await approve(a);
  const r = await publish(a);
  assert.equal(r.status, 200, show(r));
  assert.deepEqual(regionalFailed(r), [], "발행 결과에 지역 판정 실패 항목 0");
  assert.equal(await page200(a.href), 200, "공개 200");

  // DB 직접 발행도 지역 태그를 요구하지 않는다 (트리거 삭제 — 마이그레이션 243)
  const direct = await draftLocal("tagless-db", "시험용 가상군 직접 발행");
  await db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [direct.id]);
  assert.equal((await one("select status from public.articles where id = $1", [direct.id])).status, "published", "DB 직접 발행 통과");
});

test("b) 축제 소재 + 관계 유형·근거 0 → 보류 없이 승인·발행 200 · 승인 확인 3항목을 빼도 201", async () => {
  const b = await draftLocal("festival-budget", "시험용 가상군 축제 예산의 지방재정 영향", {
    regionCodes: [SEOUL],
    editorialField: "local_finance",
    publicQuestion: "축제 예산이 시험용 가상군 지방재정에 어떤 영향을 주는가",
    subjectKind: "festival",
  });
  // 근거·관계·광고 독립성 중 일부만 체크한 편집 승인도 그대로 기록된다
  const desk = await api("POST", `/articles/${b.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve", checklist: { evidence: true } });
  assert.equal(desk.status, 201, show(desk));
  const tax = await api("POST", `/articles/${b.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
  assert.equal(tax.status, 201, show(tax));
  const r = await publish(b);
  assert.equal(r.status, 200, show(r));
  assert.deepEqual(regionalFailed(r), []);
  assert.equal(await page200(b.href), 200);
});

test("c) 판정 API는 없다(405) · 판정 칸 그대로", async () => {
  const a = await draftLocal("judge-gone", "시험용 가상군 판정 없음");
  for (const who of [u.editor, u.admin]) {
    const r = await api("POST", "/regions", who, { op: "judge", articleId: a.id, judgement: "travel_review" });
    assert.equal(r.status, 405, show(r));
  }
  assert.equal((await one("select editorial_judgement from public.articles where id = $1", [a.id])).editorial_judgement, null, "판정 칸 그대로");
});

test("d) 광고 담당 — 편집 분야 바꾸기·편집 분야를 넣은 새 원고 403 + 거부 감사 1건씩, 칸 그대로 (이 막기는 그대로 남았다)", async () => {
  const ad = await api("POST", "/articles", u.adOps, { slug: slugOf("ad"), title: `시험용 광고 ${staff.run}`, section: "local", contentType: "sponsored", label: "ad", regionCodes: [SEOUL] });
  assert.equal(ad.status, 201, show(ad));
  staff.trackArticle(ad.body.article.id);
  const target = `articles:${ad.body.article.id}`;
  const change = await api("PATCH", `/articles/${ad.body.article.id}`, u.adOps, { editorialField: "local_tax" });
  assert.equal(change.status, 403, show(change));
  assert.equal(await auditCount("article.regional_fields.denied", target, u.adOps.id), 1);
  assert.equal((await one("select editorial_field from public.articles where id = $1", [ad.body.article.id])).editorial_field, null, "칸 그대로");
  const created = await api("POST", "/articles", u.adOps, { slug: slugOf("ad2"), title: `시험용 광고 둘 ${staff.run}`, section: "local", contentType: "sponsored", label: "ad", regionCodes: [SEOUL], editorialField: "local_tax" });
  assert.equal(created.status, 403, show(created));
  assert.equal(await auditCount("article.regional_fields.denied", "articles:new", u.adOps.id), 1);
  assert.equal((await one("select count(*)::int n from public.articles where slug = $1", [slugOf("ad2")])).n, 0);
  // 광고 담당이 고칠 수 있는 칸(제목)은 그대로 된다
  assert.equal((await api("PATCH", `/articles/${ad.body.article.id}`, u.adOps, { title: `시험용 광고 고침 ${staff.run}` })).status, 200);
});
