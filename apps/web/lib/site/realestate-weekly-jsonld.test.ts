import { describe, expect, test } from "vitest";
import { weeklyJsonLdContent } from "@/components/site/RealestateWeeklyView";
import type { WeeklyIssue } from "@/lib/server/public/realestate-weekly-logic";

const issue: WeeklyIssue = {
  issueId: 7,
  week: "2026-43",
  publishedAt: "2026-10-23T01:00:00Z",
  items: [1, 2, 3].map((n) => ({ rank: n, taxItems: ["취득세"], point: "한 줄", articleId: n, href: `/news/a-${n}`, title: `기사 ${n}` })),
};

describe("재테크 포인트 구조화 데이터", () => {
  test("화면의 제목·주소·항목 순서와 같은 CollectionPage를 낸다", () => {
    const node = JSON.parse(weeklyJsonLdContent(issue, "https://news.example"));
    const top = Array.isArray(node) ? node[0] : node;
    expect(top["@type"]).toBe("CollectionPage");
    expect(top.name).toBe("금주 부동산 재테크 2026년 43주차");
    expect(top.url).toBe("https://news.example/realestate/weekly/2026-43");
    expect(top.datePublished).toBe("2026-10-23");
    expect(top.mainEntity.itemListElement.map((i: { position: number; url: string }) => [i.position, i.url])).toEqual([
      [1, "https://news.example/news/a-1"],
      [2, "https://news.example/news/a-2"],
      [3, "https://news.example/news/a-3"],
    ]);
  });
  test("투자 권유 한 줄(point)은 구조화 데이터에 싣지 않는다", () => {
    expect(weeklyJsonLdContent(issue, "https://news.example")).not.toContain("한 줄");
  });
});
