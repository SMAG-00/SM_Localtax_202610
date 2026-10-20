// 공개 사이트 공용 값이 설계 문서 2.3 표와 같다 (DB 시험 w2b-values·w2b-public-read가 같은 표를 읽는다) · 숨긴 경로 판정
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  FEATURE_KEYS,
  HOME_SECTION_KEYS,
  NEXT_ACTION_KEYS,
  POLICY_LINKS,
  PUBLIC_SETTING_KEYS,
  SECTION_INFO,
  UTILITY_LINKS,
  categoryHref,
  glossaryAnchor,
  glossaryIndexHref,
  glossaryTermHref,
  isBlockedPath,
  isOpenPath,
  type FeatureKey,
  type Features,
} from "./constants";

const DOCS = path.resolve(__dirname, "../../../../../docs");
const DESIGN = fs.readFileSync(path.join(DOCS, "dev", "W2-b_설계.md"), "utf8");
const PRD_00 = fs.readFileSync(path.join(DOCS, "PRD", "PRD-00_공통기반.md"), "utf8");

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
    "/academy",
    "/authors/7",
    "/pricing",
    "/ask",
    "/ask/session-1",
    "/realestate/trust",
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

  test("PRD-00 8장 'v1.2 경로 대체'의 옛 주소는 모두 막는다 (새 주소는 막지 않는다)", () => {
    const line = PRD_00.split("\n").find((l) => l.includes("**v1.2 경로 대체**"));
    if (!line) throw new Error("PRD-00에 'v1.2 경로 대체' 줄이 없다");
    const pairs = line.slice(line.indexOf("—") + 1, line.indexOf("새 플랫폼이")).split(/,\s*/);
    const ticks = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.replace(/\/(\*|\[[^\]]+\])$/, "/x"));
    const old = pairs.flatMap((p) => ticks(p.split("→")[0]!));
    const fresh = pairs.flatMap((p) => ticks(p.split("→")[1] ?? ""));
    expect(old.length).toBeGreaterThanOrEqual(12);
    for (const href of old) expect(isBlockedPath(href), href).toBe(true);
    for (const href of fresh) expect(isBlockedPath(href), href).toBe(false);
  });

  test("하위 분야 주소 — 지자체뉴스는 허브로(01B 경로 전), 나머지는 /분야/하위 분야", () => {
    expect(categoryHref("tax", "amendments")).toBe("/tax/amendments");
    expect(categoryHref("realestate", "development-methods")).toBe("/realestate/development-methods");
    expect(categoryHref("local", "reporting")).toBe("/local");
  });
});

