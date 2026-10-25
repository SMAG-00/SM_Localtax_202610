// 다음 한 걸음 사다리 (읽기 -> 계산 -> 상담 -> 구독, W10-i 설계 8장) - 글자와 도착을 한 곳에. 금액·입력값은 싣지 않는다
export const NEXT_STEPS = {
  /** /realestate/weekly 끝, 브리핑 호 화면 끝(IssueView에 이미 있는 /calc 카드를 이 단계로 쓴다) */
  read_to_calc: { label: "이 내용으로 계산해 보기", href: "/calc", shortcut: "calc" },
  /** 계산 결과 6번 칸 (GROW-06) - 쿼리는 source·field만 */
  calc_to_consult: { label: "SM 전문가에게 상담 요청", href: "/experts/request", shortcut: "expert_request" },
  /** 상담 요청 접수 완료 화면 */
  consult_to_brief: { label: "주간 브리핑 받아 보기", href: "/brief/subscribe", shortcut: "brief_weekly" },
} as const;
export type NextStepKey = keyof typeof NEXT_STEPS;

/** 계산 결과 -> 상담 요청 링크 - 쿼리 키는 source=calc_result 와 field 둘뿐 (입력값 0) */
export function calcResultConsultHref(field: "tax" | "realestate" | "finance" | "local"): string {
  return `${NEXT_STEPS.calc_to_consult.href}?${new URLSearchParams({ source: "calc_result", field }).toString()}`;
}
