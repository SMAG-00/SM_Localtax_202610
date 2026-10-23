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

// 지자체 허브 블록(LG-08) ② 지방세·지방재정 ③ 부동산·개발 에 담는 편집 분야는 설정 local_block_fields가 정한다 (W4 4단계 — region-hub-logic.ts, 코드 상수에서 옮겼다)

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
  "popular_rules",
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
  // W2-c 4단계 — 동영상 목록 /news/video (동영상 채널 결정 전에는 꺼 둔다, PRD-01A 1.3)
  "video_list",
  // W2-d 3단계 — 용어사전 /glossary · /glossary/[번호] (GLO-01 — 공개 승인 전에는 꺼 둔다, W2-d 설계 2.5)
  "glossary",
  // W2-e 1단계 — 이용약관·이메일무단수집거부·광고·제휴 안내 페이지, 회원(/signup·/login·/my…), 브리핑 사전 알림(/brief…) (W2-e 설계 2.3 — 게시본·메일 설정이 없으면 켜지 못한다, 화면은 2단계 이후)
  "page_terms",
  "page_no_email",
  "page_advertise",
  "members",
  "brief",
  // W3 5단계 — 해석 해설 /tax/interpretations (원문 입력·세무 감수 뒤 공개 해설 1건 이상일 때만 켠다)
  "interpretations",
  // W3 6단계 — 칼럼 필자 체계 (의견 고지 문구 입력 + 필자 검증 1명 이상일 때만 켠다). 켜지면 모든 opinion 기사가 칼럼 발행 검사를 받는다
  "tax_columns",
  // W3 7단계 — 인물 페이지 역할별 블록(칼럼 목록·감수 기사 목록 — 동의서·증빙 약력이 있는 인물이 있어야 켠다)·브랜드 문구(감수·경력 승인 기록 뒤에만 켠다).
  // 동의서·증빙 검사 자체는 키와 상관없이 항상 한다 (W3 설계 2.4 · 12장 #12)
  "people_pages",
  "brand_copy",
  // W4 4단계 — 지자체 허브 ① 금주 핫뉴스·④ 행사안내(W6가 데이터·화면과 함께 켠다)·③ 정비사업 현황·⑤ 조례 원문 자리(3단계). W4 화면은 켜져도 그리는 것 0 (W4 설계 2.4)
  "weekly_digest",
  "local_events",
  "redevelopment_status",
  "ordinance_texts",
  // W4 15단계 — 프로젝트 트래커 /realestate/projects/[slug]·지역 허브 ③ 프로젝트 카드·검색 결과 프로젝트·확인된 연결의 프로젝트 링크
  // (사업 유형·단계 목록 감수 + 공개 프로젝트 1건 이상일 때 켠다 — W4 설계 2.4). 꺼지면 상세 404, 목록 /realestate/projects는 하위 분야 목록
  "realestate_projects",
  // W4 17단계 — 분양 정보 목록 /realestate/supply·지역 허브 ③ 분양 정보 카드·프로젝트 화면 분양 정보 (분양 광고 표시 기준 법률 검토 기록(12장 #12) + 공개 항목 1건 이상일 때 켠다 —
  // W4 설계 2.4). 꺼지면 /realestate/supply는 하위 분야 목록(W3 12장 #20과 같은 방식)·분양 정보 카드·공식 공고 링크 0
  "supply_notices",
  // W4 18단계 — 개발방법 비교 /realestate/development-methods* (화면은 19단계). 7개 방법의 비교 항목 6칸과 세무 감수 서명이 모두 있어야 켜진다 —
  // DB 저장 검사(…52 settings_dev_methods_flag_guard)와 운영 설정 화면이 같은 조건을 본다(W4 설계 2.4 · 12장 #153). 꺼지면 공개 뷰 0행
  "dev_methods",
  // W4 23단계 - 상속·증여 안내 (설계 2.4). 꺼지면 /realestate/inheritance-gift는 하위 분야 목록, /inheritance·/gift는 404, 링크 0
  "inheritance_gift",
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
  /** HOME-05 상담 사례 HOT — 해결 사례 카드 3장 + HOT 목록 5건 */
  hotCards: 3,
  hotList: 5,
} as const;

