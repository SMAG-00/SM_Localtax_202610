import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSimilarity, selectThresholds, splitSentences, type SimilaritySource } from "./index";

/** 견본 원고(fixtures/) — 가상 지자체 '가온시' 보도자료와 그 보도자료로 쓴 원고들 */
function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

const PRESS_RELEASE: SimilaritySource = {
  id: "pr-gaon-2026-10-15",
  kind: "press_release",
  text: fixture("press-release_gaon-property-tax.txt"),
};
const OWN_ARTICLE: SimilaritySource = {
  id: "article-2025-1203",
  kind: "own_article",
  text: fixture("own-article_gaon-2025-result.txt"),
};
const COPIED_DRAFT = fixture("draft_copied-from-press-release.txt");
const REWRITTEN_DRAFT = fixture("draft_rewritten-by-editor.txt");

/** 운영과 같은 경로 — 규정 미등록 상태의 내부 기준 */
const internal = selectThresholds();

describe("견본 — 보도자료 문장을 옮긴 원고는 차단, 요약·재구성 원고는 통과 (OPT-06 · LG-03)", () => {
  it("보도자료를 문장마다 옮긴 원고는 차단되고 유사 문장이 보도자료를 가리킨다", () => {
    const result = checkSimilarity({ draft: COPIED_DRAFT, sources: [PRESS_RELEASE], ...internal });
    expect(result.status).toBe("blocked");
    expect(result.bodySentenceCount).toBe(10);
    expect(result.similarSentenceRatio).toBeGreaterThan(0.6);
    expect(result.maxSentenceSimilarity).toBe(1);
    const similar = result.perSentence.filter((s) => s.similar);
    expect(similar.length).toBe(result.similarSentenceCount);
    expect(similar.every((s) => s.bestSourceId === PRESS_RELEASE.id)).toBe(true);
  });

  it("같은 사실을 편집자 문장으로 다시 쓴 원고는 통과하고, 인용 블록은 비율에서 빠진다", () => {
    const result = checkSimilarity({ draft: REWRITTEN_DRAFT, sources: [PRESS_RELEASE], ...internal });
    expect(result.status).toBe("pass");
    expect(result.similarSentenceCount).toBe(0);
    expect(result.maxSentenceSimilarity).toBeLessThan(0.9);
    expect(result.quoteSentenceCount).toBe(1);
    expect(result.quoteWarning).toBe(false);
    const quote = result.perSentence.find((s) => s.inQuote);
    expect(quote).toMatchObject({ similar: true, bestSourceId: PRESS_RELEASE.id });
  });

  it("보도자료와 자사 기존 기사를 함께 비교해도 재구성 원고는 통과하고 두 원문이 모두 기록된다", () => {
    const result = checkSimilarity({ draft: REWRITTEN_DRAFT, sources: [PRESS_RELEASE, OWN_ARTICLE], ...internal });
    expect(result.status).toBe("pass");
    expect(result.comparedSources).toEqual([PRESS_RELEASE.id, OWN_ARTICLE.id]);
    expect(result.thresholdSource).toBe("내부");
  });

  it("자사 기존 기사 본문을 거의 그대로 다시 쓴 원고는 차단", () => {
    // 제목 줄을 뺀 본문 6문장, 한 곳만 표현을 바꿨다
    const body = OWN_ARTICLE.text.split("\n").slice(1).join("\n").replace("집계됐다", "나타났다");
    expect(splitSentences(body)).toHaveLength(6);
    const result = checkSimilarity({ draft: body, sources: [PRESS_RELEASE, OWN_ARTICLE], ...internal });
    expect(result.status).toBe("blocked");
    expect(result.perSentence.filter((s) => s.similar).every((s) => s.bestSourceId === OWN_ARTICLE.id)).toBe(true);
  });

  it("지역명만 바꾼 페이지는 원래 페이지와 비교해 차단 (OPT-10)", () => {
    const original: SimilaritySource = { id: "article-gaon", kind: "own_article", text: REWRITTEN_DRAFT };
    const regionSwapped = REWRITTEN_DRAFT.replaceAll("가온", "나래");
    expect(regionSwapped).not.toBe(REWRITTEN_DRAFT);
    const result = checkSimilarity({ draft: regionSwapped, sources: [original], ...internal });
    expect(result.status).toBe("blocked");
  });

  it("옮긴 원고라도 비교 원문을 넘기지 않으면 통과가 아니라 비교 대상 없음", () => {
    const result = checkSimilarity({ draft: COPIED_DRAFT, sources: [], ...internal });
    expect(result.status).toBe("no_sources");
  });

  it("규정 버전을 등록하면 결과의 기준 출처가 '규정'이 된다", () => {
    const regulated = selectThresholds({
      regulation: {
        version: "naver-news-partner-2026.1",
        sentenceSimilarity: 0.9,
        sentenceComparator: "gte",
        articleRatio: 0.6,
        articleComparator: "gt",
      },
    });
    const result = checkSimilarity({ draft: COPIED_DRAFT, sources: [PRESS_RELEASE], ...regulated });
    expect(result.status).toBe("blocked");
    expect(result.thresholdSource).toBe("규정");
    expect(result.rulesVersion).toBe("naver-news-partner-2026.1");
  });
});

describe("견본 — 결정론 (같은 입력이면 같은 결과)", () => {
  it("같은 입력으로 두 번 돌리면 결과 전체가 같다", () => {
    const run = () => checkSimilarity({ draft: COPIED_DRAFT, sources: [PRESS_RELEASE, OWN_ARTICLE], ...internal });
    expect(run()).toEqual(run());
  });

  it("원문 순서를 바꿔도 판정과 수치는 같다", () => {
    const a = checkSimilarity({ draft: REWRITTEN_DRAFT, sources: [PRESS_RELEASE, OWN_ARTICLE], ...internal });
    const b = checkSimilarity({ draft: REWRITTEN_DRAFT, sources: [OWN_ARTICLE, PRESS_RELEASE], ...internal });
    expect(b.status).toBe(a.status);
    expect(b.maxSentenceSimilarity).toBe(a.maxSentenceSimilarity);
    expect(b.similarSentenceRatio).toBe(a.similarSentenceRatio);
    expect(b.perSentence.map((s) => s.bestSimilarity)).toEqual(a.perSentence.map((s) => s.bestSimilarity));
  });
});

describe("견본 — 결과 필드 (seo_checks.similarity에 남길 값)", () => {
  it("판정·최고 문장 유사도·기사 비율·인용 비율·비교 원문·기준 출처·기준값·버전·문장별 결과가 있다", () => {
    const result = checkSimilarity({ draft: REWRITTEN_DRAFT, sources: [PRESS_RELEASE], ...internal });
    expect(result).toMatchObject({
      status: "pass",
      comparedSources: [PRESS_RELEASE.id],
      thresholdSource: "내부",
      rulesVersion: internal.rulesVersion,
      thresholds: internal.thresholds,
      bodySentenceCount: 10,
      quoteSentenceCount: 1,
    });
    expect(typeof result.maxSentenceSimilarity).toBe("number");
    expect(result.similarSentenceRatio).toBe(0);
    expect(result.quoteRatio).toBeCloseTo(1 / 11, 12);
    expect(result.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.perSentence).toHaveLength(11);
    expect(result.perSentence.map((s) => s.index)).toEqual(Array.from({ length: 11 }, (_, i) => i));
  });
});
