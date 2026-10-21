// 지역 화면 값 — 기사 범위(시·도 = 자기 + 하위, 시·군·구 = 자기) · 빈 지역 noindex + 상위 지역 안내 · 이동 줄 = BreadcrumbList · 시·군·구 바꾸기
// (docs/dev/W4_설계.md 1장 3단계 · 12장 #26, PRD-01B REG1-01 · REG1-12). 시험용 지역은 접두 99 가짜 코드다 (설계 8장)
import { describe, expect, test } from "vitest";
import { breadcrumbList, compareRendered, validate } from "@ltr/structured-data";
import type { RegionRouteRow } from "@/lib/site/region-route";
import type { ArticleListItem } from "./cards";
import { breadcrumbView, emptyGuide, regionArticleCodes, regionPage, sigunguOptions } from "./region-logic";

const TODAY = "2026-10-22";
const SITE = "https://news.example";
const r = (code: string, slug: string, name: string, over: Partial<RegionRouteRow> = {}): RegionRouteRow => {
  const sido = /^[0-9]{2}0{8}$/.test(code);
  return { code, parent_code: sido ? null : `${code.slice(0, 2)}00000000`, level: sido ? "sido" : "sigungu", name, slug, valid_from: null, valid_to: null, ...over };
};
const SIDO = r("9900000000", "gasang", "시험용 가상도");
const GU_B = r("9902100000", "bin-gu", "시험용 빈구");
const GU_A = r("9901100000", "gadeuk-gu", "시험용 가득구");
const GONE = r("9903100000", "yet-gu", "시험용 옛구", { valid_to: "2026-10-21" });
const SOON = r("9904100000", "nae-gu", "시험용 내일구", { valid_from: "2026-10-23" });
const OTHER = r("9800000000", "dareun", "시험용 다른도");
const OTHER_GU = r("9801100000", "dareun-gu", "시험용 다른구");
const REGIONS = [SIDO, GU_B, GU_A, GONE, SOON, OTHER, OTHER_GU];
const item = (id: number) => ({ id, title: `시험용 기사 ${id}` }) as unknown as ArticleListItem;

describe("기사 범위 (12장 #26)", () => {
  test("시·도 = 자기 + 하위 시·군·구(폐지·시작 전 하위 포함), 다른 시·도 하위 0", () => {
    expect(regionArticleCodes(SIDO, REGIONS)).toEqual(["9900000000", "9901100000", "9902100000", "9903100000", "9904100000"]);
  });
  test("시·군·구 = 자기 태그만", () => {
    expect(regionArticleCodes(GU_A, REGIONS)).toEqual(["9901100000"]);
  });
});

describe("시·군·구 바꾸기", () => {
  test("같은 시·도의 오늘 유효한 시·군·구만, 코드 순 — 폐지·시작 전·다른 시·도 0", () => {
    expect(sigunguOptions(SIDO, REGIONS, TODAY)).toEqual([
      { name: "시험용 가득구", href: "/local/gasang/gadeuk-gu" },
      { name: "시험용 빈구", href: "/local/gasang/bin-gu" },
    ]);
    expect(sigunguOptions(r("1100000000", "seoul", "서울특별시"), REGIONS, TODAY)).toEqual([]);
  });
});

