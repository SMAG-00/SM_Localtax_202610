import { checkSimilarity, selectThresholds, type InternalSimilaritySettings } from "@ltr/similarity";

// 공공누리 제4유형 전재 검사 (W10-h h5 — PR-06). 순수 함수 - 공개 본문(편집자 요지)이 원천 원문의 문장을 그대로 옮겼는지 @ltr/similarity 로 본다.
// 기준값은 설정 similarity_internal(호출하는 쪽이 읽어 넘김). 원문이 없거나 본문이 없으면 '통과'가 아니다.

export type RightsStatus = "pass" | "blocked" | "no_sources" | "no_body";

export interface RightsVerdict {
  status: RightsStatus;
  maxSimilarity: number | null;
  similarRatio: number | null;
  rulesVersion: string;
}

/** 스냅샷 응답(JSON 글자)에서 문장 비교용 글자만 뽑는다 - 키 이름·구조 기호를 빼고 값(글자)만 줄바꿈으로 잇는다. JSON 이 아니면 그대로 */
export function plainTextOf(payload: string): string {
  try {
    const out: string[] = [];
    const walk = (n: unknown) => {
      if (typeof n === "string") out.push(n);
      else if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") Object.values(n).forEach(walk);
    };
    walk(JSON.parse(payload));
    return out.join("\n");
  } catch {
    return payload;
  }
}

export function rightsVerdict(input: { body: string; original: string; rules: InternalSimilaritySettings }): RightsVerdict {
  const selected = selectThresholds({ internal: input.rules });
  if (input.original.trim() === "") return { status: "no_sources", maxSimilarity: null, similarRatio: null, rulesVersion: selected.rulesVersion };
  const r = checkSimilarity({ draft: input.body, sources: [{ id: "original", kind: "raw_snapshot", text: input.original }], ...selected });
  return { status: r.status, maxSimilarity: r.maxSentenceSimilarity, similarRatio: r.similarSentenceRatio, rulesVersion: r.rulesVersion ?? selected.rulesVersion };
}
