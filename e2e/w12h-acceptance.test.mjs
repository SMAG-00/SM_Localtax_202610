// W12-h 수용 E2E - 데이터 스토리·채널 배포 키트 (docs/dev/W12-h_설계.md - PRD-04 DATA-01 · CH-01)
// standalone 빌드를 로컬 Supabase에 붙인다. 통계 값·제목·원고 문장은 전부 시험용 가짜다. 기능 키는 시험 동안만 켜고 끝나면 원래 값으로 되돌린다.
//  a) 키 꺼짐(기본) - /data · /data/[키] 404
//  b) 통계 - 승인 전 404 · 직원 아님 403 · 편집 책임자 승인 · 승인 뒤 /data 200 + 상세에 SVG 점 수 = 표 행 수 + 출처·기준연도·확인일
//  c) 기사 차트 - 연결 뒤 기사 화면에 차트 · 새 기준연도 승인 뒤에도 기준연도 고정 + 새 기준연도 안내 · 철회는 이유 필수 · 철회 뒤 차트 0
//  d) 채널 키트 - 키 꺼짐 409 · 승인 전 원고 키트 0 · 승인 원고만 내려받기 · 직원 아님 403 · 게시 기록은 체크리스트 4칸 + https 필요(422) · 1건만(409)
//  e) 수집·키트 소스에 AI SDK/호출 0, 외부 채널 게시 호출 0
// 클라이언트 측정 요소(채널 유입)는 화면에 그려지는 것이 없어 단위 시험(channelLandingProps)과 DB 시험(공개 뷰)으로 확인한다.
// 만든 행은 끝나면 지우고 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w12h-acceptance-e2e@example.test";
const SITE = "https://e2e-w12h.example.test";
const CRON = "e2e-w12h-cron";
const GUARD = "e2e-w12h-guard-secret";
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = "mois_local_tax_stats";
const CHECKS = ["original_compared", "numbers_dates_links", "no_personal_info", "channel_limits_checked"];
const FULL = { source_noted: true, ai_notice: true, alt_text: true, not_ad: true };

