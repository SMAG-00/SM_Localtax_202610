"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { optionsOf } from "@/lib/admin/labels";
import { PARTNER_KIND_LABELS, partnerFormToBody, type PartnerForm as Form } from "@/lib/admin/partner-rules";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

export interface PartnerItem {
  id: number;
  name: string;
  kind: string;
  intro: string | null;
  url: string | null;
  contract_from: string | null;
  contract_to: string | null;
  visible: boolean;
}

const empty: Form = { name: "", kind: "", intro: "", url: "", contractFrom: "", contractTo: "", visible: false };

/** 제휴사 등록·고치기 (ART-10) — 광고·협찬 담당·관리자만 이 폼을 본다. 계약 종료일은 그날까지 유효 */
export function PartnerForm({ mode, partner }: { mode: "create" | "patch"; partner?: PartnerItem }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const base = mode === "create" ? "partner-new" : `partner-${partner!.id}`;
  const [form, setForm] = useState<Form>(
    partner
      ? {
          name: partner.name,
          kind: partner.kind,
          intro: partner.intro ?? "",
          url: partner.url ?? "",
          contractFrom: partner.contract_from ?? "",
          contractTo: partner.contract_to ?? "",
          visible: partner.visible,
        }
      : empty,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const set = (key: "name" | "kind" | "intro" | "url" | "contractFrom" | "contractTo") => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    setDone("");
    const v = partnerFormToBody(form, base);
    if (!v.ok) {
      setErrors(v.errors);
      document.getElementById(Object.keys(v.errors)[0]!)?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    const r = mode === "create" ? await adminApi("POST", "/api/admin/partners", v.body) : await adminApi("PATCH", `/api/admin/partners/${partner!.id}`, v.body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(mode === "create" ? `제휴사를 등록했습니다 — ${form.name.trim()}` : "저장했습니다");
      if (mode === "create") setForm(empty);
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3" aria-label={mode === "create" ? "제휴사 등록" : `${partner!.name} 고치기`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`${base}-name`} label="제휴사 이름" required value={form.name} onChange={set("name")} error={errors[`${base}-name`]} />
        <SelectField
          id={`${base}-kind`}
          label="종류"
          required
          options={optionsOf(PARTNER_KIND_LABELS)}
          placeholder="골라 주세요"
          value={form.kind}
          onChange={set("kind")}
          error={errors[`${base}-kind`]}
        />
        <TextField id={`${base}-contract-from`} label="계약 시작일" type="date" value={form.contractFrom} onChange={set("contractFrom")} error={errors[`${base}-contract-from`]} />
        <TextField
          id={`${base}-contract-to`}
          label="계약 종료일"
          type="date"
          hint="이날까지 새 기사에 지정할 수 있습니다. 지나면 기존 기사 배지는 남고 새 지정만 막힙니다"
          value={form.contractTo}
          onChange={set("contractTo")}
          error={errors[`${base}-contract-to`]}
        />
      </div>
      <TextField id={`${base}-url`} label="누리집 주소" hint="https://로 시작" value={form.url} onChange={set("url")} error={errors[`${base}-url`]} />
      <TextAreaField id={`${base}-intro`} label="소개" value={form.intro} onChange={set("intro")} />
      <CheckboxField
        id={`${base}-visible`}
        label="공개 — 제휴사 프로필(/partners)에 보입니다"
        checked={form.visible}
        onChange={(e) => setForm((f) => ({ ...f, visible: e.target.checked }))}
      />
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "저장하는 중" : mode === "create" ? "제휴사 등록" : "저장"}
      </DarkButton>
    </form>
  );
}
