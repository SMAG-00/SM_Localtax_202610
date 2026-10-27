// W13-a 수용 E2E - 지식창고 (docs/dev/W13-a_설계.md - PRD-05 LIB-01~07 · AIOPS-16, 5단계 설계 4.1 누출 경로 표)
// standalone 빌드를 로컬 Supabase에 붙인다. 출판물·칼럼 글은 전부 시험용 가짜이고 가격·한도 값은 시험값이다.
// 기능 키·미리보기·속도 제한 설정은 시험 동안만 바꾸고 끝나면 원래 값으로 되돌린다.
//  a) 키 꺼짐(기본) - 지식창고 화면 404
//  b) 비구독자·비로그인 - 응답 전체(본문·RSC 페이로드·메타·구조화 데이터)에 미리보기 밖 글자 0
//  c) 구독자 전문 -> 비구독자 순서 요청에서도 비구독자 응답에 전문 0, 응답 캐시 머리글이 공유 저장 허용 아님
//  d) 만료 직후 요청은 미리보기만
//  e) 권리 철회 - 관리자만, 다음 요청부터 404, 변경 기록 남음
//  f) 이관 API - 권리 확인 전 거부, 단계 건너뛰기 거부, 승인은 관리자만, 오류율 0.5% 초과 거부·이하 승인
//  g) 사이트맵·RSS에 지식창고 항목 0
//  h) 열람 속도 제한 - n번째 허용, n+1번째 제한 안내
//  i) 프리미엄 칼럼 - 미리보기만, 기사 주소 404, 검색에 본문 0
//  j) 지식창고 서버 코드에 AI SDK/호출·학습 경로·상속증여 엔진 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w13a-acceptance-e2e@example.test";
const SITE = "https://e2e-w13a.example.test";
const ROOT = path.resolve(import.meta.dirname, "..");
const HEAD = "시험용앞부분";
const SECRET = "비밀꼬리표시험";
const BODY = `${HEAD}${"가나다라".repeat(20)}${SECRET}`;

let sb, server, staff, db, base, saved, run;
const u = {};
const ids = { pubs: [], people: [], articles: [] };
let seq = 0;

async function startAll() {
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
  });
  base = server.base;
}
async function restart() {
  await server?.stop?.();
  await startAll();
}
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
  await restart(); // 공개 데이터 캐시 없이 새 출발점
}
const setting = (k, v) => db.query("update public.settings set value = $2::jsonb where key = $1", [k, JSON.stringify(v)]);
const count = (html, re) => (html.match(re) ?? []).length;
const unique = () => `${run}${++seq}`;
const ip = () => `10.${(seq % 200) + 1}.${(run.length * 7) % 250}.${(seq * 13) % 250 + 1}`;

async function cookieOf(user) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip() }, body: JSON.stringify({ email: user.email, password: user.password }) });
  assert.equal(res.status, 200, `로그인 ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
async function page(p, { cookie, xff } = {}) {
  const headers = { "x-forwarded-for": xff ?? `203.0.113.${(seq % 200) + 1}` };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${p}`, { redirect: "manual", headers });
  return { status: res.status, html: await res.text(), cache: res.headers.get("cache-control") ?? "" };
}
async function api(method, p, user, body) {
  const headers = { origin: base };
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { text };
  }
  return { status: res.status, body: parsed, text };
}
const lib = (user, body) => api("POST", "/api/admin/library", user, body);

