import { Callout, Chip, cx } from "../base";
import { UiLink } from "../link";

export type StepTimelineItem = {
  /** 단계 이름 (예: 취득) */
  title: string;
  /** 언제 — hermes-800 보조 글자 (예: 살 때) */
  when?: string;
  /** 이 단계의 세목 등 — 칩으로 */
  chips?: readonly string[];
  /** 할 일 한 줄 — 강조 문단으로 */
  note?: string;
  /** 있으면 카드 전체가 하나의 링크 */
  href?: string;
};

const CARD = "relative flex gap-5 rounded-2xl border border-navy-100 bg-white p-6";
const LINKED =
  "group transition hover:border-hermes-400 hover:shadow-[0_2px_20px_-8px_rgba(242,106,27,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

/**
 * 단계 타임라인 — SM 홈 '전 주기 타임라인' 그대로 (PRD-00 8.6).
 * STEP 원(h-14 w-14 navy-900 흰 글자 + "STEP" 10px) + 단계를 잇는 navy-200 세로선. 링크 단계는 호버 때 원이 오렌지 면 + navy-900 글자로 바뀐다
 * (흰 글자로 두면 그 순간 대비가 3.1:1로 떨어진다).
 */
export function StepTimeline({ steps, label }: { steps: readonly StepTimelineItem[]; label?: string }) {
  if (steps.length === 0) return null;
  return (
    <ol data-ui="step-timeline" aria-label={label} className="space-y-5">
      {steps.map((step, i) => {
        const body = (
          <>
            <span
              aria-hidden="true"
              className={cx(
                "z-10 flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full bg-navy-900 text-white",
                step.href && "transition group-hover:bg-hermes-500 group-hover:text-navy-900",
              )}
            >
              <span className={cx("text-[10px] font-bold tracking-widest text-navy-200", step.href && "transition group-hover:text-navy-700")}>STEP</span>
              <span className="text-[17px] leading-none font-black">{i + 1}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="text-[22px] font-black tracking-tight text-navy-900">{step.title}</span>
                {step.when && <span className="text-[15px] font-bold text-hermes-800">{step.when}</span>}
              </p>
              {step.chips && step.chips.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {step.chips.map((chip) => (
                    <li key={chip}>
                      <Chip>{chip}</Chip>
                    </li>
                  ))}
                </ul>
              )}
              {step.note && <Callout className="mt-3 leading-relaxed">{step.note}</Callout>}
            </div>
            {step.href && (
              <span aria-hidden="true" className="hidden shrink-0 self-center text-[22px] text-navy-200 transition group-hover:translate-x-0.5 group-hover:text-hermes-500 sm:block">
                →
              </span>
            )}
          </>
        );
        return (
          <li key={`${i}-${step.title}`} className="relative">
            {i < steps.length - 1 && <span data-part="connector" aria-hidden="true" className="absolute top-16 left-[27px] h-[calc(100%+0.25rem)] w-px bg-navy-200" />}
            {step.href ? (
              <UiLink href={step.href} className={cx(CARD, LINKED)}>
                {body}
              </UiLink>
            ) : (
              <div className={CARD}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
