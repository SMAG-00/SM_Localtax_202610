/** 진행 단계 — 찾는 중 → n건 확인 → 답변 작성 중 */
export type ProgressStatusProps = { stage: "searching" } | { stage: "found" | "writing"; /** 찾은 사이트 자료 수 */ count: number };

function foundStep(count: number): string {
  return Number.isInteger(count) && count >= 0 ? `${count}건 확인` : "결과 확인";
}

/** 진행 상태 — 고정폭 한 줄, aria-live=polite. 1단계 AI 도우미는 "사이트에서 찾는 중 → 3건 확인 → 답변 작성 중" */
export function ProgressStatus(props: ProgressStatusProps) {
  const steps = ["사이트에서 찾는 중"];
  if (props.stage !== "searching") steps.push(foundStep(props.count));
  if (props.stage === "writing") steps.push("답변 작성 중");

  return (
    <p data-ui="progress-status" role="status" aria-live="polite" className="font-mono text-[13px] tracking-wide text-navy-600">
      {steps.join(" → ")}
    </p>
  );
}
