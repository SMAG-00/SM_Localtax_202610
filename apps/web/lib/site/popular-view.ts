// 많이 본 기사(ART-11)·상담 사례 HOT(HOME-05) 화면 값 — 순수 함수 (시험 popular-view.test.ts, docs/dev/W2-c_설계.md 8.2)
//  · 창 글자는 설정(popular_rules.window_hours)에서 — 168시간이면 "최근 7일"
//  · 집계 시각은 한국 시간 고정폭 줄. 아직 집계 전이면 줄이 없다
//  · 누름 측정 속성: 많이 본 기사 popular_article_clicked(기사 번호·화면 순위·위치) · HOT hot_article_clicked(기사 번호·목록 순위·고정 여부)
import type { SectionKey } from "@/lib/server/public/constants";
import { kstDateTime } from "./article-view";

export const POPULAR_EYEBROW = "POPULAR";
export const POPULAR_TITLE = "많이 본 기사";
export const POPULAR_EMPTY = "아직 집계된 기사가 없습니다. 집계는 1시간마다 바뀝니다.";

export function windowLabel(hours: number): string {
  return hours % 24 === 0 ? `최근 ${hours / 24}일` : `최근 ${hours}시간`;
}

export function computedLine(iso: string | null): string | null {
  return iso ? `집계 ${kstDateTime(iso)} (한국 시간)` : null;
}

type ClickItem = { href: string; section: SectionKey; props: Record<string, string | number | boolean> };

export function popularClickItems(items: ReadonlyArray<{ id: number; href: string; section: SectionKey }>, position: "sidebar" | "list"): ClickItem[] {
  return items.map((a, i) => ({ href: a.href, section: a.section, props: { article_id: a.id, rank: i + 1, position } }));
}

export function hotClickItems(list: ReadonlyArray<{ item: { id: number; href: string }; rank: number; pinned: boolean }>): ClickItem[] {
  return list.map((e) => ({ href: e.item.href, section: "tax", props: { article_id: e.item.id, rank: e.rank, pinned: e.pinned } }));
}
