// 공통 검수 큐 규칙 (W10-c — PRD-02 REV-01~03). 화면과 API가 같은 규칙을 쓰고, 판정의 기준은 DB 함수(review_item_transition)다 — 여기는 입력 모양과 표시 라벨.
// 체크 키는 처리 과정의 라벨이다(법·세무 내용 아님). 필수 키 목록은 DB가 정하고 항목에 담겨 오므로 화면은 항목의 required_checks를 쓴다.

export const REVIEW_KINDS = ["law_change", "legal_doc", "link_error", "link_candidates", "amendment_stage", "field_data", "ai_draft", "pipeline_failure"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const KIND_LABELS: Record<ReviewKind, string> = {
  law_change: "법령 변경",
  legal_doc: "해석·결정례 문서",
  link_error: "링크 오류",
  link_candidates: "자동 링크 후보",
  amendment_stage: "개정 단계 변경 후보",
  field_data: "분야 데이터 후보",
  ai_draft: "운영 AI 초안",
  pipeline_failure: "수집 실패",
};

export const REVIEW_STATUSES = ["drafted", "in_review", "approved", "published", "rejected", "failed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  drafted: "초안",
  in_review: "검수 중",
  approved: "승인",
  published: "처리 완료",
  rejected: "반려",
  failed: "실패",
};

export const CHECK_LABELS: Record<string, string> = {
  original_compared: "원문과 후보를 나란히 비교했습니다",
  numbers_dates_links: "번호·일자·링크가 원문과 같습니다",
  no_personal_info: "개인정보·실명이 없습니다",
  promulgation_effective_match: "공포번호와 시행일자가 원문과 같습니다",
  rights_checked: "이용 권리를 확인했습니다",
  anonymity_checked: "비실명 처리를 확인했습니다",
  link_opened: "링크를 직접 열어 확인했습니다",
  targets_exist: "연결 대상이 실제로 있습니다",
  stage_matches_source: "단계가 근거 원문과 같습니다",
  terms_allowed: "원천 이용 조건이 허용입니다",
  no_unreviewed_claims: "검수하지 않은 주장이 없습니다",
  cause_noted: "실패 원인을 확인했습니다",
};

export const STALE_HOURS = 72;

/** 열린 항목 상태 — 72시간 경고 대상 (DB review_items_stale과 같은 기준: 머문 시간이 72시간을 넘으면 경고) */
export const OPEN_STATUSES: readonly ReviewStatus[] = ["drafted", "in_review", "approved", "failed"];

export function hoursOpen(statusChangedAt: string, now: Date): number {
  return (now.getTime() - new Date(statusChangedAt).getTime()) / 3_600_000;
}

export function isStale(status: ReviewStatus, statusChangedAt: string, now: Date): boolean {
  return OPEN_STATUSES.includes(status) && hoursOpen(statusChangedAt, now) > STALE_HOURS;
}

/** 지금 상태에서 화면이 보여 줄 수 있는 동작 (허용 전이 표의 화면 쪽 — 실제 판정은 DB) */
export function allowedTargets(status: ReviewStatus, attempts: number): readonly string[] {
  switch (status) {
    case "drafted":
      return ["in_review", "rejected"];
    case "in_review":
      return ["approved", "rejected"];
    case "approved":
      return ["published"];
    case "failed":
      return attempts < 3 ? ["retry"] : [];
    default:
      return [];
  }
}

/** [승인] 버튼이 열리는 조건 — 필수 체크를 모두 확인 (REV-01) */
export function canApprove(required: readonly string[], checked: readonly string[]): boolean {
  return required.every((k) => checked.includes(k));
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface TransitionInput {
  id: number;
  to: "in_review" | "approved" | "rejected" | "published" | "retry";
  reason: string | null;
  checked: string[];
  parts: string[] | null;
}

const TARGETS = ["in_review", "approved", "rejected", "published", "retry"] as const;
const strList = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string" && x.length <= 60) ? (v as string[]) : null);

export function parseTransition(body: Record<string, unknown>): Parsed<TransitionInput> {
  const errors: string[] = [];
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) errors.push("id: 검수 항목 번호가 필요합니다");
  const to = body.to as TransitionInput["to"];
  if (!TARGETS.includes(to)) errors.push(`to: ${TARGETS.join("·")} 중 하나입니다`);
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
  if (to === "rejected" && reason === null) errors.push("reason: 반려는 사유가 필요합니다");
  const checked = body.checked === undefined ? [] : strList(body.checked);
  if (checked === null) errors.push("checked: 문자열 목록이어야 합니다");
  const parts = body.parts === undefined || body.parts === null ? null : strList(body.parts);
  if (body.parts !== undefined && body.parts !== null && parts === null) errors.push("parts: 문자열 목록이어야 합니다");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { id, to, reason, checked: checked ?? [], parts } };
}

export function parseAssign(body: Record<string, unknown>): Parsed<{ id: number; assignee: string }> {
  const errors: string[] = [];
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) errors.push("id: 검수 항목 번호가 필요합니다");
  const assignee = typeof body.assignee === "string" ? body.assignee.trim() : "";
  if (!assignee || assignee.length > 80) errors.push("assignee: 담당자를 80자 안으로 적으세요");
  return errors.length ? { ok: false, errors } : { ok: true, value: { id, assignee } };
}

export const TERMS_STATUSES = ["unchecked", "allowed", "link_only", "denied"] as const;
export type TermsStatus = (typeof TERMS_STATUSES)[number];
export const TERMS_LABELS: Record<TermsStatus, string> = { unchecked: "미확인", allowed: "허용", link_only: "링크만", denied: "금지" };

export function parseSourceUpdate(body: Record<string, unknown>): Parsed<{ key: string; op: "terms" | "contract"; terms?: TermsStatus; note: string | null }> {
  const errors: string[] = [];
  const key = typeof body.key === "string" ? body.key : "";
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) errors.push("key: 원천 키 모양이 아닙니다");
  const op = body.op;
  if (op !== "terms" && op !== "contract") errors.push("op: terms·contract 중 하나입니다");
  const terms = body.terms as TermsStatus | undefined;
  if (op === "terms" && !(TERMS_STATUSES as readonly string[]).includes(String(terms))) errors.push("terms: unchecked·allowed·link_only·denied 중 하나입니다");
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  if (op === "terms" && terms === "allowed" && note === null) errors.push("note: 허용으로 바꿀 때는 근거(확인한 약관·문서 이름)를 적으세요");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { key, op: op as "terms" | "contract", ...(op === "terms" ? { terms } : {}), note } };
}
