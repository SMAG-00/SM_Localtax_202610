// ② 확인 한 버튼 (2026-10-31 PO 결정) — [감수하고 발행]·[승인하고 발행]·[본인 발행]이 이미 있는 API를 차례로 부른다.
//  세무 감수 승인(필요할 때만) → 편집 승인 → 발행. 첫 실패에서 멈추고 서버의 한국어 문장을 그대로 보인다.
//  판정은 서버가 한다 — 여기서는 요청 순서·본문만 만든다 (시험: confirm-publish.test.ts)
import { apiErrorDetails, apiErrorMessage, type ApiResult } from "./api-client";
import type { ConfirmPlan } from "./publish-steps";

export type ConfirmStepKind = "tax_review" | "desk_edit" | "publish";

export interface ConfirmRequest {
  kind: ConfirmStepKind;
  /** 화면에 보이는 이름 */
  label: string;
  path: string;
  body: Record<string, unknown> | undefined;
  /** 성공 상태 — 검토 기록 201, 발행 200 */
  okStatus: number;
}

export const CONFIRM_STEP_LABELS: Record<ConfirmStepKind, string> = { tax_review: "세무 감수", desk_edit: "편집 승인", publish: "발행" };

/** 계획 → 보낼 요청 목록 (순서 = 보내는 순서) */
export function confirmRequests(plan: ConfirmPlan): ConfirmRequest[] {
  const reviews = `/api/admin/articles/${plan.articleId}/reviews`;
  const all = (items: readonly { id: string }[]) => Object.fromEntries(items.map((c) => [c.id, true]));
  const out: ConfirmRequest[] = [];
  if (plan.tax) {
    out.push({ kind: "tax_review", label: CONFIRM_STEP_LABELS.tax_review, path: reviews, body: { kind: "tax_review", decision: "approve", checklist: all(plan.taxChecks) }, okStatus: 201 });
  }
  if (plan.desk) {
    const checklist = plan.mode === "self" ? { ...all(plan.deskChecks), selfPublish: true } : all(plan.deskChecks);
    out.push({ kind: "desk_edit", label: CONFIRM_STEP_LABELS.desk_edit, path: reviews, body: { kind: "desk_edit", decision: "approve", checklist }, okStatus: 201 });
  }
  out.push({ kind: "publish", label: CONFIRM_STEP_LABELS.publish, path: `/api/admin/articles/${plan.articleId}/publish`, body: undefined, okStatus: 200 });
  return out;
}

/** 계획의 확인 항목을 모두 체크했는가 — 버튼은 이때만 켜진다 */
export function allConfirmChecked(plan: ConfirmPlan, checked: Readonly<Record<string, boolean>>): boolean {
  return [...plan.taxChecks.map((c) => `tax.${c.id}`), ...plan.deskChecks.map((c) => `desk.${c.id}`)].every((k) => checked[k] === true);
}

export type ConfirmResult =
  | { ok: true; done: ConfirmStepKind[]; warnings: number }
  | { ok: false; done: ConfirmStepKind[]; failedAt: ConfirmStepKind; title: string; details: string[] };

export type ApiCall = (method: "POST", path: string, body?: unknown) => Promise<ApiResult>;

/** 요청을 차례로 보낸다 — 첫 실패에서 멈추고, 그 앞에서 끝난 것(done)과 서버 문장을 돌려준다 */
export async function runConfirmPublish(plan: ConfirmPlan, call: ApiCall): Promise<ConfirmResult> {
  const done: ConfirmStepKind[] = [];
  let warnings = 0;
  for (const req of confirmRequests(plan)) {
    const r = await call("POST", req.path, req.body);
    if (r.status !== req.okStatus) {
      return { ok: false, done, failedAt: req.kind, title: `${req.label}에서 멈췄습니다 — ${apiErrorMessage(r)}`, details: apiErrorDetails(r) };
    }
    if (req.kind === "publish" && Array.isArray(r.body.warnings)) warnings = r.body.warnings.length;
    done.push(req.kind);
  }
  return { ok: true, done, warnings };
}

/** 실패했을 때 앞 단계가 기록됐다는 안내 — 없으면 null */
export function doneNote(done: readonly ConfirmStepKind[]): string | null {
  if (done.length === 0) return null;
  // 조사 — 마지막 이름이 '감수'(받침 없음)면 '는', '승인'·'발행'(받침 있음)이면 '은'
  const particle = done[done.length - 1] === "tax_review" ? "는" : "은";
  return `${done.map((k) => CONFIRM_STEP_LABELS[k]).join("·")}${particle} 기록됐습니다. [화면 새로 불러오기]를 누르면 남은 일만 보입니다.`;
}
