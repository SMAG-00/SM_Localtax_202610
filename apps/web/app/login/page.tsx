import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { memberNextPath } from "@/lib/auth/member-next";
import { memberAuthOpen } from "@/lib/server/auth-guard";
import { getViewer } from "@/lib/server/dal";
import { adminClient } from "@/lib/server/supabase";

// 회원 로그인 (/login, W2-e 설계 4.4) — 일반 HTML 폼(JS 없이 동작) → POST /api/auth/login(편집국 /admin/login과 같은 API). 이미 로그인했으면 next로 보낸다.
export const metadata: Metadata = { title: "로그인", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const MESSAGES: Record<string, string> = {
  failed: "이메일 또는 비밀번호가 맞지 않습니다",
  too_many: "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요",
  unavailable: "지금은 로그인을 처리할 수 없습니다 — 잠시 뒤 다시 시도해 주세요",
};
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
const label = "block text-[15px] font-bold text-navy-900";

export default async function MemberLoginPage({ searchParams }: Props) {
  const q = await searchParams;
  const next = memberNextPath(q.next);
  const viewer = await getViewer().catch(() => null);
  if (viewer) redirect(next);
  const error = typeof q.e === "string" && Object.hasOwn(MESSAGES, q.e) ? MESSAGES[q.e] : null;
  const notice = q.reset === "1" ? "비밀번호를 바꿨습니다 — 새 비밀번호로 로그인해 주세요" : q.withdrawn === "1" ? "탈퇴가 완료되었습니다" : null;
  const db = adminClient();
  const canReset = db ? await memberAuthOpen(db).catch(() => false) : false;
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.productName} <span className="text-hermes-500">·</span> 회원
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>LOGIN</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">로그인</h1>
        <form method="post" action="/api/auth/login" className="mt-6 space-y-4">
          {notice && (
            <p role="status" data-testid="login-notice" className="rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" data-testid="login-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
              {error}
            </p>
          )}
          <div>
            <label htmlFor="member-email" className={label}>이메일</label>
            <input id="member-email" name="email" type="email" autoComplete="username" required className={input} />
          </div>
          <div>
            <label htmlFor="member-password" className={label}>비밀번호</label>
            <input id="member-password" name="password" type="password" autoComplete="current-password" required className={input} />
          </div>
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="min-h-11 w-full rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
            로그인
          </button>
        </form>
        {canReset && (
          <p className="mt-4 text-[15px]">
            <Link href="/forgot-password" prefetch={false} className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">
              비밀번호를 잊으셨나요?
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
