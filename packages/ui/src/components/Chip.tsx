import type { ReactNode } from "react";
import { cx } from "./cx";

/** 칩 — 조문·분야·지역 표시 (13px 700) */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span data-ui="chip" className={cx("inline-flex items-center rounded-md border border-navy-100 bg-ivory px-2.5 py-1 text-[13px] font-bold text-navy-700", className)}>
      {children}
    </span>
  );
}
