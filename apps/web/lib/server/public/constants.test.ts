// 공개 사이트 공용 값이 설계 문서 2.3 표와 같다 (DB 시험 w2b-values·w2b-public-read가 같은 표를 읽는다) · 숨긴 경로 판정
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { FEATURE_KEYS, HOME_SECTION_KEYS, NEXT_ACTION_KEYS, POLICY_LINKS, PUBLIC_SETTING_KEYS, SECTION_INFO, UTILITY_LINKS, categoryHref, isBlockedPath } from "./constants";

const DESIGN = fs.readFileSync(path.resolve(__dirname, "../../../../../docs/dev/W2-b_설계.md"), "utf8");

/** 설계 문서 2.3 표의 한 줄 → 값 배열 */
function designList(name: string): string[] {
  const line = DESIGN.split("\n").find((l) => l.startsWith(`| ${name} `));
  if (!line) throw new Error(`설계 문서에 '${name}' 줄이 없다`);
  return [...line.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}

describe("설계 문서 2.3과 같은 목록", () => {
  test.each([
    ["settings.public_keys", PUBLIC_SETTING_KEYS],
    ["feature_flags", FEATURE_KEYS],
    ["next_action", NEXT_ACTION_KEYS],
    ["home_sections", HOME_SECTION_KEYS],
    ["policy_links", POLICY_LINKS.map((p) => p.key)],
  ] as const)("%s", (name, values) => {
    expect([...values]).toEqual(designList(name));
  });

  test("정책 링크마다 기능 키가 있고 그 키는 기능 목록에 있다 (공개 승인 전 링크 0 — HELP-05)", () => {
    for (const p of POLICY_LINKS) expect(FEATURE_KEYS).toContain(p.feature);
    expect(new Set(POLICY_LINKS.map((p) => p.href)).size).toBe(7);
  });

  test("유틸 메뉴 5개는 HOME-02 순서이고 모두 기능 키로 열고 닫는다", () => {
    expect(UTILITY_LINKS.map((u) => u.label)).toEqual(["계산기", "전문가 소개", "구독·도서", "교육", "검색"]);
    expect(UTILITY_LINKS.map((u) => u.href)).toEqual(["/calc", "/experts", "/store", "/edu", "/search"]);
    for (const u of UTILITY_LINKS) expect(FEATURE_KEYS).toContain(u.key);
  });

  test("4대 분야 이름·주소 (HOME-01·HOME-02)", () => {
    expect(Object.values(SECTION_INFO).map((s) => [s.name, s.href])).toEqual([
      ["지방세", "/tax"],
      ["부동산", "/realestate"],
      ["부동산개발금융", "/finance"],
      ["지자체뉴스", "/local"],
    ]);
  });
});

describe("숨긴 경로·v1.2 경로 (HOME-02 · MIG-02)", () => {
  test.each([
    "/calc/acquisition",
    "/calc/acquisition?x=1",
    "/law",
    "/law/123",
    "/cases",
    "/workspace",
    "/qna",
    "/library",
    "/region",
    "/region/seoul/seongdong",
    "/resources",
    "/authors/7",
    "/news/cards/abc",
    "/editorial-policy",
    "/corrections",
    "/advertise",
    "/terms",
    "/privacy",
    "/no-email-collection",
  ])("%s — 막는다", (href) => expect(isBlockedPath(href)).toBe(true));

  test.each(["/calc", "/news/law-update", "/local/seoul", "/about/privacy", "/about/corrections", "/tax/columns", "/lawyer", "/regions", "https://example.go.kr/law", "/"])(
    "%s — 막지 않는다",
    (href) => expect(isBlockedPath(href)).toBe(false),
  );

  test("하위 분야 주소 — 지자체뉴스는 허브로(01B 경로 전), 나머지는 /분야/하위 분야", () => {
    expect(categoryHref("tax", "amendments")).toBe("/tax/amendments");
    expect(categoryHref("realestate", "development-methods")).toBe("/realestate/development-methods");
    expect(categoryHref("local", "reporting")).toBe("/local");
  });
});
