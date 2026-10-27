// W13-g 수용 E2E (docs/dev/W13-g_설계.md - PRD-05 EXP-01·02, QNA-01~08, 5단계 설계 W13-g "SM 소속 아닌 계정의 배지 0 · 자기 신청 화면·API 0 · 상담 신청·매칭·결제 버튼 0 · 연락처 렌더 0 · 90일 경계")
// standalone 빌드를 로컬 Supabase에 붙인다. 글·고지 문구는 전부 시험용 가짜다.
//  a) 닫힘 - 키 꺼짐이면 /qna 화면 5개 404 · 쓰기 API 404 / 고지 승인 없이 qna 켜기 거부 · 승인 뒤 켜짐
//  b) 계정 연결 - 기자·편집 책임자 403(관리자만) · 잘못된 번호 422 · 비공개 프로필 422 · 연결 201 · 같은 계정/프로필 409 / 자기 신청 경로(/my/expert, /api/expert/*) 404
//  c) 글 - 경고 확인 없이 422 · 정상 201 · 개인정보는 가려 저장하고 게시 보류(목록 0, 원문 DB·HTML 0) / 연결 없는 계정의 답변은 일반 회원 의견, 연결된 SM 전문가는 '전문가 답변' 배지 /
//     채택: 질문자만(타인 403) · 한 번만(409)
//  d) 화면 - 고지 3개 화면 + 답변 하단 · 상담 신청·매칭·결제 요소 0 · 연락처(tel:/mailto:) 0 · 1단계 두 링크뿐 · 라운지 글 noindex · chunks 허용 목록에 라운지 없음
//  e) 활동 띠 - 기준이 비어 있으면 띠 0 · 기준 충족 시 전문가 1명 · 제재 중이면 빠짐 · 프로필 링크는 /experts/profile만
//  f) 해제 - 연결을 해제하면 같은 요청부터 배지 0(일반 회원 의견) · 프로필 비공개도 같음
//  g) 신고·관리 - 신고 201 · 중복 409 · 자기 글 422 · 기자 403 · 편집 책임자 처리(숨김) 뒤 글 사라짐 · 처리 목표 시각 = 접수 + 1영업일 이후
// 만든 계정·글·연결은 끝나면 지운다 (설정은 시작 상태로 되돌린다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w13g-acceptance-e2e@example.test";
const SITE = "https://e2e-w13g.example.test";
const GUARD = "e2e-w13g-guard-secret-not-real";
const TAG = "e2e-w13g";

let sb, server, staff, db, base, run;
const u = {};
const NOTICE = { version: "e2e-n1", text: "시험용 중립성 고지입니다 (실제 문구 아님).", answer_footer: "시험용 답변 하단 고지", approved: true, reviewed_by: "시험 검토자", reviewed_on: "2026-10-27" };

