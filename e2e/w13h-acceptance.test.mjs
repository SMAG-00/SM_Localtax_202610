// W13-h 수용 E2E (docs/dev/W13-h_설계.md - PRD-05 HOME-11 · AIOPS-15, 5단계 설계 W13-h "동의 안 한 글 후보 0 · 승인·가림 확인 없이 노출 0 · 동의 철회 → 다음 요청부터 제외 · AI 우회 경로 0")
// standalone 빌드를 로컬 Supabase에 붙인다. 글·카드 문구는 전부 시험용 가짜다. (작성만 - 실행은 W13-z 수용 때)
//  a) 닫힘 - 기능 키 solved_cases 꺼짐이면 홈에 해결 사례 블록 0 (승인된 카드가 있어도)
//  b) 동의 - 질문 폼의 해결 사례 동의 체크는 기본 꺼짐 / 동의 없이 등록한 글은 카드 저장 거부(409) / 동의한 글은 채택 전 거부 · 채택 뒤 저장 가능
//  c) 승인 - 기자 403 · 가림 확인 없이 승인 422 · 개인정보 모양 카드 422 · 확인 뒤 승인 200
//  d) 홈 - 키 켜짐 + 승인 카드 → 홈에 카드 1장(원 질문 링크, 작성자·연락처 렌더 0) / 동의 철회 → 다음 요청부터 홈에서 빠짐
//  e) 분류 - 질문 등록 시 정규식 제안이 큐에 들어간다 · 수락하면 카드 세목에 반영 · AI 출처 행 0
// 만든 계정·글은 끝나면 지운다 (설정은 시작 상태로 되돌린다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w13h-acceptance-e2e@example.test";
const SITE = "https://e2e-w13h.example.test";
const GUARD = "e2e-w13h-guard-secret-not-real";
const TAG = "e2e-w13h";

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
  await db.query("delete from public.request_throttles where scope = 'form_ip'");
  const res = await fetch(`${base}/api/qna/${path}`, { method: "POST", headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const get = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
const setFlag = async (patch) => db.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(patch)]);
const q1 = (over = {}) => ({ tax_type: "재산세", title: `${TAG} ${run} 질문`, body: "재산세 납부 방법을 묻는 시험용 질문입니다", warning_confirmed: true, ...over });
const CARD = { situation: "시험용 상황 문장", issue: "시험용 쟁점 문장", result: "시험용 결과 문장", lesson: "시험용 교훈 문장" };

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.qna_solved_cases where question_id in (select id from public.qna_questions where title like $1)", [`${TAG}%`]);
    await db.query("delete from public.qna_classifications where question_id in (select id from public.qna_questions where title like $1)", [`${TAG}%`]);
    await db.query("delete from public.qna_answers where question_id in (select id from public.qna_questions where title like $1)", [`${TAG}%`]);
    await db.query("delete from public.qna_questions where title like $1", [`${TAG}%`]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
async function resolvedQuestion(consent) {
  const q = await memberPost("questions", u.asker, q1({ solved_consent: consent }));
  assert.equal(q.status, 201);
  const qid = q.body.question.id;
  const a = await memberPost("answers", u.member, { question_id: qid, body: "시험용 답변입니다" });
  assert.equal(a.status, 201);
  const acc = await memberPost("accept", u.asker, { question_id: qid, answer_id: a.body.answer.id });
  assert.equal(acc.status, 200);
  return qid;
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
  u.reporter = await staff.createUser({ label: "w13h-reporter", email: "w13h-reporter@example.test", roles: ["reporter"], person: { name: "해결 사례 시험 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w13h-editor", email: "w13h-editor@example.test", roles: ["editor"], person: { name: "해결 사례 시험 편집장", roles: ["editor"] } });
  u.admin = await staff.createUser({ label: "w13h-admin", email: ADMIN_EMAIL });
  u.asker = await staff.createUser({ label: "w13h-asker", email: "w13h-asker@example.test" });
  u.member = await staff.createUser({ label: "w13h-member", email: "w13h-member@example.test" });
  await db.query("update public.settings set value = $1::jsonb where key = 'qna_neutrality_notice'", [JSON.stringify(NOTICE)]);
  await setFlag({ qna: true, solved_cases: false });
});

after(async () => {
  try {
    await purge();
    await db.query("update public.settings set value = value || '{\"qna\": false, \"solved_cases\": false}'::jsonb where key = 'feature_flags'");
    await db.query("update public.settings set value = jsonb_build_object('version','','text','','answer_footer','','approved',false,'reviewed_by',null,'reviewed_on',null) where key = 'qna_neutrality_notice'");
    await db.query("delete from public.request_throttles where scope = 'form_ip'");
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

test("a) 닫힘 - 기능 키 solved_cases가 꺼져 있으면 승인된 카드가 있어도 홈에 해결 사례 블록 0", async () => {
  const qid = await resolvedQuestion(true);
  const saved = await adminApi("POST", "/solved-cases", u.editor, { op: "save", question_id: qid, ...CARD });
  assert.equal(saved.status, 200);
  const ok = await adminApi("POST", "/solved-cases", u.editor, { op: "approve", id: saved.body.id, mask_confirmed: true });
  assert.equal(ok.status, 200);
  const home = await get("/");
  assert.equal(home.status, 200);
  assert.ok(!home.html.includes('data-home-section="solved_cases"'), "키 꺼짐이면 블록 0");
  assert.ok(!home.html.includes(CARD.situation));
});

test("b) 동의 - 폼 체크는 기본 꺼짐 · 동의 없는 글 카드 저장 409 · 채택 전 409", async () => {
  const form = await get("/qna/new");
  assert.equal(form.status, 200);
  const box = form.html.match(/<input[^>]*name="solved_consent"[^>]*>/);
  assert.ok(box, "동의 체크 칸이 있다");
  assert.ok(!/checked/.test(box[0]), "기본 꺼짐");
  const noConsent = await resolvedQuestion(false);
  assert.equal((await adminApi("POST", "/solved-cases", u.editor, { op: "save", question_id: noConsent, ...CARD })).status, 409);
  const q = await memberPost("questions", u.asker, q1({ solved_consent: true }));
  assert.equal((await adminApi("POST", "/solved-cases", u.editor, { op: "save", question_id: q.body.question.id, ...CARD })).status, 409, "채택 전");
});

test("c) 승인 - 기자 403 · 가림 확인 없이 422 · 개인정보 모양 카드 422 · 확인 뒤 200", async () => {
  const qid = await resolvedQuestion(true);
  assert.equal((await adminApi("POST", "/solved-cases", u.reporter, { op: "save", question_id: qid, ...CARD })).status, 403);
  assert.equal((await adminApi("POST", "/solved-cases", u.editor, { op: "save", question_id: qid, ...CARD, situation: "문의는 someone@example.com 으로" })).status, 422);
  const saved = await adminApi("POST", "/solved-cases", u.editor, { op: "save", question_id: qid, ...CARD });
  assert.equal(saved.status, 200);
  assert.equal((await adminApi("POST", "/solved-cases", u.editor, { op: "approve", id: saved.body.id })).status, 422, "가림 확인 없음");
  assert.equal((await adminApi("POST", "/solved-cases", u.editor, { op: "approve", id: saved.body.id, mask_confirmed: false })).status, 422);
  assert.equal((await adminApi("POST", "/solved-cases", u.editor, { op: "approve", id: saved.body.id, mask_confirmed: true })).status, 200);
  assert.equal((await adminApi("GET", "/solved-cases", u.reporter)).status, 403);
  assert.equal((await adminApi("GET", "/solved-cases", u.admin)).status, 200);
});

test("d) 홈 - 키 켜짐 + 승인 카드가 보이고 작성자·연락처 렌더 0, 동의 철회 뒤 다음 요청부터 빠진다", async () => {
  await setFlag({ solved_cases: true });
  await db.query("delete from public.qna_solved_cases where question_id in (select id from public.qna_questions where title like $1)", [`${TAG}%`]);
  const qid = await resolvedQuestion(true);
  const saved = await adminApi("POST", "/solved-cases", u.editor, { op: "save", question_id: qid, ...CARD, situation: `${TAG} 홈 카드 상황` });
  await adminApi("POST", "/solved-cases", u.editor, { op: "approve", id: saved.body.id, mask_confirmed: true });
  const home = await get("/");
  assert.ok(home.html.includes('data-home-section="solved_cases"'));
  assert.ok(home.html.includes(`${TAG} 홈 카드 상황`));
  assert.ok(home.html.includes(`/qna/${qid}`), "원 질문 링크");
  assert.ok(!/tel:|mailto:/.test(home.html.slice(home.html.indexOf('data-home-section="solved_cases"'))), "연락처 렌더 0");
  assert.equal((await memberPost("solved-consent", u.member, { question_id: qid })).status, 403, "질문자 아닌 계정은 철회 불가");
  assert.equal((await memberPost("solved-consent", u.asker, { question_id: qid })).status, 200);
  const after = await get("/");
  assert.ok(!after.html.includes(`${TAG} 홈 카드 상황`), "철회 뒤 다음 요청부터 제외");
  assert.equal((await memberPost("solved-consent", u.asker, { question_id: qid })).status, 409, "이미 철회");
});

test("e) 분류 - 등록 시 정규식 제안이 큐에 들어가고 수락하면 카드 세목에 반영, AI 출처 행 0", async () => {
  const qid = await resolvedQuestion(true);
  const queue = await adminApi("GET", "/solved-cases", u.editor);
  const item = queue.body.queue.find((k) => k.question_id === qid);
  assert.ok(item, "큐에 제안이 있다");
  assert.deepEqual(item.proposed_tax_types, ["재산세"]);
  assert.equal(Number((await db.query("select count(*) n from public.qna_classifications where source <> 'regex'")).rows[0].n), 0);
  assert.equal((await adminApi("POST", "/solved-cases", u.editor, { op: "classify_review", id: item.id, decision: "accepted" })).status, 422, "세목 없는 수락");
  assert.equal((await adminApi("POST", "/solved-cases", u.editor, { op: "classify_review", id: item.id, decision: "accepted", final_tax_type: "지방교육세" })).status, 200);
  const saved = await adminApi("POST", "/solved-cases", u.editor, { op: "save", question_id: qid, ...CARD });
  await adminApi("POST", "/solved-cases", u.editor, { op: "approve", id: saved.body.id, mask_confirmed: true });
  const row = (await db.query("select tax_type from public.public_solved_cases where question_id = $1", [qid])).rows[0];
  assert.equal(row.tax_type, "지방교육세");
});
