// 지방세봇 시험 도구 - 시험 파일에서만 쓴다 (W12-b). 가짜 모델·가짜 도구 상자·시험용 사전. 법·세무 문장 0 - 모든 글은 `시험용` 표시와 지어낸 글.
import { ModelError, type MessagesRequest, type MessagesResponse, type ModelClient } from "../assistant/anthropic";
import type { AgentConfig } from "./ask-config";
import type { AskLimits, LivePolicy } from "./ask-limits";
import type { RequirementDictionary } from "./clarify";
import type { EvidenceDoc } from "./evidence";
import { testCopy } from "./fixed-copy";
import type { AgentDeps } from "./flow";
import type { AgentToolbox } from "./tools";

export function makeDoc(over: Partial<EvidenceDoc> = {}): EvidenceDoc {
  return {
    sourceId: "100", sourceType: "law_article", docType: "law", path: "시험용법 > 제3조(시험용 제목)", content: "시험용 본문입니다. 기준 수치는 12345원 입니다.",
    taxItems: ["acquisition"], validFrom: "2020-01-01", validTo: null, scope: "base", accessTier: "public", chunkId: 1, snapshotId: 11, isLive: false, snapshotOk: true,
    fetchedAt: null, mapVersion: null, reviewedOn: null, score: 0.03, ...over,
  };
}

export const OK_TEXT = "시험용 요건을 확인하세요. 제3조 기준 금액은 12345원입니다.";

/** 모델 응답 - 한 문단 + 문서 인용 */
export function answerResponse(text: string, docIndexes: number[], docTitles: string[] = []): MessagesResponse {
  return {
    content: [{ type: "text", text, citations: docIndexes.map((i) => ({ type: "char_location", document_index: i, document_title: docTitles[i] ?? "100", cited_text: "x" })) } as never],
    stop_reason: "end_turn",
    usage: { input_tokens: 1000, output_tokens: 500 },
  };
}

export interface ScriptedModel extends ModelClient {
  requests: MessagesRequest[];
}
/** 차례대로 응답/오류를 내는 가짜 모델 - 네트워크 0 */
export function scriptedModel(script: Array<MessagesResponse | Error>): ScriptedModel {
  const requests: MessagesRequest[] = [];
  let i = 0;
  return {
    requests,
    async create(request) {
      requests.push(JSON.parse(JSON.stringify(request)) as MessagesRequest);
      const next = script[Math.min(i, script.length - 1)];
      i += 1;
      if (next === undefined) throw new ModelError("script empty", "shape");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

export interface FakeTools extends AgentToolbox {
  searches: string[];
}
export function fakeTools(docs: EvidenceDoc[] | Error, extra: Partial<AgentToolbox> = {}): FakeTools {
  const searches: string[] = [];
  return {
    searches,
    async search(a) {
      searches.push(a.query);
      if (docs instanceof Error) throw docs;
      return docs;
    },
    async getLawArticle() {
      return null;
    },
    async getSource() {
      return null;
    },
    async lookupGlossary() {
      return [];
    },
    async suggestActions() {
      return [{ kind: "wetax", key: "wetax" }];
    },
    ...extra,
  };
}

export const TEST_LIMITS: AskLimits = {
  guestDaily: 3, memberDaily: 10, premiumDaily: 100, sessionTurns: 20, clarifyRounds: 2, clarifyPerRound: 3, contextChunks: 12, contextTokens: 20000, evidenceMinDocs: 1, evidenceMinScore: 0,
};
export const TEST_LIVE: LivePolicy = { maxCalls: 3, timeoutMs: 5000, excerptTokens: 4000, officialSearchMax: 2 };
export const TEST_CONFIG: AgentConfig = { modelAnswer: "test-model-a", modelUtility: null, effortGeneral: "low", effortExpert: "high", effortUtility: null };

export const TEST_DICTIONARY: RequirementDictionary = {
  version: "시험용",
  topics: [
    {
      id: "t1",
      taxItems: ["acquisition"],
      keywords: ["시험용주제"],
      required: ["A", "B", "C", "D"].map((k) => ({
        id: `slot_${k.toLowerCase()}`,
        question: `시험용 질문 ${k}`,
        options: [
          { id: `${k.toLowerCase()}1`, label: `시험용 선택 ${k}1` },
          { id: `${k.toLowerCase()}2`, label: `시험용 선택 ${k}2` },
        ],
        satisfiedBy: [`이미말함${k}`],
      })),
    },
  ],
};

export function makeDeps(over: Partial<AgentDeps> & { tools?: AgentToolbox; models?: ModelClient } = {}): AgentDeps {
  return {
    config: TEST_CONFIG,
    limits: TEST_LIMITS,
    live: TEST_LIVE,
    officialSearch: false,
    models: scriptedModel([answerResponse(OK_TEXT, [0])]),
    tools: fakeTools([makeDoc()]),
    liveFetcher: null,
    scopeFlags: { trust_redevelopment: false, inheritance: false, gift: false },
    copy: testCopy(),
    dictionary: { version: "empty", topics: [] },
    tier: "guest",
    budget: "ok",
    pricing: { answer: { in: 3000, out: 15000, cachedIn: 300 }, utility: { in: 1000, out: 5000, cachedIn: 100 } },
    today: "2026-10-27",
    forbidden: ["틀림없이", "감면 대상입니다", "투자하세요"],
    personNames: ["김의효"],
    maxOutputTokens: 2000,
    ...over,
  };
}
