// services 묶음 — 기사 신뢰 블록 7종 (PRD-00 8.6: 기자 소개 블록 · 정정 이력 블록 · 갱신 배너 · 해석 원문 블록 · 「지방세로 읽기」 박스 · FAQ 블록 · 핵심 요약 상자)
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReporterBlock } from "./ReporterBlock";
import { CorrectionHistory, type CorrectionEntry } from "./CorrectionHistory";
import { UpdateBanner } from "./UpdateBanner";
import { InterpretationSource } from "./InterpretationSource";
import { TaxLensBox, type TaxLensBoxProps } from "./TaxLensBox";
import { FaqBlock, selectFaqItems, type FaqItem } from "./FaqBlock";
import { KeySummary } from "./KeySummary";

const cls = (el: Element | null | undefined) => el?.getAttribute("class") ?? "";

describe("기자 소개 블록 (NAV-03 · TX-15 · TX-16)", () => {
  const base = {
    author: { name: "홍길동", slug: "hong-gildong", beat: "지방세·부동산", bio: "지방세와 지자체 재정을 취재합니다." },
    editor: { name: "김편집" },
    publishedAt: "2026-10-17T00:30:00Z",
    modifiedAt: "2026-10-18T05:00:00Z",
  };

  it("기자 이름은 /people/[slug] 인물 페이지로 이어지고 담당 분야·소개·편집자를 보인다", () => {
    render(<ReporterBlock kind="report" {...base} />);
    expect(screen.getByRole("link", { name: /홍길동/ }).getAttribute("href")).toBe("/people/hong-gildong");
    const block = document.querySelector('[data-ui="reporter-block"]')!;
    expect(block.textContent).toContain("지방세·부동산");
    expect(block.textContent).toContain("지방세와 지자체 재정을 취재합니다.");
    expect(block.textContent).toContain("김편집");
    expect(block.textContent).toContain("기자");
  });

  it("slug에 특수 문자가 있으면 인물 페이지 주소를 인코딩한다", () => {
    render(<ReporterBlock kind="report" {...base} author={{ ...base.author, slug: "홍 길동" }} />);
    expect(screen.getByRole("link", { name: /홍길동/ }).getAttribute("href")).toBe("/people/%ED%99%8D%20%EA%B8%B8%EB%8F%99");
  });

  it("최초 발행·실질 수정 시각을 한국 시간 고정폭 <time>으로 보인다", () => {
    render(<ReporterBlock kind="report" {...base} />);
    const published = screen.getByText("2026-10-17 09:30");
    expect(published.tagName).toBe("TIME");
    expect(published.getAttribute("datetime")).toBe("2026-10-17T00:30:00Z");
    expect(cls(published.closest("p"))).toContain("font-mono");
    expect(screen.getByText("2026-10-18 14:00").tagName).toBe("TIME");
  });

  it("실질 수정 시각이 없으면 최초 발행 시각만 보인다", () => {
    render(<ReporterBlock kind="report" {...base} modifiedAt={undefined} />);
    expect(document.querySelectorAll('[data-ui="reporter-block"] time').length).toBe(1);
    expect(document.querySelector('[data-ui="reporter-block"]')!.textContent).not.toContain("실질 수정");
  });

  it("소개에 이메일 주소가 들어 있으면 소개 문단을 렌더하지 않는다 (평문 이메일 0)", () => {
    render(<ReporterBlock kind="report" {...base} author={{ ...base.author, bio: "제보는 hong@example.org 으로 보내 주세요." }} />);
    const block = document.querySelector('[data-ui="reporter-block"]')!;
    expect(block.textContent).not.toContain("@");
    expect(block.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("[정정·반론 요청]과 편집 원칙 링크를 둔다 (기본 경로)", () => {
    render(<ReporterBlock kind="report" {...base} />);
    expect(screen.getByRole("link", { name: "정정·반론 요청" }).getAttribute("href")).toBe("/about/corrections");
    expect(screen.getByRole("link", { name: "편집 원칙" }).getAttribute("href")).toBe("/about/editorial-policy");
  });

  it("정책 페이지가 공개 승인되지 않았으면(null) 그 링크를 그리지 않는다 — 둘 다 null이면 목록째 0 (HELP-05)", () => {
    const { unmount } = render(<ReporterBlock kind="report" {...base} correctionHref={null} editorialPolicyHref="/about/editorial-policy" />);
    expect(screen.queryByRole("link", { name: "정정·반론 요청" })).toBeNull();
    expect(screen.getByRole("link", { name: "편집 원칙" }).getAttribute("href")).toBe("/about/editorial-policy");
    unmount();
    render(<ReporterBlock kind="report" {...base} correctionHref={null} editorialPolicyHref={null} />);
    const links = [...document.querySelectorAll('[data-ui="reporter-block"] a')].map((x) => x.getAttribute("href"));
    expect(links).toEqual(["/people/hong-gildong"]);
    expect(document.querySelector('[data-ui="reporter-block"] ul')).toBeNull();
  });

  it("칼럼은 '필자'로 표시하고 이해관계 한 줄과 '의견이며 개별 자문이 아닙니다'를 붙인다", () => {
    render(<ReporterBlock kind="opinion" {...base} interest="SM(선명) 감수위원으로 원고료를 받습니다" />);
    const block = document.querySelector('[data-ui="reporter-block"]')!;
    expect(block.textContent).toContain("필자");
    expect(block.textContent).toContain("이해관계: SM(선명) 감수위원으로 원고료를 받습니다");
    expect(screen.getByText("의견이며 개별 자문이 아닙니다")).toBeTruthy();
  });

  it("칼럼 이해관계가 비어 있으면 줄을 빼지 않고 '확인 필요'로 보인다", () => {
    render(<ReporterBlock kind="opinion" {...base} interest="  " />);
    expect(document.querySelector('[data-ui="reporter-block"]')!.textContent).toContain("이해관계: 확인 필요");
  });

  it("보도 기사에는 이해관계 줄과 의견 고지가 없다", () => {
    render(<ReporterBlock kind="report" {...base} />);
    const text = document.querySelector('[data-ui="reporter-block"]')!.textContent ?? "";
    expect(text).not.toContain("이해관계");
    expect(text).not.toContain("의견이며 개별 자문이 아닙니다");
  });

  it("세무 감수자는 해설에서만 보인다", () => {
    const { unmount } = render(<ReporterBlock kind="explainer" {...base} taxReviewer={{ name: "이감수 세무사" }} />);
    expect(document.querySelector('[data-ui="reporter-block"]')!.textContent).toContain("세무 감수 이감수 세무사");
    unmount();
    // 보도 기사에 감수자 값이 섞여 들어와도 렌더하지 않는다
    const stray = { taxReviewer: { name: "이감수 세무사" } } as object;
    render(<ReporterBlock kind="report" {...base} {...stray} />);
    expect(document.querySelector('[data-ui="reporter-block"]')!.textContent).not.toContain("이감수");
  });
});

describe("정정 이력 블록 (NAV-03 · NAV-05 · NAV-06)", () => {
  const entries: CorrectionEntry[] = [
    { id: "c2", kind: "rebuttal", date: "2026-10-20", what: "구청 측 반론을 실었습니다", why: "반론 요청을 받아 반영", compareHref: "/news/a/compare/2" },
    { id: "c1", kind: "correction", date: "2026-10-18", what: "신고 기한을 60일로 고쳤습니다", why: "법령 조문 확인 결과 오기", compareHref: "/news/a/compare/1" },
  ];

  it("항목이 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<CorrectionHistory entries={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("날짜 순(오래된 것부터)으로 쌓는다 — 입력 순서와 무관", () => {
    render(<CorrectionHistory entries={entries} />);
    const items = within(document.querySelector('[data-ui="correction-history"]') as HTMLElement).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("time")?.textContent)).toEqual(["2026-10-18", "2026-10-20"]);
  });

  it("항목마다 종류·날짜(고정폭)·무엇을·왜·전후 비교 링크를 보인다", () => {
    render(<CorrectionHistory entries={entries} />);
    const first = within(document.querySelector('[data-ui="correction-history"]') as HTMLElement).getAllByRole("listitem")[0];
    expect(first.textContent).toContain("정정");
    expect(first.textContent).toContain("신고 기한을 60일로 고쳤습니다");
    expect(first.textContent).toContain("법령 조문 확인 결과 오기");
    expect(cls(first.querySelector("time"))).toContain("font-mono");
    expect(within(first).getByRole("link", { name: /전후 비교/ }).getAttribute("href")).toBe("/news/a/compare/1");
  });

  it("네 종류(정정·반론·추후보도·제목 변경)를 서로 다른 글자로 표시하고, 제목에 건수를 쓴다", () => {
    render(
      <CorrectionHistory
        entries={[
          { id: "1", kind: "correction", date: "2026-10-01", what: "가", why: "나" },
          { id: "2", kind: "rebuttal", date: "2026-10-02", what: "가", why: "나" },
          { id: "3", kind: "follow-up", date: "2026-10-03", what: "가", why: "나" },
          { id: "4", kind: "title-change", date: "2026-10-04", what: "가", why: "나" },
        ]}
      />,
    );
    const root = document.querySelector('[data-ui="correction-history"]') as HTMLElement;
    const labels = within(root).getAllByRole("listitem").map((li) => li.querySelector('[data-ui="chip"]')?.textContent);
    expect(labels).toEqual(["정정", "반론", "추후보도", "제목 변경"]);
    expect(within(root).getByRole("heading").textContent).toBe("정정 이력 4건");
  });

  it("업데이트 표시(ART-05)와 라벨을 나눈다 — 제목에 '수정'·'업데이트'가 없다", () => {
    render(<CorrectionHistory entries={entries} />);
    const heading = within(document.querySelector('[data-ui="correction-history"]') as HTMLElement).getByRole("heading").textContent ?? "";
    expect(heading).not.toContain("업데이트");
    expect(heading).not.toContain("수정");
  });

  it("전후 비교 주소가 없는 항목은 비교 링크를 만들지 않는다 (빈 링크 0)", () => {
    render(<CorrectionHistory entries={[{ id: "1", kind: "title-change", date: "2026-10-01", what: "제목을 바꿨습니다", why: "뜻을 분명히" }]} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("갱신 배너 (TX-08)", () => {
  it("강조 문단 문법 한 줄로 바뀐 단계·날짜(고정폭)와 [트래커 보기] 링크를 보인다", () => {
    render(<UpdateBanner stage="국회 제출" changedAt="2026-10-15" trackerHref="/tax/amendments/2026-local-tax-reform" />);
    const banner = document.querySelector('[data-ui="update-banner"]')!;
    expect(banner.textContent).toContain("이 기사가 다룬 개정안이 국회 제출 단계로 바뀌었습니다");
    const date = banner.querySelector("time")!;
    expect(date.textContent).toBe("2026-10-15");
    expect(cls(date)).toContain("font-mono");
    expect(screen.getByRole("link", { name: "트래커 보기" }).getAttribute("href")).toBe("/tax/amendments/2026-local-tax-reform");
    expect(cls(banner.querySelector('[data-ui="callout"]'))).toContain("border-hermes-500");
  });

  it("단계 변경 뒤 기사를 실질 수정했으면 배너를 렌더하지 않는다", () => {
    const { container } = render(<UpdateBanner stage="공포" changedAt="2026-10-15T09:00:00+09:00" articleModifiedAt="2026-10-16T09:00:00+09:00" trackerHref="/tax/amendments/x" />);
    expect(container.innerHTML).toBe("");
  });

  it("경계 — 실질 수정 시각이 단계 변경 시각과 같으면 배너 0, 1분 이르면 배너가 있다", () => {
    const same = render(<UpdateBanner stage="공포" changedAt="2026-10-15T09:00:00+09:00" articleModifiedAt="2026-10-15T09:00:00+09:00" trackerHref="/t" />);
    expect(same.container.innerHTML).toBe("");
    same.unmount();
    render(<UpdateBanner stage="공포" changedAt="2026-10-15T09:00:00+09:00" articleModifiedAt="2026-10-15T08:59:00+09:00" trackerHref="/t" />);
    expect(document.querySelector('[data-ui="update-banner"]')).not.toBeNull();
  });
});

describe("해석 원문 블록 (TX-09)", () => {
  const doc = {
    docType: "예규" as const,
    issuer: "행정안전부",
    docNumber: "지방세운영과-1234",
    decidedAt: "2026-03-02",
    summary: "생애최초 주택 감면은 실제 거주 요건을 함께 봅니다.",
    sourceUrl: "https://www.law.go.kr/expc/view?id=1234",
    rightsConfirmed: true,
  };

  it("유형 칩·발행기관·문서 번호와 결정일(고정폭)·요지·[원문 보기](새 창)·권리 확인 표시를 보인다", () => {
    render(<InterpretationSource {...doc} />);
    const block = document.querySelector('[data-ui="interpretation-source"]') as HTMLElement;
    expect(within(block).getByText("예규").getAttribute("data-ui")).toBe("chip");
    expect(block.textContent).toContain("행정안전부");
    expect(cls(within(block).getByText(/지방세운영과-1234/).closest("p"))).toContain("font-mono");
    expect(block.querySelector("time")?.textContent).toBe("2026-03-02");
    expect(block.textContent).toContain("생애최초 주택 감면은 실제 거주 요건을 함께 봅니다.");
    const link = within(block).getByRole("link", { name: /원문 보기/ });
    expect(link.getAttribute("href")).toBe("https://www.law.go.kr/expc/view?id=1234");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("(새 창)");
    expect(block.textContent).toContain("권리 확인");
  });

  it("판례·심판은 비실명 확인이 없으면 렌더하지 않고, 있으면 '비실명 확인'을 표시한다", () => {
    const { container, unmount } = render(<InterpretationSource {...doc} docType="판례" />);
    expect(container.innerHTML).toBe("");
    unmount();
    render(<InterpretationSource {...doc} docType="심판" anonymized />);
    expect(document.querySelector('[data-ui="interpretation-source"]')!.textContent).toContain("비실명 확인");
  });

  it("권리 확인이 없거나 필수 칸이 비면 렌더하지 않는다", () => {
    expect(render(<InterpretationSource {...doc} rightsConfirmed={false} />).container.innerHTML).toBe("");
    expect(render(<InterpretationSource {...doc} docNumber=" " />).container.innerHTML).toBe("");
    expect(render(<InterpretationSource {...doc} summary="" />).container.innerHTML).toBe("");
  });

  it("원문 주소가 http(s)가 아니면 렌더하지 않는다", () => {
    expect(render(<InterpretationSource {...doc} sourceUrl="javascript:alert(1)" />).container.innerHTML).toBe("");
    expect(render(<InterpretationSource {...doc} sourceUrl="/legal/1234" />).container.innerHTML).toBe("");
  });
});

describe("「지방세로 읽기」 박스 (CORE-01)", () => {
  const lens: TaxLensBoxProps = {
    taxes: ["취득세", "재산세"],
    points: ["관리처분계획인가 뒤 입주권은 주택 수에 들어갑니다.", "원시취득 세율이 따로 적용됩니다.", "조합원 분담금도 과세표준에 들어갑니다."],
    links: {
      explainer: { href: "/news/reconstruction-acquisition-tax", enabled: true },
      smCalculator: { href: "https://calc.example.org/acquisition", enabled: true },
      product: { href: "/store/books/local-tax-practice", enabled: true },
      experts: { href: "/experts?field=local-tax", enabled: false },
    },
    reviewer: "홍길동 세무사",
    basisDate: "2026-10-01",
  };

  it("아이브로 LOCAL TAX LENS·세목 칩·포인트·감수자와 기준일(고정폭)을 보인다", () => {
    render(<TaxLensBox {...lens} />);
    const box = document.querySelector('[data-ui="tax-lens-box"]') as HTMLElement;
    expect(within(box).getByText("LOCAL TAX LENS").closest('[data-ui="eyebrow"]')).not.toBeNull();
    expect(within(box).getByText("취득세").getAttribute("data-ui")).toBe("chip");
    expect(within(box).getAllByRole("listitem").filter((li) => li.closest('[data-list="points"]')).length).toBe(3);
    const meta = within(box).getByText(/기준일/);
    expect(meta.textContent).toBe("감수 홍길동 세무사 · 기준일 2026-10-01");
    expect(cls(meta)).toContain("font-mono");
    expect(cls(box.querySelector('[data-part="lens-body"]'))).toContain("border-hermes-500");
  });

  it("열린 기능의 링크만 보인다 — 닫힌 [전문가 찾기]는 0", () => {
    render(<TaxLensBox {...lens} />);
    const box = document.querySelector('[data-ui="tax-lens-box"]') as HTMLElement;
    expect(within(box).getByRole("link", { name: "해설 읽기" }).getAttribute("href")).toBe("/news/reconstruction-acquisition-tax");
    expect(within(box).getByRole("link", { name: /관련 도서 · 자사 상품/ }).getAttribute("href")).toBe("/store/books/local-tax-practice");
    expect(within(box).queryByRole("link", { name: /전문가 찾기/ })).toBeNull();
    expect(within(box).getAllByRole("link").length).toBe(3);
  });

  it("구별 이름(label — 한 화면에 박스가 여럿일 때, W4 16단계)은 제목 뒤 숨은 글자로만 — 없으면 제목 그대로", () => {
    const { unmount } = render(<TaxLensBox {...lens} label="시험용 구역지정 단계" />);
    expect(screen.getByRole("region", { name: /^지방세로 읽기\s*— 시험용 구역지정 단계$/ })).toBeTruthy();
    expect(cls(screen.getByText(/— 시험용 구역지정 단계/))).toContain("sr-only");
    unmount();
    render(<TaxLensBox {...lens} />);
    expect(screen.getByRole("region", { name: "지방세로 읽기" })).toBeTruthy();
  });

  it("링크는 주 버튼이 아니다 — 주 버튼·button 요소 0", () => {
    render(<TaxLensBox {...lens} />);
    const box = document.querySelector('[data-ui="tax-lens-box"]') as HTMLElement;
    expect(box.querySelectorAll('[data-ui="primary-button"]').length).toBe(0);
    expect(box.querySelectorAll("button").length).toBe(0);
  });

  it("SM 취득세 계산기 링크는 새 창(rel=noopener noreferrer)이고 주소에 쿼리·조각이 있으면 그 링크만 뺀다", () => {
    const { unmount } = render(<TaxLensBox {...lens} />);
    const calc = screen.getByRole("link", { name: /SM 취득세 계산기/ });
    expect(calc.getAttribute("href")).toBe("https://calc.example.org/acquisition");
    expect(calc.getAttribute("target")).toBe("_blank");
    expect(calc.getAttribute("rel")).toBe("noopener noreferrer");
    expect(calc.textContent).toContain("새 창");
    unmount();
    render(<TaxLensBox {...lens} links={{ ...lens.links, smCalculator: { href: "https://calc.example.org/acquisition?ref=news", enabled: true } }} />);
    expect(screen.queryByRole("link", { name: /SM 취득세 계산기/ })).toBeNull();
    expect(screen.getByRole("link", { name: "해설 읽기" })).toBeTruthy();
  });

  it("경계 — 포인트 3줄은 렌더, 4줄·0줄은 박스 HTML 0", () => {
    expect(render(<TaxLensBox {...lens} points={[...lens.points, "네 번째 줄"]} />).container.innerHTML).toBe("");
    expect(render(<TaxLensBox {...lens} points={[]} />).container.innerHTML).toBe("");
    expect(render(<TaxLensBox {...lens} points={["한 줄", "  "]} />).container.querySelector('[data-ui="tax-lens-box"]')).not.toBeNull();
  });

  it("포인트에 세액 표현(숫자 + 원)이 있으면 박스를 렌더하지 않는다", () => {
    expect(render(<TaxLensBox {...lens} points={["취득세는 1,200만 원이 나옵니다."]} />).container.innerHTML).toBe("");
    expect(render(<TaxLensBox {...lens} points={["세액은 3억원 안팎입니다."]} />).container.innerHTML).toBe("");
  });

  it("세목 칩이 없거나 열린 링크가 하나도 없으면 렌더하지 않는다", () => {
    expect(render(<TaxLensBox {...lens} taxes={[]} />).container.innerHTML).toBe("");
    expect(
      render(<TaxLensBox {...lens} links={{ explainer: { href: "/news/x", enabled: false }, experts: { href: "/experts", enabled: false } }} />).container.innerHTML,
    ).toBe("");
  });
});

describe("FAQ 블록 (OPT-02 · OPT-10)", () => {
  const item = (n: number): FaqItem => ({ id: `q${n}`, question: `질문 ${n}`, answer: `답 ${n}` });

  it("질문(19px 900)과 답을 펼친 상태(<details open>)로 보인다 — 숨김 답 0", () => {
    render(<FaqBlock items={[{ ...item(1), sources: [{ label: "지방세법 제11조", href: "https://www.law.go.kr/lsSc.do" }] }, item(2)]} />);
    const block = document.querySelector('[data-ui="faq-block"]') as HTMLElement;
    const details = block.querySelectorAll("details");
    expect(details.length).toBe(2);
    details.forEach((d) => expect(d.open).toBe(true));
    const q = within(block).getByText("질문 1");
    expect(q.closest("summary")).not.toBeNull();
    expect(cls(q)).toContain("text-[19px]");
    expect(cls(q)).toContain("font-black");
    const answer = within(block).getByText("답 1");
    expect(answer.closest("[hidden]")).toBeNull();
    expect(cls(answer)).not.toContain("sr-only");
    expect(cls(answer)).not.toContain("hidden");
    const source = within(block).getByRole("link", { name: /지방세법 제11조/ });
    expect(source.getAttribute("target")).toBe("_blank");
  });

  it("경계 — 1개·6개면 렌더 0, 2개·5개는 렌더", () => {
    expect(render(<FaqBlock items={[item(1)]} />).container.innerHTML).toBe("");
    expect(render(<FaqBlock items={[1, 2, 3, 4, 5, 6].map(item)} />).container.innerHTML).toBe("");
    expect(render(<FaqBlock items={[1, 2, 3, 4, 5].map(item)} />).container.querySelectorAll("details").length).toBe(5);
  });

  it("질문이나 답이 빈 항목은 빼고 센다 — 구조화 데이터용 selectFaqItems와 화면이 같은 값", () => {
    const items = [item(1), { id: "blank", question: "빈 답", answer: "  " }, item(2)];
    expect(selectFaqItems(items).map((i) => i.id)).toEqual(["q1", "q2"]);
    render(<FaqBlock items={items} />);
    const shown = Array.from(document.querySelectorAll('[data-ui="faq-block"] summary [data-part="question"]')).map((s) => s.textContent);
    expect(shown).toEqual(selectFaqItems(items).map((i) => i.question));
    expect(selectFaqItems([item(1), { id: "b", question: "", answer: "답" }])).toEqual([]);
  });
});

describe("핵심 요약 상자 (OPT-03)", () => {
  it("강조 문단 문법 상자에 요약을 3줄까지 보인다", () => {
    render(<KeySummary lines={["잔금일부터 60일 안에 신고합니다.", "생애최초 감면은 따로 신청합니다.", "위택스에서 신고할 수 있습니다."]} />);
    const box = document.querySelector('[data-ui="key-summary"]') as HTMLElement;
    expect(within(box).getAllByRole("listitem").length).toBe(3);
    expect(box.textContent).toContain("핵심 요약");
    expect(cls(box)).toContain("border-hermes-500");
  });

  it("경계 — 4줄·0줄이면 렌더 0, 빈 줄은 세지 않는다", () => {
    expect(render(<KeySummary lines={["1", "2", "3", "4"]} />).container.innerHTML).toBe("");
    expect(render(<KeySummary lines={[]} />).container.innerHTML).toBe("");
    const { container } = render(<KeySummary lines={["한 줄 요약", " ", ""]} />);
    expect(container.querySelectorAll("li").length).toBe(1);
  });
});
