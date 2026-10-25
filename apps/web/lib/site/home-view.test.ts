// 홈 화면 값 (HOME-01 · HOME-03 · PRD-01A 3장 홈 골격)
import { describe, expect, test } from "vitest";
import { HOME_SECTION_KEYS } from "@/lib/server/public/constants";
import { HERO_HIGHLIGHT_FALLBACK, SECTION_HEADINGS, heroHighlights, formatBadge, sectionTones, typeBadgeKind } from "./home-view";

describe("히어로 강조 낱말", () => {
  test("설정에 낱말이 있으면 그대로, 비어 있으면(아직 안 넣음) 기본값 '지방세' 하나", () => {
    expect(heroHighlights(["지방세", "부동산 세금", "재테크"])).toEqual(["지방세", "부동산 세금", "재테크"]);
    expect(heroHighlights([])).toEqual(HERO_HIGHLIGHT_FALLBACK);
    expect(HERO_HIGHLIGHT_FALLBACK).toEqual(["지방세"]);
  });
});

describe("섹션 바탕 — 보이는 순서대로 ivory ↔ ivory-dark", () => {
  test("모든 섹션이 보이면 바로가기부터 ivory, 다음 ivory-dark … (히어로는 세지 않는다)", () => {
    expect(sectionTones(HOME_SECTION_KEYS).map((t) => `${t.key}:${t.tone}`)).toEqual([
      "shortcuts:ivory",
      "fields:ivory-dark",
      "latest_reports:ivory",
      "weekly_hot:ivory-dark",
      "amendments:ivory",
      "column:ivory-dark",
      "product:ivory",
      "experts:ivory-dark",
    ]);
  });

  test("빠진 섹션은 건너뛰고 번갈아 — 금주 핫뉴스가 없으면 개정 트래커가 ivory", () => {
    expect(sectionTones(["hero", "fields", "latest_reports", "amendments"]).map((t) => t.tone)).toEqual(["ivory", "ivory-dark", "ivory"]);
  });

  test("히어로·4대 분야만 있는 빈 DB 홈 — 4대 분야 하나만 ivory", () => {
    expect(sectionTones(["hero", "fields"])).toEqual([{ key: "fields", tone: "ivory" }]);
    expect(sectionTones([])).toEqual([]);
  });
});

describe("배지 글자", () => {
  test.each([
    ["cardnews", "카드뉴스"],
    ["infographic", "인포그래픽"],
    ["video", "동영상"],
    ["photo", "포토"],
  ])("형식 %s → 형식 배지 %s", (format, label) => expect(formatBadge(format)).toBe(label));

  test.each(["general", "", null, undefined, "live"])("형식 %s → 형식 배지 0 (일반 기사에 배지 0)", (format) => expect(formatBadge(format)).toBeUndefined());

  test.each(["reported_news", "explainer", "guide", "opinion", "digest", "sponsored"])("기사 유형 %s → 같은 값의 배지", (t) => expect(typeBadgeKind(t)).toBe(t));

  test.each([null, undefined, "", "toString", "news"])("기사 유형 %s → 배지 0", (t) => expect(typeBadgeKind(t)).toBeUndefined());
});

describe("섹션 머리 글자", () => {
  test("히어로 밖 섹션 7개 모두 아이브로와 제목이 있다 — 제목은 PRD 화면 표의 섹션 이름", () => {
    expect(Object.keys(SECTION_HEADINGS)).toEqual(HOME_SECTION_KEYS.filter((k) => k !== "hero"));
    expect(SECTION_HEADINGS.latest_reports.title).toBe("최신 자체 취재");
    expect(SECTION_HEADINGS.amendments.title).toBe("개정 트래커 하이라이트");
  });
});
