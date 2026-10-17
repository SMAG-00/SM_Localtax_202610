// 기사 기획(story_assignments) 입력 검사 — 순수 함수. 상태 전이 규칙(assigned 조건·published 전 fact_check·review)은 DB가 강제한다 (NAV-09).
import { REPORTING_METHODS, SECTIONS } from "@ltr/editorial";
import type { Result } from "./articles/content";
import { EDITORIAL_FIELDS } from "./articles/input";
import { parseFields, type FieldSpec } from "./articles/records-input";

export const ASSIGNMENT_STATUSES = ["idea", "assigned", "reporting", "fact_check", "review", "published", "held"] as const;

const SPEC: FieldSpec = [
  ["section", "section", SECTIONS],
  ["editorialField", "editorial_field", EDITORIAL_FIELDS],
  ["kind", "kind", ["general", "feature", "investigative"]],
  ["quarter", "quarter", "text"],
  ["regionCode", "region_code", "text"],
  ["hypothesis", "hypothesis", "text"],
  ["publicInterest", "public_interest", "text"],
  ["publicQuestion", "public_question", "text"],
  ["relevance", "relevance", "text"],
  ["subjectKind", "subject_kind", "text"],
  ["relationTypes", "relation_types", "texts"],
  ["method", "method", REPORTING_METHODS],
  ["reporterId", "reporter_id", "id"],
  ["editorId", "editor_id", "id"],
  ["plan", "plan", "text"],
  ["dueAt", "due_at", "instant"],
  ["conflicts", "conflicts", "text"],
  ["status", "status", ASSIGNMENT_STATUSES],
  ["reviewQueue", "review_queue", ["news", "held", "separate_product"]],
  ["rejectReason", "reject_reason", "text"],
];

export function parseAssignmentInput(raw: Record<string, unknown>, mode: "create" | "patch"): Result<Record<string, unknown>> {
  const errors: string[] = [];
  const columns = parseFields(raw, SPEC, "assignment", errors, mode === "create" ? ["section"] : []);
  if (typeof columns.quarter === "string" && !/^\d{4}Q[1-4]$/.test(columns.quarter)) errors.push("assignment.quarter: 2026Q4 같은 분기여야 합니다");
  if (mode === "patch" && Object.keys(columns).length === 0 && errors.length === 0) errors.push("assignment: 바꿀 칸이 없습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: columns };
}
