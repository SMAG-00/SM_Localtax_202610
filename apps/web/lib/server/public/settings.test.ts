// 공개 설정 읽기 — 모양이 틀리면 닫힌 쪽(꺼짐·숨김·기본값)으로 (설계 2.4)
import { describe, expect, test } from "vitest";
import { FEATURE_KEYS, NEXT_ACTION_KEYS } from "./constants";
import { CLOSED_FEATURES, parseFeatures, parsePriority, parsePublicSettings, parseSearchChips } from "./settings";

const rows = (o: Record<string, unknown>) => Object.entries(o).map(([key, value]) => ({ key, value }));

describe("parsePublicSettings", () => {
  test("씨앗 값 그대로 — 핵심 메시지, 칩 0개, 기능 모두 꺼짐, 우선순위, 상한 4, 확정 기준 공포", () => {
    const s = parsePublicSettings(
      rows({
        home_core_message: "부동산과 지자체의 변화를 읽고 대응하려면 지방세 이해가 필수다",
        home_search_chips: [],
        hub_intros: {},
        amendment_confirmed_stage: "promulgated",
        hub_situation_limit: 4,
        feature_flags: CLOSED_FEATURES,
        next_action_priority: [...NEXT_ACTION_KEYS],
      }),
    );
    expect(s).toEqual({
      coreMessage: "부동산과 지자체의 변화를 읽고 대응하려면 지방세 이해가 필수다",
      searchChips: [],
      hubIntros: {},
      confirmStage: "promulgated",
      hubSituationLimit: 4,
      features: CLOSED_FEATURES,
      nextActionPriority: [...NEXT_ACTION_KEYS],
    });
  });

  test("행이 하나도 없으면 — 메시지 없음, 기능 꺼짐, 기본 우선순위·상한·기준", () => {
    const s = parsePublicSettings([]);
    expect(s.coreMessage).toBeNull();
    expect(Object.values(s.features).every((v) => v === false)).toBe(true);
    expect(s.hubSituationLimit).toBe(4);
    expect(s.confirmStage).toBe("promulgated");
    expect(s.nextActionPriority).toEqual([...NEXT_ACTION_KEYS]);
  });

  test("틀린 모양 — 공백 메시지는 null, 단계 이름이 아니면 공포, 상한은 1 이상 정수(소수는 내림)", () => {
    expect(parsePublicSettings(rows({ home_core_message: "   " })).coreMessage).toBeNull();
    expect(parsePublicSettings(rows({ amendment_confirmed_stage: "공포" })).confirmStage).toBe("promulgated");
    expect(parsePublicSettings(rows({ amendment_confirmed_stage: "effective" })).confirmStage).toBe("effective");
    expect(parsePublicSettings(rows({ hub_situation_limit: 0 })).hubSituationLimit).toBe(4);
    expect(parsePublicSettings(rows({ hub_situation_limit: "6" })).hubSituationLimit).toBe(4);
    expect(parsePublicSettings(rows({ hub_situation_limit: 5.9 })).hubSituationLimit).toBe(5);
  });

  test("허브 소개 — 4대 분야 키의 글자만", () => {
    expect(parsePublicSettings(rows({ hub_intros: { tax: " 지방세 소식 ", tourism: "관광", local: 3 } })).hubIntros).toEqual({ tax: "지방세 소식" });
  });
});

describe("추천 검색어 칩 (HOME-01 — 3~6개, 0개면 숨김)", () => {
  test.each([
    [[], []],
    [["취득세", "개편안"], []],
    [["취득세", "개편안", "신속통합기획"], ["취득세", "개편안", "신속통합기획"]],
    [["a", "b", "c", "d", "e", "f"], ["a", "b", "c", "d", "e", "f"]],
    [["a", "b", "c", "d", "e", "f", "g"], []],
    [["취득세", "취득세", "개편안", "책임준공"], []],
    [["취득세", " ", "개편안"], []],
    [["취득세", 3, "개편안"], []],
  ] as [unknown[], string[]][])("%j → %j", (input, expected) => {
    expect(parseSearchChips(input)).toEqual(expected);
  });

  test("목록이 아니면 숨김", () => expect(parseSearchChips("취득세,개편안,책임준공")).toEqual([]));
});

describe("기능 공개 목록 — true만 열린다", () => {
  test("모르는 키는 버리고, 없는 키·true가 아닌 값은 꺼짐", () => {
    const f = parseFeatures({ search: true, calc: "true", experts: 1, tourism: true });
    expect(f.search).toBe(true);
    expect(f.calc).toBe(false);
    expect(f.experts).toBe(false);
    expect(Object.keys(f).sort()).toEqual([...FEATURE_KEYS].sort());
  });
  test("객체가 아니면 모두 꺼짐", () => expect(parseFeatures([true])).toEqual(CLOSED_FEATURES));
});

describe("다음 행동 우선순위 (ART-06)", () => {
  test("모르는 키·중복은 빼고 순서는 지킨다", () => {
    expect(parsePriority(["expert_finder", "nope", "situation", "expert_finder"])).toEqual(["expert_finder", "situation"]);
  });
  test("목록이 아니면 기본 순서", () => expect(parsePriority({})).toEqual([...NEXT_ACTION_KEYS]));
});
