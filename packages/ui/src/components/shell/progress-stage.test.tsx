// 진행 단계 배지 (PRD-00 8.6 · PRD-01B TX-07·TX-08 · PRD-01A CAT-04) — v2.1 6단계
// 현재 단계 = 가장 늦은 순서의 기록 · 공포 전 단계는 `확정 아님` 칩 · 시행일 D 전날까지 '시행 예정', D부터 '시행'
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PROGRESS_STAGE_LABELS, PROGRESS_STAGE_ORDER, ProgressStageBadge, resolveProgressStage, type ProgressStageEvent } from "./ProgressStageBadge";

const tokens = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);
const url = (n: number) => `https://www.example.org/amendment/${n}`;

const untilSubmitted: ProgressStageEvent[] = [
  { stage: "announced", occurredOn: "2026-08-26", sourceUrl: url(1) },
  { stage: "pre_notice", occurredOn: "2026-09-10", sourceUrl: url(2) },
  { stage: "submitted", occurredOn: "2026-10-02", sourceUrl: url(3) },
];
const untilPromulgated: ProgressStageEvent[] = [
  ...untilSubmitted,
  { stage: "passed", occurredOn: "2026-12-02", sourceUrl: url(4) },
  { stage: "promulgated", occurredOn: "2026-12-24", sourceUrl: url(5) },
];
const withEffective: ProgressStageEvent[] = [...untilPromulgated, { stage: "effective", occurredOn: "2027-01-01", sourceUrl: url(6) }];

function cells(container: HTMLElement) {
  const list = within(container).getByRole("list", { name: "개정 진행 단계" });
  return within(list).getAllByRole("listitem");
}
const cellOf = (container: HTMLElement, stage: string) => container.querySelector(`[data-stage-cell="${stage}"]`)!;

describe("진행 단계 배지 — 6칸", () => {
  it("단계 값과 글자는 발표·입법예고·국회 제출·의결·공포·시행 순서", () => {
    expect(PROGRESS_STAGE_ORDER).toEqual(["announced", "pre_notice", "submitted", "passed", "promulgated", "effective"]);
    expect(PROGRESS_STAGE_ORDER.map((s) => PROGRESS_STAGE_LABELS[s])).toEqual(["발표", "입법예고", "국회 제출", "의결", "공포", "시행"]);
  });

  it("가로 6칸 줄(1024px 이상), 모바일은 세로 목록이고 칸마다 단계 이름", () => {
    const { container } = render(<ProgressStageBadge events={untilSubmitted} today="2026-10-17" />);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("progress-stage-badge");
    const list = screen.getByRole("list", { name: "개정 진행 단계" });
    expect(list.tagName).toBe("OL");
    expect(tokens(list)).toEqual(expect.arrayContaining(["grid-cols-1", "lg:grid-cols-6"]));
    expect(cells(container).map((li) => li.querySelector('[data-part="stage-label"]')?.textContent)).toEqual(["발표", "입법예고", "국회 제출", "의결", "공포", "시행"]);
  });

  it("기록된 단계는 날짜(고정폭)와 새 창 원문 링크를 갖는다", () => {
    const { container } = render(<ProgressStageBadge events={untilSubmitted} today="2026-10-17" />);
    const announced = cellOf(container, "announced") as HTMLElement;
    const date = within(announced).getByText("2026-08-26");
    expect(tokens(date)).toContain("font-mono");
    const link = within(announced).getByRole("link", { name: "발표 원문 보기 (새 창)" });
    expect(link.getAttribute("href")).toBe(url(1));
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("새 창");
  });

  it("원문 주소가 없는 기록은 링크를 두지 않는다", () => {
    const { container } = render(<ProgressStageBadge events={[{ stage: "announced", occurredOn: "2026-08-26" }]} today="2026-10-17" />);
    expect(within(cellOf(container, "announced") as HTMLElement).queryByRole("link")).toBeNull();
  });
});

