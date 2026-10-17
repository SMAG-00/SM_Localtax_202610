import { brand } from "../../brand";
import { LinkCard } from "../base";
import { DateText, MONO, NewWindowIcon, TaxKindLabel } from "./parts";
import { pickOfficialLink, type OfficialLink } from "./official-link";

export type ExternalCalculatorCardProps = {
  /** `official_links` kind `external_calculator` */
  link: OfficialLink;
  /** 점검 실패 때 같은 자리에 보이는 국세청 공식 안내 */
  fallback: OfficialLink;
};

/** 고정 제목 (PRD-00 8.6 · FAM-08) */
export const EXTERNAL_CALCULATOR_TITLE = `상속세·증여세 계산은 ${brand.externalCalculatorSiteName}(별도 사이트)에서`;
const NO_CALC = "이 사이트는 상속세·증여세를 계산하지 않습니다";
const OPEN_LABEL = "새 창에서 별도 사이트 열기";

/**
 * 외부 계산기 연결 카드 — 링크 카드 문법, 카드 전체가 하나의 새 창 링크 (FAM-08 · TX-02).
 * 주 버튼이 아니다(R2). 외부 화면·금액을 끼워 넣지 않는다(iframe 0). 점검 실패면 국세청 안내, 그것도 못 쓰면 렌더 0.
 */
export function ExternalCalculatorCard({ link, fallback }: ExternalCalculatorCardProps) {
  const picked = pickOfficialLink(link, fallback);
  if (!picked) return null;
  const { link: target, isFallback } = picked;
  const fallbackName = target.label ?? "국세청 공식 안내";
  const title = isFallback ? `상속세·증여세는 ${fallbackName}에서 확인하세요` : EXTERNAL_CALCULATOR_TITLE;
  const line = isFallback ? NO_CALC : `${NO_CALC} · 입력한 내용은 넘어가지 않습니다`;

  return (
    <div data-ui="external-calculator-card" data-state={isFallback ? "fallback" : "primary"}>
      {/* 이름은 보이는 글자 + 화면 읽기 전용 안내 — aria-label로 덮어쓰지 않는다 (WCAG 2.5.3 Label in Name) */}
      <LinkCard href={target.url} external>
        <span className="flex">
          <TaxKindLabel kind="national" />
        </span>
        <span className="mt-3 block text-[19px] font-black text-navy-900">{title}</span>
        <span className="mt-1 block text-[15px] text-navy-600">{line}</span>
        <span className="mt-3 flex items-center gap-1.5 text-[14px] font-bold text-navy-700">
          <NewWindowIcon />
          별도 사이트 · 새 창
        </span>
        <span className={`mt-2 block ${MONO}`}>
          링크 확인일 <DateText value={target.checkedAt} />
        </span>
        <span className="sr-only"> — {OPEN_LABEL}</span>
      </LinkCard>
    </div>
  );
}
