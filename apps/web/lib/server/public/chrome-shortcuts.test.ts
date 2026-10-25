// 화면 틀의 바로가기 (HOME-12) - buildChrome이 키·공개 호로 바로가기를 계산해 SiteChrome.shortcuts에 담는다
import { describe, expect, test } from "vitest";
import { buildChrome, closedChrome } from "./chrome-logic";
import type { Features } from "./constants";
import { CLOSED_FEATURES } from "./settings";

const on = (...k: (keyof Features)[]): Features => ({ ...CLOSED_FEATURES, ...Object.fromEntries(k.map((x) => [x, true])) }) as Features;

describe("화면 틀 바로가기", () => {
  test("닫힌 틀과 키 꺼짐은 바로가기 0, 1단계 유틸 메뉴는 그대로", () => {
    expect(closedChrome().shortcuts).toEqual([]);
    const c = buildChrome([], new Map(), on("calc", "experts"));
    expect(c.shortcuts).toEqual([]);
    expect(c.utilities.map((u) => u.key)).toEqual(["calc", "experts"]);
  });
  test("키가 켜지면 열린 도착만, 상담 요청은 마지막", () => {
    const c = buildChrome([], new Map(), on("shortcuts", "calc", "expert_requests"), new Map(), null, { briefHref: null, weeklyOpen: false });
    expect(c.shortcuts.map((s) => s.key)).toEqual(["calc", "expert_request"]);
  });
  test("최신 호 주소와 설정 순서를 반영한다", () => {
    const c = buildChrome([], new Map(), on("shortcuts", "calc", "brief_regular"), new Map(), null, { briefHref: "/brief/2026-10-26", weeklyOpen: false }, ["brief_weekly", "calc", "realestate_weekly"]);
    expect(c.shortcuts.map((s) => [s.key, s.href])).toEqual([["brief_weekly", "/brief/2026-10-26"], ["calc", "/calc"]]);
  });
});
