import "server-only";
import { publicDb, rowsOf } from "./db";
import { interestLinesByArticle, type InterestItemRow } from "./column-interest-logic";
import { getFinanceInterestLine } from "./finance";
import { readPublicSettings } from "./reads";

// 칼럼 상세의 이해관계 줄 + 의견 고지 (TX-16·17 — docs/dev/W3_설계.md 1장 6단계). 공개 뷰 public_column_disclosures만 읽는다(공개 기사의 줄만, 계약·증빙 위치 없음).
// 기능 키 tax_columns가 꺼져 있거나 고지 문구가 비어 있으면 null — 화면은 지금까지처럼 칼럼 본문만 보인다.

export interface ColumnDisclosure {
  /** 이해관계 줄 — 내용이 있으면 그 글자, 필자가 '없음'을 확인했으면 고정 문장 */
  interestLine: string;
  /** PO 감수본 의견 고지 (설정값) */
  notice: string;
  aiIndexAllowed: boolean;
  /** 부동산 칼럼의 조합·시공사·신탁사 자문 줄 (PR-14) — 부동산 칼럼이 아니면 null */
  itemsLine: string | null;
}

/**
 * 부동산 칼럼 이해관계 3항목 줄 (PR-14) — 공개 뷰 public_column_interest_items만 읽는다. 칼럼 머리(getColumnDisclosure)와
 * 프로젝트 페이지 관련 칼럼 목록이 같은 함수를 쓰므로 글자가 같다. 기능 키 tax_columns가 꺼져 있으면 빈 지도
 */
export async function readColumnInterestLines(articleIds: readonly number[]): Promise<Map<number, string>> {
  if (articleIds.length === 0) return new Map();
  const settings = await readPublicSettings();
  if (!settings.features.tax_columns) return new Map();
  const rows = await rowsOf<InterestItemRow>(
    publicDb().from("public_column_interest_items").select("article_id, item, state, interest_text").in("article_id", [...articleIds]),
    "부동산 칼럼 이해관계 항목",
  );
  return interestLinesByArticle(rows);
}

interface Row {
  interest_state: "declared" | "none_confirmed";
  interest_text: string | null;
  ai_index_scope: "allow" | "deny" | null;
  opinion_notice: string | null;
}

export async function getColumnDisclosure(articleId: number): Promise<ColumnDisclosure | null> {
  const settings = await readPublicSettings();
  if (!settings.features.tax_columns) return null;
  const [row] = await rowsOf<Row>(
    publicDb().from("public_column_disclosures").select("interest_state, interest_text, ai_index_scope, opinion_notice").eq("article_id", articleId).limit(1),
    "칼럼 이해관계",
  );
  if (!row) return null;
  const notice = (row.opinion_notice ?? "").trim();
  if (notice === "") return null;
  const interestLine = row.interest_state === "declared" ? `이해관계: ${row.interest_text ?? ""}` : "이해관계: 필자가 밝힌 이해관계 없음";
  // 부동산 칼럼 3항목 줄 또는 개발금융 칼럼 소속 2항목 줄 (W5 DF-09) - 칼럼 분야가 다르므로 한쪽만 있다
  const itemsLine = (await readColumnInterestLines([articleId])).get(articleId) ?? (await getFinanceInterestLine(articleId));
  return { interestLine, notice, aiIndexAllowed: row.ai_index_scope !== "deny", itemsLine };
}
