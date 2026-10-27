// W13-z 수용 E2E - 5단계를 닫는 묶음 (docs/dev/W13-z_설계.md - PRD-05 8장 검증 표 · 5단계 설계 4.1 누출 경로 전수표 · EXPL-11 부재)
// 단위별 수용 시험(w13a~j)이 못 덮은 이음매만 본다. 글·계약·값은 전부 시험용 가짜이고 모델·네트워크 호출은 0이다.
//  a) EXPL-11(폐기)·13장 #29 - 외부 전문가 가입·인증·유료 등재·외부 활동 띠의 경로·표·칸·이벤트·메뉴가 없다 (정적 + 스키마 + 키를 모두 켠 HTTP 404)
//  b) 교차 누출 - 기능 키를 모두 켠 채 비구독자·비로그인에게 프리미엄 꼬리 글자 0
//     (권호·위키·칼럼 화면 / 사이트맵·RSS·검색·구조화 데이터·OG / 내보내기 / 분할 화면 / 코파일럿·지방세봇 근거 / 제휴 피드 / 알림 메일·브리핑 / 구독자 -> 비구독자 순서)
//  c) 새 화면 - 공개 8개 접근성 95 · 360px 가로 스크롤 0 · R2·R3, 관리 5개와 회원 2개 360px 가로 스크롤 0 (회원 2개는 접근성도)
//  d) 기능 키를 모두 끄면 새 경로 404(제휴 피드 API는 401/503 닫힘)이고 홈·허브·푸터에 새 링크 0
// 만든 행은 끝나면 지우고, 바꾼 설정은 원래 값으로 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { pageAuth } from "./lib/session-cookie.mjs";
import { inboxFor, mailEnv, waitForMail } from "./lib/mail.mjs";

const SITE = "https://e2e-w13z.example.test";
const CRON = "e2e-w13z-cron";
const GUARD = "e2e-w13z-guard-secret-0001";
const PEPPER = "e2e-w13z-pepper-0123456789";
const ADMIN_EMAIL = "w13z-acceptance-e2e@example.test";
const ROOT = path.resolve(import.meta.dirname, "..");
const HEAD = "시험용앞부분";
const MIDDLE = "가나다라가나다라가나다라";
const SECRET = "꼬리표시험용비밀";
const BODY = `${HEAD}${"가나다라".repeat(20)}${SECRET}`;
const W13_KEYS = ["library", "library_premium", "workspace", "law_split", "law_timeline", "research_copilot", "expert_calc", "qna", "solved_cases", "my_notifications", "my_briefings", "partner_feeds", "licenses", "naver_series", "account_links", "security_cert_plan"];
const KEYS = ["feature_flags", "library_preview", "library_rate_limit", "export_excerpt_limit", "ask_rollout", "ask_budget", "ask_pricing", "copilot_monthly_limit", "partner_feed_rate_limit", "qna_neutrality_notice"];
const SEC_KEYS = ["data_location", "encryption", "access_control", "ai_provider_data", "calc_input_not_stored", "conversation_retention", "vulnerability_contact"];
const NOTICE = { version: "e2e-w13z", text: "시험용 중립성 고지입니다 (실제 문구 아님).", answer_footer: "시험용 답변 하단 고지", approved: true, reviewed_by: "시험 검토자", reviewed_on: "2026-10-27" };
const NEW_LINK = /href="\/(library|qna|workspace|law\/timeline|calc\/(oligopoly|entity|corporate-local-income)|my\/notifications|my\/briefings)(["/?#])/;

let sb, server, staff, db, base, run, saved, regionCode, personId, cdpPort, browserCtx, userDir;
const u = {};
const f = { pubs: [], articles: [], people: [], chunks: [], contracts: [], feeds: [], questions: [] };
let seq = 0;

