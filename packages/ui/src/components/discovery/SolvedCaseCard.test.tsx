// 해결 사례 카드 (PRD-00 8.6, PRD-01A CAT-05) — 상황 → 쟁점 → 결과(결론 배지·근거 칩) → 교훈, 실명·식별 정보 없음, 재구성 고지
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SolvedCaseCard, type SolvedCaseCardProps } from "./SolvedCaseCard";

const CASE: SolvedCaseCardProps = {
  title: "연납한 자동차세, 차를 판 뒤 돌려받은 사례",
  href: "/news/solved-vehicle-tax-refund",
  situation: "1월에 자동차세를 1년치 미리 내고 5월에 차를 팔았습니다.",
  issue: "남은 기간만큼 낸 세금을 돌려받을 수 있는지가 쟁점이었습니다.",
  result: {
    conclusion: "accepted",
    text: "판 날 이후 기간의 세금을 날짜 단위로 계산해 돌려받았습니다.",
    basis: [
      { label: "지방세법 제128조", href: "https://www.law.go.kr/", external: true },
      { label: "조심2026지0085" },
    ],
  },
  lesson: "차를 팔면 구청에 환급 신청서를 내면 됩니다. 연납했다면 판 날짜를 확인해 두세요.",
};

describe("해결 사례 카드", () => {
  it("상황 → 쟁점 → 결과 → 교훈 4칸이 이 순서로 내용과 함께 보인다", () => {
    render(<SolvedCaseCard {...CASE} />);
    // 결과 칸 안의 근거 칩 목록은 빼고 흐름의 칸(바로 아래 li)만 센다
    const steps = Array.from(screen.getByRole("list", { name: "사례 흐름" }).querySelectorAll(":scope > li"));
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.querySelector("[data-step-label]")!.textContent)).toEqual(["상황", "쟁점", "결과", "교훈"]);
    expect(steps[0].textContent).toContain(CASE.situation);
    expect(steps[1].textContent).toContain(CASE.issue);
    expect(steps[2].textContent).toContain(CASE.result.text);
    expect(steps[3].textContent).toContain(CASE.lesson);
  });

  it.each([
    ["accepted", "인용", "bg-emerald-50", "text-emerald-800"],
    ["partial", "일부 인용", "bg-emerald-50", "text-emerald-800"],
    ["rejected", "기각", "bg-rose-50", "text-rose-800"],
    ["dismissed", "각하", "bg-navy-50", "text-navy-700"],
    ["interpretation", "해석", "bg-navy-50", "text-navy-700"],
  ] as const)("결론 %s는 '%s' 글자 배지로 색과 글자를 함께 쓴다", (conclusion, label, bg, fg) => {
    const { container } = render(<SolvedCaseCard {...CASE} result={{ ...CASE.result, conclusion }} />);
    const badge = container.querySelector("[data-conclusion]")!;
    expect(badge.textContent).toBe(label);
    expect(badge.getAttribute("data-conclusion")).toBe(conclusion);
    expect(badge.className).toContain(bg);
    expect(badge.className).toContain(fg);
  });

  it("모르는 결론 값이면 카드를 그리지 않는다 (배지 없는 결과 0)", () => {
    const odd = { ...CASE.result, conclusion: "won" } as unknown as typeof CASE.result;
    expect(render(<SolvedCaseCard {...CASE} result={odd} />).container.innerHTML).toBe("");
  });

  it("결과 칸에 근거 칩이 고정폭으로 있고, 새 창 근거는 rel·'새 창' 안내를 갖는다", () => {
    render(<SolvedCaseCard {...CASE} />);
    const ext = screen.getByRole("link", { name: /지방세법 제128조/ });
    expect(ext.getAttribute("href")).toBe("https://www.law.go.kr/");
    expect(ext.getAttribute("target")).toBe("_blank");
    expect(ext.getAttribute("rel")).toBe("noopener noreferrer");
    expect(ext.textContent).toContain("(새 창)");
    const plain = screen.getByText("조심2026지0085");
    expect(plain.getAttribute("data-ui")).toBe("chip");
    expect(plain.className).toContain("font-mono");
    expect(plain.closest("a")).toBeNull();
  });

  it("재구성 고지가 붙는다", () => {
    render(<SolvedCaseCard {...CASE} />);
    expect(screen.getByText("개인을 알아볼 수 없도록 내용을 바꿔 다시 구성한 사례입니다.")).toBeTruthy();
  });

  it("제목은 상세로 가는 링크이고 근거 링크는 그 위에서 따로 눌린다", () => {
    render(<SolvedCaseCard {...CASE} />);
    const title = screen.getByRole("link", { name: CASE.title });
    expect(title.getAttribute("href")).toBe(CASE.href);
    expect(screen.getByRole("link", { name: /지방세법 제128조/ }).className).toContain("relative");
  });

  it("주소가 없으면 제목은 글자로만 보인다", () => {
    render(<SolvedCaseCard {...CASE} href={undefined} />);
    expect(screen.getByRole("heading", { name: CASE.title })).toBeTruthy();
    expect(screen.queryByRole("link", { name: CASE.title })).toBeNull();
  });

  it.each([["situation"], ["issue"], ["lesson"]] as const)("%s 칸이 비면 카드를 렌더하지 않는다 (4칸 필수)", (key) => {
    const { container } = render(<SolvedCaseCard {...CASE} {...{ [key]: "  " }} />);
    expect(container.innerHTML).toBe("");
  });

  it("결과 글이 비거나 근거가 0개면 카드를 렌더하지 않는다", () => {
    const { container, rerender } = render(<SolvedCaseCard {...CASE} result={{ ...CASE.result, text: "" }} />);
    expect(container.innerHTML).toBe("");
    rerender(<SolvedCaseCard {...CASE} result={{ ...CASE.result, basis: [] }} />);
    expect(container.innerHTML).toBe("");
  });

  it.each([
    ["전화번호", "담당자 010-1234-5678로 연락했습니다."],
    ["주민등록번호", "신청서에 800101-1234567을 적었습니다."],
    ["이메일", "hong@example.com으로 회신을 받았습니다."],
  ])("%s 형식이 들어 있으면 카드를 렌더하지 않는다 (식별 정보 0)", (_kind, text) => {
    const { container } = render(<SolvedCaseCard {...CASE} situation={text} />);
    expect(container.innerHTML).toBe("");
  });

  it("실명·연락처를 받는 칸이 없다 (tsc가 확인)", () => {
    // @ts-expect-error 해결 사례 카드에는 사람 이름 칸이 없다
    const element = <SolvedCaseCard {...CASE} personName="홍길동" />;
    expect(element.props.personName).toBe("홍길동");
  });

  it("루트 article data-ui=solved-case-card", () => {
    const { container } = render(<SolvedCaseCard {...CASE} />);
    expect(container.firstElementChild!.tagName.toLowerCase()).toBe("article");
    expect(container.firstElementChild!.getAttribute("data-ui")).toBe("solved-case-card");
  });
});
