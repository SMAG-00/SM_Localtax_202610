// 홈 해결 사례 입력 규칙 (HOME-11, docs/dev/W13-h_설계.md) - 순수 함수. 정본 규칙은 DB(RPC·제약)이고 여기는 칸 모양과 가림 모양을 먼저 본다.
// 카드 문장은 편집자가 직접 쓴다 - 이 파일에는 문장을 만드는 코드가 없다.
import { maskText } from "@/lib/assistant/mask";

export const CASE_FIELD_MAX = 400;
export const CASE_FIELDS = ["situation", "issue", "result", "lesson"] as const;
export type CaseField = (typeof CASE_FIELDS)[number];
export const CASE_FIELD_LABEL: Record<CaseField, string> = { situation: "상황", issue: "쟁점", result: "결과", lesson: "교훈" };
export const SOLVED_OPS = ["save", "approve", "unpublish", "classify_review"] as const;

type Body = Record<string, unknown>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : typeof v === "string" && /^[1-9]\d{0,15}$/.test(v.trim()) ? Number(v) : null);

export interface CaseInput {
  questionId: number;
  situation: string;
  issue: string;
  result: string;
  lesson: string;
}

/** 카드 저장 - 네 칸은 승인 전에는 비어 있어도 되지만 400자 이하이고 개인정보 모양(이메일·전화·긴 숫자)이 있으면 거부 */
export function parseCaseInput(b: Body): Parsed<CaseInput> {
  const errors: string[] = [];
  const questionId = int(b.question_id);
  if (questionId === null) errors.push("question_id: 질문 번호입니다");
  const out: Record<CaseField, string> = { situation: "", issue: "", result: "", lesson: "" };
  for (const f of CASE_FIELDS) {
    const v = text(b[f]);
    if (v.length > CASE_FIELD_MAX) errors.push(`${f}: ${CASE_FIELD_LABEL[f]}은 ${CASE_FIELD_MAX}자 이하입니다`);
    else if (v.length > 0 && maskText(v).text !== v) errors.push(`${f}: ${CASE_FIELD_LABEL[f]}에 개인정보로 보이는 값이 있습니다. 지우고 다시 쓰세요`);
    out[f] = v;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { questionId: questionId!, ...out } };
}

/** 승인 - 가림 확인 체크(mask_confirmed=true)가 없으면 거부 */
export function parseApproveInput(b: Body): Parsed<{ id: number }> {
  const errors: string[] = [];
  const id = int(b.id);
  if (id === null) errors.push("id: 카드 번호입니다");
  if (b.mask_confirmed !== true) errors.push("mask_confirmed: 개인정보 가림을 확인해야 승인할 수 있습니다");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { id: id! } };
}

export function parseUnpublishInput(b: Body): Parsed<{ id: number; reason: string }> {
  const errors: string[] = [];
  const id = int(b.id);
  if (id === null) errors.push("id: 카드 번호입니다");
  const reason = text(b.reason);
  if (reason.length < 1 || reason.length > 300) errors.push("reason: 내림 사유는 1~300자입니다");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { id: id!, reason } };
}

export function parseClassifyReview(b: Body): Parsed<{ id: number; decision: "accepted" | "rejected"; finalTaxType: string | null }> {
  const errors: string[] = [];
  const id = int(b.id);
  if (id === null) errors.push("id: 분류 제안 번호입니다");
  const decision = b.decision;
  if (decision !== "accepted" && decision !== "rejected") errors.push("decision: accepted 또는 rejected입니다");
  const tax = text(b.final_tax_type);
  if (decision === "accepted" && (tax.length < 1 || tax.length > 30)) errors.push("final_tax_type: 수락하려면 세목 1~30자가 필요합니다");
  if (decision === "rejected" && tax.length > 0) errors.push("final_tax_type: 거절에는 세목을 넣지 않습니다");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { id: id!, decision: decision as "accepted" | "rejected", finalTaxType: decision === "accepted" ? tax : null } };
}
