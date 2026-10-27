import { describe, expect, it } from "vitest";
import { chunksFromPayload, type SourcePayload } from "./index-runner";

// W13-a - 지식창고 출판물 원천은 경로(서명 판 > 제목) + 본문 한 절로 청킹된다. 글은 모두 시험용이다.
const payload = (over: Record<string, unknown> = {}): SourcePayload =>
  ({
    sourceType: "publication", sourceId: "node:7", docType: "publication", taxItems: ["지식창고"], validFrom: "2026-01-01",
    accessTier: "premium", rightsStatus: "confirmed", scope: "base", snapshotId: null, sourceHash: "h1", title: "시험용 장",
    path: "시험용 출판물 시험 1판 > 시험용 장", body: "시험용 본문 문장입니다.", ...over,
  }) as SourcePayload;

describe("출판물 청킹 (chunksFromPayload - publication)", () => {
  it("경로와 본문으로 청크를 만들고 경로가 서명 판 > 제목 모양이다", () => {
    const r = chunksFromPayload(payload());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.chunks.length).toBeGreaterThan(0);
      expect(r.chunks[0]!.path).toBe("시험용 출판물 시험 1판 > 시험용 장 > 본문");
      expect(r.chunks[0]!.content).toContain("시험용 본문 문장입니다.");
    }
  });
  it("본문이 비면 청크 0개 또는 거부이고 지어낸 청크는 없다", () => {
    const r = chunksFromPayload(payload({ body: "   " }));
    expect(r.ok ? r.chunks.length : 0).toBe(0);
  });
  it("프리미엄이 아니거나 권리 미확인이면 메타 검사에서 거부된다 (출판물 게이트와 같은 조건)", () => {
    const a = chunksFromPayload(payload({ accessTier: "public" }));
    const b = chunksFromPayload(payload({ rightsStatus: "unchecked" }));
    expect(a.ok && a.chunks.length > 0).toBe(false);
    expect(b.ok && b.chunks.length > 0).toBe(false);
  });
});
