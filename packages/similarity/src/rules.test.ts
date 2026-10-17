import { describe, expect, it } from "vitest";
import { INTERNAL_SIMILARITY_RULES, selectThresholds, type RegulationSimilarityRule } from "./index";

describe("INTERNAL_SIMILARITY_RULES — 내부 기준 초기값 (OPT-06 · PRD_최종 §7.2)", () => {
  it("문장 유사 0.9 '이상', 기사 비율 0.6 '초과'가 초기값이고 버전 문자열이 있다", () => {
    expect(INTERNAL_SIMILARITY_RULES.sentenceSimilarity).toBe(0.9);
    expect(INTERNAL_SIMILARITY_RULES.sentenceComparator).toBe("gte");
    expect(INTERNAL_SIMILARITY_RULES.articleRatio).toBe(0.6);
    expect(INTERNAL_SIMILARITY_RULES.articleComparator).toBe("gt");
    expect(INTERNAL_SIMILARITY_RULES.quoteComparator).toBe("gt");
    expect(INTERNAL_SIMILARITY_RULES.version).toMatch(/^similarity-internal-\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("인용 비율 기준은 0~1 사이의 임시값이다 (편집 책임자 결정 전)", () => {
    expect(INTERNAL_SIMILARITY_RULES.quoteRatio).toBeGreaterThan(0);
    expect(INTERNAL_SIMILARITY_RULES.quoteRatio).toBeLessThan(1);
  });
});

describe("selectThresholds — 규정 버전이 있으면 규정, 없으면 내부 기준 (NAV-18)", () => {
  const regulation: RegulationSimilarityRule = {
    version: "naver-news-partner-2026.1",
    sentenceSimilarity: 0.85,
    sentenceComparator: "gt",
    articleRatio: 0.5,
    articleComparator: "gte",
  };

  it("규정이 등록되지 않았으면 내부 기준과 '내부' 출처를 돌려준다", () => {
    expect(selectThresholds()).toEqual({
      thresholdSource: "내부",
      rulesVersion: INTERNAL_SIMILARITY_RULES.version,
      thresholds: {
        sentenceSimilarity: 0.9,
        sentenceComparator: "gte",
        articleRatio: 0.6,
        articleComparator: "gt",
        quoteRatio: INTERNAL_SIMILARITY_RULES.quoteRatio,
        quoteComparator: "gt",
      },
    });
    expect(selectThresholds({ regulation: null }).thresholdSource).toBe("내부");
  });

  it("규정이 등록되면 문장·기사 기준과 비교 연산은 규정 값, 인용 기준은 내부 값, 출처는 '규정'", () => {
    expect(selectThresholds({ regulation })).toEqual({
      thresholdSource: "규정",
      rulesVersion: "naver-news-partner-2026.1",
      thresholds: {
        sentenceSimilarity: 0.85,
        sentenceComparator: "gt",
        articleRatio: 0.5,
        articleComparator: "gte",
        quoteRatio: INTERNAL_SIMILARITY_RULES.quoteRatio,
        quoteComparator: "gt",
      },
    });
  });

  it("settings에서 읽은 내부 기준을 넘기면 파일 초기값 대신 그 값을 쓴다 (배포 없이 기준 변경)", () => {
    const fromSettings = { ...INTERNAL_SIMILARITY_RULES, version: "settings-2026-11-01.2", articleRatio: 0.55, quoteRatio: 0.25 };
    const selected = selectThresholds({ internal: fromSettings });
    expect(selected.thresholdSource).toBe("내부");
    expect(selected.rulesVersion).toBe("settings-2026-11-01.2");
    expect(selected.thresholds.articleRatio).toBe(0.55);
    expect(selected.thresholds.quoteRatio).toBe(0.25);
    expect(selectThresholds({ internal: fromSettings, regulation }).thresholds.quoteRatio).toBe(0.25);
  });
});
