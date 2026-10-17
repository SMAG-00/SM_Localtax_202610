import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/**
 * 폼 요소 (PRD-00 8.6) — 입력창 · 선택 목록 · 체크박스 · 라디오. 네 가지 모두 루트에 data-ui="form-field".
 *  - 입력창: rounded-xl navy-200 테두리 흰 바탕 17px, 높이 48px 이상, 포커스 오렌지 2px
 *  - 라벨은 입력창 위 15px 700 — 자리표시 글자로 라벨을 대신하지 않는다 (label은 필수 값)
 *  - 체크박스·라디오는 24px, 선택 시 navy-900
 *  - 오류는 입력창 아래 rose-700 14px 문장 + aria-describedby · 필수 표시는 글자 "(필수)"
 * id는 쓰는 쪽이 정한다 — 도움말·오류의 id는 `${id}-hint`·`${id}-error`.
 */

const CONTROL =
  "block min-h-12 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-[17px] text-navy-900 placeholder:text-navy-400 focus:outline-2 focus:outline-offset-2 focus:outline-hermes-500 disabled:cursor-not-allowed disabled:bg-navy-50";
const LABEL = "block text-[15px] font-bold text-navy-900";
const CHOICE = "size-[24px] shrink-0 accent-navy-900 focus:outline-2 focus:outline-offset-2 focus:outline-hermes-500";
const CHOICE_ROW = "flex min-h-11 cursor-pointer items-center gap-3 text-[17px] text-navy-900";

type Messages = { hint?: string; error?: string };

function describe(id: string, { hint, error }: Messages) {
  const ids = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
  return ids || undefined;
}

function Required({ on }: { on?: boolean }) {
  return on ? (
    <>
      {" "}
      <span className="font-semibold text-navy-600">(필수)</span>
    </>
  ) : null;
}

function Hint({ id, hint }: { id: string; hint?: string }) {
  return hint ? (
    <p id={`${id}-hint`} className="text-[14px] text-navy-600">
      {hint}
    </p>
  ) : null;
}

function ErrorText({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={`${id}-error`} className="text-[14px] text-rose-700">
      {error}
    </p>
  ) : null;
}

type FieldBase = { id: string; label: string; required?: boolean; hint?: string; error?: string };

export type TextFieldProps = FieldBase & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "required" | "aria-describedby" | "aria-invalid" | "children">;

/** 입력창 */
export function TextField({ id, label, required, hint, error, type = "text", ...rest }: TextFieldProps) {
  return (
    <div data-ui="form-field" data-field="text" className="space-y-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
        <Required on={required} />
      </label>
      <Hint id={id} hint={hint} />
      <input id={id} type={type} required={required} aria-invalid={error ? true : undefined} aria-describedby={describe(id, { hint, error })} className={CONTROL} {...rest} />
      <ErrorText id={id} error={error} />
    </div>
  );
}

export type SelectFieldOption = { value: string; label: string };
export type SelectFieldProps = FieldBase & {
  options: readonly SelectFieldOption[];
  /** 맨 앞의 빈 값 선택지 글자 (예: 선택해 주세요) */
  placeholder?: string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className" | "required" | "aria-describedby" | "aria-invalid" | "children">;

/** 선택 목록 — 입력창과 같은 형태 */
export function SelectField({ id, label, required, hint, error, options, placeholder, ...rest }: SelectFieldProps) {
  return (
    <div data-ui="form-field" data-field="select" className="space-y-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
        <Required on={required} />
      </label>
      <Hint id={id} hint={hint} />
      <select id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={describe(id, { hint, error })} className={CONTROL} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ErrorText id={id} error={error} />
    </div>
  );
}

export type CheckboxFieldProps = FieldBase & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "className" | "required" | "aria-describedby" | "aria-invalid" | "children">;

/** 체크박스 — 라벨 줄 전체가 누르는 자리(44px 이상). 필수 동의도 기본은 해제 상태로 둔다 */
export function CheckboxField({ id, label, required, hint, error, ...rest }: CheckboxFieldProps) {
  return (
    <div data-ui="form-field" data-field="checkbox" className="space-y-1">
      <label htmlFor={id} className={CHOICE_ROW}>
        <input id={id} type="checkbox" required={required} aria-invalid={error ? true : undefined} aria-describedby={describe(id, { hint, error })} className={CHOICE} {...rest} />
        <span>
          <span>{label}</span>
          <Required on={required} />
        </span>
      </label>
      <Hint id={id} hint={hint} />
      <ErrorText id={id} error={error} />
    </div>
  );
}

export type RadioFieldOption = { value: string; label: ReactNode };
export type RadioFieldProps = {
  /** 묶음 id — 라디오는 `${id}-0`, `${id}-1` … */
  id: string;
  name: string;
  legend: string;
  options: readonly RadioFieldOption[];
  required?: boolean;
  hint?: string;
  error?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
};

/** 라디오 묶음 — fieldset·legend(라벨과 같은 15px 700) */
export function RadioField({ id, name, legend, options, required, hint, error, defaultValue, value, onChange, disabled }: RadioFieldProps) {
  return (
    <fieldset data-ui="form-field" data-field="radio" aria-describedby={describe(id, { hint, error })} disabled={disabled} className="space-y-1.5">
      <legend className={LABEL}>
        {legend}
        <Required on={required} />
      </legend>
      <Hint id={id} hint={hint} />
      <div className="space-y-1">
        {options.map((o, i) => (
          <label key={o.value} htmlFor={`${id}-${i}`} className={CHOICE_ROW}>
            <input
              id={`${id}-${i}`}
              type="radio"
              name={name}
              value={o.value}
              required={required}
              {...(value !== undefined ? { checked: value === o.value } : { defaultChecked: defaultValue === o.value })}
              onChange={onChange ? (e) => e.target.checked && onChange(o.value) : undefined}
              className={CHOICE}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <ErrorText id={id} error={error} />
    </fieldset>
  );
}
