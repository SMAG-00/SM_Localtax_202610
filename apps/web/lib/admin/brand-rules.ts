// 브랜드 관리 입력 검사 (W3 7단계 — BR-01·07·10, docs/dev/W3_설계.md 2.1 · 6장) — 순수 모듈 (시험 brand-rules.test.ts).
// 증빙·동의서 문서는 저장소 밖이고 여기서는 위치(참조)만 받는다. 약력 문구·경력 연수·동의서 문구는 만들지 않는다(사람이 넣는다).
import { CONSENT_SCOPES, EVIDENCE_KINDS, type ConsentScope, type EvidenceKind } from "@/lib/server/public/constants";

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const id = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d+$/.test(v.trim()) && Number(v) > 0 ? Number(v) : null);
const MAX_REF = 500;
const MAX_ITEM = 200;
const MAX_ITEMS = 30;

export interface EvidenceInput {
  personId: number;
  kind: EvidenceKind;
  docRef: string;
}
export function parseEvidence(body: Record<string, unknown>): Parsed<EvidenceInput> {
  const errors: string[] = [];
  const personId = id(body.personId);
  const docRef = text(body.docRef);
  const kind = String(body.kind ?? "");
  if (!personId) errors.push("personId(인물 번호)가 필요합니다");
  if (!docRef) errors.push("docRef(증빙 문서 위치)가 필요합니다");
  else if (docRef.length > MAX_REF) errors.push(`docRef는 ${MAX_REF}자 이하입니다`);
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) errors.push(`kind는 ${EVIDENCE_KINDS.join("·")} 중 하나입니다`);
  return errors.length ? { ok: false, errors } : { ok: true, value: { personId: personId!, kind: kind as EvidenceKind, docRef: docRef! } };
}

export interface ConsentInput {
  personId: number;
  version: string;
  scope: ConsentScope[];
  docRef: string;
  validFrom: string | null;
  validTo: string | null;
}
const isoOrNull = (v: unknown): string | null | false => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) return false;
  return new Date(v).toISOString();
};
/** 동의서 버전 기록 — 범위는 설계 값만(중복 제거), 시작은 지금 이전(미래 시작 거부 — DB도 거부), 끝은 시작 뒤 */
export function parseConsent(body: Record<string, unknown>, now: Date): Parsed<ConsentInput> {
  const errors: string[] = [];
  const personId = id(body.personId);
  const version = text(body.version);
  const docRef = text(body.docRef);
  const rawScope = Array.isArray(body.scope) ? body.scope.map((s) => String(s).trim()) : [];
  const scope = [...new Set(rawScope)];
  const validFrom = isoOrNull(body.validFrom);
  const validTo = isoOrNull(body.validTo);
  if (!personId) errors.push("personId(인물 번호)가 필요합니다");
  if (!version) errors.push("version(동의서 버전)이 필요합니다");
  else if (version.length > 100) errors.push("version은 100자 이하입니다");
  if (!docRef) errors.push("docRef(동의서 문서 위치)가 필요합니다");
  else if (docRef.length > MAX_REF) errors.push(`docRef는 ${MAX_REF}자 이하입니다`);
  if (scope.length === 0) errors.push("scope(사용 범위)를 하나 이상 고르세요");
  const bad = scope.filter((s) => !(CONSENT_SCOPES as readonly string[]).includes(s));
  if (bad.length) errors.push(`scope는 ${CONSENT_SCOPES.join("·")} 중에서 고릅니다 — 받을 수 없는 값: ${bad.join(", ")}`);
  if (validFrom === false) errors.push("validFrom은 날짜·시각이어야 합니다");
  if (validTo === false) errors.push("validTo는 날짜·시각이어야 합니다");
  if (typeof validFrom === "string" && Date.parse(validFrom) > now.getTime()) errors.push("validFrom은 지금보다 뒤일 수 없습니다 — 동의서를 받은 뒤 기록합니다");
  const start = typeof validFrom === "string" ? Date.parse(validFrom) : now.getTime();
  if (typeof validTo === "string" && Date.parse(validTo) <= start) errors.push("validTo는 시작보다 뒤여야 합니다");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { personId: personId!, version: version!, scope: scope as ConsentScope[], docRef: docRef!, validFrom: validFrom || null, validTo: validTo || null } };
}

export interface BioItemInput {
  item: string;
  evidence_id: string;
}
/**
 * 약력 항목 저장 — 항목마다 그 인물의 증빙 번호가 있어야 한다 (BR-01 · BR-10 '증빙 없는 사실이 든 문장 저장 거부').
 * 승인 전 증빙을 가리켜도 저장은 되고 화면에는 승인 뒤에만 나온다(공개 뷰가 거른다). 이메일 섞인 줄은 거부
 */
export function parseBio(body: Record<string, unknown>, evidenceIdsOfPerson: ReadonlySet<number>): Parsed<{ personId: number; items: BioItemInput[] }> {
  const errors: string[] = [];
  const personId = id(body.personId);
  if (!personId) errors.push("personId(인물 번호)가 필요합니다");
  const raw = Array.isArray(body.items) ? body.items : null;
  if (!raw) errors.push("items(약력 항목 목록)가 필요합니다");
  else if (raw.length > MAX_ITEMS) errors.push(`약력 항목은 ${MAX_ITEMS}개 이하입니다`);
  const items: BioItemInput[] = [];
  (raw ?? []).forEach((r, i) => {
    const o = typeof r === "object" && r !== null ? (r as Record<string, unknown>) : {};
    const item = text(o.item);
    const ev = id(o.evidenceId ?? o.evidence_id);
    if (!item) errors.push(`${i + 1}번째 항목: 글자가 비었습니다`);
    else if (item.length > MAX_ITEM) errors.push(`${i + 1}번째 항목: ${MAX_ITEM}자 이하입니다`);
    else if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(item)) errors.push(`${i + 1}번째 항목: 이메일 주소는 약력에 넣지 않습니다`);
    if (!ev) errors.push(`${i + 1}번째 항목: 증빙 번호(evidenceId)가 필요합니다 — 증빙 없는 약력은 저장하지 않습니다`);
    else if (!evidenceIdsOfPerson.has(ev)) errors.push(`${i + 1}번째 항목: 증빙 ${ev}번은 이 인물의 증빙이 아닙니다`);
    if (item && ev) items.push({ item, evidence_id: String(ev) });
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: { personId: personId!, items } };
}

/** 경력 표시 승인 값 (settings.career_claim_approved — 설계 2.2 모양 그대로). 철회는 근거·승인자를 비운다 */
export function careerClaimValue(on: boolean, basisEvidenceId: number | null, actor: string, nowIso: string) {
  return on
    ? { approved: true, basis_evidence_id: basisEvidenceId, approved_by: actor, approved_at: nowIso }
    : { approved: false, basis_evidence_id: null, approved_by: null, approved_at: null };
}

/** 광고 규정 감수 기록 값 (settings.brand_copy_review — 설계 2.2 모양 그대로) */
export function brandReviewValue(on: boolean, recordRef: string | null) {
  return on ? { reviewed: true, record_id: recordRef } : { reviewed: false, record_id: null };
}
