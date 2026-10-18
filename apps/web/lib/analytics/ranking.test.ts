import { describe, expect, test } from "vitest";
import { HOUR_MS, countArticleHours, hourStart, type ArticleEvent } from "./aggregate";
import { checkHotPin, hotScore, inRankingWindow, rankHot, rankPopular, rankingWindow, selectHotBlock, sidebarPicks, totalsInWindow, type ArticleTotals, type RankCandidate } from "./ranking";

// 많이 본 기사(ART-11)·상담 사례 HOT(HOME-05) 순위 규칙 (docs/dev/W2-c_설계.md 8.2). 시각은 UTC 밀리초.
const T = (iso: string) => Date.parse(iso);
const totals = (articleId: number, viewsHuman: number, shares = 0, engagedViews = 0): ArticleTotals => ({ articleId, viewsHuman, shares, engagedViews });
const cand = (id: number, publishedAt: string, contentType: string | null = "explainer"): RankCandidate => ({ id, contentType, publishedAt });
const ids = (entries: readonly { articleId: number }[]) => entries.map((e) => e.articleId);
const POPULAR = { exclude_content_types: ["digest", "sponsored"] };
const WEIGHTS = { version: "w1", window_days: 7, view: 1, share: 5, engaged: 2, max_pins: 2 };

describe("rankingWindow — 집계 시각 기준 window_hours시간 (끝난 시간대만)", () => {
  const NOW = T("2026-10-18T12:07:00Z");
  const w = rankingWindow(NOW, 168);
  test("끝 = 지금 시간대 시작(12:00), 시작 = 168시간 전(10-11 12:00)", () => {
    expect(new Date(w.end).toISOString()).toBe("2026-10-18T12:00:00.000Z");
    expect(new Date(w.start).toISOString()).toBe("2026-10-11T12:00:00.000Z");
  });
  test("168시간 전 시간대는 포함, 169시간 전 시간대는 제외, 바로 앞 시간대 포함, 지금(끝나지 않은) 시간대 제외", () => {
    const end = hourStart(NOW);
    expect(inRankingWindow(end - 168 * HOUR_MS, w)).toBe(true);
    expect(inRankingWindow(end - 169 * HOUR_MS, w)).toBe(false);
    expect(inRankingWindow(end - HOUR_MS, w)).toBe(true);
    expect(inRankingWindow(end, w)).toBe(false);
  });
  test("시간대 행 합계 — 창 안 행만 더한다", () => {
    const end = hourStart(NOW);
    const rows = [
      { articleId: 1, hour: end - 168 * HOUR_MS, viewsHuman: 2, shares: 1, engagedViews: 0 },
      { articleId: 1, hour: end - 169 * HOUR_MS, viewsHuman: 50, shares: 9, engagedViews: 9 },
      { articleId: 1, hour: end - HOUR_MS, viewsHuman: 3, shares: 0, engagedViews: 1 },
      { articleId: 1, hour: end, viewsHuman: 70, shares: 0, engagedViews: 0 },
    ];
    expect(totalsInWindow(rows, w)).toEqual([totals(1, 5, 1, 1)]);
  });
});

