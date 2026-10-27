import "server-only";
import { publicDb, rowsOf } from "./db";

// 홈 해결 사례 공개 읽기 (W13-h HOME-11) - 공개 뷰 public_solved_cases(anon 키)만 읽는다.
// 뷰가 승인 ∧ 지금도 동의 ∧ 원 질문 공개·채택 ∧ 기능 키 solved_cases 켜짐을 읽는 순간 판정하므로 이 함수는 캐시 없이 읽는다 - 동의 철회는 다음 요청부터 반영된다.
// 작성자 번호·연락처는 뷰에 없다. 최근 승인 순 최대 3건.

export const HOME_SOLVED_LIMIT = 3;

export interface SolvedCaseCard {
  id: number;
  questionId: number;
  taxType: string;
  situation: string;
  issue: string;
  result: string;
  lesson: string;
}

export async function getHomeSolvedCases(): Promise<SolvedCaseCard[]> {
  const rows = await rowsOf<{ id: number; question_id: number; tax_type: string; situation: string; issue: string; result: string; lesson: string }>(
    publicDb().from("public_solved_cases").select("id, question_id, tax_type, situation, issue, result, lesson").order("approved_at", { ascending: false }).order("id", { ascending: false }).limit(HOME_SOLVED_LIMIT),
    "홈 해결 사례",
  );
  return rows.map((r) => ({ id: r.id, questionId: r.question_id, taxType: r.tax_type, situation: r.situation, issue: r.issue, result: r.result, lesson: r.lesson }));
}
