import { describe, expect, it } from "vitest";
import { ModelError } from "../assistant/anthropic";
import { runAgentTurn, type AgentDeps, type AgentInput, type AgentTurnRecord } from "./flow";
import { answerResponse, fakeTools, makeDeps, makeDoc, OK_TEXT, scriptedModel, TEST_DICTIONARY } from "./flow-fixtures";
import type { LiveFetcher } from "./live";
import type { AgentEvent } from "./sse";

const input = (message = "시험용 취득세 질문입니다", over: Partial<AgentInput> = {}): AgentInput => ({ message, mode: "general", turn: 0, clarify: { rounds: 0, answers: {} }, ...over });

async function run(deps: AgentDeps, inp: AgentInput = input()): Promise<{ events: AgentEvent[]; rec: AgentTurnRecord }> {
  const gen = runAgentTurn(inp, deps);
  const events: AgentEvent[] = [];
  for (;;) {
    const n = await gen.next();
    if (n.done) return { events, rec: n.value };
    events.push(n.value);
  }
}
const LIVE_TEXT = "시험용 최신 원문 내용을 설명합니다 정말로.";
const names = (e: AgentEvent[]) => e.map((x) => x.event);

describe("정상 흐름", () => {
  it("첫 이벤트는 status이고 검색 같은 I/O보다 먼저 나온다 (ASK-01)", async () => {
    const tools = fakeTools([makeDoc()]);
    const gen = runAgentTurn(input(), makeDeps({ tools }));
    const first = await gen.next();
    expect(first.value).toEqual({ event: "status", data: { phase: "searching" } });
    expect(tools.searches).toHaveLength(0);
    await gen.return(undefined as never);
  });
  it("검증을 통과한 문단과 DB 메타 칩, done 요약, 기록", async () => {
    const models = scriptedModel([answerResponse(OK_TEXT, [0])]);
    const { events, rec } = await run(makeDeps({ models }));
    expect(names(events)).toEqual(["status", "status", "status", "status", "paragraph", "done"]);
    const p = events.find((e) => e.event === "paragraph")!;
    expect(p.data).toMatchObject({ index: 0, text: OK_TEXT });
    expect((p.data.citations as Array<{ label: string }>)[0]!.label).toBe("법 시험용법 > 제3조(시험용 제목)");
    const d = events.at(-1)!;
    expect(d.data).toMatchObject({ validation: "passed", asOf: "2026-10-27", citationCount: 1, liveCitationCount: 0, highRisk: false });
    expect(rec).toMatchObject({ kind: "answer", validation: "passed", regenerated: false, modelCalls: 1 });
    expect(rec.citations).toEqual([{ sourceId: "100", sourceType: "law_article", isLive: false, snapshotId: 11, chunkId: 1 }]);
    expect(rec.costWon).toBe(10.5);
  });
  it("요청은 문서 블록(제목 = source_id, 인용 켜짐)·캐시 지점·모드별 추론 강도를 쓰고 tool_choice를 보내지 않는다", async () => {
    const models = scriptedModel([answerResponse(OK_TEXT, [0])]);
    await run(makeDeps({ models }), input("시험용 질문", { mode: "expert" }));
    const req = models.requests[0] as unknown as { model: string; system: Array<{ cache_control?: unknown }>; messages: Array<{ content: Array<Record<string, unknown>> }>; output_config: unknown; tool_choice?: unknown };
    expect(req.model).toBe("test-model-a");
    expect(req.output_config).toEqual({ effort: "high" });
    expect(req.system.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
    expect(req.tool_choice).toBeUndefined();
    const docBlock = req.messages[0]!.content[0]!;
    expect(docBlock).toMatchObject({ type: "document", title: "100", citations: { enabled: true } });
    const textBlock = req.messages[0]!.content.at(-1)! as { text: string };
    expect(textBlock.text).toContain("[기준일] 2026-10-27");
    expect(textBlock.text).toContain("[모드] 전문가");
  });
  it("고위험 낱말은 done에 배너 표지, 기준일은 질문에서 뽑아 검색에 쓴다", async () => {
    const searched: string[] = [];
    const tools = fakeTools([makeDoc()], { async search(a) { searched.push(a.asOf); return [makeDoc()]; } });
    const { events } = await run(makeDeps({ tools }), input("2024년 5월 3일에 산 집 가산세가 붙나요"));
    expect(events.at(-1)!.data).toMatchObject({ highRisk: true, asOf: "2024-05-03" });
    expect(searched).toEqual(["2024-05-03"]);
  });
});

describe("막힘·범위 안내", () => {
  it("투자 추천은 모델 0회, 범위 안내 + 고정 문구 + 측정 이벤트", async () => {
    const models = scriptedModel([answerResponse(OK_TEXT, [0])]);
    const tools = fakeTools([makeDoc()]);
    const { events, rec } = await run(makeDeps({ models, tools }), input("시험구역 추천해 주세요"));
    expect(models.requests).toHaveLength(0);
    expect(tools.searches).toHaveLength(0);
    const fb = events.find((e) => e.event === "fallback")!;
    expect(fb.data).toMatchObject({ reason: "scope", kind: "scope_guide", line: "[시험용] investment 안내" });
    expect(rec.measure).toEqual([{ name: "ask_investment_blocked", props: { topic: "recommendation" } }]);
  });
  it("꺼진 범위 주제는 안내로 끝난다", async () => {
    const { events, rec } = await run(makeDeps(), input("재건축 입주권 취득세를 알려줘"));
    expect(events.find((e) => e.event === "fallback")!.data.reason).toBe("scope");
    expect(rec.measure[0]).toMatchObject({ name: "ask_scope_redirected", props: { reason: "scope_pending", scope: "trust_redevelopment" } });
  });
  it("세션 턴 상한을 넘으면 error", async () => {
    const { events } = await run(makeDeps(), input("시험용 질문", { turn: 20 }));
    expect(events.at(-1)).toEqual({ event: "error", data: { code: "turn_limit", retryable: false } });
  });
});

describe("역질문 (ASK-02)", () => {
  it("요건이 비면 검색·모델 호출 없이 역질문", async () => {
    const models = scriptedModel([answerResponse(OK_TEXT, [0])]);
    const tools = fakeTools([makeDoc()]);
    const { events, rec } = await run(makeDeps({ models, tools, dictionary: TEST_DICTIONARY }), input("시험용주제 알려줘"));
    expect(names(events)).toEqual(["status", "clarify", "done"]);
    expect((events[1]!.data.questions as unknown[]).length).toBe(3);
    expect(models.requests).toHaveLength(0);
    expect(tools.searches).toHaveLength(0);
    expect(rec).toMatchObject({ kind: "clarify", clarifyRound: 1 });
  });
  it("2라운드 뒤에는 묻지 않고 가정을 밝힌 조건부 답변", async () => {
    const models = scriptedModel([answerResponse(OK_TEXT, [0])]);
    const { events } = await run(makeDeps({ models, dictionary: TEST_DICTIONARY }), input("시험용주제 알려줘", { clarify: { rounds: 2, answers: { slot_a: "a1" } } }));
    expect(names(events)).not.toContain("clarify");
    const t = (models.requests[0]!.messages[0] as { content: Array<{ text?: string }> }).content.at(-1)!.text!;
    expect(t).toContain("요건 확인 필요: 시험용 질문 B");
  });
});

describe("근거 부족·폴백 (ASK-04 · ASK-15)", () => {
  it("검색 결과가 없고 실시간 조회도 없으면 모델 호출 없이 근거 부족 응답", async () => {
    const models = scriptedModel([answerResponse(OK_TEXT, [0])]);
    const { events, rec } = await run(makeDeps({ models, tools: fakeTools([]) }));
    expect(models.requests).toHaveLength(0);
    expect(events.find((e) => e.event === "fallback")!.data).toMatchObject({ reason: "no_evidence", kind: "evidence_list", results: [], peopleButtons: { find: true, request: true } });
    expect(rec.answerMasked).toBeNull();
  });
  it("예산 미설정이면 호출 0 - 근거 목록(검색 모드)", async () => {
    const models = scriptedModel([answerResponse(OK_TEXT, [0])]);
    const { events } = await run(makeDeps({ models, budget: "unset" }));
    expect(models.requests).toHaveLength(0);
    const fb = events.find((e) => e.event === "fallback")!;
    expect(fb.data).toMatchObject({ reason: "budget", kind: "evidence_list" });
    expect((fb.data.results as unknown[]).length).toBe(1);
  });
  it("100%에서는 비회원만 검색 모드", async () => {
    const guest = await run(makeDeps({ budget: "over", tier: "guest", models: scriptedModel([answerResponse(OK_TEXT, [0])]) }));
    expect(guest.rec.kind).toBe("fallback");
    const member = await run(makeDeps({ budget: "over", tier: "member", models: scriptedModel([answerResponse(OK_TEXT, [0])]) }));
    expect(member.rec.kind).toBe("answer");
  });
  it("장애 주입: 모델이 계속 실패하면 재시도 1회 뒤 검색 모드", async () => {
    const models = scriptedModel([new ModelError("x", "http", 500)]);
    const { events, rec } = await run(makeDeps({ models }));
    expect(models.requests).toHaveLength(2);
    expect(events.find((e) => e.event === "fallback")!.data).toMatchObject({ reason: "outage", kind: "evidence_list" });
    expect(rec.measure).toEqual([{ name: "ask_fallback_shown", props: { reason: "outage" } }]);
  });
  it("재시도 1회로 회복하면 답변", async () => {
    const models = scriptedModel([new ModelError("x", "timeout"), answerResponse(OK_TEXT, [0])]);
    expect((await run(makeDeps({ models }))).rec.kind).toBe("answer");
  });
  it("거절은 보조 모델로 1회 폴백, 보조 모델이 없으면 검색 모드", async () => {
    const withUtil = scriptedModel([new ModelError("r", "refusal"), answerResponse(OK_TEXT, [0])]);
    const a = await run(makeDeps({ models: withUtil, config: { modelAnswer: "test-model-a", modelUtility: "test-model-u", effortGeneral: null, effortExpert: null, effortUtility: null } }));
    expect(a.rec.kind).toBe("answer");
    expect(withUtil.requests.map((r) => r.model)).toEqual(["test-model-a", "test-model-u"]);
    expect(withUtil.requests[1]!).not.toHaveProperty("output_config");
    const without = await run(makeDeps({ models: scriptedModel([new ModelError("r", "refusal")]) }));
    expect(without.rec).toMatchObject({ kind: "fallback", fallbackReason: "outage" });
  });
  it("검색 DB 장애는 error (일시 중단 안내)", async () => {
    const { events } = await run(makeDeps({ tools: fakeTools(new Error("db")) }));
    expect(events.at(-1)).toEqual({ event: "error", data: { code: "search_down", retryable: true } });
  });
});

describe("검증기 연동 (V1~V6)", () => {
  it("첫 응답이 인용 없음이면 재생성 1회 후 통과", async () => {
    const models = scriptedModel([answerResponse("시험용 결론 문장에 인용이 없습니다 정말로.", []), answerResponse(OK_TEXT, [0])]);
    const { rec, events } = await run(makeDeps({ models }));
    expect(rec).toMatchObject({ kind: "answer", validation: "regenerated", regenerated: true, modelCalls: 2 });
    const second = JSON.stringify(models.requests[1]!.messages.at(-1));
    expect(second).toContain("V1");
    expect(events.at(-1)!.data.validation).toBe("regenerated");
  });
  it("재생성도 실패하면 근거 목록 응답 (문단 0)", async () => {
    const models = scriptedModel([answerResponse("시험용 결론 문장에 인용이 없습니다 정말로.", [])]);
    const { events, rec } = await run(makeDeps({ models }));
    expect(names(events)).not.toContain("paragraph");
    expect(events.find((e) => e.event === "fallback")!.data).toMatchObject({ reason: "verification_failed", kind: "evidence_list" });
    expect(rec.validation).toBe("fallback");
    expect(rec.regenerated).toBe(true);
  });
  it("국세 금액 문장은 재생성 없이 안내로 바꾼다 (국세 금액 문장 0)", async () => {
    const models = scriptedModel([answerResponse("시험용 양도세는 5000만원입니다 확인하세요.", [0])]);
    const { events, rec } = await run(makeDeps({ models }));
    expect(models.requests).toHaveLength(1);
    expect(names(events)).not.toContain("paragraph");
    expect(events.find((e) => e.event === "fallback")!.data).toMatchObject({ reason: "scope", kind: "scope_guide" });
    expect(rec.measure).toEqual([{ name: "ask_scope_redirected", props: { reason: "national_tax_calculator" } }]);
  });
});

describe("실시간 조회와 도구 (ASK-16 · ASK-17)", () => {
  const liveDoc = makeDoc({ sourceId: "snap:7", sourceType: "live_snapshot", isLive: true, snapshotId: 7, snapshotOk: true, path: "실시간 조회 > 시험용", chunkId: null, fetchedAt: "2026-10-27T00:00:00Z" });
  const fetcher = (): LiveFetcher & { n: number } => {
    const f = {
      n: 0,
      get callsMade() {
        return f.n;
      },
      async fetchOfficial() {
        f.n += 1;
        return { ok: true as const, doc: liveDoc, latencyMs: 5, targetType: "law" as const, snapshotId: 7 };
      },
    };
    return f;
  };
  const toolUse = { content: [{ type: "tool_use", id: "tu1", name: "fetch_official_source", input: { target_type: "law", query: "시험용 최신" } }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } };
  it("색인에 없으면 모델의 도구 호출로 조회하고, 스냅샷 인용에는 실시간 표지가 붙는다", async () => {
    const lf = fetcher();
    const models = scriptedModel([toolUse as never, answerResponse(LIVE_TEXT, [0], ["snap:7"])]);
    const { events, rec } = await run(makeDeps({ models, tools: fakeTools([]), liveFetcher: lf }));
    expect(lf.n).toBe(1);
    expect(events.some((e) => e.event === "status" && e.data.phase === "fetching")).toBe(true);
    const p = events.find((e) => e.event === "paragraph")!;
    expect((p.data.citations as Array<{ live: boolean; unreviewed: boolean }>)[0]).toMatchObject({ live: true, unreviewed: true });
    expect(rec.toolCalls).toEqual([expect.objectContaining({ name: "fetch_official_source", ok: true, targetType: "law", snapshotId: 7 })]);
    expect(rec.citations).toEqual([expect.objectContaining({ sourceId: "snap:7", isLive: true, snapshotId: 7 })]);
    const second = JSON.stringify(models.requests[1]!.messages);
    expect(second).toContain("tool_result");
    expect(second).toContain("snap:7");
  });
  it("실시간 조회 연결이 없으면 도구 정의 자체가 요청에 없다", async () => {
    const models = scriptedModel([answerResponse(OK_TEXT, [0])]);
    await run(makeDeps({ models }));
    const toolNames = ((models.requests[0] as unknown as { tools: Array<{ name: string }> }).tools ?? []).map((t) => t.name);
    expect(toolNames).not.toContain("fetch_official_source");
    expect(toolNames).not.toContain("web_search_official");
  });
  it("공식 검색은 설정이 켜지고 도구 상자가 있을 때만 정의에 들어간다", async () => {
    const off = scriptedModel([answerResponse(OK_TEXT, [0])]);
    await run(makeDeps({ models: off, officialSearch: true }));
    expect((off.requests[0] as unknown as { tools: Array<{ name: string }> }).tools.map((t) => t.name)).not.toContain("web_search_official");
    const on = scriptedModel([answerResponse(OK_TEXT, [0])]);
    await run(makeDeps({ models: on, officialSearch: true, tools: fakeTools([makeDoc()], { async webSearchOfficial() { return []; } }) }));
    expect((on.requests[0] as unknown as { tools: Array<{ name: string }> }).tools.map((t) => t.name)).toContain("web_search_official");
  });
  it("스냅샷 없는 실시간 문서는 모델이 인용해도 인정되지 않는다", async () => {
    const bad = { ...liveDoc, snapshotId: null, snapshotOk: false };
    const lf: LiveFetcher = { callsMade: 0, async fetchOfficial() { return { ok: true as const, doc: bad, latencyMs: 1, targetType: "law" as const, snapshotId: 7 }; } };
    const models = scriptedModel([toolUse as never, answerResponse(LIVE_TEXT, [0], ["snap:7"])]);
    const { rec } = await run(makeDeps({ models, tools: fakeTools([]), liveFetcher: lf }));
    expect(rec.kind).toBe("fallback");
    expect(rec.citations).toEqual([]);
  });
});
