// 검색 어휘 백오피스 E2E (W2-d 2단계 — 상황 카드 '검색 별칭' 칸 · 검색 동의어 사전, docs/dev/W2-d_설계.md 5장) — API와 화면
// standalone 빌드를 로컬 Supabase에 붙인다. 상태 코드·감사 로그·DB 값과, 저장 직후 공개 검색(/api/search · anon 키 search_public)에 바로 반영되는지 본다.
//  API) 별칭 — 만들기·고치기 200(공개 중에도 고칠 수 있고 감수 기록 그대로 — 감수 대상 칸이 아니다)·감사 로그 전후·21개·51자·같은 말·기호만 422(바뀜 0)·기자 200·광고 담당 403
//       → 저장 즉시 별칭으로 찾힌다(캐시 없음)
//       동의어 — 편집 책임자만(기자 403) · 더하기 201(정규형 열쇠) · 같은 정규형 409 · 규칙 밖 422 · 끄면 바로 검색에서 빠진다 · 지우기 · 감사 로그
//  화면) 상황 카드 고치기 — 별칭 21줄이면 API를 부르지 않고 칸 오류, 고치면 저장·목록에 별칭 수 · 사전 '검색 동의어' 탭 — 더하기·끄기·지우기, 빈 동의어는 칸 오류 · 360px 가로 스크롤 0
// 만든 계정·상황·기사·동의어·감사 로그는 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "admin-search-vocab-e2e@example.test";
const SITE = "https://e2e.example.test";

let sb, server, staff, db, browser, base, M;
const u = {};
const fx = {};
const contexts = [];

async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const show = (r) => JSON.stringify(r.body).slice(0, 800);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const lastAudit = (userId, action, target) => one("select before, after from public.audit_logs where actor = $1 and action = $2 and target = $3 order by id desc limit 1", [`user:${userId}`, action, target]);
const auditCount = async (userId, action, target) => (await one("select count(*)::int n from public.audit_logs where actor = $1 and action = $2 and target = $3", [`user:${userId}`, action, target])).n;

