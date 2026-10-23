import type { Metadata } from "next";
import { CategoryRoute, categoryMetadata, type SearchParams } from "@/components/site/routes";
import { StructureCards } from "@/components/site/FinanceViews";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getStructureCards } from "@/lib/server/public/finance";

// 신탁·PF 구조 (W5 DF-01) — 기존 하위 분야 목록(기사)에 구조 해설 목록을 더한다. 기능 키 finance 꺼짐·승인본 0건이면 기존 목록 그대로.
const PARAMS = Promise.resolve({ category: "trust-pf" });
export const generateMetadata = ({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> => categoryMetadata("finance")({ params: PARAMS, searchParams });

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const cards = await readPublic("개발금융 구조 해설 목록", () => getStructureCards(), () => UNAVAILABLE);
  return (
    <>
      {!isUnavailable(cards) && <StructureCards cards={cards} />}
      <CategoryRoute section="finance" params={PARAMS} searchParams={searchParams} />
    </>
  );
}
