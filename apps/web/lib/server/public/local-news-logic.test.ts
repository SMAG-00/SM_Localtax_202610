import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  calendarEventCount,
  cardsInMonth,
  eventCard,
  eventJsonLdScript,
  eventStatusAt,
  eventsBlock,
  monthRange,
  recheckDue,
  regionCodeSet,
  selectEvents,
  weeklyBlock,
  type DigestItemRow,
  type DigestRow,
  type EventRow,
} from "./local-news-logic";

let n = 0;
// 시험용 가짜 행사 - startKst/endKst는 한국 시각 'YYYY-MM-DDTHH:mm'
function row(over: Partial<EventRow> & { startKst?: string; endKst?: string } = {}): EventRow {
  n += 1;
  const { startKst = "2026-10-20T10:00", endKst = "2026-10-20T12:00", ...rest } = over;
  return {
    id: n,
    slug: `ev-${n}`,
    series_key: `s-${n}`,
    title: `시험 행사 ${n}`,
    category: "tax_finance",
    organizer: "시험 주최",
    organizer_type: "government",
    venue: "시험 장소",
    region_code: "1100000000",
    starts_at: `${startKst}:00+09:00`,
    ends_at: `${endKst}:00+09:00`,
    official_url: "https://event.example.test/a",
    source_name: "시험 출처",
    confirmed_on: "2026-10-20",
    sponsored: false,
    status_source_url: null,
    status_confirmed_at: null,
    status: "upcoming",
    recheck_due: false,
    ...rest,
  };
}
const opts = (today: string, extra: object = {}) => ({ today, regionCodes: null, range: null, ...extra });

describe("monthRange - 기본 이번 달·다음 달 (REG-04)", () => {
  it("10월 31일이면 10월·11월, 11월 1일이면 11월·12월, 12월 31일이면 12월·다음 해 1월", () => {
    expect(monthRange("2026-10-31").months).toEqual(["2026-10", "2026-11"]);
    expect(monthRange("2026-11-01").months).toEqual(["2026-11", "2026-12"]);
    const dec = monthRange("2026-12-31");
    expect(dec.months).toEqual(["2026-12", "2027-01"]);
    expect(dec).toMatchObject({ from: "2026-12-01", to: "2027-01-31" });
  });
  it("month가 올바르면 그 한 달, 틀리면 기본 범위", () => {
    expect(monthRange("2026-10-24", "2027-02")).toEqual({ months: ["2027-02"], from: "2027-02-01", to: "2027-02-28" });
    expect(monthRange("2026-10-24", "2027-13").months).toEqual(["2026-10", "2026-11"]);
    expect(monthRange("2026-10-24", "abc").months).toEqual(["2026-10", "2026-11"]);
  });
});

describe("selectEvents - 지난 일정 숨김·아카이브·축제 제외·정렬 (LG-09 · LG-10 · REG-04)", () => {
  it("10월 20일 종료 행사는 10월 20일 목록에 있고 10월 21일에는 없고 아카이브에는 있다", () => {
    const rows = [row({ endKst: "2026-10-20T23:00" })];
    expect(selectEvents(rows, opts("2026-10-20"))).toHaveLength(1);
    expect(selectEvents(rows, opts("2026-10-21"))).toHaveLength(0);
    expect(selectEvents(rows, opts("2026-10-21", { archive: true }))).toHaveLength(1);
    expect(selectEvents(rows, opts("2026-10-20", { archive: true }))).toHaveLength(0);
  });
  it("축제는 목록·달력 선택에 없고 허브 블록 선택(includeFestival)에는 있다", () => {
    const rows = [row({ category: "festival", title: "시험 축제" }), row({ title: "시험 설명회" })];
    expect(selectEvents(rows, opts("2026-10-01")).map((c) => c.title)).toEqual(["시험 설명회"]);
    expect(selectEvents(rows, opts("2026-10-01", { includeFestival: true })).map((c) => c.title).sort()).toEqual(["시험 설명회", "시험 축제"]);
  });
  it("정렬 - 세무·재정·개발·정비가 먼저, 그 밖, sponsored는 마지막, 같은 묶음은 시작 일시 순", () => {
    const rows = [
      row({ category: "other", title: "기타 이른", startKst: "2026-10-02T09:00", endKst: "2026-10-02T10:00" }),
      row({ category: "commercial", sponsored: true, title: "광고", startKst: "2026-10-01T09:00", endKst: "2026-10-01T10:00" }),
      row({ category: "development", title: "개발 늦은", startKst: "2026-10-05T09:00", endKst: "2026-10-05T10:00" }),
      row({ category: "tax_finance", title: "세무 이른", startKst: "2026-10-03T09:00", endKst: "2026-10-03T10:00" }),
    ];
    expect(selectEvents(rows, opts("2026-10-01")).map((c) => c.title)).toEqual(["세무 이른", "개발 늦은", "기타 이른", "광고"]);
  });
  it("시·도 필터는 하위 시·군·구 행사를 포함한다", () => {
    const regions = [{ code: "1100000000", parent_code: null }, { code: "1111000000", parent_code: "1100000000" }, { code: "2600000000", parent_code: null }];
    const rows = [row({ region_code: "1111000000" }), row({ region_code: "1100000000" }), row({ region_code: "2600000000" })];
    expect(selectEvents(rows, opts("2026-10-01", { regionCodes: regionCodeSet("1100000000", regions) }))).toHaveLength(2);
    expect(selectEvents(rows, opts("2026-10-01", { regionCodes: regionCodeSet("1111000000", regions) }))).toHaveLength(1);
  });
  it("hide_stale가 켜지면 재확인 필요 회차는 예정 목록에서 빠지고, 꺼져 있으면 표시만 한다", () => {
    const rows = [row({ recheck_due: true })];
    expect(selectEvents(rows, opts("2026-10-01"))[0]!.recheckDue).toBe(true);
    expect(selectEvents(rows, opts("2026-10-01", { hideStale: true }))).toHaveLength(0);
  });
  it("기간 밖 행사는 빠지고 걸친 행사는 남는다", () => {
    const rows = [row({ startKst: "2026-09-30T10:00", endKst: "2026-10-02T10:00" }), row({ startKst: "2026-12-05T10:00", endKst: "2026-12-05T11:00" })];
    expect(selectEvents(rows, opts("2026-09-01", { range: { from: "2026-10-01", to: "2026-11-30" } }))).toHaveLength(1);
  });
});

