"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, RadioField, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { partnerChoices } from "@/lib/admin/partner-rules";
import { LABEL_LABELS, REPORTING_METHOD_LABELS, SECTION_LABELS, optionsOf } from "@/lib/admin/labels";
import { newArticlePayload, templateById, validateNewArticle, type ArticleTemplate, type NewArticleForm as Form } from "@/lib/admin/templates";
import { ErrorSummary, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

type Category = { id: number; section: string; name: string };
type Partner = { id: number; name: string; contract_to: string | null };

/** 새 기사 만들기 — 템플릿 · 제목 · 주소 · 분야 · (보도) 취재 방식 · (해설) 법령 기준일 · (광고·협찬) 표기 하나 */
export function NewArticleForm({
  templates,
  categories,
  partners,
  assignment,
  initial,
  today,
}: {
  templates: readonly ArticleTemplate[];
  categories: readonly Category[];
  partners: readonly Partner[];
  assignment: { id: number; hypothesis: string } | null;
  initial: Form;
  /** 한국 날짜 YYYY-MM-DD (서버가 정한다 — 제휴사 계약 종료 판정) */
  today: string;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [pending, setPending] = useState(false);
  const template = templateById(form.templateId);
  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function chooseTemplate(id: string) {
    const t = templateById(id as Form["templateId"]);
    setForm((f) => ({
      ...f,
      templateId: t.id,
      section: assignment ? f.section : (t.defaultSection ?? f.section),
      categoryId: "",
      reportingMethod: t.contentType === "reported_news" ? (f.reportingMethod || t.reportingMethod || "") : "",
      label: t.needsLabel ? "" : "none",
      partnerId: "",
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const v = validateNewArticle(form);
    setErrors(v);
    if (Object.keys(v).length > 0) {
      document.getElementById(Object.keys(v)[0]!)?.focus();
      return;
    }
    setPending(true);
    const r = await adminApi("POST", "/api/admin/articles", newArticlePayload(form));
    if (r.status === 201) {
      const id = (r.body.article as { id?: number } | undefined)?.id;
      router.push(`/admin/articles/${id}`);
      return;
    }
    setPending(false);
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  const sectionCategories = categories.filter((c) => c.section === form.section).map((c) => ({ value: String(c.id), label: c.name }));
  // 계약이 끝난 제휴사는 새 기사에 고를 수 없다 (ART-10) — 선택지에서 빼고 이름을 알린다
  const partnerPick = partnerChoices(partners, today, null);
  const usablePartners = partnerPick.options;
  const expiredNote =
    partnerPick.expired.length > 0 ? `계약이 끝나 고를 수 없는 제휴사: ${partnerPick.expired.map((p) => `${p.name}(${p.contractTo} 종료)`).join(", ")}` : undefined;

  return (
    <form onSubmit={submit} noValidate className="space-y-6 rounded-2xl border border-navy-100 bg-white p-6">
      {assignment && (
        <p className="rounded-xl border border-navy-100 bg-ivory px-4 py-3 text-[15px] text-navy-800 [overflow-wrap:anywhere]">
          기획 {assignment.id}에 이어 씁니다 — {assignment.hypothesis || "가설 없음"}
        </p>
      )}
      <RadioField
        id="new-template"
        name="template"
        legend="템플릿"
        value={form.templateId}
        onChange={chooseTemplate}
        options={templates.map((t) => ({
          value: t.id,
          label: (
            <span>
              <span className="font-bold">{t.label}</span>
              <span className="block text-[14px] text-navy-600">{t.summary}</span>
            </span>
          ),
        }))}
      />
      <TextField id="new-title" label="제목" required value={form.title} onChange={set("title")} error={errors["new-title"]} />
      <TextField
        id="new-slug"
        label="주소(slug)"
        required
        hint="공백과 '/' 없이 씁니다. 발행한 뒤에는 바꿀 수 없습니다."
        value={form.slug}
        onChange={set("slug")}
        error={errors["new-slug"]}
      />
      <TextAreaField id="new-summary" label="요약" hint="2줄 안팎" value={form.summary} onChange={set("summary")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="new-section"
          label="분야"
          required
          options={optionsOf(SECTION_LABELS)}
          placeholder="골라 주세요"
          value={form.section}
          onChange={(e) => setForm((f) => ({ ...f, section: e.target.value, categoryId: "" }))}
          error={errors["new-section"]}
        />
        <SelectField id="new-category" label="하위 분야" options={sectionCategories} placeholder="없음" value={form.categoryId} onChange={set("categoryId")} />
        {template.contentType === "reported_news" && (
          <SelectField
            id="new-reporting-method"
            label="취재 방식"
            required
            options={optionsOf(REPORTING_METHOD_LABELS)}
            placeholder="골라 주세요"
            value={form.reportingMethod}
            onChange={set("reportingMethod")}
            error={errors["new-reporting-method"]}
          />
        )}
        {(template.needsLegalBasisDate || template.subtype === "solved_case") && (
          <TextField
            id="new-legal-basis-date"
            label="법령 기준일"
            type="date"
            required={template.needsLegalBasisDate}
            value={form.legalBasisDate}
            onChange={set("legalBasisDate")}
            error={errors["new-legal-basis-date"]}
          />
        )}
      </div>
      {template.needsLabel && (
        <div className="grid gap-4 sm:grid-cols-2">
          <RadioField
            id="new-label"
            name="label"
            legend="표기 (하나만)"
            required
            value={form.label}
            onChange={(v) => setForm((f) => ({ ...f, label: v }))}
            options={optionsOf(LABEL_LABELS, ["co_planned", "ad"])}
            error={errors["new-label"]}
          />
          {form.label === "co_planned" && (
            <SelectField
              id="new-partner"
              label="제휴사"
              required
              hint={expiredNote}
              options={usablePartners}
              placeholder="골라 주세요"
              value={form.partnerId}
              onChange={set("partnerId")}
              error={errors["new-partner"]}
            />
          )}
        </div>
      )}
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      <PrimaryButton type="submit" disabled={pending || !hydrated}>
        {pending ? "만드는 중" : "초안 만들기"}
      </PrimaryButton>
    </form>
  );
}
