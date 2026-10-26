import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { UiLink } from "@ltr/ui";
import { SiteSection } from "@/components/site/SiteSection";
import { SCOPE_LABEL } from "@/components/site/tax-guide/PlacedGuides";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getPlacedGuidesBySurface } from "@/lib/server/public/tax-guide";
import { pageTitle } from "@/lib/site/hub-view";

// 금융 구조별 세금 가이드 허브 (/finance/tax-guide — DF-08). 기능 키 finance_tax_guide(자본시장법 검토 기록 뒤에만 켜짐)와 공개된 가이드 배치가 있어야 열린다.
// 신탁 주제는 TRU-02와 같은 가이드(허브 trust의 한 행) - 이 목록은 배치 정보만 읽고 원고를 따로 두지 않는다.
export const metadata: Metadata = { title: pageTitle("금융 구조별 세금 가이드"), description: "신탁·현물출자·공매·대물변제·PF 단계에서 생기는 세금 쟁점을 구조별로 설명합니다." };

export default async function Page() {
  await connection();
  const byTopic = await readPublic("금융 구조별 세금 가이드 목록", () => getPlacedGuidesBySurface("finance_tax_hub"), () => UNAVAILABLE);
  if (isUnavailable(byTopic)) return <UnavailablePage />;
  const topics = [...byTopic.entries()].filter(([, g]) => g.length > 0);
  if (topics.length === 0) notFound();
  return (
    <div data-ui="finance-tax-guide-hub">
      <SiteSection id="finance-tax-guide-head" tone="ivory" first data={{ "data-part": "hub-head" }}>
        <nav aria-label="현재 위치" className="text-[15px]">
          <UiLink href="/finance" className="font-bold text-navy-900 underline-offset-4 hover:underline">
            부동산금융
          </UiLink>
        </nav>
        <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900 sm:text-[40px]">금융 구조별 세금 가이드</h1>
        <p className="mt-3 max-w-2xl text-[17px] text-navy-700">구조별로 생기는 지방세 쟁점을 설명합니다. 국세는 해설과 공식 링크만 안내합니다.</p>
      </SiteSection>
      <SiteSection id="finance-tax-guide-topics" tone="ivory-dark" data={{ "data-part": "topic-list" }}>
        <ul className="grid gap-4">
          {topics.map(([topic, guides]) =>
            guides.map((g) => (
              <li key={`${topic}-${g.slug}`} data-guide-slug={g.slug} data-guide-version={String(g.version)} className="rounded-2xl border border-navy-100 bg-white p-5">
                <span data-part="scope-badge" className="rounded-full border border-navy-200 px-3 py-1 text-[13px] font-bold text-navy-700">
                  {SCOPE_LABEL[g.taxScope]}
                </span>
                <UiLink href={`/finance/tax-guide/${topic}`} className="mt-3 inline-flex min-h-11 items-center text-[20px] font-black text-navy-900 underline-offset-4 hover:underline">
                  {g.title}
                </UiLink>
                {g.lastReviewedOn && <p className="text-[13px] text-navy-600">최종 감수일 {g.lastReviewedOn}</p>}
              </li>
            )),
          )}
        </ul>
      </SiteSection>
    </div>
  );
}
