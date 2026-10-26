import { describe, expect, it } from "vitest";
import { chunkDecision, chunkGuide, chunkIssueGraph, chunkLawArticle, chunkPublication, estimateTokens, splitByTokens, splitDecisionBody, validateChunkDraft, validateMeta, type ChunkMeta } from "./chunking";

// 모든 글은 시험용 가짜다 (실제 법령·세무 글 없음)
const meta = (over: Partial<ChunkMeta> = {}): ChunkMeta => ({
  sourceType: "law_article", sourceId: "1", docType: "law", taxItems: ["local"], validFrom: "2099-01-01", accessTier: "public",
  rightsStatus: "confirmed", scope: "base", snapshotId: 7, sourceHash: "h1", ...over,
});

describe("메타 검사 (RAG-01 - 메타가 빈 청크는 색인 거부)", () => {
  it("모든 메타가 있으면 통과한다", () => expect(validateMeta(meta())).toEqual({ ok: true }));
  it.each([
    ["docType", { docType: "" }],
    ["taxItems", { taxItems: [] }],
    ["taxItems", { taxItems: [" "] }],
    ["validFrom", { validFrom: "" }],
    ["validFrom", { validFrom: "2099/01/01" }],
    ["scope", { scope: undefined }],
    ["accessTier", { accessTier: undefined }],
    ["rightsStatus", { rightsStatus: undefined }],
    ["sourceHash", { sourceHash: " " }],
    ["sourceId", { sourceId: "" }],
  ])("%s 가 비면 meta_missing", (field, over) => {
    const r = validateMeta(meta(over as Partial<ChunkMeta>));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("meta_missing");
      expect(r.fields).toContain(field);
    }
  });
  it("원천 종류와 문서 종류가 안 맞으면 거부", () => expect(validateMeta(meta({ docType: "guide" }))).toMatchObject({ ok: false, code: "doc_type_mismatch" }));
  it("권리 미확인·제한은 거부 (권리 미확인 0)", () => {
    expect(validateMeta(meta({ rightsStatus: "unchecked" }))).toMatchObject({ ok: false, code: "rights_not_confirmed" });
    expect(validateMeta(meta({ rightsStatus: "restricted" }))).toMatchObject({ ok: false, code: "rights_not_confirmed" });
  });
  it("출판물은 권리가 미확인이면 거부, 확인돼도 프리미엄이 아니면 거부, 둘 다 맞아야 통과 (RAG-06)", () => {
    const pub = { sourceType: "publication", docType: "publication", snapshotId: null } as const;
    expect(validateMeta(meta({ ...pub, accessTier: "premium", rightsStatus: "unchecked" }))).toMatchObject({ ok: false, code: "rights_not_confirmed" });
    expect(validateMeta(meta({ ...pub, accessTier: "public" }))).toMatchObject({ ok: false, code: "publication_must_be_premium" });
    expect(validateMeta(meta({ ...pub, accessTier: "premium" }))).toEqual({ ok: true });
  });
  it("법령·해석·결정례는 스냅샷이 없으면 거부", () => expect(validateMeta(meta({ snapshotId: null }))).toMatchObject({ ok: false, code: "snapshot_required" }));
  it("효력 끝이 시작보다 빠르면 거부", () => expect(validateMeta(meta({ validTo: "2098-01-01" }))).toMatchObject({ ok: false, code: "bad_valid_range" }));
  it("청크 본문이 비었거나 해시 모양이 틀리면 거부", () => {
    expect(validateChunkDraft({ chunkNo: 0, path: "p", content: " ", tokenEst: 1, contentHash: "a".repeat(64) }).ok).toBe(false);
    expect(validateChunkDraft({ chunkNo: 0, path: "p", content: "c", tokenEst: 1, contentHash: "zz" }).ok).toBe(false);
    expect(validateChunkDraft({ chunkNo: 0, path: "p", content: "c", tokenEst: 1, contentHash: "a".repeat(64) }).ok).toBe(true);
  });
});

