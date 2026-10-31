import { FieldHubHead } from "@ltr/ui";
import type { AllColumnsData } from "@/lib/server/public";
import { pagerLinks } from "@/lib/site/hub-view";
import { ArticleGrid } from "./ArticleItem";
import { Pager } from "./Pager";
import { SiteSection } from "./SiteSection";

// 전문가칼럼 (/columns — 헤더 바로 메뉴, PO 2026-11-01) — 뉴스 전체와 같은 골격(머리 + [전체]·허브 탭 4개)에 공개된 칼럼(opinion) 카드만.
// 칼럼이 아직 없어도 404가 아니라 빈 안내 — 헤더 메뉴에서 오는 화면이라 빈 링크가 되지 않게 한다.

export const COLUMNS_EYEBROW = "COLUMN";
export const COLUMNS_TITLE = "전문가칼럼";
export const COLUMNS_INTRO = "세무사·회계사 등 전문가가 쓴 칼럼을 모았습니다. 칼럼은 필자의 의견입니다.";

export function ColumnsView({ columns }: { columns: AllColumnsData }) {
  const { prev, next } = pagerLinks("/columns", { section: columns.section }, columns.page, columns.hasMore);
  return (
    <div data-ui="columns-list" data-section={columns.section ?? "all"}>
      <SiteSection id="columns-head" tone="ivory" first data={{ "data-hub-part": "head" }}>
        <FieldHubHead field="news" eyebrow={COLUMNS_EYEBROW} title={COLUMNS_TITLE} intro={COLUMNS_INTRO} tabs={{ items: columns.tabs, current: columns.currentTab, label: "분야" }} />
      </SiteSection>
      <SiteSection id="columns-items" tone="ivory-dark" heading={{ eyebrow: "COLUMNS", title: columns.total ? `칼럼 ${columns.total}편` : "아직 칼럼이 없습니다" }} data={{ "data-hub-part": "latest" }}>
        {columns.items.length > 0 && <ArticleGrid part="columns-articles" items={columns.items} />}
        <Pager page={columns.page} total={columns.total} prev={prev} next={next} />
      </SiteSection>
    </div>
  );
}