describe("달력 - 칸과 목록의 항목 수가 같다 (REG-04)", () => {
  it("여러 날 행사는 걸친 모든 칸에 보이지만 서로 다른 행사 수는 목록과 같다", () => {
    const rows = [
      row({ startKst: "2026-10-05T10:00", endKst: "2026-10-08T10:00" }),
      row({ startKst: "2026-10-31T10:00", endKst: "2026-11-02T10:00" }),
      row({ startKst: "2026-10-15T10:00", endKst: "2026-10-15T12:00" }),
      row({ category: "festival", startKst: "2026-10-16T10:00", endKst: "2026-10-16T12:00" }),
    ];
    const cards = selectEvents(rows, opts("2026-10-01"));
    const october = cardsInMonth(cards, "2026-10");
    const cal = buildCalendar("2026-10", october);
    expect(october).toHaveLength(3);
    expect(calendarEventCount(cal)).toBe(october.length);
    expect(cal.weeks.every((w) => w.length === 7)).toBe(true);
    const oct6 = cal.weeks.flat().find((c) => c?.date === "2026-10-06");
    expect(oct6?.events).toHaveLength(1);
    expect(cal.weeks.flat().filter((c) => c).length).toBe(31);
    expect(calendarEventCount(buildCalendar("2026-11", cardsInMonth(cards, "2026-11")))).toBe(1);
    // 축제는 달력에 없다
    expect(cal.weeks.flat().flatMap((c) => c?.events ?? []).some((e) => e.category === "festival")).toBe(false);
  });
});

describe("Event 구조화 데이터 - 화면 값과 같다 (LG-16)", () => {
  const site = "https://e2e.example.test";
  const parse = (s: string | null) => JSON.parse(s!) as Record<string, unknown>;
  it("이름·날짜·장소·상태가 카드(화면) 값과 같고 취소 회차는 EventCancelled", () => {
    const r = row({ title: "시험 설명회", venue: "시험 홀", status: "cancelled" });
    const card = eventCard(r);
    const ld = parse(eventJsonLdScript(card, r.starts_at, r.ends_at, site));
    expect(JSON.stringify(ld)).toContain("https://schema.org/EventCancelled");
    expect(card.statusLabel).toBe("취소");
    expect(JSON.stringify(ld)).toContain("시험 설명회");
    expect(JSON.stringify(ld)).toContain("시험 홀");
    expect(JSON.stringify(ld)).toContain(r.starts_at);
    expect(JSON.stringify(ld)).toContain(`${site}/local/events/${r.slug}`);
  });
  it("변경 확인 중 회차는 Event 데이터를 내지 않는다, 사이트 주소가 없어도 내지 않는다", () => {
    const r = row({ status: "changing" });
    expect(eventJsonLdScript(eventCard(r), r.starts_at, r.ends_at, site)).toBeNull();
    const ok = row();
    expect(eventJsonLdScript(eventCard(ok), ok.starts_at, ok.ends_at, undefined)).toBeNull();
    expect(JSON.stringify(parse(eventJsonLdScript(eventCard(ok), ok.starts_at, ok.ends_at, site)))).toContain("https://schema.org/EventScheduled");
  });
  it("영리 행사는 이름에 광고 표기가 붙는다", () => {
    const r = row({ sponsored: true, organizer_type: "commercial", category: "commercial", title: "시험 홍보 행사" });
    expect(JSON.stringify(parse(eventJsonLdScript(eventCard(r), r.starts_at, r.ends_at, site)))).toContain("광고");
  });
});

