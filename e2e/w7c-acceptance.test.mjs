// W7c 수용 E2E (docs/dev/W7c_설계.md 1장 4단계 - PRD-01C EXPL-01·02·04·05·07·08·13·15·17~21, PRD_최종 §11.1 W7c "미검증 노출 0, SM 소속 아닌 프로필 노출 0, 동의 없는 전달 0")
// standalone 빌드를 로컬 Supabase에 붙인다. 프로필·요청 내용은 전부 시험용 가짜다(*.example.test, 가상 이름).
//  a) 권한 - 기자·광고 담당 403 · 전문가 담당은 읽기만(쓰기 403, 요청 목록 0) · 키 꺼짐이면 /experts·/experts/request·프로필 404
//  b) 켜기 조건 - 고지문 승인 없이 experts 422 · 연락 요청 정책(실사·감수 기록) 승인 없이 expert_requests 422
//  c) 프로필 - 외부 제휴·쓰면 안 되는 표현·없는 분류·동의서 기록 없는 공개 422 / 초안은 공개 0 / 두 분류 프로필이 두 분류 목록에 모두 보임 / 공개 분류만 필터 / 지역 쿼리 무시 /
//     프로필 화면 SM 소속 표시·고지 1개·새 창 연락 링크·ProfilePage / 별점·후기·예약 요소 0 / 내리면 404
//  d) 연락 요청 - 양식 200 · 동의·내용 확인 없음·연락처 없음·긴 숫자 우회 422 · 정상 201 + 접수 번호 · 목록에 이름·연락처·요약 0 · 상세는 관리자만(열람 감사 1건) ·
//     첫 연락은 수행 주체·안내 완료 필요 · 철회(틀린 연락처 실패, 맞으면 즉시 파기) · 봇 숨은 칸 · 키 꺼짐 404
// 만든 계정·프로필·요청은 끝나면 지운다 (설정은 시작 상태로 되돌린다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w7c-acceptance-e2e@example.test";
const SITE = "https://e2e-w7c.example.test";
const GUARD = "e2e-w7c-guard-secret-not-real";
const CONSENT_VERSION = "e2e-consent-1";

let sb, server, staff, db, base;
const u = {};
let run;

const show = (r) => JSON.stringify(r.body).slice(0, 600);
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (user, body) => api("POST", "/experts", user, body);
const setting = (key, value) => api("PATCH", `/settings/${key}`, u.admin, { value });
const flags = async (patch) => {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  return setting("feature_flags", { ...cur, ...patch });
};
const get = async (p, user) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual", headers: user ? { authorization: `Bearer ${user.token}` } : {} });
  return { status: res.status, html: await res.text(), location: res.headers.get("location") };
};
async function publicPost(path, body, { form = false } = {}) {
  await db.query("delete from public.request_throttles where scope = 'form_ip'"); // 같은 IP 시도 횟수(시간당 10회)에 걸리지 않게 - 시험은 횟수 제한 자체를 보지 않는다
  const headers = { origin: base };
  let payload;
  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(body).toString();
  } else {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method: "POST", headers, body: payload, redirect: "manual" });
  return { status: res.status, body: form ? {} : await res.json().catch(() => ({})), location: res.headers.get("location") };
}
const count = (html, re) => [...html.matchAll(re)].length;
const slugs = (html) => [...html.matchAll(/data-expert-slug="([^"]+)"/g)].map((m) => m[1]);

