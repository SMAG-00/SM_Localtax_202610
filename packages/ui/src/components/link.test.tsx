// 사이트 안 이동 링크 (FND-09) — 앱이 넘긴 링크 컴포넌트는 사이트 안·같은 창 주소에만 쓰고, 외부·새 창·내려받기·쪽 안 이동은 보통의 a 요소다.
// 앱 링크 대신 표식(data-app-link)을 붙이는 시험용 링크 컴포넌트로 어느 쪽으로 그렸는지 본다.
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Footer } from "./shell/Footer";
import { Header } from "./shell/Header";
import { HomeSearch } from "./shell/HomeSearch";
import { ArticleCard } from "./discovery/ArticleCard";
import { LinkCard } from "./Card";
import { DarkButton } from "./Button";
import { LinkProvider, UiLink, isInternalHref, type UiLinkProps } from "./link";
import { TabNav } from "./Tabs";
import { StepTimeline } from "./shell/StepTimeline";
import { SituationCard } from "./discovery/SituationCard";
import { NextActionBand } from "./discovery/NextActionBand";
import { SolvedCaseCard } from "./discovery/SolvedCaseCard";
import { FieldTaxPoint } from "./local/FieldTaxPoint";
import { LocalHubBlocks } from "./local/LocalHubBlocks";
import { ReporterBlock } from "./services/ReporterBlock";
import { TaxLensBox } from "./services/TaxLensBox";
import { UpdateBanner } from "./services/UpdateBanner";

function AppLink(props: UiLinkProps) {
  return <a data-app-link="" {...props} />;
}

const withApp = (ui: ReactNode) => render(<LinkProvider component={AppLink}>{ui}</LinkProvider>);
const appLinks = () => [...document.querySelectorAll("a[data-app-link]")].map((a) => a.getAttribute("href"));
const plainLinks = () => [...document.querySelectorAll("a:not([data-app-link])")].map((a) => a.getAttribute("href"));

describe("사이트 안 주소 판정", () => {
  it.each([
    ["/", true],
    ["/tax", true],
    ["/news/abc?x=1#h", true],
    ["//evil.example.com/x", false],
    ["https://www.mois.go.kr/a", false],
    ["#main", false],
    ["mailto:desk@example.com", false],
    ["", false],
  ])("%s → %s", (href, expected) => expect(isInternalHref(href)).toBe(expected));
});

describe("UiLink", () => {
  it("앱 링크가 없으면(견본·관리자 화면) 언제나 보통의 a 요소다", () => {
    render(<UiLink href="/tax">지방세</UiLink>);
    const a = screen.getByRole("link", { name: "지방세" });
    expect(a.hasAttribute("data-app-link")).toBe(false);
    expect(a.getAttribute("href")).toBe("/tax");
  });

  it("앱 링크가 있으면 사이트 안·같은 창 주소만 앱 링크로 — 외부·새 창·내려받기·쪽 안 이동·다른 사이트(//)는 a 요소", () => {
    withApp(
      <>
        <UiLink href="/tax">허브</UiLink>
        <UiLink href="/news/a" target="_self">
          같은 창
        </UiLink>
        <UiLink href="https://www.mois.go.kr/a">외부</UiLink>
        <UiLink href="/news/b" target="_blank" rel="noopener noreferrer">
          새 창
        </UiLink>
        <UiLink href="/files/a.pdf" download="">
          내려받기
        </UiLink>
        <UiLink href="#main">본문으로</UiLink>
        <UiLink href="//evil.example.com/">다른 사이트</UiLink>
      </>,
    );
    expect(appLinks()).toEqual(["/tax", "/news/a"]);
    expect(plainLinks()).toEqual(["https://www.mois.go.kr/a", "/news/b", "/files/a.pdf", "#main", "//evil.example.com/"]);
    expect(screen.getByRole("link", { name: "새 창" }).getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "내려받기" }).hasAttribute("download")).toBe(true);
  });

  it("클래스·aria·data 속성과 누름 처리를 그대로 넘긴다", () => {
    let clicked = 0;
    withApp(
      <UiLink href="/local" className="x" aria-current="page" data-field="local" onClick={(e) => {
          e.preventDefault(); // 시험 환경(jsdom)은 문서 이동을 하지 않는다
          clicked++;
        }}>
        지자체뉴스
      </UiLink>,
    );
    const a = screen.getByRole("link", { name: "지자체뉴스" });
    expect(a.className).toBe("x");
    expect(a.getAttribute("aria-current")).toBe("page");
    expect(a.getAttribute("data-field")).toBe("local");
    a.click();
    expect(clicked).toBe(1);
  });
});