async function setSetting(key, value) {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("update public.settings set value = $1::jsonb where key = $2", [JSON.stringify(value), key]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
const serverEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
  ADMIN_EMAILS: ADMIN_EMAIL,
  NEXT_PUBLIC_SITE_URL: SITE,
  CRON_SECRET: CRON,
  GUARD_SECRET: GUARD,
  PARTNER_FEED_KEY_PEPPER: PEPPER,
  AGENT_MODEL_COPILOT: "e2e-model-copilot",
  AGENT_EFFORT_COPILOT: "high",
  ANTHROPIC_API_KEY: "e2e-not-a-real-key",
  ANTHROPIC_BASE_URL: "http://127.0.0.1:9", // 모델은 부르지 않는다 (연결되면 실패)
  ...mailEnv(),
});
async function restart() {
  await server?.stop?.();
  server = await startServer(serverEnv());
  base = server.base;
}
async function setAllFlags(on) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  if (on) await setSetting("qna_neutrality_notice", NOTICE); // 고지 승인 없이는 qna 키를 켤 수 없다
  const patch = Object.fromEntries(W13_KEYS.map((k) => [k, on]));
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
  await restart();
}
const html = (t) => t.replace(/<!-- -->/g, "");
async function page(p, { cookie, xff } = {}) {
  const headers = { "x-forwarded-for": xff ?? `203.0.113.${(++seq % 200) + 1}` };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${p}`, { redirect: "manual", headers });
  return { status: res.status, html: html(await res.text()), cache: res.headers.get("cache-control") ?? "" };
}
async function api(method, p, user, body, extra = {}) {
  const headers = { origin: base, ...extra };
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json, text };
}
const cookieOf = async (user) => (await pageAuth(sb, user)).cookie;
const ent = (userId, key) =>
  db.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, $2, 'manual', $3, now() - interval '1 day', now() + interval '30 days')", [userId, key, `e2e-w13z-${run}-${key}-${userId.slice(0, 8)}`]);
const slugOf = (p) => `e2e-w13z-${p}-${run}-${++seq}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

function zipEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString("utf8");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nl + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

// ── 시험 자료 ──
const ACTOR = `admin:${ADMIN_EMAIL}`;
async function makeIssue() {
  const pub = (await db.query("insert into public.publications (slug, title, kind) values ($1, '시험용 월간지', 'magazine') returning id", [slugOf("pub")])).rows[0].id;
  f.pubs.push(pub);
  const issue = (await db.query("insert into public.magazine_issues (publication_id, issue_no, issued_on, as_of) values ($1, '시험 1호', '2026-01-10', '2026-01-01') returning id", [pub])).rows[0].id;
  const art = (await db.query("insert into public.magazine_articles (issue_id, ordinal, title, access_tier) values ($1, 0, '시험용 기사', 'premium') returning id", [issue])).rows[0].id;
  await db.query("insert into public.library_bodies (kind, ref_id, body) values ('issue_article', $1, $2)", [art, BODY]);
  for (const [table, id] of [["magazine_issues", issue], ["magazine_articles", art]]) {
    await db.query(`update public.${table} set rights_public = 'confirmed', rights_sale = 'confirmed', rights_ref = '시험용 계약', rights_confirmed_on = '2026-01-02' where id = $1`, [id]);
  }
  for (const [kind, id] of [["issue_article", art], ["issue", issue]]) {
    const job = (await db.query("select public.digitize_create($1, $2, '시험용.txt', $3) r", [kind, id, ACTOR])).rows[0].r.jobId;
    for (const to of ["extracted", "structured", "proofread"]) await db.query("select public.digitize_advance($1, $2, $3)", [job, to, ACTOR]);
    const ok = (await db.query("select public.digitize_approve($1, 100, 0, $2) r", [job, ACTOR])).rows[0].r;
    assert.equal(ok.ok, true, JSON.stringify(ok));
  }
  return { issue, art };
}
async function makeNode() {
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  const pub = (await db.query("insert into public.publications (slug, title, kind) values ($1, '시험용 출판물', 'book') returning id", [slugOf("book")])).rows[0].id;
  f.pubs.push(pub);
  const ed = (await db.query("insert into public.editions (publication_id, edition_label, as_of) values ($1, '시험 1판', '2026-01-01') returning id", [pub])).rows[0].id;
  const node = (
    await db.query(
      "insert into public.pub_nodes (edition_id, depth, ordinal, title, status, approved_job_id, rights_public, rights_sale, rights_index, rights_ref, rights_confirmed_on, access_tier) values ($1, 1, 0, '시험용 프리미엄 노드', 'approved', 1, 'confirmed', 'confirmed', 'confirmed', '시험용 계약', '2026-01-02', 'premium') returning id",
      [ed],
    )
  ).rows[0].id;
  await db.query("insert into public.library_bodies (kind, ref_id, body) values ('node', $1, $2)", [node, BODY]);
  await db.query("commit");
  return node;
}
async function makeColumn(title) {
  const person = (await db.query("insert into public.people (slug, name, roles, visibility, contract_status, contract_until) values ($1, '시험 필자', array['writer'], 'public', 'active', '2099-12-31') returning id", [slugOf("p")])).rows[0].id;
  await db.query("insert into public.name_likeness_consents (person_id, version, scope, doc_ref, recorded_by) values ($1, '시험용', array['column'], '시험용 위치', 'admin:e2e')", [person]);
  f.people.push(person);
  const slug = slugOf("col");
  const art = (
    await db.query("insert into public.articles (slug, title, section, content_type, status, author_id, body, access_tier, is_paid, region_codes, editorial_field, public_question) values ($1, $2, 'tax', 'opinion', 'draft', $3, '[]'::jsonb, 'premium', true, '{}', 'local_tax', '시험용 공익적 질문') returning id", [slug, title, person])
  ).rows[0].id;
  f.articles.push(art);
  await db.query("insert into public.paid_bodies (kind, ref_key, article_id, preview, body, sale_allowed, rights_ref, sale_confirmed_on, edited_by) values ('column', $1::bigint::text, $1::bigint, '시험용 요약', $2, true, '시험용 계약', '2026-01-02', 'e2e')", [String(art), BODY]);
  await db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [art]);
  await db.query("update public.articles set region_codes = $2 where id = $1", [art, [regionCode]]);
  return { id: art, slug };
}
async function makeFreeArticle(title) {
  const a = (
    await db.query(
      "insert into public.articles (slug, title, section, content_type, status, author_id, body, summary, first_published_at, region_codes, editorial_field, public_question) values ($1, $2, 'local', 'explainer', 'published', $3, $4::jsonb, '시험용 요약 문장', now(), $5, 'local_tax', '시험용 공익적 질문') returning id",
      [slugOf("free"), title, personId, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 무료 본문" }], claims: [] }), [regionCode]],
    )
  ).rows[0].id;
  f.articles.push(a);
}
async function insertChunk(over, tag) {
  const row = { doc_type: "publication", source_type: "publication", source_id: `e2e-w13z-${run}-${tag}`, chunk_no: 0, path: "시험용", content: `${WORD} ${SECRET}`, token_est: 5, tax_items: ["local"], valid_from: "2000-01-01", source_hash: "h", index_version: "chunk-v1", access_tier: "premium", rights_status: "confirmed", scope: "base", ...over };
  row.content_hash = (await db.query("select encode(sha256($1::bytea), 'hex') h", [`${run}-${tag}`])).rows[0].h;
  const keys = Object.keys(row);
  await db.query(`insert into public.chunks (${keys.join(", ")}) values (${keys.map((_, k) => `$${k + 1}`).join(", ")})`, keys.map((k) => row[k]));
  f.chunks.push(row.source_id);
}
let WORD;

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const issues = (await db.query("select i.id from public.magazine_issues i where i.publication_id = any($1::bigint[])", [f.pubs])).rows.map((r) => r.id);
    const arts = (await db.query("select id from public.magazine_articles where issue_id = any($1::bigint[])", [issues])).rows.map((r) => r.id);
    const eds = (await db.query("select id from public.editions where publication_id = any($1::bigint[])", [f.pubs])).rows.map((r) => r.id);
    const nodes = (await db.query("select id from public.pub_nodes where edition_id = any($1::bigint[])", [eds])).rows.map((r) => r.id);
    await db.query("delete from public.library_bodies where (kind = 'issue_article' and ref_id = any($1::bigint[])) or (kind = 'node' and ref_id = any($2::bigint[]))", [arts, nodes]);
    await db.query("delete from public.digitization_audit where actor = $1 or actor like 'user:%'", [ACTOR]);
    await db.query("delete from public.digitization_jobs where (target_kind = 'issue' and target_id = any($1::bigint[])) or (target_kind = 'issue_article' and target_id = any($2::bigint[])) or source_file = '시험용.txt'", [issues, arts]);
    await db.query("delete from public.library_rights_log where (item_kind = 'issue' and item_id = any($1::bigint[])) or (item_kind = 'issue_article' and item_id = any($2::bigint[]))", [issues, arts]);
    await db.query("delete from public.magazine_articles where id = any($1::bigint[])", [arts]);
    await db.query("delete from public.magazine_issues where id = any($1::bigint[])", [issues]);
    await db.query("delete from public.pub_nodes where id = any($1::bigint[])", [nodes]);
    await db.query("delete from public.editions where id = any($1::bigint[])", [eds]);
    await db.query("delete from public.publications where id = any($1::bigint[])", [f.pubs]);
    await db.query("delete from public.library_abuse_log where at > now() - interval '1 day'");
    await db.query("delete from public.library_access_log where at > now() - interval '1 day'");
    await db.query("delete from public.briefings where user_id = any($1::uuid[])", [Object.values(u).map((x) => x.id)]);
    await db.query("delete from public.notifications where user_id = any($1::uuid[])", [Object.values(u).map((x) => x.id)]);
    await db.query("delete from public.notification_prefs where user_id = any($1::uuid[])", [Object.values(u).map((x) => x.id)]);
    await db.query("delete from public.scraps where user_id = any($1::uuid[])", [Object.values(u).map((x) => x.id)]);
    await db.query("delete from public.workspace_exports where user_id = any($1::uuid[])", [Object.values(u).map((x) => x.id)]);
    await db.query("delete from public.copilot_runs where user_id = any($1::uuid[])", [Object.values(u).map((x) => x.id)]);
    await db.query("delete from public.copilot_usage where user_id = any($1::uuid[])", [Object.values(u).map((x) => x.id)]);
    await db.query("delete from public.paid_bodies where kind = 'column' and article_id = any($1::bigint[])", [f.articles]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [f.articles]);
    await db.query("delete from public.name_likeness_consents where person_id = any($1::bigint[])", [f.people]);
    await db.query("delete from public.people where id = any($1::bigint[])", [f.people]);
    await db.query("delete from public.chunks where source_id like $1", [`e2e-w13z-${run}%`]);
    await db.query("delete from public.partner_feed_usage where feed_id in (select id from public.partner_feeds where issued_by like 'admin:%')");
    await db.query("delete from public.partner_feeds where partner_id in (select id from public.partners where name = $1)", [`시험용 제휴사 ${run}`]);
    await db.query("delete from public.license_contracts where counterparty = $1", [`시험용 상대방 ${run}`]);
    await db.query("delete from public.partner_feed_audit where at > now() - interval '1 day' and actor like 'admin:%'");
    await db.query("delete from public.partners where name = $1", [`시험용 제휴사 ${run}`]);
    await db.query("delete from public.qna_answers where question_id in (select id from public.qna_questions where title like $1)", [`e2e-w13z ${run}%`]);
    await db.query("delete from public.qna_questions where title like $1", [`e2e-w13z ${run}%`]);
    await db.query("delete from public.security_audit where (actor like 'admin:%' or actor like 'user:%') and at > now() - interval '1 day' and detail is distinct from 'keep'");
    await db.query("delete from public.security_control_checks where control_key like $1", [`e2e_w13z_${run}%`]);
    await db.query("delete from public.security_self_check_rounds where round_no >= 9100");
    await db.query("delete from public.security_policy_items where body like '시험용%'");
    const t = (await db.query("select id from public.issue_tags where tag_key like $1", [`e2e_w13z_${run}%`])).rows.map((r) => r.id);
    if (t.length) {
      await db.query("delete from public.issue_audit where subject in ('issue_tag', 'case_issue_tag')");
      await db.query("delete from public.case_issue_tags where issue_tag_id = any($1::bigint[])", [t]);
      await db.query("delete from public.issue_tags where id = any($1::bigint[])", [t]);
    }
    await db.query("delete from public.entitlements where source_ref like $1", [`e2e-w13z-${run}%`]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

let fixture = {};
before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer(serverEnv());
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  WORD = `교차시험${run}`;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  saved = Object.fromEntries((await db.query("select key, value from public.settings where key = any($1::text[])", [KEYS])).rows.map((r) => [r.key, r.value]));
  u.admin = await staff.createUser({ label: "w13z-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w13z-editor", roles: ["editor"], person: { name: "시험용 편집자", roles: ["editor"] } });
  u.sub = await staff.createUser({ label: "w13z-sub" }); // library + workspace + copilot 권한
  u.ws = await staff.createUser({ label: "w13z-ws" }); // workspace만
  u.plain = await staff.createUser({ label: "w13z-plain" }); // 권한 없음
  u.cop = await staff.createUser({ label: "w13z-cop" }); // copilot만
  await purge();
  for (const k of ["library", "workspace", "copilot"]) await ent(u.sub.id, k);
  await ent(u.ws.id, "workspace");
  await ent(u.cop.id, "copilot");
  regionCode = (await db.query("select code from public.regions where level = 'sido' and (valid_to is null or valid_to >= current_date) order by code limit 1")).rows[0].code;
  personId = (await db.query("insert into public.people (slug, name, roles, visibility) values ($1, '시험 기자', '{reporter}', 'public') returning id", [slugOf("rep")])).rows[0].id;
  f.people.push(personId);
  await setSetting("library_preview", { chars: HEAD.length });
  await setSetting("library_rate_limit", { max: 100000, window_seconds: 60 });
  fixture.issue = await makeIssue();
  fixture.node = await makeNode();
  fixture.column = await makeColumn(`시험용 프리미엄 칼럼 ${run}`);
  fixture.freeTitle = `시험용 무료 지역 소식 ${run}`;
  await makeFreeArticle(fixture.freeTitle);
  await insertChunk({}, "pub");
  await insertChunk({ source_type: "guide_version", doc_type: "guide", access_tier: "public", rights_status: "unchecked", content: `${WORD} 권리없음${SECRET}` }, "norights");
});

