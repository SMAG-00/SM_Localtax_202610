import { describe, expect, test } from "vitest";
import { CLOSED_FEATURES } from "./settings";
import type { Features } from "./constants";
import { buildShortcuts, openDestinations, parseShortcutCopy, NO_SHORTCUT_INPUTS } from "./shortcuts-logic";

const on = (...keys: (keyof Features)[]): Features => ({ ...CLOSED_FEATURES, ...Object.fromEntries(keys.map((k) => [k, true])) }) as Features;
const ALL_ON = on("shortcuts", "calc", "expert_requests", "brief_regular", "realestate_weekly");
const INPUTS = { briefHref: "/brief/2026-10-26", weeklyOpen: true };

describe("바로가기 메뉴 (키 shortcuts 하나로 결정)", () => {
  test("키 shortcuts가 꺼지면 다른 키가 모두 켜져도 0개", () => {
    expect(buildShortcuts({ ...ALL_ON, shortcuts: false }, INPUTS)).toEqual([]);
  });
  test("모두 열리면 계산기, 재테크 포인트, 법령 해석, 상담 요청 순서와 실제 주소", () => {
    expect(buildShortcuts(ALL_ON, INPUTS).map((s) => [s.key, s.href])).toEqual([
      ["calc", "/calc"],
      ["realestate_weekly", "/realestate/weekly"],
      ["brief_weekly", "/brief/2026-10-26"],
      ["expert_request", "/experts/request"],
    ]);
  });
  test("바로가기 글자에 AI 낱말이 없다", () => {
    for (const s of buildShortcuts(ALL_ON, INPUTS)) expect(s.label).not.toMatch(/AI/);
  });
  test("도착 키 16가지 조합에 상관없이 키 shortcuts만 켜지면 항상 4개이고 상담 요청은 마지막", () => {
    for (let mask = 0; mask < 16; mask++) {
      const keys = (["calc", "expert_requests", "brief_regular", "realestate_weekly"] as const).filter((_, i) => !!(mask & (1 << i)));
      const got = buildShortcuts(on("shortcuts", ...keys), NO_SHORTCUT_INPUTS);
      expect(got.map((s) => s.key), `mask ${mask}`).toEqual(["calc", "realestate_weekly", "brief_weekly", "expert_request"]);
    }
  });
  test("모든 도착 키가 꺼지고 공개 호가 0이어도 4개 - 법령 해석은 /brief, 나머지는 고정 주소", () => {
    expect(buildShortcuts(on("shortcuts"), NO_SHORTCUT_INPUTS).map((s) => [s.key, s.href])).toEqual([
      ["calc", "/calc"],
      ["realestate_weekly", "/realestate/weekly"],
      ["brief_weekly", "/brief"],
      ["expert_request", "/experts/request"],
    ]);
  });
  test("공개 호가 있으면 법령 해석 주소만 최신 호로 바뀐다", () => {
    const got = buildShortcuts(on("shortcuts"), { briefHref: "/brief/2026-10-19", weeklyOpen: false });
    expect(got.find((s) => s.key === "brief_weekly")!.href).toBe("/brief/2026-10-19");
    expect(got).toHaveLength(4);
  });
  test("설정 순서와 관심 분야가 반영되고 상담 요청은 끝까지 마지막이다", () => {
    expect(buildShortcuts(ALL_ON, INPUTS, ["brief_weekly", "calc", "realestate_weekly"]).map((s) => s.key)).toEqual(["brief_weekly", "calc", "realestate_weekly", "expert_request"]);
    expect(buildShortcuts(ALL_ON, INPUTS, undefined, ["realestate"])[0]!.key).toBe("realestate_weekly");
    // 도착 키가 꺼져 있어도 관심 분야 맞춤은 그대로 적용된다
    const closed = buildShortcuts(on("shortcuts"), NO_SHORTCUT_INPUTS, undefined, ["realestate"]);
    expect(closed.map((s) => s.key)).toEqual(["realestate_weekly", "calc", "brief_weekly", "expert_request"]);
  });
});

describe("실제로 열린 도착 (캠페인 랜딩 /go용)", () => {
  test("키 shortcuts는 보지 않고 도착 키·공개 호가 닫힌 도착은 뺀다", () => {
    expect(openDestinations(on("calc", "expert_requests"), NO_SHORTCUT_INPUTS).map((s) => s.key)).toEqual(["calc", "expert_request"]);
    expect(openDestinations(CLOSED_FEATURES, INPUTS)).toEqual([]);
  });
  test("법령 해석은 키 brief_regular와 공개 호가 모두 있어야 열리고 주소는 최신 호", () => {
    expect(openDestinations(on("brief_regular"), INPUTS).map((s) => [s.key, s.href])).toEqual([["brief_weekly", "/brief/2026-10-26"]]);
    expect(openDestinations(on("brief_regular"), NO_SHORTCUT_INPUTS)).toEqual([]);
    expect(openDestinations(on("realestate_weekly"), NO_SHORTCUT_INPUTS)).toEqual([]);
    expect(openDestinations(on("realestate_weekly"), INPUTS).map((s) => s.key)).toEqual(["realestate_weekly"]);
  });
});

describe("바로가기 설명 설정 읽기", () => {
  test("30자 이하 한 줄만 받고 31자, 줄바꿈, 모르는 키는 버린다", () => {
    expect(parseShortcutCopy({ calc: "가".repeat(30), brief_weekly: "가".repeat(31), realestate_weekly: "a\nb", nope: "x" })).toEqual({ calc: "가".repeat(30) });
  });
  test("객체가 아니면 빈 값", () => {
    expect(parseShortcutCopy(null)).toEqual({});
    expect(parseShortcutCopy(["calc"])).toEqual({});
  });
});
