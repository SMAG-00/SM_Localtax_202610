"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, RadioField, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { isoToKstDate, type FieldErrors } from "@/lib/admin/form-utils";
import { ANONYMITY_LABELS, EVIDENCE_RIGHTS_LABELS, EVIDENCE_TYPE_LABELS, QUOTE_CONSENT_LABELS, VERIFICATION_LABELS, labelOf, optionsOf } from "@/lib/admin/labels";
import { DATASET_FIELDS, EMPTY_EVIDENCE_FORM, evidenceFormFrom, evidencePayload, validateEvidence, type EvidenceForm, type EvidenceRowView } from "@/lib/admin/records-form";
import { ErrorSummary, FieldGroup, StatusNote, TextAreaField } from "./fields";
import { EmptyNote, MONO, OUTLINE_BUTTON, ToneChip } from "./ui";
import { useHydrated } from "./useHydrated";

/**
 * 비공개 취재 근거 (article_evidence, NAV-12) — 정량형 재현 정보(article_datasets)·인터뷰 기록(article_interviews).
 * 독자 화면·공개 API·검색 색인에 나오지 않는다. 연락처·녹취 원문은 적지 않고 보존 위치만 적는다.
 */
export function EvidencePanel({ articleId, evidence, readOnly }: { articleId: number; evidence: readonly EvidenceRowView[]; readOnly: boolean }) {
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-[14px] text-navy-600">비공개 기록입니다 — 독자 화면과 공개 API에 나오지 않습니다.</p>
      {evidence.length === 0 ? (
        <EmptyNote>취재 근거가 없습니다. 보도기사는 자체 취재 근거가 1건 이상 있어야 발행됩니다.</EmptyNote>
      ) : (
        <ul data-testid="evidence-list" className="space-y-3">
          {evidence.map((e) => (
            <li key={e.id} className="rounded-xl border border-navy-100 p-4 text-[15px] text-navy-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className={MONO}>ev:{e.id}</span>
                <ToneChip tone="plain">{labelOf(EVIDENCE_TYPE_LABELS, e.evidence_type)}</ToneChip>
                <ToneChip tone={e.verification_status === "verified" ? "emerald" : "amber"}>{labelOf(VERIFICATION_LABELS, e.verification_status)}</ToneChip>
                <ToneChip tone={e.rights_status === "confirmed" ? "emerald" : "amber"}>{labelOf(EVIDENCE_RIGHTS_LABELS, e.rights_status)}</ToneChip>
              </div>
              <p className="mt-1 [overflow-wrap:anywhere]">보존 위치: {e.location}</p>
              {e.dataset && (
                <p className="text-[14px] text-navy-600">
                  재현 정보 {DATASET_FIELDS.filter((f) => (e.dataset as Record<string, string | null>)[apiColumn(f.api)]?.trim()).length}/{DATASET_FIELDS.length}칸
                </p>
              )}
              {e.interview && (
                <p className="text-[14px] text-navy-600 [overflow-wrap:anywhere]">
                  인터뷰 — {e.interview.subject_role} · {labelOf(QUOTE_CONSENT_LABELS, e.interview.quote_consent)} · {labelOf(ANONYMITY_LABELS, e.interview.anonymity)}
                  {e.interview.contacted_at ? ` · 접촉 ${isoToKstDate(e.interview.contacted_at)}` : ""}
                </p>
              )}
              {!readOnly && (
                <button type="button" className={`${OUTLINE_BUTTON} mt-2`} aria-expanded={editing === e.id} onClick={() => setEditing(editing === e.id ? null : e.id)}>
                  {editing === e.id ? "고치기 닫기" : `ev:${e.id} 고치기`}
                </button>
              )}
              {editing === e.id && <EvidenceForm articleId={articleId} mode="patch" evidenceId={e.id} initial={evidenceFormFrom(e)} onDone={() => setEditing(null)} />}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="rounded-xl border border-navy-100 p-4">
          <p className="text-[15px] font-black text-navy-900">근거 더하기</p>
          <EvidenceForm articleId={articleId} mode="create" initial={EMPTY_EVIDENCE_FORM} />
        </div>
      )}
    </div>
  );
}

/** API 칸 이름(camelCase) → DB 칸 이름(snake_case) */
function apiColumn(api: string): string {
  return api.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function EvidenceForm({ articleId, mode, evidenceId, initial, onDone }: { articleId: number; mode: "create" | "patch"; evidenceId?: number; initial: EvidenceForm; onDone?: () => void }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [form, setForm] = useState<EvidenceForm>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const prefix = mode === "create" ? "ev" : `ev-${evidenceId}`;
  const id = (name: string) => `${prefix}-${name}`;
  const err = (name: string) => errors[`ev-${name}`];
  const set = (key: keyof EvidenceForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setDs = (key: keyof EvidenceForm["dataset"]) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, dataset: { ...f.dataset, [key]: e.target.value } }));
  const setIv = (key: keyof EvidenceForm["interview"], value: string) => setForm((f) => ({ ...f, interview: { ...f.interview, [key]: value } }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone("");
    setFailure(null);
    const v = validateEvidence(form);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setPending(true);
    const path = mode === "create" ? `/api/admin/articles/${articleId}/evidence` : `/api/admin/articles/${articleId}/evidence/${evidenceId}`;
    const r = await adminApi(mode === "create" ? "POST" : "PATCH", path, evidencePayload(form, mode));
    setPending(false);
    if (r.status === 201 || r.status === 200) {
      const ref = (r.body.evidence as { ref?: string } | undefined)?.ref ?? "";
      setDone(mode === "create" ? `근거를 더했습니다 — ${ref}` : `근거를 고쳤습니다 — ${ref}`);
      if (mode === "create") setForm(EMPTY_EVIDENCE_FORM);
      router.refresh();
      onDone?.();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  const isDataset = form.evidenceType === "dataset" || form.evidenceType === "calculation";
  const groups = [...new Set(DATASET_FIELDS.map((f) => f.group))];
  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-4" aria-label={mode === "create" ? "근거 더하기" : `ev:${evidenceId} 고치기`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id={id("type")} label="근거 유형" required options={optionsOf(EVIDENCE_TYPE_LABELS)} placeholder="골라 주세요" value={form.evidenceType} onChange={set("evidenceType")} error={err("type")} />
        <TextField id={id("location")} label="원본 보존 위치" required hint="파일 경로·기록함 번호" value={form.location} onChange={set("location")} error={err("location")} />
        <SelectField id={id("rights")} label="권리 상태" options={optionsOf(EVIDENCE_RIGHTS_LABELS)} value={form.rightsStatus} onChange={set("rightsStatus")} />
        <SelectField id={id("verification")} label="확인 상태" options={optionsOf(VERIFICATION_LABELS)} value={form.verificationStatus} onChange={set("verificationStatus")} />
        <TextField id={id("verified-date")} label="확인일" type="date" value={form.verifiedDate} onChange={set("verifiedDate")} error={err("verified-date")} />
        <TextField id={id("retention")} label="보존 기한" type="date" value={form.retentionUntil} onChange={set("retentionUntil")} error={err("retention")} />
      </div>
      {isDataset &&
        groups.map((g) => (
          <FieldGroup key={g} legend={`재현 정보 — ${g}`}>
            <div className="grid gap-4 sm:grid-cols-2">
              {DATASET_FIELDS.filter((f) => f.group === g).map((f) => (
                <TextField
                  key={f.key}
                  id={id(`ds-${f.key}`)}
                  label={f.label}
                  type={f.date ? "date" : "text"}
                  value={form.dataset[f.key]}
                  onChange={setDs(f.key)}
                  error={err(`ds-${f.key}`)}
                />
              ))}
            </div>
          </FieldGroup>
        ))}
      {form.evidenceType === "interview" && (
        <FieldGroup legend="인터뷰 기록" hint="이름·연락처·녹취 원문은 적지 않습니다 (보존 위치만)">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id={id("iv-role")} label="취재원 역할" required value={form.interview.subjectRole} onChange={(e) => setIv("subjectRole", e.target.value)} error={err("iv-role")} />
            <TextField id={id("iv-contacted")} label="접촉일" type="date" value={form.interview.contactedDate} onChange={(e) => setIv("contactedDate", e.target.value)} error={err("iv-contacted")} />
            <TextField id={id("iv-record")} label="녹취·메모 보존 위치" value={form.interview.recordLocation} onChange={(e) => setIv("recordLocation", e.target.value)} />
            <SelectField
              id={id("iv-consent")}
              label="인용 동의"
              required
              options={optionsOf(QUOTE_CONSENT_LABELS)}
              placeholder="골라 주세요"
              value={form.interview.quoteConsent}
              onChange={(e) => setIv("quoteConsent", e.target.value)}
              error={err("iv-consent")}
            />
          </div>
          <RadioField
            id={id("iv-anonymity")}
            name={id("iv-anonymity")}
            legend="실명·익명"
            required
            options={optionsOf(ANONYMITY_LABELS)}
            value={form.interview.anonymity}
            onChange={(v) => setIv("anonymity", v)}
            error={err("iv-anonymity")}
          />
          {form.interview.anonymity === "anonymous" && (
            <TextAreaField
              id={id("iv-anonymity-reason")}
              label="익명 사유"
              required
              value={form.interview.anonymityReason}
              onChange={(e) => setIv("anonymityReason", e.target.value)}
              error={err("iv-anonymity-reason")}
            />
          )}
        </FieldGroup>
      )}
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "저장 중" : mode === "create" ? "근거 더하기" : "근거 고치기 저장"}
      </DarkButton>
    </form>
  );
}
