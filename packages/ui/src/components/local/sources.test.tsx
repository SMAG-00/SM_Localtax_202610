// 원문·자료 카드 — 공식 자료 카드(REG1-07·REG1-09·REG1-13·PR-07), 핫뉴스 항목 카드(LG-02·PR-07), 분양 정보 카드(PR-04)
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { OfficialSourceCard, type OfficialSourceCardProps } from "./OfficialSourceCard";
import { HotNewsItemCard, type HotNewsItemCardProps } from "./HotNewsItemCard";
import { PresaleInfoCard, type PresaleInfoCardProps } from "./PresaleInfoCard";

const cls = (el: Element | null) => el?.getAttribute("class") ?? "";

function expectNewWindow(link: HTMLElement) {
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(link.textContent).toContain("(새 창)");
}

describe("공식 자료 카드 (REG1-07·REG1-13)", () => {
  const props: OfficialSourceCardProps = {
    kind: "예산/결산",
    title: "2027년도 강남구 예산안 개요",
    publisher: "서울특별시 강남구",
    basisDate: "2026-10-01",
    checkedAt: "2026-10-13",
    rights: "kogl-1",
    url: "https://www.example.go.kr/budget/2027",
    articles: [{ title: "강남구 내년 예산, 어디에 쓰이나", href: "/news/gangnam-budget-2027" }],
  };

  it("자료 유형 칩·제목·발표기관·기준일·정보 확인일(고정폭)·권리 상태·원문 보기(새 창)를 보인다", () => {
    render(<OfficialSourceCard {...props} />);
    const card = screen.getByRole("article");
    expect(card.getAttribute("data-ui")).toBe("official-source-card");
    expect(screen.getByText("예산/결산")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("2027년도 강남구 예산안 개요");
    expect(screen.getByText("서울특별시 강남구")).toBeTruthy();
    expect(cls(screen.getByText("2026-10-01"))).toContain("font-mono");
    expect(cls(screen.getByText("2026-10-13"))).toContain("font-mono");
    expect(screen.getByText("공공누리 제1유형(출처표시)")).toBeTruthy();
    const link = screen.getByRole("link", { name: /원문 보기/ });
    expect(link.getAttribute("href")).toBe("https://www.example.go.kr/budget/2027");
    expectNewWindow(link);
  });

  it.each(["publisher", "basisDate", "checkedAt", "rights"] as const)("출처·기준일·확인일·권리 상태 중 %s가 없으면 아무것도 그리지 않는다", (field) => {
    const broken = { ...props, [field]: undefined } as unknown as OfficialSourceCardProps;
    const { container } = render(<OfficialSourceCard {...broken} />);
    expect(container.innerHTML).toBe("");
  });

  it("원문 URL이 없거나 날짜 형식이 틀리면 그리지 않는다", () => {
    const { container, rerender } = render(<OfficialSourceCard {...props} url="" />);
    expect(container.innerHTML).toBe("");
    rerender(<OfficialSourceCard {...props} basisDate="2026-13-01" />);
    expect(container.innerHTML).toBe("");
  });

  it("허용 자료 종류(조례·고시·예산/결산·지방세 세수·부동산 거래/공시·정비/개발) 밖이면 그리지 않는다 — 관광 안내 0", () => {
    const tour = { ...props, kind: "관광" } as unknown as OfficialSourceCardProps;
    const { container } = render(<OfficialSourceCard {...tour} />);
    expect(container.innerHTML).toBe("");
  });

  it("원문·발표기관·기준일 영역과 기자의 해석(기사 링크) 영역이 섞이지 않는다", () => {
    render(<OfficialSourceCard {...props} />);
    const original = screen.getByRole("group", { name: "원문 자료" });
    const interpretation = screen.getByRole("group", { name: "이 자료를 다룬 기사" });
    expect(within(original).queryByText("강남구 내년 예산, 어디에 쓰이나")).toBeNull();
    expect(within(original).getByText("서울특별시 강남구")).toBeTruthy();
    expect(within(interpretation).getByRole("link", { name: "강남구 내년 예산, 어디에 쓰이나" }).getAttribute("href")).toBe("/news/gangnam-budget-2027");
    expect(within(interpretation).queryByRole("link", { name: /원문 보기/ })).toBeNull();
    expect(original.compareDocumentPosition(interpretation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("카드에 해석 문장을 넣는 칸은 없다 — 해석은 기사 링크로만", () => {
    // @ts-expect-error 해석·분석 글은 공식 자료 카드의 입력이 아니다
    render(<OfficialSourceCard {...props} analysis="예산이 크게 늘어 주민 부담이 커진다" />);
    expect(screen.queryByText(/주민 부담/)).toBeNull();
  });

  it("기사 링크가 없으면 해석 영역도 없다", () => {
    render(<OfficialSourceCard {...props} articles={[]} />);
    expect(screen.queryByRole("group", { name: "이 자료를 다룬 기사" })).toBeNull();
  });

  it("공공누리 유형마다 출처 조건을 글자로 보인다", () => {
    const { rerender } = render(<OfficialSourceCard {...props} rights="kogl-4" />);
    expect(screen.getByText("공공누리 제4유형(출처표시·상업적 이용금지·변경금지)")).toBeTruthy();
    rerender(<OfficialSourceCard {...props} rights="unmarked" />);
    expect(screen.getByText("공공누리 미표시")).toBeTruthy();
  });

  it("원문이 바뀌어 다시 검토하는 자료는 '검토 중'을 함께 보인다", () => {
    render(<OfficialSourceCard {...props} underReview />);
    expect(screen.getByText("검토 중")).toBeTruthy();
  });
});

describe("핫뉴스 항목 카드 (LG-02)", () => {
  const props: HotNewsItemCardProps = {
    region: "서울특별시 강남구",
    summary: "강남구가 내년 재산세 고지서에 납부 방법 안내를 더 크게 싣기로 했습니다. 고지서는 7월과 9월에 나갑니다.",
    publisher: "강남구청 보도자료",
    publishedAt: "2026-10-14",
    sourceUrl: "https://www.example.go.kr/press/1",
    license: "kogl-1",
  };

  it("지역 칩·편집자 요약(17px)·발표기관·발표일(고정폭)·원문 보기(새 창)·공공누리 표기", () => {
    render(<HotNewsItemCard {...props} />);
    const card = screen.getByRole("article");
    expect(card.getAttribute("data-ui")).toBe("hot-news-item-card");
    expect(screen.getByText("서울특별시 강남구")).toBeTruthy();
    expect(cls(screen.getByText(props.summary))).toContain("text-[17px]");
    expect(screen.getByText("강남구청 보도자료")).toBeTruthy();
    expect(cls(screen.getByText("2026-10-14"))).toContain("font-mono");
    expect(screen.getByText("공공누리 제1유형(출처표시)")).toBeTruthy();
    expectNewWindow(screen.getByRole("link", { name: /원문 보기/ }));
  });

  it.each(["sourceUrl", "publisher", "publishedAt"] as const)("원문 URL·발표기관·발표일 중 %s가 없으면 그리지 않는다", (field) => {
    const broken = { ...props, [field]: "" };
    const { container } = render(<HotNewsItemCard {...broken} />);
    expect(container.innerHTML).toBe("");
  });

  it("조회수·순위는 입력도 표시도 없다", () => {
    // @ts-expect-error 조회수·순위는 핫뉴스 항목의 입력이 아니다
    const { container } = render(<HotNewsItemCard {...props} views={1234} rank={1} />);
    expect(container.textContent).not.toMatch(/조회|1234|순위|1위/);
  });
});

describe("분양 정보 카드 (PR-04)", () => {
  const props: PresaleInfoCardProps = {
    name: "○○구역 주택재개발 일반분양",
    region: "서울특별시 강남구",
    supply: "총 1,024세대 중 일반분양 312세대",
    subscriptionStart: "2026-11-02",
    subscriptionEnd: "2026-11-04",
    noticeUrl: "https://www.example.or.kr/notice/presale-1",
    checkedAt: "2026-10-13",
  };

  it("'분양 정보' 표시·사업명·지역 칩·공급 규모·청약 일정(고정폭)·공식 공고(새 창)·확인일", () => {
    render(<PresaleInfoCard {...props} />);
    const card = screen.getByRole("article");
    expect(card.getAttribute("data-ui")).toBe("presale-info-card");
    const label = screen.getByText("분양 정보");
    expect(cls(label)).toContain("text-navy-800");
    expect(cls(label)).toContain("bg-white");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("○○구역 주택재개발 일반분양");
    expect(screen.getByText("서울특별시 강남구")).toBeTruthy();
    expect(screen.getByText("총 1,024세대 중 일반분양 312세대")).toBeTruthy();
    expect(cls(screen.getByText("2026-11-02 ~ 2026-11-04"))).toContain("font-mono");
    expect(cls(screen.getByText("2026-10-13"))).toContain("font-mono");
    expectNewWindow(screen.getByRole("link", { name: /공식 공고/ }));
  });

  it("공식 공고 URL이나 확인일이 없으면 그리지 않는다", () => {
    const { container, rerender } = render(<PresaleInfoCard {...props} noticeUrl="" />);
    expect(container.innerHTML).toBe("");
    rerender(<PresaleInfoCard {...props} checkedAt="" />);
    expect(container.innerHTML).toBe("");
  });

  it("확인되지 않은 공급 규모·청약 일정은 추정하지 않고 '확인 필요'로 쓴다", () => {
    render(<PresaleInfoCard {...props} supply="" subscriptionStart="" subscriptionEnd="" />);
    expect(screen.getAllByText("확인 필요").length).toBe(2);
  });

  it("가격·전망·투자 권유·추천 요소가 없다 — 분양가를 넘겨도 보이지 않는다", () => {
    // @ts-expect-error 분양 정보 카드에는 가격 칸이 없다
    const { container } = render(<PresaleInfoCard {...props} price="3.3㎡당 5,000만원" />);
    expect(container.textContent).not.toMatch(/분양가|가격|전망|추천|투자|수익|유망|5,000만원/);
  });

  it("연결된 프로젝트가 있으면 프로젝트 링크를 둔다", () => {
    render(<PresaleInfoCard {...props} projectHref="/realestate/projects/oo-redevelopment" />);
    expect(screen.getByRole("link", { name: "연결된 프로젝트 보기" }).getAttribute("href")).toBe("/realestate/projects/oo-redevelopment");
  });
});
