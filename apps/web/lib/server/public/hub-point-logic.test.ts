// 허브 지방세 포인트 공개 값 (CORE-02 · W3 9단계) — 감수된 뷰 행도 모양이 틀리면 블록째 숨김, 홈 카드는 첫 줄
import { describe, expect, it } from "vitest";
import { fieldCardPoints, hubTaxPoint, hubTaxPoints, type HubPointRow } from "./hub-point-logic";

const row = (over: Partial<HubPointRow> = {}): HubPointRow => ({
  section: "realestate",
  lines: ["시험용 첫 줄", "시험용 둘째 줄"],
  base_date: "2026-10-01",
  links: [{ label: "시험용 해설", href: "/tax" }],
  ...over,
});

describe("공개 뷰 행 → 포인트 블록", () => {
  it("1~3줄·기준일·해설 링크가 있으면 블록 값", () => {
    expect(hubTaxPoint(row())).toEqual({ points: ["시험용 첫 줄", "시험용 둘째 줄"], basisDate: "2026-10-01", links: [{ label: "시험용 해설", href: "/tax" }] });
  });
  it("0줄·4줄·빈 줄·기준일 없음·링크 없음·바깥 링크는 null (블록째 숨김)", () => {
    for (const bad of [
      row({ lines: [] }),
      row({ lines: ["1", "2", "3", "4"] }),
      row({ lines: ["시험용", " "] }),
      row({ base_date: null }),
      row({ links: [] }),
      row({ links: [{ label: "x", href: "https://example.test" }] }),
      row({ links: [{ label: " ", href: "/tax" }] }),
    ]) {
      expect(hubTaxPoint(bad)).toBeNull();
    }
  });
  it("분야별 — 지방세·모르는 분야는 뺀다, 홈 카드는 첫 줄", () => {
    const points = hubTaxPoints([row(), row({ section: "tax" }), row({ section: "local", lines: ["시험용 지자체 줄"] }), row({ section: "finance", lines: [] })]);
    expect(Object.keys(points).sort()).toEqual(["local", "realestate"]);
    expect(fieldCardPoints(points)).toEqual({ realestate: "시험용 첫 줄", local: "시험용 지자체 줄" });
  });
});
