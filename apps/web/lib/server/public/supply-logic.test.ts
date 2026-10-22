// 분양 정보 공개 화면 규칙 (W4 17단계 — docs/dev/W4_설계.md 1장 17단계 · 2.3 · 5장 · 12장 #11·#140~, PRD-01B PR-04 · PR-01 · PR-05)
// 지역·분양 정보는 시험용 가짜다(접두 99 · '시험용' — 설계 8장). 청약 마감 경계는 한국 시각(KST)으로 본다(설계 8장 '마감일 23:59/00:00').
import { describe, expect, test } from "vitest";
import { FEATURE_KEYS, type FeatureKey, type Features } from "./constants";
import type { RegionRow } from "./rows";
import {
  SUPPLY_HREF,
  SUPPLY_LIMITS,
  filterSupply,
  hubSupplyCards,
  isUpcoming,
  kstDateOf,
  parseSupplyFilter,
  sortProjectSupply,
  supplyBreadcrumb,
  supplyCard,
  supplyCrumbs,
  supplyListHref,
  supplyPhase,
  supplyRegionChips,
  supplySourceLine,
  upcomingCards,
  type PublicSupplyRow,
  type SupplyCard,
} from "./supply-logic";

const features = (on: FeatureKey[] = []): Features => Object.fromEntries(FEATURE_KEYS.map((k) => [k, on.includes(k)])) as Features;
const REGIONS: RegionRow[] = [
  { code: "9900000000", parent_code: null, level: "sido", name: "시험용 분양도", slug: "siheom-bunyang-do", aliases: [], valid_from: null, valid_to: null },
  { code: "9901100000", parent_code: "9900000000", level: "sigungu", name: "시험용 하늘구", slug: "siheom-haneul-gu", aliases: [], valid_from: null, valid_to: null },
  { code: "9901200000", parent_code: "9900000000", level: "sigungu", name: "시험용 바다구", slug: "siheom-bada-gu", aliases: [], valid_from: null, valid_to: null },
  { code: "9800000000", parent_code: null, level: "sido", name: "시험용 옆도", slug: "siheom-yeop-do", aliases: [], valid_from: null, valid_to: null },
];
const ROW: PublicSupplyRow = {
  id: 1,
  name: "시험용 하늘마을 분양",
  region_code: "9901100000",
  supply_scale: "총 820세대 중 일반공급 410세대",
  apply_start: "2026-11-02",
  apply_end: "2026-11-04",
  notice_date: "2026-10-26",
  notice_issuer: "시험용 하늘구청",
  official_notice_url: "https://gov.example.test/supply/1",
  verified_at: "2026-10-22T16:30:00Z",
  license_type: "kogl_1",
  project_id: null,
  project_slug: null,
  project_name: null,
};
/** 한국 시각 → Date */
const kst = (local: string) => new Date(`${local}+09:00`);

describe("청약 마감 경계 (2.3 — 마감일 다음 날 00:00 KST부터 예정 목록 제외)", () => {
  test("마감일 23:59:59(KST) = 있음 · 다음 날 00:00:00(KST) = 없음 · 마감일 00:00 = 있음 · 마감 전날 = 있음", () => {
    expect(isUpcoming("2026-11-04", kst("2026-11-04T23:59:59"))).toBe(true);
    expect(isUpcoming("2026-11-04", kst("2026-11-05T00:00:00"))).toBe(false);
    expect(isUpcoming("2026-11-04", kst("2026-11-04T00:00:00"))).toBe(true);
    expect(isUpcoming("2026-11-04", kst("2026-11-03T12:00:00"))).toBe(true);
  });
  test("UTC 날짜가 아니라 한국 날짜 — UTC 11-04 15:00 = KST 11-05 00:00 (빠짐), UTC 11-04 14:59 = KST 11-04 23:59 (있음)", () => {
    expect(isUpcoming("2026-11-04", new Date("2026-11-04T15:00:00Z"))).toBe(false);
    expect(isUpcoming("2026-11-04", new Date("2026-11-04T14:59:59Z"))).toBe(true);
    expect(kstDateOf(new Date("2026-11-04T15:00:00Z"))).toBe("2026-11-05");
  });
  test("모양 밖 마감일은 목록에 넣지 않는다", () => {
    expect(isUpcoming("2026/11/04", kst("2026-10-01T00:00:00"))).toBe(false);
    expect(isUpcoming("", kst("2026-10-01T00:00:00"))).toBe(false);
  });
  test("예정 목록 카드 — 마감일 23:59에는 보이고 다음 날 00:00에는 0장", () => {
    expect(upcomingCards([ROW], REGIONS, kst("2026-11-04T23:59:00"), features()).map((c) => c.id)).toEqual([1]);
    expect(upcomingCards([ROW], REGIONS, kst("2026-11-05T00:00:00"), features())).toEqual([]);
  });
  test("청약 단계 — 시작 전 예정 · 시작일~마감일 접수 중 · 다음 날부터 마감", () => {
    expect(supplyPhase("2026-11-02", "2026-11-04", "2026-11-01")).toBe("upcoming");
    expect(supplyPhase("2026-11-02", "2026-11-04", "2026-11-02")).toBe("open");
    expect(supplyPhase("2026-11-02", "2026-11-04", "2026-11-04")).toBe("open");
    expect(supplyPhase("2026-11-02", "2026-11-04", "2026-11-05")).toBe("closed");
  });
});

