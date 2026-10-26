// 임베딩 PoC (W12-a a3 - RAG-02 "PoC 결과표로 결정", RAG-05 "재순위 전후 Recall 비교표"). 문항·정답 청크는 PO·감수 입력이라 파일로 받는다. 이 모듈은 계산과 표 만들기뿐(네트워크는 공급자 객체가 한다).
import { cosine, type EmbeddingProvider } from "./embedding.ts";
import { diversifyTop, recallAtK, rrfFuse } from "./rrf.ts";

export type PocCorpusItem = { id: number; docKey: string; text: string };
export type PocQuery = { query: string; relevant: number[] };
export type PocRow = { provider: string; model: string; dims: number; recallAt10: number; queries: number };

/** 전문(낱말 겹침) 순위 - 벡터 없이 도는 기준선. 질의의 2글자 조각이 많이 들어 있는 순 */
export function lexicalRank(query: string, corpus: PocCorpusItem[]): number[] {
  const sq = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");
  const q = sq(query);
  const grams = new Set<string>();
  for (let i = 0; i + 1 < q.length; i++) grams.add(q.slice(i, i + 2));
  return corpus
    .map((c) => {
      const t = sq(c.text);
      let s = 0;
      for (const g of grams) if (t.includes(g)) s++;
      return { id: c.id, s };
    })
    .sort((a, b) => b.s - a.s || b.id - a.id)
    .map((x) => x.id);
}

export async function vectorRank(provider: EmbeddingProvider, query: string, corpus: PocCorpusItem[], docVecs?: number[][]): Promise<number[]> {
  const dv = docVecs ?? (await provider.embed(corpus.map((c) => c.text), "document"));
  const [qv] = await provider.embed([query], "query");
  return corpus.map((c, i) => ({ id: c.id, s: cosine(qv, dv[i]) })).sort((a, b) => b.s - a.s || b.id - a.id).map((x) => x.id);
}

/** 공급자별 Recall@10 (벡터 단독) */
export async function runPoc(providers: EmbeddingProvider[], corpus: PocCorpusItem[], queries: PocQuery[]): Promise<PocRow[]> {
  const rows: PocRow[] = [];
  for (const p of providers) {
    const dv = await p.embed(corpus.map((c) => c.text), "document");
    let sum = 0;
    for (const q of queries) sum += recallAtK(await vectorRank(p, q.query, corpus, dv), q.relevant, 10);
    rows.push({ provider: p.id, model: p.model, dims: p.dims, recallAt10: queries.length ? sum / queries.length : 0, queries: queries.length });
  }
  return rows;
}

/** 재순위 전후 Recall 비교 (RAG-05): 전문 단독 · 전문+벡터 RRF · RRF 뒤 같은 문서 상한 */
export async function compareRerank(provider: EmbeddingProvider, corpus: PocCorpusItem[], queries: PocQuery[]) {
  const dv = await provider.embed(corpus.map((c) => c.text), "document");
  const docKey = new Map(corpus.map((c) => [c.id, c.docKey]));
  const acc = { lexical: 0, rrf: 0, rrfDiversified: 0 };
  for (const q of queries) {
    const lex = lexicalRank(q.query, corpus);
    const vec = await vectorRank(provider, q.query, corpus, dv);
    const fused = rrfFuse([lex.slice(0, 40), vec.slice(0, 40)]).map((x) => x.id);
    const div = diversifyTop(fused.map((id) => ({ id, docKey: docKey.get(id) ?? String(id) }))).map((c) => c.id);
    acc.lexical += recallAtK(lex, q.relevant, 12);
    acc.rrf += recallAtK(fused, q.relevant, 12);
    acc.rrfDiversified += recallAtK(div, q.relevant, 12);
  }
  const n = queries.length || 1;
  return { lexical: acc.lexical / n, rrf: acc.rrf / n, rrfDiversified: acc.rrfDiversified / n, queries: queries.length };
}

export function pocTable(rows: PocRow[]): string {
  const head = "| 공급자 | 모델 | 차원 | Recall@10 | 문항 수 |\n|---|---|---|---|---|";
  return [head, ...rows.map((r) => `| ${r.provider} | ${r.model} | ${r.dims} | ${(r.recallAt10 * 100).toFixed(1)}% | ${r.queries} |`)].join("\n");
}
