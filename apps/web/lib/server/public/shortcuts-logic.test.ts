import { describe, expect, test } from "vitest";
import { CLOSED_FEATURES } from "./settings";
import type { Features } from "./constants";
import { buildShortcuts, parseShortcutCopy, NO_SHORTCUT_INPUTS } from "./shortcuts-logic";

const on = (...keys: (keyof Features)[]): Features => ({ ...CLOSED_FEATURES, ...Object.fromEntries(keys.map((k) => [k, true])) }) as Features;
const ALL_ON = on("shortcuts", "calc", "expert_requests", "brief_regular", "realestate_weekly");
const INPUTS = { briefHref: "/brief/2026-10-26", weeklyOpen: true };

describe("바로가기 열림 판정", () => {
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
  test("도착 열림 조합 16가지 - 열린 도착 수만큼만 나오고 상담 요청은 열려 있으면 항상 마지막", () => {
    for (let mask = 0; mask < 16; mask++) {
      const flags = [!!(mask & 1), !!(mask & 2), !!(mask & 4), !!(mask & 8)];
      const keys = (["calc", "expert_requests", "brief_regular", "realestate_weekly"] as const).filter((_, i) => flags[i]);
      const got = buildShortcuts(on("shortcuts", ...keys), INPUTS);
      expect(got.length, `mask ${mask}`).toBe(flags.filter(Boolean).length);
      if (flags[1]) expect(got.at(-1)!.key).toBe("expert_request");
    }
  });
  test("공개 호가 0이면 법령 해석과 재테크 포인트 바로가기는 키가 켜져도 빠진다", () => {
    expect(buildShortcuts(ALL_ON, NO_SHORTCUT_INPUTS).map((s) => s.key)).toEqual(["calc", "expert_request"]);
  });
  test("설정 순서와 관심 분야가 반영된다", () => {
    expect(buildShortcuts(ALL_ON, INPUTS, ["brief_weekly", "calc", "realestate_weekly"]).map((s) => s.key)).toEqual(["brief_weekly", "calc", "realestate_weekly", "expert_request"]);
    expect(buildShortcuts(ALL_ON, INPUTS, undefined, ["realestate"])[0]!.key).toBe("realestate_weekly");
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
