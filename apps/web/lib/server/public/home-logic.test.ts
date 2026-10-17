// 홈 섹션 순서와 대체 규칙 (HOME-01 · HOME-03 · HOME-04)
import { describe, expect, test } from "vitest";
import { trackerState, type TrackerSource } from "./cards";
import { HOME_SECTION_KEYS } from "./constants";
import { activeCurations, homeSections, latestReports, pickStories, pickTrackers, type HomeInput } from "./home-logic";
import { CLOSED_FEATURES } from "./settings";
import { curation, listItem, stageEvent } from "./test-items";

const TODAY = "2026-10-18";

function tracker(id: number, occurred = "2026-08-26"): TrackerSource {
  return {
    amendment: { id, slug: `amendment-${id}`, title: `개정안 ${id}`, law_names: ["지방세법"], summary: null },
    state: trackerState([stageEvent({ amendment_id: id, stage: "pre_notice", occurred_on: occurred })], "promulgated", TODAY),
  };
}

describe("오늘 보이는 배치 (노출 기간 — 한국 날짜, 그날까지)", () => {
  test("시작일 당일·종료일 당일은 보이고, 어제 끝난 것·내일 시작하는 것은 빠진다, 끝 없음은 계속 보인다", () => {
    const rows = [
      curation({ id: 1, kind: "story", starts_on: TODAY, ends_on: TODAY }),
      curation({ id: 2, kind: "story", starts_on: "2026-10-01", ends_on: "2026-10-17" }),
      curation({ id: 3, kind: "story", starts_on: "2026-10-19", ends_on: null }),
      curation({ id: 4, kind: "story", starts_on: "2026-01-01", ends_on: null }),
      curation({ id: 5, kind: "tracker", starts_on: "2026-10-01", ends_on: null }),
    ];
    expect(activeCurations(rows, "story", TODAY).map((r) => r.id)).toEqual([1, 4]);
    expect(activeCurations(rows, "tracker", TODAY).map((r) => r.id)).toEqual([5]);
  });

  test("편집자가 정한 순서(sort), 같으면 번호", () => {
    const rows = [curation({ id: 9, kind: "story", sort: 20 }), curation({ id: 8, kind: "story", sort: 10 }), curation({ id: 7, kind: "story", sort: 20 })];
    expect(activeCurations(rows, "story", TODAY).map((r) => r.id)).toEqual([8, 7, 9]);
  });
});

describe("트래커 하이라이트 1~3건 (HOME-03)", () => {
  const sources = new Map([1, 2, 3, 4].map((id) => [id, tracker(id)]));

  test("지정 순서대로 3건까지, 읽히지 않는(비공개) 트래커는 건너뛴다", () => {
    const designated = [5, 2, 1, 3, 4].map((amendment_id, i) => curation({ kind: "tracker", amendment_id, sort: i }));
    const r = pickTrackers(designated, sources, tracker(9), CLOSED_FEATURES);
    expect(r.source).toBe("designated");
    expect(r.items.map((t) => t.id)).toEqual([2, 1, 3]);
    expect(r.items.every((t) => t.designated)).toBe(true);
  });

  test("지정 0건이면 최근 단계가 바뀐 트래커 1건으로 채운다 — 지정이 모두 비공개여도 0건으로 본다", () => {
    expect(pickTrackers([], sources, tracker(4), CLOSED_FEATURES)).toMatchObject({ source: "fallback", items: [{ id: 4, designated: false }] });
    const hiddenOnly = [curation({ kind: "tracker", amendment_id: 77 })];
    expect(pickTrackers(hiddenOnly, sources, tracker(4), CLOSED_FEATURES).source).toBe("fallback");
  });

  test("공개 트래커가 없으면 없음 → 섹션 숨김", () => {
    expect(pickTrackers([], new Map(), null, CLOSED_FEATURES)).toEqual({ items: [], source: "none" });
  });

  test("트래커 페이지 링크는 기능 키(amendments, 01B W3)가 켜졌을 때만 — 꺼지면 null (빈 링크 0)", () => {
    const designated = [curation({ kind: "tracker", amendment_id: 1 })];
    expect(pickTrackers(designated, sources, null, CLOSED_FEATURES).items[0]!.href).toBeNull();
    expect(pickTrackers(designated, sources, null, { ...CLOSED_FEATURES, amendments: true }).items[0]!.href).toBe("/tax/amendments/amendment-1");
  });

  test("카드의 단계 값은 트래커 데이터의 현재 단계 그대로 + 확정 아님", () => {
    const card = pickTrackers([curation({ kind: "tracker", amendment_id: 1 })], sources, null, CLOSED_FEATURES).items[0]!;
    expect(card.stage).toMatchObject({ current: "pre_notice", label: "입법예고", confirmed: false });
  });
});

