"use client";

import { SelectField, TextField } from "@ltr/ui";
import { withMethodChecklists } from "@/lib/admin/editor-state";
import { CONTENT_TYPE_LABELS, EDITORIAL_FIELD_LABELS, EVIDENCE_RIGHTS_LABELS, FORMAT_LABELS, LABEL_LABELS, REPORTING_METHOD_LABELS, SECTION_LABELS, labelOf, optionsOf } from "@/lib/admin/labels";
import { FieldGroup, TextAreaField } from "../fields";
import type { SectionProps } from "./types";

type Category = { id: number; section: string; name: string };
type Partner = { id: number; name: string; contract_to: string | null };
type Media = { id: number; path: string; alt: string | null; rights_status: string };

/** 기본 정보 — 제목·주소·요약·분야·하위 분야·기사 유형·취재 방식·형식·표기/제휴사·대표 이미지·법령 기준일·지역 태그 (ART-01 · ART-10) */
export function MetaFields({
  state,
  update,
  errors,
  readOnly,
  published,
  categories,
  partners,
  media,
  contentTypes,
}: SectionProps & { published: boolean; categories: readonly Category[]; partners: readonly Partner[]; media: readonly Media[]; contentTypes: readonly string[] }) {
  const typeOptions = optionsOf(CONTENT_TYPE_LABELS, [...new Set([...contentTypes, state.contentType])]);
  const categoryOptions = categories.filter((c) => c.section === state.section).map((c) => ({ value: String(c.id), label: c.name }));
  const partnerOptions = partners.map((p) => ({ value: String(p.id), label: p.contract_to ? `${p.name} (계약 ${p.contract_to}까지)` : p.name }));
  const mediaOptions = media.map((m) => ({ value: String(m.id), label: `${m.id} · ${m.alt || m.path} (${labelOf(EVIDENCE_RIGHTS_LABELS, m.rights_status)})` }));

  function changeType(contentType: string) {
    const reportingMethod = contentType === "reported_news" ? state.reportingMethod : "";
    update({ contentType, reportingMethod, label: contentType === "sponsored" ? state.label : "none", checklists: withMethodChecklists(state.checklists, contentType, reportingMethod) });
  }

  return (
    <div className="space-y-4">
      <TextField id="meta-title" label="제목" required disabled={readOnly} value={state.title} onChange={(e) => update({ title: e.target.value })} error={errors["meta-title"]} />
      <TextField
        id="meta-slug"
        label="주소(slug)"
        required
        disabled={readOnly || published}
        hint={published ? "발행된 기사의 주소는 바꿀 수 없습니다 (영속 주소)" : "공백과 '/' 없이 씁니다"}
        value={state.slug}
        onChange={(e) => update({ slug: e.target.value })}
        error={errors["meta-slug"]}
      />
      <TextAreaField id="meta-summary" label="요약" disabled={readOnly} value={state.summary} onChange={(e) => update({ summary: e.target.value })} error={errors["meta-summary"]} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="meta-section"
          label="분야"
          required
          disabled={readOnly}
          options={optionsOf(SECTION_LABELS)}
          value={state.section}
          onChange={(e) => update({ section: e.target.value, categoryId: "" })}
          error={errors["meta-section"]}
        />
        <SelectField
          id="meta-category"
          label="하위 분야"
          disabled={readOnly}
          options={categoryOptions}
          placeholder="없음"
          value={state.categoryId}
          onChange={(e) => update({ categoryId: e.target.value })}
          error={errors["meta-category"]}
        />
        <SelectField
          id="meta-content-type"
          label="기사 유형"
          required
          disabled={readOnly}
          options={typeOptions}
          value={state.contentType}
          onChange={(e) => changeType(e.target.value)}
          error={errors["meta-content-type"]}
        />
        {state.contentType === "reported_news" && (
          <SelectField
            id="meta-reporting-method"
            label="취재 방식"
            required
            disabled={readOnly}
            options={optionsOf(REPORTING_METHOD_LABELS)}
            placeholder="골라 주세요"
            value={state.reportingMethod}
            onChange={(e) => update({ reportingMethod: e.target.value, checklists: withMethodChecklists(state.checklists, state.contentType, e.target.value) })}
            error={errors["meta-reporting-method"]}
          />
        )}
        <SelectField id="meta-format" label="형식" disabled={readOnly} options={optionsOf(FORMAT_LABELS)} value={state.format} onChange={(e) => update({ format: e.target.value })} />
        <SelectField
          id="meta-label"
          label="표기 (하나만)"
          disabled={readOnly}
          hint="공동 기획·광고 표기는 광고·협찬 콘텐츠에만 씁니다"
          options={optionsOf(LABEL_LABELS, state.contentType === "sponsored" ? ["co_planned", "ad"] : ["none"])}
          placeholder={state.contentType === "sponsored" ? "골라 주세요" : undefined}
          value={state.contentType === "sponsored" && state.label === "none" ? "" : state.label}
          onChange={(e) => update({ label: e.target.value || "none" })}
          error={errors["meta-label"]}
        />
        {state.label === "co_planned" && (
          <SelectField
            id="meta-partner"
            label="제휴사"
            required
            disabled={readOnly}
            options={partnerOptions}
            placeholder="골라 주세요"
            value={state.partnerId}
            onChange={(e) => update({ partnerId: e.target.value })}
            error={errors["meta-partner"]}
          />
        )}
        <SelectField
          id="meta-lead-media"
          label="대표 이미지"
          disabled={readOnly}
          hint={mediaOptions.length === 0 ? "등록된 이미지가 없습니다" : "권리 확인된 이미지만 공개 화면에 나옵니다"}
          options={mediaOptions}
          placeholder="없음"
          value={state.leadMediaId}
          onChange={(e) => update({ leadMediaId: e.target.value })}
          error={errors["meta-lead-media"]}
        />
        <TextField
          id="meta-legal-basis-date"
          label="법령 기준일"
          type="date"
          disabled={readOnly}
          hint="지방세 분야·세무 감수 대상·「지방세로 읽기」가 있는 기사는 꼭 적습니다"
          value={state.legalBasisDate}
          onChange={(e) => update({ legalBasisDate: e.target.value })}
          error={errors["meta-legal-basis-date"]}
        />
      </div>
      <FieldGroup legend="지역" hint="지역 태그를 달면 편집 분야와 공익적 질문을 함께 적습니다">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="meta-region-codes"
            label="지역 코드"
            hint="쉼표로 나눕니다 (예: 11680, 11650)"
            disabled={readOnly}
            value={state.regionCodesText}
            onChange={(e) => update({ regionCodesText: e.target.value })}
            error={errors["meta-region-codes"]}
          />
          <SelectField
            id="meta-editorial-field"
            label="편집 분야"
            disabled={readOnly}
            options={optionsOf(EDITORIAL_FIELD_LABELS)}
            placeholder="없음"
            value={state.editorialField}
            onChange={(e) => update({ editorialField: e.target.value })}
            error={errors["meta-editorial-field"]}
          />
        </div>
        <TextAreaField id="meta-public-question" label="공익적 질문" disabled={readOnly} value={state.publicQuestion} onChange={(e) => update({ publicQuestion: e.target.value })} />
      </FieldGroup>
    </div>
  );
}
