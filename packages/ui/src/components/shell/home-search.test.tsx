// 홈 큰 입력창 (PRD-00 8.6 · PRD-01A HOME-01) — /search GET 제출, 빈 입력 막기, 추천 검색어 칩
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeSearch } from "./HomeSearch";

const tokens = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

// 폼 제출을 창(window)에서 받아 본다 — React 처리(루트)가 끝난 뒤 실행되므로 막혔는지와 보낸 값을 그대로 읽는다.
// jsdom은 페이지 이동을 하지 않으므로 기록한 뒤 이동만 멈춘다.
let submits: Array<{ prevented: boolean; q: FormDataEntryValue | null; action: string; method: string }> = [];
const onSubmit = (e: Event) => {
  const form = e.target as HTMLFormElement;
  submits.push({ prevented: e.defaultPrevented, q: new FormData(form).get("q"), action: form.getAttribute("action") ?? "", method: form.method });
  e.preventDefault();
};
beforeEach(() => {
  submits = [];
  window.addEventListener("submit", onSubmit);
});
afterEach(() => window.removeEventListener("submit", onSubmit));

describe("홈 큰 입력창 — 형태", () => {
  it("검색 영역(role=search) 폼이 /search에 GET으로, 입력 이름 q로 제출한다", () => {
    const { container } = render(<HomeSearch label="무엇이 궁금하세요?" />);
    const form = container.firstElementChild as HTMLFormElement;
    expect(form.tagName).toBe("FORM");
    expect(form.getAttribute("data-ui")).toBe("home-search");
    expect(screen.getByRole("search")).toBe(form);
    expect(form.getAttribute("action")).toBe("/search");
    expect(form.method).toBe("get");
    expect(screen.getByRole("searchbox", { name: "무엇이 궁금하세요?" }).getAttribute("name")).toBe("q");
  });

  it("흰 입력창 rounded-2xl, 높이 64px 이상(min-h-16), 17px 글자, 포커스 오렌지 2px", () => {
    render(<HomeSearch label="검색어" placeholder="예: 취득세 신고 기한" />);
    const input = screen.getByRole("searchbox", { name: "검색어" });
    expect(tokens(input)).toEqual(expect.arrayContaining(["rounded-2xl", "bg-white", "min-h-16", "text-[17px]", "text-navy-900", "focus:outline-2", "focus:outline-hermes-500"]));
    expect(input.getAttribute("placeholder")).toBe("예: 취득세 신고 기한");
  });

  it("라벨은 자리표시 글자와 따로 화면에 보인다 (자리표시로 라벨을 대신하지 않는다)", () => {
    render(<HomeSearch label="검색어" placeholder="예: 취득세" />);
    const label = screen.getByText("검색어");
    expect(label.tagName).toBe("LABEL");
    expect(tokens(label)).not.toContain("sr-only");
  });

  it("주 버튼은 [검색하기] 하나이고 제출 버튼이다 (R2)", () => {
    render(<HomeSearch label="검색어" suggestions={["재산세", "취득세", "자동차세"]} />);
    const primaries = document.querySelectorAll('[data-ui="primary-button"]');
    expect(primaries.length).toBe(1);
    const button = screen.getByRole("button", { name: "검색하기" });
    expect(button).toBe(primaries[0]);
    expect(button.getAttribute("type")).toBe("submit");
  });
});

describe("홈 큰 입력창 — 제출", () => {
  it("검색어를 넣고 엔터를 치면 막지 않고 앞뒤 공백을 뗀 q로 제출한다", async () => {
    render(<HomeSearch label="검색어" />);
    await userEvent.type(screen.getByRole("searchbox"), "  취득세 신고 기한  {Enter}");
    expect(submits).toEqual([{ prevented: false, q: "취득세 신고 기한", action: "/search", method: "get" }]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("[검색하기]를 눌러도 같은 방식으로 제출한다", async () => {
    render(<HomeSearch label="검색어" />);
    await userEvent.type(screen.getByRole("searchbox"), "재산세");
    await userEvent.click(screen.getByRole("button", { name: "검색하기" }));
    expect(submits).toEqual([{ prevented: false, q: "재산세", action: "/search", method: "get" }]);
  });

  it("빈 입력은 막고 안내 문구를 입력창과 연결해 보이며 포커스를 입력창에 둔다", async () => {
    render(<HomeSearch label="검색어" />);
    await userEvent.click(screen.getByRole("button", { name: "검색하기" }));
    expect(submits.map((s) => s.prevented)).toEqual([true]);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("검색어를 입력해 주세요.");
    expect(tokens(alert)).toEqual(expect.arrayContaining(["text-[14px]", "text-rose-700", "bg-white"]));
    const input = screen.getByRole("searchbox");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
  });

  it("공백만 넣고 엔터를 쳐도 막는다", async () => {
    render(<HomeSearch label="검색어" />);
    await userEvent.type(screen.getByRole("searchbox"), "   {Enter}");
    expect(submits.map((s) => s.prevented)).toEqual([true]);
    expect(screen.getByRole("alert").textContent).toBe("검색어를 입력해 주세요.");
  });

  it("안내 문구가 뜬 뒤 다시 입력하면 문구와 오류 표시가 사라진다", async () => {
    render(<HomeSearch label="검색어" />);
    await userEvent.click(screen.getByRole("button", { name: "검색하기" }));
    await userEvent.type(screen.getByRole("searchbox"), "재");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("searchbox").hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("홈 큰 입력창 — 추천 검색어 칩", () => {
  it("칩은 /search?q=검색어 링크이고 칩 문법, 터치 영역 44px 이상", () => {
    render(<HomeSearch label="검색어" suggestions={["취득세 신고 기한", "재산세 고지서", "재건축 취득세"]} />);
    const list = screen.getByRole("list", { name: "추천 검색어" });
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["취득세 신고 기한", "재산세 고지서", "재건축 취득세"]);
    links.forEach((a) => {
      const url = new URL(a.getAttribute("href")!, "https://example.org");
      expect(url.pathname).toBe("/search");
      expect(url.searchParams.get("q")).toBe(a.textContent);
      expect(tokens(a)).toContain("min-h-11");
      expect(a.querySelector('[data-ui="chip"]')).not.toBeNull();
    });
  });

  it("7개를 넘겨도 6개까지만 보인다", () => {
    render(<HomeSearch label="검색어" suggestions={["가", "나", "다", "라", "마", "바", "사"]} />);
    expect(within(screen.getByRole("list", { name: "추천 검색어" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["가", "나", "다", "라", "마", "바"]);
  });

  it("빈 글자 추천어는 빼고, 남은 것이 0개면 칩 줄을 숨긴다", () => {
    const { rerender } = render(<HomeSearch label="검색어" suggestions={["  ", "재산세", ""]} />);
    expect(within(screen.getByRole("list", { name: "추천 검색어" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["재산세"]);
    rerender(<HomeSearch label="검색어" suggestions={[" ", ""]} />);
    expect(screen.queryByRole("list", { name: "추천 검색어" })).toBeNull();
    rerender(<HomeSearch label="검색어" />);
    expect(screen.queryByRole("list", { name: "추천 검색어" })).toBeNull();
  });
});
