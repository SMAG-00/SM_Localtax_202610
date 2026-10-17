// discovery 묶음 견본 등록 (PRD-00 8.6 · DS-02) — 이름이 표 그대로이고, 컴포넌트 루트의 data-ui가 등록 값과 같다
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { registry } from "./registry";
import * as discovery from "./index";

const SAMPLES: Record<string, ReactElement> = {
  픽토그램: <discovery.Pictogram name="acquisition" label="취득세" />,
  "4대 분야 카드": <discovery.FieldCards />,
  "상황 카드": <discovery.SituationCard href="/s" pictogram="car-sold" title="차를 팔았어요" description="한 줄" />,
  "기사 카드": <discovery.ArticleCard href="/news/a" title="제목" summary="요약" section="tax" publishedAt="2026-10-14" />,
  "많이 본 기사 목록": <discovery.PopularArticles items={[{ href: "/news/a", title: "제목" }]} />,
  "동영상 카드": (
    <discovery.VideoCard
      title="제목"
      summary="요약"
      thumbnail={{ src: "/t.jpg", width: 16, height: 9 }}
      durationSeconds={60}
      captions
      href="/news/v"
    />
  ),
  "인포그래픽 블록": (
    <discovery.InfographicBlock title="제목" image={{ src: "/i.png", alt: "설명", width: 4, height: 3 }} data={{ kind: "list", items: ["한 줄"] }} />
  ),
  "해결 사례 카드": (
    <discovery.SolvedCaseCard situation="상황" issue="쟁점" result={{ conclusion: "accepted", text: "결과", basis: [{ label: "근거" }] }} lesson="교훈" />
  ),
  "다음 행동 띠": <discovery.NextActionBand similarCases={[{ href: "/n", title: "사례" }]} actions={[]} />,
};

describe("discovery 견본 등록", () => {
  it("PRD-00 8.6 이름 그대로 9종이다", () => {
    expect(registry.map((r) => r.name)).toEqual([
      "픽토그램",
      "4대 분야 카드",
      "상황 카드",
      "기사 카드",
      "많이 본 기사 목록",
      "동영상 카드",
      "인포그래픽 블록",
      "해결 사례 카드",
      "다음 행동 띠",
    ]);
  });

  it("data-ui 값은 겹치지 않는 kebab-case다", () => {
    const uis = registry.map((r) => r.ui);
    expect(new Set(uis).size).toBe(uis.length);
    for (const ui of uis) expect(ui).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it.each(registry.map((r) => [r.name, r.ui] as const))("%s 컴포넌트의 루트 요소가 data-ui=%s를 갖는다", (name, ui) => {
    const { container } = render(SAMPLES[name]);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe(ui);
    expect(container.querySelectorAll(`[data-ui="${ui}"]`)).toHaveLength(1);
  });
});
