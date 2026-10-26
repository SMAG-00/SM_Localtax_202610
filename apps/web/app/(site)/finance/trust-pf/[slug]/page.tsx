import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { StructureDetail } from "@/components/site/FinanceViews";
import { PlacedGuides } from "@/components/site/tax-guide/PlacedGuides";
import { IssueMapEntry, TrustArticles, TrustJudgmentEntry } from "@/components/site/tax-guide/TaxEntries";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getStructure } from "@/lib/server/public/finance";
import { SLUG_RE } from "@/lib/admin/finance-rules";
import { pageTitle } from "@/lib/site/hub-view";

// 구조 해설 상세 (/finance/trust-pf/[slug] — W5 DF-01·02). 기능 키 finance 꺼짐·승인본 없음·모양 밖 주소는 404.
const load = cache(async (slug: string) => {
  await connection();
  if (slug.length > 60 || !SLUG_RE.test(slug)) return null;
  return readPublic("개발금융 구조 해설 상세", () => getStructure(slug), () => UNAVAILABLE);
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const view = await load((await params).slug);
  if (!view || isUnavailable(view)) return { title: pageTitle("구조 해설"), robots: { index: false, follow: false } };
  return { title: pageTitle(view.title), ...(view.summary ? { description: view.summary } : {}) };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const view = await load((await params).slug);
  if (view === null || isUnavailable(view)) notFound();
  // W11-c c2 (TRU-01·02·03): 세금 칸 - 같은 신탁 가이드는 /finance/tax-guide 와 같은 public_guides 한 곳에서 읽는다 (구조 해설은 이 경로 하나)
  return (
    <>
      <StructureDetail view={view} />
      <PlacedGuides surface="trust_type" targetKey={view.slug} id="finance-structure-tax" heading={{ eyebrow: "신탁 세금", title: "이 신탁 유형의 세금" }} />
      <TrustArticles />
      <div className="mx-auto max-w-5xl px-4 pb-10">
        <TrustJudgmentEntry />
        <IssueMapEntry hub="trust" />
      </div>
    </>
  );
}