describe("빈 지역 — 200 + noindex + 상위 지역 안내 (REG1-01 · REG1-12)", () => {
  test("시·군·구 0건 → noindex · 상위 시·도 소식 링크 + 지자체뉴스 전체 · 기사 0", () => {
    const p = regionPage({ sido: SIDO, sigungu: GU_B, regions: REGIONS, articles: [], total: 0, today: TODAY, siteUrl: SITE });
    expect(p).toMatchObject({ level: "sigungu", code: "9902100000", fullName: "시험용 가상도 시험용 빈구", href: "/local/gasang/bin-gu", empty: true, noindex: true, total: 0, articles: [] });
    expect(p.guide).toEqual({
      text: "시험용 가상도 시험용 빈구에는 아직 공개된 기사가 없습니다. 상위 지역 시험용 가상도 소식을 보세요.",
      links: [
        { label: "시험용 가상도 소식 보기", href: "/local/gasang" },
        { label: "지자체뉴스 전체 보기", href: "/local" },
      ],
    });
  });

  test("시·도 0건 → noindex · 지자체뉴스 전체 링크 하나", () => {
    const p = regionPage({ sido: SIDO, sigungu: null, regions: REGIONS, articles: [], total: 0, today: TODAY, siteUrl: SITE });
    expect(p).toMatchObject({ level: "sido", code: "9900000000", fullName: "시험용 가상도", noindex: true });
    expect(p.guide?.links).toEqual([{ label: "지자체뉴스 전체 보기", href: "/local" }]);
    expect(emptyGuide(p.sido, null, p.fullName).text).toBe("시험용 가상도에는 아직 공개된 기사가 없습니다. 지자체뉴스 전체에서 다른 지역 소식을 보세요.");
  });

  test("기사가 있으면 색인 대상(noindex 0) · 안내 0 · 기사 그대로", () => {
    const p = regionPage({ sido: SIDO, sigungu: GU_A, regions: REGIONS, articles: [item(1), item(2)], total: 2, today: TODAY, siteUrl: SITE });
    expect(p).toMatchObject({ empty: false, noindex: false, guide: null, total: 2 });
    expect(p.articles.map((a) => a.id)).toEqual([1, 2]);
  });

  test("수는 있는데 목록이 비면(쪽 넘김 끝 등) 빈 지역으로 본다 — 빈 목록 껍데기 0", () => {
    const p = regionPage({ sido: SIDO, sigungu: GU_A, regions: REGIONS, articles: [], total: 3, today: TODAY, siteUrl: SITE });
    expect(p).toMatchObject({ empty: true, noindex: true, total: 0 });
  });
});

describe("이동 줄 = BreadcrumbList (홈 > 지자체뉴스 > 시·도 > 시·군·구)", () => {
  test("시·군·구 — 네 칸, 마지막이 지금 화면 · 구조화 데이터 주소는 사이트 절대 주소", () => {
    const p = regionPage({ sido: SIDO, sigungu: GU_A, regions: REGIONS, articles: [item(1)], total: 1, today: TODAY, siteUrl: SITE });
    expect(p.crumbs.map((c) => [c.name, c.href, c.current])).toEqual([
      ["홈", "/", false],
      ["지자체뉴스", "/local", false],
      ["시험용 가상도", "/local/gasang", false],
      ["시험용 가득구", "/local/gasang/gadeuk-gu", true],
    ]);
    expect(p.breadcrumb).toEqual({
      items: [
        { name: "홈", url: "https://news.example/" },
        { name: "지자체뉴스", url: "https://news.example/local" },
        { name: "시험용 가상도", url: "https://news.example/local/gasang" },
        { name: "시험용 가득구", url: "https://news.example/local/gasang/gadeuk-gu" },
      ],
    });
    // 화면 이동 줄(글자 + 화면 주소를 사이트 주소로 푼 값)과 생성기가 만든 BreadcrumbList가 같다
    const shown = p.crumbs.map((c) => ({ name: c.name, url: new URL(c.href, SITE).href }));
    expect(compareRendered({ breadcrumb: shown }, [breadcrumbList(p.breadcrumb!)])).toEqual([]);
    // 구조화 데이터 검사기 — 필수 속성·차례 번호·마지막이 아닌 항목의 주소
    expect(validate([breadcrumbList(p.breadcrumb!)])).toEqual([]);
  });

  test("시·도 — 세 칸, 시·도가 지금 화면", () => {
    const p = regionPage({ sido: SIDO, sigungu: null, regions: REGIONS, articles: [], total: 0, today: TODAY, siteUrl: SITE });
    expect(p.crumbs.map((c) => [c.name, c.current])).toEqual([
      ["홈", false],
      ["지자체뉴스", false],
      ["시험용 가상도", true],
    ]);
  });

  test("사이트 주소가 없으면 구조화 데이터를 내지 않는다 (틀린 주소 0)", () => {
    expect(regionPage({ sido: SIDO, sigungu: null, regions: REGIONS, articles: [], total: 0, today: TODAY, siteUrl: undefined }).breadcrumb).toBeNull();
    expect(breadcrumbView([{ name: "홈", href: "/", current: false }], undefined)).toBeNull();
  });
});
