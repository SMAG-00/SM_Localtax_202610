"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { SYNONYM_LIMITS, emptySynonymForm, synonymFormToBody, synonymToForm, termKeyPreview, type SynonymForm as Form } from "@/lib/admin/synonym-rules";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { MONO, OUTLINE_BUTTON } from "./ui";
import { useHydrated } from "./useHydrated";

// 검색 동의어 사전 편집 (W2-d 설계 5장) — 낱말 하나를 찾으면 동의어도 함께 찾는다(한쪽 방향). 칸 검사는 서버와 같은 규칙(lib/admin/synonym-rules.ts).
// 저장하면 다음 검색부터 바로 쓴다(검색은 캐시하지 않는다). 같은 정규형 낱말은 한 줄만 — 서버(DB)가 거부한 문장을 그대로 보인다.

export interface SynonymItem {
  id: number;
  term: string;
  termKey: string;
  synonyms: string[];
  enabled: boolean;
  note: string | null;
}

/** 동의어 줄 더하기·고치기 */
export function SynonymForm({ mode, item }: { mode: "create" | "patch"; item?: SynonymItem }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const base = mode === "create" ? "synonym-new" : `synonym-${item!.id}`;
  const [form, setForm] = useState<Form>(item ? synonymToForm(item) : emptySynonymForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const text = (key: "term" | "synonymsText" | "note") => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const key = termKeyPreview(form.term);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    setDone("");
    const v = synonymFormToBody(form, base);
    if (!v.ok) {
      setErrors(v.errors);
      document.getElementById(Object.keys(v.errors)[0]!)?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    const r = mode === "create" ? await adminApi("POST", "/api/admin/synonyms", v.body) : await adminApi("PATCH", `/api/admin/synonyms/${item!.id}`, v.body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(mode === "create" ? `동의어 사전에 더했습니다 — ${v.body.term}` : "저장했습니다 — 다음 검색부터 바로 쓰입니다");
      if (mode === "create") setForm(emptySynonymForm());
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3" aria-label={mode === "create" ? "동의어 더하기" : `${item!.term} 동의어 고치기`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={`${base}-term`}
          label="낱말"
          required
          hint={`${SYNONYM_LIMITS.termChars}자까지 — 띄어쓰기·기호는 빼고 찾습니다${key ? ` (찾는 열쇠: ${key})` : ""}`}
          value={form.term}
          onChange={text("term")}
          error={errors[`${base}-term`]}
        />
        <TextField
          id={`${base}-synonyms`}
          label="함께 찾을 말"
          required
          hint={`쉼표로 나눕니다 — ${SYNONYM_LIMITS.count}개·하나에 ${SYNONYM_LIMITS.synonymChars}자까지`}
          value={form.synonymsText}
          onChange={text("synonymsText")}
          error={errors[`${base}-synonyms`]}
        />
      </div>
      <TextAreaField id={`${base}-note`} label="메모 (편집국만 봅니다)" rows={2} value={form.note} onChange={text("note")} error={errors[`${base}-note`]} />
      <CheckboxField id={`${base}-enabled`} label="사용 중 — 끄면 검색에 쓰지 않습니다" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "저장하는 중" : mode === "create" ? "동의어 더하기" : "저장"}
      </DarkButton>
    </form>
  );
}

/** 줄 지우기 — 감사 로그에 지운 줄이 남는다 */
export function SynonymDelete({ id, term }: { id: number; term: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function remove() {
    setPending(true);
    setError("");
    const r = await adminApi("DELETE", `/api/admin/synonyms/${id}`);
    setPending(false);
    if (r.status === 200) return router.refresh();
    setError(apiErrorMessage(r));
  }
  return (
    <div className="space-y-2">
      <button type="button" className={OUTLINE_BUTTON} disabled={pending || !hydrated} onClick={() => void remove()} aria-label={`동의어 ‘${term}’ 줄 지우기`}>
        지우기
      </button>
      {error && <ErrorSummary title={error} messages={[]} />}
    </div>
  );
}

/** 찾는 열쇠 표시 — 고정폭 */
export function TermKey({ value }: { value: string }) {
  return <span className={MONO}>{value}</span>;
}
