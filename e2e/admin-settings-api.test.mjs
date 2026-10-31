// 백오피스 운영 API E2E (W2-a 4-2) — 분야(CAT-01) · 사전(UX-01·UX-03) · 운영 설정 · 제휴사(ART-10) · 회원·역할·정지(ADM-02)
// standalone 빌드를 띄우고 로컬 Supabase(Auth·DB)에 붙인다. 상태 코드와 감사 로그 행, DB 값을 함께 본다.
// 사전·설정은 모두가 같이 쓰는 행이라, 시험 전 값을 기억했다가 끝나면 그대로 되돌린다 (e2e/lib/staff.mjs snapshotOperations).
// 만든 계정·기사·분야·제휴사·용어·감사 로그는 끝나면 지운다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "admin-settings-e2e@example.test";
const SITE = "https://e2e.example.test";

let sb, server, staff, db;
const u = {};

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
const auditCount = async (userId, action, target) =>
  (await one("select count(*)::int n from public.audit_logs where actor = $1 and action = $2 and target = $3", [`user:${userId}`, action, target])).n;
const lastAudit = (userId, action, target) =>
  one("select before, after, reason from public.audit_logs where actor = $1 and action = $2 and target = $3 order by id desc limit 1", [`user:${userId}`, action, target]);
const setting = async (key) => (await one("select value from public.settings where key = $1", [key])).value;
/** 한국 날짜 YYYY-MM-DD (오늘 + days) */
const kstDay = (days = 0) => new Date(Date.now() + 9 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);

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
  await staff.snapshotOperations();

  u.reporter = await staff.createUser({ label: "ops-reporter", roles: ["reporter"], person: { name: "운영 시험 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "ops-editor", roles: ["editor"], person: { name: "운영 시험 편집자", roles: ["editor"] } });
  u.adOps = await staff.createUser({ label: "ops-ad", roles: ["ad_ops"], person: { name: "운영 시험 광고 담당", roles: ["writer"] } });
  u.admin = await staff.createUser({ label: "ops-admin", email: ADMIN_EMAIL });
  u.target = await staff.createUser({ label: "ops-target", roles: ["reporter"], person: { name: "정지 시험 기자", roles: ["reporter"] } });
  u.plain = await staff.createUser({ label: "ops-plain-member" });
});

after(async () => {
  try {
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

// ── 분야 (CAT-01) ─────────────────────────────────────

test("분야 목록 — 편집 책임자·관리자 200, 기자·광고 담당 403", async () => {
  const r = await api("GET", "/categories", u.editor);
  assert.equal(r.status, 200, show(r));
  const seed = (await db.query("select count(*)::int n from public.categories")).rows[0].n;
  assert.equal(r.body.categories.length, seed);
  assert.deepEqual([...new Set(r.body.categories.map((c) => c.section))].sort(), ["finance", "local", "realestate", "tax"]);
  assert.equal((await api("GET", "/categories", u.admin)).status, 200);
  for (const who of [u.reporter, u.adOps]) assert.equal((await api("GET", "/categories", who)).status, 403);
});

test("하위 분야 더하기·고치기 — 편집 책임자 200·감사 로그 전후 값, 기자 403·바뀜 0, 허브·발행 판정 주소는 못 바꿈", async () => {
  const slug = `e2e-${staff.run}`;
  const created = await api("POST", "/categories", u.editor, { section: "finance", slug, name: `시험 분야 ${staff.run}`, intro: "시험용 하위 분야입니다." });
  assert.equal(created.status, 201, show(created));
  const id = created.body.category.id;
  staff.trackRow("categories", id);
  const maxSort = (await one("select max(sort)::int m from public.categories where section = 'finance' and id <> $1", [id])).m;
  assert.equal(created.body.category.sort, maxSort + 10, "순서를 주지 않으면 그 분야 맨 끝");
  assert.equal(await auditCount(u.editor.id, "category.create", `categories:${id}`), 1);

  const renamed = await api("PATCH", `/categories/${id}`, u.editor, { name: `고친 분야 ${staff.run}`, visible: true });
  assert.equal(renamed.status, 200, show(renamed));
  assert.deepEqual(renamed.body.changed.sort(), ["name", "visible"]);
  const audit = await lastAudit(u.editor.id, "category.update", `categories:${id}`);
  assert.deepEqual(audit.before, { name: `시험 분야 ${staff.run}`, visible: false });
  assert.deepEqual(audit.after, { name: `고친 분야 ${staff.run}`, visible: true });

  const byReporter = await api("PATCH", `/categories/${id}`, u.reporter, { name: "기자가 고침" });
  assert.equal(byReporter.status, 403, show(byReporter));
  assert.equal((await one("select name from public.categories where id = $1", [id])).name, `고친 분야 ${staff.run}`);

  const hub = await api("PATCH", `/categories/${id}`, u.editor, { section: "local" });
  assert.equal(hub.status, 422, show(hub));
  assert.match(hub.body.errors[0], /분야\(허브\)는 바꿀 수 없습니다/);
  const badSection = await api("POST", "/categories", u.editor, { section: "tourism", slug: `${slug}-x`, name: "관광" });
  assert.equal(badSection.status, 422, "허브 값이 4개 밖이면 저장 거부");
  const badSlug = await api("PATCH", `/categories/${id}`, u.editor, { slug: "Bad Slug" });
  assert.equal(badSlug.status, 422);
  const dup = await api("POST", "/categories", u.editor, { section: "finance", slug, name: `다른 이름 ${staff.run}` });
  assert.equal(dup.status, 409, show(dup));

  const amendments = await one("select id, slug from public.categories where section = 'tax' and slug = 'amendments'");
  const locked = await api("PATCH", `/categories/${amendments.id}`, u.editor, { slug: "amendment-briefing" });
  assert.equal(locked.status, 409, show(locked));
  assert.match(locked.body.error, /CAT-04/);
  assert.equal((await one("select slug from public.categories where id = $1", [amendments.id])).slug, "amendments");

  const forbidden = await api("PATCH", `/categories/${id}`, u.editor, { intro: "이 분야는 절세 보장을 다룹니다." });
  assert.equal(forbidden.status, 422, show(forbidden));
  assert.ok(forbidden.body.failed.includes("ux01.forbidden-phrase"), show(forbidden));
  assert.equal((await one("select intro from public.categories where id = $1", [id])).intro, "시험용 하위 분야입니다.", "금지 표현이 든 소개는 저장되지 않는다");

  const long = "이 하위 분야는 지방세와 부동산 개발 금융 구조를 함께 다루면서 세금 영향을 쉬운 말로 풀어 설명하고 독자가 신고 일정과 준비 서류를 한눈에 확인하도록 돕는 기사를 모아 두는 곳입니다.";
  const warned = await api("PATCH", `/categories/${id}`, u.editor, { intro: long });
  assert.equal(warned.status, 200, show(warned));
  assert.ok(warned.body.checks.some((f) => f.id === "ux01.guide-sentence-long"), "60자 넘는 안내 문장은 저장되고 경고만");
});

test("하위 분야 순서 바꾸기 — 그 분야 전부를 10 간격으로, 감사 로그 1줄 · 빠진 번호 422 · 광고 담당 403", async () => {
  const before = (await db.query("select id, sort from public.categories where section = 'local' order by sort, id")).rows.map((r) => ({ id: Number(r.id), sort: r.sort }));
  const reversed = before.map((r) => r.id).reverse();
  const r = await api("POST", "/categories/order", u.editor, { section: "local", ids: reversed });
  assert.equal(r.status, 200, show(r));
  const after = (await db.query("select id, sort from public.categories where section = 'local' order by sort, id")).rows.map((x) => ({ id: Number(x.id), sort: x.sort }));
  assert.deepEqual(after.map((x) => x.id), reversed);
  assert.deepEqual(after.map((x) => x.sort), reversed.map((_, i) => (i + 1) * 10));
  const audit = await lastAudit(u.editor.id, "category.reorder", "categories:order:local");
  assert.deepEqual(audit.before.order, before);

  const missing = await api("POST", "/categories/order", u.editor, { section: "local", ids: reversed.slice(1) });
  assert.equal(missing.status, 422, show(missing));
  const denied = await api("POST", "/categories/order", u.adOps, { section: "local", ids: reversed });
  assert.equal(denied.status, 403);
});

// ── 사전 (UX-01 · UX-03) — 배포 없이 다음 점검부터 ─────────────

test("금지 표현·공포 표현 — 사전에 더하면 점검 API가 바로 잡고, 빼면 사라진다 (settings 키·모양 그대로)", async () => {
  const banned = `금지시험${staff.run}`;
  const scary = `공포시험${staff.run}`;
  const created = await api("POST", "/articles", u.reporter, {
    slug: `e2e-dict-${staff.run}`,
    title: `사전 시험 기사 ${staff.run}`,
    section: "tax",
    contentType: "explainer",
    body: { blocks: [{ type: "paragraph", text: `이 문단에는 ${banned} 표현과 ${scary} 표현이 있다.` }], claims: [] },
  });
  assert.equal(created.status, 201, show(created));
  const articleId = created.body.article.id;
  staff.trackArticle(articleId);
  const phraseHits = async (id) => {
    const c = await api("GET", `/articles/${articleId}/check`, u.reporter);
    assert.equal(c.status, 200, show(c));
    return c.body.findings.filter((f) => f.id === id && f.location?.phrase).map((f) => f.location.phrase);
  };
  assert.deepEqual(await phraseHits("ux01.forbidden-phrase"), []);

  const beforeValue = await setting("forbidden_phrases");
  const add = await api("POST", "/dictionaries/forbidden", u.editor, { op: "add", phrase: banned });
  assert.equal(add.status, 200, show(add));
  const stored = await setting("forbidden_phrases");
  assert.deepEqual(Object.keys(stored).sort(), ["phrases", "version"], "발행 판정이 읽는 모양 { version, phrases } 그대로");
  assert.deepEqual(stored.phrases, [...beforeValue.phrases, banned]);
  assert.notEqual(stored.version, beforeValue.version);
  assert.equal(await auditCount(u.editor.id, "dictionary.add", "settings:forbidden_phrases"), 1);
  assert.deepEqual(await phraseHits("ux01.forbidden-phrase"), [banned], "배포 없이 다음 점검부터 잡힌다");
  // 간편 발행 (2026-10-31 PO 결정) — 금지 표현은 발행을 막지 않고 경고(발행 기록)로 남는다
  const warned = await api("GET", `/articles/${articleId}/check`, u.reporter);
  assert.ok(warned.body.warnings.includes("ux01.forbidden-phrase") && !warned.body.failed.includes("ux01.forbidden-phrase"), show(warned));

  assert.equal((await api("POST", "/dictionaries/forbidden", u.editor, { op: "add", phrase: ` ${banned} ` })).status, 409, "이미 있는 표현");
  assert.equal((await api("POST", "/dictionaries/forbidden", u.reporter, { op: "add", phrase: "기자 표현" })).status, 403);
  assert.equal((await api("POST", "/dictionaries/unknown", u.editor, { op: "add", phrase: "x" })).status, 404);
  assert.equal((await api("POST", "/dictionaries/forbidden", u.editor, { op: "add", phrase: "가".repeat(41) })).status, 422);

  const remove = await api("POST", "/dictionaries/forbidden", u.editor, { op: "remove", phrase: banned });
  assert.equal(remove.status, 200, show(remove));
  assert.deepEqual((await setting("forbidden_phrases")).phrases, beforeValue.phrases);
  assert.deepEqual(await phraseHits("ux01.forbidden-phrase"), [], "사전에서 지우면 다음 점검부터 잡히지 않는다");
  assert.equal((await api("POST", "/dictionaries/forbidden", u.editor, { op: "remove", phrase: banned })).status, 404);
  const removedAudit = await lastAudit(u.editor.id, "dictionary.remove", "settings:forbidden_phrases");
  assert.ok(removedAudit.before.phrases.includes(banned) && !removedAudit.after.phrases.includes(banned), "감사 로그에 전후 목록");

  assert.equal((await api("POST", "/dictionaries/fear", u.admin, { op: "add", phrase: scary })).status, 200, "관리자도 사전을 고친다");
  assert.deepEqual(await phraseHits("ux03.fear-phrase"), [scary]);
  assert.equal((await api("POST", "/dictionaries/fear", u.editor, { op: "remove", phrase: scary })).status, 200);
  assert.deepEqual(await phraseHits("ux03.fear-phrase"), []);

  const all = await api("GET", "/dictionaries", u.editor);
  assert.equal(all.status, 200, show(all));
  assert.deepEqual(all.body.forbidden.phrases, beforeValue.phrases);
  assert.ok(Array.isArray(all.body.glossary));
});

test("쉬운 말 사전 — 용어를 더하면 '풀이 없는 첫 등장' 경고가 생기고 지우면 사라진다 · 풀이 121자·풀이 없는 전문 용어 422 · 61자·숫자 + 단위는 저장 경고(201·200) · 공개·숨김 감사 로그", async () => {
  const term = `시험용어${staff.run}`;
  const created = await api("POST", "/articles", u.reporter, {
    slug: `e2e-glossary-${staff.run}`,
    title: `용어 시험 기사 ${staff.run}`,
    section: "tax",
    contentType: "explainer",
    body: { blocks: [{ type: "paragraph", text: `${term}를 처음 쓰는 문단이다.` }], claims: [] },
  });
  assert.equal(created.status, 201, show(created));
  staff.trackArticle(created.body.article.id);
  const jargon = async () => {
    const c = await api("GET", `/articles/${created.body.article.id}/check`, u.reporter);
    return c.body.findings.filter((f) => f.id === "ux01.jargon-unexplained" && f.location?.phrase === term).length;
  };
  assert.equal(await jargon(), 0);

  // W2-d 3단계 — GLO-01 '61자는 저장 경고': 121자(저장 한도 120자 밖)만 거부, 61자는 저장되고 경고 (W2-d 설계 2.5)
  assert.equal((await api("POST", "/glossary", u.editor, { term, plain: "가".repeat(121) })).status, 422, "쉬운 풀이 121자");
  assert.equal((await api("POST", "/glossary", u.editor, { term, jargon: true })).status, 422, "전문 용어인데 풀이 없음");
  const add = await api("POST", "/glossary", u.editor, { term, plain: "가".repeat(61), section: ["tax"] });
  assert.equal(add.status, 201, show(add));
  const termId = add.body.term.id;
  staff.trackRow("glossary_terms", termId);
  assert.equal(add.body.term.visible, false, "새 용어는 숨김");
  assert.deepEqual(add.body.warnings.map((w) => [w.id, w.field]), [["glo01.plain-long", "plain"]]);
  assert.match(add.body.warnings[0].message, /61자/);
  assert.equal((await one("select char_length(plain) n from public.glossary_terms where id = $1", [termId])).n, 61, "61자 그대로 저장");
  assert.equal(await auditCount(u.editor.id, "glossary.create", `glossary_terms:${termId}`), 1);
  assert.equal(await jargon(), 1, "다음 점검부터 풀이 없는 첫 등장 경고");
  assert.equal((await api("POST", "/glossary", u.editor, { term, plain: "다른 풀이" })).status, 409, "같은 용어");

  const edit = await api("PATCH", `/glossary/${termId}`, u.editor, { plain: "쉬운 풀이" });
  assert.equal(edit.status, 200, show(edit));
  assert.deepEqual(edit.body.warnings, [], "60자 이하·숫자 없음 — 경고 0");
  assert.deepEqual((await lastAudit(u.editor.id, "glossary.update", `glossary_terms:${termId}`)).after, { plain: "쉬운 풀이" });
  assert.equal((await api("PATCH", `/glossary/${termId}`, u.reporter, { plain: "x" })).status, 403);
  // 숫자 + 단위 — 풀이·뜻 칸마다 경고, 저장은 된다
  const numbers = await api("PATCH", `/glossary/${termId}`, u.editor, { plain: "가짜 풀이 3%", definition: "가짜 뜻 85㎡" });
  assert.equal(numbers.status, 200, show(numbers));
  assert.deepEqual(numbers.body.warnings.map((w) => [w.id, w.field]), [["glo01.number-unit", "plain"], ["glo01.number-unit", "definition"]]);
  // 공개·숨김 — 따로 감사 로그(glossary.publish·glossary.unpublish), 내용 고치기 로그는 늘지 않는다
  const updates = await auditCount(u.editor.id, "glossary.update", `glossary_terms:${termId}`);
  const shown = await api("PATCH", `/glossary/${termId}`, u.editor, { visible: true });
  assert.equal(shown.status, 200, show(shown));
  assert.equal(shown.body.term.visible, true);
  assert.deepEqual((await lastAudit(u.editor.id, "glossary.publish", `glossary_terms:${termId}`)).after, { visible: true });
  assert.equal((await api("PATCH", `/glossary/${termId}`, u.editor, { visible: false })).status, 200);
  const hid = await lastAudit(u.editor.id, "glossary.unpublish", `glossary_terms:${termId}`);
  assert.deepEqual([hid.before, hid.after], [{ visible: true }, { visible: false }]);
  assert.equal(await auditCount(u.editor.id, "glossary.update", `glossary_terms:${termId}`), updates, "공개 상태만 바꾸면 내용 고치기 로그 0");
  assert.equal((await api("PATCH", `/glossary/${termId}`, u.reporter, { visible: true })).status, 403, "기자는 공개 상태를 바꾸지 못한다");
  assert.equal((await api("PATCH", `/glossary/${termId}`, u.editor, { visible: "yes" })).status, 422);

  const del = await api("DELETE", `/glossary/${termId}`, u.editor);
  assert.equal(del.status, 200, show(del));
  assert.equal((await one("select count(*)::int n from public.glossary_terms where id = $1", [termId])).n, 0);
  assert.equal((await lastAudit(u.editor.id, "glossary.delete", `glossary_terms:${termId}`)).before.term, term);
  assert.equal(await jargon(), 0);
});

// ── 운영 설정 (관리자만) ───────────────────────────────

test("운영 설정 — 편집 책임자 403·감사 로그·바뀜 0, 관리자 200(다음 점검이 새 기준), 잘못된 JSON·모양 422, 낡은 값 409", async () => {
  const original = await setting("similarity_internal");
  const next = { ...original, version: `e2e-similarity-${staff.run}`, quoteRatio: 0.25 };

  assert.equal((await api("GET", "/settings", u.editor)).status, 403);
  const byEditor = await api("PATCH", "/settings/similarity_internal", u.editor, { value: next });
  assert.equal(byEditor.status, 403, show(byEditor));
  assert.equal(await auditCount(u.editor.id, "settings.edit.denied", "settings:similarity_internal"), 1);
  assert.deepEqual(await setting("similarity_internal"), original, "거부된 호출은 값을 바꾸지 않는다");

  const list = await api("GET", "/settings", u.admin);
  assert.equal(list.status, 200, show(list));
  const keys = list.body.settings.map((s) => s.key);
  for (const k of ["forbidden_phrases", "fear_phrases", "similarity_internal", "amendment_confirmed_stage"]) assert.ok(keys.includes(k), k);
  const row = list.body.settings.find((s) => s.key === "similarity_internal");
  assert.equal(row.editable, true);

  const badJson = await api("PATCH", "/settings/similarity_internal", u.admin, { valueJson: "{ sentenceSimilarity: 0.9 " });
  assert.equal(badJson.status, 422, show(badJson));
  assert.match(badJson.body.error, /JSON 형식이 아닙니다/);
  const outOfRange = await api("PATCH", "/settings/similarity_internal", u.admin, { valueJson: JSON.stringify({ ...next, sentenceSimilarity: 1.5 }) });
  assert.equal(outOfRange.status, 422, show(outOfRange));
  assert.deepEqual(outOfRange.body.errors, ["sentenceSimilarity: 0~1 사이 숫자여야 합니다"]);
  const sameVersion = await api("PATCH", "/settings/similarity_internal", u.admin, { value: { ...original, quoteRatio: 0.25 } });
  assert.equal(sameVersion.status, 422);
  assert.match(sameVersion.body.errors[0], /버전도 바꿔야/);
  const stage = await api("PATCH", "/settings/amendment_confirmed_stage", u.admin, { value: "공포" });
  assert.equal(stage.status, 422);
  assert.equal((await api("PATCH", "/settings/no_such_key", u.admin, { value: 1 })).status, 404);
  assert.deepEqual(await setting("similarity_internal"), original, "검사에 걸린 값은 저장되지 않는다");

  const ok = await api("PATCH", "/settings/similarity_internal", u.admin, { valueJson: JSON.stringify(next), updatedAt: row.updatedAt, reason: "E2E 인용 비율 시험" });
  assert.equal(ok.status, 200, show(ok));
  assert.deepEqual(await setting("similarity_internal"), next);
  const audit = await lastAudit(u.admin.id, "settings.update", "settings:similarity_internal");
  assert.deepEqual(audit.before.value, original);
  assert.deepEqual(audit.after.value, next);
  assert.equal(audit.reason, "E2E 인용 비율 시험");

  const stale = await api("PATCH", "/settings/similarity_internal", u.admin, { value: { ...next, version: `${next.version}-2` }, updatedAt: row.updatedAt });
  assert.equal(stale.status, 409, show(stale));

  // 다음 점검이 새 기준 버전을 쓴다 (배포 없음)
  const article = await api("POST", "/articles", u.reporter, { slug: `e2e-sim-${staff.run}`, title: `유사도 기준 시험 ${staff.run}`, section: "tax", contentType: "explainer" });
  assert.equal(article.status, 201, show(article));
  staff.trackArticle(article.body.article.id);
  const check = await api("GET", `/articles/${article.body.article.id}/check`, u.reporter);
  assert.equal(check.status, 200, show(check));
  assert.equal(check.body.similarity.rulesVersion, next.version);

  const restore = await api("PATCH", "/settings/similarity_internal", u.admin, { value: original });
  assert.equal(restore.status, 200, show(restore));
  assert.deepEqual(await setting("similarity_internal"), original);
});

// ── 제휴사 (ART-10) ───────────────────────────────────

test("제휴사 — 광고 담당 등록 201·감사 로그, 편집 책임자 등록 403·목록 200(읽기만), 기자 목록 403, 잘못된 기간·종류 422", async () => {
  const body = { name: `시험세무법인 ${staff.run}`, kind: "tax_firm", contractFrom: kstDay(-30), contractTo: kstDay(30), url: "https://tax-firm.example" };
  const created = await api("POST", "/partners", u.adOps, body);
  assert.equal(created.status, 201, show(created));
  const id = created.body.partner.id;
  staff.trackRow("partners", id);
  assert.equal(created.body.partner.status, "active");
  assert.equal(await auditCount(u.adOps.id, "partner.create", `partners:${id}`), 1);

  const byEditor = await api("POST", "/partners", u.editor, { ...body, name: "편집자 등록" });
  assert.equal(byEditor.status, 403, show(byEditor));
  assert.equal((await one("select count(*)::int n from public.partners where name = '편집자 등록'")).n, 0);
  const editorList = await api("GET", "/partners", u.editor);
  assert.equal(editorList.status, 200, show(editorList));
  assert.ok(editorList.body.partners.some((p) => p.id === id && p.status === "active"));
  assert.equal((await api("GET", "/partners", u.reporter)).status, 403);
  assert.equal((await api("PATCH", `/partners/${id}`, u.editor, { intro: "편집자가 고침" })).status, 403);

  assert.equal((await api("PATCH", `/partners/${id}`, u.adOps, { contractTo: kstDay(-60) })).status, 422, "종료일이 시작일보다 앞");
  assert.equal((await api("POST", "/partners", u.adOps, { ...body, kind: "bank" })).status, 422);
  const edit = await api("PATCH", `/partners/${id}`, u.adOps, { intro: "지방세 실무 공동 기획", visible: true });
  assert.equal(edit.status, 200, show(edit));
  assert.deepEqual((await lastAudit(u.adOps.id, "partner.update", `partners:${id}`)).after, { intro: "지방세 실무 공동 기획", visible: true });
});

test("계약이 끝난 제휴사는 새 기사에 지정할 수 없다 — 저장 422, 계약 중이면 201, 이미 지정된 기사는 배지가 남고 다른 칸 저장은 된다", async () => {
  const expired = await api("POST", "/partners", u.adOps, { name: `끝난제휴 ${staff.run}`, kind: "media", contractFrom: kstDay(-90), contractTo: kstDay(-1) });
  const active = await api("POST", "/partners", u.adOps, { name: `계약중제휴 ${staff.run}`, kind: "institution", contractTo: kstDay(0) });
  assert.equal(expired.status, 201, show(expired));
  assert.equal(active.status, 201, show(active));
  staff.trackRow("partners", expired.body.partner.id);
  staff.trackRow("partners", active.body.partner.id);
  assert.equal(expired.body.partner.status, "expired");
  assert.equal(active.body.partner.status, "active", "종료일 당일까지 계약 중");

  const draft = (partnerId, name) => ({ slug: `e2e-co-${name}-${staff.run}`, title: `공동 기획 시험 ${name} ${staff.run}`, section: "tax", contentType: "sponsored", label: "co_planned", partnerId });
  const blocked = await api("POST", "/articles", u.adOps, draft(expired.body.partner.id, "expired"));
  assert.equal(blocked.status, 422, show(blocked));
  assert.deepEqual(blocked.body.failed, ["art10.partner-contract-expired"]);
  assert.equal((await one("select count(*)::int n from public.articles where slug = $1", [`e2e-co-expired-${staff.run}`])).n, 0);

  const ok = await api("POST", "/articles", u.adOps, draft(active.body.partner.id, "active"));
  assert.equal(ok.status, 201, show(ok));
  const articleId = ok.body.article.id;
  staff.trackArticle(articleId);
  const swap = await api("PATCH", `/articles/${articleId}`, u.adOps, { partnerId: expired.body.partner.id });
  assert.equal(swap.status, 422, show(swap));
  assert.deepEqual(swap.body.failed, ["art10.partner-contract-expired"]);
  assert.equal(Number((await one("select partner_id from public.articles where id = $1", [articleId])).partner_id), active.body.partner.id);

  // 지정 뒤 계약이 끝나도 배지는 남는다 — 다른 칸 저장은 되고, 발행 판정은 새 기사(첫 발행 전)라 막는다
  assert.equal((await api("PATCH", `/partners/${active.body.partner.id}`, u.adOps, { contractTo: kstDay(-1) })).status, 200);
  const other = await api("PATCH", `/articles/${articleId}`, u.adOps, { summary: "요약만 고친다." });
  assert.equal(other.status, 200, show(other));
  const check = await api("GET", `/articles/${articleId}/check`, u.adOps);
  assert.equal(check.status, 200, show(check));
  assert.ok(check.body.failed.includes("art10.partner-contract-expired"));
});

// ── 회원·역할·정지 (ADM-02) ────────────────────────────

test("회원 목록 — 관리자: 편집국 계정(역할·인물), 이메일 검색은 일반 계정도 / 편집 책임자 403", async () => {
  const r = await api("GET", "/members", u.admin);
  assert.equal(r.status, 200, show(r));
  const byId = new Map(r.body.members.map((m) => [m.userId, m]));
  assert.deepEqual(byId.get(u.editor.id).roles, ["editor"]);
  assert.equal(byId.get(u.editor.id).person.name, "운영 시험 편집자");
  assert.deepEqual(byId.get(u.adOps.id).roles, ["ad_ops"]);
  assert.equal(byId.has(u.plain.id), false, "역할·인물 없는 계정은 기본 목록에 없다");
  assert.equal(byId.get(u.target.id).suspended, false);

  const q = u.plain.email.split("@")[0];
  const search = await api("GET", `/members?q=${encodeURIComponent(q.toUpperCase())}`, u.admin);
  assert.equal(search.status, 200, show(search));
  const found = search.body.members.find((m) => m.userId === u.plain.id);
  assert.ok(found, show(search));
  assert.equal(found.isStaff, false);
  assert.deepEqual(found.roles, []);
  assert.equal((await api("GET", "/members?q=a", u.admin)).status, 422);
  assert.equal((await api("GET", "/members", u.editor)).status, 403);
});

test("계정 정지 — 그 계정의 토큰이 바로 401, 로그인 거부, 해제하면 다시 로그인 · 편집 책임자 403·감사 로그 · 자기 계정 409", async () => {
  const target = `members:${u.target.id}`;
  assert.equal((await api("GET", "/me", u.target)).status, 200);

  const byEditor = await api("POST", `/members/${u.target.id}/suspension`, u.editor, { suspend: true, reason: "편집자 시도" });
  assert.equal(byEditor.status, 403, show(byEditor));
  assert.equal(await auditCount(u.editor.id, "member.suspend.denied", target), 1);
  assert.equal((await api("GET", "/me", u.target)).status, 200, "거부된 시도는 계정을 바꾸지 않는다");

  assert.equal((await api("POST", `/members/${u.target.id}/suspension`, u.admin, { suspend: true })).status, 422, "사유 필수");
  const self = await api("POST", `/members/${u.admin.id}/suspension`, u.admin, { suspend: true, reason: "자기 정지" });
  assert.equal(self.status, 409, show(self));
  assert.equal((await api("POST", "/members/00000000-0000-4000-8000-000000000000/suspension", u.admin, { suspend: true, reason: "없음" })).status, 404);

  const suspend = await api("POST", `/members/${u.target.id}/suspension`, u.admin, { suspend: true, reason: "E2E 정지 시험" });
  assert.equal(suspend.status, 200, show(suspend));
  assert.equal(suspend.body.member.suspended, true);
  assert.ok(Date.parse(suspend.body.member.bannedUntil) > Date.now());
  const audit = await lastAudit(u.admin.id, "member.suspend", target);
  assert.equal(audit.before.suspended, false);
  assert.equal(audit.after.suspended, true);
  assert.equal(audit.reason, "E2E 정지 시험");

  const stale = await api("GET", "/me", u.target);
  assert.equal(stale.status, 401, `정지 전에 받은 토큰도 거부: ${show(stale)}`);
  assert.equal((await api("POST", "/articles", u.target, { slug: `e2e-banned-${staff.run}`, title: "정지된 기자", section: "tax", contentType: "explainer" })).status, 401);
  await assert.rejects(() => staff.signIn(u.target.email, u.target.password), /로그인 실패/, "정지된 계정은 로그인할 수 없다");

  const unsuspend = await api("POST", `/members/${u.target.id}/suspension`, u.admin, { suspend: false, reason: "E2E 정지 해제" });
  assert.equal(unsuspend.status, 200, show(unsuspend));
  assert.equal(unsuspend.body.member.suspended, false);
  assert.equal(await auditCount(u.admin.id, "member.unsuspend", target), 1);
  const token = await staff.signIn(u.target.email, u.target.password);
  assert.equal((await api("GET", "/me", token)).status, 200, "해제하면 다시 로그인한다");
});

test("역할 부여 — 편집 책임자 403 + 감사 로그, 관리자의 겸직 금지 조합 409 + 감사 로그 (회원 화면이 부르는 API)", async () => {
  const denied = await api("POST", "/roles", u.editor, { userId: u.plain.id, role: "reporter" });
  assert.equal(denied.status, 403, show(denied));
  assert.equal(await auditCount(u.editor.id, "role.grant.denied", `staff_roles:${u.plain.id}`), 1);
  assert.equal((await one("select count(*)::int n from public.staff_roles where user_id = $1", [u.plain.id])).n, 0);
  const combo = await api("POST", "/roles", u.admin, { userId: u.editor.id, role: "ad_ops" });
  assert.equal(combo.status, 409, show(combo));
  assert.equal(await auditCount(u.admin.id, "role.grant.rejected", `staff_roles:${u.editor.id}`), 1);
});

test("시험 동안 예상 못 한 서버 오류(500)가 없었다", async () => {
  const log = server.log();
  for (const mark of ["[api] 처리 중 오류", "[db] ", "[audit] ", "[members] "]) assert.ok(!log.includes(mark), log.slice(-3000));
});
