// 가짜 모델 - 한 문항 시험·회귀 실행의 시험용 답변 공급자 (4단계 설계 4.2 '시험용 문항·가짜 모델'). 실제 지방세봇(W12-b)이 붙기 전까지 쓴다.
// 법·세무 문장을 만들지 않는다 - 답변은 '[시험용]' 표시와 문항 관리 번호·필수 근거 ID 나열뿐이다.

export const FAKE_MODEL_ID = "fake-model-1";
export const FAKE_PROMPT_VERSION = "fake-prompt-1";
export const FAKE_INDEX_VERSION = "fake-index-1";

export interface FakeItem {
  item_key: string;
  expected_behavior: "answer" | "scope_guide" | "blocked" | "no_answer";
  cross_types: string[];
  expected_clarify: string | null;
  required_citation_ids: string[];
}
export interface FakeAnswer {
  answer_text: string;
  behavior: "answer" | "clarify" | "scope_guide" | "blocked" | "no_answer";
  cited_ids: string[];
  live_citations: number;
  live_without_snapshot: number;
}

/** 기대 응답 모양을 그대로 따르는 성실한 가짜 답변. clarify 문항이면 역질문 모양, 실시간 조회 문항이면 실시간 인용(스냅샷 있음)으로 낸다 */
export function fakeAnswer(item: FakeItem): FakeAnswer {
  const live = item.cross_types.includes("live");
  const clarify = item.cross_types.includes("clarify") && item.expected_clarify !== null;
  const cited = item.expected_behavior === "answer" ? [...item.required_citation_ids] : [];
  const behavior = clarify ? "clarify" : item.expected_behavior;
  return {
    answer_text: `[시험용] 가짜 모델 답변 - 문항 ${item.item_key} (${behavior})`,
    behavior,
    cited_ids: cited,
    live_citations: live ? cited.length : 0,
    live_without_snapshot: 0,
  };
}
