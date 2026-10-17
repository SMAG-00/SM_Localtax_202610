// 허브 머리·블록 — 지자체 허브 블록(LG-08·REG1-02), 분야 필터(REG-06·REG1-02), 지역 세금 연결 블록(REG1-10),
// 분야 지방세 포인트 블록(CORE-02), 분야 허브 머리(RP-02), 지역 허브 머리(RP-07), 이슈 묶음 머리(CORE-04)
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LocalHubBlocks, type HubBlockContent } from "./LocalHubBlocks";
import { TopicFilter } from "./TopicFilter";
import { RegionTaxLinks, type RegionTaxLink } from "./RegionTaxLinks";
import { FieldTaxPoint } from "./FieldTaxPoint";
import { FieldHubHead } from "./FieldHubHead";
import { RegionHubHead } from "./RegionHubHead";
import { IssueBundleHead, type IssueArticle } from "./IssueBundleHead";

const cls = (el: Element | null) => el?.getAttribute("class") ?? "";
const block = (title: string, n = 1): HubBlockContent => ({ items: Array.from({ length: n }, (_, i) => <p key={i}>{`${title} 항목 ${i + 1}`}</p>) });
const blockKeys = (root: ParentNode) => [...root.querySelectorAll("[data-hub-block]")].map((el) => el.getAttribute("data-hub-block"));

describe("지자체 허브 블록 (LG-08·REG1-02)", () => {
  const ORDER = ["weekly", "localTax", "realEstate", "events", "sources"];

  it("다섯 블록은 넘긴 순서와 상관없이 금주 핫뉴스 → 지방세·지방재정 → 부동산·개발 → 행사안내 → 공식 자료/해설", () => {
    const { container } = render(
      <LocalHubBlocks
        sources={block("자료")}
        events={block("행사")}
        realEstate={block("부동산")}
        localTax={block("지방세")}
        weekly={block("핫뉴스")}
      />,
    );
    expect(blockKeys(container)).toEqual(ORDER);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["금주 핫뉴스", "지방세·지방재정", "부동산·개발", "행사안내", "공식 자료/해설"]);
    const eyebrows = [...container.querySelectorAll('[data-ui="eyebrow"]')].map((el) => el.textContent);
    expect(eyebrows).toEqual(["WEEKLY", "LOCAL TAX", "REAL ESTATE", "EVENTS", "SOURCES"]);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("local-hub-blocks");
  });

  it("순서를 바꾸는 prop은 없다 — 넘겨도 순서가 그대로다", () => {
    const { container } = render(
      <LocalHubBlocks
        weekly={block("핫뉴스")}
        localTax={block("지방세")}
        realEstate={block("부동산")}
        events={block("행사")}
        sources={block("자료")}
        // @ts-expect-error 블록 순서는 코드 고정이라 order prop이 타입에 없다
        order={["sources", "events", "realEstate", "localTax", "weekly"]}
      />,
    );
    expect(blockKeys(container)).toEqual(ORDER);
  });

  it("기능 플래그로 꺼진 블록(값 없음)은 빠지고 나머지 순서는 그대로다", () => {
    const { container } = render(<LocalHubBlocks localTax={block("지방세")} realEstate={block("부동산")} sources={block("자료")} />);
    expect(blockKeys(container)).toEqual(["localTax", "realEstate", "sources"]);
  });

  it("행사안내가 0건이면 '현재 확인된 일정 없음'을 보인다", () => {
    render(<LocalHubBlocks events={{ items: [] }} />);
    const section = screen.getByRole("region", { name: "행사안내" });
    expect(within(section).getByText("현재 확인된 일정 없음")).toBeTruthy();
  });

  it("기사가 없는 블록은 빈 카드나 관광 정보로 채우지 않고 블록째 뺀다", () => {
    const { container } = render(<LocalHubBlocks weekly={block("핫뉴스")} localTax={{ items: [] }} realEstate={block("부동산")} />);
    expect(blockKeys(container)).toEqual(["weekly", "realEstate"]);
    expect(container.textContent).not.toMatch(/관광|명소|맛집/);
  });

  it("블록마다 카드는 5장까지 — 7장을 넘기면 앞의 5장만", () => {
    render(<LocalHubBlocks localTax={block("지방세", 7)} />);
    const section = screen.getByRole("region", { name: "지방세·지방재정" });
    expect(within(section).getAllByRole("listitem").length).toBe(5);
    expect(within(section).queryByText("지방세 항목 6")).toBeNull();
  });

  it("시·군·구 기사가 없어 상위 시·도 기사를 보이면 그 사실을 글자로 밝힌다 (REG-06)", () => {
    render(<LocalHubBlocks localTax={{ ...block("지방세"), fallbackRegion: "서울특별시" }} />);
    expect(screen.getByText("이 지역 기사가 없어 서울특별시 기사를 보여 드립니다.")).toBeTruthy();
  });

  it("금주 핫뉴스 블록은 주차·기간·발행일 줄을 고정폭으로, 더 보기 링크를 함께 보인다", () => {
    render(<LocalHubBlocks weekly={{ ...block("핫뉴스"), meta: "2026-42 · 10.12~10.18 · 발행 2026-10-16", more: { href: "/local/seoul/weekly/2026-42", label: "이번 주 핫뉴스 전체 보기" } }} />);
    expect(cls(screen.getByText("2026-42 · 10.12~10.18 · 발행 2026-10-16"))).toContain("font-mono");
    expect(screen.getByRole("link", { name: "이번 주 핫뉴스 전체 보기" }).getAttribute("href")).toBe("/local/seoul/weekly/2026-42");
  });
});

