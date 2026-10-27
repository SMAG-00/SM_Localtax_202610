// W13-i 수용 E2E - 네이버 연재·제휴 피드·데이터 라이선스 (docs/dev/W13-i_설계.md - PRD-05 CH-02 · PART-01 · BIZ-11)
// standalone 빌드를 로컬 Supabase에 붙인다. 계약·기사·제휴사는 전부 시험용 가짜다. 기능 키·한도 설정은 시험 동안만 바꾸고 끝나면 되돌린다.
//  a) 권한 - 편집 책임자 403, 비로그인 401, 관리자만 키·계약 API 통과
//  b) 키 발급 - 계약 없으면 409, 계약 기록 뒤 발급 201, 키 원문은 응답에만 있고 DB에는 해시만 (원문·비밀 포함 칸 0)
//  c) 피드 - 키 없음·틀린 키 401 · 기능 키 꺼짐 503 · 한도 값 없음 503 · 분당 한도 n번째 200 / n+1번째 429 · 폐기 뒤 401 · 계약 종료 뒤 401
//  d) 내용 - RSS·JSON에 무료 공개 기사만(유료 기사 제목·본문 0), 요약 범위에 본문 0, 항목마다 원문 링크·출처
//  e) 연재 - 기능 키 꺼짐이면 원고 준비 409, 계약 없는 원고 내려받기 409, 화면·원고에 '네이버 제휴 언론사' 표현 0
//  f) 외부 호출 0 - 이 단위 서버 소스에 네이버 주소·fetch·AI SDK import 0
// 만든 행은 끝나면 지우고 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w13i-acceptance-e2e@example.test";
const SITE = "https://e2e-w13i.example.test";
const PEPPER = "e2e-w13i-pepper-0123456789";
const ROOT = path.resolve(import.meta.dirname, "..");
const FREE_TITLE = "시험용 무료 공개 기사 W13I";
const PAID_TITLE = "시험용 유료 기사 W13I";
const PAID_BODY = "시험용유료본문표식W13I";

let sb, server, staff, db, base, saved;
const u = {};
const made = { partner: null, articles: [], people: [] };

