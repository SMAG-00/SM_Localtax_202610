import { describe, expect, test } from "vitest";
import { HOUR_MS, countArticleHours, hourStart, parseArticleEvent, planAggregation, retentionCutoff, type ArticleEvent } from "./aggregate";

// 1시간 집계 규칙 (docs/dev/W2-c_설계.md 8.2 — ART-11 · HOME-05). 시각은 UTC 밀리초.
const T = (iso: string) => Date.parse(iso);
const H = (iso: string) => hourStart(T(iso));
let nextId = 1;
const ev = (over: Omit<Partial<ArticleEvent>, "at"> & { at: string }): ArticleEvent => ({
  id: nextId++,
  name: "article_viewed",
  visitorId: "v-1",
  articleId: 7,
  isBot: false,
  isStaff: false,
  ...over,
  at: T(over.at),
});
const RANGE_10 = { from: T("2026-10-18T10:00:00Z"), to: T("2026-10-18T11:00:00Z") };
const one = (stats: ReturnType<typeof countArticleHours>, articleId = 7) => stats.find((s) => s.articleId === articleId);

describe("hourStart — UTC 정시로 내림", () => {
  test("10:59:59.999 → 10:00, 11:00:00.000 → 11:00", () => {
    expect(new Date(hourStart(T("2026-10-18T10:59:59.999Z"))).toISOString()).toBe("2026-10-18T10:00:00.000Z");
    expect(new Date(hourStart(T("2026-10-18T11:00:00.000Z"))).toISOString()).toBe("2026-10-18T11:00:00.000Z");
  });
});