describe("열린 화면 판정 isOpenPath (HOME-02 빈 링크 0 · HELP-05 · 설계 7장 '만들지 않는 경로')", () => {
  const features = (on: FeatureKey[] = []): Features => Object.fromEntries(FEATURE_KEYS.map((k) => [k, on.includes(k)])) as Features;
  const off = features();

  test.each(["/", "/tax", "/tax/interpretations", "/tax/amendments", "/tax/columns", "/local", "/local?topic=local_tax", "/news", "/news/some-article", "/news?section=tax", "/situations/car-sold", "/people/kim", "/finance/cases", "/news/popular", "/news/photo", "/news/photo?page=2", "/partners/12"])(
    "%s — 기능이 모두 꺼져도 열린 화면",
    (href) => expect(isOpenPath(href, off)).toBe(true),
  );

  test.each(["/calc", "/calc?x=1", "/experts", "/experts?field=tax", "/store/books/a", "/edu", "/search?q=취득세", "/about", "/about/editorial-policy", "/help/report", "/tax/amendments/2026-reform", "/local/seoul", "/local/seoul/jongno"])(
    "%s — 기능이 꺼지면 닫힌 화면",
    (href) => expect(isOpenPath(href, off)).toBe(false),
  );

  test("설계 7장 '만들지 않는 경로'는 기능이 모두 꺼지면 모두 닫힘 (그 화면이 생길 때까지 링크 0)", () => {
    const line = DESIGN.split("\n").find((l) => l.startsWith("만들지 않는 경로(다른 작업)"));
    if (!line) throw new Error("설계 문서에 '만들지 않는 경로' 줄이 없다");
    const paths = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.replace(/\(.*\)$/, "").replace(/\/(\*|\[[^\]]+\])/g, "/x"));
    expect(paths.length).toBeGreaterThanOrEqual(13);
    for (const href of paths) expect(isOpenPath(href, off), href).toBe(false);
  });

  test.each([
    ["/my", "members"],
    ["/signup", "members"],
    ["/about/terms", "page_terms"],
    ["/about/no-email-collection", "page_no_email"],
    ["/about/advertise", "page_advertise"],
  ] as const)("%s — 기능 키 %s가 켜져야만 열림 (W2-e 4단계)", (href, key) => {
    expect(isOpenPath(href, features([key]))).toBe(true);
    expect(isOpenPath(href, features(FEATURE_KEYS.filter((k) => k !== key)))).toBe(false);
  });

  test.each(["/brief", "/brief/confirm", "/brief/unsubscribe"])("%s — 기능 키 brief가 켜져야만 열림 (W2-e 6단계)", (href) => {
    expect(isOpenPath(href, features(["brief"]))).toBe(true);
    expect(isOpenPath(href, features(FEATURE_KEYS.filter((k) => k !== "brief")))).toBe(false);
  });

  test.each(["/local/events", "/help/faq"])(
    "%s — 아직 없는 화면은 기능을 모두 켜도 닫힘",
    (href) => expect(isOpenPath(href, features([...FEATURE_KEYS]))).toBe(false),
  );

  test("동영상 목록(/news/video)은 기능 키 video_list가 켜졌을 때만 열린다 — 동영상 채널 결정 전에는 링크 0 (PRD-01A 1.3)", () => {
    for (const href of ["/news/video", "/news/video?page=2"]) {
      expect(isOpenPath(href, off), href).toBe(false);
      expect(isOpenPath(href, features(["video_list"])), href).toBe(true);
    }
    // 다른 기능을 모두 켜도 video_list가 꺼져 있으면 닫힘
    expect(isOpenPath("/news/video", features(FEATURE_KEYS.filter((k) => k !== "video_list")))).toBe(false);
  });

  test("용어사전(/glossary · /glossary/[번호])은 기능 키 glossary가 켜졌을 때만 열린다 — 공개 승인 전에는 링크 0 (W2-d 3단계)", () => {
    for (const href of ["/glossary", "/glossary?section=tax", "/glossary/12", "/glossary#term-12"]) {
      expect(isOpenPath(href, off), href).toBe(false);
      expect(isOpenPath(href, features(["glossary"])), href).toBe(true);
    }
    expect(isOpenPath("/glossary/12", features(FEATURE_KEYS.filter((k) => k !== "glossary")))).toBe(false);
    // 비슷한 이름의 다른 주소는 이 기능과 상관없다
    expect(isOpenPath("/glossary-old", off)).toBe(true);
  });

  test("용어사전 주소 — 색인(분야 거르개)·용어 쪽·색인의 용어 자리", () => {
    expect(glossaryIndexHref(null)).toBe("/glossary");
    expect(glossaryIndexHref("finance")).toBe("/glossary?section=finance");
    expect(glossaryTermHref(12)).toBe("/glossary/12");
    expect(glossaryAnchor(12)).toBe("term-12");
  });

  test("기능을 켜면 그 화면만 열린다 — 계산기·편집 원칙·트래커 상세·지자체 허브", () => {
    const on = features(["calc", "page_editorial_policy", "amendments", "region_hubs"]);
    for (const href of ["/calc", "/about/editorial-policy", "/tax/amendments/2026-reform", "/local/seoul"]) expect(isOpenPath(href, on), href).toBe(true);
    for (const href of ["/experts", "/about", "/about/privacy", "/help/report"]) expect(isOpenPath(href, on), href).toBe(false);
  });

  test("숨긴·v1.2 경로는 기능을 켜도 닫힘, 바깥 주소는 판정 대상이 아니다", () => {
    const all = features([...FEATURE_KEYS]);
    for (const href of ["/calc/acquisition", "/region/seoul", "/pricing", "/ask"]) expect(isOpenPath(href, all), href).toBe(false);
    expect(isOpenPath("https://www.law.go.kr/법령/지방세법", off)).toBe(true);
  });
});