describe("rankPopular — 최근 window_hours시간 사람 조회 순 (ART-11)", () => {
  test("PRD 시험: 봇 조회 100회 + 사람 조회 3회인 기사 A < 사람 조회 5회인 기사 B", () => {
    const hour = T("2026-10-18T10:00:00Z");
    let id = 1;
    const e = (articleId: number, visitorId: string, isBot = false): ArticleEvent => ({ id: id++, name: "article_viewed", at: hour + id * 1000, visitorId, articleId, isBot, isStaff: false });
    const events = [...Array.from({ length: 100 }, () => e(1, "bot", true)), ...["a", "b", "c"].map((v) => e(1, v)), ...["p", "q", "r", "s", "t"].map((v) => e(2, v))];
    const stats = countArticleHours(events, { from: hour, to: hour + HOUR_MS }, 30);
    expect(stats.find((s) => s.articleId === 1)?.viewsAll).toBe(103);
    const w = rankingWindow(T("2026-10-18T12:00:00Z"), 168);
    const ranked = rankPopular(totalsInWindow(stats, w), [cand(1, "2026-10-10T00:00:00Z"), cand(2, "2026-10-01T00:00:00Z")], POPULAR, 20);
    expect(ids(ranked)).toEqual([2, 1]);
    expect(ranked.map((r) => [r.rank, r.score, r.pinned])).toEqual([
      [1, 5, false],
      [2, 3, false],
    ]);
  });

  test("조회 수가 같으면 최신 발행이 앞, 발행 시각도 같으면 번호가 큰 쪽(나중 기사)", () => {
    const ranked = rankPopular([totals(1, 4), totals(2, 4), totals(3, 4), totals(4, 9)], [cand(1, "2026-10-10T00:00:00Z"), cand(2, "2026-10-12T00:00:00Z"), cand(3, "2026-10-12T00:00:00Z"), cand(4, "2026-09-01T00:00:00Z")], POPULAR, 20);
    expect(ids(ranked)).toEqual([4, 3, 2, 1]);
  });

  test("공개 후보에 없는 기사(비공개·삭제)·사람 조회 0·제외 유형(digest·sponsored)은 순위에 없다, 최대 건수까지", () => {
    const ranked = rankPopular(
      [totals(1, 10), totals(2, 0), totals(3, 8), totals(4, 7), totals(5, 6), totals(6, 5)],
      [cand(2, "2026-10-12T00:00:00Z"), cand(3, "2026-10-12T00:00:00Z", "sponsored"), cand(4, "2026-10-12T00:00:00Z", "digest"), cand(5, "2026-10-12T00:00:00Z"), cand(6, "2026-10-12T00:00:00Z", "guide")],
      POPULAR,
      1,
    );
    expect(ids(ranked)).toEqual([5]);
    expect(ids(rankPopular([totals(3, 8)], [cand(3, "2026-10-12T00:00:00Z", "sponsored")], { exclude_content_types: [] }, 5))).toEqual([3]);
  });
});

describe("hotScore — 조회×view + 공유×share + 30초 이상 열람×engaged (가중치는 설정)", () => {
  test("기본 가중치 1·5·2: 조회 10·공유 2·열람 3 → 26", () => {
    expect(hotScore(totals(1, 10, 2, 3), WEIGHTS)).toBe(26);
  });
  test("가중치를 바꾸면 점수가 바뀐다 — 공유 0·열람 10이면 40", () => {
    expect(hotScore(totals(1, 10, 2, 3), { ...WEIGHTS, share: 0, engaged: 10 })).toBe(40);
  });
});

