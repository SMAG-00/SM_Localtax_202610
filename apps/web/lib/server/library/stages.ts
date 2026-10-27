// 이관 단계 순수 정의 (W13-a a2) - DB 상태기계(마이그레이션 192)와 같은 순서. 서버 전용 모듈에 의존하지 않아 단위 시험이 바로 읽는다.
export const DIGITIZE_STAGES = ["rights_confirmed", "extracted", "structured", "proofread", "approved"] as const;
export type DigitizeStage = (typeof DIGITIZE_STAGES)[number];
export const TARGET_KINDS = ["node", "issue", "issue_article"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** 다음 단계 이름 - 교정 단계와 승인 단계에서는 null (승인은 승인 함수로만) */
export function nextStage(stage: DigitizeStage): DigitizeStage | null {
  const i = DIGITIZE_STAGES.indexOf(stage);
  return i >= 0 && i < DIGITIZE_STAGES.length - 2 ? DIGITIZE_STAGES[i + 1]! : null;
}
