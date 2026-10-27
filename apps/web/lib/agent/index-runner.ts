// 증분 색인 실행기 (W12-a a5 - RAG-03). 저장소(IndexStore)를 주입받는 순수 흐름이라 DB 없이 시험한다. AI 호출 0 (임베딩 공급자가 있을 때만 임베딩 계산).
// 흐름: 스캔(새 원천·바뀐 원천 대기열, 철회된 원천 즉시 제외) -> 대기열 가져오기 -> 원천 읽기 -> 청킹 -> 색인 쓰기 -> (공급자가 있으면) 임베딩 -> 끝 표시. 마지막에 임베딩이 빠진 청크를 채운다(백필).
// 한 원천이 실패해도 다음 원천을 계속하고, 실패는 대기열에 횟수·사유(300자)만 남긴다.
import {
  chunkDecision, chunkGuide, chunkIssueGraph, chunkLawArticle, embeddingText, INDEX_VERSION, splitDecisionBody,
  type ChunkMeta, type ChunkResult, type ChunkScope, type SourceType,
} from "./chunking.ts";
import type { EmbeddingProvider } from "./embedding.ts";

export type QueueItem = { id: number; sourceType: SourceType; sourceId: string; reason: string; attempts: number };
/** chunk_source_load 가 돌려주는 모양 (camelCase) */
export type SourcePayload = Record<string, unknown> & {
  sourceType: SourceType; sourceId: string; docType: string; taxItems: string[]; validFrom: string; accessTier: "public" | "premium";
  rightsStatus: "confirmed" | "unchecked" | "restricted"; scope: ChunkScope; snapshotId: number | null; sourceHash: string; supersedeKey?: string | null;
};
export type PutResult = { ok: boolean; code?: string; inserted?: number; ids?: number[] };

export interface IndexStore {
  scan(indexVersion: string, now: Date): Promise<{ enqueued: number; retired: number }>;
  claim(limit: number, now: Date): Promise<QueueItem[]>;
  load(item: QueueItem): Promise<SourcePayload | null>;
  put(item: QueueItem, meta: ChunkMeta, chunks: { chunkNo: number; path: string; content: string; tokenEst: number; contentHash: string }[], indexVersion: string): Promise<PutResult>;
  finish(id: number, ok: boolean, error: string | null, chunkCount: number | null, now: Date): Promise<void>;
  withoutEmbedding(model: string, limit: number): Promise<{ chunkId: number; path: string; content: string }[]>;
  putEmbedding(chunkId: number, model: string, vector: number[]): Promise<{ ok: boolean; code?: string }>;
  status(now: Date): Promise<{ pending: number; oldestMinutes: number }>;
}

export function metaOf(p: SourcePayload): ChunkMeta {
  return {
    sourceType: p.sourceType, sourceId: p.sourceId, docType: p.docType, taxItems: p.taxItems, validFrom: p.validFrom, validTo: null,
    accessTier: p.accessTier, rightsStatus: p.rightsStatus, scope: p.scope, snapshotId: p.snapshotId ?? null, sourceHash: p.sourceHash, supersedeKey: p.supersedeKey ?? null,
  };
}

/** 원천 -> 청크. 원천 종류마다 청킹 함수를 고른다 */
export function chunksFromPayload(p: SourcePayload): ChunkResult {
  const meta = metaOf(p);
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  switch (p.sourceType) {
    case "law_article":
      return chunkLawArticle({ lawName: s("lawName"), articleNo: Number(p.articleNo), branchNo: Number(p.branchNo ?? 0), title: (p.title as string | null) ?? null, body: s("body") }, meta);
    case "interpretation":
    case "case_decision": {
      const parts = splitDecisionBody(s("body"));
      return chunkDecision({ issuer: s("issuer"), docNo: s("docNo"), summary: parts.summary, reasoning: parts.reasoning }, meta);
    }
    case "guide_version":
      return chunkGuide({ title: s("title"), sections: (p.sections as { heading: string; body: string }[]) ?? [] }, meta);
    case "issue_graph_version":
      return chunkIssueGraph(
        { title: s("title"), version: Number(p.version ?? 1), summary: (p.summary as string | null) ?? null, nodeRows: (p.nodeRows as { nodeId: string; kind: string; label: string | null }[]) ?? [], edgeRows: (p.edgeRows as { from: string; to: string; relation: string; note?: string }[]) ?? [] },
        meta,
      );
    case "publication":
      // W13-a 지식창고 - library_chunk_source_load가 돌려준 경로(서명 판 > 제목)와 본문을 한 절로 청킹한다
      return chunkGuide({ title: s("path"), sections: [{ heading: "본문", body: s("body") }] }, meta);
    default:
      return { ok: false, code: "no_loader" };
  }
}

