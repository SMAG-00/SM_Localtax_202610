// 제휴사(partners) 규칙 (ART-10 · ADM-01 제휴사 관리) — 순수 모듈. 제휴사 API·제휴사 화면·기사 편집기의 제휴사 고르기가 같이 쓴다.
//  · 등록·수정은 광고·협찬 담당(ad_ops)과 관리자, 편집 책임자는 목록을 읽기만 한다 (lib/access.ts partner.read)
//  · 계약 종료일(contract_to)은 그날까지 유효 — 지난 제휴사는 새 기사에 지정할 수 없고 기존 기사 배지는 남는다.
//    경계는 발행 판정(@ltr/editorial art10.partner-contract-expired)과 같다: contract_to < 오늘(한국 날짜)이면 종료.
import { blank, isValidDate, type FieldErrors } from "./form-utils";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Obj = Record<string, unknown>;

export const PARTNER_KINDS = ["tax_firm", "media", "institution", "local_business"] as const;
export const PARTNER_KIND_LABELS = { tax_firm: "세무법인", media: "언론", institution: "기관", local_business: "지역 사업자" } as const;
export const PARTNER_STATUS_LABELS = { active: "계약 중", expired: "계약 종료", upcoming: "계약 시작 전" } as const;
export type PartnerStatus = keyof typeof PARTNER_STATUS_LABELS;

const LIMITS = { name: 100, intro: 1000, url: 500 } as const;
const HTTP_URL = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const chars = (s: string) => [...s].length;

const FIELDS = [
  ["name", "name"],
  ["kind", "kind"],
  ["intro", "intro"],
  ["url", "url"],
  ["contractFrom", "contract_from"],
  ["contractTo", "contract_to"],
  ["visible", "visible"],
] as const;

export function parsePartnerInput(raw: Obj, mode: "create" | "patch"): Result<Obj> {
  const errors: string[] = [];
  const out: Obj = {};
  const known = new Set<string>(FIELDS.map(([k]) => k));
  for (const key of Object.keys(raw)) if (!known.has(key)) errors.push(`partner.${key}: 모르는 칸입니다`);
  for (const [key, column] of FIELDS) {
    const v = raw[key];
    const at = `partner.${key}`;
    if (v === undefined) {
      if (mode === "create" && (key === "name" || key === "kind")) errors.push(`${at}: 필요합니다`);
      continue;
    }
    switch (key) {
      case "name":
        if (typeof v !== "string" || v.trim() === "") errors.push(`${at}: 비울 수 없습니다`);
        else if (chars(v.trim()) > LIMITS.name) errors.push(`${at}: ${LIMITS.name}자 이하여야 합니다`);
        else out[column] = v.trim();
        break;
      case "kind":
        if (!(PARTNER_KINDS as readonly unknown[]).includes(v)) errors.push(`${at}: ${PARTNER_KINDS.join("·")} 중 하나여야 합니다`);
        else out[column] = v;
        break;
      case "intro":
      case "url":
        if (v === null || (typeof v === "string" && v.trim() === "")) out[column] = null;
        else if (typeof v !== "string" || chars(v.trim()) > LIMITS[key]) errors.push(`${at}: ${LIMITS[key]}자 이하 글자여야 합니다`);
        else if (key === "url" && !HTTP_URL.test(v.trim())) errors.push(`${at}: http:// 또는 https://로 시작하는 주소여야 합니다`);
        else out[column] = v.trim();
        break;
      case "contractFrom":
      case "contractTo":
        if (v === null) out[column] = null;
        else if (typeof v !== "string" || !isValidDate(v)) errors.push(`${at}: YYYY-MM-DD 날짜여야 합니다`);
        else out[column] = v;
        break;
      case "visible":
        if (typeof v !== "boolean") errors.push(`${at}: true/false여야 합니다`);
        else out[column] = v;
        break;
    }
  }
  if (mode === "patch" && errors.length === 0 && Object.keys(out).length === 0) errors.push("partner: 바꿀 칸이 없습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** 저장할 행의 계약 기간 규칙 (DB check와 같다) */
export function partnerDatesError(from: string | null | undefined, to: string | null | undefined): string | null {
  return from && to && to < from ? "계약 종료일이 시작일보다 앞입니다" : null;
}

/** 계약 상태 — today는 한국 날짜 YYYY-MM-DD */
export function partnerStatus(p: { contract_from: string | null; contract_to: string | null }, today: string): PartnerStatus {
  if (p.contract_to !== null && p.contract_to < today) return "expired";
  if (p.contract_from !== null && p.contract_from > today) return "upcoming";
  return "active";
}

/** 새로 지정할 수 없는 사유 (계약 종료) — 지정할 수 있으면 null */
export function newPartnerBlocked(p: { id?: number; name: string; contract_to: string | null }, today: string): string | null {
  return p.contract_to !== null && p.contract_to < today ? `제휴사 ‘${p.name}’의 계약이 ${p.contract_to}에 끝났습니다 — 새 기사에 지정할 수 없습니다 (ART-10)` : null;
}

export interface PartnerChoice {
  value: string;
  label: string;
}

/** 기사 편집기 제휴사 고르기 — 계약이 끝난 제휴사는 빼고 따로 알린다. 이미 지정된 제휴사는 남긴다(기존 배지 유지) */
export function partnerChoices(
  partners: readonly { id: number; name: string; contract_to: string | null }[],
  today: string,
  currentId: number | null,
): { options: PartnerChoice[]; expired: { id: number; name: string; contractTo: string }[] } {
  const options: PartnerChoice[] = [];
  const expired: { id: number; name: string; contractTo: string }[] = [];
  for (const p of partners) {
    const ended = p.contract_to !== null && p.contract_to < today;
    if (ended && p.id !== currentId) {
      expired.push({ id: p.id, name: p.name, contractTo: p.contract_to! });
      continue;
    }
    const label = ended ? `${p.name} (계약 종료 ${p.contract_to} — 지금 지정된 제휴사)` : p.contract_to ? `${p.name} (계약 ${p.contract_to}까지)` : p.name;
    options.push({ value: String(p.id), label });
  }
  return { options, expired };
}

export interface PartnerForm {
  name: string;
  kind: string;
  intro: string;
  url: string;
  contractFrom: string;
  contractTo: string;
  visible: boolean;
}

const orNull = (s: string) => (blank(s) ? null : s.trim());

export function partnerFormToBody(form: PartnerForm, base = "partner"): { ok: true; body: Obj } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (blank(form.name)) errors[`${base}-name`] = "제휴사 이름을 적어 주세요";
  if (!(PARTNER_KINDS as readonly string[]).includes(form.kind)) errors[`${base}-kind`] = "종류를 골라 주세요";
  if (!blank(form.url) && !HTTP_URL.test(form.url.trim())) errors[`${base}-url`] = "http:// 또는 https://로 시작하는 주소를 적어 주세요";
  if (!blank(form.contractFrom) && !isValidDate(form.contractFrom)) errors[`${base}-contract-from`] = "날짜를 골라 주세요";
  if (!blank(form.contractTo) && !isValidDate(form.contractTo)) errors[`${base}-contract-to`] = "날짜를 골라 주세요";
  const dates = partnerDatesError(orNull(form.contractFrom), orNull(form.contractTo));
  if (dates && !errors[`${base}-contract-to`]) errors[`${base}-contract-to`] = dates;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      name: form.name.trim(),
      kind: form.kind,
      intro: orNull(form.intro),
      url: orNull(form.url),
      contractFrom: orNull(form.contractFrom),
      contractTo: orNull(form.contractTo),
      visible: form.visible,
    },
  };
}
