// 표본 검사 합격 판정 - DB 함수 quality_sample_passes(마이그레이션 89)와 같은 기준이다(시험이 SQL 파일을 읽어 대조한다). 순수 모듈.
export const QUALITY_KINDS = ["delegation_mapping", "case_citation", "article_pattern"] as const;
export type QualityKind = (typeof QUALITY_KINDS)[number];
export const QUALITY_MIN_SAMPLE: Readonly<Record<QualityKind, number>> = { delegation_mapping: 50, case_citation: 100, article_pattern: 100 };
export const QUALITY_PERCENT = 95;

export function qualityPasses(kind: QualityKind, size: number, matched: number): boolean {
  return size >= QUALITY_MIN_SAMPLE[kind] && matched <= size && matched * 100 >= size * QUALITY_PERCENT;
}
