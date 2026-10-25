"use client";

import { useState } from "react";
import { calcAcquisition, calcHolding, type Ruleset } from "@ltr/tax-engine";
import { Eyebrow, RulesetLabel, SecondaryButton, Tabs } from "@ltr/ui";
import { ACQUISITION_QUESTIONS, buildAcquisition, type AcquisitionForm } from "@/lib/calc/acquisition";
import { COMPARE_MAX, canAddColumn, compareRows, differingLabels, type CompareColumn, type CompareTax } from "@/lib/calc/compare";
import { CALC_COPY } from "@/lib/calc/copy";
import { HOLDING_QUESTIONS, buildHolding, holdingResultFor, type HoldingForm } from "@/lib/calc/holding";
import { buildResultView, type ResultView } from "@/lib/calc/result-view";
import { applicable, type Question } from "@/lib/calc/shared";
import { QuestionField } from "./fields";

// 시나리오 비교 (CALC-05) - 회원 전용. 조건 2~3열을 같은 엔진으로 계산해 나란히 놓는다. 비교 결과는 서버에 보내지도 저장하지도 않는다(브라우저 메모리만).
// 비교할 세목은 하나를 고른다(공개된 세목만). 재산세 열은 과세기준일 소유 여부로 "올해 재산세 납세의무"를 보인다.

type Form = Record<string, unknown>;
interface Col {
  id: string;
  label: string;
  form: Form;
}
const LETTERS = ["A", "B", "C"];
const TAX_LABEL: Record<CompareTax, string> = { acquisition: "취득세", property: "재산세", comprehensive: "종합부동산세" };

function questionsOf(tax: CompareTax): readonly Question<Form>[] {
  return (tax === "acquisition" ? ACQUISITION_QUESTIONS : HOLDING_QUESTIONS) as unknown as readonly Question<Form>[];
}

function columnOf(tax: CompareTax, col: Col, ruleset: Ruleset): CompareColumn | null {
  try {
    if (tax === "acquisition") {
      const b = buildAcquisition(col.form as AcquisitionForm);
      return b.input ? { id: col.id, label: col.label, tax, view: buildResultView(calcAcquisition(b.input, ruleset)) } : null;
    }
    const b = buildHolding(col.form as HoldingForm);
    if (!b.liable) {
      const empty: ResultView = buildResultView({ items: [], total: 0, rulesVersion: ruleset.version, engineVersion: "", warnings: [] });
      return { id: col.id, label: col.label, tax, view: empty, liable: false };
    }
    if (!b.input) return null;
    const r = calcHolding(b.input, ruleset);
    return { id: col.id, label: col.label, tax, view: buildResultView(r, holdingResultFor(r, { property: true, comprehensive: false }).items), liable: true };
  } catch {
    return null;
  }
}

