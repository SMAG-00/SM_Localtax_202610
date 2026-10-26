import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceDoc, EvidenceSourceType } from "@/lib/agent/evidence";
import type { ActionSpec, AgentToolbox } from "@/lib/agent/tools";

// 지방세봇 읽기 전용 도구 상자 (W12-b b3) - 공개 키 + agent_search 함수만 쓴다. 쓰기 0, service role 0.
// 접근 등급·권리·기준일·범위 플래그 필터는 함수 안 SQL이 강제한다(지시문에 맡기지 않음 - W12-a).

interface SearchRow {
  chunk_id: number;
  source_type: EvidenceSourceType;
  source_id: string;
  doc_type: string;
  path: string;
  content: string;
  tax_items: string[];
  valid_from: string;
  valid_to: string | null;
  scope: string;
  access_tier: string;
  snapshot_id: number | null;
  rrf_score: number;
}

export function rowToDoc(r: SearchRow): EvidenceDoc {
  return {
    sourceId: String(r.source_id),
    sourceType: r.source_type,
    docType: r.doc_type,
    path: r.path,
    content: r.content,
    taxItems: r.tax_items ?? [],
    validFrom: String(r.valid_from).slice(0, 10),
    validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
    scope: r.scope,
    accessTier: r.access_tier,
    chunkId: r.chunk_id,
    snapshotId: r.snapshot_id,
    isLive: false,
    snapshotOk: true,
    fetchedAt: null,
    mapVersion: null,
    reviewedOn: null,
    score: Number(r.rrf_score) || 0,
  };
}

export function createAgentToolbox(client: SupabaseClient, embed?: (q: string) => Promise<number[] | null>): AgentToolbox {
  const run = async (args: Record<string, unknown>): Promise<EvidenceDoc[]> => {
    const { data, error } = await client.rpc("agent_search", args);
    if (error) throw new Error(`agent_search ${error.code ?? ""}`);
    return ((data ?? []) as SearchRow[]).map(rowToDoc);
  };
  return {
    async search(a) {
      const vec = embed ? await embed(a.query).catch(() => null) : null;
      return run({ p_query: a.query, p_as_of: a.asOf, p_limit: a.limit, ...(vec ? { p_embedding: vec } : {}), ...(a.docType ? { p_source_types: [a.docType] } : {}) });
    },
    async getLawArticle(a) {
      const rows = await run({ p_query: a.ref, p_as_of: a.asOf, p_source_types: ["law_article"], p_limit: 5 });
      return rows.find((d) => d.path.replace(/\s+/gu, "").includes(a.ref.replace(/\s+/gu, ""))) ?? null;
    },
    async getSource(a) {
      // 원천 ID로 직접 읽는 함수는 아직 없다 [확인 필요: W12-b 뒤 보강] - 검색 결과에서 같은 원천을 찾는다
      const rows = await run({ p_query: a.sourceId, p_as_of: a.asOf, p_limit: 10 });
      return rows.find((d) => d.sourceId === a.sourceId) ?? null;
    },
    async lookupGlossary(a) {
      return run({ p_query: a.term, p_source_types: ["glossary_term"], p_limit: 3 });
    },
    async suggestActions(a): Promise<ActionSpec[]> {
      // 정적 매핑 - 주소는 화면(d)이 official_links·wetax_links·toolLinkFor에서 채운다. 질문·입력값을 싣지 않는다
      const items = a.taxItems.slice(0, 3);
      return [
        ...items.map((key): ActionSpec => ({ kind: "calculator", key })),
        { kind: "wetax", key: "wetax" },
        { kind: "expert_find", key: "find" },
        { kind: "expert_request", key: "request" },
      ];
    },
  };
}
