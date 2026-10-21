/**
 * 화면 데이터 객체(view model) — 페이지가 화면에 그리는 바로 그 객체다 (OPT-02).
 * 생성기는 이 객체에 있는 값만 JSON-LD로 옮긴다. 화면에 없는 값(평점·후기·가격·확인 안 된 일정)은
 * 여기에 칸 자체가 없다 — 칸이 없으니 생성기도 낼 수 없다.
 *
 * 날짜는 ISO 8601 문자열이다. 시각을 쓰면 오프셋을 붙인다 (예: "2026-10-20T09:00:00+09:00").
 * URL은 절대 주소(https://…)다.
 */

/** ISO 8601 날짜("2026-10-20") 또는 오프셋이 붙은 시각("2026-10-20T09:00:00+09:00") */
export type IsoDateString = string;
/** 절대 URL */
export type Url = string;

export interface ImageRef {
  url: Url;
  width?: number;
  height?: number;
  caption?: string;
}

/** 매체·주최·출판사·제공기관 등 — 이름은 호출하는 쪽이 넘긴다 (제품명을 이 패키지에 두지 않는다) */
export interface OrganizationRef {
  name: string;
  url?: Url;
  logo?: ImageRef;
}

/** 기자·필자·저자. 사람이면 인물 페이지(`/people/[slug]`) 주소를 url로 */
export interface AuthorRef {
  kind: "person" | "organization";
  name: string;
  url?: Url;
}

/**
 * 광고·제휴 표기 (`articles.label` — 없음·공동 기획·광고, ART-10 · PRD-00 8.8).
 * 표기가 없으면 칸을 비운다. 둘을 함께 고를 수 없다(칸이 하나다).
 * 공동 기획의 배지 글자는 "공동 기획 ○○" — ○○ = 제휴사 이름(`partners.name`, 필수). 이름이 비면 "공동 기획"만 남는데,
 * PRD 배지가 아니므로 seo-lint 「광고 표기 일치」와 발행 판정(art10.co-planned-partner-required)이 그 기사를 막는다.
 */
export type SponsorLabel = { kind: "광고" } | { kind: "공동 기획"; partnerName: string };

/** 기사 `/news/[slug]` */
export interface ArticleView {
  url: Url;
  /** 표기를 뺀 원 제목 — 화면·메타·JSON-LD 제목은 displayTitle()로 표기를 붙여 만든다 */
  title: string;
  sponsorship?: SponsorLabel;
  summary?: string;
  /** 화면 분야 칩 글자 (예: "지방세") */
  sectionName?: string;
  authors: AuthorRef[];
  /** 매체 — 브랜드 값은 호출하는 쪽(packages/ui brand)이 넘긴다 */
  publisher: OrganizationRef;
  /** 최초 발행일 `first_published_at` */
  datePublished: IsoDateString;
  /** 실질 수정일 `substantive_updated_at` — 오탈자 수정은 바꾸지 않는다 (OPT-07) */
  dateModified?: IsoDateString;
  mainImage?: ImageRef;
  /** 동영상 기사(형식 동영상)의 영상 — 있으면 VideoObject를 함께 낸다 */
  video?: VideoView;
  /**
   * 세무 감수자 (BR-03 · W3 10단계) — 세무 감수 서명 기록(감수 표시 '감수 ○○')이 화면에 있을 때만 넘긴다. 손으로 넣는 값이 아니다.
   * JSON-LD에서는 기사 페이지(WebPage — mainEntityOfPage)의 reviewedBy(Person)다. url은 서명자 인물 페이지가 있을 때만
   */
  reviewer?: { name: string; url?: Url };
}

/** 동영상 (유튜브 nocookie 임베드, 동영상 카드 — 재생 시간은 ISO 8601 기간 "PT1M30S") */
export interface VideoView {
  name: string;
  description?: string;
  thumbnailUrl: Url;
  uploadDate: IsoDateString;
  duration?: string;
  embedUrl?: Url;
  contentUrl?: Url;
}

/** 경로 표시 — 마지막 항목(현재 페이지)은 url을 비워도 된다 */
export interface BreadcrumbView {
  items: { name: string; url?: Url }[];
}

/** 매체 정책 페이지 주소 (`/about/*`) */
export interface NewsMediaPolicies {
  publishingPrinciples?: Url;
  correctionsPolicy?: Url;
  ethicsPolicy?: Url;
  actionableFeedbackPolicy?: Url;
  ownershipFundingInfo?: Url;
  masthead?: Url;
  unnamedSourcesPolicy?: Url;
  verificationFactCheckingPolicy?: Url;
  diversityPolicy?: Url;
  noBylinesPolicy?: Url;
}

/** 매체 `/about` */
export interface OrganizationView {
  name: string;
  alternateName?: string;
  url: Url;
  logo?: ImageRef;
  description?: string;
  /** 확인된 공식 계정·프로필 주소만 */
  sameAs?: Url[];
  policies?: NewsMediaPolicies;
}

