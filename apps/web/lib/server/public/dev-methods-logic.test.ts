// 개발방법 비교 공개 규칙 시험 (W4 19단계). 견본 글·숫자는 전부 시험용 가짜 값이다 — 실제 방법 내용·숫자 요건 아님.
import { describe, expect, test } from "vitest";
import { DEV_METHOD_ITEMS, DEV_METHOD_SLUGS } from "@/lib/admin/dev-method-rules";
import type { Features } from "./constants";
import {
  comparisonMethods,
  devMethodBreadcrumb,
  devMethodCrumbs,
  isMethodSlug,
  methodLens,
  projectTypeKeys,
  publicMethods,
  reviewLine,
  specialLawView,
  type PublicCompareRow,
  type PublicFactRow,
  type PublicMethodRow,
} from "./dev-methods-logic";

const method = (slug: string, over: Partial<PublicMethodRow> = {}): PublicMethodRow => ({
  slug,
  name: `시험용 ${slug}`,
  kind: slug === "rapid-planning" ? "planning_support" : "project_type",
  sort: DEV_METHOD_SLUGS.indexOf(slug as never) + 1,
  legal_basis_name: `시험용 법령 ${slug}`,
  summary: `시험용 설명 ${slug}`,
  steps: ["시험 단계 가", "시험 단계 나"],
  lens: null,
  reviewed_at: "2026-10-20T03:00:00Z",
  reviewer_name: "시험 감수위원",
  ...over,
});
const compareOf = (slug: string): PublicCompareRow[] =>
  DEV_METHOD_ITEMS.map((item, i) => ({ slug, sort: 1, item, item_position: i + 1, body: `시험용 ${slug} ${item}`, reviewed_at: "2026-10-20T03:00:00Z", reviewer_name: "시험 감수위원" }));
const fact = (slug: string, key: string, over: Partial<PublicFactRow> = {}): PublicFactRow => ({
  slug,
  sort: 1,
  fact_key: key,
  label: `시험 요건 ${key}`,
  value: "1",
  unit: "단위",
  law_ref: "시험법 제1조",
  reference_date: "2026-10-01",
  source_url: "https://example.test/law",
  version: 1,
  reviewed_at: "2026-10-20T03:00:00Z",
  reviewer_name: "시험 감수위원",
  under_review: false,
  ...over,
});
const all = (): { m: PublicMethodRow[]; c: PublicCompareRow[]; f: PublicFactRow[] } => ({
  m: [...DEV_METHOD_SLUGS].reverse().map((s) => method(s)),
  c: DEV_METHOD_SLUGS.flatMap((s) => compareOf(s)),
  f: DEV_METHOD_SLUGS.map((s) => fact(s, "alpha")),
});

describe("공개 방법 목록", () => {
  test("DB가 준 순서와 상관없이 고정 편집 순서 7개, 비교 항목은 2.1의 6칸 순서", () => {
    const { m, c, f } = all();
    const out = publicMethods(m, c.reverse(), f);
    expect(out.map((x) => x.slug)).toEqual([...DEV_METHOD_SLUGS]);
    expect(out[0]!.compare.map((i) => i.item)).toEqual([...DEV_METHOD_ITEMS]);
    expect(out[0]!.compare.map((i) => i.label)).toEqual(["근거 법령", "사업 주체", "대상", "주요 절차", "숫자 요건", "지방세 쟁점"]);
  });

  test("비교 항목이 하나라도 빈 방법은 열째 빠진다 ('확인 중' 채움 0)", () => {
    const { m, c, f } = all();
    const out = publicMethods(m, c.filter((x) => !(x.slug === "trust" && x.item === "target")), f);
    expect(out.map((x) => x.slug)).not.toContain("trust");
    expect(out).toHaveLength(6);
  });

  test("서명자 이름·서명일·설명·절차 단계 중 하나가 없는 방법은 빠진다", () => {
    const { c, f } = all();
    for (const over of [{ reviewer_name: null }, { reviewed_at: null }, { summary: " " }, { steps: [] }, { steps: null }, { kind: "x" }] as Partial<PublicMethodRow>[]) {
      expect(publicMethods([method("public", over)], c, f)).toEqual([]);
    }
  });

  test("모르는 slug와 같은 slug 두 줄은 한 번만", () => {
    const { c, f } = all();
    const out = publicMethods([method("unknown-method"), method("public"), method("public", { summary: "다른 설명" })], c, f);
    expect(out.map((x) => x.slug)).toEqual(["public"]);
    expect(out[0]!.summary).toBe("시험용 설명 public");
  });

  test("기준일·감수자·근거 조문·원문 주소가 없는 사실 행은 그리지 않고, 같은 열쇠는 한 번만 열쇠 순으로", () => {
    const { m, c } = all();
    const f = [
      fact("public", "zeta"),
      fact("public", "alpha"),
      fact("public", "alpha", { label: "겹침" }),
      fact("public", "no_date", { reference_date: null }),
      fact("public", "bad_date", { reference_date: "2026-13-40x" }),
      fact("public", "no_reviewer", { reviewer_name: null }),
      fact("public", "no_law", { law_ref: "" }),
      fact("public", "no_url", { source_url: null }),
    ];
    const out = publicMethods(m, c, f).find((x) => x.slug === "public")!;
    expect(out.facts.map((x) => x.key)).toEqual(["alpha", "zeta"]);
    expect(out.facts[0]!.label).toBe("시험 요건 alpha");
  });
});

