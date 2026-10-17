// 상황 카드 (PRD-00 8.6, PRD-01A UX-05) — 링크 카드 문법 · 픽토그램 + 상황 한 문장(19px 900) + 한 줄 · 호버 hermes-50
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SituationCard } from "./SituationCard";

describe("상황 카드", () => {
  it("카드 전체가 상황 페이지로 가는 링크 하나이고 상황 문장과 한 줄 설명을 담는다", () => {
    render(<SituationCard href="/situations/car-sold" pictogram="car-sold" title="차를 팔았어요·폐차했어요" description="미리 낸 자동차세를 돌려받는 방법" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/situations/car-sold");
    expect(links[0].textContent).toBe("차를 팔았어요·폐차했어요미리 낸 자동차세를 돌려받는 방법");
  });

  it("상황 문장은 픽토그램의 글자 라벨이며 19px 900이다 (R11 — 라벨 항상 함께)", () => {
    const { container } = render(<SituationCard href="/situations/notice" pictogram="notice-received" title="고지서를 받았어요" description="고지서에서 먼저 볼 세 가지" />);
    const picto = container.querySelector('[data-ui="pictogram"]')!;
    expect(picto.getAttribute("data-pictogram")).toBe("notice-received");
    const title = screen.getByText("고지서를 받았어요");
    expect(picto.contains(title)).toBe(true);
    expect(title.className).toContain("text-[19px]");
    expect(title.className).toContain("font-black");
  });

  it("링크 카드 문법이고 호버 때 바탕이 hermes-50이다", () => {
    const { container } = render(<SituationCard href="/situations/home" pictogram="home-bought" title="집을 샀어요" description="취득세 신고 기한과 감면 요건" />);
    const card = container.querySelector('[data-ui="link-card"]')!;
    expect(card.className).toContain("hover:bg-hermes-50");
    expect(card.className).toContain("hover:border-hermes-400");
    expect(container.firstElementChild!.getAttribute("data-ui")).toBe("situation-card");
  });

  it("세목 픽토그램도 쓸 수 있다 — '세금을 돌려받고 싶어요'는 환급 그림", () => {
    const { container } = render(<SituationCard href="/situations/refund" pictogram="refund" title="세금을 돌려받고 싶어요" description="환급 신청 순서" />);
    expect(container.querySelector('[data-ui="pictogram"]')!.getAttribute("data-pictogram")).toBe("refund");
  });

  it("국세·지방세 배지 자리가 있으면 상황 문장 옆에 보이고, 없으면 빈 요소도 없다", () => {
    const { rerender, container } = render(
      <SituationCard href="/situations/inherit" pictogram="inheritance" title="부모님 집을 상속받았어요" description="취득세 신고 순서" badge={<span>지방세</span>} />,
    );
    expect(screen.getByText("지방세")).toBeTruthy();
    rerender(<SituationCard href="/situations/inherit" pictogram="inheritance" title="부모님 집을 상속받았어요" description="취득세 신고 순서" />);
    expect(screen.queryByText("지방세")).toBeNull();
    expect(container.querySelector("[data-slot=badge]")).toBeNull();
  });

  it("주 버튼이 아니다 (R2)", () => {
    const { container } = render(<SituationCard href="/situations/trust" pictogram="trust-property" title="신탁 부동산이에요" description="신탁 재산의 재산세는 누가 내나요" />);
    expect(container.querySelectorAll('[data-ui="primary-button"]')).toHaveLength(0);
  });
});
