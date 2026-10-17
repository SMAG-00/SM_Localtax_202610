"use client";

import { useState } from "react";
import { DarkButton } from "@ltr/ui";
import { adminApi, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary, StatusNote } from "./fields";
import { useHydrated } from "./useHydrated";

/** 검토 요청 — 초안·보류 → 검토 중. 편집 승인·발행은 편집 책임자가 따로 한다 */
export function SubmitForReview({ articleId, status, onChanged }: { articleId: number; status: string; onChanged: () => void }) {
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  if (status !== "draft" && status !== "held" && !done) return null;

  async function submit() {
    setPending(true);
    setError("");
    const r = await adminApi("POST", `/api/admin/articles/${articleId}/submit`);
    setPending(false);
    if (r.status === 200) {
      setDone("검토를 요청했습니다 — 편집 책임자가 승인합니다");
      onChanged();
      return;
    }
    setError(apiErrorMessage(r));
  }

  return (
    <section aria-labelledby="submit-title" className="rounded-2xl border border-navy-100 bg-white p-6">
      <h2 id="submit-title" className="text-[17px] font-black text-navy-900">
        검토 요청
      </h2>
      <p className="mt-1 text-[14px] text-navy-600">저장을 마친 뒤 요청하세요. 고치면 편집 승인을 다시 받아야 합니다.</p>
      {error && <ErrorSummary title={error} messages={[]} />}
      {done ? (
        <div className="mt-3">
          <StatusNote>{done}</StatusNote>
        </div>
      ) : (
        <DarkButton className="mt-3" onClick={submit} disabled={pending || !hydrated}>
          {pending ? "요청 중" : "검토 요청"}
        </DarkButton>
      )}
    </section>
  );
}
