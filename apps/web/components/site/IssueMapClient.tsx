"use client";

import { useEffect, useState, type ReactNode } from "react";
import { track } from "@/lib/analytics/client";

// 쟁점 연결 지도 클라이언트 부품 (LINK-01, W11-d). 둘 다 서버가 그린 내용을 바꾸지 않는다.

/** 640px 미만에서만 그림을 접어 둔다 - 표가 먼저이고 그림은 [그림 보기]로 펼친다. 그림은 한 벌만 그려 상자·선 수가 어긋나지 않는다. 넓은 화면은 늘 펼쳐져 있다 */
export function FigureToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-part="figure-toggle">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="issue-figure"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 rounded-lg border border-navy-200 px-3 py-2 text-[14px] font-bold text-navy-900 sm:hidden"
      >
        {open ? "그림 접기" : <>그림<span className="sr-only"> 보기</span></>}
      </button>
      <div id="issue-figure" className={`${open ? "block" : "hidden"} sm:block`}>
        {children}
      </div>
    </div>
  );
}

/** 640px 미만에서만 표를 접어 둔다(첫 화면 글자 밀도 R1) - [표 보기]로 펼친다. 표는 DOM에 그대로 있어 읽기 도구·행 수 검사는 같다. 넓은 화면은 늘 펼쳐져 있다 */
export function TableToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-part="table-toggle">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="issue-tables"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 rounded-lg border border-navy-200 px-3 py-2 text-[14px] font-bold text-navy-900 sm:hidden"
      >
        {open ? "표 접기" : <>표<span className="sr-only"> 보기</span></>}
      </button>
      <div id="issue-tables" className={`${open ? "block" : "hidden"} sm:block`}>
        {children}
      </div>
    </div>
  );
}

/** 조문 상자·표의 원문 링크를 누르면 issue_map_source_opened 1건 - 쟁점 주소, 법령 번호, 관계 라벨뿐(개인 정보·입력값 0). 결정례 링크는 법령 번호가 없어 보내지 않는다 */
export function MeasureIssueSources({ issue }: { issue: string }) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-source-law]");
      if (!el) return;
      const lawId = Number(el.getAttribute("data-source-law"));
      const relation = el.getAttribute("data-source-relation");
      if (!Number.isInteger(lawId) || lawId <= 0 || !relation) return;
      void track("issue_map_source_opened", { section: "realestate", props: { issue, law_id: lawId, relation }, keepalive: true });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [issue]);
  return null;
}
