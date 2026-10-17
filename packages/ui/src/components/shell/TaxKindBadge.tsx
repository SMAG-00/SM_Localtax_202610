import { cx } from "../base";

export type TaxKindBadgeKind = "local" | "national" | "other";

/** 글자와 색 — 색에 더해 글자로 뜻을 전한다 (PRD-00 8.9). 대비는 8.3 표의 [법]·[해]·[심] 칩 조합과 같다 */
const KIND: Record<TaxKindBadgeKind, { label: string; className: string }> = {
  /** 흰 글자 / navy-900 — 17.9:1 */
  local: { label: "지방세", className: "border border-navy-900 bg-navy-900 text-white" },
  /** navy-800 / ivory-dark — 13.1:1 */
  national: { label: "국세", className: "border border-navy-200 bg-ivory-dark text-navy-800" },
  /** navy-700 / navy-50 — 12.4:1 (SM 세목 아코디언의 '기타') */
  other: { label: "기타", className: "border border-navy-100 bg-navy-50 text-navy-700" },
};

/**
 * 국세·지방세 배지 — SM 세목 아코디언의 배지(지방세·국세·기타)를 단독 컴포넌트로 뺐다 (PRD-00 8.6).
 * 상속·증여 안내·기사·상황 카드의 제목 옆에 최종 감수일과 함께 둔다.
 */
export function TaxKindBadge({ kind, reviewedAt }: { kind: TaxKindBadgeKind; reviewedAt?: string }) {
  const { label, className } = KIND[kind];
  return (
    <span data-ui="tax-kind-badge" data-kind={kind} className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 align-middle">
      <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-bold", className)}>{label}</span>
      {reviewedAt?.trim() && <span className="font-mono text-[13px] tracking-wide text-navy-600">최종 감수 {reviewedAt.trim()}</span>}
    </span>
  );
}