/**
 * 상담 사례 HOT(HOME-05)을 매기는 하위 분야 — 지방세 › 해석. PRD-00 5.3 '해석 … v1.2의 판례 해설·유권해석·상담 사례(하위 유형 해결 사례 CAT-05, HOT HOME-05)를 받는다'.
 * 1단계 하위 경로에 상담 사례 경로가 따로 없어(CAT-01) 이 분야 목록(/tax/interpretations)이 '상담 사례 분야 목록'이다 [확인 필요 — W2-c 설계 9장]
 */
export const HOT_CATEGORY = { section: "tax", slug: "interpretations" } as const satisfies { section: SectionKey; slug: string };

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
 * 아직 없는 화면 — 설계 7장 '만들지 않는 경로' 중 기능 키가 없는 것: 내 화면·브리핑(W2-e) · 행사안내(01B W6).
 * 그 작업이 화면을 만들 때 이 목록에서 뺀다 (많이 본 기사 /news/popular는 W2-c 2단계, 포토 목록 /news/photo는 W2-c 4단계가 만들어 뺐다 —
 * 동영상 목록 /news/video는 기능 키 video_list로, 용어사전 /glossary는 W2-d 3단계가 만들어 기능 키 glossary로 연다)
 */
const UNBUILT_PREFIXES = ["/local/events"] as const;
/** 용어사전 (W2-d 3단계 — GLO-01). 색인 /glossary · 용어 쪽 /glossary/[번호] */
export const GLOSSARY_HREF = "/glossary";
/** 형식별 목록 (W2-c 4단계 — ART-08 · ART-09). 기사 slug로 쓸 수 없는 예약 이름(ART-01) */
export const VIDEO_LIST_HREF = "/news/video";
export const PHOTO_LIST_HREF = "/news/photo";
/** 정책 페이지 묶음(W2-e) — 공개 승인된 정책 페이지(POLICY_LINKS 주소 그대로)만 열린다 (HELP-05) */
/** 고객센터 폼 화면 (W2-e 5단계 — 기사 제보 /help/report는 POLICY_LINKS가 먼저 판정한다) */
const HELP_FORM_PATHS = ["/help/report", "/help/subscribe", "/help/ad", "/help/contribute"] as const;
const POLICY_ROOTS = ["/about", "/help"] as const;
/** 기능 키로 여는 화면 — 유틸 메뉴 화면과 그 아래(HOME-02) · 트래커 상세(01B W3) · 시·도·시·군·구 허브(01B W4). self = 그 주소 자체도 */
const FEATURE_PREFIXES: ReadonlyArray<{ prefix: string; feature: FeatureKey; self: boolean }> = [
  ...UTILITY_LINKS.map((u) => ({ prefix: u.href, feature: u.key, self: true })),
  // `/tax/amendments` 자체는 하위 분야 목록이다 (설계 9장 #28) — 트래커 상세 `/tax/amendments/[slug]`만
  { prefix: "/tax/amendments", feature: "amendments", self: false },
  // `/local`(허브)·`/local?topic=`은 그대로 — `/local/[sido](/[sigungu])`만
  { prefix: "/local", feature: "region_hubs", self: false },
  // 프로젝트 트래커 (W4 15단계) — `/realestate/projects` 자체는 꺼져도 하위 분야 목록이다 — 상세 `/realestate/projects/[slug]`만
  { prefix: "/realestate/projects", feature: "realestate_projects", self: false },
  // 동영상 목록 (W2-c 4단계 — 동영상 채널 결정 전에는 닫힘)
  { prefix: VIDEO_LIST_HREF, feature: "video_list", self: true },
  // 용어사전 색인·용어 쪽 (W2-d 3단계 — 공개 승인 전에는 닫힘)
  { prefix: GLOSSARY_HREF, feature: "glossary", self: true },
  // 회원 화면 (W2-e — `members`, 가입·메일·약관·처리방침 게시본이 갖춰져야 열린다 — lib/policy/feature-open.ts)
  ...["/signup", "/login", "/forgot-password", "/reset-password", "/auth/confirm", "/my"].map((prefix) => ({ prefix, feature: "members" as const, self: true })),
  // 정책 문서 중 POLICY_LINKS에 없는 것 (이용약관 · 이메일무단수집거부 · 광고·제휴 안내)
  // 브리핑 사전 알림 (W2-e 6단계 — /brief · /brief/confirm · /brief/unsubscribe)
  { prefix: "/brief", feature: "brief" as const, self: true },
  { prefix: "/about/terms", feature: "page_terms", self: true },
  { prefix: "/about/no-email-collection", feature: "page_no_email", self: true },
  { prefix: "/about/advertise", feature: "page_advertise", self: true },
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
  const aboutPage = FEATURE_PREFIXES.find((g) => g.prefix.startsWith("/about/") && g.prefix === path);
  if (aboutPage) return features[aboutPage.feature];
  if ((HELP_FORM_PATHS as readonly string[]).includes(path)) return features.page_help;
  if (POLICY_ROOTS.some((r) => path === r || isUnder(path, r))) return false;
  const gate = FEATURE_PREFIXES.find((g) => (g.self && path === g.prefix) || isUnder(path, g.prefix));
  return gate ? features[gate.feature] : true;
}

