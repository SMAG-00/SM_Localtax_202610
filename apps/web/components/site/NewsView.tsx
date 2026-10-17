import { FieldHubHead, UiLink } from "@ltr/ui";
import type { NewsListData } from "@/lib/server/public";
import { pagerLinks } from "@/lib/site/hub-view";
import { ArticleGrid } from "./ArticleItem";
import { Pager } from "./Pager";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 뉴스 전체 (/news — CAT-02 · PRD-01A 3장) — 허브와 같은 머리(분야 허브 머리 + [전체]·허브 탭 4개)와 편집 승인된 취재 기사(reported_news) 카드만.
// 해설·칼럼·광고·금주 핫뉴스는 0 (각 분야 허브에서 기사 유형 배지와 함께 나온다). 편집 원칙·정정·반론 창구 링크는 정책 페이지가 공개 승인된 것만.
// 기자별 보기(인물 페이지 /people/[slug])는 4단계에서 인물 화면과 함께 붙인다.

export const NEWS_EYEBROW = "NEWS";
export const NEWS_TITLE = "뉴스 전체";
export const NEWS_INTRO = "편집국이 직접 취재하고 편집 승인한 기사만 모았습니다.";

export function NewsView({ news }: { news: NewsListData }) {
  const { prev, next } = pagerLinks("/news", { section: news.section }, news.page, news.hasMore);
  return (
    <div data-ui="news-list" data-section={news.section ?? "all"}>
      <SiteSection id="news-head" tone="ivory" first data={{ "data-hub-part": "head" }}>
        <FieldHubHead field="news" eyebrow={NEWS_EYEBROW} title={NEWS_TITLE} intro={NEWS_INTRO} tabs={{ items: news.tabs, current: news.currentTab, label: "분야" }} />
      </SiteSection>
      <SiteSection id="news-items" tone="ivory-dark" heading={{ eyebrow: "REPORTS", title: news.total ? `취재 기사 ${news.total}건` : "아직 취재 기사가 없습니다" }} data={{ "data-hub-part": "latest" }}>
        {news.items.length > 0 && <ArticleGrid part="news-articles" items={news.items} />}
        <Pager page={news.page} total={news.total} prev={prev} next={next} />
        {news.policyLinks.length > 0 && (
          <nav aria-label="편집 원칙과 정정 창구" className="mt-10 flex flex-wrap gap-x-6">
            {news.policyLinks.map((l) => (
              <UiLink key={l.key} href={l.href} className={TEXT_LINK}>
                {l.label}
              </UiLink>
            ))}
          </nav>
        )}
      </SiteSection>
    </div>
  );
}
