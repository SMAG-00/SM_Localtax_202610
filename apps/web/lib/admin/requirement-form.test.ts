// 규정 버전 입력 화면의 폼 값 (NAV-13 — docs/dev/W2-c_설계.md 8.5)
//  · 폼 → API 본문: 빈 칸은 null, 고르지 않은 거르개 칸은 뺀다, 기준 숫자는 '기준 있음'을 고른 요건만
//  · 저장 전 검사는 API와 같은 함수(parseRequirementInput) — 오류 칸 경로 → 칸 id
//  · 저장된 버전 → 폼 → 본문 왕복이 같은 값 (고치기·'이 버전을 바탕으로 새 버전')
import { describe, expect, test } from "vitest";
import type { RequirementRow } from "@/lib/readiness/requirements";
import { emptyItemForm, emptyRequirementForm, errorFieldId, formFromRow, requirementFormToBody, type RequirementFormState } from "./requirement-form";

const filled = (): RequirementFormState => ({
  ...emptyRequirementForm(),
  platform: "naver",
  title: " 2026 뉴스 검색 제휴 규정 ",
  mediaType: "인터넷신문",
  sourceUrl: "https://example.test/rules/2026",
  sourceTextRef: "공유 드라이브 규정/2026",
  checkedAt: "2026-10-10",
  effectiveFrom: "2026-03-01",
  effectiveTo: "",
  reviewMonths: "3",
  reviewBasis: "closed_months",
  reviewText: "과거 1년 중 임의의 3개월",
  items: [
    {
      ...emptyItemForm(),
      key: "own_ratio",
      label: "자체 생산 기사 비율",
      metric: "ratio",
      numerator: { contentTypes: ["reported_news"], reportingMethods: [], assignmentKinds: [], includeLegacy: false },
      denominator: { contentTypes: [], reportingMethods: [], assignmentKinds: [], includeLegacy: false },
      numeratorText: "자체 취재 보도기사",
      denominatorText: "전체 발행 기사",
      exclusionsText: "금주 핫뉴스·칼럼",
      hasCriterion: true,
      comparator: "gte",
      value: "30",
      per: "period",
      sourceRef: "제3조",
    },
  ],
});

describe("requirementFormToBody", () => {
  test("다 채운 폼 → API 본문 (빈 칸 null · 고르지 않은 거르개 칸 뺌)", () => {
    const r = requirementFormToBody(filled(), "create", "req-new");
    expect(r).toEqual({
      ok: true,
      body: {
        platform: "naver",
        title: "2026 뉴스 검색 제휴 규정",
        mediaType: "인터넷신문",
        sourceUrl: "https://example.test/rules/2026",
        sourceTextRef: "공유 드라이브 규정/2026",
        checkedAt: "2026-10-10",
        effectiveFrom: "2026-03-01",
        effectiveTo: null,
        reviewPeriod: { months: 3, basis: "closed_months", text: "과거 1년 중 임의의 3개월" },
        note: null,
        items: [
          {
            key: "own_ratio",
            label: "자체 생산 기사 비율",
            metric: "ratio",
            numerator: { contentTypes: ["reported_news"] },
            denominator: {},
            numeratorText: "자체 취재 보도기사",
            denominatorText: "전체 발행 기사",
            exclusionsText: "금주 핫뉴스·칼럼",
            criterion: { comparator: "gte", value: 30, per: "period" },
            sourceRef: "제3조",
          },
        ],
      },
    });
  });

  test("빈 폼(새 버전) — 플랫폼·제목 칸 오류, 심사 기간은 모두 비우면 없음(null)", () => {
    expect(requirementFormToBody(emptyRequirementForm(), "create", "req-new")).toEqual({
      ok: false,
      errors: { "req-new-platform": "필요합니다", "req-new-title": "필요합니다" },
      messages: ["requirement.platform: 필요합니다", "requirement.title: 필요합니다"],
    });
  });

  test("기준을 고르고 숫자를 비우면 그 요건의 숫자 칸 오류 — API와 같은 문장", () => {
    const f = filled();
    f.items[0]!.value = "";
    const r = requirementFormToBody(f, "create", "req-new");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({ "req-new-items-0-criterion-value": "비율 기준은 0~100(%) 숫자여야 합니다" });
  });

  test("기사 수 요건은 분모 거르개·분모 글자를 보내지 않는다, 기준이 없으면 criterion null", () => {
    const f = filled();
    Object.assign(f.items[0]!, { metric: "count", hasCriterion: false, denominatorText: "남은 글자" });
    const r = requirementFormToBody(f, "create", "req-new");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = (r.body.items as Record<string, unknown>[])[0]!;
    expect(item.denominator).toBeUndefined();
    expect(item.denominatorText).toBeUndefined();
    expect(item.criterion).toBeNull();
  });

  test("고치기(patch)는 플랫폼을 보내지 않는다", () => {
    const r = requirementFormToBody(filled(), "patch", "req-3");
    expect(r.ok && "platform" in r.body).toBe(false);
  });
});

describe("errorFieldId — API 오류 칸 경로 → 폼 칸 id", () => {
  test.each([
    ["requirement.title", "b-title"],
    ["requirement.reviewPeriod.months", "b-reviewPeriod-months"],
    ["requirement.items[2].numerator.contentTypes", "b-items-2-numerator-contentTypes"],
    ["requirement.items", "b-items"],
    ["requirement", "b"],
  ])("%s → %s", (path, id) => {
    expect(errorFieldId(path, "b")).toBe(id);
  });
});

describe("formFromRow — 저장된 버전 → 폼 → 본문 왕복", () => {
  test("고치기·새 버전 바탕이 같은 값을 다시 보낸다", () => {
    const first = requirementFormToBody(filled(), "create", "x");
    if (!first.ok) throw new Error("견본 폼이 틀렸다");
    const row = {
      platform: "naver",
      title: first.body.title,
      media_type: first.body.mediaType,
      source_url: first.body.sourceUrl,
      source_text_ref: first.body.sourceTextRef,
      checked_at: first.body.checkedAt,
      effective_from: first.body.effectiveFrom,
      effective_to: null,
      review_period: first.body.reviewPeriod,
      requirements: first.body.items,
      note: null,
    } as unknown as RequirementRow;
    const again = requirementFormToBody(formFromRow(row), "create", "x");
    expect(again).toEqual(first);
  });
});