/** 공개 검색 결과 — 공개 API (기능 키 search를 켠 뒤) */
async function publicSearch(q) {
  const res = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`);
  assert.equal(res.status, 200);
  return (await res.json()).items.map((i) => `${i.kind}:${i.ref}`);
}

/** anon 역할로 DB 검색 함수를 부른다 (RLS·칸 권한 그대로) */
async function anonSearch(q) {
  await db.query("begin");
  try {
    await db.query("set local role anon");
    return (await db.query("select kind, ref from public.search_public($1)", [q])).rows.map((r) => `${r.kind}:${r.ref}`);
  } finally {
    await db.query("rollback");
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
  await staff.snapshotOperations();
  M = `어휘시험${staff.run}`;
  u.editor = await staff.createUser({ label: "vocab-editor", roles: ["editor"], person: { name: "어휘 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "vocab-reporter", roles: ["reporter"], person: { name: "어휘 시험 기자", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "vocab-reviewer", roles: ["reviewer"], person: { name: "어휘 시험 감수위원", roles: ["reviewer"] } });
  u.adOps = await staff.createUser({ label: "vocab-ad", roles: ["ad_ops"] });
  u.admin = await staff.createUser({ label: "vocab-admin", email: ADMIN_EMAIL });
  // 공개 검색으로 반영을 본다 — 기능 키 search만 켠다 (끝나면 시험 전 값으로)
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.equal((await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...flags, search: true } })).status, 200);
  browser = await chromium.launch();
});

after(async () => {
  try {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

// ── 상황 카드 검색 별칭 (API) ─────────────────────────────

test("API 별칭 — 만들 때 받고, 공개 중에도 고칠 수 있다(감수 기록 그대로·감사 로그 전후), 저장 즉시 별칭으로 찾힌다", async () => {
  const checks = [{ title: "자동차세를 미리 냈는지" }, { title: "등록 말소일" }, { title: "돌려받을 계좌" }];
  const created = await api("POST", "/situations", u.editor, {
    slug: `e2e-vocab-car-${staff.run}`,
    section: "tax",
    title: `차를 팔았어요 ${M}`,
    pictogram: "car-sold",
    checks,
    aliases: ["  차 팔았어요 ", "폐차"],
  });
  assert.equal(created.status, 201, show(created));
  fx.car = created.body.situation.id;
  staff.trackRow("situations", fx.car);
  assert.deepEqual((await one("select aliases from public.situations where id = $1", [fx.car])).aliases, ["차 팔았어요", "폐차"], "앞뒤 공백을 지워 저장");
  const row = await one("select updated_at from public.situations where id = $1", [fx.car]);
  assert.equal((await api("POST", `/situations/${fx.car}/review`, u.reviewer, { updatedAt: row.updated_at.toISOString() })).status, 200);
  assert.equal((await api("PATCH", `/situations/${fx.car}`, u.editor, { visible: true })).status, 200);

  const alias = `자동차 넘김 ${M}`;
  assert.deepEqual(await publicSearch(alias), [], "별칭을 넣기 전에는 0");
  const patched = await api("PATCH", `/situations/${fx.car}`, u.editor, { aliases: ["차 팔았어요", "폐차", alias] });
  assert.equal(patched.status, 200, show(patched));
  assert.equal(patched.body.reviewCleared, false, "별칭은 감수 대상 칸이 아니다");
  const after = await one("select aliases, visible, reviewer_id from public.situations where id = $1", [fx.car]);
  assert.deepEqual([after.aliases, after.visible, after.reviewer_id !== null], [["차 팔았어요", "폐차", alias], true, true]);
  assert.deepEqual(await lastAudit(u.editor.id, "situation.update", `situations:${fx.car}`), { before: { aliases: ["차 팔았어요", "폐차"] }, after: { aliases: ["차 팔았어요", "폐차", alias] } });
  assert.deepEqual(await publicSearch(alias), [`situation:${fx.car}`], "저장 즉시 별칭으로 찾힌다 (검색은 캐시하지 않는다)");
  assert.deepEqual(await anonSearch(`자동차넘김${M}`), [`situation:${fx.car}`], "띄어쓰기 없이 써도 같다");

  // 기자도 쓴다(situation.edit) · 광고 담당 403
  const byReporter = await api("PATCH", `/situations/${fx.car}`, u.reporter, { aliases: ["차 팔았어요", alias] });
  assert.equal(byReporter.status, 200, show(byReporter));
  assert.equal((await api("PATCH", `/situations/${fx.car}`, u.adOps, { aliases: [] })).status, 403);
});

test("API 별칭 — 21개·51자·같은 말(띄어쓰기만 다름)·빈 별칭·기호만·목록 아님은 422, DB는 그대로", async () => {
  const before = (await one("select aliases, updated_at from public.situations where id = $1", [fx.car])).aliases;
  const cases = [
    [Array.from({ length: 21 }, (_, i) => `별칭 ${i}`), "20개까지"],
    [["가".repeat(51)], "50자 이하"],
    [["차 팔았어요", "차팔았어요"], "같은 별칭이 두 번"],
    [["폐차", " "], "빈 별칭"],
    [["?!·"], "글자나 숫자가 없는"],
    ["차 팔았어요", "글자 목록"],
  ];
  for (const [aliases, reason] of cases) {
    const r = await api("PATCH", `/situations/${fx.car}`, u.editor, { aliases });
    assert.equal(r.status, 422, `${JSON.stringify(aliases).slice(0, 40)}: ${show(r)}`);
    assert.ok(r.body.errors.some((e) => e.startsWith("situation.aliases:") && e.includes(reason)), show(r));
  }
  const ok20 = await api("PATCH", `/situations/${fx.car}`, u.editor, { aliases: Array.from({ length: 20 }, (_, i) => `${"나".repeat(45)}${i}`) });
  assert.equal(ok20.status, 200, "20개·46자는 받는다 (경계)");
  assert.equal((await api("PATCH", `/situations/${fx.car}`, u.editor, { aliases: before })).status, 200);
  assert.deepEqual((await one("select aliases from public.situations where id = $1", [fx.car])).aliases, before);
});

// ── 검색 동의어 (API) ─────────────────────────────────────

test("API 동의어 — 편집 책임자만(기자·광고 담당 403), 더하기 201(정규형 열쇠·감사 로그), 같은 정규형 409, 규칙 밖 422", async () => {
  for (const user of [u.reporter, u.adOps]) {
    assert.equal((await api("GET", "/synonyms", user)).status, 403);
    assert.equal((await api("POST", "/synonyms", user, { term: "매도", synonyms: ["양도"] })).status, 403);
  }
  const term = `매도${M}`;
  const created = await api("POST", "/synonyms", u.editor, { term: ` 매 도${M} `, synonyms: ["양도", "팔기"], note: "편집국 메모" });
  assert.equal(created.status, 201, show(created));
  fx.syn = created.body.synonym.id;
  staff.trackRow("search_synonyms", fx.syn);
  assert.equal(created.body.synonym.term_key, term.toLowerCase(), "정규형 열쇠 — 띄어쓰기를 뺀다");
  assert.deepEqual(created.body.synonym.synonym_keys, ["양도", "팔기"]);
  assert.equal(created.body.synonym.updated_by, `user:${u.editor.id}`);
  assert.equal(await auditCount(u.editor.id, "synonym.create", `search_synonyms:${fx.syn}`), 1);
  const list = await api("GET", "/synonyms", u.editor);
  assert.equal(list.status, 200);
  assert.ok(list.body.synonyms.some((s) => s.id === fx.syn && s.note === "편집국 메모"));

  const dup = await api("POST", "/synonyms", u.admin, { term: `매도 ${M}`, synonyms: ["처분"] });
  assert.equal(dup.status, 409, show(dup));
  assert.match(dup.body.error, /같은 낱말이 이미 동의어 사전에/);
  for (const [body, reason] of [
    [{ term: "취득세", synonyms: Array.from({ length: 11 }, (_, i) => `말${i}`) }, "10개까지"],
    [{ term: "취득세", synonyms: ["취득 세"] }, "낱말 자신은"],
    [{ term: "?!", synonyms: ["a"] }, "글자나 숫자가"],
    [{ term: "취득세", synonyms: [] }, "1개 이상"],
    [{ term: "취득세", synonyms: ["양도"], termKey: "x" }, "모르는 칸"],
  ]) {
    const r = await api("POST", "/synonyms", u.editor, body);
    assert.equal(r.status, 422, show(r));
    assert.ok(r.body.errors.some((e) => e.includes(reason)), show(r));
  }
  assert.equal((await one("select count(*)::int n from public.search_synonyms where updated_by = $1", [`user:${u.admin.id}`])).n, 0, "거부된 요청은 행 0");
});

test("API 동의어 — 검색에 바로 쓰인다, 끄면 바로 빠진다(감사 로그 전후), 낱말만 바꿔 동의어와 같아지면 422, 지우기 404 뒤", async () => {
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, first_published_at)
     values ($1, $2, '집을 넘길 때 내는 세금을 정리했습니다.', 'tax', 'explainer', 'published', $3, now() - interval '1 hour') returning id`,
    [`e2e-vocab-sale-${staff.run}`, `주택 양도 ${M} 세금 안내`, u.reporter.personId],
  );
  fx.article = Number(rows[0].id);
  staff.trackArticle(fx.article);
  // 동의어 줄: 낱말 '매도{표식}' → '양도'·'팔기'. 기사에는 '매도{표식}' 글자가 없고 '양도'와 '{표식}'이 있다 — 동의어로만 찾힌다(끄면 0으로 확인)
  const q = `매도${M}`;
  assert.deepEqual(await publicSearch(`${q} ${M}`), [`article:${fx.article}`], "검색어 낱말 '매도{표식}'의 동의어 '양도'로 찾는다");

  const off = await api("PATCH", `/synonyms/${fx.syn}`, u.editor, { enabled: false });
  assert.equal(off.status, 200, show(off));
  assert.deepEqual(await lastAudit(u.editor.id, "synonym.update", `search_synonyms:${fx.syn}`), { before: { enabled: true }, after: { enabled: false } });
  assert.deepEqual(await publicSearch(`${q} ${M}`), [], "끄면 바로 검색에서 빠진다");
  assert.equal((await api("PATCH", `/synonyms/${fx.syn}`, u.editor, { enabled: true })).status, 200);
  assert.deepEqual(await publicSearch(`${q} ${M}`), [`article:${fx.article}`]);

  const self = await api("PATCH", `/synonyms/${fx.syn}`, u.editor, { term: "양 도" });
  assert.equal(self.status, 422, show(self));
  assert.match(self.body.error, /낱말 자신은 동의어로/);
  assert.equal((await api("PATCH", `/synonyms/${fx.syn}`, u.reporter, { enabled: false })).status, 403);
  assert.equal((await api("PATCH", "/synonyms/999999999", u.editor, { enabled: false })).status, 404);

  const removed = await api("DELETE", `/synonyms/${fx.syn}`, u.editor);
  assert.equal(removed.status, 200, show(removed));
  assert.equal(await auditCount(u.editor.id, "synonym.delete", `search_synonyms:${fx.syn}`), 1);
  assert.equal((await one("select count(*)::int n from public.search_synonyms where id = $1", [fx.syn])).n, 0);
  assert.deepEqual(await publicSearch(`${q} ${M}`), []);
  assert.equal((await api("DELETE", `/synonyms/${fx.syn}`, u.editor)).status, 404);
});

