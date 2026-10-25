import { CategoryRoute, categoryMetadata, type SearchParams } from "@/components/site/routes";
import { FinanceCaseEntries } from "@/components/site/FinanceCaseEntries";
import { getFinanceCaseEntries } from "@/lib/server/public/finance-case-entries";

// 하위 분야 목록 (CAT-02) — 없는 하위 분야는 404, 기사 0건은 상위 허브 안내 + noindex (components/site/routes.tsx · CategoryView.tsx)
// /finance/cases 에는 금융 사례 DB 목록(W10-h DF-07 - 구조 유형 필터)이 기사 목록 아래에 붙는다. 공개된 항목이 없으면 영역 0.
export const generateMetadata = categoryMetadata("finance");

const one = (v: string | string[] | undefined): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export default async function Page({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: SearchParams }) {
  const { category } = await params;
  const sp = await searchParams;
  const entries = category === "cases" ? await getFinanceCaseEntries() : [];
  return (
    <>
      <CategoryRoute section="finance" params={params} searchParams={searchParams} />
      {category === "cases" && <FinanceCaseEntries entries={entries} structureType={one(sp.type)} issue={one(sp.issue)} />}
    </>
  );
}