describe("countArticleHours — 시간대·기사별 전체 조회·사람 조회·공유·30초 열람", () => {
  test("봇 조회 100회 + 사람 조회 3회(서로 다른 방문자) → 전체 103, 사람 3 (봇은 0회)", () => {
    const events = [
      ...Array.from({ length: 100 }, (_, i) => ev({ at: `2026-10-18T10:${String(i % 60).padStart(2, "0")}:00Z`, isBot: true, visitorId: "bot" })),
      ...["a", "b", "c"].map((v) => ev({ at: "2026-10-18T10:20:00Z", visitorId: v })),
    ];
    expect(one(countArticleHours(events, RANGE_10, 30))).toMatchObject({ viewsAll: 103, viewsHuman: 3 });
  });

  test("편집국 조회는 전체에만 들고 사람 조회·공유·30초 열람 0", () => {
    const events = [ev({ at: "2026-10-18T10:05:00Z", isStaff: true }), ev({ at: "2026-10-18T10:06:00Z", isStaff: true, name: "article_shared" }), ev({ at: "2026-10-18T10:07:00Z", isStaff: true, name: "article_engaged" })];
    expect(one(countArticleHours(events, RANGE_10, 30))).toEqual({ articleId: 7, hour: RANGE_10.from, viewsAll: 1, viewsHuman: 0, shares: 0, engagedViews: 0 });
  });

  test("같은 방문자 30분 안 반복 → 1회: 0·10·29분 → 1, 마지막 조회에서 정확히 30분 뒤 → 다시 1회", () => {
    const within = [ev({ at: "2026-10-18T10:00:00Z" }), ev({ at: "2026-10-18T10:10:00Z" }), ev({ at: "2026-10-18T10:29:00Z" })];
    expect(one(countArticleHours(within, RANGE_10, 30))).toMatchObject({ viewsAll: 3, viewsHuman: 1 });
    // 세지 않은 반복 조회도 '마지막 조회'다 — 10:29 뒤 10:58:59(29분 59초)는 0, 10:58:59에서 30분 뒤인 11:28:59에 다시 1
    const chain = [ev({ at: "2026-10-18T10:00:00Z" }), ev({ at: "2026-10-18T10:29:00Z" }), ev({ at: "2026-10-18T10:58:59Z" }), ev({ at: "2026-10-18T11:28:59Z" })];
    const two = { from: RANGE_10.from, to: T("2026-10-18T12:00:00Z") };
    expect(countArticleHours(chain, two, 30).map((s) => [new Date(s.hour).toISOString(), s.viewsHuman])).toEqual([
      ["2026-10-18T10:00:00.000Z", 1],
      ["2026-10-18T11:00:00.000Z", 1],
    ]);
    const exact = [ev({ at: "2026-10-18T10:00:00Z" }), ev({ at: "2026-10-18T10:30:00Z" })];
    expect(one(countArticleHours(exact, RANGE_10, 30))?.viewsHuman).toBe(2);
    const just = [ev({ at: "2026-10-18T10:00:00Z" }), ev({ at: "2026-10-18T10:29:59.999Z" })];
    expect(one(countArticleHours(just, RANGE_10, 30))?.viewsHuman).toBe(1);
  });

  test("다른 방문자·다른 기사는 따로 센다 — 같은 방문자의 다른 기사 조회는 각 1회", () => {
    const events = [ev({ at: "2026-10-18T10:00:00Z", visitorId: "a" }), ev({ at: "2026-10-18T10:01:00Z", visitorId: "b" }), ev({ at: "2026-10-18T10:02:00Z", visitorId: "a", articleId: 8 })];
    const s = countArticleHours(events, RANGE_10, 30);
    expect(one(s, 7)?.viewsHuman).toBe(2);
    expect(one(s, 8)?.viewsHuman).toBe(1);
  });

  test("시간대 경계를 넘는 반복 — 9:50 조회 뒤 10:10 조회는 10시 시간대에서 0회 (앞 시간대 이벤트를 이력으로 본다)", () => {
    const events = [ev({ at: "2026-10-18T09:50:00Z" }), ev({ at: "2026-10-18T10:10:00Z" }), ev({ at: "2026-10-18T10:45:00Z", visitorId: "z" })];
    const s = countArticleHours(events, RANGE_10, 30);
    expect(s).toEqual([{ articleId: 7, hour: RANGE_10.from, viewsAll: 2, viewsHuman: 1, shares: 0, engagedViews: 0 }]);
  });

  test("측정 거부 등 방문자 ID가 없는 조회는 중복 제거 없이 센다 (ART-11)", () => {
    const events = [ev({ at: "2026-10-18T10:00:00Z", visitorId: null }), ev({ at: "2026-10-18T10:01:00Z", visitorId: null })];
    expect(one(countArticleHours(events, RANGE_10, 30))?.viewsHuman).toBe(2);
  });

  test("공유·30초 열람도 사람만, 같은 방문자 30분 안 반복은 1회 — 조회와 따로 센다", () => {
    const events = [
      ev({ at: "2026-10-18T10:00:00Z" }),
      ev({ at: "2026-10-18T10:00:30Z", name: "article_engaged" }),
      ev({ at: "2026-10-18T10:01:00Z", name: "article_shared" }),
      ev({ at: "2026-10-18T10:02:00Z", name: "article_shared" }),
      ev({ at: "2026-10-18T10:03:00Z", name: "article_shared", isBot: true, visitorId: "bot" }),
    ];
    expect(one(countArticleHours(events, RANGE_10, 30))).toMatchObject({ viewsAll: 1, viewsHuman: 1, shares: 1, engagedViews: 1 });
  });

  test("중복 제거 창 0분이면 반복도 모두 센다 (설정값 — 코드 상수 0)", () => {
    const events = [ev({ at: "2026-10-18T10:00:00Z" }), ev({ at: "2026-10-18T10:00:01Z" })];
    expect(one(countArticleHours(events, RANGE_10, 0))?.viewsHuman).toBe(2);
    expect(one(countArticleHours(events, RANGE_10, 1))?.viewsHuman).toBe(1);
  });

  test("범위 [from, to) 밖 시간대 행은 내지 않는다 — 11:00 조회는 10시 범위에서 0, 결과는 시간대·기사 순", () => {
    const range = { from: T("2026-10-18T09:00:00Z"), to: T("2026-10-18T11:00:00Z") };
    const events = [ev({ at: "2026-10-18T11:00:00Z", visitorId: "x" }), ev({ at: "2026-10-18T10:00:00Z", articleId: 9 }), ev({ at: "2026-10-18T09:59:59Z", visitorId: "y" })];
    expect(countArticleHours(events, range, 30).map((s) => [new Date(s.hour).toISOString(), s.articleId])).toEqual([
      ["2026-10-18T09:00:00.000Z", 7],
      ["2026-10-18T10:00:00.000Z", 9],
    ]);
  });

  test("이벤트 순서가 섞여 들어와도 시각 순으로 판단한다", () => {
    const events = [ev({ at: "2026-10-18T10:20:00Z" }), ev({ at: "2026-10-18T10:00:00Z" }), ev({ at: "2026-10-18T10:40:00Z" })];
    // 10:00 → 1, 10:20(20분 뒤) → 0, 10:40(마지막 10:20에서 20분) → 0
    expect(one(countArticleHours(events, RANGE_10, 30))?.viewsHuman).toBe(1);
  });
});

describe("parseArticleEvent — DB 행 → 집계 이벤트 (기사 번호가 1 이상 정수가 아니면 버림)", () => {
  const row = { id: 3, name: "article_viewed", occurred_at: "2026-10-18T10:00:00+00:00", visitor_id: "v", article_id: 12, is_bot: false, is_staff: false };
  test("정상 행", () => {
    expect(parseArticleEvent(row)).toEqual({ id: 3, name: "article_viewed", at: T("2026-10-18T10:00:00Z"), visitorId: "v", articleId: 12, isBot: false, isStaff: false });
    expect(parseArticleEvent({ ...row, id: "3", article_id: "12" })?.articleId).toBe(12);
  });
  test.each([[0], [-1], [1.5], ["x"], [null]])("기사 번호 %s → null", (articleId) => {
    expect(parseArticleEvent({ ...row, article_id: articleId })).toBeNull();
  });
  test("기사 이벤트가 아닌 이름·읽을 수 없는 시각 → null", () => {
    expect(parseArticleEvent({ ...row, name: "hub_viewed" })).toBeNull();
    expect(parseArticleEvent({ ...row, occurred_at: "어제" })).toBeNull();
  });
});

