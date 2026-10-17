// 공개 인터페이스 — OPT-06 · LG-03 · NAV-18 (1단계 W1-b 골격)
export { checkSimilarity, meetsThreshold } from "./check";
export { normalizeForComparison, sentenceSimilarity } from "./measure";
export {
  INTERNAL_SIMILARITY_RULES,
  selectThresholds,
  type InternalSimilaritySettings,
  type RegulationSimilarityRule,
  type SelectedThresholds,
} from "./rules";
export { segmentDraft, splitSentences } from "./split";
export {
  SOURCE_KINDS,
  type Comparator,
  type DraftSentence,
  type ResolvedThresholds,
  type SentenceMatch,
  type SimilarityInput,
  type SimilarityResult,
  type SimilaritySource,
  type SimilarityStatus,
  type SimilarityThresholds,
  type SourceKind,
  type ThresholdSource,
} from "./types";
export { ENGINE_VERSION } from "./version";
