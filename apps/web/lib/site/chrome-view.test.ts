// 공개 레이아웃 헤더·바닥글 값 (HOME-02 · HELP-05) — 화면 틀(buildChrome)의 결과를 넣어 본다
import { describe, expect, test } from "vitest";
import { buildChrome } from "@/lib/server/public/chrome-logic";
import { FEATURE_KEYS } from "@/lib/server/public/constants";
import { CLOSED_FEATURES } from "@/lib/server/public/settings";
import { FOOTER_DISCLAIMER, footerLinks, headerUtilityKeys, sectionOfPath } from "./chrome-view";

const allOpen = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as unknown as typeof CLOSED_FEATURES;

describe("헤더 유틸 메뉴 (HOME-02)", () => {
  test("기능 키가 모두 꺼져 있으면 유틸 메뉴 0", () => {
    expect(headerUtilityKeys(buildChrome([], new Map(), CLOSED_FEATURES).utilities)).toEqual([]);
  });

  test("켜진 기능만 — 검색 하나를 켜면 search 하나", () => {
    expect(headerUtilityKeys(buildChrome([], new Map(), { ...CLOSED_FEATURES, search: true }).utilities)).toEqual(["search"]);
  });

  test("모두 켜면 다섯 개 HOME-02 순서, 유틸 메뉴가 아닌 기능 키(SM 계산기 카드·정책 페이지 등)는 섞이지 않는다", () => {
    expect(headerUtilityKeys(buildChrome([], new Map(), allOpen).utilities)).toEqual(["calc", "experts", "store", "edu", "search"]);
  });

  test("모르는 키는 버린다", () => {
    expect(headerUtilityKeys([{ key: "taxbot", label: "지방세봇", href: "/taxbot" }])).toEqual([]);
  });
});

describe("바닥글 링크 (HELP-05)", () => {
  test("정책 페이지가 공개 승인 전이면 링크 0 (없는 화면으로 가는 링크 0)", () => {
    expect(footerLinks(buildChrome([], new Map(), CLOSED_FEATURES).policyLinks)).toEqual([]);
  });

  test("켜진 정책 페이지만 7종 순서로, 개인정보처리방침만 굵게", () => {
    const links = footerLinks(buildChrome([], new Map(), { ...CLOSED_FEATURES, page_privacy: true, page_about: true, page_help: true }).policyLinks);
    expect(links).toEqual([
      { label: "회사 소개", href: "/about" },
      { label: "개인정보처리방침", href: "/about/privacy", emphasis: true },
      { label: "고객센터", href: "/help/report" },
    ]);
  });

  test("면책 문구는 PRD-01A 3장 바닥글 문구 — 60자 이하 한 문장 (R8)", () => {
    expect(FOOTER_DISCLAIMER).toBe("이 사이트의 정보는 일반 정보이며 세무 자문이 아닙니다.");
    expect(FOOTER_DISCLAIMER.length).toBeLessThanOrEqual(60);
  });
});

describe("지금 보는 분야 (aria-current)", () => {
  test.each([
    ["/tax", "tax"],
    ["/tax/amendments", "tax"],
    ["/realestate/projects/abc", "realestate"],
    ["/finance?x=1", "finance"],
    ["/local/seoul#top", "local"],
  ] as const)("%s → %s", (path, key) => expect(sectionOfPath(path)).toBe(key));

  test.each(["/", "/news/tax-update", "/taxes", "/localnews", "/situations/car-sold", "", null, undefined])("%s → 분야 없음", (path) => {
    expect(sectionOfPath(path)).toBeUndefined();
  });
});
