// 지방세봇 도구 정의와 입력 검사 - 순수 (W12-b b3, PRD-04 6.3). 모두 읽기 전용이다. 계산·감면·판정 도구는 W12-c가 더한다.
// web_search_official은 설정(ask_official_search)이 꺼지면 요청에 정의 0이다 (ASK-17).
import type { ToolDef } from "../assistant/anthropic";
import type { EvidenceDoc } from "./evidence";
import type { LiveTarget } from "./live";

export const BASE_TOOL_NAMES = ["search_corpus", "get_law_article", "get_source", "lookup_glossary", "fetch_official_source", "suggest_actions"] as const;
export type ToolName = (typeof BASE_TOOL_NAMES)[number] | "web_search_official";

const str = { type: "string" } as const;
const def = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolDef => ({
  name,
  description,
  strict: true,
  input_schema: { type: "object", properties, required, additionalProperties: false },
});

export interface ToolOptions {
  /** 실시간 조회를 부를 수 있는가 (질문당 상한 > 0 이고 서버 연결이 있음) */
  liveAvailable: boolean;
  officialSearchEnabled: boolean;
}

/** 요청에 넣을 도구 정의. 순서를 고정해 캐시가 깨지지 않게 한다 */
export function buildToolDefs(o: ToolOptions): ToolDef[] {
  const tools: ToolDef[] = [
    def("search_corpus", "색인된 법령·해석·결정례·가이드에서 추가 검색합니다", { query: str, doc_type: { type: "string" } }, ["query"]),
    def("get_law_article", "법령 조문 하나를 기준일 기준으로 읽습니다", { ref: str }, ["ref"]),
    def("get_source", "근거 ID로 원문 메타와 본문을 읽습니다", { source_id: str }, ["source_id"]),
    def("lookup_glossary", "용어 풀이를 찾습니다", { term: str }, ["term"]),
  ];
  if (o.liveAvailable) tools.push(def("fetch_official_source", "색인에 없는 최신 공식 원문을 국가법령정보 API로 조회합니다", { target_type: { type: "string", enum: ["law", "case", "interpretation"] }, query: str }, ["target_type", "query"]));
  tools.push(def("suggest_actions", "다음 행동(계산기·원문·바로가기)을 제안받습니다", { tax_items: { type: "array", items: str }, situation: str }, ["tax_items"]));
  if (o.officialSearchEnabled) tools.push(def("web_search_official", "허용 목록 공식 도메인에서만 검색합니다", { query: str }, ["query"]));
  return tools;
}

export type ToolInput =
  | { name: "search_corpus"; query: string; docType?: string }
  | { name: "get_law_article"; ref: string }
  | { name: "get_source"; sourceId: string }
  | { name: "lookup_glossary"; term: string }
  | { name: "fetch_official_source"; targetType: LiveTarget; query: string }
  | { name: "suggest_actions"; taxItems: string[]; situation?: string }
  | { name: "web_search_official"; query: string };

const isStr = (v: unknown, max = 200): v is string => typeof v === "string" && v.trim() !== "" && v.length <= max;

/** 모델이 보낸 도구 입력 검사 - 모양이 틀리면 null */
export function parseToolInput(name: string, input: unknown): ToolInput | null {
  const o = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!o) return null;
  switch (name) {
    case "search_corpus":
      return isStr(o.query) ? { name, query: o.query, ...(isStr(o.doc_type, 40) ? { docType: o.doc_type } : {}) } : null;
    case "get_law_article":
      return isStr(o.ref) ? { name, ref: o.ref } : null;
    case "get_source":
      return isStr(o.source_id, 80) ? { name, sourceId: o.source_id } : null;
    case "lookup_glossary":
      return isStr(o.term, 80) ? { name, term: o.term } : null;
    case "fetch_official_source":
      return isStr(o.query) && (o.target_type === "law" || o.target_type === "case" || o.target_type === "interpretation") ? { name, targetType: o.target_type, query: o.query } : null;
    case "suggest_actions":
      return Array.isArray(o.tax_items) && o.tax_items.every((x) => isStr(x, 40)) && o.tax_items.length <= 10 ? { name, taxItems: o.tax_items as string[], ...(isStr(o.situation) ? { situation: o.situation } : {}) } : null;
    case "web_search_official":
      return isStr(o.query) ? { name, query: o.query } : null;
    default:
      return null;
  }
}

export interface ActionSpec {
  kind: "calculator" | "source" | "wetax" | "determination" | "issue_map" | "expert_find" | "expert_request";
  key: string;
}

/** 서버가 구현하는 읽기 전용 도구 상자 (공개 키 + 공개 함수 - 쓰기 0) */
export interface AgentToolbox {
  search(a: { query: string; asOf: string; limit: number; docType?: string }): Promise<EvidenceDoc[]>;
  getLawArticle(a: { ref: string; asOf: string }): Promise<EvidenceDoc | null>;
  getSource(a: { sourceId: string; asOf: string }): Promise<EvidenceDoc | null>;
  lookupGlossary(a: { term: string }): Promise<EvidenceDoc[]>;
  suggestActions(a: { taxItems: string[]; situation?: string }): Promise<ActionSpec[]>;
  webSearchOfficial?(a: { query: string }): Promise<EvidenceDoc[]>;
}
