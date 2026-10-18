// 지표 세는 규칙 시험 (GROW-01 — docs/dev/W2-c_설계.md 8.3) — 기대값은 PRD 수용 기준을 옮긴 견본이고, 구현에서 계산하지 않는다.
//  · 분야별 유효 방문: 지방세 허브 → 기사 29초 0 · 30초 1 (30초 열람 시계 engagement.ts와 이어서), 허브만 본 세션 0, 다른 분야 기사 0
//  · 재방문율: 30일째(한국 날짜) 포함 · 31일째 제외, 측정 거부(방문자 ID 없음) 분모 0, 같은 세션 0
//  · 깔때기: 새 브라우저 시나리오 세 칸 +1, 순서, 첫 방문 아닌 세션 0 · 봇·편집국 0 · 한국 날짜 경계
import { describe, expect, test } from "vitest";
import { EngagementClock } from "./engagement";
import {
  BASELINE_DAYS,
  DAY_MS,
  REVISIT_DAYS,
  addDays,
  checkDomainCutover,
  computeSegment,
  countExclusions,
  countFunnel,
  countRevisits,
  countValidVisits,
  daysBetween,
  decodeMetricSessions,
  isDate,
  kstDate,
  kstDayStart,
  ratio,
  readCutover,
  readWindow,
  resolvePeriod,
  splitAtCutover,
  type MetricEvent,
  type MetricEventName,
  type MetricSession,
  type Segment,
} from "./metrics";

const S = 1000;
const MIN = 60 * S;
const T0 = Date.parse("2026-03-02T01:00:00Z"); // 한국 2026-03-02 10:00
const SEG: Segment = { kind: "trial", from: "2026-03-01", to: "2026-03-31", start: kstDayStart("2026-03-01"), end: kstDayStart("2026-04-01") };
const TODAY = "2026-10-18";

const ev = (name: MetricEventName, at: number, section: MetricEvent["section"] = "tax"): MetricEvent => ({ name, section, at });
function session(events: MetricEvent[], over: Partial<MetricSession> = {}): MetricSession {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  return { visitor: 1, firstVisit: false, bot: false, staff: false, start: sorted[0]?.at ?? T0, events: sorted, ...over };
}

/** 기사를 열고 화면이 보인 채 seconds초 머문 세션 — 30초 열람 시계(브라우저와 같은 모듈)가 article_engaged를 낼지 정한다 */
function hubThenArticle(seconds: number, section: MetricEvent["section"] = "tax"): MetricSession {
  const opened = T0 + MIN;
  const clock = new EngagementClock(opened, true);
  const events = [ev("hub_viewed", T0, "tax"), ev("article_viewed", opened, section)];
  if (clock.reached(opened + seconds * S)) events.push(ev("article_engaged", opened + seconds * S, section));
  return session(events);
}

describe("한국 날짜", () => {
  test("하루 경계는 UTC 15시 — 14:59:59.999Z는 그날, 15:00Z는 다음 날", () => {
    expect(kstDate(Date.parse("2026-03-01T14:59:59.999Z"))).toBe("2026-03-01");
    expect(kstDate(Date.parse("2026-03-01T15:00:00Z"))).toBe("2026-03-02");
    expect(new Date(kstDayStart("2026-03-02")).toISOString()).toBe("2026-03-01T15:00:00.000Z");
  });
  test("날짜 더하기(달·해 넘김) · 날 수 · 날짜 모양", () => {
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-03-02", "2026-04-01")).toBe(30);
    expect(isDate("2026-02-28")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "26-03-01", "", null, 20260301]) expect(isDate(bad)).toBe(false);
  });
});

