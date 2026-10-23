// 상속·증여 안내 E2E (W4 23단계 — docs/dev/W4_설계.md 1장 23단계 · 5장 · 2.4, PRD-01B FAM-01·02·08).
// standalone 빌드를 로컬 Supabase에 붙인다. 입문 기사·상황은 '시험용' 가짜 내용이고, 외부 주소는 example.test (안심 상속증여계산기 주소는 저장 주소 그대로 쓰는지만 본다).
//  a) 기능 키 꺼짐 — /realestate/inheritance-gift는 하위 분야 목록, /inheritance·/gift 404, /realestate 허브에 링크 카드 0
//  b) 켜짐 — 세 경로 모두 고지 문구 1개 · FAM-08 카드 1 · SM 취득세 카드 1 · 입문 기사 카드마다 배지·최종 감수일(감수 전 기사 0) · 입력 요소 0 · /calc/* 링크 0
//  c) 상황 카드 — 목록의 상황만(공개된 것), 각 상황 페이지에 FAM-08 카드 1·입력 요소 0, 카드를 누르면 situation_card_clicked(inheritance_gift) 1건
//  d) FAM-08 카드 — 새 창·noopener noreferrer·저장 주소 그대로(쿼리 0)·관계 표기 '별도 사이트'뿐 / 끊김 → 국세청 / 둘 다 끊김 → 카드째 숨김
//  e) self_calculator 키 — 켜면 배포 없이 [취득세 계산하기] → /calc/acquisition, 끄면 요소 0
//  f) 설정 API — 고지 문구에 숫자 422 · 연결 없는 상황을 목록에 넣으면 422(사유) · 갖춘 상황은 200
//  g) 360·1280px 가로 넘침 0 · R1~R3 · 접근성 95
// 만든 계정·기사·상황·측정 이벤트는 끝나면 지우고, 운영 설정(기능 키·고지·상황 목록)과 연결 주소·상태는 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-inheritance-gift-e2e@example.test";
const SITE = "https://e2e.example.test";
const ANSIM = "https://ansim-igt-calculator.vercel.app/";
const SM_ACQ = "https://sm.example.test/acquisition";
const NTS = "https://nts.example.test/guide";
const PATHS = ["/realestate/inheritance-gift", "/realestate/inheritance-gift/inheritance", "/realestate/inheritance-gift/gift"];
const NOTICE = "시험용 고지 문구입니다";
const KEYS = [["external_calculator", "inheritance_gift"], ["sm_calculator", "acquisition"], ["fallback", "nts"], ["fallback", "wetax"]];

let sb, server, staff, db, browser, base, debugPort, since;
const u = {};
const fx = { sits: [] };
const saved = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const setSetting = (key, value) => db.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
async function expireCache() {
  const cur = (await one("select value from public.settings where key = 'pilot_regions'")).value;
  const res = await fetch(`${base}/api/admin/settings/pilot_regions`, { method: "PATCH", headers: { authorization: `Bearer ${u.admin.token}`, "content-type": "application/json" }, body: JSON.stringify({ value: cur }) });
  assert.equal(res.status, 200, await res.text());
}
const flags = async (over) => {
  await setSetting("feature_flags", { ...saved.feature_flags, inheritance_gift: false, sm_calculator: false, self_calculator: false, ...over });
  await expireCache();
};
const linkStatus = async (kind, key, status) => {
  await db.query("update public.official_links set status = $3 where kind = $1 and key = $2", [kind, key, status]);
  await expireCache();
};
async function get(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}
const patchSetting = (key, value) =>
  fetch(`${base}/api/admin/settings/${key}`, { method: "PATCH", headers: { authorization: `Bearer ${u.admin.token}`, "content-type": "application/json" }, body: JSON.stringify({ value }) });
