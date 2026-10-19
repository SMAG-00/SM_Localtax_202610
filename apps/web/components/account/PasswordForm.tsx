"use client";

import { useState, type FormEvent } from "react";
import { PrimaryButton, TextField } from "@ltr/ui";
import { useHydrated } from "@/components/admin/useHydrated";
import { adminApi, apiErrorMessage } from "@/lib/admin/api-client";
import { checkPassword, type PasswordRules } from "@/lib/auth/password";

type Field = "currentPassword" | "newPassword" | "newPasswordConfirm";
const FIELDS: readonly Field[] = ["currentPassword", "newPassword", "newPasswordConfirm"];

/**
 * 비밀번호 바꾸기 폼 — 현재 비밀번호 + 새 비밀번호 두 번. 입력 중 안내는 서버와 같은 규칙(lib/auth/password.ts)이고, 판정은 서버가 한다.
 * 서버가 칸을 짚어 돌려주는 문장(field)은 그 칸 옆에, 그 밖의 실패는 위쪽 알림에 보인다.
 */
export function PasswordForm({ email, rules }: { email: string; rules: PasswordRules | null }) {
  const hydrated = useHydrated();
  const [values, setValues] = useState<Record<Field, string>>({ currentPassword: "", newPassword: "", newPasswordConfirm: "" });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  const set = (field: Field) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [field]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    setFailure("");
    const next: Partial<Record<Field, string>> = {};
    if (values.currentPassword === "") next.currentPassword = "현재 비밀번호를 넣어 주세요";
    if (values.newPassword === "") next.newPassword = "새 비밀번호를 넣어 주세요";
    else if (rules) {
      const rule = checkPassword(values.newPassword, email, rules);
      if (!rule.ok) next.newPassword = rule.message;
    }
    if (values.newPasswordConfirm === "") next.newPasswordConfirm = "새 비밀번호를 한 번 더 넣어 주세요";
    else if (values.newPassword !== values.newPasswordConfirm) next.newPasswordConfirm = "새 비밀번호 두 칸이 같지 않습니다";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    const r = await adminApi("POST", "/api/auth/password", values);
    setPending(false);
    if (r.status === 200) {
      setValues({ currentPassword: "", newPassword: "", newPasswordConfirm: "" });
      setDone(true);
      return;
    }
    const field = r.body.field;
    if (r.status === 422 && typeof field === "string" && (FIELDS as readonly string[]).includes(field) && typeof r.body.error === "string") {
      setErrors({ [field as Field]: r.body.error });
      return;
    }
    // 429(시도 많음)·401(로그인 끝남)·그 밖 — 서버 문장 그대로
    setFailure(apiErrorMessage(r));
  }

  return (
    <form onSubmit={submit} noValidate aria-describedby={failure ? "password-failure" : undefined} className="mt-6 space-y-4">
      <TextField
        id="current-password"
        label="현재 비밀번호"
        type="password"
        autoComplete="current-password"
        required
        value={values.currentPassword}
        onChange={set("currentPassword")}
        error={errors.currentPassword}
      />
      <TextField
        id="new-password"
        label="새 비밀번호"
        type="password"
        autoComplete="new-password"
        required
        hint={rules ? `${rules.minChars}글자 이상, ${rules.maxBytes}바이트 이하 (한글은 글자당 3바이트)` : undefined}
        value={values.newPassword}
        onChange={set("newPassword")}
        error={errors.newPassword}
      />
      <TextField
        id="new-password-confirm"
        label="새 비밀번호 확인"
        type="password"
        autoComplete="new-password"
        required
        value={values.newPasswordConfirm}
        onChange={set("newPasswordConfirm")}
        error={errors.newPasswordConfirm}
      />
      {failure && (
        <p id="password-failure" role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
          {failure}
        </p>
      )}
      {done && (
        <p id="password-done" role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[15px] font-bold text-emerald-800">
          비밀번호를 바꿨습니다. 다른 기기에서는 로그아웃됩니다.
        </p>
      )}
      <PrimaryButton type="submit" disabled={pending || !hydrated} className="w-full">
        {pending ? "바꾸는 중" : "비밀번호 바꾸기"}
      </PrimaryButton>
    </form>
  );
}