describe("카드 (PR-01 지역·단계·출처·기준일 · PR-04 항목)", () => {
  test("칸 전부 — 지역 이름·표준코드·청약 단계·공급 규모·일정·출처(공고 기관)·기준일(모집공고일)·확인일(KST 날짜)·공식 공고·공공누리", () => {
    const card = supplyCard(ROW, REGIONS, "2026-11-03", features(["region_hubs"]))!;
    expect(card).toEqual({
      id: 1,
      name: "시험용 하늘마을 분양",
      region: { code: "9901100000", name: "시험용 분양도 시험용 하늘구", href: "/local/siheom-bunyang-do/siheom-haneul-gu" },
      phase: { key: "open", label: "청약 접수 중" },
      supplyScale: "총 820세대 중 일반공급 410세대",
      applyStart: "2026-11-02",
      applyEnd: "2026-11-04",
      noticeDate: "2026-10-26",
      issuer: "시험용 하늘구청",
      noticeUrl: "https://gov.example.test/supply/1",
      verifiedOn: "2026-10-23",
      license: card.license,
      project: null,
    });
    expect(card.license).toMatch(/제1유형/);
    expect(supplyCard(ROW, REGIONS, "2026-11-03", features())!.region.href).toBeNull();
  });
  test("칸 하나라도 비거나 모양이 틀리면 카드 0 — 빈 칸 카드 0 (11종)", () => {
    const broken: Partial<PublicSupplyRow>[] = [
      { name: " " },
      { supply_scale: null },
      { notice_issuer: "" },
      { official_notice_url: "javascript:alert(1)" },
      { official_notice_url: null },
      { verified_at: null },
      { region_code: "9999999999" },
      { region_code: "99011" },
      { apply_end: "2026-11-01" },
      { notice_date: null },
      { apply_start: "2026/11/02" },
    ];
    for (const over of broken) expect(supplyCard({ ...ROW, ...over }, REGIONS, "2026-11-03", features()), JSON.stringify(over)).toBeNull();
  });
  test("사업명·공급 규모·공고 기관에 금액·가격 표현이 든 줄은 카드 0 (DB 저장 검사를 지나온 줄이라도 — 가격 글자 0)", () => {
    for (const over of [{ name: "시험용 하늘마을 분양가 안내" }, { supply_scale: "84㎡ 5억원" }, { notice_issuer: "시세 센터" }]) {
      expect(supplyCard({ ...ROW, ...over }, REGIONS, "2026-11-03", features())).toBeNull();
    }
  });
  test("연결 프로젝트 — 공개 프로젝트(뷰가 준 주소)이고 realestate_projects가 켜졌을 때만 같은 창 링크", () => {
    const linked = { ...ROW, project_id: 7, project_slug: "siheom-haneul", project_name: "시험용 하늘구역 정비" };
    expect(supplyCard(linked, REGIONS, "2026-11-03", features(["realestate_projects"]))!.project).toEqual({ name: "시험용 하늘구역 정비", href: "/realestate/projects/siheom-haneul" });
    expect(supplyCard(linked, REGIONS, "2026-11-03", features())!.project).toBeNull();
    expect(supplyCard({ ...linked, project_slug: null }, REGIONS, "2026-11-03", features(["realestate_projects"]))!.project).toBeNull();
  });
});

const card = (id: number, over: Partial<SupplyCard> = {}): SupplyCard => ({ ...supplyCard({ ...ROW, id }, REGIONS, "2026-10-30", features())!, ...over });

