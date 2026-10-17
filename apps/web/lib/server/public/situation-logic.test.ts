// 상황 페이지 규칙 (UX-05 · FAM-02 · CAT-03)
import { describe, expect, test } from "vitest";
import {
  codesWithin,
  hubSituationCards,
  inIdOrder,
  readChecklist,
  readChecks,
  readToolFeatures,
  regionArticles,
  regionChoices,
  toolActionKeys,
  toSituationCard,
} from "./situation-logic";
import { listItem, region, situationRow } from "./test-items";

describe("먼저 확인할 것 · 체크리스트 · 연결 칸 읽기", () => {
  test("단계 타임라인 항목 — 제목 필수, 때·할 일은 있을 때만", () => {
    expect(readChecks([{ title: "자동차세 연세액 납부 여부", when: "판 날", note: "영수증을 찾아 둡니다" }, { title: "등록 말소일" }, { note: "제목 없음" }, "글자"])).toEqual([
      { title: "자동차세 연세액 납부 여부", when: "판 날", note: "영수증을 찾아 둡니다" },
      { title: "등록 말소일" },
    ]);
    expect(readChecks({})).toEqual([]);
  });

  test("일반적 체크리스트는 항목과 고지가 모두 있어야 상자가 있다 (FAM-02)", () => {
    const NOTICE = "일반적인 안내이며 개별 사건의 확정 안내가 아닙니다";
    expect(readChecklist({ items: ["상속 등기 기한", " "], notice: NOTICE })).toEqual({ items: ["상속 등기 기한"], notice: NOTICE });
    expect(readChecklist({ items: ["상속 등기 기한"] })).toBeNull();
    expect(readChecklist({ items: [], notice: NOTICE })).toBeNull();
    expect(readChecklist(null)).toBeNull();
  });

  test("연결 칸 — 아는 기능 키만, 그중 다음 행동 버튼이 되는 것", () => {
    const features = readToolFeatures([{ feature: "sm_calculator" }, { feature: "expert_finder" }, { feature: "tourism" }, { feature: "sm_calculator" }, "taxbot"]);
    expect(features).toEqual(["sm_calculator", "expert_finder"]);
    expect(toolActionKeys(["sm_calculator", "calc", "taxbot"])).toEqual(["sm_calculator", "taxbot"]);
  });
});

describe("지정 순서 · 비공개 빠짐 (UX-05 '연결한 기사가 비공개로 바뀌면 링크가 빠진다')", () => {
  test("번호 순서 그대로, 읽히지 않는 번호·중복은 뺀다", () => {
    const rows = [listItem({ id: 3 }), listItem({ id: 1 }), listItem({ id: 2 })];
    expect(inIdOrder([2, 9, 3, 2], rows).map((r) => r.id)).toEqual([2, 3]);
    expect(inIdOrder([], rows)).toEqual([]);
  });
});

describe("허브 상황 카드 줄 (UX-05 — 0~상한)", () => {
  test("그 분야의 허브 자리 순, 상한까지 — 다른 분야·허브 밖 상황·모르는 픽토그램은 빠진다", () => {
    const rows = [
      situationRow({ slug: "c", section: "tax", hub_slot: 3 }),
      situationRow({ slug: "a", section: "tax", hub_slot: 1 }),
      situationRow({ slug: "x", section: "realestate", hub_slot: 2 }),
      situationRow({ slug: "y", section: "tax", hub_slot: null }),
      situationRow({ slug: "z", section: "tax", hub_slot: 2, pictogram: "unknown-picture" }),
      situationRow({ slug: "e", section: "tax", hub_slot: 5 }),
    ];
    expect(hubSituationCards(rows, "tax", 4).map((c) => c.slug)).toEqual(["a", "c"]);
    expect(hubSituationCards(rows, "tax", 5).map((c) => c.slug)).toEqual(["a", "c", "e"]);
    expect(hubSituationCards(rows, "finance", 4)).toEqual([]);
  });

  test("카드 값 — 상황 페이지 주소·한 줄·픽토그램", () => {
    expect(toSituationCard(situationRow({ slug: "car-sold", subtitle: null }))).toEqual({
      slug: "car-sold",
      href: "/situations/car-sold",
      title: "차를 팔았어요·폐차했어요",
      subtitle: "",
      pictogram: "car-sold",
      section: "tax",
    });
  });
});

describe("지역 선택 · 지역 기사 (UX-05 '집을 샀어요' · CAT-03)", () => {
  const SEOUL = region({ code: "1100000000", name: "서울특별시" });
  const BUSAN = region({ code: "2600000000", name: "부산광역시" });
  const SEONGDONG = region({ code: "1120000000", name: "성동구", level: "sigungu", parent_code: SEOUL.code });
  const MAPO = region({ code: "1144000000", name: "마포구", level: "sigungu", parent_code: SEOUL.code });
  const OLD = region({ code: "2611000000", name: "옛 구", level: "sigungu", parent_code: BUSAN.code, valid_to: "2025-12-31" });
  const ALL = [BUSAN, SEOUL, SEONGDONG, MAPO, OLD];

  test("고를 수 있는 지역 — 유효한 시·도 전부(코드 순), 시·도나 그 시·군·구를 골랐으면 그 시·군·구도", () => {
    expect(regionChoices(ALL, null, "2026-10-18")).toEqual({ sido: [expect.objectContaining({ code: SEOUL.code }), expect.objectContaining({ code: BUSAN.code })], sigungu: [] });
    expect(regionChoices(ALL, SEONGDONG, "2026-10-18").sigungu.map((r) => r.name)).toEqual(["성동구", "마포구"]);
    expect(regionChoices(ALL, BUSAN, "2026-10-18").sigungu).toEqual([]);
  });

  test("시·군·구를 고르면 그 지역 태그 기사만", () => {
    const items = [listItem({ id: 1, regionCodes: [SEONGDONG.code] }), listItem({ id: 2, regionCodes: [MAPO.code] }), listItem({ id: 3, regionCodes: [SEOUL.code] })];
    const r = regionArticles(SEONGDONG, ALL, items);
    expect(r.items.map((a) => a.id)).toEqual([1]);
    expect(r.fallbackTo).toBeNull();
  });

  test("시·군·구 기사가 0건이면 상위 시·도 기사(하위 태그 포함)와 그 사실", () => {
    const items = [listItem({ id: 2, regionCodes: [MAPO.code] }), listItem({ id: 3, regionCodes: [SEOUL.code] }), listItem({ id: 4, regionCodes: [BUSAN.code] })];
    const r = regionArticles(SEONGDONG, ALL, items);
    expect(r.items.map((a) => a.id)).toEqual([2, 3]);
    expect(r.fallbackTo).toEqual({ code: SEOUL.code, name: "서울특별시", level: "sido" });
  });

  test("시·도를 고르면 시·군·구 태그 기사도 나오고, 0건이면 빈 목록(없는 기사를 만들지 않는다)", () => {
    expect(regionArticles(SEOUL, ALL, [listItem({ id: 5, regionCodes: [MAPO.code] })]).items.map((a) => a.id)).toEqual([5]);
    expect(regionArticles(BUSAN, ALL, [listItem({ id: 5, regionCodes: [MAPO.code] })])).toMatchObject({ items: [], fallbackTo: null });
    expect(codesWithin(SEOUL.code, ALL)).toEqual([SEOUL.code, SEONGDONG.code, MAPO.code]);
  });
});
