// 행사안내 — 행사 상태 계산·필수 필드·재확인(REG1-04·REG1-05·LG-11), 행사 상태 배지(LG-12), 행사 카드(LG-11~13), 행사 달력(REG-04·LG-10)
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { computeEventStatus, isPastEvent, isPublishableEvent, needsRecheck, type LocalEvent } from "./events";
import { EventStatusBadge } from "./EventStatusBadge";
import { EventCard } from "./EventCard";
import { EventCalendar } from "./EventCalendar";

const cls = (el: Element | null) => el?.getAttribute("class") ?? "";

function ev(over: Partial<LocalEvent> = {}): LocalEvent {
  return {
    id: "e1",
    title: "지방세 개정 주민 설명회",
    category: "세무·재정",
    host: "강남구청 세무관리과",
    place: "강남구청 별관 3층 대회의실",
    regionCode: "11680",
    start: "2026-10-15",
    end: "2026-10-20",
    officialUrl: "https://www.example.go.kr/notice/1",
    source: "강남구청 공지사항",
    checkedAt: "2026-10-13",
    ...over,
  };
}

describe("행사 상태 계산 (REG1-04)", () => {
  it("10월 15~20일 회차는 14일 예정, 15일·20일 진행, 21일 종료", () => {
    const e = ev();
    expect(computeEventStatus(e, "2026-10-14")).toBe("예정");
    expect(computeEventStatus(e, "2026-10-15")).toBe("진행");
    expect(computeEventStatus(e, "2026-10-20")).toBe("진행");
    expect(computeEventStatus(e, "2026-10-21")).toBe("종료");
  });

  it("12월 31일 하루 행사는 12월 31일 진행, 다음 해 1월 1일 종료 (연도 경계)", () => {
    const e = ev({ start: "2026-12-31", end: "2026-12-31" });
    expect(computeEventStatus(e, "2026-12-31")).toBe("진행");
    expect(computeEventStatus(e, "2027-01-01")).toBe("종료");
    expect(isPastEvent(e, "2026-12-31")).toBe(false);
    expect(isPastEvent(e, "2027-01-01")).toBe(true);
  });

  it("취소·변경 확인 중은 편집자가 지정한 값이 날짜 계산보다 앞선다", () => {
    expect(computeEventStatus(ev({ editorStatus: "취소" }), "2026-10-14")).toBe("취소");
    expect(computeEventStatus(ev({ editorStatus: "변경 확인 중" }), "2026-10-16")).toBe("변경 확인 중");
  });
});

describe("행사 필수 필드 (LG-11)", () => {
  it("모든 필수 필드가 있으면 공개 대상이다", () => {
    expect(isPublishableEvent(ev())).toBe(true);
  });

  it.each(["title", "category", "host", "place", "regionCode", "start", "end", "officialUrl", "source", "checkedAt"] as const)(
    "필수 필드 %s가 비면 공개 대상이 아니다",
    (field) => {
      expect(isPublishableEvent(ev({ [field]: "" }))).toBe(false);
    },
  );

  it("종료일이 시작일보다 이르거나 없는 날짜(2026-02-30)면 공개 대상이 아니다", () => {
    expect(isPublishableEvent(ev({ start: "2026-10-20", end: "2026-10-19" }))).toBe(false);
    expect(isPublishableEvent(ev({ start: "2026-02-30", end: "2026-03-02" }))).toBe(false);
    expect(isPublishableEvent(ev({ start: "2026-10-20", end: "2026-10-20" }))).toBe(true);
  });
});

