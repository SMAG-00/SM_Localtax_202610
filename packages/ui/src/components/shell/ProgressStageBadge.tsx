import { cx } from "../base";
import { UnconfirmedChip } from "./UnconfirmedChip";

/** 개정 단계 값 `amendment_events.stage` (PRD-01B 9장) — v2.1의 6단계 */
export type ProgressStageKey = "announced" | "pre_notice" | "submitted" | "passed" | "promulgated" | "effective";

export const PROGRESS_STAGE_ORDER: readonly ProgressStageKey[] = ["announced", "pre_notice", "submitted", "passed", "promulgated", "effective"];

export const PROGRESS_STAGE_LABELS: Readonly<Record<ProgressStageKey, string>> = {
  announced: "발표",
  pre_notice: "입법예고",
  submitted: "국회 제출",
  passed: "의결",
  promulgated: "공포",
  effective: "시행",
};

/** 단계 기록 한 건 — 편집자가 기록한 날짜·원문 (TX-07). 건너뛴 단계는 skipped + 사유 */
export type ProgressStageEvent = {
  stage: ProgressStageKey;
  /** YYYY-MM-DD (KST) */
  occurredOn: string;
  sourceUrl?: string;
  skipped?: boolean;
  skipReason?: string;
};

export type ProgressStageResult = {
  /** 가장 늦은 순서의 기록 (건너뛴 단계 제외). 기록이 없으면 null */
  current: ProgressStageKey | null;
  /** 화면 글자 — 시행일 전이면 "시행 예정" */
  currentLabel: string;
  /** 확정 기준 단계(초기값 공포)에 이르렀는지 — false면 `확정 아님` 칩을 붙인다 */
  confirmed: boolean;
  /** 단계마다 마지막 기록 (같은 단계를 다시 기록하면 정정 기록이 앞 기록을 대신한다) */
  byStage: Partial<Record<ProgressStageKey, ProgressStageEvent>>;
  /** 시행 기록이 있고 아직 시행일 전인지 */
  effectivePending: boolean;
};

