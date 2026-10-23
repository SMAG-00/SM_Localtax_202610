import { HubRoute, hubMetadata, type SearchParams } from "@/components/site/routes";
import { TrackerBlock } from "@/components/site/FinanceViews";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getTracker } from "@/lib/server/public/finance";

// 분야 허브 — 네 허브가 같은 골격(CAT-02 · UX-05)을 쓴다. 분야 값만 다르다 (components/site/routes.tsx · HubView.tsx)
// W5 DF-04: 기능 키 finance 켜짐 + 규제·통계 행이 있을 때만 허브 아래에 규제·통계 트래커 블록 (꺼짐·0건이면 달라지는 것 0)
export const generateMetadata = hubMetadata("finance");

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const tracker = await readPublic("개발금융 트래커", () => getTracker(), () => UNAVAILABLE);
  return (
    <>
      <HubRoute section="finance" searchParams={searchParams} />
      {tracker && !isUnavailable(tracker) && <TrackerBlock tracker={tracker} />}
    </>
  );
}
