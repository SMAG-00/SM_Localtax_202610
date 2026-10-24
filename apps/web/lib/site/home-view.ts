// 홈 화면 값 (HOME-01 · HOME-03 · HOME-04 · PRD-01A 3장 홈 골격) — 순수 함수 (시험 home-view.test.ts)
//  · 섹션 순서·내용 0건 숨김은 홈 데이터(getHomeData — home-logic.ts)가 정한다. 여기는 그 목록을 화면 값으로만 바꾼다
//  · 섹션 바탕은 보이는 섹션 순서대로 ivory ↔ ivory-dark (PRD-01A 3장 — 히어로 다음 첫 섹션이 ivory)
//  · 형식 배지는 기사 형식 값과 1:1, 일반 기사는 배지 0 (HOME-03)
import { ARTICLE_TYPE_BADGE_LABELS, type ArticleFormat, type ArticleTypeBadgeKind } from "@ltr/ui";
import type { HomeSectionKey } from "@/lib/server/public/constants";

/** 핵심 메시지에서 hermes-400으로 칠할 낱말 — 설정 home_core_highlights가 정한다 (PRD-00 8.10). 설정이 비었을 때(아직 안 넣음)만 쓰는 기본값 */
export const HERO_HIGHLIGHT_FALLBACK: readonly string[] = ["지방세"];
/** 칠할 낱말 목록 — 설정 값이 있으면 그것, 없으면 기본값 */
export const heroHighlights = (fromSettings: readonly string[]): readonly string[] => (fromSettings.length ? fromSettings : HERO_HIGHLIGHT_FALLBACK);
/** 홈 큰 입력창 라벨·안내 — 첫 화면 150자(R1)에 들어간다 */
export const SEARCH_LABEL = "검색어";
export const SEARCH_PLACEHOLDER = "예: 2026년 지방세제 개편안";

type BodySectionKey = Exclude<HomeSectionKey, "hero">;

/** 섹션 머리 — 아이브로(영문)와 제목. 제목은 PRD 화면 표의 섹션 이름 그대로 */
export const SECTION_HEADINGS: Readonly<Record<BodySectionKey, { eyebrow: string; title: string }>> = {
  fields: { eyebrow: "FIELDS", title: "4대 분야" },
  latest_reports: { eyebrow: "NEWS", title: "최신 자체 취재" },
  weekly_hot: { eyebrow: "THIS WEEK", title: "금주 핫뉴스" },
  amendments: { eyebrow: "AMENDMENTS", title: "개정 트래커 하이라이트" },
  column: { eyebrow: "COLUMN", title: "김의효 칼럼" },
  product: { eyebrow: "PRODUCT", title: "자사 상품" },
  experts: { eyebrow: "EXPERTS", title: "분야별 전문가 소개" },
};

export type SectionTone = "ivory" | "ivory-dark";

/** 히어로 밖 섹션의 바탕 — 보이는 순서대로 번갈아 (빠진 섹션은 세지 않는다) */
export function sectionTones<K extends string>(keys: readonly K[]): Array<{ key: K; tone: SectionTone }> {
  return keys.filter((k) => k !== "hero").map((key, i) => ({ key, tone: i % 2 === 0 ? "ivory" : "ivory-dark" }));
}

const FORMAT_LABELS: Readonly<Record<string, ArticleFormat>> = {
  cardnews: "카드뉴스",
  infographic: "인포그래픽",
  video: "동영상",
  photo: "포토",
};

/** 기사 형식 값(articles.format) → 형식 배지 글자. 일반(general)·없음·모르는 값은 배지 0 */
export function formatBadge(format: string | null | undefined): ArticleFormat | undefined {
  return format ? FORMAT_LABELS[format] : undefined;
}

/** 기사 유형 값(content_type) → 기사 유형 배지 종류. 모르는 값·유형 미분류는 배지 0 */
export function typeBadgeKind(contentType: string | null | undefined): ArticleTypeBadgeKind | undefined {
  return contentType && Object.hasOwn(ARTICLE_TYPE_BADGE_LABELS, contentType) ? (contentType as ArticleTypeBadgeKind) : undefined;
}