async function adminApi(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function memberPost(path, user, body) {
  await db.query("delete from public.request_throttles where scope = 'form_ip'"); // 시험은 횟수 제한 자체를 보지 않는다
  const res = await fetch(`${base}/api/qna/${path}`, { method: "POST", headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const get = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: (await res.text()).replace(/<!-- -->/g, "") }; // React 텍스트 경계 주석 제거
};
const serverEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
  ADMIN_EMAILS: ADMIN_EMAIL,
  NEXT_PUBLIC_SITE_URL: SITE,
  GUARD_SECRET: GUARD,
});
// 공개 설정은 30초 캐시라 키·설정을 바꾼 뒤에는 서버를 다시 띄운다
async function restart() {
  await server?.stop?.();
  server = await startServer(serverEnv());
  base = server.base;
}
const setFlag = async (patch) => {
  await db.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(patch)]);
  await restart();
};
const q1 = (over = {}) => ({ tax_type: "취득세", title: `${TAG} ${run} 질문`, body: "시험용 일반 질문입니다", warning_confirmed: true, ...over });

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.qna_reports where reporter_id in (select id from auth.users where email like 'w13g-%@%')");
    await db.query("delete from public.qna_answers where question_id in (select id from public.qna_questions where title like $1)", [`${TAG}%`]);
    await db.query("delete from public.qna_questions where title like $1", [`${TAG}%`]);
    await db.query("delete from public.qna_sanctions where created_by like 'admin:%' or reason like $1", [`${TAG}%`]);
    await db.query("delete from public.expert_verification_events where expert_profile_id in (select id from public.expert_profiles where slug like 'e2e-w13g-%')");
    await db.query("delete from public.expert_verifications where expert_profile_id in (select id from public.expert_profiles where slug like 'e2e-w13g-%')");
    await db.query("delete from public.expert_profile_events where profile_id in (select id from public.expert_profiles where slug like 'e2e-w13g-%')");
    await db.query("delete from public.expert_profiles where slug like 'e2e-w13g-%'");
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
const profile = async (n, status = "published") =>
  (
    await db.query(
      `insert into public.expert_profiles (slug, name, category_codes, office_name, house_relation, status, consent_version, consent_on, consent_doc_ref, published_by, edited_by)
       values ($1, $2, '{tax-accountant}', '시험 법인(가상)', 'employed', $3, 'c1', '2026-10-01', 'doc-1', 'e2e', 'e2e') returning id`,
      [`e2e-w13g-${run}-${n}`, `가상 전문가 ${n}`, status],
    )
  ).rows[0].id;

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer(serverEnv());
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  await staff.removeLeftover(ADMIN_EMAIL);
  await purge();
  await staff.snapshotOperations();
  u.reporter = await staff.createUser({ label: "w13g-reporter", email: "w13g-reporter@example.test", roles: ["reporter"], person: { name: "라운지 시험 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w13g-editor", email: "w13g-editor@example.test", roles: ["editor"], person: { name: "라운지 시험 편집장", roles: ["editor"] } });
  u.admin = await staff.createUser({ label: "w13g-admin", email: ADMIN_EMAIL });
  u.asker = await staff.createUser({ label: "w13g-asker", email: "w13g-asker@example.test" });
  u.expert = await staff.createUser({ label: "w13g-expert", email: "w13g-expert@example.test" });
  u.member = await staff.createUser({ label: "w13g-member", email: "w13g-member@example.test" });
  await db.query("update public.settings set value = value || '{\"qna\": false}'::jsonb where key = 'feature_flags'");
  await db.query("update public.settings set value = jsonb_build_object('version','','text','','answer_footer','','approved',false,'reviewed_by',null,'reviewed_on',null) where key = 'qna_neutrality_notice'");
  await db.query("update public.settings set value = '{}'::jsonb where key in ('qna_criteria', 'qna_detect_dictionary')");
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

test("a) 닫힘 - 키 꺼짐이면 화면 5개·쓰기 API 404, 고지 승인 없이 켜기 거부, 승인 뒤 켜짐", async () => {
  for (const p of ["/qna", "/qna/new", "/qna/1", "/qna/criteria", "/qna/experts/1"]) assert.equal((await get(p)).status, 404, `${p} 꺼짐`);
  assert.equal((await memberPost("questions", u.asker, q1())).status, 404, "쓰기 API도 꺼짐이면 404");
  await assert.rejects(setFlag({ qna: true }), (e) => e.code === "23514", "고지 승인 없이 켜기");
  await db.query("update public.settings set value = $1::jsonb where key = 'qna_neutrality_notice'", [JSON.stringify(NOTICE)]);
  await setFlag({ qna: true });
  assert.equal((await get("/qna")).status, 200);
  assert.equal((await memberPost("questions", { token: "bad" }, q1())).status, 401);
});

test("b) 계정 연결 - 관리자만 · 잘못된 입력 422 · 비공개 프로필 422 · 연결 201 · 중복 409 · 자기 신청 경로 없음", async () => {
  const pub = await profile(1);
  const draft = await profile(2, "draft");
  const body = (profileId, userId = u.expert.id) => ({ op: "link", user_id: userId, profile_id: profileId, expires_on: "2099-12-31" });
  assert.equal((await adminApi("POST", "/expert-links", u.reporter, body(pub))).status, 403);
  assert.equal((await adminApi("POST", "/expert-links", u.editor, body(pub))).status, 403, "편집 책임자도 연결은 못 한다");
  assert.equal((await adminApi("POST", "/expert-links", u.admin, { ...body(pub), user_id: "not-a-uuid" })).status, 422);
  assert.equal((await adminApi("POST", "/expert-links", u.admin, { ...body(pub), expires_on: "2099-02-30" })).status, 422);
  assert.equal((await adminApi("POST", "/expert-links", u.admin, body(draft))).status, 422, "비공개 프로필");
  assert.equal((await adminApi("POST", "/expert-links", u.admin, body(pub))).status, 201);
  assert.equal((await adminApi("POST", "/expert-links", u.admin, body(pub, u.member.id))).status, 409, "프로필당 1개");
  assert.equal((await adminApi("POST", "/expert-links", u.admin, body(await profile(3)))).status, 409, "계정당 1개");
  const audit = await db.query("select count(*)::int n from public.audit_logs where action = 'expert.link.create' and target = $1", [`expert_profiles:${pub}`]);
  assert.equal(audit.rows[0].n, 1, "연결 감사 1건");
  // 외부 전문가 자기 신청 화면·API는 없다. /my/* 는 proxy가 비로그인을 먼저 로그인으로 보내 404를 볼 수 없으므로 폴더 없음을 직접 확인한다
  for (const dir of ["app/my/expert", "app/api/expert", "app/api/my/expert"]) assert.equal(fs.existsSync(path.join(import.meta.dirname, "..", "apps/web", dir)), false, `${dir} 없음`);
  for (const p of ["/api/expert/verify", "/api/my/expert"]) assert.equal((await get(p)).status, 404, `${p} 없음`);
  u.pub = pub;
});

test("c) 글 - 경고 확인 없이 422 · 개인정보는 가려 게시 보류 · 일반 회원 의견과 전문가 답변 배지 구분 · 채택은 질문자만 한 번", async () => {
  assert.equal((await memberPost("questions", u.asker, q1({ warning_confirmed: false }))).status, 422);
  const ok = await memberPost("questions", u.asker, q1());
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  u.q = ok.body.question.id;
  const pii = await memberPost("questions", u.asker, q1({ title: `${TAG} ${run} 개인정보`, body: "연락은 e2e-pii@example.test 또는 010-1234-5678" }));
  assert.equal(pii.status, 201);
  assert.equal(pii.body.question.status, "held");
  const stored = (await db.query("select body from public.qna_questions where id = $1", [pii.body.question.id])).rows[0].body;
  assert.doesNotMatch(stored, /e2e-pii@example|1234-5678|01012345678/, "가리기 전 값은 저장되지 않는다");
  const list = await get("/qna");
  assert.ok(list.html.includes(`${TAG} ${run} 질문`));
  assert.ok(!list.html.includes("개인정보"), "보류 글은 목록에 없다");
  assert.equal((await get(`/qna/${pii.body.question.id}`)).status, 404);

  const plain = await memberPost("answers", u.member, { question_id: u.q, body: "시험용 일반 회원 답변입니다" });
  assert.equal(plain.status, 201);
  assert.equal(plain.body.by_expert, false);
  const exp = await memberPost("answers", u.expert, { question_id: u.q, body: "시험용 전문가 답변입니다" });
  assert.equal(exp.status, 201);
  assert.equal(exp.body.by_expert, true);
  u.expertAnswer = exp.body.answer.id;
  u.plainAnswer = plain.body.answer.id;
  const page = await get(`/qna/${u.q}`);
  assert.equal(page.status, 200);
  assert.equal([...page.html.matchAll(/data-answer-kind="expert"/g)].length, 1, "전문가 배지는 연결된 계정 하나");
  assert.equal([...page.html.matchAll(/data-answer-kind="member"/g)].length, 1);
  assert.ok(page.html.includes("전문가 답변") && page.html.includes("일반 회원 의견"));

  assert.equal((await memberPost("accept", u.member, { question_id: u.q, answer_id: u.expertAnswer })).status, 403, "질문자가 아니면 채택 불가");
  assert.equal((await memberPost("accept", u.asker, { question_id: u.q, answer_id: u.expertAnswer })).status, 200);
  assert.equal((await memberPost("accept", u.asker, { question_id: u.q, answer_id: u.plainAnswer })).status, 409, "한 번만");
});

test("d) 화면 - 고지 3개 화면 + 답변 하단 · 상담·매칭·결제 요소 0 · 연락처 0 · 두 링크뿐 · noindex · chunks에 라운지 없음", async () => {
  const pages = [await get("/qna"), await get("/qna/new"), await get(`/qna/${u.q}`)];
  for (const p of pages) {
    assert.equal(p.status, 200);
    assert.ok(p.html.includes(NOTICE.text), "중립성 고지");
    assert.doesNotMatch(p.html, /상담 신청|전문가 매칭|매칭 신청|결제하기|수수료|소개 대가를 받/, "상담·매칭·결제 요소 0");
    assert.doesNotMatch(p.html, /href="(tel|mailto):/, "연락처 렌더 0");
  }
  assert.ok(pages[2].html.includes(NOTICE.answer_footer), "답변 하단 고지");
  const links = [...pages[2].html.matchAll(/data-part="expert-links"[\s\S]*?<\/p>/g)][0][0];
  const hrefs = [...links.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.every((h) => h === "/experts" || h === "/experts/request"), `전문가 연결은 1단계 두 링크뿐: ${hrefs}`);
  assert.match(pages[2].html, /<meta name="robots" content="noindex/, "라운지 글 색인 제외");
  assert.equal((await get("/qna/experts/999999999")).status, 404);
  const def = (await db.query("select string_agg(pg_get_constraintdef(c.oid), ' ') d from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname = 'chunks' and c.contype = 'c'")).rows[0].d;
  assert.doesNotMatch(def, /qna|lounge/, "지방세봇 색인 허용 목록에 라운지 없음");
});

test("e) 활동 띠 - 기준이 비어 있으면 0 · 기준 충족 시 전문가 1명 · 제재 중이면 빠짐 · 프로필 링크는 1단계 프로필만", async () => {
  assert.ok(!(await get("/qna")).html.includes('data-testid="qna-strip"'), "기준이 비면 띠 0");
  await db.query("update public.settings set value = $1::jsonb where key = 'qna_criteria'", [JSON.stringify({ window_days: 90, min_accepted: 1, min_rate: 0.5, strip_size: 3 })]);
  await restart(); // 설정은 30초 캐시
  const strip = await get("/qna");
  assert.equal([...strip.html.matchAll(/data-expert-id="\d+"/g)].length, 1);
  assert.doesNotMatch(strip.html, /href="(tel|mailto):/);
  const expertPage = await get(`/qna/experts/${u.pub}`);
  assert.equal(expertPage.status, 200);
  assert.ok(expertPage.html.includes("채택률 100%"));
  assert.doesNotMatch(expertPage.html, /시험 법인|office|사무소/, "사무소 렌더 0");
  const crit = await get("/qna/criteria");
  assert.ok(crit.html.includes("결제·구독·광고는 순서에 반영되지 않습니다"));
  await db.query("insert into public.qna_sanctions (user_id, reason, created_by, ends_at) values ($1, $2, 'e2e', now() + interval '1 day')", [u.expert.id, `${TAG} 제재`]);
  await restart();
  assert.equal([...(await get("/qna")).html.matchAll(/data-expert-id="\d+"/g)].length, 0, "제재 중이면 띠에서 빠짐");
  assert.equal((await get(`/qna/experts/${u.pub}`)).status, 404);
  await db.query("delete from public.qna_sanctions where reason like $1", [`${TAG}%`]);
  await restart();
});

test("f) 해제 - 연결 해제와 프로필 비공개 모두 같은 요청부터 배지 0", async () => {
  assert.equal([...(await get(`/qna/${u.q}`)).html.matchAll(/data-answer-kind="expert"/g)].length, 1);
  const id = (await db.query("select id from public.expert_verifications where expert_profile_id = $1 and status = 'active'", [u.pub])).rows[0].id;
  assert.equal((await adminApi("POST", "/expert-links", u.admin, { op: "end", id, reason: "시험 해제" })).status, 200);
  assert.equal((await adminApi("POST", "/expert-links", u.admin, { op: "end", id, reason: "시험 해제" })).status, 409);
  const after = await get(`/qna/${u.q}`);
  assert.equal([...after.html.matchAll(/data-answer-kind="expert"/g)].length, 0, "해제 뒤 배지 0");
  assert.equal([...after.html.matchAll(/data-answer-kind="member"/g)].length, 2);
  assert.equal((await memberPost("answers", u.expert, { question_id: u.q, body: "해제 뒤 답변" })).body.by_expert, false, "해제 뒤 새 답변도 일반 회원");
});

test("g) 신고·관리 - 신고 201 · 중복 409 · 자기 글 422 · 기자 403 · 편집 책임자 처리 · 숨긴 글 사라짐 · 목표 시각 1영업일", async () => {
  const bad = await memberPost("answers", u.member, { question_id: u.q, body: "시험용 광고성 답변입니다" });
  const target = bad.body.answer.id;
  const rep = { target_type: "answer", target_id: target, reason: "ad", note: "" };
  assert.equal((await memberPost("reports", u.asker, rep)).status, 201);
  assert.equal((await memberPost("reports", u.asker, rep)).status, 409);
  assert.equal((await memberPost("reports", u.member, rep)).status, 422, "자기 글 신고 불가");
  assert.equal((await adminApi("GET", "/qna", u.reporter)).status, 403);
  const board = await adminApi("GET", "/qna", u.editor);
  assert.equal(board.status, 200);
  const r = board.body.reports.find((x) => x.target_id === target);
  assert.ok(r, "대기 신고 목록");
  const received = new Date(r.created_at).getTime();
  const due = new Date(r.due_at).getTime();
  assert.ok(due - received >= 86400000 - 1000, "목표 시각은 접수 후 최소 1일 뒤");
  assert.equal((await adminApi("POST", "/qna", u.editor, { op: "report_handle", id: r.id, decision: "upheld", hide: true, note: "광고성 확인(시험)" })).status, 200);
  assert.equal((await adminApi("POST", "/qna", u.editor, { op: "report_handle", id: r.id, decision: "dismissed", note: "다시" })).status, 409);
  assert.ok(!(await get(`/qna/${u.q}`)).html.includes("시험용 광고성 답변입니다"), "숨긴 글은 화면에서 사라진다");
  const audit = await db.query("select count(*)::int n from public.audit_logs where action = 'qna.report.handle' and target = $1", [`qna_reports:${r.id}`]);
  assert.equal(audit.rows[0].n, 1);
});