const eventsSince = async (name) => (await db.query("select * from public.analytics_events where name = $1 and occurred_at >= $2 order by id", [name, since])).rows;
async function waitEvents(name, n) {
  for (let i = 0; i < 50; i++) {
    const rows = await eventsSince(name);
    if (rows.length >= n) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return eventsSince(name);
}
const textOf = async (page, sel) => page.locator(sel).first().innerText();

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
  since = new Date();
  for (const t of ["articles", "situations", "editorial_reviews", "people"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  for (const k of ["feature_flags", "inheritance_gift_notice", "inheritance_gift_situations"]) saved[k] = (await one("select value from public.settings where key = $1", [k])).value;
  saved.links = (await db.query("select id, url, status, checked_at from public.official_links order by id")).rows;
  u.admin = await staff.createUser({ label: "w4ig-admin", email: ADMIN_EMAIL });

  // 외부 연결 주소·상태 (시험 동안만)
  const urls = { "external_calculator:inheritance_gift": ANSIM, "sm_calculator:acquisition": SM_ACQ, "fallback:nts": NTS, "fallback:wetax": "https://wetax.example.test/guide" };
  for (const [kind, key] of KEYS) await db.query("update public.official_links set url = $3, status = 'ok', checked_at = now() where kind = $1 and key = $2", [kind, key, urls[`${kind}:${key}`]]);
  const link = await one("select id from public.official_links where kind = 'external_calculator' and key = 'inheritance_gift'");

  // 감수자(인물) + 상황 4(갖춤) + 갖추지 못한 상황 1
  const person = await one("insert into public.people (name, slug, roles) values ('시험용 감수위원', $1, '{reviewer}') returning id", [`w4ig-rv-${staff.run}`]);
  staff.personIds.add(Number(person.id));
  const checks = JSON.stringify([{ title: "시험용 확인 가", when: "시험" }, { title: "시험용 확인 나" }, { title: "시험용 확인 다" }]);
  for (let i = 1; i <= 5; i++) {
    const sit = await one(
      `insert into public.situations (slug, section, title, subtitle, pictogram, checks, checklist, external_link_id, reviewer_id, reviewed_at, visible)
       values ($1, 'realestate', $2, '시험용 부제', 'acquisition', $3::jsonb, $4::jsonb, $5, $6, now(), false) returning id, slug`,
      [`w4ig-${staff.run}-${i}`, `시험용 상속 상황 ${i}`, checks, JSON.stringify({ items: ["시험용 항목"], notice: "시험용 일반 고지" }), i === 5 ? null : link.id, person.id],
    );
    staff.trackRow("situations", sit.id);
    fx.sits.push(sit.slug);
  }
  // 입문 기사 — 감수 승인된 해설 1 + 승인 전 해설 1 (발행 절차는 다른 시험 몫이라 트리거를 끈 세션으로 직접 넣는다)
  const cat = await one("select id from public.categories where section = 'realestate' and slug = 'inheritance-gift'");
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    for (const [key, status] of [["ok", "approved"], ["pending", "pending"]]) {
      const a = await one(
        `insert into public.articles (slug, title, summary, section, content_type, status, category_id, tax_review_status, first_published_at)
         values ($1, $2, '시험용 요약', 'realestate', 'explainer', 'published', $3, $4, now()) returning id`,
        [`w4ig-art-${key}-${staff.run}`, `시험용 입문 기사 ${key}`, cat.id, status],
      );
      staff.trackArticle(a.id);
      fx[key] = Number(a.id);
      if (key === "ok") {
        await db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, at) values ($1, 'tax_review', $2, 'approve', '2026-10-05T03:00:00Z')", [a.id, person.id]);
      }
    }
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
  await setSetting("inheritance_gift_notice", NOTICE);
  await setSetting("inheritance_gift_situations", fx.sits.slice(0, 4));
  await db.query("update public.situations set visible = true where slug = any($1::text[])", [fx.sits.slice(0, 3)]); // 4번째는 비공개 — 카드 3장
  await flags({});
  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
});

