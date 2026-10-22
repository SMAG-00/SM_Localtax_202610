// 편집 경고·별도 상품 검토 큐 E2E (W4 8단계 — docs/dev/W4_설계.md 1장 8단계 · 2.1 · 2.2 · 5장 `/admin/regions` · 6장, PRD-01B REG1-14·17)
// standalone 빌드를 띄우고 로컬 Supabase에 붙인다. 지역·기사·보도자료 내용은 모두 시험용 가짜다(시험용 가상군·*.example — 설계 8장).
//  a) 비보도 판정(여행 후기) → 별도 상품 검토 큐 열린 항목 정확히 1건 + 감사 separate_product.route 1건 · 다른 비보도 판정으로 바꿔도 1건 · 기사 후보로 바꾸면 닫힘
//  b) 큐 원고 — 발행 422 + DB 직접 발행 거부 · /news·/local·공개 뷰(사이트맵 원본)·자체 취재 집계에 0, 같은 때 발행한 대조 기사는 1
//  c) /api/admin/regions — 판정판 GET(편집 책임자) · 기자·광고 담당 GET·닫기 403 + 거부 감사 · 사유 없는 닫기 422 · 닫기 200 + 감사 separate_product.close · 다시 닫기 409 ·
//     닫아도 보도기사로는 발행 422(7단계) · 공개 중 가이드에 비보도 판정 409
//  d) 단계 순서 — DB 초안 → 발행 거부 · 승인 단계를 되돌린 원고 발행 409(reg1_14.stage-skip) · 세무 감수 반려 뒤 편집 승인은 승인 단계로 가지 않고, 감수 승인 뒤 승인 → 발행 200
//  e) 편집 경고 4종 — 점검 응답에 보도자료 재게시·근거 없는 지역 수치·사진 권리 누락·오래된 통계(경고 — 발행을 막지 않는다), 오래된 통계 기준 설정 422·바꾸면 다음 점검부터
//  f) 화면 — 점검 패널 '편집 경고' 묶음 · 판정 줄의 큐 링크 · /admin/regions 열린 항목 → 닫기 폼 → 닫힌 목록 · 기자 메뉴에 판정판 0·403
// 만든 계정·기사·큐 항목·감사 기록은 끝나면 지운다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-regional-queue-e2e@example.test";
const SEOUL = "1100000000";
const REGIONAL = { evidence: true, relation: true, ad_independence: true };

let sb, server, staff, db, browser, base;
const u = {};
const fx = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const slugOf = (label) => `e2e-w4rq-${label}-${staff.run}`;
const show = (r) => JSON.stringify(r.body).slice(0, 1500);

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const auditCount = (action, target, actorId) =>
  one("select count(*)::int n from public.audit_logs where action = $1 and target = $2 and actor = $3 and at >= $4", [action, target, `user:${actorId}`, staff.startedAt]).then((r) => r.n);
const queueOf = async (articleId) => (await db.query("select * from public.separate_product_queue where article_id = $1 order by id", [articleId])).rows;
const html = async (href) => {
  const res = await fetch(`${base}${href}`, { redirect: "manual" });
  return { status: res.status, text: await res.text() };
};

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
const REGION = { regionCodes: [SEOUL], editorialField: "local_finance", publicQuestion: "이 지역 지방재정에 어떤 영향을 주는가" };