describe("기간 (오늘 포함 최근 N일 · 직접 고른 기간 · 전환 후 첫 4주)", () => {
  const now = Date.parse("2026-10-18T03:00:00Z"); // 한국 2026-10-18 12:00
  test("기본은 최근 30일 — 오늘 포함, [첫날 0시, 내일 0시)", () => {
    const { period, error } = resolvePeriod({}, now, null);
    expect(error).toBeNull();
    expect(period).toMatchObject({ kind: "recent", days: 30, from: "2026-09-19", to: "2026-10-18" });
    expect(new Date(period.start).toISOString()).toBe("2026-09-18T15:00:00.000Z");
    expect(new Date(period.end).toISOString()).toBe("2026-10-18T15:00:00.000Z");
  });
  test("최근 7일·90일", () => {
    expect(resolvePeriod({ period: "7" }, now, null).period).toMatchObject({ days: 7, from: "2026-10-12", to: "2026-10-18" });
    expect(resolvePeriod({ period: "90" }, now, null).period).toMatchObject({ days: 90, from: "2026-07-21", to: "2026-10-18" });
  });
  test("직접 고른 기간 — 오늘까지·400일까지, 틀리면 이유와 함께 최근 30일", () => {
    expect(resolvePeriod({ period: "custom", from: "2026-03-02", to: "2026-03-08" }, now, null)).toEqual({
      period: { kind: "custom", days: 7, from: "2026-03-02", to: "2026-03-08", start: kstDayStart("2026-03-02"), end: kstDayStart("2026-03-09") },
      error: null,
    });
    expect(resolvePeriod({ period: "custom", from: "2026-10-18", to: "2026-10-18" }, now, null).period.days).toBe(1);
    expect(resolvePeriod({ period: "custom", from: "2025-09-14", to: "2026-10-18" }, now, null).period.days).toBe(400);
    for (const [q, msg] of [
      [{ from: "2026-03-08", to: "2026-03-02" }, "시작일이 끝날보다 늦습니다"],
      [{ from: "2026-10-18", to: "2026-10-19" }, "끝날은 오늘(2026-10-18)까지 고를 수 있습니다"],
      [{ from: "2025-09-13", to: "2026-10-18" }, "기간은 400일까지 고를 수 있습니다"],
      [{ from: "2026-02-30", to: "2026-03-08" }, "시작일과 끝날을 YYYY-MM-DD 날짜로 적어 주세요"],
      [{ to: "2026-03-08" }, "시작일과 끝날을 YYYY-MM-DD 날짜로 적어 주세요"],
    ] as const) {
      const r = resolvePeriod({ period: "custom", ...q }, now, null);
      expect(r.error).toBe(msg);
      expect(r.period).toMatchObject({ kind: "recent", days: 30 });
    }
    expect(resolvePeriod({ period: "365" }, now, null).error).toBe("알 수 없는 기간입니다");
  });
  test("기준선 — 전환일부터 28일, 아직 28일이 안 지났으면 오늘까지. 전환일 없음·미래면 이유", () => {
    expect(BASELINE_DAYS).toBe(28);
    expect(resolvePeriod({ period: "baseline" }, now, "2026-08-01").period).toMatchObject({ kind: "baseline", from: "2026-08-01", to: "2026-08-28", days: 28 });
    expect(resolvePeriod({ period: "baseline" }, now, "2026-10-08").period).toMatchObject({ kind: "baseline", from: "2026-10-08", to: "2026-10-18", days: 11 });
    expect(resolvePeriod({ period: "baseline" }, now, null).error).toBe("운영 도메인 전환일이 아직 없어 기준선 기간을 정할 수 없습니다");
    expect(resolvePeriod({ period: "baseline" }, now, "2026-10-19").error).toBe("전환일(2026-10-19)이 아직 오지 않아 기준선 기간이 없습니다");
  });
  test("재방문을 보려고 끝날 + 30일 날짜가 끝나는 때까지 읽는다", () => {
    const { period } = resolvePeriod({ period: "custom", from: "2026-03-02", to: "2026-03-08" }, now, null);
    expect(new Date(readWindow(period).until).toISOString()).toBe("2026-04-07T15:00:00.000Z"); // 한국 04-08 0시 = 03-08 + 31일
  });
});

describe("시험 기간 · 운영 (전환일 그날 0시부터 운영)", () => {
  const p = resolvePeriod({ period: "custom", from: "2026-03-02", to: "2026-03-08" }, Date.parse("2026-10-18T00:00:00Z"), null).period;
  const kinds = (c: string | null) => splitAtCutover(p, c).map((s) => [s.kind, s.from, s.to]);
  test("전환일 없음 → 모두 시험 기간 · 기간 뒤 → 시험 기간 · 기간 첫날이나 앞 → 모두 운영", () => {
    expect(kinds(null)).toEqual([["trial", "2026-03-02", "2026-03-08"]]);
    expect(kinds("2026-03-09")).toEqual([["trial", "2026-03-02", "2026-03-08"]]);
    expect(kinds("2026-03-02")).toEqual([["live", "2026-03-02", "2026-03-08"]]);
    expect(kinds("2026-01-01")).toEqual([["live", "2026-03-02", "2026-03-08"]]);
  });
  test("기간 가운데 → 전환일 전날까지 시험 기간, 전환일부터 운영 (끝날이 전환일이면 하루짜리 운영)", () => {
    expect(kinds("2026-03-05")).toEqual([
      ["trial", "2026-03-02", "2026-03-04"],
      ["live", "2026-03-05", "2026-03-08"],
    ]);
    expect(kinds("2026-03-08")).toEqual([
      ["trial", "2026-03-02", "2026-03-07"],
      ["live", "2026-03-08", "2026-03-08"],
    ]);
    const [trial, live] = splitAtCutover(p, "2026-03-05");
    expect(trial!.end).toBe(live!.start);
    expect(new Date(live!.start).toISOString()).toBe("2026-03-04T15:00:00.000Z");
  });
});

