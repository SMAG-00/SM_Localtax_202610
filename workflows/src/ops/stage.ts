// 개정 단계 후보 규칙 (W10-e - AIOPS-01 · TX-05). 순수 함수 - DB 함수 amendment_candidates_detect와 같은 규칙을 시험으로 고정한다.

export const AMENDMENT_STAGES = ["announced", "pre_notice", "submitted", "passed", "promulgated", "effective"] as const;
export type AmendmentStage = (typeof AMENDMENT_STAGES)[number];

/** 화면·메일에 쓰는 단계 이름 (단계 낱말일 뿐 법 내용 아님) */
export const STAGE_LABELS: Record<AmendmentStage, string> = {
  announced: "발표",
  pre_notice: "입법예고",
  submitted: "국회 제출",
  passed: "의결",
  promulgated: "공포",
  effective: "시행",
};

/** 계산·룰셋에 반영될 수 있는 확정 단계 - 공포·시행뿐 (TX-05) */
export const CONFIRMED_STAGES: readonly AmendmentStage[] = ["promulgated", "effective"];

export const isConfirmedStage = (stage: string): boolean => (CONFIRMED_STAGES as readonly string[]).includes(stage);

/** 룰셋 영향 제안(AIOPS-03)은 공포·시행 단계에서만 - 공포 전 개정에서 제안 0 */
export const canSuggestRulesetImpact = isConfirmedStage;

export interface StageCandidate {
  stage: AmendmentStage;
  occurredOn: string;
  sourceKey: (lawEventId: number) => string;
}

/** 개정판의 공포일·시행일 -> 후보. 공포 후보는 항상, 시행 후보는 시행일이 오늘(한국 날짜) 이하일 때 (문자열 날짜 비교) */
export function proposeStages(version: { promulgatedOn: string; effectiveOn: string }, todayKst: string): StageCandidate[] {
  const out: StageCandidate[] = [{ stage: "promulgated", occurredOn: version.promulgatedOn, sourceKey: (id) => `law_event:${id}:promulgated` }];
  if (version.effectiveOn <= todayKst) out.push({ stage: "effective", occurredOn: version.effectiveOn, sourceKey: (id) => `law_event:${id}:effective` });
  return out;
}