after(async () => {
  try {
    await browser?.close();
    if (db) {
      for (const k of ["feature_flags", "inheritance_gift_notice"]) if (saved[k] !== undefined) await setSetting(k, saved[k]);
      await setSetting("inheritance_gift_situations", []); // 상황 행을 지우기 전에 목록을 비운다
      if (saved.inheritance_gift_situations?.length === 0) await setSetting("inheritance_gift_situations", saved.inheritance_gift_situations);
      for (const r of saved.links ?? []) await db.query("update public.official_links set url = $2, status = $3, checked_at = $4 where id = $1", [r.id, r.url, r.status, r.checked_at]);
      await db.query("delete from public.analytics_events where occurred_at >= $1 and name in ('situation_card_clicked', 'calculator_card_clicked')", [since]);
    }
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

test("a) 기능 키 꺼짐 — 본 경로는 하위 분야 목록, /inheritance·/gift 404, 허브 링크 카드 0", async () => {
  await flags({});
  const main = await get(PATHS[0]);
  assert.equal(main.status, 200);
  assert.ok(!main.html.includes('data-ui="inheritance-gift"'), "전용 화면 0");
  assert.ok(!main.html.includes(NOTICE), "고지 0");
  assert.equal((await get(PATHS[1])).status, 404);
  assert.equal((await get(PATHS[2])).status, 404);
  const hub = await get("/realestate");
  assert.equal(hub.status, 200);
  assert.ok(!hub.html.includes("data-link-card="), "링크 카드 0");
});

test("b) 켜짐 — 세 경로 모두 고지 1 · FAM-08 카드 1 · SM 취득세 카드 1 · 입문 기사 배지·감수일(감수 전 0) · 입력 요소·/calc 링크 0", async () => {
  await flags({ inheritance_gift: true, sm_calculator: true });
  for (const p of PATHS) {
    const { status, html } = await get(p);
    assert.equal(status, 200, p);
    assert.equal((html.match(/data-part="notice"/g) ?? []).length, 1, `${p} 고지 요소 1개`);
    assert.ok(html.includes(NOTICE), `${p} 고지 문구`);
    assert.equal((html.match(/data-part="fam08"/g) ?? []).length, 1, `${p} FAM-08 영역 1`);
    assert.equal((html.match(/data-link-card="inheritance_gift"/g) ?? []).length, 1, `${p} FAM-08 카드 1`);
    assert.equal((html.match(/data-link-card="acquisition"/g) ?? []).length, 1, `${p} SM 취득세 카드 1`);
    const main = html.slice(html.indexOf('data-ui="inheritance-gift"'));
    assert.ok(!/<(input|textarea|select|form)\b/.test(main), `${p} 입력 요소 0`);
    assert.ok(!/href="\/calc(\/|")/.test(html) && !html.includes("inheritance-acquisition") && !html.includes("gift-acquisition"), `${p} 자체 계산기 링크·경로 0`);
    assert.ok(html.includes("시험용 입문 기사 ok"), `${p} 감수 승인된 입문 기사`);
    assert.ok(!html.includes("시험용 입문 기사 pending"), `${p} 감수 전 기사 0`);
    const badges = html.match(/data-part="intro-badge"[\s\S]*?<\/p>/g) ?? [];
    assert.equal(badges.length, 1);
    const badge = badges[0].replaceAll("<!-- -->", "");
    assert.ok(badge.includes("지방세") && badge.includes("최종 감수 2026-10-05"), badge);
  }
  await flags({ inheritance_gift: true, sm_calculator: false });
  assert.ok(!(await get(PATHS[0])).html.includes('data-link-card="acquisition"'), "sm_calculator 꺼짐 — SM 카드 0");
  // 허브 링크 카드는 같은 키를 따른다
  await flags({ inheritance_gift: true });
  assert.ok((await get("/realestate")).html.includes(PATHS[0]), "허브 링크 카드 1");
});

test("c) 상황 카드 — 공개된 목록 상황만 · 상황 페이지 FAM-08 카드 1·입력 0 · 누름 1번 = situation_card_clicked 1건", async () => {
  await flags({ inheritance_gift: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}${PATHS[0]}`, { waitUntil: "networkidle" });
    const slugs = await page.$$eval('[data-part="ig-situations"] [data-situation-slug]', (els) => els.map((e) => e.getAttribute("data-situation-slug")));
    assert.deepEqual(slugs, fx.sits.slice(0, 3), "공개된 3장만(비공개·목록 밖 0)");
    const before0 = (await eventsSince("situation_card_clicked")).length;
    await page.locator(`[data-situation-slug="${fx.sits[0]}"] a`).click();
    await page.waitForURL(`${base}/situations/${fx.sits[0]}`);
    const clicks = (await waitEvents("situation_card_clicked", before0 + 1)).slice(before0);
    assert.equal(clicks.length, 1, "누름 1번 = 이벤트 1건");
    assert.deepEqual([clicks[0].section, clicks[0].props], ["realestate", { situation: fx.sits[0], position: "inheritance_gift" }]);
    assert.equal(await page.locator('[data-link-card="inheritance_gift"]').count(), 1, "상황 페이지 FAM-08 카드 1");
    assert.equal(await page.locator("main input, main textarea, main select").count(), 0, "입력 요소 0");
  } finally {
    await ctx.close();
  }
});

test("d) FAM-08 카드 — 새 창·noopener noreferrer·저장 주소 그대로·'별도 사이트'뿐 / 끊김 → 국세청 / 둘 다 끊김 → 숨김", async () => {
  await flags({ inheritance_gift: true, sm_calculator: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}${PATHS[0]}`);
    const a = page.locator('[data-part="fam08"] a[data-part="go"]');
    assert.equal(await a.count(), 1);
    assert.equal(await a.getAttribute("href"), ANSIM, "저장 주소 글자 그대로 (쿼리·조각 0)");
    assert.equal(await a.getAttribute("target"), "_blank");
    const rel = (await a.getAttribute("rel")) ?? "";
    assert.ok(rel.includes("noopener") && rel.includes("noreferrer"), rel);
    const text = await textOf(page, '[data-part="fam08"]');
    assert.ok(text.includes("별도 사이트"), "관계 표기");
    for (const w of ["같은 운영", "운영 주체", "제휴", "자매", "계열"]) assert.ok(!text.includes(w), `관계 표기는 '별도 사이트'뿐: ${w}`);
    assert.equal(await page.locator('[data-part="fam08"] [data-tax-kind="national"]').count(), 1, "국세 배지");
    // 24단계 — FAM-08 카드·SM 취득세 카드 이동 링크 누름 1번 = calculator_card_clicked(화면 inheritance_gift) 1건 (눌러도 이동하지 않게 막고 센다)
    await page.evaluate(() => document.addEventListener("click", (e) => e.preventDefault(), true));
    const c0 = (await eventsSince("calculator_card_clicked")).length;
    await a.click();
    const fam = (await waitEvents("calculator_card_clicked", c0 + 1)).slice(c0);
    assert.deepEqual(fam.map((r) => [r.props.card, r.props.screen]), [["inheritance_gift", "inheritance_gift"]], "FAM-08 카드 누름 = 이벤트 1건");
    const smKey = await page.locator('[data-part="sm-card"] [data-link-card]').getAttribute("data-link-card");
    await page.locator('[data-part="sm-card"] a[data-part="go"]').click();
    const both = (await waitEvents("calculator_card_clicked", c0 + 2)).slice(c0);
    assert.deepEqual(both.map((r) => [r.props.card, r.props.screen]), [["inheritance_gift", "inheritance_gift"], [smKey, "inheritance_gift"]], "SM 취득세 카드 누름 = 이벤트 1건 더");

    await linkStatus("external_calculator", "inheritance_gift", "broken");
    await page.goto(`${base}${PATHS[0]}`);
    const hrefs = await page.$$eval('[data-part="fam08"] a', (as) => as.map((x) => x.getAttribute("href")));
    assert.deepEqual(hrefs, [NTS], "끊김 → 국세청 안내만 (위택스 0)");

    await linkStatus("fallback", "nts", "broken");
    await page.goto(`${base}${PATHS[0]}`);
    assert.equal(await page.locator('[data-part="fam08"]').count(), 0, "둘 다 끊김 → 카드째 숨김");
    assert.equal(await page.locator('main a[href=""]').count(), 0, "빈 링크 0");
  } finally {
    await ctx.close();
    await linkStatus("external_calculator", "inheritance_gift", "ok");
    await linkStatus("fallback", "nts", "ok");
  }
});

test("e) self_calculator 키 — 켜면 배포 없이 [취득세 계산하기] → /calc/acquisition, 끄면 요소 0", async () => {
  await flags({ inheritance_gift: true });
  let r = await get(PATHS[0]);
  assert.ok(!r.html.includes("/calc/acquisition") && !r.html.includes('data-part="self-calculator"'), "꺼짐 — 요소 0");
  await flags({ inheritance_gift: true, self_calculator: true });
  r = await get(PATHS[0]);
  assert.ok(/data-part="self-calculator"[\s\S]{0,300}href="\/calc\/acquisition"/.test(r.html) && r.html.includes("취득세 계산하기"), "켜짐 — 버튼");
  await flags({ inheritance_gift: true });
  assert.ok(!(await get(PATHS[0])).html.includes("/calc/acquisition"), "다시 꺼짐 — 0");
});

test("f) 설정 API — 숫자 든 고지 422 · 연결 없는 상황 목록 422(사유) · 갖춘 상황 200 · 되돌리기", async () => {
  let res = await patchSetting("inheritance_gift_notice", "공제 3억 안내");
  assert.equal(res.status, 422);
  res = await patchSetting("inheritance_gift_situations", [fx.sits[4]]);
  assert.equal(res.status, 422);
  assert.match(JSON.stringify(await res.json()), /외부 계산기 연결/);
  res = await patchSetting("inheritance_gift_situations", [fx.sits[0], fx.sits[0]]);
  assert.equal(res.status, 422, "중복");
  res = await patchSetting("inheritance_gift_situations", [fx.sits[0], fx.sits[1]]);
  assert.equal(res.status, 200, await res.text());
  assert.deepEqual((await one("select value from public.settings where key = 'inheritance_gift_situations'")).value, [fx.sits[0], fx.sits[1]]);
  res = await patchSetting("inheritance_gift_situations", fx.sits.slice(0, 4));
  assert.equal(res.status, 200);
  // 목록의 공개 상황에서 연결을 지우는 고침은 DB가 거부
  await assert.rejects(() => db.query("update public.situations set external_link_id = null where slug = $1", [fx.sits[0]]), /공개 전에 갖춰야/);
});

test("g) 360·1280px 가로 넘침 0 · 터치 44px · R1~R3 · 접근성 95", async () => {
  await flags({ inheritance_gift: true, sm_calculator: true, self_calculator: true });
  for (const viewport of [{ width: 360, height: 740 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    try {
      for (const p of PATHS) {
        await page.goto(`${base}${p}`);
        assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${p} ${viewport.width}px 가로 넘침 0`);
      }
      if (viewport.width === 360) {
        const small = await page.$$eval('main a[data-part="go"], [data-part="self-calculator"] a', (as) => as.map((a) => ({ t: a.textContent, ...a.getBoundingClientRect().toJSON() })).filter((r) => r.width > 0 && r.height > 0 && r.height < 44));
        assert.deepEqual(small, [], "360px 링크 터치 44px");
      }
    } finally {
      await ctx.close();
    }
  }
  for (const width of [360, 640, 1024]) {
    const r = await measurePage(browser, `${base}${PATHS[0]}`, { width, height: 740 });
    assert.ok(r.r2.pass, `${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
    assert.ok(r.r3.pass, `${width}px R3 오렌지 ${r.r3.ratio}`);
  }
  const a = await accessibility(`${base}${PATHS[0]}`, debugPort);
  assert.ok(a.score >= A11Y_MIN, `접근성 ${a.score} — ${a.failing.join(", ")}`);
});
