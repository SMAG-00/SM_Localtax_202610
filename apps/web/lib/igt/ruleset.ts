import type { IgtRuleset } from "@ltr/igt-engine";

// 활성 룰셋 본문이 엔진이 읽는 모양인지 최소한만 확인한다 - 모양이 어긋나면 없는 것으로 치고 그 계산기는 닫힌다 (값은 읽지 않는다: 값의 정본은 서명된 룰셋)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function asIgtRuleset(raw: unknown): IgtRuleset | null {
  if (!isObj(raw)) return null;
  const { version, effective_from: from, common, gift, inheritance, payment } = raw;
  if (typeof version !== "string" || typeof from !== "string") return null;
  if (!isObj(common) || !isObj(gift) || !isObj(inheritance) || !isObj(payment)) return null;
  if (!isObj(common.thresholds)) return null;
  if (!Array.isArray(common.tax_brackets) || common.tax_brackets.length === 0) return null;
  if (!isObj(gift.deductions) || !isObj(inheritance.deductions)) return null;
  if (!isObj(payment.installment) || !isObj(payment.annual_installment) || !isObj(payment.payment_in_kind)) return null;
  return raw as unknown as IgtRuleset;
}
