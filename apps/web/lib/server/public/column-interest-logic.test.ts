import { describe, expect, it } from "vitest";
import { interestItemsLine, interestLinesByArticle, NO_INTEREST_TEXT, type InterestItemRow } from "./column-interest-logic";

const row = (item: string, state: string, text: string | null = null, article = 1): InterestItemRow => ({ article_id: article, item, state, interest_text: text });

describe("부동산 칼럼 이해관계 줄 (PR-14)", () => {
  it("항목은 입력 순서와 상관없이 조합·시공사·신탁사 순으로 붙는다", () => {
    const line = interestItemsLine([row("trust_company", "none_confirmed"), row("union", "declared", "시험용 조합 자문"), row("contractor", "none_confirmed")]);
    expect(line).toBe(`조합 자문: 시험용 조합 자문 · 시공사 자문: ${NO_INTEREST_TEXT} · 신탁사 자문: ${NO_INTEREST_TEXT}`);
  });

  it("3항목 중 하나라도 없으면 줄을 만들지 않는다", () => {
    expect(interestItemsLine([row("union", "none_confirmed"), row("contractor", "none_confirmed")])).toBeNull();
    expect(interestItemsLine([])).toBeNull();
  });

  it("내용이 빈 declared나 모르는 상태 값이면 줄을 만들지 않는다", () => {
    expect(interestItemsLine([row("union", "declared", "  "), row("contractor", "none_confirmed"), row("trust_company", "none_confirmed")])).toBeNull();
    expect(interestItemsLine([row("union", "other"), row("contractor", "none_confirmed"), row("trust_company", "none_confirmed")])).toBeNull();
  });

  it("기사마다 따로 묶는다", () => {
    const all = (id: number) => [row("union", "none_confirmed", null, id), row("contractor", "none_confirmed", null, id), row("trust_company", "declared", `시험용 신탁 ${id}`, id)];
    const m = interestLinesByArticle([...all(1), ...all(2).slice(0, 2), ...all(3)]);
    expect([...m.keys()]).toEqual([1, 3]);
    expect(m.get(3)).toContain("신탁사 자문: 시험용 신탁 3");
  });
});
