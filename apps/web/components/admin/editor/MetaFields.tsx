"use client";

import { ARTICLE_HEAD_LIMITS, RELATION_TYPES, RELATION_TYPE_LABELS, SUBJECT_KIND_LABELS, headCharCount } from "@ltr/editorial";
import { SelectField, TextField } from "@ltr/ui";
import { withMethodChecklists } from "@/lib/admin/editor-state";
import { idOrNull } from "@/lib/admin/form-utils";
import { partnerChoices } from "@/lib/admin/partner-rules";
import { CONTENT_TYPE_LABELS, EDITORIAL_FIELD_LABELS, FORMAT_LABELS, LABEL_LABELS, REPORTING_METHOD_LABELS, SECTION_LABELS, optionsOf } from "@/lib/admin/labels";
import { mediaOptionLabel, type EditorMedia } from "@/lib/admin/media-blocks";
import { FieldErrorText, FieldGroup, TextAreaField } from "../fields";
import { TEXT_LINK } from "../ui";
import type { SectionProps } from "./types";

type Category = { id: number; section: string; name: string };
type Partner = { id: number; name: string; contract_to: string | null };
type Media = EditorMedia;

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
  today,
  canReadPartners,
}: SectionProps & {
  published: boolean;
  categories: readonly Category[];
  partners: readonly Partner[];
  media: readonly Media[];
  contentTypes: readonly string[];
  /** 한국 날짜 — 계약 종료 판정 */
  today: string;
  canReadPartners: boolean;
}) {
  const typeOptions = optionsOf(CONTENT_TYPE_LABELS, [...new Set([...contentTypes, state.contentType])]);
  const categoryOptions = categories.filter((c) => c.section === state.section).map((c) => ({ value: String(c.id), label: c.name }));
  // 계약이 끝난 제휴사는 새로 고를 수 없다 — 지금 지정된 제휴사는 남긴다(기존 배지 유지, ART-10). 저장 API도 같은 규칙으로 막는다
  const partnerPick = partnerChoices(partners, today, idOrNull(state.partnerId));
  const expiredNote =
    partnerPick.expired.length > 0 ? `계약이 끝나 고를 수 없는 제휴사: ${partnerPick.expired.map((p) => `${p.name}(${p.contractTo} 종료)`).join(", ")}` : undefined;
  const mediaOptions = media.map((m) => ({ value: String(m.id), label: mediaOptionLabel(m) }));

  function changeType(contentType: string) {
    const reportingMethod = contentType === "reported_news" ? state.reportingMethod : "";
    update({ contentType, reportingMethod, label: contentType === "sponsored" ? state.label : "none", checklists: withMethodChecklists(state.checklists, contentType, reportingMethod) });
  }

  return (
    <div className="space-y-4">
      <TextField id="meta-title" label="제목" required hint={`${ARTICLE_HEAD_LIMITS.titleMax}자 이하 — 지금 ${headCharCount(state.title)}자`} disabled={readOnly} value={state.title} onChange={(e) => update({ title: e.target.value })} error={errors["meta-title"]} />
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
      <TextAreaField id="meta-summary" label="요약" hint={`한 문장, ${ARTICLE_HEAD_LIMITS.summaryMax}자 이하 — 지금 ${headCharCount(state.summary)}자`} disabled={readOnly} value={state.summary} onChange={(e) => update({ summary: e.target.value })} error={errors["meta-summary"]} />
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
          <div className="space-y-1">
            <SelectField
              id="meta-partner"
              label="제휴사"
              required
              disabled={readOnly}
              hint={expiredNote}
              options={partnerPick.options}
              placeholder="골라 주세요"
              value={state.partnerId}
              onChange={(e) => update({ partnerId: e.target.value })}
              error={errors["meta-partner"]}
            />
            {canReadPartners && (
              <a href="/admin/partners" className={`${TEXT_LINK} text-[14px]`}>
                제휴사 목록 보기
              </a>
            )}
          </div>
        )}
        <SelectField
          id="meta-lead-media"
          label="대표 이미지"
          disabled={readOnly}
          hint={mediaOptions.length === 0 ? "등록된 이미지가 없습니다 — 사진 보관함(/admin/media)에서 올린 뒤 고릅니다" : "권리 확인된 이미지만 공개 화면에 나옵니다"}
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
      {state.contentType === "opinion" && (
        <FieldGroup legend="칼럼 연재" hint="연재 칼럼이면 연재 이름과 회차를 적습니다 — 칼럼 목록이 회차 순서로 보입니다. 단독 칼럼은 둘 다 비웁니다 (ART-04)">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="meta-series-title"
              label="연재 이름"
              disabled={readOnly}
              value={state.seriesTitle}
              onChange={(e) => update({ seriesTitle: e.target.value })}
              error={errors["meta-series-title"]}
            />
            <TextField
              id="meta-series-episode"
              label="회차"
              inputMode="numeric"
              hint="1부터 — 같은 연재에서 겹치지 않습니다"
              disabled={readOnly}
              value={state.seriesEpisodeText}
              onChange={(e) => update({ seriesEpisodeText: e.target.value })}
              error={errors["meta-series-episode"]}
            />
          </div>
        </FieldGroup>
      )}
      <FieldGroup legend="지역" hint="지역 태그를 달면 편집 분야와 공익적 질문을 함께 적습니다 — 지자체뉴스 기사는 지역 태그가 있어야 새로 발행됩니다 (REG1-17)">
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
        <TextAreaField
          id="meta-public-question"
          label="공익적 질문"
          disabled={readOnly}
          value={state.publicQuestion}
          onChange={(e) => update({ publicQuestion: e.target.value })}
          error={errors["meta-public-question"]}
        />
        {/* 지역 기사 편집 게이트 (REG1-17 — W4 7단계): 축제·명소·상권 소재는 관계 유형 1개 이상 + 취재 근거 1건 이상이어야 기사 후보 */}
        <SelectField
          id="meta-subject-kind"
          label="소재 종류"
          hint="축제·명소·상권은 예산·세수·공유재산·개발·거래·주거 영향 중 검증 가능한 관계와 근거가 있어야 기사 후보가 됩니다"
          disabled={readOnly}
          options={optionsOf(SUBJECT_KIND_LABELS)}
          value={state.subjectKind}
          onChange={(e) => update({ subjectKind: e.target.value })}
          error={errors["meta-subject-kind"]}
        />
        <fieldset className="text-[15px] text-navy-800" aria-describedby={errors["meta-relation-types"] ? "meta-relation-types-error" : undefined}>
          <legend className="font-bold">관계 유형 (복수 선택)</legend>
          <div id="meta-relation-types" tabIndex={-1} className="mt-1 flex flex-wrap gap-3">
            {RELATION_TYPES.map((t) => (
              <label key={t} className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  data-relation={t}
                  disabled={readOnly}
                  checked={state.relationTypes.includes(t)}
                  onChange={() => update({ relationTypes: state.relationTypes.includes(t) ? state.relationTypes.filter((x) => x !== t) : [...state.relationTypes, t] })}
                />
                {RELATION_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
          <FieldErrorText id="meta-relation-types" error={errors["meta-relation-types"]} />
        </fieldset>
        {canReadPartners && partners.length > 0 && (
          <fieldset className="text-[15px] text-navy-800">
            <legend className="font-bold">다룬 제휴사 (광고·협찬 계약 기록이 있으면 이해관계 표시 필수)</legend>
            <div id="meta-covered-partners" tabIndex={-1} className="mt-1 flex flex-wrap gap-3">
              {partners.map((p) => (
                <label key={p.id} className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    data-covered-partner={p.id}
                    disabled={readOnly}
                    checked={state.coveredPartnerIds.includes(String(p.id))}
                    onChange={() =>
                      update({
                        coveredPartnerIds: state.coveredPartnerIds.includes(String(p.id)) ? state.coveredPartnerIds.filter((x) => x !== String(p.id)) : [...state.coveredPartnerIds, String(p.id)],
                      })
                    }
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <FieldErrorText id="meta-covered-partners" error={errors["meta-covered-partners"]} />
          </fieldset>
        )}
        {/* 법안 상태를 다룬 기사 (PR-13): 표시를 켜면 출처 주소·확인일이 있는 공식 자료 출처가 있어야 발행된다 */}
        <label className="flex items-start gap-2 text-[15px] text-navy-800">
          <input id="meta-covers-bill-status" type="checkbox" className="mt-1" disabled={readOnly} checked={state.coversBillStatus} onChange={(e) => update({ coversBillStatus: e.target.checked })} />
          <span>
            <span className="font-bold">법안 상태를 다룸</span>
            <span className="block text-[13px] text-navy-600">아직 확정되지 않은 법안의 진행 상태를 다루는 기사면 켭니다 — 출처 주소와 확인일이 있는 공식 자료 출처가 1건 이상 있어야 발행됩니다 (PR-13)</span>
          </span>
        </label>
        <FieldErrorText id="meta-covers-bill-status" error={errors["meta-covers-bill-status"]} />
        <TextAreaField
          id="meta-interest-disclosure"
          label="이해관계 표시"
          hint="다룬 지역 사업자와 이 매체의 광고·협찬 관계를 독자에게 밝히는 문장 (NAV-06)"
          disabled={readOnly}
          value={state.interestDisclosure}
          onChange={(e) => update({ interestDisclosure: e.target.value })}
          error={errors["meta-interest-disclosure"]}
        />
      </FieldGroup>
    </div>
  );
}
