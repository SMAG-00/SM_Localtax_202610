/**
 * 최소 구조화 데이터 검사기 — "유형별 견본 7유형 검사 오류 0" 시험과 발행 전 점검에 쓴다 (OPT-02).
 * 외부 검사 도구(Google 리치 결과 테스트 등)를 대신하지 않는다 — CI에서 쓸 외부 검사 도구는 [확인 필요].
 *
 * 검사 항목
 * 1. 최상위 노드: @context = https://schema.org, @type이 유형 대응표에 있는 유형
 * 2. 필수 속성 (REQUIRED_PROPERTIES) — basis "google"은 Google 구조화 데이터 문서의 필수 속성,
 *    "platform"은 Google 권장 속성 중 이 플랫폼 규칙(PRD)이 필수로 정한 것
 * 3. 형식: 날짜(ISO 8601, 시각에는 오프셋), 재생 시간(ISO 8601 기간), URL(절대 http/https), eventStatus·courseMode 값,
 *    Dataset 설명 50~5000자, BreadcrumbList 차례 번호
 * 4. 순서: 수정일 ≥ 발행일, 종료 ≥ 시작
 * 5. 금지 속성: 평점·후기·가격 (깊이 끝까지)
 */
import { SCHEMA_CONTEXT } from "./jsonld";
import { ALLOWED_TOP_LEVEL_TYPES } from "./types-map";
import { SCHEMA_EVENT_STATUSES } from "./event-status";

export type ValidationCode = "context" | "type" | "required" | "format" | "order" | "forbidden";

export interface ValidationError {
  /** 입력 배열에서 몇 번째 노드인지 (단일 노드면 0) */
  node: number;
  /** 예: "NewsArticle.author[0].name" */
  path: string;
  code: ValidationCode;
  message: string;
}

export interface RequiredRule {
  /** 노드 안의 경로. `[]`는 배열의 각 항목 */
  path: string;
  basis: "google" | "platform";
}

export const REQUIRED_PROPERTIES: Readonly<Record<string, readonly RequiredRule[]>> = {
  // Google Article 문서는 필수 속성 없이 권장만 둔다. 제목·저자·발행일은 GEO 차단 항목(OPT-03), 이미지는 권장 → 플랫폼 필수
  NewsArticle: [
    { path: "headline", basis: "platform" },
    { path: "datePublished", basis: "platform" },
    { path: "author", basis: "platform" },
    { path: "author[].name", basis: "platform" },
    { path: "image", basis: "platform" },
  ],
  // Google Video 문서
  VideoObject: [
    { path: "name", basis: "google" },
    { path: "thumbnailUrl", basis: "google" },
    { path: "uploadDate", basis: "google" },
  ],
  // Google Breadcrumb 문서 — 마지막이 아닌 항목의 item은 아래 별도 검사
  BreadcrumbList: [
    { path: "itemListElement", basis: "google" },
    { path: "itemListElement[].position", basis: "google" },
    { path: "itemListElement[].name", basis: "google" },
  ],
  // Google Organization 문서는 필수 속성이 없다 — 이름·주소는 플랫폼 필수
  NewsMediaOrganization: [
    { path: "name", basis: "platform" },
    { path: "url", basis: "platform" },
  ],
  // Google ProfilePage 문서
  ProfilePage: [
    { path: "mainEntity", basis: "google" },
    { path: "mainEntity.name", basis: "google" },
  ],
  Person: [{ path: "name", basis: "platform" }],
  // Google Event 문서 — 장소(Place)에는 address가 필수
  Event: [
    { path: "name", basis: "google" },
    { path: "startDate", basis: "google" },
    { path: "location", basis: "google" },
    { path: "location.address", basis: "google" },
  ],
  // Google Book 문서(Book actions)의 name·url·author. 판차는 BIZ-01 플랫폼 필수
  Book: [
    { path: "name", basis: "google" },
    { path: "url", basis: "google" },
    { path: "author", basis: "google" },
    { path: "author[].name", basis: "google" },
    { path: "bookEdition", basis: "platform" },
  ],
  // Google Course 문서의 name·description. 운영 기관은 플랫폼 필수
  Course: [
    { path: "name", basis: "google" },
    { path: "description", basis: "google" },
    { path: "provider", basis: "platform" },
    { path: "provider.name", basis: "platform" },
  ],
  // Google Dataset 문서
  Dataset: [
    { path: "name", basis: "google" },
    { path: "description", basis: "google" },
  ],
};

/** 평점·후기·가격 — 화면에 없는 값 0 (OPT-02 · EXPL-02 · EXPL-12). 1단계에는 이 속성을 내는 화면이 없다 */
export const FORBIDDEN_PROPERTIES: readonly string[] = [
  "aggregateRating",
  "review",
  "reviews",
  "reviewRating",
  "reviewCount",
  "rating",
  "ratingValue",
  "ratingCount",
  "bestRating",
  "worstRating",
  "offers",
  "price",
  "priceRange",
  "priceCurrency",
  "priceSpecification",
  "priceValidUntil",
  "lowPrice",
  "highPrice",
];

const DATE_KEYS = new Set(["datePublished", "dateModified", "dateCreated", "uploadDate", "startDate", "endDate"]);
const URL_KEYS = new Set([
  "url",
  "item",
  "sameAs",
  "image",
  "logo",
  "thumbnailUrl",
  "embedUrl",
  "contentUrl",
  "license",
  "isBasedOn",
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
]);
const COURSE_MODES = new Set(["Onsite", "Online", "Blended"]);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
const ISO_DURATION = /^P(?=\d|T\d)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12) return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d < 1 || d > daysInMonth) return false;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] !== undefined && Number(m[6]) > 59))) {
    return false;
  }
  return true;
}

function isAbsoluteHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
  );
}

type Report = (path: string, code: ValidationCode, message: string) => void;

/** 경로 하나의 필수 검사. 부모가 없으면 부모의 규칙이 보고하므로 건너뛴다 */
function requireAt(obj: Obj, segments: string[], prefix: string, report: Report): void {
  const [seg, ...rest] = segments;
  const each = seg.endsWith("[]");
  const key = each ? seg.slice(0, -2) : seg;
  const value = obj[key];
  const path = `${prefix}.${key}`;
  if (rest.length === 0) {
    if (isEmpty(value)) report(path, "required", `필수 속성 ${key}이(가) 없다`);
    return;
  }
  if (each && Array.isArray(value)) {
    value.forEach((item, i) => isObj(item) && requireAt(item, rest, `${path}[${i}]`, report));
  } else if (isObj(value)) {
    requireAt(value, rest, path, report);
  }
}

/** 형식·금지 속성 — 깊이 끝까지, 키 이름 순서로 */
function walk(value: unknown, path: string, report: Report): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, report));
    return;
  }
  if (!isObj(value)) return;
  for (const key of Object.keys(value).sort()) {
    const v = value[key];
    if (v === undefined) continue;
    const p = `${path}.${key}`;
    if (FORBIDDEN_PROPERTIES.includes(key)) {
      report(p, "forbidden", `${key}은(는) 낼 수 없다 — 평점·후기·가격 (화면에 없는 값 0)`);
      continue;
    }
    if (DATE_KEYS.has(key) && typeof v === "string" && !isIsoDate(v)) {
      report(p, "format", `${key}은(는) ISO 8601 날짜이고 시각에는 시간대 오프셋이 있어야 한다 (받은 값: ${v})`);
    }
    if (key === "duration" && typeof v === "string" && !ISO_DURATION.test(v)) {
      report(p, "format", `duration은 ISO 8601 기간이어야 한다 (예: PT1M30S, 받은 값: ${v})`);
    }
    if (URL_KEYS.has(key)) {
      const urls = (Array.isArray(v) ? v : [v]).filter((u): u is string => typeof u === "string");
      if (urls.some((u) => !isAbsoluteHttpUrl(u))) report(p, "format", `${key}은(는) 절대 http(s) URL이어야 한다`);
    }
    if (key === "eventStatus" && !(typeof v === "string" && SCHEMA_EVENT_STATUSES.includes(v))) {
      report(p, "format", `eventStatus는 schema.org EventStatusType 값이어야 한다`);
    }
    if (key === "courseMode" && !(typeof v === "string" && COURSE_MODES.has(v))) {
      report(p, "format", `courseMode는 Onsite·Online·Blended 중 하나여야 한다`);
    }
    walk(v, p, report);
  }
}

function checkOrder(node: Obj, type: string, earlier: string, later: string, report: Report): void {
  const a = node[earlier];
  const b = node[later];
  if (typeof a !== "string" || typeof b !== "string" || !isIsoDate(a) || !isIsoDate(b)) return;
  if (Date.parse(b) < Date.parse(a)) report(`${type}.${later}`, "order", `${later}이(가) ${earlier}보다 이르다`);
}

function validateNode(node: unknown, report: Report): void {
  if (!isObj(node) || typeof node["@type"] !== "string") {
    report("@type", "type", "@type이 있는 JSON-LD 객체가 아니다");
    return;
  }
  const type = node["@type"];
  if (node["@context"] !== SCHEMA_CONTEXT) report(`${type}.@context`, "context", `@context는 ${SCHEMA_CONTEXT}이어야 한다`);
  if (!ALLOWED_TOP_LEVEL_TYPES.includes(type)) {
    report(`${type}.@type`, "type", `${type}은(는) 유형 대응표에 없는 유형이다`);
    return;
  }

  for (const rule of REQUIRED_PROPERTIES[type] ?? []) requireAt(node, rule.path.split("."), type, report);

  if (type === "BreadcrumbList" && Array.isArray(node.itemListElement)) {
    const items = node.itemListElement;
    items.forEach((item, i) => {
      if (!isObj(item)) return;
      const p = `${type}.itemListElement[${i}]`;
      if (i < items.length - 1 && isEmpty(item.item)) report(`${p}.item`, "required", "마지막이 아닌 경로 항목에는 item(URL)이 있어야 한다");
      if (item.position !== undefined && item.position !== i + 1) report(`${p}.position`, "order", `position은 ${i + 1}이어야 한다`);
    });
  }
  if (type === "Dataset" && typeof node.description === "string" && node.description.trim() !== "") {
    const len = [...node.description].length;
    if (len < 50 || len > 5000) report(`${type}.description`, "format", `Dataset 설명은 50~5000자여야 한다 (지금 ${len}자)`);
  }

  walk(node, type, report);
  checkOrder(node, type, "datePublished", "dateModified", report);
  checkOrder(node, type, "startDate", "endDate", report);
}

/** 노드 하나 또는 노드 배열을 검사한다. 오류가 없으면 [] */
export function validate(jsonld: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodes = Array.isArray(jsonld) ? jsonld : [jsonld];
  nodes.forEach((node, i) => {
    validateNode(node, (path, code, message) => errors.push({ node: i, path, code, message }));
  });
  return errors;
}
