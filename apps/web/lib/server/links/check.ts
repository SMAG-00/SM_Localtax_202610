import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isoWeekKey, isStale, resultOf } from "@/lib/links/rules";
import { nextWetaxState, type WetaxStatus } from "@/lib/calc/wetax";

// 바깥 링크 점검 (W3 2단계, 배치 link-check — 설계 1장 2단계 · 3장 official_link_checks).
//  · 주소가 있는 활성 행만 점검한다. 요청에는 주소와 고정 User-Agent 외에 아무것도 싣지 않는다(쿠키·이용자 정보·Referer 0).
//  · 2xx → ok, 4xx·5xx·연결 실패·시간 초과 → broken. 복구되면 다음 점검에서 ok.
//  · 실행 키(ISO 주)당 링크마다 기록 한 벌 — 같은 키로 다시 돌리면 이미 점검한 행은 건너뛴다(멱등).
//  · 반환은 수뿐이다(주소 0) — 실행 기록(agent_runs.detail)에 그대로 남는다.
export const LINK_CHECK_TIMEOUT_MS = 8000;
const USER_AGENT = "LTR-LinkCheck/1.0";

export type Fetcher = (url: string, init: { signal: AbortSignal; redirect: "follow"; headers: Record<string, string> }) => Promise<{ status: number }>;

async function probe(url: string, fetcher: Fetcher, timeoutMs: number): Promise<number | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": USER_AGENT } });
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface LinkRow {
  id: number;
  url: string | null;
  checked_at: string | null;
  status: WetaxStatus;
  fail_count: number | null;
}

export async function checkLinks(
  db: SupabaseClient,
  now: Date,
  opts: { fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const fetcher = opts.fetcher ?? ((u, init) => fetch(u, init));
  const runKey = isoWeekKey(now);
  const links = await db.from("official_links").select("id, url, checked_at, status, fail_count").eq("active", true).not("url", "is", null);
  if (links.error) throw new Error(`링크 목록 읽기 실패 (${links.error.code})`);
  const rows = (links.data ?? []) as LinkRow[];
  const stale = rows.filter((r) => isStale(r, now)).length;

  const done = await db.from("official_link_checks").select("link_id").eq("run_key", runKey);
  if (done.error) throw new Error(`점검 기록 읽기 실패 (${done.error.code})`);
  const already = new Set((done.data ?? []).map((d: { link_id: number }) => Number(d.link_id)));

  let ok = 0;
  let broken = 0;
  let pending = 0;
  let skipped = 0;
  for (const row of rows) {
    if (already.has(Number(row.id))) {
      skipped += 1;
      continue;
    }
    const status = await probe(row.url as string, fetcher, opts.timeoutMs ?? LINK_CHECK_TIMEOUT_MS);
    const result = resultOf(status);
    const at = now.toISOString();
    const ins = await db
      .from("official_link_checks")
      .upsert({ link_id: row.id, run_key: runKey, result, http_status: status, method: "auto", by: null, at }, { onConflict: "link_id,run_key", ignoreDuplicates: true });
    if (ins.error) throw new Error(`점검 기록 쓰기 실패 (${ins.error.code})`);
    // 오류·시간 초과가 2회 연속이어야 broken (FAM-04 · WETAX-01) - 첫 실패는 이전 상태를 유지하고 실패 횟수만 올린다
    const next = nextWetaxState({ status: row.status, fail_count: Number(row.fail_count ?? 0) }, result);
    const patch: Record<string, unknown> = { status: next.status, fail_count: next.fail_count, checked_at: at, check_method: "auto", checked_by: null };
    if (result === "ok") patch.last_ok_at = at;
    const upd = await db.from("official_links").update(patch).eq("id", row.id);
    if (upd.error) throw new Error(`링크 상태 갱신 실패 (${upd.error.code})`);
    if (result === "ok") ok += 1;
    else if (next.status === "broken") broken += 1;
    else pending += 1;
  }
  const wetax = await checkWetaxLinks(db, now, fetcher, opts.timeoutMs ?? LINK_CHECK_TIMEOUT_MS);
  return { runKey, targets: rows.length, ok, broken, pending, skipped, staleBeforeRun: stale, wetax };
}

interface WetaxRow {
  key: string;
  label: string;
  url: string | null;
  status: WetaxStatus;
  fail_count: number;
}

/**
 * 위택스 링크 점검 (WETAX-01) - official_links와 같은 배치·같은 실행 키(ISO 주).
 * 오류·시간 초과가 2회 연속이면 broken(처음 broken이 될 때 검수 큐에 link_error 항목 1건 - (종류, 키)가 같으면 다시 만들지 않는다), 성공하면 실패 횟수 0.
 * 첫 번째 실패는 상태를 바꾸지 않는다. 요청에는 주소와 고정 User-Agent뿐이다. 반환은 수뿐(주소 0).
 */
async function checkWetaxLinks(db: SupabaseClient, now: Date, fetcher: Fetcher, timeoutMs: number): Promise<Record<string, unknown>> {
  const runKey = isoWeekKey(now);
  const links = await db.from("wetax_links").select("key, label, url, status, fail_count").eq("active", true).not("url", "is", null);
  if (links.error) throw new Error(`위택스 링크 목록 읽기 실패 (${links.error.code})`);
  const rows = (links.data ?? []) as WetaxRow[];
  const done = await db.from("wetax_link_checks").select("link_key").eq("run_key", runKey);
  if (done.error) throw new Error(`위택스 점검 기록 읽기 실패 (${done.error.code})`);
  const already = new Set((done.data ?? []).map((d: { link_key: string }) => d.link_key));

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let newlyBroken = 0;
  for (const row of rows) {
    if (already.has(row.key)) {
      skipped += 1;
      continue;
    }
    const status = await probe(row.url as string, fetcher, timeoutMs);
    const result = resultOf(status);
    const at = now.toISOString();
    const ins = await db
      .from("wetax_link_checks")
      .upsert({ link_key: row.key, run_key: runKey, result, http_status: status, method: "auto", by: null, at }, { onConflict: "link_key,run_key", ignoreDuplicates: true });
    if (ins.error) throw new Error(`위택스 점검 기록 쓰기 실패 (${ins.error.code})`);
    const next = nextWetaxState({ status: row.status, fail_count: Number(row.fail_count) }, result);
    const patch: Record<string, unknown> = { status: next.status, fail_count: next.fail_count, checked_at: at, check_method: "auto", checked_by: null };
    if (result === "ok") patch.last_ok_at = at;
    const upd = await db.from("wetax_links").update(patch).eq("key", row.key);
    if (upd.error) throw new Error(`위택스 링크 상태 갱신 실패 (${upd.error.code})`);
    if (result === "ok") ok += 1;
    else failed += 1;
    if (next.status === "broken" && row.status !== "broken") {
      newlyBroken += 1;
      const item = await db.from("review_items").insert({
        kind: "link_error",
        source_key: `wetax:${row.key}`,
        title: `위택스 링크 오류: ${row.label}`.slice(0, 200),
        payload: { table: "wetax_links", link_key: row.key },
        created_by: "job:link-check",
      });
      if (item.error && item.error.code !== "23505") throw new Error(`검수 큐 항목 쓰기 실패 (${item.error.code})`);
    }
  }
  return { runKey, targets: rows.length, ok, failed, skipped, newlyBroken };
}
