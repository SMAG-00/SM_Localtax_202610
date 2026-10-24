// W7 5단계 DB — 월 마감 행·알림·규정 판단 값 (마이그레이션 …74, docs/dev/W7_설계.md 2장 · PRD-01A NAV-16~20)
//  · 월 마감 행 — 같은 (달, 플랫폼, 규정 버전, version) 중복 거부, 수정·삭제·비우기 거부(마감 행은 바꾸지 않는다), 재계산은 사유 있는 새 version 행
//  · 플랫폼 internal은 규정 버전 없이, naver·kakao는 규정 버전과 함께, 달은 1일만
//  · 알림 — 같은 (종류, 달, 열쇠) 1건, 확인 처리 칸만 고칠 수 있다
//  · 규정 판단 값 — 모양 검사(유사도 0~1·비교 연산 gt/gte·부정평가 창 1~60·합산 불리언), 확정된 규정 버전은 고칠 수 없다, 기본값 행 0
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function attempt(sql, params = [], role = null) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    if (role) await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
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
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const METRICS = JSON.stringify({ own_ratio: { numerator: 1, denominator: 2, definition: "시험용" } });
const requirement = async (platform = "naver") =>
  one("insert into public.news_partner_requirements (platform, title, created_by) values ($1, '시험용 규정', 'user:w7') returning id, version", [platform]);
const monthly = (over = {}) => {
  const row = { month: "2026-09-01", platform: "internal", metrics: METRICS, ...over };
  const keys = Object.keys(row);
  return attempt(`insert into public.partner_readiness_monthly (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => row[k]));
};

test("월 마감 행 — 같은 키 중복·수정·삭제·비우기 거부, 재계산은 사유 있는 새 version 행", () =>
  tx(async () => {
    const first = await monthly();
    assert.ok(first.ok, first.message);
    assert.equal((await monthly()).ok, false, "같은 (달, 플랫폼, 규정, version) 중복");
    assert.equal((await monthly({ version: 2 })).ok, false, "재계산 사유 없음");
    assert.ok((await monthly({ version: 2, recompute_reason: "시험용 사유" })).ok);
    assert.equal((await attempt("update public.partner_readiness_monthly set metrics = '{}'::jsonb where id = $1", [first.rows[0].id])).ok, false);
    assert.equal((await attempt("delete from public.partner_readiness_monthly where id = $1", [first.rows[0].id])).ok, false);
    assert.equal((await attempt("truncate public.partner_readiness_monthly")).ok, false);
    assert.equal((await attempt("select * from public.partner_readiness_monthly", [], "anon")).ok, false);
  }));

test("월 마감 행 — 달은 1일만, internal은 규정 버전 없이·naver는 규정 버전과 함께, 지표는 객체", () =>
  tx(async () => {
    assert.equal((await monthly({ month: "2026-09-15" })).ok, false);
    const req = await requirement();
    assert.equal((await monthly({ platform: "naver" })).ok, false, "규정 버전 없는 naver");
    assert.equal((await monthly({ platform: "internal", requirement_id: req.id })).ok, false, "규정 버전 있는 internal");
    assert.ok((await monthly({ platform: "naver", requirement_id: req.id, requirement_version: req.version })).ok);
    assert.equal((await monthly({ platform: "twitter" })).ok, false);
    assert.equal((await monthly({ month: "2026-08-01", metrics: "[]" })).ok, false, "지표가 객체가 아님");
  }));

test("알림 — 같은 (종류, 달, 열쇠) 1건, 확인 처리 칸만 고칠 수 있고 확인자·시각은 함께", () =>
  tx(async () => {
    const add = (over = {}) =>
      attempt("insert into public.partner_readiness_alerts (kind, month, key, detail) values ($1, $2, $3, '시험용 알림') returning id", [over.kind ?? "penalty", over.month ?? "2026-09-01", over.key ?? "k1"]);
    const first = await add();
    assert.ok(first.ok, first.message);
    assert.equal((await add()).ok, false, "같은 사유 중복");
    assert.ok((await add({ key: "k2" })).ok);
    assert.equal((await add({ kind: "other" })).ok, false);
    assert.equal((await attempt("update public.partner_readiness_alerts set acknowledged_at = now() where id = $1", [first.rows[0].id])).ok, false, "확인자 없이 확인");
    assert.ok((await attempt("update public.partner_readiness_alerts set acknowledged_at = now(), acknowledged_by = 'user:w7' where id = $1", [first.rows[0].id], "service_role")).ok);
    assert.equal((await attempt("update public.partner_readiness_alerts set detail = '바꿈' where id = $1", [first.rows[0].id], "service_role")).ok, false, "확인 칸 밖은 권한 없음");
  }));

test("규정 판단 값 — 모양 검사, 비어 있을 수 있음(기본값 0), 확정된 규정 버전은 고칠 수 없다", () =>
  tx(async () => {
    const req = await requirement();
    const put = (cols) => attempt(`insert into public.news_partner_requirement_rules (requirement_id, updated_by, ${Object.keys(cols).join(", ")}) values ($1, 'user:w7', ${Object.keys(cols).map((_, i) => `$${i + 2}::jsonb`).join(", ")})`, [req.id, ...Object.values(cols).map((v) => JSON.stringify(v))]);
    const sim = { sentence_similarity: 0.5, sentence_comparator: "gte", article_ratio: 0.5, article_comparator: "gt" };
    assert.equal((await put({ similarity_rule: { ...sim, sentence_similarity: 1.5 } })).ok, false, "비율 1 초과");
    assert.equal((await put({ similarity_rule: { ...sim, article_comparator: "eq" } })).ok, false, "비교 연산");
    assert.equal((await put({ penalty_rule: { window_months: 0, warn_points: 1, comparator: "gte" } })).ok, false, "창 0개월");
    assert.equal((await put({ penalty_rule: { window_months: 12, warn_points: 0, comparator: "gte" } })).ok, false, "경고 점수 0");
    assert.equal((await put({ contributor_rule: { merge_external: "yes" } })).ok, false, "불리언 아님");
    assert.equal((await one("select count(*)::int n from public.news_partner_requirement_rules")).n, 0, "기본값 행 0");
    const ok = await put({ similarity_rule: sim, penalty_rule: { window_months: 12, warn_points: 3, comparator: "gte" }, contributor_rule: { merge_external: true } });
    assert.ok(ok.ok, ok.message);
    assert.ok((await attempt("update public.news_partner_requirement_rules set contributor_rule = '{\"merge_external\": false}'::jsonb where requirement_id = $1", [req.id])).ok, "확정 전에는 고칠 수 있다");
    await client.query(
      "update public.news_partner_requirements set status = 'confirmed', source_url = 'https://rules.example.test/a', checked_at = '2026-10-01', media_type = '시험용', effective_from = '2026-10-01', review_period = '{\"months\": 3, \"basis\": \"closed_months\", \"text\": \"시험용\"}'::jsonb, requirements = '[{\"key\": \"k\"}]'::jsonb, approved_by = 'user:w7', approved_at = now() where id = $1",
      [req.id],
    );
    assert.equal((await attempt("update public.news_partner_requirement_rules set contributor_rule = null where requirement_id = $1", [req.id])).ok, false, "확정 뒤 수정");
    assert.equal((await attempt("delete from public.news_partner_requirement_rules where requirement_id = $1", [req.id])).ok, false, "확정 뒤 삭제");
  }));
