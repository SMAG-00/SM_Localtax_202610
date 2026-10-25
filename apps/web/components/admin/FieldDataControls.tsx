"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DarkButton } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { fieldActions, publishResultText, verdictText } from "@/lib/field-data/review-ui";
import { ErrorSummary } from "./fields";
import { useHydrated } from "./useHydrated";

// 분야 데이터 후보의 승인 뒤 단계 (W10-h - PR-06 · LG-15 · DF-06). 승인·반려는 ReviewItemControls 가 하고, 여기는 [제4유형 검사]·[공개 반영].
// 판정은 서버(DB field_publish)가 한다 - 통과 기록 없는 제4유형·유형 없음·원천 불허는 422 로 돌아온다.

type Problem = { title: string; details: string[] } | null;

export function FieldDataControls({ id, status, koglType, hasBody }: { id: number; status: string; koglType: string | null; hasBody: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<Problem>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const actions = fieldActions(status, { koglType, hasBody });
  if (!actions.publish && !actions.rightsCheck) return null;

  async function run(op: "rights-check" | "publish") {
    setError(null);
    setNotice(null);
    const r = await adminApi("POST", "/api/admin/field-data", { op, id });
    if (r.status !== 200) {
      setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
      return;
    }
    const body = (r.body ?? {}) as { verdict?: { status?: string } | null; result?: { action?: string } };
    setNotice(op === "rights-check" ? `제4유형 검사: ${verdictText(body.verdict?.status)}` : publishResultText(body.result?.action));
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-2" data-field-controls={id}>
      {error && <ErrorSummary id={`fd-error-${id}`} title={error.title} messages={error.details} />}
      {notice && (
        <p role="status" data-part="field-notice" className="text-[14px] font-bold text-navy-900">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.rightsCheck && (
          <DarkButton type="button" disabled={!hydrated} data-action="rights-check" onClick={() => run("rights-check")}>
            제4유형 검사
          </DarkButton>
        )}
        {actions.publish && (
          <DarkButton type="button" disabled={!hydrated} data-action="field-publish" onClick={() => run("publish")}>
            공개 반영
          </DarkButton>
        )}
      </div>
    </div>
  );
}
