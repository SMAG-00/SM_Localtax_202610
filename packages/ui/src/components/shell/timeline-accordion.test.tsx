// 단계 타임라인·세목 아코디언 (PRD-00 8.6 — SM에서 그대로) — 렌더와 클릭·키보드로 확인한다
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepTimeline } from "./StepTimeline";
import { TaxAccordion, type TaxAccordionItem } from "./TaxAccordion";

const tokens = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

const steps = [
  { title: "취득", when: "살 때", chips: ["취득세", "지방교육세"], note: "취득일부터 60일 안에 신고합니다", href: "/tax/acquisition" },
  { title: "보유", when: "가지고 있을 때", chips: ["재산세"], note: "6월 1일 소유자에게 고지됩니다" },
  { title: "양도", when: "팔 때" },
];

describe("단계 타임라인", () => {
  it("순서 있는 목록(ol)에 단계마다 STEP 원(h-14 w-14 navy-900 흰 글자)과 1부터 번호", () => {
    const { container } = render(<StepTimeline label="부동산 세금의 전 주기" steps={steps} />);
    const root = container.firstElementChild!;
    expect(root.tagName).toBe("OL");
    expect(root.getAttribute("data-ui")).toBe("step-timeline");
    expect(screen.getByRole("list", { name: "부동산 세금의 전 주기" })).toBe(root);
    const items = within(root as HTMLElement).getAllByRole("listitem").filter((li) => li.parentElement === root);
    expect(items.length).toBe(3);
    items.forEach((li, i) => {
      const circle = li.querySelector(".h-14.w-14")!;
      expect(tokens(circle)).toEqual(expect.arrayContaining(["rounded-full", "bg-navy-900", "text-white"]));
      expect(circle.textContent).toBe(`STEP${i + 1}`);
      expect(tokens(within(circle as HTMLElement).getByText("STEP"))).toContain("text-[10px]");
    });
  });

  it("단계를 잇는 navy-200 세로선은 마지막 단계에는 없다 (3단계 → 선 2개)", () => {
    const { container } = render(<StepTimeline steps={steps} />);
    const lines = container.querySelectorAll('[data-part="connector"]');
    expect(lines.length).toBe(2);
    lines.forEach((l) => {
      expect(tokens(l)).toEqual(expect.arrayContaining(["bg-navy-200", "w-px"]));
      expect(l.getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("단계가 하나면 세로선 0", () => {
    const { container } = render(<StepTimeline steps={[{ title: "취득" }]} />);
    expect(container.querySelectorAll('[data-part="connector"]').length).toBe(0);
    expect(screen.getByText("취득")).toBeTruthy();
  });

  it("주소가 있는 단계만 카드 전체가 링크이고, 없는 단계는 링크가 아니다", () => {
    render(<StepTimeline steps={steps} />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("href")).toBe("/tax/acquisition");
    expect(links[0].textContent).toContain("취득");
    expect(tokens(links[0])).toContain("hover:border-hermes-400");
  });

  it("세목은 칩으로, 설명은 강조 문단으로, 때는 hermes-800 글자로 보인다", () => {
    render(<StepTimeline steps={steps} />);
    expect(screen.getByText("재산세").closest("[data-ui]")?.getAttribute("data-ui")).toBe("chip");
    expect(screen.getByText("6월 1일 소유자에게 고지됩니다").getAttribute("data-ui")).toBe("callout");
    expect(tokens(screen.getByText("가지고 있을 때"))).toContain("text-hermes-800");
  });

  it("단계가 0개면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<StepTimeline steps={[]} />);
    expect(container.firstElementChild).toBeNull();
  });
});

const items: TaxAccordionItem[] = [
  {
    id: "acq",
    name: "취득세",
    kind: "local",
    summary: "부동산·차량을 취득하면 냅니다",
    base: "취득 당시의 가액",
    rate: "주택 유상거래 1~3%",
    due: "취득일부터 60일 안",
    law: "지방세법 제11조",
    detail: "생애최초 주택이면 감면 요건을 확인하세요.",
  },
  {
    id: "cpt",
    name: "종합부동산세",
    kind: "national",
    summary: "공시가격 합계가 공제금액을 넘으면 냅니다",
    base: "공시가격 합계 − 공제금액",
    rate: "주택 0.5~2.7%",
    due: "12월 1일~15일",
    law: "종합부동산세법 제9조",
  },
  {
    id: "bond",
    name: "국민주택채권",
    kind: "other",
    summary: "등기할 때 사야 하는 채권입니다",
    base: "시가표준액",
    rate: "지역·금액별 매입 비율",
    due: "등기 신청 때",
    law: "주택도시기금법 제8조",
  },
];

describe("세목 아코디언", () => {
  it("세목마다 h3 안의 버튼 — 배지(지방세·국세·기타) + 제목 19px + 한 줄 설명", () => {
    const { container } = render(<TaxAccordion items={items} />);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("tax-accordion");
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.length).toBe(3);
    const buttons = headings.map((h) => within(h).getByRole("button"));
    expect(buttons.map((b) => b.querySelector('[data-ui="tax-kind-badge"]')?.textContent)).toEqual(["지방세", "국세", "기타"]);
    expect(tokens(within(buttons[0]).getByText("취득세"))).toContain("text-[19px]");
    expect(within(buttons[0]).getByText("부동산·차량을 취득하면 냅니다")).toBeTruthy();
  });

  it("처음에는 모두 접혀 있고 버튼의 aria-controls가 숨긴 패널을 가리킨다", () => {
    render(<TaxAccordion items={items} />);
    for (const b of screen.getAllByRole("button")) {
      expect(b.getAttribute("aria-expanded")).toBe("false");
      const panel = document.getElementById(b.getAttribute("aria-controls") ?? "")!;
      expect(panel).not.toBeNull();
      expect(panel.hidden).toBe(true);
    }
  });

  it("누르면 펼쳐져 과세표준·세율·납부시기·근거조문이 보이고, 근거조문은 고정폭이다", async () => {
    render(<TaxAccordion items={items} />);
    const button = screen.getByRole("button", { name: /취득세/ });
    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel.hidden).toBe(false);
    const terms = [...panel.querySelectorAll("dt")].map((d) => d.textContent);
    expect(terms).toEqual(["과세표준", "세율", "납부시기", "근거조문"]);
    const values = [...panel.querySelectorAll("dd")].map((d) => d.textContent);
    expect(values).toEqual(["취득 당시의 가액", "주택 유상거래 1~3%", "취득일부터 60일 안", "지방세법 제11조"]);
    expect(tokens(within(panel).getByText("지방세법 제11조"))).toContain("font-mono");
    expect(within(panel).getByText("생애최초 주택이면 감면 요건을 확인하세요.")).toBeTruthy();
  });

  it("다시 누르면 접힌다", async () => {
    render(<TaxAccordion items={items} />);
    const button = screen.getByRole("button", { name: /취득세/ });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(button.getAttribute("aria-controls")!)!.hidden).toBe(true);
  });

  it("세목마다 따로 펼친다 — 하나를 펼쳐도 다른 세목은 접힌 채", async () => {
    render(<TaxAccordion items={items} />);
    await userEvent.click(screen.getByRole("button", { name: /종합부동산세/ }));
    expect(screen.getByRole("button", { name: /종합부동산세/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /취득세/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /국민주택채권/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("키보드 — Tab으로 세목 버튼에 가서 Enter로 펼치고 Space로 접는다", async () => {
    render(<TaxAccordion items={items} />);
    await userEvent.tab();
    const first = screen.getByRole("button", { name: /취득세/ });
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard("{Enter}");
    expect(first.getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard(" ");
    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it("상세 설명이 없는 세목은 패널에 표(dl)만 있다", async () => {
    render(<TaxAccordion items={items} />);
    const button = screen.getByRole("button", { name: /종합부동산세/ });
    await userEvent.click(button);
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel.querySelectorAll("p").length).toBe(0);
  });

  it("버튼은 터치 영역 44px 이상이고 포커스 때 오렌지 2px 테두리", () => {
    render(<TaxAccordion items={items} />);
    const button = screen.getByRole("button", { name: /취득세/ });
    expect(tokens(button)).toEqual(expect.arrayContaining(["min-h-11", "focus-visible:outline-2", "focus-visible:outline-hermes-500"]));
  });

  it("세목이 0개면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<TaxAccordion items={[]} />);
    expect(container.firstElementChild).toBeNull();
  });
});