async function api(method, p, user, body) {
  const headers = { origin: base };
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const feedsApi = (user, body) => api("POST", "/api/admin/feeds", user, body);
const licApi = (user, body) => api("POST", "/api/admin/licenses", user, body);
const feed = (key, q = "") => fetch(`${base}/api/feeds${q}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
const serverEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
  ADMIN_EMAILS: ADMIN_EMAIL,
  NEXT_PUBLIC_SITE_URL: SITE,
  PARTNER_FEED_KEY_PEPPER: PEPPER,
});
async function setSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (key === "feature_flags") {
      const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
      await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...value })]);
    } else {
      await db.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
    }
  }
}
async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.partner_feed_usage where feed_id in (select id from public.partner_feeds where issued_by like 'admin:%')");
    await db.query("delete from public.partner_feeds where partner_id = any($1::bigint[])", [made.partner ? [made.partner] : []]);
    await db.query("delete from public.license_contracts where counterparty like '시험용%'");
    await db.query("delete from public.partner_feed_audit where at > now() - interval '1 day' and actor like 'admin:%'");
    if (made.articles.length) await db.query("delete from public.articles where id = any($1::bigint[])", [made.articles]);
    if (made.people.length) await db.query("delete from public.people where id = any($1::bigint[])", [made.people]);
    if (made.partner) await db.query("delete from public.partners where id = $1", [made.partner]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
async function article(title, paid) {
  const person = (await db.query("insert into public.people (slug, name, roles, visibility) values ($1, '시험 기자', array['reporter'], 'public') returning id", [`w13i-p-${Math.random().toString(36).slice(2, 8)}`])).rows[0];
  made.people.push(person.id);
  const a = (
    await db.query(
      `insert into public.articles (slug, title, section, content_type, status, author_id, body, summary, is_paid, first_published_at)
       values ($1, $2, 'tax', 'explainer', 'published', $3, $4, '시험용 요약 문장', $5, now()) returning id`,
      [`w13i-a-${Math.random().toString(36).slice(2, 8)}`, title, person.id, JSON.stringify({ blocks: [{ type: "paragraph", text: paid ? PAID_BODY : "시험용공개본문W13I" }], claims: [] }), paid],
    )
  ).rows[0];
  made.articles.push(a.id);
}
const dataContract = (over = {}) => ({ op: "contract", counterparty: "시험용 상대방", kind: "data_license", scope: "시험용 범위", period_start: "2026-01-01", period_end: "2999-01-01", ...over });

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer(serverEnv());
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  saved = (await db.query("select key, value from public.settings where key in ('feature_flags', 'partner_feed_rate_limit')")).rows;
  u.admin = await staff.createUser({ label: "w13i-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w13i-editor", roles: ["editor"], person: { name: "시험용 편집자", roles: ["editor"] } });
  made.partner = (await db.query("insert into public.partners (name, kind) values ('시험용 제휴사', 'media') returning id")).rows[0].id;
  await article(FREE_TITLE, false);
  await article(PAID_TITLE, true);
  await setSettings({ feature_flags: { partner_feeds: false, licenses: false, naver_series: false }, partner_feed_rate_limit: {} });
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

test("a) 권한 - 편집 책임자 403, 비로그인 401, 관리자만 통과", async () => {
  assert.equal((await feedsApi(u.editor, { op: "revoke", feed_id: 1 })).status, 403);
  assert.equal((await licApi(u.editor, dataContract())).status, 403);
  assert.equal((await feedsApi(undefined, { op: "revoke", feed_id: 1 })).status, 401);
  assert.notEqual((await licApi(u.admin, { op: "terminate" })).status, 403);
});

let key, feedId, contractId;
test("b) 키 발급 - 계약 없으면 409, 계약 뒤 201, DB에는 해시만", async () => {
  const none = await feedsApi(u.admin, { op: "issue", partner_id: made.partner, contract_id: 999999999, scope: "summary" });
  assert.equal(none.status, 409);
  assert.equal(none.body.code, "contract_missing");
  const c = await licApi(u.admin, dataContract());
  assert.equal(c.status, 201);
  contractId = c.body.created.id;
  const full = await feedsApi(u.admin, { op: "issue", partner_id: made.partner, contract_id: contractId, scope: "full" });
  assert.equal(full.status, 409, "전문 허용이 없는 계약으로 전문 키 0");
  const r = await feedsApi(u.admin, { op: "issue", partner_id: made.partner, contract_id: contractId, scope: "summary" });
  assert.equal(r.status, 201);
  key = r.body.created.key;
  feedId = r.body.created.id;
  assert.match(key, /^pf_\d+\.[A-Za-z0-9_-]{43}$/);
  const secret = key.split(".")[1];
  const row = (await db.query("select * from public.partner_feeds where id = $1", [feedId])).rows[0];
  assert.match(row.key_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(row).includes(secret), "키 원문이 어느 칸에도 없다");
});

test("c) 피드 - 키 없음·틀린 키 401, 기능 키 꺼짐 503, 한도 값 없음 503, n번째 200 / n+1번째 429", async () => {
  assert.equal((await feed(null)).status, 401);
  assert.equal((await feed(`pf_${feedId}.${"A".repeat(43)}`)).status, 401);
  assert.equal((await feed(key)).status, 503, "기능 키 꺼짐");
  await setSettings({ feature_flags: { partner_feeds: true } });
  assert.equal((await feed(key)).status, 503, "한도 값 없음 = 닫힘");
  await setSettings({ partner_feed_rate_limit: { per_minute: 2 } });
  assert.equal((await feed(key)).status, 200);
  assert.equal((await feed(key, "?format=json")).status, 200);
  const over = await feed(key);
  assert.equal(over.status, 429);
  assert.ok(Number(over.headers.get("retry-after")) > 0);
});

test("d) 내용 - 무료 공개 기사만, 유료 기사 제목·본문 0, 요약 범위에 본문 0, 원문 링크·출처", async () => {
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query("delete from public.partner_feed_usage where feed_id = $1", [feedId]);
  await db.query("commit");
  const json = await (await feed(key, "?format=json&limit=50")).json();
  const titles = json.items.map((i) => i.title);
  assert.ok(titles.includes(FREE_TITLE));
  assert.ok(!titles.includes(PAID_TITLE));
  const text = JSON.stringify(json);
  assert.ok(!text.includes(PAID_BODY) && !text.includes("시험용공개본문W13I"), "요약 범위에는 본문 글자 0");
  assert.ok(json.items.every((i) => i.url.startsWith(SITE) && i.source));
});

test("c2) 폐기·계약 종료 - 다음 요청부터 401", async () => {
  await setSettings({ partner_feed_rate_limit: { per_minute: 100 } });
  assert.equal((await feed(key)).status, 200);
  assert.equal((await licApi(u.admin, { op: "terminate", contract_id: contractId })).status, 200);
  assert.equal((await feed(key)).status, 401, "계약 종료 뒤 401");
  const c2 = (await licApi(u.admin, dataContract({ counterparty: "시험용 상대방 2" }))).body.created.id;
  const k2 = (await feedsApi(u.admin, { op: "issue", partner_id: made.partner, contract_id: c2, scope: "summary" })).body.created;
  assert.equal((await feed(k2.key)).status, 200);
  assert.equal((await feedsApi(u.admin, { op: "revoke", feed_id: k2.id })).status, 200);
  assert.equal((await feed(k2.key)).status, 401, "폐기 뒤 401");
});

test("e) 연재 - 기능 키 꺼짐이면 원고 준비 409, 없는 원고 내려받기 409, 관리 화면에 '네이버 제휴 언론사' 표현 0", async () => {
  const prep = await licApi(u.admin, { op: "prepare", article_id: made.articles[0], contract_id: contractId });
  assert.equal(prep.status, 409);
  assert.equal(prep.body.code, "feature_off");
  const dl = await api("GET", "/api/admin/licenses?manuscript=999999999", u.admin);
  assert.equal(dl.status, 409);
  const src = fs.readFileSync(path.join(ROOT, "apps/web/app/admin/(desk)/licenses/page.tsx"), "utf8");
  assert.ok(!/네이버\s*(뉴스\s*)?제휴\s*(언론사|매체)/.test(src.replace(/'네이버 제휴 언론사'/g, "")), "화면 문구에 제휴 언론사 표현 0");
});

test("f) 외부 호출 0 - 이 단위 서버 소스에 네이버 주소·fetch·AI SDK import 0", () => {
  const files = [
    "apps/web/lib/partner-feeds/keys.ts",
    "apps/web/lib/partner-feeds/render.ts",
    "apps/web/lib/partner-feeds/serve.ts",
    "apps/web/lib/naver/series.ts",
    "apps/web/lib/server/partner-feeds/board.ts",
    "apps/web/app/api/feeds/route.ts",
    "apps/web/app/api/admin/feeds/route.ts",
    "apps/web/app/api/admin/licenses/route.ts",
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(!/naver\.com|fetch\(|@anthropic-ai|openai|@google\/genai/.test(src), `${f} 외부 호출·AI import 0`);
  }
});
