import { filterCaseEntries, CASE_STRUCTURE_TYPES } from "@/lib/field-data/case-filter";
import { STRUCTURE_LABELS, type CaseEntryCard } from "@/lib/field-data/case-view";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 금융 사례 DB (W10-h h4 - PRD-02 DF-07) - /finance/cases 아래 구조 유형·쟁점 필터 목록. 서버 렌더(필터는 주소 변수), 자바스크립트 없이 동작한다.
// 사례마다 공개 자료 출처·실명 기업 반론 기록·데이터 출처 줄. 수익률·투자 권유·상품 가입 링크 요소 0, 기사 집계 0.

const CHIP = "inline-flex items-center rounded-full border border-navy-200 px-2.5 py-0.5 text-[13px] font-bold text-navy-800";
const CHIP_ON = "inline-flex items-center rounded-full bg-navy-900 px-2.5 py-0.5 text-[13px] font-bold text-white";

export function FinanceCaseEntries({ entries, structureType, issue }: { entries: readonly CaseEntryCard[]; structureType: string | null; issue: string | null }) {
  const rows = entries.map((e) => ({ ...e, structure_type: e.structureType }));
  const result = filterCaseEntries(rows, { structureType, issue });
  if (entries.length === 0) return null; // 공개된 사례 DB 항목이 없으면 영역 자체를 그리지 않는다
  const href = (type: string | null) => (type ? `/finance/cases?type=${type}#case-db` : "/finance/cases#case-db");
  return (
    <SiteSection id="case-db" tone="ivory-dark" data={{ "data-part": "finance-case-db" }}>
      <h2 className="text-[24px] font-black tracking-tight text-navy-900">금융 사례 DB</h2>
      <p className="mt-2 text-[15px] text-navy-700">공개 자료 범위에서만 구조를 적었습니다. 공개되지 않은 조건은 추정하지 않으며 투자 권유가 아닙니다.</p>
      <nav aria-label="구조 유형 필터" className="mt-4 flex flex-wrap gap-2" data-part="case-filter">
        <a href={href(null)} aria-current={structureType === null ? "true" : undefined} className={structureType === null ? CHIP_ON : CHIP}>전체</a>
        {CASE_STRUCTURE_TYPES.map((t) => (
          <a key={t} href={href(t)} aria-current={structureType === t ? "true" : undefined} className={structureType === t ? CHIP_ON : CHIP}>
            {STRUCTURE_LABELS[t]}
          </a>
        ))}
      </nav>
      {result.message && (
        <p role="status" data-part="case-empty" className="mt-6 text-[16px] font-bold text-navy-900">
          {result.message}{" "}
          {result.canClear && (
            <a href={href(null)} className={TEXT_LINK}>
              필터 해제
            </a>
          )}
        </p>
      )}
      <ul className="mt-6 grid gap-4 md:grid-cols-2" data-part="case-list">
        {result.rows.map((c) => (
          <li key={c.id} data-case-entry={c.slug} data-structure-type={c.structureType} className="rounded-2xl border border-navy-100 bg-white p-5">
            <p className="flex flex-wrap items-center gap-2">
              <span className={CHIP}>{c.structureLabel}</span>
              <span className="font-mono text-[13px] text-navy-600">기준일 {c.asOf}</span>
            </p>
            <h3 className="mt-3 text-[18px] font-bold text-navy-900">{c.title}</h3>
            {c.issues.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="쟁점">
                {c.issues.map((i) => (
                  <li key={i} className={CHIP}>
                    {i}
                  </li>
                ))}
              </ul>
            )}
            {c.outcome && <p className="mt-3 text-[15px] text-navy-800">결과: {c.outcome}</p>}
            {c.rebuttalLine && (
              <p data-part="rebuttal" className="mt-2 text-[14px] text-navy-700">
                {c.companies.join(", ")} · {c.rebuttalLine}
              </p>
            )}
            <ul className="mt-3 space-y-1 text-[14px]" aria-label="공개 자료 출처">
              {c.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
                    {s.label} (새 창)
                  </a>
                </li>
              ))}
            </ul>
            {c.sourceLine && (
              <p data-part="data-source" className="mt-3 text-[13px] text-navy-600">
                {c.sourceLine}
              </p>
            )}
          </li>
        ))}
      </ul>
    </SiteSection>
  );
}
