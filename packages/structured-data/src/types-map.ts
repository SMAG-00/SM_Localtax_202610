/**
 * 유형 대응표 (OPT-02) — 페이지 종류 → schema.org 유형. 이 파일 한 곳에만 둔다.
 * 생성기(generators.ts)는 @type을 이 표에서 읽고, 검사기(validate.ts)는 이 표에 없는 최상위 유형을 오류로 본다.
 *
 * 근거: PRD-01A OPT-02(7유형 · BreadcrumbList · 동영상 기사 VideoObject) · SEO-01(BreadcrumbList)
 *       · PRD-01B LG-16(Event) · PRD-01C BR-02 · EXPL-12(ProfilePage + Person) · BIZ-01(Book) · EDU-01(Course)
 *       · PRD-01B DF-04 · PRD-01A NAV-10(Dataset)
 */

export interface AdditionalType {
  type: string;
  /** 이 유형을 함께 내는 조건 */
  when: string;
}

export interface PageTypeEntry {
  label: string;
  route: string;
  primaryType: string;
  mainEntityType?: string;
  additionalTypes: readonly AdditionalType[];
  prd: readonly string[];
}

export const PAGE_TYPE_MAP = {
  article: {
    label: "기사",
    route: "/news/[slug]",
    primaryType: "NewsArticle",
    additionalTypes: [{ type: "VideoObject", when: "동영상 기사 — 화면 데이터 객체에 video가 있을 때" }],
    prd: ["OPT-02", "SEO-01", "ART-01"],
  },
  mediaOrganization: {
    label: "매체",
    route: "/about",
    primaryType: "NewsMediaOrganization",
    additionalTypes: [],
    prd: ["OPT-02", "HELP-05"],
  },
  person: {
    label: "인물",
    route: "/people/[slug]",
    primaryType: "ProfilePage",
    mainEntityType: "Person",
    additionalTypes: [],
    prd: ["OPT-02", "BR-02", "EXPL-12"],
  },
  event: {
    label: "행사",
    route: "/local/events/[slug]",
    primaryType: "Event",
    additionalTypes: [],
    prd: ["OPT-02", "LG-16", "LG-12", "REG1-04"],
  },
  book: {
    label: "도서",
    route: "/store/books/[slug]",
    primaryType: "Book",
    additionalTypes: [],
    prd: ["OPT-02", "BIZ-01"],
  },
  course: {
    label: "교육원 강좌",
    route: "/edu",
    primaryType: "Course",
    additionalTypes: [],
    prd: ["OPT-02", "EDU-01"],
  },
  dataset: {
    label: "통계 트래커·정량형 원자료",
    route: "/finance (규제·통계 트래커)",
    primaryType: "Dataset",
    additionalTypes: [],
    prd: ["OPT-02", "DF-04", "NAV-10"],
  },
} as const satisfies Record<string, PageTypeEntry>;

/**
 * OPT-02 7유형 밖의 확장 유형 — PRD-02 4.16 PR-15(금주 부동산 재테크 목록)가 더한 CollectionPage 하나.
 * 7유형 대응표(PAGE_TYPE_MAP)와 문서 대조는 그대로 두고, 최상위로 낼 수 있는 유형에만 더한다.
 */
export const EXTENSION_TYPES = {
  collection: {
    label: "금주 부동산 재테크 목록 페이지",
    route: "/realestate/weekly",
    primaryType: "CollectionPage",
    additionalTypes: [],
    prd: ["PR-15"],
  },
} as const satisfies Record<string, PageTypeEntry>;

export type PageKind = keyof typeof PAGE_TYPE_MAP;

/** 경로 표시가 있는 모든 페이지에 함께 내는 유형 (SEO-01 · REG1-12) */
export const BREADCRUMB_TYPE = "BreadcrumbList";

/** 최상위 노드로 낼 수 있는 유형 — 대응표 밖의 유형은 검사기가 오류로 본다 */
export const ALLOWED_TOP_LEVEL_TYPES: readonly string[] = [
  ...new Set([
    ...Object.values(PAGE_TYPE_MAP).flatMap((e: PageTypeEntry) => [
      e.primaryType,
      ...(e.mainEntityType ? [e.mainEntityType] : []),
      ...e.additionalTypes.map((a) => a.type),
    ]),
    ...Object.values(EXTENSION_TYPES).map((e: PageTypeEntry) => e.primaryType),
    BREADCRUMB_TYPE,
  ]),
];

/** 대응표에서 일부러 뺀 유형과 그 이유 */
export const EXCLUDED_TYPES: readonly { type: string; reason: string }[] = [
  {
    type: "FAQPage",
    reason:
      "OPT-02의 유형 목록(7유형 · BreadcrumbList · VideoObject)에 없다. PRD-00 8.6 FAQ 블록은 '구조화 데이터를 낼 때는 화면과 같은 값만'이라는 조건만 둔다 — 낼지 말지는 [결정 안건]. FAQ 블록은 화면에만 보인다 (OPT-10 가짜 FAQ 금지).",
  },
];
