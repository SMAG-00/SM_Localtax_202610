import type { Comparator, ResolvedThresholds, ThresholdSource } from "./types";

/** settings에 두는 내부 기준 한 벌 (버전 포함) */
export interface InternalSimilaritySettings extends ResolvedThresholds {
  version: string;
}

/** NAV-18이 `news_partner_requirements`에 등록하는 규정 버전의 유사도 칸 */
export interface RegulationSimilarityRule {
  version: string;
  sentenceSimilarity: number;
  sentenceComparator: Comparator;
  articleRatio: number;
  articleComparator: Comparator;
}

/**
 * 내부 기준 초기값 — 출처 '내부'.
 *
 * - 문장 유사 0.9 이상 · 기사 비율 0.6 초과: PRD_최종 §7.2 `[웹확인]` 네이버 2026 규정 요점
 *   ("문장 단위 90% 유사 문장이 60% 넘으면 유사 기사"), OPT-06 초기값, 01B LG-03과 같은 설정.
 *   LG-03 시험: 89%는 세지 않고 90%는 센다(이상), 5문장 중 3개(60%) 통과·4개(80%) 차단(초과).
 * - 인용 비율 0.3: **임시값**. PRD-01A 13장 "점검 엔진 내부 기준값 — 견본 원고 시험 뒤 편집 책임자가 정한다" [결정 안건].
 *
 * 운영에서는 `settings` 값이 이 초기값을 대신하고(배포 없이 변경),
 * NAV-18이 규정 버전을 등록하면 문장·기사 기준은 규정 값으로 바뀐다 — selectThresholds 참고.
 */
export const INTERNAL_SIMILARITY_RULES: InternalSimilaritySettings = {
  version: "similarity-internal-2026-10-17.1",
  sentenceSimilarity: 0.9,
  sentenceComparator: "gte",
  articleRatio: 0.6,
  articleComparator: "gt",
  quoteRatio: 0.3,
  quoteComparator: "gt",
};

export interface SelectedThresholds {
  thresholds: ResolvedThresholds;
  thresholdSource: ThresholdSource;
  rulesVersion: string;
}

/**
 * 적용할 기준을 고른다. 규정 버전이 있으면 문장·기사 기준과 비교 연산은 규정 값(출처 '규정'),
 * 없으면 내부 기준(출처 '내부'). 인용 비율은 규정 항목이 아니므로 언제나 내부 기준이다.
 * 반환값은 checkSimilarity 입력에 그대로 펼쳐 넣는다: `checkSimilarity({ draft, sources, ...selectThresholds() })`.
 */
export function selectThresholds(options: {
  regulation?: RegulationSimilarityRule | null;
  internal?: InternalSimilaritySettings;
} = {}): SelectedThresholds {
  const internal = options.internal ?? INTERNAL_SIMILARITY_RULES;
  const quote = { quoteRatio: internal.quoteRatio, quoteComparator: internal.quoteComparator };
  const regulation = options.regulation;
  if (regulation) {
    return {
      thresholdSource: "규정",
      rulesVersion: regulation.version,
      thresholds: {
        sentenceSimilarity: regulation.sentenceSimilarity,
        sentenceComparator: regulation.sentenceComparator,
        articleRatio: regulation.articleRatio,
        articleComparator: regulation.articleComparator,
        ...quote,
      },
    };
  }
  return {
    thresholdSource: "내부",
    rulesVersion: internal.version,
    thresholds: {
      sentenceSimilarity: internal.sentenceSimilarity,
      sentenceComparator: internal.sentenceComparator,
      articleRatio: internal.articleRatio,
      articleComparator: internal.articleComparator,
      ...quote,
    },
  };
}
