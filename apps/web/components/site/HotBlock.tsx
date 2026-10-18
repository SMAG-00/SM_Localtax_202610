import { HotBadge, SolvedCaseCard, UiLink } from "@ltr/ui";
import type { HotBlock as HotBlockData } from "@/lib/server/public";
import { hotClickItems } from "@/lib/site/popular-view";
import { MeasureClicks } from "./Measure";
import { TEXT_LINK } from "./SiteSection";

// 상담 사례 HOT (HOME-05 · PRD-01A 3장 '지방세 허브에는 상담 사례 HOT' · '상담 사례 — HOT 배지 목록 · 해결 사례 카드') — 지방세 허브와 상담 사례 분야 목록이 같이 쓴다.
//  · 해결 사례 카드 3장(점수 상위 해결 사례) → HOT 목록 5건(카드에 나온 기사 제외 — 같은 기사 0). HOT 배지는 고정이거나 점수가 있는 줄에만 —
//    최신 상담 사례로 채운 줄은 배지 없음. 홈에는 두지 않는다
//  · HOT 목록을 누르면 hot_article_clicked(기사 번호·목록 순위·고정 여부) 1건
//  · 순서·배지는 1시간 집계(popular-hourly)가 정한다 — 화면은 순위 표의 순서를 그대로 그린다

export function HotBlock({ hot, moreLink }: { hot: HotBlockData; moreLink: boolean }) {
  return (
    <div data-part="hot-block">
      {hot.cards.length > 0 && (
        <ul data-part="hot-cards" className="mt-8 grid gap-4 lg:grid-cols-3">
          {hot.cards.map(({ item, card }) => (
            <li key={item.id} data-article-id={item.id} className="min-w-0">
              <SolvedCaseCard title={item.title} href={item.href} situation={card.situation} issue={card.issue} result={card.result} lesson={card.lesson} />
            </li>
          ))}
        </ul>
      )}
      {hot.list.length > 0 && (
        <MeasureClicks name="hot_article_clicked" items={hotClickItems(hot.list)}>
          <ol data-part="hot-list" aria-label="상담 사례 HOT 목록" className="mt-8 divide-y divide-navy-100 rounded-2xl border border-navy-100 bg-white px-6 py-2">
            {hot.list.map((e) => (
              <li key={e.item.id} data-article-id={e.item.id} data-hot={e.hot ? "true" : "false"} data-pinned={e.pinned ? "true" : "false"}>
                <UiLink
                  href={e.item.href}
                  className="flex min-h-11 items-center gap-3 py-2 text-navy-900 transition hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
                >
                  {e.hot && <HotBadge />}
                  <span className="min-w-0 flex-1 text-[16px] leading-snug font-semibold [overflow-wrap:anywhere]">{e.item.title}</span>
                  <span className="shrink-0 font-mono text-[13px] tracking-wide text-navy-600">{e.item.publishedOn}</span>
                </UiLink>
              </li>
            ))}
          </ol>
        </MeasureClicks>
      )}
      {moreLink && (
        <p className="mt-6">
          <UiLink href={hot.href} className={TEXT_LINK}>
            상담 사례 전체 보기
          </UiLink>
        </p>
      )}
    </div>
  );
}