describe("진행 단계 배지 — 공포 전 (확정 아님)", () => {
  it("국회 제출이 현재면 '현재 단계 국회 제출'과 `확정 아님` 칩 1개, 지난 단계는 navy-50·navy-700으로 채운다", () => {
    const { container } = render(<ProgressStageBadge events={untilSubmitted} today="2026-10-17" />);
    expect(screen.getByText("국회 제출", { selector: '[data-part="current-label"]' })).toBeTruthy();
    expect(screen.getAllByText("확정 아님").length).toBe(1);
    expect(container.querySelectorAll('[data-ui="unconfirmed-chip"]').length).toBe(1);
    for (const s of ["announced", "pre_notice", "submitted"]) {
      const card = cellOf(container, s).querySelector('[data-part="stage-card"]')!;
      expect(tokens(card)).toEqual(expect.arrayContaining(["bg-navy-50", "text-navy-700"]));
      expect(cellOf(container, s).getAttribute("data-state")).toBe("done");
    }
    expect(cellOf(container, "submitted").getAttribute("aria-current")).toBe("step");
    expect(container.querySelectorAll('[aria-current="step"]').length).toBe(1);
  });

  it("아직 오지 않은 단계는 채우지 않고 글자 '기록 전'으로 알린다", () => {
    const { container } = render(<ProgressStageBadge events={untilSubmitted} today="2026-10-17" />);
    for (const s of ["passed", "promulgated", "effective"]) {
      const cell = cellOf(container, s);
      expect(cell.getAttribute("data-state")).toBe("upcoming");
      expect(cell.textContent).toContain("기록 전");
      const card = cell.querySelector('[data-part="stage-card"]')!;
      expect(tokens(card)).toContain("bg-white");
      expect(tokens(card)).not.toContain("bg-navy-50");
    }
  });

  it("의결까지는 여전히 `확정 아님`", () => {
    render(<ProgressStageBadge events={untilPromulgated.slice(0, 4)} today="2026-12-10" />);
    expect(screen.getByText("의결", { selector: '[data-part="current-label"]' })).toBeTruthy();
    expect(screen.getAllByText("확정 아님").length).toBe(1);
  });

  it("기록이 하나도 없으면 6칸 모두 '기록 전'이고 `확정 아님`", () => {
    const { container } = render(<ProgressStageBadge events={[]} today="2026-10-17" />);
    expect(cells(container).every((li) => li.getAttribute("data-state") === "upcoming")).toBe(true);
    expect(screen.getAllByText("확정 아님").length).toBe(1);
    expect(container.querySelectorAll('[aria-current="step"]').length).toBe(0);
  });
});

describe("진행 단계 배지 — 공포·시행", () => {
  it("공포를 기록하면 `확정 아님` 칩 0, 공포 칸은 navy-900 바탕 흰 글자", () => {
    const { container } = render(<ProgressStageBadge events={untilPromulgated} today="2026-12-28" />);
    expect(screen.queryByText("확정 아님")).toBeNull();
    expect(container.querySelectorAll('[data-ui="unconfirmed-chip"]').length).toBe(0);
    const card = cellOf(container, "promulgated").querySelector('[data-part="stage-card"]')!;
    expect(tokens(card)).toEqual(expect.arrayContaining(["bg-navy-900", "text-white"]));
  });

  it("시행일 D의 전날까지는 '시행 예정'(amber-50·amber-800)", () => {
    const { container } = render(<ProgressStageBadge events={withEffective} today="2026-12-31" />);
    const cell = cellOf(container, "effective");
    expect(cell.querySelector('[data-part="stage-label"]')?.textContent).toBe("시행 예정");
    expect(tokens(cell.querySelector('[data-part="stage-card"]'))).toEqual(expect.arrayContaining(["bg-amber-50", "text-amber-800"]));
    expect(screen.getByText("시행 예정", { selector: '[data-part="current-label"]' })).toBeTruthy();
    expect(screen.queryByText("확정 아님")).toBeNull();
  });

  it("시행일 D 당일부터 '시행'(emerald-50·emerald-800) — 글자로도 시행 예정과 구분된다", () => {
    const { container } = render(<ProgressStageBadge events={withEffective} today="2027-01-01" />);
    const cell = cellOf(container, "effective");
    expect(cell.querySelector('[data-part="stage-label"]')?.textContent).toBe("시행");
    expect(tokens(cell.querySelector('[data-part="stage-card"]'))).toEqual(expect.arrayContaining(["bg-emerald-50", "text-emerald-800"]));
    expect(cell.textContent).not.toContain("시행 예정");
  });
});

