"use client";

import { RadioField, SelectField, TextField } from "@ltr/ui";
import { TAX_LENS_LINK_KINDS, isTaxLensTarget, type ContentType, type Section, type TaxLensLinkKind } from "@ltr/editorial";
import type { StoredTaxLens } from "@/lib/server/articles/content";
import type { TaxLensMode } from "@/lib/admin/editor-state";
import { TAX_LENS_LINK_LABELS } from "@/lib/admin/labels";
import { FieldErrorText, TextAreaField } from "../fields";
import { OUTLINE_BUTTON, ToneChip } from "../ui";
import type { SectionProps } from "./types";

/**
 * 「지방세로 읽기」 (01B CORE-01) — 박스(관련 세목·핵심 포인트 1~3줄·링크) 또는 생략 사유.
 * 생략 사유 승인은 편집 책임자만 한다. 박스 문장은 세무 감수 서명이 필요하고, 고치면 다시 감수받는다.
 */
export function TaxLensEditor({ state, update, errors, readOnly, canSkip, stored }: SectionProps & { canSkip: boolean; stored: StoredTaxLens | null }) {
  const target = isTaxLensTarget((state.section || null) as Section | null, (state.contentType || null) as ContentType | null);
  const reviewNote = stored && stored.skip_reason === null && (stored.topics.length > 0 || stored.points.length > 0 || stored.links.length > 0) ? stored : null;
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-navy-700">
        {target ? "이 기사는 「지방세로 읽기」 대상입니다. 박스나 생략 사유가 있어야 발행됩니다." : "이 기사는 「지방세로 읽기」 필수 대상이 아닙니다."}
      </p>
      {reviewNote && (
        <p>
          <ToneChip tone={reviewNote.reviewed ? "emerald" : "amber"}>
            {reviewNote.reviewed ? `세무 감수됨 (버전 ${reviewNote.reviewed_for_version})` : "세무 감수 필요"}
          </ToneChip>
        </p>
      )}
      <RadioField
        id="taxlens-mode"
        name="taxlens-mode"
        legend="쓰는 방법"
        disabled={readOnly}
        value={state.taxLensMode}
        onChange={(v) => update({ taxLensMode: v as TaxLensMode })}
        options={[
          { value: "none", label: "아직 쓰지 않음" },
          { value: "box", label: "박스 쓰기" },
          { value: "skip", label: canSkip ? "생략 사유 쓰기" : "생략 사유 쓰기 (편집 책임자만)" },
        ]}
      />
      <FieldErrorText id="taxlens" error={errors.taxlens} />
      {state.taxLensMode === "box" && (
        <div className="space-y-4">
          <TextField
            id="taxlens-topics"
            label="관련 세목"
            hint="쉼표로 나눕니다 (예: 취득세, 재산세)"
            disabled={readOnly}
            value={state.taxTopicsText}
            onChange={(e) => update({ taxTopicsText: e.target.value })}
            error={errors["taxlens-topics"]}
          />
          <TextAreaField
            id="taxlens-points"
            label="핵심 포인트"
            hint="1~3줄, 줄마다 하나. 세액(숫자 + 원)은 쓰지 않습니다"
            disabled={readOnly}
            value={state.taxPointsText}
            onChange={(e) => update({ taxPointsText: e.target.value })}
            error={errors["taxlens-points"]}
          />
          <div className="space-y-3">
            <p className="text-[15px] font-bold text-navy-900">링크 (해설·계산기·도서·전문가)</p>
            {state.taxLinks.map((l, i) => (
              <div key={i} className="grid gap-3 rounded-xl border border-navy-100 p-3 sm:grid-cols-3">
                <SelectField
                  id={`taxlens-link-${i}-kind`}
                  label={`링크 ${i + 1} 종류`}
                  disabled={readOnly}
                  options={TAX_LENS_LINK_KINDS.map((k) => ({ value: k, label: TAX_LENS_LINK_LABELS[k] }))}
                  value={l.kind}
                  onChange={(e) => update({ taxLinks: state.taxLinks.map((x, j) => (j === i ? { ...x, kind: e.target.value as TaxLensLinkKind } : x)) })}
                />
                <TextField
                  id={`taxlens-link-${i}-label`}
                  label="글자"
                  disabled={readOnly}
                  value={l.label}
                  onChange={(e) => update({ taxLinks: state.taxLinks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                />
                <TextField
                  id={`taxlens-link-${i}-url`}
                  label="주소"
                  disabled={readOnly}
                  value={l.url}
                  onChange={(e) => update({ taxLinks: state.taxLinks.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
                />
                {!readOnly && (
                  <button type="button" className={OUTLINE_BUTTON} onClick={() => update({ taxLinks: state.taxLinks.filter((_, j) => j !== i) })} aria-label={`링크 ${i + 1} 지우기`}>
                    링크 지우기
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button type="button" className={OUTLINE_BUTTON} onClick={() => update({ taxLinks: [...state.taxLinks, { kind: "explainer", label: "", url: "" }] })}>
                링크 더하기
              </button>
            )}
          </div>
        </div>
      )}
      {state.taxLensMode === "skip" && (
        <TextAreaField
          id="taxlens-omission"
          label="생략 사유"
          required
          hint="생략 사유·편집자·시각이 감사 기록에 남습니다"
          disabled={readOnly}
          value={state.omissionReason}
          onChange={(e) => update({ omissionReason: e.target.value })}
          error={errors["taxlens-omission"]}
        />
      )}
    </div>
  );
}
