"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, RadioField } from "@ltr/ui";
import { adminApi, apiErrorMessage } from "@/lib/admin/api-client";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { REVIEW_DECISION_LABELS, REVIEW_KIND_LABELS, optionsOf } from "@/lib/admin/labels";
import { checksFor, reviewErrorsFromServer, reviewPayload, type ReviewForm, type ReviewKind } from "@/lib/admin/review-form";
import { ErrorSummary, FieldErrorText, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

/**
 * 검토 결정 — 편집 승인(편집 책임자, 작성자와 다른 사람) · 세무 감수(세무 감수위원). 승인은 확인 항목을 모두 체크해야 하고,
 * 반려·보류는 사유가 필요하다. 정량형 편집 승인의 '인과 단정 없음'이 checklist.noCausalClaim으로 남는다 (NAV-10).
 */
export function ReviewDecisionForm({
  articleId,
  kind,
  reportingMethod,
  version,
  regional = false,
}: {
  articleId: number;
  kind: ReviewKind;
  reportingMethod: string | null;
  version: number;
  /** 지역 기사 — 편집 승인에 근거·관계·광고 독립성 3항목이 더해진다 (REG1-17) */
  regional?: boolean;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [form, setForm] = useState<ReviewForm>({ kind, decision: "", reason: "", checks: {} });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState("");
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const p = `review-${kind}`;
  const items = checksFor(kind, reportingMethod, regional);
  const [details, setDetails] = useState<string[]>([]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone("");
    setFailure("");
    setDetails([]);
    const r0 = reviewPayload(form, reportingMethod, regional);
    if (!r0.ok) {
      setErrors(r0.errors);
      return;
    }
    setErrors({});
    setPending(true);
    const r = await adminApi("POST", `/api/admin/articles/${articleId}/reviews`, r0.body);
    setPending(false);
    if (r.status === 201) {
      setDone(`${REVIEW_KIND_LABELS[kind]} 결정 ‘${REVIEW_DECISION_LABELS[form.decision as keyof typeof REVIEW_DECISION_LABELS]}’을 남겼습니다 (버전 ${version})`);
      setForm({ kind, decision: "", reason: "", checks: {} });
      router.refresh();
      return;
    }
    const server = reviewErrorsFromServer(kind, Array.isArray(r.body.errors) ? (r.body.errors as string[]) : undefined);
    setErrors(server.fields);
    setDetails(server.rest);
    setFailure(apiErrorMessage(r));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label={`${REVIEW_KIND_LABELS[kind]} 결정`}>
      <p className="text-[14px] text-navy-600">이 결정은 지금 버전({version})에만 해당합니다. 원고를 고치면 다시 받습니다.</p>
      <fieldset aria-describedby={errors[`${p}-checks`] ? `${p}-checks-error` : undefined} className="min-w-0 space-y-1">
        <legend className="text-[15px] font-bold text-navy-900">확인 항목 (승인할 때 모두)</legend>
        {items.map((c) => (
          <CheckboxField
            key={c.id}
            id={`${p}-check-${c.id}`}
            label={c.label}
            checked={form.checks[c.id] === true}
            onChange={(e) => setForm((f) => ({ ...f, checks: { ...f.checks, [c.id]: e.target.checked } }))}
          />
        ))}
        <FieldErrorText id={`${p}-checks`} error={errors[`${p}-checks`]} />
      </fieldset>
      <RadioField
        id={`${p}-decision`}
        name={`${p}-decision`}
        legend="결정"
        required
        options={optionsOf(REVIEW_DECISION_LABELS)}
        value={form.decision}
        onChange={(v) => setForm((f) => ({ ...f, decision: v as ReviewForm["decision"] }))}
        error={errors[`${p}-decision`]}
      />
      <TextAreaField id={`${p}-reason`} label="사유 (반려·보류는 필수)" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} error={errors[`${p}-reason`]} />
      {failure && <ErrorSummary title={failure} messages={details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "남기는 중" : "결정 남기기"}
      </DarkButton>
    </form>
  );
}
