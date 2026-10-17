// services 묶음 — 백오피스 (PRD-00 8.6: 최적화 점검 패널 · 제휴 준비 지표 카드). 독자 화면에는 나오지 않는다
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptimizationPanel, type OptimizationCheck } from "./OptimizationPanel";
import { PartnerReadinessCard, type PartnerReadinessCardProps } from "./PartnerReadinessCard";

const cls = (el: Element | null | undefined) => el?.getAttribute("class") ?? "";

describe("최적화 점검 패널 (OPT-03 · OPT-06 · OPT-07)", () => {
  const scores = { seo: 86, aeo: 72, geo: 64, common: 90 };
  const checks: OptimizationCheck[] = [
    { id: "title", label: "제목 길이", result: "pass" },
    { id: "faq", label: "FAQ 답이 본문과 같음", result: "warn", detail: "2번 답이 본문보다 깁니다" },
    { id: "canonical", label: "canonical·중복", result: "block", detail: "같은 주소의 기사가 있습니다" },
  ];

  it("축별(SEO·AEO·GEO·공통) 0~100점을 고정폭으로, 점수 옆 고정 문구를 보인다", () => {
    render(<OptimizationPanel scores={scores} checks={checks} />);
    const panel = document.querySelector('[data-ui="optimization-panel"]') as HTMLElement;
    const terms = Array.from(panel.querySelectorAll("dt")).map((d) => d.textContent);
    expect(terms).toEqual(["SEO", "AEO", "GEO", "공통"]);
    const values = Array.from(panel.querySelectorAll("dd"));
    expect(values.map((d) => d.textContent)).toEqual(["86", "72", "64", "90"]);
    values.forEach((d) => expect(cls(d)).toContain("font-mono"));
    expect(within(panel).getByText("내부 품질 지표 — 검색 순위 예측이 아닙니다")).toBeTruthy();
  });

  it("항목 결과는 색에 더해 글자 — 통과 emerald · 경고 amber · 차단 rose, 차단이 먼저", () => {
    render(<OptimizationPanel scores={scores} checks={checks} />);
    const items = within(screen.getByRole("list", { name: "점검 항목" })).getAllByRole("listitem");
    const label = (li: HTMLElement) => li.querySelector('[data-part="result"]')!;
    expect(items.map((li) => label(li).textContent)).toEqual(["차단", "경고", "통과"]);
    expect(cls(label(items[0]))).toContain("text-rose-800");
    expect(cls(label(items[1]))).toContain("text-amber-800");
    expect(cls(label(items[2]))).toContain("text-emerald-800");
    expect(items[0].textContent).toContain("canonical·중복");
    expect(items[0].textContent).toContain("같은 주소의 기사가 있습니다");
  });

  it("차단 항목이 하나라도 있으면 [발행 승인]이 꺼지고 눌러도 동작하지 않는다", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<OptimizationPanel scores={scores} checks={checks} onApprove={onApprove} />);
    const approve = screen.getByRole("button", { name: "발행 승인" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    await user.click(approve);
    expect(onApprove).not.toHaveBeenCalled();
    expect(document.querySelector('[data-ui="optimization-panel"]')!.textContent).toContain("차단 항목 1개");
  });

  it("차단 0 + 경고만 있으면 [발행 승인]이 켜진다 (경고는 발행을 막지 않는다)", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<OptimizationPanel scores={scores} checks={checks.filter((c) => c.result !== "block")} onApprove={onApprove} />);
    const approve = screen.getByRole("button", { name: "발행 승인" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    await user.click(approve);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("경계 — 0·100점은 그대로, 범위 밖·소수·NaN은 '—'(점수 없음)", () => {
    render(<OptimizationPanel scores={{ seo: 0, aeo: 100, geo: 101, common: Number.NaN }} checks={[]} />);
    const dd = Array.from(document.querySelectorAll('[data-ui="optimization-panel"] dd')).map((d) => d.textContent);
    expect(dd).toEqual(["0", "100", "—", "—"]);
    const { container } = render(<OptimizationPanel scores={{ seo: -1, aeo: 87.5, geo: 50, common: 50 }} checks={[]} />);
    expect(Array.from(container.querySelectorAll("dd")).map((d) => d.textContent)).toEqual(["—", "—", "50", "50"]);
  });

  it("주 버튼이 아니고 '상위 노출'·'노출 예측' 같은 문구가 없다", () => {
    const { container } = render(<OptimizationPanel scores={scores} checks={checks} />);
    expect(container.querySelectorAll('[data-ui="primary-button"]').length).toBe(0);
    expect(container.textContent).not.toContain("상위 노출");
    expect(container.textContent).not.toContain("노출 예측");
  });
});

describe("제휴 준비 지표 카드 (NAV-17 · NAV-24)", () => {
  const card: PartnerReadinessCardProps = {
    name: "자체 생산 비율",
    value: "62.5%",
    monthsOfData: 12,
    lowestThreeMonths: "48.0%",
    zeroRisk: false,
    rule: { version: "2026.03", checkedAt: "2026-10-01" },
  };

  it("지표 이름·이번 달 값·임의 3개월 조합 최저값(고정폭)·규정 버전·확인일·고정 문구를 보인다", () => {
    render(<PartnerReadinessCard {...card} />);
    const root = document.querySelector('[data-ui="partner-readiness-card"]') as HTMLElement;
    expect(within(root).getByRole("heading").textContent).toBe("자체 생산 비율");
    expect(root.querySelector('[data-part="value"]')!.textContent).toBe("62.5%");
    const lowest = root.querySelector('[data-part="lowest"]')!;
    expect(lowest.textContent).toBe("48.0%");
    expect(cls(lowest)).toContain("font-mono");
    expect(root.textContent).toContain("규정 2026.03");
    expect(root.querySelector("time")?.textContent).toBe("2026-10-01");
    expect(within(root).getByText("내부 지표 — 네이버 심사 점수가 아닙니다")).toBeTruthy();
  });

  it("규정 원문이 등록되지 않았으면 값 대신 '요건 미확정'", () => {
    render(<PartnerReadinessCard {...card} rule={null} />);
    const root = document.querySelector('[data-ui="partner-readiness-card"]') as HTMLElement;
    expect(root.querySelector('[data-part="value"]')!.textContent).toBe("요건 미확정");
    expect(root.textContent).not.toContain("62.5%");
    expect(root.textContent).not.toContain("48.0%");
    expect(root.textContent).toContain("내부 지표 — 네이버 심사 점수가 아닙니다");
  });

  it("0점 위험이면 amber 칩 '0점 위험'(글자로도), 아니면 칩 0", () => {
    const { unmount } = render(<PartnerReadinessCard {...card} value="0" zeroRisk />);
    const chip = screen.getByText("0점 위험");
    expect(cls(chip)).toContain("bg-amber-50");
    expect(cls(chip)).toContain("text-amber-800");
    expect(document.querySelector('[data-part="value"]')!.textContent).toBe("0");
    unmount();
    render(<PartnerReadinessCard {...card} />);
    expect(screen.queryByText("0점 위험")).toBeNull();
  });

  it("경계 — 데이터 2개월이면 최저값 대신 '기간 부족', 3개월이면 최저값", () => {
    const { unmount } = render(<PartnerReadinessCard {...card} monthsOfData={2} />);
    expect(document.querySelector('[data-part="lowest"]')!.textContent).toBe("기간 부족");
    unmount();
    render(<PartnerReadinessCard {...card} monthsOfData={3} />);
    expect(document.querySelector('[data-part="lowest"]')!.textContent).toBe("48.0%");
  });
});
