"use client";

import { useState, type ReactNode } from "react";

// 3단 보기의 모바일 탭 3개 (LAW-05) - 768px 미만에서는 탭으로 열을 하나씩, 이상에서는 3열을 모두 보인다.
// 열 칸은 서버가 그린 요소(data-col)이고 이 컴포넌트는 어느 열이 보이는지만 정한다.
export function ThreeTabs({ labels, children }: { labels: readonly [string, string, string]; children: ReactNode }) {
  const [active, setActive] = useState(0);
  return (
    <div data-part="three-tabs" data-active={active} className="[&_[data-col]]:max-md:hidden data-[active='0']:[&_[data-col='0']]:max-md:block data-[active='1']:[&_[data-col='1']]:max-md:block data-[active='2']:[&_[data-col='2']]:max-md:block">
      <div role="tablist" aria-label="법령 단" className="mb-3 flex gap-1 md:hidden">
        {labels.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={active === i}
            onClick={() => setActive(i)}
            className={`flex-1 rounded-full px-3 py-1.5 text-[14px] font-bold ${active === i ? "bg-navy-900 text-white" : "border border-navy-200 text-navy-900"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
