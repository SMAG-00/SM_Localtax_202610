// W2-e 5단계 — inquiries 칸 더하기 (docs/dev/W2-e_설계.md 2.1 · 2.2 · 3.5, HELP-01)
//  · 접수 번호 자동 생성·형식·unique · request_type은 correction에서만(그리고 필수) · 연락 이메일 필수 종류와 모양
//  · 본문에 이메일·9자리 이상 숫자 줄 거부 (설계 2.8 견본 중 저장되면 안 되는 꼴) · mail_status 값 · 길이 한도
//  · 정정 완료는 결과·사유 필수(W2-a 제약 그대로) · 설정 씨앗 help · 첨부 버킷 비공개 · anon·authenticated 접근 0
// 모든 시험은 트랜잭션 안에서 하고 되돌린다. 로컬 DB에서만 돈다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돈다");
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
const COLS = "kind, body, contact_email, request_type, privacy_version_id, title, mail_status";
async function privacyId() {
  const { rows } = await client.query(
    `insert into public.policy_versions (doc_key, version, status, body, approved_by, approved_on, approval_note, published_at, effective_on)
     values ('privacy', (select coalesce(max(version), 0) + 1 from public.policy_versions where doc_key = 'privacy'), 'published', '[]'::jsonb, '시험', current_date, '시험', now(), current_date) returning id`,
  ).catch(() => ({ rows: [] }));
  return rows[0]?.id ?? null;
}
const insert = (over = {}) => {
  const v = { kind: "tip", body: "시험 본문입니다 충분히 깁니다", contact_email: null, request_type: null, privacy_version_id: null, title: null, mail_status: "none", ...over };
  return attempt(`insert into public.inquiries (${COLS}) values ($1, $2, $3, $4, $5, $6, $7) returning ref_code`, [v.kind, v.body, v.contact_email, v.request_type, v.privacy_version_id, v.title, v.mail_status]);
};

