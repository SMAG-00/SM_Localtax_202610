// W11 0차 DB - 3단계 공통 (마이그레이션 20261025000110, docs/dev/3단계_설계.md 2.1 · docs/dev/W11-a_설계.md 1장)
//  · 이벤트 이름 제약 85종 = W2-c 설계 2.1 표, 새 이벤트 13개는 저장되고 비슷한 이름은 거부
//  · 기능 키 10개는 꺼진 채로 있고 이전 키 값은 그대로, 설정 씨앗 4개는 빈 객체이며 공개 키가 아님
//  · review_items 종류 3개가 저장되고 종류별 필수 체크 키가 붙으며, 모르는 종류는 거부
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
  "guide_viewed", "determination_completed", "total_cost_started", "total_cost_completed", "family_next_check_opened", "step_viewed", "zone_viewed",
  "issue_map_viewed", "issue_map_source_opened", "ordinance_viewed", "institution_inquiry_sent", "premium_report_viewed", "org_seat_invited",
];
const NEW_FLAGS = ["tax_lifecycle", "house_count", "total_cost", "trust_tax_guide", "redevelopment_tax", "finance_tax_guide", "tax_determination", "issue_graph", "institution_subscription", "premium_reports"];
const NEW_SETTINGS = ["total_cost_policy", "premium_report_policy", "institution_inquiry_policy", "stale_check_policy"];
const NEW_KINDS = { guide_stale: "guide_reflected", issue_graph_stale: "graph_reflected", ordinance_change: "summary_matches_source" };

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

test("이벤트 이름 제약 - 제약 값 집합은 W2-c 2.1 표 85종과 같고 새 13개가 모두 표에 있다", () =>
  tx(async () => {
    const line = W2C.split("\n").find((l) => l.startsWith("| analytics_events.name "));
    const names = [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    assert.equal(names.length, 85);
    for (const n of NEW_EVENTS) assert.ok(names.includes(n), `2.1 표에 ${n}`);
    const def = (await client.query("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'analytics_events_name_check'")).rows[0].d;
    const inDb = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    assert.deepEqual([...inDb].sort(), [...names].sort());
  }));

test("이벤트 이름 제약 - 새 13개는 저장되고, 비슷한 이름·대문자·끝 공백은 거부된다", () =>
  tx(async () => {
    for (const n of NEW_EVENTS) await insertEvent(n);
    for (const bad of ["guide_view", "Guide_Viewed", "guide_viewed ", "premium_report_opened"]) {
      await client.query("savepoint e");
      await assert.rejects(insertEvent(bad), (err) => err.code === "23514", bad);
      await client.query("rollback to savepoint e");
    }
  }));

test("기능 키 10개는 꺼진 채로 있고, 이전 키의 값은 바뀌지 않았다", () =>
  tx(async () => {
    const flags = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
    for (const k of NEW_FLAGS) assert.strictEqual(flags[k], false, `${k}는 false`);
    assert.ok("calc_acquisition" in flags && "field_data" in flags && "redevelopment_status" in flags, "이전 키가 남아 있다");
  }));

test("설정 씨앗 4개는 빈 객체이고 공개 설정 키 목록에 없다", () =>
  tx(async () => {
    for (const k of NEW_SETTINGS) {
      const row = (await client.query("select value from public.settings where key = $1", [k])).rows[0];
      // institution_inquiry_policy는 W11-f 134가 보존 기간 365일 한 칸을 씨앗으로 채운다 (법률 검토 대상 값은 아님 - 나머지 3개는 빈 객체)
      assert.deepEqual(row?.value, k === "institution_inquiry_policy" ? { retention_days: 365 } : k === "stale_check_policy" ? { zone_days: 90, ordinance_days: 90 } : {}, k === "institution_inquiry_policy" ? `${k}는 retention_days 365` : `${k}는 빈 객체`);
    }
    const pub = (await client.query("select value from public.settings where key = 'public_keys'")).rows[0]?.value;
    const publicKeys = Array.isArray(pub) ? pub : [];
    for (const k of NEW_SETTINGS) assert.ok(!publicKeys.includes(k), `${k}는 공개 키가 아님`);
  }));

test("review_items - 새 종류 3개는 저장되고 종류별 필수 체크 키가 붙는다", () =>
  tx(async () => {
    for (const [kind, last] of Object.entries(NEW_KINDS)) {
      const { rows } = await client.query("insert into public.review_items (kind, source_key, title) values ($1, 'w11-0-test', '시험용 항목') returning required_checks", [kind]);
      assert.deepEqual(rows[0].required_checks, ["original_compared", "numbers_dates_links", "no_personal_info", last], kind);
    }
  }));

test("review_items - 모르는 종류는 거부되고, 이전 종류의 필수 체크 키는 그대로다", () =>
  tx(async () => {
    // 만들기 트리거는 모르는 종류의 필수 체크 키를 null로 만들어 NOT NULL이 먼저 걸리므로, 종류 제약(23514) 자체를 보려고 이 트랜잭션 안에서만 트리거를 끈다 (tx는 롤백)
    await client.query("alter table public.review_items disable trigger review_items_before_insert");
    await client.query("savepoint e");
    await assert.rejects(client.query("insert into public.review_items (kind, source_key, title, required_checks) values ('guide_old', 'w11-0-test', '시험용 항목', '{}')"), (err) => err.code === "23514" && /review_items_kind_check/.test(err.constraint ?? err.message));
    await client.query("rollback to savepoint e");
    await client.query("alter table public.review_items enable trigger review_items_before_insert");
    assert.deepEqual((await client.query("select public.review_required_checks('pipeline_failure') c")).rows[0].c, ["cause_noted"]);
    assert.equal((await client.query("select public.review_required_checks('unknown_kind') c")).rows[0].c, null);
  }));
