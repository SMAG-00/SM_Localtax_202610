// packages/seo-lint 공개 타입 — 점검 입력(ArticleForLint)·문맥·규칙 파일·결과 (PRD-01A OPT-03)
// 다른 패키지(packages/similarity · packages/structured-data)를 import하지 않는다 — 그 결과는 평범한 입력 칸으로 받는다.

/** 점검 4축 — PRD-01A §4.15 점검 표 · PRD_최종 §7.3 */
export const AXES = ["SEO", "AEO", "GEO", "공통"] as const;
export type Axis = (typeof AXES)[number];

/** 4대 분야 `articles.section` — tax(지방세) · realestate(부동산) · finance(부동산개발금융) · local(지자체뉴스) */
export type Section = "tax" | "realestate" | "finance" | "local";

/** `article_sources.kind` (PRD-01A 6.1) */
export type SourceKind = "official_doc" | "dataset" | "press_release" | "interview" | "field" | "photo" | "other";

/** `articles.label` — 없음 · 공동 기획 · 광고 (PRD-01A 6.1) */
export type AdLabel = "없음" | "공동 기획" | "광고";

/** packages/similarity 검사 결과 상태 (OPT-06). no_sources = 비교 원문 0건, no_body = 판정할 본문 0 — 둘 다 통과로 보지 않는다 */
export type SimilarityStatus = "blocked" | "pass" | "no_sources" | "no_body";

/** 날짜 한 벌 — 시각은 시간대가 붙은 ISO 8601(예: 2026-10-15T09:00:00+09:00). 수정일이 없으면 null */
export interface ArticleDates {
  /** 발행일 — 기록 값은 `first_published_at`(예약 발행 전이면 `publish_at`) */
  publishedAt: string | null;
  /** 실질 수정일 — 기록 값은 `substantive_updated_at`(= JSON-LD `dateModified`, OPT-07). 실질 수정이 없으면 null */
  updatedAt: string | null;
}

/** 편집자가 '핵심 주장'으로 표시한 문장 (OPT-03 — 근거는 `article_sources`·`article_evidence`의 ID) */
export interface CoreClaim {
  id: string;
  /** 핵심 주장 문장 */
  text: string;
  /** 이어 둔 근거 ID — `sources[].id` 또는 `evidence[].id`에 있어야 근거로 친다 */
  evidenceIds: readonly string[];
}

/** 공개 출처 (`article_sources`) — 핵심 주장 근거 · SEO 「공식 출처」 */
export interface SourceRef {
  id: string;
  kind: SourceKind;
  title: string;
}

/**
 * 점검 대상 원고 한 판. 편집기 미리보기 렌더와 같은 데이터에서 만든다.
 * 각 칸 설명 끝의 「」는 그 칸을 쓰는 점검 표 항목이다 (PRD-01A §4.15).
 */
export interface ArticleForLint {
  /** 기사 ID `articles.id` — canonical·제목 비교에서 자기 자신을 뺄 때 쓴다. SEO 「canonical·중복」 「고유 제목」 */
  id: string;
  /** 화면 제목 — SEO 「고유 제목」 */
  title: string;
  /** 메타 제목(`<title>`) — 공통 「광고 표기 일치」 (OPT-02: 광고·공동 기획 기사는 메타 제목에 화면과 같은 표기) */
  metaTitle: string;
  /** 메타 설명 — SEO 「메타 설명」 · 공통 「광고 표기 일치」 */
  metaDescription: string;
  /** canonical 절대 주소(https://…). 지정하지 않았으면 null — SEO **「canonical·중복」(차단)** · OPT-11 */
  canonical: string | null;
  /** 분야 — `tax`(지방세 분야)면 법령 기준일 필수 대상 (OPT-03). 대상 분야 목록은 규칙 파일 값 */
  section: Section;
  /** 세무 감수 대상(세금 계산·법률 주장이 있어 세무 감수 서명을 받는 기사, `editorial_reviews`) — 법령 기준일 필수 대상 (OPT-03) */
  taxReviewTarget: boolean;
  /** 「지방세로 읽기」 박스가 있음(`tax_lens`에 내용이 있음 — 생략 사유만 있으면 false, 01B CORE-01) — 법령 기준일 필수 대상 (OPT-03) */
  hasTaxLens: boolean;
  /** 법령 기준일 `legal_basis_date`(YYYY-MM-DD). 없으면 null — GEO **「법령 기준일」(차단, 대상 기사만)** */
  lawBasisDate: string | null;
  /** 저자(기자·필자) — `articles.author_id` → `people`. 이름과 인물 ID가 둘 다 있어야 저자로 친다 — GEO **「저자」(차단)** */
  authors: readonly { peopleId: string; name: string }[];
  /** 발행·수정일 — data(DB 기록 값)와 displayed(화면 `<time datetime>` 값, 날짜만 보이면 YYYY-MM-DD) — GEO **「발행/수정일」(차단)** */
  dates: { data: ArticleDates; displayed: ArticleDates };
  /** 핵심 주장 — GEO **「핵심 주장마다 근거」(차단)** */
  claims: readonly CoreClaim[];
  /** 공개 출처 `article_sources` — 핵심 주장 근거 · SEO 「공식 출처」 */
  sources: readonly SourceRef[];
  /** 비공개 취재 근거 `article_evidence`의 ID — 핵심 주장 근거로만 쓴다 (NAV-12) */
  evidence: readonly { id: string }[];
  /** packages/structured-data의 렌더 값 ↔ JSON-LD 대조 결과 — 다른 칸 이름 목록(빈 배열 = 일치) — 공통 **「구조화 데이터와 화면 일치」(차단)** (OPT-02) */
  structuredDataMismatches: readonly string[];
  /** packages/similarity 결과 — 공통 **「유사도」(차단)** (OPT-06) */
  similarity: { status: SimilarityStatus };
  /** 광고 표기 — 공통 **「광고 표기 일치」(차단)** (OPT-02) */
  sponsorship: {
    /** `articles.label` */
    label: AdLabel;
    /** 화면 제휴 배지 글자(배지가 없으면 null) */
    pageBadge: string | null;
    /** packages/structured-data가 만든 JSON-LD `headline` 값 */
    structuredHeadline: string;
  };
  /** 본문 소제목(문서 순서, level 2~4) — AEO 「질문형 소제목」 */
  headings: readonly { level: number; text: string }[];
  /** 본문에서 자사 페이지로 가는 링크 수(같은 주소는 한 번) — SEO 「내부 링크 2개 이상」 */
  internalLinkCount: number;
  /** 본문 이미지 — SEO 「이미지 대체 텍스트」 */
  images: readonly { alt: string }[];
  /** 핵심 요약 상자 줄 — AEO 「3줄 요약」 */
  summaryBoxLines: readonly string[];
  /** 화면에 보이는 FAQ 블록 항목(숨김 FAQ는 저장되지 않는다, OPT-10) — AEO 「FAQ 2~5개(화면 노출)」 */
  faqs: readonly { question: string; answer: string }[];
}