describe("분야 필터 (REG-06·REG1-02)", () => {
  it("글자 순서는 전체 · 지방세 · 지방재정 · 부동산·정비 · 도시정책이고 URL 쿼리 topic 링크다", () => {
    render(<TopicFilter basePath="/local/seoul/gangnam-gu" />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["전체", "지방세", "지방재정", "부동산·정비", "도시정책"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/local/seoul/gangnam-gu",
      "/local/seoul/gangnam-gu?topic=local_tax",
      "/local/seoul/gangnam-gu?topic=local_finance",
      "/local/seoul/gangnam-gu?topic=realestate",
      "/local/seoul/gangnam-gu?topic=urban_policy",
    ]);
  });

  it("현재 topic 링크에만 aria-current=page와 활성 밑줄이 있다", () => {
    render(<TopicFilter basePath="/local/seoul" topic="realestate" />);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["부동산·정비"]);
    expect(cls(current[0])).toContain("border-hermes-500");
    expect(cls(screen.getByRole("link", { name: "지방세" }))).toContain("text-navy-400");
  });

  it("topic이 없거나 모르는 값이면 '전체'가 현재 항목이다", () => {
    const { rerender } = render(<TopicFilter basePath="/local/seoul" />);
    expect(screen.getByRole("link", { name: "전체" }).getAttribute("aria-current")).toBe("page");
    rerender(<TopicFilter basePath="/local/seoul" topic="tourism" />);
    expect(screen.getByRole("link", { name: "전체" }).getAttribute("aria-current")).toBe("page");
  });

  it("JS 없이 동작하는 링크만 있고(버튼 0), 모바일은 가로 넘김 대신 줄바꿈", () => {
    const { container } = render(<TopicFilter basePath="/local/seoul" />);
    expect(screen.queryAllByRole("button").length).toBe(0);
    expect(cls(container.querySelector("ul"))).toContain("flex-wrap");
    expect(container.innerHTML).not.toContain("overflow-x");
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("topic-filter");
    expect(screen.getByRole("navigation", { name: "분야 필터" })).toBeTruthy();
  });

  it("주소에 이미 쿼리가 있으면 &로 잇는다", () => {
    render(<TopicFilter basePath="/local?sido=seoul" topic="local_tax" />);
    expect(screen.getByRole("link", { name: "지방세" }).getAttribute("href")).toBe("/local?sido=seoul&topic=local_tax");
  });
});

