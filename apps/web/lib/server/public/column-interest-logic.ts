// 부동산 칼럼 이해관계 3항목 줄 (PR-14 — 칼럼 머리와 프로젝트 페이지 관련 칼럼 목록이 같은 글자를 쓴다) — 순수 함수 (시험 column-interest-logic.test.ts)
//  · 항목 순서 고정: 조합 → 시공사 → 신탁사 (설계 2.1 column_interest.item)
//  · declared = 필자가 적은 내용 그대로, none_confirmed = 고정 문장 (W3 이해관계 줄 '필자가 밝힌 이해관계 없음'과 같은 방식)
//  · 3항목이 모두 있지 않으면 줄을 만들지 않는다(부분 줄 0) — 발행 검사가 3항목을 보장하므로 공개 칼럼은 늘 모두 있다

export interface InterestItemRow {
  article_id: number | string;
  item: string;
  state: "declared" | "none_confirmed" | string;
  interest_text: string | null;
}

const ITEMS = [
  { item: "union", label: "조합 자문" },
  { item: "contractor", label: "시공사 자문" },
  { item: "trust_company", label: "신탁사 자문" },
] as const;

export const NO_INTEREST_TEXT = "필자가 밝힌 관계 없음";

export function interestItemsLine(rows: readonly InterestItemRow[]): string | null {
  const parts: string[] = [];
  for (const { item, label } of ITEMS) {
    const r = rows.find((x) => x.item === item);
    if (!r) return null;
    if (r.state === "declared") {
      const text = (r.interest_text ?? "").trim();
      if (text === "") return null;
      parts.push(`${label}: ${text}`);
    } else if (r.state === "none_confirmed") parts.push(`${label}: ${NO_INTEREST_TEXT}`);
    else return null;
  }
  return parts.join(" · ");
}

/** 기사 번호별 줄 */
export function interestLinesByArticle(rows: readonly InterestItemRow[]): Map<number, string> {
  const by = new Map<number, InterestItemRow[]>();
  for (const r of rows) {
    const id = Number(r.article_id);
    by.set(id, [...(by.get(id) ?? []), r]);
  }
  const out = new Map<number, string>();
  for (const [id, list] of by) {
    const line = interestItemsLine(list);
    if (line) out.set(id, line);
  }
  return out;
}
