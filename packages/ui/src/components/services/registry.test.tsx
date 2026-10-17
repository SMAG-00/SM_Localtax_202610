// services 묶음 견본 등록 — PRD-00 8.6 이름(한글 그대로) 18종과 루트 data-ui가 실제 렌더 결과와 같다 (DS-02)
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { registry } from "./registry";
import { registry as baseRegistry } from "../base.registry";
import * as services from "./index";

const NAMES_8_6 = [
  "기자 소개 블록",
  "정정 이력 블록",
  "갱신 배너",
  "해석 원문 블록",
  "「지방세로 읽기」 박스",
  "FAQ 블록",
  "핵심 요약 상자",
  "상품 카드",
  "외부 계산기 연결 카드",
  "SM 계산기 카드",
  "전문가 카드",
  "인물 페이지 머리",
  "AI 도우미 런처",
  "AI 도우미 패널",
  "답변 카드",
  "진행 상태",
  "최적화 점검 패널",
  "제휴 준비 지표 카드",
];

const link = (url: string) => ({ url, status: "ok" as const, checkedAt: "2026-10-12" });

/** 이름별 최소 렌더 견본 — 루트 요소의 data-ui를 확인한다 */
const SAMPLES: Record<string, ReactElement> = {
  "기자 소개 블록": <services.ReporterBlock kind="report" author={{ name: "홍길동", slug: "hong", beat: "지방세" }} publishedAt="2026-10-17T00:00:00Z" />,
  "정정 이력 블록": <services.CorrectionHistory entries={[{ id: "1", kind: "correction", date: "2026-10-18", what: "기한", why: "오기" }]} />,
  "갱신 배너": <services.UpdateBanner stage="공포" changedAt="2026-10-15" trackerHref="/tax/amendments/x" />,
  "해석 원문 블록": (
    <services.InterpretationSource docType="예규" issuer="행정안전부" docNumber="1" decidedAt="2026-03-02" summary="요지" sourceUrl="https://www.law.go.kr/" rightsConfirmed />
  ),
  "「지방세로 읽기」 박스": (
    <services.TaxLensBox taxes={["취득세"]} points={["한 줄"]} links={{ explainer: { href: "/news/x", enabled: true } }} reviewer="홍길동 세무사" basisDate="2026-10-01" />
  ),
  "FAQ 블록": (
    <services.FaqBlock
      items={[
        { id: "1", question: "질문 1", answer: "답 1" },
        { id: "2", question: "질문 2", answer: "답 2" },
      ]}
    />
  ),
  "핵심 요약 상자": <services.KeySummary lines={["요약"]} />,
  "상품 카드": (
    <services.ProductCard name="지방세 실무" audience="실무자" format="book" verifiedAt="2026-10-01" saleStatus="on_sale" order={{ mode: "request_form", href: "/store/apply" }} />
  ),
  "외부 계산기 연결 카드": <services.ExternalCalculatorCard link={link("https://inherit.example.org/")} fallback={link("https://www.nts.go.kr/")} />,
  "SM 계산기 카드": <services.SmCalculatorCard calcKey="acquisition" link={link("https://sm.example.org/a")} fallback={link("https://www.wetax.go.kr/")} usageNote="승인 회원 전용" />,
  "전문가 카드": (
    <services.ExpertCard name="홍길동" slug="hong" category="cpa" fields={["지방세"]} affiliation="길동회계" checkedAt="2026-09-30" verification="verified" />
  ),
  "인물 페이지 머리": <services.PersonHeader name="홍길동" roles={["reporter"]} checkedAt="2026-10-01" bio={[]} />,
  "AI 도우미 런처": <services.AssistantLauncher />,
  "AI 도우미 패널": <services.AssistantPanel aiNotice="생성형 AI 안내" firstUseNotice={["세무 자문이 아닙니다."]} />,
  "답변 카드": <services.AnswerCard paragraphs={["결론"]} citations={[]} />,
  "진행 상태": <services.ProgressStatus stage="searching" />,
  "최적화 점검 패널": <services.OptimizationPanel scores={{ seo: 1, aeo: 2, geo: 3, common: 4 }} checks={[]} />,
  "제휴 준비 지표 카드": <services.PartnerReadinessCard name="월 송출량" value="120" monthsOfData={12} lowestThreeMonths="98" zeroRisk={false} rule={null} />,
};

describe("services 견본 등록", () => {
  it("PRD-00 8.6 이름 18종을 글자 그대로 등록한다", () => {
    expect(registry.map((r) => r.name)).toEqual(NAMES_8_6);
  });

  it("data-ui는 케밥 표기이고 서로·기본 컴포넌트와 겹치지 않는다", () => {
    const uis = registry.map((r) => r.ui);
    uis.forEach((ui) => expect(ui).toMatch(/^[a-z]+(-[a-z]+)*$/));
    expect(new Set(uis).size).toBe(uis.length);
    const base = new Set(baseRegistry.map((r) => r.ui));
    uis.forEach((ui) => expect(base.has(ui)).toBe(false));
  });

  it.each(NAMES_8_6)("'%s' — 렌더한 루트 요소의 data-ui가 등록 값과 같다", (name) => {
    const entry = registry.find((r) => r.name === name)!;
    const { container } = render(SAMPLES[name]);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe(entry.ui);
  });
});
