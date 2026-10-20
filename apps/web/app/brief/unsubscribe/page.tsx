import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { TOKEN_SHAPE } from "@/lib/brief/input";
import { briefOpen } from "@/lib/server/auth-guard";
import { adminClient } from "@/lib/server/supabase";

// 브리핑 사전 알림 철회 (/brief/unsubscribe, W2-e 설계 7.5) — 버튼을 눌러야 철회한다(링크를 미리 열어도 철회되지 않는다)
export const metadata: Metadata = { title: "브리핑 알림 철회", robots: { index: false, follow: false }, referrer: "same-origin" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BriefUnsubscribePage({ searchParams }: Props) {
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
        <Eyebrow>UNSUBSCRIBE</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">브리핑 알림 철회</h1>
        {done ? (
          <p role="status" data-testid="brief-unsubscribed" className="mt-6 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
            신청을 철회했습니다
          </p>
        ) : expired ? (
          <p role="alert" data-testid="brief-expired" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
            링크가 만료되었습니다
          </p>
        ) : (
          <form method="post" action="/api/brief/unsubscribe" className="mt-6">
            <input type="hidden" name="token" value={token ?? ""} />
            <p className="text-[15px] text-navy-600">아래 버튼을 누르면 브리핑 알림 신청이 철회됩니다.</p>
            <button type="submit" className="mt-4 min-h-11 w-full rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
              신청 철회하기
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
