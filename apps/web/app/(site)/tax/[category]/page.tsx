import { CategoryRoute, categoryMetadata, type SearchParams } from "@/components/site/routes";

// 하위 분야 목록 (CAT-02) — 없는 하위 분야는 404, 기사 0건은 상위 허브 안내 + noindex (components/site/routes.tsx · CategoryView.tsx)
export const generateMetadata = categoryMetadata("tax");

export default function Page({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: SearchParams }) {
  return <CategoryRoute section="tax" params={params} searchParams={searchParams} />;
}
