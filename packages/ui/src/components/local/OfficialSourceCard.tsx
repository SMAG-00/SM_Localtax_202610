import { Chip } from "../base";
import { CARD, ExternalLink, Field, StateChip, TEXT_LINK, rightsLabel, type SourceRights } from "./shared";
import { filled, isIsoDate, type IsoDate } from "./dates";

/** 공식 자료 종류 허용 목록 (REG1-07 초기값) — 교통·관광·음식점·생활 안내는 넣지 않는다 */
export const OFFICIAL_SOURCE_KINDS = ["조례", "고시", "예산/결산", "지방세 세수", "부동산 거래/공시", "정비/개발"] as const;
export type OfficialSourceKind = (typeof OFFICIAL_SOURCE_KINDS)[number];

export type OfficialSourceCardProps = {
  kind: OfficialSourceKind;
  title: string;
  /** 발표기관 (출처) */
  publisher: string;
  /** 기준일 */
  basisDate: IsoDate;
  /** 정보 확인일 */
  checkedAt: IsoDate;
  /** 권리 상태 — 공공누리 유형 */
  rights: SourceRights;
  /** 공식 원문 주소 */
  url: string;
  /** 이 자료를 쓴 기사 — 해석은 기사·해설로만 */
  articles?: Array<{ title: string; href: string }>;
  /** 원문을 다시 받아 내용이 달라져 검토하는 중 (REG1-13) */
  underReview?: boolean;
};

/**
 * 공식 자료 카드 — 원문/발표기관/기준일과 기자의 해석을 한 카드에 섞지 않는다.
 * 출처·기준일·확인일·권리 상태(와 원문 주소) 중 하나라도 없으면 렌더하지 않는다 (REG1-07·REG1-13)
 */
export function OfficialSourceCard({ kind, title, publisher, basisDate, checkedAt, rights, url, articles = [], underReview = false }: OfficialSourceCardProps) {
  const rights_ = rightsLabel(rights);
  const complete =
    (OFFICIAL_SOURCE_KINDS as readonly string[]).includes(kind) && filled(title) && filled(publisher) && isIsoDate(basisDate) && isIsoDate(checkedAt) && rights_ !== null && filled(url);
  if (!complete) return null;

  return (
    <article data-ui="official-source-card" className={CARD}>
      <div role="group" aria-label="원문 자료">
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{kind}</Chip>
          {underReview && <StateChip>검토 중</StateChip>}
        </div>
        <h3 className="mt-3 text-[19px] leading-snug font-black text-navy-900">{title}</h3>
        <dl className="mt-3 space-y-1">
          <Field term="발표기관">{publisher}</Field>
          <Field term="기준일" mono>
            {basisDate}
          </Field>
          <Field term="정보 확인일" mono>
            {checkedAt}
          </Field>
          <Field term="권리">{rights_}</Field>
        </dl>
        <p className="mt-3">
          <ExternalLink href={url}>원문 보기</ExternalLink>
        </p>
      </div>
      {articles.length > 0 && (
        <div role="group" aria-label="이 자료를 다룬 기사" className="mt-4 border-t border-navy-100 pt-4">
          <p className="text-[13px] font-bold text-navy-600">이 자료를 다룬 기사 — 해석은 기사에서 읽습니다</p>
          <ul className="mt-1">
            {articles.map((a) => (
              <li key={a.href}>
                <a href={a.href} className={TEXT_LINK}>
                  {a.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
