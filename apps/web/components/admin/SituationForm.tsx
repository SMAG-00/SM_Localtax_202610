"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, PICTOGRAMS, PICTOGRAM_NAMES, Pictogram, SelectField, TextField, cx } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { SECTION_LABELS } from "@/lib/admin/labels";
import {
  ALIASES_MAX,
  ALIAS_CHARS_MAX,
  CHECKS_COUNT,
  CHECKLIST_NOTICE,
  FIELD,
  SITUATION_SECTIONS,
  TOOL_FEATURES,
  TOOL_FEATURE_LABELS,
  emptyCheck,
  situationFormToBody,
  type SituationForm as Form,
} from "@/lib/admin/situation-rules";
import { ErrorSummary, FieldErrorText, FieldGroup, StatusNote, TextAreaField } from "./fields";
import { OUTLINE_BUTTON } from "./ui";
import { useHydrated } from "./useHydrated";

// 상황 카드 만들기·고치기 폼 (UX-05 · FAM-02) — 칸 검사는 서버와 같은 규칙(lib/admin/situation-rules.ts).
// '먼저 확인할 것'이 2개·4개면 서버에 보내지 않고 묶음 칸에 사유를 보인다. 서버(DB)가 거부하면 그 문장을 그대로 보인다(주소 중복·허브 상한 등).
// 감수 서명이 있는 상황에서 감수 대상 문장을 고치면 감수 기록이 지워진다는 것을 저장 전·후에 알린다.

const PICTOGRAM_GROUP_LABELS = { situation: "상황", tax: "세목", field: "4대 분야", hub: "지자체 허브" } as const;

