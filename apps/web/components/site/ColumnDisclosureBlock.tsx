import type { ColumnDisclosure } from "@/lib/server/public";

// 칼럼 상세의 이해관계 줄 + 의견 고지 1개 (TX-16·17 — docs/dev/W3_설계.md 5장). 문구는 설정값(PO 감수본)과 편집국 입력값 — 여기엔 글자를 두지 않는다.
export function ColumnDisclosureBlock({ disclosure }: { disclosure: ColumnDisclosure | null }) {
  if (!disclosure) return null;
  return (
    <aside data-part="column-disclosure" aria-label="칼럼 고지" className="mx-auto mt-6 w-full max-w-[860px] rounded-2xl border border-navy-100 bg-white px-6 py-4">
      <p data-part="column-interest" className="text-[15px] text-navy-800">
        {disclosure.interestLine}
      </p>
      <p data-part="column-opinion-notice" className="mt-2 text-[15px] font-bold text-navy-700">
        {disclosure.notice}
      </p>
    </aside>
  );
}