describe("허브 블록 (LG-08)", () => {
  const digests: DigestRow[] = [
    { id: 1, sido_code: "1100000000", week_key: "2026-42", starts_on: "2026-10-12", ends_on: "2026-10-18", published_at: "2026-10-19T01:00:00+00:00" },
    { id: 2, sido_code: "1100000000", week_key: "2026-43", starts_on: "2026-10-19", ends_on: "2026-10-25", published_at: "2026-10-26T01:00:00+00:00" },
  ];
  const item = (id: number, digest_id: number, region_code: string): DigestItemRow => ({
    id, digest_id, region_code, title: `시험 항목 ${id}`, source_url: "https://press.example.test/x", press_org: "시험 기관", announced_on: "2026-10-20", license_type: "unknown", summary: "시험 요약", position: id,
  });
  it("가장 최근 발행 주를 보이고 주차·기간·발행일을 한 줄로 낸다", () => {
    const b = weeklyBlock({ sidoSlug: "seoul", sidoName: "서울", sigungu: null, digests, items: [item(1, 1, "1100000000"), item(2, 2, "1100000000")] })!;
    expect(b.weekKey).toBe("2026-43");
    expect(b.meta).toBe("2026-43 · 2026-10-19 ~ 2026-10-25 · 발행 2026-10-26");
    expect(b.items.map((i) => i.id)).toEqual([2]);
    expect(b.href).toBe("/local/seoul/weekly/2026-43");
    expect(b.fallbackNotice).toBeNull();
  });
  it("시·군·구 허브는 그 시·군·구 항목을 먼저, 없으면 시·도 페이지 링크와 그 사실 문장", () => {
    const items = [item(3, 2, "1100000000"), item(4, 2, "1111000000")];
    const mine = weeklyBlock({ sidoSlug: "seoul", sidoName: "서울", sigungu: { code: "1111000000", name: "종로구" }, digests, items })!;
    expect(mine.items.map((i) => i.id)).toEqual([4, 3]);
    expect(mine.fallbackNotice).toBeNull();
    const none = weeklyBlock({ sidoSlug: "seoul", sidoName: "서울", sigungu: { code: "1114000000", name: "중구" }, digests, items })!;
    expect(none.fallbackNotice).toBe("중구 항목이 없어 서울 주간 페이지를 보입니다");
  });
  it("발행된 주가 없으면 블록이 없다", () => {
    expect(weeklyBlock({ sidoSlug: "seoul", sidoName: "서울", sigungu: null, digests: [], items: [] })).toBeNull();
  });
  it("행사안내 블록은 축제를 포함하고 지난 회차를 뺀다, 최대 5건", () => {
    const rows = [
      row({ category: "festival", startKst: "2026-10-25T10:00", endKst: "2026-10-26T10:00" }),
      row({ startKst: "2026-10-01T10:00", endKst: "2026-10-02T10:00" }),
      ...Array.from({ length: 6 }, () => row({ startKst: "2026-10-30T10:00", endKst: "2026-10-30T12:00" })),
    ];
    const b = eventsBlock(rows, new Set(["1100000000"]), "2026-10-24");
    expect(b.items).toHaveLength(5);
    expect(b.items.every((c) => c.endDate >= "2026-10-24")).toBe(true);
    expect(eventsBlock([rows[0]!], new Set(["1100000000"]), "2026-10-24").items[0]!.category).toBe("festival");
    expect(b.more.href).toBe("/local/events");
  });
});

describe("관리 화면 상태 계산 - 공개 뷰와 같은 규칙 (REG1-04)", () => {
  const ev = { status_override: null, starts_at: "2026-10-15T09:00:00+09:00", ends_at: "2026-10-20T18:00:00+09:00" } as const;
  it("10월 15~20일 회차는 14일 예정, 15일·20일 진행, 21일 종료", () => {
    expect(eventStatusAt(ev, new Date("2026-10-14T12:00:00+09:00"))).toBe("upcoming");
    expect(eventStatusAt(ev, new Date("2026-10-15T09:00:00+09:00"))).toBe("ongoing");
    expect(eventStatusAt(ev, new Date("2026-10-20T17:00:00+09:00"))).toBe("ongoing");
    expect(eventStatusAt(ev, new Date("2026-10-21T00:00:00+09:00"))).toBe("ended");
  });
  it("취소·변경 확인 중은 시각과 상관없이 지정값", () => {
    expect(eventStatusAt({ ...ev, status_override: "cancelled" }, new Date("2026-10-16T12:00:00+09:00"))).toBe("cancelled");
    expect(eventStatusAt({ ...ev, status_override: "changing" }, new Date("2026-10-30T12:00:00+09:00"))).toBe("changing");
  });
  it("재확인 - 확인 후 7일째는 정상, 8일째는 필요", () => {
    expect(recheckDue("2026-10-10", 7, "2026-10-17")).toBe(false);
    expect(recheckDue("2026-10-10", 7, "2026-10-18")).toBe(true);
  });
});
