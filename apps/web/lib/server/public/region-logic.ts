// 지역 화면(/local/[sido] · /local/[sido]/[sigungu] — W4 3단계) 값 만들기 — 순수 모듈 (시험 region-logic.test.ts).
// docs/dev/W4_설계.md 1장 3단계 · 5장 · 12장 #26, PRD-01B REG1-01 · REG1-12:
//  · 머리 = 지역 허브 머리(@ltr/ui RegionHubHead — 홈 > 지자체뉴스 > 시·도 > 시·군·구 이동, 같은 시·도의 시·군·구 바꾸기)
//  · 기사 범위 — 시·도 = 자기 + 하위 시·군·구 태그, 시·군·구 = 자기 태그만 (12장 #26). 지자체뉴스 분야 기사
//  · 기사 0건이면 200 + noindex + 상위 지역 안내(시·군·구 → 시·도 · 지자체뉴스 전체, 시·도 → 지자체뉴스 전체) — 빈 카드·'준비 중' 0
//  · 구조화 데이터 BreadcrumbList = 화면 이동 줄 (regionCrumbs 한 함수). 사이트 주소(NEXT_PUBLIC_SITE_URL)가 없으면 내지 않는다(틀린 주소 0)
//  · W4 4단계 — 머리 아래 지방세 포인트(hub_tax_points.local, 서명본만) · 분야 필터(?topic=) · LG-08 블록 ②③⑤(규칙은 region-hub-logic.ts) · 데이터 출처 줄.
//    분야를 골랐는데 그 지역 범위에 그 분야 기사가 0이면 그 주소도 noindex. 폐지 지역 태그 기사는 후속 지역 화면에 넣지 않는다(자기 태그만 — 12장 #26·#36)
// W4 9단계 — ⑤ 공식 자료/해설(검수 공식 자료 카드·감수 해설)과 지역 세금 연결 블록(⑤ 뒤 — 규칙은 region-official-logic.ts). 색인 최소선(9.2)·메타 설명은 11단계가 더한다.
import { regionCrumbs, type LocalTopic, type RegionCrumb, type RegionRef } from "@ltr/ui";
import type { BreadcrumbView } from "@ltr/structured-data";
import { isValidOn, regionHref, type RegionRouteRow } from "@/lib/site/region-route";
import { SECTION_INFO } from "./constants";
import type { HubTaxPoint } from "./hub-point-logic";
import { regionHubBlocks, regionSourceLine, topicHasOwnArticles, type BlockArticles, type LocalBlockFields, type RegionHubBlock, type RegionSourceLine } from "./region-hub-logic";
import type { RegionalOfficial, RegionTaxLinksView } from "./region-official-logic";

export interface RegionGuide {
  text: string;
  links: { label: string; href: string }[];
}

export interface RegionPage {
  level: "sido" | "sigungu";
  code: string;
  /** 화면 제목 — 시·도 이름, 시·군·구면 '시·도 시·군·구' */
  fullName: string;
  href: string;
  sido: RegionRef;
  sigungu: RegionRef | null;
  /** 같은 시·도의 오늘 유효한 시·군·구 (코드 순) */
  sigunguOptions: RegionRef[];
  /** 화면 이동 줄 — 구조화 데이터가 같은 값을 쓴다 */
  crumbs: RegionCrumb[];
  /** 고른 분야 (?topic=) — 목록 밖 값이면 null(전체) */
  topic: LocalTopic | null;
  /** 지방세 포인트 (CORE-02 — hub_tax_points.local 서명본, 감수 전이면 null → 블록째 숨김) */
  taxPoint: HubTaxPoint | null;
  /** LG-08 블록 — ②③(고른 분야를 담는 블록만)·⑤ 순서 고정 (①④는 W6 — 요소 0) */
  blocks: RegionHubBlock[];
  /** 지역 세금 연결 블록 (⑤ 뒤 — REG1-10) — 내용이 하나도 없으면 null(블록째 0) */
  taxLinks: RegionTaxLinksView | null;
  /** 데이터 출처 줄 (REG-10) */
  source: RegionSourceLine;
  /** 그 지역 범위의 지자체뉴스 기사 수 (편집 분야와 상관없이) */
  total: number;
  empty: boolean;
  /** 검색 노출 제외 — 기사 0건 (REG1-01 '빈 시·군·구 주소는 200 + noindex'), 고른 분야 기사 0건 */
  noindex: boolean;
  guide: RegionGuide | null;
  /** BreadcrumbList 입력 — 사이트 주소가 없으면 null */
  breadcrumb: BreadcrumbView | null;
}

