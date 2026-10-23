// W5 수용 E2E (docs/dev/W5_설계.md 1장 5단계 - PRD-01B DF-01~05 · DF-09, PRD_최종 §11.1 W5 "반론 기록, 투자 권유 0")
// standalone 빌드를 로컬 Supabase에 붙인다. 구조 해설·사례·통계·규제 내용은 전부 시험용 가짜다(*.example.test).
//  a) 권한 - 기자 403 · 감수위원은 입력 403(서명만) · 편집 책임자는 입력 · 법률 검토 기록은 관리자만
//  b) 구조 해설 - 법률 확인 없이 서명 422 · 편집 책임자 서명 403 · 읽은 초안이 바뀌면 409 · 서명 뒤 승인본 · 고치면 재감수 필요
//  c) 투자 권유 문구 반려 - 금지 표현 422 · 차단 도메인 원문 주소 422 · 추적 쿼리 422 · 원자료 없는 통계 422
//  d) 사례 - 실명 기업 사례는 반론 기록 없이 발행 거부(DB) → 기록하면 발행 · 반론 메모는 공개 화면에 없음
//  e) 켜기 조건 - 법률 검토 기록 없이 켜기 422 → 기록 후 켜짐
//  f) 공개 화면 - 키 꺼짐: 구조 해설·트래커·사례 블록 0, 링크 0 / 켜짐: 구조 해설 상세(SVG + 표 = 관계 수) · 목록 카드 · 허브 트래커(이전 값 남음·시행 상태) · 사례 블록 / 다시 끄면 0
// 만든 계정·기사·구조 해설·통계·스냅샷은 끝나면 지운다 (설정은 시작 상태로 되돌린다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w5-acceptance-e2e@example.test";
const SITE = "https://e2e.example.test";
const URL_BASE = "https://e2e-w5.example.test";
const KST_TODAY = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

let sb, server, staff, db, base;
const u = {};
const fx = { articles: [] };
let slug, caseArticle;

