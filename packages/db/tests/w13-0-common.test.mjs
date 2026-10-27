// W13 0차 DB - 5단계 공통 (마이그레이션 20261027000190, docs/dev/5단계_설계.md 2.1 · 3장 · W13-0 결정)
//  · 이벤트 이름 제약 124종 = W2-c 설계 2.1 표, 새 19개는 저장되고 비슷한 이름은 거부
//  · 기능 키 16개는 꺼진 채로 있고 이전 키 값은 그대로, 설정 씨앗 11개는 공개 키가 아니고 가격·한도 칸은 비어 있음(PRD 값 둘만 채움)
//  · entitlements.key · product_plans.entitlement_key 허용 목록에 library·workspace·copilot - 허용 밖 값은 거부, has_entitlement는 새 키도 같은 규칙으로 판정
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const W2C = fs.readFileSync(path.join(ROOT, "docs", "dev", "W2-c_설계.md"), "utf8");
const NEW_EVENTS = [
  "pricing_viewed", "subscription_renewed", "library_opened", "workspace_opened", "note_saved", "split_view_opened", "timeline_opened", "export_downloaded",
  "briefing_opened", "copilot_used", "qna_posted", "qna_answered", "qna_accepted", "expert_strip_clicked", "solved_case_clicked", "expert_verified",
  "notification_setting_changed", "notification_opened", "partner_feed_requested",
];
const NEW_FLAGS = [
  "library", "library_premium", "workspace", "law_split", "law_timeline", "research_copilot", "expert_calc", "qna", "solved_cases",
  "my_notifications", "my_briefings", "partner_feeds", "licenses", "naver_series", "account_links", "security_cert_plan",
];
const EMPTY_SETTINGS = ["library_preview", "library_rate_limit", "export_excerpt_limit", "saved_search_limit", "copilot_monthly_limit", "link_similarity_threshold", "qna_criteria", "qna_detect_dictionary", "expert_badge_notice_days"];
const NEW_KEYS = ["library", "workspace", "copilot"];

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
async function rejectsWith(sql, params, code) {
  await client.query("savepoint e");
  await assert.rejects(client.query(sql, params), (err) => err.code === code, `${sql} ${JSON.stringify(params)}`);
  await client.query("rollback to savepoint e");
}
const insertEvent = (name) =>
  client.query(
    "insert into public.analytics_events (name, session_id, first_visit, stage, entry, section, props, is_bot, is_staff) values ($1, gen_random_uuid(), true, 1, 'direct', null, '{}'::jsonb, false, false)",
    [name],
  );
const authUser = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
const grant = (user, key, until = "2099-01-01") =>
  client.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, $2, 'manual', $3, '2026-01-01', $4)", [user, key, `w13-0-${key}-${Math.random()}`, until]);

