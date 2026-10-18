"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary, StatusNote } from "./fields";
import { useHydrated } from "./useHydrated";

// 규정 버전 확정 — 담당자 승인 (NAV-13). 담당자가 원문과 우리 매체의 실제 등록 유형을 확인했다고 표시해야 확정된다.
// 확정에 빠진 칸(서버가 같은 검사로 계산한 목록)을 먼저 보인다 — 확정하면 고칠 수 없다는 것도 알린다.

export function RequirementConfirm({ id, missing, label }: { id: number; missing: readonly string[]; label: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [attested, setAttested] = useState(false);
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    setPending(true);
    const r = await adminApi("POST", `/api/admin/news-readiness/requirements/${id}/confirm`, { attested });
    setPending(false);
    if (r.status === 200) {
      setDone("확정했습니다 — 이제 이 버전은 고칠 수 없고, 대시보드가 이 버전의 정의로 셉니다");
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3" aria-label={label}>
      {missing.length > 0 && (
        <div data-part="confirm-missing" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
          <p className="font-bold">확정하려면 이 칸을 먼저 채우세요</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {missing.map((m) => (
              <li key={m} className="[overflow-wrap:anywhere]">
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[15px] text-navy-700">확정하면 이 버전은 고치거나 지울 수 없습니다. 규정이 바뀌면 새 버전을 적어 다시 확정합니다 — 이 버전은 기록으로 남습니다.</p>
      <CheckboxField
        id={`confirm-${id}-attested`}
        label="공식 규정 원문과 우리 매체의 실제 등록 유형을 확인했습니다"
        checked={attested}
        onChange={(e) => setAttested(e.target.checked)}
      />
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "확정하는 중" : "이 버전 확정"}
      </DarkButton>
    </form>
  );
}
