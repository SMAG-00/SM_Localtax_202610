"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, SelectField, TextField } from "@ltr/ui";
import type { StoredBody } from "@/lib/server/articles/content";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { correctionPayload, correctionRequestPayload, editableParagraphs, type CorrectionForm } from "@/lib/admin/correction-form";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { CORRECTION_KIND_LABELS, optionsOf } from "@/lib/admin/labels";
import { ErrorSummary, FieldErrorText, FieldGroup, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

/** 정정·반론 요청 (기자) — 문의함 '정정·반론'에 쌓이고, 결정은 편집 책임자가 한다 */
export function CorrectionRequestForm({ articleId }: { articleId: number }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone("");
    const p = correctionRequestPayload(reason);
    if (!p.ok) return setError(p.error);
    setError("");
    setPending(true);
    const r = await adminApi("POST", `/api/admin/articles/${articleId}/correction-requests`, p.body);
    setPending(false);
    if (r.status === 201) {
      setDone("정정 요청을 남겼습니다 — 편집 책임자가 결정합니다");
      setReason("");
      router.refresh();
      return;
    }
    setError(apiErrorMessage(r));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="정정 요청">
      <TextAreaField id="cor-req-reason" label="무엇을 왜 고쳐야 하나요" required value={reason} onChange={(e) => setReason(e.target.value)} error={error || undefined} />
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "보내는 중" : "정정 요청 보내기"}
      </DarkButton>
    </form>
  );
}

export interface PendingRequest {
  id: number;
  body: string;
}

/**
 * 정정·반론·추후보도·삭제·제목 변경 결정 (편집 책임자, NAV-06) — 이유가 없으면 저장하지 않는다.
 * 정정은 고친 내용(제목·요약·문단)이 필요하고, 저장하면 전후 버전이 정정 이력에 남는다.
 */
export function CorrectionDecisionForm({
  articleId,
  original,
  requests,
}: {
  articleId: number;
  original: { title: string; summary: string | null; body: StoredBody };
  requests: readonly PendingRequest[];
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const paragraphs = editableParagraphs(original.body);
  const initial: CorrectionForm = {
    kind: "correction",
    reason: "",
    readerNotice: "",
    title: original.title,
    summary: original.summary ?? "",
    paragraphs: Object.fromEntries(paragraphs.map((p) => [p.index, p.text])),
    inquiryId: "",
  };
  const [form, setForm] = useState<CorrectionForm>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const set = (key: keyof CorrectionForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone("");
    setFailure(null);
    const p = correctionPayload(form, original);
    if (!p.ok) {
      setErrors(p.errors);
      document.getElementById(Object.keys(p.errors)[0]!)?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    const r = await adminApi("POST", `/api/admin/articles/${articleId}/corrections`, p.body);
    setPending(false);
    if (r.status === 201) {
      const c = r.body.correction as { kind?: string } | undefined;
      setDone(`${CORRECTION_KIND_LABELS[(c?.kind ?? form.kind) as keyof typeof CORRECTION_KIND_LABELS] ?? "정정"}을 기록했습니다 — 전후 버전은 정정 이력에서 봅니다`);
      setForm((f) => ({ ...f, reason: "", readerNotice: "", inquiryId: "" }));
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  const editsContent = form.kind !== "deletion";
  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="정정 결정">
      <SelectField id="cor-kind" label="결정 종류" required options={optionsOf(CORRECTION_KIND_LABELS)} value={form.kind} onChange={set("kind")} error={errors["cor-kind"]} />
      <TextAreaField id="cor-reason" label="이유" required hint="무엇을 왜 고치는지 적습니다 — 독자 표시와 감사 기록에 남습니다" value={form.reason} onChange={set("reason")} error={errors["cor-reason"]} />
      <TextField id="cor-notice" label="독자 표시 문구 (선택)" hint="비우면 이유를 그대로 씁니다" value={form.readerNotice} onChange={set("readerNotice")} />
      {requests.length > 0 && (
        <SelectField
          id="cor-inquiry"
          label="처리할 정정 요청"
          options={requests.map((q) => ({ value: String(q.id), label: `요청 ${q.id} · ${q.body.slice(0, 40)}` }))}
          placeholder="없음"
          value={form.inquiryId}
          onChange={set("inquiryId")}
        />
      )}
      {editsContent && (
        <FieldGroup legend="고친 내용" hint="정정은 고친 내용이 있어야 합니다. 반론·추후보도는 비워도 됩니다.">
          <FieldErrorText id="cor-changes" error={errors["cor-changes"]} />
          <TextField id="cor-title" label="제목" value={form.title} onChange={set("title")} error={errors["cor-title"]} />
          {form.kind !== "title_change" && (
            <>
              <TextAreaField id="cor-summary" label="요약" value={form.summary} onChange={set("summary")} />
              {paragraphs.map((p) => (
                <TextAreaField
                  key={p.index}
                  id={`cor-p-${p.index}`}
                  label={`본문 ${p.index + 1}번째 블록 (문단)`}
                  rows={4}
                  value={form.paragraphs[p.index] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, paragraphs: { ...f.paragraphs, [p.index]: e.target.value } }))}
                />
              ))}
            </>
          )}
        </FieldGroup>
      )}
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "기록하는 중" : "결정 기록"}
      </DarkButton>
    </form>
  );
}
