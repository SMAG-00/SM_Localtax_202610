// W10-a 수용 E2E (docs/dev/W10-a_설계.md - PRD-02 RULE-02·03·04 · TX-05 · CALC-14 · FAM-07)
// standalone 빌드를 로컬 Supabase에 붙인다. 룰셋 초안은 저장소의 rules/*.json(SM이 가진 AI 작성·미감수 값, draft)을 그대로 붙여 넣고,
// 대조 사례는 전부 시험용 가짜다 - 공식 결과 금액은 첫 대조 실행에서 엔진이 낸 값을 그대로 빌려 쓴다(법령 정답이 아니라 연결을 보는 시험).
//  a) 권한 - 기자·편집 책임자 403 / 감수위원은 읽기+서명 / 관리자는 읽기+승인, 서명은 관리자도 403(거부 감사)
//  b) 활성화 경로 - 서명 없는 승인 409(거부 감사 1행) / 감수 시트 없는 서명 422 / 서명 뒤 승인 200, 두 번째 승인 409 / 직접 UPDATE로 활성화 거부
//  c) 근거 개정 - 입법예고·국회 제출 단계 근거는 승인 거부(상태 변화 0), 공포 단계 근거는 승인되고 이전 활성본은 내려간다
//  d) 대조 사례 - 개인정보 흔적 422 / 확인은 감수위원만 / 확인 안 된 사례는 게이트에 세지 않음
//  e) 게이트 - 배치 accuracy-run 인증 없으면 401 / 공식 29건 닫힘 -> 30건 열림 / 1건 철회하면 다시 닫힘 (수동 우회 입력 없음)
// 만든 룰셋·사례·실행 기록은 끝나면 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w10a-acceptance-e2e@example.test";
const CRON = "e2e-w10a-cron-secret";
const SITE = "https://e2e-w10a.example.test";
const read = (v) => fs.readFileSync(new URL(`../rules/${v}.json`, import.meta.url), "utf8");
const HOLDING = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", publishedPrices: [500000000], isSingleHouseOneHousehold: true };

let sb, server, staff, db, base, run, since;
const u = {};
const created = { rulesets: [], amendments: [] };
const show = (r) => JSON.stringify(r.body).slice(0, 400);

async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const rules = (user, body) => api("POST", "/rules", user, body);
const accuracy = (user, body) => api("POST", "/accuracy", user, body);
const job = (secret = CRON) => fetch(`${base}/api/jobs/accuracy-run`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} }).then(async (res) => ({ status: res.status, text: await res.text() }));
const statusOf = async (id) => (await db.query("select status from public.rulesets where id = $1", [id])).rows[0]?.status;
const auditOf = async (id) => (await db.query("select action, outcome, code, basis_event_id from public.rules_audit where kind = 'ruleset' and target_id = $1 order by id", [id])).rows;
const gate = async () => (await db.query("select * from public.calc_gate_status where tax_kind = 'property' and cause_group = 'ALL'")).rows[0];

async function createDraft(version, extra = {}) {
  const r = await rules(u.admin, { op: "create", kind: "ruleset", version, source_ref: "시험용 - rules 폴더 초안", basis_note: "시험용 초기 반입", body: read(version), ...extra });
  assert.equal(r.status, 201, show(r));
  const id = Number(r.body.created.id);
  created.rulesets.push(id);
  return id;
}
async function amendmentEvent(stage) {
  const am = (await db.query("insert into public.amendments (slug, title) values ($1, '시험용 개정안') returning id", [`e2e-w10a-${run}-${stage.replace("_", "-")}`])).rows[0].id;
  created.amendments.push(Number(am));
  const snap = (await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('mois', 'https://example.test/w10a', $1, '시험용') returning id", [`e2e-w10a-${run}-${stage.replace("_", "-")}`])).rows[0].id;
  return Number((await db.query("insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, $2, '2099-01-01', 'https://example.test/w10a', $3, 'e2e:w10a') returning id", [am, stage, snap])).rows[0].id);
}

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.accuracy_run_results where case_id in (select id from public.accuracy_cases where case_key like 'e2e-w10a-%')");
    await db.query("delete from public.accuracy_runs where ruleset_id = any($1::bigint[]) or run_at >= $2", [created.rulesets, since]);
    await db.query("delete from public.accuracy_cases where case_key like 'e2e-w10a-%'");
    await db.query("delete from public.rules_audit where target_id = any($1::bigint[]) and kind = 'ruleset'", [created.rulesets]);
    await db.query("delete from public.rulesets where id = any($1::bigint[])", [created.rulesets]);
    await db.query("delete from public.amendment_events where amendment_id = any($1::bigint[])", [created.amendments]);
    await db.query("delete from public.amendments where id = any($1::bigint[])", [created.amendments]);
    await db.query("delete from public.raw_snapshots where content_hash like $1", [`e2e-w10a-${run}-%`]);
    await db.query("delete from public.agent_runs where job = 'accuracy-run' and started_at >= $1", [since]);
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
    CRON_SECRET: CRON,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  since = new Date().toISOString();
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w10a-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w10a-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w10a-editor", roles: ["editor"], person: { name: "시험용 편집 책임자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w10a-reviewer", roles: ["reviewer"], person: { name: "시험용 감수위원", roles: ["reviewer"] } });
  await purge();
});