test("접수 번호는 자동으로 생기고 혼동 글자 없는 8글자이며 행마다 다르다", () =>
  tx(async () => {
    const a = await insert();
    const b = await insert();
    assert.ok(a.ok && b.ok, a.message ?? b.message);
    for (const r of [a, b]) assert.match(r.rows[0].ref_code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.notEqual(a.rows[0].ref_code, b.rows[0].ref_code);
  }));

test("접수 번호 형식 위반(소문자·0·O·길이)과 중복은 거부", () =>
  tx(async () => {
    for (const bad of ["abcdefgh", "ABCDEFG0", "ABCDEFGO", "ABCDEFG", "ABCDEFGHJ"]) {
      const r = await attempt("insert into public.inquiries (kind, body, ref_code) values ('tip', '시험 본문', $1)", [bad]);
      assert.equal(r.code, "23514", `${bad}: ${r.message}`);
    }
    assert.ok((await attempt("insert into public.inquiries (kind, body, ref_code) values ('tip', '시험 본문', 'ABCDEFGH')")).ok);
    assert.equal((await attempt("insert into public.inquiries (kind, body, ref_code) values ('tip', '시험 본문', 'ABCDEFGH')")).code, "23505");
  }));

test("request_type은 정정·반론 종류에만 허용(공개 폼의 필수는 앱이 검사), 값은 correction·rebuttal", () =>
  tx(async () => {
    const pid = await privacyId();
    const base = { contact_email: "a@example.test", privacy_version_id: pid };
    assert.ok((await insert({ ...base, kind: "correction" })).ok, "편집국이 직접 넣는 정정 요청은 구분이 없어도 된다");
    assert.equal((await insert({ ...base, kind: "correction", request_type: "delete" })).code, "23514");
    assert.ok((await insert({ ...base, kind: "correction", request_type: "rebuttal" })).ok);
    assert.equal((await insert({ kind: "tip", request_type: "correction" })).code, "23514");
  }));

test("연락 이메일 — 구독·광고·독자 투고는 필수, 기사 제보는 선택, 모양이 틀리면 거부", () =>
  tx(async () => {
    const pid = await privacyId();
    for (const kind of ["subscription", "advertising", "reader_submission"]) {
      assert.equal((await insert({ kind })).code, "23514", `${kind} 이메일 없음`);
      assert.ok((await insert({ kind, contact_email: "a@example.test", privacy_version_id: pid })).ok, kind);
    }
    assert.ok((await insert({ kind: "tip" })).ok);
    for (const bad of ["x@y", "no-at.example.test", "a@@example.test", "a b@example.test"]) assert.equal((await insert({ contact_email: bad, privacy_version_id: pid })).code, "23514", bad);
  }));

test("연락 이메일이 있으면 처리방침 버전 번호가 있어야 한다", () =>
  tx(async () => {
    assert.equal((await insert({ contact_email: "a@example.test" })).code, "23514");
    assert.ok((await insert({ contact_email: "a@example.test", privacy_version_id: await privacyId() })).ok);
  }));

test("본문에 이메일 모양·9자리 이상 숫자 줄이 있으면 거부, 8자리 날짜와 법 조문은 통과", () =>
  tx(async () => {
    for (const bad of ["답장은 hong@example.com 으로 주세요", "제 번호는 010-1234-5678 입니다", "계좌 110-123-456789", "hong＠example.com 연락"]) assert.equal((await insert({ body: bad })).code, "23514", bad);
    for (const good of ["2026-10-19 기사 오류", "지방세법 제111조 관련", "답장은 [이메일] 으로 주세요"]) assert.ok((await insert({ body: good })).ok, good);
  }));

test("mail_status 값은 none·queued·sent·failed·skipped만", () =>
  tx(async () => {
    for (const s of ["none", "queued", "sent", "failed", "skipped"]) assert.ok((await insert({ mail_status: s })).ok, s);
    assert.equal((await insert({ mail_status: "ok" })).code, "23514");
  }));

test("제목은 100글자까지(101글자 거부), 빈 제목 거부", () =>
  tx(async () => {
    assert.ok((await insert({ title: "가".repeat(100) })).ok);
    assert.equal((await insert({ title: "가".repeat(101) })).code, "23514");
    assert.equal((await insert({ title: "   " })).code, "23514");
  }));

test("정정·반론은 처리 결과·사유 없이 완료로 바꿀 수 없다 (W2-a 제약이 그대로)", () =>
  tx(async () => {
    const pid = await privacyId();
    const { rows } = (await insert({ kind: "correction", request_type: "correction", contact_email: "a@example.test", privacy_version_id: pid })).ok
      ? await client.query("select id from public.inquiries order by id desc limit 1")
      : { rows: [] };
    const id = rows[0].id;
    assert.equal((await attempt("update public.inquiries set status = 'done' where id = $1", [id])).code, "23514");
    assert.equal((await attempt("update public.inquiries set status = 'done', resolution = 'dismissed', resolution_reason = '  ' where id = $1", [id])).code, "23514");
    assert.ok((await attempt("update public.inquiries set status = 'done', resolution = 'dismissed', resolution_reason = '사실 확인 결과 기각' where id = $1", [id])).ok);
  }));

test("설정 씨앗 help가 있고 첨부 상한·허용 확장자·최소 작성 시간이 설계 2.2 값이다", async () => {
  const { rows } = await client.query("select value from public.settings where key = 'help'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value.attachments.max_files, 3);
  assert.equal(rows[0].value.attachments.max_total_bytes, 4000000);
  assert.ok(!rows[0].value.attachments.allowed_extensions.includes("exe"));
});

test("첨부 버킷 inquiry-attachments는 비공개이고 anon·authenticated 정책이 없다", async () => {
  const b = await client.query("select public from storage.buckets where id = 'inquiry-attachments'");
  assert.equal(b.rows.length, 1);
  assert.equal(b.rows[0].public, false);
  const pol = await client.query("select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual ilike '%inquiry-attachments%' or with_check ilike '%inquiry-attachments%')");
  assert.equal(pol.rows.length, 0);
});

test("anon·authenticated는 inquiries를 읽거나 쓸 수 없다", () =>
  tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await attempt("select ref_code from public.inquiries", [], role)).code, "42501", role);
      assert.equal((await attempt("insert into public.inquiries (kind, body) values ('tip', '시험 본문')", [], role)).code, "42501", role);
    }
  }));
