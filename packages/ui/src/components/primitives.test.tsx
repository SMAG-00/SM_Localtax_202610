// SM에서 그대로 가져오는 기본 컴포넌트 12종 (PRD-00 8.6) — 실제로 렌더하고 사용자 동작으로 확인한다
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrimaryButton, SecondaryButton, DarkButton } from "./Button";
import { LinkCard, ToolCard } from "./Card";
import { Eyebrow } from "./Eyebrow";
import { Chip } from "./Chip";
import { Callout } from "./Callout";
import { Tabs, TabNav } from "./Tabs";
import { StatusBox } from "./StatusBox";
import { LockBadge } from "./LockBadge";
import { RulesetLabel } from "./RulesetLabel";

const cls = (el: Element) => el.getAttribute("class") ?? "";

describe("버튼 3종", () => {
  it("주 버튼은 navy-900 글자 + hermes-500 바탕이고 R2 계수용 표식(data-ui=primary-button)이 있다", () => {
    render(<PrimaryButton>검색하기</PrimaryButton>);
    const b = screen.getByRole("button", { name: "검색하기" });
    expect(b.getAttribute("data-ui")).toBe("primary-button");
    expect(cls(b)).toContain("bg-hermes-500");
    expect(cls(b)).toContain("text-navy-900");
    expect(cls(b)).not.toContain("text-white");
    expect(b.getAttribute("type")).toBe("button");
  });

  it("주 버튼에 href를 주면 링크로 렌더한다 (버튼 역할 아님)", () => {
    render(<PrimaryButton href="/search">검색하기</PrimaryButton>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "검색하기" }).getAttribute("href")).toBe("/search");
  });

  it("주 버튼 submit 유형을 지정할 수 있다", () => {
    render(<PrimaryButton type="submit">보내기</PrimaryButton>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });

  it("보조 버튼(어두운 바탕)과 어두운 버튼은 주 버튼 표식을 갖지 않는다", () => {
    render(
      <>
        <SecondaryButton>더 보기</SecondaryButton>
        <DarkButton>환급금 조회</DarkButton>
      </>,
    );
    expect(document.querySelectorAll('[data-ui="primary-button"]').length).toBe(0);
    expect(cls(screen.getByRole("button", { name: "더 보기" }))).toContain("border-navy-500");
    expect(cls(screen.getByRole("button", { name: "환급금 조회" }))).toContain("bg-navy-900");
  });

  it("비활성 주 버튼은 눌러도 동작하지 않는다", async () => {
    let clicked = 0;
    render(
      <PrimaryButton disabled onClick={() => clicked++}>
        요청 보내기
      </PrimaryButton>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(clicked).toBe(0);
  });
});

