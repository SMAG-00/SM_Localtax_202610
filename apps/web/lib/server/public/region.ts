import "server-only";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { matchRegion, regionRoute } from "@/lib/site/region-route";
import { siteUrl } from "../env";
import { LIMITS } from "./constants";
import { publicDb } from "./db";
import { readArticleList, readPublicSettings, readRegions } from "./reads";
import { regionArticleCodes, regionPage, type RegionPage } from "./region-logic";

// 지역 화면 (/local/[sido] · /local/[sido]/[sigungu] — W4 3단계, 규칙은 region-logic.ts·lib/site/region-route.ts).
// 기능 키 region_hubs가 꺼졌거나 오늘 유효한 지역이 아니면(없음·예약 이름·다른 시·도 아래 slug·폐지) null → 404.
// 옛 주소 301은 proxy.ts가 먼저 정한다(이 함수는 옛 주소 표를 읽지 않는다 — anon 키, 공개 표만).

export type { RegionPage } from "./region-logic";

export async function getRegionPage(sidoSlug: string, sigunguSlug: string | null, opts: { now?: Date } = {}): Promise<RegionPage | null> {
  const route = regionRoute(sigunguSlug === null ? `/local/${sidoSlug}` : `/local/${sidoSlug}/${sigunguSlug}`);
  if (!route) return null;
  const [settings, regions] = await Promise.all([readPublicSettings(), readRegions()]);
  if (!settings.features.region_hubs) return null;
  const today = isoToKstDate((opts.now ?? new Date()).toISOString());
  const match = matchRegion(route, regions, today);
  if (match.kind !== "current") return null;
  const region = match.sigungu ?? match.sido;
  const { items, total } = await readArticleList(publicDb(), { section: "local", regionCodes: regionArticleCodes(region, regions), limit: LIMITS.hubLatest, count: true });
  return regionPage({ sido: match.sido, sigungu: match.sigungu, regions, articles: items, total, today, siteUrl: siteUrl() });
}
