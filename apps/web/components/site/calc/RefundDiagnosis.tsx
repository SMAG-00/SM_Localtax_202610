"use client";

import type { DeterminationTable } from "@ltr/tax-engine";
import { Chip, RulesetLabel } from "@ltr/ui";
import { CALC_COPY } from "@/lib/calc/copy";
import { diagnoseRefund, refundQuestions, refundSummary, type RefundForm } from "@/lib/calc/refund";
import type { WetaxLinkRow } from "@/lib/calc/wetax";
import { WetaxCardView } from "./cards";
import { CalculatorShell } from "./Shell";

// 환급 자가진단 (CALC-04) - 판정표(서명된 활성 표)가 문진표와 규칙을 모두 가진다. 금액을 확정하는 표현을 쓰지 않고, 진단 중 서버 요청 0.
export function RefundDiagnosis({ table, wetax }: { table: DeterminationTable; wetax: WetaxLinkRow[] }) {
  const questions = refundQuestions(table);
  const result = (form: RefundForm) => {
    const outcome = diagnoseRefund(table, form);
    if (outcome.kind !== "refund") return null;
    const s = refundSummary(outcome);
    return (
      <article data-ui="result-first" data-kind="refund" className="space-y-6">
        <section data-result-block="total" className="rounded-2xl border border-navy-100 bg-ivory p-5">
          <p data-part="refund-summary" className="text-[20px] font-black text-navy-900">
            돌려받을 수 있는지 — 가능성 높음 {s.high}건 · 확인 필요 {s.check}건
          </p>
          <p className="mt-1 text-[15px] text-navy-700">어디서 — 위택스 환급금 조회 ({CALC_COPY.wetaxLabel})</p>
        </section>
        <ul className="divide-y divide-navy-100 rounded-2xl border border-navy-100">
          {outcome.results.map((r) => (
            <li key={r.id} data-refund-item={r.id} data-likelihood={r.likelihood} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <span className="font-bold text-navy-900">{r.label}</span>
              <span className="flex items-center gap-2">
                <span className="text-[15px] font-bold text-navy-800">{r.likelihood}</span>
                {r.law && <Chip>{r.law}</Chip>}
              </span>
            </li>
          ))}
        </ul>
        <WetaxCardView screen="refund" rows={wetax} action="환급금 조회하러 가기" />
        <div className="space-y-1">
          <RulesetLabel version={outcome.tableVersion} />
          <p className="text-[13px] text-navy-500">{CALC_COPY.refundNotice}</p>
        </div>
      </article>
    );
  };
  return <CalculatorShell<RefundForm> tool="refund" rulesetVersion={table.version} eyebrow="REFUND · 환급 자가진단" title="환급 자가진단" questions={questions} initial={{}} ready={() => true} result={result} />;
}
