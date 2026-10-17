import { FieldHubHead, UiLink } from "@ltr/ui";
import type { CategoryListData } from "@/lib/server/public";
import { pagerLinks } from "@/lib/site/hub-view";
import { ArticleGrid } from "./ArticleItem";
import { Pager } from "./Pager";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 하위 분야 목록 (CAT-02 · PRD-01A 3장 '하위 분야 목록') — 허브와 같은 머리(분야 허브 머리 + 허브 탭, 지금 하위 분야가 고른 탭)와 기사 카드 목록.
// 기사 0건이면 목록 대신 상위 허브 안내 — 이 주소는 noindex이고 탭·메뉴에는 없다 (화면 metadata가 정한다).
// 분야 고유 목록(트래커·프로젝트·사례)·기간·지역 필터는 01B·뒤 단계가 더한다 (설계 9장).

export function CategoryView({ list }: { list: CategoryListData }) {
  const { prev, next } = pagerLinks(`${list.hubHref}/${list.category.slug}`, {}, list.page, list.hasMore);
  const empty = list.total === 0;
  return (
    <div data-ui="category-list" data-section={list.section} data-category={list.category.slug}>
      <SiteSection id="category-head" tone="ivory" first data={{ "data-hub-part": "head" }}>
        <FieldHubHead
          field={list.section}
          eyebrow={list.hub.eyebrow}
          title={list.category.name}
          intro={list.category.intro}
          tabs={{ items: list.tabs, current: list.category.slug, label: "하위 분야" }}
        />
      </SiteSection>
      <SiteSection
        id="category-list"
        tone="ivory-dark"
        heading={{ eyebrow: "ARTICLES", title: empty ? "아직 기사가 없습니다" : `기사 ${list.total}건` }}
        data={{ "data-hub-part": "latest" }}
      >
        {empty ? (
          <div data-part="empty-guide" className="mt-6 space-y-2">
            <p className="text-[17px] text-navy-700">{`${list.category.name}에는 아직 공개된 기사가 없습니다. ${list.hub.name} 허브에서 다른 기사를 보세요.`}</p>
            <UiLink href={list.hubHref} className={TEXT_LINK}>
              {`${list.hub.name} 허브로 가기`}
            </UiLink>
          </div>
        ) : (
          <>
            <ArticleGrid part="category-articles" items={list.items} />
            <Pager page={list.page} total={list.total} prev={prev} next={next} />
          </>
        )}
      </SiteSection>
    </div>
  );
}