describe("카드 2종", () => {
  it("링크 카드는 카드 전체가 하나의 링크다", () => {
    render(<LinkCard href="/tax">지방세</LinkCard>);
    const a = screen.getByRole("link", { name: /지방세/ });
    expect(a.getAttribute("data-ui")).toBe("link-card");
    expect(cls(a)).toContain("rounded-2xl");
    expect(cls(a)).toContain("hover:border-hermes-400");
  });

  it("새 창 링크 카드는 rel=noopener noreferrer와 '새 창' 안내를 갖는다", () => {
    render(
      <LinkCard href="https://example.org/" external>
        외부 자료
      </LinkCard>,
    );
    const a = screen.getByRole("link", { name: /새 창/ });
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("도구 카드는 호버 시 위로 0.5만큼 뜨고 navy-900 테두리", () => {
    render(<ToolCard href="/calc">취득세</ToolCard>);
    const a = screen.getByRole("link", { name: "취득세" });
    expect(a.getAttribute("data-ui")).toBe("tool-card");
    expect(cls(a)).toContain("hover:-translate-y-0.5");
    expect(cls(a)).toContain("hover:border-navy-900");
  });
});

describe("글자 요소", () => {
  it("아이브로는 밝은 바탕에서 hermes-800, 어두운 바탕에서 hermes-400이고 앞에 오렌지 선", () => {
    const { rerender, container } = render(<Eyebrow>LOCAL TAX</Eyebrow>);
    expect(cls(screen.getByText("LOCAL TAX").closest("[data-ui]")!)).toContain("text-hermes-800");
    expect(container.querySelector(".bg-hermes-500")?.getAttribute("aria-hidden")).toBe("true");
    rerender(<Eyebrow tone="dark">LOCAL TAX</Eyebrow>);
    expect(cls(screen.getByText("LOCAL TAX").closest("[data-ui]")!)).toContain("text-hermes-400");
  });

  it("칩·강조 문단·잠금 배지·룰셋 라벨이 SM 규칙 클래스로 렌더된다", () => {
    render(
      <>
        <Chip>지방세법 §11</Chip>
        <Callout>핵심만 먼저 보세요</Callout>
        <LockBadge>구독 전용</LockBadge>
        <RulesetLabel version="2026.10" />
      </>,
    );
    expect(cls(screen.getByText("지방세법 §11"))).toContain("text-navy-700");
    expect(cls(screen.getByText("핵심만 먼저 보세요"))).toContain("border-hermes-500");
    expect(cls(screen.getByText("구독 전용"))).toContain("text-hermes-300");
    const label = screen.getByText("적용 룰셋 2026.10");
    expect(cls(label)).toContain("font-mono");
  });
});

describe("탭", () => {
  const items = [
    { id: "all", label: "전체", panel: <p>전체 목록</p> },
    { id: "tax", label: "지방세", panel: <p>지방세 목록</p> },
    { id: "fin", label: "지방재정", panel: <p>지방재정 목록</p> },
  ];

  it("탭을 누르면 그 탭이 선택되고 해당 패널만 보인다", async () => {
    render(<Tabs label="분야" items={items} />);
    expect(screen.getByRole("tab", { name: "전체" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("tab", { name: "지방세" }));
    expect(screen.getByRole("tab", { name: "지방세" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("지방세 목록");
  });

  it("방향키로 탭을 옮기고 끝에서 처음으로 돈다 (키보드 접근)", async () => {
    render(<Tabs label="분야" items={items} />);
    screen.getByRole("tab", { name: "전체" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement?.textContent).toBe("지방세");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(document.activeElement?.textContent).toBe("전체");
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement?.textContent).toBe("지방재정");
  });

  it("활성 탭은 hermes-500 밑줄 3px, 비활성은 navy-400", () => {
    render(<Tabs label="분야" items={items} />);
    expect(cls(screen.getByRole("tab", { name: "전체" }))).toContain("border-hermes-500");
    expect(cls(screen.getByRole("tab", { name: "지방세" }))).toContain("text-navy-400");
  });

  it("링크 탭(TabNav)은 서버 렌더 링크 — 현재 항목에 aria-current=page (JS 없이 동작)", () => {
    render(
      <TabNav
        label="분야 필터"
        current="local_tax"
        items={[
          { id: "all", label: "전체", href: "/local/seoul" },
          { id: "local_tax", label: "지방세", href: "/local/seoul?topic=local_tax" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "지방세" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "전체" }).getAttribute("aria-current")).toBeNull();
  });
});

describe("상태 상자", () => {
  it("절세 체크포인트는 emerald, 자주 틀리는 점은 rose이고 제목 글자로도 구분한다", () => {
    render(
      <>
        <StatusBox kind="tip" title="절세 체크포인트">
          60일 안에 신고
        </StatusBox>
        <StatusBox kind="mistake" title="자주 틀리는 점">
          잔금일 기준
        </StatusBox>
      </>,
    );
    const tip = screen.getByText("절세 체크포인트").closest("[data-ui]")!;
    const mistake = screen.getByText("자주 틀리는 점").closest("[data-ui]")!;
    expect(cls(tip)).toContain("bg-emerald-50");
    expect(cls(mistake)).toContain("bg-rose-50");
  });
});
