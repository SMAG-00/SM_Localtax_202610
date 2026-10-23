"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { REBUTTAL_METHODS, REBUTTAL_METHOD_LABELS, REBUTTAL_STATUSES, REBUTTAL_STATUS_LABELS, STRUCTURE_TYPES, STRUCTURE_TYPE_LABELS, diagramFromText } from "@/lib/admin/finance-rules";
import { errorsByField } from "@/lib/admin/project-rules";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

// 개발금융 관리 폼 (W5 - /admin/finance). 값 검사는 서버(lib/admin/finance-rules.ts + DB 트리거)가 하고, 오류 "칸: 문장"은 그 칸 옆에 보인다.
// 폼 하나가 op 하나를 보낸다(종류별 칸 목록은 아래 SPECS). 입력 칸에 채워 넣는 기본값은 없다 - 내용은 편집국이 공식 원문을 보고 적는다.
// 수익률 순위·상품 가입 링크·추천 입력 요소는 어디에도 없다 (DF-05).

type Kind = "structure" | "legal_check" | "indicator" | "regulation" | "case" | "interest" | "legal_review";
type Field = { name: string; label: string; type?: "text" | "area" | "select" | "check" | "date"; options?: { value: string; label: string }[]; hint?: string; required?: boolean };
type Values = Record<string, string | boolean>;

const opt = (labels: Record<string, string>, keys: readonly string[]) => [{ value: "", label: "고르세요" }, ...keys.map((k) => ({ value: k, label: labels[k] ?? k }))];
const STATE_OPTIONS = [
  { value: "", label: "고르세요" },
  { value: "declared", label: "관계 있음 (내용을 적습니다)" },
  { value: "none_confirmed", label: "관계 없음 (필자 확인자와 함께)" },
];
const SOURCE: Field[] = [
  { name: "provider", label: "제공기관", required: true },
  { name: "source_url", label: "원문 주소", required: true },
  { name: "snapshot_id", label: "원본 스냅샷 번호 (있으면)" },
  { name: "snapshot_payload", label: "원문 글자 (스냅샷 번호가 없을 때 붙여 넣기)", type: "area" },
];

