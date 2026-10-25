import { licenseBadge } from "@/lib/admin/official-source-rules";

// 공통 검수 화면의 분야 데이터 후보 표시·버튼 규칙 (W10-h - PR-06 · LG-15 · DF-06). 순수 함수 (시험 review-ui.test.ts).
// 판정의 기준은 서버(DB 승인 검사·field_publish)이고, 화면은 같은 규칙으로 미리 버튼을 막을 뿐이다.

export const FIELD_TARGET_LABELS: Readonly<Record<string, string>> = {
  project_stage: "프로젝트 단계",
  supply_notice: "분양 정보",
  local_event: "행사안내",
  finance_indicator: "금융 통계 지표",
  finance_regulation: "금융 규제 항목",
  finance_case_entry: "금융 사례 DB",
};

/** 공개 본문 글자가 있는 대상 - DB field_body_text 와 같다 (제4유형 유사도 검사 대상) */
const BODY_TARGETS: readonly string[] = ["finance_indicator", "finance_case_entry"];

export interface FieldCandidateView {
  targetLabel: string;
  sourceItemId: string;
  koglType: string | null;
  koglLabel: string | null;
  changedFields: string[];
  rows: { name: string; value: string; changed: boolean }[];
  hasBody: boolean;
  /** 유형이 없으면 DB 가 승인을 거부한다 */
  typeMissing: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

export function fieldCandidateView(payload: Record<string, unknown>): FieldCandidateView | null {
  const target = typeof payload.target === "string" ? payload.target : null;
  const fields = payload.fields && typeof payload.fields === "object" && !Array.isArray(payload.fields) ? (payload.fields as Record<string, unknown>) : null;
  if (!target || !fields) return null;
  const changed = Array.isArray(payload.changed_fields) ? payload.changed_fields.filter((x): x is string => typeof x === "string") : [];
  const kogl = typeof payload.kogl_type === "string" ? payload.kogl_type : null;
  return {
    targetLabel: FIELD_TARGET_LABELS[target] ?? target,
    sourceItemId: typeof payload.source_item_id === "string" ? payload.source_item_id : "",
    koglType: kogl,
    koglLabel: licenseBadge(kogl),
    changedFields: changed,
    rows: Object.entries(fields).filter(([, v]) => v !== null && v !== undefined).map(([name, v]) => ({ name, value: str(v), changed: changed.includes(name) })),
    hasBody: BODY_TARGETS.includes(target),
    typeMissing: !kogl || kogl === "not_applicable" || licenseBadge(kogl) === null,
  };
}

export interface FieldActions {
  /** [제4유형 검사] - 승인된 제4유형 후보 중 공개 본문이 있는 것 */
  rightsCheck: boolean;
  /** [공개 반영] - 승인된 후보만 */
  publish: boolean;
}

export function fieldActions(status: string, view: Pick<FieldCandidateView, "koglType" | "hasBody">): FieldActions {
  const approved = status === "approved";
  return { rightsCheck: approved && view.koglType === "kogl_4" && view.hasBody, publish: approved };
}

const VERDICT_LABELS: Readonly<Record<string, string>> = {
  pass: "통과 - 원문 문장을 옮기지 않았습니다",
  blocked: "차단 - 원문 문장이 그대로 옮겨졌습니다. 편집자 요지로 다시 써야 합니다",
  no_sources: "원문 스냅샷이 비어 있어 통과로 볼 수 없습니다",
  no_body: "검사할 본문이 없습니다",
};

export function verdictText(status: string | null | undefined): string {
  return status ? (VERDICT_LABELS[status] ?? status) : VERDICT_LABELS.no_body!;
}

const ACTION_LABELS: Readonly<Record<string, string>> = { created: "새로 반영했습니다", updated: "갱신했습니다", corrected: "정정 기록으로 반영했습니다", unchanged: "이미 같은 값이 반영되어 있습니다", already_published: "이미 반영된 후보입니다" };

export function publishResultText(action: unknown): string {
  return typeof action === "string" ? (ACTION_LABELS[action] ?? action) : "반영했습니다";
}
