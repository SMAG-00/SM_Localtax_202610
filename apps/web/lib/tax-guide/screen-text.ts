// 화면 문구 검사 (W11-c - RDV-09 · PR-12 · DF-08 · 투자 권유 금지). 판정·가이드 화면에 나오는 사이트 고정 문구와 감수 원고를 렌더 전에 한 번 걸러 본다.
//  · PRD-00 8.8 금지 표현 사전은 @ltr/editorial이 정본이다. 이 파일은 W11-c 화면에만 더 붙는 낱말(RDV-09 · 판정 화면)을 가진다.
//  · 감수 원고(guide_versions)도 같은 검사를 받는다 - 걸리면 그 절을 그리지 않고 편집 검수 항목으로 넘긴다.

/** RDV-09 + PR-12 추가 금지 낱말 (분담금·사업성·예상 수익·유망 구역·추천, 판정의 유리/불리) */
export const W11C_EXTRA_FORBIDDEN: readonly string[] = [
  "유망 구역",
  "유망구역",
  "예상 수익",
  "분담금 계산",
  "분담금 예상",
  "사업성",
  "수익률 순위",
  "절세 추천",
  "유리합니다",
  "불리합니다",
  "추천합니다",
  "가입하세요",
];

export function extraForbiddenHits(text: string): string[] {
  const compact = text.replace(/\s+/g, "");
  return W11C_EXTRA_FORBIDDEN.filter((w) => compact.includes(w.replace(/\s+/g, "")));
}

/** 국세 금액·세액 표현 (숫자 + 원) - 가이드·판정 화면에는 금액이 없어야 한다 (뒤가 원칙·원리·원본·원문·원장·원소·원형·원점이면 금액이 아니다) */
const AMOUNT = /[0-9][0-9,.]*\s*(?:십|백|천|만|억|조)?\s*원(?!칙|리|본|문|장|소|형|점)/;
export function amountHits(text: string): string[] {
  const m = AMOUNT.exec(text);
  return m ? [m[0]] : [];
}

export interface ScreenTextProblem {
  kind: "extra_forbidden" | "amount";
  hit: string;
}

export function screenTextProblems(text: string): ScreenTextProblem[] {
  return [...extraForbiddenHits(text).map((hit) => ({ kind: "extra_forbidden" as const, hit })), ...amountHits(text).map((hit) => ({ kind: "amount" as const, hit }))];
}
