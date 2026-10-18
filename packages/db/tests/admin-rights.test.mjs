// 관리자(PO) 전권 — 서버의 관리자 경로(service_role)는 모든 public 표를 읽고·추가하고·고치고·지울 수 있다 (2026-10-17 PO 지시).
// 예외: 감사 기록(audit_logs)은 전용 함수로만 고치고 지운다(PO만, audit-amend.test.mjs), 그 변경 기록(audit_log_changes)은 추가만. 표가 늘어나도 이 시험이 권한 누락을 잡는다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

// 추가만 되는 표 — 감사 기록 2종(ADM-04) + W2-a 설계 3장의 수정 이력·정정 이력·점검 결과 + 개정 단계 기록(01B TX-07) + 기획 상태 기록(NAV-09, 트리거만 쓴다)
//   + 삭제된 기사 주소(W2-b 4단계 NAV-06 — 트리거만 쓴다, 410 응답의 원본) + 제휴 실사·점검 기록(W2-c 5단계 NAV-01·07·20 — 새 판은 새 행)
const APPEND_ONLY = new Set([
  "public.news_partner_checks",
  "public.audit_logs",
  "public.audit_log_changes",
  "public.article_revisions",
  "public.article_corrections",
  "public.seo_checks",
  "public.amendment_events",
  "public.story_assignment_events",
  "public.article_tombstones",
]);
let client;

before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

test("감사 로그를 뺀 모든 public 표에서 service_role이 SELECT·INSERT·UPDATE·DELETE 권한을 가진다", async () => {
  const { rows } = await client.query(`
    select n.nspname || '.' || c.relname as name,
      has_table_privilege('service_role', c.oid, 'SELECT') as s,
      has_table_privilege('service_role', c.oid, 'INSERT') as i,
      has_table_privilege('service_role', c.oid, 'UPDATE') as u,
      has_table_privilege('service_role', c.oid, 'DELETE') as d
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by 1`);
  const checked = rows.filter((r) => !APPEND_ONLY.has(r.name));
  assert.ok(checked.length > 0, "검사할 표가 없다");
  const missing = checked.filter((r) => !(r.s && r.i && r.u && r.d)).map((r) => `${r.name} (S${+r.s} I${+r.i} U${+r.u} D${+r.d})`);
  assert.deepEqual(missing, []);
});

test("service_role로 실행 기록(agent_runs) 행을 실제로 지울 수 있다", async () => {
  await client.query("begin");
  try {
    const { rows } = await client.query("insert into public.agent_runs (job, trigger) values ('scheduler-heartbeat', 'manual') returning id");
    await client.query("set local role service_role");
    const del = await client.query("delete from public.agent_runs where id = $1", [rows[0].id]);
    assert.equal(del.rowCount, 1);
  } finally {
    await client.query("rollback");
  }
});
