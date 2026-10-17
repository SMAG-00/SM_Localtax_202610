// 칼럼 목록 규칙 (ART-04 — 칼럼은 분야별 칼럼 목록에 연재 회차 순서로 나온다) — 순수 함수 (시험 column-logic.test.ts)
//  · 연재마다 한 묶음 — 묶음 안은 회차 오름차순(1회 → 2회 → …). 묶음 순서는 가장 최근에 새 회차가 나온 연재부터
//  · 연재 없는 칼럼(단독 칼럼)은 마지막 묶음 하나 — 최신 발행 순
//  · 칼럼(opinion)이 아닌 기사는 넣지 않는다 (목록 읽기가 거르고, 여기서도 한 번 더)
import type { ArticleListItem } from "./cards";

export interface ColumnGroup {
  /** 연재 이름 — 단독 칼럼 묶음은 null */
  series: string | null;
  items: ArticleListItem[];
}

const time = (a: ArticleListItem) => Date.parse(a.publishedAt ?? "") || 0;

export function groupColumns(items: readonly ArticleListItem[]): ColumnGroup[] {
  const columns = [...new Map(items.filter((a) => a.contentType === "opinion").map((a) => [a.id, a])).values()];
  const bySeries = new Map<string, ArticleListItem[]>();
  const single: ArticleListItem[] = [];
  for (const a of columns) {
    if (a.seriesTitle && a.seriesEpisode !== null) {
      const list = bySeries.get(a.seriesTitle) ?? [];
      list.push(a);
      bySeries.set(a.seriesTitle, list);
    } else single.push(a);
  }
  const groups: ColumnGroup[] = [...bySeries.entries()].map(([series, list]) => ({
    series,
    items: list.sort((x, y) => (x.seriesEpisode ?? 0) - (y.seriesEpisode ?? 0) || time(x) - time(y) || x.id - y.id),
  }));
  const latest = (g: ColumnGroup) => Math.max(...g.items.map(time));
  groups.sort((x, y) => latest(y) - latest(x) || (x.series ?? "").localeCompare(y.series ?? "", "ko"));
  if (single.length) groups.push({ series: null, items: single.sort((x, y) => time(y) - time(x) || y.id - x.id) });
  return groups;
}

/** 회차 글자 — "3회" (연재 칼럼만) */
export function episodeLabel(a: Pick<ArticleListItem, "seriesTitle" | "seriesEpisode">): string | null {
  return a.seriesTitle && a.seriesEpisode !== null ? `${a.seriesEpisode}회` : null;
}