const ACTOR = `admin:${ADMIN_EMAIL}`;
/** 승인된 월간지 권호 하나 + 프리미엄 기사 하나 (실제 경로: 권리 확인 -> 작업 -> 승인) */
async function approvedIssue({ sale = true } = {}) {
  const slug = `e2e-w13a-${unique()}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const pub = (await db.query("insert into public.publications (slug, title, kind) values ($1, '시험용 월간지', 'magazine') returning id", [slug])).rows[0].id;
  ids.pubs.push(pub);
  const issue = (await db.query("insert into public.magazine_issues (publication_id, issue_no, issued_on, as_of) values ($1, '시험 1호', '2026-01-10', '2026-01-01') returning id", [pub])).rows[0].id;
  const art = (await db.query("insert into public.magazine_articles (issue_id, ordinal, title, access_tier) values ($1, 0, '시험용 기사', 'premium') returning id", [issue])).rows[0].id;
  await db.query("insert into public.library_bodies (kind, ref_id, body) values ('issue_article', $1, $2)", [art, BODY]);
  for (const [table, id] of [["magazine_issues", issue], ["magazine_articles", art]]) {
    await db.query(`update public.${table} set rights_public = 'confirmed', rights_sale = $2, rights_ref = '시험용 계약', rights_confirmed_on = '2026-01-02' where id = $1`, [id, sale ? "confirmed" : "unchecked"]);
  }
  for (const [kind, id] of [["issue_article", art], ["issue", issue]]) {
    const job = (await db.query("select public.digitize_create($1, $2, '시험용.txt', $3) r", [kind, id, ACTOR])).rows[0].r.jobId;
    for (const to of ["extracted", "structured", "proofread"]) await db.query("select public.digitize_advance($1, $2, $3)", [job, to, ACTOR]);
    const ok = (await db.query("select public.digitize_approve($1, 100, 0, $2) r", [job, ACTOR])).rows[0].r;
    assert.equal(ok.ok, true, JSON.stringify(ok));
  }
  return { issue, art };
}
async function entitle(userId, until = "2099-01-01") {
  await db.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'library', 'manual', $2, '2026-01-01', $3)", [userId, `e2e-w13a-${unique()}`, until]);
}

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const issues = (await db.query("select i.id from public.magazine_issues i where i.publication_id = any($1::bigint[])", [ids.pubs])).rows.map((r) => r.id);
    const arts = (await db.query("select id from public.magazine_articles where issue_id = any($1::bigint[])", [issues])).rows.map((r) => r.id);
    await db.query("delete from public.library_bodies where kind = 'issue_article' and ref_id = any($1::bigint[])", [arts]);
    await db.query("delete from public.digitization_audit where actor = $1 or actor like 'user:%'", [ACTOR]);
    await db.query("delete from public.digitization_jobs where (target_kind = 'issue' and target_id = any($1::bigint[])) or (target_kind = 'issue_article' and target_id = any($2::bigint[])) or source_file = 'e2e-w13a.txt'", [issues, arts]);
    await db.query("delete from public.library_rights_log where (item_kind = 'issue' and item_id = any($1::bigint[])) or (item_kind = 'issue_article' and item_id = any($2::bigint[])) or (item_kind = 'column' and item_id = any($3::bigint[]))", [issues, arts, ids.articles]);
    await db.query("delete from public.magazine_articles where id = any($1::bigint[])", [arts]);
    await db.query("delete from public.magazine_issues where id = any($1::bigint[])", [issues]);
    await db.query("delete from public.publications where id = any($1::bigint[])", [ids.pubs]);
    await db.query("delete from public.paid_bodies where kind = 'column' and article_id = any($1::bigint[])", [ids.articles]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [ids.articles]);
    await db.query("delete from public.people where id = any($1::bigint[])", [ids.people]);
    await db.query("delete from public.library_abuse_log where at > now() - interval '1 day'");
    await db.query("delete from public.library_access_log where at > now() - interval '1 day'");
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  saved = (await db.query("select key, value from public.settings where key in ('feature_flags', 'library_preview', 'library_rate_limit', 'digitization_sample_error_max')")).rows;
  u.admin = await staff.createUser({ label: "w13a-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w13a-editor", roles: ["editor"], person: { name: "시험용 편집자", roles: ["editor"] } });
  u.sub = await staff.createUser({ label: "w13a-sub" });
  u.member = await staff.createUser({ label: "w13a-member" });
  await setting("library_preview", { chars: HEAD.length });
  await setting("library_rate_limit", { max: 1000, window_seconds: 60 });
  await db.query("update public.settings set value = value || '{\"library\": false, \"library_premium\": false}'::jsonb where key = 'feature_flags'");
  await restart();
  await purge();
});

after(async () => {
  try {
    await purge();
    for (const s of saved ?? []) await db.query("update public.settings set value = $2::jsonb where key = $1", [s.key, JSON.stringify(s.value)]);
  } finally {
    await staff?.cleanup();
    await server?.stop();
  }
});

test("a) 키 꺼짐(기본) - 지식창고 화면 404", async () => {
  const { issue } = await approvedIssue();
  assert.equal((await page(`/library/magazine/${issue}`)).status, 404);
  assert.equal((await page("/library/columns")).status, 404);
  assert.equal((await page("/library/wiki/1")).status, 404);
  assert.equal((await page("/library")).status, 404, "허브 404");
  const tax = await page("/tax");
  assert.equal(tax.status, 200);
  assert.equal(count(tax.html, /href="\/library"/g), 0, "키 꺼짐 - /tax 허브에 지식창고 링크 0");
  const store = await page("/store");
  if (store.status === 200) assert.equal(count(store.html, /href="\/library"/g), 0, "키 꺼짐 - /store에 지식창고 링크 0");
});

test("a2) 키 켜짐 - /tax 허브 링크 1개, /library 허브는 제목·발행일만(본문 0), 사이트맵·RSS 0", async () => {
  const { issue } = await approvedIssue();
  await setFlags({ library: true });
  const tax = await page("/tax");
  assert.equal(count(tax.html, /href="\/library"/g), 1, "/tax 허브 링크 1개");
  const store = await page("/store");
  if (store.status === 200) assert.equal(count(store.html, /href="\/library"/g), 1, "/store 링크 1개");
  const hub = await page("/library");
  assert.equal(hub.status, 200);
  assert.ok(hub.html.includes(`/library/magazine/${issue}`));
  assert.ok(hub.html.includes("2026-01-10"), "발행일");
  assert.equal(hub.html.includes(HEAD), false, "허브에 미리보기 글자 0");
  assert.equal(hub.html.includes(SECRET), false);
  for (const p of ["/sitemap.xml", "/rss"]) assert.equal((await page(p)).html.includes("/library"), false, `${p}`);
  await setFlags({ library: false });
});

test("b) 비구독자·비로그인 응답 전체(본문·메타·구조화 데이터·RSC 페이로드)에 미리보기 밖 글자 0", async () => {
  const { issue } = await approvedIssue();
  await setFlags({ library: true });
  for (const who of [undefined, await cookieOf(u.member)]) {
    const r = await page(`/library/magazine/${issue}`, { cookie: who });
    assert.equal(r.status, 200);
    assert.ok(r.html.includes(HEAD), "미리보기는 보인다");
    assert.equal(r.html.includes(SECRET), false, "꼬리 글자 0");
    assert.equal(r.html.includes("가나다라가나다라가나다라"), false, "본문 중간 글자 0");
    assert.match(r.html, /data-locked="true"/);
    assert.ok(r.html.includes('data-part="library-gate"'));
  }
});

test("c) 구독자 전문 -> 비구독자 순서로 요청해도 비구독자 응답에 전문 0, 캐시 머리글은 공유 저장 허용이 아니다", async () => {
  const { issue } = await approvedIssue();
  await entitle(u.sub.id);
  const subCookie = await cookieOf(u.sub);
  const full = await page(`/library/magazine/${issue}`, { cookie: subCookie });
  assert.equal(full.status, 200);
  assert.ok(full.html.includes(SECRET), "구독자는 전문");
  assert.ok(full.html.includes('data-part="library-watermark"'), "인쇄 워터마크");
  assert.equal(/public|s-maxage/i.test(full.cache), false, `구독자 응답 캐시 머리글 ${full.cache}`);
  const anon = await page(`/library/magazine/${issue}`);
  assert.equal(anon.html.includes(SECRET), false);
  assert.equal(/public|s-maxage/i.test(anon.cache), false);
});

test("d) 권한 만료 직후 요청은 미리보기만", async () => {
  const { issue } = await approvedIssue();
  await db.query("delete from public.entitlements where user_id = $1", [u.sub.id]);
  await entitle(u.sub.id, "2099-01-01");
  const cookie = await cookieOf(u.sub);
  assert.ok((await page(`/library/magazine/${issue}`, { cookie })).html.includes(SECRET));
  await db.query("update public.entitlements set valid_until = now() - interval '1 second', valid_from = now() - interval '2 days' where user_id = $1", [u.sub.id]);
  const after = await page(`/library/magazine/${issue}`, { cookie });
  assert.equal(after.html.includes(SECRET), false);
  assert.ok(after.html.includes(HEAD));
});

test("e) 권리 철회 - 관리자만 가능, 다음 요청부터 404, 변경 기록이 남는다", async () => {
  const { issue, art } = await approvedIssue();
  assert.equal((await page(`/library/magazine/${issue}`)).status, 200);
  const body = { op: "rights", item_kind: "issue_article", item_id: art, field: "rights_public", value: "restricted" };
  assert.equal((await lib(u.editor, body)).status, 403, "편집 책임자는 권리 기록 불가");
  assert.equal((await lib(u.admin, { ...body, value: "maybe" })).status, 422);
  const ok = await lib(u.admin, body);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const r = await page(`/library/magazine/${issue}`);
  assert.equal(r.html.includes(SECRET), false);
  const log = (await db.query("select old_value, new_value from public.library_rights_log where item_kind = 'issue_article' and item_id = $1 and field = 'rights_public' order by id", [art])).rows;
  assert.deepEqual(log.at(-1), { old_value: "confirmed", new_value: "restricted" });
});

test("f) 이관 API - 권리 확인 전 거부·단계 건너뛰기 거부·승인은 관리자만·오류율 경계", async () => {
  const pub = (await db.query("insert into public.publications (slug, title, kind) values ($1, '시험용 단행본', 'book') returning id", [`e2e-w13a-${unique()}`.toLowerCase().replace(/[^a-z0-9-]/g, "-")])).rows[0].id;
  ids.pubs.push(pub);
  const ed = (await db.query("insert into public.editions (publication_id, edition_label, as_of) values ($1, '시험 1판', '2026-01-01') returning id", [pub])).rows[0].id;
  const node = (await db.query("insert into public.pub_nodes (edition_id, depth, ordinal, title) values ($1, 1, 0, '시험용 장') returning id", [ed])).rows[0].id;
  const create = (user) => lib(user, { op: "create", target_kind: "node", target_id: node, source_file: "e2e-w13a.txt" });
  const denied = await create(u.editor);
  assert.equal(denied.status, 409);
  assert.equal(denied.body.code, "rights_not_confirmed");
  await db.query("update public.pub_nodes set rights_public = 'confirmed', rights_ref = '시험용 계약', rights_confirmed_on = '2026-01-02' where id = $1", [node]);
  const made = await create(u.editor);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const job = made.body.created.id;
  const skip = await lib(u.editor, { op: "advance", job_id: job, to: "structured" });
  assert.equal(skip.status, 409);
  assert.equal(skip.body.code, "skip");
  for (const to of ["extracted", "structured", "proofread"]) assert.equal((await lib(u.editor, { op: "advance", job_id: job, to })).status, 200);
  assert.equal((await lib(u.editor, { op: "approve", job_id: job, sample_size: 10000, sample_errors: 0 })).status, 403, "승인은 관리자만");
  await setting("digitization_sample_error_max", { percent: 0.5 });
  const over = await lib(u.admin, { op: "approve", job_id: job, sample_size: 10000, sample_errors: 51 });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, "error_rate");
  const ok = await lib(u.admin, { op: "approve", job_id: job, sample_size: 10000, sample_errors: 50 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await db.query("select status from public.pub_nodes where id = $1", [node])).rows[0].status, "approved");
});

test("g) 사이트맵·RSS에 지식창고 항목 0", async () => {
  const { issue } = await approvedIssue();
  for (const p of ["/sitemap.xml", "/rss", "/news-sitemap.xml"]) {
    const r = await page(p);
    assert.equal(r.html.includes("/library/"), false, `${p} 지식창고 주소`);
    assert.equal(r.html.includes(SECRET), false, `${p} 본문`);
    assert.equal(r.html.includes(`/library/magazine/${issue}`), false);
  }
});

test("h) 열람 속도 제한 - 한도 n번째 허용, n+1번째 제한 안내", async () => {
  const { issue } = await approvedIssue();
  await setting("library_rate_limit", { max: 2, window_seconds: 600 });
  const xff = `198.51.100.${(seq % 200) + 1}`;
  const a = await page(`/library/magazine/${issue}`, { xff });
  const b = await page(`/library/magazine/${issue}`, { xff });
  const c = await page(`/library/magazine/${issue}`, { xff });
  assert.ok(a.html.includes(HEAD) && b.html.includes(HEAD));
  assert.equal(c.html.includes(HEAD), false);
  assert.ok(c.html.includes('data-part="library-limited"'));
  assert.equal(Number((await db.query("select count(*)::int c from public.library_abuse_log where kind = 'rate'")).rows[0].c) >= 1, true);
  await setting("library_rate_limit", { max: 1000, window_seconds: 60 });
});

test("i) 프리미엄 칼럼 - 미리보기만, 기사 주소 404, 검색 결과에 본문 0", async () => {
  await setFlags({ library: true, library_premium: true });
  const person = (await db.query("insert into public.people (slug, name, roles, visibility, contract_status, contract_until) values ($1, '시험 필자', array['writer'], 'public', 'active', '2099-12-31') returning id", [`e2e-w13a-p-${unique()}`.toLowerCase().replace(/[^a-z0-9-]/g, "-")])).rows[0].id;
  await db.query("insert into public.name_likeness_consents (person_id, version, scope, doc_ref, recorded_by) values ($1, '시험용', array['column'], '시험용 위치', 'admin:e2e')", [person]);
  ids.people.push(person);
  const slug = `e2e-w13a-col-${unique()}`;
  const art = (await db.query("insert into public.articles (slug, title, section, content_type, status, author_id, body, access_tier, is_paid) values ($1, '시험용 프리미엄 칼럼', 'tax', 'opinion', 'draft', $2, '[]'::jsonb, 'premium', true) returning id", [slug, person])).rows[0].id;
  ids.articles.push(art);
  await db.query("insert into public.paid_bodies (kind, ref_key, article_id, preview, body, sale_allowed, rights_ref, sale_confirmed_on, edited_by) values ('column', $1::bigint::text, $1::bigint, '시험용 요약', $2, true, '시험용 계약', '2026-01-02', 'e2e')", [String(art), BODY]);
  await db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [art]);
  await restart();
  const list = await page("/library/columns");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes("시험용 프리미엄 칼럼"));
  assert.equal(list.html.includes(SECRET), false);
  const r = await page(`/library/columns/${art}`);
  assert.equal(r.status, 200);
  assert.ok(r.html.includes(HEAD));
  assert.equal(r.html.includes(SECRET), false);
  assert.equal((await page(`/news/${slug}`)).status, 404, "기사 주소로는 열리지 않는다");
  const search = await page(`/search?q=${encodeURIComponent(SECRET)}`);
  assert.equal(search.html.includes(`/library/columns/${art}`), false, "검색 결과에 프리미엄 칼럼 링크 0");
  await entitle(u.sub.id, "2099-01-01").catch(() => {});
  const full = await page(`/library/columns/${art}`, { cookie: await cookieOf(u.sub) });
  assert.ok(full.html.includes(SECRET), "구독자는 전문");
});

test("j) 지식창고 서버 코드에 AI SDK/호출·학습 경로·상속증여 엔진·외부 주소 0", () => {
  const dir = path.join(ROOT, "apps/web/lib/server/library");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.equal(/@anthropic-ai|openai|generativelanguage|fine[-_ ]?tun|training|embedding|@ltr\/igt-?engine/i.test(src), false, `${f}`);
    assert.equal(/\bfetch\(|https?:\/\//.test(src), false, `${f} 외부 호출`);
  }
});
