import { LinkCard } from "../base";
import { FIELDS, FIELD_ORDER, type FieldSection } from "./fields";
import { Pictogram } from "./Pictogram";

export type FieldCardsProps = {
  /** 분야마다 '이 분야의 지방세 포인트' 한 줄 (settings·CMS 값). 첫 화면 150자(R1)를 넘기면 빼고 아래로 옮긴다 */
  points?: Partial<Record<FieldSection, string>>;
};

/**
 * 4대 분야 카드 — 링크 카드 4장, 같은 크기·같은 비중 (PRD-00 8.6, HOME-01). 모바일 2×2, 1024px 이상 4열.
 * 줄 높이를 모두 같게(auto-rows-fr) — 포인트 한 줄이 있는 카드와 없는 카드도 크기가 같다 (CORE-02)
 * 카드 수·순서·경로는 고정이다(지방세 /tax · 부동산 /realestate · 부동산금융 /finance · 지자체뉴스 /local). 주 버튼이 아니다(R2)
 */
export function FieldCards({ points = {} }: FieldCardsProps) {
  return (
    <nav aria-label="4대 분야" data-ui="field-cards">
      <ul className="grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4">
        {FIELD_ORDER.map((key) => {
          const field = FIELDS[key];
          const point = points[key];
          return (
            <li key={key} data-field={key} className="flex">
              <LinkCard href={field.href} className="flex h-full w-full flex-col">
                <Pictogram name={field.pictogram} label={field.name} size={40} layout="start" labelClassName="text-[19px] leading-snug font-black text-navy-900" />
                {point && <p className="mt-2 text-[15px] leading-relaxed text-navy-600">{point}</p>}
              </LinkCard>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
