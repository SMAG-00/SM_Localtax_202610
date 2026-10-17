import type { ReactNode } from "react";
import { Eyebrow, cx } from "@ltr/ui";
import type { SectionTone } from "@/lib/site/home-view";

// 공개 화면 섹션 틀 — 세로 여백 80px(R7), 바탕은 보이는 순서대로 ivory와 ivory-dark를 번갈아, 경계에 navy-100 선 (PRD-00 8.5).
// 머리(아이브로·제목)를 주면 제목이 섹션 이름이 된다(aria-labelledby). data 속성은 E2E가 화면 골격을 비교하는 표식이다.

export function SiteSection({
  id,
  tone,
  heading,
  data,
  first = false,
  children,
}: {
  id: string;
  tone: SectionTone;
  heading?: { eyebrow: string; title: string };
  data: Record<`data-${string}`, string>;
  /** 화면 첫 섹션 — 위 경계선 없음 */
  first?: boolean;
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <section {...data} aria-labelledby={heading ? titleId : undefined} className={cx(!first && "border-t border-navy-100", tone === "ivory" ? "bg-ivory" : "bg-ivory-dark")}>
      <div className="mx-auto max-w-5xl px-4 py-20">
        {heading && (
          <>
            <Eyebrow>{heading.eyebrow}</Eyebrow>
            <h2 id={titleId} className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900 sm:text-[32px]">
              {heading.title}
            </h2>
          </>
        )}
        {children}
      </div>
    </section>
  );
}

/** 밝은 바탕 글자 링크 — navy-900 글자 + 오렌지 밑줄, 터치 44px (PRD-00 8.6 링크 문법) */
export const TEXT_LINK =
  "inline-flex min-h-11 items-center text-[15px] font-bold text-navy-900 underline decoration-hermes-500 decoration-2 underline-offset-4 transition hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";
