"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { PHRASE_DICTIONARIES, phraseError, type PhraseKind } from "@/lib/admin/dictionary-rules";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { GLOSSARY_GUIDE, GLOSSARY_LIMITS, glossaryFormToBody, glossaryWarnings, type GlossaryForm as Form } from "@/lib/admin/glossary-rules";
import { SECTION_LABELS } from "@/lib/admin/labels";
import { ErrorSummary, FieldGroup, StatusNote, TextAreaField } from "./fields";
import { MONO, OUTLINE_BUTTON } from "./ui";
import { useHydrated } from "./useHydrated";

/**
 * 금지 표현·공포 표현 사전 (UX-01 · UX-03) — 표현 하나씩 더하고 뺀다. 저장하면 배포 없이 다음 점검·저장부터 적용된다
 * (점검 패널·발행 API가 settings에서 바로 읽는다).
 */
export function PhraseEditor({ kind, phrases, version }: { kind: PhraseKind; phrases: readonly string[]; version: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const spec = PHRASE_DICTIONARIES[kind];
  const base = `dict-${kind}`;
  const [phrase, setPhrase] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [failure, setFailure] = useState<string>("");
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);

  async function send(op: "add" | "remove", value: string) {
    setPending(true);
    setFailure("");
    setDone("");
    const r = await adminApi("POST", `/api/admin/dictionaries/${kind}`, { op, phrase: value });
    setPending(false);
    if (r.status === 200) {
      setDone(op === "add" ? `${spec.label} 사전에 더했습니다 — ${value.trim()}` : `${spec.label} 사전에서 뺐습니다 — ${value.trim()}`);
      if (op === "add") setPhrase("");
      router.refresh();
      return;
    }
    if (op === "add" && r.status === 422) setFieldError(apiErrorMessage(r));
    else setFailure(apiErrorMessage(r));
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const problem = phraseError(phrase);
    setFieldError(problem ?? "");
    if (problem) return document.getElementById(`${base}-phrase`)?.focus();
    void send("add", phrase);
  }

  return (
    <div className="space-y-4">
      <p className="text-[15px] text-navy-700">
        {spec.effect}. 사전 버전 <span className={MONO}>{version || "없음"}</span> · 표현 {phrases.length}개
      </p>
      <form onSubmit={add} noValidate className="space-y-3" aria-label={`${spec.label} 더하기`}>
        <TextField
          id={`${base}-phrase`}
          label={`더할 ${spec.label}`}
          hint="40자 이하 한 줄. 띄어쓰기는 여러 칸이어도 한 칸으로 봅니다"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          error={fieldError || undefined}
        />
        <DarkButton type="submit" disabled={pending || !hydrated}>
          {pending ? "저장하는 중" : "사전에 더하기"}
        </DarkButton>
      </form>
      {failure && <ErrorSummary title={failure} messages={[]} />}
      {done && <StatusNote>{done}</StatusNote>}
      <ul aria-label={`${spec.label} 목록`} data-testid={`${base}-list`} className="flex flex-wrap gap-2">
        {phrases.map((p) => (
          <li key={p} data-phrase={p} className="inline-flex items-center gap-1 rounded-xl border border-navy-200 bg-white py-1 pr-1 pl-3 text-[15px] text-navy-900">
            <span className="[overflow-wrap:anywhere]">{p}</span>
            <button type="button" className={`${OUTLINE_BUTTON} min-h-11 px-3`} disabled={pending || !hydrated} onClick={() => void send("remove", p)} aria-label={`‘${p}’ 빼기`}>
              빼기
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface GlossaryItem {
  id: number;
  term: string;
  reading: string | null;
  definition: string | null;
  plain: string | null;
  jargon: boolean;
  related: string[];
  section: string[];
  source: string | null;
  visible: boolean;
}

const emptyForm: Form = { term: "", reading: "", definition: "", plain: "", jargon: true, relatedText: "", sections: [], source: "", visible: false };

/** 저장 경고 목록 (서버 응답 warnings) — 저장은 됐다 */
function warningsOf(body: Record<string, unknown>): string[] {
  const list = Array.isArray(body.warnings) ? body.warnings : [];
  return list.flatMap((w) => (typeof w === "object" && w !== null && typeof (w as { message?: unknown }).message === "string" ? [(w as { message: string }).message] : []));
}

/** 입력 중 경고 — 저장 전에 미리 보인다 (서버와 같은 규칙 glossaryWarnings). 저장은 막지 않는다 */
function LiveWarnings({ id, messages }: { id: string; messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <div id={id} data-part="glossary-live-warnings" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] text-amber-800">
      <p className="font-bold">저장 전에 확인해 주세요 (저장은 됩니다)</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {messages.map((m) => (
          <li key={m} className="[overflow-wrap:anywhere]">
            {m}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 쉬운 말 사전 용어 더하기·고치기 (UX-01 ① · GLO-01) — 전문 용어로 표시하면 쉬운 풀이가 필요하다.
 * 쉬운 풀이 60자 초과·풀이와 뜻의 숫자 + 단위는 경고만(입력 중에 미리, 저장 뒤에 서버 문장) — 저장은 된다. 120자를 넘으면 저장하지 않는다.
 * 더하기 폼에서만 공개를 고른다(기본 숨김) — 고치기는 목록의 [공개하기]·[숨기기] 단추로
 */
export function GlossaryForm({ mode, item }: { mode: "create" | "patch"; item?: GlossaryItem }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const base = mode === "create" ? "glossary-new" : `glossary-${item!.id}`;
  const [form, setForm] = useState<Form>(
    item
      ? {
          term: item.term,
          reading: item.reading ?? "",
          definition: item.definition ?? "",
          plain: item.plain ?? "",
          jargon: item.jargon,
          relatedText: item.related.join(", "),
          sections: item.section,
          source: item.source ?? "",
        }
      : emptyForm,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const text = (key: "term" | "reading" | "definition" | "plain" | "relatedText" | "source") => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const plainLength = [...form.plain.trim()].length;
  const live = glossaryWarnings({ plain: form.plain, definition: form.definition }).map((w) => w.message);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    setDone("");
    setSaved([]);
    const v = glossaryFormToBody(form, base);
    if (!v.ok) {
      setErrors(v.errors);
      document.getElementById(Object.keys(v.errors)[0]!)?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    const r = mode === "create" ? await adminApi("POST", "/api/admin/glossary", v.body) : await adminApi("PATCH", `/api/admin/glossary/${item!.id}`, v.body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(mode === "create" ? `용어를 더했습니다 — ${form.term.trim()}${form.visible ? " (공개)" : " (숨김 — 목록에서 공개할 수 있습니다)"}` : "저장했습니다");
      setSaved(warningsOf(r.body));
      if (mode === "create") setForm(emptyForm);
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3" aria-label={mode === "create" ? "용어 더하기" : `${item!.term} 고치기`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`${base}-term`} label="용어" required value={form.term} onChange={text("term")} error={errors[`${base}-term`]} />
        <TextField id={`${base}-reading`} label="읽는 법" value={form.reading} onChange={text("reading")} />
      </div>
      <TextField
        id={`${base}-plain`}
        label="쉬운 풀이 (한 줄)"
        hint={`${GLOSSARY_GUIDE.plainChars}자 이하로 씁니다 — 지금 ${plainLength}자. 넘어도 저장은 되고 경고만 합니다(${GLOSSARY_LIMITS.plain}자까지). 세율·공제액·요건 숫자는 넣지 않습니다. 기사에 이 용어가 처음 나오는 문단에 이 풀이가 없으면 점검 패널이 경고합니다`}
        value={form.plain}
        onChange={text("plain")}
        error={errors[`${base}-plain`]}
      />
      <TextAreaField id={`${base}-definition`} label="뜻 (자세히)" value={form.definition} onChange={text("definition")} />
      <LiveWarnings id={`${base}-warnings`} messages={live} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`${base}-related`} label="관련 용어" hint="쉼표로 나눕니다" value={form.relatedText} onChange={text("relatedText")} error={errors[`${base}-related`]} />
        <TextField id={`${base}-source`} label="출처" hint="법령 조문·자료 이름 등" value={form.source} onChange={text("source")} />
      </div>
      <FieldGroup legend="분야">
        <div className="grid gap-1 sm:grid-cols-4">
          {Object.entries(SECTION_LABELS).map(([value, label]) => (
            <CheckboxField
              key={value}
              id={`${base}-section-${value}`}
              label={label}
              checked={form.sections.includes(value)}
              onChange={(e) => setForm((f) => ({ ...f, sections: e.target.checked ? [...f.sections, value] : f.sections.filter((s) => s !== value) }))}
            />
          ))}
        </div>
      </FieldGroup>
      <CheckboxField
        id={`${base}-jargon`}
        label="전문 용어 — 풀이 없는 첫 등장을 점검합니다"
        checked={form.jargon}
        onChange={(e) => setForm((f) => ({ ...f, jargon: e.target.checked }))}
      />
      {mode === "create" && (
        <CheckboxField
          id={`${base}-visible`}
          label="바로 공개 — 용어사전·용어 칩·본문 풀이·검색에 보입니다 (감수 전이면 비워 두세요)"
          checked={form.visible === true}
          onChange={(e) => setForm((f) => ({ ...f, visible: e.target.checked }))}
        />
      )}
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      {saved.length > 0 && <ErrorSummary id={`${base}-saved-warnings`} title="저장했지만 확인할 문장이 있습니다" messages={saved} />}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "저장하는 중" : mode === "create" ? "용어 더하기" : "저장"}
      </DarkButton>
    </form>
  );
}

/** 공개·숨김 단추 — 감사 로그에 glossary.publish·glossary.unpublish가 남는다. 공개 화면에 바로 반영된다 */
export function GlossaryVisibility({ id, term, visible }: { id: number; term: string; visible: boolean }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function toggle() {
    setPending(true);
    setError("");
    const r = await adminApi("PATCH", `/api/admin/glossary/${id}`, { visible: !visible });
    setPending(false);
    if (r.status === 200) return router.refresh();
    setError(apiErrorMessage(r));
  }
  return (
    <div className="space-y-2">
      <button type="button" className={OUTLINE_BUTTON} disabled={pending || !hydrated} onClick={() => void toggle()} aria-label={`용어 ‘${term}’ ${visible ? "숨기기" : "공개하기"}`}>
        {pending ? "바꾸는 중" : visible ? "숨기기" : "공개하기"}
      </button>
      {error && <ErrorSummary title={error} messages={[]} />}
    </div>
  );
}

/** 용어 지우기 — 감사 로그에 지운 행이 남는다 */
export function GlossaryDelete({ id, term }: { id: number; term: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function remove() {
    setPending(true);
    setError("");
    const r = await adminApi("DELETE", `/api/admin/glossary/${id}`);
    setPending(false);
    if (r.status === 200) return router.refresh();
    setError(apiErrorMessage(r));
  }
  return (
    <div className="space-y-2">
      <button type="button" className={OUTLINE_BUTTON} disabled={pending || !hydrated} onClick={() => void remove()} aria-label={`용어 ‘${term}’ 지우기`}>
        지우기
      </button>
      {error && <ErrorSummary title={error} messages={[]} />}
    </div>
  );
}
