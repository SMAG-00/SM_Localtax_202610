import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { UiLink } from "@ltr/ui";
import { IssueMapEntry } from "@/components/site/tax-guide/TaxEntries";
import { PlacedGuides } from "@/components/site/tax-guide/PlacedGuides";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getPlacedGuides } from "@/lib/server/public/tax-guide";
import { pageTitle } from "@/lib/site/hub-view";

// 금융 구조별 세금 가이드 주제 (/finance/tax-guide/[topic] — DF-08). 신탁 주제는 신탁 유형 페이지(TRU-02)와 같은 가이드 버전을 연다 - 같은 배치 읽기라 같은 버전·본문 해시다.
const TOPIC_RE = /^[a-z0-9]+([-_][a-z0-9]+)*$/;

const load = cache(async (topic: string) => {
  await connection();
  if (topic.length > 100 || !TOPIC_RE.test(topic)) return [];
  return readPublic("금융 구조별 세금 가이드 주제", () => getPlacedGuides("finance_tax_hub", topic), () => UNAVAILABLE);
});

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }): Promise<Metadata> {
  const guides = await load((await params).topic);
  if (isUnavailable(guides) || guides.length === 0) return { title: pageTitle("금융 구조별 세금 가이드"), robots: { index: false, follow: false } };
  return { title: pageTitle(guides[0]!.title) };
}

export default async function Page({ params }: { params: Promise<{ topic: string }> }) {
  const topic = (await params).topic;
  const guides = await load(topic);
  if (isUnavailable(guides)) return <UnavailablePage />;
  if (guides.length === 0) notFound();
  return (
    <div data-ui="finance-tax-guide-topic" data-topic={topic}>
      <div className="mx-auto max-w-5xl px-4 pt-10">
        <UiLink href="/finance/tax-guide" className="inline-flex min-h-11 items-center font-bold text-navy-900 underline-offset-4 hover:underline">
          금융 구조별 세금 가이드
        </UiLink>
      </div>
      <PlacedGuides surface="finance_tax_hub" targetKey={topic} id="finance-tax-guide-body" tone="ivory" heading={{ eyebrow: "금융 구조별 세금 가이드", title: guides[0]!.title }} />
      {guides[0]!.hub === "trust" && (
        <div className="mx-auto max-w-5xl px-4 pb-10">
          <IssueMapEntry hub="trust" />
        </div>
      )}
    </div>
  );
}
