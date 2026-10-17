// 백오피스 폼 조각 — packages/ui 폼 요소(TextField·SelectField·CheckboxField)와 같은 모양의 여러 줄 입력창, 오류 요약, 상태 알림.
// 라벨은 늘 보이고(자리표시 글자로 대신하지 않는다), 오류 문장은 aria-describedby로 칸에 잇는다 (PRD-00 8.6 · 8.9).
import type { ReactNode, TextareaHTMLAttributes } from "react";

const CONTROL =
  "block min-h-24 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-[17px] text-navy-900 placeholder:text-navy-400 focus:outline-2 focus:outline-offset-2 focus:outline-hermes-500 disabled:cursor-not-allowed disabled:bg-navy-50";

export type TextAreaFieldProps = {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className" | "required" | "aria-describedby" | "aria-invalid" | "children">;

/** 여러 줄 입력창 */
export function TextAreaField({ id, label, required, hint, error, rows = 3, ...rest }: TextAreaFieldProps) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div data-field="textarea" className="space-y-1.5">
      <label htmlFor={id} className="block text-[15px] font-bold text-navy-900">
        {label}
        {required && <span className="font-semibold text-navy-600"> (필수)</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-[14px] text-navy-600">
          {hint}
        </p>
      )}
      <textarea id={id} rows={rows} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={CONTROL} {...rest} />
      {error && (
        <p id={`${id}-error`} className="text-[14px] text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** 칸에 붙지 않는 오류(묶음 칸·서버 오류) — 칸 id를 주면 그 칸 오류와 같은 id 규칙 */
export function FieldErrorText({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={`${id}-error`} className="text-[14px] text-rose-700">
      {error}
    </p>
  ) : null;
}

/** 저장 실패 요약 — role=alert (화면 읽기가 바로 읽는다) */
export function ErrorSummary({ id, title, messages }: { id?: string; title: string; messages: readonly string[] }) {
  if (messages.length === 0 && !title) return null;
  return (
    <div id={id} role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] text-rose-800">
      <p className="font-bold">{title}</p>
      {messages.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {messages.map((m, i) => (
            <li key={`${i}-${m}`} className="[overflow-wrap:anywhere]">
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 처리 결과 알림 — role=status (polite) */
export function StatusNote({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[15px] font-bold text-emerald-800">
      {children}
    </p>
  );
}

/** 칸 묶음 (fieldset + legend) */
export function FieldGroup({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-3 rounded-xl border border-navy-100 p-4">
      <legend className="px-1 text-[15px] font-black text-navy-900">{legend}</legend>
      {hint && <p className="text-[14px] text-navy-600">{hint}</p>}
      {children}
    </fieldset>
  );
}
