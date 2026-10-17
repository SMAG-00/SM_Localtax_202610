"use client";

import { useState, type FormEvent } from "react";
import { PrimaryButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorMessage } from "@/lib/admin/api-client";
import { blank } from "@/lib/admin/form-utils";
import { useHydrated } from "./useHydrated";

/** 로그인 폼 — 실패하면 어느 칸이 틀렸는지 말하지 않는 같은 문장 하나 (서버가 정한다) */
export function LoginForm({ next }: { next: string }) {
  const hydrated = useHydrated();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const fieldErrors = { ...(blank(email) ? { email: "이메일을 넣어 주세요" } : {}), ...(password === "" ? { password: "비밀번호를 넣어 주세요" } : {}) };
    setErrors(fieldErrors);
    setFailure("");
    if (Object.keys(fieldErrors).length > 0) return;
    setPending(true);
    const r = await adminApi("POST", "/api/auth/login", { email, password });
    if (r.status === 200) {
      window.location.assign(next);
      return;
    }
    setPending(false);
    // 로그인 API의 401은 '세션 끝남'이 아니라 '이메일·비밀번호가 맞지 않음' — 서버의 같은 문장을 그대로 보인다
    setFailure(r.status === 401 && typeof r.body.error === "string" ? r.body.error : apiErrorMessage(r));
  }

  return (
    <form onSubmit={submit} noValidate aria-describedby={failure ? "login-failure" : undefined} className="mt-6 space-y-4">
      <TextField
        id="login-email"
        label="이메일"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />
      <TextField
        id="login-password"
        label="비밀번호"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
      />
      {failure && (
        <p id="login-failure" role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
          {failure}
        </p>
      )}
      <PrimaryButton type="submit" disabled={pending || !hydrated} className="w-full">
        {pending ? "확인 중" : "로그인"}
      </PrimaryButton>
    </form>
  );
}
