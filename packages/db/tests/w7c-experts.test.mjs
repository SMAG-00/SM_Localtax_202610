// W7c DB — SM 전문가 소개 · 연락 요청 (docs/dev/W7c_설계.md 1장 1·2단계 · 2장, 마이그레이션 20261024000065 · 66 · PRD-01C EXPL-01·02·04·05·07·08·13·15·17~21)
//  · 씨앗 — 분류 5개(세무사·공인회계사·변호사·공인중개사·법무사 순서), 프로필·요청 0행, 기능 키 expert_requests 꺼짐, 고지문·연락 정책 미승인
//  · 켜기 — 고지문 승인 없이 experts 거부, 정책 승인 없이 expert_requests 거부
//  · 프로필 — 소속 형태 2값만, 분류 0개·없는 분류·겹침 거부, 쓰면 안 되는 표현·연락 링크 규칙·권리 미확인 사진 거부, 동의서 기록 없는 공개 거부
//  · 여러 분류 — 한 프로필이 두 분류에 함께 나오고, 분류가 닫히면 그 분류에서만 빠진다
//  · 노출 0 — 초안·내림·철회·기능 키 꺼짐·고지문 미승인은 공개 뷰 0행, 1명뿐인 분류도 노출, 0명 분류는 없음
//  · 자격 검증·등록번호·재검증 기록 칸이 없다(PO 결정 2026-10-24)
//  · 요청 — 동의·내용 확인·연락처·긴 숫자 우회 10종·소개 중인 전문가 없는 분류·요약 상한 거부, 상태 역행 거부, 보관 경계, 철회
//  · 권한 — anon은 표·함수 접근 0, 공개 뷰는 요청 표를 참조하지 않음
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

