"use client";

import { cx } from "@ltr/ui";
import { isAnswerValid, type Question } from "@/lib/calc/shared";

// 질문 하나의 입력 칸 (CALC-11) - 질문형 화면과 [한 화면에 모두 입력] 폼이 같은 부품을 쓴다. 값은 부모 상태에만 있다(저장소·전송 0).

const CHOICE = "min-h-12 rounded-xl border px-4 py-2 text-[17px] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";
const ON = "border-hermes-500 bg-hermes-100 text-navy-900";
const OFF = "border-navy-200 bg-white text-navy-800 hover:border-navy-400";
const INPUT = "min-h-12 w-full rounded-xl border border-navy-200 bg-white px-4 text-[17px] tabular-nums text-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

const fmt = (n: number | undefined) => (n && n > 0 ? String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "");
const digits = (s: string): number | undefined => {
  const d = s.replace(/[^\d]/g, "");
  return d === "" ? undefined : Number(d);
};

export type FieldProps<F> = { q: Question<F>; value: unknown; onChange: (v: unknown) => void; inputId: string };

export function QuestionField<F>({ q, value, onChange, inputId }: FieldProps<F>) {
  switch (q.kind) {
    case "choice":
      return (
        <div role="group" aria-label={q.text} className="flex flex-wrap gap-2">
          {(q.options ?? []).map((o) => (
            <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={cx(CHOICE, value === o.value ? ON : OFF)}>
              {o.label}
            </button>
          ))}
        </div>
      );
    case "yesno":
      return (
        <div role="group" aria-label={q.text} className="flex gap-2">
          {[
            [true, "예"],
            [false, "아니요"],
          ].map(([v, label]) => (
            <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={cx(CHOICE, "min-w-24", value === v ? ON : OFF)}>
              {label as string}
            </button>
          ))}
        </div>
      );
    case "won":
      return (
        <div>
          <input id={inputId} aria-label={q.text} inputMode="numeric" autoComplete="off" className={INPUT} value={fmt(value as number | undefined)} onChange={(e) => onChange(digits(e.target.value))} />
          <span className="mt-1 block text-[13px] text-navy-500">원 단위로 입력해요</span>
        </div>
      );
    case "wonlist": {
      const rows = Array.isArray(value) && value.length > 0 ? (value as number[]) : [0];
      return (
        <div className="space-y-2">
          {rows.map((n, i) => (
            <input
              key={i}
              aria-label={`${q.text} ${i + 1}번째`}
              inputMode="numeric"
              autoComplete="off"
              className={INPUT}
              value={fmt(n)}
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? (digits(e.target.value) ?? 0) : x)))}
            />
          ))}
          <div className="flex gap-2">
            {rows.length < 20 && (
              <button type="button" onClick={() => onChange([...rows, 0])} className={cx(CHOICE, OFF, "text-[15px]")}>
                한 채 더 넣기
              </button>
            )}
            {rows.length > 1 && (
              <button type="button" onClick={() => onChange(rows.slice(0, -1))} className={cx(CHOICE, OFF, "text-[15px]")}>
                마지막 줄 빼기
              </button>
            )}
          </div>
        </div>
      );
    }
    case "count":
    case "area":
      return <input id={inputId} aria-label={q.text} inputMode={q.kind === "area" ? "decimal" : "numeric"} autoComplete="off" className={INPUT} value={typeof value === "number" ? String(value) : ""} onChange={(e) => onChange(e.target.value.trim() === "" ? undefined : Number(e.target.value.replace(/[^\d.]/g, "")))} />;
    case "date":
      return <input id={inputId} aria-label={q.text} type="date" className={INPUT} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />;
  }
}

/** 값을 쓰는 질문(선택지가 아닌)은 [다음]을 눌러야 넘어간다 */
export const needsNext = (q: { kind: string }) => !["choice", "yesno"].includes(q.kind);
export { isAnswerValid };
