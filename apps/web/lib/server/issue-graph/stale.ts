import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 작업 issue-graph-stale (W11-d d7 - PRD-03 AIOPS-11 · LINK-01). 지도 노드가 가리키는 조문의 글이 새 개정판에서 달라졌으면 DB 함수가
// 지도에 개정 신호를 달고 검수 큐 항목(issue_graph_stale) 1건을 만든다. 해시만 바뀐 사건·글이 같은 개정판은 신호 0.
// 이 모듈은 AI를 쓰지 않고 결과는 수뿐이다(조문 글·번호 0).
export async function detectIssueGraphStale(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("issue_graph_stale_detect");
  if (error) throw dbError(error, "쟁점 지도 개정 신호");
  const row = (Array.isArray(data) ? data[0] : data) as { items_created?: number; items_existing?: number; graphs_stale?: number } | null;
  return { checkedAt: now.toISOString(), itemsCreated: Number(row?.items_created ?? 0), itemsExisting: Number(row?.items_existing ?? 0), graphsStale: Number(row?.graphs_stale ?? 0) };
}
