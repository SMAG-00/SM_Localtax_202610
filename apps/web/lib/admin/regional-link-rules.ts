// 지역 연결 규칙 (W4 13단계 — docs/dev/W4_설계.md 1장 13단계 · 2.1 · 3장 · 12장 100번~, PRD-01B REG1-10 · LG-14) — 순수 함수
// 관리 API(/api/admin/regional-links)·관리 화면(/admin/regions/links)·공개 연결 모양(lib/server/public/regional-links-logic.ts)이 같은 값 목록을 쓴다.
// DB 검사(마이그레이션 20261023000048 regional_links 제약·regional_links_guard·regional_links_confirm_check)와 같은 규칙 — 한쪽만 바꾸지 않는다.
// 지역 = 전문 뉴스 허브 — 관광 항목 종류(명소·음식점·관광 정보)는 어디에도 저장하지 않는다(PRD-X).

/** 연결 끝 종류 (설계 2.1 regional_link.from/to type) — local_event는 W6 (지금은 저장 거부) */
export const REGIONAL_LINK_TYPES = ["article", "official_source", "project", "region", "local_event"] as const;
export type RegionalLinkType = (typeof REGIONAL_LINK_TYPES)[number];
/** 저장 거부 종류 (설계 2.1 regional_link.blocked type — PRD-X 관광 항목) */
export const REGIONAL_LINK_BLOCKED_TYPES = ["attraction", "restaurant", "tour_item"] as const;
/** 관계 (설계 2.1) — related_event는 행사 연결(W6)에서만 */
export const REGIONAL_LINK_RELATIONS = ["same_region", "related_tax", "related_realestate", "related_policy", "related_project", "related_event"] as const;
export type RegionalLinkRelation = (typeof REGIONAL_LINK_RELATIONS)[number];
export const REGIONAL_LINK_ORIGINS = ["editor", "auto_candidate"] as const;
export type RegionalLinkOrigin = (typeof REGIONAL_LINK_ORIGINS)[number];
export const REGIONAL_LINK_STATUSES = ["candidate", "confirmed", "removed"] as const;
export type RegionalLinkStatus = (typeof REGIONAL_LINK_STATUSES)[number];

/** W4에서 만들 수 있는 끝 종류 (행사는 W6) */
export const OPEN_LINK_TYPES: readonly RegionalLinkType[] = ["article", "official_source", "project", "region"];
/** 같은 지역 자동 후보를 찾는 출발 종류 (마이그레이션 regional_link_suggest) */
export const SUGGEST_FROM_TYPES: readonly RegionalLinkType[] = ["project", "article", "region"];
/** 편집자가 고를 수 있는 관계 (related_event는 W6) */
export const EDITOR_RELATIONS: readonly RegionalLinkRelation[] = ["same_region", "related_tax", "related_realestate", "related_policy", "related_project"];
/** 연결 이유 글자 수 (DB 제약 regional_links_reason_length) */
export const LINK_REASON_MAX = 300;
/** 자동 후보 — 종류마다 최근 몇 건까지 (DB 함수 c_limit) */
export const SUGGEST_LIMIT = 20;

export const LINK_TYPE_LABELS: Readonly<Record<RegionalLinkType, string>> = {
  article: "기사",
  official_source: "공식 자료",
  project: "프로젝트",
  region: "지역 허브",
  local_event: "행사",
};
export const LINK_RELATION_LABELS: Readonly<Record<RegionalLinkRelation, string>> = {
  same_region: "같은 지역",
  related_tax: "관련 세금",
  related_realestate: "관련 부동산",
  related_policy: "관련 정책",
  related_project: "관련 프로젝트",
  related_event: "관련 행사",
};
export const LINK_STATUS_LABELS: Readonly<Record<RegionalLinkStatus, string>> = { candidate: "후보", confirmed: "확인됨", removed: "지움" };
export const LINK_ORIGIN_LABELS: Readonly<Record<RegionalLinkOrigin, string>> = { editor: "편집자", auto_candidate: "같은 지역 자동 후보" };

