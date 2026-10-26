// 통계 수집 관문 (W12-h h2) - 네 조건이 모두 맞아야 외부로 요청을 보낸다. 하나라도 틀리면 요청 0, 이유만 남긴다.
//  1. 기능 키 data_stories 켜짐  2. 인증키 있음  3. 요청 주소 칸이 채워짐  4. 원천이 수집 가능(이용 조건 allowed + 견본 계약 확인 - DB data_source_runnable)
export type StatsSkipReason = "flag_off" | "no_key" | "no_endpoint" | "source_not_runnable";

export interface StatsGateInput {
  flagOn: boolean;
  hasKey: boolean;
  endpointSet: boolean;
  sourceRunnable: boolean;
}

export function statsGate(input: StatsGateInput): { run: true } | { run: false; reason: StatsSkipReason } {
  if (!input.flagOn) return { run: false, reason: "flag_off" };
  if (!input.hasKey) return { run: false, reason: "no_key" };
  if (!input.endpointSet) return { run: false, reason: "no_endpoint" };
  if (!input.sourceRunnable) return { run: false, reason: "source_not_runnable" };
  return { run: true };
}
