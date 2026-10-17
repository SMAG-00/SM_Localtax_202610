"use client";

import { CheckboxField, SelectField, TextField } from "@ltr/ui";
import { PERSPECTIVE_KEYS, PERSPECTIVE_LABELS, type PerspectiveKey } from "@ltr/editorial";
import type { Checklists } from "@/lib/server/articles/content";
import { PERSPECTIVE_STATUS_LABELS, optionsOf } from "@/lib/admin/labels";
import { FieldGroup, TextAreaField } from "../fields";
import { OUTLINE_BUTTON } from "../ui";
import type { RefOption, SectionProps } from "./types";

/**
 * 비공개 취재 확인 목록 (check_log.checklists — 공개 칸에 두지 않는다)
 *  · 정량형: 원자료 대조 기록 · 수치의 한계 · 관련 기관·전문가 확인 (NAV-10)
 *  · 정성형: 취재 질문 · 현장 확인 · 반대/보완 관점 · 이해관계 (NAV-11)
 *  · 쟁점 표시: 세금 계산·법률 주장 · 세금 쟁점 · 지역 정책 쟁점(관점별 기록·원문 대조) · 상속·증여 사례(동의·비식별)
 * '인과 단정 없음'은 편집 책임자가 편집 승인 때 확인한다.
 */
