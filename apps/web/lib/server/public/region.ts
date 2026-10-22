import "server-only";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { matchRegion, regionRoute } from "@/lib/site/region-route";
import { siteUrl } from "../env";
import { getSmCalculatorCard } from "./calc";
import { isLocalTopic } from "./constants";
import { publicDb, rowsOf } from "./db";
import { getHubTaxPoint } from "./hub-points";
import { readPublicSettings, readRegions } from "./reads";
import { countRegionArticles, readBlockArticles, readLocalBlockFields } from "./region-hub";
import { regionArticleCodes, regionPage, type RegionPage } from "./region-logic";
import { readDescriptionTitles, readRegionIndexed } from "./region-index";
import { readRegionalOfficial } from "./region-official";
import { TAX_LINK_SITUATION_SECTIONS, TAX_LINK_SM_KEY, regionTaxLinks } from "./region-official-logic";
import { SITUATION_COLUMNS, type SituationRow } from "./rows";

// 지역 화면 (/local/[sido] · /local/[sido]/[sigungu] — W4 3단계, 규칙은 region-logic.ts·lib/site/region-route.ts).
// 기능 키 region_hubs가 꺼졌거나 오늘 유효한 지역이 아니면(없음·예약 이름·다른 시·도 아래 slug·폐지) null → 404.
// 옛 주소 301은 proxy.ts가 먼저 정한다(이 함수는 옛 주소 표를 읽지 않는다 — anon 키, 공개 표만).
// W4 4단계 — 지자체 허브 블록(②③⑤ — region-hub-logic.ts): 그 지역 범위 블록 기사를 읽고, 시·군·구 블록이 0건이면 상위 시·도 범위를 읽는다.
// 지방세 포인트는 지자체뉴스 허브와 같은 hub_tax_points.local(서명본만 — 12장 #31).
// W4 9단계 — ⑤ 공식 자료/해설(그 지역 범위의 검수 공식 자료·감수 해설 — region-official.ts)과 지역 세금 연결 블록(상황 카드·지방세 감수 해설·SM 취득세 카드·공식 원문).
// W4 11단계 — 색인 최소선 판정(뷰 public_region_index — …46)과 메타 설명 재료(그 지역 코드 하나만 단 최신 자체 취재 기사 제목 — region-index.ts).

export type { RegionPage } from "./region-logic";

export async function getRegionPage(sidoSlug: string, sigunguSlug: string | null, opts: { now?: Date; topic?: string | null } = {}): Promise<RegionPage | null> {
  const route = regionRoute(sigunguSlug === null ? `/local/${sidoSlug}` : `/local/${sidoSlug}/${sigunguSlug}`);
  if (!route) return null;
  const [settings, regions] = await Promise.all([readPublicSettings(), readRegions()]);
  if (!settings.features.region_hubs) return null;
  const today = isoToKstDate((opts.now ?? new Date()).toISOString());
  const match = matchRegion(route, regions, today);
  if (match.kind !== "current") return null;
  const region = match.sigungu ?? match.sido;
  const topic = isLocalTopic(opts.topic) ? opts.topic : null; // 목록 밖 값은 전체 (2.8)
  const codes = regionArticleCodes(region, regions);
  const [fields, total, taxPoint, official, situations, sm, indexable, descriptionTitles] = await Promise.all([
    readLocalBlockFields(),
    countRegionArticles(codes),
    getHubTaxPoint("local"),
    readRegionalOfficial(codes),
    rowsOf<SituationRow>(
      publicDb().from("situations").select(SITUATION_COLUMNS).in("section", [...TAX_LINK_SITUATION_SECTIONS]).not("hub_slot", "is", null).order("hub_slot"),
      "지역 세금 연결 상황 카드",
    ),
    getSmCalculatorCard(TAX_LINK_SM_KEY, settings.features),
    readRegionIndexed(region.code),
    readDescriptionTitles(region.code),
  ]);
  const own = fields ? await readBlockArticles(fields, topic, codes) : {};
  // 시·군·구 블록이 0건이면 상위 시·도 범위(시·도 + 그 아래 시·군·구 태그) — 0건인 블록만 다시 읽는다
  const emptyBlocks = match.sigungu && fields ? Object.entries(own).filter(([, items]) => items.length === 0).map(([b]) => b) : [];
  const parent =
    emptyBlocks.length && fields && match.sigungu
      ? await readBlockArticles({ local_tax: emptyBlocks.includes("local_tax") ? fields.local_tax : [], realestate: emptyBlocks.includes("realestate") ? fields.realestate : [] }, topic, regionArticleCodes(match.sido, regions))
      : {};
  const taxLinks = regionTaxLinks({ situations, situationLimit: settings.hubSituationLimit, official, sm });
  return regionPage({ sido: match.sido, sigungu: match.sigungu, regions, total, today, siteUrl: siteUrl(), topic, fields, own, parent, taxPoint, official, taxLinks, indexable, descriptionTitles });
}
