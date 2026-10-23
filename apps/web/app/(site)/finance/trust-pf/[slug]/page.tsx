import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { StructureDetail } from "@/components/site/FinanceViews";
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
  return <StructureDetail view={view} />;
}
