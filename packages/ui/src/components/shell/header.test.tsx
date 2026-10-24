// 헤더 (PRD-00 8.6 · PRD-01A HOME-02 · HELP-05) — 실제로 렌더하고 클릭·키보드로 확인한다
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { brand } from "../../brand";
import { LinkProvider, type UiLinkProps } from "../link";
import { Header } from "./Header";

const tokens = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);
const pairs = (links: HTMLElement[]) => links.map((a) => [a.textContent, a.getAttribute("href")]);

describe("헤더 — 워드마크", () => {
  it("bg-navy-800 머리에 brand 워드마크를 홈 링크로 두고, 가운뎃점 없이 띄어쓰기로 잇는다", () => {
    const { container } = render(<Header />);
    const root = container.firstElementChild!;
    expect(root.tagName).toBe("HEADER");
    expect(root.getAttribute("data-ui")).toBe("header");
    expect(tokens(root)).toContain("bg-navy-800");

    const home = screen.getByRole("link", { name: `${brand.wordmark.lead} ${brand.wordmark.tail}` });
    expect(home.getAttribute("href")).toBe("/");
    expect(home.textContent).toBe(`${brand.wordmark.lead} ${brand.wordmark.tail}`);
    expect(home.textContent).toBe(brand.productName);
    expect(home.textContent).not.toContain("·");
    expect(tokens(home)).toEqual(expect.arrayContaining(["text-[17px]", "font-extrabold", "text-white"]));
    expect(within(home).queryByText("·")).toBeNull();
    expect(tokens(home)).not.toContain("text-hermes-500");
  });
});

