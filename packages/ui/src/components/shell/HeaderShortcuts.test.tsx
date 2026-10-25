// 바로가기 이름 표 (HOME-13 · 14, W10-i) - 헤더에는 바로가기 줄이 없고(PO 2026-10-26), 이름 글자 표는 HEADER_SHORTCUTS 한 곳이다
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { brand } from "../../brand";
import { HEADER_SHORTCUTS, Header } from "./Header";

describe("바로가기 이름 표", () => {
  it("네 이름이 PO가 정한 글자 그대로이고 순서는 계산기·재테크·법령·상담 요청이다", () => {
    expect(HEADER_SHORTCUTS.map((s) => [s.key, s.label, s.href])).toEqual([
      ["calc", "부동산 세금 계산기", "/calc"],
      ["realestate_weekly", "금주 부동산 재테크", "/realestate/weekly"],
      ["brief_weekly", "금주 지방세 최신법령·유권해석", "/brief"],
      ["expert_request", `(가칭)${brand.productName} 전문가 상담요청`, "/experts/request"],
    ]);
  });

  it("상담 요청 이름은 (가칭)으로 시작하고 제품 이름을 brand에서 가져온다", () => {
    const label = HEADER_SHORTCUTS.find((s) => s.key === "expert_request")!.label;
    expect(label.startsWith("(가칭)")).toBe(true);
    expect(label).toContain(brand.productName);
    expect(label.endsWith("전문가 상담요청")).toBe(true);
  });

  it("글자에 AI 낱말이 없고 주소에 쿼리·해시가 없다", () => {
    for (const s of HEADER_SHORTCUTS) {
      expect(s.label).not.toMatch(/AI/);
      expect(s.href).not.toMatch(/[?#]/);
    }
  });
});

describe("헤더에는 바로가기 줄이 없다", () => {
  it("바로가기 내비게이션 요소가 0이고 유틸 메뉴 계산기 링크가 그대로 1개다", () => {
    render(<Header utilities={["calc", "experts"]} />);
    expect(screen.queryByRole("navigation", { name: "바로가기" })).toBeNull();
    expect(document.querySelector('[data-ui="header-shortcuts"]')).toBeNull();
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("href") === "/calc")).toHaveLength(1);
  });
});
