// 맞춤 브리핑 항목 선정 (W13-d, WS-06) - 순수 규칙. 새 문장을 만들지 않고 공개 상태 콘텐츠의 번호만 고른다.
// 같은 후보 집합이면 입력 순서와 관계없이 같은 결과: 이유 우선순위 -> 최신(기준일) -> 번호 오름차순.

export const BRIEFING_REASONS = ["saved_search", "region", "interest", "case_summary"] as const;
export type BriefingReason = (typeof BRIEFING_REASONS)[number];
export type BriefingItemType = "article" | "case_summary";

export interface BriefingCandidate {
  type: BriefingItemType;
  id: number;
  reason: BriefingReason;
  /** 기준일 YYYY-MM-DD (공개일 또는 승인일, 한국 날짜) */
  basisOn: string;
}
export interface BriefingItem {
  type: BriefingItemType;
  id: number;
  reason: BriefingReason;
  basis_on: string;
}

const RANK: Record<BriefingReason, number> = { saved_search: 0, region: 1, interest: 2, case_summary: 3 };

/** 같은 (종류, 번호)는 우선순위가 높은 이유 하나만 남기고, 상위 max건. max가 0 이하이거나 정수가 아니면 빈 목록 */
export function selectBriefingItems(candidates: readonly BriefingCandidate[], max: number): BriefingItem[] {
  if (!Number.isInteger(max) || max <= 0) return [];
  const best = new Map<string, BriefingCandidate>();
  for (const c of candidates) {
    if (!Number.isInteger(c.id) || c.id <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(c.basisOn)) continue;
    const key = `${c.type}:${c.id}`;
    const prev = best.get(key);
    if (!prev || RANK[c.reason] < RANK[prev.reason]) best.set(key, c);
  }
  return [...best.values()]
    .sort((a, b) => RANK[a.reason] - RANK[b.reason] || (a.basisOn < b.basisOn ? 1 : a.basisOn > b.basisOn ? -1 : 0) || a.id - b.id || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
    .slice(0, max)
    .map((c) => ({ type: c.type, id: c.id, reason: c.reason, basis_on: c.basisOn }));
}

/** 설정 {"max_items": n} 읽기 - 비어 있거나 틀린 값은 0(닫힘) */
export function parseBriefingMax(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const n = (value as Record<string, unknown>).max_items;
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 50 ? n : 0;
}