describe("진행 단계 배지 — 기록 규칙", () => {
  it("건너뛴 단계는 '해당 없음'과 사유를 보이고 현재 단계가 되지 않는다", () => {
    const events: ProgressStageEvent[] = [
      { stage: "announced", occurredOn: "2026-08-26", sourceUrl: url(1) },
      { stage: "pre_notice", occurredOn: "2026-09-10", sourceUrl: url(2) },
      { stage: "submitted", occurredOn: "2026-09-30", skipped: true, skipReason: "시행령 개정이라 국회 단계가 없습니다" },
    ];
    const { container } = render(<ProgressStageBadge events={events} today="2026-10-17" />);
    const cell = cellOf(container, "submitted");
    expect(cell.getAttribute("data-state")).toBe("skipped");
    expect(cell.textContent).toContain("해당 없음");
    expect(cell.textContent).toContain("시행령 개정이라 국회 단계가 없습니다");
    expect(screen.getByText("입법예고", { selector: '[data-part="current-label"]' })).toBeTruthy();
    expect(cellOf(container, "pre_notice").getAttribute("aria-current")).toBe("step");
  });

  it("같은 단계 기록이 둘이면 나중 기록(정정)을 쓴다", () => {
    const events: ProgressStageEvent[] = [
      { stage: "announced", occurredOn: "2026-08-26", sourceUrl: url(1) },
      { stage: "announced", occurredOn: "2026-08-27", sourceUrl: url(9) },
    ];
    const { container } = render(<ProgressStageBadge events={events} today="2026-10-17" />);
    const cell = cellOf(container, "announced") as HTMLElement;
    expect(within(cell).getByText("2026-08-27")).toBeTruthy();
    expect(within(cell).queryByText("2026-08-26")).toBeNull();
    expect(within(cell).getByRole("link").getAttribute("href")).toBe(url(9));
  });

  it("확정 기준(설정값)을 의결로 바꾸면 의결부터 `확정 아님`이 사라진다", () => {
    const { rerender } = render(<ProgressStageBadge events={untilPromulgated.slice(0, 4)} today="2026-12-10" confirmStage="passed" />);
    expect(screen.queryByText("확정 아님")).toBeNull();
    rerender(<ProgressStageBadge events={untilSubmitted} today="2026-10-17" confirmStage="passed" />);
    expect(screen.getAllByText("확정 아님").length).toBe(1);
  });
});

describe("resolveProgressStage — 현재 단계 계산", () => {
  it("가장 늦은 순서의 기록이 현재 단계다 (배열 순서와 상관없이)", () => {
    const shuffled = [untilSubmitted[2], untilSubmitted[0], untilSubmitted[1]];
    const r = resolveProgressStage(shuffled, { today: "2026-10-17" });
    expect(r.current).toBe("submitted");
    expect(r.currentLabel).toBe("국회 제출");
    expect(r.confirmed).toBe(false);
  });

  it("시행 경계 — D-1은 시행 예정, D는 시행, 둘 다 확정", () => {
    expect(resolveProgressStage(withEffective, { today: "2026-12-31" })).toMatchObject({ current: "effective", currentLabel: "시행 예정", confirmed: true });
    expect(resolveProgressStage(withEffective, { today: "2027-01-01" })).toMatchObject({ current: "effective", currentLabel: "시행", confirmed: true });
  });

  it("기록이 없으면 현재 단계 없음 · 확정 아님", () => {
    expect(resolveProgressStage([], { today: "2026-10-17" })).toMatchObject({ current: null, confirmed: false });
  });
});
