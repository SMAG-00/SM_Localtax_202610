import { LinkCard } from "../base";
import { FIELDS, FIELD_ORDER, type FieldSection } from "./fields";
import { Pictogram } from "./Pictogram";

export type FieldCardsProps = {
  /** 분야마다 카드 바탕 작은 그림 (공개 파일 경로 — PO 결정 2026-10-25). 있는 카드만 그림 위에 어두운 막을 덮고 흰 글자, 없으면 지금 모양 그대로. 링크·구조는 같다 */
  images?: Partial<Record<FieldSection, string>>;
  /** 분야마다 '이 분야의 지방세 포인트' 한 줄 (settings·CMS 값). 첫 화면 150자(R1)를 넘기면 빼고 아래로 옮긴다 */
  points?: Partial<Record<FieldSection, string>>;
};

/**
 * 4대 분야 카드 — 링크 카드 4장, 같은 크기·같은 비중 (PRD-00 8.6, HOME-01). 모바일 2×2, 1024px 이상 4열.
 * 줄 높이를 모두 같게(auto-rows-fr) — 포인트 한 줄이 있는 카드와 없는 카드도 크기가 같다 (CORE-02)
 * 카드 수·순서·경로는 고정이다(지방세 /tax · 부동산 /realestate · 부동산금융 /finance · 지자체뉴스 /local). 주 버튼이 아니다(R2)
 */
export function FieldCards({ points = {}, images = {} }: FieldCardsProps) {
  return (
    <nav aria-label="4대 분야" data-ui="field-cards">
      <ul className="grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4">
        {FIELD_ORDER.map((key) => {
          const field = FIELDS[key];
          const point = points[key];
          const image = images[key];
          return (
            <li key={key} data-field={key} className="flex">
              <LinkCard href={field.href} className={image ? "relative flex h-full w-full flex-col overflow-hidden" : "flex h-full w-full flex-col"}>
                {image && (
                  <>
                    {/* 카드 바탕 그림(장식) + 글자 대비용 어두운 막 */}
                    <img src={image} alt="" aria-hidden="true" loading="lazy" decoding="async" data-part="field-card-image" className="absolute inset-0 h-full w-full object-cover" />
                    <span aria-hidden="true" className="absolute inset-0 bg-navy-900/65" />
                  </>
                )}
                <Pictogram
                  name={field.pictogram}
                  label={field.name}
                  size={40}
                  layout="start"
                  className={image ? "relative [&_svg]:stroke-white" : undefined}
                  labelClassName={image ? "text-[19px] leading-snug font-black text-white" : "text-[19px] leading-snug font-black text-navy-900"}
                />
                {point && <p className={image ? "relative mt-2 text-[15px] leading-relaxed text-navy-50" : "mt-2 text-[15px] leading-relaxed text-navy-600"}>{point}</p>}
              </LinkCard>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