let sb, server, staff, db, base, saved, savedSource, run;
const u = {};
const ids = { snapshots: [], articles: [], people: [], items: [] };

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
  return { status: res.status, body: parsed, text, type: res.headers.get("content-type") ?? "" };
}
const stats = (user, body) => api("POST", "/api/admin/stats", user, body);
const channels = (user, body) => api("POST", "/api/admin/channels", user, body);
const page = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
const count = (html, re) => (html.match(re) ?? []).length;
const serverEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
  ADMIN_EMAILS: ADMIN_EMAIL,
  NEXT_PUBLIC_SITE_URL: SITE,
  CRON_SECRET: CRON,
  GUARD_SECRET: GUARD,
});
async function startAll() {
  server = await startServer(serverEnv());
  base = server.base;
}
/** 공개 데이터 캐시(30초)를 새로 시작하려고 서버를 다시 띄운다 - 새 배포와 같은 출발점 */
async function restart() {
  await server?.stop?.();
  await startAll();
}
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
  if (server) await restart();
}
const key = (s) => `e2e_w12h_${run}_${s}`;
async function put(seriesKey, baseYear, points) {
  const snap = { url: "https://example.test/w12h/list", payload: `{"시험용":"${seriesKey}${baseYear}"}`, content_hash: `h-${run}-${seriesKey}-${baseYear}`, http_status: 200, external_id: `${run}-${seriesKey}-${baseYear}` };
  const s = { series_key: seriesKey, title: `시험용 시계열 ${seriesKey}`, tax_item: "시험세목", region_code: null, unit: "시험단위", points, source_name: "시험용 출처", source_url: "https://example.test/about", base_year: baseYear, checked_at: "2026-10-01" };
  const r = (await db.query("select public.stats_series_put($1, $2::jsonb, $3::jsonb, 'job:e2e') r", [SRC, JSON.stringify(snap), JSON.stringify(s)])).rows[0].r;
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.id;
}
async function publishedArticle(slug) {
  const person = (await db.query("insert into public.people (slug, name, roles, visibility) values ($1, '시험 기자', array['reporter'], 'public') returning id", [`e2e-w12h-p-${run}-${ids.people.length}`])).rows[0];
  ids.people.push(person.id);
  const a = (
    await db.query(
      `insert into public.articles (slug, title, section, content_type, status, author_id, body, first_published_at)
       values ($1, '시험용 기사 제목', 'tax', 'explainer', 'published', $2, $3, now()) returning id, slug`,
      [slug, person.id, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 본문입니다." }], claims: [] })],
    )
  ).rows[0];
  ids.articles.push(a.id);
  return a;
}
async function channelDraft(a, channel, approve) {
  const url = `${SITE}/news/${a.slug}?utm_source=${channel}&utm_medium=owned&utm_campaign=${a.slug}`;
  const item = (
    await db.query("insert into public.review_items (kind, source_key, title, payload, created_by) values ('channel_draft', $1, '시험용 채널 원고', $2, 'job:e2e') returning id", [
      `e2e-w12h:${run}:${channel}:${ids.items.length}`,
      JSON.stringify({ articleId: a.id, articleVersion: 1, channel, text: `시험용 ${channel} 원고`, articleUrl: url }),
    ])
  ).rows[0];
  ids.items.push(item.id);
  if (approve) {
    await db.query("select public.review_item_transition($1, 'in_review', $2)", [item.id, `admin:${ADMIN_EMAIL}`]);
    await db.query("select public.review_item_transition($1, 'approved', $2, null, $3)", [item.id, `admin:${ADMIN_EMAIL}`, CHECKS]);
  }
  return item.id;
}

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.article_data_charts where article_id = any($1::bigint[])", [ids.articles]);
    await db.query("delete from public.channel_posts where article_id = any($1::bigint[])", [ids.articles]);
    await db.query("delete from public.channel_kit_downloads where review_item_id = any($1::bigint[])", [ids.items]);
    await db.query("delete from public.channel_audit where review_item_id = any($1::bigint[]) or (review_item_id is null and actor like 'user:%' and at > now() - interval '1 day')", [ids.items]);
    if (ids.items.length) {
      await db.query("delete from public.review_item_events where item_id = any($1::bigint[])", [ids.items]);
      await db.query("delete from public.review_items where id = any($1::bigint[])", [ids.items]);
    }
    await db.query("delete from public.stats_audit where actor like 'user:%' and at > now() - interval '1 day'");
    const rows = (await db.query("select snapshot_id from public.stats_series where series_key like $1", [`e2e_w12h_${run}%`])).rows.map((r) => r.snapshot_id);
    await db.query("delete from public.stats_series where series_key like $1", [`e2e_w12h_${run}%`]);
    if (rows.length) await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [rows]);
    await db.query("delete from public.stats_audit where actor = 'job:e2e'");
    await db.query("delete from public.articles where id = any($1::bigint[])", [ids.articles]);
    await db.query("delete from public.people where id = any($1::bigint[])", [ids.people]);
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
  saved = (await db.query("select key, value from public.settings where key = 'feature_flags'")).rows;
  savedSource = (await db.query("select terms_status, terms_checked_by, terms_checked_at, contract_verified_by, contract_verified_at from public.data_sources where key = $1", [SRC])).rows[0];
  u.admin = await staff.createUser({ label: "w12h-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w12h-editor", roles: ["editor"], person: { name: "시험용 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w12h-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  await db.query("update public.data_sources set terms_status = 'allowed', terms_checked_by = 'e2e', terms_checked_at = now(), contract_verified_by = 'e2e', contract_verified_at = now() where key = $1", [SRC]);
  await setFlags({ data_stories: false, channel_kit: false });
  await purge();
});

after(async () => {
  try {
    await purge();
    for (const s of saved ?? []) await db.query("update public.settings set value = $2::jsonb where key = $1", [s.key, JSON.stringify(s.value)]);
    if (savedSource) {
      await db.query("update public.data_sources set terms_status = $2, terms_checked_by = $3, terms_checked_at = $4, contract_verified_by = $5, contract_verified_at = $6 where key = $1", [
        SRC, savedSource.terms_status, savedSource.terms_checked_by, savedSource.terms_checked_at, savedSource.contract_verified_by, savedSource.contract_verified_at,
      ]);
    }
  } finally {
    await staff?.cleanup();
    await server?.stop();
  }
});

test("a) 키 꺼짐(기본) - /data · 상세 404", async () => {
  assert.equal((await page("/data")).status, 404);
  assert.equal((await page(`/data/${key("a")}`)).status, 404);
});

test("b) 통계 - 승인 전 404, 직원 아님 403, 승인 뒤 /data 200 + SVG 점 수 = 표 행 수 + 출처·기준연도·확인일", async () => {
  const points = [{ period: "2021", value: 10 }, { period: "2022", value: 14 }, { period: "2023", value: 12 }];
  const id = await put(key("a"), 2023, points);
  await setFlags({ data_stories: true });
  assert.equal((await page(`/data/${key("a")}`)).status, 404, "초안은 공개 0");
  assert.equal((await stats(u.reporter, { op: "approve", id })).status, 403);
  const ok = await stats(u.editor, { op: "approve", id });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await stats(u.editor, { op: "approve", id })).status, 409, "이미 승인");
  await restart();
  const list = await page("/data");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes(`시험용 시계열 ${key("a")}`));
  const detail = await page(`/data/${key("a")}`);
  assert.equal(detail.status, 200);
  assert.equal(count(detail.html, /data-dot="/g), points.length, "SVG 점 수");
  assert.equal(count(detail.html, /data-row="/g), points.length, "표 행 수");
  assert.ok(detail.html.includes("시험용 출처"));
  assert.ok(/기준연도[^<]*<span[^>]*>2023</.test(detail.html) || detail.html.includes("2023"));
  assert.ok(detail.html.includes("2026-10-01"), "확인일");
});

test("c) 기사 차트 - 연결, 새 기준연도 뒤에도 기준연도 고정 + 안내, 철회는 이유 필수, 철회 뒤 차트 0", async () => {
  const art = await publishedArticle(`e2e-w12h-art-${run}`);
  const old = (await db.query("select id from public.stats_series where series_key = $1 and base_year = 2023", [key("a")])).rows[0].id;
  assert.equal((await stats(u.reporter, { op: "attach", series_id: old, article_id: art.id })).status, 403);
  const att = await stats(u.editor, { op: "attach", series_id: old, article_id: art.id, caption: "시험용 차트 제목" });
  assert.equal(att.status, 201, JSON.stringify(att.body));
  await restart();
  let html = (await page(`/news/${art.slug}`)).html;
  assert.ok(html.includes('data-part="article-charts"'));
  assert.equal(count(html, /data-dot="/g), 3);
  assert.ok(html.includes("시험용 차트 제목"));
  assert.ok(!html.includes('data-part="newer-base-year"'));

  const next = await put(key("a"), 2024, [{ period: "2024", value: 20 }]);
  assert.equal((await stats(u.editor, { op: "approve", id: next })).status, 200);
  await restart();
  html = (await page(`/news/${art.slug}`)).html;
  assert.equal(count(html, /data-dot="/g), 3, "기사 차트는 기준연도 2023 그대로");
  assert.ok(html.includes('data-part="newer-base-year"'), "새 기준연도 안내");
  const board = await api("GET", "/api/admin/stats", u.editor);
  assert.equal(board.status, 200);
  assert.ok(board.body.links.some((l) => Number(l.article_id) === Number(art.id) && l.newer_base_year === 2024), "관리 화면 목록에 새 기준연도 표시");
  assert.equal((await api("GET", "/api/admin/stats", u.reporter)).status, 403);

  assert.equal((await stats(u.editor, { op: "withdraw", id: next })).status, 409, "이유 없는 철회");
  assert.equal((await stats(u.editor, { op: "withdraw", id: next, reason: "시험용 이유" })).status, 200);
  assert.equal((await stats(u.editor, { op: "withdraw", id: old, reason: "시험용 이유" })).status, 200);
  await restart();
  html = (await page(`/news/${art.slug}`)).html;
  assert.ok(!html.includes('data-part="article-charts"'), "철회 뒤 차트 0");
});

test("d) 채널 키트 - 키 꺼짐 409, 승인 전 원고 0, 승인 원고만 내려받기, 게시 기록 규칙", async () => {
  const art = await publishedArticle(`e2e-w12h-ch-${run}`);
  const approved = await channelDraft(art, "brief", true);
  await channelDraft(art, "shorts", false);
  const kit = (user) => api("GET", `/api/admin/channels?kit=${art.id}`, user);
  assert.equal((await kit(u.editor)).status, 409, "키 꺼짐");
  await setFlags({ channel_kit: true });
  assert.equal((await kit(u.reporter)).status, 403);
  const k = await kit(u.editor);
  assert.equal(k.status, 200);
  assert.ok(k.type.startsWith("text/plain"));
  assert.ok(k.text.includes("시험용 brief 원고"));
  assert.ok(!k.text.includes("시험용 shorts 원고"), "승인 전 원고는 키트에 0");
  const json = await api("GET", `/api/admin/channels?kit=${art.id}&format=json`, u.editor);
  assert.deepEqual(json.body.bundles.map((b) => b.channel), ["brief"]);

  const body = { op: "post", review_item_id: approved, posted_url: "https://example.test/post/1", checklist: FULL };
  assert.equal((await channels(u.reporter, body)).status, 403);
  assert.equal((await channels(u.editor, { ...body, checklist: { ...FULL, alt_text: false } })).status, 422);
  assert.equal((await channels(u.editor, { ...body, posted_url: "http://example.test/p" })).status, 422);
  const ok = await channels(u.editor, body);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await channels(u.editor, body)).status, 409, "원고당 1건");
  const reg = await db.query("select channel, utm_campaign from public.public_channel_posts where utm_campaign = $1", [art.slug]);
  assert.deepEqual(reg.rows.map((r) => ({ ...r })), [{ channel: "brief", utm_campaign: art.slug }]);
  const landing = await page(`/news/${art.slug}?utm_source=brief&utm_medium=owned&utm_campaign=${art.slug}`);
  assert.equal(landing.status, 200, "UTM 링크로 들어와도 기사는 200");
  assert.equal((await page(`/news/${art.slug}?utm_source=unknown&utm_campaign=${art.slug}`)).status, 200);
});

test("e) 소스 확인 - 수집·키트 코드에 AI 호출·외부 채널 게시 호출 0", () => {
  const files = [
    "workflows/src/stats/collect.ts", "workflows/src/stats/gate.ts", "workflows/src/stats/specs.ts", "apps/web/lib/server/stats/service.ts",
    "apps/web/lib/channels/kit.ts", "apps/web/lib/server/channels/board.ts", "apps/web/app/api/admin/channels/route.ts", "apps/web/app/api/admin/stats/route.ts",
  ];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.doesNotMatch(text, /anthropic|openai|@anthropic-ai|ops-model|\bOpsModel\b/i, `${f} AI`);
  }
  for (const f of files.filter((x) => x.includes("channels"))) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.doesNotMatch(text, /\bfetch\s*\(/, `${f} 외부 호출`);
  }
});
