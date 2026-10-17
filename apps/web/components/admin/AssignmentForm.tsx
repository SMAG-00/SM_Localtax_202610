"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { EMPTY_ASSIGNMENT_FORM, assignmentPayload, validateAssignment, type AssignmentForm as Form } from "@/lib/admin/assignment-form";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { EDITORIAL_FIELD_LABELS, REPORTING_METHOD_LABELS, SECTION_LABELS, optionsOf } from "@/lib/admin/labels";
import { ErrorSummary, FieldGroup, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

export interface PersonOption {
  id: number;
  name: string;
  roles: string[];
}

const KIND_LABELS = { general: "일반", feature: "기획", investigative: "탐사" } as const;

/** 기사 기획 등록·고치기 (NAV-09) — 분야·지역·가설·공익성·전문 분야 관련성·취재 방식·담당 기자/편집자·취재 계획·마감·이해관계 */
export function AssignmentForm({ mode, assignmentId, initial, people }: { mode: "create" | "patch"; assignmentId?: number; initial?: Form; people: readonly PersonOption[] }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const start = initial ?? EMPTY_ASSIGNMENT_FORM;
  const [form, setForm] = useState<Form>(start);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const prefix = mode === "create" ? "asg" : `asg-${assignmentId}`;
  const id = (name: string) => `${prefix}-${name}`;
  const err = (name: string) => errors[`asg-${name}`];
  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const reporters = people.filter((p) => p.roles.includes("reporter")).map((p) => ({ value: String(p.id), label: p.name }));
  const editors = people.filter((p) => p.roles.includes("editor")).map((p) => ({ value: String(p.id), label: p.name }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone("");
    setFailure(null);
    const v = validateAssignment(form);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    const body = assignmentPayload(form, mode, mode === "patch" ? start : undefined);
    if (mode === "patch" && Object.keys(body).length === 0) {
      setDone("바뀐 칸이 없습니다");
      return;
    }
    setPending(true);
    const r = await adminApi(mode === "create" ? "POST" : "PATCH", mode === "create" ? "/api/admin/assignments" : `/api/admin/assignments/${assignmentId}`, body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(mode === "create" ? "기획을 등록했습니다" : "기획을 고쳤습니다");
      if (mode === "create") setForm(EMPTY_ASSIGNMENT_FORM);
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id={id("section")} label="분야" required options={optionsOf(SECTION_LABELS)} placeholder="골라 주세요" value={form.section} onChange={set("section")} error={err("section")} />
        <SelectField id={id("kind")} label="기획 종류" options={optionsOf(KIND_LABELS)} value={form.kind} onChange={set("kind")} />
      </div>
      <TextAreaField id={id("hypothesis")} label="기사 가설" required value={form.hypothesis} onChange={set("hypothesis")} error={err("hypothesis")} />
      <TextAreaField id={id("public-interest")} label="공익성" hint="독자가 왜 알아야 하는지" value={form.publicInterest} onChange={set("publicInterest")} />
      <TextAreaField id={id("relevance")} label="전문 분야 관련성" hint="배정 전에 꼭 적습니다" value={form.relevance} onChange={set("relevance")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id={id("method")} label="취재 방식" options={optionsOf(REPORTING_METHOD_LABELS)} placeholder="골라 주세요" value={form.method} onChange={set("method")} />
        <TextField id={id("due-date")} label="마감" type="date" value={form.dueDate} onChange={set("dueDate")} error={err("due-date")} />
        <SelectField id={id("reporter")} label="담당 기자" options={reporters} placeholder="골라 주세요" value={form.reporterId} onChange={set("reporterId")} />
        <SelectField id={id("editor")} label="담당 편집자" options={editors} placeholder="골라 주세요" value={form.editorId} onChange={set("editorId")} />
      </div>
      <TextAreaField id={id("plan")} label="취재 계획" value={form.plan} onChange={set("plan")} />
      <TextAreaField id={id("conflicts")} label="이해관계" hint="관계가 없으면 '없음'이라고 적습니다" value={form.conflicts} onChange={set("conflicts")} />
      <FieldGroup legend="지역 기획" hint="지역 태그를 달면 편집 분야와 공익적 질문이 있어야 배정됩니다">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id={id("region-code")} label="지역 코드" value={form.regionCode} onChange={set("regionCode")} />
          <SelectField
            id={id("editorial-field")}
            label="편집 분야"
            options={optionsOf(EDITORIAL_FIELD_LABELS)}
            placeholder="없음"
            value={form.editorialField}
            onChange={set("editorialField")}
            error={err("editorial-field")}
          />
        </div>
        <TextAreaField id={id("public-question")} label="공익적 질문" value={form.publicQuestion} onChange={set("publicQuestion")} />
      </FieldGroup>
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "저장 중" : mode === "create" ? "기획 등록" : "기획 고치기 저장"}
      </DarkButton>
    </form>
  );
}
