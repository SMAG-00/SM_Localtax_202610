import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { RECOVERY_SENT } from "@/lib/auth/recovery";
import { CODE_MESSAGES } from "@/lib/auth/signup-input";
import { memberAuthOpen } from "@/lib/server/auth-guard";
import { adminClient } from "@/lib/server/supabase";

// 비밀번호 찾기 (/forgot-password, W2-e 설계 4.2) — 일반 HTML 폼. 닫혀 있으면(가입과 같은 열림 조건) 404. 응답 문장은 계정 유무와 상관없이 같다.
export const metadata: Metadata = { title: "비밀번호 찾기", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
const label = "block text-[15px] font-bold text-navy-900";

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const db = adminClient();
  if (!db || !(await memberAuthOpen(db).catch(() => false))) notFound();
  const q = await searchParams;
  const sent = q.sent === "1";
  const error = q.e === "email" ? CODE_MESSAGES.email : q.e === "too_many" ? CODE_MESSAGES.too_many : null;
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.productName} <span className="text-hermes-500">·</span> 회원
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>FORGOT</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">비밀번호 찾기</h1>
        {sent ? (
          <p role="status" data-testid="forgot-sent" className="mt-6 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
            {RECOVERY_SENT}
          </p>
        ) : (
          <form method="post" action="/api/auth/forgot" className="mt-6 space-y-4">
            {error && (
              <p role="alert" data-testid="forgot-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
                {error}
              </p>
            )}
            <div>
              <label htmlFor="forgot-email" className={label}>가입한 이메일</label>
              <input id="forgot-email" name="email" type="email" autoComplete="username" required maxLength={254} className={input} />
            </div>
            <button type="submit" className="min-h-11 w-full rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
              재설정 메일 받기
            </button>
          </form>
        )}
      </div>
      <p className="mt-6 text-[15px]">
        <Link href="/login" prefetch={false} className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">
          로그인 화면으로
        </Link>
      </p>
    </main>
  );
}