export interface LinkRef {
  type: RegionalLinkType;
  id: string;
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const ID_RE = /^[1-9][0-9]{0,17}$/;
const REGION_RE = /^[0-9]{10}$/;

/** 끝 하나 검사 — 칸 이름(from·to)을 앞에 붙인 문장 목록. 관광 항목 종류는 별도 문장(PRD-X) */
export function linkRefErrors(field: "from" | "to", type: unknown, id: unknown): string[] {
  const t = typeof type === "string" ? type.trim() : type;
  if (isOneOf(REGIONAL_LINK_BLOCKED_TYPES, t)) {
    return [`${field}Type: 관광 항목 종류(${t})는 지역 연결에 저장하지 않습니다 — 지역은 전문 뉴스 허브이고 명소·맛집·관광 정보는 만들지 않습니다 (PRD-X)`];
  }
  if (!isOneOf(REGIONAL_LINK_TYPES, t)) return [`${field}Type: ${OPEN_LINK_TYPES.join("·")} 중 하나여야 합니다`];
  if (t === "local_event") return [`${field}Type: 행사(local_event) 연결은 행사 표가 생기는 W6에서 엽니다`];
  const ref = typeof id === "number" && Number.isSafeInteger(id) ? String(id) : typeof id === "string" ? id.trim() : "";
  if (t === "region" ? !REGION_RE.test(ref) : !ID_RE.test(ref)) {
    return [`${field}Id: ${t === "region" ? "행정구역 코드 10자리 숫자" : "1 이상의 번호"}여야 합니다`];
  }
  return [];
}

/** "article:12" · "region:1100000000" → 끝. 모양이 틀리면 null (관리 화면 주소 ?from=) */
export function parseLinkRef(text: string | null | undefined): LinkRef | null {
  const m = /^([a-z_]+):([0-9]+)$/.exec((text ?? "").trim());
  if (!m) return null;
  return linkRefErrors("from", m[1], m[2]).length === 0 ? { type: m[1] as RegionalLinkType, id: m[2] } : null;
}

export const refKey = (r: LinkRef): string => `${r.type}:${r.id}`;

type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function refOf(raw: Record<string, unknown>, field: "from" | "to", errors: string[]): LinkRef | null {
  const type = raw[`${field}Type`];
  const id = raw[`${field}Id`];
  const e = linkRefErrors(field, type, id);
  if (e.length) {
    errors.push(...e);
    return null;
  }
  return { type: String(type).trim() as RegionalLinkType, id: typeof id === "number" ? String(id) : String(id).trim() };
}

function reasonOf(raw: unknown, required: boolean, errors: string[]): string | null {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    errors.push("reason: 글자여야 합니다");
    return null;
  }
  const text = typeof raw === "string" ? raw.trim() : "";
  if (required && text === "") errors.push("reason: 확인 이유를 적으세요 — 확인 기록(확인자·시각·이유)이 있어야 공개됩니다");
  if (text.length > LINK_REASON_MAX) errors.push(`reason: ${LINK_REASON_MAX}자 이하여야 합니다`);
  return text === "" ? null : text;
}

/** 관계 검사 — 목록 밖·related_event(W6)·related_project(한쪽이 프로젝트) */
export function relationErrors(relation: unknown, from: LinkRef | null, to: LinkRef | null): string[] {
  if (!isOneOf(REGIONAL_LINK_RELATIONS, relation)) return [`relation: ${EDITOR_RELATIONS.join("·")} 중 하나여야 합니다`];
  if (relation === "related_event") return ["relation: related_event는 행사 연결(W6)에서만 씁니다"];
  if (relation === "related_project" && from && to && from.type !== "project" && to.type !== "project") return ["relation: related_project는 한쪽이 프로젝트인 연결에만 씁니다"];
  return [];
}

