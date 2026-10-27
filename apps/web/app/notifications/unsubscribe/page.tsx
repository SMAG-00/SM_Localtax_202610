import type { Metadata } from "next";
import Link from "next/link";

// 알림 수신 거부 (W13-d) - 버튼을 눌러야 거부한다. 토큰 검증은 POST 경로가 한다.
export const metadata: Metadata = { title: "알림 수신 거부", robots: { index: false, follow: false }, referrer: "same-origin" };
export const dynamic = "force-dynamic";

export default async function NotifyUnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const done = q.done === "1";
  const token = typeof q.token === "string" && /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(q.token) ? q.token : null;
  const expired = !done && (q.error === "expired" || token === null);
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-[28px] font-black text-navy-900">알림 수신 거부</h1>
      {done ? (
        <p role="status" data-testid="notify-unsubscribed" className="mt-6 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
          알림을 모두 껐습니다
        </p>
      ) : expired ? (
        <p role="alert" data-testid="notify-expired" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
          링크가 만료되었습니다
        </p>
      ) : (
        <form method="post" action="/api/notifications/unsubscribe" className="mt-6">
          <input type="hidden" name="token" value={token ?? ""} />
          <p className="text-[15px] text-navy-600">아래 버튼을 누르면 모든 알림이 꺼집니다. 다시 켜려면 알림 설정에서 고르세요.</p>
          <button type="submit" className="mt-4 min-h-11 w-full rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
            알림 모두 끄기
          </button>
        </form>
      )}
      <p className="mt-6 text-[15px]">
        <Link href="/" prefetch={false} className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">
          홈으로
        </Link>
      </p>
    </main>
  );
}
