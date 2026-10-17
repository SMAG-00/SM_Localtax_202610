// 기사 기획 폼 시험 (NAV-09) — 폼 → POST/PATCH 본문, 마감일(한국 날짜) ↔ 시각, 상태 변경, 마감 달별 묶기
import { describe, expect, test } from "vitest";
import { parseAssignmentInput } from "@/lib/server/assignment-input";
import {
  EMPTY_ASSIGNMENT_FORM,
  assignmentFormFrom,
  assignmentPayload,
  groupByDueMonth,
  nextStatus,
  statusChangePayload,
  validateAssignment,
  type AssignmentForm,
  type AssignmentRow,
} from "./assignment-form";

const filled: AssignmentForm = {
  ...EMPTY_ASSIGNMENT_FORM,
  section: "local",
  hypothesis: "취득세 감소는 거래량 감소와 같이 움직였다",
  publicInterest: "세수 변화를 주민이 알아야 한다",
  relevance: "지방세 세수와 부동산 거래",
  method: "quantitative",
  reporterId: "5",
  editorId: "6",
  plan: "세목별 징수 실적 집계 → 세정과 확인",
  dueDate: "2026-10-30",
  conflicts: "없음",
};

const row = (over: Partial<AssignmentRow> = {}): AssignmentRow => ({
  id: 1,
  section: "local",
  kind: "general",
  editorial_field: null,
  region_code: null,
  hypothesis: filled.hypothesis,
  public_interest: filled.publicInterest,
  public_question: null,
  relevance: filled.relevance,
  method: "quantitative",
  reporter_id: 5,
  editor_id: 6,
  plan: filled.plan,
  due_at: "2026-10-30T14:59:59+00:00",
  conflicts: "없음",
  status: "idea",
  reject_reason: null,
  updated_at: "2026-10-17T00:00:00+00:00",
  ...over,
});

describe("등록 본문", () => {
  test("API 입력 검사(create)를 통과하고, 마감일은 그날 한국 시각 23:59:59", () => {
    const p = assignmentPayload(filled, "create");
    expect(parseAssignmentInput(p, "create").ok).toBe(true);
    expect(p).toMatchObject({ section: "local", reporterId: 5, editorId: 6, method: "quantitative", dueAt: "2026-10-30T23:59:59+09:00" });
  });

  test("빈 칸은 보내지 않는다", () => {
    const p = assignmentPayload({ ...EMPTY_ASSIGNMENT_FORM, section: "tax", hypothesis: "가설" }, "create");
    expect(p).toEqual({ section: "tax", kind: "general", hypothesis: "가설" });
  });
});

describe("수정 본문 — 바뀐 칸만, 지운 칸은 null", () => {
  test("담당 편집자·이해관계만 바꾸면 그 두 칸", () => {
    const original = assignmentFormFrom(row());
    const p = assignmentPayload({ ...original, editorId: "9", conflicts: "  " }, "patch", original);
    expect(p).toEqual({ editorId: 9, conflicts: null });
    expect(parseAssignmentInput(p, "patch").ok).toBe(true);
  });

  test("바뀐 칸이 없으면 빈 본문", () => {
    const original = assignmentFormFrom(row());
    expect(assignmentPayload(original, "patch", original)).toEqual({});
  });

  test("저장된 마감 시각 → 한국 날짜", () => {
    expect(assignmentFormFrom(row({ due_at: "2026-10-30T14:59:59+00:00" })).dueDate).toBe("2026-10-30");
    expect(assignmentFormFrom(row({ due_at: "2026-10-30T15:00:00+00:00" })).dueDate).toBe("2026-10-31");
    expect(assignmentFormFrom(row({ due_at: null })).dueDate).toBe("");
  });
});

describe("입력 확인", () => {
  test("분야·가설 필수, 마감일은 실제 날짜", () => {
    expect(validateAssignment(filled)).toEqual({});
    const e = validateAssignment({ ...EMPTY_ASSIGNMENT_FORM, dueDate: "2026-13-01" });
    expect(Object.keys(e).sort()).toEqual(["asg-due-date", "asg-hypothesis", "asg-section"]);
  });

  test("지역 코드가 있으면 편집 분야를 고르라고 알린다 (REG1-17)", () => {
    expect(validateAssignment({ ...filled, regionCode: "11680", editorialField: "" })["asg-editorial-field"]).toBeTruthy();
  });
});

describe("상태 변경", () => {
  test("다음 상태 제안 — idea → assigned → reporting → fact_check → review → published", () => {
    expect(["idea", "assigned", "reporting", "fact_check", "review"].map(nextStatus)).toEqual(["assigned", "reporting", "fact_check", "review", "published"]);
    expect(nextStatus("held")).toBe("idea");
  });

  test("보류는 반려 사유가 필요하다 (NAV-09 월간 점검)", () => {
    expect(statusChangePayload("held", " ")).toEqual({ ok: false, error: "보류에는 반려 사유가 필요합니다 (NAV-09 월간 점검)" });
    expect(statusChangePayload("held", "취재원 응답 없음")).toEqual({ ok: true, body: { status: "held", rejectReason: "취재원 응답 없음" } });
    expect(statusChangePayload("reporting", "")).toEqual({ ok: true, body: { status: "reporting" } });
  });

  test("7종 밖 상태는 보내지 않는다", () => {
    expect(statusChangePayload("done", "")).toEqual({ ok: false, error: "기획 상태를 골라 주세요" });
  });
});

describe("마감 달별 묶기 (기획 캘린더)", () => {
  test("한국 날짜 기준 달로 묶고, 달 순서 · 마감 없음은 맨 뒤", () => {
    const rows = [
      row({ id: 1, due_at: "2026-11-02T00:00:00+09:00" }),
      row({ id: 2, due_at: null }),
      row({ id: 3, due_at: "2026-10-31T15:30:00+00:00" }), // 한국 11월 1일
      row({ id: 4, due_at: "2026-10-05T00:00:00+09:00" }),
    ];
    const groups = groupByDueMonth(rows);
    expect(groups.map((g) => [g.label, g.items.map((r) => r.id)])).toEqual([
      ["2026년 10월", [4]],
      ["2026년 11월", [3, 1]],
      ["마감 없음", [2]],
    ]);
  });
});