describe("rankHot — 편집자 고정(최대 max_pins건)이 맨 앞, 그다음 점수 순, 동점은 최신 발행 (HOME-05)", () => {
  const C = [cand(1, "2026-10-10T00:00:00Z"), cand(2, "2026-10-11T00:00:00Z"), cand(3, "2026-10-12T00:00:00Z"), cand(4, "2026-10-13T00:00:00Z"), cand(5, "2026-10-14T00:00:00Z")];
  test("고정 기사는 점수가 0이어도 맨 앞, 고정끼리는 점수·최신 순", () => {
    const ranked = rankHot([totals(1, 50), totals(2, 3), totals(3, 0), totals(4, 9)], C, new Set([3, 2]), WEIGHTS, 20);
    expect(ranked.map((r) => [r.articleId, r.pinned])).toEqual([
      [2, true],
      [3, true],
      [1, false],
      [4, false],
    ]);
  });
  test("고정이 max_pins(2)보다 많으면 2건만 고정으로 앞에 — 나머지는 점수대로 (0점이면 빠진다)", () => {
    const ranked = rankHot([totals(1, 5), totals(4, 2)], C, new Set([1, 4, 5]), WEIGHTS, 20);
    expect(ranked.map((r) => [r.articleId, r.pinned])).toEqual([
      [1, true],
      [4, true],
    ]);
    expect(rankHot([totals(1, 5)], C, new Set([1, 2]), { ...WEIGHTS, max_pins: 0 }, 20).map((r) => r.pinned)).toEqual([false]);
  });
  test("점수가 같으면 최신 발행이 앞 · 점수 0은 HOT이 아니다 · 후보(상담 사례 분야 공개 기사) 밖은 0", () => {
    const ranked = rankHot([totals(1, 4), totals(2, 0, 0, 2), totals(5, 4), totals(9, 99)], C, new Set(), WEIGHTS, 20);
    expect(ids(ranked)).toEqual([5, 2, 1]);
    expect(ranked.map((r) => r.score)).toEqual([4, 4, 4]);
  });
  test("가중치 설정을 바꾸면 순위가 바뀐다 — 조회 많은 1 vs 공유 많은 2", () => {
    const t = [totals(1, 20, 0, 0), totals(2, 2, 4, 0)];
    expect(ids(rankHot(t, C, new Set(), WEIGHTS, 20))).toEqual([2, 1]); // 22 vs 20
    expect(ids(rankHot(t, C, new Set(), { ...WEIGHTS, share: 1 }, 20))).toEqual([1, 2]); // 20 vs 6
  });
});

describe("selectHotBlock — 해결 사례 카드 3장(점수 상위 해결 사례) + HOT 목록 5건(카드에 나온 기사 제외), 같은 기사 0", () => {
  type Item = { id: number; subtype: string };
  const item = (id: number, solved = false): Item => ({ id, subtype: solved ? "solved_case" : "general" });
  const r = (i: Item, pinned = false) => ({ item: i, pinned });
  const can = () => true;

  test("점수 순 목록에서 해결 사례 상위 3개가 카드, 나머지가 HOT 목록 앞 5건 — 겹침 0", () => {
    const ranked = [r(item(1)), r(item(2, true)), r(item(3)), r(item(4, true)), r(item(5, true)), r(item(6, true)), r(item(7)), r(item(8)), r(item(9))];
    const b = selectHotBlock({ ranked, latest: [], latestSolved: [], canCard: can, cards: 3, list: 5 });
    expect(b.cards.map((c) => c.id)).toEqual([2, 4, 5]);
    expect(b.list.map((x) => [x.item.id, x.hot])).toEqual([
      [1, true],
      [3, true],
      [6, true],
      [7, true],
      [8, true],
    ]);
    const all = [...b.cards.map((c) => c.id), ...b.list.map((x) => x.item.id)];
    expect(new Set(all).size).toBe(all.length);
  });

  test("편집자 고정 기사는 해결 사례여도 카드로 가지 않고 HOT 목록 맨 앞 (고정 표시)", () => {
    const b = selectHotBlock({ ranked: [r(item(1, true), true), r(item(2, true)), r(item(3))], latest: [], latestSolved: [], canCard: can, cards: 3, list: 5 });
    expect(b.cards.map((c) => c.id)).toEqual([2]);
    expect(b.list.map((x) => [x.item.id, x.pinned, x.hot])).toEqual([
      [1, true, true],
      [3, false, true],
    ]);
  });

  test("최근 7일 HOT이 5건 미만이면 HOT 배지 없이 최신 상담 사례로 채운다 — 카드·HOT에 나온 기사는 빼고", () => {
    const b = selectHotBlock({ ranked: [r(item(1)), r(item(2, true))], latest: [item(2, true), item(1), item(10), item(11), item(12), item(13), item(14)], latestSolved: [], canCard: can, cards: 3, list: 5 });
    expect(b.cards.map((c) => c.id)).toEqual([2]);
    expect(b.list.map((x) => [x.item.id, x.hot])).toEqual([
      [1, true],
      [10, false],
      [11, false],
      [12, false],
      [13, false],
    ]);
  });

  test("점수 있는 해결 사례가 3건 미만이면 최신 해결 사례로 카드를 채운다 — 고정 기사·이미 나온 기사·카드로 그릴 수 없는 기사는 빼고", () => {
    const pinnedSolved = item(20, true);
    const b = selectHotBlock({
      ranked: [r(pinnedSolved, true), r(item(21, true))],
      latest: [],
      latestSolved: [pinnedSolved, item(21, true), item(22, true), item(23, true), item(24, true)],
      canCard: (i) => i.id !== 22,
      cards: 3,
      list: 5,
    });
    expect(b.cards.map((c) => c.id)).toEqual([21, 23, 24]);
    expect(b.list.map((x) => x.item.id)).toEqual([20]);
  });

  test("카드로 그릴 수 없는 해결 사례(4칸이 다 없는 등)는 HOT 목록에 남는다", () => {
    const b = selectHotBlock({ ranked: [r(item(1, true)), r(item(2, true))], latest: [], latestSolved: [], canCard: (i) => i.id === 2, cards: 3, list: 5 });
    expect(b.cards.map((c) => c.id)).toEqual([2]);
    expect(b.list.map((x) => x.item.id)).toEqual([1]);
  });

  test("상담 사례가 하나도 없으면 카드 0·목록 0", () => {
    expect(selectHotBlock({ ranked: [], latest: [], latestSolved: [], canCard: can, cards: 3, list: 5 })).toEqual({ cards: [], list: [] });
  });
});

