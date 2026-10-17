// 4대 분야 카드 (PRD-00 8.6, PRD-01A HOME-01 · UX-04) — 4장 같은 비중, 정해진 네 경로, 주 버튼 아님(R2)
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FieldCards } from "./FieldCards";

const POINTS = {
  tax: "고지서·환급·신고 기한을 한곳에서 봅니다",
  realestate: "사고·갖고·팔 때 내는 지방세를 정리합니다",
  finance: "신탁·PF 구조에서 누가 취득세를 내는지 봅니다",
  local: "우리 지역 세수와 재정 소식을 전합니다",
};

describe("4대 분야 카드", () => {
  it("정확히 4장이 지방세 · 부동산 · 부동산개발금융 · 지자체뉴스 순서로 네 경로에 연결된다", () => {
    render(<FieldCards points={POINTS} />);
    const links = within(screen.getByRole("navigation", { name: "4대 분야" })).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/tax", "/realestate", "/finance", "/local"]);
    expect(links.map((a) => a.textContent)).toEqual([
      `지방세${POINTS.tax}`,
      `부동산${POINTS.realestate}`,
      `부동산개발금융${POINTS.finance}`,
      `지자체뉴스${POINTS.local}`,
    ]);
  });

  it("4장이 서로 다른 픽토그램과 라벨을 쓴다 (UX-04)", () => {
    const { container } = render(<FieldCards points={POINTS} />);
    const pictos = Array.from(container.querySelectorAll('[data-ui="pictogram"]'));
    expect(pictos).toHaveLength(4);
    const names = pictos.map((p) => p.getAttribute("data-pictogram"));
    const labels = pictos.map((p) => p.textContent);
    expect(new Set(names).size).toBe(4);
    expect(new Set(labels).size).toBe(4);
    expect(names).toEqual(["field-local-tax", "field-real-estate", "field-development-finance", "field-local-news"]);
  });

  it("분야 이름은 19px 900 글자다", () => {
    render(<FieldCards points={POINTS} />);
    for (const name of ["지방세", "부동산", "부동산개발금융", "지자체뉴스"]) {
      const el = screen.getByText(name);
      expect(el.className).toContain("text-[19px]");
      expect(el.className).toContain("font-black");
    }
  });

  it("주 버튼이 아니다 — 주 버튼 표식·hermes-500 면이 없고 링크 카드 문법이다 (R2)", () => {
    const { container } = render(<FieldCards points={POINTS} />);
    expect(container.querySelectorAll('[data-ui="primary-button"]')).toHaveLength(0);
    expect(container.querySelectorAll(".bg-hermes-500")).toHaveLength(0);
    expect(container.querySelectorAll('[data-ui="link-card"]')).toHaveLength(4);
  });

  it("4장은 같은 비중이다 — 카드 클래스가 모두 같다", () => {
    const { container } = render(<FieldCards points={POINTS} />);
    const classes = Array.from(container.querySelectorAll('[data-ui="link-card"]')).map((a) => a.className);
    expect(new Set(classes).size).toBe(1);
  });

  it("모바일 2×2, 1024px 이상 4열 격자다", () => {
    const { container } = render(<FieldCards points={POINTS} />);
    const grid = container.querySelector('[data-ui="field-cards"] ul')!;
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("lg:grid-cols-4");
  });

  it("지방세 포인트 한 줄을 주지 않으면 그 줄 없이 이름만 보인다 (R1 넘침 대응)", () => {
    render(<FieldCards />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["지방세", "부동산", "부동산개발금융", "지자체뉴스"]);
  });

  it("일부 분야만 포인트를 주면 그 분야만 한 줄이 붙는다", () => {
    render(<FieldCards points={{ finance: POINTS.finance }} />);
    expect(screen.getByRole("link", { name: /부동산개발금융/ }).textContent).toBe(`부동산개발금융${POINTS.finance}`);
    expect(screen.getByRole("link", { name: /^지방세$/ }).textContent).toBe("지방세");
  });

  it("분석용 분야 표식(data-field)이 카드마다 있다 (home_entry_clicked)", () => {
    const { container } = render(<FieldCards points={POINTS} />);
    const fields = Array.from(container.querySelectorAll("[data-field]")).map((el) => el.getAttribute("data-field"));
    expect(fields).toEqual(["tax", "realestate", "finance", "local"]);
  });
});
