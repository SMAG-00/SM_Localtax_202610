// 공개 인터페이스 — 화면과 같은 데이터 객체에서 JSON-LD를 만든다 (OPT-02)
export * from "./models";
export {
  PAGE_TYPE_MAP,
  BREADCRUMB_TYPE,
  ALLOWED_TOP_LEVEL_TYPES,
  EXCLUDED_TYPES,
  type PageKind,
  type PageTypeEntry,
  type AdditionalType,
} from "./types-map";
export { EVENT_STATUS_MAP, EVENT_STATUS_URL, SCHEMA_EVENT_STATUSES } from "./event-status";
export { displayTitle, sponsorLabelText } from "./labels";
export {
  newsArticle,
  paywalledArticle,
  videoObject,
  breadcrumbList,
  newsMediaOrganization,
  person,
  profilePage,
  event,
  book,
  course,
  dataset,
} from "./generators";
export { pageJsonLd } from "./page";
export { toJsonLdScriptContent } from "./serialize";
export { compareRendered, MISMATCH, MISMATCH_LABELS, type MismatchId, type RenderedFacts } from "./compare";
export {
  validate,
  REQUIRED_PROPERTIES,
  FORBIDDEN_PROPERTIES,
  type ValidationError,
  type ValidationCode,
  type RequiredRule,
} from "./validate";
export { SCHEMA_CONTEXT, type JsonLdNode, type JsonValue, type JsonObject } from "./jsonld";