describe("sidebarPicks — 기사 사이드바: 지금 보는 기사를 빼고 앞에서 size건", () => {
  const list = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id }));
  test("지금 보는 기사가 3위면 빼고 1·2·4·5·6", () => {
    expect(sidebarPicks(list, 3, 5).map((x) => x.id)).toEqual([1, 2, 4, 5, 6]);
  });
  test("지금 보는 기사가 목록에 없으면 앞 5건, 목록이 짧으면 있는 만큼", () => {
    expect(sidebarPicks(list, 99, 5).map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
    expect(sidebarPicks(list.slice(0, 2), 1, 5).map((x) => x.id)).toEqual([2]);
  });
});

describe("checkHotPin — HOT 고정은 상담 사례 분야 기사만, 최대 max_pins건 (3번째 고정은 막힌다)", () => {
  const NOW = T("2026-10-18T03:00:00Z");
  const base = { inHotCategory: true, until: T("2026-10-25T00:00:00Z"), now: NOW, otherActivePins: 0, maxPins: 2 };
  test("고정 0·1건이면 된다, 2건이면 3번째는 409", () => {
    expect(checkHotPin(base)).toEqual({ ok: true });
    expect(checkHotPin({ ...base, otherActivePins: 1 })).toEqual({ ok: true });
    const third = checkHotPin({ ...base, otherActivePins: 2 });
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.status).toBe(409);
      expect(third.message).toContain("최대 2건");
    }
  });
  test("고정 풀기(null)·이미 지난 시각은 상한과 관계없이 된다", () => {
    expect(checkHotPin({ ...base, until: null, otherActivePins: 5 })).toEqual({ ok: true });
    expect(checkHotPin({ ...base, until: NOW, otherActivePins: 5 })).toEqual({ ok: true });
  });
  test("상담 사례 분야가 아닌 기사의 고정은 422", () => {
    const r = checkHotPin({ ...base, inHotCategory: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });
  test("설정 max_pins를 3으로 바꾸면 3번째도 된다 (코드 상수 0)", () => {
    expect(checkHotPin({ ...base, otherActivePins: 2, maxPins: 3 })).toEqual({ ok: true });
  });
});
