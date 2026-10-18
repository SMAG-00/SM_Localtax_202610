// 많이 본 기사·상담 사례 HOT 화면 값 (ART-11 · HOME-05 — W2-c 설계 8.2): 창 글자·집계 시각·누름 측정 속성
import { describe, expect, test } from "vitest";
import { validateEvent } from "@/lib/analytics/events";
import { computedLine, hotClickItems, popularClickItems, windowLabel } from "./popular-view";

describe("windowLabel — 창 길이(popular_rules.window_hours) 글자", () => {
  test.each([
    [168, "최근 7일"],
    [24, "최근 1일"],
    [48, "최근 2일"],
    [36, "최근 36시간"],
    [1, "최근 1시간"],
  ])("%s시간 → %s", (hours, label) => expect(windowLabel(hours)).toBe(label));
});

describe("computedLine — 집계 시각 (한국 시간, 고정폭 줄)", () => {
  test("UTC 05:05 → 한국 14:05", () => expect(computedLine("2026-10-18T05:05:00Z")).toBe("집계 2026-10-18 14:05 (한국 시간)"));
  test("아직 집계 전이면 null", () => expect(computedLine(null)).toBeNull());
});

describe("누름 측정 속성 — 수집 API 검사(2.2)를 지나는 모양", () => {
  const items = [
    { id: 11, href: "/news/a", section: "tax" as const },
    { id: 12, href: "/news/b", section: "local" as const },
  ];
  test("많이 본 기사 — 순위는 화면 자리(1부터), 위치는 sidebar·list, 분야는 기사 분야", () => {
    const side = popularClickItems(items, "sidebar");
    expect(side).toEqual([
      { href: "/news/a", section: "tax", props: { article_id: 11, rank: 1, position: "sidebar" } },
      { href: "/news/b", section: "local", props: { article_id: 12, rank: 2, position: "sidebar" } },
    ]);
    for (const i of [...side, ...popularClickItems(items, "list")]) {
      expect(validateEvent({ name: "popular_article_clicked", section: i.section, props: i.props }).ok, JSON.stringify(i)).toBe(true);
    }
  });
  test("상담 사례 HOT — 순위·고정 여부, 분야는 지방세", () => {
    const hot = hotClickItems([
      { item: { id: 21, href: "/news/c" }, rank: 1, pinned: true },
      { item: { id: 22, href: "/news/d" }, rank: 2, pinned: false },
    ]);
    expect(hot).toEqual([
      { href: "/news/c", section: "tax", props: { article_id: 21, rank: 1, pinned: true } },
      { href: "/news/d", section: "tax", props: { article_id: 22, rank: 2, pinned: false } },
    ]);
    for (const i of hot) expect(validateEvent({ name: "hot_article_clicked", section: i.section, props: i.props }).ok).toBe(true);
  });
});