describe("비교표 입력", () => {
  test("방법 열쇠는 @ltr/ui 열쇠로, 6칸·사실 행·상세 주소가 그대로", () => {
    const { m, c, f } = all();
    const entries = comparisonMethods(publicMethods(m, c, f));
    expect(Object.keys(entries).sort()).toEqual(["public", "reconstruction", "redevelopment", "renewal", "small_scale", "speed_integrated", "trust"]);
    const e = entries.small_scale!;
    expect(e.law).toBe("시험용 small-scale legal_basis");
    expect(e.operator).toBe("시험용 small-scale actor");
    expect(e.target).toBe("시험용 small-scale target");
    expect(e.procedure).toBe("시험용 small-scale procedure");
    expect(e.factsNote).toBe("시험용 small-scale numeric_requirements");
    expect(e.taxIssue).toBe("시험용 small-scale tax_issues");
    expect(e.href).toBe("/realestate/development-methods/small-scale");
    expect(e.facts).toEqual([{ label: "시험 요건 alpha", value: "1", unit: "단위", article: "시험법 제1조", basisDate: "2026-10-01", reviewer: "시험 감수위원" }]);
    expect(entries.speed_integrated!.href).toBe("/realestate/development-methods/rapid-planning");
  });

  test("원문 검토 중인 요건은 이름 옆에 그 사실을 적고, 단위가 비면 빈 글자", () => {
    const { m, c } = all();
    const out = publicMethods(m, c, [fact("public", "alpha", { under_review: true, unit: null })]);
    expect(comparisonMethods(out).public!.facts).toEqual([expect.objectContaining({ label: "시험 요건 alpha (원문 검토 중)", unit: "" })]);
  });

  test("점수·순위·추천을 뜻하는 값이 항목에 없다", () => {
    const { m, c, f } = all();
    const json = JSON.stringify(comparisonMethods(publicMethods(m, c, f)));
    expect(json).not.toMatch(/score|rank|rating|recommend|점수|순위|추천/);
  });
});