const NOTICE = { version: "e2e-n1", text: "시험용 고지문입니다 (실제 법률 문구 아님).", approved: true, reviewed_by: "시험 검토자", reviewed_on: "2026-10-24" };
const POLICY = {
  retention_days: "365",
  target_business_days: "1",
  summary_max_chars: "300",
  consent_version: CONSENT_VERSION,
  intro: "시험용 안내 문단 하나\n시험용 안내 문단 둘",
  consent_items: "시험용 동의 항목 하나\n시험용 동의 항목 둘",
  reviewed_by: "시험 검토자",
  reviewed_on: "2026-10-24",
  due_diligence_ref: "DD-E2E",
  legal_review_ref: "LR-E2E",
  approved: true,
};
const profileBody = (n, extra = {}) => ({
  op: "profile",
  slug: `e2e-w7c-${run}-${n}`,
  name: `가상 전문가 ${n}${run.slice(0, 4)}`,
  category_codes: "tax-accountant, cpa",
  specialties: "시험 분야 가, 시험 분야 나",
  office_name: "시험 법인(가상)",
  house_relation: "employed",
  regions: "가상 지역",
  contact_links: "사무소 홈페이지|https://office-e2e.example.test/",
  interests: "이 플랫폼과 관계 없음(시험)",
  intro: "시험용 소개 문장입니다.",
  ...extra,
});
const REQ = (over = {}) => ({
  category_code: "tax-accountant",
  summary: "시험용 문의 요약입니다.",
  name: "가상 요청인",
  email: `requester-${run}@example.test`,
  summary_confirmed: true,
  consent_0: true,
  consent_1: true,
  source: "experts",
  ...over,
});

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.expert_request_events where request_id in (select id from public.expert_requests where consent_version = $1)", [CONSENT_VERSION]);
    await db.query("delete from public.expert_requests where consent_version = $1", [CONSENT_VERSION]);
    await db.query("delete from public.expert_profile_events where profile_id in (select id from public.expert_profiles where slug like 'e2e-w7c-%')");
    await db.query("delete from public.expert_profiles where slug like 'e2e-w7c-%'");
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
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
    GUARD_SECRET: GUARD,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  await staff.removeLeftover(ADMIN_EMAIL);
  await purge();
  await staff.snapshotOperations();
  u.reporter = await staff.createUser({ label: "w7c-reporter", roles: ["reporter"], person: { name: "전문가 시험 기자", roles: ["reporter"] } });
  u.adsOps = await staff.createUser({ label: "w7c-ads", roles: ["ad_ops"] });
  u.expertOps = await staff.createUser({ label: "w7c-expert-ops", roles: ["expert_ops"] });
  u.admin = await staff.createUser({ label: "w7c-admin", email: ADMIN_EMAIL });
  // 시험 시작 상태 - 전문가 키 꺼짐, 고지문·정책은 씨앗(미승인)
  await db.query("update public.settings set value = value || '{\"experts\": false, \"expert_requests\": false}'::jsonb where key = 'feature_flags'");
  await db.query(
    "update public.settings set value = jsonb_build_object('version', '', 'text', '', 'approved', false, 'reviewed_by', null, 'reviewed_on', null) where key = 'expert_notice'",
  );
});