export function CompareCalculator({ ruleset, openTaxes, isMember }: { ruleset: Ruleset; openTaxes: CompareTax[]; isMember: boolean }) {
  const compareTaxes = openTaxes.filter((t): t is "acquisition" | "property" => t !== "comprehensive");
  const [tax, setTax] = useState<CompareTax>(compareTaxes[0] ?? "acquisition");
  const [cols, setCols] = useState<Col[]>([{ id: "A", label: "A", form: {} }]);
  const [notice, setNotice] = useState<"member_only" | "max" | null>(null);

  const add = () => {
    const r = canAddColumn(cols.length, tax, openTaxes, isMember);
    if (!r.ok) {
      if (r.reason !== "closed") setNotice(r.reason);
      return;
    }
    setNotice(null);
    const label = LETTERS[cols.length] ?? String(cols.length + 1);
    // 처음 열의 조건을 복사해 시작하고 바꾼다
    setCols((c) => [...c, { id: label, label, form: JSON.parse(JSON.stringify(c[0]!.form)) as Form }]);
  };
  const setField = (id: string, key: string, v: unknown) =>
    setCols((c) =>
      c.map((x) => {
        if (x.id !== id) return x;
        const form = { ...x.form };
        if (v === undefined) delete form[key];
        else form[key] = v;
        return { ...x, form };
      }),
    );

  const computed = cols.map((c) => columnOf(tax, c, ruleset)).filter((c): c is CompareColumn => c !== null);
  const rows = computed.length >= 2 ? compareRows(computed) : [];
  const diff = differingLabels(rows).filter((l) => l !== "적용 룰셋");

  return (
    <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-8" data-ui="compare">
      <Eyebrow>COMPARE · 조건 바꿔 비교</Eyebrow>
      <h1 className="mt-2 text-[28px] font-black text-navy-900">조건 바꿔 비교</h1>
      {compareTaxes.length > 1 && (
        <div role="group" aria-label="비교할 세목" className="mt-4 flex gap-2">
          {compareTaxes.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tax === t}
              onClick={() => {
                setTax(t);
                setCols([{ id: "A", label: "A", form: {} }]);
                setNotice(null);
              }}
              className={`min-h-11 rounded-xl border px-4 text-[16px] font-bold ${tax === t ? "border-hermes-500 bg-hermes-100" : "border-navy-200 bg-white"}`}
            >
              {TAX_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3" data-part="compare-columns">
        {cols.map((c) => (
          <details key={c.id} open className="rounded-2xl border border-navy-100 p-4" data-column={c.id}>
            <summary className="min-h-11 cursor-pointer text-[17px] font-black text-navy-900">조건 {c.label}</summary>
            <div className="mt-3 space-y-4">
              {applicable(questionsOf(tax), c.form).map((q) => (
                <div key={q.id}>
                  <p className="text-[15px] font-bold text-navy-900">{q.text}</p>
                  <div className="mt-1">
                    <QuestionField q={q} value={c.form[q.id]} onChange={(v) => setField(c.id, q.id, v)} inputId={`${c.id}-${q.id}`} />
                  </div>
                </div>
              ))}
            </div>
            {c.id !== "A" && (
              <button type="button" onClick={() => setCols((x) => x.filter((y) => y.id !== c.id))} className="mt-3 min-h-11 text-[14px] font-bold text-navy-700 underline underline-offset-4">
                이 조건 빼기
              </button>
            )}
          </details>
        ))}
      </div>

      <div className="mt-4">
        {cols.length < COMPARE_MAX ? (
          <SecondaryButton type="button" data-part="compare-add" onClick={add}>
            조건 바꿔 비교하기
          </SecondaryButton>
        ) : (
          <p data-part="compare-max" className="text-[15px] text-navy-700">{CALC_COPY.compareMax(COMPARE_MAX)}</p>
        )}
        {notice === "member_only" && (
          <div data-part="compare-join" role="status" className="mt-3 rounded-2xl border border-navy-100 bg-ivory p-5">
            <p className="text-[15px] text-navy-800">{CALC_COPY.compareJoin}</p>
            <a href="/login" className="mt-2 inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4">로그인하고 비교하기</a>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <section className="mt-8" aria-label="비교 결과" data-part="compare-result">
          {/* 데스크톱: 열을 나란히 */}
          <table className="hidden w-full text-[15px] sm:table" data-part="compare-table">
            <thead>
              <tr>
                <th scope="col" className="py-2 text-left" />
                {computed.map((c) => (
                  <th key={c.id} scope="col" className="py-2 text-right">조건 {c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-row={r.id} data-differs={r.differs} className={`border-t border-navy-100 ${r.differs ? "bg-hermes-100" : ""}`}>
                  <th scope="row" className="py-2 text-left font-bold">{r.label}</th>
                  {r.cells.map((cell, i) => (
                    <td key={i} className="py-2 text-right tabular-nums">{cell ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {/* 모바일: 탭 + 차이 요약 한 줄 */}
          <div className="sm:hidden" data-part="compare-tabs">
            <p className="mb-2 text-[15px] font-bold text-navy-900">{diff.length > 0 ? `달라지는 것: ${diff.join(" · ")}` : "달라지는 것이 없어요"}</p>
            <Tabs
              label="비교할 조건"
              items={computed.map((c) => ({
                id: c.id,
                label: `조건 ${c.label}`,
                panel: (
                  <div>
                    <ul>
                      {rows.map((r) => (
                        <li key={r.id} className={`flex justify-between py-2 ${r.differs ? "bg-hermes-100" : ""}`}>
                          <span className="font-bold">{r.label}</span>
                          <span className="tabular-nums">{r.cells[computed.indexOf(c)] ?? "—"}</span>
                        </li>
                      ))}
                    </ul>
                    <RulesetLabel version={c.view.rulesVersion} />
                  </div>
                ),
              }))}
            />
          </div>
        </section>
      )}
      <p className="mt-8 text-[13px] text-navy-500">{CALC_COPY.neverSaved}</p>
    </main>
  );
}
