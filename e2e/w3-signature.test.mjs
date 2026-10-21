// 시그니처 칼럼·편집 독립 E2E (W3 8단계 — PRD-01C BR-01·04·08, docs/dev/W3_설계.md 1장 8단계 증거 · 2.6 · 12장 #25~#28)
// standalone 빌드를 로컬 Supabase에 붙인다. 필자·연재 제목·비교 항목·증빙·동의서·감수 기록은 전부 '시험용' 가짜 글자다(실제 경력·'50년' 산정 기준 0).
//  a) 승인 전 저장 — 연재 제목 '50년'·'50 년'·'오십 년' 422(칸 title) + DB 거부, 회차 글(제목·주소)·기사 연재 이름 칸 422 칸별 오류
//  b) 홈 칼럼 영역 — 기능 키 꺼짐·공개 회차 0이면 영역 0(빈 껍데기 0)
//  c) 「그때와 지금」 — 출처·기준연도 빠지면 422 칸별 오류, 항목 없이 발행 422 + DB 거부, 갖추면 출처·기준연도와 함께 렌더 · 홈 최신 회차 ·
//     승인 전 '50년' 0 — 제목·메타·주소·JSON-LD·사이트맵 원본·검색 색인
//  d) 승인 뒤 — 연재 제목에만, 보이는 곳마다 근거 링크(인물 페이지의 증빙 약력 줄)와 함께, 메타·JSON-LD 0, 회차 글은 여전히 422, 근거를 거두면 다시 0
//  e) 편집 독립 — 브랜드 관리 담당의 승인·정렬·발행·연재 회차 API 403 + 감사 1건씩, 칼럼 필자 = 승인자(편집 승인·발행) 403 + 감사 + DB 거부
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { importSource } from "./lib/ts-source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_EMAIL = "w3-signature-e2e@example.test";
const SITE = "https://e2e.example.test";
const TITLE_50 = "시험용 연재 50년";

