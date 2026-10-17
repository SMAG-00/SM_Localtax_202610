import { useId } from "react";
import { DateText, MONO, StateChip } from "./parts";

export type PartnerReadinessCardProps = {
  /** 지표 이름 (자체 생산 비율 · 월 송출량 · 기획·탐사 실적 · 기자 1인당 생산량 등) */
  name: string;
  /** 이번 달 값 — 표기 그대로 (예: "62.5%", "0") */
  value: string;
  /** 쌓인 데이터 개월 수 — 3개월 미만이면 조합 최저값 대신 '기간 부족' (NAV-17) */
  monthsOfData: number;
  /** 임의 3개월 조합의 최저값 — 표기 그대로 */
  lowestThreeMonths: string;
  /** 규정상 0점 위험 */
  zeroRisk: boolean;
  /** 규정 원문(`news_partner_requirements`) — 등록 전이면 null → 값 대신 '요건 미확정' */
  rule: { version: string; checkedAt: string } | null;
};

/** 고정 문구 (PRD-00 8.6) */
export const PARTNER_READINESS_NOTICE = "내부 지표 — 네이버 심사 점수가 아닙니다";
const UNDECIDED = "요건 미확정";
const MIN_MONTHS = 3;

/** 제휴 준비 지표 카드 — 백오피스 제휴 준비도 대시보드 (NAV-17 · NAV-24) */
export function PartnerReadinessCard({ name, value, monthsOfData, lowestThreeMonths, zeroRisk, rule }: PartnerReadinessCardProps) {
  const headingId = useId();
  const lowest = rule === null ? UNDECIDED : monthsOfData < MIN_MONTHS ? "기간 부족" : lowestThreeMonths;

  return (
    <section data-ui="partner-readiness-card" aria-labelledby={headingId} className="rounded-2xl border border-navy-100 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={headingId} className="text-[17px] font-black text-navy-900">
          {name}
        </h3>
        {zeroRisk && <StateChip tone="amber">0점 위험</StateChip>}
      </div>
      <p className="mt-3 text-[13px] font-bold text-navy-600">이번 달</p>
      <p data-part="value" className="text-[28px] leading-tight font-black text-navy-900">
        {rule === null ? UNDECIDED : value}
      </p>
      <p className="mt-2 text-[13px] font-bold text-navy-600">임의 3개월 조합 최저값</p>
      <p data-part="lowest" className={MONO}>
        {lowest}
      </p>
      <p className={`mt-3 ${MONO}`}>
        {rule === null ? (
          "규정 원문 미등록"
        ) : (
          <>
            규정 {rule.version} · 확인일 <DateText value={rule.checkedAt} />
          </>
        )}
      </p>
      <p className="mt-2 text-[13px] text-navy-600">{PARTNER_READINESS_NOTICE}</p>
    </section>
  );
}
