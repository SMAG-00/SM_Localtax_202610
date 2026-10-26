// 임베딩 어댑터 (W12-a a3 - PRD-04 RAG-02, docs/dev/W12-a_설계.md). 공급자는 PO 결정(유료) 전이므로 인터페이스 + 가짜 + 후보 틀만 둔다.
// 설정 EMBEDDING_PROVIDER 가 비어 있으면 resolveEmbeddingProvider 는 null - 임베딩을 계산하지 않고 전문 검색만 돈다.
// 후보 틀은 요청을 만들고 응답을 읽는 부분뿐이며, 바깥 호출 주소는 이 모듈의 허용 목록(EMBEDDING_HOSTS)만 쓴다. SDK 의존 0 (HTTP).
// 각 공급자의 요청·응답 모양은 PoC 때 공식 문서로 다시 확인한다 [확인 필요].
import { sha256Hex } from "./chunking.ts";

export type EmbedKind = "document" | "query";
export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dims: number;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

/** 바깥 호출 허용 주소 - 선정된 임베딩 API만 */
export const EMBEDDING_HOSTS: Record<string, string> = {
  voyage: "api.voyageai.com",
  openai: "api.openai.com",
  cohere: "api.cohere.com",
};

/** 가짜 임베딩 - 글자 2개 조각을 해시해 차원에 흩뿌린 뒤 길이 1로 맞춘다. 같은 글은 같은 벡터, 겹치는 글자가 많을수록 가깝다(시험·PoC 틀 확인용). 네트워크 0 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = "fake";
  constructor(
    readonly dims: number = 64,
    readonly model: string = "fake-bigram",
  ) {}
  async embed(texts: string[], _kind?: EmbedKind): Promise<number[][]> {
    void _kind; // 가짜는 문서/질의 구분이 없다
    return texts.map((t) => this.one(t));
  }
  private one(text: string): number[] {
    const v = new Array<number>(this.dims).fill(0);
    const s = text.normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");
    for (let i = 0; i + 1 < s.length; i++) {
      const h = parseInt(sha256Hex(s.slice(i, i + 2)).slice(0, 8), 16);
      v[h % this.dims] += 1; // 부호 없이 누적 (겹침이 곧 가까움)
    }
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    return norm === 0 ? v : v.map((x) => x / norm);
  }
}

export type CandidateName = keyof typeof EMBEDDING_HOSTS;
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** 후보 공급자 틀 - fetch는 주입한다(시험은 가짜 fetch). 호스트가 허용 목록 밖이면 호출 전에 던진다 */
export function createCandidateProvider(name: CandidateName, opts: { apiKey: string; model: string; dims: number; fetchImpl: FetchLike }): EmbeddingProvider {
  const host = EMBEDDING_HOSTS[name];
  if (!host) throw new Error(`허용되지 않은 임베딩 공급자: ${name}`);
  if (!opts.apiKey) throw new Error("EMBEDDING_API_KEY가 비어 있습니다");
  const call = async (url: string, headers: Record<string, string>, body: unknown): Promise<unknown> => {
    if (new URL(url).hostname !== host) throw new Error("임베딩 호출 주소가 허용 목록 밖입니다");
    const res = await opts.fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`임베딩 호출 실패 (${res.status})`);
    return res.json();
  };
  const auth = { authorization: `Bearer ${opts.apiKey}` };
  const check = (rows: unknown, n: number): number[][] => {
    if (!Array.isArray(rows) || rows.length !== n || rows.some((r) => !Array.isArray(r) || r.length !== opts.dims)) throw new Error("임베딩 응답의 개수나 차원이 맞지 않습니다");
    return rows as number[][];
  };
  return {
    id: name,
    model: opts.model,
    dims: opts.dims,
    async embed(texts, kind) {
      if (texts.length === 0) return [];
      if (name === "voyage") {
        const r = (await call("https://api.voyageai.com/v1/embeddings", auth, { input: texts, model: opts.model, input_type: kind })) as { data?: { embedding: number[] }[] };
        return check(r.data?.map((d) => d.embedding), texts.length);
      }
      if (name === "openai") {
        const r = (await call("https://api.openai.com/v1/embeddings", auth, { input: texts, model: opts.model })) as { data?: { embedding: number[] }[] };
        return check(r.data?.map((d) => d.embedding), texts.length);
      }
      const r = (await call("https://api.cohere.com/v2/embed", auth, { texts, model: opts.model, input_type: kind === "query" ? "search_query" : "search_document", embedding_types: ["float"] })) as { embeddings?: { float?: number[][] } };
      return check(r.embeddings?.float, texts.length);
    },
  };
}

/** 설정으로 공급자를 정한다. 비어 있으면 null(벡터 꺼짐). 'fake'는 시험·PoC 전용 */
export function resolveEmbeddingProvider(env: { provider?: string; model?: string; apiKey?: string; dims?: number }, fetchImpl?: FetchLike): EmbeddingProvider | null {
  const p = (env.provider ?? "").trim().toLowerCase();
  if (!p || p === "none" || p === "off") return null;
  if (p === "fake") return new FakeEmbeddingProvider(env.dims ?? 64);
  if (!(p in EMBEDDING_HOSTS)) throw new Error(`알 수 없는 EMBEDDING_PROVIDER: ${p}`);
  if (!env.model || !env.apiKey || !env.dims || !fetchImpl) return null; // 설정이 덜 채워지면 벡터 꺼짐
  return createCandidateProvider(p as CandidateName, { apiKey: env.apiKey, model: env.model, dims: env.dims, fetchImpl });
}

export function cosine(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : d / Math.sqrt(na * nb);
}
