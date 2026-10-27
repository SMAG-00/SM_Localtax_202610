"use client";

// 3단 보기 인쇄 버튼 (LAW-09) - 브라우저 인쇄 창을 연다. 인쇄 규칙은 LawThreeView의 style에 있다.
export function PrintButton() {
  return (
    <button type="button" data-part="print-button" onClick={() => window.print()} className="rounded-lg border border-navy-300 bg-white px-3 py-1.5 text-[14px] font-bold text-navy-900 print:hidden">
      인쇄 (A4 가로)
    </button>
  );
}
