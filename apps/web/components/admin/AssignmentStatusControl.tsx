"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, SelectField } from "@ltr/ui";
import { adminApi, apiErrorMessage } from "@/lib/admin/api-client";
import { nextStatus, statusChangePayload } from "@/lib/admin/assignment-form";
import { ASSIGNMENT_STATUS_LABELS, labelOf, optionsOf } from "@/lib/admin/labels";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

/**
 * 기획 상태 바꾸기 (NAV-09) — 다음 상태를 먼저 고른다. 순서·조건 규칙은 DB가 강제하고, 거부되면 그 문장(409)을 그대로 보인다.
 * 보류(held)는 반려 사유가 필요하다 (월간 점검).
 */
export function AssignmentStatusControl({ assignmentId, status }: { assignmentId: number; status: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [next, setNext] = useState(nextStatus(status));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const [shownStatus, setShownStatus] = useState(status);
  // 서버가 새 상태로 다시 그리면 다음 상태 제안도 바꾼다 (알림 문장은 남긴다)
  if (shownStatus !== status) {
    setShownStatus(status);
    setNext(nextStatus(status));
  }
  const base = `asg-${assignmentId}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone("");
    const p = statusChangePayload(next, reason);
    if (!p.ok) return setError(p.error);
    setPending(true);
    const r = await adminApi("PATCH", `/api/admin/assignments/${assignmentId}`, p.body);
    setPending(false);
    if (r.status === 200) {
      setDone(`상태를 바꿨습니다: ${labelOf(ASSIGNMENT_STATUS_LABELS, status)} → ${labelOf(ASSIGNMENT_STATUS_LABELS, next)}`);
      router.refresh();
      return;
    }
    setError(apiErrorMessage(r));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="기획 상태 바꾸기">
      <SelectField id={`${base}-status`} label="바꿀 상태" options={optionsOf(ASSIGNMENT_STATUS_LABELS)} value={next} onChange={(e) => setNext(e.target.value)} />
      {next === "held" && <TextAreaField id={`${base}-reason`} label="반려 사유" required value={reason} onChange={(e) => setReason(e.target.value)} />}
      {error && <ErrorSummary title={error} messages={[]} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "바꾸는 중" : "상태 바꾸기"}
      </DarkButton>
    </form>
  );
}
