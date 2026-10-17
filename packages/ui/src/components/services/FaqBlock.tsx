import { useId } from "react";
import { SiteLink } from "./parts";
import { isBlank } from "./format";

export type FaqSource = { label: string; href: string };
export type FaqItem = { id: string; question: string; answer: string; /** 근거 링크 */ sources?: readonly FaqSource[] };

const MIN_ITEMS = 2;
const MAX_ITEMS = 5;

/**
 * 화면에 보일 FAQ 항목 — 질문·답이 빈 항목을 빼고 2~5개일 때만 그대로, 아니면 빈 목록.
 * 구조화 데이터(OPT-02)도 이 함수의 결과로 만든다 — 화면과 다른 FAQ 0 (OPT-10).
 */
export function selectFaqItems(items: readonly FaqItem[]): FaqItem[] {
  const valid = items.filter((i) => !isBlank(i.question) && !isBlank(i.answer));
  return valid.length >= MIN_ITEMS && valid.length <= MAX_ITEMS ? valid : [];
}

/** FAQ 블록 — 기사 본문 아래 질문 2~5개와 답. 세목 아코디언 문법, 답은 펼친 채로 보인다 (숨김 FAQ 0) */
export function FaqBlock({ items, title = "자주 묻는 질문" }: { items: readonly FaqItem[]; title?: string }) {
  const headingId = useId();
  const shown = selectFaqItems(items);
  if (shown.length === 0) return null;

  return (
    <section data-ui="faq-block" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-[22px] font-black text-navy-900">
        {title}
      </h2>
      <ul className="mt-4 space-y-3">
        {shown.map((item) => (
          <li key={item.id}>
            <details open className="group rounded-xl border border-navy-100 bg-white">
              <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500 [&::-webkit-details-marker]:hidden">
                <span data-part="question" className="text-[19px] font-black text-navy-900">{item.question}</span>
                <span aria-hidden="true" className="mt-1 shrink-0 text-navy-500 transition group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <div className="border-t border-navy-50 bg-ivory px-5 py-4">
                <p className="text-[16px] text-navy-800">{item.answer}</p>
                {item.sources && item.sources.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-x-4 text-[15px]">
                    {item.sources.map((s) => (
                      <li key={s.href}>
                        <SiteLink href={s.href}>{s.label}</SiteLink>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
