import "server-only";
import { readStoredSolvedCase } from "../articles/content";
import { solvedCaseView, type SolvedCaseView } from "./article-logic";
import type { ArticleListItem } from "./cards";
import { HOT_CATEGORY, LIMITS } from "./constants";
import { publicDb, rowsOf } from "./db";
import { readArticleList, readCategories, readPublicSettings } from "./reads";
import { num } from "./rows";
import { selectHotBlock, sidebarPicks } from "@/lib/analytics/ranking";

// 많이 본 기사(ART-11)·상담 사례 HOT(HOME-05) 공개 읽기 (docs/dev/W2-c_설계.md 8.2) — anon 키로 순위 표(article_rankings)의
// 순위·기사 번호·고정·집계 시각 칸만 읽는다. RLS가 지금 공개된 기사의 행만 준다(비공개·삭제 기사는 다음 집계 전에도 빠진다).
// 원본 이벤트·시간 단위 집계·점수는 읽지 않는다(권한 0). 건수는 설정 popular_rules(사이드바·목록), HOT 카드 3·목록 5는 PRD 숫자(LIMITS).

type Db = ReturnType<typeof publicDb>;

interface RankingRow {
  article_id: number;
  rank: number;
  pinned: boolean;
  computed_at: string;
}

async function readRanking(db: Db, list: "popular" | "hot") {
  const rows = await rowsOf<RankingRow>(db.from("article_rankings").select("article_id, rank, pinned, computed_at").eq("list", list).order("rank"), "순위");
  return { rows: rows.map((r) => ({ id: num(r.article_id), pinned: r.pinned === true })), computedAt: rows[0]?.computed_at ?? null };
}

/** 순위 순서대로 공개 목록 카드 — 카드로 읽히지 않는 기사(유형 없음·금주 핫뉴스)는 빠진다 */
async function rankedItems(db: Db, rows: readonly { id: number; pinned: boolean }[]) {
  const { items } = await readArticleList(db, { ids: rows.map((r) => r.id), limit: Math.max(1, rows.length) });
  const byId = new Map(items.map((i) => [i.id, i]));
  return rows.flatMap((r) => {
    const item = byId.get(r.id);
    return item ? [{ item, pinned: r.pinned }] : [];
  });
}

export interface PopularList {
  /** 순위 순서 — 화면 순위는 자리 번호(1부터) */
  items: ArticleListItem[];
  /** 집계 시각 (ISO) — 아직 집계 전이면 null */
  computedAt: string | null;
  /** 창 길이 (popular_rules.window_hours) */
  windowHours: number;
}

async function readPopular(limit: number, excludeId?: number): Promise<PopularList> {
  const settings = await readPublicSettings();
  if (limit <= 0) return { items: [], computedAt: null, windowHours: settings.popular.windowHours };
  const db = publicDb();
  const ranking = await readRanking(db, "popular");
  const items = (await rankedItems(db, ranking.rows)).map((r) => r.item);
  return {
    items: excludeId === undefined ? items.slice(0, limit) : sidebarPicks(items, excludeId, limit),
    computedAt: ranking.computedAt,
    windowHours: settings.popular.windowHours,
  };
}

/** /news/popular — 목록 list_size건 */
export async function getPopularList(): Promise<PopularList> {
  const settings = await readPublicSettings();
  return readPopular(settings.popular.listSize);
}

/** 기사 사이드바 — 지금 보는 기사를 빼고 sidebar_size건 */
export async function readPopularSidebar(currentId: number): Promise<ArticleListItem[]> {
  const settings = await readPublicSettings();
  return (await readPopular(settings.popular.sidebarSize, currentId)).items;
}

export interface HotEntry {
  item: ArticleListItem;
  /** HOT 배지 — 고정이거나 최근 창 안 점수가 있는 기사. 최신 상담 사례로 채운 줄은 false */
  hot: boolean;
  pinned: boolean;
  /** 목록 자리 (1부터 — hot_article_clicked.rank) */
  rank: number;
}

export interface HotBlock {
  /** 해결 사례 카드 (점수 상위 해결 사례, 모자라면 최신 해결 사례) */
  cards: Array<{ item: ArticleListItem; card: SolvedCaseView }>;
  list: HotEntry[];
  computedAt: string | null;
  /** 상담 사례 분야 목록 주소 */
  href: string;
}

/** 상담 사례 HOT 블록 (지방세 허브·상담 사례 분야 목록) — 상담 사례 기사가 하나도 없으면 null (블록 0) */
export async function getHotBlock(): Promise<HotBlock | null> {
  const db = publicDb();
  const categories = await readCategories();
  const category = categories.find((c) => c.section === HOT_CATEGORY.section && c.slug === HOT_CATEGORY.slug);
  if (!category) return null;
  const categoryId = num(category.id);
  const pool = LIMITS.hotCards + LIMITS.hotList;
  const [ranking, latest, latestSolved] = await Promise.all([
    readRanking(db, "hot"),
    readArticleList(db, { section: HOT_CATEGORY.section, categoryId, limit: pool * 2 }),
    readArticleList(db, { section: HOT_CATEGORY.section, categoryId, subtype: "solved_case", limit: pool * 2 }),
  ]);
  const ranked = (await rankedItems(db, ranking.rows)).filter((r) => r.item.categoryId === categoryId);
  const solvedIds = [...new Set([...ranked.map((r) => r.item), ...latestSolved.items].filter((i) => i.subtype === "solved_case").map((i) => i.id))];
  const bodies = solvedIds.length
    ? await rowsOf<{ id: number; solved_case: unknown }>(db.from("public_articles").select("id, solved_case").in("id", solvedIds).eq("subtype", "solved_case"), "해결 사례 카드")
    : [];
  const cardViews = new Map<number, SolvedCaseView>();
  for (const b of bodies) {
    const view = solvedCaseView(readStoredSolvedCase(b.solved_case));
    if (view) cardViews.set(num(b.id), view);
  }
  const block = selectHotBlock({
    ranked,
    latest: latest.items,
    latestSolved: latestSolved.items,
    canCard: (i) => cardViews.has(i.id),
    cards: LIMITS.hotCards,
    list: LIMITS.hotList,
  });
  if (block.cards.length === 0 && block.list.length === 0) return null;
  return {
    cards: block.cards.map((item) => ({ item, card: cardViews.get(item.id)! })),
    list: block.list.map((e, i) => ({ item: e.item, hot: e.hot, pinned: e.pinned, rank: i + 1 })),
    computedAt: ranking.computedAt,
    href: `/${HOT_CATEGORY.section}/${HOT_CATEGORY.slug}`,
  };
}
