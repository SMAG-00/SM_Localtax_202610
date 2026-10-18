// 공개 사이트 공용 값 — docs/dev/W2-b_설계.md 2.3 표와 같다 (시험 constants.test.ts가 설계 문서를 읽어 대조한다). 순수 모듈.
import { ARTICLE_TYPE_BADGE_LABELS, HEADER_SECTIONS, HEADER_UTILITIES, TOPIC_FILTER_ITEMS, type LocalTopic } from "@ltr/ui";

/** 4대 분야 `section` (W2-a 설계 §2) — 순서는 HOME-01·HOME-02 고정 */
export const SECTION_KEYS = ["tax", "realestate", "finance", "local"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const isSectionKey = (v: unknown): v is SectionKey => typeof v === "string" && (SECTION_KEYS as readonly string[]).includes(v);

/** 분야 이름·허브 주소는 헤더와 같은 표(@ltr/ui HEADER_SECTIONS), 아이브로는 홈 히어로 아이브로의 낱말 (PRD-01A 3장 홈 골격) */
const EYEBROWS: Record<SectionKey, string> = { tax: "LOCAL TAX", realestate: "REAL ESTATE", finance: "DEVELOPMENT FINANCE", local: "LOCAL" };
export const SECTION_INFO: Readonly<Record<SectionKey, { name: string; href: string; eyebrow: string }>> = Object.fromEntries(
  HEADER_SECTIONS.map((s) => [s.key, { name: s.label, href: s.href, eyebrow: EYEBROWS[s.key] }]),
) as Record<SectionKey, { name: string; href: string; eyebrow: string }>;

/**
 * 지자체뉴스 분야(편집 분야 editorial_field — W2-a articles 값과 같다)와 분야 필터 글자 — 순서는 분야 필터 컴포넌트(@ltr/ui TOPIC_FILTER_ITEMS, PRD-00 8.6)
 * `/local` 허브의 탭·하위 메뉴는 이 값으로 거른다 (`/local?topic=<값>`) — 지자체뉴스의 하위 경로는 시·도 주소(`/local/[sido]`, 01B)와 겹치므로 쓰지 않는다 (설계 9장)
 */
export const LOCAL_TOPICS: ReadonlyArray<{ topic: LocalTopic; label: string }> = TOPIC_FILTER_ITEMS.flatMap((i) => (i.topic === null ? [] : [{ topic: i.topic, label: i.label }]));
export const isLocalTopic = (v: unknown): v is LocalTopic => typeof v === "string" && LOCAL_TOPICS.some((t) => t.topic === v);
export const localTopicHref = (topic: LocalTopic) => `${SECTION_INFO.local.href}?topic=${topic}`;

/** 지자체 허브 블록(LG-08) ② 지방세·지방재정 ③ 부동산·개발 에 담는 편집 분야 — 도시정책은 부동산·개발 블록 [확인 필요 — 설계 9장] */
export const LOCAL_BLOCK_TOPICS = { localTax: ["local_tax", "local_finance"], realEstate: ["realestate", "urban_policy"] } as const satisfies Record<string, readonly LocalTopic[]>;

/** 뉴스 전체(/news)의 허브 탭 글자 (PRD-01A 3장 화면 표 — 탭 지방세·부동산·개발금융·지자체) */
export const NEWS_TAB_LABELS: Readonly<Record<SectionKey, string>> = { tax: "지방세", realestate: "부동산", finance: "개발금융", local: "지자체" };

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
  /** 지자체 허브 블록 한 칸의 기사 카드 (PRD-00 8.10 — 2~4장) */
  localBlock: 4,
  /** 목록 한 쪽 */
  pageSize: 20,
} as const;