/** 기사 범위의 지역 코드 — 시·도 = 자기 + 하위 시·군·구(폐지된 하위 포함 — 그때 단 태그도 그 시·도 기사), 시·군·구 = 자기 */
export function regionArticleCodes(region: RegionRouteRow, regions: readonly RegionRouteRow[]): string[] {
  if (region.level !== "sido") return [region.code];
  return [region.code, ...regions.filter((r) => r.parent_code === region.code).map((r) => r.code).sort()];
}

/** 같은 시·도의 오늘 유효한 시·군·구 — 코드 순 */
export function sigunguOptions(sido: RegionRouteRow, regions: readonly RegionRouteRow[], today: string): RegionRef[] {
  return regions
    .filter((r) => r.level === "sigungu" && r.parent_code === sido.code && isValidOn(r, today))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((r) => ({ name: r.name, href: regionHref(sido.slug, r.slug) }));
}

/** 빈 지역 안내 — 시·군·구는 상위 시·도로, 시·도는 지자체뉴스 전체로 (REG1-12 '유용한 상위 지역 안내') */
export function emptyGuide(sido: RegionRef, sigungu: RegionRef | null, fullName: string): RegionGuide {
  const all = { label: `${SECTION_INFO.local.name} 전체 보기`, href: SECTION_INFO.local.href };
  if (sigungu) {
    return { text: `${fullName}에는 아직 공개된 기사가 없습니다. 상위 지역 ${sido.name} 소식을 보세요.`, links: [{ label: `${sido.name} 소식 보기`, href: sido.href }, all] };
  }
  return { text: `${sido.name}에는 아직 공개된 기사가 없습니다. ${SECTION_INFO.local.name} 전체에서 다른 지역 소식을 보세요.`, links: [all] };
}

/** 이동 줄 → BreadcrumbList 입력 — 주소는 사이트 절대 주소 */
export function breadcrumbView(crumbs: readonly RegionCrumb[], siteUrl: string | undefined): BreadcrumbView | null {
  if (!siteUrl) return null;
  return { items: crumbs.map((c) => ({ name: c.name, url: `${siteUrl}${c.href}` })) };
}

export function regionPage(input: {
  sido: RegionRouteRow;
  sigungu: RegionRouteRow | null;
  regions: readonly RegionRouteRow[];
  total: number;
  today: string;
  siteUrl: string | undefined;
  topic?: LocalTopic | null;
  /** 설정 local_block_fields — 읽지 못했거나 모양이 틀리면 null (기사 블록 0) */
  fields?: LocalBlockFields | null;
  /** 그 지역 범위 블록 기사 */
  own?: BlockArticles;
  /** 상위 시·도 범위 블록 기사 (시·군·구 허브만) */
  parent?: BlockArticles;
  taxPoint?: HubTaxPoint | null;
  /** ⑤ 검수 공식 자료·감수 해설 (그 지역 범위) */
  official?: RegionalOfficial;
  taxLinks?: RegionTaxLinksView | null;
}): RegionPage {
  const { sido, sigungu } = input;
  const sidoRef: RegionRef = { name: sido.name, href: regionHref(sido.slug) };
  const sigunguRef: RegionRef | null = sigungu ? { name: sigungu.name, href: regionHref(sido.slug, sigungu.slug) } : null;
  const fullName = sigungu ? `${sido.name} ${sigungu.name}` : sido.name;
  const crumbs = regionCrumbs(sidoRef, sigunguRef ?? undefined);
  const topic = input.topic ?? null;
  const fields = input.fields ?? null;
  const own = input.own ?? {};
  const blocks = regionHubBlocks({ fields, topic, sidoName: sido.name, sigunguName: sigungu?.name ?? null, own, parent: input.parent ?? {}, ...(input.official ? { official: input.official } : {}) });
  const empty = input.total <= 0;
  return {
    level: sigungu ? "sigungu" : "sido",
    code: (sigungu ?? sido).code,
    fullName,
    href: (sigunguRef ?? sidoRef).href,
    sido: sidoRef,
    sigungu: sigunguRef,
    sigunguOptions: sigunguOptions(sido, input.regions, input.today),
    crumbs,
    topic,
    taxPoint: input.taxPoint ?? null,
    blocks,
    taxLinks: input.taxLinks ?? null,
    source: regionSourceLine(blocks),
    total: empty ? 0 : input.total,
    empty,
    noindex: empty || (topic !== null && !topicHasOwnArticles(fields, topic, own)),
    guide: empty ? emptyGuide(sidoRef, sigunguRef, fullName) : null,
    breadcrumb: breadcrumbView(crumbs, input.siteUrl),
  };
}