after(async () => {
  try {
    await browserCtx?.close().catch(() => {});
    if (userDir) fs.rmSync(userDir, { recursive: true, force: true });
    for (const k of KEYS) if (saved?.[k] !== undefined) await setSetting(k, saved[k]);
    await purge();
  } finally {
    await staff?.cleanup();
    await server?.stop();
  }
});

// ───────────────────────── a) EXPL-11 ─────────────────────────
test("a) EXPL-11 폐기 - 외부 전문가 가입·인증·유료 등재·외부 증빙·외부 활동 띠의 경로·표·칸·이벤트·메뉴가 없다 (정적 + 스키마 + HTTP 404)", async () => {
  // 정적: 경로 디렉터리
  for (const d of ["app/my/expert", "app/api/expert", "app/api/my/expert", "app/(site)/experts/verify", "app/(site)/experts/signup", "app/(site)/experts/paid", "app/admin/(desk)/expert-listings"]) {
    assert.equal(fs.existsSync(path.join(ROOT, "apps/web", d)), false, `${d} 없음`);
  }
  // 정적: 소스에 폐기 이름이 없다 (시험 파일 제외)
  const BAD = /expert_paid_listings|paid_listing|\/my\/expert|expert_evidence|external_expert|expert_signup|광고\s*등재/;
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (["node_modules", ".next"].includes(e.name)) return [];
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.(ts|tsx|sql)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
    });
  const hits = [...walk(path.join(ROOT, "apps/web/app")), ...walk(path.join(ROOT, "apps/web/components")), ...walk(path.join(ROOT, "apps/web/lib")), ...walk(path.join(ROOT, "packages/ui/src"))]
    .filter((p) => !p.endsWith("events.ts")) // 이벤트 목록 주석은 아래 DB 제약으로 따로 본다
    .filter((p) => BAD.test(fs.readFileSync(p, "utf8")))
    .map((p) => path.relative(ROOT, p));
  assert.deepEqual(hits, []);
  // 메뉴: 헤더 유틸 메뉴·관리 메뉴에 외부 전문가 항목이 없다
  const menu = fs.readFileSync(path.join(ROOT, "apps/web/lib/admin/menu.ts"), "utf8");
  assert.ok(!/expert-listing|paid-listing|광고 등재|외부 전문가/.test(menu), "관리 메뉴");
  const ui = fs.readdirSync(path.join(ROOT, "packages/ui/src")).filter((n) => /\.ts$/.test(n)).map((n) => fs.readFileSync(path.join(ROOT, "packages/ui/src", n), "utf8")).join("\n");
  assert.ok(!/\/my\/expert|paid[-_]listing/.test(ui), "헤더 메뉴");
  // 스키마: 표·칸·이벤트
  const tables = (await db.query("select table_name from information_schema.tables where table_schema = 'public' and (table_name ~ 'paid_listing|expert_paid|expert_evidence|external_expert|expert_signup' )")).rows;
  assert.deepEqual(tables, [], "폐기된 표 이름 0");
  const cols = (
    await db.query(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and (table_name like 'expert\\_%' or table_name like 'qna\\_%' or table_name = 'expert_activity') and column_name ~ 'fee|commission|referral|sponsor|paid|price|payment|evidence|upload|license_no|advert'",
    )
  ).rows;
  assert.deepEqual(cols, [], "전문가·라운지 표에 대가·증빙 칸 0");
  await db.query("begin");
  try {
    for (const name of ["paid_listing_viewed", "paid_listing_contact_clicked", "expert_signup_started"]) {
      await db.query("savepoint s");
      await assert.rejects(
        db.query("insert into public.analytics_events (name, session_id, first_visit, stage, entry, section, props, is_bot, is_staff) values ($1, gen_random_uuid(), true, 1, 'direct', null, '{}'::jsonb, false, false)", [name]),
        (e) => e.code === "23514",
        name,
      );
      await db.query("rollback to savepoint s");
    }
  } finally {
    await db.query("rollback");
  }
  // HTTP: 5단계 키를 모두 켠 상태에서도 404
  await setAllFlags(true);
  const cookie = await cookieOf(u.plain);
  for (const p of ["/my/expert", "/my/expert/verify", "/experts/verify", "/experts/signup", "/experts/paid", "/experts/ads", "/admin/expert-listings"]) {
    assert.equal((await page(p, { cookie })).status, 404, `${p}`);
  }
  for (const p of ["/api/expert/verify", "/api/expert/upload", "/api/my/expert", "/api/experts/listings"]) {
    for (const method of ["GET", "POST"]) assert.equal((await api(method, p, u.plain, method === "POST" ? {} : undefined)).status, 404, `${method} ${p}`);
  }
  // 라운지 쓰기 API에 자기 신청·증빙 모양의 본문을 보내도 칸이 저장되지 않는다 (질문 등록은 일반 회원 글)
  const q = await api("POST", "/api/qna/questions", u.plain, { tax_type: "취득세", title: `e2e-w13z ${run} 증빙`, body: "시험용 일반 질문입니다", warning_confirmed: true, expert_verified: true, license_no: "99-9999", paid_listing: true });
  assert.ok([201, 422, 400].includes(q.status), `질문 등록 ${q.status}`);
  const qc = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='qna_questions'")).rows.map((r) => r.column_name);
  assert.ok(!qc.some((c) => /expert_verified|license_no|paid_listing/.test(c)));
  // 라운지 답변 배지는 SM 소속 연결 계정에만 - 연결이 하나도 없는 이 시험 계정은 배지 0
  const lounge = await page("/qna", { cookie });
  assert.equal(lounge.status, 200);
  assert.equal(/data-part="expert-badge"|전문가 답변/.test(lounge.html), false, "연결 없는 계정 글에 전문가 배지 0");
});

