import "server-only";
import type { BreadcrumbView } from "@ltr/structured-data";
import { siteUrl } from "../env";
import { publicDb, rowsOf } from "./db";
import type { FilterChip } from "./project-logic";
import { readPublicSettings, readRegions } from "./reads";
import {
  PUBLIC_SUPPLY_COLUMNS,
  SUPPLY_LIMITS,
  filterSupply,
  hubSupplyCards,
  kstDateOf,
  sortProjectSupply,
  supplyBreadcrumb,
  supplyCard,
  supplyCrumbs,
  supplyRegionChips,
  supplySourceLine,
  upcomingCards,
  type PublicSupplyRow,
  type SupplyCard,
  type SupplyCrumb,
  type SupplyFilter,
} from "./supply-logic";

// 분양 정보 공개 화면 데이터 (W4 17단계 — 규칙은 supply-logic.ts). 공개 뷰 public_supply_notices(…51)만 anon 키로 읽는다.
// 기능 키 supply_notices가 꺼져 있으면 null·0장 → 목록 /realestate/supply는 하위 분야 목록(W3 12장 #20과 같은 방식), 허브 ③·프로젝트 화면 분양 정보 요소 0.
// 예정 목록(목록·허브 ③)은 now의 한국 날짜로 거른다 — 청약 마감일 다음 날 00:00(KST)부터 빠진다(2.3). 프로젝트 화면은 지난 항목도 기록으로 남긴다(PR-04).
// 원격 DB에 …51이 없어도 기능 키가 원격 feature_flags에 없으면 꺼짐이라 뷰를 읽지 않는다(공통 경로 영향 0).

export interface SupplyListView {
  today: string;
  filter: SupplyFilter;
  /** 거른 예정 카드 (마감 이른 순) */
  items: SupplyCard[];
  /** 예정 카드 전체 수 (거르기 전) */
  total: number;
  chips: FilterChip[];
  crumbs: SupplyCrumb[];
  breadcrumb: BreadcrumbView | null;
  /** 데이터 출처 줄 — 보이는 카드의 공고 기관·가장 이른 모집공고일·가장 이른 확인일 */
  sourceLine: { source: string; baseDate: string; checkedAt: string } | null;
}

export async function getSupplyList(filter: SupplyFilter = { region: null }, now: Date = new Date()): Promise<SupplyListView | null> {
  const settings = await readPublicSettings();
  if (!settings.features.supply_notices) return null;
  const [rows, regions] = await Promise.all([
    rowsOf<PublicSupplyRow>(
      publicDb().from("public_supply_notices").select(PUBLIC_SUPPLY_COLUMNS).gte("apply_end", kstDateOf(now)).order("apply_end").order("id").limit(SUPPLY_LIMITS.list),
      "공개 분양 정보",
    ),
    readRegions(),
  ]);
  const all = upcomingCards(rows, regions, now, settings.features);
  const items = filterSupply(all, filter);
  const crumbs = supplyCrumbs();
  return { today: kstDateOf(now), filter, items, total: all.length, chips: supplyRegionChips(all, filter, regions), crumbs, breadcrumb: supplyBreadcrumb(crumbs, siteUrl()), sourceLine: supplySourceLine(items) };
}

/** 지역 허브 ③ 분양 정보 카드 — 그 지역 범위(#26)의 예정 항목 최대 4장. 기능 키가 꺼지면 0장 */
export async function readRegionSupply(regionCode: string, scopeCodes: readonly string[], now: Date = new Date()): Promise<{ cards: SupplyCard[]; more: string | null }> {
  const settings = await readPublicSettings();
  if (!settings.features.supply_notices || scopeCodes.length === 0) return { cards: [], more: null };
  const [rows, regions] = await Promise.all([
    rowsOf<PublicSupplyRow>(
      publicDb().from("public_supply_notices").select(PUBLIC_SUPPLY_COLUMNS).in("region_code", [...scopeCodes]).gte("apply_end", kstDateOf(now)).order("apply_end").order("id").limit(SUPPLY_LIMITS.list),
      "지역 분양 정보",
    ),
    readRegions(),
  ]);
  return hubSupplyCards(upcomingCards(rows, regions, now, settings.features), regionCode);
}

/** 프로젝트 화면 분양 정보 — 그 프로젝트에 이은 공개 항목 전부(예정·접수 중 먼저, 지난 항목은 '청약 마감' 기록). 기능 키가 꺼지면 0장 */
export async function readProjectSupply(projectId: number, now: Date = new Date()): Promise<SupplyCard[]> {
  const settings = await readPublicSettings();
  if (!settings.features.supply_notices) return [];
  const [rows, regions] = await Promise.all([
    rowsOf<PublicSupplyRow>(publicDb().from("public_supply_notices").select(PUBLIC_SUPPLY_COLUMNS).eq("project_id", projectId).order("apply_end", { ascending: false }).limit(SUPPLY_LIMITS.project), "프로젝트 분양 정보"),
    readRegions(),
  ]);
  const today = kstDateOf(now);
  return sortProjectSupply(rows.flatMap((r) => supplyCard(r, regions, today, settings.features) ?? []));
}
