import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEmbeddingProvider } from "@/lib/agent/embedding";
import { INDEX_VERSION } from "@/lib/agent/chunking";
import { runIndexRefresh, type IndexStore, type QueueItem, type SourcePayload } from "@/lib/agent/index-runner";
import { dbError } from "@/lib/server/http";
import { embeddingEnv } from "./env";

// 작업 index-refresh (W12-a a5 - RAG-03). 수집 작업(pipeline-law·docs·field) 뒤 1시간 안에 새·바뀐 원천을 색인한다.
// 이 모듈은 DB 함수(index_queue_*·chunk_*)만 부르고 AI를 쓰지 않는다. 임베딩 공급자가 설정되어 있을 때만 임베딩 API를 부른다(기본 꺼짐).
// 결과는 수뿐이다(조문·판결 글 0).

function rows<T>(data: unknown): T[] {
  return (Array.isArray(data) ? data : data ? [data] : []) as T[];
}

export function supabaseIndexStore(db: SupabaseClient): IndexStore {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw dbError(error, fn);
    return data;
  };
  return {
    async scan(indexVersion, now) {
      const d = (await rpc("index_queue_scan", { p_index_version: indexVersion, p_now: now.toISOString() })) as { enqueued?: number; retired?: number };
      return { enqueued: Number(d?.enqueued ?? 0), retired: Number(d?.retired ?? 0) };
    },
    async claim(limit, now) {
      const data = await rpc("index_queue_claim", { p_limit: limit, p_now: now.toISOString() });
      return rows<{ id: number; source_type: string; source_id: string; reason: string; attempts: number }>(data).map(
        (r): QueueItem => ({ id: Number(r.id), sourceType: r.source_type as QueueItem["sourceType"], sourceId: r.source_id, reason: r.reason, attempts: r.attempts }),
      );
    },
    async load(item) {
      // W13-a 지식창고 출판물은 전용 읽기 함수(권리 색인 자격을 다시 확인한다). 나머지는 기존 그대로
      if (item.sourceType === "publication") return ((await rpc("library_chunk_source_load", { p_source_id: item.sourceId })) as SourcePayload | null) ?? null;
      return ((await rpc("chunk_source_load", { p_source_type: item.sourceType, p_source_id: item.sourceId })) as SourcePayload | null) ?? null;
    },
    async put(item, meta, chunks, indexVersion) {
      const d = (await rpc("chunk_index_put", { p_source_type: item.sourceType, p_source_id: item.sourceId, p_index_version: indexVersion, p_meta: meta, p_chunks: chunks })) as { ok: boolean; code?: string; inserted?: number; ids?: number[] };
      return { ok: !!d?.ok, code: d?.code, inserted: d?.inserted, ids: d?.ids };
    },
    async finish(id, ok, error, chunkCount, now) {
      await rpc("index_queue_finish", { p_id: id, p_ok: ok, p_error: error, p_chunks: chunkCount, p_now: now.toISOString() });
    },
    async withoutEmbedding(model, limit) {
      const data = await rpc("chunks_without_embedding", { p_model: model, p_limit: limit });
      return rows<{ chunk_id: number; path: string; content: string }>(data).map((r) => ({ chunkId: Number(r.chunk_id), path: r.path, content: r.content }));
    },
    async putEmbedding(chunkId, model, vector) {
      const d = (await rpc("chunk_embedding_put", { p_chunk_id: chunkId, p_model: model, p_embedding: vector })) as { ok: boolean; code?: string };
      return { ok: !!d?.ok, code: d?.code };
    },
    async status(now) {
      const d = (await rpc("index_queue_status", { p_now: now.toISOString() })) as { pending?: number; oldest_minutes?: number };
      return { pending: Number(d?.pending ?? 0), oldestMinutes: Number(d?.oldest_minutes ?? 0) };
    },
  };
}

export async function refreshIndex(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const provider = resolveEmbeddingProvider(embeddingEnv(), (url, init) => fetch(url, init));
  const r = await runIndexRefresh(supabaseIndexStore(db), { now, provider });
  return { checkedAt: now.toISOString(), ...r };
}

/** 작업 library-index-sync (W13-a a8 - LIB-06) - 권리 철회·승인 취소된 지식창고 청크를 색인에서 빼고 색인할 원천을 대기열에 쌓는다. AI 없음, 결과는 수뿐 */
export async function syncLibraryIndex(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("library_index_sync", { p_index_version: INDEX_VERSION, p_now: now.toISOString() });
  if (error) throw dbError(error, "library_index_sync");
  const d = data as { ok?: boolean; retired?: number; enqueued?: number } | null;
  return { checkedAt: now.toISOString(), retired: Number(d?.retired ?? 0), enqueued: Number(d?.enqueued ?? 0) };
}
