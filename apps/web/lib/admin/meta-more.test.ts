// 기사 기본 정보 '더 보기' 펼침 판정 시험 (PO 단순화 2026-10-31)
import { describe, expect, test } from "vitest";
import { moreOpenReason } from "./meta-more";

const base = {
  slug: "tax-note-1",
  section: "realestate",
  categoryId: "",
  format: "general",
  label: "none",
  partnerId: "",
  legalBasisDate: "",
  seriesTitle: "",
  seriesEpisodeText: "",
  regionCodesText: "",
  editorialField: "",
  publicQuestion: "",
  subjectKind: "general",
  relationTypes: [] as string[],
  coveredPartnerIds: [] as string[],
  interestDisclosure: "",
  coversBillStatus: false,
};

describe("moreOpenReason — 더 보기를 펼치는 이유", () => {
  test("새 기사처럼 기본값뿐이면 접어 둔다(null)", () => {
    expect(moreOpenReason(base, {})).toBeNull();
  });

  test.each([
    ["하위 분야", { categoryId: "12" }, "filled:meta-category"],
    ["형식 카드뉴스", { format: "cardnews" }, "filled:meta-format"],
    ["표기 광고", { label: "ad" }, "filled:meta-label"],
    ["지역 코드", { regionCodesText: "11680, 11650" }, "filled:meta-region-codes"],
    ["연재 회차만", { seriesEpisodeText: "2" }, "filled:meta-series-title"],
    ["소재 종류 축제", { subjectKind: "festival" }, "filled:meta-subject-kind"],
    ["관계 유형", { relationTypes: ["budget"] }, "filled:meta-relation-types"],
    ["법안 상태", { coversBillStatus: true }, "filled:meta-covers-bill-status"],
    ["이해관계 표시", { interestDisclosure: "광고 계약이 있습니다" }, "filled:meta-interest-disclosure"],
  ])("값이 있으면 펼친다 — %s", (_n, over, reason) => {
    expect(moreOpenReason({ ...base, ...over }, {})).toBe(reason);
  });

  test("공백뿐인 값은 값으로 치지 않는다", () => {
    expect(moreOpenReason({ ...base, regionCodesText: "   ", publicQuestion: " ", interestDisclosure: "  " }, {})).toBeNull();
  });

  test("주소(slug)가 비어 있으면 저장이 막히므로 펼친다", () => {
    expect(moreOpenReason({ ...base, slug: "  " }, {})).toBe("required:meta-slug");
  });

  test("지방세 분야는 법령 기준일이 없으면 펼치고, 적었으면 값이 있어서 펼친다", () => {
    expect(moreOpenReason({ ...base, section: "tax" }, {})).toBe("required:meta-legal-basis-date");
    expect(moreOpenReason({ ...base, section: "tax", legalBasisDate: "2026-10-01" }, {})).toBe("filled:meta-legal-basis-date");
  });

  test("지자체뉴스 분야는 지역 태그·편집 분야·공익적 질문이 필요하므로 펼친다", () => {
    expect(moreOpenReason({ ...base, section: "local" }, {})).toBe("required:region");
  });

  test("저장 오류가 '더 보기' 안의 칸을 가리키면 값이 비어 있어도 펼친다", () => {
    expect(moreOpenReason(base, { "meta-region-codes": "쉼표로 나눈 5자리 코드여야 합니다" })).toBe("error:meta-region-codes");
  });

  test("저장 오류가 기본 칸(제목)만 가리키면 접어 둔 채로 둔다", () => {
    expect(moreOpenReason(base, { "meta-title": "제목을 적어 주세요" })).toBeNull();
  });
});