// ───────────────────────── b) 교차 누출 ─────────────────────────
const SURFACES = () => [
  `/library`,
  `/library/magazine/${fixture.issue.issue}`,
  `/library/wiki/${fixture.node}`,
  `/library/columns`,
  `/library/columns/${fixture.column.id}`,
  `/workspace/split?p=node:${fixture.node}`,
  `/workspace/split?p=node:${fixture.node},note:1`,
  `/search?q=${encodeURIComponent("시험용 프리미엄 칼럼")}`,
  `/search?q=${encodeURIComponent(fixture.column.slug)}`,
  `/search?q=${encodeURIComponent(WORD)}`,
  `/news/${fixture.column.slug}`,
  `/tax`,
  `/store`,
  `/sitemap.xml`,
  `/rss`,
  `/news-sitemap.xml`,
  `/robots.txt`,
];
function assertNoTail(label, text) {
  assert.equal(text.includes(SECRET), false, `${label} 꼬리 글자`);
  assert.equal(text.includes(MIDDLE), false, `${label} 본문 중간 글자`);
}

test("b1) 키를 모두 켠 채 비구독자·비로그인·권한 일부만 가진 회원에게 화면·메타·구조화 데이터·검색·사이트맵·RSS에 프리미엄 꼬리 글자 0 (구독자 -> 비구독자 순서)", async () => {
  await setAllFlags(true);
  // 양성 대조군: 구독자는 세 화면에서 전문이 보인다 (자료가 비어 있어서 통과하는 것을 막는다)
  const subCookie = await cookieOf(u.sub);
  for (const p of [`/library/magazine/${fixture.issue.issue}`, `/library/wiki/${fixture.node}`, `/library/columns/${fixture.column.id}`]) {
    const r = await page(p, { cookie: subCookie });
    assert.equal(r.status, 200, p);
    assert.ok(r.html.includes(SECRET), `구독자 전문 ${p}`);
    assert.equal(/public|s-maxage/i.test(r.cache), false, `구독자 응답 캐시 ${p}: ${r.cache}`);
  }
  // 이어서 비구독자들 - 같은 서버(캐시)에서 순서대로
  const who = [["비로그인", undefined], ["권한 없음", await cookieOf(u.plain)], ["workspace만", await cookieOf(u.ws)], ["copilot만", await cookieOf(u.cop)]];
  for (const [label, cookie] of who) {
    for (const p of SURFACES()) {
      const r = await page(p, { cookie });
      assert.ok([200, 301, 302, 303, 307, 308, 404].includes(r.status), `${label} ${p} ${r.status}`);
      assertNoTail(`${label} ${p}`, r.html);
    }
    const col = await page(`/library/columns/${fixture.column.id}`, { cookie });
    assert.equal(col.status, 200);
    assert.ok(col.html.includes(HEAD), `${label} 미리보기는 보인다`);
    assert.match(col.html, /<title>/);
    assert.equal(/public|s-maxage/i.test(col.cache), false);
  }
  // 링크가 실제로 걸린 상태에서의 점검임을 보인다 (끄면 d에서 0)
  assert.match((await page("/tax")).html, /href="\/library"/);
});

