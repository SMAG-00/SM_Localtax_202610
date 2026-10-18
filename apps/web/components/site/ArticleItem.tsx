import type { ReactNode } from "react";
import { ArticleCard, ArticleTypeBadge, EditorialFieldBadge, PartnerBadge, type EditorialFieldBadgeKind } from "@ltr/ui";
import type { ArticleListItem } from "@/lib/server/public";
import { partnerBadgeFor, typeBadgeFor } from "@/lib/site/article-view";
import { formatBadge } from "@/lib/site/home-view";

// 기사 카드 한 장 (PRD-00 8.6 기사 카드 — 분야 칩·기사 유형 배지·제휴 배지·형식 배지·편집 분야 배지(지역 기사)·기자명·발행일·지역 칩).
// 홈·허브·하위 분야 목록·뉴스 전체·상황 페이지·칼럼 목록·인물 페이지가 같은 카드를 쓴다. 카드 전체가 기사 상세(/news/[slug]) 링크다.
// 표기 배지는 기사 상세 머리와 같은 함수(typeBadgeFor·partnerBadgeFor) — 광고는 '광고', 공동 기획은 '공동 기획 ○○' (ART-10 · NAV-06 '목록·상세 같은 표시')

export type CardItem = Pick<ArticleListItem, "href" | "title" | "summary" | "section" | "subsection" | "publishedOn" | "regionLabel" | "authorName" | "contentType" | "format"> &
  Partial<Pick<ArticleListItem, "editorialField" | "sponsor">>;

const EDITORIAL_FIELDS = new Set<string>(["local_tax", "realestate", "local_finance", "urban_policy"]);

/** 카드의 기사 유형 배지 또는 제휴 배지 — 기사 카드·동영상 카드·기사 상세 머리가 같은 함수(typeBadgeFor·partnerBadgeFor) (ART-10 빠진 곳 0) */
export function cardTypeBadge(item: Pick<CardItem, "contentType" | "sponsor">): ReactNode {
  const type = typeBadgeFor(item.contentType, item.sponsor ?? null);
  const partner = partnerBadgeFor(item.sponsor ?? null);
  return type ? <ArticleTypeBadge type={type} /> : partner ? <PartnerBadge partner={partner} /> : undefined;
}

export function ArticleItem({ item }: { item: CardItem }) {
  const field = item.editorialField && EDITORIAL_FIELDS.has(item.editorialField) ? (item.editorialField as EditorialFieldBadgeKind) : undefined;
  return (
    <ArticleCard
      href={item.href}
      title={item.title}
      summary={item.summary}
      section={item.section}
      subsection={item.subsection ?? undefined}
      publishedAt={item.publishedOn}
      region={item.regionLabel ?? undefined}
      byline={item.authorName ?? undefined}
      typeBadge={cardTypeBadge(item)}
      editorialBadge={field ? <EditorialFieldBadge field={field} /> : undefined}
      format={formatBadge(item.format)}
    />
  );
}

/** 기사 카드 그리드 — 1열 → 640px 2열 → 1024px 3열, 간격 16px (PRD-00 8.5). 카드마다 data-article-id */
export function ArticleGrid({ part, items, children }: { part: string; items: readonly (CardItem & { id: number })[]; children?: ReactNode }) {
  return (
    <ul data-part={part} className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((a) => (
        <li key={a.id} data-article-id={a.id} className="flex">
          <ArticleItem item={a} />
        </li>
      ))}
      {children}
    </ul>
  );
}
