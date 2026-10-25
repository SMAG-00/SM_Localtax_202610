import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { QuotePageView } from "@/components/site/EducationViews";
import type { SearchParams } from "@/components/site/routes";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getQuoteForm } from "@/lib/server/public/education";
import { pageTitle, queryValue } from "@/lib/site/hub-view";

// 위탁교육 견적 요청 양식 (/edu/quote - W10-g BIZ-06). 기능 키 education_billing 꺼짐·정책 승인 전은 404. 개인 정보가 들어가는 화면이라 색인하지 않고, 결제 정보 칸은 없다.
export const metadata: Metadata = { title: pageTitle("위탁교육 견적 요청"), robots: { index: false, follow: false } };

export default async function QuotePage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const view = await readPublic("위탁교육 견적 양식", () => getQuoteForm(), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open) notFound();
  return <QuotePageView view={view} query={{ sent: queryValue(sp.sent), t: queryValue(sp.t), e: queryValue(sp.e), field: queryValue(sp.field), withdrawn: queryValue(sp.withdrawn) }} />;
}