/** 점검 문맥 — 원고 바깥에서 가져오는 값 */
export interface LintContext {
  /** 공개 중인 다른 기사 — canonical 중복·고유 제목 비교 대상. 원고와 같은 id는 자기 자신이라 뺀다 */
  publishedArticles: readonly { id: string; canonical: string; title: string }[];
}

/** 규칙 하나 (rules/rules.v*.json) */
export interface RuleDef {
  /** 규칙 ID — 엔진의 점검 함수와 1:1 */
  id: string;
  axis: Axis;
  /** 위반 때 등급 — block 발행 차단 · warn 발행 가능(발행 기록에 남음) */
  level: "block" | "warn";
  /** 검사할 비교 대상이 없을 때 등급 (유사도 '비교 대상 없음' — OPT-06). 그 상태를 낼 수 있는 규칙만 둔다 */
  unverifiedLevel?: "block" | "warn";
  /** 항목 이름 — 패널 항목 이름이자 발행 API 422의 실패 항목 이름 */
  name: string;
  /** 축 점수 가중치(양의 정수) */
  weight: number;
  /** 근거 PRD 항목 */
  source: string;
  /** 기준값 — 점검 함수마다 정해진 이름 */
  params: Readonly<Record<string, unknown>>;
  /** 문구 — 키는 점검 함수가 정한다. {이름}은 엔진이 채운다 */
  messages: Readonly<Record<string, string>>;
}

/** 검사를 마친 규칙 파일 (parseRules 결과) */
export interface RuleSet {
  version: string;
  axes: readonly Axis[];
  rules: readonly RuleDef[];
}

export type ItemLevel = "block" | "warn" | "pass";

export interface LintItem {
  id: string;
  axis: Axis;
  name: string;
  level: ItemLevel;
  message: string;
  /** false = 이 원고에는 해당 없음(법령 기준일 비대상 기사 등) — 점수 계산에서 뺀다 */
  applicable: boolean;
}

export interface LintResult {
  /** 규칙 파일 version — `seo_checks.rules_version` */
  ruleVersion: string;
  /** 엔진 버전(package.json version) — `seo_checks.engine_version` */
  engineVersion: string;
  /** 축별 0~100 정수 — 내부 품질 지표 */
  scores: Record<Axis, number>;
  /** 규칙 파일 순서 */
  items: LintItem[];
  /** 차단 항목 ID — `seo_checks.blocking_failures[]` */
  blockers: string[];
  /** 경고 항목 ID — `seo_checks.warnings[]` */
  warnings: string[];
  canPublish: boolean;
}

/** 견본 원고 (fixtures/) — 원고 + 문맥 + 어기는 차단 규칙 */
export interface LintSample {
  id: string;
  description: string;
  /** 이 견본이 어기는 차단 규칙 ID 하나 (통과 견본은 null) */
  violates: string | null;
  article: ArticleForLint;
  context: LintContext;
}

export interface PublishDecision {
  allowed: boolean;
  httpStatus: 200 | 422;
  /** 남은 차단 항목 이름 (OPT-03 — 발행 API 422와 실패 항목 이름) */
  failed: string[];
  /** 발행 기록에 남길 경고 항목 ID (`seo_checks.published_with_warnings`) */
  warnings: string[];
}
