// services 묶음 — 사람 소개 (PRD-00 8.6: 전문가 카드 · 인물 페이지 머리)
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ExpertCard, type ExpertCardProps } from "./ExpertCard";
import { PersonHeader, type PersonHeaderProps } from "./PersonHeader";

const cls = (el: Element | null | undefined) => el?.getAttribute("class") ?? "";

describe("전문가 카드 (EXPL-02 · EXPL-03 · EXPL-04 · EXPL-07)", () => {
  const expert: ExpertCardProps = {
    name: "홍길동",
    slug: "hong-gildong",
    category: "tax-accountant",
    fields: ["지방세", "상속·증여"],
    affiliation: "길동세무회계",
    region: "서울",
    registrationNo: "제12345호",
    checkedAt: "2026-09-30",
    relations: ["월간지방세연구 필진"],
    interest: "이 플랫폼에 원고를 쓰고 원고료를 받습니다",
    verification: "verified",
  };

  it("카드 전체가 인물 페이지로 가는 링크 하나 — 이름(19px 900)·분류·전문 분야·소속·지역", () => {
    render(<ExpertCard {...expert} />);
    const root = document.querySelector('[data-ui="expert-card"]')!;
    expect(root.querySelectorAll("a").length).toBe(1);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/people/hong-gildong");
    const name = root.querySelector('[data-part="name"]')!;
    expect(name.textContent).toBe("홍길동");
    expect(cls(name)).toContain("text-[19px]");
    expect(cls(name)).toContain("font-black");
    const chips = Array.from(root.querySelectorAll('[data-ui="chip"]')).map((c) => c.textContent);
    expect(chips).toEqual(expect.arrayContaining(["세무사", "지방세", "상속·증여", "월간지방세연구 필진"]));
    expect(root.textContent).toContain("길동세무회계");
    expect(root.textContent).toContain("서울");
  });

  it("등록번호·확인일은 고정폭, 이해관계 한 줄을 보인다", () => {
    render(<ExpertCard {...expert} />);
    const root = document.querySelector('[data-ui="expert-card"]')!;
    const mono = root.querySelector("time")!.parentElement!;
    expect(cls(mono)).toContain("font-mono");
    expect(mono.textContent).toBe("등록번호 제12345호 · 확인일 2026-09-30");
    expect(root.textContent).toContain("이해관계: 이 플랫폼에 원고를 쓰고 원고료를 받습니다");
  });

  it.each([
    ["tax-accountant", "세무사"],
    ["cpa", "공인회계사"],
    ["lawyer", "변호사"],
    ["judicial-scrivener", "법무사"],
    ["real-estate", "부동산 전문가"],
  ] as const)("분류 %s → 칩 '%s'", (category, label) => {
    render(<ExpertCard {...expert} category={category} />);
    expect(document.querySelector('[data-ui="expert-card"] [data-ui="chip"]')!.textContent).toBe(label);
  });

  it("별점·후기·순위 숫자·'추천' 배지가 없다 — 데이터에 평점·후기 값이 섞여 와도 렌더 0", () => {
    const stray = { rating: 4.8, reviewCount: 37, rank: 1, badge: "추천" } as object;
    const { container } = render(<ExpertCard {...expert} {...stray} />);
    const text = container.textContent ?? "";
    for (const word of ["별점", "후기", "평점", "순위", "추천", "1위", "4.8", "37"]) expect(text).not.toContain(word);
    // 별 모양 글자(U+2605·U+2606) 0 — 린트가 원문 기호를 막으므로 코드 포인트로 쓴다
    for (const star of [0x2605, 0x2606]) expect(text).not.toContain(String.fromCodePoint(star));
    expect(container.querySelectorAll('meter, progress, [role="meter"], [aria-label*="별점"]').length).toBe(0);
  });

  it.each(["pending", "expired", "revoked"] as const)("검증 상태 %s 프로필은 렌더하지 않는다 (미검증 노출 0)", (verification) => {
    expect(render(<ExpertCard {...expert} verification={verification} />).container.innerHTML).toBe("");
  });

  it("필수 항목(이름·소속·분야·확인일)이 비면 렌더하지 않는다", () => {
    expect(render(<ExpertCard {...expert} affiliation=" " />).container.innerHTML).toBe("");
    expect(render(<ExpertCard {...expert} fields={[]} />).container.innerHTML).toBe("");
    expect(render(<ExpertCard {...expert} checkedAt="" />).container.innerHTML).toBe("");
    expect(render(<ExpertCard {...expert} name="" />).container.innerHTML).toBe("");
  });

  it("선택 항목(지역·등록번호·자사 관계·이해관계)이 없어도 렌더하고 빈 줄을 만들지 않는다", () => {
    render(<ExpertCard {...expert} region={undefined} registrationNo={undefined} relations={undefined} interest={undefined} />);
    const root = document.querySelector('[data-ui="expert-card"]')!;
    expect(root.textContent).not.toContain("이해관계");
    expect(root.textContent).not.toContain("등록번호");
    expect(root.querySelector("time")!.parentElement!.textContent).toBe("확인일 2026-09-30");
  });
});

