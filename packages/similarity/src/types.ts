/** 비교 원문 종류 — OPT-06: 보도자료(`article_sources` press_release)·원자료 스냅숏(`raw_snapshots`)·자사 기존 기사·같은 회차의 다른 핫뉴스 항목 */
export type SourceKind = "press_release" | "raw_snapshot" | "own_article" | "hot_news_item";

export const SOURCE_KINDS: readonly SourceKind[] = ["press_release", "raw_snapshot", "own_article", "hot_news_item"];

export interface SimilaritySource {
  id: string;
  kind: SourceKind;
  text: string;
}

/** 비교 연산 — `gte` 이상, `gt` 초과. 규정 버전의 비교 연산 칸에서 읽는다 (NAV-18) */
export type Comparator = "gt" | "gte";

/** 기준값은 모두 0~1 비율이다 (0.9 = 90%) */
export interface SimilarityThresholds {
  /** 문장 하나가 '유사 문장'이 되는 최고 일치 기준 */
  sentenceSimilarity: number;
  /** 본문(인용 블록 제외) 중 유사 문장 비율의 차단 기준 */
  articleRatio: number;
  /** 원고 전체 문장 중 인용 블록 문장 비율의 경고 기준 */
  quoteRatio: number;
  /** 생략하면 rules.ts의 내부 기본값("gte" — 90%는 센다) */
  sentenceComparator?: Comparator;
  /** 생략하면 rules.ts의 내부 기본값("gt" — 60% 초과) */
  articleComparator?: Comparator;
  /** 생략하면 rules.ts의 내부 기본값("gt") */
  quoteComparator?: Comparator;
}

export type ResolvedThresholds = Required<SimilarityThresholds>;

/** 적용 기준의 출처 — 규정 버전(NAV-18 `news_partner_requirements`) 또는 내부 기준(`settings`) */
export type ThresholdSource = "규정" | "내부";

export interface SimilarityInput {
  /** 원고 본문. '>'로 시작하는 줄은 직접 인용 블록이다 */
  draft: string;
  sources: SimilaritySource[];
  thresholds: SimilarityThresholds;
  thresholdSource: ThresholdSource;
  /** 기준값의 버전(규정 버전 또는 settings 버전) — 결과에 그대로 남긴다 */
  rulesVersion?: string;
}

/** no_sources = 비교 원문 0건, no_body = 판정할 본문 문장 0개(빈 원고·인용만) — 둘 다 통과로 표시하지 않는다 */
export type SimilarityStatus = "blocked" | "pass" | "no_sources" | "no_body";

export interface DraftSentence {
  text: string;
  inQuote: boolean;
}

export interface SentenceMatch {
  /** 원고 문장 순번 (본문·인용 블록 통틀어 0부터) */
  index: number;
  text: string;
  inQuote: boolean;
  /** 모든 비교 원문 문장 중 최고 일치. 비교 대상이 없으면 null */
  bestSimilarity: number | null;
  /** 최고 일치 원문 id. 겹치는 글자가 없거나(0) 비교 대상이 없으면 null */
  bestSourceId: string | null;
  /** 최고 일치 원문 문장 순번 — splitSentences(원문.text)의 인덱스 */
  bestSourceSentence: number | null;
  /** 문장 기준을 충족했는지. 인용 블록 문장도 표시하지만 기사 비율에는 넣지 않는다 */
  similar: boolean;
}

export interface SimilarityResult {
  status: SimilarityStatus;
  /** 본문 문장(인용 블록 제외)의 최고 일치 중 최댓값. 비교 대상 없음이면 null */
  maxSentenceSimilarity: number | null;
  /** 본문 문장 중 유사 문장 비율. 비교 대상 없음이면 null */
  similarSentenceRatio: number | null;
  similarSentenceCount: number | null;
  bodySentenceCount: number;
  quoteSentenceCount: number;
  /** 원고 전체 문장 중 인용 블록 문장 비율 */
  quoteRatio: number;
  quoteWarning: boolean;
  /** 실제로 비교한 원문 id (문장이 1개 이상인 원문, 입력 순서, 중복 제거) */
  comparedSources: string[];
  thresholdSource: ThresholdSource;
  thresholds: ResolvedThresholds;
  rulesVersion: string | null;
  engineVersion: string;
  perSentence: SentenceMatch[];
}