describe("헤더 — 상단 메뉴 (4대 분야)", () => {
  it("상단 메뉴는 정확히 4개 — 지방세·부동산세금·부동산재테크·부동산금융·지자체뉴스 순서와 경로", () => {
    render(<Header />);
    const nav = screen.getByRole("navigation", { name: "분야 메뉴" });
    expect(pairs(within(nav).getAllByRole("link"))).toEqual([
      ["지방세·부동산세금", "/tax"],
      ["부동산재테크", "/realestate"],
      ["부동산금융", "/finance"],
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
    expect(document.activeElement?.textContent).toBe("지방세·부동산세금");
    await userEvent.keyboard("{Escape}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("펼친 메뉴의 항목을 누르면 메뉴가 닫힌다 — 화면 전환(새로고침 없음)에서는 헤더가 그대로 남기 때문", async () => {
    // 앱 링크 자리 — 화면 전환처럼 문서 이동을 하지 않는다
    const NoReload = (props: UiLinkProps) => (
      <a
        {...props}
        onClick={(e) => {
          e.preventDefault();
          props.onClick?.(e);
        }}
      />
    );
    render(
      <LinkProvider component={NoReload}>
        <Header utilities={["search"]} />
      </LinkProvider>,
    );
    const button = screen.getByRole("button", { name: "메뉴" });
    for (const name of ["부동산재테크", "검색"]) {
      await userEvent.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      await userEvent.click(screen.getByRole("link", { name }));
      expect(button.getAttribute("aria-expanded")).toBe("false");
    }
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

describe("헤더 — 분야별 하위 메뉴 (HOME-02 '하위 메뉴는 분야 데이터에서, 공통 뉴스 전체')", () => {
  const SUB = {
    tax: [
      { key: "tax:interpretations", label: "해석", href: "/tax/interpretations" },
      { key: "tax:news", label: "뉴스 전체", href: "/news?section=tax" },
    ],
    local: [{ key: "local:news", label: "뉴스 전체", href: "/news?section=local" }],
  } as const;
  const topLinks = () => [...document.querySelectorAll('nav[aria-label="분야 메뉴"] [data-part="section-link"]')].map((a) => a.textContent);

  it("하위 메뉴를 줘도 상단 메뉴는 정확히 4개 — 펼침 단추는 하위 메뉴가 있는 분야에만", () => {
    render(<Header submenus={SUB} />);
    expect(topLinks()).toEqual(["지방세·부동산세금", "부동산재테크", "부동산금융", "지자체뉴스"]);
    expect(screen.getAllByRole("button", { name: /하위 메뉴$/ }).map((b) => b.textContent)).toEqual(["지방세·부동산세금 하위 메뉴", "지자체뉴스 하위 메뉴"]);
    // 닫힌 하위 메뉴는 hidden — 화면 읽기·탭 이동에도 없다
    expect(screen.queryByRole("link", { name: "해석" })).toBeNull();
    expect(document.querySelectorAll('[data-part="sub-link"]')).toHaveLength(3);
  });

  it("펼침 단추로 열고 닫는다 — 링크는 그대로 허브로 가고, 한 번에 하나만 열린다", async () => {
    render(<Header submenus={SUB} />);
    const tax = screen.getByRole("button", { name: "지방세·부동산세금 하위 메뉴" });
    const local = screen.getByRole("button", { name: "지자체뉴스 하위 메뉴" });
    expect(tax.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(tax);
    expect(tax.getAttribute("aria-expanded")).toBe("true");
    const list = document.getElementById(tax.getAttribute("aria-controls") ?? "")!;
    expect(pairs(within(list).getAllByRole("link"))).toEqual([
      ["해석", "/tax/interpretations"],
      ["뉴스 전체", "/news?section=tax"],
    ]);
    expect(screen.getByRole("link", { name: "지방세·부동산세금" }).getAttribute("href")).toBe("/tax");
    await userEvent.click(local);
    expect(tax.getAttribute("aria-expanded")).toBe("false");
    expect(local.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(local);
    expect(local.getAttribute("aria-expanded")).toBe("false");
  });

  it("Esc는 하위 메뉴를 먼저 닫고 포커스를 그 펼침 단추로 돌린다 — 펼친 모바일 메뉴는 그대로", async () => {
    render(<Header submenus={SUB} />);
    const menu = screen.getByRole("button", { name: "메뉴" });
    await userEvent.click(menu);
    const tax = screen.getByRole("button", { name: "지방세·부동산세금 하위 메뉴" });
    await userEvent.click(tax);
    screen.getByRole("link", { name: "해석" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(tax.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(tax);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{Escape}");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menu);
  });

  it("하위 메뉴 항목을 누르면 하위 메뉴와 펼친 메뉴가 함께 닫힌다 (화면 전환)", async () => {
    const NoReload = (props: UiLinkProps) => (
      <a
        {...props}
        onClick={(e) => {
          e.preventDefault();
          props.onClick?.(e);
        }}
      />
    );
    render(
      <LinkProvider component={NoReload}>
        <Header submenus={SUB} />
      </LinkProvider>,
    );
    const menu = screen.getByRole("button", { name: "메뉴" });
    await userEvent.click(menu);
    const tax = screen.getByRole("button", { name: "지방세·부동산세금 하위 메뉴" });
    await userEvent.click(tax);
    await userEvent.click(screen.getByRole("link", { name: "해석" }));
    expect(tax.getAttribute("aria-expanded")).toBe("false");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });

  it("메뉴 바깥을 누르거나 키보드 포커스가 그 분야 밖으로 나가면 하위 메뉴가 닫힌다", async () => {
    render(
      <>
        <Header submenus={SUB} />
        <button type="button">바깥</button>
      </>,
    );
    const tax = screen.getByRole("button", { name: "지방세·부동산세금 하위 메뉴" });
    await userEvent.click(tax);
    await userEvent.click(screen.getByRole("button", { name: "바깥" }));
    expect(tax.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(tax);
    screen.getByRole("link", { name: "뉴스 전체" }).focus();
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("부동산재테크");
    expect(tax.getAttribute("aria-expanded")).toBe("false");
  });

  it("펼침 단추·하위 메뉴 항목의 터치 영역 44px(min-h-11) 이상", async () => {
    render(<Header submenus={SUB} />);
    const tax = screen.getByRole("button", { name: "지방세·부동산세금 하위 메뉴" });
    expect(tokens(tax)).toEqual(expect.arrayContaining(["min-h-11", "min-w-11"]));
    await userEvent.click(tax);
    for (const a of within(document.getElementById(tax.getAttribute("aria-controls")!)!).getAllByRole("link")) expect(tokens(a)).toContain("min-h-11");
  });
});
