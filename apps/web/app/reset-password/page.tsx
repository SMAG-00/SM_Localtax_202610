import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow, brand } from "@ltr/ui";
import { PASSWORD_PROBLEM_MESSAGES } from "@/lib/auth/password";
import { hasValidResetMark } from "@/lib/server/accounts/reset-mark";

// 새 비밀번호 정하기 (/reset-password, W2-e 설계 4.2) — 메일의 재설정 링크를 확인한 직후(15분 안)에만 폼이 보인다. 일반 HTML 폼.
export const metadata: Metadata = { title: "새 비밀번호", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const ERRORS: Record<string, string> = {
  ...PASSWORD_PROBLEM_MESSAGES,
  mismatch: "새 비밀번호 두 칸이 같지 않습니다",
  weak: "이 비밀번호는 쓸 수 없습니다 — 다른 값을 써 주세요",
};
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
const label = "block text-[15px] font-bold text-navy-900";

export default async function ResetPasswordPage({ searchParams }: Props) {
  const q = await searchParams;
  const allowed = await hasValidResetMark();
  const error = typeof q.e === "string" && Object.hasOwn(ERRORS, q.e) ? ERRORS[q.e] : null;
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.wordmark.lead} <span className="text-hermes-500">·</span> 회원
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>RESET</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">새 비밀번호</h1>
        {allowed ? (
          <form method="post" action="/api/auth/reset" className="mt-6 space-y-4">
            {error && (
              <p role="alert" data-testid="reset-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
                {error}
              </p>
            )}
            <div>
              <label htmlFor="reset-new" className={label}>새 비밀번호</label>
              <input id="reset-new" name="newPassword" type="password" autoComplete="new-password" required maxLength={1000} className={input} />
            </div>
            <div>
              <label htmlFor="reset-confirm" className={label}>새 비밀번호 확인</label>
              <input id="reset-confirm" name="newPasswordConfirm" type="password" autoComplete="new-password" required maxLength={1000} className={input} />
            </div>
            <button type="submit" className="min-h-11 w-full rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
              비밀번호 바꾸기
            </button>
          </form>
        ) : (
          <p role="alert" data-testid="reset-expired" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
            재설정 시간이 지났습니다 — 비밀번호 찾기에서 메일을 다시 받아 주세요
          </p>
        )}
      </div>
      <p className="mt-6 text-[15px]">
        <Link href="/forgot-password" prefetch={false} className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">
          비밀번호 찾기
        </Link>
      </p>
    </main>
  );
}
