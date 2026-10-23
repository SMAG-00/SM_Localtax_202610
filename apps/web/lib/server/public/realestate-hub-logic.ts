import { isoToKstDate } from "@/lib/admin/form-utils";
import type { ArticleListItem } from "./cards";
import { PROJECTS_HREF, type ProjectCard } from "./project-logic";
import { SUPPLY_HREF, type SupplyCard } from "./supply-logic";
import { isValidOn, regionHref, sidoCodeOf, type RegionRouteRow } from "@/lib/site/region-route";

// /realestate 허브 확장 (W4 22단계 — PRD-01B PR-01 · docs/dev/W4_설계.md 1장 22단계 · 5장) — 순수 규칙 (시험 realestate-hub-logic.test.ts).
//  · 지역 칩 = 시범 지역(설정 pilot_regions) + 시·도 17 → 지역 허브 ③ 앵커(`/local/[sido](/[sigungu])#realestate`). 지역 허브(region_hubs)가 꺼지면 칩 0 (404 링크 0)
//  · 랜드마크 프로젝트 카드·분양 정보 카드는 15·17단계 카드 그대로(지역·단계·출처·기준일이 빈 카드는 그쪽 함수가 만들지 않는다)
//  · 개발방법·상속·증여 링크 카드는 그 기능이 열렸을 때만 — 닫힌 기능 카드 0
//  · 순서 = 지방세 포인트(머리) → 지역 칩 → 랜드마크 프로젝트 → 분양 정보 → 링크 카드 → 최신 기사 → 칼럼

/** 지역 허브 ③ 부동산·개발 블록의 앵커 (packages/ui LocalHubBlocks 가 블록 키를 id 로 단다) */
export const REALESTATE_ANCHOR = "realestate";

/** 허브에 보이는 최근 칼럼 수 */
export const HUB_COLUMN_LIMIT = 3;

export const DEV_METHODS_HREF = "/realestate/development-methods";
export const INHERITANCE_GIFT_HREF = "/realestate/inheritance-gift";
export const COLUMNS_HREF = "/realestate/columns";

export interface RegionChip {
  code: string;
  /** 화면 글자 — 시범 시·군·구는 '시·도 시·군·구' */
  label: string;
  /** 지역 허브 ③ 앵커 주소 */
  href: string;
  kind: "pilot" | "sido";
}

export interface RegionChips {
  pilot: RegionChip[];
  sido: RegionChip[];
}

export const NO_CHIPS: RegionChips = { pilot: [], sido: [] };

const anchored = (path: string) => `${path}#${REALESTATE_ANCHOR}`;

/** 지역 칩 — 오늘 유효한 시·도 전부(코드 순) + 시범 지역(설정 순, 오늘 유효하고 찾을 수 있는 것만). region_hubs가 꺼지면 둘 다 0 */
export function regionChips(regions: readonly RegionRouteRow[], pilots: readonly string[], today: string, hubsOpen: boolean): RegionChips {
  if (!hubsOpen) return NO_CHIPS;
  const valid = regions.filter((r) => isValidOn(r, today));
  const sidos = valid.filter((r) => r.level === "sido").sort((a, b) => a.code.localeCompare(b.code));
  const sido: RegionChip[] = sidos.map((r) => ({ code: r.code, label: r.name, href: anchored(regionHref(r.slug)), kind: "sido" }));
  const pilot: RegionChip[] = [];
  const seen = new Set<string>();
  for (const code of pilots) {
    if (seen.has(code)) continue;
    seen.add(code);
    const row = valid.find((r) => r.code === code);
    if (!row) continue;
    if (row.level === "sido") {
      pilot.push({ code, label: row.name, href: anchored(regionHref(row.slug)), kind: "pilot" });
      continue;
    }
    const parent = sidos.find((s) => s.code === (row.parent_code ?? sidoCodeOf(code)));
    if (row.level === "sigungu" && parent) pilot.push({ code, label: `${parent.name} ${row.name}`, href: anchored(regionHref(parent.slug, row.slug)), kind: "pilot" });
  }
  return { pilot, sido };
}

export interface HubLinkCard {
  key: "dev_methods" | "inheritance_gift";
  title: string;
  description: string;
  href: string;
  /** 보조 줄 — 개발방법은 세무 감수일 */
  meta: string | null;
}

/** 링크 카드 글자 — 숫자·기한·세율 낱말 0, 추천·순위 낱말 0 */
export const HUB_LINK_COPY = {
  dev_methods: { title: "개발방법 비교", description: "재개발·재건축 등 개발방법을 같은 항목으로 나란히 놓고 지방세 쟁점을 비교합니다. 고르는 기준은 제시하지 않습니다." },
  inheritance_gift: { title: "상속·증여 안내", description: "상속·증여 때 따르는 세금을 국세와 지방세로 나눠 읽는 입문 안내입니다. 이 사이트에서 세액을 계산하지 않습니다." },
} as const;

/** 링크 카드 — 기능이 열린 것만(닫힌 기능 카드 0). 차례 고정: 개발방법 → 상속·증여 */
export function hubLinkCards(input: { devMethods: { reviewedOn: string } | null; inheritanceOpen: boolean }): HubLinkCard[] {
  const cards: HubLinkCard[] = [];
  if (input.devMethods) cards.push({ key: "dev_methods", ...HUB_LINK_COPY.dev_methods, href: DEV_METHODS_HREF, meta: `세무 감수 ${input.devMethods.reviewedOn}` });
  if (input.inheritanceOpen) cards.push({ key: "inheritance_gift", ...HUB_LINK_COPY.inheritance_gift, href: INHERITANCE_GIFT_HREF, meta: null });
  return cards;
}

/** 대표(랜드마크) 프로젝트 카드 — 목록 차례대로 최대 limit장, 있으면 전체 목록 주소 */
export function landmarkCards(sorted: readonly ProjectCard[], limit: number): { cards: ProjectCard[]; all: string | null } {
  const cards = sorted.filter((c) => c.landmark).slice(0, limit);
  return { cards, all: cards.length > 0 ? PROJECTS_HREF : null };
}

/** 분양 정보 카드 — 예정 카드 최대 limit장, 있으면 전체 목록 주소 */
export function hubSupplyBlock(upcoming: readonly SupplyCard[], limit: number): { cards: SupplyCard[]; all: string | null } {
  const cards = upcoming.slice(0, limit);
  return { cards, all: cards.length > 0 ? SUPPLY_HREF : null };
}

/** /realestate 허브가 더 가진 값 (다른 허브·닫힌 허브는 null) */
export interface RealEstateHubData {
  chips: RegionChips;
  projects: { cards: ProjectCard[]; all: string | null };
  supply: { cards: SupplyCard[]; all: string | null };
  links: HubLinkCard[];
  /** 최근 칼럼(opinion) — 있으면 전체 목록 주소 */
  columns: { items: ArticleListItem[]; all: string | null };
}

export const EMPTY_REALESTATE_HUB: RealEstateHubData = {
  chips: NO_CHIPS,
  projects: { cards: [], all: null },
  supply: { cards: [], all: null },
  links: [],
  columns: { items: [], all: null },
};

export const todayKst = (now: Date): string => isoToKstDate(now.toISOString());
