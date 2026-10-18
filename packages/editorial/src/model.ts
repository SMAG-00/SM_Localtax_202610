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

/** `article_sources.kind` */
export const SOURCE_KINDS = ["official_doc", "dataset", "press_release", "interview", "field", "photo", "other"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

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
  chart: ChartLabels | null;
  /** 템플릿 — 절차 흐름 · 비교 · 핵심 숫자 */
  template: InfographicTemplate;
  /** 같은 내용의 표·목록 — 없으면(null) 저장 불가, 발행 판정도 막는다 */
  data: InfographicData | null;
}

/** 동영상 썸네일의 media 기록 — 판정 입력이 media 표에서 채운다(저장하지 않는다). 크기를 모르면 null */
export interface ThumbnailFacts {
  rightsStatus: RightsStatus;
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
  /** packages/similarity 결과. 검사를 돌리지 않았으면 null */
  similarity: { status: SimilarityStatus } | null;
}
