// 기사 카드 (PRD-00 8.6 · RP-04) — 분야 칩 · 제목 19px 900 · 요약 2줄 · 발행일 고정폭 · 지역 칩 · 기사 유형 배지 자리 · 형식 배지
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArticleCard, type ArticleFormat } from "./ArticleCard";

const BASE = {
  href: "/news/seongdong-redevelopment-tax",
  title: "성동구 재개발 구역, 관리처분인가 뒤 취득세는 언제 내나",
  summary: "관리처분인가가 나면 입주권을 사는 사람의 취득세 기준이 바뀝니다. 신고 기한과 준비할 서류를 정리했습니다.",
  section: "realestate" as const,
  publishedAt: "2026-10-14",
};

describe("기사 카드", () => {
  it("제목 링크 하나로 기사 상세에 가고 링크 이름은 제목이다 (카드 전체를 덮는 링크)", () => {
    render(<ArticleCard {...BASE} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(BASE.href);
    expect(links[0].textContent).toBe(BASE.title);
    expect(links[0].className).toContain("after:absolute");
    expect(links[0].className).toContain("after:inset-0");
  });

  it("제목은 19px 900, 요약은 2줄로 자른다", () => {
    render(<ArticleCard {...BASE} />);
    const heading = screen.getByRole("heading", { name: BASE.title });
    expect(heading.className).toContain("text-[19px]");
    expect(heading.className).toContain("font-black");
    expect(screen.getByText(BASE.summary).className).toContain("line-clamp-2");
  });

  it("분야 칩은 4대 분야 이름이고 하위 분야를 함께 쓸 수 있다", () => {
    const { rerender } = render(<ArticleCard {...BASE} />);
    expect(screen.getByText("부동산재테크").getAttribute("data-ui")).toBe("chip");
    rerender(<ArticleCard {...BASE} section="finance" subsection="신탁" />);
    expect(screen.getByText("부동산금융 › 신탁").getAttribute("data-ui")).toBe("chip");
  });

  it("발행일은 고정폭 <time>이고 datetime 값이 같다", () => {
    render(<ArticleCard {...BASE} />);
    const time = screen.getByText(BASE.publishedAt);
    expect(time.tagName.toLowerCase()).toBe("time");
    expect(time.getAttribute("datetime")).toBe(BASE.publishedAt);
    expect(time.className).toContain("font-mono");
  });

  it("수정일은 넘긴 화면에서만 '수정 ○○' 고정폭 <time>으로 — 없거나 발행일과 같으면 자리 0", () => {
    const { container, rerender } = render(<ArticleCard {...BASE} modifiedAt="2026-10-20" />);
    const mod = container.querySelector('[data-part="modified"]')!;
    expect(mod.tagName.toLowerCase()).toBe("time");
    expect(mod.textContent).toBe("수정 2026-10-20");
    expect(mod.getAttribute("datetime")).toBe("2026-10-20");
    expect(mod.className).toContain("font-mono");
    rerender(<ArticleCard {...BASE} />);
    expect(container.querySelector('[data-part="modified"]')).toBeNull();
    rerender(<ArticleCard {...BASE} modifiedAt={BASE.publishedAt} />);
    expect(container.querySelector('[data-part="modified"]')).toBeNull();
  });

  it("지역 칩은 지역이 있을 때만 보인다", () => {
    const { rerender } = render(<ArticleCard {...BASE} region="서울 성동구" />);
    expect(screen.getByText("서울 성동구").getAttribute("data-ui")).toBe("chip");
    rerender(<ArticleCard {...BASE} />);
    expect(screen.queryByText("서울 성동구")).toBeNull();
  });

  it("기사 유형 배지 자리(다른 묶음의 배지)를 그대로 보인다", () => {
    render(<ArticleCard {...BASE} typeBadge={<span data-ui="article-type-badge">보도</span>} />);
    expect(screen.getByText("보도").getAttribute("data-ui")).toBe("article-type-badge");
  });

  it.each([["카드뉴스"], ["동영상"], ["포토"], ["인포그래픽"]] as const)("형식이 %s이면 형식 배지가 같은 글자로 보인다", (format) => {
    const { container } = render(<ArticleCard {...BASE} format={format} />);
    const badge = container.querySelector("[data-format-badge]")!;
    expect(badge.textContent).toBe(format);
  });

  it("일반 형식이거나 형식이 없으면 형식 배지가 없다", () => {
    const { container, rerender } = render(<ArticleCard {...BASE} format="일반" />);
    expect(container.querySelector("[data-format-badge]")).toBeNull();
    rerender(<ArticleCard {...BASE} />);
    expect(container.querySelector("[data-format-badge]")).toBeNull();
  });

  it("형식 배지 값은 다섯 형식 밖의 글자를 받지 않는다 (tsc가 확인)", () => {
    // @ts-expect-error 형식은 일반·카드뉴스·동영상·포토·인포그래픽만
    const bad: ArticleFormat = "라이브";
    expect(bad).toBe("라이브");
  });

  it("기자명은 있을 때만 발행일 앞에 글자로 보이고(링크 아님), 공백뿐이면 자리가 없다", () => {
    const { container, rerender } = render(<ArticleCard {...BASE} byline="  김가온 기자 " />);
    const byline = container.querySelector('[data-part="byline"]')!;
    expect(byline.textContent).toBe("김가온 기자");
    expect(byline.closest("a")).toBeNull();
    expect(byline.compareDocumentPosition(screen.getByText(BASE.publishedAt)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    rerender(<ArticleCard {...BASE} byline="   " />);
    expect(container.querySelector('[data-part="byline"]')).toBeNull();
    rerender(<ArticleCard {...BASE} />);
    expect(container.querySelector('[data-part="byline"]')).toBeNull();
  });

  it("루트는 article 요소이고 data-ui=article-card, 호버 때 hermes-400 테두리", () => {
    const { container } = render(<ArticleCard {...BASE} />);
    const root = container.firstElementChild!;
    expect(root.tagName.toLowerCase()).toBe("article");
    expect(root.getAttribute("data-ui")).toBe("article-card");
    expect(root.className).toContain("hover:border-hermes-400");
    expect(root.className).toContain("relative");
  });
});