test("b2) 내보내기 - 권한이 workspace뿐이면 한도가 커도 발췌 0, 구독자는 한도 안에서만 (csv·docx)", async () => {
  await setSetting("export_excerpt_limit", { chars: 1000 });
  await restart();
  for (const user of [u.ws, u.sub]) {
    const r = await api("POST", "/api/workspace/items", user, { action: "scrap_add", targetKind: "node", targetId: String(fixture.node), label: "x" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const exp = (user, fmt) => fetch(`${base}/api/workspace/export?target=scraps&format=${fmt}`, { headers: { authorization: `Bearer ${user.token}` } });
  const wsCsv = await (await exp(u.ws, "csv")).text();
  assert.ok(wsCsv.includes("시험용 프리미엄 노드"), "제목은 나온다");
  assertNoTail("ws csv", wsCsv);
  const wsDocx = zipEntries(Buffer.from(await (await exp(u.ws, "docx")).arrayBuffer())).get("word/document.xml").toString("utf8");
  assertNoTail("ws docx", wsDocx);
  const subCsv = await (await exp(u.sub, "csv")).text();
  assert.ok(subCsv.includes(HEAD), "구독자 발췌 대조군");
  // 한도 -1/한도/+1 중 한도 5: 정확히 5글자
  await setSetting("export_excerpt_limit", { chars: HEAD.length });
  await restart();
  const exact = (await (await exp(u.sub, "csv")).text()).replace(/^﻿/, "");
  assert.ok(exact.includes(HEAD));
  assert.equal(exact.includes(BODY.slice(0, HEAD.length + 1)), false, "한도 +1 글자 0");
  assert.equal((await fetch(`${base}/api/workspace/export?target=scraps&format=csv`)).status, 401, "비로그인");
});

test("b3) 코파일럿·지방세봇 근거 - 비구독자 검색 발췌 0, 권리 없는 청크 0, 요약 권리 없는 출판물은 코파일럿 422·모델 0, 권한 없으면 403", async () => {
  await setSetting("ask_rollout", { stage: "4c" });
  await setSetting("copilot_monthly_limit", 5);
  await setSetting("ask_budget", { monthly_won: 100000 });
  await setSetting("ask_pricing", { answer: { in: 1000, out: 5000, cachedIn: 100 }, utility: { in: 100, out: 500 } });
  await restart();
  const rpc = async (fn, args) => {
    const res = await fetch(`${sb.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}`, "content-type": "application/json" }, body: JSON.stringify(args) });
    return { status: res.status, text: await res.text() };
  };
  const s = await rpc("agent_search", { p_query: WORD });
  assert.equal(s.status, 200);
  assertNoTail("agent_search anon", s.text);
  assert.deepEqual(JSON.parse(s.text), [], "프리미엄·권리 없음 청크는 비구독자 검색에 0건");
  const hint = await rpc("agent_premium_hint", { p_query: WORD });
  assert.equal(hint.text.includes(SECRET), false);
  // 회원(비구독자) 토큰으로 검색해도 같다
  const asPlain = await fetch(`${sb.url}/rest/v1/rpc/agent_search`, { method: "POST", headers: { apikey: sb.anonKey, authorization: `Bearer ${u.plain.token}`, "content-type": "application/json" }, body: JSON.stringify({ p_query: WORD }) });
  assertNoTail("agent_search plain", await asPlain.text());
  const cop = (user, body) => api("POST", "/api/copilot", user, body);
  assert.equal((await cop(u.plain, { kind: "publications", ref: WORD })).status, 403);
  const r = await cop(u.cop, { kind: "publications", ref: WORD });
  assert.equal(r.status, 422, r.text.slice(0, 200));
  assertNoTail("copilot 422", r.text);
});

test("b4) 제휴 피드 - 전문 허용 계약·권리 근거가 있는 키로도 유료 칼럼 제목·본문 0 (무료 공개 기사는 나옴)", async () => {
  await setSetting("partner_feed_rate_limit", { per_minute: 100 });
  await restart();
  const partner = (await db.query("insert into public.partners (name, kind) values ($1, 'media') returning id", [`시험용 제휴사 ${run}`])).rows[0].id;
  const c = await api("POST", "/api/admin/licenses", u.admin, { op: "contract", counterparty: `시험용 상대방 ${run}`, kind: "data_license", scope: "시험용 범위", period_start: "2026-01-01", period_end: "2999-01-01", rights_ref: "시험용 권리 근거", allows_full: true });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const k = await api("POST", "/api/admin/feeds", u.admin, { op: "issue", partner_id: partner, contract_id: c.body.created.id, scope: "full" });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const key = k.body.created.key;
  for (const fmt of ["json", "rss"]) {
    const res = await fetch(`${base}/api/feeds?format=${fmt}&limit=50`, { headers: { authorization: `Bearer ${key}` } });
    assert.equal(res.status, 200, fmt);
    const text = await res.text();
    assert.ok(text.includes(fixture.freeTitle), `${fmt} 무료 공개 기사 대조군`);
    assert.equal(text.includes(`시험용 프리미엄 칼럼 ${run}`), false, `${fmt} 유료 칼럼 제목`);
    assert.equal(text.includes(fixture.column.slug), false);
    assertNoTail(`feed ${fmt}`, text);
  }
});

test("b5) 알림 메일·맞춤 브리핑 - 메일에는 무료 기사 제목만, 유료 칼럼 제목·꼬리 글자 0 / 브리핑에는 유료 항목을 넣을 수 없고 화면에도 없다", async () => {
  await db.query("insert into public.profiles (id, interest_region_codes) values ($1, $2) on conflict (id) do update set interest_region_codes = excluded.interest_region_codes", [u.plain.id, [regionCode]]);
  await db.query("insert into public.consents (user_id, kind, channel, confirmed_at) values ($1, 'receive', 'web_my', now())", [u.plain.id]);
  const form = new URLSearchParams([["action", "save"], ["kinds", "region"], ["frequency", "instant"], ["briefing", "off"]]);
  const saveRes = await fetch(`${base}/api/my/notifications`, { method: "POST", redirect: "manual", headers: { authorization: `Bearer ${u.plain.token}`, origin: base, "content-type": "application/x-www-form-urlencoded" }, body: form });
  assert.match(saveRes.headers.get("location") ?? "", /saved=1/);
  // 설정을 켠 뒤 공개된 새 기사만 알림이 된다 - 무료 1건 + 유료 칼럼 1건을 새로 공개
  await makeFreeArticle(`${fixture.freeTitle} 알림`);
  const col2 = await makeColumn(`시험용 알림 유료 칼럼 ${run}`);
  const job = await fetch(`${base}/api/jobs/notify-daily`, { headers: { authorization: `Bearer ${CRON}` } });
  assert.equal(job.status, 200);
  const mails = await waitForMail(u.plain.email, 1);
  assert.equal(mails.length, 1);
  assert.ok(mails[0].Text.includes(`${fixture.freeTitle} 알림`), "무료 기사 제목 대조군");
  assert.equal(mails[0].Text.includes(`시험용 알림 유료 칼럼 ${run}`), false, "유료 칼럼 제목 0");
  assert.equal(mails[0].Text.includes(`/library/columns/${col2.id}`), false);
  assertNoTail("notify mail", mails[0].Text + (mails[0].HTML ?? ""));
  assert.equal((await db.query("select count(*)::int n from public.notifications where user_id = $1", [u.plain.id])).rows[0].n, 1);
  // 브리핑: workspace 권한 + 웹 브리핑 켠 회원에게 유료 칼럼 항목은 만들 수 없다
  await db.query("insert into public.notification_prefs (user_id, briefing) values ($1, 'web') on conflict (user_id) do update set briefing = 'web'", [u.ws.id]);
  const items = [{ type: "article", id: Number(fixture.column.id), reason: "interest", basis_on: "2026-10-26" }];
  const made = await db.query("select public.briefing_create($1, '2026-W99', $2::jsonb, now()) r", [u.ws.id, JSON.stringify(items)]).then(
    (x) => x.rows[0].r,
    (e) => ({ rejected: e.code ?? e.message }),
  );
  assert.ok(made.rejected || made.ok === false, `유료 항목 브리핑 거부: ${JSON.stringify(made)}`);
  const bp = await page("/my/briefings", { cookie: await cookieOf(u.ws) });
  assert.equal(bp.status, 200);
  assert.equal(bp.html.includes(`시험용 프리미엄 칼럼 ${run}`), false);
  assertNoTail("briefings page", bp.html);
  assert.equal((await inboxFor(u.ws.email)).length, 0, "브리핑 메일 0");
});

// ───────────────────────── c) 화면 ─────────────────────────
test("c) 새 화면 - 공개 8개 접근성 95·360px 가로 스크롤 0·R2·R3 / 관리 5개 360px 가로 스크롤 0 / 회원 2개 360px 가로 스크롤 0·접근성 95", async (t) => {
  await setAllFlags(true);
  await db.query("update public.settings set value = value || '{\"security_page\": true}'::jsonb where key = 'feature_flags'");
  await restart();
  // 자료: 라운지 질문, 쟁점 태그, 보안 정책 7항목
  const q = await api("POST", "/api/qna/questions", u.plain, { tax_type: "취득세", title: `e2e-w13z ${run} 질문`, body: "시험용 일반 질문입니다", warning_confirmed: true });
  assert.equal(q.status, 201, JSON.stringify(q.body));
  const qid = (await db.query("select id from public.qna_questions where title = $1", [`e2e-w13z ${run} 질문`])).rows[0].id;
  const tagKey = `e2e_w13z_${run}_a`;
  const tags = (body) => api("POST", "/api/admin/issue-tags", u.editor, body);
  const p = await tags({ op: "propose", tag_key: tagKey, label: "시험용 쟁점", hub: "trust" });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal((await tags({ op: "approve", id: p.body.created.id })).status, 200);
  const sec = (body) => api("POST", "/api/admin/security", u.admin, body);
  const items = {};
  for (const k of SEC_KEYS) {
    const r = await sec({ op: "draft", item_key: k, body: `시험용 본문 ${k}`, confirmed_on: "2026-10-01", contract_verified: k === "ai_provider_data" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    items[k] = r.body.created.id;
  }
  for (const k of SEC_KEYS) assert.equal((await sec({ op: "publish", id: items[k] })).status, 200, k);

  const ctl = `e2e_w13z_${run}_ctl`;
  assert.equal((await sec({ op: "check", round_no: 9100, control_key: ctl, control_title: "시험용 통제", result: "gap", checked_on: "2026-10-01", gap_plan: "시험용 조치 계획", due_on: "2026-12-31" })).status, 201);
  assert.equal((await sec({ op: "complete_round", round_no: 9100 })).status, 200);

  const publicPaths = ["/library", `/library/wiki/${fixture.node}`, `/library/magazine/${fixture.issue.issue}`, "/library/columns", "/qna", `/qna/${qid}`, `/law/timeline/${tagKey}`, "/security"];
  for (const pth of publicPaths) assert.equal((await page(pth)).status, 200, `${pth} 열림`);

  cdpPort = await freePort();
  userDir = fs.mkdtempSync(path.join(os.tmpdir(), "w13z-chrome-"));
  browserCtx = await chromium.launchPersistentContext(userDir, { args: [`--remote-debugging-port=${cdpPort}`], viewport: { width: 360, height: 740 } });
  const shim = { newPage: async (o) => { const pg = await browserCtx.newPage(); await pg.setViewportSize(o.viewport); return pg; } };
  const fails = [];
  const overflowOf = async (pth) => {
    const pg = await browserCtx.newPage();
    await pg.setViewportSize({ width: 360, height: 740 });
    const res = await pg.goto(`${base}${pth}`, { waitUntil: "networkidle" });
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const url = pg.url();
    await pg.close();
    return { status: res?.status(), overflow, url };
  };
  for (const pth of publicPaths) {
    for (const width of [360, 1280]) {
      const m = await measurePage(shim, `${base}${pth}`, { width, height: width === 360 ? 740 : 800 });
      if (width === 360) t.diagnostic(`R1 측정만 ${pth} ${m.r1.chars}자`);
      if (!m.r2.pass || !m.r3.pass) fails.push(`${pth} ${m.viewport} R2 ${m.r2.maxPerViewport} R3 ${m.r3.ratio}`);
    }
    const o = await overflowOf(pth);
    if (o.overflow > 0) fails.push(`${pth} 360px 가로 스크롤 ${o.overflow}px`);
    const a = await accessibility(`${base}${pth}`, cdpPort);
    if (a.score < A11Y_MIN) fails.push(`${pth} 접근성 ${Math.round(a.score * 100)} (${a.failing.join(",")})`);
  }

  const login = async (user) => {
    await browserCtx.clearCookies();
    const pg = await browserCtx.newPage();
    await pg.goto(`${base}/login`);
    await pg.fill('input[name="email"]', user.email);
    await pg.fill('input[name="password"]', user.password);
    await Promise.all([pg.waitForURL((x) => !x.pathname.startsWith("/login")), pg.click('button[type="submit"]')]);
    await pg.close();
  };
  await login(u.admin);
  for (const pth of ["/admin/library", "/admin/qna", "/admin/solved-cases", "/admin/feeds", "/admin/licenses"]) {
    const o = await overflowOf(pth);
    if (o.status !== 200 || !o.url.includes(pth)) fails.push(`${pth} 열리지 않음 (${o.status} ${o.url})`);
    else if (o.overflow > 0) fails.push(`${pth} 360px 가로 스크롤 ${o.overflow}px`);
  }
  await login(u.ws);
  for (const pth of ["/workspace", "/my/notifications"]) {
    const o = await overflowOf(pth);
    if (o.status !== 200 || !o.url.includes(pth)) fails.push(`${pth} 열리지 않음 (${o.status} ${o.url})`);
    else if (o.overflow > 0) fails.push(`${pth} 360px 가로 스크롤 ${o.overflow}px`);
    const a = await accessibility(`${base}${pth}`, cdpPort);
    assert.ok(a.finalUrl?.includes(pth), `Lighthouse가 로그인 화면으로 밀리지 않음: ${a.finalUrl}`);
    if (a.score < A11Y_MIN) fails.push(`${pth} 접근성 ${Math.round(a.score * 100)} (${a.failing.join(",")})`);
  }
  t.diagnostic(`화면 점검 실패 ${fails.length}건`);
  assert.deepEqual(fails, []);
});

// ───────────────────────── d) 키 꺼짐 ─────────────────────────
test("d) 기능 키를 모두 끄면 새 경로 404(제휴 피드 API는 401/503 닫힘)이고 홈·허브·푸터에 새 링크 0, 무상 범위 화면은 계속 열려 있다", async () => {
  await setAllFlags(false);
  const cookie = await cookieOf(u.sub);
  const pages = [
    "/library", "/library/columns", `/library/columns/${fixture.column.id}`, `/library/wiki/${fixture.node}`, `/library/magazine/${fixture.issue.issue}`,
    "/qna", "/qna/new", "/qna/1", "/qna/criteria", "/qna/experts/1",
    "/law/timeline/some_issue", "/calc/oligopoly", "/calc/entity", "/calc/corporate-local-income",
    "/workspace", "/workspace/notes", "/workspace/scraps", "/workspace/searches", "/workspace/split?p=case:1", "/workspace/copilot", "/workspace/accounts",
    "/my/notifications", "/my/briefings",
  ];
  for (const p of pages) assert.equal((await page(p, { cookie })).status, 404, `${p} 꺼짐`);
  for (const [method, p, body] of [
    ["POST", "/api/qna/questions", {}], ["POST", "/api/qna/answers", {}], ["POST", "/api/qna/accept", {}], ["POST", "/api/qna/reports", {}], ["POST", "/api/qna/solved-consent", {}],
    ["POST", "/api/workspace/items", { action: "note_save", body: "x" }], ["POST", "/api/workspace/mode", { mode: "expert" }], ["GET", "/api/workspace/export?target=notes&format=csv", undefined],
    ["POST", "/api/copilot", { kind: "comparison", ids: ["a", "b"] }], ["POST", "/api/my/briefings", { id: 1 }],
  ]) {
    const r = await api(method, p, u.sub, body);
    assert.equal(r.status, 404, `${method} ${p}`);
  }
  const noti = await fetch(`${base}/api/my/notifications`, { method: "POST", redirect: "manual", headers: { authorization: `Bearer ${u.sub.token}`, origin: base, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams([["action", "save"]]) });
  assert.equal(noti.status, 404);
  // 제휴 피드 API는 404가 아니라 닫힘(키 없음 401 / 키 있어도 기능 키 꺼짐 503)이고 본문이 없다
  const noKey = await fetch(`${base}/api/feeds`);
  assert.equal(noKey.status, 401);
  const anyKey = await fetch(`${base}/api/feeds`, { headers: { authorization: `Bearer pf_1.${"A".repeat(43)}` } });
  assert.ok([401, 503].includes(anyKey.status), `피드 닫힘 ${anyKey.status}`);
  assert.equal((await anyKey.text()).includes(fixture.freeTitle), false);
  // 링크 0: 홈·허브·푸터(모든 화면)
  for (const p of ["/", "/tax", "/store", "/experts", "/law", "/local", "/realestate", "/finance", "/calc", "/glossary", "/help", "/security"]) {
    const r = await page(p);
    if (r.status !== 200) continue;
    assert.equal(NEW_LINK.test(r.html), false, `${p} 새 링크 0`);
  }
  const my = await page("/my", { cookie });
  if (my.status === 200) assert.equal(NEW_LINK.test(my.html), false, "/my 새 링크 0");
  const sec = await page("/security");
  assert.equal(sec.status, 200, "/security는 W12-g 무상 범위");
  assert.equal(/인증 추진 중|추진 중/.test(sec.html), false, "/security 추진 중 표기는 키가 꺼지면 0");
  // 무상 범위는 키와 무관하게 열려 있다
  for (const p of ["/", "/tax", "/local", "/realestate", "/finance"]) assert.equal((await page(p)).status, 200, `${p} 무상 범위`);
});
