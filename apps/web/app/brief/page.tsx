import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { signFillToken } from "@/lib/auth/signup-input";
import { BRIEF_MESSAGES, isBriefCode } from "@/lib/brief/input";
import { briefOpen } from "@/lib/server/auth-guard";
import { guardSecret } from "@/lib/server/env";
import { adminClient } from "@/lib/server/supabase";

// 브리핑 사전 알림 (/brief, W2-e 설계 7.5 · HOME-06) — 일반 HTML 폼(JS 없이 동작). 닫혀 있으면 404.
// 발행은 2단계라서 지금은 신청만 받는다. 동의 문구는 법률 검토본이 들어오기 전까지 사실만 적는다(정책 문구 0 — 설계 12장 #1)
export const metadata: Metadata = { title: "브리핑 알림 받기", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const openFillToken = (secret: string) => signFillToken(secret, Date.now());
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";

export default async function BriefPage({ searchParams }: Props) {
  const db = adminClient();
  const secret = guardSecret();
  if (!db || !secret || !(await briefOpen(db).catch(() => false))) notFound();
  const q = await searchParams;
  const done = q.done === "sent" || q.done === "already" ? q.done : null;
  const error = typeof q.e === "string" && isBriefCode(q.e) && q.e !== "sent" && q.e !== "already" ? q.e : null;
  const fill = openFillToken(secret);
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.wordmark.lead} <span className="text-hermes-500">·</span> 브리핑
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>BRIEFING</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">브리핑 알림 받기</h1>
        <p className="mt-3 text-[15px] text-navy-600">브리핑 발행은 아직 시작 전입니다. 이메일을 남기시면 첫 발행을 알려 드립니다.</p>
        {done ? (
          <p role="status" data-testid="brief-done" data-code={done} className="mt-6 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
            {BRIEF_MESSAGES[done]}
          </p>
        ) : (
          <form method="post" action="/api/brief" className="mt-6 space-y-4" data-testid="brief-form">
            {error && (
              <p role="alert" data-testid="brief-error" data-code={error} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
                {BRIEF_MESSAGES[error]}
              </p>
            )}
            <div>
              <label htmlFor="brief-email" className="block text-[15px] font-bold text-navy-900">이메일</label>
              <input id="brief-email" name="email" type="email" autoComplete="email" required maxLength={254} className={input} />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-[15px] text-navy-900">
              <input type="checkbox" name="agree" required className="size-5" /> 브리핑 알림 수신에 동의합니다
            </label>
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="brief-website">웹사이트</label>
              <input id="brief-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>
            <input type="hidden" name="fill" value={fill} />
            <button type="submit" className="min-h-11 w-full rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
              알림 받기
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
