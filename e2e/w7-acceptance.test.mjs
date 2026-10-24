// W7 4~5단계 수용 E2E (docs/dev/W7_설계.md 1장 4·5단계 - PRD-01A OPT-07·09·10, NAV-16~20, PRD_최종 §11.1 W7 "구조화 데이터 오류 0, 게이트 동작").
// standalone 빌드를 로컬 Supabase에 붙인다. 기사·규정·질문·표본은 전부 시험용 가짜다. 끝나면 지운다(마감 행·활성 질문 목록은 트리거를 끈 거래로).
//  a) 권한 - 기자 403(검색 최적화 화면 API·제휴 기록 API) / 편집 책임자 200
//  b) 신선도(OPT-07) - 개정 `공포` 기록 → 그 개정을 단 공개 기사 n건에 큐 n건(법령 기준일 없는 기사 0) + 기사 화면 '검토 중' / 변경 없음 처리 → 표시 사라짐·실질 수정일 그대로 / 이미 처리 409 / 사유 없음 422
//  c) 핵심 질문·표본(OPT-09) - 49·51문항 422, 50문항 저장·활성화 / 표본 50×엔진 칸 / 인용됨은 주소 필수 / 인용률 분모=확인한 칸·미확인은 인용 0 아님 / 두 번 만들어도 행 불변
//  d) 최초 발행일 변경 시도(OPT-10) - API 422 + 감사 로그, DB 직접 변경도 거부
//  e) 화면 - /admin/seo (색인 관문 닫힘 사유·신선도·AI 표본) · /admin/news-readiness 머리 '목표 접수 미정'·'요건 미확정'
//  f) 월 마감(NAV-17) - 작업 실행 → 12개월 행, 다시 실행해도 행 불변, 월 송출량 = 넣은 자료, 3개월 조합 220개, 0 지표 경고 알림 1건씩(중복 0), 재계산은 새 version
//  g) 규정 판단 값·부정평가(NAV-18·20) - 형식 틀리면 422, 확정 전 저장 / 확정 뒤 422 / 확정 규정 버전의 유사도 기준이 발행 판정에 '규정' 기준으로 / 부정평가 누적(창 안 기록만) → 기준 도달 알림 1건
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w7-acceptance-e2e@example.test";
const SITE = "https://e2e-w7.example.test";
const SECRET = "w7-acceptance-e2e-cron-secret";

let sb, server, staff, db, base, browser;
const u = {};
const art = {};
const created = { questionVersions: [], requirementIds: [], alertMonths: [] };
let startedAt;

