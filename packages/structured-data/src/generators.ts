/**
 * 유형별 JSON-LD 생성기 (OPT-02). 화면 데이터 객체(models.ts)를 받아 schema.org 노드를 만든다.
 * - 입력에 있는 값만 옮긴다. 값을 지어내거나 기본값을 채우지 않는다.
 * - 입력 객체에 칸이 더 붙어 있어도(DB 행 등) 아래에 적은 칸만 읽는다 — 평점·후기·가격은 읽을 칸이 없다.
 * - @type은 유형 대응표(types-map.ts)에서 읽는다.
 */
import { compact, SCHEMA_CONTEXT, type JsonLdNode, type JsonObject } from "./jsonld";
import { BREADCRUMB_TYPE, PAGE_TYPE_MAP } from "./types-map";
import { EVENT_STATUS_MAP } from "./event-status";
import { displayTitle } from "./labels";
import type {
  ArticleView,
  AuthorRef,
  BookView,
  BreadcrumbView,
  CourseSessionView,
  CourseView,
  DatasetView,
  EventView,
  ImageRef,
  NewsMediaPolicies,
  OrganizationRef,
  OrganizationView,
  PersonView,
  VideoView,
} from "./models";

const VIDEO_TYPE = PAGE_TYPE_MAP.article.additionalTypes[0].type;

function top(type: string, props: JsonObject): JsonLdNode {
  return compact({ "@context": SCHEMA_CONTEXT, "@type": type, ...props });
}

function nested(type: string, props: JsonObject): JsonLdNode {
  return compact({ "@type": type, ...props });
}

function imageObject(img: ImageRef | undefined): JsonLdNode | undefined {
  if (!img) return undefined;
  return nested("ImageObject", { url: img.url, width: img.width, height: img.height, caption: img.caption });
}

function organization(org: OrganizationRef | undefined): JsonLdNode | undefined {
  if (!org) return undefined;
  return nested("Organization", { name: org.name, url: org.url, logo: imageObject(org.logo) });
}

function author(a: AuthorRef): JsonLdNode {
  return nested(a.kind === "person" ? "Person" : "Organization", { name: a.name, url: a.url });
}

function place(p: { name: string; address?: string } | undefined): JsonLdNode | undefined {
  if (!p) return undefined;
  return nested("Place", { name: p.name, address: p.address });
}

/**
 * 기사 → NewsArticle. headline은 화면 제목과 같은 광고·공동 기획 표기를 가진다.
 * 감수자(reviewer)가 있으면 기사 페이지(mainEntityOfPage — WebPage)의 reviewedBy로 낸다(schema.org에서 reviewedBy는 WebPage 속성). 없으면 칸 0
 */
export function newsArticle(a: ArticleView): JsonLdNode {
  return top(PAGE_TYPE_MAP.article.primaryType, {
    url: a.url,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": a.url,
      reviewedBy: a.reviewer ? nested("Person", { name: a.reviewer.name, url: a.reviewer.url }) : undefined,
    },
    headline: displayTitle(a.title, a.sponsorship),
    description: a.summary,
    articleSection: a.sectionName,
    author: a.authors.map(author),
    publisher: organization(a.publisher),
    datePublished: a.datePublished,
    dateModified: a.dateModified,
    image: imageObject(a.mainImage),
  });
}

/**
 * 유료 기사(디지털 구독 페이월, W10-f BIZ-04) → NewsArticle. 제목·발행일·"무료 아님" 표시만 낸다 - 본문·미리보기 글자는 속성에 넣지 않는다.
 * isAccessibleForFree=false와 유료 구간(hasPart)을 함께 낸다. 주소는 있을 때만.
 */
export function paywalledArticle(a: { url?: string; title: string; datePublished?: string; paywallSelector: string }): JsonLdNode {
  return top(PAGE_TYPE_MAP.article.primaryType, {
    mainEntityOfPage: a.url,
    headline: a.title,
    datePublished: a.datePublished,
    isAccessibleForFree: false,
    hasPart: nested("WebPageElement", { isAccessibleForFree: false, cssSelector: a.paywallSelector }),
  });
}

/** 동영상 기사의 영상 → VideoObject */
export function videoObject(v: VideoView): JsonLdNode {
  return top(VIDEO_TYPE, {
    name: v.name,
    description: v.description,
    thumbnailUrl: v.thumbnailUrl,
    uploadDate: v.uploadDate,
    duration: v.duration,
    embedUrl: v.embedUrl,
    contentUrl: v.contentUrl,
  });
}

/** 경로 표시 → BreadcrumbList (차례 번호는 1부터) */
export function breadcrumbList(b: BreadcrumbView): JsonLdNode {
  return top(BREADCRUMB_TYPE, {
    itemListElement: b.items.map((item, i) => nested("ListItem", { position: i + 1, name: item.name, item: item.url })),
  });
}

const POLICY_KEYS: readonly (keyof NewsMediaPolicies)[] = [
  "publishingPrinciples",
  "correctionsPolicy",
  "ethicsPolicy",
  "actionableFeedbackPolicy",
  "ownershipFundingInfo",
  "masthead",
  "unnamedSourcesPolicy",
  "verificationFactCheckingPolicy",
  "diversityPolicy",
  "noBylinesPolicy",
];