export function ChecklistsEditor({ state, update, readOnly, refs }: Omit<SectionProps, "errors"> & { refs: readonly RefOption[] }) {
  const c = state.checklists;
  const set = (patch: Partial<Checklists>) => update({ checklists: { ...c, ...patch } });
  const evidenceRefs = refs.filter((r) => r.kind === "evidence").map((r) => ({ value: r.value, label: r.label }));
  const sourceRefs = refs.filter((r) => r.kind === "source").map((r) => ({ value: r.value, label: r.label }));
  const text = (v: string | null) => v ?? "";

  function setPerspective(key: PerspectiveKey, patch: { status?: string; evidenceId?: string; contactedAt?: string }) {
    const current = c.perspectives[key];
    const status = patch.status ?? current?.status ?? "";
    if (status === "") return set({ perspectives: { ...c.perspectives, [key]: null } });
    set({
      perspectives: {
        ...c.perspectives,
        [key]: {
          status: status as "interviewed" | "no_response",
          evidenceId: (patch.evidenceId ?? current?.evidenceId ?? "") || null,
          contactedAt: (patch.contactedAt ?? current?.contactedAt ?? "") || null,
        },
      },
    });
  }

  return (
    <div className="space-y-4">
      <FieldGroup legend="이 원고의 쟁점" hint="표시하면 그 쟁점의 기록·감수가 발행 조건이 됩니다">
        <CheckboxField id="chk-tax-legal" label="세금 계산·법률 주장이 있습니다 (세무 감수 대상)" disabled={readOnly} checked={c.hasTaxOrLegalClaims} onChange={(e) => set({ hasTaxOrLegalClaims: e.target.checked })} />
        <CheckboxField id="chk-tax-issue" label="세금 쟁점 원고입니다 (법령 기준일·세무 감수 필요)" disabled={readOnly} checked={c.isTaxIssue} onChange={(e) => set({ isTaxIssue: e.target.checked })} />
        <CheckboxField id="chk-local-policy" label="지역 정책 쟁점 원고입니다 (관점별 기록·원문 대조 필요)" disabled={readOnly} checked={c.isLocalPolicyIssue} onChange={(e) => set({ isLocalPolicyIssue: e.target.checked })} />
        <CheckboxField id="chk-inheritance" label="상속·증여 사례입니다 (동의·비식별 검토 필요)" disabled={readOnly} checked={c.isInheritanceGiftCase} onChange={(e) => set({ isInheritanceGiftCase: e.target.checked })} />
      </FieldGroup>

      {c.quantitative && (
        <FieldGroup legend="정량형 확인 (NAV-10)">
          <TextAreaField
            id="chk-q-source-cross-check"
            label="원자료 대조 기록"
            hint="원자료와 무엇을 언제 대조했는지"
            disabled={readOnly}
            value={text(c.quantitative.sourceCrossCheck)}
            onChange={(e) => set({ quantitative: { ...c.quantitative!, sourceCrossCheck: e.target.value } })}
          />
          <TextAreaField
            id="chk-q-limitations"
            label="수치가 말하지 않는 한계"
            hint="상관관계를 원인으로 단정하지 않습니다"
            disabled={readOnly}
            value={text(c.quantitative.limitations)}
            onChange={(e) => set({ quantitative: { ...c.quantitative!, limitations: e.target.value } })}
          />
          <TextAreaField
            id="chk-q-related-party"
            label="관련 기관·전문가 확인"
            disabled={readOnly}
            value={text(c.quantitative.relatedPartyCheck)}
            onChange={(e) => set({ quantitative: { ...c.quantitative!, relatedPartyCheck: e.target.value } })}
          />
          <p className="text-[14px] text-navy-600">&apos;인과 단정 없음&apos;은 편집 책임자가 편집 승인 때 확인합니다.</p>
        </FieldGroup>
      )}

      {c.qualitative && (
        <FieldGroup legend="정성형 기록 (NAV-11)">
          <TextAreaField id="chk-ql-questions" label="취재 질문" disabled={readOnly} value={text(c.qualitative.interviewQuestions)} onChange={(e) => set({ qualitative: { ...c.qualitative!, interviewQuestions: e.target.value } })} />
          <TextAreaField id="chk-ql-field" label="현장 확인 기록" disabled={readOnly} value={text(c.qualitative.fieldRecord)} onChange={(e) => set({ qualitative: { ...c.qualitative!, fieldRecord: e.target.value } })} />
          <TextAreaField id="chk-ql-counter" label="반대·보완 관점" disabled={readOnly} value={text(c.qualitative.counterPerspective)} onChange={(e) => set({ qualitative: { ...c.qualitative!, counterPerspective: e.target.value } })} />
          <TextAreaField
            id="chk-ql-conflicts"
            label="이해관계 확인"
            hint="관계가 없으면 '없음'이라고 적습니다"
            disabled={readOnly}
            value={text(c.qualitative.conflictsOfInterest)}
            onChange={(e) => set({ qualitative: { ...c.qualitative!, conflictsOfInterest: e.target.value } })}
          />
        </FieldGroup>
      )}

      {c.isLocalPolicyIssue && (
        <FieldGroup legend="관점별 기록 (지역 정책 쟁점)" hint="관점마다 취재 기록을 잇거나 '접촉했으나 응답 없음'과 접촉일을 남깁니다">
          {PERSPECTIVE_KEYS.map((key) => {
            const p = c.perspectives[key];
            return (
              <div key={key} className="grid gap-3 rounded-xl border border-navy-100 p-3 sm:grid-cols-3">
                <SelectField
                  id={`chk-p-${key}-status`}
                  label={`${PERSPECTIVE_LABELS[key]} 관점`}
                  disabled={readOnly}
                  options={optionsOf(PERSPECTIVE_STATUS_LABELS)}
                  placeholder="기록 없음"
                  value={p?.status ?? ""}
                  onChange={(e) => setPerspective(key, { status: e.target.value })}
                />
                <SelectField
                  id={`chk-p-${key}-evidence`}
                  label="취재 기록"
                  disabled={readOnly || p?.status !== "interviewed"}
                  options={evidenceRefs}
                  placeholder="고르지 않음"
                  value={p?.evidenceId ?? ""}
                  onChange={(e) => setPerspective(key, { evidenceId: e.target.value })}
                />
                <TextField id={`chk-p-${key}-date`} label="접촉일" type="date" disabled={readOnly || !p} value={p?.contactedAt ?? ""} onChange={(e) => setPerspective(key, { contactedAt: e.target.value })} />
              </div>
            );
          })}
          <div className="space-y-3">
            <p className="text-[15px] font-bold text-navy-900">해당 원문 대조 기록</p>
            {c.originalTextChecks.map((x, i) => (
              <div key={i} className="grid gap-3 rounded-xl border border-navy-100 p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
                <SelectField
                  id={`chk-otc-${i}-source`}
                  label={`원문 ${i + 1}`}
                  disabled={readOnly}
                  options={sourceRefs}
                  placeholder="골라 주세요"
                  value={x.sourceId}
                  onChange={(e) => set({ originalTextChecks: c.originalTextChecks.map((y, j) => (j === i ? { ...y, sourceId: e.target.value } : y)) })}
                />
                <TextField
                  id={`chk-otc-${i}-date`}
                  label="대조일"
                  type="date"
                  disabled={readOnly}
                  value={x.checkedAt ?? ""}
                  onChange={(e) => set({ originalTextChecks: c.originalTextChecks.map((y, j) => (j === i ? { ...y, checkedAt: e.target.value } : y)) })}
                />
                {!readOnly && (
                  <button type="button" className={OUTLINE_BUTTON} onClick={() => set({ originalTextChecks: c.originalTextChecks.filter((_, j) => j !== i) })} aria-label={`원문 ${i + 1} 지우기`}>
                    지우기
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button type="button" className={OUTLINE_BUTTON} onClick={() => set({ originalTextChecks: [...c.originalTextChecks, { sourceId: "", checkedAt: null }] })}>
                원문 대조 더하기
              </button>
            )}
          </div>
        </FieldGroup>
      )}

      {c.isInheritanceGiftCase && (
        <FieldGroup legend="상속·증여 사례 확인 (NAV-11)">
          <CheckboxField id="chk-ig-consent" label="당사자 동의를 확인했습니다" disabled={readOnly} checked={c.inheritanceGift.consent} onChange={(e) => set({ inheritanceGift: { ...c.inheritanceGift, consent: e.target.checked } })} />
          <CheckboxField
            id="chk-ig-deidentified"
            label="비식별 검토를 마쳤습니다"
            disabled={readOnly}
            checked={c.inheritanceGift.deidentified}
            onChange={(e) => set({ inheritanceGift: { ...c.inheritanceGift, deidentified: e.target.checked } })}
          />
        </FieldGroup>
      )}
    </div>
  );
}
