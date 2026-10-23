// 발행 판정 입력 모델 — 기사 한 판(ArticleForPublish)과 판정 문맥(PublishContext).
// 값 목록은 docs/dev/W2-a_설계.md §2와 같고(DB check 제약과 같은 값), 칸 이름은 PRD-01A 6.1 컬럼의 camelCase다.
// 다른 워크스페이스 패키지를 import하지 않는다 — seo-lint·similarity 결과는 PublishContext의 평범한 칸으로 받는다.

/** 4대 분야 `articles.section` — 지방세 · 부동산 · 부동산개발금융 · 지자체뉴스 */
export const SECTIONS = ["tax", "realestate", "finance", "local"] as const;
export type Section = (typeof SECTIONS)[number];

/** `articles.content_type` */
export const CONTENT_TYPES = ["reported_news", "explainer", "guide", "opinion", "sponsored", "digest"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** `articles.reporting_method` — reported_news만 */
export const REPORTING_METHODS = ["quantitative", "qualitative", "mixed"] as const;
export type ReportingMethod = (typeof REPORTING_METHODS)[number];

/** `articles.format` */
export const FORMATS = ["general", "cardnews", "infographic", "video", "photo"] as const;
export type ArticleFormat = (typeof FORMATS)[number];

/** `articles.label` — 없음 · 공동 기획 · 광고 (하나만) */
export const LABELS = ["none", "co_planned", "ad"] as const;
export type Label = (typeof LABELS)[number];

/** `articles.subtype` */
export const SUBTYPES = ["general", "solved_case"] as const;
export type Subtype = (typeof SUBTYPES)[number];

/** `articles.update_kind` — 실질 수정 · 오탈자 · 정정 (ART-05) */
export const UPDATE_KINDS = ["substantive", "typo", "correction"] as const;
export type UpdateKind = (typeof UPDATE_KINDS)[number];

/** `article_sources.kind` — W2-a 7개 + `sponsor_material`(시행사·분양대행사가 준 분양 홍보 원고 — 이 출처가 있는 기사는 sponsored로만 발행, 01B PR-04 · W4 17단계) */
export const SOURCE_KINDS = ["official_doc", "dataset", "press_release", "interview", "field", "photo", "other", "sponsor_material"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** 공공누리 유형 `article_sources.license_type` · `media.license_type` (W4 설계 2.1 — PR-07). 제1~4유형 · 미표시 · 해당 없음(자체 촬영·자체 제작) */
export const LICENSE_TYPES = ["kogl_1", "kogl_2", "kogl_3", "kogl_4", "unmarked", "not_applicable"] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

/** 공식 자료 — 발표일·기준일·지역 단위·수집일·확인일·공공누리 유형이 모두 있어야 그 자료를 쓴 기사가 발행된다 (REG1-09) */
export const OFFICIAL_SOURCE_KINDS = ["official_doc", "dataset"] as const satisfies readonly SourceKind[];
/** 공공누리 유형이 필수인 출처 종류 — 공식 자료·보도자료·사진 (PR-07) */
export const LICENSE_REQUIRED_KINDS = ["official_doc", "dataset", "press_release", "photo"] as const satisfies readonly SourceKind[];
/** 공식 자료 종류 허용 목록 씨앗 `settings.official_source_types` (W4 설계 2.1 — REG1-07): 조례 · 고시 · 예산/결산 · 지방세 세수 · 부동산 거래/공시 · 정비/개발 */
export const OFFICIAL_SOURCE_TYPES = ["ordinance", "notice", "budget_settlement", "local_tax_revenue", "realestate_transaction", "redevelopment"] as const;
/** 차단 4종 — 교통 · 관광(명소) · 음식점 · 생활 안내. 출처에도 설정에도 넣을 수 없다 (REG1-07 코드 고정 — DB 트리거와 같다) */
export const BLOCKED_OFFICIAL_SOURCE_TYPES = ["transport", "tourism", "restaurant", "living_guide"] as const;
/** 이 자료를 쓴 해설(explainer·guide)은 세무 감수 승인이 있어야 발행된다 — 고시 · 조례 (REG1-07) */
export const TAX_REVIEW_SOURCE_TYPES = ["notice", "ordinance"] as const;
/** 설정으로도 열 수 없는 공공누리 유형 — 제4유형 · 미표시 (PR-07 코드 고정 — 링크·요약만) */
export const KOGL_NEVER = ["kogl_4", "unmarked"] as const satisfies readonly LicenseType[];

/** 공공누리 이용 범위 `settings.kogl_usage` — photoTypes 게시하는 사진 유형 · fullTextTypes 원문 본문을 옮겨도 되는 유형 */
export interface KoglUsage {
  photoTypes: readonly LicenseType[];
  fullTextTypes: readonly LicenseType[];
}
/** W4 12장 #13 권고 기본값(설정 씨앗과 같다) — 사진은 제1유형·자체 촬영만, 원문 전재는 모든 유형 0. 설정을 못 읽으면 이 값(가장 닫힌 쪽) */
export const KOGL_USAGE_DEFAULT: KoglUsage = { photoTypes: ["kogl_1", "not_applicable"], fullTextTypes: [] };

/** 공공누리 유형 배지 글자 — 공식 자료 카드·사진 출처 줄 (PR-07 '자료 카드에 유형별 출처 표시') */
export const LICENSE_TYPE_LABELS: Readonly<Record<LicenseType, string>> = {
  kogl_1: "공공누리 제1유형 (출처표시)",
  kogl_2: "공공누리 제2유형 (출처표시·상업적 이용금지)",
  kogl_3: "공공누리 제3유형 (출처표시·변경금지)",
  kogl_4: "공공누리 제4유형 (출처표시·상업적 이용금지·변경금지)",
  unmarked: "공공누리 표시 없음",
  not_applicable: "공공누리 해당 없음",
};

/** 편집 분야 `articles.editorial_field` (W2-a 값 — 지자체 허브 분야 필터 `topic`과 같다, REG1-17): 지방세 · 부동산 세금 · 지방재정 · 도시/부동산 정책 */
export const EDITORIAL_FIELDS = ["local_tax", "realestate", "local_finance", "urban_policy"] as const;
export type EditorialField = (typeof EDITORIAL_FIELDS)[number];
/** 소재 종류 `articles.subject_kind` (W4 설계 2.1 — REG1-17): 일반 · 축제 · 명소 · 상권 */
export const SUBJECT_KINDS = ["general", "festival", "attraction", "commerce"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];
/** 관계 유형 + 근거가 있어야 기사 후보가 되는 소재 — 축제 · 명소 · 상권 (REG1-17) */
export const RELATION_SUBJECT_KINDS = ["festival", "attraction", "commerce"] as const satisfies readonly SubjectKind[];
/** 관계 유형 `articles.relation_types` (W4 설계 2.1 · 12장 #9 — PRD 6종): 예산 · 세수 · 공유재산 · 개발 · 거래 · 주거 영향 */
export const RELATION_TYPES = ["budget", "tax_revenue", "public_property", "development", "transaction", "housing"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
/** 편집자 판정 `articles.editorial_judgement` (W4 설계 2.1 — REG1-17): 기사 후보 · 여행 후기 · 맛집 추천 · 행사 홍보 */
export const EDITORIAL_JUDGEMENTS = ["news_candidate", "travel_review", "restaurant_pick", "event_promo"] as const;
export type EditorialJudgement = (typeof EDITORIAL_JUDGEMENTS)[number];
/** 뉴스·자체 취재 기사로 발행하지 않는 판정 — 여행 후기 · 맛집 추천 · 행사 홍보 (보류 또는 별도 상품 검토 큐) */
export const NON_NEWS_JUDGEMENTS = ["travel_review", "restaurant_pick", "event_promo"] as const satisfies readonly EditorialJudgement[];
/** 비보도 판정 원고로 발행할 수 없는 기사 유형 — 보도기사 · 해설 (REG1-17) */
export const NON_NEWS_BLOCKED_TYPES = ["reported_news", "explainer"] as const satisfies readonly ContentType[];
/** 지역 기사 편집 승인(desk_edit) checklist 3항목 (W4 설계 2.1 regional_review.checklist): 근거 · 관계 · 광고 독립성 */
export const REGIONAL_DESK_CHECKLIST = ["evidence", "relation", "ad_independence"] as const;
export type RegionalDeskCheck = (typeof REGIONAL_DESK_CHECKLIST)[number];

export const EDITORIAL_FIELD_NAMES: Readonly<Record<EditorialField, string>> = {
  local_tax: "지방세",
  realestate: "부동산 세금",
  local_finance: "지방재정",
  urban_policy: "도시·부동산 정책",
};
export const SUBJECT_KIND_LABELS: Readonly<Record<SubjectKind, string>> = { general: "일반", festival: "축제", attraction: "명소", commerce: "상권" };
export const RELATION_TYPE_LABELS: Readonly<Record<RelationType, string>> = {
  budget: "예산",
  tax_revenue: "세수",
  public_property: "공유재산",
  development: "개발",
  transaction: "거래",
  housing: "주거 영향",
};
export const EDITORIAL_JUDGEMENT_LABELS: Readonly<Record<EditorialJudgement, string>> = {
  news_candidate: "기사 후보",
  travel_review: "여행 후기",
  restaurant_pick: "맛집 추천",
  event_promo: "행사 홍보",
};
export const REGIONAL_DESK_CHECKLIST_LABELS: Readonly<Record<RegionalDeskCheck, string>> = {
  evidence: "근거 — 지역 수치·주장마다 공식 자료·취재 근거를 확인했습니다",
  relation: "관계 — 소재와 지방세·지방재정·부동산·도시정책의 관계가 검증 가능합니다",
  ad_independence: "광고 독립성 — 광고·협찬 관계가 기사 판단에 영향을 주지 않았습니다",
};

/**
 * 판정 책임자가 있는 편집 분야 `settings.regional_judge_fields` 씨앗 (W4 12장 #7 권고안 — 편집 책임자 역할이 네 분야 모두 판정).
 * 목록에 없는 분야의 지역 기사는 보류(held) — 설정을 못 읽으면 판정 입력이 빈 목록(가장 닫힌 쪽)을 넘긴다
 */
export const REGIONAL_JUDGE_FIELDS_DEFAULT: readonly EditorialField[] = EDITORIAL_FIELDS;

/** 별도 상품 검토 큐 상태 `separate_product_queue.status` (W4 설계 2.1 — REG1-14·17): 열림 · 닫힘. 열린 항목이 있는 원고는 공개되지 않는다 */
export const SEPARATE_PRODUCT_STATUSES = ["open", "closed"] as const;
export type SeparateProductStatus = (typeof SEPARATE_PRODUCT_STATUSES)[number];
export const SEPARATE_PRODUCT_STATUS_LABELS: Readonly<Record<SeparateProductStatus, string>> = { open: "검토 중", closed: "닫힘" };

/** 오래된 통계 경고 기준 `settings.stale_statistics_days` 씨앗 (W4 설계 2.2 · 2.3 · 12장 #23 — 365일, 기준 당일 0건·하루 넘김 1건) */
export const STALE_STATISTICS_DAYS_DEFAULT = 365;
export const STALE_STATISTICS_DAYS_MIN = 1;
export const STALE_STATISTICS_DAYS_MAX = 3650;
/** 통계로 보는 공식 자료 종류 — 자료(dataset)는 모두, 공식 문서는 예산/결산 · 지방세 세수 · 부동산 거래/공시만 (REG1-14 오래된 통계 경고) */
export const STATISTICS_SOURCE_TYPES = ["budget_settlement", "local_tax_revenue", "realestate_transaction"] as const satisfies readonly (typeof OFFICIAL_SOURCE_TYPES)[number][];

/** `article_evidence.evidence_type` (NAV-12) */
export const EVIDENCE_TYPES = ["dataset", "document", "interview", "field", "photo", "calculation"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** `editorial_reviews.kind` — 편집 승인 · 세무 감수 · 협찬 확인 */
export const REVIEW_KINDS = ["desk_edit", "tax_review", "sponsor_check"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/** `editorial_reviews.decision` */
export const REVIEW_DECISIONS = ["approve", "reject", "hold"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** `article_interviews.quote_consent` */
export const QUOTE_CONSENTS = ["full", "partial", "none"] as const;
export type QuoteConsent = (typeof QUOTE_CONSENTS)[number];

/** `article_interviews.anonymity` */
export const ANONYMITIES = ["named", "anonymous"] as const;
export type Anonymity = (typeof ANONYMITIES)[number];

/**
 * 권리 확인 상태 — `article_sources.rights_status` · `article_evidence.rights_status` · `media`의 권리 확인.
 * PRD 6.1은 값 목록을 정하지 않았다 — 판정은 `confirmed`만 '확인됨'으로 본다 (W2-a 설계 §2에 더할 값).
 */
// DB 값과 같다 — article_evidence: unconfirmed·confirmed·restricted, media: unconfirmed·confirmed·rejected
export const RIGHTS_STATUSES = ["unconfirmed", "confirmed", "restricted", "rejected"] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

/** `article_evidence.verification_status` — PRD 6.1에 값 목록이 없어 판정은 `verified`만 검증됨으로 본다 */
// DB 값과 같다 — article_evidence.verification_status
export const VERIFICATION_STATUSES = ["pending", "verified", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** 지역 정책 쟁점의 관점 3종 (NAV-11) — 지자체 · 주민/납세자 · 전문가 */
export const PERSPECTIVE_KEYS = ["local_gov", "residents_taxpayers", "experts"] as const;
export type PerspectiveKey = (typeof PERSPECTIVE_KEYS)[number];

/** 「지방세로 읽기」 링크 종류 (01B CORE-01) — 해설 · 계산기 · 도서 · 전문가 */
export const TAX_LENS_LINK_KINDS = ["explainer", "calculator", "book", "expert"] as const;
export type TaxLensLinkKind = (typeof TAX_LENS_LINK_KINDS)[number];

/** 콜아웃(상태 상자) 종류 — 정보(blue) · 절세 체크포인트(emerald) · 주의(amber) · 자주 틀리는 점(rose, PRD-00 8.6·R9) */
export const CALLOUT_KINDS = ["info", "tip", "caution", "mistake"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/**
 * 해결 사례 결과의 결론 배지 (CAT-05 · PRD-00 8.6 '결과(결론 배지)') — 인용 · 일부 인용 · 기각 · 각하 · 해석.
 * 인용·기각·각하는 결정례 카드와 같은 뜻(8.6), 일부 인용은 인용 쪽, 해석은 결정례가 아니라 유권해석·예규로 결론이 난 사례다
 */
export const SOLVED_CASE_CONCLUSIONS = ["accepted", "partial", "rejected", "dismissed", "interpretation"] as const;
export type SolvedCaseConclusion = (typeof SOLVED_CASE_CONCLUSIONS)[number];

/** 카드뉴스 장 수 (ART-03 — 5~7장, 4장·8장은 발행 불가) */
export const CARDNEWS_SLIDES = { min: 5, max: 7 } as const;

/** 인포그래픽 템플릿 (ART-07 '템플릿 3종') — 절차 흐름 · 비교 · 핵심 숫자 */
export const INFOGRAPHIC_TEMPLATES = ["flow", "compare", "numbers"] as const;
export type InfographicTemplate = (typeof INFOGRAPHIC_TEMPLATES)[number];

/**
 * 동영상 썸네일 비율 (ART-08 '썸네일 16:9 원본 비율') — 가로÷세로가 16÷9에서 1% 안이면 16:9로 본다(1920×1080 · 1280×720 · 854×480).
 * 자르지 않고 원본 비율로 보이므로 그림 자체가 16:9여야 한다 (W2-c 설계 9장)
 */
export const VIDEO_THUMBNAIL_RATIO = { width: 16, height: 9, tolerance: 0.01 } as const;

/** 본문 블록 종류 (ART-01) */
export const BLOCK_TYPES = [
  "paragraph",
  "table",
  "image",
  "quote",
  "callout",
  "infographic",
  "video",
  "faq",
  "key_summary",
  "slide",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

// ── 본문 블록 ───────────────────────────────────────────────

/** 블록마다 붙는 편집자 확인 항목 */
export interface BlockChecklist {
  /** UX-03 '할 일을 함께 썼다' — '기한'·'가산세'가 든 블록은 체크해야 발행된다 */
  actionWritten?: boolean;
}

interface BlockBase {
  checklist?: BlockChecklist;
}

/** 그래프·표의 축/단위/출처 표기 (NAV-10 「그래프·표 표기」) */
export interface ChartLabels {
  axis: string;
  unit: string;
  source: string;
}

export interface ParagraphBlock extends BlockBase {
  type: "paragraph";
  text: string;
}

export interface TableBlock extends BlockBase {
  type: "table";
  caption: string;
  rows: readonly (readonly string[])[];
  /** 축/단위/출처. 표기하지 않았으면 null */
  chart: ChartLabels | null;
}

export interface ImageBlock extends BlockBase {
  type: "image";
  mediaId: string;
  alt: string;
  caption: string;
  /** `media`의 권리 확인 (NAV-04 사진 권리) */
  rightsStatus: RightsStatus;
  /** `media.license_type` (PR-07) — 판정 입력이 media 표에서 채운다. 없으면 null */
  licenseType?: LicenseType | null;
  /**
   * `media`의 출처(credit)·이용 조건(license)·대체 텍스트(alt) — 판정 입력이 media 표에서 채운다(저장하지 않는다).
   * 포토 기사(ART-09)는 사진마다 셋이 있어야 발행된다. 없으면(undefined·null·빈 글자) 빈 것으로 본다
   */
  credit?: string | null;
  license?: string | null;
  mediaAlt?: string | null;
}

export interface QuoteBlock extends BlockBase {
  type: "quote";
  text: string;
  /** 화면에 보이는 발언자 표기 */
  speaker: string;
  /** interview = 취재원 발언(`article_interviews` 기록 필수) · document = 문서 인용(출처·문서 근거 필수) */
  origin: "interview" | "document";
  /** interview면 `article_interviews.evidence_id`, document면 `sources[].id` 또는 문서 근거 `evidence[].id` */
  refId: string | null;
}

export interface CalloutBlock extends BlockBase {
  type: "callout";
  kind: CalloutKind;
  title: string;
  text: string;
}

/**
 * 그림과 같은 내용 (ART-07 '같은 내용의 표·목록') — 그림만으로 정보를 전하지 않는다 (PRD-00 8.9).
 * 표 = 머리 칸(columns) + 내용 행(rows, 행마다 머리 칸 수만큼) · 목록 = 항목 글자들
 */
export type InfographicData =
  | { kind: "table"; columns: readonly string[]; rows: readonly (readonly string[])[] }
  | { kind: "list"; items: readonly string[] };

export interface InfographicBlock extends BlockBase {
  type: "infographic";
  mediaId: string;
  /** 대체 텍스트 — 없으면 저장 불가 (ART-07) */
  alt: string;
  caption: string;
  rightsStatus: RightsStatus;
  /** `media.license_type` (PR-07) — 판정 입력이 media 표에서 채운다. 없으면 null */
  licenseType?: LicenseType | null;
  chart: ChartLabels | null;
  /** 템플릿 — 절차 흐름 · 비교 · 핵심 숫자 */
  template: InfographicTemplate;
  /** 같은 내용의 표·목록 — 없으면(null) 저장 불가, 발행 판정도 막는다 */
  data: InfographicData | null;
}

/** 동영상 썸네일의 media 기록 — 판정 입력이 media 표에서 채운다(저장하지 않는다). 크기를 모르면 null */
export interface ThumbnailFacts {
  rightsStatus: RightsStatus;
  /** `media.license_type` (PR-07) — 없으면 null */
  licenseType?: LicenseType | null;
  width: number | null;
  height: number | null;
}

/**
 * 동영상 블록 (ART-08) — 유튜브 개인정보 보호 주소(youtube-nocookie.com/embed/영상번호)만, 누른 뒤에 플레이어를 불러온다.
 * 썸네일은 media에 저장한 16:9 이미지, 요약 텍스트(영상 내용을 글로)와 편집자의 '자막 있음' 확인이 있어야 발행된다
 */
export interface VideoBlock extends BlockBase {
  type: "video";
  embedUrl: string;
  caption: string;
  /** 요약 텍스트 — 영상을 보지 않아도 내용을 알 수 있게 (접근성) */
  summary: string;
  /** 편집자가 영상에 자막이 있는지 확인했다 */
  captions: boolean;
  /** 썸네일 media 번호 */
  thumbnailMediaId: string | null;
  /** 재생 시간(초) — 모르면 null (카드에 표기하지 않는다) */
  durationSeconds: number | null;
  /** 썸네일 media의 권리·크기 (판정 입력이 채운다) */
  thumbnail?: ThumbnailFacts | null;
}

export interface FaqBlock extends BlockBase {
  type: "faq";
  items: readonly { question: string; answer: string }[];
}

/** 핵심 요약 상자 — 줄마다 한 문장 */
export interface KeySummaryBlock extends BlockBase {
  type: "key_summary";
  lines: readonly string[];
}

/**
 * 카드뉴스 한 장 (ART-03) — 글자는 이미지가 아니라 HTML 글자다(검색·화면 읽기). 형식이 카드뉴스인 기사에만 쓴다.
 * alt = 장마다 대체 텍스트 — 장의 그림·배치를 글로 설명한다(화면 읽기 프로그램이 장 이름으로 읽는다). 없으면 발행 불가
 */
export interface SlideBlock extends BlockBase {
  type: "slide";
  title: string;
  text: string;
  alt: string;
}

export type ArticleBlock =
  | ParagraphBlock
  | TableBlock
  | ImageBlock
  | QuoteBlock
  | CalloutBlock
  | InfographicBlock
  | VideoBlock
  | FaqBlock
  | KeySummaryBlock
  | SlideBlock;

/** 편집자가 '핵심 주장'으로 표시한 문장과 근거 ID (ART-01 · OPT-03) */
export interface CoreClaim {
  id: string;
  text: string;
  /** fact = 사실 · tax_calculation = 세금 계산 · legal = 법률 주장 — 뒤의 둘은 세무 감수 서명 대상 (NAV-12) */
  kind: "fact" | "tax_calculation" | "legal";
  /** `sources[].id` 또는 `evidence[].id` */
  evidenceIds: readonly string[];
  /** 그 문장이 있는 블록 (없으면 null) */
  blockIndex: number | null;
}

// ── 연결 표 ─────────────────────────────────────────────────

/** 공개 출처 `article_sources` */
export interface ArticleSource {
  id: string;
  kind: SourceKind;
  title: string;
  url: string | null;
  provider: string | null;
  accessedAt: string | null;
  rightsStatus: RightsStatus;
  /** 공공누리 유형 (PR-07) — 공식 자료·보도자료·사진은 필수. 없으면 null(빈 것) */
  licenseType?: LicenseType | null;
  /** 공식 자료 종류 (REG1-07 — 허용 목록 값). 비면 검사하지 않는다(법령 출처 등) */
  sourceType?: string | null;
  /** 발표일 · 기준일 YYYY-MM-DD, 지역 단위, 수집일 (REG1-09 — 공식 자료는 필수) */
  publishedOn?: string | null;
  referenceDate?: string | null;
  regionUnit?: string | null;
  collectedAt?: string | null;
}

/** 비공개 취재 근거 `article_evidence` (NAV-12) */
export interface ArticleEvidence {
  id: string;
  articleVersion: number;
  evidenceType: EvidenceType;
  location: string;
  rightsStatus: RightsStatus;
  verifiedAt: string | null;
  ownerId: string | null;
  retentionUntil: string | null;
  verificationStatus: VerificationStatus;
}

/** 정량형 재현 정보 `article_datasets` (NAV-10). 빈 칸은 null 또는 빈 글자 */
export interface ArticleDataset {
  evidenceId: string;
  definition: string | null;
  period: string | null;
  unit: string | null;
  regionUnit: string | null;
  denominator: string | null;
  exclusions: string | null;
  transform: string | null;
  reproFileHash: string | null;
  provider: string | null;
  sourceUrl: string | null;
  collectedAt: string | null;
  license: string | null;
}

/** 인터뷰 기록 `article_interviews` (NAV-11) — 연락처·녹취 원문은 넣지 않고 보존 위치만 */
export interface ArticleInterview {
  evidenceId: string;
  subjectRole: string;
  contactedAt: string | null;
  recordLocation: string | null;
  quoteConsent: QuoteConsent | null;
  anonymity: Anonymity;
  anonymityReason: string | null;
}

/** 승인 기록 `editorial_reviews` */
export interface EditorialReview {
  kind: ReviewKind;
  decision: ReviewDecision;
  reviewerUserId: string;
  /** 서명 시각(ISO 8601). 서명 전이면 null — 승인으로 세지 않는다 */
  signedAt: string | null;
  /** 승인한 기사 버전 `editorial_reviews.version` — 현재 버전과 같아야 승인으로 센다 */
  forVersion: number;
  /** 확인 항목 `editorial_reviews.checklist` — 지역 기사 편집 승인은 근거·관계·광고 독립성 3항목이 true여야 한다 (REG1-17) */
  checklist?: Readonly<Record<string, unknown>> | null;
}

/**
 * 지역 기사 편집 게이트 입력 (REG1-17 — W4 7단계). 판정 입력(`lib/server/articles/mapping.ts`)이 기사 칸·partners에서 채운다.
 * 없으면(undefined) 지역 태그 0·편집 분야 없음·소재 일반으로 본다
 */
export interface RegionalFacts {
  /** 지역 태그 `region_codes` (법정동코드) */
  regionCodes: readonly string[];
  editorialField: EditorialField | null;
  publicQuestion: string | null;
  subjectKind: SubjectKind;
  relationTypes: readonly RelationType[];
  judgement: EditorialJudgement | null;
  /** 원고가 다룬 제휴사 중 광고·협찬 계약 기록이 있는 곳 (`covered_partner_ids` × partners 계약 기간) */
  contractedPartners: readonly { id: string; name: string }[];
  /** 이해관계 표시 `interest_disclosure` (NAV-06) */
  interestDisclosure: string | null;
}

/** 「지방세로 읽기」 `articles.tax_lens` (01B CORE-01) */
export interface TaxLens {
  /** 관련 세목 */
  topics: readonly string[];
  /** 핵심 포인트 — 1~3줄 */
  points: readonly string[];
  links: readonly { kind: TaxLensLinkKind; label: string; url: string }[];
  /** 생략 사유 `skip_reason` — 박스 대신 남긴다 */
  omissionReason: string | null;
  /** 박스 문장의 세무 감수 서명 여부 */
  reviewed: boolean;
  /** 감수한 기사 버전 — 현재 버전보다 낮으면 '재감수 필요' */
  reviewedForVersion: number | null;
}

/** 해결 사례 `articles.solved_case` (CAT-05) — 상황 → 쟁점 → 결과 → 교훈 */
export interface SolvedCase {
  situation: string;
  issue: string;
  result: string;
  lesson: string;
  /** 결과의 근거 — 결정례 사건번호 또는 해석 번호 + 출처 링크 */
  resultEvidence: readonly { kind: "decision" | "interpretation"; number: string; url: string }[];
  /** 결과의 결론 배지 — 없으면(null) 발행 불가 (결과 칸의 일부, PRD-00 8.6) */
  conclusion: SolvedCaseConclusion | null;
}

/** 제휴사 `partners` — 계약 종료일 `contract_to`(YYYY-MM-DD, 그날까지 유효). null이면 종료일 없음 */
export interface PartnerRef {
  id: string;
  name: string;
  contractFrom: string | null;
  contractTo: string | null;
}

/** 하위 분야 `categories` — slug와 면책 대상 여부 (CAT-01) */
export interface ArticleCategory {
  slug: string;
  needsDisclaimer: boolean;
}

/** 대표 이미지 */
export interface LeadImage {
  mediaId: string;
  alt: string;
  rightsStatus: RightsStatus;
  /** `media.license_type` (PR-07) — 없으면 null */
  licenseType?: LicenseType | null;
}

/** 정량형 확인 목록 (NAV-10) — 비면 null 또는 빈 글자 */
export interface QuantitativeChecklist {
  /** 기자의 원자료 대조 기록 */
  sourceCrossCheck: string | null;
  /** 수치가 말하지 않는 한계 */
  limitations: string | null;
  /** 관련 기관·전문가 확인 기록 */
  relatedPartyCheck: string | null;
  /** 편집자 확인 '인과 단정 없음' */
  noCausalClaim: boolean;
}

/** 정성형 확인 목록 (NAV-11) — 비면 null 또는 빈 글자 */
export interface QualitativeChecklist {
  /** 취재 질문 */
  interviewQuestions: string | null;
  /** 현장 확인 기록 */
  fieldRecord: string | null;
  /** 반대/보완 관점 */
  counterPerspective: string | null;
  /** 이해관계 확인 (없으면 '없음'이라고 적는다) */
  conflictsOfInterest: string | null;
}

/** 지역 정책 쟁점의 관점별 기록 — 취재 기록(근거 ID) 또는 '접촉했으나 응답 없음'(접촉일) */
export interface PerspectiveRecord {
  status: "interviewed" | "no_response";
  evidenceId: string | null;
  contactedAt: string | null;
}

/** 발행 판정 입력 — 기사 한 판 */
export interface ArticleForPublish {
  id: string;
  slug: string;
  /** 현재 버전 — 승인·감수는 이 버전에 대한 것만 센다 */
  version: number;
  title: string;
  summary: string;
  blocks: readonly ArticleBlock[];
  claims: readonly CoreClaim[];
  /** 이관 기사는 분류 전까지 비어 있을 수 있다 — 발행은 막힌다 */
  section: Section | null;
  category: ArticleCategory | null;
  contentType: ContentType | null;
  reportingMethod: ReportingMethod | null;
  format: ArticleFormat;
  subtype: Subtype;
  solvedCase: SolvedCase | null;
  label: Label;
  partner: PartnerRef | null;
  /** 작성 기자 계정 (`people.staff_user_id`) */
  authorUserId: string | null;
  /** 첫 발행 시각 — null이면 새 기사(아직 발행 안 됨) */
  firstPublishedAt: string | null;
  /** 발행 뒤 수정의 종류·사유 (ART-05) */
  updateKind: UpdateKind | null;
  updatedReason: string | null;
  /** 법령 기준일 YYYY-MM-DD */
  legalBasisDate: string | null;
  /** 금주 핫뉴스 회차 (digest만) */
  digestId: string | null;
  /** 개정 트래커 연결 (개정 브리핑 — CAT-04) */
  amendmentId: string | null;
  leadImage: LeadImage | null;
  sources: readonly ArticleSource[];
  evidence: readonly ArticleEvidence[];
  datasets: readonly ArticleDataset[];
  interviews: readonly ArticleInterview[];
  reviews: readonly EditorialReview[];
  taxLens: TaxLens | null;
  /** 세금 계산·법률 주장이 있음 — 세무 감수 서명 대상 (NAV-12 · ART-01) */
  hasTaxOrLegalClaims: boolean;
  /** 세금 쟁점 원고 — 법령 기준일·세무 감수 필수 (NAV-11) */
  isTaxIssue: boolean;
  /** 지역 정책 쟁점 원고 — 관점 3종 기록·원문 대조 필수 (NAV-11) */
  isLocalPolicyIssue: boolean;
  perspectives: Readonly<Record<PerspectiveKey, PerspectiveRecord | null>>;
  /** 지역 정책 쟁점의 해당 원문 대조 기록 — `sources[].id`와 대조일 */
  originalTextChecks: readonly { sourceId: string; checkedAt: string | null }[];
  /** 상속·증여 사례 원고 — 동의·비식별 검토 필수 (NAV-11) */
  isInheritanceGiftCase: boolean;
  inheritanceGiftChecks: { consent: boolean; deidentified: boolean };
  quantitativeChecklist: QuantitativeChecklist | null;
  qualitativeChecklist: QualitativeChecklist | null;
  /** 지역 기사 편집 게이트 입력 (REG1-17) — 없으면 지역 태그 0으로 본다 */
  regional?: RegionalFacts | null;
  /** 법안 상태를 다룸 `covers_bill_status` (PR-13) — 켜면 출처 주소·확인일이 있는 공식 자료 출처가 1건 이상 있어야 발행된다 */
  coversBillStatus?: boolean;
}

// ── 판정 문맥 ───────────────────────────────────────────────

/** 쉬운 말 사전 항목 — 전문 용어와 쉬운 풀이 (glossary_terms) */
export interface JargonTerm {
  term: string;
  plain: string;
}

/** 운영 사전 — `settings`에서 읽는다(배포 없이 바뀐다) */
export interface Dictionaries {
  forbiddenPhrases: readonly string[];
  fearPhrases: readonly string[];
  jargonTerms: readonly JargonTerm[];
}

/** R8 기준값 (PRD-00 8.2) */
export interface Thresholds {
  /** 화면 안내 문장 최대 글자 수(공백 제외) — 초과면 경고 */
  guideSentenceMax: number;
  /** 한 상자 최대 문장 수 — 초과면 경고 */
  boxSentenceMax: number;
}

/** R8 기준값 — PRD-00 8.2 표의 값(디자인 문서 값, 바꾸면 그 표를 고친다) */
export const R8_THRESHOLDS: Thresholds = { guideSentenceMax: 60, boxSentenceMax: 3 };

/**
 * 기사 머리 글자 상한 — 휴대폰 첫 화면(360×740)에 머리(분야 칩·제목·요약·기자)만 들어가고 그 글자가 150자(R1, PRD-00 8.2)를 넘지 않게 (W2-b 설계 9장).
 * 제목 40자 · 요약 60자(R8 화면 문장 60자와 같은 값). 공백 포함 — 편집자가 세는 그대로. 기사 저장(API·편집 화면)이 막는다
 */
export const ARTICLE_HEAD_LIMITS = { titleMax: 40, summaryMax: 60 } as const;

/** 머리 글자 수 — 앞뒤 공백을 뺀 글자(코드 포인트) 수, 사이 공백은 센다 */
export const headCharCount = (text: string): number => [...text.trim()].length;

/** 머리 글자 상한을 넘으면 그 문장 (API 오류·편집 화면 칸 오류가 같은 글자), 아니면 null */
export function headLengthProblem(field: "title" | "summary", text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const max = field === "title" ? ARTICLE_HEAD_LIMITS.titleMax : ARTICLE_HEAD_LIMITS.summaryMax;
  const n = headCharCount(text);
  return n > max ? `${field === "title" ? "제목" : "요약"}은 ${max}자 이하여야 합니다 (지금 ${n}자 — 휴대폰 첫 화면 글자 기준 R1)` : null;
}

/** packages/similarity 결과 상태 (OPT-06) */
export type SimilarityStatus = "blocked" | "pass" | "no_sources" | "no_body";

export interface PublishContext {
  /** 판정 기준일 YYYY-MM-DD (KST) — 제휴 계약 종료 판정에 쓴다 */
  today: string;
  dictionaries: Dictionaries;
  thresholds: Thresholds;
  /** packages/seo-lint 결과의 차단·경고 항목 ID. 점검을 돌리지 않았으면 null */
  seoLint: { blockers: readonly string[]; warnings: readonly string[] } | null;
  /**
   * packages/similarity 결과. 검사를 돌리지 않았으면 null.
   * copied — 원문 문장과 기준 이상 같은 본문 문장(직접 인용 블록 제외)과 그 원문 `sources[].id` (PR-07 원문 전재 검사)
   */
  similarity: {
    status: SimilarityStatus;
    copied?: readonly { sourceId: string; sentenceIndex: number }[];
    /**
     * 보도자료 재게시 (REG1-14) — 본문 문장(인용 제외) 중 그 보도자료 문장과 기준 이상 같은 문장의 비율이
     * 기사 비율 기준(settings.similarity_internal articleRatio·articleComparator) 이상인 보도자료 `sources[].id`와 그 비율
     */
    reposted?: readonly { sourceId: string; ratio: number }[];
  } | null;
  /** 공공누리 이용 범위 `settings.kogl_usage` — 없으면 KOGL_USAGE_DEFAULT (PR-07 · W4 12장 #13) */
  kogl?: KoglUsage;
  /** 공식 자료 종류 허용 목록 `settings.official_source_types` — 없으면 씨앗 OFFICIAL_SOURCE_TYPES (REG1-07) */
  officialSourceTypes?: readonly string[];
  /** 판정 책임자가 있는 편집 분야 `settings.regional_judge_fields` — 없으면 씨앗 REGIONAL_JUDGE_FIELDS_DEFAULT (REG1-17 · W4 12장 #7) */
  regionalJudgeFields?: readonly EditorialField[];
  /** 오래된 통계 경고 기준 일수 `settings.stale_statistics_days` — 없으면 씨앗 STALE_STATISTICS_DAYS_DEFAULT (REG1-14 · W4 2.2) */
  staleStatisticsDays?: number;
}
