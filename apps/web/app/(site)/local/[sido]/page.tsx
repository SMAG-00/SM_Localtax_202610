import { RegionRoute, regionMetadata, type RegionParams } from "@/components/site/region-routes";

// 시·도 지자체 허브 (/local/[sido] — W4 3단계, 기능 키 region_hubs). 지자체뉴스 허브 /local·분야 필터 /local?topic=은 ../page.tsx 그대로
export const generateMetadata = regionMetadata;

export default function Page({ params }: { params: RegionParams }) {
  return <RegionRoute params={params} />;
}
