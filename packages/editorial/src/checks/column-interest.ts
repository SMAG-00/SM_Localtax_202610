// PR-14 부동산 칼럼 이해관계 3항목 (01B W4 21단계 — docs/dev/W4_설계.md 1장 21단계 · 11.21 · 12장 #170)
// DB 트리거(마이그레이션 20261023000055 realestate_column_interest_problem)와 같은 규칙을 발행 서비스 쪽에서 한 번 더 본다.
//  · 부동산 칼럼(분야 realestate · 유형 opinion)은 조합·시공사·신탁사 자문 관계 3항목이 모두 저장돼 있어야 발행된다(각 declared 또는 none_confirmed)
//  · 대상은 W3 칼럼 발행 검사와 같다 — realestateColumn.required (칼럼 기록이 있거나 기능 키 tax_columns 켜짐)
//  · 부동산 칼럼이 아니거나 입력이 없으면 아무것도 하지 않는다
import { finding, type Finding } from "../findings";
import type { ArticleForPublish } from "../model";

/** 항목 키 → 화면 글자 (설계 2.1 column_interest.item 순서) */
export const COLUMN_INTEREST_ITEMS = [
  { item: "union", label: "조합 자문 관계" },
  { item: "contractor", label: "시공사 자문 관계" },
  { item: "trust_company", label: "신탁사 자문 관계" },
] as const;

/** 빠진 항목 글자 — 문제 없으면 null */
export function columnInterestProblem(article: ArticleForPublish): { missing: string[] } | null {
  const rc = article.realestateColumn;
  if (!rc || !rc.required || article.section !== "realestate" || article.contentType !== "opinion") return null;
  const have = new Set(rc.items.filter((i) => i.state === "declared" || i.state === "none_confirmed").map((i) => i.item));
  const missing = COLUMN_INTEREST_ITEMS.filter((i) => !have.has(i.item)).map((i) => i.label);
  return missing.length === 0 ? null : { missing };
}

export function checkColumnInterest(article: ArticleForPublish): Finding[] {
  const problem = columnInterestProblem(article);
  if (!problem) return [];
  return [
    finding(
      "pr14.column-interest",
      `부동산 칼럼은 조합·시공사·신탁사 자문 관계 3항목을 모두 밝혀야 발행됩니다 — 빠진 항목: ${problem.missing.join("·")}. 관계가 없으면 필자 확인과 함께 '없음'을 골라야 합니다 (PR-14)`,
      { field: "columnInterest" },
    ),
  ];
}
