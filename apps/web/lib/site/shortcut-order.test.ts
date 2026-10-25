import { describe, expect, test } from "vitest";
import { orderShortcuts, parseInterests, parseShortcutOrder, shortcutOrderErrors, SHORTCUT_ORDER_DEFAULT, type ShortcutKey } from "./shortcut-order";

const ALL: ShortcutKey[] = ["calc", "realestate_weekly", "brief_weekly", "expert_request"];

describe("shortcut_order 설정 검사", () => {
  test("세 키를 한 번씩 담은 순서는 통과한다", () => {
    expect(shortcutOrderErrors(["brief_weekly", "calc", "realestate_weekly"])).toEqual([]);
  });
  test.each([
    [["calc", "realestate_weekly"]],
    [["calc", "calc", "realestate_weekly"]],
    [["calc", "realestate_weekly", "expert_request"]],
    [["calc", "realestate_weekly", "brief_weekly", "expert_request"]],
    [{ 0: "calc" }],
    [null],
  ])("틀린 모양 %j 는 거부되고 기본 순서로 읽힌다", (v) => {
    expect(shortcutOrderErrors(v).length).toBe(1);
    expect(parseShortcutOrder(v)).toEqual(SHORTCUT_ORDER_DEFAULT);
  });
});

describe("바로가기 순서 계산", () => {
  test("기본 순서는 계산기, 재테크 포인트, 법령 해석, 상담 요청(마지막)", () => {
    expect(orderShortcuts(ALL, undefined)).toEqual(["calc", "realestate_weekly", "brief_weekly", "expert_request"]);
  });
  test("설정 순서를 따르되 상담 요청은 입력 순서와 상관없이 마지막", () => {
    expect(orderShortcuts(["expert_request", "brief_weekly", "calc", "realestate_weekly"], ["brief_weekly", "calc", "realestate_weekly"])).toEqual([
      "brief_weekly",
      "calc",
      "realestate_weekly",
      "expert_request",
    ]);
  });
  test("닫힌 바로가기는 순서에서 빠진다", () => {
    expect(orderShortcuts(["brief_weekly", "expert_request"], undefined)).toEqual(["brief_weekly", "expert_request"]);
  });
  test("관심 분야가 부동산재테크면 재테크 포인트가 1번이 된다", () => {
    expect(orderShortcuts(ALL, undefined, ["realestate"])).toEqual(["realestate_weekly", "calc", "brief_weekly", "expert_request"]);
  });
  test("관심 분야에 맞는 바로가기가 닫혀 있으면 설정 순서 그대로", () => {
    expect(orderShortcuts(["calc", "brief_weekly", "expert_request"], undefined, ["realestate"])).toEqual(["calc", "brief_weekly", "expert_request"]);
  });
  test("맞는 바로가기가 없는 관심 분야(금융)는 순서를 바꾸지 않고, 여러 개면 앞에 저장된 것이 이긴다", () => {
    expect(orderShortcuts(ALL, undefined, ["finance"])).toEqual(["calc", "realestate_weekly", "brief_weekly", "expert_request"]);
    expect(orderShortcuts(ALL, undefined, ["finance", "realestate", "tax"])).toEqual(["realestate_weekly", "calc", "brief_weekly", "expert_request"]);
  });
});

describe("프로필 관심 분야 읽기", () => {
  test("아는 분야 키만 남기고 저장 순서를 지키며 중복은 뺀다", () => {
    expect(parseInterests(["realestate", "x", "tax", "realestate", 3, null])).toEqual(["realestate", "tax"]);
  });
  test("배열이 아니면 빈 목록", () => {
    expect(parseInterests(null)).toEqual([]);
    expect(parseInterests("tax")).toEqual([]);
  });
  test("읽은 관심 분야가 부동산재테크이면 순서 맨 앞이 재테크 포인트가 된다", () => {
    expect(orderShortcuts(ALL, undefined, parseInterests(["finance", "realestate"]))[0]).toBe("realestate_weekly");
  });
});
