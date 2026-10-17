"use client";

import { SelectField, TextField } from "@ltr/ui";
import type { SolvedCase } from "@ltr/editorial";
import { FieldErrorText, TextAreaField } from "../fields";
import { OUTLINE_BUTTON } from "../ui";
import type { SectionProps } from "./types";

const EMPTY: SolvedCase = { situation: "", issue: "", result: "", lesson: "", resultEvidence: [] };

/** 해결 사례 4칸 (CAT-05) — 상황 → 쟁점 → 결과(근거: 결정례 사건번호·해석 번호 + 링크) → 교훈. 개인을 알아볼 수 있는 정보는 넣지 않는다 */
export function SolvedCaseEditor({ state, update, errors, readOnly }: SectionProps) {
  const sc = state.solvedCase ?? EMPTY;
  const set = (patch: Partial<SolvedCase>) => update({ solvedCase: { ...sc, ...patch } });
  const cells: [keyof Omit<SolvedCase, "resultEvidence">, string][] = [
    ["situation", "상황"],
    ["issue", "쟁점"],
    ["result", "결과"],
    ["lesson", "교훈"],
  ];
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-navy-700">주민등록번호·전화번호·이메일·지번까지 적은 주소는 저장할 수 없습니다.</p>
      <FieldErrorText id="solved-case" error={errors["solved-case"]} />
      {cells.map(([key, label]) => (
        <TextAreaField key={key} id={`sc-${key}`} label={label} required disabled={readOnly} value={sc[key]} onChange={(e) => set({ [key]: e.target.value })} />
      ))}
      <div className="space-y-3">
        <p className="text-[15px] font-bold text-navy-900">결과의 근거</p>
        {sc.resultEvidence.map((ev, i) => (
          <div key={i} className="grid gap-3 rounded-xl border border-navy-100 p-3 sm:grid-cols-3">
            <SelectField
              id={`sc-ev-${i}-kind`}
              label={`근거 ${i + 1} 종류`}
              disabled={readOnly}
              options={[
                { value: "decision", label: "결정례" },
                { value: "interpretation", label: "해석" },
              ]}
              value={ev.kind}
              onChange={(e) => set({ resultEvidence: sc.resultEvidence.map((x, j) => (j === i ? { ...x, kind: e.target.value as "decision" | "interpretation" } : x)) })}
            />
            <TextField
              id={`sc-ev-${i}-number`}
              label="사건번호·해석 번호"
              disabled={readOnly}
              value={ev.number}
              onChange={(e) => set({ resultEvidence: sc.resultEvidence.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)) })}
            />
            <TextField
              id={`sc-ev-${i}-url`}
              label="출처 링크"
              disabled={readOnly}
              value={ev.url}
              onChange={(e) => set({ resultEvidence: sc.resultEvidence.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
            />
          </div>
        ))}
        {!readOnly && (
          <button type="button" className={OUTLINE_BUTTON} onClick={() => set({ resultEvidence: [...sc.resultEvidence, { kind: "decision", number: "", url: "" }] })}>
            근거 더하기
          </button>
        )}
      </div>
    </div>
  );
}
