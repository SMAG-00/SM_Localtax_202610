// 임베딩 PoC 도구 (W12-a a3 - RAG-02) - Recall@10 결과표를 만든다.
// 사용: node scripts/embedding-poc.mjs <poc.json> [fake|voyage|openai|cohere ...]
//   poc.json = { "corpus": [{ "id": 1, "docKey": "d1", "text": "..." }], "queries": [{ "query": "...", "relevant": [1] }] }
//   문항·정답은 PO·감수 입력이다(이 저장소에는 시험용 견본만). 공급자를 정하지 않으면 fake(네트워크 0)만 돈다.
//   실제 공급자는 환경변수 EMBEDDING_MODEL · EMBEDDING_API_KEY 환경변수와 --dims=<차원> 이 있어야 돈다(유료 - PO 결정 뒤).
import fs from "node:fs";
import { FakeEmbeddingProvider, resolveEmbeddingProvider } from "../apps/web/lib/agent/embedding.ts";
import { compareRerank, pocTable, runPoc } from "../apps/web/lib/agent/poc.ts";

const args = process.argv.slice(2);
const dimsArg = Number((args.find((a) => a.startsWith("--dims=")) ?? "").slice(7)) || undefined;
const [file, ...names] = args.filter((a) => !a.startsWith("--"));
if (!file) {
  console.error("사용: node scripts/embedding-poc.mjs <poc.json> [fake|voyage|openai|cohere ...]");
  process.exit(2);
}
const { corpus, queries } = JSON.parse(fs.readFileSync(file, "utf8"));
const providers = [];
for (const n of names.length ? names : ["fake"]) {
  if (n === "fake") providers.push(new FakeEmbeddingProvider(64));
  else {
    const p = resolveEmbeddingProvider({ provider: n, model: process.env.EMBEDDING_MODEL, apiKey: process.env.EMBEDDING_API_KEY, dims: dimsArg }, (url, init) => fetch(url, init));
    if (!p) console.error(`${n}: 설정이 비어 있어 건너뜁니다 (EMBEDDING_MODEL · EMBEDDING_API_KEY · --dims)`);
    else providers.push(p);
  }
}
console.log(pocTable(await runPoc(providers, corpus, queries)));
if (providers[0]) {
  const c = await compareRerank(providers[0], corpus, queries);
  console.log(`\n재순위 전후 Recall@12 (${providers[0].id}) - 전문 ${(c.lexical * 100).toFixed(1)}% · RRF ${(c.rrf * 100).toFixed(1)}% · RRF+같은 문서 상한 ${(c.rrfDiversified * 100).toFixed(1)}%`);
}
