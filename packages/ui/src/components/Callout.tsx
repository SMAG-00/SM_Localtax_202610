import type { ReactNode } from "react";
import { cx } from "./cx";

/** 강조 문단 — 왼쪽 hermes-500 2px 선 */
export function Callout({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p data-ui="callout" className={cx("border-l-2 border-hermes-500 pl-3 text-[15px] text-navy-600", className)}>
      {children}
    </p>
  );
}