describe("전환일 설정 (domain_cutover — 설계 2.6)", () => {
  const SEED = { version: "2026-10-18.1", date: null };
  test("씨앗(전환 전)·날짜는 통과, 틀린 날짜·모르는 칸·빠진 칸은 칸 오류", () => {
    expect(checkDomainCutover(SEED)).toEqual([]);
    expect(checkDomainCutover({ version: "2026-11-01.1", date: "2026-11-02" })).toEqual([]);
    expect(checkDomainCutover({ version: "v", date: "2026-02-30" })).toEqual(["date: 한국 날짜 YYYY-MM-DD 또는 null(전환 전)이어야 합니다"]);
    expect(checkDomainCutover({ version: "v", date: null, note: "x" })).toEqual(["note: 모르는 칸입니다"]);
    expect(checkDomainCutover({ date: null })).toEqual(["version: 필요합니다"]);
    expect(checkDomainCutover("2026-11-02")[0]).toMatch(/^값은 JSON 객체여야 합니다/);
  });
  test("날짜를 바꾸면 버전도 바꿔야 한다", () => {
    expect(checkDomainCutover({ version: "2026-10-18.1", date: "2026-11-02" }, SEED)).toEqual(["version: 값을 바꾸면 버전도 바꿔야 합니다 (지금 2026-10-18.1)"]);
    expect(checkDomainCutover({ version: "2026-11-01.1", date: "2026-11-02" }, SEED)).toEqual([]);
  });
  test("대시보드 읽기 — 없거나 틀리면 전환일 없음(모두 시험 기간) + 알림", () => {
    expect(readCutover({ version: "v", date: "2026-11-02" }, true)).toEqual({ date: "2026-11-02", problem: null });
    expect(readCutover(null, false)).toEqual({ date: null, problem: "전환일 설정(domain_cutover)이 없습니다 — 모두 시험 기간으로 봅니다" });
    expect(readCutover({ version: "v", date: "11/02" }, true).date).toBeNull();
    expect(readCutover({ version: "v", date: "11/02" }, true).problem).toMatch(/^전환일 설정이 틀렸습니다/);
  });
});

describe("DB 함수 응답 읽기", () => {
  const from = kstDayStart("2026-03-02");
  test("시각은 시작에서 지난 밀리초 → 절대 시각, 이름 번호 → 이름", () => {
    const r = decodeMetricSessions({ over: false, count: 2, sessions: [[1, true, false, false, 0, [[0, "tax", 5], [6, null, 9]]], [null, false, true, false, 60_000, []]] }, from);
    expect(r).toEqual({
      over: false,
      sessions: [
        { visitor: 1, firstVisit: true, bot: false, staff: false, start: from, events: [ev("hub_viewed", from + 5), { name: "next_action_clicked", section: null, at: from + 9 }] },
        { visitor: null, firstVisit: false, bot: true, staff: false, start: from + 60_000, events: [] },
      ],
    });
  });
  test("상한 초과 응답", () => expect(decodeMetricSessions({ over: true, count: 120_001 }, from)).toEqual({ over: true, count: 120_001 }));
  test("모양이 틀리면 오류 — 모르는 이름 번호·분야·음수 시각·칸 수", () => {
    for (const bad of [
      null,
      [],
      { over: false },
      { over: true, count: -1 },
      { over: false, sessions: [[1, true, false, false, 0]] },
      { over: false, sessions: [[0, true, false, false, 0, []]] },
      { over: false, sessions: [[1, "y", false, false, 0, []]] },
      { over: false, sessions: [[1, true, false, false, 0, [[7, "tax", 1]]]] },
      { over: false, sessions: [[1, true, false, false, 0, [[0, "seoul", 1]]]] },
      { over: false, sessions: [[1, true, false, false, 0, [[0, "tax", -1]]]] },
    ]) {
      expect(() => decodeMetricSessions(bad, from)).toThrow(/지표 응답 모양이 틀렸습니다/);
    }
  });
});

