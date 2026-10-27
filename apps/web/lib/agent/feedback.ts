// 피드백·오류 신고 요청 스키마 - 순수 (W12-d d4, ASK-11). 사유는 고정 목록뿐이고 자유 글 칸은 없다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const FEEDBACK_KINDS = ["helpful", "not_helpful", "error_report"] as const;
export const FEEDBACK_REASONS = ["wrong", "weak_evidence", "hard_to_understand", "other"] as const;
export interface Feedback {
  sessionId: string;
  turn: number;
  kind: (typeof FEEDBACK_KINDS)[number];
  reason: (typeof FEEDBACK_REASONS)[number] | null;
}

export function parseFeedback(body: unknown): { ok: true; value: Feedback } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "요청 모양이 틀립니다" };
  const o = body as Record<string, unknown>;
  const extra = Object.keys(o).find((k) => !["sessionId", "turn", "kind", "reason"].includes(k));
  if (extra) return { ok: false, error: `알 수 없는 칸: ${extra}` };
  if (typeof o.sessionId !== "string" || !UUID.test(o.sessionId)) return { ok: false, error: "세션 값이 틀립니다" };
  if (typeof o.turn !== "number" || !Number.isInteger(o.turn) || o.turn < 1 || o.turn > 1000) return { ok: false, error: "턴 값이 틀립니다" };
  if (!(FEEDBACK_KINDS as readonly unknown[]).includes(o.kind)) return { ok: false, error: "종류 값이 틀립니다" };
  const reason = o.reason ?? null;
  if (reason !== null && !(FEEDBACK_REASONS as readonly unknown[]).includes(reason)) return { ok: false, error: "사유 값이 틀립니다" };
  if (o.kind === "helpful" && reason !== null) return { ok: false, error: "도움이 됐다에는 사유가 없습니다" };
  return { ok: true, value: { sessionId: o.sessionId, turn: o.turn, kind: o.kind as Feedback["kind"], reason: reason as Feedback["reason"] } };
}