describe("행사 재확인 (REG1-05)", () => {
  it("확인 후 N일째는 정상, N+1일째는 재확인 필요 — 14일 기준", () => {
    const e = ev({ start: "2026-11-01", end: "2026-11-02", checkedAt: "2026-10-01" });
    expect(needsRecheck(e, "2026-10-15", 14)).toBe(false);
    expect(needsRecheck(e, "2026-10-16", 14)).toBe(true);
  });

  it("연말을 넘어도 날짜 차이로 센다 — 12월 25일 확인, 7일 기준이면 1월 1일 정상·1월 2일 재확인", () => {
    const e = ev({ start: "2027-01-20", end: "2027-01-20", checkedAt: "2026-12-25" });
    expect(needsRecheck(e, "2027-01-01", 7)).toBe(false);
    expect(needsRecheck(e, "2027-01-02", 7)).toBe(true);
  });

  it("이미 끝난 회차는 재확인 대상이 아니다", () => {
    const e = ev({ checkedAt: "2026-09-01" });
    expect(needsRecheck(e, "2026-10-25", 14)).toBe(false);
  });
});

describe("행사 상태 배지 (LG-12, PRD-00 8.3·8.6)", () => {
  const pairs = [
    ["예정", "bg-navy-50", "text-navy-700"],
    ["진행", "bg-emerald-50", "text-emerald-800"],
    ["종료", "bg-ivory-dark", "text-navy-800"],
    ["취소", "bg-rose-50", "text-rose-800"],
    ["변경 확인 중", "bg-amber-50", "text-amber-800"],
  ] as const;

  it.each(pairs)("'%s' 배지는 %s 바탕 + %s 글자이고 상태 이름을 글자로 보인다", (status, bg, text) => {
    render(<EventStatusBadge status={status} />);
    const label = screen.getByText(status);
    expect(cls(label)).toContain(bg);
    expect(cls(label)).toContain(text);
    expect(cls(label)).toContain("rounded-full");
    expect(cls(label)).toContain("text-[12px]");
    expect(label.closest("[data-ui]")?.getAttribute("data-ui")).toBe("event-status-badge");
  });

  it("다섯 상태의 글자가 모두 달라 색 없이도 구분된다", () => {
    const { container } = render(
      <>
        {pairs.map(([s]) => (
          <EventStatusBadge key={s} status={s} />
        ))}
      </>,
    );
    const texts = [...container.querySelectorAll("[data-status-label]")].map((el) => el.textContent);
    expect(texts).toEqual(["예정", "진행", "종료", "취소", "변경 확인 중"]);
  });

  it("상태 확인일을 배지 옆 고정폭으로 보인다", () => {
    render(<EventStatusBadge status="예정" checkedAt="2026-10-13" />);
    const date = screen.getByText("상태 확인 2026-10-13");
    expect(cls(date)).toContain("font-mono");
  });
});