export function SituationForm({
  mode,
  id,
  initial,
  reviewed,
  visible,
}: {
  mode: "create" | "patch";
  id?: number;
  initial: Form;
  /** 지금 감수 서명이 있는가 (고치기) */
  reviewed?: boolean;
  /** 지금 공개 중인가 (고치기) — 감수 대상 문장을 고치려면 먼저 내려야 한다 */
  visible?: boolean;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setCheck = (i: number, part: "title" | "when" | "note", value: string) =>
    setForm((f) => ({ ...f, checks: f.checks.map((c, j) => (j === i ? { ...c, [part]: value } : c)) }));
  const text = (key: keyof Form) => (e: { target: { value: string } }) => set(key, e.target.value as never);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    setDone("");
    const v = situationFormToBody(form, mode);
    if (!v.ok) {
      setErrors(v.errors);
      const first = Object.keys(v.errors)[0]!;
      document.getElementById(first === FIELD.checks ? `${FIELD.checks}-legend` : first)?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    const r = mode === "create" ? await adminApi("POST", "/api/admin/situations", v.body) : await adminApi("PATCH", `/api/admin/situations/${id}`, v.body);
    setPending(false);
    if (mode === "create" && r.status === 201) {
      const created = (r.body.situation as { id: number } | undefined)?.id;
      router.push(created ? `/admin/situations/${created}?created=1` : "/admin/situations");
      return;
    }
    if (mode === "patch" && r.status === 200) {
      setDone(r.body.reviewCleared === true ? "저장했습니다 — 감수 대상 문장이 바뀌어 감수 기록이 지워졌습니다. 세무 감수위원의 서명을 다시 받아야 공개할 수 있습니다." : "저장했습니다");
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6" aria-label={mode === "create" ? "상황 카드 만들기" : "상황 카드 고치기"}>
      {mode === "patch" && reviewed && (
        <p data-testid="review-warning" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] font-bold text-amber-800">
          {visible
            ? "공개 중입니다 — 먼저 확인할 것·일반적 체크리스트·자주 틀리는 점은 내린 뒤에 고칠 수 있습니다. 고치면 감수 기록이 지워집니다."
            : "감수 서명이 있습니다 — 먼저 확인할 것·일반적 체크리스트·자주 틀리는 점을 고치면 감수 기록이 지워져 다시 감수를 받아야 합니다."}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "create" ? (
          <TextField id={FIELD.slug} label="주소 (slug)" required hint="영문 소문자·숫자·'-' — 만든 뒤에는 바꾸지 않습니다 (/situations/주소)" value={form.slug} onChange={text("slug")} error={errors[FIELD.slug]} />
        ) : (
          <p className="text-[15px] text-navy-700">
            주소 <span className="font-mono text-[13px]">/situations/{form.slug}</span> — 만든 뒤에는 바꾸지 않습니다
          </p>
        )}
        <SelectField
          id={FIELD.section}
          label="분야"
          required
          placeholder="골라 주세요"
          options={SITUATION_SECTIONS.map((s) => ({ value: s, label: SECTION_LABELS[s] }))}
          value={form.section}
          onChange={text("section")}
          error={errors[FIELD.section]}
        />
        <TextField id={FIELD.title} label="상황 한 문장" required hint="예: 차를 팔았어요·폐차했어요 (60자 이하)" value={form.title} onChange={text("title")} error={errors[FIELD.title]} />
        <TextField id={FIELD.subtitle} label="무엇을 알 수 있는지 한 줄" hint="예: 돌려받을 세금이 있는지 먼저 확인합니다" value={form.subtitle} onChange={text("subtitle")} error={errors[FIELD.subtitle]} />
      </div>

      <TextAreaField
        id={FIELD.aliases}
        label="검색 별칭 (한 줄에 하나)"
        hint={`독자가 이 상황을 부르는 말 — 예: 차 팔았어요, 폐차. ${ALIASES_MAX}개·${ALIAS_CHARS_MAX}자까지. 감수 대상이 아니어서 공개 중에도 고칠 수 있고, 저장하면 다음 검색부터 찾힙니다`}
        rows={3}
        value={form.aliases}
        onChange={text("aliases")}
        error={errors[FIELD.aliases]}
      />

      <fieldset className="min-w-0 space-y-3 rounded-xl border border-navy-100 p-4" aria-describedby={errors[FIELD.pictogram] ? `${FIELD.pictogram}-error` : undefined}>
        <legend id={FIELD.pictogram} tabIndex={-1} className="px-1 text-[15px] font-black text-navy-900">
          픽토그램 (필수)
        </legend>
        <FieldErrorText id={FIELD.pictogram} error={errors[FIELD.pictogram]} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {PICTOGRAM_NAMES.map((name) => {
            const def = PICTOGRAMS[name];
            const checked = form.pictogram === name;
            return (
              <label
                key={name}
                data-pictogram-option={name}
                className={cx(
                  "flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-xl border p-3 text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-hermes-500",
                  checked ? "border-navy-900 bg-hermes-50" : "border-navy-100 bg-white hover:border-navy-300",
                )}
              >
                <input type="radio" name="situation-pictogram" value={name} checked={checked} onChange={() => set("pictogram", name)} className="sr-only" />
                <Pictogram name={name} label={def.label} layout="start" />
                <span className="text-[12px] text-navy-600">{PICTOGRAM_GROUP_LABELS[def.group]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="min-w-0 space-y-3 rounded-xl border border-navy-100 p-4" aria-describedby={errors[FIELD.checks] ? `${FIELD.checks}-error` : `${FIELD.checks}-hint`}>
        <legend id={`${FIELD.checks}-legend`} tabIndex={-1} className="px-1 text-[15px] font-black text-navy-900">
          먼저 확인할 것 — 정확히 {CHECKS_COUNT}개
        </legend>
        <p id={`${FIELD.checks}-hint`} className="text-[14px] text-navy-600">
          세무 감수 대상입니다. 단계마다 제목은 필수, 언제·할 일은 있으면 적습니다.
        </p>
        <FieldErrorText id={FIELD.checks} error={errors[FIELD.checks]} />
        <ol className="space-y-4" data-testid="checks">
          {form.checks.map((c, i) => (
            <li key={i} data-check-row={i} className="space-y-2 rounded-xl border border-navy-100 p-3">
              <p className="text-[14px] font-bold text-navy-800">확인할 것 {i + 1}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField id={FIELD.check(i, "title")} label="제목" required value={c.title} onChange={(e) => setCheck(i, "title", e.target.value)} error={errors[FIELD.check(i, "title")]} />
                <TextField id={FIELD.check(i, "when")} label="언제" hint="예: 판 날" value={c.when} onChange={(e) => setCheck(i, "when", e.target.value)} error={errors[FIELD.check(i, "when")]} />
                <TextField id={FIELD.check(i, "note")} label="할 일 한 줄" value={c.note} onChange={(e) => setCheck(i, "note", e.target.value)} error={errors[FIELD.check(i, "note")]} />
              </div>
              <button type="button" className={OUTLINE_BUTTON} onClick={() => setForm((f) => ({ ...f, checks: f.checks.filter((_, j) => j !== i) }))} aria-label={`확인할 것 ${i + 1} 빼기`}>
                빼기
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className={OUTLINE_BUTTON} onClick={() => setForm((f) => ({ ...f, checks: [...f.checks, emptyCheck()] }))}>
          확인할 것 더하기
        </button>
      </fieldset>

      <FieldGroup legend="일반적인 체크리스트 (상속·증여 상황 — 있으면)" hint="한 줄에 하나. 고지 문장과 함께 보입니다 (FAM-02 — 감수 대상).">
        <TextAreaField id={FIELD.checklistItems} label="체크리스트 항목" rows={3} value={form.checklistItems} onChange={text("checklistItems")} error={errors[FIELD.checklistItems]} />
        <TextField
          id={FIELD.checklistNotice}
          label="고지 문장"
          hint={`기본: ${CHECKLIST_NOTICE}`}
          value={form.checklistNotice}
          onChange={text("checklistNotice")}
          error={errors[FIELD.checklistNotice]}
        />
      </FieldGroup>

      <TextAreaField id={FIELD.mistakes} label="자주 틀리는 점 (3개까지 — 한 줄에 하나, 감수 대상)" rows={3} value={form.mistakes} onChange={text("mistakes")} error={errors[FIELD.mistakes]} />

      <FieldGroup legend="연결" hint="번호는 쉼표로 나눠 적습니다. 공개 화면에는 발행된 기사만 이 순서로 보입니다.">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField id={FIELD.articleIds} label="관련 기사 번호" value={form.articleIds} onChange={text("articleIds")} error={errors[FIELD.articleIds]} />
          <TextField id={FIELD.solvedCaseIds} label="해결 사례 기사 번호" value={form.solvedCaseIds} onChange={text("solvedCaseIds")} error={errors[FIELD.solvedCaseIds]} />
          <TextField id={FIELD.glossaryIds} label="용어 번호" value={form.glossaryIds} onChange={text("glossaryIds")} error={errors[FIELD.glossaryIds]} />
        </div>
        <div className="space-y-2">
          <p className="text-[14px] text-navy-600">다음 행동 연결 칸 — 그 기능이 공개되면(운영 설정) 상황 페이지에 저절로 붙습니다.</p>
          {TOOL_FEATURES.map((f) => (
            <CheckboxField
              key={f}
              id={`situation-tool-${f}`}
              label={TOOL_FEATURE_LABELS[f]}
              checked={form.toolLinks.includes(f)}
              onChange={(e) => set("toolLinks", e.target.checked ? [...form.toolLinks, f] : form.toolLinks.filter((x) => x !== f))}
            />
          ))}
          <CheckboxField id="situation-region-select" label="지역 선택 칩을 보인다 (예: 집을 샀어요)" checked={form.regionSelect} onChange={(e) => set("regionSelect", e.target.checked)} />
        </div>
      </FieldGroup>

      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "저장하는 중" : mode === "create" ? "상황 카드 만들기" : "저장"}
      </DarkButton>
    </form>
  );
}
