import { Chip } from "../base";

/** 지역 기사의 편집 분야 `editorial_field` (PRD-01B REG1-17) */
export type EditorialFieldBadgeKind = "local_tax" | "realestate" | "local_finance" | "urban_policy";

export const EDITORIAL_FIELD_BADGE_LABELS: Readonly<Record<EditorialFieldBadgeKind, string>> = {
  local_tax: "지방세",
  realestate: "부동산 세금",
  local_finance: "지방재정",
  urban_policy: "도시·부동산 정책",
};

/**
 * 편집 분야 배지 — 칩 문법 그대로(새 색 없음). 색이 아니라 글자로 구분한다 (PRD-00 8.6).
 * 지역 기사 카드·기사 머리·공유 미리보기에서 기사 유형 배지 옆에 둔다.
 */
export function EditorialFieldBadge({ field }: { field: EditorialFieldBadgeKind }) {
  return (
    <span data-ui="editorial-field-badge" data-field={field} className="inline-flex align-middle">
      <Chip>{EDITORIAL_FIELD_BADGE_LABELS[field]}</Chip>
    </span>
  );
}
