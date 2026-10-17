import { cx } from "../base";

/** 기사 유형 `content_type` (PRD-01A ART-01) */
export type ArticleTypeBadgeKind = "reported_news" | "explainer" | "guide" | "opinion" | "digest" | "sponsored";

/** 화면 글자 — 기사 카드·기사 머리·공유 미리보기에 같은 글자로 (PRD-00 8.6, ART-02 '배지 글자 = content_type') */
export const ARTICLE_TYPE_BADGE_LABELS: Readonly<Record<ArticleTypeBadgeKind, string>> = {
  reported_news: "보도",
  explainer: "해설",
  guide: "가이드",
  opinion: "오피니언",
  digest: "금주 핫뉴스",
  sponsored: "광고",
};

/** PRD-00 8.6 표의 순서 */
export const ARTICLE_TYPE_BADGE_ORDER: readonly ArticleTypeBadgeKind[] = ["reported_news", "explainer", "guide", "opinion", "digest", "sponsored"];

/** 정보 목록(행사·분양) 표시 — 기사 유형이 아님을 글자로 밝힌다 */
export type InfoListMarkerKind = "event" | "presale";
export const INFO_LIST_MARKER_LABELS: Readonly<Record<InfoListMarkerKind, string>> = {
  event: "행사안내",
  presale: "분양 정보",
};

/** 제휴 배지 문법 — navy-800 / 흰 바탕 15.5:1 (8.3) */
const SHAPE = "inline-flex items-center rounded-md border border-navy-200 px-2 py-0.5 text-[13px] font-bold text-navy-800";

/**
 * 기사 유형 배지 — 보도 · 해설 · 가이드 · 오피니언 · 금주 핫뉴스 · 광고. 모양은 같고 글자로 구분하며 광고만 ivory-dark 바탕 (PRD-00 8.6).
 * 형식 배지(카드뉴스·동영상 등)와 별개다.
 */
export function ArticleTypeBadge({ type }: { type: ArticleTypeBadgeKind }) {
  return (
    <span data-ui="article-type-badge" data-type={type} className={cx(SHAPE, type === "sponsored" ? "bg-ivory-dark" : "bg-white")}>
      {ARTICLE_TYPE_BADGE_LABELS[type]}
    </span>
  );
}

/**
 * 정보 목록 표시 `행사안내`·`분양 정보` — 기사 유형 배지와 같은 문법의 다른 글자 (PRD-00 8.6 기사 유형 배지 행).
 * 기사 유형 배지로 세지 않도록 data-ui를 따로 둔다 (검색 결과의 행사에 기사 유형 배지 0 — SRCH-01).
 */
export function InfoListMarker({ kind }: { kind: InfoListMarkerKind }) {
  return (
    <span data-ui="info-list-marker" data-kind={kind} className={cx(SHAPE, "bg-white")}>
      {INFO_LIST_MARKER_LABELS[kind]}
    </span>
  );
}
