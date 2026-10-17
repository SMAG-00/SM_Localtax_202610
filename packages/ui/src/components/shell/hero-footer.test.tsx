// 히어로·바닥글 (PRD-00 8.4·8.6 · PRD-01A HOME-01 · HELP-05) — SM 네이비 그라데이션 3곳 중 2곳
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { brand } from "../../brand";
import { Hero } from "./Hero";
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

  it("제목은 h1 — 2.6rem → 640px 이상 3.75rem · 900 · 자간 좁게 · 행간 1.15", () => {
    render(<Hero title="지방세 소식을 쉽게" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "지방세 소식을 쉽게" });
    expect(tokens(h1)).toEqual(
      expect.arrayContaining(["text-[2.6rem]", "sm:text-[3.75rem]", "font-black", "tracking-tight", "leading-[1.15]", "text-white"]),
    );
  });

  it("강조 단어만 hermes-400으로 칠하고 제목 글자는 그대로다", () => {
    render(<Hero title="지방세·부동산 소식을 한곳에서 쉽게" highlight="한곳에서" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("지방세·부동산 소식을 한곳에서 쉽게");
    const marked = h1.querySelectorAll(".text-hermes-400");
    expect([...marked].map((m) => m.textContent)).toEqual(["한곳에서"]);
  });

  it("강조 단어가 두 번 나와도 첫 번째만 칠한다", () => {
    render(<Hero title="세금 알기, 세금 읽기" highlight="세금" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("세금 알기, 세금 읽기");
    expect([...h1.querySelectorAll(".text-hermes-400")].map((m) => m.textContent)).toEqual(["세금"]);
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

  it("아이브로·설명을 주지 않으면 그 요소가 없다", () => {
    const { container } = render(<Hero title="지방세 소식" />);
    expect(container.querySelector('[data-ui="eyebrow"]')).toBeNull();
    expect(container.querySelectorAll("p").length).toBe(0);
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
