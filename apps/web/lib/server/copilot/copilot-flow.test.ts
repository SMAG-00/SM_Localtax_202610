import { describe, expect, it, vi } from "vitest";
import { runAgentTurn, type AgentTurnRecord } from "@/lib/agent/flow";
import { answerResponse, fakeTools, makeDeps, makeDoc, OK_TEXT, scriptedModel } from "@/lib/agent/flow-fixtures";
import type { AgentEvent } from "@/lib/agent/sse";
import { collectEvidence, restrictedToolbox } from "./evidence";
import { buildTaskMessage, type CopilotRequest } from "./logic";

// 코파일럿 = 4단계 흐름(runAgentTurn) + 미리 모은 근거. 가짜 모델만 쓴다 (실제 API 0).
async function runCopilot(req: CopilotRequest, docs: ReturnType<typeof makeDoc>[], models: ReturnType<typeof scriptedModel>) {
  const gen = runAgentTurn({ message: buildTaskMessage(req), mode: "expert", turn: 0, clarify: { rounds: 0, answers: {} } }, makeDeps({ models, tools: restrictedToolbox(docs), tier: "member" }));
  const events: AgentEvent[] = [];
  for (;;) {
    const n = await gen.next();
    if (n.done) return { events, rec: n.value as AgentTurnRecord };
    events.push(n.value);
  }
}
const cmp: CopilotRequest = { kind: "comparison", ids: ["100", "101"] };
const decisions = [makeDoc({ sourceId: "100", sourceType: "case_decision", chunkId: 1 }), makeDoc({ sourceId: "101", sourceType: "case_decision", chunkId: 2, path: "시험용심판원 2020-1 > 요지" })];

describe("검증기 연동 (RES-05 - 4단계와 같은 검증기)", () => {
  it("인용이 달린 문단만 나가고 인용 source_id가 기록된다", async () => {
    const { events, rec } = await runCopilot(cmp, decisions, scriptedModel([answerResponse(OK_TEXT, [0, 1])]));
    expect(events.filter((e) => e.event === "paragraph")).toHaveLength(1);
    expect(rec.kind).toBe("answer");
    expect(rec.citations.map((c) => c.sourceId).sort()).toEqual(["100", "101"]);
  });
  it("인용 없는 문장은 재생성되고 계속 없으면 문단 0 (인용 없는 문장 차단)", async () => {
    const models = scriptedModel([answerResponse("시험용 결론 문장에 인용이 없습니다 정말로.", [])]);
    const { events, rec } = await runCopilot(cmp, decisions, models);
    expect(events.some((e) => e.event === "paragraph")).toBe(false);
    expect(rec.regenerated).toBe(true);
    expect(rec.kind).toBe("fallback");
  });
  it("근거에 없는 금액이 문장에 있으면 재생성되어 나가지 않는다", async () => {
    const models = scriptedModel([answerResponse("시험용 결정례의 추징액은 9876543원입니다 확인하세요.", [0]), answerResponse(OK_TEXT, [0])]);
    const { events, rec } = await runCopilot(cmp, decisions, models);
    expect(rec.regenerated).toBe(true);
    expect(models.requests).toHaveLength(2);
    const text = events.filter((e) => e.event === "paragraph").map((e) => String(e.data.text)).join("");
    expect(text).not.toContain("9876543");
  });
  it("국세 금액 문장은 안내로 바뀌고 문단 0", async () => {
    const { events } = await runCopilot(cmp, decisions, scriptedModel([answerResponse("시험용 양도세는 5000만원입니다 확인하세요.", [0])]));
    expect(events.some((e) => e.event === "paragraph")).toBe(false);
  });
});

describe("도구 상자 - 목록 밖 문서는 모델에게 보이지 않는다", () => {
  it("검색·원문 조회가 미리 모은 문서만 돌려준다", async () => {
    const box = restrictedToolbox(decisions);
    expect((await box.search({ query: "라운지 글", asOf: "2026-10-27", limit: 8 })).map((d) => d.sourceId)).toEqual(["100", "101"]);
    expect(await box.getSource({ sourceId: "lounge:1", asOf: "2026-10-27" })).toBeNull();
  });
});

describe("근거 수집", () => {
  const base = { today: "2026-10-27", premiumOk: true, summaryAllowed: async (ids: string[]) => ids };
  it("고른 결정례 중 하나라도 못 읽으면 422(일부만 비교하지 않음)", async () => {
    const tools = fakeTools([], { async getSource(a) { return a.sourceId === "100" ? decisions[0]! : null; } });
    expect(await collectEvidence(cmp, { ...base, tools })).toEqual({ ok: false, status: 422, code: "source_not_found" });
  });
  it("결정례가 아닌 종류(라운지 등)는 비교 대상이 될 수 없다", async () => {
    const tools = fakeTools([], { async getSource(a) { return makeDoc({ sourceId: a.sourceId, sourceType: "glossary_term" }); } });
    expect(await collectEvidence(cmp, { ...base, tools })).toMatchObject({ ok: false, code: "source_not_found" });
  });
  it("프리미엄 문서는 권한 없는 계정에게 버려진다", async () => {
    const tools = fakeTools([], { async getSource(a) { return makeDoc({ sourceId: a.sourceId, sourceType: "case_decision", accessTier: "premium" }); } });
    expect(await collectEvidence(cmp, { ...base, premiumOk: false, tools })).toMatchObject({ ok: false, code: "source_not_found" });
  });
  it("요약 권리 없는 출판물은 0건 - 요약 대상이 없으면 거부되고 모델 호출 0", async () => {
    const pubs = [makeDoc({ sourceId: "node:1", sourceType: "publication", accessTier: "premium" }), makeDoc({ sourceId: "node:2", sourceType: "publication", accessTier: "premium", chunkId: 9 })];
    const none = await collectEvidence({ kind: "publications", ref: "시험법 제3조" }, { ...base, tools: fakeTools(pubs), summaryAllowed: async () => [] });
    expect(none).toEqual({ ok: false, status: 422, code: "no_summarizable_publication" });
    const some = await collectEvidence({ kind: "publications", ref: "시험법 제3조" }, { ...base, tools: fakeTools(pubs), summaryAllowed: async () => ["node:2"] });
    expect(some.ok && some.docs.map((d) => d.sourceId)).toEqual(["node:2"]);
  });
  it("연혁은 개정판을 시행일 순으로 모으고 다른 조문은 제외", async () => {
    const v1 = makeDoc({ sourceId: "a1", chunkId: 1, validFrom: "2020-01-01", validTo: "2022-01-01", path: "시험용법 > 제3조" });
    const v2 = makeDoc({ sourceId: "a2", chunkId: 2, validFrom: "2022-01-01", path: "시험용법 > 제3조" });
    const other = makeDoc({ sourceId: "a3", chunkId: 3, path: "시험용법 > 제9조" });
    const search = vi.fn(async () => [v2, other, v1]);
    const r = await collectEvidence({ kind: "history", ref: "시험용법 제3조", from: "2020-01-01", to: "2023-06-01" }, { ...base, tools: fakeTools([], { search }) });
    expect(r.ok && r.docs.map((d) => d.sourceId)).toEqual(["a1", "a2"]);
    expect(search.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