const SPECS: Record<Kind, { label: string; submit: string; ok: string; fields: Field[] }> = {
  structure: {
    label: "구조 해설 초안",
    submit: "초안 저장",
    ok: "초안을 저장했습니다 - 고쳤다면 법률 확인이 지워지고 다시 서명이 필요합니다.",
    fields: [
      { name: "slug", label: "주소 이름 (영문 소문자·숫자·-)", required: true },
      { name: "structure_type", label: "구조 유형", type: "select", options: opt(STRUCTURE_TYPE_LABELS, STRUCTURE_TYPES), required: true },
      { name: "title", label: "제목", required: true },
      { name: "summary", label: "한 줄 설명", type: "area" },
      { name: "alt", label: "구조도 대체 텍스트", hint: "구조도를 말로 설명합니다 (200자 이하)" },
      { name: "nodes", label: "구조도 노드 (한 줄에 하나: key=이름)", type: "area", hint: "예) a=주체 가 (key는 영문 소문자·숫자·밑줄)" },
      { name: "edges", label: "구조도 관계 (한 줄에 하나: from>to:관계 이름)", type: "area", hint: "이 관계 목록이 같은 내용의 표가 됩니다 (1개 이상)" },
      { name: "notes", label: "설명 문단 (한 줄에 한 문단)", type: "area" },
      { name: "lens", label: "「지방세로 읽기」 박스 (JSON, 없으면 비움)", type: "area", hint: "{ topics, points, links, base_date } - 비우면 아래 생략 사유가 필요합니다" },
      { name: "lens_omit_reason", label: "박스 생략 사유 (박스가 없을 때)" },
    ],
  },
  legal_check: {
    label: "법률 확인",
    submit: "법률 확인 기록",
    ok: "법률 확인을 기록했습니다.",
    fields: [
      { name: "checked_by", label: "법률 확인자 이름", required: true },
      { name: "checked_on", label: "확인일 (YYYY-MM-DD, 비우면 오늘)", type: "date" },
    ],
  },
  indicator: {
    label: "통계 지표 새 값",
    submit: "새 값 추가",
    ok: "새 값을 추가했습니다 - 이전 값은 그대로 남습니다.",
    fields: [
      { name: "indicator_key", label: "지표 열쇠 (영문 소문자·숫자·밑줄)", required: true },
      { name: "label", label: "지표 이름", required: true },
      { name: "definition", label: "지표 정의 (분모·기간)", type: "area", required: true },
      { name: "value", label: "값 (숫자)", required: true },
      { name: "unit", label: "단위", required: true },
      { name: "as_of", label: "기준일 (YYYY-MM-DD)", type: "date", required: true },
      { name: "collected_on", label: "수집일 (YYYY-MM-DD)", type: "date", required: true },
      ...SOURCE,
    ],
  },
  regulation: {
    label: "규제 항목 새 단계",
    submit: "새 단계 추가",
    ok: "새 단계를 추가했습니다 - 이전 단계는 그대로 남습니다.",
    fields: [
      { name: "reg_key", label: "항목 열쇠 (영문 소문자·숫자·밑줄)", required: true },
      { name: "title", label: "항목 이름", required: true },
      { name: "stage", label: "단계", required: true },
      { name: "effective_on", label: "시행 예정일 (YYYY-MM-DD)", type: "date", required: true },
      ...SOURCE,
    ],
  },
  case: {
    label: "사례 구조·반론 기록",
    submit: "사례 기록 저장",
    ok: "사례 기록을 저장했습니다.",
    fields: [
      { name: "structure_type", label: "구조 유형", type: "select", options: opt(STRUCTURE_TYPE_LABELS, STRUCTURE_TYPES), required: true },
      { name: "issues", label: "쟁점 (한 줄에 하나, 8개까지)", type: "area" },
      { name: "outcome", label: "결과 (공개된 자료 범위)", type: "area" },
      { name: "named_company", label: "실명 기업을 다룹니다 (켜면 반론 기록이 모두 필요합니다)", type: "check" },
      { name: "rebuttal_requested_at", label: "반론 요청일 (YYYY-MM-DD)", type: "date" },
      { name: "rebuttal_method", label: "요청 방법", type: "select", options: opt(REBUTTAL_METHOD_LABELS, REBUTTAL_METHODS) },
      { name: "rebuttal_status", label: "답변 상태", type: "select", options: opt(REBUTTAL_STATUS_LABELS, REBUTTAL_STATUSES) },
      { name: "rebuttal_note", label: "반론 내부 메모 (공개되지 않습니다)", type: "area" },
      { name: "judgment_quoted", label: "판결문을 인용했습니다", type: "check" },
      { name: "anonymized_checked", label: "비실명 처리를 확인했습니다", type: "check" },
    ],
  },
  interest: {
    label: "칼럼 소속 항목",
    submit: "소속 항목 저장",
    ok: "소속 항목을 저장했습니다.",
    fields: [
      { name: "fin_state", label: "소속 금융사 관계", type: "select", options: STATE_OPTIONS },
      { name: "fin_text", label: "소속 금융사 내용 (관계 있음일 때)" },
      { name: "fin_by", label: "필자 확인자 (관계 없음일 때)" },
      { name: "trust_state", label: "소속 신탁사 관계", type: "select", options: STATE_OPTIONS },
      { name: "trust_text", label: "소속 신탁사 내용 (관계 있음일 때)" },
      { name: "trust_by", label: "필자 확인자 (관계 없음일 때)" },
    ],
  },
  legal_review: {
    label: "법률 검토 기록",
    submit: "법률 검토 기록 저장",
    ok: "법률 검토 기록을 저장했습니다.",
    fields: [
      { name: "reviewer", label: "법률 검토자", required: true },
      { name: "reviewed_on", label: "검토일 (YYYY-MM-DD)", type: "date", required: true },
      { name: "conclusion", label: "결론", type: "select", options: [{ value: "", label: "고르세요" }, { value: "approved", label: "승인 (개발금융 공개를 켤 수 있음)" }, { value: "rejected", label: "반려" }], required: true },
    ],
  },
};

const lines = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");

/** 폼 값 → 요청 본문 (op 포함). 틀린 JSON은 null + 오류 */
function toBody(kind: Kind, v: Values, ctx: Record<string, unknown>): { body: Record<string, unknown> } | { error: string } {
  const s = (k: string) => String(v[k] ?? "");
  if (kind === "structure") {
    let lens: unknown = null;
    if (s("lens").trim() !== "") {
      try {
        lens = JSON.parse(s("lens"));
      } catch {
        return { error: "lens: JSON 모양이 아닙니다" };
      }
    }
    const hasDiagram = s("alt").trim() !== "" || s("nodes").trim() !== "" || s("edges").trim() !== "";
    return {
      body: {
        op: "structure", slug: s("slug"), structure_type: s("structure_type"), title: s("title"), summary: s("summary"),
        diagram: hasDiagram ? diagramFromText(s("alt"), s("nodes"), s("edges")) : null,
        notes: lines(s("notes")), lens, lens_omit_reason: s("lens_omit_reason"),
      },
    };
  }
  if (kind === "legal_check") return { body: { op: "legal_check", ...ctx, checked_by: s("checked_by"), checked_on: s("checked_on") } };
  if (kind === "indicator" || kind === "regulation") return { body: { op: kind, ...Object.fromEntries(SPECS[kind].fields.map((f) => [f.name, s(f.name)])) } };
  if (kind === "case") {
    return {
      body: {
        op: "case", ...ctx, structure_type: s("structure_type"), issues: lines(s("issues")), outcome: s("outcome"), named_company: v.named_company === true,
        rebuttal_requested_at: s("rebuttal_requested_at"), rebuttal_method: s("rebuttal_method"), rebuttal_status: s("rebuttal_status"), rebuttal_note: s("rebuttal_note"),
        judgment_quoted: v.judgment_quoted === true, anonymized_checked: v.anonymized_checked === true,
      },
    };
  }
  if (kind === "interest") {
    const items = [
      { item: "financial_company", state: s("fin_state"), interest_text: s("fin_text"), confirmed_by: s("fin_by") },
      { item: "trust_company", state: s("trust_state"), interest_text: s("trust_text"), confirmed_by: s("trust_by") },
    ].filter((i) => i.state !== "");
    return { body: { op: "interest_items", ...ctx, items } };
  }
  return { body: { op: "legal_review", reviewer: s("reviewer"), reviewed_on: s("reviewed_on"), conclusion: s("conclusion") } };
}