describe("감수 줄·박스·관련 프로젝트 키", () => {
  test("감수 줄은 이름 겹침 0, 가장 이른 서명일(한국 날짜)", () => {
    const { c, f } = all();
    const out = publicMethods([method("public", { reviewed_at: "2026-10-22T16:00:00Z" }), method("trust", { reviewer_name: "다른 위원", reviewed_at: "2026-10-20T03:00:00Z" }), method("renewal")], c, f);
    expect(reviewLine(out)).toEqual({ reviewers: ["시험 감수위원", "다른 위원"], reviewedOn: "2026-10-20" });
    expect(reviewLine([])).toBeNull();
  });

  test("「지방세로 읽기」 박스는 16단계 규칙 — 세액 표현이 있거나 링크가 없으면 박스 0", () => {
    const { c, f } = all();
    const features = { store: false, expert_finder: false } as unknown as Features;
    const lens = (over: Record<string, unknown>) => ({ topics: ["취득세"], points: ["시험 포인트"], links: [{ kind: "explainer", url: "/tax/guide" }], base_date: "2026-10-01", ...over });
    const get = (l: unknown) => methodLens(publicMethods([method("public", { lens: l })], c, f)[0]!, features);
    expect(get(null)).toBeNull();
    expect(get(lens({ points: ["취득세 1,000원 납부"] }))).toBeNull();
    expect(get(lens({ links: [] }))).toBeNull();
    expect(get(lens({ base_date: null }))).toBeNull();
  });

  test("사업 유형 방법만 프로젝트 유형 키가 있다 (신속통합기획은 0, 줄표는 밑줄로도)", () => {
    expect(projectTypeKeys({ slug: "small-scale", kind: "project_type" })).toEqual(["small-scale", "small_scale"]);
    expect(projectTypeKeys({ slug: "public", kind: "project_type" })).toEqual(["public"]);
    expect(projectTypeKeys({ slug: "rapid-planning", kind: "planning_support" })).toEqual([]);
  });

  test("주소 모양과 이동 줄", () => {
    expect(isMethodSlug("trust")).toBe(true);
    expect(isMethodSlug("Trust")).toBe(false);
    expect(isMethodSlug("../x")).toBe(false);
    const crumbs = devMethodCrumbs({ name: "시험", href: "/realestate/development-methods/trust" });
    expect(crumbs.map((c) => c.name)).toEqual(["홈", "부동산", "개발방법 비교", "시험"]);
    expect(devMethodBreadcrumb(crumbs, undefined)).toBeNull();
    expect(devMethodBreadcrumb(crumbs, "https://x.test")!.items[2]).toEqual({ name: "개발방법 비교", url: "https://x.test/realestate/development-methods" });
  });
});

describe("특례법 근거 표시 (PR-13 — 확인 전 요소 0)", () => {
  const LAW = [{ promulgation_url: "https://gasang.example/law", promulgated_on: "2026-01-02" }];
  const methods = (): ReturnType<typeof publicMethods> => {
    const { m, c, f } = all();
    return publicMethods(m, c, f);
  };
  test("공포 확인 줄이 없으면 표시된 행이 있어도 null이다", () => {
    const { c, f } = all();
    const flagged = c.map((x) => ({ ...x, special_law_basis: true }));
    expect(specialLawView([], methods(), flagged, f)).toBeNull();
  });
  test("뷰가 true로 준 행이 없으면 공포 확인이 있어도 null이다 (행 확인 전)", () => {
    const { c, f } = all();
    expect(specialLawView(LAW, methods(), c.map((x) => ({ ...x, special_law_basis: false })), f.map((x) => ({ ...x, special_law_basis: null })))).toBeNull();
  });
  test("true인 비교 항목·사실 행만 방법 이름과 항목 이름으로 모이고 only로 한 방법만 거른다", () => {
    const { c, f } = all();
    const flaggedC = c.map((x) => ({ ...x, special_law_basis: x.slug === "trust" && x.item === DEV_METHOD_ITEMS[0] }));
    const flaggedF = f.map((x) => ({ ...x, special_law_basis: x.slug === "public" }));
    const v = specialLawView(LAW, methods(), flaggedC, flaggedF)!;
    expect(v.promulgationUrl).toBe("https://gasang.example/law");
    expect(v.promulgatedOn).toBe("2026-01-02");
    expect(v.items.map((i) => i.slug).sort()).toEqual(["public", "trust"]);
    expect(specialLawView(LAW, methods(), flaggedC, flaggedF, "trust")!.items).toHaveLength(1);
    expect(specialLawView(LAW, methods(), flaggedC, flaggedF, "renewal")).toBeNull();
  });
  test("공포 원문 주소나 공포일이 비어 있으면 null이다", () => {
    const { c, f } = all();
    const flagged = c.map((x) => ({ ...x, special_law_basis: true }));
    expect(specialLawView([{ promulgation_url: null, promulgated_on: "2026-01-02" }], methods(), flagged, f)).toBeNull();
    expect(specialLawView([{ promulgation_url: "https://gasang.example/law", promulgated_on: null }], methods(), flagged, f)).toBeNull();
  });
});
