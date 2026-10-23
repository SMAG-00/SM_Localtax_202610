"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { errorsByField } from "@/lib/admin/project-rules";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

// 지자체뉴스 관리 폼·버튼 (W6 - /admin/local-news). 값 검사는 서버(lib/admin/local-news-rules.ts + DB 트리거)가 하고, 오류 "칸: 문장"은 그 칸 옆에 보인다.
// 폼 하나가 op 하나를 보낸다. 입력 칸에 채워 넣는 기본값은 없다 - 내용은 편집국이 공식 원문을 보고 적는다.

export type LnField = { name: string; label: string; type?: "text" | "area" | "select" | "check"; options?: { value: string; label: string }[]; hint?: string; required?: boolean };
type Values = Record<string, string | boolean>;

function summarize(body: Record<string, unknown>): string | null {
  const sim = body.similarity as { status?: string; max?: number | null; ratio?: number | null; matches?: unknown[] } | undefined;
  if (sim) {
    const pct = (v: number | null | undefined) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "-");
    return `유사도 검사 결과 ${sim.status} - 최고 문장 유사도 ${pct(sim.max)} · 유사 문장 비율 ${pct(sim.ratio)} · 유사 문장 ${sim.matches?.length ?? 0}개`;
  }
  return null;
}

export function OpForm({ id, op, label, submit, fields, initial, ctx = {} }: { id: string; op: string; label: string; submit: string; fields: LnField[]; initial?: Values; ctx?: Record<string, unknown> }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [v, setV] = useState<Values>(initial ?? {});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<{ title: string; details: string[]; fields: Record<string, string[]> } | null>(null);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    setErr(null);
    const body: Record<string, unknown> = { op, ...ctx };
    for (const f of fields) {
      const val = v[f.name];
      if (f.type === "check") body[f.name] = val === true;
      else if (typeof val === "string" && val.trim() !== "") body[f.name] = val.trim();
    }
    setPending(true);
    const r = await adminApi("POST", "/api/admin/local-news", body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(summarize(r.body) ?? `${label} - 저장했습니다.`);
      router.refresh();
    } else {
      const details = apiErrorDetails(r);
      setErr({ title: apiErrorMessage(r), details, fields: errorsByField(details) });
    }
  }
  return (
    <form noValidate onSubmit={onSubmit} aria-label={label} data-form={`ln-${op}`} className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const fid = `${id}-${f.name}`;
        const val = v[f.name];
        const error = err?.fields[f.name]?.join(" ");
        const set = (e: { target: { value: string } }) => setV({ ...v, [f.name]: e.target.value });
        if (f.type === "check")
          return (
            <div key={f.name} className="sm:col-span-2">
              <CheckboxField id={fid} label={f.label} checked={val === true} onChange={(e) => setV({ ...v, [f.name]: e.target.checked })} error={error} />
            </div>
          );
        if (f.type === "select") return <SelectField key={f.name} id={fid} label={f.label} options={f.options ?? []} value={String(val ?? "")} onChange={set} error={error} required={f.required} />;
        if (f.type === "area")
          return (
            <div key={f.name} className="sm:col-span-2">
              <TextAreaField id={fid} label={f.label} hint={f.hint} value={String(val ?? "")} onChange={set} error={error} required={f.required} rows={3} />
            </div>
          );
        return <TextField key={f.name} id={fid} label={f.hint ? `${f.label} - ${f.hint}` : f.label} value={String(val ?? "")} onChange={set} error={error} required={f.required} />;
      })}
      <div className="space-y-3 sm:col-span-2">
        {done && <StatusNote>{done}</StatusNote>}
        {err && <ErrorSummary id={`${id}-error`} title={err.title} messages={err.details} />}
        <DarkButton type="submit" disabled={!hydrated || pending}>
          {submit}
        </DarkButton>
      </div>
    </form>
  );
}

/** 폼 없이 op 하나를 보내는 버튼 (유사도 검사·기획 전환·발행·내리기 등) */
export function OpButton({ id, op, label, ctx, tone = "dark" }: { id: string; op: string; label: string; ctx: Record<string, unknown>; tone?: "dark" }) {
  void tone;
  const hydrated = useHydrated();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; details: string[] } | null>(null);
  async function run() {
    setPending(true);
    setMsg(null);
    const r = await adminApi("POST", "/api/admin/local-news", { op, ...ctx });
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setMsg({ ok: true, text: summarize(r.body) ?? `${label} - 완료했습니다.`, details: [] });
      router.refresh();
    } else setMsg({ ok: false, text: apiErrorMessage(r), details: apiErrorDetails(r) });
  }
  return (
    <div className="space-y-2" data-form={`ln-${op}`} data-op-button={op}>
      {msg?.ok && <StatusNote>{msg.text}</StatusNote>}
      {msg && !msg.ok && <ErrorSummary id={`${id}-error`} title={msg.text} messages={msg.details} />}
      <DarkButton type="button" disabled={!hydrated || pending} onClick={() => void run()}>
        {label}
      </DarkButton>
    </div>
  );
}
