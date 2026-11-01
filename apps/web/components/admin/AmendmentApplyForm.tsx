"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DarkButton } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary } from "./fields";

// 승인된 개정 단계 후보 반영 (W10-e - AIOPS-01). 판정의 기준은 서버(DB 함수)이고 화면은 요청만 보낸다 - 승인 전이면 서버가 422로 이유를 돌려준다.

type Problem = { title: string; details: string[] } | null;

/** 승인된 개정 단계 후보를 개정 트래커에 반영 (AIOPS-01) - 어느 개정안인지 편집자가 고른다. 승인 전에는 서버가 거부한다 */
export function AmendmentApplyForm({ itemId, amendments }: { itemId: number; amendments: { id: number; title: string }[] }) {
  const router = useRouter();
  const [amendmentId, setAmendmentId] = useState(amendments[0]?.id ?? 0);
  const [error, setError] = useState<Problem>(null);
  async function apply() {
    setError(null);
    const r = await adminApi("POST", "/api/admin/amendment-candidates", { itemId, amendmentId });
    if (r.status >= 200 && r.status < 300) router.refresh();
    else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="amendment-apply" data-item-id={itemId}>
      <label className="text-[14px] font-bold text-navy-900">
        개정안
        <select value={amendmentId} onChange={(e) => setAmendmentId(Number(e.target.value))} className="ml-2 min-h-11 rounded-xl border border-navy-200 px-3 text-[15px]">
          {amendments.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      </label>
      <DarkButton type="button" onClick={apply} data-testid="amendment-apply-button">개정안에 반영</DarkButton>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
    </div>
  );
}
