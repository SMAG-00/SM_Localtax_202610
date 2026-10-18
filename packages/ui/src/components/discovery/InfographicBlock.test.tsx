// 인포그래픽 블록 (PRD-00 8.6 · 8.9, PRD-01A ART-07) — 이미지 + 같은 내용의 표·목록(접어 두기) + 대체 텍스트 필수
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InfographicBlock } from "./InfographicBlock";

const IMAGE = {
  src: "/media/acquisition-steps.png",
  alt: "취득세 신고 순서: 잔금 지급, 60일 안에 신고, 납부 순서로 진행",
  width: 1200,
  height: 900,
};
const TABLE = {
  kind: "table" as const,
  caption: "취득세 신고 순서",
  columns: ["순서", "할 일", "기한"],
  rows: [
    ["1", "잔금 지급", "계약서의 잔금일"],
    ["2", "취득세 신고", "잔금일부터 60일 안"],
    ["3", "취득세 납부", "신고와 함께"],
  ],
};

describe("인포그래픽 블록", () => {
  it("이미지에 대체 텍스트가 붙고 원본 비율 그대로 줄인다 (자르지 않음)", () => {
    render(<InfographicBlock title="취득세 신고 순서" image={IMAGE} data={TABLE} />);
    const img = screen.getByRole("img", { name: IMAGE.alt });
    expect(img.getAttribute("width")).toBe("1200");
    expect(img.getAttribute("height")).toBe("900");
    expect(img.className).toContain("h-auto");
    expect(img.className).toContain("w-full");
    expect(img.className).not.toContain("object-cover");
  });

  it("같은 내용의 표는 기본으로 접혀 있고, 누르면 펼쳐진다", async () => {
    const { container } = render(<InfographicBlock title="취득세 신고 순서" image={IMAGE} data={TABLE} />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    const summary = details.querySelector("summary")!;
    expect(screen.getByText("같은 내용 표로 보기").closest("summary")).toBe(summary);
    // 펼침 표시(▸)는 그림 글자라 화면 읽기에서 뺀다
    expect(summary.querySelector('[aria-hidden="true"]')!.textContent).toBe("▸");
    expect(summary.className).toContain("min-h-11");
    await userEvent.click(summary);
    expect(details.open).toBe(true);
  });

  it("표에는 캡션·열 머리(scope=col)·행 머리(scope=row)와 모든 칸이 그대로 있다", () => {
    render(<InfographicBlock title="취득세 신고 순서" image={IMAGE} data={TABLE} />);
    const table = screen.getByRole("table", { name: "취득세 신고 순서" });
    const cols = within(table).getAllByRole("columnheader");
    expect(cols.map((c) => c.textContent)).toEqual(["순서", "할 일", "기한"]);
    expect(cols.every((c) => c.getAttribute("scope") === "col")).toBe(true);
    const rowHeads = within(table).getAllByRole("rowheader");
    expect(rowHeads.map((c) => c.textContent)).toEqual(["1", "2", "3"]);
    expect(within(table).getByText("잔금일부터 60일 안")).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(4);
  });

  it("목록형 자료는 같은 내용의 목록으로 보인다", () => {
    render(
      <InfographicBlock
        title="재산세 납부 시기"
        image={{ ...IMAGE, alt: "재산세는 7월과 9월에 나누어 냅니다" }}
        data={{ kind: "list", items: ["7월: 건축물·주택 절반", "9월: 토지·주택 나머지 절반"] }}
      />,
    );
    expect(screen.getByText("같은 내용 목록으로 보기")).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["7월: 건축물·주택 절반", "9월: 토지·주택 나머지 절반"]);
  });

  it("제목은 그림 설명(figcaption)으로 이어진다", () => {
    render(<InfographicBlock title="취득세 신고 순서" image={IMAGE} data={TABLE} />);
    const figure = screen.getByRole("figure", { name: "취득세 신고 순서" });
    expect(figure.getAttribute("data-ui")).toBe("infographic-block");
  });

  it("대체 텍스트가 비었거나 공백뿐이면 블록을 렌더하지 않는다", () => {
    const { container, rerender } = render(<InfographicBlock title="t" image={{ ...IMAGE, alt: "" }} data={TABLE} />);
    expect(container.innerHTML).toBe("");
    rerender(<InfographicBlock title="t" image={{ ...IMAGE, alt: "   " }} data={TABLE} />);
    expect(container.innerHTML).toBe("");
  });

  it("같은 내용의 표·목록이 비면(0행·0항목) 블록을 렌더하지 않는다", () => {
    const { container, rerender } = render(<InfographicBlock title="t" image={IMAGE} data={{ ...TABLE, rows: [] }} />);
    expect(container.innerHTML).toBe("");
    rerender(<InfographicBlock title="t" image={IMAGE} data={{ kind: "list", items: [] }} />);
    expect(container.innerHTML).toBe("");
  });

  it("절차 흐름(차례 있는 목록)은 번호 목록(ol)으로, 그 밖의 목록은 점 목록(ul)으로", () => {
    const { container, rerender } = render(<InfographicBlock title="t" image={IMAGE} data={{ kind: "list", items: ["계약", "잔금", "신고"], ordered: true }} template="flow" />);
    expect(container.querySelector("ol")!.className).toContain("list-decimal");
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector("figure")!.getAttribute("data-template")).toBe("flow");
    rerender(<InfographicBlock title="t" image={IMAGE} data={{ kind: "list", items: ["계약"] }} />);
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("ol")).toBeNull();
  });

  it("단위·출처 줄은 그림 아래(표 밖)에 있을 때만, 빈 줄은 빼고", () => {
    const { container, rerender } = render(<InfographicBlock title="t" image={IMAGE} data={TABLE} notes={["단위 건", " ", "그림 편집국"]} />);
    const notes = container.querySelector('[data-part="infographic-notes"]')!;
    expect([...notes.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["단위 건", "그림 편집국"]);
    expect(notes.closest("details")).toBeNull();
    rerender(<InfographicBlock title="t" image={IMAGE} data={TABLE} />);
    expect(container.querySelector('[data-part="infographic-notes"]')).toBeNull();
  });

  it("이미지 크기를 모르면 width·height 없이 원본 비율로 줄인다", () => {
    const { container } = render(<InfographicBlock title="t" image={{ src: IMAGE.src, alt: IMAGE.alt }} data={TABLE} />);
    const img = container.querySelector("img")!;
    expect(img.hasAttribute("width")).toBe(false);
    expect(img.className).toContain("h-auto");
  });

  it("표는 표 안에서만 가로로 밀린다 (화면 가로 스크롤 0)", () => {
    const { container } = render(<InfographicBlock title="t" image={IMAGE} data={TABLE} />);
    expect(container.querySelector("table")!.parentElement!.className).toContain("overflow-x-auto");
  });

  it("대체 텍스트를 빼면 타입 검사가 실패한다 (tsc가 확인)", () => {
    const image = { src: IMAGE.src, width: 10, height: 10 };
    // @ts-expect-error image.alt는 필수다 (ART-07)
    const element = <InfographicBlock title="t" image={image} data={TABLE} />;
    expect(element.props.image).not.toHaveProperty("alt");
  });

  it("같은 내용 자료(data)를 빼면 타입 검사가 실패한다 (tsc가 확인)", () => {
    // @ts-expect-error data는 필수다 — 그림만으로 정보를 전하지 않는다 (8.9)
    const element = <InfographicBlock title="t" image={IMAGE} />;
    expect(element.props).not.toHaveProperty("data");
  });
});