describe("분야별 유효 방문 (분모 허브 방문 세션 · 분자 그중 같은 분야 기사 30초 이상)", () => {
  test("지방세 허브 → 기사 29초 열람은 0, 30초 열람은 1 (PRD 수용 기준)", () => {
    expect(countValidVisits([hubThenArticle(29)], SEG).sections.tax).toEqual({ numerator: 0, denominator: 1 });
    expect(countValidVisits([hubThenArticle(30)], SEG).sections.tax).toEqual({ numerator: 1, denominator: 1 });
    expect(countValidVisits([hubThenArticle(29), hubThenArticle(30)], SEG).total).toEqual({ numerator: 1, denominator: 2 });
  });
  test("허브만 본 세션은 분모 1·분자 0, 허브 없이 기사만 읽은 세션은 분모에 없다", () => {
    const hubOnly = session([ev("hub_viewed", T0)]);
    const articleOnly = session([ev("article_viewed", T0), ev("article_engaged", T0 + 31 * S)]);
    const r = countValidVisits([hubOnly, articleOnly], SEG);
    expect(r.sections.tax).toEqual({ numerator: 0, denominator: 1 });
    expect(r.total).toEqual({ numerator: 0, denominator: 1 });
  });
  test("다른 분야 기사 30초는 그 허브의 유효 방문이 아니다 · 허브 두 곳이면 분야마다", () => {
    expect(countValidVisits([hubThenArticle(40, "realestate")], SEG).sections.tax).toEqual({ numerator: 0, denominator: 1 });
    const two = session([ev("hub_viewed", T0, "tax"), ev("hub_viewed", T0 + MIN, "finance"), ev("article_engaged", T0 + 2 * MIN, "tax")]);
    const r = countValidVisits([two], SEG);
    expect(r.sections.tax).toEqual({ numerator: 1, denominator: 1 });
    expect(r.sections.finance).toEqual({ numerator: 0, denominator: 1 });
    expect(r.sections.local).toEqual({ numerator: 0, denominator: 0 });
    expect(r.total).toEqual({ numerator: 1, denominator: 1 });
  });
  test("같은 세션이면 순서는 보지 않는다 — 기사 30초 뒤 허브", () => {
    expect(countValidVisits([session([ev("article_engaged", T0), ev("hub_viewed", T0 + MIN)])], SEG).sections.tax).toEqual({ numerator: 1, denominator: 1 });
  });
  test("봇·편집국 세션은 분모·분자 0", () => {
    const r = countValidVisits([{ ...hubThenArticle(35), bot: true }, { ...hubThenArticle(35), staff: true }, hubThenArticle(35)], SEG);
    expect(r.sections.tax).toEqual({ numerator: 1, denominator: 1 });
  });
  test("세션은 시작 시각이 든 구간에 속한다 — 시작 포함·끝 제외", () => {
    const at = (start: number) => session([ev("hub_viewed", start)], { start });
    const r = countValidVisits([at(SEG.start), at(SEG.end - 1), at(SEG.end), at(SEG.start - 1)], SEG);
    expect(r.sections.tax.denominator).toBe(2);
  });
});

