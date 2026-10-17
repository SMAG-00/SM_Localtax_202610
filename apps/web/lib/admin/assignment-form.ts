// 기사 기획 캘린더 폼 (NAV-09) — 폼 ↔ story_assignments 행 ↔ POST/PATCH 본문. 순수 함수 (시험: assignment-form.test.ts)
// 상태 전이 규칙(assigned 조건·published 전 fact_check·review)은 DB가 강제한다 — 화면은 거부 문장(409)을 그대로 보여 준다.
import { SECTIONS } from "@ltr/editorial";
import { blank, idOrNull, isValidDate, isoToKstDate, kstDateToIso, type FieldErrors } from "./form-utils";
import { ASSIGNMENT_STATUS_LABELS } from "./labels";

/** story_assignments 행 (화면이 쓰는 칸) */
export interface AssignmentRow {
  id: number;
  section: string;
  kind: string;
  editorial_field: string | null;
  region_code: string | null;
  hypothesis: string | null;
  public_interest: string | null;
  public_question: string | null;
  relevance: string | null;
  method: string | null;
  reporter_id: number | null;
  editor_id: number | null;
  plan: string | null;
  due_at: string | null;
  conflicts: string | null;
  status: string;
  reject_reason: string | null;
  updated_at: string;
}

export interface AssignmentForm {
  section: string;
  kind: string;
  editorialField: string;
  regionCode: string;
  hypothesis: string;
  publicInterest: string;
  publicQuestion: string;
  relevance: string;
  method: string;
  reporterId: string;
  editorId: string;
  plan: string;
  /** 마감 — 한국 날짜 YYYY-MM-DD */
  dueDate: string;
  conflicts: string;
}

export const EMPTY_ASSIGNMENT_FORM: AssignmentForm = {
  section: "",
  kind: "general",
  editorialField: "",
  regionCode: "",
  hypothesis: "",
  publicInterest: "",
  publicQuestion: "",
  relevance: "",
  method: "",
  reporterId: "",
  editorId: "",
  plan: "",
  dueDate: "",
  conflicts: "",
};

const s = (v: string | null | undefined) => v ?? "";

export function assignmentFormFrom(r: AssignmentRow): AssignmentForm {
  return {
    section: r.section,
    kind: r.kind,
    editorialField: s(r.editorial_field),
    regionCode: s(r.region_code),
    hypothesis: s(r.hypothesis),
    publicInterest: s(r.public_interest),
    publicQuestion: s(r.public_question),
    relevance: s(r.relevance),
    method: s(r.method),
    reporterId: r.reporter_id === null ? "" : String(r.reporter_id),
    editorId: r.editor_id === null ? "" : String(r.editor_id),
    plan: s(r.plan),
    dueDate: isoToKstDate(r.due_at),
    conflicts: s(r.conflicts),
  };
}

/** 폼 칸 → API 칸 (값 바꾸기) */
const FIELDS: readonly [keyof AssignmentForm, string, (v: string) => unknown][] = [
  ["section", "section", (v) => v],
  ["kind", "kind", (v) => v],
  ["editorialField", "editorialField", (v) => v],
  ["regionCode", "regionCode", (v) => v.trim()],
  ["hypothesis", "hypothesis", (v) => v.trim()],
  ["publicInterest", "publicInterest", (v) => v.trim()],
  ["publicQuestion", "publicQuestion", (v) => v.trim()],
  ["relevance", "relevance", (v) => v.trim()],
  ["method", "method", (v) => v],
  ["reporterId", "reporterId", (v) => idOrNull(v)],
  ["editorId", "editorId", (v) => idOrNull(v)],
  ["plan", "plan", (v) => v.trim()],
  // 마감일은 그날 끝(한국 시각 23:59:59)으로 둔다
  ["dueDate", "dueAt", (v) => kstDateToIso(v.trim(), "23:59:59")],
  ["conflicts", "conflicts", (v) => v.trim()],
];

/** 등록(create) — 빈 칸은 빼고 보낸다. 수정(patch) — 원래 값과 다른 칸만, 지운 칸은 null */
export function assignmentPayload(form: AssignmentForm, mode: "create" | "patch", original?: AssignmentForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, api, convert] of FIELDS) {
    const value = form[key];
    if (mode === "create") {
      if (!blank(value)) out[api] = convert(value);
      continue;
    }
    if (original && value.trim() === original[key].trim()) continue;
    out[api] = blank(value) ? null : convert(value);
  }
  return out;
}

export function validateAssignment(form: AssignmentForm): FieldErrors {
  const e: FieldErrors = {};
  if (!(SECTIONS as readonly string[]).includes(form.section)) e["asg-section"] = "분야를 골라 주세요";
  if (blank(form.hypothesis)) e["asg-hypothesis"] = "기사 가설을 적어 주세요";
  if (!blank(form.dueDate) && !isValidDate(form.dueDate.trim())) e["asg-due-date"] = "마감일은 YYYY-MM-DD 날짜로 적어 주세요";
  if (!blank(form.regionCode) && blank(form.editorialField)) e["asg-editorial-field"] = "지역 태그가 있는 기획은 편집 분야를 골라야 배정할 수 있습니다 (REG1-17)";
  return e;
}

const FLOW: Record<string, string> = {
  idea: "assigned",
  assigned: "reporting",
  reporting: "fact_check",
  fact_check: "review",
  review: "published",
  published: "published",
  held: "idea",
};

/** 다음 상태 제안 — 상태 변경 선택 목록의 처음 값 */
export function nextStatus(status: string): string {
  return FLOW[status] ?? "idea";
}

export function statusChangePayload(status: string, rejectReason: string): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (!Object.hasOwn(ASSIGNMENT_STATUS_LABELS, status)) return { ok: false, error: "기획 상태를 골라 주세요" };
  if (status === "held") {
    if (blank(rejectReason)) return { ok: false, error: "보류에는 반려 사유가 필요합니다 (NAV-09 월간 점검)" };
    return { ok: true, body: { status, rejectReason: rejectReason.trim() } };
  }
  return { ok: true, body: { status } };
}

/** 기획 캘린더 — 마감 달(한국 날짜)별로 묶는다. 달 순서, 같은 달은 마감 순서, 마감 없음은 맨 뒤 */
export function groupByDueMonth<T extends { due_at: string | null }>(rows: readonly T[]): { key: string; label: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  const sorted = [...rows].sort((a, b) => {
    if (a.due_at === null || b.due_at === null) return a.due_at === b.due_at ? 0 : a.due_at === null ? 1 : -1;
    return Date.parse(a.due_at) - Date.parse(b.due_at);
  });
  for (const r of sorted) {
    const date = isoToKstDate(r.due_at);
    const key = date ? date.slice(0, 7) : "none";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "none" ? 1 : b === "none" ? -1 : a.localeCompare(b)))
    .map(([key, items]) => ({ key, label: key === "none" ? "마감 없음" : `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월`, items }));
}
