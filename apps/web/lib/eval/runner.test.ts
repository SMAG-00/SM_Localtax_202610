import { describe, expect, it } from "vitest";
import { answerWithAgent, applyIndexExclusion, behaviorMatches, changeReasons, compareOutcomes, fingerprintOf, selectItems, toEvalAnswer, type RunConditions } from "./runner";
import { answerResponse, fakeTools, makeDeps, makeDoc, OK_TEXT, scriptedModel } from "@/lib/agent/flow-fixtures";

const C: RunConditions = { model: "m1", prompt_version: "p1", index_version: "i1", ruleset_hash: "a".repeat(64), determination_hash: "b".repeat(64) };

describe("목록 선택", () => {
  const items = [
    { k: 1, scope: "base", index_exclude_ids: [] as string[] },
    { k: 2, scope: "gift", index_exclude_ids: [] as string[] },
    { k: 3, scope: "base", index_exclude_ids: ["100"] },
    { k: 4, scope: "inheritance", index_exclude_ids: ["x"] },
  ];
  it("기본은 base 범위, 확장은 그 밖, 색인 제외는 가릴 ID가 있는 문항", () => {
    expect(selectItems(items, "base").map((i) => i.k)).toEqual([1, 3]);
    expect(selectItems(items, "extended").map((i) => i.k)).toEqual([2, 4]);
    expect(selectItems(items, "index_exclusion").map((i) => i.k)).toEqual([3, 4]);
  });
  it("빈 목록은 빈 결과", () => expect(selectItems([], "base")).toEqual([]));
});

describe("색인 제외", () => {
  const docs = [makeDoc({ sourceId: "100", chunkId: 1 }), makeDoc({ sourceId: "200", chunkId: 2 }), makeDoc({ sourceId: "300", chunkId: null })];
  it("sourceId 또는 chunk:번호로 가린다", () => {
    expect(applyIndexExclusion(docs, ["100"]).map((d) => d.sourceId)).toEqual(["200", "300"]);
    expect(applyIndexExclusion(docs, ["chunk:2"]).map((d) => d.sourceId)).toEqual(["100", "300"]);
  });
  it("제외 목록이 비면 그대로", () => expect(applyIndexExclusion(docs, [])).toHaveLength(3));
  it("제외한 근거는 실제 흐름의 모델 요청에도 실리지 않는다", async () => {
    const model = scriptedModel([answerResponse(OK_TEXT, [0], ["200"])]);
    const deps = makeDeps({ models: model, tools: fakeTools([makeDoc({ sourceId: "100", content: "가릴시험본문 제3조 기준 금액은 12345원입니다." }), makeDoc({ sourceId: "200", chunkId: 2, content: "남길시험본문 제3조 기준 금액은 12345원입니다." })]) });
    const a = await answerWithAgent({ question: "시험용 취득세 질문입니다", index_exclude_ids: ["100"] }, deps);
    expect(JSON.stringify(model.requests)).not.toContain("가릴시험본문");
    expect(JSON.stringify(model.requests)).toContain("남길시험본문");
    expect(a.behavior).toBe("answer");
    expect(a.cited_ids).toEqual(["200"]);
  });
});

describe("조건 지문과 변경 감지", () => {
  it("같은 조건은 같은 지문(64자리 16진), 한 칸만 달라도 다른 지문", () => {
    expect(fingerprintOf(C)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintOf({ ...C })).toBe(fingerprintOf(C));
    expect(fingerprintOf({ ...C, index_version: "i2" })).not.toBe(fingerprintOf(C));
  });
  it("해시가 없는 조건은 빈 칸으로 계산한다", () => {
    expect(fingerprintOf({ ...C, ruleset_hash: null, determination_hash: null })).toMatch(/^[0-9a-f]{64}$/);
  });
  it("바뀐 칸마다 사유가 나오고, 같으면 0, 이전이 없으면 0", () => {
    expect(changeReasons(C, C)).toEqual([]);
    expect(changeReasons(null, C)).toEqual([]);
    expect(changeReasons(C, { ...C, prompt_version: "p2" })).toEqual(["prompt_changed"]);
    expect(changeReasons(C, { ...C, model: "m2", index_version: "i2" })).toEqual(["model_changed", "index_changed"]);
    expect(changeReasons(C, { ...C, ruleset_hash: "c".repeat(64) })).toEqual(["ruleset_changed"]);
    expect(changeReasons(C, { ...C, determination_hash: null })).toEqual(["determination_changed"]);
  });
});

