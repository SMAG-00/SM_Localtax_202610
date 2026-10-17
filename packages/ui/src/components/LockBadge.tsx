import type { ReactNode } from "react";

/** 잠금 배지 — 구독·회원 전용 표시 */
export function LockBadge({ children }: { children: ReactNode }) {
  return (
    <span data-ui="lock-badge" className="inline-flex items-center rounded-full bg-navy-900 px-3.5 py-1.5 text-[13px] font-bold text-hermes-300">
      {children}
    </span>
  );
}
