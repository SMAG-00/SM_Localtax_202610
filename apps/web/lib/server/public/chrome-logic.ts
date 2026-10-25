// 공개 화면 틀 — 헤더 상단 메뉴·하위 메뉴·유틸 메뉴·정책 링크 (HOME-02 · HELP-05) — 순수 함수 (시험 chrome-logic.test.ts)
//  · 상단 메뉴는 4대 분야 정확히 4개, 이 순서. 하위 메뉴는 분야 데이터(CAT-01)에서 — 공개 분야 중 목록 기사가 1건 이상인 것 + 공통 `뉴스 전체`
//    지자체뉴스는 하위 경로(/local/[sido] · /local/events)가 01B 몫이라 하위 분야 대신 기사 있는 편집 분야(/local?topic=…)를 둔다 (설계 9장)
//  · 유틸 메뉴·정책 링크는 기능 키가 켜진 것만 (꺼지면 링크 요소 0 — 빈 링크 0)
import { brand, type LocalTopic } from "@ltr/ui";
import { companyFooter, type CompanyFooter } from "@/lib/policy/docs";
import { LOCAL_TOPICS, POLICY_LINKS, SECTION_INFO, SECTION_KEYS, UTILITY_LINKS, categoryHref, isBlockedPath, localTopicHref, type Features, type SectionKey } from "./constants";
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
  /** 바닥글 링크 — 정책 · 약관 · 측정 거부 · 계정 (W2-e 6.4). 기능 키(실제로 열린 것)가 닫으면 0, 측정 거부만 항상 있다 */
  footerLinks: NavLink[];
  /** 바닥글 안내 문단·매체 정보·연락처 — 값이 있는 칸만 (제호는 brand에서) */
  company: CompanyFooter;
}

/**
 * 바닥글 링크 (6.4) — 순서: 옛 사이트 여섯(회사소개 · 개인정보처리방침 · 이용약관 · 청소년보호정책 · 저작권보호정책 · 이메일무단수집거부)
 * · 편집 원칙 · 윤리강령 · 정정·반론 창구 · 광고 정책 · 고객센터 · 측정 거부 · 내 정보. 공개 승인(기능 키)된 것만, 측정 거부는 항상
 */
export function buildFooterLinks(features: Features): NavLink[] {
  const policy = (key: string) => POLICY_LINKS.filter((p) => p.key === key && features[p.feature]).map((p) => ({ key: p.key, label: p.label, href: p.href }));
  const links: NavLink[] = [
    ...policy("about"),
    ...policy("privacy"),
    ...(features.page_terms ? [{ key: "terms", label: "이용약관", href: "/about/terms" }] : []),
    ...(features.page_youth_protection ? [{ key: "youth_protection", label: "청소년보호정책", href: "/about/youth-protection" }] : []),
    ...(features.page_copyright_policy ? [{ key: "copyright_policy", label: "저작권보호정책", href: "/about/copyright-policy" }] : []),
    ...(features.page_no_email ? [{ key: "no_email", label: "이메일무단수집거부", href: "/about/no-email-collection" }] : []),
    ...["editorial_policy", "ethics", "corrections", "ad_policy", "help"].flatMap(policy),
    { key: "measurement", label: "방문 통계 설정", href: "/about/measurement" },
    ...(features.members ? [{ key: "my", label: "내 정보", href: "/my" }] : []),
  ];
  return links;
}

/** 공개 하위 분야 가운데 목록 기사가 있는 것 — 분야 안 순서(sort, 번호) */
export function listedCategories(categories: readonly PublicCategoryRow[], counts: ReadonlyMap<number, number>, section: SectionKey): PublicCategoryRow[] {
  return categories
    .filter((c) => c.section === section && (counts.get(Number(c.id)) ?? 0) > 0)
    .sort((a, b) => a.sort - b.sort || Number(a.id) - Number(b.id));
}

/**
 * 분야의 하위 메뉴 항목(뉴스 전체 빼고) — 허브 탭(CAT-02)과 헤더 하위 메뉴(HOME-02)가 같은 목록을 쓴다. 기사 0건인 것은 없다.
 * key = "<분야>:<하위 분야 slug 또는 편집 분야 값>"
 */
export function subsectionLinks(
  section: SectionKey,
  categories: readonly PublicCategoryRow[],
  counts: ReadonlyMap<number, number>,
  topicCounts: ReadonlyMap<LocalTopic, number>,
): NavLink[] {
  const links =
    section === "local"
      ? LOCAL_TOPICS.filter((t) => (topicCounts.get(t.topic) ?? 0) > 0).map((t) => ({ key: `local:${t.topic}`, label: t.label, href: localTopicHref(t.topic) }))
      : listedCategories(categories, counts, section).map((c) => ({ key: `${section}:${c.slug}`, label: c.name, href: categoryHref(section, c.slug) }));
  return links.filter((l) => !isBlockedPath(l.href));
}

export function buildChrome(
  categories: readonly PublicCategoryRow[],
  counts: ReadonlyMap<number, number>,
  features: Features,
  topicCounts: ReadonlyMap<LocalTopic, number> = new Map(),
  companyInfo: unknown = null,
): SiteChrome {
  const sections = SECTION_KEYS.map((key): SectionMenu => {
    const children: NavLink[] = subsectionLinks(key, categories, counts, topicCounts);
    children.push({ key: `${key}:news`, label: "뉴스 전체", href: `/news?section=${key}` });
    return { key, label: SECTION_INFO[key].name, href: SECTION_INFO[key].href, children: children.filter((c) => !isBlockedPath(c.href)) };
  });
  return {
    sections,
    utilities: UTILITY_LINKS.filter((u) => features[u.key]).map((u) => ({ key: u.key, label: u.label, href: u.href })),
    policyLinks: POLICY_LINKS.filter((p) => features[p.feature]).map((p) => ({ key: p.key, label: p.label, href: p.href })),
    footerLinks: buildFooterLinks(features),
    company: companyFooter(companyInfo, brand.mastheadName),
  };
}

/**
 * 닫힌 화면 틀 — 공개 데이터를 읽지 못할 때(DB 연결 실패) 공개 레이아웃이 쓴다. 상단 메뉴 4개와 공통 '뉴스 전체'만,
 * 기능 키로 여는 유틸 메뉴·정책 링크는 0 (모양이 틀린 값은 닫힌 쪽으로 — 설계 2.4)
 */
export function closedChrome(): SiteChrome {
  return buildChrome([], new Map(), CLOSED_FEATURES);
}
