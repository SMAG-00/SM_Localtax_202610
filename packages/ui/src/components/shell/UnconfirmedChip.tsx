/**
 * `확정 아님` 칩 — 칩 문법(navy-50 바탕 · navy-700 글자, 12.4:1). 개정 트래커의 공포 전 단계와
 * 연결된 개정 브리핑 기사 머리·홈 하이라이트에 붙인다. 공포 뒤에는 렌더하지 않는다 — 판단은 쓰는 쪽(진행 단계 배지 등)이 한다 (PRD-00 8.6, TX-08).
 */
export function UnconfirmedChip() {
  return (
    <span data-ui="unconfirmed-chip" className="inline-flex items-center rounded-md border border-navy-100 bg-navy-50 px-2.5 py-1 text-[13px] font-bold text-navy-700">
      확정 아님
    </span>
  );
}