const show = (r) => JSON.stringify(r.body).slice(0, 700);
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (user, body) => api("POST", "/finance", user, body);
const setting = (key, value) => api("PATCH", `/settings/${key}`, u.admin, { value });
const flagFinance = async (on) => {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  return setting("feature_flags", { ...cur, finance: on });
};
const get = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
const board = async () => (await api("GET", "/finance", u.editor)).body;
const structureBody = (over = {}) => ({
  op: "structure",
  slug,
  structure_type: "trust",
  title: `시험용 구조 ${staff.run}`,
  summary: "시험용 한 줄 설명입니다",
  diagram: { alt: "시험용 구조도 대체 텍스트", nodes: [{ key: "a", label: "시험 주체 가" }, { key: "b", label: "시험 주체 나" }, { key: "c", label: "시험 주체 다" }], edges: [{ from: "a", to: "b", label: "시험 관계 하나" }, { from: "b", to: "c", label: "시험 관계 둘" }] },
  notes: ["시험용 설명 문단입니다"],
  lens_omit_reason: "시험용 생략 사유",
  ...over,
});
const sourceFields = (tag) => ({ provider: "시험 기관", source_url: `${URL_BASE}/${tag}`, snapshot_payload: `시험용 원문 글자 ${tag} ${staff.run}` });

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.finance_structure_versions where structure_id in (select id from public.finance_structures where slug like 'e2e-w5-%')");
    await db.query("delete from public.finance_structures where slug like 'e2e-w5-%'");
    await db.query("delete from public.finance_indicators where indicator_key like 'e2e_w5_%'");
    await db.query("delete from public.finance_regulations where reg_key like 'e2e_w5_%'");
    await db.query("delete from public.raw_snapshots where url like $1", [`${URL_BASE}/%`]);
    await db.query("delete from public.finance_cases where article_id = any($1::bigint[])", [fx.articles]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [fx.articles]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
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
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await purge();
  await staff.snapshotOperations();
  u.editor = await staff.createUser({ label: "w5-editor", roles: ["editor"], person: { name: "개발금융 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w5-reporter", roles: ["reporter"], person: { name: "개발금융 시험 기자", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "w5-reviewer", roles: ["reviewer"], person: { name: "개발금융 시험 감수위원", roles: ["reviewer"] } });
  u.admin = await staff.createUser({ label: "w5-admin", email: ADMIN_EMAIL });
  slug = `e2e-w5-${staff.run}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
  // 시험 시작 상태 - 키 꺼짐 · 법률 검토 기록 없음 · 차단 도메인 없음
  await db.query("update public.settings set value = value || '{\"finance\": false}'::jsonb where key = 'feature_flags'");
  await db.query("update public.settings set value = '{}'::jsonb where key = 'finance_legal_review'");
  await db.query("update public.settings set value = '[]'::jsonb where key = 'finance_blocked_domains'");
});

after(async () => {
  try {
    await purge();
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

test("a) 권한 - 기자 403 · 감수위원 입력 403 · 편집 책임자 입력 · 법률 검토 기록은 관리자만", async () => {
  assert.equal((await post(u.reporter, structureBody())).status, 403);
  assert.equal((await post(u.reviewer, structureBody())).status, 403, "감수위원은 서명만");
  assert.equal((await api("GET", "/finance", u.reporter)).status, 403);
  assert.equal((await api("GET", "/finance", u.reviewer)).status, 200, "감수위원은 서명하려고 읽는다");
  assert.equal((await post(u.editor, { op: "legal_review", reviewer: "시험 법률 검토자", reviewed_on: "2026-10-01", conclusion: "approved" })).status, 403, "편집 책임자는 법률 검토 기록 못 남김");
  assert.equal((await post(u.editor, { op: "nope" })).status, 422);
  const created = await post(u.editor, structureBody());
  assert.equal(created.status, 201, show(created));
  assert.equal(created.body.structure.review_status, "draft");
});

test("b) 구조 해설 - 법률 확인 없이 서명 422 · 편집 책임자 서명 403 · 초안이 바뀌면 409 · 서명 뒤 승인본 · 고치면 재감수 필요", async () => {
  let st = (await board()).structures.find((s) => s.slug === slug);
  const noLegal = await post(u.reviewer, { op: "sign", slug, updated_at: st.updated_at });
  assert.equal(noLegal.status, 422, show(noLegal));
  assert.match(JSON.stringify(noLegal.body), /법률 확인/);
  assert.equal((await post(u.editor, { op: "legal_check", slug, checked_by: "시험 법률 검토자" })).status, 200);
  st = (await board()).structures.find((s) => s.slug === slug);
  assert.equal((await post(u.editor, { op: "sign", slug, updated_at: st.updated_at })).status, 403, "편집 책임자는 서명 못 함");
  const stale = await post(u.reviewer, { op: "sign", slug, updated_at: "2020-01-01T00:00:00Z" });
  assert.equal(stale.status, 409, show(stale));
  const signed = await post(u.reviewer, { op: "sign", slug, updated_at: st.updated_at });
  assert.equal(signed.status, 201, show(signed));
  assert.equal(signed.body.structure.review_status, "approved");
  assert.equal(signed.body.structure.approved_version, 1);

  const edited = await post(u.editor, structureBody({ title: `시험용 구조 고침 ${staff.run}` }));
  assert.equal(edited.status, 200, show(edited));
  assert.equal(edited.body.structure.review_status, "rereview_needed");
  assert.equal(edited.body.structure.legal_checked_by, null, "고치면 법률 확인이 지워진다");
  // 다시 법률 확인 + 서명 → 승인본 2
  await post(u.editor, { op: "legal_check", slug, checked_by: "시험 법률 검토자" });
  st = (await board()).structures.find((s) => s.slug === slug);
  const again = await post(u.reviewer, { op: "sign", slug, updated_at: st.updated_at });
  assert.equal(again.body.structure.approved_version, 2, show(again));
});

test("c) 투자 권유 문구·차단 도메인·추적 쿼리·원자료 없는 통계 반려", async () => {
  const promo = await post(u.editor, structureBody({ slug: `${slug}-p`, summary: "이 상품은 수익률 순위 상위입니다" }));
  assert.equal(promo.status, 422, show(promo));
  assert.match(JSON.stringify(promo.body), /금지 표현/);
  assert.equal((await db.query("select 1 from public.finance_structures where slug = $1", [`${slug}-p`])).rowCount, 0, "저장되지 않는다");
  const noRel = await post(u.editor, structureBody({ slug: `${slug}-n`, diagram: { alt: "x", nodes: [{ key: "a", label: "가" }, { key: "b", label: "나" }], edges: [] } }));
  assert.equal(noRel.status, 422, "관계(표)가 없으면 저장 불가");

  const ind = { op: "indicator", indicator_key: `e2e_w5_idx`, label: "시험 지표", definition: "시험 정의", value: 1.5, unit: "단위", as_of: "2026-09-30", collected_on: "2026-10-01", ...sourceFields("idx1") };
  assert.equal((await post(u.editor, { ...ind, snapshot_payload: undefined })).status, 422, "스냅샷 없음");
  assert.equal((await post(u.editor, { ...ind, provider: "" })).status, 422, "제공기관 없음");
  assert.equal((await setting("finance_blocked_domains", ["shop.example.test"])).status, 200);
  const blocked = await post(u.editor, { ...ind, source_url: "https://m.shop.example.test/x" });
  assert.equal(blocked.status, 422, show(blocked));
  assert.match(JSON.stringify(blocked.body), /막아 둔 도메인/);
  const tracked = await post(u.editor, { ...ind, source_url: `${URL_BASE}/idx?utm_source=ad` });
  assert.equal(tracked.status, 422, show(tracked));
  assert.match(JSON.stringify(tracked.body), /추적 쿼리/);
  assert.equal((await setting("finance_blocked_domains", [])).status, 200);
  assert.equal((await db.query("select 1 from public.finance_indicators where indicator_key = 'e2e_w5_idx'")).rowCount, 0);
});

test("d) 사례 - 실명 기업 사례는 반론 기록 없이 발행 거부 → 기록하면 발행, 반론 메모는 공개 화면에 없다", async () => {
  const cat = (await db.query("select id from public.categories where section = 'finance' and slug = 'cases'")).rows[0].id;
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, category_id, body)
     values ($1, $2, '시험용 가짜 사례', 'finance', 'reported_news', 'draft', $3, $4) returning id, slug`,
    [`e2e-w5-case-${staff.run}`.toLowerCase(), `시험용 개발금융 사례 ${staff.run}`, cat, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 가짜 사례 본문입니다." }], claims: [] })],
  );
  caseArticle = { id: Number(rows[0].id), slug: rows[0].slug, title: `시험용 개발금융 사례 ${staff.run}` };
  fx.articles.push(caseArticle.id);
  staff.trackArticle(caseArticle.id);
  const tryPublish = async () => {
    await db.query("savepoint p");
    try {
      await db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [caseArticle.id]);
      await db.query("release savepoint p");
      return null;
    } catch (err) {
      await db.query("rollback to savepoint p");
      return err.message;
    }
  };
  await db.query("begin");
  try {
    // 사례 기록 없는 사례 하위 분야 기사는 발행 거부
    assert.match(await tryPublish(), /금융 사례 기록/);
    const rec = await post(u.editor, { op: "case", article_id: caseArticle.id, structure_type: "trust", issues: ["시험 쟁점"], outcome: "시험용 결과", named_company: true, rebuttal_note: "내부 메모 시험" });
    assert.equal(rec.status, 201, show(rec));
    // 실명인데 반론 기록 없음 → 거부
    assert.match(await tryPublish(), /반론 요청일/);
    // 반론 기록을 채워도 공개 자료 근거가 없으면 거부
    const withRebuttal = await post(u.editor, { op: "case", article_id: caseArticle.id, structure_type: "trust", issues: ["시험 쟁점"], outcome: "시험용 결과", named_company: true, rebuttal_requested_at: "2026-09-01", rebuttal_method: "email", rebuttal_status: "no_response", rebuttal_note: "내부 메모 시험" });
    assert.equal(withRebuttal.status, 200, show(withRebuttal));
    assert.match(await tryPublish(), /공개 자료 근거/);
    await db.query("insert into public.article_evidence (article_id, evidence_type, location) values ($1, 'document', '시험용 보관함')", [caseArticle.id]);
    assert.equal(await tryPublish(), null, "반론 기록 + 근거가 갖춰지면 발행");
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
  // 무응답은 대기 기간 전이면 입력 자체가 거부된다
  const early = await post(u.editor, { op: "case", article_id: caseArticle.id, structure_type: "trust", named_company: true, rebuttal_requested_at: new Date(Date.now() - 86400000).toISOString(), rebuttal_method: "phone", rebuttal_status: "no_response" });
  assert.equal(early.status, 422, show(early));
  assert.match(JSON.stringify(early.body), /일이 지나야/);
});

test("e) 켜기 조건 - 법률 검토 기록 없이 켜기 422 → 관리자가 기록하면 켜진다", async () => {
  const off = await flagFinance(true);
  assert.equal(off.status, 422, show(off));
  assert.match(JSON.stringify(off.body), /법률 검토/);
  const rejected = await post(u.admin, { op: "legal_review", reviewer: "시험 법률 검토자", reviewed_on: "2026-10-01", conclusion: "rejected" });
  assert.equal(rejected.status, 200, show(rejected));
  assert.equal((await flagFinance(true)).status, 422, "반려 기록으로는 못 켠다");
  const ok = await post(u.admin, { op: "legal_review", reviewer: "시험 법률 검토자", reviewed_on: "2026-10-01", conclusion: "approved" });
  assert.equal(ok.status, 200, show(ok));
});

test("f) 공개 화면 - 키 꺼짐 0 / 켜짐 구조 해설·트래커·사례 블록 / 다시 끄면 0", async () => {
  // 통계(두 번)·규제(시행 중 1·예정 1) 입력
  const base1 = { op: "indicator", indicator_key: "e2e_w5_idx", label: "시험 지표", definition: "시험 정의 분모와 기간", value: 1.5, unit: "단위", as_of: "2026-06-30", collected_on: "2026-07-01", ...sourceFields("idx-1") };
  assert.equal((await post(u.editor, base1)).status, 201);
  assert.equal((await post(u.editor, { ...base1, value: 2.5, as_of: "2026-09-30", collected_on: "2026-10-01", ...sourceFields("idx-2") })).status, 201, "새 값은 새 행");
  assert.equal((await db.query("select 1 from public.finance_indicators where indicator_key = 'e2e_w5_idx'")).rowCount, 2, "이전 값이 남는다");
  assert.equal((await post(u.editor, { op: "regulation", reg_key: "e2e_w5_reg_a", title: "시험 규제 가", stage: "시행", effective_on: KST_TODAY(), ...sourceFields("reg-a") })).status, 201);
  assert.equal((await post(u.editor, { op: "regulation", reg_key: "e2e_w5_reg_b", title: "시험 규제 나", stage: "입법예고", effective_on: "2099-01-01", ...sourceFields("reg-b") })).status, 201);

  // 키 꺼짐 - 모두 0
  const hubOff = await get("/finance");
  assert.equal(hubOff.status, 200);
  assert.ok(!hubOff.html.includes('data-finance-part="tracker"'), "트래커 블록 0");
  assert.ok(!hubOff.html.includes("시험 규제 가"), "규제 행 0");
  assert.equal((await get(`/finance/trust-pf/${slug}`)).status, 404, "구조 해설 상세 404");
  const listOff = await get("/finance/trust-pf");
  assert.equal(listOff.status, 200, "기존 하위 분야 목록은 그대로");
  assert.ok(!listOff.html.includes(`/finance/trust-pf/${slug}`), "구조 해설 링크 0");
  assert.ok(!(await get(`/news/${caseArticle.slug}`)).html.includes('data-part="finance-case"'), "사례 블록 0");

  // 키 켜짐
  assert.equal((await flagFinance(true)).status, 200);
  const detail = await get(`/finance/trust-pf/${slug}`);
  assert.equal(detail.status, 200);
  assert.match(detail.html, /<svg[^>]*role="img"[^>]*aria-label="시험용 구조도 대체 텍스트"/);
  const tableRows = (detail.html.match(/<table[^>]*data-part="relation-table"[\s\S]*?<\/table>/)?.[0].match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr/g) ?? []).length;
  assert.equal(tableRows, 2, "표 행 수 = 구조도 관계 수");
  assert.ok(detail.html.includes("시험 관계 하나") && detail.html.includes("시험 주체 다"));
  assert.match(detail.html.replace(/<!-- -->/g, ""), /세무 감수 \d{4}-\d{2}-\d{2} · 법률 확인 \d{4}-\d{2}-\d{2}/);
  assert.ok(!/가입하기|수익률 순위|추천 상품/.test(detail.html), "투자 권유 요소 0");
  assert.ok(!detail.html.includes("<img"), "구조도는 그림 파일이 아니다");

  const listOn = await get("/finance/trust-pf");
  assert.ok(listOn.html.includes(`href="/finance/trust-pf/${slug}"`), "목록 카드 링크");

  const hubOn = await get("/finance");
  assert.match(hubOn.html, /data-finance-part="tracker"/);
  assert.equal((hubOn.html.match(/data-indicator-key="e2e_w5_idx"/g) ?? []).length, 2, "최신 값 + 이전 값");
  assert.match(hubOn.html, /data-indicator-key="e2e_w5_idx" data-latest="true"[\s\S]*?2\.5/);
  assert.match(hubOn.html, /data-reg-key="e2e_w5_reg_a" data-in-force="true"/, "시행일 당일 00:00(KST)부터 시행");
  assert.match(hubOn.html, /data-reg-key="e2e_w5_reg_b" data-in-force="false"/);
  assert.ok(hubOn.html.includes(`${URL_BASE}/reg-a`) && hubOn.html.includes(`${URL_BASE}/idx-2`), "원문 링크");
  assert.ok(hubOn.html.includes("기준일") && hubOn.html.includes("2026-09-30"));

  const art = await get(`/news/${caseArticle.slug}`);
  assert.equal(art.status, 200);
  assert.match(art.html, /data-part="finance-case"/);
  assert.ok(art.html.includes("시험 쟁점") && art.html.includes("시험용 결과"));
  assert.ok(!art.html.includes("내부 메모 시험"), "반론 메모는 공개 화면에 없다");

  // 다시 끄면 0
  assert.equal((await flagFinance(false)).status, 200);
  assert.equal((await get(`/finance/trust-pf/${slug}`)).status, 404);
  const hubBack = await get("/finance");
  assert.ok(!hubBack.html.includes('data-finance-part="tracker"'));
  assert.ok(!(await get("/finance/trust-pf")).html.includes(`/finance/trust-pf/${slug}`));
  assert.ok(!(await get(`/news/${caseArticle.slug}`)).html.includes('data-part="finance-case"'));
});

test("g) 관리 화면 - 메뉴에 개발금융, 화면이 열린다", async () => {
  const board2 = await api("GET", "/finance", u.editor);
  assert.equal(board2.status, 200);
  assert.ok(board2.body.structures.some((s) => s.slug === slug));
  assert.equal(board2.body.featureOn, false);
});
