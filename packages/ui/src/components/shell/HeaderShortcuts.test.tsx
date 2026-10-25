// 헤더 바로가기 줄 (HOME-12 · 14, W10-i) - 실제로 렌더해 순서·주소·중복 링크·강조를 확인한다
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HEADER_SHORTCUTS, Header, type HeaderShortcut } from "./Header";

const def = (key: HeaderShortcut["key"]): HeaderShortcut => {
  const d = HEADER_SHORTCUTS.find((s) => s.key === key)!;
  return { key: d.key, label: d.label, href: d.href };
};
const ALL: HeaderShortcut[] = [def("expert_request"), def("brief_weekly"), def("calc"), def("realestate_weekly")];
const pairs = (links: HTMLElement[]) => links.map((a) => [a.textContent, a.getAttribute("href")]);

describe("헤더 바로가기 줄", () => {
  it("shortcuts를 안 주면 바로가기 요소가 0이고 1단계 유틸 메뉴가 그대로다", () => {
    render(<Header utilities={["calc", "experts"]} />);
    expect(screen.queryByRole("navigation", { name: "바로가기" })).toBeNull();
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("href") === "/calc")).toHaveLength(1);
  });

  it("넘긴 순서를 따르되 SM 전문가 상담 요청은 항상 마지막, 최대 4개", () => {
    render(<Header shortcuts={ALL} />);
    const nav = screen.getByRole("navigation", { name: "바로가기" });
    expect(pairs(within(nav).getAllByRole("link"))).toEqual([
      ["이번 주 법령·해석", "/brief"],
      ["부동산 세금 계산기", "/calc"],
      ["이번 주 재테크 포인트", "/realestate/weekly"],
      ["SM 전문가 상담 요청", "/experts/request"],
    ]);
  });

  it("바로가기 계산기가 있으면 유틸 메뉴의 계산기를 빼서 /calc 링크는 헤더 안에 1개", () => {
    render(<Header utilities={["calc", "experts"]} shortcuts={[def("calc")]} />);
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("href") === "/calc")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "전문가 소개" }).getAttribute("href")).toBe("/experts");
  });

  it("바로가기에 계산기가 없으면 유틸 계산기는 그대로", () => {
    render(<Header utilities={["calc"]} shortcuts={[def("expert_request")]} />);
    expect(screen.getByRole("link", { name: "계산기" }).getAttribute("href")).toBe("/calc");
  });

  it("상담 요청만 강조(오렌지) 버튼이고 나머지는 글자 링크다", () => {
    render(<Header shortcuts={ALL} />);
    const cls = (name: string) => screen.getByRole("link", { name }).className;
    expect(cls("SM 전문가 상담 요청")).toContain("bg-hermes-500");
    expect(cls("부동산 세금 계산기")).not.toContain("bg-hermes-500");
  });

  it("모르는 키는 버리고, 글자에 AI 낱말이 없다", () => {
    render(<Header shortcuts={[...ALL, { key: "evil" as never, label: "외부", href: "https://evil.example" }]} />);
    const links = within(screen.getByRole("navigation", { name: "바로가기" })).getAllByRole("link");
    expect(links).toHaveLength(4);
    for (const a of links) expect(a.textContent).not.toMatch(/AI/);
  });

  it("바로가기 주소에 쿼리·해시가 없다", () => {
    render(<Header shortcuts={ALL} />);
    for (const a of within(screen.getByRole("navigation", { name: "바로가기" })).getAllByRole("link")) expect(a.getAttribute("href")).not.toMatch(/[?#]/);
  });

  it("탭 대상은 높이 44px 이상 클래스(min-h-11)를 쓴다", () => {
    render(<Header shortcuts={ALL} />);
    for (const a of within(screen.getByRole("navigation", { name: "바로가기" })).getAllByRole("link")) expect(a.className).toContain("min-h-11");
  });
});
