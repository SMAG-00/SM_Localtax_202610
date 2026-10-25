// W10-g DB - 교육 강좌 안내 · 위탁교육 견적 · 세미나 (마이그레이션 20261025000098, PRD-02 BIZ-06, 연결 방식 - docs/dev/W10-g_설계.md)
//  · 씨앗 - 견적 정책 미승인, 기능 키 edu·education_billing·seminars 꺼짐, 수강 등록·수료증 표 없음, 견적 표에 결제 칸 0
//  · 정책 - 보관 일수·영업일·글자 수 범위, 승인에는 동의 버전·안내·동의 항목·검토자·검토일·법률 검토 기록 필수
//  · 기능 키 - education_billing은 edu + 승인된 정책이 있어야 켜짐, seminars는 edu가 있어야 켜짐
//  · 강좌·회차·세미나 - 게시는 출처·확인일, 세미나는 연사 이해관계 공개·협찬자 표기, 신청 링크는 edu_site 종류만, 예약 이름 slug 거부
//  · 견적 - 정책 승인 전·동의 버전 불일치·긴 숫자·연락처 없음 저장 거부, 마지막 보관일 계산, 개인 칸 수정 불가, 상태는 앞으로만
//  · 파기 - 마지막 보관일 당일 보존 · 다음 날 파기, 멱등, 통계 칸 유지, 철회는 맞는 연락처만 즉시 파기
//  · 공개 뷰 - 기능 키·게시 상태·정책 승인에 따라 나오고 닫히며, 견적 표는 anon·authenticated가 읽지 못함
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 내용은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
async function attempt(sql, params = [], role = null) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    if (role) await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, code: err.code, message: err.message };
  }
}
let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const lkey = () => `l${process.pid}_${++seq}`; // official_links.key 모양: 소문자·숫자·밑줄
async function flags(patch) {
  const cur = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  return attempt("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
const policyValue = (patch = {}) => ({
  retention_days: 30, target_business_days: 3, message_max_chars: 200,
  consent_version: "시험용-v1", intro: ["시험용 안내 문단"], consent_items: ["시험용 동의 항목"],
  approved: true, reviewed_by: "시험용 검토자", reviewed_on: "2026-10-25", legal_review_ref: "시험용-기록-1", ...patch,
});
const setPolicy = (patch) => attempt("update public.settings set value = $1::jsonb where key = 'training_quote_policy'", [JSON.stringify(policyValue(patch))]);
async function openAll() {
  assert.ok((await setPolicy({})).ok);
  assert.ok((await flags({ edu: true, education_billing: true, seminars: true })).ok);
}
const course = async (patch = {}) => {
  const c = { slug: uniq("c"), title: "시험용 강좌", provider_name: "시험용 교육기관", status: "published", verified_on: "2026-10-20", verified_ref: "시험용 공지", apply_link_id: null, ...patch };
  const r = await attempt(
    "insert into public.courses (slug, title, provider_name, status, verified_on, verified_ref, apply_link_id) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [c.slug, c.title, c.provider_name, c.status, c.verified_on, c.verified_ref, c.apply_link_id],
  );
  return r;
};
const seminar = (patch = {}) => {
  const s = { slug: uniq("s"), title: "시험용 세미나", topic: "amendment", starts_at: "2026-11-10T10:00:00+09", ends_at: "2026-11-10T12:00:00+09", mode: "online", organizer_name: "시험용 주최", sponsored: false, sponsor_name: null, speaker_disclosure: "시험용 이해관계 없음", status: "published", verified_on: "2026-10-20", verified_ref: "시험용 공지", ...patch };
  return attempt(
    `insert into public.seminars (slug, title, topic, starts_at, ends_at, mode, organizer_name, sponsored, sponsor_name, speaker_disclosure, status, verified_on, verified_ref)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [s.slug, s.title, s.topic, s.starts_at, s.ends_at, s.mode, s.organizer_name, s.sponsored, s.sponsor_name, s.speaker_disclosure, s.status, s.verified_on, s.verified_ref],
  );
};
const quote = (patch = {}) => {
  const q = { org_name: "시험용 시청", org_type: "public", contact_name: "시험용 담당", email: "tester@example.test", phone: null, course_id: null, course_text: "시험용 맞춤 과정", headcount: 20, message: null, consent_version: "시험용-v1", created_at: "2026-03-01T12:00:00+09", ...patch };
  return attempt(
    `insert into public.training_quotes (org_name, org_type, contact_name, email, phone, course_id, course_text, headcount, message, consent_version, consented_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) returning id, receipt_no, status, purge_at::text as purge_at`,
    [q.org_name, q.org_type, q.contact_name, q.email, q.phone, q.course_id, q.course_text, q.headcount, q.message, q.consent_version, q.created_at],
  );
};
const eduLink = async (key, url = "https://edu.example.test/apply", kind = "edu_site") =>
  (await client.query("insert into public.official_links (kind, key, label, url) values ($1, $2, '시험용 교육원', $3) returning id", [kind, key, url])).rows[0].id;

test("씨앗 - 정책 미승인 · 기능 키 꺼짐 · 수강 등록·수료증 표 없음 · 견적 표에 결제 칸 0", async () =>
  tx(async () => {
    const p = (await client.query("select value from public.settings where key = 'training_quote_policy'")).rows[0].value;
    assert.equal(p.approved, false);
    assert.equal(p.retention_days, 365);
    assert.deepEqual(p.consent_items, []);
    const f = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
    assert.deepEqual([f.edu, f.education_billing, f.seminars], [false, false, false]);
    const tables = (await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_name in ('course_enrollments','certificates')")).rows;
    assert.deepEqual(tables, []);
    for (const t of ["courses", "course_sessions", "seminars", "training_quotes"]) {
      const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [t])).rows.map((r) => r.column_name);
      assert.ok(cols.length > 5, t);
      assert.deepEqual(cols.filter((c) => /(pay|card|amount|price|fee|cost|order|capacity|seat)/i.test(c)), [], t);
    }
  }));

test("정책 - 범위 밖 값과 승인 조건 거부, 올바른 승인은 저장", async () =>
  tx(async () => {
    for (const [name, patch] of [
      ["보관 29일", { retention_days: 29 }],
      ["보관 1826일", { retention_days: 1826 }],
      ["영업일 0", { target_business_days: 0 }],
      ["글자 수 99", { message_max_chars: 99 }],
      ["동의 항목 7개", { consent_items: Array(7).fill("시험용") }],
      ["승인인데 법률 검토 기록 없음", { legal_review_ref: "" }],
      ["승인인데 동의 항목 없음", { consent_items: [] }],
      ["승인인데 검토일 모양 틀림", { reviewed_on: "2026/10/25" }],
    ]) {
      const r = await setPolicy(patch);
      assert.equal(r.ok, false, name);
      assert.equal(r.code, "23514", name);
    }
    assert.equal((await setPolicy({ retention_days: 30 })).ok, true);
    assert.equal((await setPolicy({ retention_days: 1825, approved: false, consent_version: "", intro: [], consent_items: [], legal_review_ref: "" })).ok, true);
  }));

test("기능 키 - education_billing은 edu와 승인된 정책이 있어야, seminars는 edu가 있어야 켜짐", async () =>
  tx(async () => {
    assert.equal((await flags({ education_billing: true })).ok, false, "edu 없이 거부");
    assert.equal((await flags({ edu: true, education_billing: true })).ok, false, "정책 미승인 거부");
    assert.equal((await flags({ seminars: true })).ok, false, "edu 없이 세미나 거부");
    assert.equal((await flags({ edu: true, seminars: true })).ok, true);
    assert.ok((await setPolicy({})).ok);
    assert.equal((await flags({ edu: true, seminars: true, education_billing: true })).ok, true);
  }));

test("강좌 - 게시는 출처·확인일 필수, 예약 이름 slug 거부, 신청 링크는 edu_site만", async () =>
  tx(async () => {
    assert.equal((await course({ verified_on: null })).ok, false);
    assert.equal((await course({ verified_ref: "  " })).ok, false);
    assert.equal((await course({ status: "draft", verified_on: null, verified_ref: null })).ok, true, "초안은 확인일 없이도 저장");
    for (const slug of ["quote", "seminars", "Bad Slug"]) assert.equal((await course({ slug })).ok, false, slug);
    const smLink = await eduLink(lkey(), "https://sm.example.test", "sm_calculator");
    assert.equal((await course({ apply_link_id: smLink })).ok, false, "edu_site 아닌 링크 거부");
    const edu = await eduLink(lkey());
    assert.equal((await course({ apply_link_id: edu })).ok, true);
  }));

test("회차 - 끝 날짜가 시작보다 빠르면 거부, 출처·확인일 없는 일정 거부, 시작과 같은 날은 허용", async () =>
  tx(async () => {
    const id = (await course()).rows[0].id;
    const ins = (starts, ends, ref = "시험용 공지") =>
      attempt("insert into public.course_sessions (course_id, starts_on, ends_on, mode, verified_on, verified_ref) values ($1,$2,$3,'onsite','2026-10-20',$4) returning id", [id, starts, ends, ref]);
    assert.equal((await ins("2026-12-02", "2026-12-01")).ok, false);
    assert.equal((await ins("2026-12-01", "2026-12-01")).ok, true);
    assert.equal((await ins("2026-12-05", null, "")).ok, false);
  }));

test("세미나 - 게시는 연사 이해관계 공개 필수, 협찬이면 협찬자 표기 필수, 끝이 시작보다 빠르면 거부", async () =>
  tx(async () => {
    assert.equal((await seminar({ speaker_disclosure: "  " })).ok, false);
    assert.equal((await seminar({ sponsored: true, sponsor_name: null })).ok, false);
    assert.equal((await seminar({ sponsored: true, sponsor_name: "시험용 협찬사" })).ok, true);
    assert.equal((await seminar({ ends_at: "2026-11-10T09:59:59+09" })).ok, false);
    assert.equal((await seminar({ status: "draft", speaker_disclosure: "", verified_on: null, verified_ref: null })).ok, true);
    assert.equal((await seminar({ topic: "tax" })).ok, false);
  }));

test("견적 - 정책 승인 전 저장 거부, 승인 뒤 저장되고 접수 번호·마지막 보관일·상태가 서버에서 정해진다", async () =>
  tx(async () => {
    assert.equal((await quote()).ok, false, "승인 전 거부");
    assert.ok((await setPolicy({ retention_days: 30 })).ok);
    // 종결 상태·사유를 실어 넣어도 접수 상태로 시작한다
    const r = await attempt(
      `insert into public.training_quotes (org_name, org_type, contact_name, email, course_text, headcount, consent_version, consented_at, created_at, status, close_reason)
       values ('시험용 시청','public','시험용 담당','tester@example.test','시험용 과정',20,'시험용-v1','2026-03-01T12:00:00+09','2026-03-01T12:00:00+09','closed','quoted')
       returning receipt_no, status, close_reason, purge_at::text as purge_at`,
    );
    assert.equal(r.ok, true, r.message);
    assert.equal(r.rows[0].close_reason, null);
    assert.match(r.rows[0].receipt_no, /^TQ-[0-9A-F]{8}$/);
    assert.equal(r.rows[0].status, "received");
    assert.equal(r.rows[0].purge_at, "2026-03-31", "2026-03-01 + 30일");
  }));

test("견적 - 동의 버전 불일치·긴 숫자·연락처 없음·잘못된 이메일·인원 0·과정 없음·미게시 과정 거부", async () =>
  tx(async () => {
    assert.ok((await setPolicy({ message_max_chars: 100 })).ok);
    assert.equal((await quote({ consent_version: "옛-v0" })).ok, false);
    assert.equal((await quote({ message: "계좌 110-123-456-789" })).ok, false);
    assert.equal((await quote({ course_text: "과정 1234567890" })).ok, false);
    assert.equal((await quote({ email: null, phone: null })).ok, false);
    assert.equal((await quote({ email: "not-an-email" })).ok, false);
    assert.equal((await quote({ phone: "010-12" , email: null})).ok, false);
    assert.equal((await quote({ headcount: 0 })).ok, false);
    assert.equal((await quote({ course_text: null, course_id: null })).ok, false);
    assert.equal((await quote({ message: "가".repeat(101) })).ok, false);
    assert.equal((await quote({ message: "가".repeat(100) })).ok, true, "정확히 상한은 허용");
    const draft = (await course({ status: "draft", verified_on: null, verified_ref: null })).rows[0].id;
    assert.equal((await quote({ course_id: draft, course_text: null })).ok, false, "미게시 과정 거부");
    const pub = (await course()).rows[0].id;
    assert.equal((await quote({ course_id: pub, course_text: null })).ok, true);
  }));

test("견적 - 접수 뒤 기관명·연락처·동의 기록은 고칠 수 없고, 상태는 앞으로만, 종결에는 사유가 필요", async () =>
  tx(async () => {
    assert.ok((await setPolicy({})).ok);
    const id = (await quote()).rows[0].id;
    assert.equal((await attempt("update public.training_quotes set org_name = '바꿈' where id = $1", [id])).ok, false);
    assert.equal((await attempt("update public.training_quotes set email = 'other@example.test' where id = $1", [id])).ok, false);
    assert.equal((await attempt("update public.training_quotes set consent_version = 'x' where id = $1", [id])).ok, false);
    assert.equal((await attempt("update public.training_quotes set headcount = 99 where id = $1", [id])).ok, false);
    assert.equal((await attempt("update public.training_quotes set status = 'closed' where id = $1", [id])).ok, false, "사유 없는 종결");
    assert.equal((await attempt("update public.training_quotes set status = 'contacted' where id = $1", [id])).ok, true);
    assert.equal((await attempt("update public.training_quotes set status = 'closed', close_reason = 'quoted' where id = $1", [id])).ok, true);
    assert.equal((await attempt("update public.training_quotes set status = 'received', close_reason = null where id = $1", [id])).ok, false, "되돌리기 거부");
    assert.equal((await attempt("update public.training_quotes set close_reason = 'declined' where id = $1", [id])).ok, false, "종결 사유 변경 거부");
  }));

test("파기 - 마지막 보관일 당일은 보존, 다음 날 파기, 두 번 불러도 같음, 통계 칸은 남음", async () =>
  tx(async () => {
    assert.ok((await setPolicy({ retention_days: 30 })).ok);
    const id = (await quote({ message: "시험용 내용", phone: "010-1234-5678" })).rows[0].id; // 마지막 보관일 2026-03-31
    const purge = async (at) => Number((await client.query("select public.training_quotes_purge($1::timestamptz) as n", [at])).rows[0].n);
    assert.equal(await purge("2026-03-31T23:59:59+09"), 0, "마지막 보관일 당일 보존");
    const kept = (await client.query("select org_name, purged_at from public.training_quotes where id = $1", [id])).rows[0];
    assert.equal(kept.org_name, "시험용 시청");
    assert.equal(kept.purged_at, null);
    assert.equal(await purge("2026-04-01T00:00:00+09"), 1, "다음 날 파기");
    assert.equal(await purge("2026-04-01T00:00:01+09"), 0, "멱등");
    const gone = (await client.query("select org_name, contact_name, phone, email, message, org_type, headcount, status, purged_at from public.training_quotes where id = $1", [id])).rows[0];
    assert.deepEqual([gone.org_name, gone.contact_name, gone.phone, gone.email, gone.message], [null, null, null, null, null]);
    assert.deepEqual([gone.org_type, gone.headcount, gone.status], ["public", 20, "received"]);
    assert.notEqual(gone.purged_at, null);
    assert.equal((await attempt("update public.training_quotes set purged_at = null where id = $1", [id])).ok, false, "되살리기 거부");
  }));

test("철회 - 접수 번호와 맞는 이메일·전화만 즉시 파기하고 종결(이용자 철회), 틀리면 false", async () =>
  tx(async () => {
    assert.ok((await setPolicy({})).ok);
    const q = (await quote({ phone: "010-1234-5678" })).rows[0];
    const withdraw = async (receipt, contact) => (await client.query("select public.training_quote_withdraw($1, $2) as ok", [receipt, contact])).rows[0].ok;
    assert.equal(await withdraw(q.receipt_no, "wrong@example.test"), false);
    assert.equal(await withdraw("TQ-00000000", "tester@example.test"), false);
    assert.equal(await withdraw(q.receipt_no.toLowerCase(), "TESTER@example.test"), true, "접수 번호 대소문자·이메일 대소문자 무시");
    const row = (await client.query("select org_name, email, status, close_reason, purged_at from public.training_quotes where id = $1", [q.id])).rows[0];
    assert.deepEqual([row.org_name, row.email, row.status, row.close_reason], [null, null, "closed", "withdrawn"]);
    assert.notEqual(row.purged_at, null);
    assert.equal(await withdraw(q.receipt_no, "tester@example.test"), false, "이미 파기된 요청은 false");
    const q2 = (await quote({ email: null, phone: "010-1234-5678" })).rows[0];
    assert.equal(await withdraw(q2.receipt_no, "01012345678"), true, "전화는 숫자만 비교");
  }));

test("공개 뷰 - 기능 키·게시 상태·정책 승인에 따라 열리고 닫히며 신청 주소는 점검 대상 링크에서 온다", async () =>
  tx(async () => {
    const link = await eduLink(lkey(), "https://edu.example.test/apply");
    const pub = (await course({ apply_link_id: link })).rows[0].id;
    const draft = (await course({ status: "draft", verified_on: null, verified_ref: null })).rows[0].id;
    await client.query("insert into public.course_sessions (course_id, starts_on, mode, verified_on, verified_ref) values ($1, '2026-12-01', 'online', '2026-10-20', '시험용 공지')", [pub]);
    const sem = (await seminar()).rows[0].id;
    const semDraft = (await seminar({ status: "draft", speaker_disclosure: "", verified_on: null, verified_ref: null })).rows[0].id;
    const ids = async (view, col = "id") => (await client.query(`select ${col} from public.${view}`)).rows.map((r) => String(r[col]));

    assert.ok(!(await ids("public_courses")).includes(String(pub)), "edu 꺼짐");
    assert.deepEqual(await ids("public_seminars"), []);
    assert.deepEqual(await ids("public_training_quote_notice", "consent_version"), []);
    assert.deepEqual(await ids("public_quote_course_options"), []);

    assert.ok((await flags({ edu: true })).ok);
    const courses = await ids("public_courses");
    assert.ok(courses.includes(String(pub)) && !courses.includes(String(draft)), "게시된 강좌만");
    const row = (await client.query("select apply_url, apply_status from public.public_courses where id = $1", [pub])).rows[0];
    assert.deepEqual([row.apply_url, row.apply_status], ["https://edu.example.test/apply", "unchecked"]);
    assert.equal((await client.query("select count(*)::int as n from public.public_course_sessions where course_id = $1", [pub])).rows[0].n, 1);
    assert.deepEqual(await ids("public_seminars"), [], "seminars 꺼짐");

    assert.ok((await flags({ seminars: true })).ok);
    const sems = await ids("public_seminars");
    assert.ok(sems.includes(String(sem)) && !sems.includes(String(semDraft)));

    await client.query("update public.official_links set active = false where id = $1", [link]);
    assert.equal((await client.query("select apply_url from public.public_courses where id = $1", [pub])).rows[0].apply_url, null, "비활성 링크는 주소 없음");

    assert.deepEqual(await ids("public_training_quote_notice", "consent_version"), [], "education_billing 꺼짐");
    await openAll();
    assert.deepEqual(await ids("public_training_quote_notice", "consent_version"), ["시험용-v1"]);
    assert.ok((await ids("public_quote_course_options")).includes(String(pub)));
    assert.ok(!(await ids("public_quote_course_options")).includes(String(draft)));
  }));

test("권한 - anon·authenticated는 견적·강좌 표를 읽지 못하고 공개 뷰만 읽으며, service_role도 견적을 지우지 못한다", async () =>
  tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const t of ["training_quotes", "courses", "course_sessions", "seminars"]) {
        const r = await attempt(`select 1 from public.${t} limit 1`, [], role);
        assert.equal(r.ok, false, `${role} ${t}`);
        assert.equal(r.code, "42501", `${role} ${t}`);
      }
      assert.equal((await attempt("select 1 from public.public_courses limit 1", [], role)).ok, true);
      assert.equal((await attempt("select 1 from public.public_training_quote_notice limit 1", [], role)).ok, true);
    }
    assert.ok((await setPolicy({})).ok);
    const id = (await quote()).rows[0].id;
    const del = await attempt("delete from public.training_quotes where id = $1", [id], "service_role");
    assert.equal(del.ok, false);
    assert.equal(del.code, "42501");
    for (const fn of ["training_quotes_purge(timestamptz)", "training_quote_withdraw(text,text)"]) {
      const r = await attempt(`select has_function_privilege('anon', 'public.${fn}', 'execute') as a, has_function_privilege('service_role', 'public.${fn}', 'execute') as s`);
      assert.deepEqual([r.rows[0].a, r.rows[0].s], [false, true], fn);
    }
  }));