describe("차례·거르개·허브 카드", () => {
  test("예정 목록 — 마감 이른 순 → 시작일 → 번호", () => {
    const cards = [card(3, { applyEnd: "2026-11-10" }), card(2, { applyEnd: "2026-11-04", applyStart: "2026-11-03" }), card(1, { applyEnd: "2026-11-04" })];
    const rows: PublicSupplyRow[] = cards.map((c) => ({ ...ROW, id: c.id, apply_end: c.applyEnd, apply_start: c.applyStart }));
    expect(upcomingCards(rows, REGIONS, kst("2026-10-30T09:00:00"), features()).map((c) => c.id)).toEqual([1, 2, 3]);
  });
  test("프로젝트 화면 — 예정·접수 중 먼저(마감 이른 순), 그다음 마감 기록(최근 마감 위)", () => {
    const cards = [
      card(1, { phase: { key: "closed", label: "청약 마감" }, applyEnd: "2026-03-04" }),
      card(2, { phase: { key: "upcoming", label: "청약 예정" }, applyEnd: "2026-12-04" }),
      card(3, { phase: { key: "closed", label: "청약 마감" }, applyEnd: "2026-06-04" }),
      card(4, { phase: { key: "open", label: "청약 접수 중" }, applyEnd: "2026-11-04" }),
    ];
    expect(sortProjectSupply(cards).map((c) => c.id)).toEqual([4, 2, 3, 1]);
  });
  test("거르개 ?region= — 10자리 코드만(모양 밖은 전체) · 시·도 코드는 그 아래 시·군·구 포함", () => {
    expect(parseSupplyFilter({ region: "9900000000" })).toEqual({ region: "9900000000" });
    expect(parseSupplyFilter({ region: "seoul" })).toEqual({ region: null });
    expect(parseSupplyFilter({ region: ["9901100000", "x"] })).toEqual({ region: "9901100000" });
    const cards = [card(1), card(2, { region: { code: "9901200000", name: "바다", href: null } }), card(3, { region: { code: "9800000000", name: "옆도", href: null } })];
    expect(filterSupply(cards, { region: "9900000000" }).map((c) => c.id)).toEqual([1, 2]);
    expect(filterSupply(cards, { region: "9901200000" }).map((c) => c.id)).toEqual([2]);
    expect(filterSupply(cards, { region: null }).map((c) => c.id)).toEqual([1, 2, 3]);
    expect(supplyListHref({ region: "9900000000" })).toBe("/realestate/supply?region=9900000000");
    expect(supplyListHref({ region: null })).toBe(SUPPLY_HREF);
  });
  test("지역 칩 — 카드가 있는 시·도만(코드 순)·'전체' 앞·고른 칩 표시, 카드 0이면 칩 0", () => {
    const cards = [card(1), card(2, { region: { code: "9901200000", name: "바다", href: null } }), card(3, { region: { code: "9800000000", name: "옆도", href: null } })];
    expect(supplyRegionChips(cards, { region: "9900000000" }, REGIONS).map((c) => [c.label, c.count, c.href, c.current])).toEqual([
      ["전체", 0, "/realestate/supply", false],
      ["시험용 옆도", 1, "/realestate/supply?region=9800000000", false],
      ["시험용 분양도", 2, "/realestate/supply?region=9900000000", true],
    ]);
    expect(supplyRegionChips([], { region: null }, REGIONS)).toEqual([]);
  });
  test(`지역 허브 ③ — 최대 ${SUPPLY_LIMITS.hubCards}장, 더 있으면 목록(그 지역 거르개) 주소`, () => {
    const five = [1, 2, 3, 4, 5].map((i) => card(i));
    expect(hubSupplyCards(five, "9901100000")).toEqual({ cards: five.slice(0, 4), more: "/realestate/supply?region=9901100000" });
    expect(hubSupplyCards(five.slice(0, 4), "9901100000")).toEqual({ cards: five.slice(0, 4), more: null });
  });
});

describe("이동 줄·구조화 데이터·출처 줄", () => {
  test("이동 줄 홈 > 부동산 > 분양 정보 = BreadcrumbList(같은 값) · 사이트 주소 없으면 null", () => {
    expect(supplyCrumbs()).toEqual([
      { name: "홈", href: "/" },
      { name: "부동산", href: "/realestate" },
      { name: "분양 정보", href: "/realestate/supply" },
    ]);
    expect(supplyBreadcrumb(supplyCrumbs(), "https://e2e.example.test")).toEqual({
      items: [
        { name: "홈", url: "https://e2e.example.test/" },
        { name: "부동산", url: "https://e2e.example.test/realestate" },
        { name: "분양 정보", url: "https://e2e.example.test/realestate/supply" },
      ],
    });
    expect(supplyBreadcrumb(supplyCrumbs(), undefined)).toBeNull();
  });
  test("데이터 출처 줄 — 공고 기관(겹침 0)·가장 이른 모집공고일·가장 이른 확인일, 카드 0이면 null", () => {
    const cards = [card(1), card(2, { issuer: "시험용 바다구청", noticeDate: "2026-10-20", verifiedOn: "2026-10-25" }), card(3, { verifiedOn: "2026-10-21" })];
    expect(supplySourceLine(cards)).toEqual({ source: "시험용 하늘구청 · 시험용 바다구청", baseDate: "2026-10-20", checkedAt: "2026-10-21" });
    expect(supplySourceLine([])).toBeNull();
  });
});
