"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { errorsByField } from "@/lib/admin/project-rules";
import { DEV_METHOD_LIMITS } from "@/lib/admin/dev-method-rules";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

// 개발방법 비교 관리 폼 (W4 19단계 — PRD-01B PR-09 · PR-10 · PR-11, /admin/dev-methods). 값 검사는 서버(lib/admin/dev-method-rules.ts + DB)가 하고,
// 오류 "칸: 문장"은 그 칸 옆에 보인다(칸 이름 = 요청 칸 = DB 칸). 내용은 편집국이 공식 원문을 보고 직접 적는다 — 채워 넣는 기본값 0.
// 점수·순위·추천·등급 입력 요소는 어디에도 없다(PR-11). 서명은 세무 감수위원만(서버가 다시 판정).

type Failure = { title: string; details: string[]; fields: Record<string, string[]> } | null;

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<Failure>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function send(body: Record<string, unknown>, ok: string) {
    setError(null);
    setDone(null);
    setPending(true);
    const r = await adminApi("POST", "/api/admin/dev-methods", body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      const warnings = Array.isArray((r.body as { warnings?: unknown } | undefined)?.warnings) ? ((r.body as { warnings: string[] }).warnings) : [];
      setDone(warnings.length ? `${ok} ${warnings.map((w) => w.replace(/^[^:]+: /, "")).join(" ")}` : ok);
      router.refresh();
    } else {
      const details = apiErrorDetails(r);
      setError({ title: apiErrorMessage(r), details, fields: errorsByField(details) });
    }
  }
  const fieldError = (...names: string[]) => names.flatMap((n) => error?.fields[n] ?? []).join(" ") || undefined;
  return { error, done, pending, send, fieldError };
}

function Feedback({ id, s }: { id: string; s: ReturnType<typeof useSubmit> }) {
  return (
    <>
      {s.done && <StatusNote>{s.done}</StatusNote>}
      {s.error && <ErrorSummary id={`${id}-error`} title={s.error.title} messages={s.error.details} />}
    </>
  );
}

/** 방법 내용 — 근거 법령 이름 · 한 줄 설명 · 절차 단계(한 줄에 하나). 박스(lens)는 이 폼에서 건드리지 않고 그대로 보낸다 */
export function MethodForm({ slug, initial }: { slug: string; initial: { legal_basis_name: string; summary: string; steps: string[]; lens: unknown } }) {
  const hydrated = useHydrated();
  const s = useSubmit();
  const [f, setF] = useState({ legal_basis_name: initial.legal_basis_name, summary: initial.summary, steps: initial.steps.join("\n") });
  const p = `dm-${slug}`;
  return (
    <form
      noValidate
      aria-label={`${slug} 방법 내용`}
      data-form="dev-method"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void s.send({ op: "method", slug, legal_basis_name: f.legal_basis_name, summary: f.summary, steps: f.steps.split("\n").map((x) => x.trim()).filter(Boolean), ...(initial.lens ? { lens: initial.lens } : {}) }, "방법 내용을 저장했습니다 — 감수 서명이 있었다면 지워졌습니다(재감수 필요).");
      }}
      className="grid gap-4"
    >
      <TextField id={`${p}-legal`} label={`근거 법령 이름 (${DEV_METHOD_LIMITS.legalBasisChars}자까지)`} value={f.legal_basis_name} onChange={(e) => setF({ ...f, legal_basis_name: e.target.value })} error={s.fieldError("legal_basis_name")} />
      <TextAreaField id={`${p}-summary`} label={`한 줄 설명 (${DEV_METHOD_LIMITS.summaryChars}자까지)`} rows={2} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} error={s.fieldError("summary")} />
      <TextAreaField id={`${p}-steps`} label={`절차 단계 (한 줄에 하나, ${DEV_METHOD_LIMITS.stepsMax}개까지)`} rows={4} value={f.steps} onChange={(e) => setF({ ...f, steps: e.target.value })} error={s.fieldError("steps")} />
      <Feedback id={p} s={s} />
      <div>
        <DarkButton type="submit" disabled={!hydrated || s.pending}>
          방법 내용 저장
        </DarkButton>
      </div>
    </form>
  );
}

/** 비교 항목 한 칸 */
export function CompareForm({ slug, item, label, initial }: { slug: string; item: string; label: string; initial: string }) {
  const hydrated = useHydrated();
  const s = useSubmit();
  const [body, setBody] = useState(initial);
  const p = `dc-${slug}-${item}`;
  return (
    <form
      noValidate
      aria-label={`${slug} ${label}`}
      data-form="dev-compare"
      data-item={item}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void s.send({ op: "compare", slug, item, body }, `${label} 칸을 저장했습니다 — 감수 서명이 있었다면 지워졌습니다.`);
      }}
      className="grid gap-3"
    >
      <TextAreaField id={p} label={`${label} (${DEV_METHOD_LIMITS.bodyChars}자까지)`} rows={3} value={body} onChange={(e) => setBody(e.target.value)} error={s.fieldError("body")} />
      <Feedback id={p} s={s} />
      <div>
        <DarkButton type="submit" disabled={!hydrated || s.pending}>
          {label} 저장
        </DarkButton>
      </div>
    </form>
  );
}

