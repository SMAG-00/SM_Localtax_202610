import type { ReactNode } from "react";
import { Chip } from "../base";
import { UiLink } from "../link";
import { FIELDS, type FieldSection } from "./fields";

/** 기사 형식 (`articles.format`) — 분야가 아니라 형식이다 (PRD-00 5.3). 일반 기사에는 형식 배지가 없다 */
export type ArticleFormat = "일반" | "카드뉴스" | "동영상" | "포토" | "인포그래픽";

export type ArticleCardProps = {
  /** 기사 상세 `/news/[slug]` */
  href: string;
  title: string;
  /** 요약 — 화면에서는 2줄로 자른다 */
  summary: string;
  /** 4대 분야 (`articles.section`) */
  section: FieldSection;
  /** 하위 분야 (예: 정비사업) — 분야 칩에 "부동산 › 정비사업"으로 붙는다 */
  subsection?: string;
  /** 최초 발행일 YYYY-MM-DD */
  publishedAt: string;
  /** 지역 태그 (예: 서울 성동구) */
  region?: string;
  /** 기사 유형 배지 자리 (보도·해설·가이드·오피니언·금주 핫뉴스·광고 — 다른 묶음의 배지) */
  typeBadge?: ReactNode;
  /** 편집 분야 배지 자리 (지역 기사 — 기사 유형 배지 옆) */
  editorialBadge?: ReactNode;
  format?: ArticleFormat;
  /** 기자·필자 이름 (글자만 — 카드 전체가 기사 링크라 이름 링크를 따로 두지 않는다) */
  byline?: string;
};

/**
 * 기사 카드 — 분야 칩 · 제목(19px 900) · 요약 2줄 · 기자명 · 발행일(고정폭) · 지역 칩 · 기사 유형 배지 · 형식 배지 (PRD-00 8.6 · RP-04 · PRD-01A 3장 홈)
 * 제목 링크가 카드 전체를 덮는다 — 링크 이름은 제목만, 칩·배지는 글자로 읽힌다
 */
export function ArticleCard({ href, title, summary, section, subsection, publishedAt, region, typeBadge, editorialBadge, format, byline }: ArticleCardProps) {
  const field = FIELDS[section].name;
  const showFormat = format !== undefined && format !== "일반";
  return (
    <article
      data-ui="article-card"
      className="group relative flex h-full flex-col rounded-2xl border border-navy-100 bg-white p-6 transition hover:border-hermes-400 hover:shadow-[0_2px_20px_-8px_rgba(242,106,27,0.35)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip>{subsection ? `${field} › ${subsection}` : field}</Chip>
        {typeBadge}
        {editorialBadge}
        {showFormat && (
          <span data-format-badge className="inline-flex items-center rounded-md bg-navy-50 px-2 py-0.5 text-[12px] font-bold text-navy-700">
            {format}
          </span>
        )}
      </div>
      <h3 className="mt-3 text-[19px] leading-snug font-black text-navy-900">
        <UiLink
          href={href}
          className="after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-hermes-500"
        >
          {title}
        </UiLink>
      </h3>
      <p className="mt-2 line-clamp-2 text-[15px] leading-relaxed text-navy-600">{summary}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {byline?.trim() && (
          <span data-part="byline" className="text-[14px] font-semibold text-navy-700">
            {byline.trim()}
          </span>
        )}
        <span className="sr-only">발행일 </span>
        <time dateTime={publishedAt} className="font-mono text-[13px] tracking-wide text-navy-600">
          {publishedAt}
        </time>
        {region && <Chip>{region}</Chip>}
      </div>
    </article>
  );
}
