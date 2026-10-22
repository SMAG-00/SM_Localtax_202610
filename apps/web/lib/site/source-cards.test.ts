// 기사 상세 출처 화면 값 (W4 5단계 — REG1-07 · REG1-09 · REG1-13 · PR-07). 시험용 가상 기관·가짜 주소만 쓴다
import { describe, expect, test } from "vitest";
import { LICENSE_TYPE_LABELS } from "@ltr/editorial";
import { UNDER_REVIEW_LABEL, officialCard, sourceCards, type SourceCardInput } from "./source-cards";

/** 칸이 모두 찬 공식 자료 — 시험용 가상구 */
const FULL: SourceCardInput = {
  id: 11,
  kind: "dataset",
  title: "시험용 가상구 지방세 세수 결산",
  source_url: "https://gasang.example/open/tax-2026",
  source_name: "시험용 가상구청",
  provider: "시험용 공공데이터 창구",
  last_verified_at: "2026-10-20T15:30:00+00:00",
  published_on: "2026-10-01",
  reference_date: "2026-06-30",
  license_type: "kogl_1",
  source_type: "local_tax_revenue",
  region_unit: "시·군·구",
};

describe("공식 자료 카드 (원문 블록)", () => {
  test("칸이 모두 찬 공식 자료 → 카드: 자료 종류 글자·발표기관·제공처·날짜·확인일(한국 날짜)·유형 배지 글자·원문 주소", () => {
    expect(officialCard(FULL)).toEqual({
      id: 11,
      typeLabel: "지방세 세수",
      title: "시험용 가상구 지방세 세수 결산",
      href: "https://gasang.example/open/tax-2026",
      issuer: "시험용 가상구청",
      provider: "시험용 공공데이터 창구",
      publishedOn: "2026-10-01",
      referenceDate: "2026-06-30",
      regionUnit: "시·군·구",
      verifiedOn: "2026-10-21",
      license: "공공누리 제1유형 (출처표시)",
      underReview: false,
    });
  });

  test("유형마다 배지 글자가 다르다 (PR-07 '유형별 출처 표시')", () => {
    const labels = (["kogl_1", "kogl_2", "kogl_3", "kogl_4", "unmarked", "not_applicable"] as const).map((t) => officialCard({ ...FULL, license_type: t })!.license);
    expect(labels).toEqual(Object.values(LICENSE_TYPE_LABELS));
    expect(new Set(labels).size).toBe(6);
  });

  test("원문 URL·발표기관·기준일·확인일·공공누리 유형 중 하나라도 비면 카드 0 (REG1-07 · REG1-13)", () => {
    for (const over of [
      { source_url: null },
      { source_url: "javascript:alert(1)" },
      { source_name: "  " },
      { reference_date: null },
      { last_verified_at: null },
      { last_verified_at: "어제" },
      { license_type: null },
      { license_type: "kogl_9" },
    ]) {
      expect(officialCard({ ...FULL, ...over }), JSON.stringify(over)).toBeNull();
    }
  });

  test("자료 종류가 비면 '공식 자료', 제공처가 발표기관과 같으면 제공처 0, 발표일·지역 단위는 있으면만", () => {
    const c = officialCard({ ...FULL, source_type: null, provider: "시험용 가상구청", published_on: null, region_unit: " " })!;
    expect(c).toMatchObject({ typeLabel: "공식 자료", provider: null, publishedOn: null, regionUnit: null });
  });

  test("공식 자료가 아닌 종류(보도자료·사진·인터뷰)는 카드가 아니다", () => {
    for (const kind of ["press_release", "photo", "interview", "field", "other"]) expect(officialCard({ ...FULL, kind })).toBeNull();
  });
});

describe("출처 화면 값 — 카드와 줄을 나눈다", () => {
  test("카드가 된 공식 자료는 줄에 없고, 나머지는 줄 — 공공누리 유형 글자를 함께, 이름 없는 출처 0", () => {
    const { official, lines } = sourceCards([
      FULL,
      { ...FULL, id: 12, kind: "press_release", title: "시험용 가상구 보도자료", source_type: null, license_type: "kogl_2" },
      // W4 전에 들어간 법령 인용 — 공식 자료 칸이 비어 카드가 아니라 이름 줄만
      { ...FULL, id: 13, kind: "official_doc", title: "시험용 법령 조문", reference_date: null, license_type: null, source_type: null },
      { ...FULL, id: 14, kind: "interview", title: null, source_name: null, source_url: null, license_type: null },
    ]);
    expect(official.map((c) => c.id)).toEqual([11]);
    expect(lines).toEqual([
      { id: 12, text: "시험용 가상구 보도자료", href: "https://gasang.example/open/tax-2026", issuer: "시험용 가상구청", license: "공공누리 제2유형 (출처표시·상업적 이용금지)", underReview: false },
      { id: 13, text: "시험용 법령 조문", href: "https://gasang.example/open/tax-2026", issuer: "시험용 가상구청", license: null, underReview: false },
    ]);
  });

  test("http(s)가 아닌 주소는 링크로 만들지 않는다, 제목이 없으면 발표기관 이름이 글자", () => {
    const { lines } = sourceCards([{ ...FULL, kind: "other", title: null, source_url: "ftp://x.example/a" }]);
    expect(lines).toEqual([{ id: 11, text: "시험용 가상구청", href: null, issuer: null, license: "공공누리 제1유형 (출처표시)", underReview: false }]);
  });
});

describe("검토 중 (W4 6단계 — REG1-13)", () => {
  test("열린 검수 항목이 있는 출처만 카드·줄에 검토 중 — 없는 출처는 false, 표시가 있어도 카드 조건은 그대로", () => {
    const { official, lines } = sourceCards([
      { ...FULL, under_review: true },
      { ...FULL, id: 15 },
      { ...FULL, id: 16, kind: "official_doc", title: "시험용 칸 빈 옛 자료", reference_date: null, under_review: true },
      { ...FULL, id: 17, reference_date: null, source_name: null, title: null, source_url: null, under_review: true },
    ]);
    expect(official.map((c) => [c.id, c.underReview])).toEqual([
      [11, true],
      [15, false],
    ]);
    expect(lines.map((l) => [l.id, l.underReview])).toEqual([[16, true]]);
    expect(UNDER_REVIEW_LABEL).toBe("검토 중");
  });
});