export interface FactFormValues {
  fact_key: string;
  label: string;
  value: string;
  unit: string;
  law_ref: string;
  reference_date: string;
  source_url: string;
}
const EMPTY_FACT: FactFormValues = { fact_key: "", label: "", value: "", unit: "", law_ref: "", reference_date: "", source_url: "" };

/** 숫자 요건 사실 행 — supersedesId가 있으면 새 판(사유 필수, 옛 판은 그대로), 없으면 첫 판 */
export function FactForm({ slug, supersedesId, initial }: { slug: string; supersedesId?: number; initial?: FactFormValues }) {
  const hydrated = useHydrated();
  const s = useSubmit();
  const [f, setF] = useState<FactFormValues>(initial ?? EMPTY_FACT);
  const [payload, setPayload] = useState("");
  const [reason, setReason] = useState("");
  const set = (k: keyof FactFormValues) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const p = supersedesId ? `df-${slug}-${supersedesId}` : `df-${slug}-new`;
  return (
    <form
      noValidate
      aria-label={supersedesId ? `${f.label} 새 판` : `${slug} 숫자 요건 첫 판`}
      data-form={supersedesId ? "dev-fact-version" : "dev-fact-new"}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void s.send(
          { op: "fact", slug, ...f, snapshot_payload: payload, ...(supersedesId ? { supersedes_id: supersedesId, reason } : {}) },
          supersedesId ? "새 판을 저장했습니다 — 옛 판은 그대로 남고, 서명 전까지 공개 화면에 이 요건이 보이지 않습니다." : "첫 판을 저장했습니다 — 감수 서명 뒤 공개 화면에 보입니다.",
        );
      }}
      className="grid gap-4 sm:grid-cols-2"
    >
      <TextField id={`${p}-key`} label="요건 열쇠 (영문 소문자·숫자·밑줄)" value={f.fact_key} onChange={set("fact_key")} error={s.fieldError("fact_key")} readOnly={supersedesId !== undefined} required />
      <TextField id={`${p}-label`} label="요건 이름" value={f.label} onChange={set("label")} error={s.fieldError("label")} required />
      <TextField id={`${p}-value`} label="값 (공식 원문 그대로)" value={f.value} onChange={set("value")} error={s.fieldError("value")} required />
      <TextField id={`${p}-unit`} label="단위 (없으면 비움)" value={f.unit} onChange={set("unit")} error={s.fieldError("unit")} />
      <TextField id={`${p}-law`} label="근거 조문" value={f.law_ref} onChange={set("law_ref")} error={s.fieldError("law_ref")} required />
      <TextField id={`${p}-date`} label="기준일 (YYYY-MM-DD)" value={f.reference_date} onChange={set("reference_date")} error={s.fieldError("reference_date")} required />
      <div className="sm:col-span-2">
        <TextField id={`${p}-url`} label="근거 원문 주소" type="url" value={f.source_url} onChange={set("source_url")} error={s.fieldError("source_url")} required />
      </div>
      <div className="sm:col-span-2">
        <TextAreaField id={`${p}-payload`} label="근거 원문 글자 (공식 원문을 붙여 넣으면 그 해시로 원문 스냅샷을 남깁니다)" rows={3} value={payload} onChange={(e) => setPayload(e.target.value)} error={s.fieldError("snapshot_payload", "snapshot_id")} />
      </div>
      {supersedesId !== undefined && (
        <div className="sm:col-span-2">
          <TextField id={`${p}-reason`} label={`고친 사유 (${DEV_METHOD_LIMITS.reasonChars}자까지 — 새 판에는 필수)`} value={reason} onChange={(e) => setReason(e.target.value)} error={s.fieldError("reason", "supersedes_id")} required />
        </div>
      )}
      <div className="space-y-3 sm:col-span-2">
        <Feedback id={p} s={s} />
        <DarkButton type="submit" disabled={!hydrated || s.pending}>
          {supersedesId ? "새 판으로 저장" : "첫 판 저장"}
        </DarkButton>
      </div>
    </form>
  );
}

/** 세무 감수 서명 — body는 op=review 요청 그대로 (서버가 감수위원인지 다시 본다) */
export function SignButton({ body, label }: { body: Record<string, unknown>; label: string }) {
  const hydrated = useHydrated();
  const s = useSubmit();
  return (
    <div className="space-y-2" data-form="dev-sign">
      <Feedback id={`sign-${String(body.slug)}-${String(body.target)}-${String(body.item ?? body.fact_id ?? "")}`} s={s} />
      <DarkButton type="button" disabled={!hydrated || s.pending} onClick={() => void s.send({ op: "review", ...body }, "서명했습니다.")}>
        {label}
      </DarkButton>
    </div>
  );
}
