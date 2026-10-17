import { useId } from "react";
import { nonBlank } from "./format";

const MAX_LINES = 3;

/** 핵심 요약 상자 — 기사 머리 아래 강조 문단 문법 상자, 3줄 이하 (OPT-03). 편집자가 쓴 요약만 넣는다 */
export function KeySummary({ lines }: { lines: readonly string[] }) {
  const labelId = useId();
  const shown = nonBlank(lines);
  if (shown.length === 0 || shown.length > MAX_LINES) return null;

  return (
    <section data-ui="key-summary" aria-labelledby={labelId} className="border-l-2 border-hermes-500 bg-white py-4 pr-6 pl-5">
      <p id={labelId} className="text-[13px] font-bold text-hermes-800">
        핵심 요약
      </p>
      <ul className="mt-2 space-y-1 text-[17px] text-navy-900">
        {shown.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
