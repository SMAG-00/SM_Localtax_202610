import { describe, expect, it } from "vitest";
import { duplicatePlacementProblems, duplicateTopicProblems, guidesForSurface, sameGuideVersion, SURFACE_FEATURE, type PlacementRow, type PublicGuideRow } from "./placements";

// 시험용 지어낸 값만 - 실제 가이드 글·법령·숫자 없음
const guide = (over: Partial<PublicGuideRow> = {}): PublicGuideRow => ({
  hub: "trust",
  topic: "topic_a",
  slug: "test-guide-a",
  version: 2,
  title: "시험용 가이드 A",
  tax_scope: "local",
  last_reviewed_at: "2000-01-01T15:30:00Z",
  body_sha256: "hash-a-v2",
  ...over,
});
const place = (over: Partial<PlacementRow> = {}): PlacementRow => ({
  surface: "trust_type",
  target_key: "test-structure",
  sort: 0,
  hub: "trust",
  topic: "topic_a",
  slug: "test-guide-a",
  version: 2,
  body_sha256: "hash-a-v2",
  ...over,
});
const ON = { trust_tax_guide: true, finance_tax_guide: true, redevelopment_tax: true, tax_lifecycle: true } as const;

describe("guidesForSurface", () => {
  it("배치와 공개 가이드가 맞으면 제목·버전·감수일(KST)을 낸다", () => {
    const [g] = guidesForSurface([place()], [guide()], "trust_type", "test-structure", ON);
    expect(g).toMatchObject({ slug: "test-guide-a", version: 2, bodySha256: "hash-a-v2", taxScope: "local", lastReviewedOn: "2000-01-02" });
  });

  it("화면 종류의 기능 키가 꺼지면 빈 목록 (빈 상자·준비 중 0)", () => {
    expect(guidesForSurface([place()], [guide()], "trust_type", "test-structure", { ...ON, trust_tax_guide: false })).toEqual([]);
    expect(guidesForSurface([place({ surface: "finance_tax_hub" })], [guide()], "finance_tax_hub", "test-structure", { ...ON, finance_tax_guide: false })).toEqual([]);
  });

  it("공개 가이드에 없는(서명 전) 가이드는 배치돼 있어도 숨긴다", () => {
    expect(guidesForSurface([place()], [], "trust_type", "test-structure", ON)).toEqual([]);
  });

  it("배치 뷰와 가이드 뷰의 버전·본문 해시가 다르면 빼 낸다 (갱신 틈)", () => {
    expect(guidesForSurface([place({ version: 1 })], [guide()], "trust_type", "test-structure", ON)).toEqual([]);
    expect(guidesForSurface([place({ body_sha256: "stale" })], [guide()], "trust_type", "test-structure", ON)).toEqual([]);
  });

  it("다른 대상 키·다른 화면 종류의 배치는 섞이지 않고, 순서(sort)대로 나온다", () => {
    const rows = [place({ slug: "test-guide-b", sort: 5, version: 1, body_sha256: "hash-b" }), place({ sort: 1 }), place({ target_key: "other" })];
    const guides = [guide(), guide({ slug: "test-guide-b", version: 1, body_sha256: "hash-b", title: "시험용 가이드 B" })];
    expect(guidesForSurface(rows, guides, "trust_type", "test-structure", ON).map((g) => g.slug)).toEqual(["test-guide-a", "test-guide-b"]);
    expect(guidesForSurface(rows, guides, "dev_method", "test-structure", ON)).toEqual([]);
  });

  it("같은 가이드가 같은 화면에 두 번 겹쳐 배치돼도 한 번만 나온다", () => {
    expect(guidesForSurface([place(), place({ sort: 3 })], [guide()], "trust_type", "test-structure", ON)).toHaveLength(1);
  });

  it("화면 종류마다 기능 키가 하나씩 정해져 있다", () => {
    expect(SURFACE_FEATURE).toEqual({ trust_type: "trust_tax_guide", finance_tax_hub: "finance_tax_guide", dev_method: "redevelopment_tax", stage: "redevelopment_tax", situation: "tax_lifecycle" });
  });
});

describe("TRU-02 = DF-08 같은 가이드 버전", () => {
  it("신탁 유형 페이지와 금융 구조별 세금 가이드 허브에 같은 slug가 같은 버전·해시로 열린다", () => {
    const g = guide();
    const onType = guidesForSurface([place()], [g], "trust_type", "test-structure", ON);
    const onHub = guidesForSurface([place({ surface: "finance_tax_hub", target_key: "trust" })], [g], "finance_tax_hub", "trust", ON);
    expect(onType).toHaveLength(1);
    expect(sameGuideVersion(onType, onHub, "test-guide-a")).toBe(true);
  });

  it("한쪽에 없거나 버전이 다르면 같다고 하지 않는다", () => {
    const g = guide();
    const onType = guidesForSurface([place()], [g], "trust_type", "test-structure", ON);
    expect(sameGuideVersion(onType, [], "test-guide-a")).toBe(false);
    expect(sameGuideVersion(onType, [{ ...onType[0]!, version: 3 }], "test-guide-a")).toBe(false);
    expect(sameGuideVersion(onType, [{ ...onType[0]!, bodySha256: "other" }], "test-guide-a")).toBe(false);
  });
});

describe("중복 원고 검사", () => {
  it("같은 주제가 두 허브에 따로 있으면 문제로 낸다", () => {
    expect(duplicateTopicProblems([{ hub: "trust", topic: "trust", slug: "a" }, { hub: "finance_tax", topic: "trust", slug: "b" }])).toHaveLength(1);
  });
  it("주제가 허브마다 다르면 문제 없음", () => {
    expect(duplicateTopicProblems([{ hub: "trust", topic: "trust", slug: "a" }, { hub: "finance_tax", topic: "contribution", slug: "b" }])).toEqual([]);
  });
  it("같은 화면·대상·가이드 배치가 겹치면 문제로 낸다", () => {
    expect(duplicatePlacementProblems([place(), place()])).toHaveLength(1);
    expect(duplicatePlacementProblems([place(), place({ target_key: "other" })])).toEqual([]);
  });
});