/** 오늘 날짜 (한국 시간, YYYY-MM-DD) — 시행일 D는 D 00:00(KST)부터 '시행' (TX-07) */
function todayInKorea(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * 현재 단계 계산 — 가장 늦은 순서의 기록이 현재 단계 (TX-07). 확정 기준은 settings 값(초기값 공포, TX-08)을 넘겨받는다.
 */
export function resolveProgressStage(
  events: readonly ProgressStageEvent[],
  { today = todayInKorea(), confirmStage = "promulgated" }: { today?: string; confirmStage?: ProgressStageKey } = {},
): ProgressStageResult {
  const byStage: Partial<Record<ProgressStageKey, ProgressStageEvent>> = {};
  for (const e of events) byStage[e.stage] = e;

  let currentIndex = -1;
  PROGRESS_STAGE_ORDER.forEach((stage, i) => {
    const e = byStage[stage];
    if (e && !e.skipped) currentIndex = i;
  });
  const current = currentIndex >= 0 ? PROGRESS_STAGE_ORDER[currentIndex] : null;
  const effective = byStage.effective;
  const effectivePending = Boolean(effective && !effective.skipped && today < effective.occurredOn);
  const currentLabel = current === null ? "기록 전" : current === "effective" && effectivePending ? "시행 예정" : PROGRESS_STAGE_LABELS[current];
  const confirmed = currentIndex >= PROGRESS_STAGE_ORDER.indexOf(confirmStage);
  return { current, currentLabel, confirmed, byStage, effectivePending };
}

/** 단계별 채움 색 (PRD-00 8.6·8.3) — 공포 전은 [심] 칩 조합, 공포는 [법] 칩 조합, 시행 예정 amber, 시행 emerald */
function filledTone(stage: ProgressStageKey, effectivePending: boolean): string {
  if (stage === "promulgated") return "border-navy-900 bg-navy-900 text-white";
  if (stage === "effective") return effectivePending ? "border-navy-100 bg-amber-50 text-amber-800" : "border-navy-100 bg-emerald-50 text-emerald-800";
  return "border-navy-100 bg-navy-50 text-navy-700";
}

function ExternalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export type ProgressStageBadgeProps = {
  events: readonly ProgressStageEvent[];
  /** 오늘 날짜(KST, YYYY-MM-DD). 비우면 지금 시각으로 계산한다 */
  today?: string;
  /** 확정 기준 단계 — settings 값(초기값 공포, TX-08) */
  confirmStage?: ProgressStageKey;
};

/**
 * 진행 단계 배지 — 개정 트래커의 6단계 `발표 · 입법예고 · 국회 제출 · 의결 · 공포 · 시행` (PRD-00 8.6, TX-07·08, CAT-04).
 * 1024px 이상 가로 6칸 줄, 그 아래는 세로 단계 타임라인. 지난 단계는 채우고, 칸마다 날짜(고정폭)·원문 링크.
 * 공포 전이면 옆에 `확정 아님` 칩 하나. 색에 더해 글자(시행 예정·해당 없음·기록 전)로 뜻을 전한다 (8.9).
 */
export function ProgressStageBadge({ events, today, confirmStage }: ProgressStageBadgeProps) {
  const r = resolveProgressStage(events, { today, confirmStage });
  const currentIndex = r.current === null ? -1 : PROGRESS_STAGE_ORDER.indexOf(r.current);

  return (
    <div data-ui="progress-stage-badge" data-stage={r.current ?? "none"} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[15px] font-bold text-navy-900">
          현재 단계 <span data-part="current-label">{r.currentLabel}</span>
        </p>
        {!r.confirmed && <UnconfirmedChip />}
      </div>

      <ol aria-label="개정 진행 단계" className="grid grid-cols-1 gap-2 lg:grid-cols-6">
        {PROGRESS_STAGE_ORDER.map((stage, i) => {
          const e = r.byStage[stage];
          // done = 기록됨(채움) · skipped = 해당 없음 · missing = 현재보다 앞인데 기록이 빠짐 · upcoming = 아직 오지 않음
          const state = e?.skipped ? "skipped" : e ? "done" : i < currentIndex ? "missing" : "upcoming";
          const isCurrent = i === currentIndex;
          const label = stage === "effective" && state === "done" && r.effectivePending ? "시행 예정" : PROGRESS_STAGE_LABELS[stage];
          const last = i === PROGRESS_STAGE_ORDER.length - 1;
          const tone =
            state === "done"
              ? filledTone(stage, r.effectivePending)
              : state === "skipped"
                ? "border-dashed border-navy-200 bg-white text-navy-600"
                : "border-navy-100 bg-white text-navy-400";

          return (
            <li key={stage} data-stage-cell={stage} data-state={state} aria-current={isCurrent ? "step" : undefined} className="relative flex gap-3 lg:block">
              {/* 모바일 세로 타임라인 — 단계 점과 잇는 선 (SM 단계 타임라인 문법) */}
              <span
                aria-hidden="true"
                className={cx("relative z-10 mt-3 size-[24px] shrink-0 rounded-full lg:hidden", state === "done" ? "bg-navy-900" : "border-2 border-navy-200 bg-white")}
              />
              {!last && <span aria-hidden="true" className="absolute top-10 bottom-[-0.5rem] left-[11.5px] w-px bg-navy-200 lg:hidden" />}

              <div data-part="stage-card" className={cx("min-w-0 flex-1 rounded-xl border px-3 py-2.5", tone, isCurrent && "border-t-[3px] border-t-hermes-500")}>
                <p data-part="stage-label" className="text-[15px] font-bold">
                  {label}
                </p>
                {isCurrent && <span className="sr-only">(현재 단계)</span>}
                {state === "done" && e && (
                  <>
                    <p className="font-mono text-[13px] tracking-wide">{e.occurredOn}</p>
                    {e.sourceUrl && (
                      <a
                        href={e.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${label} 원문 보기 (새 창)`}
                        className="inline-flex min-h-11 items-center gap-1 text-[13px] font-bold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
                      >
                        원문 보기 <ExternalIcon /> (새 창)
                      </a>
                    )}
                  </>
                )}
                {state === "skipped" && e && (
                  <p className="text-[13px]">
                    해당 없음{e.skipReason?.trim() ? ` · ${e.skipReason.trim()}` : ""}
                  </p>
                )}
                {state === "missing" && <p className="text-[13px]">기록 없음</p>}
                {state === "upcoming" && <p className="text-[13px]">기록 전</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
