// shell 묶음 견본 등록 — PRD-00 8.6 이름(한글 그대로) 15종과 루트 요소 data-ui가 1:1로 맞는지 실제 렌더로 확인한다
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { registry as baseRegistry } from "../base.registry";
import { registry } from "./registry";
import {
  ArticleTypeBadge,
  EditorialFieldBadge,
  Footer,
  Header,
  Hero,
  HomeSearch,
  HotBadge,
  PartnerBadge,
  ProgressStageBadge,
  SourceLine,
  StepTimeline,
  TaxAccordion,
  TaxKindBadge,
  TextField,
  UnconfirmedChip,
} from "./index";

const samples: Record<string, ReactElement> = {
  header: <Header />,
  hero: <Hero title="지방세 소식" />,
  footer: <Footer disclaimer="참고용 해설입니다." links={[]} />,
  "step-timeline": <StepTimeline steps={[{ title: "취득" }]} />,
  "tax-accordion": (
    <TaxAccordion items={[{ id: "a", name: "취득세", kind: "local", summary: "요약", base: "가액", rate: "1%", due: "60일", law: "지방세법 제11조" }]} />
  ),
  "form-field": <TextField id="f" label="이름" />,
  "home-search": <HomeSearch label="검색어" />,
  "source-line": <SourceLine source="행정안전부" baseDate="2025-12-31" checkedAt="2026-10-13" />,
  "tax-kind-badge": <TaxKindBadge kind="local" />,
  "article-type-badge": <ArticleTypeBadge type="explainer" />,
  "editorial-field-badge": <EditorialFieldBadge field="local_finance" />,
  "partner-badge": <PartnerBadge partner="가나다 세무법인" />,
  "hot-badge": <HotBadge />,
  "unconfirmed-chip": <UnconfirmedChip />,
  "progress-stage-badge": <ProgressStageBadge events={[{ stage: "announced", occurredOn: "2026-08-26" }]} today="2026-10-17" />,
};

describe("shell 등록부", () => {
  it("PRD-00 8.6 표의 이름 그대로 15종", () => {
    expect(registry.map((r) => r.name)).toEqual([
      "헤더",
      "히어로",
      "바닥글",
      "단계 타임라인",
      "세목 아코디언",
      "폼 요소",
      "홈 큰 입력창",
      "데이터 출처 줄",
      "국세·지방세 배지",
      "기사 유형 배지",
      "편집 분야 배지",
      "제휴 배지",
      "HOT 배지",
      "`확정 아님` 칩",
      "진행 단계 배지",
    ]);
  });

  it("data-ui 값은 묶음 안에서, 그리고 기본 컴포넌트와도 겹치지 않는다", () => {
    const ui = registry.map((r) => r.ui);
    expect(new Set(ui).size).toBe(ui.length);
    const base = new Set(baseRegistry.map((r) => r.ui));
    expect(ui.filter((u) => base.has(u))).toEqual([]);
    ui.forEach((u) => expect(u).toMatch(/^[a-z]+(-[a-z]+)*$/));
  });

  it("등록한 컴포넌트마다 렌더한 루트 요소의 data-ui가 등록 값과 같다", () => {
    expect(Object.keys(samples).sort()).toEqual(registry.map((r) => r.ui).sort());
    for (const entry of registry) {
      const { container, unmount } = render(samples[entry.ui]);
      expect({ name: entry.name, ui: container.firstElementChild?.getAttribute("data-ui") }).toEqual({ name: entry.name, ui: entry.ui });
      unmount();
    }
  });
});
