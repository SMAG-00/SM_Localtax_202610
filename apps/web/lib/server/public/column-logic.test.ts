// 칼럼 목록 — 연재 회차 순서 (ART-04)
import { describe, expect, test } from "vitest";
import { episodeLabel, groupColumns } from "./column-logic";
import { listItem } from "./test-items";

const col = (id: number, series: string | null, episode: number | null, at: string) =>
  listItem({ id, contentType: "opinion", seriesTitle: series, seriesEpisode: episode, publishedAt: at, title: `칼럼 ${id}` });

describe("칼럼 묶음", () => {
  test("연재마다 회차 오름차순 — 늦게 발행된 회차가 먼저 나와도 1회부터", () => {
    const groups = groupColumns([col(3, "그때와 지금", 3, "2026-10-15T00:00:00Z"), col(1, "그때와 지금", 1, "2026-10-01T00:00:00Z"), col(2, "그때와 지금", 2, "2026-10-08T00:00:00Z")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.series).toBe("그때와 지금");
    expect(groups[0]!.items.map((a) => a.seriesEpisode)).toEqual([1, 2, 3]);
  });

  test("묶음 순서는 가장 최근에 새 회차가 나온 연재부터, 단독 칼럼은 마지막 한 묶음(최신 순)", () => {
    const groups = groupColumns([
      col(10, "A 연재", 1, "2026-09-01T00:00:00Z"),
      col(11, "A 연재", 2, "2026-10-01T00:00:00Z"),
      col(20, "B 연재", 1, "2026-10-10T00:00:00Z"),
      col(30, null, null, "2026-09-20T00:00:00Z"),
      col(31, null, null, "2026-10-12T00:00:00Z"),
    ]);
    expect(groups.map((g) => [g.series, g.items.map((a) => a.id)])).toEqual([
      ["B 연재", [20]],
      ["A 연재", [10, 11]],
      [null, [31, 30]],
    ]);
  });

  test("칼럼이 아닌 기사·같은 기사 두 번은 넣지 않는다, 0건이면 빈 목록", () => {
    expect(groupColumns([listItem({ id: 5, contentType: "explainer" }), col(6, null, null, "2026-10-01T00:00:00Z"), col(6, null, null, "2026-10-01T00:00:00Z")]).map((g) => g.items.map((a) => a.id))).toEqual([[6]]);
    expect(groupColumns([])).toEqual([]);
  });

  test("회차 글자 — 연재 칼럼만 'n회'", () => {
    expect(episodeLabel({ seriesTitle: "A", seriesEpisode: 3 })).toBe("3회");
    expect(episodeLabel({ seriesTitle: null, seriesEpisode: null })).toBeNull();
  });
});
