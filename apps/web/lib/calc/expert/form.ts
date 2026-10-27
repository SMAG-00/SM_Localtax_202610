import type { CorporateLocalIncomeInput, EntityLocalTaxInput, ListingChoice, OligopolyInput } from "@ltr/tax-engine/expert";

// 전문가 계산기 입력 변환 (W13-f) - 화면 글자 -> 엔진 입력. 순수 함수. 숫자 상한 외에 세율·기준 값은 어디에도 없다.

export type Built<T> = { ok: true; input: T } | { ok: false; errors: Record<string, string> };

const MAX_DIGITS = 15;

/** "1,234,000" -> 1234000. 숫자와 쉼표만, 15자리까지. 빈 칸·0은 null */
export function parseWon(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (!/^\d+$/.test(t) || t.length > MAX_DIGITS) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 0 이상 허용 (과세표준 0) */
export function parseWonOrZero(text: string): number | null {
  return text.trim() === "0" ? 0 : parseWon(text);
}

/** "50.0001" (%) -> 0.500001. 소수 넷째 자리까지, 0~100 */
export function parsePercentRatio(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(t)) return null;
  const p = Number(t);
  if (p < 0 || p > 100) return null;
  return Math.round(p * 1e4) / 1e6;
}

export interface OligopolyForm {
  listing: ListingChoice | "";
  bookValue: string;
  beforePercent: string;
  afterPercent: string;
}
export const OLIGOPOLY_FORM_EMPTY: OligopolyForm = { listing: "", bookValue: "", beforePercent: "", afterPercent: "" };

export function buildOligopoly(f: OligopolyForm): Built<{ listing: ListingChoice; input: OligopolyInput }> {
  const errors: Record<string, string> = {};
  if (f.listing !== "listed" && f.listing !== "unlisted" && f.listing !== "unknown") errors.listing = "상장 여부를 골라 주세요.";
  const bookValue = parseWon(f.bookValue);
  if (bookValue === null) errors.bookValue = "장부가액을 숫자로 입력해 주세요.";
  const before = parsePercentRatio(f.beforePercent);
  if (before === null) errors.beforePercent = "취득 전 지분율을 0~100 사이 숫자로 입력해 주세요.";
  const after = parsePercentRatio(f.afterPercent);
  if (after === null) errors.afterPercent = "취득 후 지분율을 0~100 사이 숫자로 입력해 주세요.";
  if (Object.keys(errors).length > 0 || bookValue === null || before === null || after === null) return { ok: false, errors };
  return { ok: true, input: { listing: f.listing as ListingChoice, input: { bookValue, beforeRatio: before, afterRatio: after } } };
}

export interface CorporateForm {
  taxBase: string;
}
export const CORPORATE_FORM_EMPTY: CorporateForm = { taxBase: "" };

export function buildCorporate(f: CorporateForm): Built<CorporateLocalIncomeInput> {
  const taxBase = parseWonOrZero(f.taxBase);
  if (taxBase === null) return { ok: false, errors: { taxBase: "법인세 과세표준을 숫자로 입력해 주세요. (0 이상)" } };
  return { ok: true, input: { taxBase } };
}

export const ENTITY_PROPERTY_KINDS = ["HOUSE", "COMMERCIAL", "LAND", "OFFICETEL"] as const;
export interface EntityForm {
  propertyKind: (typeof ENTITY_PROPERTY_KINDS)[number] | "";
  price: string;
  publishedPrice: string;
}
export const ENTITY_FORM_EMPTY: EntityForm = { propertyKind: "", price: "", publishedPrice: "" };

export function buildEntity(f: EntityForm): Built<EntityLocalTaxInput> {
  const errors: Record<string, string> = {};
  const kind = ENTITY_PROPERTY_KINDS.find((k) => k === f.propertyKind);
  if (!kind) errors.propertyKind = "물건 종류를 골라 주세요.";
  const price = parseWon(f.price);
  if (price === null) errors.price = "취득가액을 숫자로 입력해 주세요.";
  const published = f.publishedPrice.trim() === "" ? undefined : parseWon(f.publishedPrice);
  if (published === null) errors.publishedPrice = "공시가격은 숫자로 입력하거나 비워 주세요.";
  if (Object.keys(errors).length > 0 || !kind || price === null || published === null) return { ok: false, errors };
  return {
    ok: true,
    input: {
      acquisition: { propertyKind: kind, cause: "PAID", price },
      ...(published !== undefined ? { holding: { propertyKind: kind, publishedPrices: [published] } } : {}),
    },
  };
}