after(async () => {
  try {
    await purge();
  } finally {
    await staff?.cleanup();
    await server?.stop?.();
  }
});

test("a) 권한 - 기자·편집 책임자 403, 감수위원은 읽기와 서명, 관리자는 읽기와 승인", async () => {
  for (const path of ["/rules", "/accuracy"]) {
    assert.equal((await api("GET", path, u.reporter)).status, 403, `기자 ${path}`);
    assert.equal((await api("GET", path, u.editor)).status, 403, `편집 책임자 ${path}`);
    assert.equal((await api("GET", path, u.reviewer)).status, 200, `감수위원 ${path}`);
    assert.equal((await api("GET", path, u.admin)).status, 200, `관리자 ${path}`);
  }
  assert.equal((await rules(u.reporter, { op: "create", kind: "ruleset" })).status, 403);
  assert.equal((await rules(u.reviewer, { op: "create", kind: "ruleset" })).status, 403, "초안 만들기는 관리자만");
  const board = await api("GET", "/rules", u.admin);
  assert.ok(board.body.versions.every((v) => v.body === undefined), "목록에 본문 0");
});

test("b) 활성화 경로 - 서명 없는 승인 409, 서명은 감수위원만, 서명 뒤 승인 200, 직접 UPDATE 거부", async () => {
  const id = await createDraft("2026.01");
  assert.equal(await statusOf(id), "draft");

  const unsigned = await rules(u.admin, { op: "approve", kind: "ruleset", id });
  assert.equal(unsigned.status, 409, show(unsigned));
  assert.equal(unsigned.body.code, "not_signed");
  assert.deepEqual((await auditOf(id)).map((a) => `${a.action}:${a.outcome}:${a.code}`), ["approve:refused:not_signed"], "거부도 감사 1행");
  assert.equal(await statusOf(id), "draft");

  const adminSign = await rules(u.admin, { op: "sign", kind: "ruleset", id, sheet_ref: "시험용 시트" });
  assert.equal(adminSign.status, 403, "관리자도 서명 불가");
  const denial = await db.query("select 1 from public.audit_logs where action = 'ruleset.sign.denied' and target = 'rules:sign' and at >= $1", [since]);
  assert.ok(denial.rowCount >= 1, "허용 밖 서명 시도는 감사 로그에 남는다");

  assert.equal((await rules(u.reviewer, { op: "sign", kind: "ruleset", id, sheet_ref: "" })).status, 422, "감수 시트 없는 서명");
  assert.equal((await rules(u.reviewer, { op: "approve", kind: "ruleset", id })).status, 403, "감수위원은 승인 불가");
  const signed = await rules(u.reviewer, { op: "sign", kind: "ruleset", id, sheet_ref: "시험용 시트 A1" });
  assert.equal(signed.status, 200, show(signed));
  assert.equal(await statusOf(id), "reviewed");

  const direct = await db.query("update public.rulesets set status = 'active', activated_by = 'x', activated_at = now() where id = $1", [id]).then(() => null, (e) => e);
  assert.ok(direct, "함수 밖 직접 활성화는 거부된다");
  assert.equal(await statusOf(id), "reviewed");

  const ok = await rules(u.admin, { op: "approve", kind: "ruleset", id });
  assert.equal(ok.status, 200, show(ok));
  assert.equal(await statusOf(id), "active");
  assert.equal((await rules(u.admin, { op: "approve", kind: "ruleset", id })).status, 409, "두 번째 승인");
  assert.deepEqual((await auditOf(id)).map((a) => `${a.action}:${a.outcome}`), ["approve:refused", "sign:ok", "approve:ok", "approve:refused"]);
});

