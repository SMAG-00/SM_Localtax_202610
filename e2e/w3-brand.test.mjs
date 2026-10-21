// 브랜드 E2E (W3 7단계 — PRD-01C BR-01·02·03·07·08, docs/dev/W3_설계.md 1장 7단계 증거)
// standalone 빌드를 로컬 Supabase에 붙인다. 인물·약력·증빙 위치·동의서 버전·감수 기록은 전부 '시험용' 가짜 글자다(실제 경력·동의서 문구 0).
//  a) 권한 — 편집자 403 · 브랜드 관리 담당은 증빙 등록까지(승인 403 + 거부 감사 1건) · 관리자 승인 + 감사 1건 · 증빙 없는 약력 저장 422
//  b) 약력 — 렌더 약력 줄 수 = 승인 증빙 줄 수, 증빙 없는(승인 전) 줄은 인물 페이지·칼럼 필자 줄·구조화 데이터·공유 미리보기 어디에도 0, JSON-LD = 화면(compareRendered 0)
//  c) 동의서 — 동의서 없으면 인물 페이지 404·칼럼 발행 거부, 범위에 profile_page가 없으면 404, 철회 → 다음 요청부터 404 + 사이트맵 원본 0 + 기사 필자 링크·JSON-LD url 0
//  d) 감수 표시 — 서명 기록 없는 기사에 '감수 ○○' 0, 서명 뒤 1개, 오탈자 수정은 유지, 실질 수정 → 0 + 재감수 큐 1건, 다시 서명 → 1개
//  e) 브랜드 스위치 — brand_copy는 감수 기록·경력 승인 전 거부(API·운영 설정 둘 다 422), 갖추면 켜짐, 근거 증빙 승인을 거두면 함께 꺼짐 / people_pages 켜면 역할별 블록
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { importSource } from "./lib/ts-source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_EMAIL = "w3-brand-e2e@example.test";
const SITE = "https://e2e.example.test";

