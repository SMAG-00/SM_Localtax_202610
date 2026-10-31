"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton } from "@ltr/ui";
import { adminApi } from "@/lib/admin/api-client";
import { allConfirmChecked, doneNote, runConfirmPublish } from "@/lib/admin/confirm-publish";
import type { ConfirmPlan } from "@/lib/admin/publish-steps";
import { ErrorSummary, StatusNote } from "./fields";
import { OUTLINE_BUTTON } from "./ui";
import { useHydrated } from "./useHydrated";

/** 편집 화면에 저장하지 않은 고침이 있는지 — ArticleWorkspace가 원고 칸 묶음에 data-unsaved="true"를 붙인다 */
export const UNSAVED_SELECTOR = '[data-unsaved="true"]';

/**
 * ② 확인 한 번에 끝내기 — 세무 감수 항목(대상 기사만)과 편집 확인 항목을 한 칸에서 체크하고 버튼 하나로
 * 세무 감수 승인 → 편집 승인 → 발행을 차례로 보낸다. 첫 실패에서 멈추고 서버 문장을 그대로 보인다.
 */
export function ConfirmPublish({ plan }: { plan: ConfirmPlan }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ title: string; details: string[]; note: string | null } | null>(null);
  const [success, setSuccess] = useState("");
  const allChecked = allConfirmChecked(plan, checked);
  const toggle = (key: string, on: boolean) => setChecked((c) => ({ ...c, [key]: on }));

  async function go() {
    setFailure(null);
    setSuccess("");
    if (document.querySelector(UNSAVED_SELECTOR)) {
      setFailure({ title: "저장하지 않은 고침이 있습니다 — 아래 [저장]을 먼저 누릅니다", details: [], note: null });
      return;
    }
    setPending(true);
    const r = await runConfirmPublish(plan, adminApi);
    setPending(false);
    if (r.ok) {
      setSuccess(r.warnings > 0 ? `발행했습니다 — 경고 ${r.warnings}개는 발행 기록에 남았습니다` : "발행했습니다");
      router.refresh();
      return;
    }
    setFailure({ title: r.title, details: r.details, note: doneNote(r.done) });
  }

  const reason = !plan.ready ? plan.blockedReason : !allChecked ? "확인 항목을 모두 체크하면 버튼이 켜집니다." : null;

  return (
    <div data-testid="confirm-publish" data-mode={plan.mode} className="mt-3 rounded-xl border border-navy-200 bg-ivory p-4">
      <h4 className="text-[16px] font-black text-navy-900">한 번에 확인하고 발행</h4>
      <p className="mt-1 text-[14px] text-navy-700">이 확인은 지금 저장된 버전에만 해당합니다. 원고를 고치면 다시 확인합니다.</p>
      {plan.tax && (
        <fieldset className="mt-3 min-w-0 space-y-1">
          <legend className="text-[15px] font-bold text-navy-900">세무 감수 확인</legend>
          {plan.taxChecks.map((c) => (
            <CheckboxField key={c.id} id={`confirm-tax-${c.id}`} label={c.label} checked={checked[`tax.${c.id}`] === true} onChange={(e) => toggle(`tax.${c.id}`, e.target.checked)} />
          ))}
        </fieldset>
      )}
      {plan.desk && (
        <fieldset className="mt-3 min-w-0 space-y-1">
          <legend className="text-[15px] font-bold text-navy-900">편집 확인</legend>
          {plan.deskChecks.map((c) => (
            <CheckboxField key={c.id} id={`confirm-desk-${c.id}`} label={c.label} checked={checked[`desk.${c.id}`] === true} onChange={(e) => toggle(`desk.${c.id}`, e.target.checked)} />
          ))}
        </fieldset>
      )}
      {plan.note && (
        <p className="mt-3 text-[14px] font-bold text-amber-800" data-testid="self-publish-note">
          {plan.note}
        </p>
      )}
      <DarkButton type="button" className="mt-3" data-testid="confirm-publish-button" onClick={go} disabled={!plan.ready || !allChecked || pending || !hydrated} aria-describedby={reason ? "confirm-publish-reason" : undefined}>
        {pending ? "처리 중" : plan.label}
      </DarkButton>
      {reason && (
        <p id="confirm-publish-reason" className="mt-2 text-[14px] text-navy-700">
          {reason}
        </p>
      )}
      {success && (
        <div className="mt-3">
          <StatusNote>{success}</StatusNote>
        </div>
      )}
      {failure && (
        <div className="mt-3 space-y-2">
          <ErrorSummary title={failure.title} messages={failure.details} />
          {failure.note && (
            <>
              <p className="text-[14px] text-navy-700">{failure.note}</p>
              <button type="button" className={OUTLINE_BUTTON} onClick={() => router.refresh()}>
                화면 새로 불러오기
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
