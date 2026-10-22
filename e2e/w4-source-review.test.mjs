// 원문 변경·시점 만료 검수 큐 E2E (W4 6단계 — docs/dev/W4_설계.md 1장 6단계 증거 · 2.1 · 2.2 · 12장 #23, PRD-01B REG1-13)
// standalone 빌드를 로컬 Supabase에 붙인다. 바깥 사이트는 부르지 않고 이 프로세스의 가짜 원문 서버(127.0.0.1)만 쓴다(설계 8장). 기관·주소·글자는 모두 시험용 가짜.
//  a) 원문 다시 받기 — 같은 원문(같은 해시) 0건 · 원문이 바뀌면 그 주소를 쓴 기사 3개마다 1건 + 기사 화면 공식 자료 카드에 '검토 중'(본문 블록 밖) ·
//     다른 주소 기사 0건·표시 0 · 같은 새 원문 다시 0 · 받지 못하면(404) 502 + 항목 0 · 공식 자료 아닌 출처 422 · 감사 source_review.refetch
//  b) 해결 — 편집 책임자 해결 → 그 기사 '검토 중' 사라짐(다른 기사는 그대로) + 감사 source_review.resolve 1건 · 기자·광고 담당 403 + 거부 감사 1건씩 · 이미 해결 409
//  c) 시점 만료 배치 — 확인일(한국 날짜) 364·365일째 0건, 366일째 1건(00:30 KST 확인도 한국 날짜) · 같은 실행 키(같은 날) 두 번 = 한 벌 ·
//     확인일 다시 적기(reverify)로 해결 → 표시 사라짐·카드 확인일 오늘 · 다시 돌려도 0 · 큐는 anon 0행
//  d) 운영 설정 official_source_expiry_days — 0·글자 422, 값 그대로
//  e) 관리 화면 /admin/source-review — 붙여 넣은 원문으로 다시 받기 → 새 항목 1건 안내 · 해결 버튼 → 목록에서 빠짐 · 기자는 메뉴 0·화면 403
// 만든 계정·기사·출처·스냅샷·검수 항목·실행 기록은 끝나면 지운다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import pg from "pg";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-source-review-e2e@example.test";
const SITE = "https://e2e.example.test";
const SECRET = "w4-source-review-e2e-cron-secret";
const V1 = "시험용 가상구 지방세 세수 결산 원문 — 처음 판. 이 글자는 공개 화면에 나오지 않아야 합니다.";
const V2 = "시험용 가상구 지방세 세수 결산 원문 — 발표기관이 고친 판.";
const DAY = 86_400_000;

let sb, server, staff, db, browser, base, fake, fakeBase;
const u = {};
const fx = {};
const counts0 = {};
const runIds = [];
const origin = { text: V1 };

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 1500);
const slugOf = (label) => `e2e-w4sr-${label}-${staff.run}`;
async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const review = (user, body) => api("POST", "/source-review", user, body);
async function runJob() {
  const res = await fetch(`${base}/api/jobs/source-expiry`, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "x-job-trigger": "scheduler" } });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  runIds.push(body.runId);
  return (await one("select detail from public.agent_runs where id = $1", [body.runId])).detail;
}
const queueFor = (sourceIds) =>
  db.query("select * from public.source_review_queue where target_type = 'article_source' and target_id = any($1::bigint[]) order by target_id, id", [sourceIds]).then((r) => r.rows);
