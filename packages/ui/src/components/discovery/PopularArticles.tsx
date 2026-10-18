import { useId } from "react";
import { UiLink } from "../link";

export type PopularArticleItem = { href: string; title: string };

export type PopularArticlesProps = {
  /** 순위 순서대로 (최근 7일 사람 조회 수 — ART-11 집계 결과) */
  items: PopularArticleItem[];
  /** 보일 건수 — 기사 사이드바 5(기본) · /news/popular 20 */
  limit?: number;
};

/**
 * 많이 본 기사 목록 — 순위 숫자(고정폭, navy-300) + 제목 한 줄, "최근 7일 기준" (PRD-00 8.6, ART-11)
 * 순위 숫자는 20px 굵은 글자(큰 글자 기준 3:1 — navy-300/흰 바탕 3.2:1)로 쓴다. 0건이면 목록 전체를 숨긴다.
 * 항목은 사이트 안 링크(UiLink — 앱이 넘긴 링크로 새로고침 없는 화면 전환, FND-09)
 */
export function PopularArticles({ items, limit = 5 }: PopularArticlesProps) {
  const headingId = useId();
  const shown = items.slice(0, Math.max(0, limit));
  if (shown.length === 0) return null;
  return (
    <section data-ui="popular-articles" aria-labelledby={headingId} className="min-w-0 rounded-2xl border border-navy-100 bg-white p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-[19px] font-black text-navy-900">
          많이 본 기사
        </h2>
        <p className="font-mono text-[13px] tracking-wide text-navy-600">최근 7일 기준</p>
      </div>
      <ol className="mt-3 divide-y divide-navy-100">
        {shown.map((item, i) => (
          <li key={item.href}>
            <UiLink
              href={item.href}
              data-rank={i + 1}
              className="flex min-h-11 items-center gap-3 py-2 text-navy-900 transition hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
            >
              <span data-rank-number className="w-7 shrink-0 text-right font-mono text-[20px] font-bold text-navy-300 tabular-nums">
                {i + 1}
              </span>
              {/* contain-inline-size: 한 줄(nowrap) 제목이 부모 격자 칸의 최소 너비를 키우지 않게 고유 너비를 0으로 둔다 */}
              <span className="min-w-0 flex-1 truncate text-[16px] font-semibold contain-inline-size">{item.title}</span>
            </UiLink>
          </li>
        ))}
      </ol>
    </section>
  );
}