describe("지역 세금 연결 블록 (REG1-10)", () => {
  const links: RegionTaxLink[] = [
    { kind: "explainer", label: "강남구 재산세 고지서 읽는 법", href: "/tax/explainers/property-tax-bill" },
    { kind: "situation", label: "집을 샀어요", href: "/situations/bought-house" },
    { kind: "sm-calculator", label: "취득세 계산하기", href: "https://sm.example.com/calc/acquisition" },
    { kind: "official", label: "강남구 지방세 감면 조례 원문", href: "https://www.example.go.kr/ordinance/1" },
  ];

  it("아이브로 NEXT STEP과 제목 '이 지역의 세금 상황·도구', 링크를 보인다", () => {
    const { container } = render(<RegionTaxLinks links={links} />);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("region-tax-links");
    expect(screen.getByText("NEXT STEP")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("이 지역의 세금 상황·도구");
    expect(screen.getAllByRole("link").length).toBe(4);
  });

  it("SM 계산기·공식 원문은 새 창(rel=noopener noreferrer, '새 창' 글자), 사이트 안 해설은 같은 창", () => {
    render(<RegionTaxLinks links={links} />);
    const calc = screen.getByRole("link", { name: /취득세 계산하기/ });
    expect(calc.getAttribute("target")).toBe("_blank");
    expect(calc.getAttribute("rel")).toBe("noopener noreferrer");
    expect(calc.textContent).toContain("(새 창)");
    expect(calc.textContent).toContain("별도 사이트");
    expect(screen.getByRole("link", { name: /공식 지자체 원문|조례 원문/ }).getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: /재산세 고지서/ }).getAttribute("target")).toBeNull();
  });

  it("기능 플래그가 꺼진 링크는 '준비 중'으로 두지 않고 아예 빠진다", () => {
    render(<RegionTaxLinks links={[...links, { kind: "calculator", label: "재산세 계산해 보기", href: "/calc/property", enabled: false }]} />);
    expect(screen.queryByText(/재산세 계산해 보기/)).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();
    expect(screen.getAllByRole("link").length).toBe(4);
  });

  it("관광 정보 링크는 넣지 않는다 — 허용 종류 밖 링크는 빠진다", () => {
    const tour = { kind: "tour", label: "강남 명소 둘러보기", href: "/tour/gangnam" } as unknown as RegionTaxLink;
    render(<RegionTaxLinks links={[...links, tour]} />);
    expect(screen.queryByText(/명소/)).toBeNull();
  });

  it("링크는 2~5건 — 1건이면 블록을 그리지 않고, 2건이면 그리고, 6건이면 5건만", () => {
    const { container, rerender } = render(<RegionTaxLinks links={links.slice(0, 1)} />);
    expect(container.innerHTML).toBe("");
    rerender(<RegionTaxLinks links={links.slice(0, 2)} />);
    expect(screen.getAllByRole("link").length).toBe(2);
    const six = [...links, { kind: "explainer", label: "지방소득세 해설", href: "/tax/a" }, { kind: "explainer", label: "자동차세 해설", href: "/tax/b" }] as RegionTaxLink[];
    rerender(<RegionTaxLinks links={six} />);
    expect(screen.getAllByRole("link").length).toBe(5);
    expect(screen.queryByText("자동차세 해설")).toBeNull();
  });
});

