// 편집국 화면 이름표 시험 — DB 값 목록(W2-a 설계 §2 = @ltr/editorial 상수 = DB check 제약)의 모든 값에 한국어 이름이 있는지.
// 이름이 빠지면 화면에 영문 값(raw)이 그대로 보이므로, 값 목록과 이름표를 양쪽으로 대조한다.
import { describe, expect, test } from "vitest";
import {
  CALLOUT_KINDS,
  CONTENT_TYPES,
  EVIDENCE_TYPES,
  FORMATS,
  LABELS,
  REPORTING_METHODS,
  REVIEW_DECISIONS,
  REVIEW_KINDS,
  SECTIONS,
  SOURCE_KINDS,
  UPDATE_KINDS,
  BLOCK_TYPES,
  QUOTE_CONSENTS,
  ANONYMITIES,
  TAX_LENS_LINK_KINDS,
} from "@ltr/editorial";
import { STAFF_ROLES } from "@/lib/access";
import { ASSIGNMENT_STATUSES } from "@/lib/server/assignment-input";
import { EDITORIAL_FIELDS } from "@/lib/server/articles/input";
import {
  ANONYMITY_LABELS,
  ARTICLE_STATUS_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  BLOCK_TYPE_LABELS,
  CALLOUT_KIND_LABELS,
  CONTENT_TYPE_LABELS,
  CORRECTION_KIND_LABELS,
  EDITORIAL_FIELD_LABELS,
  EVIDENCE_TYPE_LABELS,
  FORMAT_LABELS,
  LABEL_LABELS,
  QUOTE_CONSENT_LABELS,
  REPORTING_METHOD_LABELS,
  REVIEW_DECISION_LABELS,
  REVIEW_KIND_LABELS,
  ROLE_LABELS,
  SECTION_LABELS,
  SOURCE_KIND_LABELS,
  TAX_LENS_LINK_LABELS,
  UPDATE_KIND_LABELS,
  labelOf,
  optionsOf,
} from "./labels";

const keys = (o: object) => Object.keys(o).sort();
const sorted = (values: readonly string[]) => [...values].sort();

describe("이름표는 값 목록과 1:1이다 (빠진 값·없는 값 0)", () => {
  test.each([
    ["분야", SECTION_LABELS, SECTIONS],
    ["기사 유형", CONTENT_TYPE_LABELS, CONTENT_TYPES],
    ["취재 방식", REPORTING_METHOD_LABELS, REPORTING_METHODS],
    ["형식", FORMAT_LABELS, FORMATS],
    ["표기", LABEL_LABELS, LABELS],
    ["발행 뒤 수정 종류", UPDATE_KIND_LABELS, UPDATE_KINDS],
    ["출처 종류", SOURCE_KIND_LABELS, SOURCE_KINDS],
    ["근거 유형", EVIDENCE_TYPE_LABELS, EVIDENCE_TYPES],
    ["검토 종류", REVIEW_KIND_LABELS, REVIEW_KINDS],
    ["검토 결정", REVIEW_DECISION_LABELS, REVIEW_DECISIONS],
    ["블록 종류", BLOCK_TYPE_LABELS, BLOCK_TYPES],
    ["콜아웃 종류", CALLOUT_KIND_LABELS, CALLOUT_KINDS],
    ["인용 동의", QUOTE_CONSENT_LABELS, QUOTE_CONSENTS],
    ["익명 여부", ANONYMITY_LABELS, ANONYMITIES],
    ["박스 링크 종류", TAX_LENS_LINK_LABELS, TAX_LENS_LINK_KINDS],
    ["서비스 역할", ROLE_LABELS, STAFF_ROLES],
    ["기획 상태", ASSIGNMENT_STATUS_LABELS, ASSIGNMENT_STATUSES],
    ["편집 분야", EDITORIAL_FIELD_LABELS, EDITORIAL_FIELDS],
  ] as const)("%s", (_name, labels, values) => {
    expect(keys(labels)).toEqual(sorted(values));
    for (const v of values) expect((labels as Record<string, string>)[v]?.trim().length).toBeGreaterThan(0);
  });

  test("기사 게재 상태 7종 · 정정 종류 5종 (W2-a 설계 §2)", () => {
    expect(keys(ARTICLE_STATUS_LABELS)).toEqual(sorted(["draft", "in_review", "approved", "scheduled", "published", "held", "deleted"]));
    expect(keys(CORRECTION_KIND_LABELS)).toEqual(sorted(["correction", "rebuttal", "follow_up", "deletion", "title_change"]));
  });

  test("편집국 외 역할의 이름은 '편집'을 쓰지 않는다 — 편집 권한이 있는 것처럼 보이지 않게", () => {
    for (const role of ["ad_ops", "store_ops", "brand_ops", "expert_ops"] as const) expect(ROLE_LABELS[role]).not.toContain("편집");
  });
});

describe("labelOf · optionsOf", () => {
  test("모르는 값은 값 그대로, null은 '없음'", () => {
    expect(labelOf(SECTION_LABELS, "tax")).toBe("지방세");
    expect(labelOf(SECTION_LABELS, "unknown-x")).toBe("unknown-x");
    expect(labelOf(SECTION_LABELS, null)).toBe("없음");
  });

  test("선택지는 이름표 순서대로, 고른 값만 남길 수 있다", () => {
    expect(optionsOf(REPORTING_METHOD_LABELS)).toEqual([
      { value: "quantitative", label: "정량형" },
      { value: "qualitative", label: "정성형" },
      { value: "mixed", label: "혼합형" },
    ]);
    expect(optionsOf(LABEL_LABELS, ["co_planned", "ad"]).map((o) => o.value)).toEqual(["co_planned", "ad"]);
  });
});
