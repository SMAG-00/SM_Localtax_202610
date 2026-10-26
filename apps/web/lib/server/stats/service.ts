import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runStatsSource, STATS_SPECS, type StatsStore } from "@ltr/workflows/stats";
import { dataApiKey } from "../env";

// 지방세 통계 수집 작업 (W12-h h2 - DATA-01). 작업 목록(@ltr/workflows)이 collectStats를 부르고, 같은 함수를 URL 호출·명령줄이 함께 쓴다.
// 관문(기능 키 data_stories · 인증키 · 주소 칸 · 원천 이용 조건 allowed + 견본 계약 확인) 중 하나라도 틀리면 외부 요청 0, 이유만 남긴다.
// 쓰기는 DB 함수 stats_series_put 하나(응답 원본 스냅샷 + 시계열 초안). 공개 반영은 사람이 stats_series_approve로. AI 호출 없음. 결과는 수와 이유뿐.
const ACTOR = "job:stats-collect";

async function flagOn(db: SupabaseClient): Promise<boolean> {
  const r = await db.from("settings").select("value").eq("key", "feature_flags").limit(1);
  if (r.error) throw new Error(`settings 읽기 실패: ${r.error.code ?? ""} ${r.error.message}`.trim());
  const value = (r.data?.[0] as { value?: unknown } | undefined)?.value;
  return !!value && typeof value === "object" && (value as Record<string, unknown>).data_stories === true;
}

async function sourceRunnable(db: SupabaseClient, sourceKey: string): Promise<boolean> {
  const r = await db.rpc("data_source_runnable", { p_key: sourceKey });
  if (r.error) throw new Error(`data_source_runnable 실패: ${r.error.code ?? ""} ${r.error.message}`.trim());
  return r.data === true;
}

export function supabaseStatsStore(db: SupabaseClient): StatsStore {
  return {
    async put(input) {
      const r = await db.rpc("stats_series_put", { p_source_key: input.sourceKey, p_snapshot: input.snapshot, p_series: input.series, p_actor: ACTOR });
      if (r.error) throw new Error(`stats_series_put 실패: ${r.error.code ?? ""} ${r.error.message}`.trim());
      const d = r.data as { ok?: boolean; code?: string; created?: boolean } | null;
      return { ok: !!d?.ok, code: d?.code, created: !!d?.created };
    },
  };
}

const httpFetch = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  return { status: res.status, text: await res.text() };
};

export async function collectStats(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const on = await flagOn(db);
  const store = supabaseStatsStore(db);
  const key = dataApiKey();
  const results: Record<string, unknown>[] = [];
  for (const spec of Object.values(STATS_SPECS)) {
    const runnable = on && !!key && !!spec.baseUrl ? await sourceRunnable(db, spec.sourceKey) : false;
    const r = await runStatsSource({ spec, fetch: httpFetch, store, now, key, flagOn: on, sourceRunnable: runnable });
    results.push({ source: spec.sourceKey, ...r });
  }
  return { sources: results };
}
