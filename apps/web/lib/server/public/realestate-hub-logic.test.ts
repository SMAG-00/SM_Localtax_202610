import { describe, expect, test } from "vitest";
import type { RegionRouteRow } from "@/lib/site/region-route";
import type { ProjectCard } from "./project-logic";
import type { SupplyCard } from "./supply-logic";
import { HUB_LINK_COPY, hubLinkCards, hubSupplyBlock, landmarkCards, regionChips } from "./realestate-hub-logic";

// 가짜 코드 접두 99 — 실제 지명 0 (설계 8장)
const row = (code: string, level: "sido" | "sigungu", name: string, slug: string, over: Partial<RegionRouteRow> = {}): RegionRouteRow => ({
  code,
  parent_code: level === "sigungu" ? `${code.slice(0, 2)}00000000` : null,
  level,
  name,
  slug,
  valid_from: null,
  valid_to: null,
  ...over,
});
const REGIONS = [
  row("9900000000", "sido", "시험용 가도", "gado"),
  row("9901100000", "sigungu", "시험용 나구", "nagu"),
  row("9800000000", "sido", "시험용 나도", "nado"),
  row("9700000000", "sido", "시험용 폐지도", "pyeji", { valid_to: "2026-01-01" }),
];
const TODAY = "2026-10-23";

describe("regionChips — 지역 칩 (PR-01)", () => {
  test("시·도는 오늘 유효한 것만 코드 순, 모든 칩 주소가 지역 허브 ③ 앵커(#realestate)", () => {
    const { sido, pilot } = regionChips(REGIONS, [], TODAY, true);
    expect(sido.map((c) => [c.code, c.label, c.href])).toEqual([
      ["9800000000", "시험용 나도", "/local/nado#realestate"],
      ["9900000000", "시험용 가도", "/local/gado#realestate"],
    ]);
    expect(pilot).toEqual([]);
  });

  test("시범 시·군·구 칩은 '시·도 시·군·구' 글자와 시·군·구 주소, 시범 시·도 칩은 시·도 주소", () => {
    const { pilot } = regionChips(REGIONS, ["9901100000", "9800000000"], TODAY, true);
    expect(pilot).toEqual([
      { code: "9901100000", label: "시험용 가도 시험용 나구", href: "/local/gado/nagu#realestate", kind: "pilot" },
      { code: "9800000000", label: "시험용 나도", href: "/local/nado#realestate", kind: "pilot" },
    ]);
  });

  test("지역 허브가 꺼지면 칩 0 (404 링크 0) — 시범 지역이 있어도", () => {
    expect(regionChips(REGIONS, ["9900000000"], TODAY, false)).toEqual({ pilot: [], sido: [] });
  });

  test("없는 코드·폐지 코드·중복 시범 지역은 칩이 되지 않고, 폐지 시·도는 시·도 칩에서 빠진다", () => {
    const { pilot, sido } = regionChips(REGIONS, ["9999900000", "9700000000", "9900000000", "9900000000"], TODAY, true);
    expect(pilot.map((c) => c.code)).toEqual(["9900000000"]);
    expect(sido.map((c) => c.code)).not.toContain("9700000000");
  });

  test("폐지일 당일까지는 유효 — 다음 날부터 빠진다 (한국 날짜)", () => {
    expect(regionChips(REGIONS, [], "2026-01-01", true).sido.map((c) => c.code)).toContain("9700000000");
    expect(regionChips(REGIONS, [], "2026-01-02", true).sido.map((c) => c.code)).not.toContain("9700000000");
  });
});

describe("hubLinkCards — 닫힌 기능 카드 0", () => {
  test("둘 다 닫히면 0장", () => {
    expect(hubLinkCards({ devMethods: null, inheritanceOpen: false })).toEqual([]);
  });

  test("개발방법만 열리면 그 카드 하나 — 주소·세무 감수일", () => {
    const cards = hubLinkCards({ devMethods: { reviewedOn: "2026-10-20" }, inheritanceOpen: false });
    expect(cards).toEqual([{ key: "dev_methods", ...HUB_LINK_COPY.dev_methods, href: "/realestate/development-methods", meta: "세무 감수 2026-10-20" }]);
  });

  test("상속·증여만 열리면 그 카드 하나, 둘 다 열리면 개발방법 → 상속·증여 차례", () => {
    expect(hubLinkCards({ devMethods: null, inheritanceOpen: true }).map((c) => c.key)).toEqual(["inheritance_gift"]);
    expect(hubLinkCards({ devMethods: { reviewedOn: "2026-10-20" }, inheritanceOpen: true }).map((c) => c.href)).toEqual(["/realestate/development-methods", "/realestate/inheritance-gift"]);
  });

  test("고정 문구에 숫자·세율·기한·추천·순위 낱말이 없다", () => {
    for (const c of Object.values(HUB_LINK_COPY)) {
      expect(`${c.title} ${c.description}`).not.toMatch(/[0-9]|세율|기한|공제|추천|순위|유리|수익/);
    }
  });
});

const project = (id: number, landmark: boolean): ProjectCard =>
  ({ id, slug: `p-${id}`, name: `시험용 프로젝트 ${id}`, href: `/realestate/projects/p-${id}`, summary: null, landmark }) as ProjectCard;
const supply = (id: number): SupplyCard => ({ id, name: `시험용 분양 ${id}` }) as SupplyCard;

describe("landmarkCards · hubSupplyBlock", () => {
  test("대표(랜드마크)만, 입력 차례 그대로, 최대 limit장 + 전체 목록 주소", () => {
    const r = landmarkCards([project(1, true), project(2, false), project(3, true), project(4, true)], 2);
    expect(r.cards.map((c) => c.id)).toEqual([1, 3]);
    expect(r.all).toBe("/realestate/projects");
  });

  test("대표 프로젝트가 없으면 0장·전체 보기 링크도 0", () => {
    expect(landmarkCards([project(1, false)], 4)).toEqual({ cards: [], all: null });
  });

  test("분양 정보는 최대 limit장 + 전체 목록 주소, 0건이면 링크도 0", () => {
    expect(hubSupplyBlock([1, 2, 3, 4, 5].map(supply), 4)).toMatchObject({ all: "/realestate/supply", cards: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] });
    expect(hubSupplyBlock([], 4)).toEqual({ cards: [], all: null });
  });
});
