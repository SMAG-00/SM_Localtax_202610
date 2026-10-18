"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { CONTENT_TYPE_LABELS, REPORTING_METHOD_LABELS } from "@/lib/admin/labels";
import { METRIC_LABELS } from "@/lib/admin/readiness-view";
import { emptyItemForm, errorFieldId, requirementFormToBody, type FilterFormState, type ItemFormState, type RequirementFormState } from "@/lib/admin/requirement-form";
import { ASSIGNMENT_KIND_LABELS, ASSIGNMENT_KINDS, CONTENT_TYPES, PLATFORM_LABELS, PLATFORMS, REPORTING_METHODS, REQUIREMENT_METRICS } from "@/lib/readiness/requirements";
import { WINDOW_BASES, WINDOW_BASIS_LABELS } from "@/lib/readiness/windows";
import { ErrorSummary, FieldErrorText, FieldGroup, StatusNote, TextAreaField } from "./fields";
import { OUTLINE_BUTTON } from "./ui";
import { useHydrated } from "./useHydrated";

// 제휴 규정 버전 입력 (NAV-13) — 새 버전 · 작성 중 버전 고치기 · 확정 버전을 바탕으로 새 버전. 저장 전 검사는 규정 API와 같은 함수.
// 기준 숫자는 담당자가 원문을 보고 요건마다 적는다(기본값 0). 확정은 따로(RequirementConfirm).

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}개월` }));
const BASIS_OPTIONS = WINDOW_BASES.map((b) => ({ value: b, label: WINDOW_BASIS_LABELS[b] }));
const METRIC_OPTIONS = REQUIREMENT_METRICS.map((m) => ({ value: m, label: METRIC_LABELS[m] }));
const COMPARATOR_OPTIONS = [
  { value: "gte", label: "이상" },
  { value: "gt", label: "초과" },
];
const PER_OPTIONS = [
  { value: "period", label: "심사 기간 전체" },
  { value: "month", label: "월평균" },
];

const FILTER_GROUPS = [
  { field: "contentTypes", legend: "유형", values: CONTENT_TYPES as readonly string[], labels: CONTENT_TYPE_LABELS as Record<string, string> },
  { field: "reportingMethods", legend: "취재 방식", values: REPORTING_METHODS as readonly string[], labels: REPORTING_METHOD_LABELS as Record<string, string> },
  { field: "assignmentKinds", legend: "기획 종류", values: ASSIGNMENT_KINDS as readonly string[], labels: ASSIGNMENT_KIND_LABELS as Record<string, string> },
] as const;

function FilterFields({ id, legend, value, onChange, errors }: { id: string; legend: string; value: FilterFormState; onChange: (v: FilterFormState) => void; errors: FieldErrors }) {
  return (
    <FieldGroup legend={legend} hint="고르지 않은 칸은 모두 셉니다. 고른 칸은 모두 맞아야 셉니다.">
      {FILTER_GROUPS.map((g) => (
        <div key={g.field} className="space-y-1">
          <p className="text-[14px] font-bold text-navy-700">{g.legend}</p>
          <div className="flex flex-wrap gap-x-4">
            {g.values.map((v) => (
              <CheckboxField
                key={v}
                id={`${id}-${g.field}-${v}`}
                label={g.labels[v] ?? v}
                checked={value[g.field].includes(v)}
                onChange={(e) => onChange({ ...value, [g.field]: e.target.checked ? [...value[g.field], v] : value[g.field].filter((x) => x !== v) })}
              />
            ))}
          </div>
          <FieldErrorText id={`${id}-${g.field}`} error={errors[`${id}-${g.field}`]} />
        </div>
      ))}
      <CheckboxField id={`${id}-includeLegacy`} label="이관(옛 사이트) 기사도 셉니다" checked={value.includeLegacy} onChange={(e) => onChange({ ...value, includeLegacy: e.target.checked })} />
    </FieldGroup>
  );
}

function ItemFields({ base, index, item, onChange, onRemove, errors }: { base: string; index: number; item: ItemFormState; onChange: (i: ItemFormState) => void; onRemove: () => void; errors: FieldErrors }) {
  const id = `${base}-items-${index}`;
  const set = (key: keyof ItemFormState) => (e: { target: { value: string } }) => onChange({ ...item, [key]: e.target.value });
  const needsDenominatorText = item.metric === "ratio" || item.metric === "per_reporter";
  return (
    <fieldset data-item={index} className="min-w-0 space-y-3 rounded-xl border border-navy-200 p-4">
      <legend className="px-1 text-[15px] font-bold text-navy-900">요건 {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`${id}-key`} label="요건 key" required hint="영문 소문자·숫자·_ (예: own_ratio)" value={item.key} onChange={set("key")} error={errors[`${id}-key`]} />
        <TextField id={`${id}-label`} label="요건 이름" required value={item.label} onChange={set("label")} error={errors[`${id}-label`]} />
        <SelectField id={`${id}-metric`} label="계산" required options={METRIC_OPTIONS} placeholder="골라 주세요" value={item.metric} onChange={set("metric")} error={errors[`${id}-metric`]} />
        <TextField id={`${id}-sourceRef`} label="원문 조항" hint="예: 제3조 2항" value={item.sourceRef} onChange={set("sourceRef")} error={errors[`${id}-sourceRef`]} />
      </div>
      <FilterFields id={`${id}-numerator`} legend="분자 — 세는 기사" value={item.numerator} onChange={(v) => onChange({ ...item, numerator: v })} errors={errors} />
      {item.metric === "ratio" && <FilterFields id={`${id}-denominator`} legend="분모 — 비율의 바탕 기사" value={item.denominator} onChange={(v) => onChange({ ...item, denominator: v })} errors={errors} />}
      <TextAreaField id={`${id}-numeratorText`} label="분자 정의 (규정 원문을 쉬운 말로)" required value={item.numeratorText} onChange={set("numeratorText")} error={errors[`${id}-numeratorText`]} />
      {needsDenominatorText && (
        <TextAreaField
          id={`${id}-denominatorText`}
          label={item.metric === "ratio" ? "분모 정의" : "기자 수 정의"}
          required
          value={item.denominatorText}
          onChange={set("denominatorText")}
          error={errors[`${id}-denominatorText`]}
        />
      )}
      <TextAreaField id={`${id}-exclusionsText`} label="제외 조건 (없으면 '없음')" required value={item.exclusionsText} onChange={set("exclusionsText")} error={errors[`${id}-exclusionsText`]} />
      <CheckboxField
        id={`${id}-hasCriterion`}
        label="규정 원문에 기준 숫자가 있습니다"
        hint="원문에 적힌 숫자만 적습니다. 없으면 숫자만 보고 기준 비교를 하지 않습니다"
        checked={item.hasCriterion}
        onChange={(e) => onChange({ ...item, hasCriterion: e.target.checked })}
      />
      {item.hasCriterion && (
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            id={`${id}-criterion-value`}
            label={item.metric === "ratio" ? "기준 (%)" : "기준 (건)"}
            inputMode="decimal"
            required
            value={item.value}
            onChange={set("value")}
            error={errors[`${id}-criterion-value`]}
          />
          <SelectField id={`${id}-criterion-comparator`} label="비교" options={COMPARATOR_OPTIONS} value={item.comparator} onChange={set("comparator")} error={errors[`${id}-criterion-comparator`]} />
          <SelectField id={`${id}-criterion-per`} label="단위" options={PER_OPTIONS} value={item.per} onChange={set("per")} error={errors[`${id}-criterion-per`]} />
        </div>
      )}
      <FieldErrorText id={id} error={errors[id]} />
      <button type="button" className={OUTLINE_BUTTON} onClick={onRemove}>
        요건 {index + 1} 빼기
      </button>
    </fieldset>
  );
}

export interface RequirementFormProps {
  mode: "create" | "patch";
  /** 칸 id 앞부분 (한 화면에 폼이 여럿) */
  base: string;
  initial: RequirementFormState;
  /** 고치기 대상 */
  id?: number;
  /** 이 버전을 바탕으로 새 버전 */
  supersedesId?: number;
  label: string;
}

export function RequirementForm({ mode, base, initial, id, supersedesId, label }: RequirementFormProps) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [form, setForm] = useState<RequirementFormState>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const set = (key: keyof RequirementFormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const lockedPlatform = mode === "patch" || supersedesId !== undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    setDone("");
    const v = requirementFormToBody(form, mode, base);
    if (!v.ok) {
      setErrors(v.errors);
      setFailure({ title: "입력값을 확인하세요", details: v.messages });
      const first = Object.keys(v.errors)[0];
      if (first) document.getElementById(first)?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    const body = mode === "create" && supersedesId !== undefined ? { ...v.body, supersedesId } : v.body;
    const r = mode === "create" ? await adminApi("POST", "/api/admin/news-readiness/requirements", body) : await adminApi("PATCH", `/api/admin/news-readiness/requirements/${id}`, body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      const saved = r.body.requirement as { version?: number } | undefined;
      setDone(mode === "create" ? `새 버전을 저장했습니다 — ${saved?.version ?? ""}번 (작성 중)` : "저장했습니다");
      router.refresh();
      return;
    }
    const details = apiErrorDetails(r);
    const mapped: FieldErrors = {};
    for (const m of details) {
      const at = m.indexOf(": ");
      if (at > 0) mapped[errorFieldId(m.slice(0, at), base)] ??= m.slice(at + 2);
    }
    setErrors(mapped);
    setFailure({ title: apiErrorMessage(r), details });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-4" aria-label={label}>
      <div className="grid gap-3 sm:grid-cols-2">
        {lockedPlatform ? (
          <p className="text-[15px] text-navy-800">
            <span className="font-bold">플랫폼</span> {PLATFORM_LABELS[form.platform as keyof typeof PLATFORM_LABELS] ?? form.platform}
          </p>
        ) : (
          <SelectField
            id={`${base}-platform`}
            label="플랫폼"
            required
            options={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
            placeholder="골라 주세요"
            value={form.platform}
            onChange={set("platform")}
            error={errors[`${base}-platform`]}
          />
        )}
        <TextField id={`${base}-title`} label="규정 이름" required hint="예: 2026 뉴스 검색 제휴 심사 규정" value={form.title} onChange={set("title")} error={errors[`${base}-title`]} />
        <TextField id={`${base}-sourceUrl`} label="공식 규정 원문 주소" hint="확정하려면 필요 — https://로 시작" value={form.sourceUrl} onChange={set("sourceUrl")} error={errors[`${base}-sourceUrl`]} />
        <TextField id={`${base}-sourceTextRef`} label="원문 사본 보관 위치·조항" value={form.sourceTextRef} onChange={set("sourceTextRef")} error={errors[`${base}-sourceTextRef`]} />
        <TextField id={`${base}-checkedAt`} label="원문 확인일" type="date" hint="확정하려면 필요" value={form.checkedAt} onChange={set("checkedAt")} error={errors[`${base}-checkedAt`]} />
        <TextField id={`${base}-mediaType`} label="매체 등록 유형" hint="실사로 확인한 우리 매체의 등록 유형 — 확정하려면 필요" value={form.mediaType} onChange={set("mediaType")} error={errors[`${base}-mediaType`]} />
        <TextField id={`${base}-effectiveFrom`} label="적용 시작일" type="date" hint="확정하려면 필요" value={form.effectiveFrom} onChange={set("effectiveFrom")} error={errors[`${base}-effectiveFrom`]} />
        <TextField id={`${base}-effectiveTo`} label="적용 끝날" type="date" hint="모르면 비웁니다" value={form.effectiveTo} onChange={set("effectiveTo")} error={errors[`${base}-effectiveTo`]} />
      </div>
      <FieldGroup legend="심사 대상 기간 (확정하려면 필요)" hint="규정 원문의 기간 글자와, 대시보드가 기준 비교에 쓰는 기간 길이·잡는 법">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField id={`${base}-reviewPeriod-months`} label="기간 길이" options={MONTH_OPTIONS} placeholder="골라 주세요" value={form.reviewMonths} onChange={set("reviewMonths")} error={errors[`${base}-reviewPeriod-months`]} />
          <SelectField id={`${base}-reviewPeriod-basis`} label="잡는 법" options={BASIS_OPTIONS} placeholder="골라 주세요" value={form.reviewBasis} onChange={set("reviewBasis")} error={errors[`${base}-reviewPeriod-basis`]} />
        </div>
        <TextField id={`${base}-reviewPeriod-text`} label="원문의 기간 글자" hint="예: 과거 1년 중 임의의 3개월" value={form.reviewText} onChange={set("reviewText")} error={errors[`${base}-reviewPeriod-text`]} />
        <FieldErrorText id={`${base}-reviewPeriod`} error={errors[`${base}-reviewPeriod`]} />
      </FieldGroup>
      <div className="space-y-3">
        <p className="text-[17px] font-bold text-navy-900">요건 (확정하려면 1개 이상)</p>
        {form.items.map((item, i) => (
          <ItemFields
            key={i}
            base={base}
            index={i}
            item={item}
            errors={errors}
            onChange={(next) => setForm((f) => ({ ...f, items: f.items.map((x, j) => (j === i ? next : x)) }))}
            onRemove={() => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}
          />
        ))}
        <FieldErrorText id={`${base}-items`} error={errors[`${base}-items`]} />
        <button type="button" className={OUTLINE_BUTTON} onClick={() => setForm((f) => ({ ...f, items: [...f.items, emptyItemForm()] }))}>
          요건 더하기
        </button>
      </div>
      <TextAreaField id={`${base}-note`} label="메모" value={form.note} onChange={set("note")} error={errors[`${base}-note`]} />
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "저장하는 중" : mode === "create" ? "작성 중 버전으로 저장" : "저장"}
      </DarkButton>
    </form>
  );
}