describe("planAggregation — 다시 집계할 시간대와 다음 실행이 볼 이벤트 번호", () => {
  const NOW = T("2026-10-18T12:07:00Z");
  const base = { now: NOW, watermark: 500, changedHours: [] as number[], pendingMinId: null, maxId: null, lookbackHours: 168, dedupeMinutes: 30 };
  const iso = (hours: number[]) => hours.map((h) => new Date(h).toISOString());

  test("새 이벤트가 없어도 바로 앞 시간대(11시)는 늘 다시 집계한다 — 시간대 끝에 막 저장된 이벤트를 놓치지 않게", () => {
    const p = planAggregation(base);
    expect(iso(p.hours)).toEqual(["2026-10-18T11:00:00.000Z"]);
    expect(p.ranges).toEqual([{ from: H("2026-10-18T11:00:00Z"), to: H("2026-10-18T12:00:00Z") }]);
    expect(p.watermark).toBe(500);
  });

  test("새 이벤트가 든 시간대와 그다음 시간대(30분 중복 제거가 넘어가는 곳)를 다시 집계, 지금 시간대(12시)는 끝난 뒤에", () => {
    const p = planAggregation({ ...base, changedHours: [H("2026-10-18T08:30:00Z"), H("2026-10-18T09:10:00Z")], maxId: 640 });
    expect(iso(p.hours)).toEqual(["2026-10-18T08:00:00.000Z", "2026-10-18T09:00:00.000Z", "2026-10-18T10:00:00.000Z", "2026-10-18T11:00:00.000Z"]);
    expect(p.ranges).toEqual([{ from: H("2026-10-18T08:00:00Z"), to: H("2026-10-18T12:00:00Z") }]);
    expect(p.watermark).toBe(640);
  });

  test("늦게 들어온 이벤트(시각이 이틀 전)도 번호가 새것이면 그 시간대를 다시 집계 — 떨어진 시간대는 범위를 나눈다", () => {
    const p = planAggregation({ ...base, changedHours: [H("2026-10-16T05:00:00Z")], maxId: 501 });
    expect(p.ranges.map((r) => [new Date(r.from).toISOString(), new Date(r.to).toISOString()])).toEqual([
      ["2026-10-16T05:00:00.000Z", "2026-10-16T07:00:00.000Z"],
      ["2026-10-18T11:00:00.000Z", "2026-10-18T12:00:00.000Z"],
    ]);
  });

  test("지금 시간대에 들어온 이벤트가 있으면 다음 실행이 그 번호부터 다시 본다 (가장 작은 번호 − 1)", () => {
    expect(planAggregation({ ...base, pendingMinId: 610, maxId: 640 }).watermark).toBe(609);
    expect(planAggregation({ ...base, pendingMinId: 480, maxId: 640 }).watermark).toBe(500);
  });

  test("집계 창(lookback)보다 오래된 시간대는 다시 집계하지 않는다 — 168시간 전 시간대는 포함, 169시간 전은 제외", () => {
    const h168 = H("2026-10-11T12:00:00Z");
    const h169 = H("2026-10-11T11:00:00Z");
    const p = planAggregation({ ...base, dedupeMinutes: 0, changedHours: [h169, h168] });
    expect(iso(p.hours)).toEqual(["2026-10-11T12:00:00.000Z", "2026-10-18T11:00:00.000Z"]);
  });

  test("중복 제거 창이 60분을 넘으면 그만큼 뒤 시간대까지 (90분 → 2시간 뒤까지)", () => {
    const p = planAggregation({ ...base, dedupeMinutes: 90, changedHours: [H("2026-10-18T05:00:00Z")] });
    expect(iso(p.hours)).toEqual(["2026-10-18T05:00:00.000Z", "2026-10-18T06:00:00.000Z", "2026-10-18T07:00:00.000Z", "2026-10-18T11:00:00.000Z"]);
  });

  test("한 범위는 24시간까지 — 처음 실행처럼 168시간을 다시 집계하면 7조각", () => {
    const changed = Array.from({ length: 168 }, (_, i) => H("2026-10-18T12:00:00Z") - (i + 1) * HOUR_MS);
    const p = planAggregation({ ...base, watermark: 0, changedHours: changed, maxId: 9 });
    expect(p.hours).toHaveLength(168);
    expect(p.ranges).toHaveLength(7);
    expect(p.ranges.every((r) => r.to - r.from <= 24 * HOUR_MS)).toBe(true);
    expect(p.ranges[0]!.from).toBe(H("2026-10-11T12:00:00Z"));
    expect(p.ranges.at(-1)!.to).toBe(H("2026-10-18T12:00:00Z"));
    expect(p.watermark).toBe(9);
  });
});

describe("retentionCutoff — 보존 기한 (analytics.retention_days)", () => {
  test("395일 전 시각 — 그보다 앞선 이벤트만 지운다", () => {
    expect(new Date(retentionCutoff(T("2026-10-18T03:00:00Z"), 395)).toISOString()).toBe("2025-09-18T03:00:00.000Z");
    expect(new Date(retentionCutoff(T("2026-10-18T03:00:00Z"), 31)).toISOString()).toBe("2026-09-17T03:00:00.000Z");
  });
});
