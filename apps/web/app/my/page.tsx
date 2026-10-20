import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { getViewer } from "@/lib/server/dal";

// 내 화면 (/my) — 3단계에서 맞춤 화면으로 채운다. 지금은 로그인 상태와 가입 확인 완료 안내만 보인다.
export const metadata: Metadata = { title: "내 화면", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MyPage({ searchParams }: Props) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(`/login?next=${encodeURIComponent("/my")}`);
  const welcome = (await searchParams).welcome === "1";
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.wordmark.lead} <span className="text-hermes-500">·</span> 내 화면
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>MY</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">내 화면</h1>
        {welcome && (
          <p role="status" data-testid="my-welcome" className="mt-4 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
            가입이 완료되었습니다
          </p>
        )}
        <p className="mt-4 text-[15px] text-navy-600">
          로그인한 계정: <span data-testid="my-email" className="[overflow-wrap:anywhere]">{viewer.email ?? "이메일 없음"}</span>
        </p>
      </div>
    </main>
  );
}
