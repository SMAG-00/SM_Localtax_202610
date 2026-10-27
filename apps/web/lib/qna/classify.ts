// 라운지 질문 분류 제안 (AIOPS-15 · QNA-03) - 정규식만 쓴다. DB·네트워크·모델 호출 0 (AI 단계는 4단계 AI 공통 기반 운영 뒤, docs/dev/W13-h_설계.md).
// 결과는 "참고" 제안일 뿐이다 - 운영자가 수락해야 해결 사례 카드 세목에 쓰인다. 국세는 제안 목록에 없다(NT 경계).

/** 지방세 세목 이름 - 제안 후보의 전체 목록 */
export const LOCAL_TAX_TYPES = ["취득세", "재산세", "자동차세", "지방소득세", "주민세", "등록면허세", "지방교육세", "지역자원시설세", "담배소비세", "레저세", "지방소비세"] as const;
export type LocalTaxType = (typeof LOCAL_TAX_TYPES)[number];

export const MAX_PROPOSED = 5;

export interface ClassifyProposal {
  /** 많이 언급된 순서(동수는 목록 순서) 최대 5개 */
  taxTypes: LocalTaxType[];
  /** 가림이 일어난 글 - 운영자 확인 대상 표시 */
  piiSuspected: boolean;
}

/** 제목·본문(가림 후)에서 세목 이름이 나온 횟수로 후보를 만든다. 공백은 무시한다 */
export function classifyQuestion(title: string, body: string, maskedKinds: readonly string[] = []): ClassifyProposal {
  const text = `${title} ${body}`.normalize("NFKC").replace(/\s+/g, "");
  const found = LOCAL_TAX_TYPES.map((name, order) => ({ name, order, count: text.split(name).length - 1 })).filter((x) => x.count > 0);
  found.sort((a, b) => b.count - a.count || a.order - b.order);
  return { taxTypes: found.slice(0, MAX_PROPOSED).map((x) => x.name), piiSuspected: maskedKinds.length > 0 };
}