describe("분야 지방세 포인트 블록 (CORE-02)", () => {
  const props = {
    points: ["관리처분계획인가 뒤 새 집을 받으면 취득세 신고 대상이 됩니다.", "조합원 입주권은 주택 수 계산에 들어갈 수 있습니다.", "신탁 부동산의 재산세는 위탁자에게 고지됩니다."],
    basisDate: "2026-10-01",
    links: [{ label: "정비사업 지방세 해설 보기", href: "/tax/explainers/redevelopment" }],
  };

  it("강조 문단 문법으로 제목·포인트 3줄·기준일(고정폭)·지방세 해설 링크를 보인다", () => {
    const { container } = render(<FieldTaxPoint {...props} />);
    const root = container.firstElementChild!;
    expect(root.getAttribute("data-ui")).toBe("field-tax-point");
    expect(cls(root)).toContain("border-l-2");
    expect(cls(root)).toContain("border-hermes-500");
    expect(screen.getByRole("heading").textContent).toBe("이 분야의 지방세 포인트");
    expect(screen.getAllByRole("listitem").length).toBe(3);
    expect(cls(screen.getByText(/기준일 2026-10-01/))).toContain("font-mono");
    expect(screen.getByRole("link", { name: "정비사업 지방세 해설 보기" }).getAttribute("href")).toBe("/tax/explainers/redevelopment");
  });

  it("포인트는 1~3줄 — 0줄·4줄이면 블록째 숨기고 1줄이면 보인다", () => {
    const { container, rerender } = render(<FieldTaxPoint {...props} points={[]} />);
    expect(container.innerHTML).toBe("");
    rerender(<FieldTaxPoint {...props} points={[...props.points, "네 번째 줄"]} />);
    expect(container.innerHTML).toBe("");
    rerender(<FieldTaxPoint {...props} points={props.points.slice(0, 1)} />);
    expect(screen.getAllByRole("listitem").length).toBe(1);
  });

  it("기준일이나 지방세 해설 링크가 없으면 블록째 숨긴다 (빈 블록·'준비 중' 0)", () => {
    const { container, rerender } = render(<FieldTaxPoint {...props} basisDate="" />);
    expect(container.innerHTML).toBe("");
    rerender(<FieldTaxPoint {...props} links={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("분야 허브 머리 (RP-02)", () => {
  const tabs = {
    current: "projects",
    items: [
      { id: "projects", label: "프로젝트", href: "/realestate/projects" },
      { id: "presale", label: "분양 정보", href: "/realestate/presale" },
      { id: "methods", label: "개발방법 비교", href: "/realestate/development-methods" },
    ],
  };
  const taxPoint = { points: ["관리처분 단계의 취득세 쟁점을 먼저 확인합니다."], basisDate: "2026-10-01", links: [{ label: "정비사업 지방세 해설 보기", href: "/tax/explainers/redevelopment" }] };

  it("아이브로(허브 영문명)·제목·한 줄 소개·하위 분야 탭(링크)을 보인다", () => {
    const { container } = render(<FieldHubHead field="realestate" eyebrow="REAL ESTATE" title="부동산" intro="지역 개발과 정비사업의 진행을 원문으로 확인합니다." tabs={tabs} />);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("field-hub-head");
    expect(screen.getByText("REAL ESTATE")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("부동산");
    expect(screen.getByText("지역 개발과 정비사업의 진행을 원문으로 확인합니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "프로젝트" }).getAttribute("aria-current")).toBe("page");
  });

  it("골격 순서 = 머리(아이브로·제목·소개) → 분야 지방세 포인트 → 하위 분야 탭 (CAT-02 '머리 → 지방세 포인트 → 탭')", () => {
    const { container } = render(<FieldHubHead field="realestate" eyebrow="REAL ESTATE" title="부동산" intro="소개" tabs={tabs} taxPoint={taxPoint} />);
    const order = [...container.querySelectorAll('[data-ui="eyebrow"], h1, p, [data-ui="field-tax-point"], [data-ui="tab-nav"]')]
      .filter((el) => !el.closest('[data-ui="field-tax-point"]') || el.getAttribute("data-ui") === "field-tax-point")
      .map((el) => el.getAttribute("data-ui") ?? el.tagName.toLowerCase());
    expect(order).toEqual(["eyebrow", "h1", "p", "field-tax-point", "tab-nav"]);
  });

  it("지방세 허브·뉴스 전체에는 분야 지방세 포인트 블록이 없다", () => {
    for (const field of ["tax", "news"]) {
      const props = { field, eyebrow: "LOCAL TAX", title: "지방세", intro: "소개", taxPoint } as unknown as Parameters<typeof FieldHubHead>[0];
      const { container, unmount } = render(<FieldHubHead {...props} />);
      expect(container.querySelector('[data-ui="field-tax-point"]')).toBeNull();
      expect(container.firstElementChild?.getAttribute("data-field")).toBe(field);
      unmount();
    }
  });

  it("한 줄 소개가 없거나 빈칸이면 소개 문단째 없다 — 빈 문단 0", () => {
    for (const intro of [undefined, null, "  "]) {
      const { container, unmount } = render(<FieldHubHead field="finance" eyebrow="DEVELOPMENT FINANCE" title="부동산개발금융" intro={intro} tabs={tabs} />);
      expect(container.querySelectorAll("header > p:not([data-ui])")).toHaveLength(0);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("부동산개발금융");
      unmount();
    }
  });

  it("탭이 0개면 탭 요소 0", () => {
    const { container } = render(<FieldHubHead field="local" eyebrow="LOCAL" title="지자체뉴스" tabs={{ items: [], current: "all" }} />);
    expect(container.querySelector('[data-ui="tab-nav"]')).toBeNull();
  });
});

describe("지역 허브 머리 (RP-07)", () => {
  const sido = { name: "서울특별시", href: "/local/seoul" };
  const sigungu = { name: "강남구", href: "/local/seoul/gangnam-gu" };

  it("/local 시·도 > 시·군·구 이동 줄 — 마지막 단계에 aria-current=page, 제목은 시·도 + 시·군·구", () => {
    const { container } = render(<RegionHubHead sido={sido} sigungu={sigungu} />);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("region-hub-head");
    const nav = screen.getByRole("navigation", { name: "지역 이동" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["지자체뉴스", "/local"],
      ["서울특별시", "/local/seoul"],
      ["강남구", "/local/seoul/gangnam-gu"],
    ]);
    expect(links[2].getAttribute("aria-current")).toBe("page");
    expect(links[1].getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("서울특별시 강남구");
  });

  it("시·도 허브는 시·도가 현재 단계이고, 같은 시·도의 시·군·구로 옮겨 갈 링크를 둔다", () => {
    render(<RegionHubHead sido={sido} sigunguOptions={[sigungu, { name: "서초구", href: "/local/seoul/seocho-gu" }]} />);
    const nav = screen.getByRole("navigation", { name: "지역 이동" });
    expect(within(nav).getByRole("link", { name: "서울특별시" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("서울특별시");
    expect(screen.getByText("시·군·구 바꾸기")).toBeTruthy();
    expect(screen.getByRole("link", { name: "서초구" }).getAttribute("href")).toBe("/local/seoul/seocho-gu");
  });

  it("분야 지방세 포인트 → 분야 필터 → 지자체 허브 블록 → 지역 세금 연결 블록 순서로 놓는다", () => {
    const { container } = render(
      <RegionHubHead
        sido={sido}
        sigungu={sigungu}
        taxLinks={<div data-slot="links" />}
        blocks={<div data-slot="blocks" />}
        filter={<div data-slot="filter" />}
        taxPoint={<div data-slot="point" />}
      />,
    );
    expect([...container.querySelectorAll("[data-slot]")].map((el) => el.getAttribute("data-slot"))).toEqual(["point", "filter", "blocks", "links"]);
  });
});

describe("이슈 묶음 머리 (CORE-04)", () => {
  const approval = { by: "편집자 A", at: "2026-10-15T10:00:00+09:00", reason: "같은 정비구역의 관리처분 단계" };
  const art = (id: string, field: IssueArticle["field"], ok = true): IssueArticle => ({ id, field, card: <p>{`기사 ${id}`}</p>, approval: ok ? approval : undefined });

  it("아이브로 ISSUE·편집자 제목·요약, 분야별 기사 목록을 고정 분야 순서로, 「지방세로 읽기」 박스 1개", () => {
    const { container } = render(
      <IssueBundleHead
        title="○○구역 관리처분, 무엇이 달라지나"
        summary="같은 구역을 다룬 부동산·지방세 기사를 한곳에 모았습니다."
        articles={[art("r1", "부동산"), art("t1", "지방세"), art("l1", "지자체뉴스")]}
        taxLens={<aside data-slot="tax-lens">지방세로 읽기</aside>}
      />,
    );
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("issue-bundle-head");
    expect(screen.getByText("ISSUE")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("○○구역 관리처분, 무엇이 달라지나");
    expect([...container.querySelectorAll("[data-issue-field]")].map((el) => el.getAttribute("data-issue-field"))).toEqual(["지방세", "부동산", "지자체뉴스"]);
    expect(container.querySelectorAll('[data-slot="tax-lens"]').length).toBe(1);
  });

  it("승인 기록(승인자·시각·관계 이유)이 없는 관계는 렌더하지 않는다", () => {
    render(
      <IssueBundleHead
        title="제목"
        summary="요약"
        articles={[art("t1", "지방세"), art("r1", "부동산"), art("r2", "부동산", false), { ...art("f1", "부동산개발금융"), approval: { ...approval, reason: "" } }]}
        taxLens={<aside>박스</aside>}
      />,
    );
    expect(screen.getByText("기사 t1")).toBeTruthy();
    expect(screen.getByText("기사 r1")).toBeTruthy();
    expect(screen.queryByText("기사 r2")).toBeNull();
    expect(screen.queryByText("기사 f1")).toBeNull();
  });

  it("승인된 기사가 서로 다른 분야 2개 미만이면 묶음을 그리지 않는다", () => {
    const { container } = render(<IssueBundleHead title="제목" summary="요약" articles={[art("r1", "부동산"), art("r2", "부동산"), art("t1", "지방세", false)]} taxLens={<aside>박스</aside>} />);
    expect(container.innerHTML).toBe("");
  });
});
