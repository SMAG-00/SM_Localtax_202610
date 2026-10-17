// 공개 화면 틀 — 헤더 상단 메뉴·하위 메뉴·유틸 메뉴·정책 링크 (HOME-02 · HELP-05) — 순수 함수 (시험 chrome-logic.test.ts)
//  · 상단 메뉴는 4대 분야 정확히 4개, 이 순서. 하위 메뉴는 분야 데이터(CAT-01)에서 — 공개 분야 중 목록 기사가 1건 이상인 것 + 공통 `뉴스 전체`
//  · 유틸 메뉴·정책 링크는 기능 키가 켜진 것만 (꺼지면 링크 요소 0 — 빈 링크 0)
import { POLICY_LINKS, SECTION_INFO, SECTION_KEYS, UTILITY_LINKS, categoryHref, isBlockedPath, type Features, type SectionKey } from "./constants";
import type { PublicCategoryRow } from "./rows";
import { CLOSED_FEATURES } from "./settings";

export interface NavLink {
  key: string;
  label: string;
  href: string;
}

export interface SectionMenu extends NavLink {
  key: SectionKey;
  children: NavLink[];
}

export interface SiteChrome {
  sections: SectionMenu[];
  utilities: NavLink[];
  policyLinks: NavLink[];
}

/** 공개 하위 분야 가운데 목록 기사가 있는 것 — 분야 안 순서(sort, 번호) */
export function listedCategories(categories: readonly PublicCategoryRow[], counts: ReadonlyMap<number, number>, section: SectionKey): PublicCategoryRow[] {
  return categories
    .filter((c) => c.section === section && (counts.get(Number(c.id)) ?? 0) > 0)
    .sort((a, b) => a.sort - b.sort || Number(a.id) - Number(b.id));
}

export function buildChrome(categories: readonly PublicCategoryRow[], counts: ReadonlyMap<number, number>, features: Features): SiteChrome {
  const sections = SECTION_KEYS.map((key): SectionMenu => {
    // 지자체뉴스의 하위 경로(/local/[sido] · /local/events)는 01B가 정한다 — 분야 하위 메뉴는 3단계에서 [확인 필요] (설계 7장)
    const children: NavLink[] =
      key === "local"
        ? []
        : listedCategories(categories, counts, key).map((c) => ({ key: `${key}:${c.slug}`, label: c.name, href: categoryHref(key, c.slug) }));
    children.push({ key: `${key}:news`, label: "뉴스 전체", href: `/news?section=${key}` });
    return { key, label: SECTION_INFO[key].name, href: SECTION_INFO[key].href, children: children.filter((c) => !isBlockedPath(c.href)) };
  });
  return {
    sections,
    utilities: UTILITY_LINKS.filter((u) => features[u.key]).map((u) => ({ key: u.key, label: u.label, href: u.href })),
    policyLinks: POLICY_LINKS.filter((p) => features[p.feature]).map((p) => ({ key: p.key, label: p.label, href: p.href })),
  };
}

/**
 * 닫힌 화면 틀 — 공개 데이터를 읽지 못할 때(DB 연결 실패) 공개 레이아웃이 쓴다. 상단 메뉴 4개와 공통 '뉴스 전체'만,
 * 기능 키로 여는 유틸 메뉴·정책 링크는 0 (모양이 틀린 값은 닫힌 쪽으로 — 설계 2.4)
 */
export function closedChrome(): SiteChrome {
  return buildChrome([], new Map(), CLOSED_FEATURES);
}
