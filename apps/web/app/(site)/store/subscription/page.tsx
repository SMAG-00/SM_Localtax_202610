import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SubscriptionPage } from "@/components/site/BillingViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { getViewer } from "@/lib/server/dal";
import { getBillingRuntime } from "@/lib/server/billing/runtime";
import { getPublicPlans } from "@/lib/server/billing/plans";
import { HttpError } from "@/lib/server/http";
import { pageTitle } from "@/lib/site/hub-view";

// 디지털 구독 (/store/subscription - W10-f BIZ-04). 요청마다 그린다(공유 캐시 0). 기능 키 꺼짐·요금제 없음·판매 권리 미확인은 404.
// 결제 화면이라 AI 도우미 런처가 없고(lib/site/assistant-paths.ts) 검색에도 나오지 않는다.
export const metadata: Metadata = { title: pageTitle("디지털 구독"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SubscriptionRoute() {
  await connection();
  const plans = await getPublicPlans();
  if (plans === null) return <UnavailablePage />;
  if (plans.length === 0) notFound();
  const runtime = getBillingRuntime();
  if (!runtime) return <UnavailablePage />;
  let loggedIn = false;
  try {
    loggedIn = (await getViewer()) !== null;
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
  }
  return <SubscriptionPage plans={plans} loggedIn={loggedIn} mode={runtime.config.mode} />;
}