test("c) 근거 개정 - 입법예고·국회 제출 단계 근거는 승인 거부(상태 변화 0), 공포 단계 근거는 승인되고 이전 활성본은 내려간다 (TX-05)", async () => {
  const preNotice = await amendmentEvent("pre_notice");
  const submitted = await amendmentEvent("submitted");
  const promulgated = await amendmentEvent("promulgated");
  const drafts = [];
  for (const [version, ev] of [["2026.07", preNotice], ["2026.08", submitted]]) {
    const id = await createDraft(version, { basis_event_id: ev, basis_note: "" });
    assert.equal((await rules(u.reviewer, { op: "sign", kind: "ruleset", id, sheet_ref: "시험용 시트" })).status, 200);
    const res = await rules(u.admin, { op: "approve", kind: "ruleset", id });
    assert.equal(res.status, 409, show(res));
    assert.equal(res.body.code, "basis_stage");
    assert.equal(await statusOf(id), "reviewed", "상태 변화 0");
    const last = (await auditOf(id)).at(-1);
    assert.deepEqual([last.outcome, last.code, Number(last.basis_event_id)], ["refused", "basis_stage", ev]);
    drafts.push(id);
  }
  // 국회 제출이었던 기록이 아니라 공포 기록을 근거로 한 새 차수는 승인된다
  const firstId = created.rulesets[0];
  assert.equal(await statusOf(firstId), "active");
  const res = await rules(u.admin, { op: "create", kind: "ruleset", version: "2026.08", source_ref: "중복 버전", basis_event_id: String(promulgated), body: read("2026.08") });
  assert.equal(res.status, 409, "같은 버전은 덮어쓰지 않는다");
  // 거부된 초안 하나를 근거만 바꿔 다시 만들 수는 없으므로, 공포 근거 초안은 다른 차수 번호로 만든다
  const body = JSON.parse(read("2026.08"));
  const next = { ...body, version: "2026.09" };
  const created2 = await rules(u.admin, { op: "create", kind: "ruleset", version: "2026.09", source_ref: "시험용 파생", basis_event_id: String(promulgated), body: JSON.stringify(next) });
  assert.equal(created2.status, 201, show(created2));
  const id = Number(created2.body.created.id);
  created.rulesets.push(id);
  assert.equal((await rules(u.reviewer, { op: "sign", kind: "ruleset", id, sheet_ref: "시험용 시트" })).status, 200);
  assert.equal((await rules(u.admin, { op: "approve", kind: "ruleset", id })).status, 200);
  assert.equal(await statusOf(id), "active");
  assert.equal(await statusOf(firstId), "retired", "이전 활성본은 내려간다");
  assert.equal((await db.query("select 1 from public.rulesets where status = 'active'")).rowCount, 1, "활성은 1행");
  void drafts;
});

test("d) 대조 사례 - 개인정보 흔적 422, 확인은 감수위원만, 확인 전 사례는 게이트에 세지 않음", async () => {
  const base_ = { op: "case_add", case_key: `e2e-w10a-${run}-probe`, tax_kind: "property", sample_kind: "official", official_basis: "tax_notice", official_total: "1", case_input: JSON.stringify(HOLDING) };
  assert.equal((await accuracy(u.reporter, base_)).status, 403);
  const pii = await accuracy(u.admin, { ...base_, case_input: JSON.stringify({ ...HOLDING, ownerName: "x" }) });
  assert.equal(pii.status, 422, show(pii));
  assert.equal((await db.query("select 1 from public.accuracy_cases where case_key like $1", [`e2e-w10a-${run}-%`])).rowCount, 0, "저장 0");
  const added = await accuracy(u.admin, base_);
  assert.equal(added.status, 201, show(added));
  const caseId = Number(added.body.created.id);
  assert.equal((await accuracy(u.admin, { op: "case_confirm", id: caseId })).status, 403, "확인은 감수위원만");
  assert.equal((await accuracy(u.reviewer, { op: "case_confirm", id: caseId })).status, 200);
  assert.equal((await accuracy(u.reviewer, { op: "case_confirm", id: caseId })).status, 409, "두 번 확인");
  const audit = await db.query("select after from public.audit_logs where target = $1 and action = 'accuracy.case.add'", [`accuracy_cases:${caseId}`]);
  assert.ok(!JSON.stringify(audit.rows[0].after).includes("publishedPrices"), "감사 기록에 사례 입력 0");
});