let sb, server, staff, db, base, compareRendered;
const u = {};
const fx = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 600);
async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const brand = (user, body) => api("POST", "/brand", user, body);
async function page(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
const strip = (s) => decode(s.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
/** 인물 페이지 화면 값 — 머리 이름·검증된 약력 줄 (seo-lint가 화면에서 뽑는 칸과 같다) */
function personFacts(html) {
  const head = html.slice(html.indexOf('data-ui="person-header"'));
  const name = strip(head.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "");
  const list = head.match(/<ul aria-label="검증된 약력"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "";
  const bio = [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => strip(m[1]));
  return { name, bio };
}
function jsonLd(html) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, "JSON-LD 스크립트가 없다");
  return JSON.parse(m[1]);
}
const nodesOf = (ld) => (Array.isArray(ld) ? ld : [ld]);
const mainOf = (ld, type) => nodesOf(ld).find((n) => n["@type"] === type);
const markCount = (html) => (html.match(/data-part="review-mark"/g) ?? []).length;
/** 공개 데이터 캐시(30초)를 바로 만료시키는 편집국 쓰기 — DB에 직접 넣은 수정 뒤에 부른다 (같은 약력을 다시 저장 — 감사 1줄) */
async function expireCache() {
  const r = await brand(u.admin, { op: "bio", personId: fx.anchor, items: [] });
  assert.equal(r.status, 200, show(r));
}
async function newPerson(tag, roles = ["writer"]) {
  const { rows } = await db.query("insert into public.people (slug, name, roles, visibility) values ($1, $2, $3, 'public') returning id, slug", [`e2e-brand-${tag}-${staff.run}`, `시험용 인물 ${tag}`, roles]);
  staff.personIds.add(Number(rows[0].id));
  return { id: Number(rows[0].id), slug: rows[0].slug, name: `시험용 인물 ${tag}` };
}
async function newArticle(tag, { authorId, contentType = "explainer", status = "published" }) {
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body, first_published_at)
     values ($1, $2, '시험용 가짜 기사', 'tax', $3, $4, $5, $6, $7) returning id, slug, version`,
    [`e2e-brand-art-${tag}-${staff.run}`, `시험용 브랜드 기사 ${tag} ${staff.run}`, contentType, status, authorId, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 가짜 본문입니다." }], claims: [] }), status === "published" ? hoursAgo(5) : null],
  );
  staff.trackArticle(rows[0].id);
  return { id: Number(rows[0].id), slug: rows[0].slug, href: `/news/${rows[0].slug}`, version: Number(rows[0].version) };
}
async function revise(articleId, kind) {
  const { version } = await one("select version from public.articles where id = $1", [articleId]);
  const next = Number(version) + 1;
  await db.query("insert into public.article_revisions (article_id, version, title, body, edited_by, reason, update_kind) values ($1, $2, '시험용', '{}'::jsonb, 'admin:e2e-setup', '시험용 수정', $3)", [articleId, next, kind]);
  await db.query(`update public.articles set version = $2${kind === "typo" ? "" : ", substantive_updated_at = now(), update_kind = 'substantive', updated_reason = '시험용 수정'"} where id = $1`, [articleId, next]);
}
const auditCount = (action, target) => one("select count(*)::int n from public.audit_logs where action = $1 and target = $2", [action, target]).then((r) => r.n);

before(async () => {
  sb = localSupabase();
  buildWeb();
  ({ compareRendered } = await importSource(pathToFileURL(path.join(ROOT, "packages", "structured-data", "src", "compare.ts")).href));
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
  u.admin = await staff.createUser({ label: "brand-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "brand-editor", roles: ["editor"], person: { name: "브랜드 시험 편집자", roles: ["editor"] } });
  u.ops = await staff.createUser({ label: "brand-ops", roles: ["brand_ops"] });
  u.reviewer = await staff.createUser({ label: "brand-reviewer", roles: ["reviewer"], person: { name: "시험용 감수위원", roles: ["reviewer"] } });
  u.reporter = await staff.createUser({ label: "brand-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  fx.anchor = u.editor.personId;
  // 첫 화면 요청 전에 DB에 넣는다 (공개 데이터 캐시 30초)
  fx.writer = await newPerson("writer");
  fx.none = await newPerson("noconsent");
  fx.column = await newArticle("column", { authorId: fx.writer.id, contentType: "opinion", status: "draft" });
  fx.noneColumn = await newArticle("none-column", { authorId: fx.none.id, contentType: "opinion", status: "draft" });
  fx.noneNews = await newArticle("none-news", { authorId: fx.none.id });
  fx.signed = await newArticle("signed", { authorId: u.reporter.personId });
  fx.unsigned = await newArticle("unsigned", { authorId: u.reporter.personId });
});

after(async () => {
  try {
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("a) 권한 — 편집자 403, 브랜드 관리 담당은 증빙 등록까지(승인은 403 + 거부 감사), 관리자 승인 + 감사, 증빙 없는 약력 422", async () => {
  assert.equal((await api("GET", "/brand", u.editor)).status, 403, "편집자 목록");
  assert.equal((await brand(u.editor, { op: "evidence", personId: fx.writer.id, kind: "document", docRef: "시험용 증빙 위치" })).status, 403, "편집자 등록");
  const list = await api("GET", "/brand", u.ops);
  assert.equal(list.status, 200, show(list));
  const bad = await brand(u.ops, { op: "evidence", personId: fx.writer.id, kind: "license", docRef: "시험용 증빙 위치" });
  assert.equal(bad.status, 422, "설계 밖 증빙 종류");
  const e1 = await brand(u.ops, { op: "evidence", personId: fx.writer.id, kind: "document", docRef: "시험용 증빙 위치 1" });
  assert.equal(e1.status, 201, show(e1));
  fx.e1 = Number(e1.body.evidence.id);
  assert.equal(await auditCount("people_evidence.record", `people_evidence:${fx.e1}`), 1);
  const denied = await brand(u.ops, { op: "evidence_approve", id: fx.e1 });
  assert.equal(denied.status, 403, "브랜드 관리 담당의 승인");
  assert.equal(await auditCount("brand.approve.denied", "brand:evidence_approve"), 1, "거부 감사 1건");
  const deniedConsent = await brand(u.ops, { op: "consent", personId: fx.writer.id, version: "시험용-x", docRef: "시험용", scope: ["column"] });
  assert.equal(deniedConsent.status, 403, "브랜드 관리 담당의 동의서 기록");
  const ok = await brand(u.admin, { op: "evidence_approve", id: fx.e1 });
  assert.equal(ok.status, 200, show(ok));
  assert.equal(ok.body.evidence.approved, true);
  assert.equal(await auditCount("people_evidence.approve", `people_evidence:${fx.e1}`), 1, "승인 감사 1건");
  const noEv = await brand(u.ops, { op: "bio", personId: fx.writer.id, items: [{ item: "시험용 약력 증빙 없음" }] });
  assert.equal(noEv.status, 422, "증빙 없는 약력 저장 거부");
  const others = await brand(u.ops, { op: "bio", personId: fx.writer.id, items: [{ item: "시험용 약력", evidenceId: fx.e1 + 100000 }] });
  assert.equal(others.status, 422, "이 인물의 증빙이 아닌 번호");
});

test("b) 약력 — 렌더 줄 수 = 승인 증빙 줄 수, 승인 전 줄은 화면·필자 줄·구조화 데이터·공유 미리보기 0, JSON-LD = 화면", async () => {
  const e2 = await brand(u.ops, { op: "evidence", personId: fx.writer.id, kind: "official_record", docRef: "시험용 증빙 위치 2" });
  const e3 = await brand(u.ops, { op: "evidence", personId: fx.writer.id, kind: "publisher_history", docRef: "시험용 증빙 위치 3" });
  fx.e2 = Number(e2.body.evidence.id);
  fx.e3 = Number(e3.body.evidence.id);
  assert.equal((await brand(u.admin, { op: "evidence_approve", id: fx.e3 })).status, 200);
  const items = [
    { item: "시험용 약력 가", evidenceId: fx.e1 },
    { item: "시험용 약력 나(승인 전)", evidenceId: fx.e2 },
    { item: "시험용 약력 다", evidenceId: fx.e3 },
  ];
  const saved = await brand(u.ops, { op: "bio", personId: fx.writer.id, items });
  assert.equal(saved.status, 200, show(saved));
  const consent = await brand(u.admin, { op: "consent", personId: fx.writer.id, version: "시험용-1", docRef: "시험용 동의서 위치", scope: ["profile_page", "column"] });
  assert.equal(consent.status, 201, show(consent));
  assert.equal(await auditCount("consent_doc.record", `name_likeness_consents:${consent.body.consent.id}`), 1);
  await db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [fx.column.id]);
  await expireCache();

  const p = await page(`/people/${fx.writer.slug}`);
  assert.equal(p.status, 200);
  const facts = personFacts(p.html);
  const approved = (await one("select count(*)::int n from public.people_evidence where person_id = $1 and approved", [fx.writer.id])).n;
  assert.deepEqual(facts.bio, ["시험용 약력 가", "시험용 약력 다"]);
  assert.equal(facts.bio.length, approved, "렌더 약력 수 = 승인 증빙 수");
  assert.ok(!p.html.includes("시험용 약력 나"), "승인 전 줄 — 인물 페이지 HTML 어디에도(구조화 데이터·메타 포함) 0");
  const ld = jsonLd(p.html);
  assert.equal(mainOf(ld, "ProfilePage")?.mainEntity?.description, "시험용 약력 가 · 시험용 약력 다");
  assert.deepEqual(compareRendered({ title: facts.name, description: facts.bio.join(" · ") }, ld), [], "JSON-LD = 화면");
  const meta = [...p.html.matchAll(/<meta[^>]+(?:name|property)="(?:description|og:description|twitter:description)"[^>]*>/g)].map((m) => m[0]).join(" ");
  assert.ok(!meta.includes("나(승인 전)"), "공유 미리보기 설명에 승인 전 줄 0");

  const col = await page(fx.column.href);
  assert.equal(col.status, 200);
  const block = col.html.slice(col.html.indexOf('data-ui="reporter-block"'));
  assert.match(block, /시험용 약력 가 · 시험용 약력 다/, "칼럼 필자 줄 = 승인 약력");
  assert.ok(!col.html.includes("시험용 약력 나"), "칼럼 페이지에 승인 전 줄 0");

  assert.equal((await brand(u.admin, { op: "evidence_approve", id: fx.e2 })).status, 200);
  const after = personFacts((await page(`/people/${fx.writer.slug}`)).html);
  assert.deepEqual(after.bio, ["시험용 약력 가", "시험용 약력 나(승인 전)", "시험용 약력 다"], "승인하면 다음 요청부터 3줄");
});

test("c) 동의서 — 없으면 404·칼럼 발행 거부, profile_page 범위 필요, 철회 → 404 + 사이트맵 원본 0 + 필자 링크·JSON-LD url 0", async () => {
  assert.equal((await page(`/people/${fx.none.slug}`)).status, 404, "동의서 없음 → 404");
  await assert.rejects(db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [fx.noneColumn.id]), /동의서/, "동의서 없이 칼럼 발행 거부");
  const news = await page(fx.noneNews.href);
  assert.equal(news.status, 200, "보도·해설 기사는 필자 이름만으로 발행된다");
  assert.ok(!news.html.includes(`/people/${fx.none.slug}`), "인물 페이지가 없는 사람에게 링크 0");
  const newsLd = mainOf(jsonLd(news.html), "NewsArticle");
  assert.equal(newsLd?.author?.[0]?.url ?? newsLd?.author?.url, undefined, "JSON-LD 저자 url 0");

  const c1 = await brand(u.admin, { op: "consent", personId: fx.none.id, version: "시험용-1", docRef: "시험용 동의서 위치", scope: ["column"] });
  assert.equal(c1.status, 201, show(c1));
  await db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [fx.noneColumn.id]);
  assert.equal((await page(`/people/${fx.none.slug}`)).status, 404, "범위에 profile_page 없음 → 404");
  const dup = await brand(u.admin, { op: "consent", personId: fx.none.id, version: "시험용-1", docRef: "시험용", scope: ["profile_page"] });
  assert.equal(dup.status, 409, "같은 버전 두 번");
  const future = await brand(u.admin, { op: "consent", personId: fx.none.id, version: "시험용-미래", docRef: "시험용", scope: ["profile_page"], validFrom: new Date(Date.now() + 86_400_000).toISOString() });
  assert.equal(future.status, 422, "미래 시작 동의서");
  const c2 = await brand(u.admin, { op: "consent", personId: fx.none.id, version: "시험용-2", docRef: "시험용 동의서 위치", scope: ["profile_page", "column"] });
  assert.equal(c2.status, 201, show(c2));
  assert.equal((await page(`/people/${fx.none.slug}`)).status, 200, "새 버전에 profile_page → 200");
  const linked = await page(fx.noneNews.href);
  assert.ok(linked.html.includes(`/people/${fx.none.slug}`), "동의서가 생기면 필자 링크");

  const w = await brand(u.admin, { op: "consent_withdraw", id: Number(c2.body.consent.id) });
  assert.equal(w.status, 200, show(w));
  assert.equal(await auditCount("consent_doc.withdraw", `name_likeness_consents:${c2.body.consent.id}`), 1);
  assert.equal((await page(`/people/${fx.none.slug}`)).status, 404, "철회 → 다음 요청부터 404");
  assert.equal((await one("select count(*)::int n from public.public_profile_pages where person_id = $1", [fx.none.id])).n, 0, "사이트맵 원본 0");
  const gone = await page(fx.noneNews.href);
  assert.ok(!gone.html.includes(`/people/${fx.none.slug}`), "철회 뒤 필자 링크 0");
  const goneLd = mainOf(jsonLd(gone.html), "NewsArticle");
  assert.equal(goneLd?.author?.[0]?.url ?? goneLd?.author?.url, undefined, "철회 뒤 JSON-LD 저자 url 0");
  assert.equal((await brand(u.admin, { op: "consent_withdraw", id: Number(c2.body.consent.id) })).status, 404, "두 번 철회");
  assert.equal((await page(fx.noneColumn.href)).status, 200, "이미 공개된 칼럼은 그대로(새 발행만 막힘)");
});

test("d) 감수 표시 — 서명 없으면 0, 서명 뒤 1개, 오탈자 수정 유지, 실질 수정 → 0 + 재감수 큐 1건, 다시 서명 → 1개", async () => {
  const name = "시험용 감수위원";
  const unsigned = await page(fx.unsigned.href);
  assert.equal(markCount(unsigned.html), 0);
  assert.ok(!strip(unsigned.html).includes(`감수 ${name}`), "서명 기록 없는 기사에 '감수 ○○' 0");
  assert.equal(markCount((await page(fx.signed.href)).html), 0, "서명 전 0");

  const r = await api("POST", `/articles/${fx.signed.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
  assert.equal(r.status, 201, show(r));
  let html = (await page(fx.signed.href)).html;
  assert.equal(markCount(html), 1);
  assert.match(strip(html), new RegExp(`감수 ${name}`));
  assert.ok(html.includes(`href="/people/${(await one("select slug from public.people where id = $1", [u.reviewer.personId])).slug}"`), "서명자 인물 페이지 링크");

  await revise(fx.signed.id, "typo");
  await expireCache();
  assert.equal(markCount((await page(fx.signed.href)).html), 1, "오탈자 수정은 유지");

  await revise(fx.signed.id, "substantive");
  await expireCache();
  html = (await page(fx.signed.href)).html;
  assert.equal(markCount(html), 0, "서명 뒤 실질 수정 → 0");
  const q = await api("GET", "/brand", u.admin);
  assert.equal(q.status, 200);
  assert.deepEqual(q.body.rereviewQueue.filter((x) => Number(x.article_id) === fx.signed.id).length, 1, "재감수 큐 1건");

  const again = await api("POST", `/articles/${fx.signed.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
  assert.equal(again.status, 201, show(again));
  assert.equal(markCount((await page(fx.signed.href)).html), 1, "현재 버전에 다시 서명 → 1개");
  const q2 = await api("GET", "/brand", u.admin);
  assert.equal(q2.body.rereviewQueue.filter((x) => Number(x.article_id) === fx.signed.id).length, 0, "재감수 큐에서 빠짐");
});

test("e) 브랜드 스위치 — brand_copy는 감수 기록·경력 승인 전 거부, 갖추면 켜짐, 근거 증빙 승인을 거두면 함께 꺼짐 / people_pages 켜면 역할별 블록", async () => {
  const flags = async () => (await one("select value from public.settings where key = 'feature_flags'")).value;
  const early = await brand(u.admin, { op: "brand_copy", value: true });
  assert.equal(early.status, 422, show(early));
  assert.match(JSON.stringify(early.body), /brand_copy_review/);
  assert.match(JSON.stringify(early.body), /career_claim_approved/);
  const viaSettings = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...(await flags()), brand_copy: true } });
  assert.equal(viaSettings.status, 422, `운영 설정으로도 거부 ${show(viaSettings)}`);
  assert.equal((await brand(u.ops, { op: "brand_copy", value: true })).status, 403, "브랜드 관리 담당은 스위치 거부");
  assert.equal(await auditCount("brand.approve.denied", "brand:brand_copy"), 1);

  const unapproved = await brand(u.ops, { op: "evidence", personId: fx.writer.id, kind: "document", docRef: "시험용 증빙 위치 4" });
  const basisBad = await brand(u.admin, { op: "career_claim", value: true, basisEvidenceId: Number(unapproved.body.evidence.id) });
  assert.equal(basisBad.status, 422, "승인 전 증빙을 근거로 경력 표시 승인 거부");
  const claim = await brand(u.admin, { op: "career_claim", value: true, basisEvidenceId: fx.e3 });
  assert.equal(claim.status, 200, show(claim));
  assert.equal(await auditCount("career_claim.approve", "settings:career_claim_approved"), 1);
  assert.equal((await brand(u.admin, { op: "brand_copy", value: true })).status, 422, "감수 기록이 아직 없음");
  assert.equal((await brand(u.admin, { op: "brand_review", value: true })).status, 422, "감수 기록 위치 없음");
  assert.equal((await brand(u.admin, { op: "brand_review", value: true, recordRef: "시험용 감수 기록 위치" })).status, 200);
  const on = await brand(u.admin, { op: "brand_copy", value: true });
  assert.equal(on.status, 200, show(on));
  assert.equal((await flags()).brand_copy, true);
  assert.equal(await auditCount("brand_copy.toggle", "settings:feature_flags"), 1);
  const revoke = await brand(u.admin, { op: "evidence_revoke", id: fx.e3 });
  assert.equal(revoke.status, 200, show(revoke));
  assert.equal((await flags()).brand_copy, false, "근거 증빙 승인을 거두면 브랜드 문구도 내려간다");

  // people_pages — 역할별 블록(필자 = 칼럼, 감수위원 = 서명이 살아 있는 감수 기사)
  const reviewerSlug = (await one("select slug from public.people where id = $1", [u.reviewer.personId])).slug;
  assert.ok(!(await page(`/people/${fx.writer.slug}`)).html.includes('data-person-part="columns"'), "꺼져 있으면 역할별 블록 0");
  const pp = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...(await flags()), people_pages: true } });
  assert.equal(pp.status, 200, show(pp));
  const writerPage = (await page(`/people/${fx.writer.slug}`)).html;
  assert.ok(writerPage.includes('data-person-part="columns"'), "필자 블록");
  assert.ok(!writerPage.includes('data-person-part="reviewed"'), "필자에게 감수 블록 0");
  const reviewerPage = (await page(`/people/${reviewerSlug}`)).html;
  const reviewed = reviewerPage.slice(reviewerPage.indexOf('data-person-part="reviewed"'));
  assert.ok(reviewerPage.includes('data-person-part="reviewed"'), "감수위원 블록");
  assert.ok(reviewed.includes(`data-article-id="${fx.signed.id}"`), "서명한 기사");
  assert.ok(!reviewed.includes(`data-article-id="${fx.unsigned.id}"`), "서명 없는 기사 0");
  assert.ok(!reviewerPage.includes('data-person-part="columns"'), "감수위원에게 칼럼 블록 0");
});