/** 기사 문단의 링크 표기 [글](주소) — 공개 데이터 함수(열린 화면만 링크로)와 화면(링크 조각)이 같은 표기를 읽는다 */
export const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export const newsHref = (slug: string) => `/news/${encodeURIComponent(slug)}`;
export const personHref = (slug: string) => `/people/${encodeURIComponent(slug)}`;

// W3 7단계 브랜드 값 (docs/dev/W3_설계.md 2.1 — DB check·뷰와 같은 값, 시험이 표를 읽어 대조한다)
/** 증빙 종류 people_evidence.kind — 문서 · 공식 기록 · 회사 출판 이력 */
export const EVIDENCE_KINDS = ["document", "official_record", "publisher_history"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
/** 동의 범위 consent_doc.scope (BR-07) — 인물 페이지 · 칼럼 · 홈 · 외부 프로필 · 상품 · 광고 · 영상 */
export const CONSENT_SCOPES = ["profile_page", "column", "home", "external_profile", "product", "ad", "video"] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];
/** 동의서 상태 consent_doc.status (뷰 name_consent_docs가 계산) */
export const CONSENT_STATUSES = ["active", "withdrawn", "expired"] as const;
/** 감수 표시 상태 article_review_marks.state */
export const REVIEW_MARK_STATES = ["shown", "hidden_changed", "none"] as const;
export type ReviewMarkState = (typeof REVIEW_MARK_STATES)[number];
export const situationHref = (slug: string) => `/situations/${encodeURIComponent(slug)}`;
export const amendmentHref = (slug: string) => `/tax/amendments/${encodeURIComponent(slug)}`;
/** 제휴사 프로필 (ART-10) — 공개 제휴사 번호 */
export const partnerHref = (id: number) => `/partners/${id}`;
/** 용어사전 — 색인(분야 거르개 ?section=) · 용어 쪽 · 색인 화면의 용어 자리(id) */
export const glossaryIndexHref = (section: SectionKey | null) => (section ? `${GLOSSARY_HREF}?section=${section}` : GLOSSARY_HREF);
export const glossaryTermHref = (id: number | string) => `${GLOSSARY_HREF}/${encodeURIComponent(String(id))}`;
export const glossaryAnchor = (id: number | string) => `term-${id}`;
export const categoryHref = (section: SectionKey, slug: string) => (section === "local" ? SECTION_INFO.local.href : `${SECTION_INFO[section].href}/${encodeURIComponent(slug)}`);
