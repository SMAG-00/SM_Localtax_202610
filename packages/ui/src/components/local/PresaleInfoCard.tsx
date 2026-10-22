import { Chip } from "../base";
import { UiLink } from "../link";
import { CARD, ExternalLink, Field, TEXT_LINK } from "./shared";
import { filled, isIsoDate, type IsoDate } from "./dates";

export type PresaleInfoCardProps = {
  /** 사업명 */
  name: string;
  region?: string;
  /** 행정구역 표준코드 — 지역 칩 안 고정폭 (PR-01 '지역(행정구역 이름·표준코드)') */
  regionCode?: string;
  /** 공급 규모 — 예: 총 1,024세대 중 일반분양 312세대 */
  supply?: string;
  subscriptionStart?: IsoDate;
  subscriptionEnd?: IsoDate;
  /** 청약 단계 글자 — 청약 예정 · 청약 접수 중 · 청약 마감 (PR-01 '사업 단계') */
  phase?: string;
  /** 출처 — 공고 기관 */
  issuer?: string;
  /** 기준일 — 모집공고일 */
  noticeDate?: IsoDate;
  /** 공고의 공공누리 유형 글자 (PR-07) */
  license?: string;
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
 * 공식 공고 URL·확인일이 없으면 렌더하지 않고, 확인되지 않은 값은 '확인 필요'로 쓴다 (PR-04, 8.8).
 * 선택 칸(표준코드·청약 단계·출처·기준일·공공누리)은 넘길 때만 보인다 — 지역 허브 ③·분양 정보 목록 카드(PR-01 '지역·단계·출처·기준일')
 */
export function PresaleInfoCard({ name, region, regionCode, supply, subscriptionStart, subscriptionEnd, phase, issuer, noticeDate, license, noticeUrl, checkedAt, projectHref }: PresaleInfoCardProps) {
  if (!filled(name) || !filled(noticeUrl) || !isIsoDate(checkedAt)) return null;
  const when = schedule(subscriptionStart, subscriptionEnd);

  return (
    <article data-ui="presale-info-card" className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-md border border-navy-200 bg-white px-2 py-0.5 text-[12px] font-bold text-navy-800">분양 정보</span>
        {filled(region) && (
          <Chip>
            {region}
            {filled(regionCode) && <span className="ml-1 font-mono font-normal tracking-wide">{regionCode}</span>}
          </Chip>
        )}
        {filled(phase) && (
          <span data-part="presale-phase" className="inline-flex items-center rounded-md bg-navy-900 px-2 py-0.5 text-[12px] font-bold text-white">
            {phase}
          </span>
        )}
      </div>
      <h3 className="mt-3 text-[19px] leading-snug font-black text-navy-900 [overflow-wrap:anywhere]">{name}</h3>
      <dl className="mt-3 space-y-1">
        <Field term="공급 규모">{filled(supply) ? supply : UNCONFIRMED}</Field>
        <Field term="청약 일정" mono={when !== null}>
          {when ?? UNCONFIRMED}
        </Field>
        {filled(issuer) && <Field term="출처">{issuer}</Field>}
        {isIsoDate(noticeDate) && (
          <Field term="기준일" mono>
            {noticeDate}
          </Field>
        )}
        <Field term="확인일" mono>
          {checkedAt}
        </Field>
        {filled(license) && <Field term="공공누리">{license}</Field>}
      </dl>
      <p className="mt-3 flex flex-wrap gap-x-5">
        <ExternalLink href={noticeUrl}>공식 공고</ExternalLink>
        {projectHref && (
          <UiLink href={projectHref} className={TEXT_LINK}>
            연결된 프로젝트 보기
          </UiLink>
        )}
      </p>
    </article>
  );
}