/** 매체 `/about` → NewsMediaOrganization. 이름·주소는 호출하는 쪽이 넘긴 값 그대로 */
export function newsMediaOrganization(o: OrganizationView): JsonLdNode {
  const policies: JsonObject = {};
  for (const key of POLICY_KEYS) policies[key] = o.policies?.[key];
  return top(PAGE_TYPE_MAP.mediaOrganization.primaryType, {
    name: o.name,
    alternateName: o.alternateName,
    url: o.url,
    logo: imageObject(o.logo),
    description: o.description,
    sameAs: o.sameAs ? [...o.sameAs] : undefined,
    ...policies,
  });
}

function personNode(p: PersonView): JsonLdNode {
  return nested(PAGE_TYPE_MAP.person.mainEntityType, {
    name: p.name,
    url: p.url,
    jobTitle: p.jobTitle?.text,
    affiliation: p.affiliation ? nested("Organization", { name: p.affiliation.text }) : undefined,
    hasCredential: p.credentials?.map((c) => nested("EducationalOccupationalCredential", { name: c.text })),
    award: p.awards?.map((a) => a.text),
    knowsAbout: p.knowsAbout ? [...p.knowsAbout] : undefined,
    sameAs: p.sameAs ? [...p.sameAs] : undefined,
    image: imageObject(p.image),
    description: p.description,
  });
}

/** 인물 → Person (단독 노드) */
export function person(p: PersonView): JsonLdNode {
  return { "@context": SCHEMA_CONTEXT, ...personNode(p) };
}

/** 인물 페이지 `/people/[slug]` → ProfilePage (주 엔터티 Person) */
export function profilePage(p: PersonView): JsonLdNode {
  return top(PAGE_TYPE_MAP.person.primaryType, { url: p.url, mainEntity: personNode(p) });
}

/**
 * 행사 상세 → Event. 상태는 화면 배지와 같은 칸(status)에서 읽는다.
 * '변경 확인 중'이면 null — 확정되지 않은 일정을 내지 않는다 (LG-16).
 * 공식 안내 주소는 sameAs, 이 페이지 주소는 url.
 */
export function event(e: EventView): JsonLdNode | null {
  const eventStatus = EVENT_STATUS_MAP[e.status];
  if (eventStatus === undefined) throw new TypeError(`알 수 없는 행사 상태: ${String(e.status)}`);
  if (eventStatus === null) return null;
  return top(PAGE_TYPE_MAP.event.primaryType, {
    name: displayTitle(e.name, e.sponsored ? { kind: "광고" } : undefined),
    url: e.url,
    sameAs: e.officialUrl,
    description: e.description,
    startDate: e.startDate,
    endDate: e.endDate,
    eventStatus,
    location: place(e.venue),
    organizer: organization(e.organizer),
    image: imageObject(e.image),
  });
}

/** 도서 → Book. 정가는 내지 않는다 (OPT-02 가격 0 · 도서정가제 감수 전) */
export function book(b: BookView): JsonLdNode {
  return top(PAGE_TYPE_MAP.book.primaryType, {
    name: b.name,
    url: b.url,
    author: b.authors.map(author),
    bookEdition: b.bookEdition,
    publisher: organization(b.publisher),
    datePublished: b.datePublished,
    isbn: b.isbn,
    image: imageObject(b.image),
    description: b.description,
    numberOfPages: b.numberOfPages,
  });
}

const COURSE_MODE: Record<CourseSessionView["mode"], string> = {
  onsite: "Onsite",
  online: "Online",
  blended: "Blended",
};

/** 교육원 강좌 → Course (회차는 CourseInstance). 수강료는 내지 않는다 */
export function course(c: CourseView): JsonLdNode {
  return top(PAGE_TYPE_MAP.course.primaryType, {
    name: c.name,
    description: c.description,
    url: c.url,
    provider: organization(c.provider),
    audience: c.audience ? nested("Audience", { audienceType: c.audience }) : undefined,
    hasCourseInstance: c.sessions?.map((s) =>
      nested("CourseInstance", {
        courseMode: COURSE_MODE[s.mode],
        startDate: s.startDate,
        endDate: s.endDate,
        location: place(s.location),
      }),
    ),
  });
}

/** 통계 트래커·정량형 원자료 → Dataset */
export function dataset(d: DatasetView): JsonLdNode {
  return top(PAGE_TYPE_MAP.dataset.primaryType, {
    name: d.name,
    description: d.description,
    url: d.url,
    creator: organization(d.creator),
    license: d.license,
    temporalCoverage: d.temporalCoverage,
    spatialCoverage: d.spatialCoverage,
    variableMeasured: d.variables?.map((v) => nested("PropertyValue", { name: v.name, unitText: v.unitText })),
    dateModified: d.dateModified,
    isBasedOn: d.isBasedOn,
    distribution: d.distribution?.map((x) =>
      nested("DataDownload", { contentUrl: x.contentUrl, encodingFormat: x.encodingFormat }),
    ),
  });
}
