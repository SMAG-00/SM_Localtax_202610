import { describe, expect, it } from "vitest";
import {
  checkSimilarity,
  meetsThreshold,
  type SimilarityInput,
  type SimilaritySource,
  type SimilarityThresholds,
} from "./index";

/** 서로 다른 한글 음절 n개 — start 구간이 겹치지 않으면 두 문자열의 유사도는 0 */
function syllables(start: number, n: number): string {
  return Array.from({ length: n }, (_, i) => String.fromCharCode(0xac00 + start + i)).join("");
}
/** k번째 원문 문장 (8음절, 서로 겹치지 않음) */
const sourceSentence = (k: number) => syllables(k * 8, 8);
/** k번째 원문과 무관한 문장 (원문 구간과 겹치지 않는 5000번대 음절) */
const unrelatedSentence = (k: number) => syllables(5000 + k * 8, 8);

/** 비교 연산을 지정하지 않은 PRD 초기 기준 — 기본 연산(문장 이상·기사 초과·인용 초과)을 함께 시험한다 */
const PRD_THRESHOLDS: SimilarityThresholds = { sentenceSimilarity: 0.9, articleRatio: 0.6, quoteRatio: 0.3 };

function pressRelease(id: string, sentences: string[]): SimilaritySource {
  return { id, kind: "press_release", text: sentences.join("\n") };
}

function input(draftLines: string[], sources: SimilaritySource[], thresholds = PRD_THRESHOLDS): SimilarityInput {
  return { draft: draftLines.join("\n"), sources, thresholds, thresholdSource: "내부" };
}

/** 원고 total문장 중 copied문장은 원문을 그대로, 나머지는 무관한 문장 */
function ratioCase(copied: number, total: number, thresholds = PRD_THRESHOLDS): SimilarityInput {
  const source = pressRelease("pr-1", Array.from({ length: copied }, (_, k) => sourceSentence(k)));
  const draft = [
    ...Array.from({ length: copied }, (_, k) => sourceSentence(k)),
    ...Array.from({ length: total - copied }, (_, k) => unrelatedSentence(k)),
  ];
  return input(draft, [source], thresholds);
}

describe("meetsThreshold — 비교 연산(이상·초과)과 부동소수 오차", () => {
  it("이상(gte): 0.9는 0.9 기준을 충족하고 0.89는 못 한다", () => {
    expect(meetsThreshold(0.9, 0.9, "gte")).toBe(true);
    expect(meetsThreshold(0.89, 0.9, "gte")).toBe(false);
  });

  it("초과(gt): 0.6은 0.6 기준을 넘지 않고 0.61은 넘는다", () => {
    expect(meetsThreshold(0.6, 0.6, "gt")).toBe(false);
    expect(meetsThreshold(0.61, 0.6, "gt")).toBe(true);
  });

  it("부동소수 계산 오차(0.1+0.2)는 같은 값으로 본다", () => {
    expect(meetsThreshold(0.1 + 0.2, 0.3, "gt")).toBe(false);
    expect(meetsThreshold(0.1 + 0.2, 0.3, "gte")).toBe(true);
    expect(meetsThreshold(0.3 - 1e-12, 0.3, "gte")).toBe(true);
  });
});

describe("checkSimilarity — 문장 유사 경계 89%·90% (LG-03)", () => {
  it("최고 일치가 정확히 0.9인 문장은 유사 문장으로 센다", () => {
    const result = checkSimilarity(input([syllables(0, 10) + syllables(500, 1)], [pressRelease("pr-1", [syllables(0, 11)])]));
    expect(result.maxSentenceSimilarity).toBe(0.9);
    expect(result.similarSentenceCount).toBe(1);
    expect(result.perSentence[0]).toMatchObject({ similar: true, bestSimilarity: 0.9, bestSourceId: "pr-1", bestSourceSentence: 0 });
  });

  it("최고 일치가 0.89인 문장은 유사 문장으로 세지 않는다", () => {
    const result = checkSimilarity(input([syllables(0, 90) + syllables(1000, 11)], [pressRelease("pr-1", [syllables(0, 101)])]));
    expect(result.maxSentenceSimilarity).toBe(0.89);
    expect(result.similarSentenceCount).toBe(0);
    expect(result.similarSentenceRatio).toBe(0);
    expect(result.status).toBe("pass");
  });

  it("규정의 비교 연산이 '초과'면 정확히 0.9인 문장은 세지 않는다 (NAV-18 비교 연산 칸)", () => {
    const result = checkSimilarity(
      input([syllables(0, 10) + syllables(500, 1)], [pressRelease("pr-1", [syllables(0, 11)])], {
        ...PRD_THRESHOLDS,
        sentenceComparator: "gt",
      }),
    );
    expect(result.similarSentenceCount).toBe(0);
    expect(result.status).toBe("pass");
  });
});

