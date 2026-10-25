import { describe, expect, it } from "vitest";
import { caseEntryCard, caseSourceLine, publicSources, rebuttalLine } from "./case-view";
import { eventSourceInfo } from "./event-source";
import { fieldActions, fieldCandidateView, publishResultText, verdictText } from "./review-ui";

describe("행사 상세 출처 줄 (LG-15)", () => {
  it("기록된 공공누리 유형은 글자로, 유형이 없으면 줄이 없다", () => {
    expect(eventSourceInfo({ license_type: "kogl_1" }).licenseLabel).toContain("제1유형");
    expect(eventSourceInfo({ license_type: "kogl_4" }).licenseLabel).toContain("제4유형");
    expect(eventSourceInfo({ license_type: null }).licenseLabel).toBeNull();
    expect(eventSourceInfo({ license_type: "없는값" }).licenseLabel).toBeNull();
    expect(eventSourceInfo({}).licenseLabel).toBeNull();
  });

  it("이미지는 https 주소일 때만 그린다 (권리 미확인이면 뷰가 null 을 내리므로 렌더 0)", () => {
    expect(eventSourceInfo({ image_url: "https://example.test/i.png" }).imageUrl).toBe("https://example.test/i.png");
    expect(eventSourceInfo({ image_url: null }).imageUrl).toBeNull();
    expect(eventSourceInfo({ image_url: "http://example.test/i.png" }).imageUrl).toBeNull();
    expect(eventSourceInfo({ image_url: "javascript:alert(1)" }).imageUrl).toBeNull();
    expect(eventSourceInfo({ image_url: "https://x.test/a b.png" }).imageUrl).toBeNull();
    expect(eventSourceInfo({ image_url: "  " }).imageUrl).toBeNull();
  });
});

describe("금융 사례 DB 카드 (DF-07)", () => {
  const row = {
    id: 1, slug: "fixture-a", title: "시험용 사례", structure_type: "completion_guarantee", issues: ["시험용 쟁점 가"], outcome: "시험용 결과", as_of: "2026-09-30",
    sources: [{ label: "시험용 출처", url: "https://example.test/s" }, { label: "", url: "https://example.test/x" }, { label: "주소 아님", url: "javascript:x" }, "문자열"],
    companies: ["시험용 주식회사"], rebuttal_requested_on: "2026-10-01", rebuttal_status: "no_response", article_ids: [], license_type: "kogl_2", source_name: "시험용 원천", checked_on: "2026-10-20",
  };

  it("출처는 이름이 있고 http(s) 주소인 것만 남는다", () => {
    expect(publicSources(row.sources)).toEqual([{ label: "시험용 출처", url: "https://example.test/s" }]);
    expect(publicSources(null)).toEqual([]);
    expect(publicSources("x")).toEqual([]);
  });

  it("실명 기업이 있을 때만 반론 줄이 나오고 회신 없음이 그대로 적힌다", () => {
    expect(rebuttalLine(["시험용 주식회사"], "2026-10-01", "no_response")).toBe("반론 요청 2026-10-01 · 회신 없음");
    expect(rebuttalLine(["시험용 주식회사"], "2026-10-01", "answered")).toBe("반론 요청 2026-10-01 · 회신 있음");
    expect(rebuttalLine([], "2026-10-01", "answered")).toBeNull();
    expect(rebuttalLine(["시험용 주식회사"], null, "answered")).toBeNull();
    expect(rebuttalLine(["시험용 주식회사"], "2026-10-01", "알수없음")).toBeNull();
  });

  it("데이터 출처 줄은 원천 이름·확인일·공공누리 유형을 잇고, 수동 입력 항목(원천 없음)은 줄이 없다", () => {
    expect(caseSourceLine("시험용 원천", "2026-10-20", "kogl_2")).toMatch(/^출처 시험용 원천 · 확인일 2026-10-20 · 공공누리 제2유형/);
    expect(caseSourceLine("시험용 원천", null, null)).toBe("출처 시험용 원천");
    expect(caseSourceLine(null, "2026-10-20", "kogl_1")).toBeNull();
  });

  it("카드 값 - 구조 유형 글자, 출처 걸러내기, 반론·출처 줄", () => {
    const c = caseEntryCard(row);
    expect(c.structureLabel).toBe("책임준공");
    expect(c.sources).toHaveLength(1);
    expect(c.rebuttalLine).toContain("회신 없음");
    expect(c.sourceLine).toContain("시험용 원천");
    expect(caseEntryCard({ ...row, structure_type: "알수없음" }).structureLabel).toBe("알수없음");
  });
});

describe("공통 검수 - 분야 데이터 후보 표시와 버튼", () => {
  const payload = {
    target: "finance_indicator", source_item_id: "IDX-1", value_hash: "a".repeat(64), kogl_type: "kogl_4", changed_fields: ["unit"],
    fields: { label: "시험용 지표", unit: "%", value: 1.5, definition: "시험용 정의" },
  };

  it("후보 칸을 펼쳐 보이고 바뀐 칸을 표시한다", () => {
    const v = fieldCandidateView(payload)!;
    expect(v.targetLabel).toBe("금융 통계 지표");
    expect(v.sourceItemId).toBe("IDX-1");
    expect(v.koglLabel).toContain("제4유형");
    expect(v.rows.find((r) => r.name === "unit")).toEqual({ name: "unit", value: "%", changed: true });
    expect(v.rows.find((r) => r.name === "value")).toEqual({ name: "value", value: "1.5", changed: false });
    expect(v.hasBody).toBe(true);
    expect(v.typeMissing).toBe(false);
  });

  it("유형이 없거나 모르는 값이면 typeMissing(승인 불가 안내), 대상 모양이 아니면 null", () => {
    expect(fieldCandidateView({ ...payload, kogl_type: null })!.typeMissing).toBe(true);
    expect(fieldCandidateView({ ...payload, kogl_type: "이상한값" })!.typeMissing).toBe(true);
    expect(fieldCandidateView({ law: "x" })).toBeNull();
    expect(fieldCandidateView({ target: "supply_notice", fields: [] })).toBeNull();
  });

  it("공개 본문이 없는 대상(분양)은 제4유형이어도 본문 검사 버튼이 없다", () => {
    const supply = fieldCandidateView({ target: "supply_notice", kogl_type: "kogl_4", fields: { name: "시험용" } })!;
    expect(supply.hasBody).toBe(false);
    expect(fieldActions("approved", supply)).toEqual({ rightsCheck: false, publish: true });
  });

  it("[공개 반영]은 승인된 후보에만, [제4유형 검사]는 승인된 제4유형 본문 후보에만 열린다", () => {
    const v = fieldCandidateView(payload)!;
    expect(fieldActions("approved", v)).toEqual({ rightsCheck: true, publish: true });
    for (const status of ["drafted", "in_review", "published", "rejected", "failed"]) {
      expect(fieldActions(status, v)).toEqual({ rightsCheck: false, publish: false });
    }
    expect(fieldActions("approved", { koglType: "kogl_1", hasBody: true })).toEqual({ rightsCheck: false, publish: true });
  });

  it("검사 결과·반영 결과 문구", () => {
    expect(verdictText("pass")).toContain("통과");
    expect(verdictText("blocked")).toContain("차단");
    expect(verdictText("no_sources")).toContain("통과로 볼 수 없습니다");
    expect(verdictText(null)).toContain("검사할 본문이 없습니다");
    expect(publishResultText("corrected")).toContain("정정");
    expect(publishResultText("already_published")).toContain("이미");
    expect(publishResultText(undefined)).toBe("반영했습니다");
  });
});