describe("행사 카드 (LG-11·LG-12·LG-13·REG1-05)", () => {
  it("분류 칩·행사명·기간(고정폭)·장소·주최·상태 배지·확인일·공식 안내(새 창)를 보인다", () => {
    render(<EventCard event={ev()} today="2026-10-14" recheckAfterDays={14} />);
    const card = screen.getByRole("article");
    expect(card.getAttribute("data-ui")).toBe("event-card");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("지방세 개정 주민 설명회");
    expect(screen.getByText("세무·재정")).toBeTruthy();
    expect(cls(screen.getByText("2026-10-15 ~ 2026-10-20"))).toContain("font-mono");
    expect(screen.getByText("강남구청 별관 3층 대회의실")).toBeTruthy();
    expect(screen.getByText("강남구청 세무관리과")).toBeTruthy();
    expect(screen.getByText("예정")).toBeTruthy();
    expect(screen.getByText("상태 확인 2026-10-13")).toBeTruthy();
    const link = screen.getByRole("link", { name: /공식 안내/ });
    expect(link.getAttribute("href")).toBe("https://www.example.go.kr/notice/1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("(새 창)");
  });

  it.each(["title", "category", "host", "place", "regionCode", "officialUrl", "source", "checkedAt"] as const)(
    "필수 필드 %s가 빠진 회차는 렌더하지 않는다",
    (field) => {
      const { container } = render(<EventCard event={ev({ [field]: "" })} today="2026-10-14" recheckAfterDays={14} />);
      expect(container.innerHTML).toBe("");
    },
  );

  it("종료일이 시작일보다 이른 회차는 렌더하지 않는다", () => {
    const { container } = render(<EventCard event={ev({ start: "2026-10-20", end: "2026-10-01" })} today="2026-10-14" recheckAfterDays={14} />);
    expect(container.innerHTML).toBe("");
  });

  it("상업 행사(sponsored)는 '광고'를 표시 줄 맨 앞에 두고, 일반 행사에는 '광고'가 없다", () => {
    const { rerender } = render(<EventCard event={ev({ sponsored: true })} today="2026-10-14" recheckAfterDays={14} />);
    const labels = screen.getByRole("article").querySelector("[data-event-labels]")!;
    expect(labels.firstElementChild?.textContent).toBe("광고");
    rerender(<EventCard event={ev()} today="2026-10-14" recheckAfterDays={14} />);
    expect(screen.queryByText("광고")).toBeNull();
  });

  it("확인 후 기준 일수를 넘으면 amber 칩 '일정 재확인 필요' — 기준 당일에는 없다", () => {
    const e = ev({ start: "2026-11-01", end: "2026-11-02", checkedAt: "2026-10-01" });
    const { rerender } = render(<EventCard event={e} today="2026-10-15" recheckAfterDays={14} />);
    expect(screen.queryByText("일정 재확인 필요")).toBeNull();
    rerender(<EventCard event={e} today="2026-10-16" recheckAfterDays={14} />);
    const chip = screen.getByText("일정 재확인 필요");
    expect(cls(chip)).toContain("bg-amber-50");
    expect(cls(chip)).toContain("text-amber-800");
  });

  it("변경 확인 중 회차는 종전 일정을 확정 일정처럼 보이지 않는다 — '종전 안내 일정'으로 표시", () => {
    render(<EventCard event={ev({ editorStatus: "변경 확인 중" })} today="2026-10-14" recheckAfterDays={14} />);
    expect(screen.getByText("변경 확인 중")).toBeTruthy();
    expect(screen.getByText("종전 안내 일정")).toBeTruthy();
    expect(screen.queryByText("기간")).toBeNull();
  });

  it("하루 행사는 기간에 날짜 하나만 쓰고, 상세 주소가 있으면 행사명이 상세 링크다", () => {
    render(<EventCard event={ev({ start: "2026-10-15", end: "2026-10-15", href: "/local/events/gangnam-tax-briefing-2026" })} today="2026-10-14" recheckAfterDays={14} />);
    expect(screen.getByText("2026-10-15")).toBeTruthy();
    expect(screen.getByRole("link", { name: "지방세 개정 주민 설명회" }).getAttribute("href")).toBe("/local/events/gangnam-tax-briefing-2026");
  });
});

describe("행사 달력 (REG-04·LG-10·8.9)", () => {
  const tabLabels = () => screen.getAllByRole("tab").map((t) => t.textContent);
  const panel = () => screen.getByRole("tabpanel");
  const listTitles = (ym: string) =>
    within(within(panel()).getByRole("list", { name: `${ym} 행사 목록` }))
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);

  it("탭은 이번 달 · 다음 달 · 지난 행사 순서다", () => {
    render(<EventCalendar events={[ev()]} today="2026-10-14" recheckAfterDays={14} scope="events-page" />);
    expect(tabLabels()).toEqual(["이번 달", "다음 달", "지난 행사"]);
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
  });

  it("10월 31일이면 기본 범위가 10월·11월, 11월 1일이면 11월·12월", async () => {
    const { unmount } = render(<EventCalendar events={[]} today="2026-10-31" recheckAfterDays={14} scope="events-page" />);
    expect(within(panel()).getByRole("heading", { name: "2026년 10월" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "다음 달" }));
    expect(within(panel()).getByRole("heading", { name: "2026년 11월" })).toBeTruthy();
    unmount();

    render(<EventCalendar events={[]} today="2026-11-01" recheckAfterDays={14} scope="events-page" />);
    expect(within(panel()).getByRole("heading", { name: "2026년 11월" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "다음 달" }));
    expect(within(panel()).getByRole("heading", { name: "2026년 12월" })).toBeTruthy();
  });

  const yearEnd = ev({ id: "a", title: "연말 지방재정 공개 설명회", start: "2026-12-31", end: "2026-12-31", checkedAt: "2026-12-28" });
  const newYear = ev({ id: "b", title: "신년 정비계획 주민설명회", category: "개발·정비", start: "2027-01-01", end: "2027-01-01", checkedAt: "2026-12-28" });

  it("12월 31일 — 범위는 12월·다음 해 1월, 12월 31일 행사는 이번 달에 진행으로, 1월 1일 새 회차는 다음 달에 예정으로", async () => {
    render(<EventCalendar events={[yearEnd, newYear]} today="2026-12-31" recheckAfterDays={14} scope="events-page" />);
    expect(within(panel()).getByRole("heading", { name: "2026년 12월" })).toBeTruthy();
    expect(listTitles("2026년 12월")).toEqual(["연말 지방재정 공개 설명회"]);
    expect(within(panel()).getAllByText("진행").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("tab", { name: "다음 달" }));
    expect(within(panel()).getByRole("heading", { name: "2027년 1월" })).toBeTruthy();
    expect(listTitles("2027년 1월")).toEqual(["신년 정비계획 주민설명회"]);

    await userEvent.click(screen.getByRole("tab", { name: "지난 행사" }));
    expect(within(panel()).queryByText("연말 지방재정 공개 설명회")).toBeNull();
  });

  it("1월 1일 00시부터 12월 31일 종료 행사는 예정 목록에서 빠지고 지난 행사에 종료로 남는다 (옛 회차와 새 회차는 따로)", async () => {
    render(<EventCalendar events={[yearEnd, newYear]} today="2027-01-01" recheckAfterDays={14} scope="events-page" />);
    expect(within(panel()).getByRole("heading", { name: "2027년 1월" })).toBeTruthy();
    expect(listTitles("2027년 1월")).toEqual(["신년 정비계획 주민설명회"]);

    await userEvent.click(screen.getByRole("tab", { name: "다음 달" }));
    expect(within(panel()).getByRole("heading", { name: "2027년 2월" })).toBeTruthy();
    expect(within(panel()).queryByText("연말 지방재정 공개 설명회")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "지난 행사" }));
    const past = within(panel()).getByRole("list", { name: "지난 행사 목록" });
    expect(within(past).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["연말 지방재정 공개 설명회"]);
    expect(within(past).getByText("종료")).toBeTruthy();
  });

  it("10월 20일 종료 행사는 10월 20일 목록에 있고 10월 21일 목록에는 없다", async () => {
    const e = ev();
    const { unmount } = render(<EventCalendar events={[e]} today="2026-10-20" recheckAfterDays={14} scope="events-page" />);
    expect(listTitles("2026년 10월")).toEqual(["지방세 개정 주민 설명회"]);
    unmount();

    render(<EventCalendar events={[e]} today="2026-10-21" recheckAfterDays={14} scope="events-page" />);
    expect(within(panel()).queryByRole("list", { name: "2026년 10월 행사 목록" })).toBeNull();
    expect(within(panel()).getByText("현재 확인된 일정 없음")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "지난 행사" }));
    expect(within(panel()).getByText("지방세 개정 주민 설명회")).toBeTruthy();
  });

  it("달력 칸의 항목 수와 같은 내용 목록의 항목 수가 같다 — 달을 넘는 행사는 그 달의 첫 칸에 한 번만", async () => {
    const events = [
      ev({ id: "x", title: "재산세 고지 안내 설명회", start: "2026-10-28", end: "2026-11-03" }),
      ev({ id: "y", title: "도시계획 공청회", category: "개발·정비", start: "2026-10-30", end: "2026-10-30" }),
      ev({ id: "z", title: "예산 설명회", start: "2026-11-12", end: "2026-11-12" }),
    ];
    render(<EventCalendar events={events} today="2026-10-25" recheckAfterDays={14} scope="events-page" />);
    const grid = () => within(panel()).getByRole("table");
    expect(grid().querySelectorAll("[data-calendar-entry]").length).toBe(2);
    expect(listTitles("2026년 10월")).toEqual(["재산세 고지 안내 설명회", "도시계획 공청회"]);
    expect(within(grid().querySelector('[data-date="2026-10-28"]') as HTMLElement).getByText("재산세 고지 안내 설명회")).toBeTruthy();

    await userEvent.click(screen.getByRole("tab", { name: "다음 달" }));
    expect(grid().querySelectorAll("[data-calendar-entry]").length).toBe(2);
    expect(listTitles("2026년 11월")).toEqual(["재산세 고지 안내 설명회", "예산 설명회"]);
    expect(within(grid().querySelector('[data-date="2026-11-01"]') as HTMLElement).getByText("재산세 고지 안내 설명회")).toBeTruthy();
  });

  it("달력 칸마다 행사명과 행사 상태 배지를 보이고, 달력은 모바일에서 숨고 목록은 늘 보인다", () => {
    render(<EventCalendar events={[ev()]} today="2026-10-16" recheckAfterDays={14} scope="events-page" />);
    const grid = within(panel()).getByRole("table");
    const entry = grid.querySelector("[data-calendar-entry]") as HTMLElement;
    expect(within(entry).getByText("지방세 개정 주민 설명회")).toBeTruthy();
    expect(within(entry).getByText("진행")).toBeTruthy();
    expect(cls(grid)).toContain("hidden");
    expect(cls(grid)).toContain("sm:table");
    expect(cls(within(panel()).getByRole("list", { name: "2026년 10월 행사 목록" }))).not.toContain("hidden");
  });

  it("/local/events(events-page)에는 축제가 없고, 지자체 허브(region-hub)에는 보인다 (LG-10)", () => {
    const festival = ev({ id: "f", title: "가을 구민 축제", category: "축제", start: "2026-10-24", end: "2026-10-25" });
    const { unmount } = render(<EventCalendar events={[ev(), festival]} today="2026-10-14" recheckAfterDays={14} scope="events-page" />);
    expect(listTitles("2026년 10월")).toEqual(["지방세 개정 주민 설명회"]);
    unmount();
    render(<EventCalendar events={[ev(), festival]} today="2026-10-14" recheckAfterDays={14} scope="region-hub" />);
    expect(listTitles("2026년 10월")).toEqual(["지방세 개정 주민 설명회", "가을 구민 축제"]);
  });

  it("필수 필드가 빠진 회차는 달력 칸과 목록 어디에도 없다", () => {
    render(<EventCalendar events={[ev(), ev({ id: "bad", title: "공식 주소 없는 행사", officialUrl: "" })]} today="2026-10-14" recheckAfterDays={14} scope="events-page" />);
    expect(screen.queryByText("공식 주소 없는 행사")).toBeNull();
    expect(within(panel()).getByRole("table").querySelectorAll("[data-calendar-entry]").length).toBe(1);
  });

  it("10월 달력은 일요일 시작 7칸이고 10월 1일(목)이 다섯째 칸이다", () => {
    render(<EventCalendar events={[]} today="2026-10-14" recheckAfterDays={14} scope="events-page" />);
    const grid = within(panel()).getByRole("table");
    expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["일", "월", "화", "수", "목", "금", "토"]);
    const firstRow = grid.querySelectorAll("tbody tr")[0];
    const cells = [...firstRow.querySelectorAll("td")];
    expect(cells[4].getAttribute("data-date")).toBe("2026-10-01");
    expect(cells[3].getAttribute("data-date")).toBeNull();
  });
});
