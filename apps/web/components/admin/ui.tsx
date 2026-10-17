// 백오피스 공용 조각 — packages/ui 토큰·문법(PRD-00 8.6)으로 만든 편집국 전용 표시 요소. 공개 화면에는 쓰지 않는다.
// 색은 토큰 클래스만, 상태는 색에 더해 글자로 전한다 (8.9).
import type { ReactNode } from "react";
import { cx } from "@ltr/ui";

const TONES = {
  navy: "border-navy-200 bg-navy-50 text-navy-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
  plain: "border-navy-200 bg-white text-navy-800",
} as const;
export type Tone = keyof typeof TONES;

/** 상태 칩 — 글자로 뜻을 전한다 (13px 700) */
export function ToneChip({ tone = "navy", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center rounded-md border px-2.5 py-0.5 text-[13px] font-bold", TONES[tone], className)}>{children}</span>;
}

/** 카드 섹션 — 흰 카드(안쪽 24px, R7) + 제목. id는 제목 앵커 */
export function Panel({ id, title, description, children, className }: { id: string; title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cx("scroll-mt-4 rounded-2xl border border-navy-100 bg-white p-6", className)}>
      <h2 id={`${id}-title`} className="text-[19px] font-black text-navy-900">
        {title}
      </h2>
      {description && <div className="mt-1 text-[15px] text-navy-600">{description}</div>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/** 화면 제목 */
export function PageTitle({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-black tracking-tight text-navy-900">{title}</h1>
        {description && <p className="mt-1 text-[15px] text-navy-600">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/** 표 — 표만 가로로 넘친다(페이지 가로 스크롤 0). caption은 화면 읽기용 */
export function DataTable({ caption, head, children }: { caption: string; head: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-navy-100 bg-white">
      <table className="w-full min-w-[40rem] border-collapse text-left text-[15px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-ivory text-[13px] font-bold text-navy-600">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="border-b border-navy-100 px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const TD = "border-b border-navy-100 px-4 py-3 align-top text-navy-800";

/** 밝은 바탕 글자 링크 (SM 링크 문법 — hermes-800 밑줄). 터치 44px */
export const TEXT_LINK =
  "inline-flex min-h-11 items-center font-bold text-hermes-800 underline underline-offset-4 hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

/** 작은 보조 버튼 (흰 바탕 위 테두리) — 블록 옮기기·지우기 같은 작은 작업. 주 버튼이 아니다 */
export const OUTLINE_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-navy-200 bg-white px-4 py-2 text-[15px] font-bold text-navy-800 transition hover:border-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500 disabled:cursor-not-allowed disabled:opacity-50";

/** 고정폭 글자 (버전·날짜·근거 번호) */
export const MONO = "font-mono text-[13px] tracking-wide";

/** 비어 있음 안내 */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-navy-200 bg-ivory px-4 py-3 text-[15px] text-navy-600">{children}</p>;
}