test("이벤트 이름 제약 - 제약 값 집합은 W2-c 2.1 표 124종과 같고 새 19개가 모두 표에 있다", () =>
  tx(async () => {
    const line = W2C.split("\n").find((l) => l.startsWith("| analytics_events.name "));
    const names = [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    assert.equal(names.length, 124);
    assert.equal(new Set(names).size, 124, "중복 이름 없음");
    for (const n of NEW_EVENTS) assert.ok(names.includes(n), `2.1 표에 ${n}`);
    const def = (await client.query("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'analytics_events_name_check'")).rows[0].d;
    const inDb = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    assert.deepEqual([...inDb].sort(), [...names].sort());
  }));

test("이벤트 이름 제약 - 새 19개는 저장되고, 폐기된 유료 등재 이벤트·비슷한 이름·대문자·끝 공백은 거부된다", () =>
  tx(async () => {
    for (const n of NEW_EVENTS) await insertEvent(n);
    for (const bad of ["paid_listing_viewed", "paid_listing_contact_clicked", "pricing_view", "Pricing_Viewed", "library_opened ", "subscription_canceled", "seat_invited"]) {
      await rejectsWith(
        "insert into public.analytics_events (name, session_id, first_visit, stage, entry, section, props, is_bot, is_staff) values ($1, gen_random_uuid(), true, 1, 'direct', null, '{}'::jsonb, false, false)",
        [bad],
        "23514",
      );
    }
  }));

test("기능 키 16개는 꺼진 채로 있고, 이전 키의 값은 바뀌지 않았다", () =>
  tx(async () => {
    const flags = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
    for (const k of NEW_FLAGS) assert.strictEqual(flags[k], false, `${k}는 false`);
    assert.equal(new Set(NEW_FLAGS).size, 16);
    assert.ok("ask_history" in flags && "calc_acquisition" in flags && "experts" in flags && "taxbot" in flags, "이전 키가 남아 있다");
  }));

test("설정 씨앗 11개 - 가격·한도·고지 칸은 빈 객체, PRD 값 둘만 채워져 있고, 공개 설정 키 목록에 없다", () =>
  tx(async () => {
    const get = async (k) => (await client.query("select value from public.settings where key = $1", [k])).rows[0]?.value;
    for (const k of EMPTY_SETTINGS) assert.deepEqual(await get(k), {}, `${k}는 빈 객체`);
    assert.deepEqual(await get("qna_answer_sla_hours"), { hours: 72 });
    assert.deepEqual(await get("digitization_sample_error_max"), { percent: 0.5 });
    const pub = await get("public_keys");
    const publicKeys = Array.isArray(pub) ? pub : [];
    for (const k of [...EMPTY_SETTINGS, "qna_answer_sla_hours", "digitization_sample_error_max"]) assert.ok(!publicKeys.includes(k), `${k}는 공개 키가 아님`);
  }));

test("entitlements - 새 권한 키 3개는 저장되고, 허용 밖 값·대문자·공백은 거부되며, 기존 키도 그대로 저장된다", () =>
  tx(async () => {
    const u = await authUser();
    for (const k of [...NEW_KEYS, "digital", "premium_report"]) await grant(u, k);
    for (const bad of ["Library", "library ", "libraries", "premium", ""]) {
      await rejectsWith("insert into public.entitlements (user_id, key, source, source_ref, valid_until) values ($1, $2, 'manual', $3, '2099-01-01')", [u, bad, `bad-${bad}`], "23514");
    }
  }));

test("has_entitlement - 새 키도 같은 규칙: 있는 키만 true, 다른 키는 false, 끝 시각 직전 true·끝 시각부터 false, 해지하면 false", () =>
  tx(async () => {
    const u = await authUser();
    const has = async (key, at) => (await client.query("select public.has_entitlement($1, $2, $3::timestamptz) h", [u, key, at])).rows[0].h;
    await grant(u, "library", "2026-12-01T00:00:00Z");
    assert.equal(await has("library", "2026-11-30T23:59:59Z"), true, "끝 직전");
    assert.equal(await has("library", "2026-12-01T00:00:00Z"), false, "끝 시각부터 없음 (배타적)");
    assert.equal(await has("workspace", "2026-11-30T00:00:00Z"), false, "다른 새 키는 따로 판정");
    assert.equal(await has("digital", "2026-11-30T00:00:00Z"), false, "library 권한이 digital을 주지 않음");
    await client.query("update public.entitlements set revoked_at = '2026-11-01T00:00:00Z' where user_id = $1 and key = 'library'", [u]);
    assert.equal(await has("library", "2026-11-30T23:59:59Z"), false, "해지 뒤");
  }));

test("product_plans.entitlement_key - 새 권한 키 3개와 digital은 저장되고, 허용 밖 값은 거부된다", () =>
  tx(async () => {
    const slug = `zz-w13-0-${process.pid}`;
    const p = (await client.query("insert into public.products (slug, title, kind, order_mode, billing_mode, status, edited_by) values ($1, '시험', 'digital_subscription', 'pg', 'pg', 'draft', 't') returning id", [slug])).rows[0];
    let n = 0;
    for (const k of ["digital", ...NEW_KEYS]) {
      const r = await client.query("insert into public.product_plans (product_id, plan_key, title, period_months, amount, entitlement_key, edited_by) values ($1, $2, '시험', 1, 100, $3, 't') returning entitlement_key", [p.id, `k${++n}`, k]);
      assert.equal(r.rows[0].entitlement_key, k);
    }
    for (const bad of ["premium_report", "Library", "x"]) {
      await rejectsWith("insert into public.product_plans (product_id, plan_key, title, period_months, amount, entitlement_key, edited_by) values ($1, $2, '시험', 1, 100, $3, 't')", [p.id, `b${++n}`, bad], "23514");
    }
  }));