describe("재방문율 (분모 측정 동의 분야 방문자 · 분자 30일 안 다른 세션에서 같은 분야)", () => {
  const D0 = Date.parse("2026-03-02T05:00:00Z"); // 한국 2026-03-02 14:00
  const view = (at: number, visitor: number | null = 7, section: MetricEvent["section"] = "tax", over: Partial<MetricSession> = {}) =>
    session([ev("hub_viewed", at, section)], { visitor, ...over });
  const kstAt = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+09:00`);

  test("30일째(한국 날짜)는 포함, 31일째는 제외 (PRD 수용 기준)", () => {
    expect(REVISIT_DAYS).toBe(30);
    const day30 = countRevisits([view(D0), view(kstAt(addDays("2026-03-02", 30), "23:59"))], SEG, TODAY).sections.tax;
    expect(day30).toEqual({ visitors: 1, revisited: 1, pending: 0 });
    const day31 = countRevisits([view(D0), view(kstAt(addDays("2026-03-02", 31), "00:00"))], SEG, TODAY).sections.tax;
    expect(day31).toEqual({ visitors: 1, revisited: 0, pending: 0 });
  });
  test("날짜는 한국 날짜로 센다 — 23:59에 본 방문자의 30일 창은 지난 시간과 관계없이 30일째 날짜 끝까지", () => {
    const late = kstAt("2026-03-02", "23:59");
    // 30일 0시간 1분 뒤 = 한국 04-01 00:00 = 30일째 → 포함 · 30일째 23:59 → 포함 · 31일째 00:00 → 제외
    expect(countRevisits([view(late), view(kstAt("2026-04-01", "00:00"))], SEG, TODAY).total.revisited).toBe(1);
    expect(countRevisits([view(late), view(kstAt("2026-04-01", "23:59"))], SEG, TODAY).total.revisited).toBe(1);
    expect(countRevisits([view(late), view(kstAt("2026-04-02", "00:00"))], SEG, TODAY).total.revisited).toBe(0);
  });
  test("같은 세션에서 다시 본 것은 재방문이 아니다 · 같은 날 다른 세션은 재방문", () => {
    const one = session([ev("hub_viewed", D0), ev("article_viewed", D0 + 40 * MIN)], { visitor: 7 });
    expect(countRevisits([one], SEG, TODAY).sections.tax).toEqual({ visitors: 1, revisited: 0, pending: 0 });
    expect(countRevisits([view(D0), view(D0 + 3 * 3_600_000)], SEG, TODAY).sections.tax.revisited).toBe(1);
  });
  test("측정 거부(방문자 ID 없음) 세션은 분모에서 빠지고 따로 센다", () => {
    const r = countRevisits([view(D0, null), view(D0 + DAY_MS, null), view(D0, 7)], SEG, TODAY);
    expect(r.sections.tax).toEqual({ visitors: 1, revisited: 0, pending: 0 });
    expect(r.withoutVisitor).toBe(2);
  });
  test("봇·편집국 세션은 분모에도, 재방문 증거에도 0", () => {
    expect(countRevisits([view(D0, 7, "tax", { bot: true }), view(D0 + DAY_MS, 7, "tax", { staff: true })], SEG, TODAY).sections.tax.visitors).toBe(0);
    expect(countRevisits([view(D0), view(D0 + DAY_MS, 7, "tax", { staff: true })], SEG, TODAY).sections.tax).toEqual({ visitors: 1, revisited: 0, pending: 0 });
  });
  test("다른 분야를 다시 본 것은 그 분야의 재방문이 아니다 · 전체는 방문자 단위", () => {
    const r = countRevisits([view(D0, 7, "tax"), view(D0 + DAY_MS, 7, "finance"), view(D0, 8, "local"), view(D0 + DAY_MS, 8, "local")], SEG, TODAY);
    expect(r.sections.tax).toEqual({ visitors: 1, revisited: 0, pending: 0 });
    expect(r.sections.finance).toEqual({ visitors: 1, revisited: 0, pending: 0 });
    expect(r.sections.local).toEqual({ visitors: 1, revisited: 1, pending: 0 });
    expect(r.total).toEqual({ visitors: 2, revisited: 1, pending: 0 });
  });
  test("기준은 구간 안의 첫 방문 — 구간 밖(뒤) 세션은 재방문 증거로만", () => {
    const later = view(SEG.end + DAY_MS);
    expect(countRevisits([later], SEG, TODAY).total.visitors).toBe(0);
    expect(countRevisits([view(SEG.end - MIN), later], SEG, TODAY).total).toEqual({ visitors: 1, revisited: 1, pending: 0 });
  });
  test("아직 다시 오지 않았고 30일째 날짜가 오늘 이후면 '30일 안 지남'으로 함께 센다", () => {
    const today = "2026-03-20";
    const r = countRevisits([view(D0), view(D0 + 2 * DAY_MS, 9)], SEG, today);
    expect(r.sections.tax).toEqual({ visitors: 2, revisited: 0, pending: 2 });
    expect(countRevisits([view(D0)], SEG, addDays("2026-03-02", 31)).sections.tax.pending).toBe(0);
    expect(countRevisits([view(D0)], SEG, addDays("2026-03-02", 30)).sections.tax.pending).toBe(1);
  });
});

describe("첫 방문 깔때기 (첫 방문 → 4대 분야 카드·상황 카드·검색 → 기사 30초 + 다음 행동)", () => {
  const first = (events: MetricEvent[], over: Partial<MetricSession> = {}) => session(events, { firstVisit: true, ...over });
  test("새 브라우저 시나리오 — 홈 → 4대 분야 카드 → 기사 35초 → 다음 행동 클릭: 세 칸이 1씩", () => {
    const s = first([
      ev("home_entry_clicked", T0),
      ev("hub_viewed", T0 + S),
      ev("article_viewed", T0 + 10 * S),
      ev("article_engaged", T0 + 40 * S),
      ev("next_action_clicked", T0 + 45 * S, null),
    ]);
    expect(countFunnel([s], SEG)).toEqual({ firstVisits: 1, entered: 1, engagedAction: 1, solved: 1 });
  });
  test("상황 카드·검색도 ② — 첫 방문이 아닌 세션은 어느 칸에도 없다", () => {
    const viaSituation = first([ev("situation_card_clicked", T0), ev("article_engaged", T0 + 40 * S), ev("next_action_clicked", T0 + 50 * S, null)]);
    const viaSearch = first([ev("search_submitted", T0, null)]);
    const returning = session([ev("home_entry_clicked", T0), ev("article_engaged", T0 + 40 * S), ev("next_action_clicked", T0 + 50 * S, null)]);
    expect(countFunnel([viaSituation, viaSearch, returning], SEG)).toEqual({ firstVisits: 2, entered: 2, engagedAction: 1, solved: 1 });
  });
  test("순서 — 다음 행동이 30초 열람보다 먼저면 ③·문제해결 0, 30초 열람이 ②보다 먼저면 ③ 0(문제해결은 1)", () => {
    const actionFirst = first([ev("home_entry_clicked", T0), ev("next_action_clicked", T0 + 10 * S, null), ev("article_engaged", T0 + 40 * S)]);
    expect(countFunnel([actionFirst], SEG)).toEqual({ firstVisits: 1, entered: 1, engagedAction: 0, solved: 0 });
    const engagedFirst = first([ev("article_engaged", T0), ev("home_entry_clicked", T0 + MIN), ev("next_action_clicked", T0 + 2 * MIN, null)]);
    expect(countFunnel([engagedFirst], SEG)).toEqual({ firstVisits: 1, entered: 1, engagedAction: 0, solved: 1 });
  });
  test("②를 거치지 않은 첫 방문(검색 유입 기사) — ③ 0, 문제해결 1 · 30초 열람만 있고 다음 행동 0이면 둘 다 0", () => {
    expect(countFunnel([first([ev("article_engaged", T0), ev("next_action_clicked", T0 + MIN, null)])], SEG)).toEqual({ firstVisits: 1, entered: 0, engagedAction: 0, solved: 1 });
    expect(countFunnel([first([ev("home_entry_clicked", T0), ev("article_engaged", T0 + MIN)])], SEG)).toEqual({ firstVisits: 1, entered: 1, engagedAction: 0, solved: 0 });
  });
  test("봇·편집국 첫 방문 세션은 0 · 지표 이벤트가 하나도 없는 첫 방문 세션도 ①에는 든다", () => {
    const full = [ev("home_entry_clicked", T0), ev("article_engaged", T0 + 40 * S), ev("next_action_clicked", T0 + 50 * S, null)];
    const quiet = first([], { start: T0 });
    expect(countFunnel([first(full, { bot: true }), first(full, { staff: true }), quiet], SEG)).toEqual({ firstVisits: 1, entered: 0, engagedAction: 0, solved: 0 });
  });
});

describe("빼는 세션 · 비율 · 한 구간 전부", () => {
  test("구간에서 시작한 세션 — 봇(편집국 표시가 함께 있어도 봇) · 편집국", () => {
    const list = [session([ev("hub_viewed", T0)], { bot: true, staff: true }), session([ev("hub_viewed", T0)], { staff: true }), session([ev("hub_viewed", T0)]), session([ev("hub_viewed", SEG.end)])];
    expect(countExclusions(list, SEG)).toEqual({ sessions: 3, bot: 1, staff: 1 });
  });
  test("비율 — 분모 0이면 없음", () => {
    expect(ratio({ numerator: 1, denominator: 3 })).toBeCloseTo(1 / 3);
    expect(ratio({ numerator: 0, denominator: 0 })).toBeNull();
  });
  test("한 구간 지표를 한 번에 — 각 규칙과 같은 값", () => {
    const list = [hubThenArticle(30), hubThenArticle(29)];
    const m = computeSegment(list, SEG, TODAY);
    expect(m.validVisits).toEqual(countValidVisits(list, SEG));
    expect(m.revisits).toEqual(countRevisits(list, SEG, TODAY));
    expect(m.funnel).toEqual(countFunnel(list, SEG));
    expect(m.exclusions).toEqual({ sessions: 2, bot: 0, staff: 0 });
    expect(m.segment).toBe(SEG);
  });
});
