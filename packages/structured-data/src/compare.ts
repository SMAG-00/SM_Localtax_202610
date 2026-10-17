/**
 * 렌더 값 ↔ JSON-LD 대조 (OPT-02 수용 기준 · OPT-03 차단 항목 '구조화 데이터 불일치').
 * 제목·저자·발행일·수정일·대표 이미지·행사 시작/종료·행사 상태·행사 장소를 본다.
 *
 * 규칙
 * - 한쪽에만 값이 있어도 불일치다 (화면에 없는 값 0).
 * - 제목은 NFC로 맞추고 공백을 합쳐 비교한다 (HTML 렌더가 공백을 합친다).
 * - 저자는 이름 목록을 순서와 상관없이 비교한다.
 * - 날짜는 둘 다 오프셋이 붙은 시각이면 같은 순간인지, 아니면 글자가 같은지 본다.
 * - 화면이 '변경 확인 중'이면 Event가 없어야 맞다 (LG-16).
 */
import type { EventScreenStatus } from "./models";
import type { JsonLdNode } from "./jsonld";
import { EVENT_STATUS_MAP } from "./event-status";
import { PAGE_TYPE_MAP } from "./types-map";

/** 화면(렌더된 HTML)에서 읽은 값 — seo-lint가 페이지에서 뽑아 넘긴다 */
export interface RenderedFacts {
  /** 화면 제목 그대로 (광고·공동 기획 표기 포함). 행사·도서·강좌·통계·인물은 이름 */
  title?: string;
  authorNames?: string[];
  datePublished?: string;
  dateModified?: string;
  mainImageUrl?: string;
  event?: {
    startDate?: string;
    endDate?: string;
    status: EventScreenStatus;
    locationName?: string;
  };
}

/** 불일치 id — seo-lint 차단 항목 '구조화 데이터 불일치'의 세부 항목 */
export const MISMATCH = {
  HEADLINE: "structured-data.headline",
  AUTHOR: "structured-data.author",
  DATE_PUBLISHED: "structured-data.datePublished",
  DATE_MODIFIED: "structured-data.dateModified",
  IMAGE: "structured-data.image",
  EVENT_START: "structured-data.event.startDate",
  EVENT_END: "structured-data.event.endDate",
  EVENT_STATUS: "structured-data.event.status",
  EVENT_LOCATION: "structured-data.event.location",
  NODE_MISSING: "structured-data.node-missing",
} as const;

export type MismatchId = (typeof MISMATCH)[keyof typeof MISMATCH];

/** 편집기 점검 패널에 보일 이름 */
export const MISMATCH_LABELS: Readonly<Record<MismatchId, string>> = {
  [MISMATCH.HEADLINE]: "구조화 데이터 제목 ≠ 화면 제목",
  [MISMATCH.AUTHOR]: "구조화 데이터 저자 ≠ 화면 저자",
  [MISMATCH.DATE_PUBLISHED]: "구조화 데이터 발행일 ≠ 화면 발행일",
  [MISMATCH.DATE_MODIFIED]: "구조화 데이터 수정일 ≠ 화면 수정일",
  [MISMATCH.IMAGE]: "구조화 데이터 대표 이미지 ≠ 화면 대표 이미지",
  [MISMATCH.EVENT_START]: "구조화 데이터 행사 시작 ≠ 화면 행사 시작",
  [MISMATCH.EVENT_END]: "구조화 데이터 행사 종료 ≠ 화면 행사 종료",
  [MISMATCH.EVENT_STATUS]: "구조화 데이터 행사 상태 ≠ 화면 행사 상태",
  [MISMATCH.EVENT_LOCATION]: "구조화 데이터 행사 장소 ≠ 화면 행사 장소",
  [MISMATCH.NODE_MISSING]: "화면에 있는 항목의 구조화 데이터 없음",
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function toNodes(jsonld: unknown): JsonLdNode[] {
  const value = typeof jsonld === "string" ? (JSON.parse(jsonld) as unknown) : jsonld;
  return asList(value).filter((n): n is JsonLdNode => isObj(n) && typeof n["@type"] === "string");
}

/** 주 노드 고르는 순서 — 유형 대응표의 주 유형 순서, 그다음 Person·VideoObject */
const PRIMARY_ORDER: string[] = [...Object.values(PAGE_TYPE_MAP).map((e) => e.primaryType as string), "Person", "VideoObject"];

function pickPrimary(nodes: JsonLdNode[]): JsonLdNode | undefined {
  let best: JsonLdNode | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    const rank = PRIMARY_ORDER.indexOf(n["@type"]);
    if (rank !== -1 && rank < bestRank) {
      best = n;
      bestRank = rank;
    }
  }
  return best;
}