const show = (r) => JSON.stringify(r.body).slice(0, 700);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const seo = (op, body, user = u.editor) => api("POST", "/seo", user, { op, ...body });
const records = (op, body, user = u.editor) => api("POST", "/news-readiness/records", user, { op, ...body });
const job = (name) => fetch(`${base}/api/jobs/${name}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "x-job-trigger": "scheduler" } });
const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const auditCount = (action) => one("select count(*)::int n from public.audit_logs where action = $1 and at >= $2", [action, startedAt]).then((r) => r.n);

/** 한국 날짜 기준 직전 완결 달 'YYYY-MM' */
function lastClosedMonth() {
  const kst = new Date(Date.now() + 9 * 3600_000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

async function insertArticle(key, over = {}) {
  const row = {
    slug: `w7acc-${key}-${staff.run}`,
    title: `시험용 W7 기사 ${key}`,
    section: "tax",
    content_type: "reported_news",
    first_published_at: hoursAgo(1),
    amendment_id: null,
    legal_basis_date: null,
    ...over,
  };
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const cat = (await db.query("select id from public.categories where section = 'tax' order by id limit 1")).rows[0];
    const r = (
      await db.query(
        `insert into public.articles (slug, title, summary, section, content_type, status, category_id, author_id, first_published_at, tax_review_status, amendment_id, legal_basis_date, body)
         values ($1, $2, '시험용 요약', $3, $4, 'published', $5, $6, $7, 'approved', $8, $9, '{"blocks":[{"type":"paragraph","text":"시험용 본문 문단입니다."}],"claims":[]}'::jsonb) returning id`,
        [row.slug, row.title, row.section, row.content_type, cat.id, art.personId, row.first_published_at, row.amendment_id, row.legal_basis_date],
      )
    ).rows[0];
    await db.query("commit");
    staff.trackArticle(Number(r.id));
    return { ...row, id: Number(r.id) };
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  startedAt = new Date().toISOString();
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w7acc-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w7acc-editor", roles: ["editor"], person: { name: "시험용 편집 책임자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w7acc-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  const person = (await db.query("insert into public.people (name, slug, roles, visibility, employment) values ('시험용 필자', $1, '{reporter}', 'hidden', 'staff') returning id", [`w7acc-rep-${staff.run}`])).rows[0];
  staff.personIds.add(Number(person.id));
  art.personId = Number(person.id);
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: SECRET,
  });
  base = server.base;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.stop();
  if (db) {
    // 마감 행·활성 질문 목록·확정 규정 버전은 트리거가 지우기를 막는다 - 시험이 만든 것만 트리거를 끈 거래로 지운다
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      await db.query("delete from public.partner_readiness_alerts where created_at >= $1", [startedAt]);
      await db.query("delete from public.partner_readiness_monthly where computed_at >= $1", [startedAt]);
      await db.query("delete from public.ai_citation_samples where question_set_version = any($1::int[])", [created.questionVersions]);
      await db.query("delete from public.ai_core_questions where version = any($1::int[])", [created.questionVersions]);
      await db.query("delete from public.ai_question_sets where version = any($1::int[])", [created.questionVersions]);
      await db.query("delete from public.news_partner_checks where kind = 'penalty_risk' and checked_at >= $1", [startedAt]);
      await db.query("delete from public.news_partner_requirement_rules where requirement_id = any($1::bigint[])", [created.requirementIds]);
      await db.query("delete from public.news_partner_requirements where id = any($1::bigint[])", [created.requirementIds]);
      await db.query("delete from public.freshness_review_queue where created_at >= $1", [startedAt]);
      await db.query("delete from public.amendment_events where recorded_by = 'user:w7acc'");
      await db.query("delete from public.amendments where slug like $1", [`w7acc-%`]);
      await db.query("delete from public.raw_snapshots where url = 'https://www.mois.go.kr/w7acc'");
      await db.query("commit");
    } catch (err) {
      await db.query("rollback");
      console.error("정리 실패:", err.message);
    }
  }
  await staff?.cleanup();
});

test("a) 권한 - 기자는 검색 최적화·제휴 기록 화면 API 403, 편집 책임자는 200", async () => {
  assert.equal((await api("GET", "/seo", u.reporter)).status, 403);
  assert.equal((await seo("freshness_resolve", { id: 1, resolution: "no_change", note: "x" }, u.reporter)).status, 403);
  assert.equal((await records("alert_ack", { id: 1 }, u.reporter)).status, 403);
  assert.equal((await api("GET", "/seo", u.editor)).status, 200);
  assert.equal((await api("GET", "/news-readiness/records", u.editor)).status, 200);
  assert.equal((await api("GET", "/seo", u.admin)).status, 200);
  assert.equal((await fetch(`${base}/api/admin/seo`)).status, 401, "로그인 없이는 거부");
});

test("b) 신선도 - 공포 기록 → 법령 기준일 있는 공개 기사에만 큐 + '검토 중', 변경 없음 처리 → 표시 사라지고 실질 수정일 그대로", async () => {
  const am = (await one("insert into public.amendments (slug, title) values ($1, '시험용 개정') returning id", [`w7acc-am-${staff.run}`])).id;
  art.f1 = await insertArticle("f1", { amendment_id: am, legal_basis_date: "2026-08-01" });
  art.f2 = await insertArticle("f2", { amendment_id: am, legal_basis_date: "2026-08-02" });
  art.f3 = await insertArticle("f3", { amendment_id: am });
  const snap = (await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('mois', 'https://www.mois.go.kr/w7acc', 'h', '원문') returning id")).id;
  const ev = (
    await one(
      "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, 'promulgated', '2026-08-01', 'https://www.mois.go.kr/a.do', $2, 'user:w7acc') returning id",
      [am, snap],
    )
  ).id;
  // 공개 데이터 캐시를 비운다 - 기능 키를 같은 값으로 저장하면 만료된다
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.equal((await api("PATCH", "/settings/feature_flags", u.admin, { value: flags })).status, 200);

  const board = await api("GET", "/seo", u.editor);
  const open = board.body.freshness.open.filter((i) => [art.f1.id, art.f2.id, art.f3.id].includes(i.article?.id));
  assert.deepEqual(open.map((i) => i.article.id).sort(), [art.f1.id, art.f2.id].sort(), show(board));
  assert.ok(open.every((i) => i.eventStage === "promulgated"));
  const page = async (a) => (await fetch(`${base}/news/${a.slug}`)).text();
  assert.match(await page(art.f1), /data-part="freshness-review"/);
  assert.doesNotMatch(await page(art.f3), /data-part="freshness-review"/, "법령 기준일 없는 기사는 표시 0");

  const before = await one("select substantive_updated_at, first_published_at from public.articles where id = $1", [art.f1.id]);
  const item = open.find((i) => i.article.id === art.f1.id);
  assert.equal((await seo("freshness_resolve", { id: item.id, resolution: "no_change", note: " " })).status, 422, "사유 없음");
  assert.equal((await seo("freshness_resolve", { id: item.id, resolution: "typo", note: "x" })).status, 422, "결과 3종 밖");
  const done = await seo("freshness_resolve", { id: item.id, resolution: "no_change", note: "개정 내용과 무관함을 확인" });
  assert.equal(done.status, 200, show(done));
  assert.equal((await seo("freshness_resolve", { id: item.id, resolution: "no_change", note: "또" })).status, 409, "이미 처리");
  const after = await one("select substantive_updated_at, first_published_at from public.articles where id = $1", [art.f1.id]);
  assert.deepEqual(after, before, "변경 없음 처리는 실질 수정일·최초 발행일을 바꾸지 않는다");
  assert.equal(await auditCount("freshness.resolve"), 1);
  assert.doesNotMatch(await page(art.f1), /data-part="freshness-review"/, "처리하면 표시 사라짐");
  assert.match(await page(art.f2), /data-part="freshness-review"/, "처리하지 않은 기사는 그대로");
  void ev;
});

test("c) 핵심 질문 50개와 AI 표본 - 49·51문항 422, 50문항 저장·활성화, 50×엔진 칸, 인용률 분모=확인한 칸, 두 번 만들어도 행 불변", async () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `시험용 핵심 질문 ${i + 1}`).join("\n");
  assert.equal((await seo("questions_save", { text: lines(49) })).status, 422);
  assert.equal((await seo("questions_save", { text: lines(51) })).status, 422);
  const saved = await seo("questions_save", { text: lines(50), activate: true });
  assert.equal(saved.status, 201, show(saved));
  const version = saved.body.version;
  created.questionVersions.push(version);
  const month = "2026-09";
  assert.equal((await seo("samples_init", { month: "2026-09-15", version, engines: "엔진A" })).status, 422, "달 모양");
  const init = await seo("samples_init", { month, version, engines: "시험엔진A, 시험엔진B" });
  assert.equal(init.status, 201, show(init));
  assert.equal(init.body.created, 100, "50문항 × 엔진 2개");
  assert.equal((await seo("samples_init", { month, version, engines: "시험엔진A, 시험엔진B" })).body.created, 0, "두 번 만들어도 행 불변");

  const rows = (await api("GET", `/seo?month=${month}`, u.editor)).body.ai.samples;
  assert.equal(rows.length, 100);
  assert.ok(rows.every((r) => r.cited === "unknown"));
  const [r1, r2] = rows;
  assert.equal((await seo("sample_set", { id: r1.id, cited: "yes" })).status, 422, "인용됨은 주소 필수");
  assert.equal((await seo("sample_set", { id: r1.id, cited: "yes", cited_url: "javascript:alert(1)" })).status, 422);
  assert.equal((await seo("sample_set", { id: r1.id, cited: "yes", cited_url: "https://answers.example.test/a" })).status, 200);
  assert.equal((await seo("sample_set", { id: r2.id, cited: "no" })).status, 200);
  const tally = (await api("GET", `/seo?month=${month}`, u.editor)).body.ai.tally;
  assert.deepEqual({ yes: tally.yes, no: tally.no, unknown: tally.unknown, checked: tally.checked, total: tally.total, rate: tally.rate }, { yes: 1, no: 1, unknown: 98, checked: 2, total: 100, rate: 0.5 });
  const row = await one("select checker_id, checked_at from public.ai_citation_samples where id = $1", [r1.id]);
  assert.match(row.checker_id, /^user:/);
  assert.ok(row.checked_at);
  assert.equal((await seo("sample_set", { id: r1.id, cited: "unknown" })).status, 200, "미확인으로 되돌리기");
  assert.equal((await one("select checker_id from public.ai_citation_samples where id = $1", [r1.id])).checker_id, null);
  // 활성화된 목록은 고칠 수 없다
  const edit = await db.query("update public.ai_core_questions set text = '바꿈' where version = $1 and question_no = 1", [version]).then(() => "ok", (e) => e.message);
  assert.match(edit, /활성화된 핵심 질문/);
});

test("d) 최초 발행일 변경 시도 - API 422 + 감사 로그 1건, DB 직접 변경도 거부", async () => {
  const before = await one("select first_published_at from public.articles where id = $1", [art.f2.id]);
  const res = await api("PATCH", `/articles/${art.f2.id}`, u.editor, { first_published_at: "2020-01-01T00:00:00Z" });
  assert.equal(res.status, 422, show(res));
  assert.equal(await auditCount("article.first_published_at.denied"), 1);
  assert.deepEqual(await one("select first_published_at from public.articles where id = $1", [art.f2.id]), before);
  const direct = await db.query("update public.articles set first_published_at = '2020-01-01T00:00:00Z' where id = $1", [art.f2.id]).then(() => "ok", (e) => e.message);
  assert.match(direct, /최초 발행일/);
});

test("e) 화면 - /admin/seo(색인 관문 닫힘·신선도·AI 표본)와 /admin/news-readiness 머리 '목표 접수 미정'·'요건 미확정'", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(`${base}/admin/login`);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^로그인$/.test(b.textContent.trim()) && !b.disabled));
    await page.fill("#login-email", u.editor.email);
    await page.fill("#login-password", u.editor.password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL((url) => url.pathname !== "/admin/login");
    await page.goto(`${base}/admin/seo`);
    await page.getByText("색인 전환 점검").first().waitFor();
    assert.match(await page.getByTestId("gate-state").innerText(), /닫혀/);
    assert.match(await page.getByTestId("gate-problems").innerText(), /SITE_INDEXING/);
    assert.ok((await page.locator("[data-freshness-id]").count()) >= 1, "신선도 검수 항목");
    assert.match(await page.getByTestId("citation-tally").innerText(), /인용률/);
    const body = await page.locator("main").innerText();
    for (const banned of ["상위 노출", "노출 예측"]) assert.ok(!body.includes(banned), banned);
    await page.goto(`${base}/admin/news-readiness`);
    await page.getByTestId("next-intake").waitFor();
    assert.equal((await page.getByTestId("next-intake").innerText()).trim(), "목표 접수 미정");
    assert.match(await page.locator("#readiness-monthly").innerText(), /요건 미확정/);
    const text = await page.locator("main").innerText();
    for (const banned of ["선정 예정", "제휴 확정", "예상 점수"]) assert.ok(!text.includes(banned), banned);
  } finally {
    await context.close();
  }
});

test("f) 월 마감 - 12개월 행·두 번 실행해도 행 불변·월 송출량 = 넣은 자료·조합 220개·0 지표 경고 알림 1건씩, 재계산은 새 version", async () => {
  const month = lastClosedMonth();
  const mid = `${month}-15T03:00:00Z`;
  await insertArticle("m1", { first_published_at: mid });
  await insertArticle("m2", { first_published_at: mid });
  await insertArticle("m3", { first_published_at: mid, content_type: "explainer" });
  const run1 = await job("readiness-monthly");
  assert.equal(run1.status, 200, await run1.clone().text());
  const rows = async () => (await db.query("select month::text, version, metrics from public.partner_readiness_monthly where platform = 'internal' and computed_at >= $1 order by month", [startedAt])).rows;
  const first = await rows();
  assert.equal(first.length, 12);
  const last = first.at(-1);
  assert.equal(last.month.slice(0, 7), month);
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const window = [`${month}-01T00:00:00+09:00`, `${next}-01T00:00:00+09:00`];
  const count = (extra) => one(`select count(*)::int n from public.articles where status = 'published' and origin <> 'legacy' and first_published_at >= $1 and first_published_at < $2 ${extra}`, window).then((r) => r.n);
  assert.ok((await count("")) >= 3);
  assert.equal(last.metrics.monthly_output.numerator, await count(""), "월 송출량 = 그 달 공개 기사 수");
  assert.equal(last.metrics.own_ratio.numerator, await count("and content_type = 'reported_news'"), "자체 생산 분자는 보도기사만");
  assert.equal(last.metrics.own_ratio.denominator, last.metrics.monthly_output.numerator);
  const alerts1 = (await db.query("select kind, key from public.partner_readiness_alerts where created_at >= $1 order by key", [startedAt])).rows;
  assert.ok(alerts1.some((a) => a.kind === "zero_metric" && a.key === "feature_output"), "기획·탐사 실적 0 경고");
  assert.equal(new Set(alerts1.map((a) => `${a.kind}|${a.key}`)).size, alerts1.length, "같은 사유 중복 0");

  assert.equal((await job("readiness-monthly")).status, 200);
  assert.equal((await rows()).length, 12, "다시 실행해도 행 불변");
  assert.equal((await db.query("select count(*)::int n from public.partner_readiness_alerts where created_at >= $1", [startedAt])).rows[0].n, alerts1.length, "알림도 불변");

  const board = (await api("GET", "/news-readiness/records", u.editor)).body;
  assert.equal(board.monthly.months.length, 12);
  assert.deepEqual({ kind: board.monthly.combos.kind, count: board.monthly.combos.count }, { kind: "ok", count: 220 });
  assert.equal(board.monthly.requirementUnconfirmed, true);
  assert.equal(board.monthly.intake, null);
  const open = board.monthly.alerts.find((a) => !a.acknowledged && a.kind === "zero_metric");
  assert.ok(open);
  assert.equal((await records("alert_ack", { id: open.id })).status, 200);
  assert.equal((await records("alert_ack", { id: open.id })).status, 409);

  const before = await one("select computed_at from public.partner_readiness_monthly where platform = 'internal' and month = $1 and version = 1", [`${month}-01`]);
  assert.equal((await records("monthly_recalc", { month, reason: " " })).status, 422, "사유 없음");
  assert.equal((await records("monthly_recalc", { month: "2099-01", reason: "x" })).status, 409, "마감된 적 없는 달");
  const recalc = await records("monthly_recalc", { month, reason: "시험용 재계산" });
  assert.equal(recalc.status, 201, show(recalc));
  const versions = (await db.query("select version from public.partner_readiness_monthly where platform = 'internal' and month = $1 order by version", [`${month}-01`])).rows.map((r) => r.version);
  assert.deepEqual(versions, [1, 2]);
  assert.deepEqual(await one("select computed_at from public.partner_readiness_monthly where platform = 'internal' and month = $1 and version = 1", [`${month}-01`]), before, "마감 행은 그대로");
  const direct = await db.query("update public.partner_readiness_monthly set metrics = '{}'::jsonb where platform = 'internal' and month = $1", [`${month}-01`]).then(() => "ok", (e) => e.message);
  assert.match(direct, /마감된 월 지표 행/);
});

test("g) 규정 판단 값·부정평가 - 형식 틀리면 422, 확정 전 저장·확정 뒤 422, 확정 규정의 유사도 기준이 발행 판정에 '규정'으로, 누적은 창 안 기록만·기준 도달 알림 1건", async () => {
  const req = (
    await one(
      `insert into public.news_partner_requirements (platform, title, created_by, media_type, source_url, checked_at, effective_from, review_period, requirements)
       values ('naver', '시험용 규정', 'user:w7acc', '시험용 유형', 'https://rules.example.test/w7', current_date, current_date - 1, '{"months": 3, "basis": "closed_months", "text": "시험용"}'::jsonb, '[{"key": "own_test", "label": "시험용 요건", "metric": "count", "numerator": {"contentTypes": ["reported_news"]}, "numeratorText": "시험용 분자 정의", "exclusionsText": "없음"}]'::jsonb)
       returning id, version`,
    )
  );
  created.requirementIds.push(Number(req.id));
  const sim = { sentence_similarity: 0.9, sentence_comparator: "gte", article_ratio: 0.6, article_comparator: "gt" };
  const pen = { window_months: 3, warn_points: 3, comparator: "gte" };
  assert.equal((await records("rules_save", { requirement_id: Number(req.id), similarity_rule: { ...sim, sentence_similarity: 2 } })).status, 422);
  assert.equal((await records("rules_save", { requirement_id: Number(req.id), penalty_rule: { ...pen, window_months: 0 } })).status, 422);
  const saved = await records("rules_save", { requirement_id: Number(req.id), similarity_rule: sim, penalty_rule: pen, contributor_rule: { merge_external: true } });
  assert.equal(saved.status, 201, show(saved));

  // 확정 - 담당자 확인은 API가 한다(원문 URL·확인일·등록 유형 등이 이미 찼다)
  const confirm = await api("POST", `/news-readiness/requirements/${req.id}/confirm`, u.editor, { attested: true });
  assert.equal(confirm.status, 200, show(confirm));
  const locked = await records("rules_save", { requirement_id: Number(req.id), contributor_rule: { merge_external: false } });
  assert.equal(locked.status, 422, "확정 뒤 판단 값 수정은 거부");

  // 확정된 규정 버전의 유사도 기준이 발행 판정에 쓰인다 (NAV-18)
  const check = await api("GET", `/articles/${art.f2.id}/check`, u.editor);
  assert.equal(check.status, 200, show(check));
  assert.equal(check.body.similarity.thresholdSource, "규정");
  assert.match(check.body.similarity.rulesVersion, /naver 규정 v\d+/);

  // 부정평가 누적 - 창(3개월) 안의 기록만
  const day = (offset) => new Date(Date.now() + 9 * 3600_000 - offset * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await records("penalty_add", { item: "시험용 사례 A", points: 2, occurred_on: day(1) })).status, 201);
  assert.equal((await records("penalty_add", { item: "시험용 사례 B", points: 1, occurred_on: day(2), evidence_ref: "시험용 문서 1쪽" })).status, 201);
  assert.equal((await records("penalty_add", { item: "시험용 오래된 사례", points: 10, occurred_on: day(400) })).status, 201);
  assert.equal((await records("penalty_add", { item: "시험용", points: 0, occurred_on: day(1) })).status, 422);
  const board = (await api("GET", "/news-readiness/records", u.editor)).body;
  assert.equal(board.monthly.requirementUnconfirmed, false);
  assert.equal(board.monthly.penalty.total, 3, "창 밖(400일 전) 기록은 누적에서 빠진다");
  assert.equal(board.monthly.penalty.reached, true);
  assert.equal(board.monthly.penalty.records.length, 3, "기록은 모두 남는다");

  assert.equal((await job("readiness-monthly")).status, 200);
  assert.equal((await job("readiness-monthly")).status, 200);
  const penalty = (await db.query("select key from public.partner_readiness_alerts where kind = 'penalty' and created_at >= $1", [startedAt])).rows;
  assert.deepEqual(penalty.map((r) => r.key), [`requirement:${req.id}`], "기준 도달 알림 1건 (두 번 실행해도 중복 0)");
  // 규정 확정 뒤 월 마감은 규정 버전과 함께 한 번 더 남긴다
  const official = await db.query("select requirement_version from public.partner_readiness_monthly where platform = 'naver' and requirement_id = $1", [req.id]);
  assert.equal(official.rowCount, 12);
  assert.equal(await auditCount("readiness.penalty.add"), 3);
});

test("시험 동안 예상 못 한 서버 오류가 없었다", () => {
  assert.doesNotMatch(server.log(), /\b(TypeError|ReferenceError|Unhandled|ECONNREFUSED)\b/);
});
