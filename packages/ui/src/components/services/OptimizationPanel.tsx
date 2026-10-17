import { useId } from "react";
import { DarkButton } from "../base";
import { StateChip } from "./parts";

export type OptimizationAxis = "seo" | "aeo" | "geo" | "common";
export type CheckResult = "pass" | "warn" | "block";
export type OptimizationCheck = { id: string; label: string; result: CheckResult; detail?: string };

export type OptimizationPanelProps = {
  /** 축별 점수 0~100 (정수) — `packages/seo-lint` 결과 */
  scores: Record<OptimizationAxis, number>;
  checks: readonly OptimizationCheck[];
  onApprove?: () => void;
};

/** 점수 옆 고정 문구 (PRD-00 8.6) */
export const OPTIMIZATION_NOTICE = "내부 품질 지표 — 검색 순위 예측이 아닙니다";

const AXES: ReadonlyArray<[OptimizationAxis, string]> = [
  ["seo", "SEO"],
  ["aeo", "AEO"],
  ["geo", "GEO"],
  ["common", "공통"],
];
const RESULT: Record<CheckResult, { label: string; tone: "emerald" | "amber" | "rose"; order: number }> = {
  block: { label: "차단", tone: "rose", order: 0 },
  warn: { label: "경고", tone: "amber", order: 1 },
  pass: { label: "통과", tone: "emerald", order: 2 },
};
const MIN_SCORE = 0;
const MAX_SCORE = 100;

const isScore = (n: number) => Number.isInteger(n) && n >= MIN_SCORE && n <= MAX_SCORE;

/**
 * 최적화 점검 패널 — 백오피스 기사 편집기 오른쪽 열 (OPT-03 · OPT-06 · OPT-07).
 * 차단 항목이 하나라도 있으면 [발행 승인] 비활성. 결과는 색에 더해 글자(통과·경고·차단). 독자 화면에는 쓰지 않는다.
 */
export function OptimizationPanel({ scores, checks, onApprove }: OptimizationPanelProps) {
  const headingId = useId();
  const reasonId = useId();
  const sorted = checks.map((c, i) => ({ c, i })).sort((a, b) => RESULT[a.c.result].order - RESULT[b.c.result].order || a.i - b.i).map((x) => x.c);
  const blocked = checks.filter((c) => c.result === "block").length;

  return (
    <section data-ui="optimization-panel" aria-labelledby={headingId} className="rounded-2xl border border-navy-100 bg-white p-6">
      <h2 id={headingId} className="text-[17px] font-black text-navy-900">
        최적화 점검
      </h2>
      <dl className="mt-3 grid grid-cols-4 gap-2">
        {AXES.map(([axis, label]) => {
          const value = scores[axis];
          const ok = isScore(value);
          return (
            <div key={axis} className="rounded-xl border border-navy-100 bg-ivory px-2 py-3 text-center">
              <dt className="text-[13px] font-bold text-navy-600">{label}</dt>
              <dd className="mt-1 font-mono text-[19px] font-bold tracking-wide text-navy-900" {...(ok ? {} : { "aria-label": "점수 없음" })}>
                {ok ? value : "—"}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-2 text-[13px] text-navy-600">{OPTIMIZATION_NOTICE}</p>

      <ul aria-label="점검 항목" className="mt-4 space-y-2">
        {sorted.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-[15px] text-navy-800">
            <StateChip part="result" tone={RESULT[c.result].tone}>
              {RESULT[c.result].label}
            </StateChip>
            <span className="min-w-0">
              <span className="block font-bold text-navy-900">{c.label}</span>
              {c.detail && <span className="block text-[14px] text-navy-600">{c.detail}</span>}
            </span>
          </li>
        ))}
      </ul>

      {blocked > 0 && (
        <p id={reasonId} className="mt-4 text-[14px] font-bold text-navy-800">
          차단 항목 {blocked}개를 고치면 발행할 수 있습니다
        </p>
      )}
      <div className="mt-3">
        <DarkButton disabled={blocked > 0} onClick={onApprove} aria-describedby={blocked > 0 ? reasonId : undefined}>
          발행 승인
        </DarkButton>
      </div>
    </section>
  );
}