describe("공개 화면 컴포넌트의 사이트 안 링크는 앱 링크로 그린다", () => {
  it("헤더 — 워드마크·4대 분야·유틸 메뉴·계정 버튼", () => {
    withApp(<Header utilities={["search"]} account={{ label: "로그인", href: "/login" }} />);
    expect(appLinks()).toEqual(["/", "/tax", "/realestate", "/finance", "/local", "/search", "/login"]);
    expect(plainLinks()).toEqual([]);
  });

  it("바닥글 링크 · 추천 검색어 칩 · 기사 카드 제목 · 링크 카드 · 어두운 버튼 링크", () => {
    withApp(
      <>
        <Footer disclaimer="면책" links={[{ label: "회사 소개", href: "/about" }]} />
        <HomeSearch suggestions={["취득세", "개편안", "재산세"]} />
        <ArticleCard href="/news/a" title="제목" summary="요약" section="tax" publishedAt="2026-10-18" />
        <LinkCard href="/tax">지방세</LinkCard>
        <LinkCard href="https://www.wetax.go.kr" external>
          위택스
        </LinkCard>
        <DarkButton href="/experts">전문가</DarkButton>
      </>,
    );
    expect(appLinks()).toEqual(["/about", "/search?q=%EC%B7%A8%EB%93%9D%EC%84%B8", "/search?q=%EA%B0%9C%ED%8E%B8%EC%95%88", "/search?q=%EC%9E%AC%EC%82%B0%EC%84%B8", "/news/a", "/tax", "/experts"]);
    expect(plainLinks()).toEqual(["https://www.wetax.go.kr"]);
  });
});

describe("허브·상황 화면 컴포넌트의 사이트 안 링크도 앱 링크로 그린다 (W2-b 3단계)", () => {
  it("헤더 하위 메뉴 · 링크 탭 · 단계 타임라인 링크 단계 · 상황 카드", () => {
    withApp(
      <>
        <Header submenus={{ tax: [{ key: "tax:news", label: "뉴스 전체", href: "/news?section=tax" }] }} />
        <TabNav label="하위 분야" current="all" items={[{ id: "all", label: "전체", href: "/tax" }, { id: "interpretations", label: "해석", href: "/tax/interpretations" }]} />
        <StepTimeline steps={[{ title: "취득", href: "/news/acq" }, { title: "보유" }]} />
        <SituationCard href="/situations/car-sold" pictogram="car-sold" title="차를 팔았어요" description="돌려받을 세금" />
      </>,
    );
    expect(appLinks()).toEqual(["/", "/tax", "/news?section=tax", "/realestate", "/finance", "/local", "/tax", "/tax/interpretations", "/news/acq", "/situations/car-sold"]);
    expect(plainLinks()).toEqual([]);
  });

  it("다음 행동 띠(비슷한 사례·버튼) · 해결 사례 제목과 근거 · 분야 지방세 포인트 · 지자체 허브 블록 더 보기 — 외부 근거는 a 요소", () => {
    withApp(
      <>
        <NextActionBand similarCases={[{ href: "/news/case-1", title: "사례" }]} actions={[{ key: "same_section", label: "같은 분야 더 보기", href: "/tax", enabled: true }]} />
        <SolvedCaseCard
          title="환급 사례"
          href="/news/solved-1"
          situation="상황"
          issue="쟁점"
          result={{ conclusion: "accepted", text: "환급", basis: [{ label: "조심2025지0001", href: "https://www.tt.go.kr/a", external: true }, { label: "해석 기사", href: "/news/basis" }] }}
          lesson="교훈"
        />
        <FieldTaxPoint points={["포인트"]} basisDate="2026-10-01" links={[{ label: "해설", href: "/news/explainer" }]} />
        <LocalHubBlocks localTax={{ items: [<p key="a">기사</p>], more: { href: "/local?topic=local_tax", label: "더 보기" } }} />
      </>,
    );
    expect(appLinks()).toEqual(["/news/case-1", "/tax", "/news/solved-1", "/news/basis", "/news/explainer", "/local?topic=local_tax"]);
    expect(plainLinks()).toEqual(["https://www.tt.go.kr/a"]);
  });
});

describe("기사 신뢰 블록의 사이트 안 링크 (W2-b 4단계)", () => {
  it("기자 소개 블록 — 인물 페이지·정책 링크는 화면 전환, 「지방세로 읽기」 사이트 안 링크도 화면 전환·SM 계산기는 새 창 a 요소, 갱신 배너 트래커 링크도 화면 전환", () => {
    withApp(
      <>
        <ReporterBlock kind="report" author={{ name: "김가온", slug: "kim-gaon", beat: "지방세" }} publishedAt="2026-10-18T00:00:00Z" correctionHref="/about/corrections" editorialPolicyHref={null} />
        <TaxLensBox
          taxes={["취득세"]}
          points={["잔금일과 등기일 중 빠른 날이 취득일입니다."]}
          links={{ explainer: { href: "/news/acquisition-date", enabled: true }, smCalculator: { href: "https://sm.example.com/calc", enabled: true } }}
          reviewer="이감수"
          basisDate="2026-10-01"
        />
        <UpdateBanner stage="공포" changedAt="2026-10-15" trackerHref="/tax/amendments/2026-reform" />
      </>,
    );
    expect(appLinks()).toEqual(["/people/kim-gaon", "/about/corrections", "/news/acquisition-date", "/tax/amendments/2026-reform"]);
    expect(plainLinks()).toEqual(["https://sm.example.com/calc"]);
  });
});