describe("splitByTokens", () => {
  it("짧은 글은 한 조각이다", () => expect(splitByTokens("시험용 짧은 글")).toEqual(["시험용 짧은 글"]));
  it("모든 조각이 최대 토큰 이하이고 글자를 잃지 않는다", () => {
    const text = Array.from({ length: 40 }, (_, i) => `시험용 문장 ${i} 입니다. ${"가".repeat(60)}`).join("\n");
    const out = splitByTokens(text, { minTokens: 50, maxTokens: 120 });
    expect(out.length).toBeGreaterThan(1);
    for (const o of out) expect(estimateTokens(o)).toBeLessThanOrEqual(120);
    expect(out.join("\n").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  });
  it("한 문장이 최대보다 길면 글자 단위로 자른다", () => {
    const out = splitByTokens("가".repeat(1000), { maxTokens: 100 });
    expect(out.length).toBe(5);
    expect(out.every((o) => estimateTokens(o) <= 100)).toBe(true);
  });
});

describe("법령 조문 청킹", () => {
  const art = (body: string) => ({ lawName: "시험용법", articleNo: 3, branchNo: 2, title: "시험용 제목", body });
  it("짧은 조는 한 청크이고 경로에 법령명·조·제목이 있다", () => {
    const r = chunkLawArticle(art("시험용 본문"), meta());
    expect(r.ok && r.chunks).toHaveLength(1);
    if (r.ok) expect(r.chunks[0].path).toBe("시험용법 > 제3조의2(시험용 제목)");
  });
  it("긴 조는 항(①②…) 단위로 나뉘고 경로에 항 번호가 붙는다", () => {
    const body = `도입 글\n① ${"가".repeat(700)}\n② ${"나".repeat(700)}\n③ 짧은 항`;
    const r = chunkLawArticle(art(body), meta(), { minTokens: 10, maxTokens: 400 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const paths = r.chunks.map((c) => c.path);
    expect(paths.some((p) => p.endsWith("제1항"))).toBe(true);
    expect(paths.some((p) => p.endsWith("제2항"))).toBe(true);
    expect(paths.some((p) => p.endsWith("제3항"))).toBe(true);
    expect(r.chunks[0].content.startsWith("도입 글")).toBe(true);
    expect(r.chunks.map((c) => c.chunkNo)).toEqual(r.chunks.map((_, i) => i));
  });
  it("같은 입력은 같은 해시, 글이 다르면 다른 해시", () => {
    const a = chunkLawArticle(art("시험용 A"), meta());
    const b = chunkLawArticle(art("시험용 A"), meta());
    const c = chunkLawArticle(art("시험용 B"), meta());
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.chunks[0].contentHash).toBe(b.chunks[0].contentHash);
      expect(a.chunks[0].contentHash).not.toBe(c.chunks[0].contentHash);
    }
  });
  it("메타가 비면 청크를 만들지 않는다", () => expect(chunkLawArticle(art("시험용"), meta({ taxItems: [] }))).toMatchObject({ ok: false, code: "meta_missing" }));
});

describe("결정례·출판물·가이드·쟁점 지도 청킹", () => {
  it("요지/이유 머리말로 본문을 나눈다", () => {
    expect(splitDecisionBody("[요지]\n시험용 요지 글\n[이유]\n시험용 이유 글")).toEqual({ summary: "시험용 요지 글", reasoning: "시험용 이유 글" });
    expect(splitDecisionBody("머리말 없는 시험용 본문")).toEqual({ summary: "", reasoning: "머리말 없는 시험용 본문" });
  });
  it("결정례는 요지와 이유가 서로 다른 경로의 청크가 된다", () => {
    const r = chunkDecision({ issuer: "시험용기관", docNo: "시험-1", summary: "요지 글", reasoning: "이유 글" }, meta({ sourceType: "interpretation", docType: "ruling" }));
    expect(r.ok && r.chunks.map((c) => c.path)).toEqual(["시험용기관 시험-1 > 요지", "시험용기관 시험-1 > 이유"]);
  });
  it("출판물은 절 단위 + 목차 경로, 권리 미확인이면 청크 0", () => {
    const pub = { sourceType: "publication", docType: "publication", accessTier: "premium", snapshotId: null } as const;
    const ok = chunkPublication({ title: "시험용 책", tocPath: ["1장"], sections: [{ heading: "1절", text: "글" }, { heading: "2절", text: "글2" }] }, meta(pub));
    expect(ok.ok && ok.chunks.map((c) => c.path)).toEqual(["시험용 책 > 1장 > 1절", "시험용 책 > 1장 > 2절"]);
    expect(chunkPublication({ title: "t", sections: [{ heading: "h", text: "글" }] }, meta({ ...pub, rightsStatus: "unchecked" }))).toMatchObject({ ok: false, code: "rights_not_confirmed" });
  });
  it("가이드는 절 단위", () => {
    const r = chunkGuide({ title: "시험용 가이드", sections: [{ heading: "절A", body: "본문A" }, { heading: "절B", body: " " }] }, meta({ sourceType: "guide_version", docType: "guide", snapshotId: null }));
    expect(r.ok && r.chunks.map((c) => c.path)).toEqual(["시험용 가이드 > 절A"]);
  });
  it("쟁점 지도는 버전 요약 1건 + 연결 표 행(노드 이름으로 풀어서)", () => {
    const r = chunkIssueGraph(
      { title: "시험용 지도", version: 2, summary: "시험용 요약", nodeRows: [{ nodeId: "n1", kind: "case", label: "시험-1" }, { nodeId: "n2", kind: "law_article", label: null }], edgeRows: [{ from: "n1", to: "n2", relation: "precedent" }] },
      meta({ sourceType: "issue_graph_version", docType: "issue_graph", snapshotId: null, scope: "trust_redevelopment" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.chunks.map((c) => c.path)).toEqual(["시험용 지도 (지도 v2) > 요약", "시험용 지도 (지도 v2) > 연결"]);
      expect(r.chunks[1].content).toBe("시험-1 -[precedent]-> n2");
    }
  });
});