const FIELD_ALIAS: Record<string, string> = { diagram: "nodes", items: "fin_state", lens_omit_reason: "lens_omit_reason" };

/** 폼 한 개 - kind가 보낼 op와 칸을 정한다. ctx는 보이지 않는 값(slug·기사 번호) */
export function FinanceForm({ kind, id, initial, ctx = {} }: { kind: Kind; id: string; initial?: Values; ctx?: Record<string, unknown> }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const spec = SPECS[kind];
  const [v, setV] = useState<Values>(initial ?? {});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<{ title: string; details: string[]; fields: Record<string, string[]> } | null>(null);
  const fieldError = (name: string) => {
    if (!err) return undefined;
    const alias = Object.entries(FIELD_ALIAS).filter(([, to]) => to === name).map(([from]) => from);
    return [name, ...alias].flatMap((n) => err.fields[n] ?? []).join(" ") || undefined;
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    setErr(null);
    const made = toBody(kind, v, ctx);
    if ("error" in made) {
      setErr({ title: "입력값을 확인하세요", details: [made.error], fields: errorsByField([made.error]) });
      return;
    }
    setPending(true);
    const r = await adminApi("POST", "/api/admin/finance", made.body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(spec.ok);
      router.refresh();
    } else {
      const details = apiErrorDetails(r);
      setErr({ title: apiErrorMessage(r), details, fields: errorsByField(details) });
    }
  }
  return (
    <form noValidate onSubmit={submit} aria-label={spec.label} data-form={`finance-${kind}`} className="grid gap-4 sm:grid-cols-2">
      {spec.fields.map((f) => {
        const fid = `${id}-${f.name}`;
        const val = v[f.name];
        const set = (e: { target: { value: string } }) => setV({ ...v, [f.name]: e.target.value });
        if (f.type === "check")
          return (
            <div key={f.name} className="sm:col-span-2">
              <CheckboxField id={fid} label={f.label} checked={val === true} onChange={(e) => setV({ ...v, [f.name]: e.target.checked })} error={fieldError(f.name)} />
            </div>
          );
        if (f.type === "select") return <SelectField key={f.name} id={fid} label={f.label} options={f.options ?? []} value={String(val ?? "")} onChange={set} error={fieldError(f.name)} required={f.required} />;
        if (f.type === "area")
          return (
            <div key={f.name} className="sm:col-span-2">
              <TextAreaField id={fid} label={f.label} hint={f.hint} value={String(val ?? "")} onChange={set} error={fieldError(f.name)} required={f.required} rows={3} />
            </div>
          );
        return <TextField key={f.name} id={fid} label={f.hint ? `${f.label} - ${f.hint}` : f.label} value={String(val ?? "")} onChange={set} error={fieldError(f.name)} required={f.required} />;
      })}
      <div className="space-y-3 sm:col-span-2">
        {done && <StatusNote>{done}</StatusNote>}
        {err && <ErrorSummary id={`${id}-error`} title={err.title} messages={err.details} />}
        <DarkButton type="submit" disabled={!hydrated || pending}>
          {spec.submit}
        </DarkButton>
      </div>
    </form>
  );
}

/** 세무 감수 서명 - 읽은 초안 그대로일 때만 (updated_at이 다르면 409) */
export function SignButton({ slug, updatedAt, id }: { slug: string; updatedAt: string; id: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; details: string[] } | null>(null);
  async function sign() {
    setPending(true);
    setMsg(null);
    const r = await adminApi("POST", "/api/admin/finance", { op: "sign", slug, updated_at: updatedAt });
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setMsg({ ok: true, text: "서명했습니다 - 승인본이 추가됐습니다.", details: [] });
      router.refresh();
    } else setMsg({ ok: false, text: apiErrorMessage(r), details: apiErrorDetails(r) });
  }
  return (
    <div className="space-y-3" data-form="finance-sign">
      {msg?.ok && <StatusNote>{msg.text}</StatusNote>}
      {msg && !msg.ok && <ErrorSummary id={`${id}-error`} title={msg.text} messages={msg.details} />}
      <DarkButton type="button" disabled={!hydrated || pending} onClick={() => void sign()}>
        세무 감수 서명 (승인본 추가)
      </DarkButton>
    </div>
  );
}
