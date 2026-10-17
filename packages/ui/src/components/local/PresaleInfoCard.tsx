import { Chip } from "../base";
import { CARD, ExternalLink, Field, TEXT_LINK } from "./shared";
import { filled, isIsoDate, type IsoDate } from "./dates";

export type PresaleInfoCardProps = {
  /** 사업명 */
  name: string;
  region?: string;
  /** 공급 규모 — 예: 총 1,024세대 중 일반분양 312세대 */
  supply?: string;
  subscriptionStart?: IsoDate;
  subscriptionEnd?: IsoDate;
  /** 공식 공고 주소 */
  noticeUrl: string;
  /** 확인일 */
  checkedAt: IsoDate;
  /** 연결된 프로젝트 트래커 (PR-02) */
  projectHref?: string;
};

const UNCONFIRMED = "확인 필요";

function schedule(start?: string, end?: string): string | null {
  if (!isIsoDate(start)) return null;
  if (!isIsoDate(end) || start === end) return start;
  return `${start} ~ ${end}`;
}

/**
 * 분양 정보 카드 — 기사와 분리한 정보 항목. 가격·전망·투자 권유·추천 요소 없음.
 * 공식 공고 URL·확인일이 없으면 렌더하지 않고, 확인되지 않은 값은 '확인 필요'로 쓴다 (PR-04, 8.8)
 */
export function PresaleInfoCard({ name, region, supply, subscriptionStart, subscriptionEnd, noticeUrl, checkedAt, projectHref }: PresaleInfoCardProps) {
  if (!filled(name) || !filled(noticeUrl) || !isIsoDate(checkedAt)) return null;
  const when = schedule(subscriptionStart, subscriptionEnd);

  return (
    <article data-ui="presale-info-card" className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-md border border-navy-200 bg-white px-2 py-0.5 text-[12px] font-bold text-navy-800">분양 정보</span>
        {filled(region) && <Chip>{region}</Chip>}
      </div>
      <h3 className="mt-3 text-[19px] leading-snug font-black text-navy-900">{name}</h3>
      <dl className="mt-3 space-y-1">
        <Field term="공급 규모">{filled(supply) ? supply : UNCONFIRMED}</Field>
        <Field term="청약 일정" mono={when !== null}>
          {when ?? UNCONFIRMED}
        </Field>
        <Field term="확인일" mono>
          {checkedAt}
        </Field>
      </dl>
      <p className="mt-3 flex flex-wrap gap-x-5">
        <ExternalLink href={noticeUrl}>공식 공고</ExternalLink>
        {projectHref && (
          <a href={projectHref} className={TEXT_LINK}>
            연결된 프로젝트 보기
          </a>
        )}
      </p>
    </article>
  );
}
