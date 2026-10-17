import { HubRoute, hubMetadata, type SearchParams } from "@/components/site/routes";

// 분야 허브 — 네 허브가 같은 골격(CAT-02 · UX-05)을 쓴다. 분야 값만 다르다 (components/site/routes.tsx · HubView.tsx)
export const generateMetadata = hubMetadata("realestate");

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <HubRoute section="realestate" searchParams={searchParams} />;
}
