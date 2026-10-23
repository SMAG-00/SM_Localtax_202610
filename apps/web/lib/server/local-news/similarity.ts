import { createHash } from "node:crypto";
import { INTERNAL_SIMILARITY_RULES, checkSimilarity, selectThresholds, type InternalSimilaritySettings } from "@ltr/similarity";

// 핫뉴스 항목 요약 유사도 검사 (W6 LG-03) - @ltr/similarity(W1-b)를 요약 하나에 돌린다. 순수 함수 (시험 similarity.test.ts).
// 비교 원문 = 항목의 원문 글자(보도자료) + 같은 주간 페이지의 다른 항목 요약. 원문 글자가 없으면 no_sources(통과 아님).
// 결과는 항목에 적히고, DB 발행 검사가 상태 pass + 요약 해시(md5) 일치를 본다.

export interface DigestSimilarity {
  status: "pass" | "blocked" | "no_sources" | "no_body";
  max: number | null;
  ratio: number | null;
  matches: { index: number; text: string; similarity: number | null; source: string | null }[];
  rulesVersion: string;
}

/** DB의 md5(summary)와 같은 값 - 저장된 글자 그대로 */
export const summaryHash = (summary: string): string => createHash("md5").update(summary, "utf8").digest("hex");

/** 설정 similarity_internal 값 -> 기준 한 벌 (형식이 틀리면 내부 초기값) */
export function internalRules(raw: unknown): InternalSimilaritySettings {
  const r = raw as Record<string, unknown> | null;
  const num = (k: string) => (r && typeof r[k] === "number" && (r[k] as number) >= 0 && (r[k] as number) <= 1 ? (r[k] as number) : null);
  const cmp = (k: string) => (r && (r[k] === "gt" || r[k] === "gte") ? (r[k] as "gt" | "gte") : null);
  const s = num("sentenceSimilarity");
  const a = num("articleRatio");
  const q = num("quoteRatio");
  if (!r || s === null || a === null || q === null || typeof r.version !== "string") return INTERNAL_SIMILARITY_RULES;
  return {
    version: r.version,
    sentenceSimilarity: s,
    sentenceComparator: cmp("sentenceComparator") ?? INTERNAL_SIMILARITY_RULES.sentenceComparator,
    articleRatio: a,
    articleComparator: cmp("articleComparator") ?? INTERNAL_SIMILARITY_RULES.articleComparator,
    quoteRatio: q,
    quoteComparator: cmp("quoteComparator") ?? INTERNAL_SIMILARITY_RULES.quoteComparator,
  };
}

export function digestSimilarity(input: { summary: string; originalText: string | null; siblings: readonly { id: number; summary: string }[]; rules: InternalSimilaritySettings }): DigestSimilarity {
  const selected = selectThresholds({ internal: input.rules });
  if (!input.originalText || input.originalText.trim() === "") {
    return { status: "no_sources", max: null, ratio: null, matches: [], rulesVersion: selected.rulesVersion };
  }
  const result = checkSimilarity({
    draft: input.summary,
    sources: [
      { id: "original", kind: "press_release", text: input.originalText },
      ...input.siblings.map((s) => ({ id: `item-${s.id}`, kind: "hot_news_item" as const, text: s.summary })),
    ],
    ...selected,
  });
  return {
    status: result.status,
    max: result.maxSentenceSimilarity,
    ratio: result.similarSentenceRatio,
    matches: result.perSentence.filter((m) => m.similar && !m.inQuote).map((m) => ({ index: m.index, text: m.text, similarity: m.bestSimilarity, source: m.bestSourceId })),
    rulesVersion: result.rulesVersion ?? selected.rulesVersion,
  };
}