const auditCount = (action, target) => one("select count(*)::int n from public.audit_logs where action = $1 and target = $2 and at >= $3", [action, target, staff.startedAt]).then((r) => r.n);
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.parse(`${kstToday()}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);

/** 공개 기사 한 건 (DB에 직접 — 발행 판정은 W4 5단계 E2E가 본다). 본문 = 기자의 해석 문단 */
async function publishedArticle(label) {
  const body = { blocks: [{ type: "paragraph", text: `${label} — 편집국이 결산 자료를 읽은 해석 문단입니다.` }], claims: [] };
  const row = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body, first_published_at)
     values ($1, $2, '원문 검수 시험', 'tax', 'reported_news', 'published', $3, $4, now() - interval '1 hour') returning id, slug`,
    [slugOf(label), `시험용 원문 검수 ${label} ${staff.run}`, u.reporter.personId, JSON.stringify(body)],
  );
  staff.trackArticle(Number(row.id));
  return { id: Number(row.id), href: `/news/${row.slug}` };
}
/** 공식 자료 출처 — 편집국 API(발행된 기사라 편집 책임자). 원본 스냅샷 = 붙여 넣은 원문 */
async function addSource(articleId, url, extra = {}) {
  const r = await api("POST", `/articles/${articleId}/sources`, u.editor, {
    kind: "dataset",
    title: "시험용 가상구 지방세 세수 결산(2026년 상반기)",
    url,
    sourceName: "시험용 가상구청 세무과",
    lastVerifiedAt: "2026-10-20T10:00:00+09:00",
    licenseStatus: "출처표시",
    licenseType: "kogl_1",
    sourceType: "local_tax_revenue",
    publishedOn: "2026-07-15",
    referenceDate: "2026-06-30",
    regionUnit: "시·군·구",
    collectedAt: "2026-10-19T09:00:00+09:00",
    ...extra,
  });
  assert.equal(r.status, 201, show(r));
  return Number(r.body.source.id);
}
/** 기사 화면의 공식 자료 카드 — 검토 중 표시 · 확인일 · 본문 블록 안인지 */
async function cardsOf(href) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await ctx.newPage();
    const res = await page.goto(`${base}${href}`, { waitUntil: "domcontentloaded" });
    assert.equal(res.status(), 200, href);
    const html = await page.content();
    assert.equal(html.includes(V1.slice(0, 20)) || html.includes(V2.slice(0, 20)), false, "원본 스냅샷 글자 0");
    return await page.$$eval('[data-part="official-source-card"]', (els) =>
      els.map((el) => ({
        id: Number(el.getAttribute("data-source-id")),
        mark: el.querySelector('[data-part="source-review-mark"]')?.textContent ?? null,
        verified: [...el.querySelectorAll('[data-part="official-source-dates"] div')].find((d) => d.querySelector("dt")?.textContent === "확인일")?.querySelector("dd")?.textContent ?? null,
        inBlocks: Boolean(el.closest('[data-part="blocks"]')),
      })),
    );
  } finally {
    await ctx.close();
  }
}
const markOf = async (href, sourceId) => (await cardsOf(href)).find((c) => c.id === sourceId)?.mark ?? null;

