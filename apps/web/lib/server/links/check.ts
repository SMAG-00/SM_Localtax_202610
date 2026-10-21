import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isoWeekKey, isStale, resultOf } from "@/lib/links/rules";

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
}

export async function checkLinks(
  db: SupabaseClient,
  now: Date,
  opts: { fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const fetcher = opts.fetcher ?? ((u, init) => fetch(u, init));
  const runKey = isoWeekKey(now);
  const links = await db.from("official_links").select("id, url, checked_at").eq("active", true).not("url", "is", null);
  if (links.error) throw new Error(`링크 목록 읽기 실패 (${links.error.code})`);
  const rows = (links.data ?? []) as LinkRow[];
  const stale = rows.filter((r) => isStale(r, now)).length;

  const done = await db.from("official_link_checks").select("link_id").eq("run_key", runKey);
  if (done.error) throw new Error(`점검 기록 읽기 실패 (${done.error.code})`);
  const already = new Set((done.data ?? []).map((d: { link_id: number }) => Number(d.link_id)));

  let ok = 0;
  let broken = 0;
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
    const patch: Record<string, unknown> = { status: result, checked_at: at, check_method: "auto", checked_by: null };
    if (result === "ok") patch.last_ok_at = at;
    const upd = await db.from("official_links").update(patch).eq("id", row.id);
    if (upd.error) throw new Error(`링크 상태 갱신 실패 (${upd.error.code})`);
    if (result === "ok") ok += 1;
    else broken += 1;
  }
  return { runKey, targets: rows.length, ok, broken, skipped, staleBeforeRun: stale };
}