export type RunOptions = {
  now: Date;
  provider?: EmbeddingProvider | null;
  indexVersion?: string;
  batchSize?: number;
  /** 한 번 실행에서 처리할 최대 묶음 수 (시간 상한 대용) */
  maxBatches?: number;
  /** 임베딩 백필 한 번에 채울 개수 */
  backfill?: number;
};
export type RunResult = {
  enqueued: number; retiredSources: number; processed: number; failed: number; skipped: number; chunksInserted: number;
  embedded: number; embedFailed: number; pending: number; oldestPendingMinutes: number; vector: "off" | "on";
};

export async function runIndexRefresh(store: IndexStore, o: RunOptions): Promise<RunResult> {
  const iv = o.indexVersion ?? INDEX_VERSION;
  const r: RunResult = { enqueued: 0, retiredSources: 0, processed: 0, failed: 0, skipped: 0, chunksInserted: 0, embedded: 0, embedFailed: 0, pending: 0, oldestPendingMinutes: 0, vector: o.provider ? "on" : "off" };
  const sc = await store.scan(iv, o.now);
  r.enqueued = sc.enqueued;
  r.retiredSources = sc.retired;
  for (let b = 0; b < (o.maxBatches ?? 20); b++) {
    const items = await store.claim(o.batchSize ?? 50, o.now);
    if (items.length === 0) break;
    for (const item of items) {
      try {
        const payload = await store.load(item);
        if (!payload) {
          // 더는 색인할 수 없는 원천 - 끝으로 표시(스캔이 청크를 이미 뺐다)
          await store.finish(item.id, true, null, 0, o.now);
          r.skipped++;
          continue;
        }
        const built = chunksFromPayload(payload);
        if (!built.ok) throw new Error(`청킹 거부: ${built.code}${built.fields ? ` (${built.fields.join(",")})` : ""}`);
        if (built.chunks.length === 0) {
          await store.finish(item.id, true, null, 0, o.now);
          r.skipped++;
          continue;
        }
        const put = await store.put(item, metaOf(payload), built.chunks, iv);
        if (!put.ok) throw new Error(`색인 거부: ${put.code ?? "unknown"}`);
        r.chunksInserted += put.inserted ?? 0;
        if (o.provider && put.ids && put.ids.length) {
          const texts = built.chunks.map((c) => embeddingText(c));
          // 새로 들어간 행만 임베딩한다 - 백필이 나머지를 채운다
          if (put.ids.length === texts.length) {
            try {
              const vecs = await o.provider.embed(texts, "document");
              for (let i = 0; i < put.ids.length; i++) {
                const e = await store.putEmbedding(put.ids[i], o.provider.model, vecs[i]);
                if (e.ok) r.embedded++;
                else r.embedFailed++;
              }
            } catch {
              r.embedFailed += put.ids.length; // 임베딩 실패는 색인 실패가 아니다 - 전문 검색은 이미 된다
            }
          }
        }
        await store.finish(item.id, true, null, built.chunks.length, o.now);
        r.processed++;
      } catch (e) {
        r.failed++;
        await store.finish(item.id, false, e instanceof Error ? e.message : "오류", null, o.now);
      }
    }
  }
  if (o.provider) {
    const missing = await store.withoutEmbedding(o.provider.model, o.backfill ?? 50);
    if (missing.length) {
      try {
        const vecs = await o.provider.embed(missing.map((m) => embeddingText(m)), "document");
        for (let i = 0; i < missing.length; i++) {
          const e = await store.putEmbedding(missing[i].chunkId, o.provider.model, vecs[i]);
          if (e.ok) r.embedded++;
          else r.embedFailed++;
        }
      } catch {
        r.embedFailed += missing.length;
      }
    }
  }
  const st = await store.status(o.now);
  r.pending = st.pending;
  r.oldestPendingMinutes = st.oldestMinutes;
  return r;
}
