import type { ReactNode } from "react";
import { NEXT_STEPS } from "@/lib/site/next-step";
import { Chip, RulesetLabel, StatusBox } from "@ltr/ui";
import { CALC_COPY } from "@/lib/calc/copy";
import type { ReductionBlock } from "@/lib/calc/reduction";
import { formatWon, type ResultView } from "@/lib/calc/result-view";
import type { AppliedAssumption } from "@/lib/calc/shared";

// 결과 먼저 (CALC-12) - 6블록을 DOM 순서 그대로 그린다: 총액 -> 기한·장소 -> 명세서 -> 감면 -> 근거 -> 다음 행동.
// 금액은 모두 엔진이 낸 값이고 이 파일에는 계산이 없다. 360x740 첫 화면에 총액 줄과 기한 줄이 들어가도록 앞 두 블록은 짧게 둔다.

const pct = (rate: number | null) => (rate === null ? "" : `${Number((rate * 100).toFixed(4))}%`);

function ReductionView({ block }: { block: ReductionBlock }) {
  if (block.state === "hidden") return null;
  if (block.state === "none") {
    return (
      <section data-result-block="reduction" data-state="none" aria-label="감면 점검" className="rounded-2xl border border-navy-100 p-5">
        <p className="text-[16px] font-bold text-navy-900">{CALC_COPY.reductionNone}</p>
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-700 underline underline-offset-4">{CALC_COPY.reductionNoneLink}</summary>
          <ul className="mt-2 list-disc pl-5 text-[15px] text-navy-800">
            {block.checked.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
        <p className="mt-3 font-mono text-[13px] text-navy-600">판정표 감면 {block.tableVersion}</p>
      </section>
    );
  }
  return (
    <section data-result-block="reduction" data-state="found" aria-label="감면 점검">
      <StatusBox kind="tip" title={CALC_COPY.reductionFound(block.count)}>
        <ul className="space-y-4">
          {block.items.map((item) => (
            <li key={item.id} data-reduction={item.id}>
              <p className="flex flex-wrap items-center gap-2 font-bold text-navy-900">
                {item.label}
                {item.law && <Chip>{item.law}</Chip>}
              </p>
              <ul className="mt-1 space-y-1">
                {item.requirements.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3 text-[15px]">
                    <span>
                      <span aria-hidden="true">{r.state === "입력으로 확인" ? "✓ " : "? "}</span>
                      {r.label}
                    </span>
                    <span className="shrink-0 text-navy-600">{r.state}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[14px] text-navy-600">{CALC_COPY.reductionAmountSlot}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-mono text-[13px] text-navy-600">
          판정표 감면 {block.tableVersion} · {CALC_COPY.reductionNotice}
        </p>
      </StatusBox>
    </section>
  );
}

export interface ResultBlocksProps {
  title: string;
  view: ResultView;
  /** "어디서" - 위택스 라벨. 없으면 장소 없이 기한만 */
  place: string | null;
  /** 총액 줄 바로 아래 (미포함 안내 등) */
  afterTotal?: ReactNode;
  reduction: ReductionBlock;
  assumed: AppliedAssumption[];
  badge: string | null;
  next: ReactNode;
  /** 상담 요청 보조 링크 주소 (calcResultConsultHref) - 없으면 링크 0 */
  consultHref?: string | null;
}

export function ResultBlocks({ title, view, place, afterTotal, reduction, assumed, badge, next, consultHref = null }: ResultBlocksProps) {
  return (
    <article data-ui="result-first" aria-label={title} className="space-y-8">
      <section data-result-block="total" className="rounded-2xl border border-navy-100 bg-ivory p-5">
        <p className="text-[15px] font-bold text-navy-700">{title}</p>
        {view.zero ? (
          <>
            <p data-part="total-amount" className="mt-1 text-[28px] font-black text-navy-900">
              {CALC_COPY.zeroTitle}
            </p>
            {view.zeroReason && <p className="mt-1 text-[15px] text-navy-700">{view.zeroReason}</p>}
          </>
        ) : (
          <p className="mt-1 text-[15px] text-navy-700">
            {CALC_COPY.totalLabel}{" "}
            <span data-part="total-amount" className="block text-[32px] font-black tabular-nums text-navy-900">
              {view.totalText}
            </span>
          </p>
        )}
        {afterTotal}
      </section>

      <section data-result-block="deadline" className="text-[16px] text-navy-900">
        <h2 className="text-[15px] font-bold text-navy-700">{CALC_COPY.deadlineLabel}</h2>
        <p data-part="deadline" className="mt-1">
          {view.deadline ? `${view.deadline.dueDate}까지 · ${view.deadline.note}` : CALC_COPY.deadlineMissing}
          {place ? ` · ${place}` : ""}
        </p>
      </section>

      <section data-result-block="breakdown" aria-label="명세서">
        <h2 className="text-[17px] font-black text-navy-900">명세서</h2>
        <table className="mt-2 w-full text-[15px]">
          <thead className="text-left text-navy-600">
            <tr>
              <th scope="col" className="py-1 font-bold">항목</th>
              <th scope="col" className="py-1 text-right font-bold">세율</th>
              <th scope="col" className="py-1 text-right font-bold">금액</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.code} data-row={r.code} className="border-t border-navy-100">
                <th scope="row" className="py-2 text-left font-bold">{r.label}</th>
                <td className="py-2 text-right tabular-nums text-navy-700">{pct(r.rate)}</td>
                <td className="py-2 text-right tabular-nums">{formatWon(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-navy-900 font-black">
              <th scope="row" className="py-2 text-left">합계</th>
              <td />
              <td className="py-2 text-right tabular-nums" data-part="breakdown-total">{view.totalText}</td>
            </tr>
          </tfoot>
        </table>
        {view.reference.length > 0 && (
          <div data-part="reference" className="mt-3 text-[14px] text-navy-700">
            <p className="font-bold">참고 표시 (합계에 넣지 않아요)</p>
            <ul className="mt-1">
              {view.reference.map((r) => (
                <li key={r.code} className="flex justify-between gap-3">
                  <span>{r.label}</span>
                  <span className="tabular-nums">{formatWon(r.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {view.warnings.length > 0 && (
          <ul data-part="warnings" className="mt-3 list-disc pl-5 text-[14px] text-navy-700">
            {view.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      {/* 감면이 숨겨져 있어도(서명 전) 나머지 블록 순서는 그대로 */}
      <ReductionView block={reduction} />

      <section data-result-block="basis" aria-label="근거">
        <h2 className="text-[17px] font-black text-navy-900">근거</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {view.basis.map((law) => (
            <Chip key={law}>{law}</Chip>
          ))}
          {assumed.map((a) => (
            <Chip key={a.id} className="border-hermes-500">
              {CALC_COPY.assumedChip}: {a.text} {a.note ?? CALC_COPY.noAssumption}
            </Chip>
          ))}
        </div>
        <div className="mt-3 space-y-1">
          <RulesetLabel version={view.rulesVersion} />
          {badge && (
            <p data-part="accuracy-badge" className="font-mono text-[13px] text-navy-600">
              {badge}
            </p>
          )}
        </div>
        <p className="mt-3 text-[13px] text-navy-500">{CALC_COPY.disclaimer}</p>
      </section>

      <section data-result-block="next" aria-label="다음 행동" className="space-y-4">
        {next}
        {/* 다음 한 걸음 (GROW-06) - 상담 요청 보조 링크. 쿼리는 source=calc_result · field 둘뿐 (입력값·금액 0). 전문가 연락 요청이 닫혀 있으면 주는 쪽이 넘기지 않는다 */}
        {consultHref && (
          <p data-part="consult-step">
            <a href={consultHref} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-navy-700 underline underline-offset-2">
              {NEXT_STEPS.calc_to_consult.label}
            </a>
          </p>
        )}
      </section>
    </article>
  );
}
