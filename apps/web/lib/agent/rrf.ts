// 순위 결합 RRF + Recall 계산 + 재순위 (W12-a - PRD-04 RAG-02·04·05). DB 함수 agent_search의 점수식(1/(k+순위), k=60)과 같다.
export const RRF_K = 60;

/** 목록마다 앞이 1등. 같은 id가 여러 목록에 있으면 점수를 더한다. 동점은 id 큰 쪽(DB와 같음) */
export function rrfFuse(lists: number[][], k = RRF_K): { id: number; score: number }[] {
  const score = new Map<number, number>();
  for (const l of lists) l.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score].map(([id, s]) => ({ id, score: s })).sort((a, b) => b.score - a.score || b.id - a.id);
}

/** Recall@K: 정답 id 중 상위 K개에 든 비율. 정답이 없으면 NaN 대신 1(해당 없음) */
export function recallAtK(ranked: number[], relevant: number[], k: number): number {
  if (relevant.length === 0) return 1;
  const top = new Set(ranked.slice(0, k));
  return relevant.filter((r) => top.has(r)).length / relevant.length;
}

export type Candidate = { id: number; docKey: string };

/** 재순위(RAG-05) 규칙 부분: 상위 N개에서 같은 문서는 최대 perDoc개, 전체 topK개. 순서는 입력 순서를 지킨다. 모델 기반 재순위는 Reranker로 앞에 끼운다 */
export function diversifyTop(cands: Candidate[], opts: { topK?: number; perDoc?: number; fromTop?: number } = {}): Candidate[] {
  const topK = opts.topK ?? 12;
  const perDoc = opts.perDoc ?? 3;
  const pool = cands.slice(0, opts.fromTop ?? 40);
  const seen = new Map<string, number>();
  const out: Candidate[] = [];
  for (const c of pool) {
    const n = seen.get(c.docKey) ?? 0;
    if (n >= perDoc) continue;
    seen.set(c.docKey, n + 1);
    out.push(c);
    if (out.length >= topK) break;
  }
  return out;
}

/** 재순위 모델 자리 - 기본은 없음(null). PoC 결과로 결정(PO #5) */
export interface Reranker {
  readonly id: string;
  rerank(query: string, cands: (Candidate & { text: string })[]): Promise<number[]>;
}

export async function rerank(query: string, cands: (Candidate & { text: string })[], reranker: Reranker | null, opts: { topK?: number; perDoc?: number; fromTop?: number } = {}): Promise<Candidate[]> {
  let ordered: Candidate[] = cands;
  if (reranker) {
    const ids = await reranker.rerank(query, cands.slice(0, opts.fromTop ?? 40));
    const byId = new Map(cands.map((c) => [c.id, c]));
    ordered = ids.map((i) => byId.get(i)).filter((c): c is Candidate & { text: string } => !!c);
  }
  return diversifyTop(ordered, opts);
}
