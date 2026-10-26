import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// 정비 현황·조례 확인일 경고 작업 (W11-e e4 - AIOPS-14 · RDV-07 · TX-13). 작업 목록(@ltr/workflows)이 이 함수를 부르고, URL 호출·명령줄이 같은 함수를 쓴다.
//  · DB 함수 stale_check_warnings(p_now)만 부른다 - 외부 요청 0, AI 호출 0. 한도(zone_days·ordinance_days)는 설정 stale_check_policy
//  · 90일째 경고 없음, 91일째 경고 (판정은 DB 함수 한 곳). 결과는 수와 이유뿐이다 (구역·조례 이름 0)
//  · 외부 공급원 갱신은 pipeline-field-data(W10-h)가 한다 - 이용 조건 확인 기록이 없는 공급원은 거기서 거부된다. 여기서는 자치법규 원천 상태만 알린다
//  · 실패하면 예외를 던질 뿐 공개 값은 바꾸지 않는다(마지막 승인 값 유지). 정비 단계 갱신은 project_events 새 행으로만 쌓인다 (W4 추가만)

export async function refreshZones(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const warnings = await db.rpc("stale_check_warnings", { p_now: now.toISOString() });
  if (warnings.error) throw new Error(`stale_check_warnings 실패: ${warnings.error.code ?? ""} ${warnings.error.message}`.trim());
  const rows = (warnings.data ?? []) as { target: string; target_id: number; days: number }[];
  const runnable = await db.rpc("data_source_runnable", { p_key: "ordinance_api" });
  if (runnable.error) throw new Error(`data_source_runnable 실패: ${runnable.error.code ?? ""} ${runnable.error.message}`.trim());
  return {
    zonesStale: rows.filter((r) => r.target === "zone").length,
    ordinancesStale: rows.filter((r) => r.target === "ordinance").length,
    maxDays: rows.reduce((m, r) => Math.max(m, r.days), 0),
    ordinanceSource: runnable.data === true ? "runnable" : "source_not_runnable",
    externalRequests: 0,
  };
}
