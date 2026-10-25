"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { CHECK_LABELS, TERMS_LABELS, TERMS_STATUSES, allowedTargets, canApprove, type ReviewStatus } from "@/lib/review/rules";
import { ErrorSummary } from "./fields";
import { useHydrated } from "./useHydrated";

// 공통 검수 큐 조작 (W10-c — REV-01~03) · 수집 원천 이용 조건 폼 (PIPE). 판정의 기준은 서버(DB 함수)이고, 화면은 같은 규칙으로 미리 막을 뿐이다.
// [승인]은 필수 체크를 모두 확인해야 열린다. 반려는 사유 필수, 실패한 항목은 [다시 시도](최대 3회).

type Problem = { title: string; details: string[] } | null;

export interface ReviewControlItem {
  id: number;
  status: ReviewStatus;
  attempts: number;
  required_checks: string[];
  parts: string[];
  assignee: string | null;
}

export function ReviewItemControls({ item }: { item: ReviewControlItem }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [checked, setChecked] = useState<string[]>([]);
  const [partsPicked, setPartsPicked] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState(item.assignee ?? "");
  const [error, setError] = useState<Problem>(null);
  const targets = allowedTargets(item.status, item.attempts);
  const approvable = canApprove(item.required_checks, checked);

  async function send(to: string) {
    setError(null);
    const r = await adminApi("POST", "/api/admin/review-items", {
      op: "transition", id: item.id, to,
      ...(to === "rejected" ? { reason } : {}),
      ...(to === "approved" ? { checked, ...(partsPicked.length ? { parts: partsPicked } : {}) } : {}),
    });
    if (r.status === 200) router.refresh();
    else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  async function assign(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await adminApi("POST", "/api/admin/review-items", { op: "assign", id: item.id, assignee });
    if (r.status === 200) router.refresh();
    else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  const open = item.status !== "published" && item.status !== "rejected";
  return (
    <div className="mt-3 space-y-3" data-review-controls={item.id}>
      {item.status === "in_review" && (
        <fieldset className="space-y-1" data-testid="review-checklist">
          <legend className="text-[14px] font-bold text-navy-900">체크리스트 (모두 확인해야 승인할 수 있습니다)</legend>
          {item.required_checks.map((key) => (
            <CheckboxField
              key={key}
              id={`rv-${item.id}-${key}`}
              label={CHECK_LABELS[key] ?? key}
              checked={checked.includes(key)}
              onChange={(e) => setChecked((c) => (e.target.checked ? [...c, key] : c.filter((k) => k !== key)))}
            />
          ))}
          {item.parts.length > 0 && (
            <div className="pt-2" data-testid="review-parts">
              <p className="text-[14px] text-navy-700">부분 승인 (고르지 않으면 통째로 승인)</p>
              {item.parts.map((p) => (
                <CheckboxField key={p} id={`rv-${item.id}-part-${p}`} label={p} checked={partsPicked.includes(p)} onChange={(e) => setPartsPicked((c) => (e.target.checked ? [...c, p] : c.filter((k) => k !== p)))} />
              ))}
            </div>
          )}
        </fieldset>
      )}
      {targets.includes("rejected") && <TextField id={`rv-reason-${item.id}`} label="반려 사유 (반려할 때 필수)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
      {error && <ErrorSummary id={`rv-error-${item.id}`} title={error.title} messages={error.details} />}
      <div className="flex flex-wrap gap-2">
        {targets.includes("in_review") && <DarkButton type="button" disabled={!hydrated} onClick={() => send("in_review")}>검수 시작</DarkButton>}
        {targets.includes("approved") && <DarkButton type="button" disabled={!hydrated || !approvable} data-action="approve" onClick={() => send("approved")}>승인</DarkButton>}
        {targets.includes("published") && <DarkButton type="button" disabled={!hydrated} onClick={() => send("published")}>처리 완료</DarkButton>}
        {targets.includes("retry") && <DarkButton type="button" disabled={!hydrated} onClick={() => send("retry")}>다시 시도 ({item.attempts}/3)</DarkButton>}
        {targets.includes("rejected") && <DarkButton type="button" disabled={!hydrated || reason.trim() === ""} data-action="reject" onClick={() => send("rejected")}>반려</DarkButton>}
      </div>
      {open && (
        <form onSubmit={assign} aria-label={`검수 항목 ${item.id} 담당자 배정`} className="flex flex-wrap items-end gap-2">
          <TextField id={`rv-assignee-${item.id}`} label="담당자" value={assignee} maxLength={80} onChange={(e) => setAssignee(e.target.value)} />
          <DarkButton type="submit" disabled={!hydrated || assignee.trim() === ""}>배정</DarkButton>
        </form>
      )}
    </div>
  );
}

export function SourceTermsForm({ sourceKey, status }: { sourceKey: string; status: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [terms, setTerms] = useState(status);
  const [note, setNote] = useState("");
  const [error, setError] = useState<Problem>(null);

  async function save(body: Record<string, unknown>) {
    setError(null);
    const r = await adminApi("POST", "/api/admin/data-sources", { key: sourceKey, ...body });
    if (r.status === 200) router.refresh();
    else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <div className="mt-2 space-y-2" data-source-form={sourceKey}>
      <label className="block text-[14px] text-navy-800" htmlFor={`ds-terms-${sourceKey}`}>
        이용 조건
        <select id={`ds-terms-${sourceKey}`} className="ml-2 rounded-lg border border-navy-200 px-2 py-1" value={terms} onChange={(e) => setTerms(e.target.value)}>
          {TERMS_STATUSES.map((s) => (
            <option key={s} value={s}>{TERMS_LABELS[s]}</option>
          ))}
        </select>
      </label>
      <TextField id={`ds-note-${sourceKey}`} label="근거 (허용으로 바꿀 때 필수)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      {error && <ErrorSummary id={`ds-error-${sourceKey}`} title={error.title} messages={error.details} />}
      <div className="flex flex-wrap gap-2">
        <DarkButton type="button" disabled={!hydrated} onClick={() => save({ op: "terms", terms, note })}>이용 조건 기록</DarkButton>
        <DarkButton type="button" disabled={!hydrated} onClick={() => save({ op: "contract" })}>견본 계약 시험 통과 기록</DarkButton>
      </div>
    </div>
  );
}
