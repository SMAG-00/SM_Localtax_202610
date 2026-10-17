"use client";

import { CheckboxField, SelectField } from "@ltr/ui";
import { nextClaimId, type ClaimDraft } from "@/lib/admin/editor-state";
import { BLOCK_TYPE_LABELS, CLAIM_KIND_LABELS, optionsOf } from "@/lib/admin/labels";
import { FieldErrorText, TextAreaField } from "../fields";
import { EmptyNote, OUTLINE_BUTTON } from "../ui";
import type { RefOption, SectionProps } from "./types";

/** '핵심 주장' 문장 표시와 근거 잇기 (ART-01 · OPT-03) — 근거 없는 핵심 주장은 발행 차단. 세금 계산·법률 주장은 세무 감수 대상 (NAV-12) */
export function ClaimsEditor({ state, update, errors, readOnly, refs, makeKey }: SectionProps & { refs: readonly RefOption[]; makeKey: () => string }) {
  const claims = state.claims;
  const set = (next: ClaimDraft[]) => update({ claims: next });
  const patch = (key: string, p: Partial<ClaimDraft>) => set(claims.map((c) => (c.key === key ? { ...c, ...p } : c)));
  const blockOptions = state.blocks.map((b, i) => ({ value: b.key, label: `블록 ${i + 1} · ${BLOCK_TYPE_LABELS[b.type]}` }));

  return (
    <div className="space-y-4">
      <FieldErrorText id="claims" error={errors.claims} />
      {claims.length === 0 && <EmptyNote>표시한 핵심 주장이 없습니다. 기사의 결론 문장을 표시하고 근거를 잇습니다.</EmptyNote>}
      <ol className="space-y-4">
        {claims.map((c, i) => (
          <li key={c.key}>
            <fieldset className="min-w-0 space-y-3 rounded-xl border border-navy-100 bg-ivory p-4">
              <legend className="px-1 text-[15px] font-black text-navy-900">핵심 주장 {i + 1}</legend>
              <TextAreaField id={`claim-${c.key}-text`} label="주장 문장" disabled={readOnly} value={c.text} onChange={(e) => patch(c.key, { text: e.target.value })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  id={`claim-${c.key}-kind`}
                  label="주장 종류"
                  disabled={readOnly}
                  hint="세금 계산·법률 주장은 세무 감수 서명이 필요합니다"
                  options={optionsOf(CLAIM_KIND_LABELS)}
                  value={c.kind}
                  onChange={(e) => patch(c.key, { kind: e.target.value as ClaimDraft["kind"] })}
                />
                <SelectField
                  id={`claim-${c.key}-block`}
                  label="문장이 있는 블록"
                  disabled={readOnly}
                  options={blockOptions}
                  placeholder="없음"
                  value={c.blockKey}
                  onChange={(e) => patch(c.key, { blockKey: e.target.value })}
                />
              </div>
              <fieldset className="min-w-0 space-y-1">
                <legend className="text-[15px] font-bold text-navy-900">근거</legend>
                {refs.length === 0 && <p className="text-[14px] text-navy-600">먼저 출처·취재 근거를 더해 주세요.</p>}
                {refs.map((r) => (
                  <CheckboxField
                    key={r.value}
                    id={`claim-${c.key}-ev-${r.value.replace(":", "-")}`}
                    label={r.label}
                    disabled={readOnly}
                    checked={c.evidenceIds.includes(r.value)}
                    onChange={(e) => patch(c.key, { evidenceIds: e.target.checked ? [...c.evidenceIds, r.value] : c.evidenceIds.filter((x) => x !== r.value) })}
                  />
                ))}
              </fieldset>
              {!readOnly && (
                <button type="button" className={OUTLINE_BUTTON} onClick={() => set(claims.filter((x) => x.key !== c.key))} aria-label={`핵심 주장 ${i + 1} 지우기`}>
                  지우기
                </button>
              )}
            </fieldset>
          </li>
        ))}
      </ol>
      {!readOnly && (
        <button type="button" className={OUTLINE_BUTTON} onClick={() => set([...claims, { key: makeKey(), id: nextClaimId(claims), text: "", kind: "fact", evidenceIds: [], blockKey: "" }])}>
          핵심 주장 더하기
        </button>
      )}
    </div>
  );
}
