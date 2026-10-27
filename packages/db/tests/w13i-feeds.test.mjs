// W13-i DB - 제휴 피드·라이선스 계약·네이버 연재 원고 (마이그레이션 226~228, PRD-05 PART-01 · BIZ-11 · CH-02)
//  · 키 - 해시만 저장(64자 hex), 계약 없는 발급 거부, 전문은 계약 허용 + 권리 근거, 폐기는 한 번만, 수정·삭제 거부
//  · 피드 - 틀린 해시·폐기·계약 종료 다음 날 401, 기능 키 꺼짐·한도 없음 503, 분당 한도 n번째 200 / n+1번째 429, 한도 창이 지나면 다시 200
//  · 내용 - 무료 공개 기사만(유료 기사·초안 0), 요약 범위는 본문 칸 없음, 전문은 4중 조건 (계약 플래그 ∧ 권리 근거 ∧ 이관 자료 아님 ∧ 키 범위 full)
//  · 연재 원고 - 기능 키·계약·프리미엄 칼럼 조건 거부, 게시 기록 조건
// 모든 시험은 거래 안에서 돌고 되돌린다. 계약·기사·제휴사는 모두 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { open, helpers } from "./_w10d_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const ACTOR = "admin:test@example.test";
const HASH = "a".repeat(64);
// 기사 발행 시각은 트리거가 지금으로 정하므로 기준 시각은 지금 + 1시간으로 잡는다
const NOW = new Date(Date.now() + 3600e3).toISOString();
const KST_DAY = new Date(Date.parse(NOW) + 9 * 3600e3).toISOString().slice(0, 10); // 기준 시각의 한국 날짜
const NEXT_DAY = new Date(Date.parse(KST_DAY) + 86400e3).toISOString().slice(0, 10);
const q = (sql, params) => client.query(sql, params);
async function tx(fn) {
  await q("begin");
  try {
    return await fn();
  } finally {
    await q("rollback");
  }
}
const setFlag = (k, on) => q("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ [k]: on })]);
const setRate = (v) => q("update public.settings set value = $1::jsonb where key = 'partner_feed_rate_limit'", [JSON.stringify(v)]);
const rpc = async (fn, sql, params) => (await q(`select public.${fn}(${sql}) r`, params)).rows[0].r;

async function partner() {
  return (await q("insert into public.partners (name, kind) values ('시험 제휴사', 'media') returning id")).rows[0].id;
}
async function contract(over = {}) {
  const o = { kind: "data_license", start: "2026-01-01", end: "2099-12-31", rights: "시험 권리 근거", full: false, ...over };
  const r = await rpc("license_contract_record", "$1, null, $2, '시험 범위', $3::date, $4::date, null, $5, $6, $7", ["시험 상대방", o.kind, o.start, o.end, o.rights, o.full, ACTOR]);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.id;
}
async function issue(p, c, scope = "summary", hash = HASH) {
  return rpc("partner_feed_issue", "$1, $2, $3, $4, $5, $6::timestamptz", [p, c, scope, hash, ACTOR, NOW]);
}
const serve = (id, hash = HASH, at = NOW, limit = 20) => rpc("partner_feed_serve", "$1, $2, $3, $4::timestamptz", [id, hash, limit, at]);
async function openFeed(over = {}) {
  await setFlag("partner_feeds", true);
  await setRate({ per_minute: over.perMinute ?? 3 });
  const p = await partner();
  const c = await contract(over.contract);
  const hash = over.hash ?? HASH;
  const r = await issue(p, c, over.scope ?? "summary", hash);
  assert.equal(r.ok, true, JSON.stringify(r));
  return { id: r.id, p, c, hash };
}
async function article(over = {}) {
  const person = (await q("insert into public.people (slug, name, roles, visibility) values ($1, '시험 기자', array['reporter'], 'public') returning id", [h.uniq("p")])).rows[0];
  const o = { paid: false, status: "published", summary: "시험 요약", legacy: null, ...over };
  const row = (
    await q(
      `insert into public.articles (slug, title, section, content_type, status, author_id, body, summary, is_paid, legacy_source, first_published_at)
       values ($1, $2, 'tax', 'explainer', $3, $4, $5, $6, $7, $8, $9) returning id, slug`,
      [h.uniq("a"), over.title ?? "시험 기사", o.status, person.id, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험 본문 문장" }], claims: [] }), o.summary, o.paid, o.legacy, o.status === "published" ? "2026-10-20T00:00:00Z" : null],
    )
  ).rows[0];
  return { ...row, id: Number(row.id) }; // jsonb 안의 id는 숫자이므로 맞춘다
}

test("키 발급 - 해시만 저장되고 계약이 없거나 기간 밖·종류 다름·전문 불허이면 거부, 거부도 감사 1행", () =>
  tx(async () => {
    const p = await partner();
    const c = await contract();
    const ok = await issue(p, c);
    assert.equal(ok.ok, true);
    const row = (await q("select key_hash, scope from public.partner_feeds where id = $1", [ok.id])).rows[0];
    assert.equal(row.key_hash, HASH);
    assert.deepEqual((await q("select column_name from information_schema.columns where table_name = 'partner_feeds' and column_name ~ 'key' and column_name <> 'key_hash'")).rows, []);
    assert.equal((await issue(p, 999999999)).code, "contract_missing");
    assert.equal((await issue(p, c, "full", "b".repeat(64))).code, "full_not_allowed");
    assert.equal((await issue(p, c, "summary", "XYZ")).code, "hash_invalid");
    assert.equal((await issue(p, await contract({ start: "2026-01-01", end: "2026-02-01" }), "summary", "c".repeat(64))).code, "contract_inactive");
    assert.equal((await issue(p, await contract({ kind: "naver_series" }), "summary", "d".repeat(64))).code, "contract_kind");
    const audit = (await q("select count(*)::int n from public.partner_feed_audit where action = 'issue' and outcome = 'refused'")).rows[0].n;
    assert.equal(audit, 5);
  }));

test("계약 기록 - 전문 허용은 데이터 라이선스 + 권리 근거 필요, 기간 역전·종류 오류 거부, 종료 뒤 수정 거부", () =>
  tx(async () => {
    const bad = (extra) => rpc("license_contract_record", "'상대', null, $1, '범위', $2::date, $3::date, null, $4, $5, $6", extra);
    assert.equal((await bad(["data_license", "2026-10-01", "2026-10-01", null, true, ACTOR])).code, "full_needs_rights");
    assert.equal((await bad(["naver_series", "2026-10-01", "2026-10-01", "근거", true, ACTOR])).code, "full_needs_rights");
    assert.equal((await bad(["data_license", "2026-10-02", "2026-10-01", null, false, ACTOR])).code, "period_invalid");
    assert.equal((await bad(["other", "2026-10-01", "2026-10-02", null, false, ACTOR])).code, "kind_invalid");
    const id = await contract();
    assert.equal((await rpc("license_contract_terminate", "$1, $2", [id, ACTOR])).ok, true);
    assert.equal((await rpc("license_contract_terminate", "$1, $2", [id, ACTOR])).code, "already_terminated");
    await q("savepoint s");
    await assert.rejects(q("update public.license_contracts set scope = '바꿈' where id = $1", [id]), (e) => e.code === "42501");
    await q("rollback to savepoint s");
    await assert.rejects(q("delete from public.license_contracts where id = $1", [id]), (e) => e.code === "42501");
  }));

test("피드 키 - 폐기 표시 외 수정·삭제 거부, 폐기는 한 번만", () =>
  tx(async () => {
    const { id } = await openFeed();
    await q("savepoint s");
    await assert.rejects(q("update public.partner_feeds set key_hash = $1 where id = $2", ["e".repeat(64), id]), (e) => e.code === "42501");
    await q("rollback to savepoint s");
    await assert.rejects(q("delete from public.partner_feeds where id = $1", [id]), (e) => e.code === "42501");
  }));

test("피드 제공 - 틀린 해시 401(사용 기록 0), 폐기 키 다음 요청 401, 계약 종료일 다음 날 401 / 종료일 당일 200", () =>
  tx(async () => {
    const { id } = await openFeed({ perMinute: 10, contract: { start: "2026-01-01", end: KST_DAY } });
    const wrong = await serve(id, "f".repeat(64));
    assert.deepEqual([wrong.ok, wrong.status], [false, 401]);
    assert.equal((await q("select count(*)::int n from public.partner_feed_usage where feed_id = $1", [id])).rows[0].n, 0);
    assert.equal((await serve(id, HASH, `${KST_DAY}T14:59:00Z`)).status, 200, "한국 시간 10-27 23:59는 종료일 당일");
    const next = await serve(id, HASH, `${KST_DAY}T15:00:00Z`);
    assert.deepEqual([next.status, next.code], [401, "contract_ended"]);
    const other = await openFeed({ perMinute: 10, hash: "b".repeat(64) });
    assert.equal((await serve(other.id, other.hash)).status, 200);
    assert.equal((await rpc("partner_feed_revoke", "$1, $2", [other.id, ACTOR])).ok, true);
    assert.equal((await rpc("partner_feed_revoke", "$1, $2", [other.id, ACTOR])).code, "already_revoked");
    const revoked = await serve(other.id, other.hash);
    assert.deepEqual([revoked.status, revoked.code], [401, "revoked"]);
  }));

test("피드 제공 - 기능 키 꺼짐·한도 값 없음·잘못된 한도(0)는 503", () =>
  tx(async () => {
    const { id } = await openFeed();
    await setFlag("partner_feeds", false);
    assert.equal((await serve(id)).status, 503);
    await setFlag("partner_feeds", true);
    await setRate({});
    assert.equal((await serve(id)).status, 503);
    await setRate({ per_minute: 0 });
    assert.equal((await serve(id)).status, 503);
  }));

test("분당 한도 - n번째까지 200, n+1번째 429, 한도 창(1분)이 지나면 다시 200", () =>
  tx(async () => {
    const { id } = await openFeed({ perMinute: 3 });
    for (let i = 0; i < 3; i++) assert.equal((await serve(id, HASH, `2026-10-27T03:00:0${i}Z`)).status, 200, `${i + 1}번째`);
    const over = await serve(id, HASH, "2026-10-27T03:00:30Z");
    assert.deepEqual([over.status, over.code], [429, "rate_limited"]);
    assert.equal((await serve(id, HASH, "2026-10-27T03:01:01Z")).status, 200, "첫 요청이 1분 밖으로 나가면 다시 열림");
    const counts = (await q("select response_code, count(*)::int n from public.partner_feed_usage where feed_id = $1 group by 1 order by 1", [id])).rows;
    assert.deepEqual(counts, [{ response_code: 200, n: 4 }, { response_code: 429, n: 1 }]);
  }));

test("피드 내용 - 무료 공개 기사만, 유료·초안·요약 없는 기사 0, 요약 범위는 본문 칸 없음", () =>
  tx(async () => {
    const { id } = await openFeed();
    const free = await article({ title: "무료 기사" });
    const paid = await article({ title: "유료 기사", paid: true });
    const draft = await article({ title: "초안 기사", status: "draft" });
    const nosum = await article({ title: "요약 없음", summary: null });
    const r = await serve(id);
    const ids = r.items.map((i) => i.id);
    assert.ok(ids.includes(free.id));
    for (const x of [paid, draft, nosum]) assert.ok(!ids.includes(x.id), `${x.id} 제외`);
    const item = r.items.find((i) => i.id === free.id);
    assert.equal(item.summary, "시험 요약");
    assert.equal("body_text" in item, false);
    assert.equal(r.scope, "summary");
    assert.equal((await q("select item_count from public.partner_feed_usage where feed_id = $1 and response_code = 200", [id])).rows[0].item_count, r.items.length);
  }));

test("전문 범위 - 계약 허용 ∧ 권리 근거 ∧ 이관 자료 아님일 때만 본문, 유료 기사 본문은 어떤 경우에도 0", () =>
  tx(async () => {
    const full = await openFeed({ scope: "full", contract: { full: true } });
    const own = await article({ title: "자체 기사" });
    const legacy = await article({ title: "이관 기사", legacy: "외부 이관 자료" });
    const paid = await article({ title: "유료 기사", paid: true });
    const r = await serve(full.id);
    assert.equal(r.full, true);
    assert.equal(r.items.find((i) => i.id === own.id).body_text, "시험 본문 문장");
    assert.equal("body_text" in r.items.find((i) => i.id === legacy.id), false, "이관 자료는 전문 0");
    assert.ok(!r.items.some((i) => i.id === paid.id), "유료 기사는 전문 범위에서도 0");
    const light = await openFeed({ scope: "summary", contract: { full: true }, hash: "c".repeat(64) });
    assert.equal("body_text" in (await serve(light.id, light.hash)).items.find((i) => i.id === own.id), false, "키 범위가 요약이면 본문 0");
  }));

test("피드 제공 limit - 0은 1건, 99는 50건 이하로 줄어든다", () =>
  tx(async () => {
    const { id } = await openFeed({ perMinute: 10 });
    await article();
    await article();
    assert.equal((await serve(id, HASH, NOW, 0)).items.length, 1);
    assert.ok((await serve(id, HASH, NOW, 99)).items.length <= 50);
  }));

test("사용·감사 기록은 고치거나 지울 수 없다", () =>
  tx(async () => {
    const { id } = await openFeed();
    await serve(id);
    await q("savepoint s");
    await assert.rejects(q("update public.partner_feed_usage set item_count = 9"), (e) => e.code === "42501");
    await q("rollback to savepoint s");
    await assert.rejects(q("delete from public.partner_feed_audit"), (e) => e.code === "42501");
  }));

test("연재 원고 - 기능 키 꺼짐·계약 없음·프리미엄 칼럼 아님 거부, 게시 기록은 존재하는 원고만", () =>
  tx(async () => {
    const a = await article();
    const nc = await contract({ kind: "naver_series" });
    const prep = (art, c) => rpc("naver_manuscript_prepare", "$1, $2, $3, $4::timestamptz", [art, c, ACTOR, NOW]);
    assert.equal((await prep(a.id, nc)).code, "feature_off");
    await setFlag("naver_series", true);
    assert.equal((await prep(a.id, 999999999)).code, "contract_missing");
    assert.equal((await prep(a.id, await contract())).code, "contract_missing", "데이터 라이선스 계약으로는 연재 준비 0");
    assert.equal((await prep(a.id, nc)).code, "not_premium_column");
    const post = (id, url, ok) => rpc("naver_manuscript_post", "$1, $2, $3, $4, $5::timestamptz", [id, url, ok, ACTOR, NOW]);
    assert.equal((await post(999999999, "https://example.test/x", true)).code, "not_found");
    assert.equal((await rpc("naver_manuscript_text", "$1, $2, $3::timestamptz", [999999999, ACTOR, NOW])).code, "not_found");
  }));

test("서버 함수는 익명·로그인 사용자가 부를 수 없다 (service_role만)", () =>
  tx(async () => {
    const fns = ["partner_feed_serve(bigint, text, int, timestamptz)", "partner_feed_issue(bigint, bigint, text, text, text, timestamptz)", "naver_manuscript_text(bigint, text, timestamptz)"];
    for (const f of fns) {
      const r = (await q("select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') u, has_function_privilege('service_role', $1, 'execute') s", [`public.${f}`])).rows[0];
      assert.deepEqual(r, { a: false, u: false, s: true }, f);
    }
  }));
