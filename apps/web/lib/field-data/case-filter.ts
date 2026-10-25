// 금융 사례 DB 구조 유형 필터 (W10-h h4 - PRD-02 DF-07). 순수 함수 - 필터를 걸면 결과가 모두 그 유형이고, 0건이면 안내 문구와 필터 해제를 낸다.
export const CASE_STRUCTURE_TYPES = ["trust", "completion_guarantee", "pf_stage", "reit"] as const;
export type CaseStructureType = (typeof CASE_STRUCTURE_TYPES)[number];

export const NO_MATCHING_CASES = "조건에 맞는 사례가 없어요";

export interface CaseEntryLike {
  structure_type: string;
  issues: readonly string[];
}

export interface CaseFilter {
  structureType?: string | null;
  issue?: string | null;
}

export function filterCaseEntries<T extends CaseEntryLike>(rows: readonly T[], filter: CaseFilter): { rows: T[]; message: string | null; canClear: boolean } {
  const type = filter.structureType && (CASE_STRUCTURE_TYPES as readonly string[]).includes(filter.structureType) ? filter.structureType : null;
  const issue = filter.issue?.trim() ? filter.issue.trim() : null;
  const out = rows.filter((r) => (type === null || r.structure_type === type) && (issue === null || r.issues.includes(issue)));
  const filtered = type !== null || issue !== null;
  return { rows: out, message: out.length === 0 && filtered ? NO_MATCHING_CASES : null, canClear: filtered };
}