/** 증빙이 있는 항목 — 증빙 ID 없는 약력·직함·소속·수상은 화면에도 구조화 데이터에도 없다 (BR-01·BR-02) */
export interface VerifiedText {
  text: string;
  evidenceId: string;
}

/** 인물 `/people/[slug]` — 기자·필자·감수자·전문가가 같은 틀 (BR-02 · EXPL-02 · EXPL-12) */
export interface PersonView {
  url: Url;
  name: string;
  jobTitle?: VerifiedText;
  affiliation?: VerifiedText;
  /** 자격 (전문가 분류 — 세무사 등) */
  credentials?: VerifiedText[];
  awards?: VerifiedText[];
  /** 전문 분야 */
  knowsAbout?: string[];
  /** 확인된 공식 프로필 URL만 */
  sameAs?: Url[];
  /** 사진 — 동의·권리 기록이 있을 때만 */
  image?: ImageRef;
  description?: string;
}

/** 행사 상태 배지 (LG-12 · REG1-04). 예정·진행·종료는 계산값, 취소·변경 확인 중은 편집자 지정 */
export type EventScreenStatus = "예정" | "진행" | "종료" | "취소" | "변경 확인 중";

/** 행사 상세 `/local/events/[slug]` (`local_events` — 필수 필드는 LG-11) */
export interface EventView {
  url: Url;
  name: string;
  /** 화면 배지와 JSON-LD `eventStatus`가 이 한 칸에서 나온다 */
  status: EventScreenStatus;
  /** 상업 행사 (LG-13) — '광고' 표기 */
  sponsored: boolean;
  startDate: IsoDateString;
  endDate: IsoDateString;
  venue: {
    name: string;
    /** 주소 — 구조화 데이터 `location.address`의 원본 [확인 필요: `local_events`에 주소 칸 없음] */
    address?: string;
  };
  organizer: OrganizationRef;
  /** [공식 안내 ↗] 주소 */
  officialUrl: Url;
  description?: string;
  image?: ImageRef;
}

/** 도서 `/store/books/[slug]` (BIZ-01 — 판차 없으면 발행 불가). 정가는 이 객체에 두지 않는다 (OPT-02 가격 0) */
export interface BookView {
  url: Url;
  name: string;
  authors: AuthorRef[];
  /** 판차 (예: "제3판") */
  bookEdition: string;
  publisher?: OrganizationRef;
  /** 출간일 */
  datePublished?: IsoDateString;
  isbn?: string;
  image?: ImageRef;
  description?: string;
  numberOfPages?: number;
}

/** 강좌 회차 — 출처·확인일이 있는 일정만 (EDU-01) */
export interface CourseSessionView {
  startDate: IsoDateString;
  endDate?: IsoDateString;
  mode: "onsite" | "online" | "blended";
  location?: { name: string; address?: string };
}

/** 교육원 강좌 `/edu` (EDU-01) */
export interface CourseView {
  url: Url;
  name: string;
  description: string;
  provider: OrganizationRef;
  /** 대상 (예: "지자체 세무 공무원") */
  audience?: string;
  sessions?: CourseSessionView[];
}

/** 통계 트래커·정량형 원자료 (DF-04 · NAV-10 · `article_datasets`) */
export interface DatasetView {
  url: Url;
  name: string;
  /** Google 기준 50~5000자 */
  description: string;
  /** 제공기관 */
  creator?: OrganizationRef;
  /** 이용 조건 주소 */
  license?: Url;
  /** 기간 — ISO 8601 구간 (예: "2024-01/2026-06") */
  temporalCoverage?: string;
  /** 지역 단위 (예: "전국") */
  spatialCoverage?: string;
  variables?: { name: string; unitText?: string }[];
  /** 마지막 수집일 */
  dateModified?: IsoDateString;
  /** 원문 URL */
  isBasedOn?: Url;
  distribution?: { contentUrl: Url; encodingFormat: string }[];
}

/** 페이지 하나가 생성기에 넘기는 입력 — `kind`는 유형 대응표(types-map.ts)의 키 */
export type PageInput =
  | { kind: "article"; article: ArticleView; breadcrumb?: BreadcrumbView }
  | { kind: "mediaOrganization"; organization: OrganizationView; breadcrumb?: BreadcrumbView }
  | { kind: "person"; person: PersonView; breadcrumb?: BreadcrumbView }
  | { kind: "event"; event: EventView; breadcrumb?: BreadcrumbView }
  | { kind: "book"; book: BookView; breadcrumb?: BreadcrumbView }
  | { kind: "course"; course: CourseView; breadcrumb?: BreadcrumbView }
  | { kind: "dataset"; dataset: DatasetView; breadcrumb?: BreadcrumbView };
