// 다음 행동 띠 (PRD-00 8.6, PRD-01A ART-06) — 비슷한 사례 3건 + 버튼 2개 이하, 열린 기능만, 어두운 버튼, 주 버튼 0, '준비 중' 0
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextActionBand, type NextActionItem, type SimilarCaseItem } from "./NextActionBand";

const cases = (n: number): SimilarCaseItem[] =>
  Array.from({ length: n }, (_, i) => ({ href: `/news/case-${i + 1}`, title: `비슷한 사례 ${i + 1}`, kind: i % 2 === 0 ? "해결 사례" : "상담 사례" }));

const SITUATION: NextActionItem = { key: "situation", label: "이 상황 모아 보기", href: "/situations/car-sold", enabled: true };
const SAME_FIELD: NextActionItem = { key: "same-field", label: "같은 분야 더 보기", href: "/tax", enabled: true };
const SM_CALC: NextActionItem = { key: "sm-calculator", label: "SM 계산기로 계산하기", href: "https://sm-tax-platform-six.vercel.app/calc", enabled: true, external: true };
const SELF_CALC: NextActionItem = { key: "self-calculator", label: "계산해 보기", href: "/calc/acquisition", enabled: false };
const BOT: NextActionItem = { key: "tax-bot", label: "지방세봇에게 묻기", href: "#assistant", enabled: false };

describe("다음 행동 띠", () => {
  it("비슷한 사례는 3건까지만 보인다 — 5건을 줘도 3건", () => {
    render(<NextActionBand similarCases={cases(5)} actions={[SITUATION]} />);
    const list = screen.getByRole("list", { name: "비슷한 사례" });
    expect(within(list).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "해결 사례비슷한 사례 1",
      "상담 사례비슷한 사례 2",
      "해결 사례비슷한 사례 3",
    ]);
  });

  it("비슷한 사례가 3건보다 적으면 있는 만큼, 0건이면 '비슷한 사례' 줄을 숨긴다", () => {
    const { rerender } = render(<NextActionBand similarCases={cases(2)} actions={[SITUATION]} />);
    expect(within(screen.getByRole("list", { name: "비슷한 사례" })).getAllByRole("link")).toHaveLength(2);
    rerender(<NextActionBand similarCases={[]} actions={[SITUATION]} />);
    expect(screen.queryByRole("list", { name: "비슷한 사례" })).toBeNull();
    expect(screen.queryByText("비슷한 사례")).toBeNull();
    expect(screen.getByRole("link", { name: "이 상황 모아 보기" })).toBeTruthy();
  });

  it("버튼은 우선순위 순서로 앞의 2개까지만 — 후보 3개면 셋째는 없다", () => {
    render(<NextActionBand similarCases={cases(1)} actions={[SITUATION, SAME_FIELD, SM_CALC]} />);
    const buttons = Array.from(document.querySelectorAll('[data-ui="dark-button"]'));
    expect(buttons.map((b) => b.textContent)).toEqual(["이 상황 모아 보기", "같은 분야 더 보기"]);
    expect(screen.queryByText("SM 계산기로 계산하기")).toBeNull();
  });

  it("열리지 않은 기능은 자리를 차지하지 않고 렌더되지 않는다 — 앞의 닫힌 후보를 건너뛴다", () => {
    render(<NextActionBand similarCases={cases(1)} actions={[SELF_CALC, BOT, SM_CALC, SITUATION, SAME_FIELD]} />);
    const buttons = Array.from(document.querySelectorAll('[data-ui="dark-button"]'));
    expect(buttons.map((b) => b.getAttribute("href"))).toEqual([SM_CALC.href, SITUATION.href]);
    expect(screen.queryByText("계산해 보기")).toBeNull();
    expect(screen.queryByText("지방세봇에게 묻기")).toBeNull();
  });

  it("어떤 경우에도 '준비 중' 글자나 링크가 없다", () => {
    const { container } = render(<NextActionBand similarCases={cases(3)} actions={[SELF_CALC, BOT, SITUATION]} />);
    expect(container.textContent).not.toContain("준비 중");
    expect(container.querySelectorAll("a[aria-disabled], button[disabled]")).toHaveLength(0);
  });

  it("버튼은 어두운 버튼이고 띠 안에 주 버튼이 없다 (R2)", () => {
    const { container } = render(<NextActionBand similarCases={cases(3)} actions={[SITUATION, SAME_FIELD]} />);
    expect(container.querySelectorAll('[data-ui="primary-button"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-ui="dark-button"]')).toHaveLength(2);
  });

  it("SM 계산기 같은 새 창 버튼은 target=_blank · rel=noopener noreferrer · '(새 창)' 안내", () => {
    render(<NextActionBand similarCases={[]} actions={[SM_CALC]} />);
    const link = screen.getByRole("link", { name: /SM 계산기로 계산하기/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("(새 창)");
    expect(link.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("같은 사이트 버튼은 새 창으로 열지 않는다", () => {
    render(<NextActionBand similarCases={[]} actions={[SITUATION]} />);
    const link = screen.getByRole("link", { name: "이 상황 모아 보기" });
    expect(link.getAttribute("target")).toBeNull();
    expect(link.textContent).not.toContain("새 창");
  });

  it("버튼마다 분석용 행동 표식(data-next-action)이 있다 (next_action_clicked)", () => {
    const { container } = render(<NextActionBand similarCases={[]} actions={[SITUATION, SM_CALC]} />);
    const keys = Array.from(container.querySelectorAll("[data-next-action]")).map((el) => el.getAttribute("data-next-action"));
    expect(keys).toEqual(["situation", "sm-calculator"]);
  });

  it("모바일에서 버튼은 전체 폭(좌우 16px 뺀 너비)이다", () => {
    const { container } = render(<NextActionBand similarCases={[]} actions={[SITUATION]} />);
    const button = container.querySelector('[data-ui="dark-button"]')!;
    expect(button.className).toContain("w-full");
    expect(button.className).toContain("sm:w-auto");
  });

  it("비슷한 사례도 열린 버튼도 없으면 띠 전체를 렌더하지 않는다", () => {
    const { container } = render(<NextActionBand similarCases={[]} actions={[SELF_CALC, BOT]} />);
    expect(container.innerHTML).toBe("");
  });

  it("루트는 '다음 행동' 이름의 흰 카드 영역, data-ui=next-action-band", () => {
    render(<NextActionBand similarCases={cases(1)} actions={[SITUATION]} />);
    const region = screen.getByRole("region", { name: "다음 행동" });
    expect(region.getAttribute("data-ui")).toBe("next-action-band");
    expect(region.className).toContain("bg-white");
    expect(region.className).toContain("rounded-2xl");
  });
});