describe("인물 페이지 머리 (BR-02 · BR-07 · EXPL-02)", () => {
  const person: PersonHeaderProps = {
    name: "홍길동",
    roles: ["writer", "reviewer"],
    affiliation: "월간지방세연구",
    checkedAt: "2026-10-01",
    bio: [
      { id: "b1", text: "행정안전부 지방세 정책 자문위원", evidenceId: "ev-101" },
      { id: "b2", text: "세무 경력 50년", evidenceId: null },
      { id: "b3", text: "지방세 실무 강의", evidenceId: "ev-102" },
      { id: "b4", text: "국내 최고 지방세 권위자" },
    ],
  };

  it("이름은 섹션 제목 크기(28→32px 900) h1, 역할 칩·소속·확인일(고정폭)을 보인다", () => {
    render(<PersonHeader {...person} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("홍길동");
    expect(cls(h1)).toContain("text-[28px]");
    expect(cls(h1)).toContain("sm:text-[32px]");
    expect(cls(h1)).toContain("font-black");
    const root = document.querySelector('[data-ui="person-header"]')!;
    expect(Array.from(root.querySelectorAll('[data-ui="chip"]')).map((c) => c.textContent)).toEqual(["필자", "감수자"]);
    expect(root.textContent).toContain("월간지방세연구");
    expect(cls(root.querySelector("time")?.parentElement)).toContain("font-mono");
  });

  it("증빙 기록이 없는 약력 항목은 렌더하지 않는다 — '50년' 같은 숫자·직함 포함", () => {
    render(<PersonHeader {...person} />);
    const list = screen.getByRole("list", { name: "검증된 약력" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["행정안전부 지방세 정책 자문위원", "지방세 실무 강의"]);
    const text = document.querySelector('[data-ui="person-header"]')!.textContent ?? "";
    expect(text).not.toContain("50년");
    expect(text).not.toContain("권위자");
  });

  it("증빙된 약력이 하나도 없으면 약력 목록과 제목을 만들지 않는다", () => {
    render(<PersonHeader {...person} bio={[{ id: "x", text: "세무 경력 50년", evidenceId: "  " }]} />);
    expect(screen.queryByRole("list", { name: "검증된 약력" })).toBeNull();
    expect(document.querySelector('[data-ui="person-header"]')!.textContent).not.toContain("약력");
  });

  it("사진은 동의·권리 기록이 있을 때만 — 없으면 픽토그램 자리를 둔다", () => {
    const { unmount } = render(<PersonHeader {...person} photo={{ src: "/people/hong.jpg", alt: "홍길동 사진", rightsRecordId: "consent-7" }} />);
    expect(screen.getByRole("img", { name: "홍길동 사진" }).getAttribute("src")).toBe("/people/hong.jpg");
    unmount();
    render(<PersonHeader {...person} photo={{ src: "/people/hong.jpg", alt: "홍길동 사진", rightsRecordId: null }} placeholder={<svg data-testid="pictogram" />} />);
    expect(screen.queryByRole("img", { name: "홍길동 사진" })).toBeNull();
    expect(document.querySelector('img[src="/people/hong.jpg"]')).toBeNull();
    expect(screen.getByTestId("pictogram").closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("저서의 상품 링크는 '자사 상품'을 글자로 밝힌다", () => {
    render(
      <PersonHeader
        {...person}
        books={[
          { id: "k1", title: "지방세 실무", edition: "제5판", publisher: "선명출판", year: 2026, productHref: "/store/books/local-tax-practice" },
          { id: "k2", title: "지방세 편람", publisher: "선명출판", year: 2025 },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /자사 상품/ });
    expect(link.getAttribute("href")).toBe("/store/books/local-tax-practice");
    expect(link.textContent).toContain("지방세 실무");
    const items = within(screen.getByRole("list", { name: "저서" })).getAllByRole("listitem");
    expect(items[0].textContent).toContain("「지방세 실무」 제5판 · 선명출판 · 2026");
    expect(within(items[1]).queryByRole("link")).toBeNull();
  });
});
