import type { ReactNode } from "react";
import { cx } from "./cx";

/** 아이브로 — 12px 700 영문 대문자, 앞에 오렌지 선. 밝은 바탕 hermes-800, 어두운 바탕 hermes-400 (8.4) */
export function Eyebrow({ children, tone = "light", className }: { children: ReactNode; tone?: "light" | "dark"; className?: string }) {
  return (
    <p
      data-ui="eyebrow"
      className={cx("flex items-center gap-3 text-[12px] font-bold uppercase tracking-[0.2em]", tone === "dark" ? "text-hermes-400" : "text-hermes-800", className)}
    >
      <span aria-hidden="true" className="h-px w-6 bg-hermes-500" />
      <span>{children}</span>
    </p>
  );
}