before(async () => {
  sb = localSupabase();
  fake = http.createServer((req, res) => {
    if (req.url.startsWith("/doc")) res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(origin.text);
    else res.writeHead(404).end("no");
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  fakeBase = `http://127.0.0.1:${fake.address().port}`;
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: SECRET,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  for (const t of ["source_review_queue", "raw_snapshots", "article_sources", "agent_runs"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  assert.equal((await one("select value from public.settings where key = 'official_source_expiry_days'")).value, 365, "시험 전 만료 기준 = 씨앗 365");

  u.admin = await staff.createUser({ label: "w4sr-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w4sr-reporter", roles: ["reporter"], person: { name: "시험용 원문 검수 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w4sr-editor", roles: ["editor"], person: { name: "시험용 원문 검수 편집자", roles: ["editor"] } });
  u.ad = await staff.createUser({ label: "w4sr-ad", roles: ["ad_ops"] });

  // 같은 원문 주소를 쓴 기사 3개 + 다른 주소 기사 1개
  fx.url = `${fakeBase}/doc/tax-revenue-2026h1`;
  fx.otherUrl = `${fakeBase}/doc/other-notice`;
  fx.arts = [];
  for (const label of ["a1", "a2", "a3"]) {
    const a = await publishedArticle(label);
    a.sourceId = await addSource(a.id, fx.url, { snapshot: { text: V1 } });
    fx.arts.push(a);
  }
  fx.other = await publishedArticle("other");
  fx.other.sourceId = await addSource(fx.other.id, fx.otherUrl, { snapshot: { text: V1 } });
  // 공식 자료가 아닌 출처 (보도자료)
  const press = await api("POST", `/articles/${fx.other.id}/sources`, u.editor, { kind: "press_release", title: "시험용 가상구 보도자료", url: fx.url, sourceName: "시험용 가상구청 대변인실", licenseType: "kogl_1" });
  assert.equal(press.status, 201, show(press));
  fx.pressId = Number(press.body.source.id);

  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    const ids = [...staff.articleIds];
    const snapIds = (await db.query("select distinct new_snapshot_id id from public.source_review_queue where article_id = any($1::bigint[]) and new_snapshot_id is not null", [ids])).rows.map((r) => r.id);
    await db.query("delete from public.source_review_queue where article_id = any($1::bigint[]) or opened_at >= $2", [ids, staff.startedAt]);
    if (runIds.length) await db.query("delete from public.agent_runs where id = any($1::bigint[])", [runIds]);
    // 다시 받기가 남긴 스냅샷(출처가 가리키지 않는 행) — 출처가 가리키는 스냅샷은 기사 정리(staff.cleanup)가 지운다
    await db.query(
      "delete from public.raw_snapshots r where (r.id = any($1::bigint[]) or r.url like $2) and not exists (select 1 from public.article_sources s where s.snapshot_id = r.id)",
      [snapIds, `${fakeBase}/%`],
    );
    await staff?.cleanup();
  } finally {
    server?.stop();
    fake?.closeAllConnections?.();
    fake?.close();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        assert.equal((await c.query("select value from public.settings where key = 'official_source_expiry_days'")).rows[0].value, 365, "만료 기준 그대로");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 원문 다시 받기 — 같은 해시 0 · 바뀌면 기사 3개마다 1건 + 카드에 '검토 중' · 다른 주소 0 · 같은 새 원문 0 · 404 → 502 · 공식 자료 아님 422 · 감사", async () => {
  const all = [...fx.arts.map((a) => a.sourceId), fx.other.sourceId, fx.pressId];
  // 1) 원문 그대로 → 0건 (출처 API가 만든 스냅샷 해시 = 서버가 받은 바이트 해시)
  let r = await review(u.editor, { op: "refetch", sourceId: `src:${fx.arts[0].sourceId}` });
  assert.equal(r.status, 200, show(r));
  assert.deepEqual([r.body.result.method, r.body.result.targets, r.body.result.opened, r.body.result.unchanged], ["fetched", 3, 0, 3], show(r));
  assert.deepEqual(await queueFor(all), [], "같은 해시 → 큐 0");
  for (const a of fx.arts) assert.equal(await markOf(a.href, a.sourceId), null, "표시 0");

  // 2) 발표기관이 원문을 고침 → 같은 주소를 쓴 기사 3개마다 1건 (기사 번호·옛/새 해시)
  origin.text = V2;
  r = await review(u.editor, { op: "refetch", sourceId: fx.arts[1].sourceId });
  assert.equal(r.status, 200, show(r));
  assert.deepEqual([r.body.result.opened, r.body.result.unchanged, r.body.result.alreadyQueued], [3, 0, 0], show(r));
  const q = await queueFor(all);
  assert.deepEqual(q.map((x) => [Number(x.target_id), Number(x.article_id), x.reason, x.status]), fx.arts.map((a) => [a.sourceId, a.id, "snapshot_changed", "open"]));
  const oldHash = (await one("select s.content_hash from public.article_sources a join public.raw_snapshots s on s.id = a.snapshot_id where a.id = $1", [fx.arts[0].sourceId])).content_hash;
  assert.ok(q.every((x) => x.old_hash === oldHash && x.new_hash === r.body.result.hash && x.new_hash !== oldHash));
  assert.equal(await auditCount("source_review.refetch", `article_sources:${fx.arts[1].sourceId}`), 1, "감사 source_review.refetch");
  // 출처 행의 스냅샷은 그대로 (원자료 덮어쓰기 0)
  assert.equal((await one("select s.content_hash from public.article_sources a join public.raw_snapshots s on s.id = a.snapshot_id where a.id = $1", [fx.arts[0].sourceId])).content_hash, oldHash);

  // 3) 기사 화면 — 그 출처 카드에 '검토 중'(원문 블록 쪽, 본문 블록 밖). 다른 주소 기사는 0
  for (const a of fx.arts) {
    const card = (await cardsOf(a.href)).find((c) => c.id === a.sourceId);
    assert.ok(card, `${a.href} 카드`);
    assert.match(card.mark ?? "", /^검토 중/, `${a.href} 검토 중`);
    assert.equal(card.inBlocks, false);
  }
  assert.equal(await markOf(fx.other.href, fx.other.sourceId), null, "다른 주소 기사 표시 0");

  // 4) 같은 새 원문 다시 → 0 (이미 검수 중)
  r = await review(u.editor, { op: "refetch", sourceId: fx.arts[2].sourceId });
  assert.deepEqual([r.status, r.body.result?.opened, r.body.result?.alreadyQueued], [200, 0, 3], show(r));
  assert.equal((await queueFor(all)).length, 3);

  // 5) 받지 못하면 502 + 항목 0 · 공식 자료 아님 422 · 없는 출처 404 · 번호 빔 422
  const missing = await publishedArticle("missing");
  const missingSrc = await addSource(missing.id, `${fakeBase}/nothing-here`);
  r = await review(u.editor, { op: "refetch", sourceId: missingSrc });
  assert.equal(r.status, 502, show(r));
  assert.match(r.body.error, /404 상태/);
  assert.deepEqual(await queueFor([missingSrc]), []);
  r = await review(u.editor, { op: "refetch", sourceId: fx.pressId });
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(r.body.errors.map((e) => e.split(":")[0]), ["sourceId"]);
  assert.equal((await review(u.editor, { op: "refetch", sourceId: 999999999 })).status, 404);
  assert.equal((await review(u.editor, { op: "refetch" })).status, 422);
  assert.equal((await review(u.editor, { op: "nope" })).status, 422);
  // 큐는 anon 0행 (REST)
  const anon = await fetch(`${sb.url}/rest/v1/source_review_queue?select=id`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
  const anonBody = await anon.json().catch(() => null);
  assert.ok(anon.status !== 200 || (Array.isArray(anonBody) && anonBody.length === 0), `anon 큐 읽기 ${anon.status}`);
  fx.snapshotQueue = q;
});

test("b) 해결 — 편집 책임자 해결 → 그 기사 표시 사라짐(다른 기사 그대로) + 감사 1건 · 기자·광고 담당 403 + 거부 감사 · 이미 해결 409", async () => {
  const q = fx.snapshotQueue;
  assert.ok(q?.length === 3, "a) 먼저");
  const [first, second] = q;
  const a1 = fx.arts.find((a) => a.sourceId === Number(first.target_id));
  const a2 = fx.arts.find((a) => a.sourceId === Number(second.target_id));

  // 편집 책임자가 아닌 사람 — 403 + 거부 감사 1건씩, 항목 그대로
  for (const user of [u.reporter, u.ad]) {
    const before = await one("select count(*)::int n from public.audit_logs where action = 'source_review.resolve.denied' and actor = $1", [`user:${user.id}`]);
    const r = await review(user, { op: "resolve", id: Number(first.id) });
    assert.equal(r.status, 403, show(r));
    const afterCount = await one("select count(*)::int n from public.audit_logs where action = 'source_review.resolve.denied' and actor = $1", [`user:${user.id}`]);
    assert.equal(afterCount.n, before.n + 1, "거부 감사 1건");
    assert.equal((await api("GET", "/source-review", user)).status, 403);
  }
  assert.equal((await one("select status from public.source_review_queue where id = $1", [first.id])).status, "open");
  // 원문 변경 항목에 확인일 다시 적기는 422 (출처를 새 버전으로 고친다)
  const wrong = await review(u.editor, { op: "resolve", id: Number(first.id), reverify: true });
  assert.equal(wrong.status, 422, show(wrong));

  // 편집 책임자 해결 → 그 기사 표시 0, 다른 기사는 그대로 · 감사 source_review.resolve 1건
  const ok = await review(u.editor, { op: "resolve", id: Number(first.id), note: "발표기관 정정 공고 확인 — 수치 변동 없음" });
  assert.equal(ok.status, 200, show(ok));
  assert.equal(ok.body.item.status, "resolved");
  assert.equal(ok.body.item.resolved_by, `user:${u.editor.id}`);
  assert.equal(await auditCount("source_review.resolve", `source_review_queue:${first.id}`), 1);
  assert.equal(await markOf(a1.href, a1.sourceId), null, "해결한 기사 표시 사라짐");
  assert.match((await markOf(a2.href, a2.sourceId)) ?? "", /^검토 중/, "다른 기사는 그대로");
  const listed = await api("GET", "/source-review", u.editor);
  assert.equal(listed.status, 200);
  assert.ok(!listed.body.open.some((x) => Number(x.id) === Number(first.id)));
  assert.ok(listed.body.resolved.some((x) => Number(x.id) === Number(first.id)));
  assert.equal(listed.body.expiryDays, 365);
  // 이미 해결 409 · 없는 항목 404 · 해결한 새 해시로 다시 받기 → 0 (검수한 변경으로는 다시 열지 않는다)
  assert.equal((await review(u.editor, { op: "resolve", id: Number(first.id) })).status, 409);
  assert.equal((await review(u.editor, { op: "resolve", id: 999999999 })).status, 404);
  const again = await review(u.editor, { op: "refetch", sourceId: a1.sourceId });
  assert.equal(again.body.result.opened, 0, show(again));
  assert.equal((await queueFor([a1.sourceId])).length, 1);
  // 관리자(역할 없음)도 해결한다 (편집 책임자·관리자 — W4 설계 6장)
  const byAdmin = await review(u.admin, { op: "resolve", id: Number(second.id) });
  assert.equal(byAdmin.status, 200, show(byAdmin));
  assert.equal(await markOf(a2.href, a2.sourceId), null);
});

test("c) 시점 만료 배치 — 364·365일째 0건, 366일째 1건(00:30 KST도 한국 날짜) · 같은 날 두 번 한 벌 · 확인일 다시 적기로 해결 → 표시 0·확인일 오늘 · 다시 돌려도 0", async () => {
  const e = await publishedArticle("expiry");
  const at = (n, time = "12:00:00") => `${daysAgo(n)}T${time}+09:00`;
  const src = {};
  src.d364 = await addSource(e.id, `${fakeBase}/exp/364`, { lastVerifiedAt: at(364) });
  src.d365 = await addSource(e.id, `${fakeBase}/exp/365`, { lastVerifiedAt: at(365) });
  src.d365early = await addSource(e.id, `${fakeBase}/exp/365-early`, { lastVerifiedAt: at(365, "00:30:00") });
  src.d366 = await addSource(e.id, `${fakeBase}/exp/366`, { lastVerifiedAt: at(366) });
  const ids = Object.values(src);

  const d1 = await runJob();
  assert.equal(d1.runKey, kstToday(), "실행 키 = 한국 날짜");
  assert.equal(d1.expiryDays, 365);
  let q = await queueFor(ids);
  assert.deepEqual(q.map((x) => Number(x.target_id)), [src.d366], "366일째만 1건");
  assert.equal(q[0].reason, "expired");
  assert.equal(q[0].run_key, kstToday());
  assert.equal(String(q[0].basis_on instanceof Date ? q[0].basis_on.toISOString().slice(0, 10) : q[0].basis_on).length > 0, true);
  assert.equal((await one("select basis_on::text d from public.source_review_queue where id = $1", [q[0].id])).d, daysAgo(366));

  // 같은 실행 키 두 번 = 한 벌
  const d2 = await runJob();
  assert.equal(d2.runKey, d1.runKey);
  assert.equal(d2.opened, 0, JSON.stringify(d2));
  assert.equal((await queueFor(ids)).length, 1, "중복 0");

  // 기사 화면 — 만료 출처에만 '검토 중'
  let cards = await cardsOf(e.href);
  assert.deepEqual(cards.filter((c) => c.mark).map((c) => c.id), [src.d366]);

  // 확인일 다시 적기로 해결 → 표시 0 · 카드 확인일 = 오늘 · 감사 1건 · 다시 돌려도 0
  const r = await review(u.editor, { op: "resolve", id: Number(q[0].id), reverify: true, note: "기관 사이트에서 원문 다시 확인" });
  assert.equal(r.status, 200, show(r));
  assert.ok(r.body.reverifiedAt);
  assert.equal(await auditCount("source_review.resolve", `source_review_queue:${q[0].id}`), 1);
  cards = await cardsOf(e.href);
  assert.deepEqual(cards.filter((c) => c.mark), [], "표시 0");
  assert.equal(cards.find((c) => c.id === src.d366)?.verified, kstToday(), "확인일 = 오늘");
  const d3 = await runJob();
  assert.equal(d3.opened, 0);
  q = await queueFor(ids);
  assert.deepEqual(q.map((x) => x.status), ["resolved"], "새 항목 0");
});

test("d) 운영 설정 official_source_expiry_days — 0·3651·글자 422, 값 그대로", async () => {
  for (const bad of [0, 3651, "365", 365.5]) {
    const r = await api("PATCH", "/settings/official_source_expiry_days", u.admin, { value: bad });
    assert.equal(r.status, 422, `${JSON.stringify(bad)}: ${show(r)}`);
  }
  assert.equal((await api("PATCH", "/settings/official_source_expiry_days", u.editor, { value: 30 })).status, 403, "편집 책임자는 운영 설정 0");
  assert.equal((await one("select value from public.settings where key = 'official_source_expiry_days'")).value, 365);
});

test("e) 관리 화면 — 붙여 넣은 원문으로 다시 받기 → 새 항목 1건 · 해결 버튼 → 목록에서 빠짐 · 기자는 메뉴 0·화면 403", async () => {
  const login = async (user) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/admin/login`);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그인" && !b.disabled));
    await page.fill("#login-email", user.email);
    await page.fill("#login-password", user.password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL((url) => url.pathname !== "/admin/login");
    return { ctx, page };
  };

  const { ctx, page } = await login(u.editor);
  try {
    assert.ok((await page.locator('nav[aria-label="편집국 메뉴"] a').allInnerTexts()).includes("원문 검수"), "편집 책임자 메뉴에 원문 검수");
    await page.goto(`${base}/admin/source-review`);
    const form = page.getByRole("form", { name: "원문 다시 받기" });
    await form.getByRole("button", { name: "원문 다시 받기" }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("form[aria-label='원문 다시 받기'] button")].some((b) => !b.disabled));
    // 번호 모양이 틀리면 → 칸 오류(요청 0). 빈 칸은 브라우저 필수 칸 검사가 먼저 막는다
    await form.locator("#sr-source").fill("번호 아님");
    await form.getByRole("button", { name: "원문 다시 받기" }).click();
    assert.match(await form.locator("#sr-source-error").innerText(), /출처 번호/);
    // 다른 주소 기사의 출처 — 같은 원문 붙여 넣기 0건, 다른 원문 붙여 넣기 1건
    await form.locator("#sr-source").fill(`src:${fx.other.sourceId}`);
    await form.locator("#sr-text").fill(V1);
    await form.getByRole("button", { name: "원문 다시 받기" }).click();
    await form.getByText(/새 검수 항목 0건/).waitFor();
    await form.locator("#sr-text").fill("시험용 가상구 고시 원문 — 편집국이 붙여 넣은 새 판");
    await form.getByRole("button", { name: "원문 다시 받기" }).click();
    await form.getByText(/새 검수 항목 1건/).waitFor();
    const [item] = await queueFor([fx.other.sourceId]);
    assert.equal(item?.reason, "snapshot_changed");
    const row = page.locator(`[data-testid="source-review-open"] li[data-queue-id="${item.id}"]`);
    await row.waitFor();
    assert.match(await row.innerText(), /원문 바뀜/);
    assert.match(await row.innerText(), new RegExp(`src:${fx.other.sourceId}`));
    // 해결 버튼 → 목록에서 빠짐, DB resolved
    await row.locator(`#sr-note-${item.id}`).fill("편집국 화면에서 확인");
    await row.getByRole("button", { name: "해결" }).click();
    await page.locator(`[data-testid="source-review-open"] li[data-queue-id="${item.id}"]`).waitFor({ state: "detached" });
    assert.equal((await one("select status, resolution_note from public.source_review_queue where id = $1", [item.id])).resolution_note, "편집국 화면에서 확인");
    assert.equal(await page.locator(`[data-testid="source-review-resolved"] li[data-queue-id="${item.id}"]`).count(), 1);
  } finally {
    await ctx.close();
  }

  const rep = await login(u.reporter);
  try {
    assert.ok(!(await rep.page.locator('nav[aria-label="편집국 메뉴"] a').allInnerTexts()).includes("원문 검수"), "기자 메뉴에 원문 검수 0");
    const res = await rep.page.goto(`${base}/admin/source-review`);
    assert.equal(res.status(), 403);
  } finally {
    await rep.ctx.close();
  }
});
