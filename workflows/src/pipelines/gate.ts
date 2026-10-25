// 수집 파이프라인 관문 (PIPE-01~04 · AIOPS-06) — 세 조건이 모두 맞아야 외부로 요청을 보낸다. 하나라도 틀리면 요청 0, 이유만 남긴다.
//  1. 기능 키 `pipelines` 켜짐  2. 기관코드(LAW_API_OC) 있음  3. 원천이 수집 가능(이용 조건 allowed + 견본 계약 확인 — DB data_source_runnable)
export type SkipReason = "flag_off" | "no_oc" | "source_not_runnable";

export interface GateInput {
  flagOn: boolean;
  oc: string | undefined | null;
  sourceRunnable: boolean;
}

export function pipelineGate(input: GateInput): { run: true } | { run: false; reason: SkipReason } {
  if (!input.flagOn) return { run: false, reason: "flag_off" };
  if (!input.oc) return { run: false, reason: "no_oc" };
  if (!input.sourceRunnable) return { run: false, reason: "source_not_runnable" };
  return { run: true };
}
