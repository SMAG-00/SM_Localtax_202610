// 많이 본 기사 목록 (PRD-00 8.6, PRD-01A ART-11) — 순위 숫자(고정폭, navy-300) + 제목 한 줄, 최근 7일 기준 표시
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PopularArticles } from "./PopularArticles";

const make = (n: number) => Array.from({ length: n }, (_, i) => ({ href: `/news/a-${i + 1}`, title: `많이 본 기사 제목 ${i + 1}` }));

describe("많이 본 기사 목록", () => {
  it("제목과 '최근 7일 기준'을 보이고 순서 있는 목록으로 렌더한다", () => {
    render(<PopularArticles items={make(3)} />);
    const section = screen.getByRole("region", { name: "많이 본 기사" });
    expect(within(section).getByText("최근 7일 기준")).toBeTruthy();
    const list = within(section).getByRole("list");
    expect(list.tagName.toLowerCase()).toBe("ol");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });

  it("순위 숫자는 1부터 고정폭 navy-300이고 항목 링크에 순위 표식이 있다 (popular_article_clicked)", () => {
    const { container } = render(<PopularArticles items={make(3)} />);
    const ranks = Array.from(container.querySelectorAll("[data-rank-number]"));
    expect(ranks.map((r) => r.textContent)).toEqual(["1", "2", "3"]);
    for (const r of ranks) {
      expect(r.className).toContain("font-mono");
      expect(r.className).toContain("text-navy-300");
    }
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("data-rank"))).toEqual(["1", "2", "3"]);
    expect(links[0].getAttribute("href")).toBe("/news/a-1");
  });

  it("제목은 한 줄로 자르고 터치 영역은 44px 이상이다", () => {
    render(<PopularArticles items={make(1)} />);
    const title = screen.getByText("많이 본 기사 제목 1");
    expect(title.className).toContain("truncate");
    expect(screen.getByRole("link").className).toContain("min-h-11");
  });

  it("한 줄 제목이 부모 칸을 넓히지 않는다 — 제목 칸의 고유 너비를 0으로 두고(contain inline-size) 루트는 min-w-0", () => {
    // 360px 격자 안에서 긴 제목(nowrap)이 칸의 최소 너비를 키워 옆 카드까지 화면 밖으로 밀던 문제의 회귀 방지
    const { container } = render(<PopularArticles items={make(1)} />);
    expect(screen.getByText("많이 본 기사 제목 1").className).toContain("contain-inline-size");
    expect(container.firstElementChild!.className).toContain("min-w-0");
  });

  it("기본 5건까지만 보인다 (기사 사이드바) — 7건을 줘도 5건", () => {
    render(<PopularArticles items={make(7)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText("많이 본 기사 제목 6")).toBeNull();
  });

  it("상한을 20으로 주면 20건까지 (/news/popular) — 25건을 줘도 20건", () => {
    render(<PopularArticles items={make(25)} limit={20} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getByText("많이 본 기사 제목 20")).toBeTruthy();
    expect(screen.queryByText("많이 본 기사 제목 21")).toBeNull();
  });

  it("항목이 상한보다 적으면 있는 만큼만 보인다", () => {
    render(<PopularArticles items={make(2)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("항목이 0건이면 목록 전체를 숨긴다 (빈 상자 0)", () => {
    const { container } = render(<PopularArticles items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("루트 data-ui=popular-articles", () => {
    const { container } = render(<PopularArticles items={make(1)} />);
    expect(container.firstElementChild!.getAttribute("data-ui")).toBe("popular-articles");
  });
});
