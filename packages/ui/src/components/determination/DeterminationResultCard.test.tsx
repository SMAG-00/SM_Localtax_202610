import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DETERMINATION_NOTICE, DeterminationResultCard } from "./DeterminationResultCard";

// 시험용 지어낸 글자만 쓴다 - 실제 판정 결론·요건·조문이 아니다.
const base = { title: "시험용 판정", tableVersion: "2099.01" } as const;

describe("판정 도우미 결과 카드", () => {
  it("결론 상태에서는 결론 글자와 근거 문장을 보이고, 빠진 항목 영역은 없다", () => {
    render(<DeterminationResultCard {...base} status="결론" conclusion={{ text: "시험용 결론 A", basis: "시험용 근거" }} />);
    const card = screen.getByRole("region", { name: "시험용 판정 판정 결과" });
    expect(card.getAttribute("data-status")).toBe("결론");
    expect(within(card).getByText("시험용 결론 A")).toBeTruthy();
    expect(within(card).getByText("시험용 근거")).toBeTruthy();
    expect(card.querySelector('[data-part="missing"]')).toBeNull();
  });

  it("요건 확인 필요 상태에서는 결론 글자가 넘어와도 그리지 않고 빠진 항목을 차례대로 보인다", () => {
    render(
      <DeterminationResultCard
        {...base}
        status="요건 확인 필요"
        conclusion={{ text: "시험용 새어 나오면 안 되는 결론" }}
        missing={[
          { id: "a", label: "시험용 취득일" },
          { id: "b", label: "시험용 지분" },
        ]}
      />,
    );
    const card = screen.getByRole("region");
    expect(card.textContent).not.toContain("새어 나오면 안 되는 결론");
    expect(card.querySelector('[data-part="conclusion"]')).toBeNull();
    expect(within(card).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["시험용 취득일", "시험용 지분"]);
    expect(within(card).getByText(/요건 확인 필요 - /)).toBeTruthy();
  });

  it("표에 없는 경우는 결론 없이 전문가 확인 안내를 보인다", () => {
    render(<DeterminationResultCard {...base} status="표에 없는 경우" />);
    const card = screen.getByRole("region");
    expect(card.querySelector('[data-part="no-row"]')?.textContent).toContain("전문가 확인");
    expect(card.querySelector('[data-part="conclusion"]')).toBeNull();
  });

  it("판정표 버전과 참고용 고지는 어느 상태에서나 보인다", () => {
    for (const status of ["결론", "요건 확인 필요", "표에 없는 경우"] as const) {
      const { unmount } = render(<DeterminationResultCard {...base} status={status} conclusion={status === "결론" ? { text: "시험용" } : null} />);
      const card = screen.getByRole("region");
      expect(card.querySelector('[data-ui="ruleset-label"]')?.textContent).toBe("적용 룰셋 2099.01");
      expect(card.querySelector('[data-part="notice"]')?.textContent).toBe(DETERMINATION_NOTICE);
      unmount();
    }
  });

  it("근거 체크는 상태 표시와 함께, 근거 조문은 칩으로 그린다", () => {
    render(
      <DeterminationResultCard
        {...base}
        status="결론"
        conclusion={{ text: "시험용" }}
        checks={[
          { id: "c1", label: "시험용 요건 1", state: "입력으로 확인" },
          { id: "c2", label: "시험용 요건 2", state: "직접 확인 필요" },
        ]}
        lawChips={["시험용 근거 칩"]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => [li.getAttribute("data-state"), li.textContent])).toEqual([
      ["입력으로 확인", "확인 시험용 요건 1"],
      ["직접 확인 필요", "직접 확인 필요 시험용 요건 2"],
    ]);
    expect(document.querySelector('[data-part="law-chips"] [data-ui="chip"]')?.textContent).toBe("시험용 근거 칩");
  });
});
