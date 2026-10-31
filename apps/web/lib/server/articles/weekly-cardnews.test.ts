// 이번 주 카드뉴스 초안 — 고르기(7일 경계·조회 순·같은 조회 수·카드뉴스/제외 유형 빼기·조회 기록 없음 → 최신 순·3건 미만 오류)와
// 만들기(5장·장 글자 = 기사 제목·요약·주소·고정 문구·권리 확인된 대표 사진만). 만든 입력은 실제 입력 검사(parseArticleInput)와
// 카드뉴스 발행 판정(ART-03)을 그대로 통과해야 한다.
import { describe, expect, test } from "vitest";
import { parseArticleInput } from "./input";
import { runGate } from "./gate";
import { toArticleForPublish } from "./mapping";
import { GATE_OPTIONS, SETTINGS, graph } from "./test-graph";
import {
  CLOSING_TITLE,
  COVER_TITLE,
  PICK_MODE_NOTES,
  WEEK_MS,
  buildWeeklyCardNewsInput,
  pickWeeklyArticles,
  weekRangeLabel,
  weeklyCardNewsSlug,
  type WeeklyCandidate,
} from "./weekly-cardnews";

// 2026-11-01(일) 10:00 KST
const NOW = Date.parse("2026-11-01T01:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const OPTS = { now: NOW, excludeContentTypes: ["digest", "sponsored"] };

function cand(id: number, over: Partial<WeeklyCandidate> = {}): WeeklyCandidate {
  return {
    id,
    slug: `article-${id}`,
    title: `기사 ${id} 제목`,
    summary: `기사 ${id} 요약입니다`,
    format: "general",
    contentType: "reported_news",
    section: "tax",
    publishedAt: hoursAgo(id),
    leadMedia: null,
    ...over,
  };
}

const ids = (r: ReturnType<typeof pickWeeklyArticles>) => (r.ok ? r.value.articles.map((a) => a.id) : r.error);

describe("고르기 — 지난 7일 공개 기사, 조회 순 3건", () => {
  test("조회 수가 많은 순으로 3건을 고르고, 각 기사의 조회 수를 함께 돌려준다", () => {
    const r = pickWeeklyArticles([cand(1), cand(2), cand(3), cand(4)], new Map([[1, 5], [2, 40], [3, 0], [4, 12]]), OPTS);
    expect(r.ok && r.value.mode).toBe("views");
    expect(ids(r)).toEqual([2, 4, 1]);
    expect(r.ok && r.value.articles.map((a) => a.views)).toEqual([40, 12, 5]);
  });

  test("조회 수가 같으면 최신 발행이 앞, 발행 시각도 같으면 번호가 큰 기사가 앞", () => {
    const same = hoursAgo(30);
    const rows = [cand(10, { publishedAt: hoursAgo(50) }), cand(11, { publishedAt: same }), cand(12, { publishedAt: same }), cand(13, { publishedAt: hoursAgo(5) })];
    const r = pickWeeklyArticles(rows, new Map([[10, 7], [11, 7], [12, 7], [13, 7]]), OPTS);
    expect(ids(r)).toEqual([13, 12, 11]);
  });

  test("조회 기록이 있는 기사가 3건보다 적으면 나머지는 조회 0 기사 중 최신 순으로 채운다", () => {
    const r = pickWeeklyArticles([cand(1), cand(2), cand(3), cand(4)], new Map([[4, 3]]), OPTS);
    expect(r.ok && r.value.mode).toBe("views");
    expect(ids(r)).toEqual([4, 1, 2]);
  });

  test("후보 모두 조회 기록이 없으면 최신 발행 순으로 고르고 mode = latest (화면 안내 '조회수 기록이 없어 최신 순으로 골랐습니다')", () => {
    const r = pickWeeklyArticles([cand(5), cand(2), cand(9), cand(3)], new Map(), OPTS);
    expect(r.ok && r.value.mode).toBe("latest");
    expect(ids(r)).toEqual([2, 3, 5]);
    expect(PICK_MODE_NOTES.latest).toBe("조회수 기록이 없어 최신 순으로 골랐습니다");
  });

  test("카드뉴스 기사 자신·금주 핫뉴스·광고·유형 없는 이관 기사는 조회가 많아도 고르지 않는다", () => {
    const rows = [
      cand(1, { format: "cardnews" }),
      cand(2, { contentType: "digest" }),
      cand(3, { contentType: "sponsored" }),
      cand(4, { contentType: null }),
      cand(5),
      cand(6),
      cand(7, { contentType: "explainer" }),
    ];
    const views = new Map([[1, 999], [2, 900], [3, 800], [4, 700], [5, 3], [6, 2], [7, 1]]);
    expect(ids(pickWeeklyArticles(rows, views, OPTS))).toEqual([5, 6, 7]);
  });

  test("7일 경계 — 정확히 7일 전 발행은 넣고, 7일 + 1밀리초 전·발행 시각 없음·지금보다 뒤는 뺀다", () => {
    const rows = [
      cand(1, { publishedAt: new Date(NOW - WEEK_MS).toISOString() }),
      cand(2, { publishedAt: new Date(NOW - WEEK_MS - 1).toISOString() }),
      cand(3, { publishedAt: null }),
      cand(4, { publishedAt: new Date(NOW + 60_000).toISOString() }),
      cand(5, { publishedAt: new Date(NOW).toISOString() }),
      cand(6, { publishedAt: hoursAgo(1) }),
    ];
    const views = new Map([[1, 1], [2, 100], [3, 100], [4, 100], [5, 1], [6, 1]]);
    expect(ids(pickWeeklyArticles(rows, views, OPTS))).toEqual([5, 6, 1]);
  });

  test("고를 기사가 3건보다 적으면 만들지 않고 한국어 오류로 이유를 알린다", () => {
    const r = pickWeeklyArticles([cand(1), cand(2), cand(3, { format: "cardnews" })], new Map([[1, 4]]), OPTS);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe(
      "지난 7일(2026.10.25 ~ 11.01) 동안 발행한 기사가 2건이라 카드뉴스를 만들 수 없습니다 — 표지·기사·마무리 5장을 채우려면 기사가 3건 있어야 합니다",
    );
    expect(pickWeeklyArticles([], new Map(), OPTS)).toMatchObject({ ok: false });
  });
});

describe("날짜 글자", () => {
  test("범위는 한국 날짜 — 해가 바뀌면 끝에도 연도", () => {
    expect(weekRangeLabel({ from: NOW - WEEK_MS, to: NOW })).toBe("2026.10.25 ~ 11.01");
    const jan = Date.parse("2027-01-03T00:00:00.000Z");
    expect(weekRangeLabel({ from: jan - WEEK_MS, to: jan })).toBe("2026.12.27 ~ 2027.01.03");
  });
  test("slug는 한국 날짜 — UTC로는 전날 15시 이후가 다음 날", () => {
    expect(weeklyCardNewsSlug(Date.parse("2026-10-31T14:59:00.000Z"))).toBe("weekly-cardnews-20261031");
    expect(weeklyCardNewsSlug(Date.parse("2026-10-31T15:00:00.000Z"))).toBe("weekly-cardnews-20261101");
  });
});

describe("만들기 — 카드뉴스 5장 초안 입력", () => {
  const picked = (over: Partial<WeeklyCandidate>[] = []) => {
    const rows = [cand(1, over[0]), cand(2, over[1]), cand(3, over[2])];
    const r = pickWeeklyArticles(rows, new Map([[1, 30], [2, 20], [3, 10]]), OPTS);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  test("표지 + 기사 3장 + 마무리 = 5장, 장 글자는 기사 제목·요약·주소와 고정 문구", () => {
    const input = buildWeeklyCardNewsInput(picked([{ title: "취득세 감면 바뀝니다", summary: "생애 최초 주택 감면 한도가 바뀝니다", slug: "acq-tax-relief" }]), {
      slug: "weekly-cardnews-20261101",
      siteBase: "https://news.example.kr/",
    });
    const blocks = (input.body as { blocks: Array<Record<string, unknown>> }).blocks;
    const slides = blocks.filter((b) => b.type === "slide");
    expect(slides).toHaveLength(5);
    expect(slides[0]).toEqual({
      type: "slide",
      title: COVER_TITLE,
      text: "2026.10.25 ~ 11.01\n많이 본 기사 3건",
      alt: "표지 — 이번 주 지방세·부동산 소식 3 (2026.10.25 ~ 11.01, 많이 본 기사 3건)",
    });
    expect(slides[1]).toEqual({
      type: "slide",
      title: "취득세 감면 바뀝니다",
      text: "생애 최초 주택 감면 한도가 바뀝니다\n기사 보기: https://news.example.kr/news/acq-tax-relief",
      alt: "1번째 기사 — 취득세 감면 바뀝니다",
    });
    expect(slides[2]?.title).toBe("기사 2 제목");
    expect(slides[3]?.title).toBe("기사 3 제목");
    expect(slides[4]).toEqual({ type: "slide", title: CLOSING_TITLE, text: "https://news.example.kr/news", alt: "마무리 — 사이트 주소 안내" });
    // 장 아래 본문 — 누르는 링크 (공개 화면은 장 글자를 링크로 그리지 않는다)
    expect(blocks.slice(5)).toEqual([
      { type: "heading", level: 2, text: "이번 주 소개한 기사" },
      { type: "paragraph", text: "[취득세 감면 바뀝니다](/news/acq-tax-relief)" },
      { type: "paragraph", text: "[기사 2 제목](/news/article-2)" },
      { type: "paragraph", text: "[기사 3 제목](/news/article-3)" },
    ]);
    expect(input).toMatchObject({
      slug: "weekly-cardnews-20261101",
      title: "이번 주 지방세·부동산 소식 3 (10.25~11.01)",
      summary: "지난 7일 많이 본 기사 3건을 카드뉴스로 모았습니다",
      format: "cardnews",
      contentType: "explainer",
      section: "tax",
      leadMediaId: null,
    });
  });

  test("요약이 없는 기사는 주소 한 줄, 사이트 주소가 없으면 /news/… 경로만, 최신 순이면 표지·요약 글자가 바뀐다", () => {
    const r = pickWeeklyArticles([cand(1, { summary: null }), cand(2), cand(3)], new Map(), OPTS);
    if (!r.ok) throw new Error(r.error);
    const input = buildWeeklyCardNewsInput(r.value, { slug: "s", siteBase: null });
    const slides = (input.body as { blocks: Array<Record<string, unknown>> }).blocks.filter((b) => b.type === "slide");
    expect(slides[1]?.text).toBe("기사 보기: /news/article-1");
    expect(slides[0]?.text).toBe("2026.10.25 ~ 11.01\n새로 발행한 기사 3건");
    expect(slides[4]?.text).toBe("/news");
    expect(input.summary).toBe("지난 7일 새로 발행한 기사 3건을 카드뉴스로 모았습니다");
  });

  test("분야는 고른 기사에 가장 많은 분야, 셋이 모두 다르면 1위 기사의 분야", () => {
    expect(buildWeeklyCardNewsInput(picked([{ section: "local" }, { section: "realestate" }, { section: "realestate" }]), { slug: "s", siteBase: null }).section).toBe("realestate");
    expect(buildWeeklyCardNewsInput(picked([{ section: "finance" }, { section: "local" }, { section: "tax" }]), { slug: "s", siteBase: null }).section).toBe("finance");
  });

  test("대표 사진은 권리 확인된 것만 — 1위 기사 사진이 미확인이면 다음 기사의 확인된 사진, 하나도 없으면 비운다", () => {
    const withPhotos = picked([{ leadMedia: { id: 70, rightsStatus: "unconfirmed" } }, { leadMedia: { id: 71, rightsStatus: "confirmed" } }, { leadMedia: { id: 72, rightsStatus: "confirmed" } }]);
    expect(buildWeeklyCardNewsInput(withPhotos, { slug: "s", siteBase: null }).leadMediaId).toBe(71);
    const noneConfirmed = picked([{ leadMedia: { id: 70, rightsStatus: "rejected" } }, {}, {}]);
    expect(buildWeeklyCardNewsInput(noneConfirmed, { slug: "s", siteBase: null }).leadMediaId).toBeNull();
  });

  test("만든 입력은 기사 작성 API의 입력 검사를 통과하고, 카드뉴스 발행 판정(ART-03 장 수·대체 텍스트·글자)에 걸리지 않는다", () => {
    const input = buildWeeklyCardNewsInput(picked(), { slug: weeklyCardNewsSlug(NOW), siteBase: "https://news.example.kr" });
    const parsed = parseArticleInput(input, "create");
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const g = graph({}, { format: "cardnews", body: parsed.value.body as never });
    expect(toArticleForPublish(g).blocks.filter((b) => b.type === "slide")).toHaveLength(5);
    const gate = runGate(g, SETTINGS, GATE_OPTIONS);
    expect([...gate.failed, ...gate.warnings].filter((id) => id.startsWith("art03."))).toEqual([]);
  });

  test("긴 제목은 장 제목 상한(200자)에 맞춰 줄이고, 링크 글자의 대괄호는 뺀다", () => {
    const long = "가".repeat(250);
    const input = buildWeeklyCardNewsInput(picked([{ title: long }, { title: "[단독] 재산세 고지" }, {}]), { slug: "s", siteBase: null });
    const blocks = (input.body as { blocks: Array<Record<string, unknown>> }).blocks;
    expect([...String(blocks[1]?.title)].length).toBe(200);
    expect(String(blocks[1]?.title).endsWith("…")).toBe(true);
    expect(blocks.at(-2)).toEqual({ type: "paragraph", text: "[단독 재산세 고지](/news/article-2)" });
    expect(parseArticleInput(input, "create").ok).toBe(true);
  });
});