describe("checkSimilarity — 기사 비율 경계 (60% 초과 차단)", () => {
  it("요약 5문장 중 유사 문장 3개(60%)면 통과", () => {
    const result = checkSimilarity(ratioCase(3, 5));
    expect(result.similarSentenceCount).toBe(3);
    expect(result.bodySentenceCount).toBe(5);
    expect(result.similarSentenceRatio).toBe(0.6);
    expect(result.status).toBe("pass");
  });

  it("요약 5문장 중 유사 문장 4개(80%)면 차단", () => {
    const result = checkSimilarity(ratioCase(4, 5));
    expect(result.similarSentenceRatio).toBe(0.8);
    expect(result.status).toBe("blocked");
  });

  it("100문장 중 60개(60%)는 통과, 61개(61%)는 차단", () => {
    const at60 = checkSimilarity(ratioCase(60, 100));
    const at61 = checkSimilarity(ratioCase(61, 100));
    expect(at60.similarSentenceRatio).toBe(0.6);
    expect(at60.status).toBe("pass");
    expect(at61.similarSentenceRatio).toBe(0.61);
    expect(at61.status).toBe("blocked");
  });

  it("규정의 비교 연산이 '이상'이면 60%와 같은 비율도 차단", () => {
    const result = checkSimilarity(ratioCase(3, 5, { ...PRD_THRESHOLDS, articleComparator: "gte" }));
    expect(result.status).toBe("blocked");
  });

  it("기준값을 바꿔 넘기면 같은 원고도 새 기준으로 판정한다", () => {
    expect(checkSimilarity(ratioCase(3, 5, { ...PRD_THRESHOLDS, articleRatio: 0.5 })).status).toBe("blocked");
  });
});

describe("checkSimilarity — 직접 인용 블록", () => {
  const source = pressRelease("pr-1", [sourceSentence(0), sourceSentence(1)]);

  it("인용 블록 문장은 원문과 같아도 기사 비율에서 빠지고 따로 센다", () => {
    const result = checkSimilarity(
      input(
        [unrelatedSentence(0), unrelatedSentence(1), unrelatedSentence(2), unrelatedSentence(3), `> ${sourceSentence(0)}`],
        [source],
      ),
    );
    expect(result.bodySentenceCount).toBe(4);
    expect(result.quoteSentenceCount).toBe(1);
    expect(result.similarSentenceCount).toBe(0);
    expect(result.similarSentenceRatio).toBe(0);
    expect(result.maxSentenceSimilarity).toBe(0);
    expect(result.quoteRatio).toBe(0.2);
    expect(result.quoteWarning).toBe(false);
    expect(result.status).toBe("pass");
    expect(result.perSentence[4]).toMatchObject({ inQuote: true, similar: true, bestSimilarity: 1, bestSourceId: "pr-1" });
  });

  it("인용 비율이 기준(0.3)을 넘으면 경고, 같으면 경고 없음", () => {
    const draft = [unrelatedSentence(0), unrelatedSentence(1), unrelatedSentence(2), `> ${sourceSentence(0)}`, `> ${sourceSentence(1)}`];
    const over = checkSimilarity(input(draft, [source]));
    expect(over.quoteRatio).toBe(0.4);
    expect(over.quoteWarning).toBe(true);
    expect(over.status).toBe("pass");

    const equal = checkSimilarity(input(draft, [source], { ...PRD_THRESHOLDS, quoteRatio: 0.4 }));
    expect(equal.quoteWarning).toBe(false);
  });

  it("인용 블록이 없으면 인용 비율 0이고 기준이 0이어도 경고 없음", () => {
    const result = checkSimilarity(
      input([unrelatedSentence(0)], [source], { ...PRD_THRESHOLDS, quoteRatio: 0, quoteComparator: "gte" }),
    );
    expect(result.quoteRatio).toBe(0);
    expect(result.quoteWarning).toBe(false);
  });

  it("원고 전체가 원문을 옮긴 인용 블록이면 판정할 본문이 없어 no_body(통과 아님)이고 인용 경고가 난다", () => {
    const result = checkSimilarity(input([`> ${sourceSentence(0)}`, `> ${sourceSentence(1)}`], [source]));
    expect(result.bodySentenceCount).toBe(0);
    expect(result.similarSentenceRatio).toBeNull();
    expect(result.status).toBe("no_body");
    expect(result.quoteRatio).toBe(1);
    expect(result.quoteWarning).toBe(true);
  });
});

describe("checkSimilarity — 비교 대상 없음", () => {
  it("비교 원문이 0건이면 'no_sources'이고 비율 값은 비워 둔다 (통과로 표시하지 않음)", () => {
    const result = checkSimilarity(input([sourceSentence(0), sourceSentence(1)], []));
    expect(result.status).toBe("no_sources");
    expect(result.comparedSources).toEqual([]);
    expect(result.maxSentenceSimilarity).toBeNull();
    expect(result.similarSentenceRatio).toBeNull();
    expect(result.similarSentenceCount).toBeNull();
    expect(result.perSentence).toEqual([
      { index: 0, text: sourceSentence(0), inQuote: false, bestSimilarity: null, bestSourceId: null, bestSourceSentence: null, similar: false },
      { index: 1, text: sourceSentence(1), inQuote: false, bestSimilarity: null, bestSourceId: null, bestSourceSentence: null, similar: false },
    ]);
  });

  it("원문이 있어도 본문 문장이 하나도 없으면(빈 스냅숏) 비교 대상 없음으로 본다", () => {
    const result = checkSimilarity(
      input([sourceSentence(0)], [
        { id: "snap-empty", kind: "raw_snapshot", text: "" },
        { id: "snap-punct", kind: "raw_snapshot", text: " ...\n- - " },
      ]),
    );
    expect(result.status).toBe("no_sources");
    expect(result.comparedSources).toEqual([]);
  });

  it("비교 대상이 없어도 인용 비율·경고는 계산한다", () => {
    const result = checkSimilarity(input([unrelatedSentence(0), `> ${sourceSentence(0)}`], []));
    expect(result.status).toBe("no_sources");
    expect(result.quoteRatio).toBe(0.5);
    expect(result.quoteWarning).toBe(true);
  });
});

