import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { TOKEN_SHAPE } from "@/lib/brief/input";
import { briefOpen } from "@/lib/server/auth-guard";
import { adminClient } from "@/lib/server/supabase";

// 브리핑 사전 알림 확인 (/brief/confirm, W2-e 설계 7.5) — 버튼만 그린다. 이 화면을 여는 것(메일 보안 검사기의 링크 미리 열기 포함)으로는 확정되지 않고,
// 버튼을 눌러 POST /api/brief/confirm으로 보낼 때 확정한다. 주소의 토큰이 새지 않게 referrer는 같은 사이트로만 보낸다(폼 POST의 Origin 검사 때문에 no-referrer는 쓰지 않는다)
export const metadata: Metadata = { title: "브리핑 알림 신청 확인", robots: { index: false, follow: false }, referrer: "same-origin" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BriefConfirmPage({ searchParams }: Props) {
  const db = adminClient();
  if (!db || !(await briefOpen(db).catch(() => false))) notFound();
  const q = await searchParams;
  const done = q.done === "1";
  const token = typeof q.token === "string" && TOKEN_SHAPE.test(q.token) ? q.token : null;
  const expired = !done && (q.error === "expired" || token === null);
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.wordmark.lead} <span className="text-hermes-500">·</span> 브리핑
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>CONFIRM</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">브리핑 알림 신청 확인</h1>
        {done ? (
          <p role="status" data-testid="brief-confirmed" className="mt-6 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
            신청이 확정되었습니다
          </p>
        ) : expired ? (
          <p role="alert" data-testid="brief-expired" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
            링크가 만료되었습니다
          </p>
        ) : (
          <form method="post" action="/api/brief/confirm" className="mt-6">
            <input type="hidden" name="token" value={token ?? ""} />
            <p className="text-[15px] text-navy-600">아래 버튼을 눌러 신청을 마칩니다.</p>
            <button type="submit" className="mt-4 min-h-11 w-full rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
              신청 확정하기
            </button>
          </form>
        )}
      </div>
      <p className="mt-6 text-[15px]">
        <Link href="/" prefetch={false} className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">
          홈으로
        </Link>
      </p>
    </main>
  );
}
