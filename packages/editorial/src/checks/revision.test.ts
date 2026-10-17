// ART-05 수정 표시 — 수정 종류와 사유 없이 저장 불가, 오탈자는 dateModified를 바꾸지 않는다 (OPT-07)
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { evaluatePublish } from "../evaluate";
import type { ArticleForPublish } from "../model";
import { changesDateModified, validateRevisionForSave } from "./revision";

describe("validateRevisionForSave", () => {
  it("수정 종류와 사유가 있으면 저장된다", () => {
    expect(validateRevisionForSave({ updateKind: "substantive", reason: "2026년 개정 세율 반영" })).toEqual({ ok: true, findings: [] });
  });

  it("수정 종류를 고르지 않으면 저장 불가", () => {
    expect(validateRevisionForSave({ updateKind: null, reason: "표 숫자 수정" })).toEqual({
      ok: false,
      findings: [
        {
          id: "art05.update-kind-required",
          level: "block",
          ruleRef: "ART-05",
          message: "수정 종류(실질 수정·오탈자·정정)를 골라 주세요",
        },
      ],
    });
  });

  it("값 목록 밖의 수정 종류도 고르지 않은 것과 같다", () => {
    expect(uniqueIds(validateRevisionForSave({ updateKind: "minor", reason: "표 숫자 수정" }).findings)).toEqual([
      "art05.update-kind-required",
    ]);
  });

  it.each([
    ["빈 글자", ""],
    ["공백만", "   "],
    ["없음", null],
  ])("수정 사유가 %s이면 저장 불가", (_name, reason) => {
    const result = validateRevisionForSave({ updateKind: "typo", reason });
    expect(result.ok).toBe(false);
    expect(uniqueIds(result.findings)).toEqual(["art05.reason-required"]);
  });

  it("둘 다 없으면 두 항목 모두", () => {
    expect(uniqueIds(validateRevisionForSave({ updateKind: null, reason: null }).findings)).toEqual([
      "art05.update-kind-required",
      "art05.reason-required",
    ]);
  });
});

describe("수정 종류와 dateModified (OPT-07)", () => {
  it.each([
    ["substantive", true],
    ["correction", true],
    ["typo", false],
  ] as const)("%s → 실질 수정일을 바꾼다: %s", (kind, expected) => {
    expect(changesDateModified(kind)).toBe(expected);
  });
});

describe("발행된 기사를 고쳐 다시 발행할 때", () => {
  const published: ArticleForPublish = { ...TAX_EXPLAINER, firstPublishedAt: "2026-10-15T09:00:00+09:00" };

  it("수정 종류·사유가 없으면 발행 불가", () => {
    expect(uniqueIds(evaluatePublish(published, BASE_CONTEXT).blockers)).toEqual(["art05.update-kind-required", "art05.reason-required"]);
  });

  it("수정 종류·사유가 있으면 발행된다", () => {
    const revised = { ...published, updateKind: "correction" as const, updatedReason: "신고 기간 기산일 설명 정정" };
    expect(evaluatePublish(revised, BASE_CONTEXT).canPublish).toBe(true);
  });

  it("처음 발행하는 기사에는 수정 사유를 요구하지 않는다", () => {
    expect(TAX_EXPLAINER.firstPublishedAt).toBeNull();
    expect(evaluatePublish(TAX_EXPLAINER, BASE_CONTEXT).canPublish).toBe(true);
  });
});
