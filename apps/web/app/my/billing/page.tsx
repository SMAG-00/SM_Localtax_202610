import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow } from "@ltr/ui";
import { CancelSubscriptionButton } from "@/components/site/CancelSubscriptionButton";
import { MyBillingPanel, TestModeBanner } from "@/components/site/BillingViews";
import { getViewer } from "@/lib/server/dal";
import { getBillingRuntime } from "@/lib/server/billing/runtime";
import { loadMyBilling } from "@/lib/server/billing/service";
import { HttpError } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 내 구독·결제 관리 (/my/billing - W10-f PAY-05). 본인 것만, 캐시 없음, 검색에 안 나옴, AI 도우미 런처 없음(내 화면은 공개 틀 밖).
export const metadata: Metadata = { title: "내 구독·결제", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MyBillingRoute() {
  const viewer = await getViewer().catch((err: unknown) => {
    if (err instanceof HttpError) return null;
    throw err;
  });
  if (!viewer) redirect("/login?next=/my/billing");
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const data = await loadMyBilling(db, viewer.userId);
  const mode = getBillingRuntime()?.config.mode ?? "test";
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-16">
      <Eyebrow>BILLING</Eyebrow>
      <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900">내 구독·결제</h1>
      <div className="mt-6">
        <TestModeBanner mode={mode} />
      </div>
      <div className="mt-8">
        <MyBillingPanel data={data} cancelSlot={data.subscription ? <CancelSubscriptionButton subscriptionId={data.subscription.id} /> : null} />
      </div>
      <p className="mt-10">
        <Link href="/my" className="inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4">
          내 화면으로
        </Link>
      </p>
    </main>
  );
}
