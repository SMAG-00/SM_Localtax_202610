// 공개 사이트 공용 값 — docs/dev/W2-b_설계.md 2.3 표와 같다 (시험 constants.test.ts가 설계 문서를 읽어 대조한다). 순수 모듈.
import { ARTICLE_TYPE_BADGE_LABELS, HEADER_SECTIONS, HEADER_UTILITIES } from "@ltr/ui";

/** 4대 분야 `section` (W2-a 설계 §2) — 순서는 HOME-01·HOME-02 고정 */
export const SECTION_KEYS = ["tax", "realestate", "finance", "local"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const isSectionKey = (v: unknown): v is SectionKey => typeof v === "string" && (SECTION_KEYS as readonly string[]).includes(v);

/** 분야 이름·허브 주소는 헤더와 같은 표(@ltr/ui HEADER_SECTIONS), 아이브로는 홈 히어로 아이브로의 낱말 (PRD-01A 3장 홈 골격) */
const EYEBROWS: Record<SectionKey, string> = { tax: "LOCAL TAX", realestate: "REAL ESTATE", finance: "DEVELOPMENT FINANCE", local: "LOCAL" };
export const SECTION_INFO: Readonly<Record<SectionKey, { name: string; href: string; eyebrow: string }>> = Object.fromEntries(
  HEADER_SECTIONS.map((s) => [s.key, { name: s.label, href: s.href, eyebrow: EYEBROWS[s.key] }]),
) as Record<SectionKey, { name: string; href: string; eyebrow: string }>;

/** anon이 읽는 설정 키 (DB 정책 settings_public_read와 같은 목록) */
export const PUBLIC_SETTING_KEYS = [
  "home_core_message",
  "home_search_chips",
  "hub_intros",
  "amendment_confirmed_stage",
  "hub_situation_limit",
  "feature_flags",
  "next_action_priority",
] as const;

/** 기능 공개 목록 (settings.feature_flags) — 없거나 false면 닫힘 */
export const FEATURE_KEYS = [
  "calc",
  "experts",
  "store",
  "edu",
  "search",
  "sm_calculator",
  "expert_finder",
  "self_calculator",
  "taxbot",
  "region_hubs",
  "amendments",
  "page_about",
  "page_editorial_policy",
  "page_ethics",
  "page_corrections",
  "page_ad_policy",
  "page_privacy",
  "page_help",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Readonly<Record<FeatureKey, boolean>>;

/** 유틸 메뉴 — 이름·주소·순서는 헤더 표(@ltr/ui HEADER_UTILITIES, HOME-02) */
export const UTILITY_LINKS: ReadonlyArray<{ key: FeatureKey; label: string; href: string }> = HEADER_UTILITIES.map((u) => ({ key: u.key, label: u.label, href: u.href }));

/** 다음 행동 띠 버튼 (ART-06) */
export const NEXT_ACTION_KEYS = ["situation", "same_section", "local_news", "sm_calculator", "expert_finder", "self_calculator", "taxbot"] as const;
export type NextActionKey = (typeof NEXT_ACTION_KEYS)[number];
export const NEXT_ACTION_LABELS: Readonly<Record<NextActionKey, string>> = {
  situation: "이 상황 모아 보기",
  same_section: "같은 분야 더 보기",
  local_news: "이 지역 뉴스 더 보기",
  sm_calculator: "SM 계산기로 계산하기",
  expert_finder: "전문가 찾기",
  self_calculator: "계산해 보기",
  taxbot: "지방세봇에게 묻기",
};

/** 홈 섹션 — 순서 고정 (HOME-01 · PRD_최종 §4.1) */
export const HOME_SECTION_KEYS = ["hero", "fields", "latest_reports", "weekly_hot", "amendments", "column", "product", "experts"] as const;
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

/** 기사 하단 정책 링크 7종 (ART-02 · PRD_최종 §4.1) — 정책 페이지가 공개 승인되면(기능 키) 나온다 (HELP-05) */
export const POLICY_LINKS: ReadonlyArray<{ key: string; label: string; href: string; feature: FeatureKey }> = [
  { key: "about", label: "회사 소개", href: "/about", feature: "page_about" },
  { key: "editorial_policy", label: "편집 원칙", href: "/about/editorial-policy", feature: "page_editorial_policy" },
  { key: "ethics", label: "윤리강령", href: "/about/ethics", feature: "page_ethics" },
  { key: "corrections", label: "정정·반론 창구", href: "/about/corrections", feature: "page_corrections" },
  { key: "ad_policy", label: "광고 정책", href: "/about/ad-policy", feature: "page_ad_policy" },
  { key: "privacy", label: "개인정보처리방침", href: "/about/privacy", feature: "page_privacy" },
  { key: "help", label: "고객센터", href: "/help/report", feature: "page_help" },
];

/** 기사 유형 배지 글자 (ART-02 — content_type 값과 1:1) — 배지 컴포넌트의 글자 표를 그대로 쓴다 */
export const CONTENT_TYPE_NAMES: Readonly<Record<string, string>> = ARTICLE_TYPE_BADGE_LABELS;

/** 화면 개수 (PRD 수용 기준의 숫자) */
export const LIMITS = {
  /** HOME-04 최신 자체 취재 */
  homeLatestReports: 5,
  /** HOME-03 트래커 하이라이트 1~3 · 스토리 3~6 (DB 트리거와 같은 상한) */
  trackers: 3,
  storiesMin: 3,
  storiesMax: 6,
  /** ART-06 비슷한 사례 3건 · 버튼 2개 이하 */
  similarCases: 3,
  nextActions: 2,
  /** 관련 기사 */
  related: 4,
  /** CAT-02 허브 최신 목록 · 관련 용어 칩 */
  hubLatest: 10,
  hubTerms: 8,
  /** 목록 한 쪽 */
  pageSize: 20,
} as const;

/**
 * 공개 링크로 내보내지 않는 경로 — 단계 전 경로(HOME-02: 자체 계산기 `/calc/…`, `/law`, `/cases`, `/workspace`, `/qna`, `/library`)와
 * v1.2 경로(`/region`, `/resources`, `/authors`, `/news/cards`, 옛 정책 경로 — MIG-02). 사이트 안 주소(`/`로 시작)만 본다
 */
const BLOCKED_PREFIXES = [
  "/calc/",
  "/law",
  "/cases",
  "/workspace",
  "/qna",
  "/library",
  "/region",
  "/resources",
  "/authors",
  "/news/cards",
  "/editorial-policy",
  "/corrections",
  "/advertise",
  "/terms",
  "/privacy",
  "/no-email-collection",
] as const;

export function isBlockedPath(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const path = href.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  return BLOCKED_PREFIXES.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));
}

export const newsHref = (slug: string) => `/news/${encodeURIComponent(slug)}`;
export const personHref = (slug: string) => `/people/${encodeURIComponent(slug)}`;
export const situationHref = (slug: string) => `/situations/${encodeURIComponent(slug)}`;
export const amendmentHref = (slug: string) => `/tax/amendments/${encodeURIComponent(slug)}`;
export const categoryHref = (section: SectionKey, slug: string) => (section === "local" ? SECTION_INFO.local.href : `${SECTION_INFO[section].href}/${encodeURIComponent(slug)}`);
