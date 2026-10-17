import { buildProfile, profileSimilarity, type TextProfile } from "./measure";
import { INTERNAL_SIMILARITY_RULES } from "./rules";
import { segmentDraft, splitSentences } from "./split";
import {
  SOURCE_KINDS,
  type Comparator,
  type ResolvedThresholds,
  type SentenceMatch,
  type SimilarityInput,
  type SimilarityResult,
  type SimilaritySource,
  type SimilarityThresholds,
} from "./types";
import { ENGINE_VERSION } from "./version";

/** 부동소수 계산 오차 허용폭 — 기준과 이 폭 안의 값은 같은 값으로 본다 */
const EPSILON = 1e-9;

/** value가 기준을 충족하는지 — gte 이상, gt 초과 */
export function meetsThreshold(value: number, threshold: number, comparator: Comparator): boolean {
  return comparator === "gte" ? value >= threshold - EPSILON : value > threshold + EPSILON;
}

interface SourceSentence {
  sourceId: string;
  index: number;
  profile: TextProfile;
}

/**
 * 발행 전 유사도 검사 (OPT-06). 원고 문장마다 모든 비교 원문 문장 중 최고 일치를 찾고,
 * 문장 기준을 충족한 본문 문장 비율이 기사 기준을 넘으면 차단한다. 인용 블록('>' 줄)은 비율에서 빼고 따로 센다.
 * 비교할 원문 문장이 0개면 'no_sources', 판정할 본문 문장이 0개(빈 원고·인용만)면 'no_body' — 둘 다 통과로 표시하지 않는다. 같은 입력이면 같은 결과.
 */
export function checkSimilarity(input: SimilarityInput): SimilarityResult {
  const thresholds = resolveThresholds(input.thresholds);
  input.sources.forEach(assertSource);

  const draft = segmentDraft(input.draft);
  const bodySentenceCount = draft.filter((s) => !s.inQuote).length;
  const quoteSentenceCount = draft.length - bodySentenceCount;
  const quoteRatio = draft.length === 0 ? 0 : quoteSentenceCount / draft.length;
  const quoteWarning =
    quoteSentenceCount > 0 && meetsThreshold(quoteRatio, thresholds.quoteRatio, thresholds.quoteComparator);

  const corpus: SourceSentence[] = [];
  const comparedSources: string[] = [];
  for (const source of input.sources) {
    const sentences = splitSentences(source.text);
    if (sentences.length === 0) continue;
    if (!comparedSources.includes(source.id)) comparedSources.push(source.id);
    sentences.forEach((text, index) => corpus.push({ sourceId: source.id, index, profile: buildProfile(text) }));
  }

  const common = {
    bodySentenceCount,
    quoteSentenceCount,
    quoteRatio,
    quoteWarning,
    comparedSources,
    thresholdSource: input.thresholdSource,
    thresholds,
    rulesVersion: input.rulesVersion ?? null,
    engineVersion: ENGINE_VERSION,
  };

  if (corpus.length === 0 || bodySentenceCount === 0) {
    return {
      status: corpus.length === 0 ? "no_sources" : "no_body",
      maxSentenceSimilarity: null,
      similarSentenceRatio: null,
      similarSentenceCount: null,
      ...common,
      perSentence: draft.map((s, index) => ({
        index,
        text: s.text,
        inQuote: s.inQuote,
        bestSimilarity: null,
        bestSourceId: null,
        bestSourceSentence: null,
        similar: false,
      })),
    };
  }

  const perSentence: SentenceMatch[] = draft.map((s, index) => {
    const profile = buildProfile(s.text);
    let best = -1;
    let bestAt: SourceSentence | null = null;
    for (const candidate of corpus) {
      const similarity = profileSimilarity(profile, candidate.profile);
      // 같은 값이면 먼저 넘긴 원문·앞 문장을 남긴다 (엄격한 > 비교)
      if (similarity > best) {
        best = similarity;
        bestAt = candidate;
        if (best === 1) break;
      }
    }
    const matched = best > 0 ? bestAt : null;
    return {
      index,
      text: s.text,
      inQuote: s.inQuote,
      bestSimilarity: best,
      bestSourceId: matched?.sourceId ?? null,
      bestSourceSentence: matched?.index ?? null,
      similar: meetsThreshold(best, thresholds.sentenceSimilarity, thresholds.sentenceComparator),
    };
  });

  const body = perSentence.filter((s) => !s.inQuote);
  const similarSentenceCount = body.filter((s) => s.similar).length;
  const similarSentenceRatio = bodySentenceCount === 0 ? 0 : similarSentenceCount / bodySentenceCount;
  const maxSentenceSimilarity = body.reduce((max, s) => Math.max(max, s.bestSimilarity ?? 0), 0);
  const blocked = meetsThreshold(similarSentenceRatio, thresholds.articleRatio, thresholds.articleComparator);

  return {
    status: blocked ? "blocked" : "pass",
    maxSentenceSimilarity,
    similarSentenceRatio,
    similarSentenceCount,
    ...common,
    perSentence,
  };
}

function resolveThresholds(t: SimilarityThresholds): ResolvedThresholds {
  for (const key of ["sentenceSimilarity", "articleRatio", "quoteRatio"] as const) {
    const value = t[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`thresholds.${key}는 0~1 사이 비율이어야 합니다 (받은 값: ${String(value)})`);
    }
  }
  const resolved: ResolvedThresholds = {
    sentenceSimilarity: t.sentenceSimilarity,
    sentenceComparator: t.sentenceComparator ?? INTERNAL_SIMILARITY_RULES.sentenceComparator,
    articleRatio: t.articleRatio,
    articleComparator: t.articleComparator ?? INTERNAL_SIMILARITY_RULES.articleComparator,
    quoteRatio: t.quoteRatio,
    quoteComparator: t.quoteComparator ?? INTERNAL_SIMILARITY_RULES.quoteComparator,
  };
  for (const key of ["sentenceComparator", "articleComparator", "quoteComparator"] as const) {
    if (resolved[key] !== "gt" && resolved[key] !== "gte") {
      throw new RangeError(`thresholds.${key}는 "gt" 또는 "gte"여야 합니다 (받은 값: ${String(resolved[key])})`);
    }
  }
  return resolved;
}

function assertSource(source: SimilaritySource): void {
  if (!SOURCE_KINDS.includes(source.kind)) {
    throw new TypeError(`알 수 없는 원문 종류입니다: ${String(source.kind)} (id: ${source.id})`);
  }
  if (typeof source.text !== "string") {
    throw new TypeError(`원문 text가 문자열이 아닙니다 (id: ${source.id})`);
  }
}
