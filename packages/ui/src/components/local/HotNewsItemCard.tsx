import { Chip } from "../base";
import { CARD, ExternalLink, MONO, rightsLabel, type SourceRights } from "./shared";
import { filled, isIsoDate, type IsoDate } from "./dates";

export type HotNewsItemCardProps = {
  /** 지역 칩 — 시·도 또는 시·군·구 */
  region: string;
  /** 편집자 요약 2~3줄 (보도자료 문장을 옮기지 않는다) */
  summary: string;
  /** 발표기관 */
  publisher: string;
  /** 발표일 */
  publishedAt: IsoDate;
  /** 원문(보도자료·고시) 주소 */
  sourceUrl: string;
  /** 공공누리 유형 */
  license: SourceRights;
};

/** 핫뉴스 항목 카드 — 편집자 요약 + 원문 링크. 조회수·순위 표시 없음. 원문 URL·발표기관·발표일이 없으면 렌더하지 않는다 (LG-02) */
export function HotNewsItemCard({ region, summary, publisher, publishedAt, sourceUrl, license }: HotNewsItemCardProps) {
  const licenseText = rightsLabel(license);
  if (!filled(summary) || !filled(publisher) || !isIsoDate(publishedAt) || !filled(sourceUrl) || licenseText === null) return null;

  return (
    <article data-ui="hot-news-item-card" className={CARD}>
      {filled(region) && <Chip>{region}</Chip>}
      <p className="mt-3 line-clamp-3 text-[17px] leading-relaxed text-navy-900">{summary}</p>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[15px] text-navy-600">
        <span>{publisher}</span>
        <span aria-hidden="true">·</span>
        <span className="sr-only">발표일</span>
        <span className={MONO}>{publishedAt}</span>
      </p>
      <p className="mt-1 text-[13px] text-navy-600">{licenseText}</p>
      <p className="mt-2">
        <ExternalLink href={sourceUrl}>원문 보기</ExternalLink>
      </p>
    </article>
  );
}