let sb, server, staff, db, base, hasClaimToken;
const u = {};
const fx = { articles: [] };
let flagsBefore;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 600);
async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const columns = (user, body) => api("POST", "/columns", user, body);
async function page(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
const visible = (html) =>
  decode(html.replace(/<head[\s\S]*?<\/head>/, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
/** 화면 글자가 아닌 곳 — 머리(제목·메타·공유 미리보기)·JSON-LD·주소(href·src) */
function machineParts(html) {
  const head = html.match(/<head[\s\S]*?<\/head>/)?.[0] ?? "";
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join(" ");
  const urls = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => decode(m[1])).join(" ");
  return { head: decode(head), ld, urls };
}
const errorFields = (r) => (r.body.errors ?? []).map((e) => String(e).split(":")[0]);
const auditCount = (action, target) => one("select count(*)::int n from public.audit_logs where action = $1 and target = $2", [action, target]).then((r) => r.n);
/** 공개 데이터 캐시(30초)를 바로 만료 — 바뀌는 것 없는 편집국 쓰기 (발행 주기 그대로) */
async function expire() {
  const cur = (await one("select value from public.settings where key = 'column_cadence'")).value;
  const r = await columns(u.editor, { op: "cadence", value: cur });
  assert.equal(r.status, 200, show(r));
}
async function setFlags(patch) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...cur, ...patch } });
  assert.equal(r.status, 200, show(r));
}
async function newColumn(tag, { title, slug } = {}) {
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body)
     values ($1, $2, '시험용 가짜 칼럼 요약', 'tax', 'opinion', 'draft', $3, $4) returning id, slug`,
    [slug ?? `e2e-sig-${tag}-${staff.run}`, title ?? `시험용 시그니처 칼럼 ${tag} ${staff.run}`, fx.writer, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 가짜 칼럼 본문입니다." }], claims: [] })],
  );
  staff.trackArticle(rows[0].id);
  fx.articles.push(Number(rows[0].id));
  const id = Number(rows[0].id);
  await db.query(
    "insert into public.column_meta (article_id, person_id, interest_state, interest_confirmed_by, interest_confirmed_at, contract_id) values ($1, $2, 'none_confirmed', '시험용 필자 확인', now(), $3)",
    [id, fx.writer, fx.contract],
  );
  return { id, slug: rows[0].slug, href: `/news/${rows[0].slug}` };
}
const publishDb = (id) => db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [id]);
const goodItem = { thenText: "시험용 과거 제도", nowText: "시험용 현재 제도", source: "시험용 출처 문서", baseYear: 1995 };

before(async () => {
  sb = localSupabase();
  buildWeb();
  ({ hasClaimToken } = await importSource(pathToFileURL(path.join(ROOT, "apps", "web", "lib", "brand", "claim.ts")).href));
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
  flagsBefore = (await one("select value from public.settings where key = 'feature_flags'")).value;
  u.admin = await staff.createUser({ label: "sig-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "sig-editor", roles: ["editor"], person: { name: "시그니처 시험 편집자", roles: ["editor"] } });
  // 칼럼 필자이면서 편집 책임자 역할도 가진 계정 — 자기 칼럼 승인·발행 시도 (BR-08)
  u.writer = await staff.createUser({ label: "sig-writer", roles: ["editor"], person: { name: "시험용 시그니처 필자", roles: ["writer", "editor"] } });
  u.ops = await staff.createUser({ label: "sig-ops", roles: ["brand_ops"] });
  fx.writer = u.writer.personId;
  fx.writerSlug = (await one("select slug from public.people where id = $1", [fx.writer])).slug;
  // 칼럼 발행 요건(W3 6·7단계) — 필자 검증·기고 계약·고지 문구 (시험용)
  await db.query("insert into public.author_verifications (person_id, evidence_kind, evidence_ref, verified_by, expires_at) values ($1, 'other', '시험용 검증 위치', 'admin:e2e-setup', now() + interval '30 days')", [fx.writer]);
  fx.contract = Number((await one("insert into public.column_contracts (person_id, doc_ref, signed_on, reuse_scope, ai_index_scope) values ($1, '시험용 계약 위치', '2026-01-10', array['online'], 'allow') returning id", [fx.writer])).id);
  await db.query("update public.settings set value = to_jsonb('시험용 의견 고지 문구입니다'::text) where key = 'column_opinion_notice'");
  fx.ep1 = await newColumn("ep1");
  fx.ep2 = await newColumn("ep2");
  fx.tn1 = await newColumn("tn1");
  fx.loose = await newColumn("loose");
});

after(async () => {
  try {
    if (db && fx.articles.length) await db.query("delete from public.articles where id = any($1::bigint[])", [fx.articles]);
    if (db && fx.writer) {
      await db.query("delete from public.column_contracts where person_id = $1", [fx.writer]);
      await db.query("delete from public.author_verifications where person_id = $1", [fx.writer]);
    }
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("a) 승인 전 저장 — 연재 제목 '50년' 변형 422(칸 title) + DB 거부, 회차 글·기사 연재 이름 칸 422 칸별 오류", async () => {
  for (const title of [TITLE_50, "시험용 연재 50 년", "시험용 연재 오십 년", "시험용 연재 ５０년"]) {
    const r = await columns(u.editor, { op: "series_title", seriesKey: "signature", title });
    assert.equal(r.status, 422, `${title} ${show(r)}`);
    assert.deepEqual(errorFields(r), ["title"]);
  }
  await assert.rejects(db.query("update public.settings set value = to_jsonb($1::text) where key = 'series_title_then_now'", [TITLE_50]), /career_claim_approved/, "DB도 거부");
  assert.equal((await columns(u.editor, { op: "series_title", seriesKey: "signature", title: `시험용 시그니처 연재 ${staff.run}` })).status, 200, "중립 제목은 저장");
  fx.titleSignature = `시험용 시그니처 연재 ${staff.run}`;
  assert.equal(await auditCount("column.series_title_edit", "settings:series_title_signature"), 1);

  const bad = await newColumn("bad", { title: `시험용 오십 년 칼럼 ${staff.run}`, slug: `e2e-sig-50nyeon-${staff.run}` });
  const assign = await columns(u.editor, { op: "signature", articleId: bad.id, seriesKey: "signature", episode: 9 });
  assert.equal(assign.status, 422, show(assign));
  assert.deepEqual(errorFields(assign), ["title", "slug"]);

  const ok = await columns(u.editor, { op: "signature", articleId: fx.ep1.id, seriesKey: "signature", episode: 1 });
  assert.equal(ok.status, 201, show(ok));
  assert.equal(await auditCount("column.signature_edit", `signature_episodes:${fx.ep1.id}`), 1);
  assert.equal((await columns(u.editor, { op: "signature", articleId: fx.ep2.id, seriesKey: "signature", episode: 1 })).status, 409, "같은 회차 두 번");
  assert.equal((await columns(u.editor, { op: "signature", articleId: fx.ep2.id, seriesKey: "signature", episode: 2 })).status, 201);

  const patched = await api("PATCH", `/articles/${fx.ep1.id}`, u.editor, { title: `시험용 50 년 칼럼 ${staff.run}` });
  assert.equal(patched.status, 422, show(patched));
  assert.deepEqual(errorFields(patched), ["title"]);
  const slug = await api("PATCH", `/articles/${fx.ep1.id}`, u.editor, { slug: `e2e-sig-50-nyeon-${staff.run}` });
  assert.equal(slug.status, 422, show(slug));
  assert.deepEqual(errorFields(slug), ["slug"]);
  const free = await api("PATCH", `/articles/${fx.loose.id}`, u.editor, { seriesTitle: "지방세 50년", seriesEpisode: 1 });
  assert.equal(free.status, 422, show(free));
  assert.ok(errorFields(free).includes("seriesTitle"), "기사 연재 이름 칸");
  await assert.rejects(db.query("update public.articles set title = '시험용 반세기 칼럼' where id = $1", [fx.ep1.id]), /경력 연수 표기/, "DB도 거부");
});

test("b) 홈 칼럼 영역 — 기능 키 꺼짐·공개 회차 0이면 영역 0 (빈 껍데기 0)", async () => {
  await expire();
  let home = (await page("/")).html;
  assert.ok(!home.includes('data-home-section="column"'), "기능 키 꺼짐");
  await setFlags({ tax_columns: true });
  home = (await page("/")).html;
  assert.equal((await one("select count(*)::int n from public.public_signature_episodes")).n, 0, "공개 회차 0");
  assert.ok(!home.includes('data-home-section="column"'), "회차 0 → 섹션 0");
  assert.ok(!home.includes('data-part="signature-columns"'), "빈 목록 껍데기 0");
  assert.ok(!visible(home).includes("김의효 칼럼"), "섹션 제목도 0");
});

test("c) 「그때와 지금」 출처·기준연도 필수·항목 없이 발행 거부 · 홈 최신 회차 · 승인 전 '50년' 0 (제목·메타·주소·JSON-LD·사이트맵 원본·검색)", async () => {
  assert.equal((await columns(u.editor, { op: "signature", articleId: fx.tn1.id, seriesKey: "then_now", episode: 1 })).status, 201);
  const noSource = await columns(u.editor, { op: "then_now", articleId: fx.tn1.id, items: [{ ...goodItem, source: "" }] });
  assert.equal(noSource.status, 422, show(noSource));
  assert.deepEqual(errorFields(noSource), ["items[0].source"]);
  const noYear = await columns(u.editor, { op: "then_now", articleId: fx.tn1.id, items: [goodItem, { ...goodItem, baseYear: null }] });
  assert.equal(noYear.status, 422, show(noYear));
  assert.deepEqual(errorFields(noYear), ["items[1].baseYear"]);
  assert.equal((await columns(u.editor, { op: "then_now", articleId: fx.ep1.id, items: [goodItem] })).status, 422, "시그니처 칼럼 회차에는 비교 항목 없음");

  const early = await api("POST", `/articles/${fx.tn1.id}/publish`, u.editor);
  assert.equal(early.status, 422, show(early));
  assert.ok(errorFields(early).includes("thenNow"), "항목 없이 발행");
  await assert.rejects(publishDb(fx.tn1.id), /비교 항목/, "DB도 거부");
  const saved = await columns(u.editor, { op: "then_now", articleId: fx.tn1.id, items: [{ ...goodItem, label: "시험용 비교 항목", sourceUrl: "https://example.test/source" }] });
  assert.equal(saved.status, 200, show(saved));
  assert.equal(saved.body.count, 1);
  assert.equal(await auditCount("column.then_now_edit", `then_now_items:${fx.tn1.id}`), 1);
  for (const a of [fx.tn1, fx.ep1, fx.ep2]) await publishDb(a.id);
  await expire();

  const tn = (await page(fx.tn1.href)).html;
  const block = tn.slice(tn.indexOf('data-part="then-now"'));
  assert.equal((tn.match(/data-part="then-now-item"/g) ?? []).length, 1, "비교 항목 1줄");
  assert.match(visible(block), /출처 시험용 출처 문서 · 기준연도 1995년/, "출처·기준연도와 함께");
  assert.match(visible(block), /그때 \(1995년 기준\)/);
  assert.match(visible(tn), /연재 「그때와 지금」 1회/, "연재 줄 = 설정 제목·회차");

  const home = (await page("/")).html;
  assert.ok(home.includes('data-home-section="column"'), "공개 회차가 생기면 홈 영역");
  const homeItems = [...home.matchAll(/data-series-key="([a-z_]+)" data-article-id="(\d+)" data-episode="(\d+)"/g)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
  assert.deepEqual(homeItems, [["signature", fx.ep2.id, 2], ["then_now", fx.tn1.id, 1]], "연재마다 최신 회차 1편");

  const list = (await page("/tax/columns")).html;
  assert.match(visible(list), new RegExp(`연재 「${fx.titleSignature}」`), "칼럼 목록 연재 묶음");
  const detail = (await page(fx.ep2.href)).html;
  assert.match(visible(detail), new RegExp(`연재 「${fx.titleSignature}」 2회`));

  // 승인 전 '50년' 0 — 홈·칼럼 목록·회차 상세·필자 인물 페이지의 화면 글자·머리·JSON-LD·주소
  for (const p of ["/", "/tax/columns", fx.ep1.href, fx.ep2.href, fx.tn1.href, `/people/${fx.writerSlug}`]) {
    const { status, html } = await page(p);
    assert.equal(status, 200, p);
    const parts = machineParts(html);
    assert.equal(hasClaimToken(visible(html)), false, `${p} 화면 글자`);
    assert.equal(hasClaimToken(parts.head), false, `${p} 제목·메타`);
    assert.equal(hasClaimToken(parts.ld), false, `${p} JSON-LD`);
    assert.equal(hasClaimToken(parts.urls), false, `${p} 주소`);
    assert.equal((html.match(/data-part="claim-basis"/g) ?? []).length, 0, `${p} 근거 링크도 0 (연수 표기가 없으니)`);
  }
  // 사이트맵 원본(W7이 읽을 공개 뷰 — 기사 주소·제목, 인물 페이지 주소, 연재 제목)
  const sitemap = await db.query(
    `select slug as v from public.public_articles where id = any($1::bigint[]) union all select title from public.public_articles where id = any($1::bigint[])
     union all select slug from public.public_profile_pages union all select coalesce(title, '') from public.public_signature_series`,
    [fx.articles],
  );
  assert.equal(sitemap.rows.filter((r) => hasClaimToken(r.v)).length, 0, "사이트맵 원본 0");
  // 검색 색인 — 공개 검색 함수(anon)로 '50년'과 이 시험 회차를 찾는다
  await db.query("begin");
  try {
    await db.query("set local role anon");
    const hits = (await db.query("select slug, title, snippet from public.search_public($1)", ["50년"])).rows;
    const episodes = new Set([fx.ep1.slug, fx.ep2.slug, fx.tn1.slug]);
    assert.equal(hits.filter((h) => episodes.has(h.slug)).length, 0, "검색 '50년' → 시그니처 회차 0");
    const ours = (await db.query("select slug, title, snippet from public.search_public($1)", [staff.run])).rows;
    assert.ok(ours.length >= 1, "이 시험 회차가 색인에 있다");
    assert.equal(ours.filter((h) => hasClaimToken(`${h.title} ${h.snippet}`)).length, 0, "색인 글자에 '50년' 0");
  } finally {
    await db.query("rollback");
  }
});

test("d) 승인 뒤 — '50년'은 연재 제목에만, 보이는 곳마다 근거 링크와 함께, 메타·JSON-LD 0 · 회차 글은 여전히 422 · 근거를 거두면 다시 0", async () => {
  const brand = (body) => api("POST", "/brand", u.admin, body);
  const ev = await api("POST", "/brand", u.ops, { op: "evidence", personId: fx.writer, kind: "document", docRef: "시험용 근거 증빙 위치" });
  assert.equal(ev.status, 201, show(ev));
  fx.evidence = Number(ev.body.evidence.id);
  assert.equal((await brand({ op: "evidence_approve", id: fx.evidence })).status, 200);
  assert.equal((await api("POST", "/brand", u.ops, { op: "bio", personId: fx.writer, items: [{ item: "시험용 근거 약력 줄", evidenceId: fx.evidence }] })).status, 200);
  assert.equal((await brand({ op: "career_claim", value: true, basisEvidenceId: fx.evidence })).status, 200);
  const saved = await columns(u.editor, { op: "series_title", seriesKey: "signature", title: TITLE_50 });
  assert.equal(saved.status, 200, `승인 뒤 저장 ${show(saved)}`);
  // brand_copy 전: 저장은 되지만 공개 제목은 막혀 연재 틀이 숨는다
  await expire();
  let home = (await page("/")).html;
  assert.equal(hasClaimToken(visible(home)), false, "brand_copy 전 화면 0");
  assert.deepEqual([...home.matchAll(/data-series-key="([a-z_]+)"/g)].map((m) => m[1]), ["then_now"], "제목이 막힌 연재는 홈에서 빠진다");
  assert.equal((await brand({ op: "brand_review", value: true, recordRef: "시험용 감수 기록 위치" })).status, 200);
  assert.equal((await brand({ op: "brand_copy", value: true })).status, 200);
  await expire();

  const href = `/people/${fx.writerSlug}#evidence-${fx.evidence}`;
  const shownWithLink = new RegExp(`연재 「${TITLE_50}」(?: \\d+회)?(?:<!-- -->)?<a\\b[^>]*data-part="claim-basis"`, "g");
  for (const p of ["/", "/tax/columns", fx.ep1.href, fx.ep2.href]) {
    const { html } = await page(p);
    const text = visible(html);
    const shown = text.split(`연재 「${TITLE_50}」`).length - 1;
    const links = [...html.matchAll(/<a\b[^>]*data-part="claim-basis"[^>]*>/g)].map((m) => decode(m[0].match(/href="([^"]*)"/)?.[1] ?? ""));
    assert.ok(shown >= 1, `${p} 연재 제목이 보인다`);
    assert.equal((html.match(shownWithLink) ?? []).length, shown, `${p} 보이는 '50년'마다 바로 뒤에 근거 링크`);
    assert.equal(links.length, shown, `${p} 근거 링크 수 = 보이는 수`);
    assert.ok(links.every((l) => l === href), `${p} 근거 링크 → 인물 페이지 증빙 줄`);
    assert.equal(hasClaimToken(visible(html.replace(shownWithLink, " "))), false, `${p} 링크 없는 '50년' 0`);
    const parts = machineParts(html);
    assert.equal(hasClaimToken(parts.head), false, `${p} 제목·메타 0`);
    assert.equal(hasClaimToken(parts.ld), false, `${p} JSON-LD 0`);
  }
  const person = (await page(`/people/${fx.writerSlug}`)).html;
  assert.match(person, new RegExp(`<li[^>]*id="evidence-${fx.evidence}"[^>]*>\\s*시험용 근거 약력 줄`), "근거 링크가 가리키는 증빙 약력 줄");
  const still = await api("PATCH", `/articles/${fx.ep1.id}`, u.editor, { title: `시험용 50년 칼럼 ${staff.run}`, updateKind: "substantive", reason: "시험용 수정" });
  assert.equal(still.status, 422, `승인 뒤에도 회차 제목은 거부 ${show(still)}`);
  assert.deepEqual(errorFields(still), ["title"]);

  // 근거 증빙 승인을 거두면 brand_copy가 함께 꺼지고 다음 요청부터 '50년' 0
  assert.equal((await brand({ op: "evidence_revoke", id: fx.evidence })).status, 200);
  for (const p of ["/", "/tax/columns", fx.ep2.href]) {
    const { html } = await page(p);
    assert.equal(hasClaimToken(visible(html)), false, `${p} 거둔 뒤 화면 0`);
    assert.equal((html.match(/data-part="claim-basis"/g) ?? []).length, 0, `${p} 근거 링크 0`);
  }
  assert.equal((await one("select title from public.public_signature_series where series_key = 'signature'")).title, null, "공개 뷰 제목 null");
});

