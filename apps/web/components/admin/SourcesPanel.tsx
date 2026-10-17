"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { isoToKstDate, type FieldErrors } from "@/lib/admin/form-utils";
import { SOURCE_KIND_LABELS, labelOf, optionsOf } from "@/lib/admin/labels";
import { EMPTY_SOURCE_FORM, sourcePayload, validateSource, type SourceForm } from "@/lib/admin/records-form";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { EmptyNote, MONO, ToneChip } from "./ui";
import { useHydrated } from "./useHydrated";

export interface SourceRowView {
  id: number;
  kind: string;
  title: string | null;
  source_url: string | null;
  source_name: string | null;
  last_verified_at: string | null;
  license_status: string | null;
  snapshot_id: number | null;
}

const OFFICIAL = new Set(["official_doc", "dataset"]);

/** 공개 출처 (article_sources, NAV-03 · FND-04) — 공식 문서·공공 데이터는 URL·발표기관·확인일·이용 조건이 모두 있어야 한다 */
export function SourcesPanel({ articleId, sources, readOnly }: { articleId: number; sources: readonly SourceRowView[]; readOnly: boolean }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [form, setForm] = useState<SourceForm>(EMPTY_SOURCE_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const set = (key: keyof SourceForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone("");
    setFailure(null);
    const v = validateSource(form);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setPending(true);
    const r = await adminApi("POST", `/api/admin/articles/${articleId}/sources`, sourcePayload(form));
    setPending(false);
    if (r.status === 201) {
      const ref = (r.body.source as { ref?: string } | undefined)?.ref ?? "";
      setDone(`출처를 더했습니다 — ${ref}`);
      setForm(EMPTY_SOURCE_FORM);
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  const official = OFFICIAL.has(form.kind);
  return (
    <div className="space-y-4">
      {sources.length === 0 ? (
        <EmptyNote>출처가 없습니다. 보도기사는 출처가 있어야 발행됩니다.</EmptyNote>
      ) : (
        <ul data-testid="source-list" className="space-y-3">
          {sources.map((s) => {
            const complete = !OFFICIAL.has(s.kind) || Boolean(s.source_url && s.source_name && s.last_verified_at && s.license_status);
            return (
              <li key={s.id} className="rounded-xl border border-navy-100 p-4 text-[15px] text-navy-800">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={MONO}>src:{s.id}</span>
                  <ToneChip tone="plain">{labelOf(SOURCE_KIND_LABELS, s.kind)}</ToneChip>
                  {!complete && <ToneChip tone="amber">칸 빔</ToneChip>}
                  {s.snapshot_id !== null && <ToneChip tone="navy">원문 있음</ToneChip>}
                </div>
                <p className="mt-1 font-bold text-navy-900 [overflow-wrap:anywhere]">{s.title ?? "제목 없음"}</p>
                <p className="text-[14px] text-navy-600 [overflow-wrap:anywhere]">
                  {[s.source_name, s.last_verified_at ? `확인 ${isoToKstDate(s.last_verified_at)}` : null, s.license_status, s.source_url].filter(Boolean).join(" · ")}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-navy-100 p-4" aria-label="출처 더하기">
          <p className="text-[15px] font-black text-navy-900">출처 더하기</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField id="src-kind" label="출처 종류" required options={optionsOf(SOURCE_KIND_LABELS)} value={form.kind} onChange={set("kind")} error={errors["src-kind"]} />
            <TextField id="src-title" label="출처 이름" required value={form.title} onChange={set("title")} error={errors["src-title"]} />
            <TextField id="src-url" label="원문 URL" required={official} value={form.url} onChange={set("url")} error={errors["src-url"]} />
            <TextField id="src-source-name" label="발표기관" required={official} value={form.sourceName} onChange={set("sourceName")} error={errors["src-source-name"]} />
            <TextField id="src-verified" label="확인일" type="date" required={official} value={form.lastVerifiedDate} onChange={set("lastVerifiedDate")} error={errors["src-verified"]} />
            <TextField
              id="src-license"
              label="이용 조건"
              required={official}
              hint="예: 공공누리 제1유형"
              value={form.licenseStatus}
              onChange={set("licenseStatus")}
              error={errors["src-license"]}
            />
          </div>
          <TextAreaField
            id="src-snapshot"
            label="원문 글 (선택)"
            hint="보도자료 원문을 붙이면 유사도 비교에 씁니다"
            value={form.snapshotText}
            onChange={set("snapshotText")}
          />
          {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
          {done && <StatusNote>{done}</StatusNote>}
          <DarkButton type="submit" disabled={pending || !hydrated}>
            {pending ? "더하는 중" : "출처 더하기"}
          </DarkButton>
        </form>
      )}
    </div>
  );
}