const normText = (s: string | undefined): string => (s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

const OFFSET_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function sameDate(a: string | undefined, b: string | undefined): boolean {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (x === "" || y === "") return x === y;
  if (OFFSET_DATETIME.test(x) && OFFSET_DATETIME.test(y)) return Date.parse(x) === Date.parse(y);
  return x === y;
}

function sameNames(a: string[] | undefined, b: string[]): boolean {
  const x = (a ?? []).map(normText).sort();
  const y = b.map(normText).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function firstImageUrl(image: unknown): string | undefined {
  const first = asList(image)[0];
  return typeof first === "string" ? first : isObj(first) ? str(first.url) : undefined;
}

function hasAnyFact(r: RenderedFacts): boolean {
  return Object.values(r).some((v) => v !== undefined);
}

export function compareRendered(rendered: RenderedFacts, jsonld: unknown): MismatchId[] {
  const nodes = toNodes(jsonld);
  const eventNode = nodes.find((n) => n["@type"] === PAGE_TYPE_MAP.event.primaryType);

  if (rendered.event && EVENT_STATUS_MAP[rendered.event.status] === null) {
    return eventNode ? [MISMATCH.EVENT_STATUS] : [];
  }
  if (rendered.event && !eventNode) return [MISMATCH.NODE_MISSING];

  const primary = eventNode ?? pickPrimary(nodes);
  if (!primary) return hasAnyFact(rendered) ? [MISMATCH.NODE_MISSING] : [];

  const entity: Obj = primary["@type"] === PAGE_TYPE_MAP.person.primaryType && isObj(primary.mainEntity) ? primary.mainEntity : primary;
  const out: MismatchId[] = [];

  const jsonTitle = primary["@type"] === PAGE_TYPE_MAP.article.primaryType ? str(primary.headline) : str(entity.name);
  if (normText(rendered.title) !== normText(jsonTitle)) out.push(MISMATCH.HEADLINE);

  const jsonAuthors = asList(entity.author).map((a) => (isObj(a) ? (str(a.name) ?? "") : ""));
  if (!sameNames(rendered.authorNames, jsonAuthors)) out.push(MISMATCH.AUTHOR);

  if (!sameDate(rendered.datePublished, str(entity.datePublished))) out.push(MISMATCH.DATE_PUBLISHED);
  if (!sameDate(rendered.dateModified, str(entity.dateModified))) out.push(MISMATCH.DATE_MODIFIED);
  if ((rendered.mainImageUrl ?? "") !== (firstImageUrl(entity.image) ?? "")) out.push(MISMATCH.IMAGE);

  if (rendered.event || eventNode) {
    const ev = rendered.event;
    if (!sameDate(ev?.startDate, str(primary.startDate))) out.push(MISMATCH.EVENT_START);
    if (!sameDate(ev?.endDate, str(primary.endDate))) out.push(MISMATCH.EVENT_END);
    const expectedStatus = ev ? EVENT_STATUS_MAP[ev.status] : undefined;
    if ((expectedStatus ?? "") !== (str(primary.eventStatus) ?? "")) out.push(MISMATCH.EVENT_STATUS);
    const jsonLocation = isObj(primary.location) ? str(primary.location.name) : undefined;
    if (normText(ev?.locationName) !== normText(jsonLocation)) out.push(MISMATCH.EVENT_LOCATION);
  }
  return out;
}
