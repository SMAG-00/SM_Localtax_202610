import { RegionRoute, regionMetadata, type RegionParams, type RegionSearchParams } from "@/components/site/region-routes";

// 시·군·구 지자체 허브 (/local/[sido]/[sigungu] — W4 3단계, 기능 키 region_hubs). 다른 시·도 아래의 slug는 404
export const generateMetadata = regionMetadata;

export default function Page({ params, searchParams }: { params: RegionParams; searchParams: RegionSearchParams }) {
  return <RegionRoute params={params} searchParams={searchParams} />;
}
