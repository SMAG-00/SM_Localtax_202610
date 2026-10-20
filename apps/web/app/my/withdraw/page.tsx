import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { WITHDRAW_BLOCKED, withdrawBlocked } from "@/lib/auth/recovery";
import { TOO_MANY } from "@/lib/server/auth-guard";
import { getViewer } from "@/lib/server/dal";

// 탈퇴 (/my/withdraw, W2-e 설계 9.3) — 현재 비밀번호를 다시 넣는 일반 HTML 폼. 편집국 역할·관리자 계정은 폼 대신 안내만 보인다.
export const metadata: Metadata = { title: "탈퇴", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function WithdrawPage({ searchParams }: Props) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(`/login?next=${encodeURIComponent("/my/withdraw")}`);
  const q = await searchParams;
  const error = q.e === "wrong" ? "현재 비밀번호가 맞지 않습니다" : q.e === "too_many" ? TOO_MANY : null;
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.wordmark.lead} <span className="text-hermes-500">·</span> 내 화면
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>WITHDRAW</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">탈퇴</h1>
        {withdrawBlocked(viewer) ? (
          <p role="alert" data-testid="withdraw-blocked" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
            {WITHDRAW_BLOCKED}
          </p>
        ) : (
          <form method="post" action="/api/auth/withdraw" className="mt-6 space-y-4">
            <p className="text-[15px] text-navy-600">탈퇴하면 계정, 프로필, 관심 분야와 동의 기록이 바로 지워지며 되돌릴 수 없습니다.</p>
            {error && (
              <p role="alert" data-testid="withdraw-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
                {error}
              </p>
            )}
            <div>
              <label htmlFor="withdraw-password" className="block text-[15px] font-bold text-navy-900">현재 비밀번호</label>
              <input id="withdraw-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={1000} className="mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900" />
            </div>
            <button type="submit" className="min-h-11 w-full rounded-xl bg-rose-700 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
              탈퇴하기
            </button>
          </form>
        )}
      </div>
      <p className="mt-6 text-[15px]">
        <Link href="/my" prefetch={false} className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">
          내 화면으로
        </Link>
      </p>
    </main>
  );
}
