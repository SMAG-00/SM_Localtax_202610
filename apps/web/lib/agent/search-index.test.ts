import { describe, expect, it } from "vitest";
import { createCandidateProvider, FakeEmbeddingProvider, resolveEmbeddingProvider, cosine } from "./embedding";
import { chunksFromPayload, runIndexRefresh, type IndexStore, type QueueItem, type SourcePayload } from "./index-runner";
import { compareRerank, pocTable, runPoc, lexicalRank } from "./poc";
import { diversifyTop, recallAtK, rrfFuse } from "./rrf";

describe("RRF · Recall · 같은 문서 상한", () => {
  it("두 목록에 모두 있는 id가 한쪽에만 있는 id보다 앞선다 (점수 = 1/(60+순위) 합)", () => {
    const r = rrfFuse([[1, 2, 3], [3, 4]]);
    expect(r[0].id).toBe(3);
    expect(r[0].score).toBeCloseTo(1 / 63 + 1 / 61, 10);
    expect(r.map((x) => x.id)).toEqual([3, 1, 4, 2]);
  });
  it("Recall@K", () => {
    expect(recallAtK([1, 2, 3, 4], [2, 9], 2)).toBe(0.5);
    expect(recallAtK([1], [], 10)).toBe(1);
  });
  it("재순위: 상위 40개에서 12개, 같은 문서는 최대 3청크 (RAG-05)", () => {
    const cands = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, docKey: i < 8 ? "same" : `d${i}` }));
    const out = diversifyTop(cands);
    expect(out).toHaveLength(12);
    expect(out.filter((c) => c.docKey === "same")).toHaveLength(3);
    expect(Math.max(...out.map((c) => c.id))).toBeLessThanOrEqual(40);
  });
});

describe("임베딩 어댑터", () => {
  it("공급자 설정이 비면 null (벡터 꺼짐)", () => {
    expect(resolveEmbeddingProvider({})).toBeNull();
    expect(resolveEmbeddingProvider({ provider: "none" })).toBeNull();
    expect(resolveEmbeddingProvider({ provider: "voyage" })).toBeNull();
  });
  it("모르는 공급자는 거부", () => expect(() => resolveEmbeddingProvider({ provider: "x" })).toThrow());
  it("가짜 임베딩은 결정적이고 길이 1, 겹치는 글이 더 가깝다", async () => {
    const p = new FakeEmbeddingProvider(64);
    const [a, a2, b, c] = await p.embed(["시험용 취득 신고", "시험용 취득 신고", "시험용 취득 기한", "전혀 다른 문장 abc"], "document");
    expect(a).toEqual(a2);
    expect(Math.hypot(...a)).toBeCloseTo(1, 10);
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
  it("후보 틀: 허용된 주소로만 호출하고 응답 개수·차원이 틀리면 던진다", async () => {
    const calls: string[] = [];
    const ok = createCandidateProvider("voyage", {
      apiKey: "k", model: "m", dims: 3,
      fetchImpl: async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ data: [{ embedding: [1, 2, 3] }] }) }; },
    });
    expect(await ok.embed(["a"], "query")).toEqual([[1, 2, 3]]);
    expect(calls).toEqual(["https://api.voyageai.com/v1/embeddings"]);
    const bad = createCandidateProvider("openai", { apiKey: "k", model: "m", dims: 4, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ embedding: [1, 2, 3] }] }) }) });
    await expect(bad.embed(["a"], "document")).rejects.toThrow("차원");
    const fail = createCandidateProvider("cohere", { apiKey: "k", model: "m", dims: 3, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
    await expect(fail.embed(["a"], "document")).rejects.toThrow("500");
    expect(() => createCandidateProvider("openai", { apiKey: "", model: "m", dims: 3, fetchImpl: async () => { throw new Error("x"); } })).toThrow();
  });
});

describe("PoC 표", () => {
  const corpus = [
    { id: 1, docKey: "a", text: "시험용 취득 신고 기한 안내" },
    { id: 2, docKey: "b", text: "시험용 재산 평가 방법 설명" },
    { id: 3, docKey: "c", text: "전혀 관계 없는 가짜 문장 xyz" },
  ];
  const queries = [{ query: "취득 신고 기한", relevant: [1] }, { query: "재산 평가 방법", relevant: [2] }];
  it("Recall@10 표를 만든다", async () => {
    const rows = await runPoc([new FakeEmbeddingProvider(64)], corpus, queries);
    expect(rows[0]).toMatchObject({ provider: "fake", queries: 2, recallAt10: 1 });
    expect(pocTable(rows)).toContain("| fake | fake-bigram | 64 | 100.0% | 2 |");
  });
  it("전문 순위와 재순위 전후 비교", async () => {
    expect(lexicalRank("취득 신고 기한", corpus)[0]).toBe(1);
    const c = await compareRerank(new FakeEmbeddingProvider(64), corpus, queries);
    expect(c).toMatchObject({ lexical: 1, rrf: 1, rrfDiversified: 1, queries: 2 });
  });
});