// ── 화면 ───────────────────────────────────────────────

async function interactive(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(로그아웃|로그인)$/.test(b.textContent.trim()) && !b.disabled));
}

async function login(user, { width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${base}/admin/login`);
  await interactive(page);
  await page.fill("#login-email", user.email);
  await page.fill("#login-password", user.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
  await interactive(page);
  return page;
}

async function open(page, path) {
  const res = await page.goto(`${base}${path}`);
  await interactive(page);
  return res;
}

test("화면 — 상황 카드 '검색 별칭' 칸: 21줄이면 API를 부르지 않고 칸 오류, 고치면 저장되고 목록에 별칭 수", async () => {
  const page = await login(u.editor);
  const patches = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === `/api/admin/situations/${fx.car}` && req.method() === "PATCH") patches.push(req.postDataJSON());
  });
  await open(page, `/admin/situations/${fx.car}`);
  const field = page.locator("#situation-aliases");
  assert.equal(await field.inputValue(), ["차 팔았어요", `자동차 넘김 ${M}`].join("\n"));
  await field.fill(Array.from({ length: 21 }, (_, i) => `별칭 ${i + 1}`).join("\n"));
  await page.getByRole("button", { name: "저장" }).click();
  assert.equal(await page.locator("#situation-aliases-error").textContent(), "검색 별칭은 20개까지입니다 — 지금 21개");
  assert.equal(await field.getAttribute("aria-invalid"), "true");
  await field.fill(`차 팔았어요\n\n차팔았어요`);
  await page.getByRole("button", { name: "저장" }).click();
  assert.equal(await page.locator("#situation-aliases-error").textContent(), "같은 별칭이 두 번 있습니다(띄어쓰기·기호만 다른 것 포함) — 3번째 줄");
  assert.deepEqual(patches, [], "칸 오류면 서버에 보내지 않는다");

  await field.fill(`차 팔았어요\n폐차\n화면 별칭 ${M}`);
  await page.getByRole("button", { name: "저장" }).click();
  await page.getByRole("status").filter({ hasText: "저장했습니다" }).waitFor();
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].aliases, ["차 팔았어요", "폐차", `화면 별칭 ${M}`]);
  assert.deepEqual((await one("select aliases, reviewer_id is not null as reviewed from public.situations where id = $1", [fx.car])), { aliases: ["차 팔았어요", "폐차", `화면 별칭 ${M}`], reviewed: true });
  assert.deepEqual(await publicSearch(`화면 별칭 ${M}`), [`situation:${fx.car}`]);
  await open(page, "/admin/situations");
  assert.equal(await page.getByTestId(`alias-count-${fx.car}`).textContent(), "검색 별칭 3개");
});

test("화면 — 사전 '검색 동의어' 탭: 더하기(찾는 열쇠 미리보기)·빈 동의어는 칸 오류·끄기·지우기, 기자 403", async () => {
  const page = await login(u.editor);
  const posts = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/admin/synonyms" && req.method() === "POST") posts.push(req.postDataJSON());
  });
  await open(page, "/admin/dictionaries?tab=synonyms");
  assert.equal(await page.locator('nav[aria-label="사전 종류"] a[aria-current="page"]').textContent(), "검색 동의어");
  await page.getByText("새 줄 적기").click();
  await page.fill("#synonym-new-term", `처분 ${M}`);
  assert.match(await page.locator("#synonym-new-term-hint").textContent(), new RegExp(`찾는 열쇠: 처분${M.toLowerCase()}`));
  await page.getByRole("button", { name: "동의어 더하기" }).click();
  assert.equal(await page.locator("#synonym-new-synonyms-error").textContent(), "동의어를 1개 이상 적으세요");
  assert.deepEqual(posts, []);
  await page.fill("#synonym-new-synonyms", "매각, 넘김");
  await page.getByRole("button", { name: "동의어 더하기" }).click();
  await page.getByRole("status").filter({ hasText: "동의어 사전에 더했습니다" }).waitFor();
  assert.deepEqual(posts, [{ term: `처분 ${M}`, synonyms: ["매각", "넘김"], enabled: true, note: null }]);
  const saved = await one("select id, term_key, enabled from public.search_synonyms where updated_by = $1 and term = $2", [`user:${u.editor.id}`, `처분 ${M}`]);
  staff.trackRow("search_synonyms", saved.id);
  const item = page.getByTestId(`synonym-${saved.id}`);
  await item.waitFor();
  assert.match(await item.textContent(), /사용 중/);
  assert.match(await item.textContent(), /함께 찾을 말: 매각, 넘김/);

  await item.getByText("고치기").click();
  await item.locator(`#synonym-${saved.id}-enabled`).uncheck();
  await item.getByRole("button", { name: "저장" }).click();
  await item.getByRole("status").filter({ hasText: "저장했습니다" }).waitFor();
  assert.equal((await one("select enabled from public.search_synonyms where id = $1", [saved.id])).enabled, false);
  await page.getByTestId(`synonym-${saved.id}`).filter({ hasText: "쉬는 중" }).waitFor();

  await page.getByRole("button", { name: `동의어 ‘처분 ${M}’ 줄 지우기` }).click();
  await page.getByTestId(`synonym-${saved.id}`).waitFor({ state: "detached" });
  assert.equal((await one("select count(*)::int n from public.search_synonyms where id = $1", [saved.id])).n, 0);

  const reporter = await login(u.reporter);
  assert.equal((await open(reporter, "/admin/dictionaries?tab=synonyms")).status(), 403);
});

test("화면 — 360px 가로 스크롤 0 (상황 카드 고치기·검색 동의어 탭)", async () => {
  const narrow = await login(u.editor, { width: 360, height: 740 });
  for (const p of [`/admin/situations/${fx.car}`, "/admin/dictionaries?tab=synonyms"]) {
    await open(narrow, p);
    assert.ok((await narrow.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${p}: 360px 가로 스크롤`);
  }
});

test("시험 동안 예상 못 한 서버 오류가 없었다", () => {
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[public\]|\[db\]|\[search\]/);
});