export interface CreateLinkInput {
  from: LinkRef;
  to: LinkRef;
  relation: RegionalLinkRelation;
  reason: string | null;
  /** 만들면서 바로 확인 — 이유 필수, 도착이 공개여야 한다(DB가 다시 본다) */
  confirm: boolean;
}

/** op=create { fromType, fromId, toType, toId, relation, reason?, confirm? } */
export function parseCreateLink(raw: Record<string, unknown>): Result<CreateLinkInput> {
  const errors: string[] = [];
  const from = refOf(raw, "from", errors);
  const to = refOf(raw, "to", errors);
  if (from && to && from.type === to.type && from.id === to.id) errors.push("toId: 자기 자신과는 연결하지 않습니다");
  errors.push(...relationErrors(raw.relation, from, to));
  if (raw.confirm !== undefined && typeof raw.confirm !== "boolean") errors.push("confirm: 참·거짓이어야 합니다");
  const confirm = raw.confirm === true;
  const reason = reasonOf(raw.reason, confirm, errors);
  if (errors.length || !from || !to) return { ok: false, errors };
  return { ok: true, value: { from, to, relation: raw.relation as RegionalLinkRelation, reason, confirm } };
}

const linkIdOf = (raw: unknown, errors: string[]): number => {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1) {
    errors.push("linkId: 1 이상의 번호여야 합니다");
    return 0;
  }
  return raw;
};

/** op=confirm { linkId, reason, relation? } — 이유 필수(확인 기록), 관계를 함께 바꿀 수 있다 */
export function parseConfirmLink(raw: Record<string, unknown>): Result<{ linkId: number; reason: string; relation: RegionalLinkRelation | null }> {
  const errors: string[] = [];
  const linkId = linkIdOf(raw.linkId, errors);
  const reason = reasonOf(raw.reason, true, errors);
  let relation: RegionalLinkRelation | null = null;
  if (raw.relation !== undefined && raw.relation !== null && raw.relation !== "") {
    const e = relationErrors(raw.relation, null, null);
    if (e.length) errors.push(...e);
    else relation = raw.relation as RegionalLinkRelation;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { linkId, reason: reason!, relation } };
}

/** op=remove { linkId, reason } — 지우는 이유 필수(감사) */
export function parseRemoveLink(raw: Record<string, unknown>): Result<{ linkId: number; reason: string }> {
  const errors: string[] = [];
  const linkId = linkIdOf(raw.linkId, errors);
  const reason = reasonOf(raw.reason, false, errors);
  if (reason === null && !errors.some((e) => e.startsWith("reason:"))) errors.push("reason: 지우는 이유를 적으세요");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { linkId, reason: reason! } };
}

/** op=suggest { fromType, fromId } — 같은 지역 자동 후보는 프로젝트·기사·지역에서만 */
export function parseSuggest(raw: Record<string, unknown>): Result<LinkRef> {
  const errors: string[] = [];
  const from = refOf(raw, "from", errors);
  if (from && !SUGGEST_FROM_TYPES.includes(from.type)) errors.push(`fromType: 같은 지역 자동 후보는 ${SUGGEST_FROM_TYPES.join("·")}에서만 찾습니다`);
  if (errors.length || !from) return { ok: false, errors };
  return { ok: true, value: from };
}

/** 상태 바꾸기 판정 (DB 트리거와 같은 흐름) — 안 되면 문장(409) */
export function statusConflict(current: RegionalLinkStatus, next: RegionalLinkStatus): string | null {
  if (current === "removed") return "지운 연결은 되살리지 않습니다 — 새로 만드세요";
  if (current === "confirmed" && next === "confirmed") return "이미 확인된 연결입니다";
  if (current === "confirmed" && next === "candidate") return "확인된 연결을 후보로 돌리지 않습니다 — 지우고 새 후보를 만드세요";
  return null;
}