describe("색인 실행기 (DB 없는 가짜 저장소)", () => {
  const lawPayload = (id: string): SourcePayload => ({
    sourceType: "law_article", sourceId: id, docType: "law", taxItems: ["local"], validFrom: "2099-01-01", accessTier: "public", rightsStatus: "confirmed", scope: "base",
    snapshotId: 5, sourceHash: `h${id}`, supersedeKey: "law:1:3:0", lawName: "시험용법", articleNo: 3, branchNo: 0, title: "제목", body: `시험용 조문 ${id}`,
  });
  function store(items: QueueItem[], payloads: Record<string, SourcePayload | null>, over: Partial<IndexStore> = {}) {
    const log = { finish: [] as [number, boolean, string | null, number | null][], put: 0, emb: 0 };
    let first = true;
    const s: IndexStore = {
      scan: async () => ({ enqueued: items.length, retired: 1 }),
      claim: async () => { if (!first) return []; first = false; return items; },
      load: async (i) => payloads[i.sourceId] ?? null,
      put: async () => { log.put++; return { ok: true, inserted: 1, ids: [100 + log.put] }; },
      finish: async (id, ok, err, n) => { log.finish.push([id, ok, err, n]); },
      withoutEmbedding: async () => [],
      putEmbedding: async () => { log.emb++; return { ok: true }; },
      status: async () => ({ pending: 0, oldestMinutes: 0 }),
      ...over,
    };
    return { s, log };
  }
  const item = (id: number, sourceId: string): QueueItem => ({ id, sourceType: "law_article", sourceId, reason: "new", attempts: 0 });

  it("원천 종류별 청킹을 고른다 (공개 해석은 요지/이유)", () => {
    expect(chunksFromPayload(lawPayload("1"))).toMatchObject({ ok: true });
    const r = chunksFromPayload({ ...lawPayload("2"), sourceType: "interpretation", docType: "ruling", issuer: "기관", docNo: "시험-9", body: "[요지]\n시험용 요지 글\n[이유]\n시험용 이유 글" } as SourcePayload);
    expect(r.ok && r.chunks.map((c) => c.path)).toEqual(["기관 시험-9 > 요지", "기관 시험-9 > 이유"]);
    expect(chunksFromPayload({ ...lawPayload("3"), sourceType: "publication" } as SourcePayload)).toMatchObject({ ok: false });
  });
  it("공급자 없으면 임베딩 0, 처리·건너뜀·실패를 센다 (전문 검색만으로 동작)", async () => {
    const { s, log } = store([item(1, "1"), item(2, "gone"), item(3, "bad")], { "1": lawPayload("1"), gone: null, bad: { ...lawPayload("3"), taxItems: [] } });
    const r = await runIndexRefresh(s, { now: new Date("2099-01-01T00:00:00Z") });
    expect(r).toMatchObject({ processed: 1, skipped: 1, failed: 1, chunksInserted: 1, embedded: 0, vector: "off", enqueued: 3, retiredSources: 1 });
    expect(log.emb).toBe(0);
    expect(log.finish.map((f) => f[1])).toEqual([true, true, false]);
    expect(log.finish[2][2]).toContain("meta_missing");
  });
  it("공급자가 있으면 새 청크를 임베딩하고, 임베딩 실패는 색인 실패가 아니다", async () => {
    const a = store([item(1, "1")], { "1": lawPayload("1") });
    const r = await runIndexRefresh(a.s, { now: new Date(), provider: new FakeEmbeddingProvider(8) });
    expect(r).toMatchObject({ processed: 1, embedded: 1, vector: "on" });
    const b = store([item(1, "1")], { "1": lawPayload("1") });
    const broken = { id: "x", model: "m", dims: 8, embed: async () => { throw new Error("down"); } };
    const r2 = await runIndexRefresh(b.s, { now: new Date(), provider: broken });
    expect(r2).toMatchObject({ processed: 1, failed: 0, embedFailed: 1 });
  });
  it("색인 쓰기가 거부하면 실패로 기록하고 다음 원천을 계속한다", async () => {
    let n = 0;
    const { s, log } = store([item(1, "1"), item(2, "2")], { "1": lawPayload("1"), "2": lawPayload("2") }, { put: async () => (++n === 1 ? { ok: false, code: "rights_not_confirmed" } : { ok: true, inserted: 1, ids: [9] }) });
    const r = await runIndexRefresh(s, { now: new Date() });
    expect(r).toMatchObject({ failed: 1, processed: 1 });
    expect(log.finish[0][2]).toContain("rights_not_confirmed");
  });
});
