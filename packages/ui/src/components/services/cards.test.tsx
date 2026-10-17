// services 묶음 — 스토어·계산기 연결 카드 (PRD-00 8.6: 상품 카드 · 외부 계산기 연결 카드 · SM 계산기 카드)
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { brand } from "../../brand";
import { isCleanExternalUrl, pickOfficialLink, type OfficialLink } from "./official-link";
import { ProductCard, type StoreProductCardProps } from "./ProductCard";
import { ExternalCalculatorCard } from "./ExternalCalculatorCard";
import { SmCalculatorCard, type SmCalcKey } from "./SmCalculatorCard";

const cls = (el: Element | null | undefined) => el?.getAttribute("class") ?? "";
const ok = (url: string, checkedAt = "2026-10-12"): OfficialLink => ({ url, status: "ok", checkedAt });

describe("계산기 연결 주소 검사 (TX-02 · FAM-08)", () => {
  it.each([
    ["https://calc.example.org/", true],
    ["https://calc.example.org/inherit", true],
    ["http://calc.example.org/inherit", true],
    ["https://calc.example.org/?a=1", false],
    ["https://calc.example.org/#x", false],
    ["https://calc.example.org/?", false],
    ["https://calc.example.org/#", false],
    ["javascript:alert(1)", false],
    ["/calc/acquisition", false],
    ["", false],
    [" https://calc.example.org/", false],
    ["https://user:pw@calc.example.org/", false],
    ["ftp://calc.example.org/", false],
  ])("%s → %s", (url, expected) => {
    expect(isCleanExternalUrl(url)).toBe(expected);
  });

  it("점검 실패(broken)·잘못된 주소면 대체 링크를, 대체도 못 쓰면 null을 고른다", () => {
    const fallback = ok("https://www.nts.go.kr/");
    expect(pickOfficialLink(ok("https://calc.example.org/"), fallback)).toEqual({ link: ok("https://calc.example.org/"), isFallback: false });
    expect(pickOfficialLink({ ...ok("https://calc.example.org/"), status: "unchecked" }, fallback)?.isFallback).toBe(false);
    expect(pickOfficialLink({ ...ok("https://calc.example.org/"), status: "broken" }, fallback)).toEqual({ link: fallback, isFallback: true });
    expect(pickOfficialLink(ok("https://calc.example.org/?ref=x"), fallback)?.isFallback).toBe(true);
    expect(pickOfficialLink({ ...ok("https://calc.example.org/"), status: "broken" }, { ...fallback, status: "broken" })).toBeNull();
  });
});