test("e) 편집 독립 — 브랜드 관리 담당의 승인·정렬·발행·연재 회차 403 + 감사 1건씩, 칼럼 필자 = 승인자 403 + 감사 + DB 거부", async () => {
  const target = `articles:${fx.loose.id}`;
  const desk = await api("POST", `/articles/${fx.loose.id}/reviews`, u.ops, { kind: "desk_edit", decision: "approve" });
  assert.equal(desk.status, 403, show(desk));
  assert.equal(await auditCount("review.desk_edit.denied", target), 1, "승인 거부 감사 1건");
  const sort = await api("POST", `/articles/${fx.ep2.id}/placement`, u.ops, { navCandidate: true });
  assert.equal(sort.status, 403, show(sort));
  assert.equal(await auditCount("article.sort.denied", `articles:${fx.ep2.id}`), 1, "정렬 거부 감사 1건");
  const pub = await api("POST", `/articles/${fx.loose.id}/publish`, u.ops);
  assert.equal(pub.status, 403, show(pub));
  assert.equal(await auditCount("article.publish.denied", target), 1, "발행 거부 감사 1건");
  const order = await columns(u.ops, { op: "signature", articleId: fx.loose.id, seriesKey: "signature", episode: 7 });
  assert.equal(order.status, 403, show(order));
  assert.equal(await auditCount("column.signature.denied", "columns:signature"), 1, "연재 회차·순서 거부 감사 1건");
  const verify = await columns(u.ops, { op: "verify", personId: fx.writer, evidenceKind: "other", evidenceRef: "시험용" });
  assert.equal(verify.status, 403);
  assert.equal(await auditCount("column.manage.denied", "columns:verify"), 1, "필자 검증 거부 감사 1건");
  assert.equal((await one("select count(*)::int n from public.signature_episodes where article_id = $1", [fx.loose.id])).n, 0, "아무것도 바뀌지 않음");

  // 칼럼 필자 = 승인자 — 필자 계정(편집 책임자 역할도 있음)이 자기 칼럼을 승인·발행
  const ownDesk = await api("POST", `/articles/${fx.loose.id}/reviews`, u.writer, { kind: "desk_edit", decision: "approve" });
  assert.equal(ownDesk.status, 403, show(ownDesk));
  assert.equal(await auditCount("review.desk_edit.denied", target), 2, "필자 본인 승인 거부 감사");
  const ownPub = await api("POST", `/articles/${fx.loose.id}/publish`, u.writer);
  assert.equal(ownPub.status, 403, show(ownPub));
  assert.match(String(ownPub.body.error ?? ownPub.body.message ?? JSON.stringify(ownPub.body)), /BR-08/);
  assert.equal(await auditCount("article.publish.denied", target), 2, "필자 본인 발행 거부 감사");
  await assert.rejects(db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision) values ($1, 'desk_edit', $2, 'approve')", [fx.loose.id, fx.writer]), /NAV-12/, "DB — 필자 본인 편집 승인");
  const record = JSON.stringify({ publish: { at: new Date().toISOString(), by: `user:${u.writer.id}`, version: 1 } });
  await assert.rejects(db.query("update public.articles set status = 'published', first_published_at = now(), check_log = $2 where id = $1", [fx.loose.id, record]), /BR-08/, "DB — 필자 본인 발행 기록");
  assert.equal((await one("select status from public.articles where id = $1", [fx.loose.id])).status, "draft", "기사는 그대로");
  await setFlags({ tax_columns: flagsBefore.tax_columns === true });
});