describe("해설 스토리 카드 3~6장 (HOME-03)", () => {
  const article = (id: number, over = {}) => listItem({ id, contentType: "explainer", ...over });
  const pool = new Map([1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, article(id)]));
  const designate = (...ids: number[]) => ids.map((article_id, i) => curation({ kind: "story", article_id, sort: i * 10 }));
  const latestExplainers = [article(21), article(22), article(23), article(24)];

  test("지정 3장 이상이면 채우지 않는다 — 지정 순서 그대로", () => {
    const r = pickStories(designate(3, 1, 2), pool, latestExplainers);
    expect(r.map((s) => [s.id, s.designated])).toEqual([
      [3, true],
      [1, true],
      [2, true],
    ]);
  });

  test("지정이 3장 미만이면 최신 해설로 3장까지 채운다 (지정과 겹치지 않게)", () => {
    expect(pickStories(designate(22), new Map([...pool, [22, article(22)]]), latestExplainers).map((s) => [s.id, s.designated])).toEqual([
      [22, true],
      [21, false],
      [23, false],
    ]);
    expect(pickStories([], pool, latestExplainers).map((s) => s.id)).toEqual([21, 22, 23]);
  });

  test("해설이 모자라면 있는 만큼만 — 해설이 아닌 기사로 채우지 않는다", () => {
    const r = pickStories(designate(1), pool, [listItem({ id: 31, contentType: "guide" }), article(32)]);
    expect(r.map((s) => s.id)).toEqual([1, 32]);
  });

  test("지정은 6장까지만 보인다, 광고·금주 핫뉴스·읽히지 않는 기사는 뺀다", () => {
    expect(pickStories(designate(1, 2, 3, 4, 5, 6, 7), pool, latestExplainers)).toHaveLength(6);
    const mixed = new Map(pool);
    mixed.set(40, listItem({ id: 40, contentType: "sponsored", sponsorBadge: "광고" }));
    mixed.set(41, listItem({ id: 41, contentType: "digest" }));
    expect(pickStories(designate(40, 41, 99, 1, 2, 3), mixed, latestExplainers).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  test("형식 배지는 기사 형식 값 그대로 — 일반 기사는 null", () => {
    const formats = new Map([
      [1, article(1, { format: "cardnews" })],
      [2, article(2, { format: null })],
      [3, article(3, { format: "infographic" })],
    ]);
    expect(pickStories(designate(1, 2, 3), formats, []).map((s) => s.format)).toEqual(["cardnews", null, "infographic"]);
  });
});

describe("최신 자체 취재 (HOME-04)", () => {
  test("편집 승인된 reported_news만, 최신 발행 순 5건 — 해설·광고·금주 핫뉴스·승인 전 보도 0", () => {
    const items = [
      ...[1, 2, 3, 4, 5, 6].map((id) => listItem({ id, contentType: "reported_news", reportedApproved: true, publishedAt: `2026-10-0${id}T00:00:00Z` })),
      listItem({ id: 10, contentType: "reported_news", reportedApproved: false, publishedAt: "2026-10-09T00:00:00Z" }),
      listItem({ id: 11, contentType: "explainer", reportedApproved: false, publishedAt: "2026-10-09T00:00:00Z" }),
      listItem({ id: 12, contentType: "sponsored", publishedAt: "2026-10-09T00:00:00Z" }),
      listItem({ id: 13, contentType: "digest", publishedAt: "2026-10-09T00:00:00Z" }),
    ];
    expect(latestReports(items).map((a) => a.id)).toEqual([6, 5, 4, 3, 2]);
  });
});

describe("홈 섹션 순서 (HOME-01)", () => {
  const empty: HomeInput = {
    coreMessage: "부동산과 지자체의 변화를 읽고 대응하려면 지방세 이해가 필수다",
    searchChips: [],
    latestReports: [],
    weeklyHot: null,
    trackers: { items: [], source: "none" },
    stories: [],
    column: null,
    product: null,
    experts: null,
  };

  test("내용이 없는 섹션은 빠지고 히어로·4대 분야 카드만 남는다", () => {
    const s = homeSections(empty);
    expect(s.map((x) => x.key)).toEqual(["hero", "fields"]);
    expect(s[0]).toEqual({ key: "hero", coreMessage: empty.coreMessage, searchChips: [], searchAction: "/search" });
  });

  test("4대 분야 카드는 정확히 4장 — 지방세 /tax · 부동산 /realestate · 부동산개발금융 /finance · 지자체뉴스 /local", () => {
    const fields = homeSections(empty).find((x) => x.key === "fields")!;
    expect(fields.key === "fields" && fields.cards.map((c) => [c.name, c.href])).toEqual([
      ["지방세", "/tax"],
      ["부동산", "/realestate"],
      ["부동산개발금융", "/finance"],
      ["지자체뉴스", "/local"],
    ]);
  });

  test("모든 섹션에 내용이 있으면 PRD_최종 §4.1 순서 그대로", () => {
    const trackerCard = pickTrackers([], new Map(), tracker(1), CLOSED_FEATURES);
    const full = homeSections({
      ...empty,
      latestReports: [listItem({ contentType: "reported_news", reportedApproved: true })],
      weeklyHot: { key: "weekly_hot", weekHref: "/local/seoul/weekly/2026-42", items: [{ title: "t", summary: "s", sourceUrl: "https://x.go.kr", issuer: "서울시", publishedOn: "2026-10-14" }] },
      trackers: trackerCard,
      stories: [],
      column: { key: "column", items: [listItem({ contentType: "opinion" })] },
      product: { key: "product", product: { title: "지방세 50문 50답", href: "/store/books/a", summary: "도서" } },
      experts: { key: "experts", items: [{ name: "전문가", href: "/experts/x", field: "tax" }] },
    });
    expect(full.map((x) => x.key)).toEqual([...HOME_SECTION_KEYS]);
  });

  test("공개 트래커가 없으면 개정 트래커 하이라이트 섹션째 숨긴다 — 스토리 카드만 남기지 않는다", () => {
    const s = homeSections({ ...empty, stories: pickStories([], new Map(), [listItem({ id: 1 }), listItem({ id: 2 }), listItem({ id: 3 })]) });
    expect(s.some((x) => x.key === "amendments")).toBe(false);
  });

  test("최신 자체 취재는 5건을 넘지 않는다", () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((id) => listItem({ id, contentType: "reported_news", reportedApproved: true }));
    const latest = homeSections({ ...empty, latestReports: many }).find((x) => x.key === "latest_reports")!;
    expect(latest.key === "latest_reports" && latest.items).toHaveLength(5);
  });

  test("금주 핫뉴스 항목이 0건이면 섹션 숨김", () => {
    expect(homeSections({ ...empty, weeklyHot: { key: "weekly_hot", weekHref: "/local/seoul/weekly/2026-42", items: [] } }).some((x) => x.key === "weekly_hot")).toBe(false);
  });
});
