// 부동산·개발금융 — 프로젝트 단계 타임라인(PR-02·PR-03·PR-05·PR-08), 개발방법 비교표(PR-09·PR-10·PR-11), 신탁 구조도(DF-01·DF-02)
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectStageTimeline, type ProjectStage } from "./ProjectStageTimeline";
import { DevMethodComparison, type DevMethodEntry, type DevMethodId } from "./DevMethodComparison";
import { TrustStructureDiagram, type StructureFlow, type StructureNode } from "./TrustStructureDiagram";

const cls = (el: Element | null) => el?.getAttribute("class") ?? "";

describe("프로젝트 단계 타임라인 (PR-02·PR-03·PR-05·PR-08)", () => {
  const record = (no: string, date: string) => ({
    noticeNo: no,
    noticeDate: date,
    agency: "서울특별시",
    sourceUrl: `https://www.example.go.kr/gosi/${no}`,
    checkedAt: "2026-10-13",
  });
  const stages: ProjectStage[] = [
    { name: "구역지정", record: record("제2024-101호", "2024-03-14"), taxLens: "구역지정만으로는 취득세가 생기지 않습니다." },
    { name: "조합설립인가", record: record("제2025-055호", "2025-06-02") },
    { name: "사업시행인가", record: record("제2026-210호", "2026-09-30"), taxLens: "사업시행인가 뒤 종전 자산 평가를 확인합니다." },
    { name: "관리처분인가" },
    { name: "착공" },
    { name: "준공", taxLens: "준공 뒤 새 집의 취득세 신고 기한을 확인합니다." },
  ];

  it("현재 단계는 단계 순서상 가장 늦은 기록이고, 그 앞은 지난 단계·뒤는 예정 단계다", () => {
    const { container } = render(<ProjectStageTimeline stages={stages} />);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("project-stage-timeline");
    const states = [...container.querySelectorAll("ol > li")].map((li) => li.getAttribute("data-stage-state"));
    expect(states).toEqual(["past", "past", "current", "upcoming", "upcoming", "upcoming"]);
    const items = container.querySelectorAll("ol > li");
    expect(within(items[2] as HTMLElement).getByText("현재 단계")).toBeTruthy();
    expect(within(items[0] as HTMLElement).getByText("지난 단계")).toBeTruthy();
    expect(within(items[3] as HTMLElement).getByText("예정 단계")).toBeTruthy();
  });

  it("지난 단계와 현재 단계의 원은 채우고(navy-900), 예정 단계는 비운다", () => {
    const { container } = render(<ProjectStageTimeline stages={stages} />);
    const circles = [...container.querySelectorAll("[data-stage-circle]")];
    expect(circles.slice(0, 3).every((c) => cls(c).includes("bg-navy-900"))).toBe(true);
    expect(circles.slice(3).some((c) => cls(c).includes("bg-navy-900"))).toBe(false);
  });

  it("단계 기록마다 고시 번호·고시일·확인일(고정폭)과 원문 보기(새 창)", () => {
    const { container } = render(<ProjectStageTimeline stages={stages} />);
    const first = container.querySelectorAll("ol > li")[0] as HTMLElement;
    expect(cls(within(first).getByText("제2024-101호"))).toContain("font-mono");
    expect(cls(within(first).getByText("2024-03-14"))).toContain("font-mono");
    expect(cls(within(first).getByText("2026-10-13"))).toContain("font-mono");
    const link = within(first).getByRole("link", { name: /원문 보기/ });
    expect(link.getAttribute("href")).toBe("https://www.example.go.kr/gosi/제2024-101호");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("고시 번호나 원문이 빠진 기록은 단계 기록으로 치지 않는다 — 현재 단계가 앞으로 온다", () => {
    const broken = stages.map((s, i) => (i === 2 ? { ...s, record: { ...s.record!, noticeNo: "" } } : s));
    const { container } = render(<ProjectStageTimeline stages={broken} />);
    const states = [...container.querySelectorAll("ol > li")].map((li) => li.getAttribute("data-stage-state"));
    expect(states).toEqual(["past", "current", "upcoming", "upcoming", "upcoming", "upcoming"]);
    expect(screen.queryByText("제2026-210호")).toBeNull();
  });

  it("공공누리 유형 글자는 기록에 있을 때만 · 해당 없음 단계는 상태 글자 대신 '해당 없음'(표도 같다), 기록이 있으면 기록이 앞선다 (W4 15단계)", () => {
    const withExtra: ProjectStage[] = stages.map((s, i) =>
      i === 0 ? { ...s, record: { ...s.record!, license: "공공누리 제1유형(출처표시)" } } : i === 3 ? { ...s, notApplicable: true } : i === 1 ? { ...s, notApplicable: true } : s,
    );
    const { container } = render(<ProjectStageTimeline stages={withExtra} />);
    const items = [...container.querySelectorAll("ol > li")] as HTMLElement[];
    expect(within(items[0]!).getByText("공공누리 제1유형(출처표시)")).toBeTruthy();
    expect(within(items[0]!).getByText("공공누리")).toBeTruthy();
    expect(within(items[2]!).queryByText("공공누리")).toBeNull();
    expect(items.map((li) => li.hasAttribute("data-stage-na"))).toEqual([false, false, false, true, false, false]);
    expect(within(items[3]!).getByText("해당 없음")).toBeTruthy();
    expect(within(items[3]!).queryByText("예정 단계")).toBeNull();
    expect(within(items[1]!).getByText("지난 단계")).toBeTruthy();
    const cells = [...container.querySelectorAll("tbody tr")].map((tr) => tr.children[1]!.textContent);
    expect(cells).toEqual(["지난 단계", "지난 단계", "현재 단계", "해당 없음", "예정 단계", "예정 단계"]);
  });

  it("공개 단계 기록이 하나도 없으면 그리지 않는다", () => {
    const { container } = render(<ProjectStageTimeline stages={[{ name: "구역지정" }, { name: "준공" }]} />);
    expect(container.innerHTML).toBe("");
  });

  it("「지방세로 읽기」 한 줄은 감수 문장이 있는 단계에만 — '준비 중' 0", () => {
    const { container } = render(<ProjectStageTimeline stages={stages} />);
    const lens = [...container.querySelectorAll("ol > li")].map((li) => li.querySelector("[data-tax-lens]")?.textContent ?? null);
    expect(lens).toEqual([
      "지방세로 읽기 구역지정만으로는 취득세가 생기지 않습니다.",
      null,
      "지방세로 읽기 사업시행인가 뒤 종전 자산 평가를 확인합니다.",
      null,
      null,
      "지방세로 읽기 준공 뒤 새 집의 취득세 신고 기한을 확인합니다.",
    ]);
    expect(container.textContent).not.toContain("준비 중");
  });

  it("가격·분양가·분담금·수익률·시세 요소가 없다 — 넘겨도 보이지 않는다", () => {
    const withPrice = stages.map((s) => ({ ...s, price: "분양가 3.3㎡당 4,800만원", contribution: "분담금 2억원", yield: "수익률 12%" })) as ProjectStage[];
    const { container } = render(<ProjectStageTimeline stages={withPrice} />);
    expect(container.textContent).not.toMatch(/분양가|분담금|수익률|가격|시세|4,800만원|2억원|12%/);
  });

  it("같은 내용의 표 — 단계마다 한 행, 단계·상태·고시·확인일", () => {
    render(<ProjectStageTimeline stages={stages} />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.length).toBe(6);
    expect(within(rows[2]).getByText("사업시행인가")).toBeTruthy();
    expect(within(rows[2]).getByText("현재 단계")).toBeTruthy();
    expect(within(rows[2]).getByText(/제2026-210호/)).toBeTruthy();
    expect(within(rows[3]).getByText("예정 단계")).toBeTruthy();
  });

  it("단계 카드 아래 덧붙임(after — 단계별 「지방세로 읽기」 박스 자리, W4 16단계)은 준 단계에만, 표에는 넣지 않는다", () => {
    const withAfter: ProjectStage[] = stages.map((s, i) => (i === 1 ? { ...s, after: <p data-testid="lens-slot">시험용 박스 자리</p> } : s));
    const { container } = render(<ProjectStageTimeline stages={withAfter} />);
    const items = [...container.querySelectorAll("ol > li")];
    expect(items.map((li) => li.querySelectorAll("[data-stage-after]").length)).toEqual([0, 1, 0, 0, 0, 0]);
    expect(within(items[1] as HTMLElement).getByTestId("lens-slot").closest("[data-stage-after]")).not.toBeNull();
    expect(container.querySelector("table")!.textContent).not.toContain("시험용 박스 자리");
  });

  it("원문을 다시 받아 내용이 달라진 단계는 '검토 중'을 보인다", () => {
    const review = stages.map((s, i) => (i === 0 ? { ...s, record: { ...s.record!, underReview: true } } : s));
    const { container } = render(<ProjectStageTimeline stages={review} />);
    expect(within(container.querySelectorAll("ol > li")[0] as HTMLElement).getByText("검토 중")).toBeTruthy();
  });
});

describe("개발방법 비교표 (PR-09·PR-10·PR-11)", () => {
  const fact = (label: string, value: string, unit: string) => ({ label, value, unit, article: "도시정비법 제35조", basisDate: "2026-10-01", reviewer: "감수자 A" });
  const entry = (name: string): DevMethodEntry => ({
    law: `${name} 근거 법률`,
    operator: `${name} 사업 주체`,
    target: `${name} 대상`,
    procedure: `${name} 주요 절차`,
    facts: [fact(`${name} 동의 요건`, "75", "%")],
    taxIssue: `${name} 지방세 쟁점`,
  });
  const ids: DevMethodId[] = ["redevelopment", "reconstruction", "small_scale", "public", "trust", "renewal", "speed_integrated"];
  const names = ["재개발", "재건축", "소규모정비", "공공 방식", "신탁방식", "재정비", "신속통합기획"];
  // 넘기는 순서를 일부러 거꾸로 한다 — 화면 순서는 고정 편집 순서여야 한다
  const all = Object.fromEntries([...ids].reverse().map((id) => [id, entry(names[ids.indexOf(id)])])) as Record<DevMethodId, DevMethodEntry>;
  const tableHeaders = () => within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent);

  it("위에 '추천하거나 판정하지 않습니다' 강조 문단을 둔다", () => {
    const { container } = render(<DevMethodComparison methods={all} />);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("dev-method-comparison");
    const callout = container.querySelector('[data-ui="callout"]')!;
    expect(callout.textContent).toContain("추천하거나 판정하지 않습니다");
    expect(callout.compareDocumentPosition(screen.getByRole("table")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("열은 7개 방법의 고정 편집 순서이고 신속통합기획 열에 '계획 지원 절차' 칩", () => {
    render(<DevMethodComparison methods={all} />);
    expect(tableHeaders()).toEqual(["비교 항목", "재개발", "재건축", "소규모정비", "공공 방식", "신탁방식", "재정비", "신속통합기획계획 지원 절차"]);
    const speed = within(screen.getByRole("table")).getAllByRole("columnheader")[7];
    expect(cls(within(speed).getByText("계획 지원 절차").closest('[data-ui="chip"]'))).toContain("rounded-md");
  });

  it("행은 근거 법령 · 사업 주체 · 대상 · 주요 절차 · 숫자 요건 · 지방세 쟁점", () => {
    render(<DevMethodComparison methods={all} />);
    expect(within(screen.getByRole("table")).getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["근거 법령", "사업 주체", "대상", "주요 절차", "숫자 요건", "지방세 쟁점"]);
  });

  it("숫자 요건 칸마다 값·단위·근거 조문·기준일·감수자를 고정폭으로", () => {
    render(<DevMethodComparison methods={{ redevelopment: entry("재개발") }} />);
    const table = screen.getByRole("table");
    expect(cls(within(table).getByText("75%"))).toContain("font-mono");
    const meta = within(table).getByText("도시정비법 제35조 · 기준일 2026-10-01 · 감수 감수자 A");
    expect(cls(meta)).toContain("font-mono");
  });

  it("기준일이나 감수자가 없는 숫자 요건은 그리지 않고, 그래서 숫자 요건이 비는 방법은 열째 빠진다 ('확인 중'으로 채우지 않는다)", () => {
    const partial = {
      ...all,
      trust: { ...entry("신탁방식"), facts: [{ ...fact("신탁 동의", "75", "%"), reviewer: "" }] },
      renewal: { ...entry("재정비"), facts: [fact("재정비 면적", "50", "만㎡"), { ...fact("재정비 기간", "3", "년"), basisDate: "" }] },
    };
    render(<DevMethodComparison methods={partial} />);
    expect(tableHeaders()).not.toContain("신탁방식");
    expect(within(screen.getByRole("table")).queryByText("3년")).toBeNull();
    expect(within(screen.getByRole("table")).getByText("50만㎡")).toBeTruthy();
    expect(screen.queryByText(/확인 중/)).toBeNull();
  });

  it("필수 비교 항목이 빈 방법은 공개하지 않는다", () => {
    render(<DevMethodComparison methods={{ ...all, public: { ...entry("공공 방식"), law: "" } }} />);
    expect(tableHeaders()).not.toContain("공공 방식");
    expect(tableHeaders().length).toBe(7);
  });

  it("모바일은 방법별 탭(같은 고정 순서) — 탭을 누르면 그 방법의 항목만 보인다, 가로 스크롤 없음", async () => {
    const { container } = render(<DevMethodComparison methods={all} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(names);
    await userEvent.click(screen.getByRole("tab", { name: "신탁방식" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("신탁방식 근거 법률")).toBeTruthy();
    expect(within(panel).queryByText("재개발 근거 법률")).toBeNull();
    expect(container.innerHTML).not.toMatch(/overflow-x|overflow-scroll|overflow-auto/);
    expect(cls(screen.getByRole("table").parentElement)).toContain("hidden");
    expect(cls(screen.getByRole("table").parentElement)).toContain("lg:block");
    expect(cls(screen.getByRole("tablist").closest("[data-dev-method-tabs]"))).toContain("lg:hidden");
  });

  it("추천·적합도 점수·'나에게 맞는 방법' 요소가 없다 — 입력 폼·점수·순위·정렬 버튼 0", () => {
    const { container } = render(<DevMethodComparison methods={all} />);
    expect(container.querySelectorAll("form, input, select, textarea, meter, progress").length).toBe(0);
    expect(screen.queryAllByRole("button").length).toBe(0);
    const callout = container.querySelector('[data-ui="callout"]')!;
    const rest = (container.textContent ?? "").replace(callout.textContent ?? "", "");
    expect(rest).not.toMatch(/추천|점수|순위|적합|맞는 방법|유리/);
  });
});

describe("신탁 구조도 (DF-01·DF-02, 8.9)", () => {
  const nodes: StructureNode[] = [
    { id: "truster", role: "위탁자", note: "토지 소유자", col: 0, row: 0, localTaxpayer: "재산세" },
    { id: "trustee", role: "수탁자", note: "신탁회사", col: 1, row: 0 },
    { id: "beneficiary", role: "수익자", note: "대주단 등", col: 2, row: 0 },
  ];
  const flows: StructureFlow[] = [
    { from: "truster", to: "trustee", kind: "right", label: "소유권 이전" },
    { from: "trustee", to: "beneficiary", kind: "money", label: "신탁 이익 지급" },
    { from: "beneficiary", to: "trustee", kind: "right", label: "수익권 행사" },
  ];

  it("인라인 SVG(이름 있는 그림) 상자에 역할 이름을, 화살표마다 돈·권리 흐름 라벨을 그린다", () => {
    const { container } = render(<TrustStructureDiagram title="담보신탁 구조" nodes={nodes} flows={flows} />);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("trust-structure-diagram");
    const svg = screen.getByRole("img", { name: "담보신탁 구조" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect([...svg.querySelectorAll("[data-node] [data-role]")].map((t) => t.textContent)).toEqual(["위탁자", "수탁자", "수익자"]);
    expect(svg.querySelectorAll("[data-flow]").length).toBe(3);
    expect([...svg.querySelectorAll("[data-flow-label]")].map((t) => t.textContent)).toEqual(["권리 · 소유권 이전", "돈 · 신탁 이익 지급", "권리 · 수익권 행사"]);
  });

  it("상자는 navy-100 테두리, 화살표는 navy-200 — 색은 토큰 클래스로만(hex 속성 0)", () => {
    const { container } = render(<TrustStructureDiagram title="담보신탁 구조" nodes={nodes} flows={flows} />);
    const svg = container.querySelector("svg")!;
    expect(cls(svg.querySelector("[data-node] rect"))).toContain("stroke-navy-100");
    expect(cls(svg.querySelector("[data-flow] line"))).toContain("stroke-navy-200");
    const colored = [...svg.querySelectorAll("*")].filter((el) => /#/.test(el.getAttribute("fill") ?? "") || /#/.test(el.getAttribute("stroke") ?? ""));
    expect(colored.length).toBe(0);
  });

  it("지방세 납세의무자에 `지방세` 배지 — 그림과 표 양쪽", () => {
    const { container } = render(<TrustStructureDiagram title="담보신탁 구조" nodes={nodes} flows={flows} />);
    const marked = [...container.querySelectorAll("svg [data-node]")].filter((g) => g.querySelector("[data-taxpayer]"));
    expect(marked.map((g) => g.querySelector("[data-role]")?.textContent)).toEqual(["위탁자"]);
    expect(within(marked[0] as HTMLElement).getByText("지방세")).toBeTruthy();
    const roles = screen.getByRole("table", { name: /역할/ });
    const row = within(roles).getByText("위탁자").closest("tr")!;
    expect(within(row).getByText("지방세")).toBeTruthy();
    expect(within(row).getByText("재산세 납세의무자")).toBeTruthy();
  });

  it("같은 내용의 표 — 역할 표는 상자마다, 흐름 표는 화살표마다 한 행", () => {
    render(<TrustStructureDiagram title="담보신탁 구조" nodes={nodes} flows={flows} />);
    expect(within(screen.getByRole("table", { name: /역할/ })).getAllByRole("row").length - 1).toBe(3);
    const flowTable = screen.getByRole("table", { name: /흐름/ });
    const rows = within(flowTable).getAllByRole("row").slice(1);
    expect(rows.map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent))).toEqual([
      ["위탁자", "수탁자", "권리", "소유권 이전"],
      ["수탁자", "수익자", "돈", "신탁 이익 지급"],
      ["수익자", "수탁자", "권리", "수익권 행사"],
    ]);
  });

  it("없는 상자를 가리키는 흐름은 그림과 표 어디에도 그리지 않는다", () => {
    const { container } = render(<TrustStructureDiagram title="담보신탁 구조" nodes={nodes} flows={[...flows, { from: "truster", to: "ghost", kind: "money", label: "없는 상대" }]} />);
    expect(container.querySelectorAll("svg [data-flow]").length).toBe(3);
    expect(screen.queryByText("없는 상대")).toBeNull();
  });

  it("같은 문법으로 PF 구조(시행사·대주단·시공사·신탁사 — 책임준공)도 그린다", () => {
    const pf: StructureNode[] = [
      { id: "developer", role: "시행사", col: 0, row: 0 },
      { id: "lenders", role: "대주단", col: 1, row: 0 },
      { id: "builder", role: "시공사", col: 0, row: 1 },
      { id: "trust", role: "신탁사", col: 1, row: 1, localTaxpayer: "취득세" },
    ];
    const pfFlows: StructureFlow[] = [
      { from: "lenders", to: "developer", kind: "money", label: "사업비 대출" },
      { from: "builder", to: "lenders", kind: "right", label: "책임준공 약정" },
      { from: "developer", to: "trust", kind: "right", label: "토지 신탁" },
    ];
    render(<TrustStructureDiagram title="부동산 PF 구조" nodes={pf} flows={pfFlows} />);
    const svg = screen.getByRole("img", { name: "부동산 PF 구조" });
    expect(svg.querySelectorAll("[data-node]").length).toBe(4);
    expect(within(svg as unknown as HTMLElement).getByText("권리 · 책임준공 약정")).toBeTruthy();
  });
});