after(async () => {
  try {
    await purge();
    await db.query("delete from public.request_throttles where scope = 'form_ip'");
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

test("a) 권한·키 꺼짐 - 기자·광고 담당 403 · 전문가 담당은 읽기만 · 꺼짐이면 공개 화면 404", async () => {
  assert.equal((await api("GET", "/experts", u.reporter)).status, 403);
  assert.equal((await api("GET", "/experts", u.adsOps)).status, 403);
  const ops = await api("GET", "/experts", u.expertOps);
  assert.equal(ops.status, 200, show(ops));
  assert.deepEqual(ops.body.requests, [], "전문가 담당에게 요청 목록은 오지 않는다");
  assert.deepEqual(ops.body.categories.map((c) => c.name), ["세무사", "공인회계사", "변호사", "공인중개사", "법무사"], "분류 5개가 PO 순서대로");
  assert.equal((await post(u.expertOps, { op: "profile", ...profileBody(0) })).status, 403, "전문가 담당도 등록하지 못함 (관리자만)");
  assert.equal((await post(u.reporter, { op: "category", code: "x", name: "y" })).status, 403);
  assert.equal((await post(u.admin, { op: "nope" })).status, 422);
  for (const p of ["/experts", "/experts/request", "/experts/profile/anything"]) assert.equal((await get(p)).status, 404, `${p} 꺼짐`);
  assert.equal((await publicPost("/api/experts/requests", REQ())).status, 404, "요청 API도 꺼짐이면 404");
});

test("b) 켜기 조건 - 고지문 승인 없이 experts 422 · 연락 요청 정책 승인 없이 expert_requests 422 · 승인 뒤 켜짐", async () => {
  const early = await flags({ experts: true });
  assert.equal(early.status, 422, show(early));
  assert.equal((await post(u.admin, { op: "notice", approved: true, version: "", text: "문구", reviewed_by: "a", reviewed_on: "2026-10-24" })).status, 422, "승인에는 버전이 필요");
  assert.equal((await post(u.admin, { op: "notice", ...NOTICE })).status, 200);
  assert.equal((await flags({ experts: true })).status, 200);
  const noPolicy = await flags({ expert_requests: true });
  assert.equal(noPolicy.status, 422, show(noPolicy));
  assert.equal((await post(u.admin, { op: "policy", ...POLICY, legal_review_ref: "" })).status, 422, "감수 기록 번호 없이 승인 불가");
  assert.equal((await post(u.admin, { op: "policy", ...POLICY })).status, 200);
  assert.equal((await flags({ expert_requests: true })).status, 200);
});

test("c) 프로필 - 규칙 422 · 초안 공개 0 · 두 분류 프로필 · 공개 분류만 필터 · SM 소속 표시·고지 1개·새 창 링크·ProfilePage · 별점·예약 0 · 내리면 404", async () => {
  const bad = (patch) => post(u.admin, profileBody(1, patch));
  assert.equal((await bad({ house_relation: "external_partner" })).status, 422, "외부 제휴 전문가는 소개하지 않는다");
  assert.equal((await bad({ intro: "업계 1위 사무소" })).status, 422, "쓰면 안 되는 표현");
  assert.equal((await bad({ category_codes: "no-such-category" })).status, 422);
  assert.equal((await bad({ category_codes: "" })).status, 422);
  assert.equal((await bad({ contact_links: "홈|https://office-e2e.example.test/?uid=7" })).status, 422, "식별 쿼리가 붙은 연락 링크");
  const made = await post(u.admin, profileBody(1));
  assert.equal(made.status, 201, show(made));
  const id = made.body.profile.id;
  const slug = made.body.profile.slug;
  const second = await post(u.admin, profileBody(2, { category_codes: "lawyer", name: `가상 변호 ${run.slice(0, 4)}` }));
  assert.equal(second.status, 201);
  // 초안 - 공개 0
  assert.equal((await get(`/experts/profile/${slug}`)).status, 404);
  assert.deepEqual(slugs((await get("/experts")).html), []);
  // 공개 - 동의서 기록 필수
  assert.equal((await post(u.admin, { op: "publish", id })).status, 422, "동의서 기록 없이 공개 불가");
  assert.equal((await post(u.expertOps, { op: "publish", id, consent_version: "v1", consent_on: "2026-10-24", consent_doc_ref: "x" })).status, 403);
  const pub = await post(u.admin, { op: "publish", id, consent_version: "e2e-본인동의-1", consent_on: "2026-10-24", consent_doc_ref: "시험 보관함 가-1" });
  assert.equal(pub.status, 200, show(pub));
  // 목록 - 두 분류(세무사·공인회계사) 칩, 변호사는 공개 전문가가 없어 칩 0
  const list = await get("/experts");
  assert.equal(list.status, 200);
  assert.deepEqual(slugs(list.html), [slug]);
  assert.equal(count(list.html, /data-category="tax-accountant"/g), 1);
  assert.equal(count(list.html, /data-category="cpa"/g), 1);
  assert.equal(count(list.html, /data-category="lawyer"/g), 0, "공개 전문가 0명인 분류는 칩 0 ('준비 중' 0)");
  assert.equal(count(list.html, /data-part="sm-badge"/g), 1, "카드마다 SM(선명) 소속 표시");
  assert.equal(count(list.html, /data-part="expert-notice"/g), 1, "고지 1개");
  assert.ok(list.html.includes(NOTICE.text));
  assert.ok(list.html.includes('data-part="request-entry"'), "연락 요청 진입 링크");
  assert.ok(!/(href|action)="[^"]*(signup|apply|register|join)[^"]*"/i.test(list.html.split('data-ui="experts-page"')[1] ?? ""), "등재 신청·가입 링크 0");
  for (const cat of ["tax-accountant", "cpa"]) assert.deepEqual(slugs((await get(`/experts?category=${cat}`)).html), [slug], `${cat} 필터`);
  const unknown = await get("/experts?category=lawyer");
  assert.deepEqual(slugs(unknown.html), [slug], "공개 전문가 없는 분류 값은 필터 없이 전체");
  assert.ok(unknown.html.includes('data-part="filter-notice"'));
  assert.deepEqual(slugs((await get("/experts?region=seoul")).html), [slug], "지역 쿼리는 무시");
  // 프로필
  const page = await get(`/experts/profile/${slug}`);
  assert.equal(page.status, 200);
  assert.ok(page.html.includes(NOTICE.text));
  assert.equal(count(page.html, /data-part="expert-notice"/g), 1);
  assert.equal(count(page.html, /data-part="sm-badge"/g), 1);
  assert.match(page.html, /<a [^>]*href="https:\/\/office-e2e\.example\.test\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"|<a [^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*href="https:\/\/office-e2e\.example\.test\/"/);
  assert.ok(!page.html.includes("uid="), "연락 링크에 식별 쿼리 0");
  const ld = /application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(page.html);
  assert.ok(ld && JSON.parse(ld[1]) && /ProfilePage/.test(ld[1]) && !/aggregateRating|review/i.test(ld[1]), "ProfilePage이고 평점·후기 속성 0");
  const body = page.html.split('data-ui="expert-profile"')[1].slice(0, 8000).replace(/<[^>]+>/g, " ");
  assert.ok(!/별점|후기|평점|순위|예약|결제|상담 건수/.test(body), "별점·후기·예약 요소 0");
  assert.ok(body.includes("세무사") && body.includes("공인회계사"), "한 프로필에 두 분류");
  // 철회 못 하는 사람/내리기
  assert.equal((await post(u.expertOps, { op: "unpublish", id })).status, 403);
  assert.equal((await post(u.admin, { op: "unpublish", id })).status, 200);
  assert.equal((await get(`/experts/profile/${slug}`)).status, 404, "내리면 다음 요청부터 404");
  assert.deepEqual(slugs((await get("/experts")).html), []);
  assert.equal((await post(u.admin, { op: "unpublish", id })).status, 409, "공개 중이 아니면 409");
  // 다시 공개
  assert.equal((await post(u.admin, { op: "publish", id, consent_version: "e2e-본인동의-2", consent_on: "2026-10-24", consent_doc_ref: "시험 보관함 가-2" })).status, 200);
  assert.equal((await get(`/experts/profile/${slug}`)).status, 200);
  u.profile = { id, slug };
});

test("d) 연락 요청 - 양식·검사·접수·목록에 개인정보 0·상세는 관리자만(열람 감사)·첫 연락 규칙·철회·봇·키 꺼짐 404", async () => {
  const form = await get("/experts/request?source=article");
  assert.equal(form.status, 200);
  assert.ok(form.html.includes('data-form="expert-request"'));
  assert.ok(form.html.includes('<option value="tax-accountant"'), "공개 전문가가 있는 분야만 선택지");
  assert.ok(!form.html.includes('<option value="lawyer"'));
  assert.ok(form.html.includes('name="source" value="article"'), "진입 출처 article");
  assert.equal(count(form.html, /name="consent_\d"/g), 2, "필수 동의 항목");
  assert.ok(form.html.includes(NOTICE.text), "고지 1개");
  assert.ok(form.html.includes("시험용 안내 문단 하나"));
  // 거부
  const reject = async (patch, code) => {
    const r = await publicPost("/api/experts/requests", REQ(patch));
    assert.equal(r.status, 422, `${code}: ${show(r)}`);
    assert.equal(r.body.code, code);
  };
  await reject({ consent_1: false }, "consent");
  await reject({ summary_confirmed: false }, "confirm");
  await reject({ email: "", phone: "" }, "contact");
  await reject({ summary: "주민번호 900101-1234567 입니다" }, "sensitive");
  await reject({ summary: "계좌 110 123 456789" }, "sensitive");
  await reject({ summary: "９００１０１－１２３４５６７" }, "sensitive");
  await reject({ category_code: "lawyer" }, "category");
  assert.equal(Number((await db.query("select count(*) from public.expert_requests where consent_version = $1", [CONSENT_VERSION])).rows[0].count), 0, "거부된 요청은 저장 0");
  // 접수
  const ok = await publicPost("/api/experts/requests", REQ({ source: "article", deadline_urgent: true }));
  assert.equal(ok.status, 201, show(ok));
  assert.match(ok.body.ref, /^EX-[0-9A-F]{8}$/);
  const row = (await db.query("select id, status, source, name, email, summary, consent_version, due_at, created_at from public.expert_requests where receipt_no = $1", [ok.body.ref])).rows[0];
  assert.equal(row.status, "received");
  assert.equal(row.source, "article");
  assert.equal(row.consent_version, CONSENT_VERSION);
  assert.ok(new Date(row.due_at) > new Date(row.created_at), "목표 시간이 접수 뒤");
  // 목록에는 개인정보 0 / 상세는 관리자만 + 열람 감사
  const boardRes = await api("GET", "/experts", u.admin);
  assert.equal(boardRes.status, 200);
  const listed = boardRes.body.requests.find((r) => r.receipt_no === ok.body.ref);
  assert.ok(listed && listed.status === "received");
  assert.ok(!JSON.stringify(boardRes.body).includes("requester-"), "목록 응답에 이메일 0");
  assert.ok(!JSON.stringify(boardRes.body).includes("가상 요청인"), "목록 응답에 이름 0");
  assert.equal((await api("GET", `/experts/requests/${row.id}`, u.expertOps)).status, 403, "전문가 담당은 상세 불가");
  const before = Number((await db.query("select count(*) from public.audit_logs where action = 'expert.request.view'")).rows[0].count);
  const detail = await api("GET", `/experts/requests/${row.id}`, u.admin);
  assert.equal(detail.status, 200, show(detail));
  assert.equal(detail.body.request.name, "가상 요청인");
  assert.equal(detail.body.request.email, `requester-${run}@example.test`);
  const after = Number((await db.query("select count(*) from public.audit_logs where action = 'expert.request.view'")).rows[0].count);
  assert.equal(after, before + 1, "열람마다 감사 1건");
  // 상태 - 첫 연락은 수행 주체·안내 완료 필요
  assert.equal((await post(u.expertOps, { op: "request_status", id: row.id, status: "contacted", performing_entity: "가상 법인", scope_noted: true })).status, 403);
  assert.equal((await post(u.admin, { op: "request_status", id: row.id, status: "contacted", performing_entity: "가상 법인", scope_noted: false })).status, 422);
  assert.equal((await post(u.admin, { op: "request_status", id: row.id, status: "contacted", performing_entity: "", scope_noted: true })).status, 422);
  assert.equal((await post(u.admin, { op: "request_status", id: row.id, status: "contacted", performing_entity: "가상 법인", scope_noted: true })).status, 200);
  assert.equal((await post(u.admin, { op: "request_status", id: row.id, status: "closed" })).status, 422, "종결 사유 없음");
  assert.equal((await post(u.admin, { op: "request_status", id: row.id, status: "closed", close_reason: "guidance_end" })).status, 200);
  const events = (await db.query("select from_status, to_status from public.expert_request_events where request_id = $1 order by id", [row.id])).rows;
  assert.deepEqual(events.map((e) => `${e.from_status ?? "-"}>${e.to_status}`), ["->received", "received>contacted", "contacted>closed"]);
  // 두 번째 요청 - 철회
  const second = await publicPost("/api/experts/requests", REQ({ email: "", phone: "010-0000-1111", name: "가상 전화 요청인" }));
  assert.equal(second.status, 201, show(second));
  const wrong = await publicPost("/api/experts/requests/withdraw", { receipt: second.body.ref, contact: "010-9999-9999" });
  assert.equal(wrong.status, 422, "틀린 연락처는 철회되지 않음");
  assert.ok((await db.query("select name from public.expert_requests where receipt_no = $1", [second.body.ref])).rows[0].name, "아직 남아 있음");
  const right = await publicPost("/api/experts/requests/withdraw", { receipt: second.body.ref, contact: "01000001111" });
  assert.equal(right.status, 200, show(right));
  const gone = (await db.query("select name, phone, summary, status, close_reason, purged_at from public.expert_requests where receipt_no = $1", [second.body.ref])).rows[0];
  assert.deepEqual([gone.name, gone.phone, gone.summary, gone.status, gone.close_reason], [null, null, null, "closed", "withdrawn"]);
  assert.ok(gone.purged_at);
  // 폼 제출 - 봇 숨은 칸은 303 + bot, 정상 폼은 303 + 접수 번호
  const bot = await publicPost("/api/experts/requests", { ...REQ(), website: "http://spam.example.test", summary_confirmed: "on", consent_0: "on", consent_1: "on" }, { form: true });
  assert.equal(bot.status, 303);
  assert.match(bot.location, /e=bot/);
  const sent = await publicPost("/api/experts/requests", { ...REQ(), summary_confirmed: "on", consent_0: "on", consent_1: "on" }, { form: true });
  assert.equal(sent.status, 303);
  assert.match(sent.location, /\/experts\/request\?sent=EX-[0-9A-F]{8}/);
  const done = await get(sent.location);
  assert.ok(done.html.includes('data-part="request-sent"'));
  // 키 꺼짐 - 양식·API 404, 진입 링크 0
  assert.equal((await flags({ expert_requests: false })).status, 200);
  assert.equal((await get("/experts/request")).status, 404);
  assert.equal((await publicPost("/api/experts/requests", REQ())).status, 404);
  const list = await get("/experts");
  assert.ok(!list.html.includes('data-part="request-entry"'), "연락 요청 진입 링크 0");
  assert.equal((await flags({ experts: false })).status, 200);
  assert.equal((await get("/experts")).status, 404);
  assert.equal((await get(`/experts/profile/${u.profile.slug}`)).status, 404);
});
