// 개정 트래커 E2E (W3 3·4단계 — TX-07·08, docs/dev/W3_설계.md 1장 3·4단계 증거)
// standalone 빌드를 로컬 Supabase에 붙인다. 개정안·단계·원문은 전부 '시험용' 가짜(실제 세법 내용 0), 편집국 API로 입력하고 공개 전환만 DB로(PO 몫).
//  a) 권한 — 편집 책임자만 입력(기자 403) · 단계 기록은 날짜·원문 URL·스냅샷 필수(422) · 같은 단계 재기록·앞 순서 409 · 정정은 사유 필수 + 한 기록당 1회
//  b) 기능 키 amendments 꺼짐 — 상세 404 · 켬 — 목록 카드·상세 타임라인, 공포 전 `확정 아님` 칩, 공포 뒤 칩 0, 시행일이 내일이면 '시행 예정'
//  c) 입법예고 → 국회 제출: 연결 기사 3건 모두 갱신 배너(입법예고) → 국회 제출 기록 직후 3건 모두 배너가 '국회 제출' · 연결 안 한 기사 0 · dateModified 불변
//  d) 연결 해제·실질 수정이 생기면 그 기사 배너 0 · 목록은 현재 단계 날짜가 늦은 개정안이 먼저 · 360px 가로 넘침 0
// 만든 계정·기사·개정안·스냅샷·감사 로그는 끝나면 지우고 운영 설정은 시험 전 값으로 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "tax-tracker-e2e@example.test";
const SITE = "https://e2e.example.test";