describe("외부 계산기 연결 카드 (FAM-08 · TX-02 · TX-03)", () => {
  const link = ok("https://inherit-calc.example.org/");
  const fallback = ok("https://www.nts.go.kr/inheritance", "2026-10-11");

  it("'국세' 표시·고정 제목·한 줄 안내·'별도 사이트 · 새 창'·링크 확인일(고정폭)을 보인다", () => {
    render(<ExternalCalculatorCard link={link} fallback={fallback} />);
    const card = document.querySelector('[data-ui="external-calculator-card"]')!;
    expect(card.textContent).toContain("국세");
    expect(screen.getByText("상속세·증여세 계산은 안심 상속증여계산기(별도 사이트)에서")).toBeTruthy();
    expect(card.textContent).toContain("이 사이트는 상속세·증여세를 계산하지 않습니다 · 입력한 내용은 넘어가지 않습니다");
    expect(card.textContent).toContain("별도 사이트 · 새 창");
    const date = card.querySelector("time")!;
    expect(date.textContent).toBe("2026-10-12");
    expect(cls(date.parentElement)).toContain("font-mono");
  });

  it("카드 전체가 하나의 새 창 링크 — 설정 주소와 글자 단위로 같고 aria-label에 '새 창에서 별도 사이트 열기'", () => {
    render(<ExternalCalculatorCard link={link} fallback={fallback} />);
    const card = document.querySelector('[data-ui="external-calculator-card"]')!;
    expect(card.querySelectorAll("a").length).toBe(1);
    const a = screen.getByRole("link", { name: /새 창에서 별도 사이트 열기/ });
    expect(a.getAttribute("href")).toBe("https://inherit-calc.example.org/");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("주 버튼이 아니고, 외부 화면을 끼워 넣지 않는다 (iframe 0)", () => {
    const { container } = render(<ExternalCalculatorCard link={link} fallback={fallback} />);
    expect(container.querySelectorAll('[data-ui="primary-button"]').length).toBe(0);
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("링크 점검이 실패하면 같은 자리에 국세청 공식 안내 링크를 보인다", () => {
    render(<ExternalCalculatorCard link={{ ...link, status: "broken" }} fallback={fallback} />);
    const card = document.querySelector('[data-ui="external-calculator-card"]')!;
    expect(card.getAttribute("data-state")).toBe("fallback");
    const a = screen.getByRole("link", { name: /국세청 공식 안내.*새 창에서 별도 사이트 열기/ });
    expect(a.getAttribute("href")).toBe("https://www.nts.go.kr/inheritance");
    expect(card.textContent).not.toContain("안심 상속증여계산기");
    expect(card.querySelector("time")?.textContent).toBe("2026-10-11");
  });

  it("주소에 쿼리·조각이 있으면 그 주소로 보내지 않는다 — 대체 안내로 바꾼다", () => {
    const q = render(<ExternalCalculatorCard link={ok("https://inherit-calc.example.org/?a=1")} fallback={fallback} />);
    expect(q.container.querySelector("a")?.getAttribute("href")).toBe("https://www.nts.go.kr/inheritance");
    q.unmount();
    const h = render(<ExternalCalculatorCard link={ok("https://inherit-calc.example.org/#x")} fallback={fallback} />);
    expect(h.container.querySelector("a")?.getAttribute("href")).toBe("https://www.nts.go.kr/inheritance");
  });

  it("대체 안내도 실패·잘못된 주소면 카드를 렌더하지 않는다 (빈 링크 0)", () => {
    expect(render(<ExternalCalculatorCard link={{ ...link, status: "broken" }} fallback={{ ...fallback, status: "broken" }} />).container.innerHTML).toBe("");
    expect(render(<ExternalCalculatorCard link={{ ...link, status: "broken" }} fallback={ok("https://www.nts.go.kr/?q=1")} />).container.innerHTML).toBe("");
  });

  it("아직 점검하지 않은(unchecked) 주소는 그대로 쓴다", () => {
    render(<ExternalCalculatorCard link={{ ...link, status: "unchecked" }} fallback={fallback} />);
    expect(document.querySelector('[data-ui="external-calculator-card"]')!.getAttribute("data-state")).toBe("primary");
  });
});

describe("SM 계산기 카드 (TX-01 · TX-02 · TX-06)", () => {
  const link = ok("https://sm-calc.example.org/calc/acquisition");
  const fallback = ok("https://www.wetax.go.kr/", "2026-10-10");
  const usageNote = "승인 회원만 이용할 수 있습니다 (확인 필요)";

  it.each<[SmCalcKey, string]>([
    ["acquisition", "취득세"],
    ["transfer", "양도세"],
    ["holding", "보유세"],
    ["oligopoly", "과점주주"],
    ["compare", "비교"],
  ])("%s 카드 이름은 '%s'", (calcKey, name) => {
    render(<SmCalculatorCard calcKey={calcKey} link={link} fallback={fallback} usageNote={usageNote} />);
    const title = document.querySelector('[data-ui="sm-calculator-card"] [data-part="title"]')!;
    expect(title.textContent).toBe(name);
    expect(cls(title)).toContain("text-[19px]");
    expect(cls(title)).toContain("font-black");
  });

  it("취득세 카드 — '지방세' 표시·사이트 이름(별도 사이트) · 새 창·이용 조건·링크 확인일, 카드 전체가 하나의 새 창 링크", () => {
    render(<SmCalculatorCard calcKey="acquisition" link={link} fallback={fallback} usageNote={usageNote} />);
    const card = document.querySelector('[data-ui="sm-calculator-card"]')!;
    expect(card.textContent).toContain("지방세");
    expect(card.textContent).not.toContain("국세");
    expect(card.textContent).toContain(`${brand.smCalculatorSiteName}(별도 사이트) · 새 창`);
    expect(card.textContent).toContain(usageNote);
    expect(card.querySelector("time")?.textContent).toBe("2026-10-12");
    expect(card.querySelectorAll("a").length).toBe(1);
    const a = screen.getByRole("link", { name: /새 창에서 별도 사이트 열기/ });
    expect(a.getAttribute("href")).toBe("https://sm-calc.example.org/calc/acquisition");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(card.querySelectorAll('[data-ui="primary-button"]').length).toBe(0);
    expect(card.textContent).not.toContain("양도소득세");
  });

  it("양도세 카드 — '국세' 표시와 '이 사이트는 양도소득세·지방소득세(양도소득분)를 계산하지 않습니다', SM 안의 양도세 메뉴로 안내한다", () => {
    render(<SmCalculatorCard calcKey="transfer" link={ok("https://sm-calc.example.org/transfer")} fallback={fallback} usageNote={usageNote} />);
    const card = document.querySelector('[data-ui="sm-calculator-card"]')!;
    expect(card.textContent).toContain("국세");
    expect(card.textContent).not.toContain("지방세");
    expect(card.textContent).toContain("이 사이트는 양도소득세·지방소득세(양도소득분)를 계산하지 않습니다");
    expect(screen.getByRole("link", { name: /양도세 메뉴/ }).getAttribute("href")).toBe("https://sm-calc.example.org/transfer");
    expect(card.textContent).not.toContain("양도세 계산기");
  });

  it("점검 실패면 같은 자리에 위택스 공식 안내, 대체도 실패면 카드를 숨긴다", () => {
    const { unmount } = render(<SmCalculatorCard calcKey="holding" link={{ ...link, status: "broken" }} fallback={fallback} usageNote={usageNote} />);
    const card = document.querySelector('[data-ui="sm-calculator-card"]')!;
    expect(card.getAttribute("data-state")).toBe("fallback");
    const a = screen.getByRole("link", { name: /위택스 공식 안내.*새 창에서 별도 사이트 열기/ });
    expect(a.getAttribute("href")).toBe("https://www.wetax.go.kr/");
    expect(card.textContent).not.toContain(brand.smCalculatorSiteName);
    expect(card.querySelector("time")?.textContent).toBe("2026-10-10");
    unmount();
    const hidden = render(<SmCalculatorCard calcKey="holding" link={{ ...link, status: "broken" }} fallback={{ ...fallback, status: "broken" }} usageNote={usageNote} />);
    expect(hidden.container.innerHTML).toBe("");
  });

  it("쿼리가 붙은 설정 주소는 쓰지 않는다 — 입력값 비전달 (TX-02)", () => {
    render(<SmCalculatorCard calcKey="acquisition" link={ok("https://sm-calc.example.org/calc/acquisition?price=700000000")} fallback={fallback} usageNote={usageNote} />);
    expect(document.querySelector("a")?.getAttribute("href")).toBe("https://www.wetax.go.kr/");
    expect(document.body.innerHTML).not.toContain("700000000");
  });
});

describe("상품 카드 (BIZ-01 · BIZ-02 · BIZ-03)", () => {
  const book: StoreProductCardProps = {
    name: "지방세 실무",
    audience: "지자체 세무 공무원·세무사",
    format: "book",
    verifiedAt: "2026-10-01",
    saleStatus: "on_sale",
    detailHref: "/store/books/local-tax-practice",
    order: { mode: "existing_channel", link: ok("https://books.example.org/local-tax-practice"), helpdeskHref: "/help" },
  };

  it("'교육·상품' 배지·이름(19px 900)·대상·형식·판매 확인일(고정폭)을 보인다", () => {
    render(<ProductCard {...book} />);
    const card = document.querySelector('[data-ui="product-card"]')!;
    expect(card.textContent).toContain("교육·상품");
    const name = card.querySelector('[data-part="name"]')!;
    expect(name.textContent).toBe("지방세 실무");
    expect(cls(name)).toContain("text-[19px]");
    expect(card.textContent).toContain("지자체 세무 공무원·세무사");
    expect(card.textContent).toContain("도서");
    expect(card.querySelector("time")?.textContent).toBe("2026-10-01");
    expect(cls(card.querySelector("time")?.parentElement)).toContain("font-mono");
  });

  it("기존 경로 주문은 어두운 버튼 [주문하러 가기](새 창)", () => {
    render(<ProductCard {...book} />);
    const a = screen.getByRole("link", { name: /주문하러 가기/ });
    expect(a.getAttribute("data-ui")).toBe("dark-button");
    expect(a.getAttribute("href")).toBe("https://books.example.org/local-tax-practice");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toContain("(새 창)");
  });

  it("사이트 신청 양식 주문은 같은 창 어두운 버튼 [신청하기]", () => {
    render(<ProductCard {...book} format="print-subscription" order={{ mode: "request_form", href: "/store/subscription/apply" }} />);
    const a = screen.getByRole("link", { name: "신청하기" });
    expect(a.getAttribute("data-ui")).toBe("dark-button");
    expect(a.getAttribute("href")).toBe("/store/subscription/apply");
    expect(a.getAttribute("target")).toBeNull();
    expect(document.querySelector('[data-ui="product-card"]')!.textContent).toContain("지면 구독");
  });

  it("PG 계약 전 — 결제 버튼·카드 입력·주 버튼·팝업·카운트다운이 없다", () => {
    const { container } = render(<ProductCard {...book} />);
    expect(container.querySelectorAll("input, select, textarea, form, iframe").length).toBe(0);
    expect(container.querySelectorAll('[data-ui="primary-button"]').length).toBe(0);
    expect(container.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="timer"], dialog').length).toBe(0);
    expect(container.textContent).not.toContain("결제");
    expect(container.textContent).not.toContain("남은 시간");
  });

  it("1단계에 없는 주문 방식(pg)이 들어오면 주문 버튼을 만들지 않는다", () => {
    const pg = { mode: "pg" } as unknown as StoreProductCardProps["order"];
    const { container } = render(<ProductCard {...book} order={pg} />);
    expect(container.querySelectorAll('[data-ui="dark-button"]').length).toBe(0);
    expect(container.querySelector('[data-ui="product-card"]')).not.toBeNull();
  });

  it("기존 주문 경로 점검이 실패하면 고객센터 안내로 바꾼다", () => {
    render(<ProductCard {...book} order={{ ...book.order, link: { ...ok("https://books.example.org/x"), status: "broken" } } as StoreProductCardProps["order"]} />);
    expect(screen.queryByRole("link", { name: /주문하러 가기/ })).toBeNull();
    expect(screen.getByRole("link", { name: "고객센터에 문의하기" }).getAttribute("href")).toBe("/help");
  });

  it("판매 중지·판매 확인일 없음이면 렌더하지 않는다", () => {
    expect(render(<ProductCard {...book} saleStatus="stopped" />).container.innerHTML).toBe("");
    expect(render(<ProductCard {...book} verifiedAt="" />).container.innerHTML).toBe("");
  });

  it("'자사 상품' 변형 — 승인 기록이 있을 때만 '자사 상품'·'교육·상품'·이름·한 줄 설명·[자세히 보기]", () => {
    render(<ProductCard variant="own" name="지방세 실무" description="취득세부터 지방소득세까지 실무 흐름을 담은 책" detailHref="/store/books/local-tax-practice" approved saleStatus="on_sale" />);
    const card = document.querySelector('[data-ui="product-card"]')!;
    expect(card.getAttribute("data-variant")).toBe("own");
    expect(card.textContent).toContain("자사 상품");
    expect(card.textContent).toContain("교육·상품");
    expect(card.textContent).toContain("취득세부터 지방소득세까지 실무 흐름을 담은 책");
    const more = screen.getByRole("link", { name: /자세히 보기/ });
    expect(more.getAttribute("data-ui")).toBe("dark-button");
    expect(more.getAttribute("href")).toBe("/store/books/local-tax-practice");
  });

  it("'자사 상품' 변형 — 승인 기록이 없거나 판매 중지면 렌더 0", () => {
    const own = { variant: "own" as const, name: "지방세 실무", description: "설명", detailHref: "/store/books/x" };
    expect(render(<ProductCard {...own} approved={false} saleStatus="on_sale" />).container.innerHTML).toBe("");
    expect(render(<ProductCard {...own} approved saleStatus="stopped" />).container.innerHTML).toBe("");
  });
});