/** 지자체뉴스 해설 초안 — 출처·본문·「지방세로 읽기」 생략 사유(편집 책임자)·지역 칸까지 */
async function draftLocal(label, title, over = {}) {
  const created = await api("POST", "/articles", u.reporter, { slug: slugOf(label), title: `${title} ${staff.run}`.slice(0, 40), summary: "시험용 가상군 자료로 지방세 흐름을 정리했습니다.", section: "local", contentType: "explainer", legalBasisDate: "2026-10-01", ...REGION, ...over });
  assert.equal(created.status, 201, show(created));
  const id = created.body.article.id;
  staff.trackArticle(id);
  const law = await api("POST", `/articles/${id}/sources`, u.reporter, LAW);
  assert.equal(law.status, 201, show(law));
  const a = { id, slug: slugOf(label), title: `${title} ${staff.run}`.slice(0, 40), href: `/news/${slugOf(label)}`, srcRef: law.body.source.ref, target: `articles:${id}` };
  const body = await api("PATCH", `/articles/${id}`, u.reporter, { body: { blocks: blocks(a.srcRef), claims: claims(a.srcRef) } });
  assert.equal(body.status, 200, show(body));
  const skip = await api("PATCH", `/articles/${id}`, u.editor, { taxLens: { topics: [], points: [], links: [], omissionReason: "세금 흐름은 본문 표로 대신한다" } });
  assert.equal(skip.status, 200, show(skip));
  fx[label] = a;
  return a;
}
async function approve(a) {
  const desk = await api("POST", `/articles/${a.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve", checklist: REGIONAL });
  assert.equal(desk.status, 201, show(desk));
  const tax = await api("POST", `/articles/${a.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
  assert.equal(tax.status, 201, show(tax));
}
const publish = (a) => api("POST", `/articles/${a.id}/publish`, u.editor);
const judge = (a, who, judgement, note) => api("POST", "/regions", who, { op: "judge", articleId: a.id, judgement, ...(note ? { note } : {}) });
const statusOf = async (a) => (await one("select status from public.articles where id = $1", [a.id])).status;

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
  for (const t of ["articles", "editorial_reviews", "separate_product_queue", "article_sources", "raw_snapshots"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  assert.equal((await one("select value from public.settings where key = 'stale_statistics_days'")).value, 365, "시험 전 오래된 통계 기준 = 씨앗(2.2)");

  u.admin = await staff.createUser({ label: "w4rq-admin", email: ADMIN_EMAIL, person: { name: "시험용 1인 편집국 관리자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w4rq-reporter", roles: ["reporter"], person: { name: "시험용 지역 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w4rq-editor", roles: ["editor"], person: { name: "시험용 지역 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4rq-reviewer", roles: ["reviewer"], person: { name: "시험용 지역 감수위원", roles: ["reviewer"] } });
  u.adOps = await staff.createUser({ label: "w4rq-adops", roles: ["ad_ops"], person: { name: "시험용 광고 담당", roles: ["writer"] } });
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    if (db) await db.query("update public.settings set value = '365'::jsonb where key = 'stale_statistics_days'");
    await staff?.cleanup();
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        assert.equal((await c.query("select value from public.settings where key = 'stale_statistics_days'")).rows[0].value, 365, "오래된 통계 기준 그대로");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 비보도 판정 → 별도 상품 검토 큐 열린 항목 정확히 1건 + 감사 · 다른 비보도 판정도 1건 · 기사 후보로 바꾸면 닫힘", async () => {
  const ten = await draftLocal("ten-picks", "이번 주말 축제 10선", { subjectKind: "festival" });
  const r = await judge(ten, u.editor, "travel_review", "주말 나들이 목록 — 여행 후기");
  assert.equal(r.status, 200, show(r));
  let q = await queueOf(ten.id);
  assert.deepEqual(q.map((x) => [x.judgement, x.status, x.judged_by]), [["travel_review", "open", `user:${u.editor.id}`]], "열린 항목 정확히 1건");
  assert.equal(await auditCount("separate_product.route", ten.target, u.editor.id), 1, "큐로 보냄 감사 1건");
  assert.equal(await auditCount("article.regional_judgement", ten.target, u.editor.id), 1);
  // 다른 비보도 판정으로 바꿔도 1건 — 판정만 맞춘다, 큐로 보냄 감사는 그대로 1건
  assert.equal((await judge(ten, u.editor, "restaurant_pick")).status, 200);
  q = await queueOf(ten.id);
  assert.deepEqual(q.map((x) => [x.judgement, x.status]), [["restaurant_pick", "open"]]);
  assert.equal(await auditCount("separate_product.route", ten.target, u.editor.id), 1);
  assert.equal((await api("GET", `/articles/${ten.id}`, u.editor)).body.regional.state, "separate_product");
  fx.queued = ten;

  // 기사 후보로 바꾸면 열린 항목이 닫힌다 (닫은 사람 = 판정자)
  const back = await draftLocal("back", "시험용 가상군 행사 예산");
  assert.equal((await judge(back, u.editor, "event_promo")).status, 200);
  assert.equal((await queueOf(back.id)).filter((x) => x.status === "open").length, 1);
  assert.equal((await judge(back, u.admin, "news_candidate")).status, 200, "1인 체제 관리자 판정");
  const closed = await queueOf(back.id);
  assert.deepEqual(closed.map((x) => [x.status, x.closed_by]), [["closed", `user:${u.admin.id}`]]);
  assert.match(closed[0].note, /news_candidate/);
});

test("b) 큐 원고는 발행 422 + DB 거부 · /news·/local·공개 뷰(사이트맵 원본)·자체 취재 집계 0 — 대조 기사는 1", async () => {
  const from = new Date(Date.now() - 60_000).toISOString();
  const queued = fx.queued;
  await approve(queued);
  const r = await publish(queued);
  assert.equal(r.status, 422, show(r));
  assert.ok(r.body.failed.includes("reg1_17.non-news-judgement"), show(r));
  await assert.rejects(db.query("update public.articles set status = 'published' where id = $1", [queued.id]), /보도기사·해설로 발행할 수 없습니다/);
  // 대조 — 같은 때 기사 후보로 발행한 지역 기사
  const control = await draftLocal("control", "시험용 가상군 세수 흐름");
  assert.equal((await judge(control, u.editor, "news_candidate")).status, 200);
  await approve(control);
  const ok = await publish(control);
  assert.equal(ok.status, 200, show(ok));
  // 뉴스 전체(/news — 편집 승인 보도기사 목록)·지자체뉴스 허브(/local — 지역 기사 블록): 큐 원고 0, 대조 해설은 허브에 1
  for (const href of ["/news", "/news?section=local", "/local"]) {
    const page = await html(href);
    assert.equal(page.status, 200, href);
    assert.ok(!page.text.includes(queued.title) && !page.text.includes(queued.slug), `${href} 큐 원고 0`);
  }
  assert.ok((await html("/local")).text.includes(control.title), "/local 대조 기사 1");
  assert.equal((await html(queued.href)).status, 404, "기사 화면 0");
  await db.query("begin");
  try {
    await db.query("set local role anon");
    const rows = (await db.query("select slug from public.public_articles where slug = any($1::text[])", [[control.slug, queued.slug]])).rows.map((x) => x.slug);
    assert.deepEqual(rows, [control.slug], "공개 뷰(사이트맵 원본)에 큐 원고 0");
  } finally {
    await db.query("rollback");
  }
  const facts = (await one("select public.news_production_facts($1::timestamptz, now() + interval '1 minute') f", [from])).f;
  const counted = (facts.articles ?? []).map((x) => Number(x.id));
  assert.ok(counted.includes(Number(control.id)) && !counted.includes(Number(queued.id)), "자체 취재 집계 — 대조 1·큐 원고 0");
  fx.control = control;
});

test("c) /api/admin/regions — 판정판·권한 403 + 감사·닫기 사유 422·닫기 200 + 감사·다시 닫기 409·닫아도 보도기사 422·공개 중 가이드 판정 409", async () => {
  const queued = fx.queued;
  const board = await api("GET", "/regions", u.editor);
  assert.equal(board.status, 200, show(board));
  const item = board.body.open.find((x) => Number(x.article_id) === queued.id);
  assert.ok(item, show(board));
  assert.deepEqual([item.judgement, item.article.title], ["restaurant_pick", queued.title]);
  assert.ok(!board.body.awaiting.some((x) => Number(x.id) === queued.id), "큐 원고는 승인 대기 목록에 0");
  for (const who of [u.reporter, u.adOps]) {
    assert.equal((await api("GET", "/regions", who)).status, 403);
    const denied = await api("POST", "/regions", who, { op: "close", itemId: Number(item.id), note: "시험용" });
    assert.equal(denied.status, 403, show(denied));
    assert.equal(await auditCount("regional.judge.denied", `separate_product_queue:${item.id}`, who.id), 1, "닫기 거부 감사 1건");
  }
  const noNote = await api("POST", "/regions", u.editor, { op: "close", itemId: Number(item.id), note: "  " });
  assert.equal(noNote.status, 422, show(noNote));
  assert.ok(noNote.body.errors.some((e) => e.startsWith("note: ")), show(noNote));
  const closed = await api("POST", "/regions", u.editor, { op: "close", itemId: Number(item.id), note: "광고·협찬 상품으로 전환 검토 — 보도 0" });
  assert.equal(closed.status, 200, show(closed));
  assert.deepEqual([closed.body.item.status, closed.body.item.closed_by], ["closed", `user:${u.editor.id}`]);
  assert.equal(await auditCount("separate_product.close", `separate_product_queue:${item.id}`, u.editor.id), 1);
  assert.equal((await api("POST", "/regions", u.editor, { op: "close", itemId: Number(item.id), note: "또" })).status, 409, "닫힌 항목 409");
  assert.equal((await api("POST", "/regions", u.editor, { op: "close", itemId: 999999999, note: "없음" })).status, 404);
  // 닫아도 판정은 그대로 — 보도·해설로는 발행 0 (7단계)
  const still = await publish(queued);
  assert.equal(still.status, 422, show(still));
  assert.ok(still.body.failed.includes("reg1_17.non-news-judgement"));
  // 공개 중인 원고(해설 — 대조 기사)에 비보도 판정 409, DB도 거부
  const onAir = await judge(fx.control, u.editor, "event_promo");
  assert.equal(onAir.status, 409, show(onAir));
  assert.equal((await queueOf(fx.control.id)).length, 0);
});

test("d) 단계 순서 — DB 초안 → 발행 거부 · 승인 단계를 되돌린 원고 발행 409 · 세무 감수 반려 뒤 편집 승인은 승인 단계 0, 감수 승인 뒤 승인 → 발행", async () => {
  const s = await draftLocal("stages", "시험용 가상군 단계 순서");
  await assert.rejects(db.query("update public.articles set status = 'published' where id = $1", [s.id]), /승인 단계를 거쳐야 공개합니다 — 지금 상태\(draft\)/, "DB 초안 → 발행 거부");
  await assert.rejects(db.query("update public.articles set status = 'approved' where id = $1", [s.id]), /편집 승인 기록 없이 승인 단계로 갈 수 없습니다/, "DB 편집 승인 없이 승인 거부");
  // 세무 감수 반려 → 편집 승인 → 승인 단계로 가지 않는다
  const taxReject = await api("POST", `/articles/${s.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "reject", reason: "시험용 — 법령 기준일 다시 확인" });
  assert.equal(taxReject.status, 201, show(taxReject));
  const desk = await api("POST", `/articles/${s.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve", checklist: REGIONAL });
  assert.equal(desk.status, 201, show(desk));
  assert.notEqual(await statusOf(s), "approved", "세무 감수 반려 상태 — 승인 단계 0");
  const early = await publish(s);
  assert.equal(early.status, 422, show(early));
  // 감수 승인 → 승인 단계 → 발행
  const tax = await api("POST", `/articles/${s.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
  assert.equal(tax.status, 201, show(tax));
  assert.equal(await statusOf(s), "approved", "편집 승인 + 감수 승인 = 승인 단계");
  // 승인 단계를 되돌린(검토 중) 원고 — 판정은 통과해도 단계를 건너뛰면 409
  await db.query("update public.articles set status = 'in_review' where id = $1", [s.id]);
  const skipped = await publish(s);
  assert.equal(skipped.status, 409, show(skipped));
  assert.deepEqual(skipped.body.failed, ["reg1_14.stage-skip"]);
  assert.match(skipped.body.error, /승인 단계를 거쳐야 공개합니다/);
  await db.query("update public.articles set status = 'approved' where id = $1", [s.id]);
  assert.equal((await publish(s)).status, 200, "승인 → 발행");
});

test("e) 편집 경고 4종 — 점검 응답 경고(발행을 막지 않음) · 오래된 통계 기준 설정 422·바꾸면 다음 점검부터", async () => {
  const w = await draftLocal("warnings", "시험용 가상군 세수 경고");
  const PRESS = "시험용 가상군은 상반기 지방세 세수가 집계됐다고 밝혔다. 군은 거래 감소가 원인이라고 설명했다.";
  const press = await api("POST", `/articles/${w.id}/sources`, u.reporter, { kind: "press_release", title: "시험용 가상군 보도자료", url: "https://gasang.example/press/1", sourceName: "시험용 가상군청", licenseStatus: "출처표시", licenseType: "kogl_1", snapshot: { text: PRESS } });
  assert.equal(press.status, 201, show(press));
  const stats = await api("POST", `/articles/${w.id}/sources`, u.reporter, { ...LAW, kind: "dataset", title: "시험용 가상군 세수 통계", url: "https://gasang.example/stats/1", sourceType: "local_tax_revenue", referenceDate: "2024-06-30", publishedOn: "2024-07-15" });
  assert.equal(stats.status, 201, show(stats));
  const figure = { type: "paragraph", text: "시험용 가상군의 올해 재산세는 312억 원으로 늘었다." };
  const saved = await api("PATCH", `/articles/${w.id}`, u.reporter, { body: { blocks: [...blocks(w.srcRef), figure, { type: "paragraph", text: PRESS }], claims: claims(w.srcRef) } });
  assert.equal(saved.status, 200, show(saved));
  const check = await api("GET", `/articles/${w.id}/check`, u.editor);
  assert.equal(check.status, 200, show(check));
  const editorial = check.body.findings.filter((f) => f.ruleRef === "REG1-14");
  assert.ok(editorial.every((f) => f.level === "warn"), "편집 경고는 경고 — 차단 0");
  const ids = [...new Set(editorial.map((f) => f.id))];
  assert.ok(ids.includes("reg1_14.unsupported-figure"), show(check));
  assert.ok(ids.includes("reg1_14.stale-statistics"), show(check));
  assert.ok(!check.body.failed.some((id) => id.startsWith("reg1_14.")), "차단 목록에 편집 경고 0");
  const fig = editorial.find((f) => f.id === "reg1_14.unsupported-figure");
  assert.deepEqual([fig.location.field, fig.location.blockIndex, fig.location.phrase], ["blocks", blocks(w.srcRef).length, "312억 원"]);
  // 보도자료 재게시 — 본문 문장 중 보도자료와 같은 문장이 기준(60% 초과) 이하라 0 → 보도자료만 남기면 1건
  assert.ok(!ids.includes("reg1_14.press-release-repost"), "같은 문장 2/11 — 기준 이하");
  const repost = await api("PATCH", `/articles/${w.id}`, u.reporter, { body: { blocks: [{ type: "paragraph", text: PRESS }], claims: [] } });
  assert.equal(repost.status, 200, show(repost));
  const again = await api("GET", `/articles/${w.id}/check`, u.editor);
  const reposted = again.body.findings.filter((f) => f.id === "reg1_14.press-release-repost");
  assert.equal(reposted.length, 1, show(again));
  assert.equal(reposted[0].location.phrase, press.body.source.ref);
  // 사진 권리 누락 — 권리 미확인 대표 사진
  const media = await one("insert into public.media (path, alt, kind, rights_status, license_type) values ($1, '시험용 가상군청', 'photo', 'unconfirmed', null) returning id", [`e2e/w4rq-${staff.run}.jpg`]);
  staff.trackRow("media", Number(media.id));
  await db.query("update public.articles set lead_media_id = $2 where id = $1", [w.id, media.id]);
  const photo = await api("GET", `/articles/${w.id}/check`, u.editor);
  assert.deepEqual(photo.body.findings.filter((f) => f.id === "reg1_14.photo-rights").map((f) => f.location.field), ["leadImage"]);
  await db.query("update public.articles set lead_media_id = null where id = $1", [w.id]);
  // 오래된 통계 기준 — 운영 설정 422(1~3650 정수), 바꾸면 배포 없이 다음 점검부터
  const bad = await api("PATCH", "/settings/stale_statistics_days", u.admin, { value: 0 });
  assert.equal(bad.status, 422, show(bad));
  const restore = await api("PATCH", `/articles/${w.id}`, u.reporter, { body: { blocks: blocks(w.srcRef), claims: claims(w.srcRef) } });
  assert.equal(restore.status, 200);
  const before365 = await api("GET", `/articles/${w.id}/check`, u.editor);
  assert.equal(before365.body.findings.filter((f) => f.id === "reg1_14.stale-statistics").length, 1, "2024-06-30 통계 — 365일 넘김");
  const wide = await api("PATCH", "/settings/stale_statistics_days", u.admin, { value: 3650 });
  assert.equal(wide.status, 200, show(wide));
  const after3650 = await api("GET", `/articles/${w.id}/check`, u.editor);
  assert.equal(after3650.body.findings.filter((f) => f.id === "reg1_14.stale-statistics").length, 0, "기준 3650일 — 경고 0");
  assert.equal((await api("PATCH", "/settings/stale_statistics_days", u.admin, { value: 365 })).status, 200);
  fx.warnings = w;
});

test("f) 화면 — 점검 패널 편집 경고 묶음 · 판정 줄 큐 링크 · /admin/regions 닫기 폼 → 닫힌 목록 · 기자 메뉴 0·403", async () => {
  const shot = await draftLocal("screen", "시험용 가상군 주말 맛집");
  assert.equal((await judge(shot, u.editor, "restaurant_pick")).status, 200);
  const w = fx.warnings;
  await api("PATCH", `/articles/${w.id}`, u.reporter, { body: { blocks: [...blocks(w.srcRef), { type: "paragraph", text: "시험용 가상군의 올해 재산세는 312억 원으로 늘었다." }], claims: claims(w.srcRef) } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const login = async (page, who) => {
    await page.goto(`${base}/admin/login`);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그인" && !b.disabled));
    await page.fill("#login-email", who.email);
    await page.fill("#login-password", who.password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL((url) => url.pathname !== "/admin/login");
  };
  try {
    const page = await ctx.newPage();
    await login(page, u.editor);
    // 점검 패널 — 편집 경고 묶음 (근거 없는 지역 수치·오래된 통계)
    await page.goto(`${base}/admin/articles/${w.id}`);
    const group = page.locator('[data-testid="check-editorial-warnings"]');
    await group.waitFor();
    const rules = await group.locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-rule")));
    assert.ok(rules.includes("reg1_14.unsupported-figure") && rules.includes("reg1_14.stale-statistics"), JSON.stringify(rules));
    assert.match(await group.innerText(), /지역 수치 문단에 공식 자료·근거 연결 없음/);
    assert.equal(await page.locator('[data-testid="check-warnings"] li[data-rule^="reg1_14."]').count(), 0, "일반 경고 목록엔 0");
    // 판정 줄 — 별도 상품 상태 + 큐 링크
    await page.goto(`${base}/admin/articles/${shot.id}`);
    const judgePanel = page.locator('[data-part="regional-judge"][data-state="separate_product"]');
    await judgePanel.waitFor();
    assert.equal(await judgePanel.locator('[data-part="separate-product-link"] a').getAttribute("href"), "/admin/regions#separate-product-open");
    // /admin/regions — 열린 항목 → 닫기 폼 → 닫힌 목록
    await page.goto(`${base}/admin/regions`);
    const [item] = (await queueOf(shot.id)).filter((x) => x.status === "open");
    const li = page.locator(`[data-testid="separate-product-open"] li[data-queue-id="${item.id}"]`);
    await li.waitFor();
    assert.match(await li.innerText(), /맛집 추천/);
    await page.waitForFunction((id) => !document.querySelector(`form[data-queue-id="${id}"] button`)?.disabled, item.id);
    await li.locator(`#sp-note-${item.id}`).fill("행사·맛집 목록은 광고 상품 후보 — 보도 0");
    await li.getByRole("button", { name: "검토 닫기" }).click();
    await page.locator(`[data-testid="separate-product-closed"] li[data-queue-id="${item.id}"]`).waitFor();
    assert.equal((await queueOf(shot.id))[0].status, "closed");
    assert.equal(await auditCount("separate_product.close", `separate_product_queue:${item.id}`, u.editor.id), 1);
    assert.ok(await page.locator('nav[aria-label="편집국 메뉴"] a[href="/admin/regions"]').count() >= 1, "편집 책임자 메뉴에 판정판");
    // 기자 — 메뉴 0·화면 403
    const rep = await ctx.browser().newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const rp = await rep.newPage();
      await login(rp, u.reporter);
      assert.equal(await rp.locator('nav[aria-label="편집국 메뉴"] a[href="/admin/regions"]').count(), 0, "기자 메뉴에 판정판 0");
      const res = await rp.goto(`${base}/admin/regions`);
      assert.equal(res.status(), 403);
    } finally {
      await rep.close();
    }
  } finally {
    await ctx.close();
  }
});