describe("checkSimilarity — 비교 원문 목록과 일치 위치", () => {
  it("문장이 있는 원문만 입력 순서대로, 같은 id는 한 번만 comparedSources에 넣는다", () => {
    const result = checkSimilarity(
      input([sourceSentence(1)], [
        { id: "own-7", kind: "own_article", text: unrelatedSentence(9) },
        { id: "blank", kind: "raw_snapshot", text: "   " },
        { id: "hot-3", kind: "hot_news_item", text: sourceSentence(1) },
        { id: "own-7", kind: "own_article", text: unrelatedSentence(8) },
      ]),
    );
    expect(result.comparedSources).toEqual(["own-7", "hot-3"]);
    expect(result.perSentence[0]).toMatchObject({ bestSourceId: "hot-3", bestSourceSentence: 0, bestSimilarity: 1 });
  });

  it("최고 일치가 같으면 먼저 넘긴 원문·앞 문장을 고른다", () => {
    const result = checkSimilarity(
      input([sourceSentence(2)], [
        pressRelease("pr-a", [unrelatedSentence(0), sourceSentence(2)]),
        pressRelease("pr-b", [sourceSentence(2)]),
      ]),
    );
    expect(result.perSentence[0]).toMatchObject({ bestSourceId: "pr-a", bestSourceSentence: 1 });
  });

  it("겹치는 글자가 전혀 없는 문장은 일치 원문을 null로 둔다", () => {
    const result = checkSimilarity(input([unrelatedSentence(0)], [pressRelease("pr-1", [sourceSentence(0)])]));
    expect(result.perSentence[0]).toMatchObject({ bestSimilarity: 0, bestSourceId: null, bestSourceSentence: null, similar: false });
  });

  it("빈 원고는 문장 0개 — 통과가 아니라 no_body이고 비율 값은 비워 둔다", () => {
    const result = checkSimilarity(input([], [pressRelease("pr-1", [sourceSentence(0)])]));
    expect(result.bodySentenceCount).toBe(0);
    expect(result.similarSentenceRatio).toBeNull();
    expect(result.maxSentenceSimilarity).toBeNull();
    expect(result.perSentence).toEqual([]);
    expect(result.status).toBe("no_body");
  });
});

describe("checkSimilarity — 입력 검증", () => {
  const source = pressRelease("pr-1", [sourceSentence(0)]);

  it("기준값이 0~1 밖이거나 숫자가 아니면 RangeError", () => {
    expect(() => checkSimilarity(input(["가"], [source], { ...PRD_THRESHOLDS, sentenceSimilarity: 90 }))).toThrow(RangeError);
    expect(() => checkSimilarity(input(["가"], [source], { ...PRD_THRESHOLDS, articleRatio: -0.1 }))).toThrow(RangeError);
    expect(() => checkSimilarity(input(["가"], [source], { ...PRD_THRESHOLDS, quoteRatio: Number.NaN }))).toThrow(RangeError);
  });

  it("알 수 없는 비교 연산이면 RangeError", () => {
    const bad = { ...PRD_THRESHOLDS, articleComparator: "lt" } as unknown as SimilarityThresholds;
    expect(() => checkSimilarity(input(["가"], [source], bad))).toThrow(RangeError);
  });

  it("알 수 없는 원문 종류면 TypeError", () => {
    const bad = { id: "x", kind: "blog", text: "가나다" } as unknown as SimilaritySource;
    expect(() => checkSimilarity(input(["가"], [bad]))).toThrow(TypeError);
  });
});

describe("checkSimilarity — 판정할 본문이 없음", () => {
  it("빈 원고는 통과가 아니라 no_body", () => {
    const r = checkSimilarity(input([], [pressRelease("pr-1", [sourceSentence(0)])]));
    expect(r.status).toBe("no_body");
    expect(r.similarSentenceRatio).toBeNull();
  });

  it("인용 블록만 있는 원고도 no_body이고 인용 비율 경고는 그대로", () => {
    const r = checkSimilarity(input(["> " + sourceSentence(0), "> " + sourceSentence(1)], [pressRelease("pr-1", [sourceSentence(0), sourceSentence(1)])]));
    expect(r.status).toBe("no_body");
    expect(r.quoteWarning).toBe(true);
  });
});
