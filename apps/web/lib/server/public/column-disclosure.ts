import "server-only";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// 칼럼 상세의 이해관계 줄 + 의견 고지 (TX-16·17 — docs/dev/W3_설계.md 1장 6단계). 공개 뷰 public_column_disclosures만 읽는다(공개 기사의 줄만, 계약·증빙 위치 없음).
// 기능 키 tax_columns가 꺼져 있거나 고지 문구가 비어 있으면 null — 화면은 지금까지처럼 칼럼 본문만 보인다.

export interface ColumnDisclosure {
  /** 이해관계 줄 — 내용이 있으면 그 글자, 필자가 '없음'을 확인했으면 고정 문장 */
  interestLine: string;
  /** PO 감수본 의견 고지 (설정값) */
  notice: string;
  aiIndexAllowed: boolean;
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
  return { interestLine, notice, aiIndexAllowed: row.ai_index_scope !== "deny" };
}
