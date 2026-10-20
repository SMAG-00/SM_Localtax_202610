import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { CODE_MESSAGES, isSignupCode, signFillToken } from "@/lib/auth/signup-input";
import { signupOpen } from "@/lib/server/auth-guard";
import { guardSecret } from "@/lib/server/env";
import { NEWS_TAB_LABELS, SECTION_KEYS } from "@/lib/server/public/constants";
import { adminClient } from "@/lib/server/supabase";

// 회원 가입 (/signup, W2-e 설계 4.3 · 5.1) — 일반 HTML 폼(JS 없이 동작). 가입이 닫혀 있으면 404(링크도 어디에도 두지 않는다).
// 관심 지역 선택·선택 동의(수신·마케팅)는 3단계 /my에서 받는다 — 가입 동의와 수신 동의는 분리(ACC-02)
export const metadata: Metadata = { title: "회원 가입", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
/** 폼을 연 시각으로 토큰을 만든다 (렌더 함수 밖에서 시계를 읽는다) */
const openFillToken = (secret: string) => signFillToken(secret, Date.now());
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
const label = "block text-[15px] font-bold text-navy-900";

export default async function SignupPage({ searchParams }: Props) {
  const db = adminClient();
  const secret = guardSecret();
  if (!db || !secret || !(await signupOpen(db).catch(() => false))) notFound();
  const q = await searchParams;
  const sent = q.sent === "1";
  const code = typeof q.e === "string" && isSignupCode(q.e) && q.e !== "sent" ? q.e : null;
  const fill = openFillToken(secret);
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.wordmark.lead} <span className="text-hermes-500">·</span> 회원
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>SIGN UP</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">회원 가입</h1>
        {sent ? (
          <p role="status" data-testid="signup-sent" className="mt-6 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
            {CODE_MESSAGES.sent}
          </p>
        ) : (
          <form method="post" action="/api/auth/signup" className="mt-6 space-y-4">
            {code && (
              <p role="alert" data-testid="signup-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
                {CODE_MESSAGES[code]}
              </p>
            )}
            <div>
              <label htmlFor="signup-email" className={label}>이메일</label>
              <input id="signup-email" name="email" type="email" autoComplete="username" required maxLength={254} className={input} />
            </div>
            <div>
              <label htmlFor="signup-password" className={label}>비밀번호</label>
              <input id="signup-password" name="password" type="password" autoComplete="new-password" required maxLength={1000} aria-describedby="signup-password-help" className={input} />
              <p id="signup-password-help" className="mt-1 text-[14px] text-navy-600">10글자 이상. 흔한 비밀번호와 이메일을 그대로 쓴 비밀번호는 쓸 수 없습니다.</p>
            </div>
            <div>
              <label htmlFor="signup-name" className={label}>표시 이름 (선택)</label>
              <input id="signup-name" name="displayName" type="text" autoComplete="nickname" maxLength={60} className={input} />
            </div>
            <fieldset>
              <legend className={label}>관심 분야 (선택)</legend>
              {SECTION_KEYS.map((key) => (
                <label key={key} className="mt-1 flex min-h-11 items-center gap-2 text-[15px] text-navy-900">
                  <input type="checkbox" name="interests" value={key} className="size-5" /> {NEWS_TAB_LABELS[key]}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend className={label}>필수 동의</legend>
              <label className="mt-1 flex min-h-11 items-center gap-2 text-[15px] text-navy-900">
                <input type="checkbox" name="agreeTerms" required className="size-5" /> 이용약관에 동의합니다
              </label>
              <label className="flex min-h-11 items-center gap-2 text-[15px] text-navy-900">
                <input type="checkbox" name="agreePrivacy" required className="size-5" /> 개인정보 수집·이용에 동의합니다
              </label>
            </fieldset>
            {/* 사람에게는 보이지 않는 칸 — 채워지면 거부 */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="signup-website">웹사이트</label>
              <input id="signup-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>
            <input type="hidden" name="fill" value={fill} />
            <button type="submit" className="min-h-11 w-full rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
              가입하기
            </button>
          </form>
        )}
      </div>
      <p className="mt-6 text-[15px]">
        이미 계정이 있으신가요?{" "}
        <Link href="/login" prefetch={false} className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">
          로그인
        </Link>
      </p>
    </main>
  );
}
