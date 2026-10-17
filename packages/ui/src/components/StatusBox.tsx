import type { ReactNode } from "react";
import { cx } from "./cx";

const KIND = {
  /** 절세 체크포인트·해당될 수 있는 감면 */
  tip: "border-emerald-200 bg-emerald-50",
  /** 자주 틀리는 점 — rose는 이 상자에만 쓴다 (R9) */
  mistake: "border-rose-200 bg-rose-50",
} as const;

/** 상태 상자 — 색과 함께 제목 글자로 뜻을 전한다 (8.9) */
export function StatusBox({ kind, title, children }: { kind: keyof typeof KIND; title: string; children: ReactNode }) {
  return (
    <section data-ui="status-box" data-kind={kind} className={cx("rounded-2xl border p-6", KIND[kind])}>
      <h3 className="text-[17px] font-black text-navy-900">{title}</h3>
      <div className="mt-2 text-[15px] text-navy-800">{children}</div>
    </section>
  );
}