/**
 * 공개 링크로 내보내지 않는 경로 — 단계 전 경로(HOME-02: 자체 계산기 `/calc/…`, `/law`, `/cases`, `/workspace`, `/qna`, `/library`)와
 * v1.2 경로(PRD-01A 3장 · PRD-00 8장 'v1.2 경로 대체' — `/region`, `/resources`, `/academy`, `/authors`, `/pricing`, `/ask`, `/realestate/trust`,
 * `/news/cards`, 옛 정책 경로 — MIG-02). 사이트 안 주소(`/`로 시작)만 본다
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
  "/academy",
  "/authors",
  "/pricing",
  "/ask",
  "/realestate/trust",
  "/news/cards",
  "/editorial-policy",
  "/corrections",
  "/advertise",
  "/terms",
  "/privacy",
  "/no-email-collection",
] as const;

/** 주소의 경로 — 쿼리·조각·끝의 '/'를 뗀다 */
const pathOf = (href: string) => href.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
const isUnder = (path: string, prefix: string) => path.startsWith(`${prefix}/`);

export function isBlockedPath(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const path = pathOf(href);
  return BLOCKED_PREFIXES.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || isUnder(path, p)));
}

/**
 * 아직 없는 화면 — 설계 7장 '만들지 않는 경로' 중 기능 키가 없는 것: 많이 본 기사·동영상·포토(W2-c) · 용어사전(W2-d) · 내 화면·브리핑(W2-e) · 행사안내(01B W6).
 * 그 작업이 화면을 만들 때 이 목록에서 뺀다
 */
const UNBUILT_PREFIXES = ["/news/popular", "/news/video", "/news/photo", "/glossary", "/my", "/brief", "/local/events"] as const;
/** 정책 페이지 묶음(W2-e) — 공개 승인된 정책 페이지(POLICY_LINKS 주소 그대로)만 열린다 (HELP-05) */
const POLICY_ROOTS = ["/about", "/help"] as const;
/** 기능 키로 여는 화면 — 유틸 메뉴 화면과 그 아래(HOME-02) · 트래커 상세(01B W3) · 시·도·시·군·구 허브(01B W4). self = 그 주소 자체도 */
const FEATURE_PREFIXES: ReadonlyArray<{ prefix: string; feature: FeatureKey; self: boolean }> = [
  ...UTILITY_LINKS.map((u) => ({ prefix: u.href, feature: u.key, self: true })),
  // `/tax/amendments` 자체는 하위 분야 목록이다 (설계 9장 #28) — 트래커 상세 `/tax/amendments/[slug]`만
  { prefix: "/tax/amendments", feature: "amendments", self: false },
  // `/local`(허브)·`/local?topic=`은 그대로 — `/local/[sido](/[sigungu])`만
  { prefix: "/local", feature: "region_hubs", self: false },
];

/**
 * 사이트 안 주소가 지금 열린 화면인가 — 숨긴·v1.2 경로, 아직 없는 화면, 꺼진 기능의 화면이면 false (HOME-02 '빈 링크 0' · HELP-05 · ART-06).
 * 편집국이 손으로 쓴 링크(기사 문단·「지방세로 읽기」 박스)도 이 판정을 지난다. 바깥 주소는 true (판정 대상 아님)
 */
export function isOpenPath(href: string, features: Features): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return true;
  if (isBlockedPath(href)) return false;
  const path = pathOf(href);
  if (UNBUILT_PREFIXES.some((p) => path === p || isUnder(path, p))) return false;
  const policy = POLICY_LINKS.find((p) => p.href === path);
  if (policy) return features[policy.feature];
  if (POLICY_ROOTS.some((r) => path === r || isUnder(path, r))) return false;
  const gate = FEATURE_PREFIXES.find((g) => (g.self && path === g.prefix) || isUnder(path, g.prefix));
  return gate ? features[gate.feature] : true;
}

/** 기사 문단의 링크 표기 [글](주소) — 공개 데이터 함수(열린 화면만 링크로)와 화면(링크 조각)이 같은 표기를 읽는다 */
export const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export const newsHref = (slug: string) => `/news/${encodeURIComponent(slug)}`;
export const personHref = (slug: string) => `/people/${encodeURIComponent(slug)}`;
export const situationHref = (slug: string) => `/situations/${encodeURIComponent(slug)}`;
export const amendmentHref = (slug: string) => `/tax/amendments/${encodeURIComponent(slug)}`;
export const categoryHref = (section: SectionKey, slug: string) => (section === "local" ? SECTION_INFO.local.href : `${SECTION_INFO[section].href}/${encodeURIComponent(slug)}`);