let sb, server, staff, db, browser, base;
const u = {};
const fx = { articles: [] };

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 600);
const kst = (plusDays = 0) => new Date(Date.now() + 9 * 3600_000 + plusDays * 86400_000).toISOString().slice(0, 10);
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (user, body) => api("POST", "/amendments", user, body);
const page = async (path) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, html: await res.text() };
};
async function setFeatures(on) {
  const current = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: Object.fromEntries(Object.keys(current).map((k) => [k, on.includes(k)])) });
  assert.equal(r.status, 200, show(r));
}
const stageEvent = (amendmentId, stage, occurredOn, extra = {}) => ({
  op: "event",
  amendmentId,
  stage,
  occurredOn,
  sourceUrl: `https://www.moleg.go.kr/e2e-${staff.run}/${stage}`,
  snapshotPayload: `시험용 가짜 원문 ${stage} ${staff.run}`,
  ...extra,
});
const banner = (html) => /data-ui="update-banner"[\s\S]{0,3000}?<\/aside>/.exec(html)?.[0] ?? null;
const modified = (html) => /"dateModified":"([^"]+)"/.exec(html)?.[1] ?? null;

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
  await staff.snapshotOperations();
  u.editor = await staff.createUser({ label: "tracker-editor", roles: ["editor"], person: { name: "트래커 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "tracker-reporter", roles: ["reporter"], person: { name: "트래커 시험 기자", roles: ["reporter"] } });
  u.admin = await staff.createUser({ label: "tracker-admin", email: ADMIN_EMAIL });
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

test("시험 자료 — 시험용 개정안 2건(편집국 API)과 공개 기사 4건(DB)", async () => {
  assert.equal((await post(u.reporter, { op: "create", slug: `e2e-no-${staff.run}`, title: "시험용 권한 없음" })).status, 403, "기자는 개정안을 만들 수 없다");
  const bad = await post(u.editor, { op: "create", slug: "Bad Slug", title: "" });
  assert.equal(bad.status, 422, show(bad));
  for (const key of ["a", "b"]) {
    const r = await post(u.editor, { op: "create", slug: `e2e-tracker-${key}-${staff.run}`, title: `시험용 가짜 개정안 ${key.toUpperCase()} ${staff.run}`, lawNames: ["시험용 가짜 법"] });
    assert.equal(r.status, 201, show(r));
    assert.equal(r.body.amendment.status, "draft", "만들면 공개 전 초안");
    fx[key] = { id: Number(r.body.amendment.id), slug: r.body.amendment.slug, title: r.body.amendment.title };
    staff.trackRow("amendments", fx[key].id);
  }
  assert.equal((await post(u.editor, { op: "create", slug: fx.a.slug, title: "중복" })).status, 409);
  for (let i = 1; i <= 4; i++) {
    const { rows } = await db.query(
      `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body, first_published_at)
       values ($1, $2, '시험용 가짜 기사', 'tax', 'explainer', 'published', $3, $4, $5) returning id, slug`,
      [`e2e-tracker-art-${i}-${staff.run}`, `시험용 개정 브리핑 ${i} ${staff.run}`, u.editor.personId, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 가짜 본문입니다." }], claims: [] }), hoursAgo(3)],
    );
    staff.trackArticle(rows[0].id);
    fx.articles.push({ id: Number(rows[0].id), slug: rows[0].slug });
  }
});

test("a) 단계 기록 조건 — 날짜·원문·스냅샷 필수 · 같은 단계·앞 순서 거부 · 정정은 사유 필수·1회", async () => {
  const id = fx.a.id;
  const noSnap = await post(u.editor, { op: "event", amendmentId: id, stage: "announced", occurredOn: kst(-30), sourceUrl: "https://www.moleg.go.kr/x" });
  assert.equal(noSnap.status, 422, show(noSnap));
  assert.ok(noSnap.body.errors.some((e) => e.startsWith("snapshot")), show(noSnap));
  const noDate = await post(u.editor, stageEvent(id, "announced", ""));
  assert.equal(noDate.status, 422);
  const badUrl = await post(u.editor, stageEvent(id, "announced", kst(-30), { sourceUrl: "javascript:alert(1)" }));
  assert.equal(badUrl.status, 422);
  assert.equal((await one("select count(*)::int n from public.amendment_events where amendment_id = $1", [id])).n, 0, "거부된 기록은 저장되지 않는다");

  const first = await post(u.editor, stageEvent(id, "announced", kst(-30)));
  assert.equal(first.status, 201, show(first));
  assert.equal(first.body.event.recorded_by, `user:${u.editor.id}`);
  assert.ok(first.body.event.snapshot_id, "스냅샷이 만들어져 연결된다");
  assert.equal((await post(u.editor, stageEvent(id, "announced", kst(-29)))).status, 409, "같은 단계 재기록 거부");
  const second = await post(u.editor, stageEvent(id, "submitted", kst(-20)));
  assert.equal(second.status, 201, show(second));
  assert.equal((await post(u.editor, stageEvent(id, "pre_notice", kst(-25)))).status, 409, "앞 순서로 돌아가는 기록 거부");

  const noReason = await post(u.editor, { ...stageEvent(id, "submitted", kst(-19)), op: "correct", correctionOf: second.body.event.id });
  assert.equal(noReason.status, 422, show(noReason));
  const fixed = await post(u.editor, { ...stageEvent(id, "submitted", kst(-19)), op: "correct", correctionOf: second.body.event.id, reason: "시험용 날짜 정정" });
  assert.equal(fixed.status, 201, show(fixed));
  assert.equal(fixed.body.event.correction_of, second.body.event.id);
  const again = await post(u.editor, { ...stageEvent(id, "submitted", kst(-18)), op: "correct", correctionOf: second.body.event.id, reason: "두 번째 정정" });
  assert.equal(again.status, 409, "한 기록은 한 번만 정정");
  const cur = await one("select current_stage, current_stage_on::text d from public.amendment_current_stages where amendment_id = $1", [id]);
  assert.deepEqual({ stage: cur.current_stage, on: cur.d }, { stage: "submitted", on: kst(-19) }, "현재 단계 = 정정된 기록 중 가장 늦은 순서");
  const skip = await post(u.editor, { op: "event", amendmentId: id, stage: "passed", skipped: true });
  assert.equal(skip.status, 422, "해당 없음은 사유 필수");
  assert.equal((await one("select count(*)::int n from public.audit_logs where action in ('amendment.record_event','amendment.correct_event') and actor = $1", [`user:${u.editor.id}`])).n >= 3, true, "기록·정정 감사 로그");
});

test("b) 기능 키 amendments — 꺼짐 404 · 켜짐 목록·타임라인 · 공포 전 `확정 아님` · 공포 뒤 칩 0 · 시행 예정", async () => {
  // 개정안 A는 위 단계에서 '국회 제출'(날짜 정정됨)까지 기록됨. 공개 전환은 PO — 여기서는 DB로
  await db.query("update public.amendments set status = 'public' where id = any($1::bigint[])", [[fx.a.id, fx.b.id]]);
  await setFeatures(["search"]);
  const off = await page(`/tax/amendments/${fx.a.slug}`);
  assert.equal(off.status, 404, "기능 키 꺼짐 = 404");
  assert.ok(!off.html.includes(fx.a.title));
  assert.ok(!(await page("/tax/amendments")).html.includes('data-part="amendment-list"'), "꺼져 있으면 트래커 목록이 아니다");

  await setFeatures(["search", "amendments"]);
  const list = await page("/tax/amendments");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes(`data-amendment="${fx.a.slug}"`), "공개 개정안 A 카드");
  const detail = await page(`/tax/amendments/${fx.a.slug}`);
  assert.equal(detail.status, 200);
  for (const label of ["발표", "입법예고", "국회 제출", "의결", "공포", "시행"]) assert.ok(detail.html.includes(label), `6단계 배지에 ${label}`);
  assert.ok(detail.html.includes("확정 아님"), "국회 제출 단계 = 공포 전 → 확정 아님");
  assert.ok(detail.html.includes(`https://www.moleg.go.kr/e2e-${staff.run}/announced`), "단계 원문 링크");
  assert.equal((await page("/tax/amendments/not-exist-" + staff.run)).status, 404);
  assert.equal((await page(`/tax/amendments/BAD_SLUG`)).status, 404);

  // 개정안 B: 공포까지 → 칩 0, 시행일이 내일이면 '시행 예정'
  for (const [stage, d] of [["announced", kst(-9)], ["pre_notice", kst(-8)], ["submitted", kst(-7)], ["passed", kst(-6)], ["promulgated", kst(-5)]]) {
    const r = await post(u.editor, stageEvent(fx.b.id, stage, d));
    assert.equal(r.status, 201, `${stage}: ${show(r)}`);
  }
  const b1 = await page(`/tax/amendments/${fx.b.slug}`);
  assert.ok(!b1.html.includes("확정 아님"), "공포 기록 뒤 칩 0");
  assert.equal((await post(u.editor, stageEvent(fx.b.id, "effective", kst(1)))).status, 201);
  const b2 = await page(`/tax/amendments/${fx.b.slug}`);
  assert.ok(b2.html.includes("시행 예정"), "시행일 전날까지 시행 예정");
  // 정렬: 현재 단계 날짜가 늦은 것(B: 내일) 먼저, A(국회 제출, 19일 전)가 뒤
  const list2 = (await page("/tax/amendments")).html;
  const iB = list2.indexOf(`data-amendment="${fx.b.slug}"`);
  const iA = list2.indexOf(`data-amendment="${fx.a.slug}"`);
  assert.ok(iB >= 0 && iA >= 0 && iB < iA, `현재 단계 날짜가 늦은 B가 먼저 (B ${iB}, A ${iA})`);
});

test("c) 입법예고 → 국회 제출: 연결 기사 3건 모두 갱신 배너, 연결 안 한 기사 0, dateModified 불변", async () => {
  // 새 개정안 C(시험용) — 발표만 기록된 상태에서 기사 3건 연결
  const r = await post(u.editor, { op: "create", slug: `e2e-tracker-c-${staff.run}`, title: `시험용 가짜 개정안 C ${staff.run}`, lawNames: [] });
  assert.equal(r.status, 201, show(r));
  fx.c = { id: Number(r.body.amendment.id), slug: r.body.amendment.slug };
  staff.trackRow("amendments", fx.c.id);
  await db.query("update public.amendments set status = 'public' where id = $1", [fx.c.id]);
  assert.equal((await post(u.editor, stageEvent(fx.c.id, "announced", kst(-2)))).status, 201);
  const [a1, a2, a3, a4] = fx.articles;
  for (const art of [a1, a2, a3]) {
    const l = await post(u.editor, { op: "link", articleId: art.id, amendmentId: fx.c.id });
    assert.equal(l.status, 201, show(l));
  }
  assert.equal((await post(u.editor, { op: "link", articleId: a1.id, amendmentId: fx.c.id })).status, 409, "같은 연결 2번 = 409");
  assert.equal((await post(u.editor, { op: "link", articleId: 999999999, amendmentId: fx.c.id })).status, 422, "없는 기사");
  assert.equal((await post(u.reporter, { op: "link", articleId: a4.id, amendmentId: fx.c.id })).status, 403);

  const before = [];
  for (const art of fx.articles) before.push(await page(`/news/${art.slug}`));
  for (const [i, p] of before.entries()) assert.equal(p.status, 200, `기사 ${i + 1}`);
  const withBanner = (p) => banner(p.html);
  assert.ok(withBanner(before[0])?.includes("발표"), "연결 기사 1: 발표 단계 배너");
  assert.equal(withBanner(before[3]), null, "연결하지 않은 기사 4는 배너 0");
  const dm = before.map((p) => modified(p.html));

  assert.equal((await post(u.editor, stageEvent(fx.c.id, "pre_notice", kst(-1)))).status, 201);
  for (const art of [a1, a2, a3]) {
    const b = banner((await page(`/news/${art.slug}`)).html);
    assert.ok(b?.includes("입법예고"), `입법예고 기록 직후 ${art.slug} 배너: ${b}`);
    assert.ok(b.includes(`/tax/amendments/${fx.c.slug}`), "배너의 트래커 링크 1개");
  }
  assert.equal((await post(u.editor, stageEvent(fx.c.id, "submitted", kst(0)))).status, 201);
  for (const art of [a1, a2, a3]) {
    const p = await page(`/news/${art.slug}`);
    const b = banner(p.html);
    assert.ok(b?.includes("국회 제출") && !b.includes("입법예고"), `국회 제출 기록 직후 ${art.slug} 배너: ${b}`);
    assert.ok(p.html.includes("확정 아님"), "공포 전 = 확정 아님 칩");
  }
  const after = await page(`/news/${a4.slug}`);
  assert.equal(banner(after.html), null, "연결 0 기사는 계속 배너 0");
  const dm2 = [];
  for (const art of [a1, a2, a3, a4]) dm2.push(modified((await page(`/news/${art.slug}`)).html));
  assert.deepEqual(dm2, dm, "배너가 떠도 dateModified 불변");
});

test("d) 연결 해제·실질 수정 뒤 배너 0 · 360px 가로 넘침 0", async () => {
  const [a1, a2, a3, a4] = fx.articles;
  const un = await post(u.editor, { op: "unlink", articleId: a1.id, amendmentId: fx.c.id });
  assert.equal(un.status, 200, show(un));
  assert.equal(banner((await page(`/news/${a1.slug}`)).html), null, "연결 해제 뒤 배너 0");
  assert.ok(banner((await page(`/news/${a2.slug}`)).html), "다른 연결 기사는 그대로");

  // 편집자가 실질 수정(substantive_updated_at 갱신)하면 그 기사 배너 사라짐 — 공개 캐시는 연결 쓰기로 만료시킨다
  await db.query("update public.articles set substantive_updated_at = now(), version = version + 1 where id = $1", [a2.id]);
  assert.equal((await post(u.editor, { op: "link", articleId: a4.id, amendmentId: fx.c.id })).status, 201);
  assert.equal(banner((await page(`/news/${a2.slug}`)).html), null, "실질 수정 뒤 배너 0");
  assert.ok(banner((await page(`/news/${a3.slug}`)).html), "수정하지 않은 기사 3은 배너 유지");
  assert.ok(banner((await page(`/news/${a4.slug}`)).html), "새로 연결한 기사 4는 배너");

  for (const path of ["/tax/amendments", `/tax/amendments/${fx.c.slug}`, `/news/${a3.slug}`]) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(`${base}${path}`, { waitUntil: "networkidle" });
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `${path} 360px 가로 넘침 ${over}`);
    await ctx.close();
  }
  const det = await page(`/tax/amendments/${fx.c.slug}`);
  assert.ok(det.html.includes(a3.slug) && det.html.includes(a4.slug) && !det.html.includes(a1.slug), "상세의 연결 기사 목록 = 현재 연결");
  await setFeatures(["search"]);
  assert.equal((await page(`/tax/amendments/${fx.c.slug}`)).status, 404, "다시 끄면 바로 404");
});
