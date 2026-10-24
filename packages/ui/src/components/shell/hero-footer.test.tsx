// 히어로·바닥글 (PRD-00 8.4·8.6 · PRD-01A HOME-01 · HELP-05) — SM 네이비 그라데이션 3곳 중 2곳
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { brand } from "../../brand";
import { Hero, highlightRanges } from "./Hero";
import { Footer } from "./Footer";

const tokens = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

describe("히어로", () => {
  it("navy-700→800→900 대각 그라데이션 section이고 안쪽 여백은 py-20 → 640px 이상 py-28", () => {
    const { container } = render(<Hero title="지방세 소식을 쉽게" />);
    const root = container.firstElementChild!;
    expect(root.tagName).toBe("SECTION");
    expect(root.getAttribute("data-ui")).toBe("hero");
    // 그라데이션 클래스 글자는 허용 파일(Hero.tsx)에만 둔다 (R5 린트) — 시험은 정규식으로 같은 토큰을 확인한다
    expect(tokens(root)).toContainEqual(expect.stringMatching(/^bg-gradient-to-br$/));
    expect(tokens(root)).toEqual(expect.arrayContaining(["from-navy-700", "via-navy-800", "to-navy-900", "overflow-hidden"]));
    const inner = root.querySelector(".max-w-5xl")!;
    expect(tokens(inner)).toEqual(expect.arrayContaining(["py-20", "sm:py-28", "px-4"]));
  });

  it("오렌지 빛번짐은 화면 읽기에서 숨긴 hermes-500/20 blur-3xl 원이다 (장식)", () => {
    const { container } = render(<Hero title="지방세 소식을 쉽게" />);
    const glow = container.querySelector(".bg-hermes-500\\/20")!;
    expect(glow).not.toBeNull();
    expect(tokens(glow)).toEqual(expect.arrayContaining(["blur-3xl", "rounded-full", "pointer-events-none"]));
    expect(glow.getAttribute("aria-hidden")).toBe("true");
    expect(glow.textContent).toBe("");
  });

  it("제목은 h1 — 2rem → 640px 이상 2.75rem → 1024px 이상 3.75rem · 900 · 자간 좁게 · 낱말 단위 줄바꿈", () => {
    render(<Hero title="지방세 소식을 쉽게" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "지방세 소식을 쉽게" });
    expect(tokens(h1)).toEqual(
      expect.arrayContaining(["text-[2rem]", "sm:text-[2.75rem]", "lg:text-[3.75rem]", "font-black", "tracking-tight", "leading-[1.2]", "sm:leading-[1.15]", "text-white", "[word-break:keep-all]"]),
    );
  });

  it("강조 단어만 hermes-400으로 칠하고 제목 글자는 그대로다", () => {
    render(<Hero title="지방세·부동산 소식을 한곳에서 쉽게" highlight="한곳에서" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("지방세·부동산 소식을 한곳에서 쉽게");
    const marked = h1.querySelectorAll(".text-hermes-400");
    expect([...marked].map((m) => m.textContent)).toEqual(["한곳에서"]);
  });

  it("강조 단어가 두 번 나오면 나온 곳을 모두 칠한다", () => {
    render(<Hero title="세금 알기, 세금 읽기" highlight="세금" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("세금 알기, 세금 읽기");
    expect([...h1.querySelectorAll(".text-hermes-400")].map((m) => m.textContent)).toEqual(["세금", "세금"]);
  });

  it("강조 낱말을 여러 개 주면 낱말마다 칠하고 제목 글자는 그대로다 (홈 핵심 메시지 3곳)", () => {
    const message = "취득·보유·상속·증여·양도 등 모든 순간 — 지방세와 부동산 세금을 알면 재테크가 보입니다";
    render(<Hero title={message} highlight={["지방세", "부동산 세금", "재테크"]} />);
    const h1 = screen.getByRole("heading", { level: 1, name: (name) => name.replace(/\s/g, "") === message.replace(/\s/g, "") });
    expect(h1.textContent).toBe(message);
    expect([...h1.querySelectorAll(".text-hermes-400")].map((m) => m.textContent)).toEqual(["지방세", "부동산 세금", "재테크"]);
  });

  it("줄표(—)가 있으면 앞뒤 덩어리로 나눠 앞 덩어리는 약 60% 크기 윗줄, 뒤 덩어리는 제목 크기 아랫줄, 줄표는 보이지 않고 글자 내용은 원문과 같다", () => {
    render(<Hero title="취득·보유 등 모든 순간 — 지방세를 알면 재테크가 보입니다" highlight={["지방세", "재테크"]} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("취득·보유 등 모든 순간 — 지방세를 알면 재테크가 보입니다");
    const [first, dash, second] = [...h1.children];
    expect(first!.textContent).toBe("취득·보유 등 모든 순간");
    // 제목 크기(2rem · 2.75rem · 3.75rem)의 60% 안팎 = 1.2rem · 1.65rem · 2.25rem
    expect(tokens(first!)).toEqual(expect.arrayContaining(["block", "text-[1.2rem]", "sm:text-[1.65rem]", "lg:text-[2.25rem]"]));
    expect(dash!.textContent).toBe(" — ");
    expect(tokens(dash!)).toContain("hidden");
    expect(tokens(dash!)).not.toContain("sm:inline");
    expect(second!.textContent).toBe("지방세를 알면 재테크가 보입니다");
    expect(tokens(second!)).toContain("block");
    expect(tokens(second!).some((t) => t.includes("text-["))).toBe(false); // 뒤 덩어리는 제목 크기를 그대로 받는다
    expect(h1.querySelectorAll("h1, h2, h3").length).toBe(0); // 제목 요소는 하나
    expect([...second!.querySelectorAll(".text-hermes-400")].map((m) => m.textContent)).toEqual(["지방세", "재테크"]);
  });

  it("줄표가 없는 제목은 덩어리를 나누지 않는다", () => {
    render(<Hero title="지방세 소식을 쉽게" highlight="지방세" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.querySelector(".hidden")).toBeNull();
    expect(h1.querySelector(".block")).toBeNull();
  });

  it("강조 단어가 제목에 없거나 빈 글자면 칠하지 않는다", () => {
    const { rerender } = render(<Hero title="지방세 소식" highlight="부동산" />);
    expect(screen.getByRole("heading", { level: 1 }).querySelectorAll(".text-hermes-400").length).toBe(0);
    rerender(<Hero title="지방세 소식" highlight="" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.querySelectorAll(".text-hermes-400").length).toBe(0);
    expect(h1.textContent).toBe("지방세 소식");
  });

  it("아이브로는 어두운 바탕 톤(hermes-400)이고, 설명과 아래 자리(큰 입력창 등)를 렌더한다", () => {
    render(
      <Hero eyebrow="LOCAL TAX NEWS" title="지방세 소식" description="개정 소식과 해설을 쉬운 말로 전합니다.">
        <p>입력창 자리</p>
      </Hero>,
    );
    const eyebrow = screen.getByText("LOCAL TAX NEWS").closest('[data-ui="eyebrow"]')!;
    expect(tokens(eyebrow)).toContain("text-hermes-400");
    expect(tokens(screen.getByText("개정 소식과 해설을 쉬운 말로 전합니다."))).toContain("text-navy-100");
    expect(screen.getByText("입력창 자리")).toBeTruthy();
  });

  it("제목(핵심 메시지)이 없거나 공백뿐이면 제목 요소가 없고 아래 자리만 그린다 — 페이지 제목은 쓰는 쪽이 둔다", () => {
    const { rerender } = render(
      <Hero eyebrow="LOCAL TAX">
        <p>입력창 자리</p>
      </Hero>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("입력창 자리")).toBeTruthy();
    rerender(<Hero title="   " />);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("아이브로·설명을 주지 않으면 그 요소가 없다", () => {
    const { container } = render(<Hero title="지방세 소식" />);
    expect(container.querySelector('[data-ui="eyebrow"]')).toBeNull();
    expect(container.querySelectorAll("p").length).toBe(0);
  });
});

describe("강조 낱말 위치 계산 (highlightRanges)", () => {
  it("긴 낱말을 먼저 잡고 겹치는 곳은 칠하지 않는다 — '부동산 세금'과 '세금'을 함께 주면 '부동산 세금'만", () => {
    expect(highlightRanges("부동산 세금과 취득 세금", ["세금", "부동산 세금"])).toEqual([
      { text: "부동산 세금", marked: true },
      { text: "과 취득 ", marked: false },
      { text: "세금", marked: true },
    ]);
  });

  it("글자 하나(옛 호출)도 그대로 받고, 빈 글자·공백·제목에 없는 낱말은 무시한다", () => {
    expect(highlightRanges("지방세 안내", "지방세")).toEqual([
      { text: "지방세", marked: true },
      { text: " 안내", marked: false },
    ]);
    expect(highlightRanges("지방세 안내", ["", "  ", "양도"])).toEqual([{ text: "지방세 안내", marked: false }]);
    expect(highlightRanges("지방세 안내", undefined)).toEqual([{ text: "지방세 안내", marked: false }]);
  });

  it("같은 낱말을 두 번 줘도 한 번만 센다", () => {
    expect(highlightRanges("재테크 재테크", ["재테크", "재테크"]).filter((p) => p.marked).length).toBe(2);
  });
});

describe("바닥글", () => {
  const links = [
    { label: "회사 소개", href: "/about" },
    { label: "편집 원칙", href: "/about/editorial-policy" },
    { label: "개인정보처리방침", href: "/about/privacy", emphasis: true },
  ];

  it("navy-800→900 세로 그라데이션 footer + 오렌지 짧은 선(장식) + 면책 14px navy-200", () => {
    const { container } = render(<Footer disclaimer="이 사이트의 해설은 참고용이며 세무 자문이 아닙니다." links={links} />);
    const root = container.firstElementChild!;
    expect(root.tagName).toBe("FOOTER");
    expect(root.getAttribute("data-ui")).toBe("footer");
    expect(tokens(root)).toContainEqual(expect.stringMatching(/^bg-gradient-to-b$/));
    expect(tokens(root)).toEqual(expect.arrayContaining(["from-navy-800", "to-navy-900"]));
    const line = root.querySelector(".bg-hermes-500")!;
    expect(tokens(line)).toEqual(expect.arrayContaining(["h-px", "w-12"]));
    expect(line.getAttribute("aria-hidden")).toBe("true");
    expect(tokens(screen.getByText("이 사이트의 해설은 참고용이며 세무 자문이 아닙니다."))).toEqual(expect.arrayContaining(["text-[14px]", "text-navy-200"]));
  });

  it("정책 링크는 넘겨준 순서 그대로 바닥글 메뉴에 두고, 터치 영역 44px 이상", () => {
    render(<Footer disclaimer="면책" links={links} />);
    const nav = screen.getByRole("navigation", { name: "바닥글 메뉴" });
    const items = within(nav).getAllByRole("link");
    expect(items.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["회사 소개", "/about"],
      ["편집 원칙", "/about/editorial-policy"],
      ["개인정보처리방침", "/about/privacy"],
    ]);
    items.forEach((a) => expect(tokens(a)).toContain("min-h-11"));
  });

  it("강조 링크(개인정보처리방침)만 굵게 구분한다", () => {
    render(<Footer disclaimer="면책" links={links} />);
    expect(tokens(screen.getByRole("link", { name: "개인정보처리방침" }))).toContain("font-bold");
    expect(tokens(screen.getByRole("link", { name: "회사 소개" }))).not.toContain("font-bold");
  });

  it("링크가 0개면 바닥글 메뉴 요소가 없다", () => {
    render(<Footer disclaimer="면책" links={[]} />);
    expect(screen.queryByRole("navigation", { name: "바닥글 메뉴" })).toBeNull();
  });

  it("매체 정보는 값이 있는 줄만 보이고, 빈 값·공백·null 줄은 숨긴다", () => {
    render(
      <Footer
        disclaimer="면책"
        links={links}
        info={[
          { label: "대표전화", value: "02-000-0000" },
          { label: "주소", value: "  " },
          { label: "발행인", value: null },
          { label: "등록번호", value: "" },
        ]}
      />,
    );
    const terms = [...document.querySelectorAll("dt")].map((d) => d.textContent);
    expect(terms).toEqual(["대표전화"]);
    expect(screen.getByText("02-000-0000").tagName).toBe("DD");
  });

  it("보일 매체 정보가 하나도 없으면 목록 요소가 없다", () => {
    const { container } = render(<Footer disclaimer="면책" links={links} info={[{ label: "주소", value: "" }]} />);
    expect(container.querySelector("dl")).toBeNull();
  });

  it("제품명은 brand 설정에서 온다 (DS-03)", () => {
    render(<Footer disclaimer="면책" links={links} />);
    expect(screen.getByText(brand.productName)).toBeTruthy();
  });
});

describe("히어로 제목 수준 (접근성 heading-order)", () => {
  it("기본은 페이지 제목 h1", () => {
    render(<Hero title="지방세 소식을 쉽게" />);
    expect(screen.getByRole("heading", { level: 1, name: "지방세 소식을 쉽게" })).toBeTruthy();
  });

  it("다른 제목 아래에 둘 때는 수준을 지정할 수 있다 (h2·h3)", () => {
    const { rerender } = render(<Hero title="지방세 소식을 쉽게" titleLevel={2} />);
    expect(screen.getByRole("heading", { level: 2, name: "지방세 소식을 쉽게" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    rerender(<Hero title="지방세 소식을 쉽게" titleLevel={3} />);
    expect(screen.getByRole("heading", { level: 3, name: "지방세 소식을 쉽게" })).toBeTruthy();
  });
});
