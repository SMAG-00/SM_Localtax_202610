// W12 0차 DB - 4단계 공통 (마이그레이션 20261026000150, docs/dev/4단계_설계.md 2.1 · 3장)
//  · 이벤트 이름 제약 105종 = W2-c 설계 2.1 표, 새 이벤트 20개는 저장되고 비슷한 이름은 거부
//  · 기능 키 9개는 꺼진 채로 있고 이전 키 값은 그대로, 설정 씨앗 10개는 공개 키가 아니고 범위 플래그·공개 단계는 꺼짐
//  · review_items 종류 4개가 저장되고 종류별 필수 체크 키가 붙으며, 모르는 종류는 거부
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
  "ask_started", "ask_entry_clicked", "assistant_mode_switched", "ask_clarify_answered", "ask_answer_rendered", "ask_fallback_shown", "ask_investment_blocked",
  "ask_scope_redirected", "ask_live_fetched", "ask_benefits_shown", "ask_determination_shown", "benefits_block_opened", "citation_opened", "ask_feedback",
  "ask_quota_reached", "keyword_map_viewed", "keyword_map_node_clicked", "data_story_viewed", "channel_landing_viewed", "security_page_viewed",
];
const NEW_FLAGS = ["ask_history", "case_summaries", "keyword_map", "data_stories", "security_page", "channel_kit", "kakao_login", "article_ai_box", "impact_banner"];
const NEW_SETTINGS = ["ask_limits", "ask_live_fetch_policy", "ask_scope_flags", "ask_rollout", "ask_budget", "ask_pricing", "ask_retention", "keyword_map_policy", "channel_copy_limits", "ask_official_search"];
const NEW_KINDS = { case_summary: "case_facts_from_source", article_ai_box: "box_matches_article", channel_draft: "channel_limits_checked", consistency_alert: "consistency_reflected" };

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
const insertEvent = (name) =>
  client.query(
    "insert into public.analytics_events (name, session_id, first_visit, stage, entry, section, props, is_bot, is_staff) values ($1, gen_random_uuid(), true, 1, 'direct', null, '{}'::jsonb, false, false)",
    [name],
  );

test("이벤트 이름 제약 - 제약 값 집합은 W2-c 2.1 표 105종과 같고 새 20개가 모두 표에 있다", () =>
  tx(async () => {
    const line = W2C.split("\n").find((l) => l.startsWith("| analytics_events.name "));
    const names = [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    assert.equal(names.length, 105);
    for (const n of NEW_EVENTS) assert.ok(names.includes(n), `2.1 표에 ${n}`);
    const def = (await client.query("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'analytics_events_name_check'")).rows[0].d;
    const inDb = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    assert.deepEqual([...inDb].sort(), [...names].sort());
  }));

test("이벤트 이름 제약 - 새 20개는 저장되고, 비슷한 이름·대문자·끝 공백은 거부된다", () =>
  tx(async () => {
    for (const n of NEW_EVENTS) await insertEvent(n);
    for (const bad of ["ask_start", "Ask_Started", "ask_started ", "ask_question_text"]) {
      await client.query("savepoint e");
      await assert.rejects(insertEvent(bad), (err) => err.code === "23514", bad);
      await client.query("rollback to savepoint e");
    }
  }));

test("기능 키 9개는 꺼진 채로 있고, 이전 키의 값은 바뀌지 않았다", () =>
  tx(async () => {
    const flags = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
    for (const k of NEW_FLAGS) assert.strictEqual(flags[k], false, `${k}는 false`);
    assert.strictEqual(flags.taxbot, false, "기존 taxbot 키도 꺼짐");
    assert.ok("calc_acquisition" in flags && "field_data" in flags && "tax_lifecycle" in flags, "이전 키가 남아 있다");
  }));

test("설정 씨앗 10개 - 범위 플래그 셋은 모두 false, 공개 단계는 none, 예산·단가·보존은 빈 객체, 공개 설정 키 목록에 없다", () =>
  tx(async () => {
    const get = async (k) => (await client.query("select value from public.settings where key = $1", [k])).rows[0]?.value;
    assert.deepEqual(await get("ask_scope_flags"), { trust_redevelopment: false, inheritance: false, gift: false });
    assert.deepEqual(await get("ask_rollout"), { stage: "none" });
    assert.deepEqual(await get("ask_official_search"), { enabled: false });
    for (const k of ["ask_budget", "ask_pricing", "ask_retention", "keyword_map_policy", "channel_copy_limits"]) assert.deepEqual(await get(k), {}, `${k}는 빈 객체`);
    const limits = await get("ask_limits");
    assert.deepEqual([limits.guest_daily, limits.member_daily, limits.premium_daily, limits.session_turns], [3, 10, 100, 20]);
    const live = await get("ask_live_fetch_policy");
    assert.deepEqual([live.max_calls, live.timeout_ms, live.excerpt_tokens, live.official_search_max], [3, 5000, 4000, 2]);
    const pub = await get("public_keys");
    const publicKeys = Array.isArray(pub) ? pub : [];
    for (const k of NEW_SETTINGS) {
      assert.notEqual(await get(k), undefined, `${k} 씨앗이 있다`);
      assert.ok(!publicKeys.includes(k), `${k}는 공개 키가 아님`);
    }
  }));

test("review_items - 새 종류 4개는 저장되고 종류별 필수 체크 키가 붙는다", () =>
  tx(async () => {
    for (const [kind, last] of Object.entries(NEW_KINDS)) {
      const { rows } = await client.query("insert into public.review_items (kind, source_key, title) values ($1, 'w12-0-test', '시험용 항목') returning required_checks", [kind]);
      assert.deepEqual(rows[0].required_checks, ["original_compared", "numbers_dates_links", "no_personal_info", last], kind);
    }
  }));

test("review_items - 모르는 종류는 거부되고, 이전 종류의 필수 체크 키는 그대로다", () =>
  tx(async () => {
    // 만들기 트리거는 모르는 종류의 필수 체크 키를 null로 만들어 NOT NULL이 먼저 걸리므로, 종류 제약(23514) 자체를 보려고 이 트랜잭션 안에서만 트리거를 끈다 (tx는 롤백)
    await client.query("alter table public.review_items disable trigger review_items_before_insert");
    await client.query("savepoint e");
    await assert.rejects(client.query("insert into public.review_items (kind, source_key, title, required_checks) values ('case_summary_old', 'w12-0-test', '시험용 항목', '{}')"), (err) => err.code === "23514" && /review_items_kind_check/.test(err.constraint ?? err.message));
    await client.query("rollback to savepoint e");
    await client.query("alter table public.review_items enable trigger review_items_before_insert");
    assert.deepEqual((await client.query("select public.review_required_checks('pipeline_failure') c")).rows[0].c, ["cause_noted"]);
    assert.deepEqual((await client.query("select public.review_required_checks('ordinance_change') c")).rows[0].c.at(-1), "summary_matches_source");
    assert.equal((await client.query("select public.review_required_checks('unknown_kind') c")).rows[0].c, null);
  }));