describe("지방세봇 결과 -> 평가 답변", () => {
  it("근거 답변은 answer, 인용 ID는 중복 없이", async () => {
    const a = await answerWithAgent({ question: "시험용 취득세 질문입니다", index_exclude_ids: [] }, makeDeps());
    expect(a).toMatchObject({ behavior: "answer", cited_ids: ["100"], live_citations: 0, live_without_snapshot: 0 });
  });
  it("검색 결과가 없으면 no_answer", async () => {
    const a = await answerWithAgent({ question: "시험용 취득세 질문입니다", index_exclude_ids: [] }, makeDeps({ tools: fakeTools([]) }));
    expect(a.behavior).toBe("no_answer");
    expect(a.cited_ids).toEqual([]);
  });
  it("실시간 인용 중 스냅샷 없는 것을 센다", () => {
    const rec = {
      kind: "answer", answerMasked: "x", fallbackReason: null, measure: [],
      citations: [
        { sourceId: "a", sourceType: "x", isLive: true, snapshotId: 5, chunkId: null },
        { sourceId: "b", sourceType: "x", isLive: true, snapshotId: null, chunkId: null },
        { sourceId: "a", sourceType: "x", isLive: false, snapshotId: null, chunkId: 1 },
      ],
    } as never;
    expect(toEvalAnswer(rec)).toMatchObject({ cited_ids: ["a", "b"], live_citations: 2, live_without_snapshot: 1 });
  });
  it("투자 추천 차단 이벤트가 있으면 blocked", () => {
    const rec = { kind: "fallback", answerMasked: null, fallbackReason: "scope", measure: [{ name: "ask_investment_blocked", props: { topic: "recommendation" } }], citations: [] } as never;
    expect(toEvalAnswer(rec).behavior).toBe("blocked");
  });
  it("본문이 비면 자리 문구를 넣어 저장 제약(1자 이상)을 지킨다", () => {
    const a = toEvalAnswer({ kind: "fallback", answerMasked: null, fallbackReason: "scope", measure: [], citations: [] } as never);
    expect(a.behavior).toBe("scope_guide");
    expect(a.answer_text.length).toBeGreaterThan(0);
  });
});

describe("켠/끈 비교", () => {
  const off = [
    { item_key: "A", behavior: "answer" as const, cited_ids: ["1", "2"] },
    { item_key: "B", behavior: "answer" as const, cited_ids: ["1"] },
    { item_key: "C", behavior: "no_answer" as const, cited_ids: [] },
  ];
  const on = [
    { item_key: "A", behavior: "answer" as const, cited_ids: ["2", "3"] },
    { item_key: "B", behavior: "answer" as const, cited_ids: ["1"] },
    { item_key: "D", behavior: "answer" as const, cited_ids: [] },
  ];
  it("행동 변화·인용 추가/제거·한쪽에만 있는 문항을 센다", () => {
    const c = compareOutcomes(off, on);
    expect(c.total).toBe(4);
    expect(c.changed).toBe(3);
    expect(c.diffs.find((d) => d.item_key === "A")).toMatchObject({ behavior_changed: false, citations_added: ["3"], citations_removed: ["1"] });
    expect(c.diffs.find((d) => d.item_key === "C")).toMatchObject({ from: "no_answer", to: null, behavior_changed: true });
    expect(c.diffs.find((d) => d.item_key === "D")).toMatchObject({ from: null, to: "answer" });
  });
  it("같은 결과끼리는 차이 0", () => expect(compareOutcomes(off, off)).toEqual({ total: 3, changed: 0, diffs: [] }));
});

describe("기대 응답 모양", () => {
  it("역질문 문항은 clarify여야 하고 그 밖은 기대 모양과 같아야 한다", () => {
    expect(behaviorMatches({ expected_behavior: "answer", cross_types: ["clarify"], expected_clarify: "q" }, "clarify")).toBe(true);
    expect(behaviorMatches({ expected_behavior: "answer", cross_types: ["clarify"], expected_clarify: "q" }, "answer")).toBe(false);
    expect(behaviorMatches({ expected_behavior: "blocked", cross_types: [], expected_clarify: null }, "blocked")).toBe(true);
    expect(behaviorMatches({ expected_behavior: "blocked", cross_types: [], expected_clarify: null }, "answer")).toBe(false);
  });
});
