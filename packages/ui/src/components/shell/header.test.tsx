// 헤더 (PRD-00 8.6 · PRD-01A HOME-02 · HELP-05) — 실제로 렌더하고 클릭·키보드로 확인한다
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { brand } from "../../brand";
import { Header } from "./Header";

const tokens = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);
const pairs = (links: HTMLElement[]) => links.map((a) => [a.textContent, a.getAttribute("href")]);

describe("헤더 — 워드마크", () => {
  it("bg-navy-800 머리에 brand 워드마크를 홈 링크로 두고, 가운뎃점만 hermes-500이다", () => {
    const { container } = render(<Header />);
    const root = container.firstElementChild!;
    expect(root.tagName).toBe("HEADER");
    expect(root.getAttribute("data-ui")).toBe("header");
    expect(tokens(root)).toContain("bg-navy-800");

    const home = screen.getByRole("link", { name: `${brand.wordmark.lead} · ${brand.wordmark.tail}` });
    expect(home.getAttribute("href")).toBe("/");
    expect(home.textContent).toBe("SM(선명) · 지방세");
    expect(tokens(home)).toEqual(expect.arrayContaining(["text-[17px]", "font-extrabold", "text-white"]));
    const dot = within(home).getByText("·");
    expect(tokens(dot)).toContain("text-hermes-500");
    expect(tokens(home)).not.toContain("text-hermes-500");
  });
});

describe("헤더 — 상단 메뉴 (4대 분야)", () => {
  it("상단 메뉴는 정확히 4개 — 지방세·부동산·부동산개발금융·지자체뉴스 순서와 경로", () => {
    render(<Header />);
    const nav = screen.getByRole("navigation", { name: "분야 메뉴" });
    expect(pairs(within(nav).getAllByRole("link"))).toEqual([
      ["지방세", "/tax"],
      ["부동산", "/realestate"],
      ["부동산개발금융", "/finance"],
      ["지자체뉴스", "/local"],
    ]);
  });

  it("메뉴 링크는 데스크톱 14px 600 navy-100이고 터치 영역 44px(min-h-11) 이상", () => {
    render(<Header utilities={["calc"]} />);
    for (const a of screen.getAllByRole("link").filter((l) => l.getAttribute("href") !== "/")) {
      expect(tokens(a)).toEqual(expect.arrayContaining(["lg:text-[14px]", "font-semibold", "text-navy-100", "min-h-11"]));
    }
  });

  it("지금 보고 있는 분야 하나에만 aria-current=page", () => {
    render(<Header currentSection="local" />);
    const nav = screen.getByRole("navigation", { name: "분야 메뉴" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["지자체뉴스"]);
  });

  it("현재 분야를 주지 않으면 aria-current 0", () => {
    render(<Header />);
    expect(document.querySelectorAll('[aria-current="page"]').length).toBe(0);
  });
});

describe("헤더 — 유틸 메뉴 자리", () => {
  it("넘겨준 공개 항목만 HOME-02 순서(계산기·전문가 소개·구독·도서·교육·검색)로 다시 세운다", () => {
    render(<Header utilities={["search", "calc", "edu"]} />);
    const nav = screen.getByRole("navigation", { name: "유틸 메뉴" });
    expect(pairs(within(nav).getAllByRole("link"))).toEqual([
      ["계산기", "/calc"],
      ["교육", "/edu"],
      ["검색", "/search"],
    ]);
  });

  it("다섯 항목을 모두 켜면 최대 5개가 정해진 순서로, 같은 항목을 두 번 넘겨도 한 번만", () => {
    render(<Header utilities={["store", "search", "experts", "store", "edu", "calc"]} />);
    const nav = screen.getByRole("navigation", { name: "유틸 메뉴" });
    expect(pairs(within(nav).getAllByRole("link"))).toEqual([
      ["계산기", "/calc"],
      ["전문가 소개", "/experts"],
      ["구독·도서", "/store"],
      ["교육", "/edu"],
      ["검색", "/search"],
    ]);
  });

  it("공개된 유틸 항목이 없으면 유틸 메뉴 요소 자체가 없다 (빈 링크 0)", () => {
    render(<Header utilities={[]} />);
    expect(screen.queryByRole("navigation", { name: "유틸 메뉴" })).toBeNull();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/", "/tax", "/realestate", "/finance", "/local"]);
  });
});

describe("헤더 — 작은 로그인 버튼", () => {
  it("rounded-lg hermes-500 면 + navy-900 굵은 글자이고, 주 버튼 표식이 없다 (R2 계수 제외)", () => {
    render(<Header account={{ label: "로그인", href: "/login" }} />);
    const login = screen.getByRole("link", { name: "로그인" });
    expect(login.getAttribute("href")).toBe("/login");
    expect(tokens(login)).toEqual(expect.arrayContaining(["rounded-lg", "bg-hermes-500", "text-navy-900", "font-bold", "min-h-11"]));
    expect(tokens(login)).not.toContain("text-white");
    expect(document.querySelectorAll('[data-ui="primary-button"]').length).toBe(0);
  });

  it("계정 버튼을 주지 않으면 렌더하지 않는다", () => {
    render(<Header />);
    expect(screen.queryByRole("link", { name: "로그인" })).toBeNull();
  });
});

describe("헤더 — 360px 메뉴 열기 버튼 (공개·닫기)", () => {
  it("버튼은 aria-expanded·aria-controls로 메뉴 패널을 가리키고, 누르면 열리고 다시 누르면 닫힌다", async () => {
    render(<Header utilities={["calc"]} />);
    const button = screen.getByRole("button", { name: "메뉴" });
    expect(tokens(button)).toEqual(expect.arrayContaining(["min-h-11", "min-w-11", "lg:hidden"]));
    expect(button.getAttribute("aria-expanded")).toBe("false");

    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "")!;
    expect(panel).not.toBeNull();
    expect(within(panel).getByRole("navigation", { name: "분야 메뉴" })).toBeTruthy();
    expect(within(panel).getByRole("navigation", { name: "유틸 메뉴" })).toBeTruthy();
    expect(tokens(panel)).toContain("hidden");
    expect(tokens(panel)).toContain("lg:flex");

    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(tokens(panel)).not.toContain("hidden");

    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(tokens(panel)).toContain("hidden");
  });

  it("키보드 — Enter로 열고 Tab으로 첫 분야에 가며, Esc로 닫으면 포커스가 메뉴 버튼으로 돌아온다", async () => {
    render(<Header />);
    const button = screen.getByRole("button", { name: "메뉴" });
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("지방세");
    await userEvent.keyboard("{Escape}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("닫힌 상태에서 Esc는 아무것도 바꾸지 않는다", async () => {
    render(<Header />);
    const button = screen.getByRole("button", { name: "메뉴" });
    button.focus();
    await userEvent.keyboard("{Escape}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });
});
