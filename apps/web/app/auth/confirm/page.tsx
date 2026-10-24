import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow, brand } from "@ltr/ui";
import { CODE_MESSAGES } from "@/lib/auth/signup-input";

// 가입·재설정 확인 (/auth/confirm, W2-e 설계 4.2 · 4.3) — 버튼만 그린다. 이 화면을 여는 것(메일 보안 검사기의 링크 미리 열기 포함)으로는 토큰이 소모되지 않고,
// 버튼을 눌러 POST /api/auth/confirm으로 보낼 때 비로소 확인한다. 주소의 토큰이 다른 사이트로 새지 않게 referrer를 다른 사이트로 보내지 않는다(same-origin — no-referrer면 브라우저가 폼 POST의 Origin을 null로 보내 출처 검사에 걸린다).
// 만료 화면: 가입 링크면 [확인 메일 다시 받기](이메일 칸), 재설정 링크면 비밀번호 찾기로 돌아가는 링크
export const metadata: Metadata = { title: "메일 확인", robots: { index: false, follow: false }, referrer: "same-origin" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,200}$/;
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
const button = "mt-4 min-h-11 w-full rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400";

export default async function ConfirmPage({ searchParams }: Props) {
  const q = await searchParams;
  const type = q.type === "recovery" ? "recovery" : q.type === "magiclink" ? "magiclink" : "signup";
  const token = typeof q.token_hash === "string" && TOKEN_SHAPE.test(q.token_hash) && (q.type === "signup" || q.type === "magiclink" || q.type === "recovery") ? q.token_hash : null;
  const expired = q.error === "expired" || token === null;
  const recovery = type === "recovery";
  const resent = q.sent === "1";
  const emailError = q.e === "email";
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.productName} <span className="text-hermes-500">·</span> 회원
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>CONFIRM</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">{recovery ? "비밀번호 재설정" : "가입 확인"}</h1>
        {expired ? (
          <>
            <p role="alert" data-testid="confirm-expired" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
              링크가 만료되었습니다
            </p>
            {recovery ? (
              <p className="mt-4 text-[15px]">
                <Link href="/forgot-password" prefetch={false} className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">
                  비밀번호 재설정 메일 다시 받기
                </Link>
              </p>
            ) : resent ? (
              <p role="status" data-testid="resend-sent" className="mt-4 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
                {CODE_MESSAGES.sent}
              </p>
            ) : (
              <form method="post" action="/api/auth/resend-confirm" className="mt-4">
                {emailError && (
                  <p role="alert" data-testid="resend-error" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
                    {CODE_MESSAGES.email}
                  </p>
                )}
                <label htmlFor="resend-email" className="block text-[15px] font-bold text-navy-900">가입한 이메일</label>
                <input id="resend-email" name="email" type="email" autoComplete="username" required maxLength={254} className={input} />
                <button type="submit" className={button}>확인 메일 다시 받기</button>
              </form>
            )}
          </>
        ) : (
          <form method="post" action="/api/auth/confirm" className="mt-6">
            <input type="hidden" name="token_hash" value={token} />
            <input type="hidden" name="type" value={type} />
            <p className="text-[15px] text-navy-600">{recovery ? "아래 버튼을 눌러 새 비밀번호를 정하는 화면으로 갑니다." : "아래 버튼을 눌러 가입을 마칩니다."}</p>
            <button type="submit" className={button}>
              {recovery ? "비밀번호 재설정하기" : "가입 확인하기"}
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
