"use client";

import Link from "next/link";
import { STEP_STATUS_LABELS, type PublishCheck, type PublishStep, type StepStatus, type StepTarget } from "@/lib/admin/publish-steps";
import { ConfirmPublish } from "./ConfirmPublish";
import { OUTLINE_BUTTON, ToneChip, type Tone } from "./ui";

const STATUS_TONE: Record<StepStatus, Tone> = { done: "emerald", todo: "amber", other: "navy" };
const CIRCLED = ["①", "②", "③"];
/** 같은 화면의 칸이 없을 때(권한이 없어 칸이 안 그려진 경우) 돌아갈 곳 */
const FALLBACK = 'aside[aria-label="점검·발행"]';

/** 같은 화면의 칸으로 스크롤하고 포커스를 옮긴다 — 칸이 입력 요소가 아니면 안의 첫 입력 요소에 */
function jumpTo(selector: string) {
  const el = document.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(FALLBACK);
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  const focusable = el.matches("input, select, textarea, button, a[href]") ? el : (el.querySelector<HTMLElement>("input, select, textarea, button") ?? el);
  if (focusable === el && !el.matches("input, select, textarea, button, a[href]")) el.tabIndex = -1;
  focusable.focus({ preventScroll: true });
}

function Go({ target, label, testId }: { target: StepTarget; label: string; testId: string }) {
  if (target.kind === "page") {
    return (
      <Link href={target.href} className={OUTLINE_BUTTON} data-testid={testId}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" className={OUTLINE_BUTTON} data-testid={testId} onClick={() => jumpTo(target.selector)}>
      {label}
    </button>
  );
}

function CheckBody({ c }: { c: PublishCheck }) {
  return (
    <>
      <p className="mt-1 text-[15px] text-navy-700 [overflow-wrap:anywhere]">{c.description}</p>
      {c.note && <p className="mt-1 text-[14px] font-bold text-amber-800">{c.note}</p>}
      {c.items.length > 0 && (
        <ul className="mt-2 space-y-2">
          {c.items.map((it, i) => (
            <li key={`${i}-${it.message}`} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-ivory px-3 py-2 text-[14px] text-navy-800">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{it.message}</span>
              {c.id === "other-blockers" && <Go target={it.target} label="바로 가기" testId={`step-go-${c.id}-${i}`} />}
            </li>
          ))}
        </ul>
      )}
      {c.status !== "done" && c.target && c.id !== "other-blockers" && (
        <div className="mt-3">
          {c.id === "publish" && !c.enabled ? (
            <button type="button" className={OUTLINE_BUTTON} disabled data-testid={`step-go-${c.id}`}>
              바로 가기 (막힘이 풀리면 켜집니다)
            </button>
          ) : (
            <Go target={c.target} label="바로 가기" testId={`step-go-${c.id}`} />
          )}
        </div>
      )}
    </>
  );
}

function Who({ c }: { c: PublishCheck }) {
  return (
    <span className="text-[14px] text-navy-700" data-testid={`step-who-${c.id}`}>
      누가: {c.who}
      {c.whoIsMe ? " (지금 계정이 할 수 있음)" : " (지금 계정은 할 수 없음)"}
    </span>
  );
}

/**
 * 발행까지 할 일 (F4 · 2026-10-31 3단계) — ① 쓰기 → ② 확인 → ③ 발행. 서버가 발행 판정으로 만든 단계표를 그대로 보인다. 화면은 따로 판정하지 않는다.
 * ①·②는 안의 항목(예전 단계)마다 상태·누가·바로 가기를 보이고, ②는 지금 계정이 남은 확인·발행을 모두 할 수 있으면 한 버튼 칸을 보인다.
 * 저장·출처 추가·서명 뒤 화면을 다시 불러오면(router.refresh) 서버가 새 판정으로 이 표를 다시 만든다.
 */
export function PublishSteps({ steps }: { steps: readonly PublishStep[] }) {
  const remaining = steps.filter((s) => s.status !== "done").length;
  return (
    <section data-testid="publish-steps" aria-labelledby="publish-steps-title" className="mb-6 rounded-2xl border border-navy-100 bg-white p-4 sm:p-6">
      <h2 id="publish-steps-title" className="text-[19px] font-black text-navy-900">
        발행까지 할 일
      </h2>
      <p className="mt-1 text-[15px] text-navy-600" data-testid="publish-steps-summary">
        {remaining === 0 ? "모든 단계를 마쳤습니다." : `남은 단계 ${remaining}개 — ① 쓰기 → ② 확인 → ③ 발행 차례로 합니다.`} 발행 판정(점검 패널)과 같은 기준입니다.
      </p>
      <ol className="mt-4 space-y-3">
        {steps.map((s) => {
          const single = s.id === "publish" ? s.checks[0] : undefined;
          return (
            <li key={s.id} data-step={s.id} data-status={s.status} className="rounded-xl border border-navy-100 p-4" aria-label={`${s.number}단계 ${s.title} — ${STEP_STATUS_LABELS[s.status]}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[15px] font-bold text-navy-600">{CIRCLED[s.number - 1] ?? s.number}</span>
                <h3 className="text-[17px] font-black text-navy-900">{s.title}</h3>
                <ToneChip tone={STATUS_TONE[s.status]}>
                  <span data-testid={`step-status-${s.id}`}>{STEP_STATUS_LABELS[s.status]}</span>
                </ToneChip>
                {single && <Who c={single} />}
              </div>
              {single ? (
                <CheckBody c={single} />
              ) : (
                <>
                  <p className="mt-1 text-[15px] text-navy-700 [overflow-wrap:anywhere]">{s.description}</p>
                  <ul className="mt-3 space-y-2">
                    {s.checks.map((c) => (
                      <li key={c.id} data-check={c.id} data-status={c.status} className="rounded-lg border border-navy-100 px-3 py-3" aria-label={`${c.title} — ${STEP_STATUS_LABELS[c.status]}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-[15px] font-bold text-navy-900">{c.title}</h4>
                          <ToneChip tone={STATUS_TONE[c.status]}>
                            <span data-testid={`step-status-${c.id}`}>{STEP_STATUS_LABELS[c.status]}</span>
                          </ToneChip>
                          <Who c={c} />
                        </div>
                        <CheckBody c={c} />
                      </li>
                    ))}
                  </ul>
                  {s.plan && <ConfirmPublish plan={s.plan} />}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
