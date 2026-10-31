// 간편 발행의 작성자 확인 항목 (2026-11-01 PO 결정 — 지역 기사·금융 사례도 작성자가 [발행] 한 번으로)
// 지역 기사 3항목(REG1-17)·금융 사례 '공개 자료 범위'(DF-03)는 없애지 않고 발행하는 사람이 직접 체크한다.
// 체크한 값만 발행과 함께 남기는 편집 승인 checklist에 넣는다 — 키는 DB 트리거(editorial_reviews_regional_guard·finance_guard)가 보는 키와 같다. 안 본 항목을 자동으로 채우지 않는다
import { REGIONAL_CHECKS, type CheckItem } from "./review-form";

export const FINANCE_CASE_CHECK: CheckItem = { id: "public_scope", label: "공개 자료 범위 — 판결문·공시·당국 발표 등 공개된 자료 안에서만 썼습니다" };

/** 문장 안에 쓰는 짧은 이름 */
const SHORT_NAMES: Readonly<Record<string, string>> = { evidence: "근거", relation: "관계", ad_independence: "광고 독립성", public_scope: "공개 자료 범위" };

/** 이 기사의 발행 전 확인 항목 — 지역 기사면 3항목, 금융 사례면 공개 자료 범위. 둘 다 아니면 빈 목록 */
export function publishConfirmItems(kind: { regional: boolean; financeCase: boolean }): CheckItem[] {
  return [...(kind.regional ? REGIONAL_CHECKS : []), ...(kind.financeCase ? [FINANCE_CASE_CHECK] : [])];
}

/** 체크하지 않은 항목 — 발행 요청 본문 confirms에서 값이 정확히 true인 키만 체크로 본다 */
export function uncheckedConfirms(items: readonly CheckItem[], confirms: unknown): CheckItem[] {
  const given = typeof confirms === "object" && confirms !== null && !Array.isArray(confirms) ? (confirms as Record<string, unknown>) : {};
  return items.filter((c) => given[c.id] !== true);
}

/** '발행 전에 고칠 것'·발행 거부에 쓰는 문장 */
export function uncheckedConfirmSentence(items: readonly CheckItem[]): string {
  return `발행 전 확인 항목에 체크해 주세요 — ${items.map((c) => SHORT_NAMES[c.id] ?? c.id).join("·")} (작성자 책임 확인)`;
}

/** 편집 승인 checklist에 넣을 값 — 체크한 항목만 true */
export function confirmedChecklist(items: readonly CheckItem[], confirms: unknown): Record<string, true> {
  const unchecked = new Set(uncheckedConfirms(items, confirms).map((c) => c.id));
  return Object.fromEntries(items.filter((c) => !unchecked.has(c.id)).map((c) => [c.id, true as const]));
}
