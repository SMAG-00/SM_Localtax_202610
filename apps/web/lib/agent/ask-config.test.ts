import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAgentConfig } from "./ask-config";
import { budgetState, costWon, emptyAgentUsage, modelCallAllowed, parseAskLimits, parseBudget, parseLivePolicy, parseOfficialSearch, parsePricingAsk, parseScopeFlags } from "./ask-limits";
import { copyReady, COPY_KEYS, EMPTY_COPY, missingCopy, testCopy } from "./fixed-copy";
import { AGENT_ANSWER_PROMPT, AGENT_UTILITY_PROMPT, variableBlockText } from "./instructions";
import { defaultForbidden } from "./validators";

describe("환경변수 (모델 ID 코드 상수 0)", () => {
  it("답변 모델이 없으면 꺼짐", () => expect(readAgentConfig({})).toEqual({ ok: false, reason: "model_answer_missing" }));
  it("30일 보관 모델 계열은 답변·보조 어느 쪽이든 꺼짐 (PRD-04 6.7)", () => {
    expect(readAgentConfig({ AGENT_MODEL_ANSWER: "fable-x" })).toMatchObject({ ok: false, reason: "model_forbidden" });
    expect(readAgentConfig({ AGENT_MODEL_ANSWER: "ok-model", AGENT_MODEL_UTILITY: "Mythos-1" })).toMatchObject({ ok: false, reason: "model_forbidden" });
  });
  it("모양이 틀린 모델 ID·추론 강도는 꺼짐", () => {
    expect(readAgentConfig({ AGENT_MODEL_ANSWER: "a b" })).toMatchObject({ reason: "model_invalid" });
    expect(readAgentConfig({ AGENT_MODEL_ANSWER: "ok-model", AGENT_EFFORT_ANSWER: "max" })).toMatchObject({ reason: "effort_invalid", detail: "AGENT_EFFORT_ANSWER" });
  });
  it("정상 읽기", () => {
    expect(readAgentConfig({ AGENT_MODEL_ANSWER: "m-1", AGENT_MODEL_UTILITY: "m-2", AGENT_EFFORT_ANSWER: "LOW", AGENT_EFFORT_EXPERT: "high" })).toEqual({
      ok: true,
      config: { modelAnswer: "m-1", modelUtility: "m-2", effortGeneral: "low", effortExpert: "high", effortUtility: null },
    });
  });
});

describe("설정 파서 (한도·정책은 settings 값)", () => {
  const limits = { guest_daily: 3, member_daily: 10, premium_daily: 100, session_turns: 20, clarify_rounds: 2, clarify_per_round: 3, context_chunks: 12, context_tokens: 20000 };
  it("시드 모양을 읽고 선택 칸은 기본값", () => {
    expect(parseAskLimits(limits)).toMatchObject({ guestDaily: 3, clarifyRounds: 2, clarifyPerRound: 3, evidenceMinDocs: 1, evidenceMinScore: 0 });
  });
  it("값이 바뀌면 따라 바뀐다", () => expect(parseAskLimits({ ...limits, clarify_per_round: 2, evidence_min_docs: 2 })).toMatchObject({ clarifyPerRound: 2, evidenceMinDocs: 2 }));
  it("칸이 빠지거나 모양이 틀리면 null (호출 0으로 닫힘)", () => {
    expect(parseAskLimits({})).toBeNull();
    expect(parseAskLimits({ ...limits, session_turns: 0 })).toBeNull();
    expect(parseAskLimits({ ...limits, guest_daily: "3" })).toBeNull();
    expect(parseAskLimits(null)).toBeNull();
  });
  it("실시간 조회 정책·공식 검색·범위 플래그", () => {
    expect(parseLivePolicy({ max_calls: 3, timeout_ms: 5000, excerpt_tokens: 4000, official_search_max: 2 })).toEqual({ maxCalls: 3, timeoutMs: 5000, excerptTokens: 4000, officialSearchMax: 2 });
    expect(parseLivePolicy({ max_calls: 3 })).toBeNull();
    expect(parseOfficialSearch({ enabled: true })).toBe(true);
    expect(parseOfficialSearch({ enabled: "true" })).toBe(false);
    expect(parseOfficialSearch({})).toBe(false);
    expect(parseScopeFlags({ trust_redevelopment: true, inheritance: "true", gift: 1 })).toEqual({ trust_redevelopment: true, inheritance: false, gift: false });
  });
});

