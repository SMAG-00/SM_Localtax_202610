import type { ReactNode } from "react";

/** 견본 한 칸 — 컴포넌트 이름(PRD-00 8.6 그대로)과 예시 */
export function Specimen({ name, children, dark = false }: { name: string; children: ReactNode; dark?: boolean }) {
  return (
    <figure className="min-w-0 rounded-2xl border border-navy-100 bg-white p-6" data-specimen={name}>
      <figcaption className="mb-4 font-mono text-[13px] tracking-wide text-navy-600">{name}</figcaption>
      <div className={dark ? "rounded-xl bg-navy-900 p-6" : ""}>{children}</div>
    </figure>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-6 text-[28px] font-black tracking-tight text-navy-900">{children}</h2>;
}
