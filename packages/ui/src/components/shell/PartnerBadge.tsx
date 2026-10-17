/**
 * 제휴 배지 — "공동 기획 ○○" (PRD-00 8.6, PRD-01A ART-10). 광고는 이 배지가 아니라 기사 유형 배지 "광고"로 따로 표기한다 — 둘을 섞지 않는다 (8.8).
 */
export function PartnerBadge({ partner }: { partner: string }) {
  const name = partner.trim();
  return (
    <span data-ui="partner-badge" className="inline-flex items-center rounded-md border border-navy-200 bg-white px-2 py-0.5 text-[13px] font-bold text-navy-700">
      {name ? `공동 기획 ${name}` : "공동 기획"}
    </span>
  );
}
