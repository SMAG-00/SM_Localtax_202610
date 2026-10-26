import { describe, expect, it } from "vitest";
import { ZONE_BLOCK_DISCLAIMER, articleLabel, ordinanceBlock, ordinanceKindsFor, zoneBlock, type OrdinanceArticleRow, type OrdinanceRow, type ZoneRow } from "./region-stage3-logic";

// W11-e e5 - 허브 블록 ③ 정비 현황 · ⑤ 조례 규칙. 시험용 이름·주소만 쓴다 (실제 조례 문장·세율 0).
const zone = (over: Partial<ZoneRow> = {}): ZoneRow => ({
  project_id: 1,
  slug: "test-zone-a",
  name: "시험용 구역 가",
  region_code: "1111000000",
  project_type: "test_type",
  current_stage_label: "시험용 단계",
  designation_notice_date: "2026-01-02",
  operator_name: "시험용 시행자",
  source_name: "시험용 출처",
  source_url: "https://example.test/zone",
  verified_at: "2026-03-01T00:30:00+09:00",
  stale: false,
  ...over,
});

const ord = (over: Partial<OrdinanceRow> = {}): OrdinanceRow => ({
  id: 10,
  region_code: "1111000000",
  region_level: "sigungu",
  kind: "tax_reduction",
  ordinance_name: "시험용 시 감면 조례",
  effective_from: "2026-01-01",
  verified_at: "2026-03-01T10:00:00+09:00",
  source_url: "https://example.test/ord",
  summary: "시험용 요약",
  summary_signed: true,
  summary_signed_at: "2026-03-02T10:00:00+09:00",
  stale: false,
  ...over,
});

const art = (over: Partial<OrdinanceArticleRow> = {}): OrdinanceArticleRow => ({ link_id: 10, article_no: 3, branch_no: 0, title: "시험용 조", body: "시험용 본문 7", ...over });

describe("zoneBlock - 정비 현황", () => {
  it("공개 구역이 0건이면 null (빈 상자·준비 중 0)", () => {
    expect(zoneBlock([], ["1111000000"])).toBeNull();
    expect(zoneBlock([zone({ region_code: "2600000000" })], ["1111000000"])).toBeNull();
  });
  it("출처·확인일이 없는 구역은 목록에서 뺀다", () => {
    expect(zoneBlock([zone({ source_name: null })], ["1111000000"])).toBeNull();
    expect(zoneBlock([zone({ source_url: null })], ["1111000000"])).toBeNull();
    expect(zoneBlock([zone({ verified_at: null })], ["1111000000"])).toBeNull();
  });
  it("확인일은 한국 날짜, 사업 유형 이름과 고정 문구가 붙는다", () => {
    const v = zoneBlock([zone()], ["1111000000"], { test_type: "시험용 유형" });
    expect(v?.items).toHaveLength(1);
    expect(v?.items[0]).toMatchObject({ verifiedOn: "2026-03-01", typeLabel: "시험용 유형", stale: false, operator: "시험용 시행자" });
    expect(v?.disclaimer).toBe(ZONE_BLOCK_DISCLAIMER);
    expect(Object.keys(v!.items[0]!).some((k) => /lat|lng|coord|map|price/i.test(k))).toBe(false);
  });
  it("확인일 경고 표시는 뷰 값 그대로 (stale true만 true)", () => {
    expect(zoneBlock([zone({ stale: true })], ["1111000000"])?.items[0]?.stale).toBe(true);
    expect(zoneBlock([zone({ stale: null })], ["1111000000"])?.items[0]?.stale).toBe(false);
  });
});

describe("ordinanceBlock - 조례", () => {
  it("시·도 허브는 도시정비 조례만, 시·군·구 허브는 감면·세율만", () => {
    expect(ordinanceKindsFor("sido")).toEqual(["urban_redevelopment"]);
    expect(ordinanceKindsFor("sigungu")).toEqual(["tax_reduction", "tax_rate"]);
    expect(ordinanceBlock([ord({ kind: "urban_redevelopment" })], [], "1111000000", "sigungu")).toBeNull();
    expect(ordinanceBlock([ord()], [], "1111000000", "sido")).toBeNull();
  });
  it("조례가 없는 지역은 null", () => {
    expect(ordinanceBlock([], [], "1111000000", "sigungu")).toBeNull();
    expect(ordinanceBlock([ord({ region_code: "2600000000" })], [], "1111000000", "sigungu")).toBeNull();
  });
  it("출처·시행일·확인일이 없는 조례는 연결 0", () => {
    expect(ordinanceBlock([ord({ source_url: null })], [], "1111000000", "sigungu")).toBeNull();
    expect(ordinanceBlock([ord({ effective_from: null })], [], "1111000000", "sigungu")).toBeNull();
    expect(ordinanceBlock([ord({ verified_at: null })], [], "1111000000", "sigungu")).toBeNull();
  });
  it("원문 상자와 요약 상자가 분리되고 조문은 번호 순", () => {
    const v = ordinanceBlock([ord()], [art({ article_no: 4, body: "시험용 둘째" }), art(), art({ article_no: 3, branch_no: 2, body: "시험용 가지" })], "1111000000", "sigungu");
    const item = v!.items[0]!;
    expect(item.articles.map((a) => a.label)).toEqual(["제3조", "제3조의2", "제4조"]);
    expect(item.summary).toEqual({ text: "시험용 요약", signedOn: "2026-03-02" });
  });
  it("서명되지 않은 요약은 상자 0, 다른 조례의 원문은 섞이지 않는다", () => {
    const v = ordinanceBlock([ord({ summary_signed: false, summary_signed_at: null })], [art({ link_id: 99 })], "1111000000", "sigungu");
    expect(v!.items[0]!.summary).toBeNull();
    expect(v!.items[0]!.articles).toEqual([]);
  });
  it("조문 라벨 - 가지 번호가 0이면 본조", () => {
    expect(articleLabel({ article_no: 5, branch_no: 0 })).toBe("제5조");
    expect(articleLabel({ article_no: 5, branch_no: 1 })).toBe("제5조의1");
  });
});
