import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { SubscriptionCompletePage } from "@/components/site/BillingViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { getViewer } from "@/lib/server/dal";
import { getBillingRuntime } from "@/lib/server/billing/runtime";
import { completeCheckout } from "@/lib/server/billing/service";
import { HttpError } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";
import { pageTitle } from "@/lib/site/hub-view";

// 결제 복귀 (/store/subscription/complete - W10-f PAY-02). 주소의 값 중 서버가 쓰는 것은 orderNo와 PG 인증 문자열(authKey·paymentKey)뿐이다.
// 상태·금액·성공 여부 쿼리는 읽지 않는다 - 서버가 PG에 승인/빌링 결제를 요청하고 다시 조회한 결과로만 구독을 시작한다 (복귀 주소 값만으로 권한 0).
export const metadata: Metadata = { title: pageTitle("구독 결제 확인"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function CompleteRoute({ searchParams }: Props) {
  await connection();
  const q = await searchParams;
  const orderNo = one(q.orderNo);
  if (!orderNo || !/^[A-Za-z0-9_-]{8,64}$/.test(orderNo)) notFound();
  const runtime = getBillingRuntime();
  const db = adminClient();
  if (!runtime || !db) return <UnavailablePage />;
  const viewer = await getViewer().catch((err: unknown) => {
    if (err instanceof HttpError) return null;
    throw err;
  });
  if (!viewer) redirect(`/login?next=${encodeURIComponent("/store/subscription")}`);
  let status = "failed";
  try {
    status = (await completeCheckout(db, runtime.adapter, runtime.config, viewer.userId, { orderNo, authKey: one(q.authKey), paymentKey: one(q.paymentKey) })).orderStatus;
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
  }
  return <SubscriptionCompletePage orderStatus={status} />;
}