describe("비용 가드 (4.5)", () => {
  const budget = parseBudget({ monthly_won: 1000 });
  const pricing = parsePricingAsk({ answer: { in: 3000, out: 15000 } });
  it("예산·단가가 비면 unset이고 누구도 호출 못 한다", () => {
    expect(parseBudget({})).toBeNull();
    expect(parsePricingAsk({})).toBeNull();
    expect(budgetState(0, null, pricing)).toBe("unset");
    expect(budgetState(0, budget, null)).toBe("unset");
    expect(modelCallAllowed("unset", "member")).toBe(false);
    expect(modelCallAllowed("unset", "guest")).toBe(false);
  });
  it("80%·100% 경계", () => {
    expect(budgetState(799, budget, pricing)).toBe("ok");
    expect(budgetState(800, budget, pricing)).toBe("warn");
    expect(budgetState(999, budget, pricing)).toBe("warn");
    expect(budgetState(1000, budget, pricing)).toBe("over");
  });
  it("100%에서는 비회원부터 검색 모드", () => {
    expect(modelCallAllowed("over", "guest")).toBe(false);
    expect(modelCallAllowed("over", "member")).toBe(true);
    expect(modelCallAllowed("warn", "guest")).toBe(true);
  });
  it("비용 = 사용량 x 설정 단가", () => {
    const u = { ...emptyAgentUsage(), answerIn: 1000, answerOut: 500 };
    expect(costWon(u, pricing)).toBe(10.5);
    expect(costWon(u, null)).toBe(0);
  });
});

describe("지시문·고정 문구", () => {
  it("지시문에 숫자·모델 이름이 없다 (세무 값 0, 모델은 환경변수)", () => {
    for (const p of [AGENT_ANSWER_PROMPT, AGENT_UTILITY_PROMPT]) {
      expect(p).not.toMatch(/[0-9]/);
      expect(p).not.toMatch(/claude|opus|sonnet|haiku/i);
    }
  });
  it("가변 값은 캐시 지점 뒤 블록에만 있고 꺼진 범위는 적지 않는다", () => {
    const t = variableBlockText({ asOf: "2026-10-27", asOfApprox: false, mode: "general", tier: "guest", openScopes: [], tourismMixed: false, assumptions: [], impersonationRequested: false });
    expect(t).toContain("2026-10-27");
    expect(t).toContain("기본");
    expect(AGENT_ANSWER_PROMPT).not.toContain("2026-10-27");
  });
  it("고정 안내 문구는 빈 칸으로 출하되고 시험용 문구는 별도다", () => {
    expect(copyReady(EMPTY_COPY)).toBe(false);
    expect(missingCopy(EMPTY_COPY)).toHaveLength(COPY_KEYS.length);
    expect(copyReady(testCopy())).toBe(true);
    expect(Object.values(testCopy()).every((s) => s.startsWith("[시험용]"))).toBe(true);
  });
  it("V5 금지 사전은 도우미 사전을 포함", () => expect(defaultForbidden()).toContain("감면 대상입니다"));
});

const BANNED = new RegExp(["igt", "engine"].join("-") + "|@anthropic-ai/sdk|from \"" + ["open", "ai"].join("") + "\"");

describe("경계 - AI 코드는 국세 엔진·AI SDK를 불러오지 않는다 (NT9)", () => {
  const dirs = [path.resolve(__dirname), path.resolve(__dirname, "../server/agent")];
  it("소스 import 검사", () => {
    for (const dir of dirs) {
      for (const f of fs.readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !n.endsWith(".test.ts"))) {
        const src = fs.readFileSync(path.join(dir, f), "utf8");
        expect(src, f).not.toMatch(BANNED);
      }
    }
  });
});
