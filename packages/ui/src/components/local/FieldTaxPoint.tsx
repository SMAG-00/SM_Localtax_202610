import { useId } from "react";
import { UiLink } from "../link";
import { MONO, TEXT_LINK } from "./shared";
import { filled, isIsoDate, type IsoDate } from "./dates";

export type FieldTaxPointProps = {
  /** 세무 감수본 포인트 1~3줄 */
  points: string[];
  /** 감수본 기준일 */
  basisDate: IsoDate;
  /** 지방세 해설·트래커 링크 1개 이상 */
  links: Array<{ label: string; href: string }>;
};

const MAX_POINTS = 3;

/**
 * 분야 지방세 포인트 블록 — 강조 문단 문법(왼쪽 hermes-500 2px 선). 조건을 못 채우면 블록째 숨긴다 —
 * 포인트 0줄·4줄 이상, 기준일 없음, 해설 링크 없음 (CORE-02: 빈 블록·'준비 중' 0)
 */
export function FieldTaxPoint({ points, basisDate, links }: FieldTaxPointProps) {
  const headingId = useId();
  const valid = points.length >= 1 && points.length <= MAX_POINTS && points.every(filled) && isIsoDate(basisDate) && links.length > 0 && links.every((l) => filled(l.label) && filled(l.href));
  if (!valid) return null;

  return (
    <section data-ui="field-tax-point" aria-labelledby={headingId} className="border-l-2 border-hermes-500 pl-4">
      <h2 id={headingId} className="text-[17px] font-black text-navy-900">
        이 분야의 지방세 포인트
      </h2>
      <ul className="mt-2 space-y-1 text-[15px] text-navy-600">
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      <p className={`mt-2 ${MONO} text-navy-600`}>기준일 {basisDate} · 세무 감수본</p>
      <p className="mt-1 flex flex-wrap gap-x-5">
        {links.map((l) => (
          <UiLink key={l.href} href={l.href} className={TEXT_LINK}>
            {l.label}
          </UiLink>
        ))}
      </p>
    </section>
  );
}