test("e) 게이트 - 인증 없는 배치 401, 공식 29건 닫힘 -> 30건 열림 -> 1건 철회하면 닫힘", async () => {
  assert.equal((await job("")).status, 401);
  assert.equal((await job("wrong-secret")).status, 401);
  // 활성 룰셋이 있는 상태에서 첫 실행 - 확인된 probe 사례 1건
  const first = await job();
  assert.equal(first.status, 200, first.text);
  const probe = (await db.query("select r.engine_total from public.accuracy_run_results r join public.accuracy_cases c on c.id = r.case_id where c.case_key = $1 order by r.run_id desc limit 1", [`e2e-w10a-${run}-probe`])).rows[0];
  assert.ok(probe, "probe 사례가 대조 실행에 들어갔다");
  const total = Number(probe.engine_total);
  await db.query("update public.accuracy_cases set retired_at = now() where case_key = $1", [`e2e-w10a-${run}-probe`]);

  const reviewerActor = `user:${u.reviewer.id}`;
  const seed = async (kind, from, to, sampleKind) => {
    await db.query(
      `insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by)
       select 'e2e-w10a-' || $1 || '-' || $2 || '-' || g, 'property', $2, $3::jsonb, $4, $5, 'e2e:w10a' from generate_series($6::int, $7::int) g`,
      [run, sampleKind, JSON.stringify(HOLDING), total, kind, from, to],
    );
  };
  await seed("tax_notice", 1, 29, "official");
  await seed("reviewer_calc", 1, 50, "review_sample");
  const confirmAll = () => db.query("select public.confirm_accuracy_case(id, $1) from public.accuracy_cases where case_key like $2 and confirmed_at is null and retired_at is null", [reviewerActor, `e2e-w10a-${run}-%`]);
  await confirmAll();
  assert.equal((await job()).status, 200);
  let g = await gate();
  assert.deepEqual([Number(g.official_cases), Number(g.official_matched), Number(g.sample_cases), g.is_open], [29, 29, 50, false], "공식 29건");

  await seed("tax_notice", 30, 30, "official");
  await confirmAll();
  assert.equal((await gate()).is_open, false, "30번째를 확인했어도 실행 전에는 닫힘");
  const ran = await accuracy(u.admin, { op: "run" });
  assert.equal(ran.status, 200, show(ran));
  g = await gate();
  assert.deepEqual([Number(g.official_cases), Number(g.official_matched), g.is_open], [30, 30, true], "공식 30건 + 표본 50건");
  const board = await api("GET", "/accuracy", u.reviewer);
  const row = board.body.gate.find((x) => x.tax_kind === "property" && x.cause_group === "ALL");
  assert.equal(row.is_open, true);
  assert.ok(board.body.cases.every((c) => c.case_input === undefined), "목록에 사례 입력 0");

  const one = (await db.query("select id from public.accuracy_cases where case_key = $1", [`e2e-w10a-${run}-official-30`])).rows[0].id;
  assert.equal((await accuracy(u.admin, { op: "case_retire", id: Number(one) })).status, 200);
  g = await gate();
  assert.deepEqual([Number(g.official_cases), g.is_open], [29, false], "철회하면 바로 닫힘");
  assert.equal((await db.query("select 1 from information_schema.columns where table_name = 'calc_gate_status' and column_name ~ 'override|manual'")).rowCount, 0, "수동 우회 칸 없음");
});
