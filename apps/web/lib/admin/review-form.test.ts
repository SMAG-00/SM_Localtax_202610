// 검토 결정 폼 시험 (NAV-03 · NAV-10 · NAV-12) — 편집 승인·세무 감수 결정 → POST reviews 본문, 본인 기사 승인 막기
import { describe, expect, test } from "vitest";
import type { StaffRole, Viewer } from "@/lib/access";
import { deskChecksFor, ownArticleNote, reviewKindsFor, reviewPayload, TAX_CHECKS } from "./review-form";

const viewer = (roles: StaffRole[], isAdmin = false): Viewer => ({ userId: "u-1", email: "s@example.test", isAdmin, roles });
const allChecked = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, true]));

describe("확인 항목", () => {
  test("편집 승인 — 원자료·핵심 주장·제목·이미지 권리, 정량형·혼합형만 '인과 단정 없음'", () => {
    expect(deskChecksFor("qualitative").map((c) => c.id)).toEqual(["sourcesChecked", "claimsChecked", "titleChecked", "imagesChecked"]);
    expect(deskChecksFor("quantitative").map((c) => c.id)).toEqual(["sourcesChecked", "claimsChecked", "titleChecked", "imagesChecked", "noCausalClaim"]);
    expect(deskChecksFor("mixed").map((c) => c.id)).toContain("noCausalClaim");
    expect(deskChecksFor(null).map((c) => c.id)).not.toContain("noCausalClaim");
  });
});

describe("결정 본문", () => {
  test("편집 승인 — 확인 항목을 모두 체크해야 하고, checklist에 noCausalClaim:true가 들어간다 (NAV-10)", () => {
    const ids = deskChecksFor("quantitative").map((c) => c.id);
    const r = reviewPayload({ kind: "desk_edit", decision: "approve", reason: "", checks: allChecked(ids) }, "quantitative");
    expect(r).toEqual({ ok: true, body: { kind: "desk_edit", decision: "approve", checklist: allChecked(ids) } });
  });

  test("편집 승인 — 하나라도 빠지면 거부, 오류는 확인 항목 칸", () => {
    const r = reviewPayload({ kind: "desk_edit", decision: "approve", reason: "", checks: { sourcesChecked: true } }, "quantitative");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["review-desk_edit-checks"]).toMatch(/모두/);
  });

  test("반려·보류는 사유가 필요하고, 확인 항목은 필요 없다", () => {
    const noReason = reviewPayload({ kind: "desk_edit", decision: "reject", reason: " ", checks: {} }, "qualitative");
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.errors["review-desk_edit-reason"]).toBeTruthy();
    expect(reviewPayload({ kind: "desk_edit", decision: "hold", reason: "관계자 확인 뒤 다시", checks: {} }, "qualitative")).toEqual({
      ok: true,
      body: { kind: "desk_edit", decision: "hold", reason: "관계자 확인 뒤 다시", checklist: {} },
    });
  });

  test("결정을 고르지 않으면 거부", () => {
    const r = reviewPayload({ kind: "tax_review", decision: "", reason: "", checks: {} }, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["review-tax_review-decision"]).toBeTruthy();
  });

  test("세무 감수 승인 — 감수 확인 항목", () => {
    const ids = TAX_CHECKS.map((c) => c.id);
    expect(reviewPayload({ kind: "tax_review", decision: "approve", reason: "", checks: allChecked(ids) }, null)).toEqual({
      ok: true,
      body: { kind: "tax_review", decision: "approve", checklist: allChecked(ids) },
    });
  });

  test("해당 없는 확인 항목은 보내지 않는다 — 정성형 승인에 noCausalClaim 없음", () => {
    const ids = deskChecksFor("qualitative").map((c) => c.id);
    const r = reviewPayload({ kind: "desk_edit", decision: "approve", reason: "", checks: { ...allChecked(ids), noCausalClaim: true, extra: true } }, "qualitative");
    expect(r.ok && (r.body.checklist as Record<string, boolean>)).toEqual(allChecked(ids));
  });
});

describe("누가 무엇을 검토하나", () => {
  test.each([
    ["편집 책임자", viewer(["editor"]), ["desk_edit"]],
    ["세무 감수위원", viewer(["reviewer"]), ["tax_review"]],
    ["편집 책임자 + 세무 감수위원", viewer(["editor", "reviewer"]), ["desk_edit", "tax_review"]],
    ["기자", viewer(["reporter"]), []],
    ["광고 담당", viewer(["ad_ops"]), []],
    ["관리자(역할 없음)", viewer([], true), []],
  ])("%s", (_n, v, expected) => {
    expect(reviewKindsFor(v)).toEqual(expected);
  });

  test("본인 기사 — 편집 승인 대상에서 막고 이유를 보인다 (NAV-12)", () => {
    expect(ownArticleNote(7, 7)).toBe("본인 기사 — 다른 편집자가 승인합니다 (NAV-12)");
    expect(ownArticleNote(7, 8)).toBeNull();
    expect(ownArticleNote(null, 8)).toBeNull();
  });
});