async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}
async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
async function asAnon(sql, params = []) {
  await client.query("set local role anon");
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.query("reset role");
  }
}
const setSetting = (key, value) => client.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
async function flags(patch) {
  const cur = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  return attempt("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
const NOTICE = { version: "n-test-1", text: "시험용 고지문입니다 (실제 문구 아님).", approved: true, reviewed_by: "시험 검토자", reviewed_on: "2026-10-24" };
const POLICY = {
  retention_days: 365,
  target_business_days: 1,
  summary_max_chars: 200,
  consent_version: "c-test-1",
  intro: ["시험용 안내 문단입니다."],
  consent_items: ["시험용 동의 항목입니다."],
  approved: true,
  reviewed_by: "시험 검토자",
  reviewed_on: "2026-10-24",
  due_diligence_ref: "DD-TEST",
  legal_review_ref: "LR-TEST",
};
async function openAll() {
  await setSetting("expert_notice", NOTICE);
  await setSetting("expert_request_policy", POLICY);
  const r = await flags({ experts: true, expert_requests: true });
  assert.ok(r.ok, r.message);
}
let n = 0;
async function profile(over = {}) {
  n += 1;
  const p = { slug: `zz-person-${n}`, name: `가상 시험인${n}`, category_codes: ["tax-accountant"], office_name: "시험 사무소", house_relation: "employed", ...over };
  const cols = Object.keys(p);
  const res = await attempt(
    `insert into public.expert_profiles (${cols.join(", ")}, edited_by) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}, 'tester') returning id`,
    cols.map((c) => p[c]),
  );
  assert.ok(res.ok, res.message);
  return res.rows[0].id;
}
const PUBLISH = "status = 'published', consent_version = 'cv-1', consent_on = current_date - 1, consent_doc_ref = '시험 보관함 A-1', published_by = 'tester'";
const publish = (id) => attempt(`update public.expert_profiles set ${PUBLISH} where id = $1`, [id]);
const publicSlugs = async () => (await asAnon("select slug from public.public_expert_profiles order by slug")).map((r) => r.slug);

async function request(over = {}) {
  const p = {
    source: "experts",
    category_code: "tax-accountant",
    summary: "시험용 요약입니다.",
    summary_confirmed: true,
    name: "가상 요청인",
    phone: null,
    email: "requester@example.test",
    preferred_time: "평일 오후",
    consent_version: POLICY.consent_version,
    consented_at: new Date().toISOString(),
    due_at: new Date(Date.now() + 86400000).toISOString(),
    ...over,
  };
  const cols = Object.keys(p);
  return attempt(`insert into public.expert_requests (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id, receipt_no, status`, cols.map((c) => p[c]));
}
/** 요청 양식이 열린 상태 + 세무사 분류에 공개 프로필 1명 */
async function openWithExpert() {
  await openAll();
  const id = await profile();
  assert.ok((await publish(id)).ok);
  return id;
}

test("씨앗 — 분류 5개가 PO 순서대로, 프로필·요청 0행, 기능 키 expert_requests 꺼짐, 고지문·정책 미승인", async () => {
  const cats = (await client.query("select code, name from public.expert_categories order by sort_order")).rows;
  assert.deepEqual(cats.map((c) => c.name), ["세무사", "공인회계사", "변호사", "공인중개사", "법무사"]);
  for (const t of ["expert_profiles", "expert_requests", "expert_request_events", "expert_profile_events"]) {
    assert.equal(Number((await client.query(`select count(*) from public.${t}`)).rows[0].count), 0, t);
  }
  const f = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  assert.equal(f.expert_requests, false);
  assert.equal(f.experts, false);
  assert.equal((await client.query("select value from public.settings where key = 'expert_notice'")).rows[0].value.approved, false);
  assert.equal((await client.query("select value from public.settings where key = 'expert_request_policy'")).rows[0].value.approved, false);
  assert.deepEqual(await asAnon("select * from public.public_expert_categories"), [], "공개 프로필 0명 -> 공개 분류 0");
});

test("켜기 — 고지문 승인 없이 experts 거부, 정책 승인 없이 expert_requests 거부, experts 없이 expert_requests 거부", async () => {
  await tx(async () => {
    const a = await flags({ experts: true });
    assert.equal(a.ok, false);
    assert.match(a.message, /expert_notice/);
    await setSetting("expert_notice", NOTICE);
    assert.ok((await flags({ experts: true })).ok);
    const b = await flags({ expert_requests: true });
    assert.equal(b.ok, false);
    assert.match(b.message, /expert_request_policy/);
    await setSetting("expert_request_policy", POLICY);
    assert.ok((await flags({ expert_requests: true })).ok);
    assert.ok((await flags({ experts: false, expert_requests: false })).ok);
    const c = await flags({ experts: false, expert_requests: true });
    assert.equal(c.ok, false);
    assert.match(c.message, /experts/);
  });
});

test("고지문 승인에는 버전·문구·검토자·검토일이 모두 필요하다 / 정책 승인에는 실사·감수 기록 번호가 필요하다", async () => {
  await tx(async () => {
    for (const bad of [{ ...NOTICE, version: "" }, { ...NOTICE, text: " " }, { ...NOTICE, reviewed_by: null }, { ...NOTICE, reviewed_on: "어제" }]) {
      assert.equal((await attempt("update public.settings set value = $1::jsonb where key = 'expert_notice'", [JSON.stringify(bad)])).ok, false, JSON.stringify(bad));
    }
    for (const bad of [{ ...POLICY, due_diligence_ref: "" }, { ...POLICY, legal_review_ref: "" }, { ...POLICY, consent_items: [] }, { ...POLICY, retention_days: 10 }, { ...POLICY, extra: 1 }]) {
      assert.equal((await attempt("update public.settings set value = $1::jsonb where key = 'expert_request_policy'", [JSON.stringify(bad)])).ok, false, JSON.stringify(bad));
    }
  });
});

test("프로필 저장 규칙 — 소속 형태 2값만·분류 0개/없는 분류/겹침·쓰면 안 되는 표현·연락 링크·동의서 없는 공개 거부", async () => {
  await tx(async () => {
    const ins = (extra, vals = []) =>
      attempt(`insert into public.expert_profiles (slug, name, category_codes, office_name, house_relation, edited_by ${extra.cols}) values ('zz-r${++n}', '가', ${extra.cat ?? "array['tax-accountant']"}, '사무소', ${extra.rel ?? "'employed'"}, 't' ${extra.vals ?? ""})`, vals);
    assert.equal((await ins({ rel: "'external_partner'" })).ok, false, "외부 제휴");
    assert.equal((await ins({ cat: "array[]::text[]" })).ok, false, "분류 0개");
    assert.equal((await ins({ cat: "array['no-such']" })).ok, false, "없는 분류");
    assert.equal((await ins({ cat: "array['cpa','cpa']" })).ok, false, "분류 겹침");
    const banned = await ins({ cols: ", interests", vals: ", '업계 1위 사무소'" });
    assert.equal(banned.ok, false);
    assert.match(banned.message, /1위/);
    assert.equal((await ins({ cols: ", intro", vals: ", '승 소 보 장'" })).ok, false, "공백을 섞은 우회");
    assert.equal((await ins({ cols: ", specialties", vals: ", array['무조건 승소']" })).ok, false, "전문 분야 문구도 검사");
    assert.equal((await ins({ cols: ", contact_links", vals: `, '[{"label":"홈","url":"https://office.example.test/?uid=1"}]'::jsonb` })).ok, false, "연락 링크 쿼리");
    assert.ok((await ins({ cols: ", contact_links", vals: `, '[{"label":"홈","url":"https://office.example.test/"}]'::jsonb` })).ok);
    assert.equal((await ins({ cols: ", status", vals: ", 'published'" })).ok, false, "동의서 기록 없는 공개");
    const id = await profile();
    assert.equal((await attempt("update public.expert_profiles set status = 'published', consent_version = 'v', consent_on = current_date, published_by = 't' where id = $1", [id])).ok, false, "보관 위치 없음");
    assert.equal((await attempt("update public.expert_profiles set status = 'published', consent_version = 'v', consent_on = current_date, consent_doc_ref = 'r' where id = $1", [id])).ok, false, "공개한 관리자 없음");
    assert.ok((await publish(id)).ok);
  });
});

test("프로필 사진 — 권리가 확인되지 않은 이미지는 거부, 확인된 사진은 공개 뷰에 경로가 나오고 권리가 취소되면 사진만 빠진다", async () => {
  await tx(async () => {
    await openAll();
    const m = (await client.query("insert into public.media (path, kind) values ('zz/photo.jpg', 'photo') returning id")).rows[0].id;
    assert.equal((await attempt("insert into public.expert_profiles (slug, name, category_codes, office_name, house_relation, photo_media_id, edited_by) values ('zz-ph', '가', array['cpa'], '사무소', 'employed', $1, 't')", [m])).ok, false);
    await client.query("update public.media set credit = '시험', license = '시험 이용 조건', checked_at = now(), photographer = '시험 촬영자', license_type = 'not_applicable', rights_status = 'confirmed' where id = $1", [m]);
    const id = await profile({ photo_media_id: m });
    assert.ok((await publish(id)).ok);
    assert.deepEqual((await asAnon("select photo_path from public.public_expert_profiles")).map((r) => r.photo_path), ["zz/photo.jpg"]);
    await client.query("update public.media set rights_status = 'rejected' where id = $1", [m]);
    assert.deepEqual((await asAnon("select photo_path from public.public_expert_profiles")).map((r) => r.photo_path), [null]);
  });
});

test("여러 분류 — 한 프로필이 세무사·공인회계사 두 분류에 함께 나오고, 한 분류가 닫히면 그 분류에서만 빠진다", async () => {
  await tx(async () => {
    await openAll();
    const id = await profile({ category_codes: ["tax-accountant", "cpa"] });
    assert.ok((await publish(id)).ok);
    const cats = await asAnon("select code, profile_count from public.public_expert_categories order by sort_order");
    assert.deepEqual(cats.map((c) => [c.code, c.profile_count]), [["tax-accountant", 1], ["cpa", 1]]);
    const row = (await asAnon("select category_codes, category_names from public.public_expert_profiles"))[0];
    assert.deepEqual(row.category_codes, ["tax-accountant", "cpa"]);
    assert.deepEqual(row.category_names, ["세무사", "공인회계사"]);
    assert.equal((await asAnon("select count(*)::int n from public.public_expert_profiles where 'cpa' = any (category_codes)"))[0].n, 1);
    await client.query("update public.expert_categories set active = false where code = 'cpa'");
    assert.deepEqual((await asAnon("select code from public.public_expert_categories")).map((c) => c.code), ["tax-accountant"]);
    assert.deepEqual((await asAnon("select category_codes from public.public_expert_profiles"))[0].category_codes, ["tax-accountant"], "닫힌 분류는 프로필 줄에서도 빠짐");
    await client.query("update public.expert_categories set active = false where code = 'tax-accountant'");
    assert.deepEqual(await publicSlugs(), [], "열린 분류가 하나도 없으면 프로필 0");
    // 닫힌 분류는 새로 더할 수 없다
    assert.equal((await attempt("update public.expert_profiles set category_codes = array['tax-accountant','cpa','lawyer'] where id = $1", [id])).ok, true, "이미 있던 분류는 그대로 유지 가능 + 열린 분류 추가");
    assert.equal((await attempt("insert into public.expert_profiles (slug, name, category_codes, office_name, house_relation, edited_by) values ('zz-cl', '가', array['cpa'], '사무소', 'employed', 't')")).ok, false, "닫힌 분류에 새 프로필");
  });
});

test("노출 0 — 초안·내림·철회·기능 키 꺼짐·고지문 미승인은 공개 뷰 0행, 1명뿐인 분류도 보임, 0명 분류는 없음", async () => {
  await tx(async () => {
    const id = await profile({ category_codes: ["lawyer"] });
    await profile({ category_codes: ["realtor"] }); // 초안 - 0명 분류
    assert.ok((await publish(id)).ok);
    assert.deepEqual(await publicSlugs(), [], "기능 키 꺼짐");
    await setSetting("expert_notice", NOTICE);
    assert.ok((await flags({ experts: true })).ok);
    assert.equal((await publicSlugs()).length, 1);
    assert.deepEqual((await asAnon("select code, profile_count from public.public_expert_categories")).map((c) => [c.code, c.profile_count]), [["lawyer", 1]]);
    assert.deepEqual(await asAnon("select version from public.public_expert_notice"), [{ version: "n-test-1" }]);
    await setSetting("expert_notice", { ...NOTICE, approved: false });
    assert.deepEqual(await publicSlugs(), [], "고지문 승인 취소 -> 0");
    assert.deepEqual(await asAnon("select * from public.public_expert_notice"), []);
    await setSetting("expert_notice", NOTICE);
    assert.equal((await publicSlugs()).length, 1);
    await client.query("update public.expert_profiles set status = 'draft' where id = $1", [id]);
    assert.deepEqual(await publicSlugs(), [], "관리자가 내리면 다음 요청부터 0");
  });
});

test("철회 — 사유 없이 철회 불가, 철회하면 0행이고 되살릴 수 없다 / 상태 기록은 추가만", async () => {
  await tx(async () => {
    await openAll();
    const id = await profile();
    assert.ok((await publish(id)).ok);
    assert.equal((await attempt("update public.expert_profiles set status = 'withdrawn', withdrawn_at = now() where id = $1", [id])).ok, false, "사유 없는 철회");
    assert.ok((await attempt("update public.expert_profiles set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = '본인 철회 요청', edited_by = 'admin' where id = $1", [id])).ok);
    assert.deepEqual(await publicSlugs(), []);
    assert.equal((await attempt(`update public.expert_profiles set ${PUBLISH}, withdrawn_at = null where id = $1`, [id])).ok, false, "되살리기");
    const ev = (await client.query("select from_status, to_status from public.expert_profile_events where profile_id = $1 order by id", [id])).rows;
    assert.deepEqual(ev.map((e) => `${e.from_status ?? "-"}>${e.to_status}`), ["->draft", "draft>published", "published>withdrawn"]);
    assert.equal((await attempt("update public.expert_profile_events set note = 'x' where profile_id = $1", [id])).ok, false);
    assert.equal((await attempt("delete from public.expert_profile_events where profile_id = $1", [id])).ok, false);
  });
});

test("스키마 — 자격 검증·등록번호·재검증·결제·별점·순위 칸 없음, 공개 뷰는 요청 표를 참조하지 않고 anon은 표를 읽지 못한다", async () => {
  const cols = (await client.query(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('expert_categories','expert_profiles','expert_requests','expert_request_events','expert_profile_events')",
  )).rows;
  const bad = cols.filter((c) => /pay|price|amount|\bfee|rating|review|rank|score|stars|views|clicks|billing|invoice|fare|order_id|license|verif|regist/i.test(c.column_name));
  assert.deepEqual(bad, []);
  const gone = (await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_name in ('expert_licenses', 'expert_duty_roster', 'expert_reports')")).rows;
  assert.deepEqual(gone, [], "자격·당번표·신고 표는 만들지 않았다 (PO 결정 / MVP 이후)");
  for (const v of ["public_expert_profiles", "public_expert_categories", "public_expert_notice", "public_expert_request_options"]) {
    const def = (await client.query("select pg_get_viewdef(($1)::regclass) as d", [`public.${v}`])).rows[0].d;
    assert.ok(!/(from|join)\s+(public\.)?(expert_requests|expert_request_events)\b/i.test(def), v);
    assert.ok(!/\b(email|phone|summary)\b/.test(def), v);
  }
  await tx(async () => {
    for (const t of ["expert_profiles", "expert_categories", "expert_requests", "expert_request_events", "expert_profile_events"]) {
      for (const role of ["anon", "authenticated"]) {
        await client.query(`set local role ${role}`);
        const r = await attempt(`select * from public.${t}`);
        await client.query("reset role");
        assert.equal(r.ok, false, `${role} ${t}`);
      }
    }
    for (const fn of ["expert_requests_purge(timestamptz)", "expert_request_withdraw(text,text)", "expert_text_problem(text)", "expert_sensitive(text)"]) {
      const row = (await client.query("select has_function_privilege('anon', $1, 'execute') as a, has_function_privilege('authenticated', $1, 'execute') as b, has_function_privilege('service_role', $1, 'execute') as c", [`public.${fn}`])).rows[0];
      assert.deepEqual(row, { a: false, b: false, c: true }, fn);
    }
  });
});

test("요청 저장 규칙 — 동의 버전·내용 확인·연락처·소개 중인 전문가 없는 분류·요약 상한·긴 숫자 우회 10종 거부, 정상 요청은 접수 번호·보관 기한을 받는다", async () => {
  await tx(async () => {
    assert.equal((await request()).ok, false, "정책 미승인 · 연락 요청 닫힘");
    await openWithExpert();
    const ok = await request();
    assert.ok(ok.ok, ok.message);
    assert.match(ok.rows[0].receipt_no, /^EX-[0-9A-F]{8}$/);
    assert.equal(ok.rows[0].status, "received");
    const kst = (await client.query("select ((now() at time zone 'Asia/Seoul')::date + 365)::text as d")).rows[0].d;
    assert.equal((await client.query("select retention_until::text as d from public.expert_requests where id = $1", [ok.rows[0].id])).rows[0].d, kst);
    assert.equal((await request({ summary_confirmed: false })).ok, false, "내용 확인 없음");
    assert.equal((await request({ consent_version: "c-old" })).ok, false, "옛 동의 버전");
    assert.equal((await request({ email: null, phone: null })).ok, false, "연락처 없음");
    assert.equal((await request({ email: "not-an-email" })).ok, false);
    assert.equal((await request({ email: null, phone: "12-34" })).ok, false);
    assert.ok((await request({ email: null, phone: "010-0000-0000" })).ok, "전화만");
    assert.equal((await request({ summary: "가".repeat(201) })).ok, false, "요약 상한");
    assert.equal((await request({ summary: " " })).ok, false);
    assert.equal((await request({ category_code: "lawyer" })).ok, false, "공개 중인 전문가가 없는 분류");
    const variants = ["900101-1234567", "900101 1234567", "9001011234567", "900101.1234567", "９００１０１－１２３４５６７", "900101 - 1 2 3 4 5 6 7", "계좌 110-123-456789", "1101234567890", "110_123_456789", "110/123/456789"];
    for (const v of variants) {
      const r = await request({ summary: `문의 ${v}` });
      assert.equal(r.ok, false, `요약에 ${v}`);
      assert.match(r.message, /긴 숫자/);
    }
    assert.equal((await request({ preferred_time: "900101-1234567" })).ok, false, "희망 시간 칸도 같은 검사");
    assert.ok((await request({ summary: "2026.10.24 오후 3시 문의, 서류 5건" })).ok, "날짜·건수는 통과");
  });
});

test("상태 — 거꾸로 가기 거부, 첫 연락은 수행 주체·안내 완료 필요, 종결은 사유 필요, 개인 칸·동의 기록 수정 거부, 이력 추가만", async () => {
  await tx(async () => {
    await openWithExpert();
    const id = (await request()).rows[0].id;
    assert.equal((await attempt("update public.expert_requests set status = 'contacted', updated_by = 't' where id = $1", [id])).ok, false, "안내 완료 체크 없음");
    assert.equal((await attempt("update public.expert_requests set status = 'contacted', scope_noted = true where id = $1", [id])).ok, false, "수행 주체 없음");
    assert.ok((await attempt("update public.expert_requests set status = 'contacted', scope_noted = true, performing_entity = '시험 수행 주체(가상)', updated_by = 'admin' where id = $1", [id])).ok);
    assert.ok((await client.query("select first_contact_at from public.expert_requests where id = $1", [id])).rows[0].first_contact_at);
    assert.equal((await attempt("update public.expert_requests set status = 'received' where id = $1", [id])).ok, false, "역행");
    assert.equal((await attempt("update public.expert_requests set status = 'closed' where id = $1", [id])).ok, false, "종결 사유 없음");
    assert.equal((await attempt("update public.expert_requests set name = '바꾼 이름' where id = $1", [id])).ok, false, "개인 칸 수정");
    assert.equal((await attempt("update public.expert_requests set consent_version = 'c-other' where id = $1", [id])).ok, false, "동의 기록 수정");
    assert.ok((await attempt("update public.expert_requests set status = 'closed', close_reason = 'guidance_end', updated_by = 'admin' where id = $1", [id])).ok);
    assert.equal((await attempt("update public.expert_requests set status = 'contacted' where id = $1", [id])).ok, false, "종결 뒤 역행");
    const ev = (await client.query("select from_status, to_status from public.expert_request_events where request_id = $1 order by id", [id])).rows;
    assert.deepEqual(ev.map((e) => `${e.from_status ?? "-"}>${e.to_status}`), ["->received", "received>contacted", "contacted>closed"]);
    assert.equal((await attempt("delete from public.expert_request_events where request_id = $1", [id])).ok, false);
  });
});

test("보관 기간 파기 — 기한 당일은 보존, 다음 날 개인 칸 파기·통계 칸 유지, 두 번 돌려도 같은 결과", async () => {
  await tx(async () => {
    await openWithExpert();
    const r = (await request()).rows[0];
    const until = (await client.query("select retention_until::text as d from public.expert_requests where id = $1", [r.id])).rows[0].d;
    const at = (day) => client.query("select public.expert_requests_purge(($1 || ' 12:00:00+09')::timestamptz) as n", [day]);
    assert.equal((await at(until)).rows[0].n, 0, "기한 당일 보존");
    assert.equal((await client.query("select name from public.expert_requests where id = $1", [r.id])).rows[0].name, "가상 요청인");
    const nextDay = (await client.query("select ($1::date + 1)::text as d", [until])).rows[0].d;
    assert.equal((await at(nextDay)).rows[0].n, 1, "다음 날 파기");
    assert.equal((await at(nextDay)).rows[0].n, 0, "멱등");
    const row = (await client.query("select name, phone, email, summary, preferred_time, purged_at, category_code, status from public.expert_requests where id = $1", [r.id])).rows[0];
    assert.deepEqual([row.name, row.phone, row.email, row.summary, row.preferred_time], [null, null, null, null, null]);
    assert.ok(row.purged_at);
    assert.equal(row.category_code, "tax-accountant");
    assert.equal(row.status, "received", "상태·분야 통계 칸은 남는다");
    assert.equal((await attempt("update public.expert_requests set purged_at = null where id = $1", [r.id])).ok, false, "되살리기");
  });
});

test("철회 — 접수 번호 + 맞는 이메일/전화로만, 즉시 파기하고 '이용자 철회'로 종결, 틀린 연락처·두 번째는 false", async () => {
  await tx(async () => {
    await openWithExpert();
    const byMail = (await request()).rows[0];
    const byPhone = (await request({ email: null, phone: "010-1111-2222", name: "가상 전화인" })).rows[0];
    const w = (rec, contact) => client.query("select public.expert_request_withdraw($1, $2) as ok", [rec, contact]).then((r) => r.rows[0].ok);
    assert.equal(await w(byMail.receipt_no, "other@example.test"), false);
    assert.equal(await w("EX-00000000", "requester@example.test"), false);
    assert.equal(await w(byMail.receipt_no.toLowerCase(), "REQUESTER@example.test"), true, "접수 번호·이메일은 대소문자 무시");
    assert.equal(await w(byMail.receipt_no, "requester@example.test"), false, "두 번째");
    assert.equal(await w(byPhone.receipt_no, "01011112222"), true, "전화는 숫자만 비교");
    const rows = (await client.query("select status, close_reason, name, email, phone, summary, purged_at from public.expert_requests order by id")).rows;
    for (const x of rows) {
      assert.equal(x.status, "closed");
      assert.equal(x.close_reason, "withdrawn");
      assert.deepEqual([x.name, x.email, x.phone, x.summary], [null, null, null, null]);
      assert.ok(x.purged_at);
    }
  });
});

test("양식 공개 뷰 — 연락 요청이 열려 있고 공개 중인 전문가가 있는 분류만 나온다", async () => {
  await tx(async () => {
    const id = await profile({ category_codes: ["tax-accountant", "cpa"] });
    assert.ok((await publish(id)).ok);
    assert.deepEqual(await asAnon("select code from public.public_expert_request_options"), [], "닫힘");
    await openAll();
    assert.deepEqual((await asAnon("select code from public.public_expert_request_options order by sort_order")).map((r) => r.code), ["tax-accountant", "cpa"]);
    const notice = await asAnon("select consent_version, intro, consent_items, retention_days, summary_max_chars from public.public_expert_request_notice");
    assert.deepEqual(notice, [{ consent_version: "c-test-1", intro: POLICY.intro, consent_items: POLICY.consent_items, retention_days: 365, summary_max_chars: 200 }]);
    await setSetting("expert_request_policy", { ...POLICY, approved: false });
    assert.deepEqual(await asAnon("select * from public.public_expert_request_notice"), []);
    assert.deepEqual(await asAnon("select * from public.public_expert_request_options"), []);
  });
});
