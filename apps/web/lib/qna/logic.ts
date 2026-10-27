// 라운지(QNA-01~08) 순수 규칙 - DB·네트워크·시계를 쓰지 않는다 (docs/dev/W13-g_설계.md).
//  · 글 준비 - 개인정보 가림(도우미 maskText 재사용). 가림이 일어난 글은 게시 보류(pii)로 저장한다 (QNA-03)
//  · 활동 전문가 띠 선정 - 결정론 정렬. 입력에 결제·구독·광고 칸이 없다 (QNA-08)
//  · 공무원 인증 도메인 - 정확히 일치하거나 하위 도메인만 (EXP-01)
//  · 신고 처리 목표 - 1영업일 (QNA-05)
import { maskText } from "@/lib/assistant/mask";

export const TITLE_RANGE = { min: 2, max: 120 } as const;
export const BODY_RANGE = { min: 2, max: 4000 } as const;
export const TAX_TYPE_MAX = 30;
export const REPORT_REASONS = ["ad", "pii", "abuse", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABEL: Record<ReportReason, string> = { ad: "광고성", pii: "개인정보", abuse: "욕설·비방", other: "기타" };
export const REPORT_NOTE_MAX = 200;
/** 신고 처리 목표 영업일 (QNA-05) */
export const REPORT_DUE_BUSINESS_DAYS = 1;

export type PreparedText = { text: string; maskedKinds: string[]; held: boolean };

/** 글을 저장하기 전에 가린다. 가림이 한 번이라도 일어났으면 held=true (운영자 확인 전 비공개) */
export function prepareText(raw: string): PreparedText {
  const m = maskText(raw);
  const maskedKinds = [...new Set(m.kinds as string[])];
  return { text: m.text.trim(), maskedKinds, held: maskedKinds.length > 0 };
}

export type QuestionInput = { taxType: string; title: PreparedText; body: PreparedText; held: boolean; maskedKinds: string[]; solvedConsent: boolean };
type Fail = { ok: false; errors: string[] };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** 질문 입력 - 개인정보 경고 확인(warning_confirmed)이 없으면 등록 불가 (QNA-01) */
export function parseQuestionInput(raw: Record<string, unknown>): { ok: true; value: QuestionInput } | Fail {
  const errors: string[] = [];
  const taxType = str(raw.tax_type);
  const title = str(raw.title);
  const body = str(raw.body);
  if (taxType.length < 1 || taxType.length > TAX_TYPE_MAX) errors.push(`tax_type: 세목은 1~${TAX_TYPE_MAX}자입니다`);
  if (title.length < TITLE_RANGE.min || title.length > TITLE_RANGE.max) errors.push(`title: ${TITLE_RANGE.min}~${TITLE_RANGE.max}자입니다`);
  if (body.length < BODY_RANGE.min || body.length > BODY_RANGE.max) errors.push(`body: ${BODY_RANGE.min}~${BODY_RANGE.max}자입니다`);
  if (raw.warning_confirmed !== true) errors.push("warning_confirmed: 개인정보 입력 경고를 확인해야 등록할 수 있습니다");
  if (errors.length > 0) return { ok: false, errors };
  const t = prepareText(title);
  const b = prepareText(body);
  return { ok: true, value: { taxType, title: t, body: b, held: t.held || b.held, maskedKinds: [...new Set([...t.maskedKinds, ...b.maskedKinds])], solvedConsent: raw.solved_consent === true } };
}

export type AnswerInput = { body: PreparedText };
export function parseAnswerInput(raw: Record<string, unknown>): { ok: true; value: AnswerInput } | Fail {
  const body = str(raw.body);
  if (body.length < BODY_RANGE.min || body.length > BODY_RANGE.max) return { ok: false, errors: [`body: ${BODY_RANGE.min}~${BODY_RANGE.max}자입니다`] };
  return { ok: true, value: { body: prepareText(body) } };
}

export type ReportInput = { targetType: "question" | "answer"; targetId: number; reason: ReportReason; note: string };
export function parseReportInput(raw: Record<string, unknown>): { ok: true; value: ReportInput } | Fail {
  const errors: string[] = [];
  const targetType = raw.target_type;
  if (targetType !== "question" && targetType !== "answer") errors.push("target_type: question 또는 answer입니다");
  const id = raw.target_id;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) errors.push("target_id: 1 이상의 정수입니다");
  const reason = raw.reason;
  if (typeof reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(reason)) errors.push(`reason: ${REPORT_REASONS.join("·")} 중 하나입니다`);
  const note = str(raw.note);
  if (note.length > REPORT_NOTE_MAX) errors.push(`note: ${REPORT_NOTE_MAX}자 이하입니다`);
  if (errors.length > 0) return { ok: false, errors };
  // 신고 메모에도 개인정보가 남지 않도록 가린 글만 저장한다
  return { ok: true, value: { targetType: targetType as "question" | "answer", targetId: id as number, reason: reason as ReportReason, note: prepareText(note).text } };
}

/**
 * 신고 처리 목표 시각 - 접수 + 1영업일(같은 시각). 주말과 설정 business_holidays(한국 날짜 YYYY-MM-DD 목록, 편집국 AI 기한과 같은 설정)를 건너뛴다.
 * 설정이 비어 있으면 주말만 본다 - 공휴일 달력 값은 PO 입력이다.
 */
export function reportDueAt(received: Date, holidays: readonly string[] = []): Date {
  const hol = new Set(holidays);
  const KST = 9 * 3600 * 1000;
  let t = received.getTime();
  let left = REPORT_DUE_BUSINESS_DAYS;
  while (left > 0) {
    t += 86400000;
    const k = new Date(t + KST);
    const dow = k.getUTCDay();
    if (dow !== 0 && dow !== 6 && !hol.has(k.toISOString().slice(0, 10))) left -= 1;
  }
  return new Date(t);
}

/** 인증 공무원 메일 - 도메인이 목록과 정확히 일치하거나 그 하위일 때만 (notgo.kr 같은 위장 거부). 메일 확인이 끝난 계정만 부른다 */
export function isGovEmail(email: string | null | undefined, domains: readonly string[]): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return false;
  const host = e.slice(at + 1);
  return domains.some((d) => {
    const dom = d.trim().toLowerCase();
    return dom.length > 0 && (host === dom || host.endsWith(`.${dom}`));
  });
}

// ─── 활동 전문가 띠 (QNA-08) ───────────────────────────────

export interface ActivityRow {
  expertProfileId: number;
  name: string;
  answeredCount: number;
  acceptedCount: number;
  acceptanceRate: number;
  sanctioned?: boolean;
}
export interface StripCriteria {
  minAccepted: number;
  minRate: number;
  stripSize: number;
}

/** 설정 qna_criteria 읽기 - 값이 비어 있거나 모자라면 null(띠 없음) */
export function parseStripCriteria(value: unknown): StripCriteria | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const size = v.strip_size;
  const minAccepted = v.min_accepted;
  const minRate = v.min_rate;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 3 || size > 5) return null;
  if (typeof minAccepted !== "number" || minAccepted < 0) return null;
  if (typeof minRate !== "number" || minRate < 0 || minRate > 1) return null;
  return { minAccepted, minRate, stripSize: size };
}

/**
 * 띠 선정 - 제재 중 제외 -> 기준 이상(채택 수 >= 최소, 채택률 >= 최소, 채택 0은 제외) -> 채택 수 내림차순 -> 채택률 내림차순 -> 프로필 번호 오름차순(동점 규칙) -> 상위 N명.
 * 같은 데이터면 같은 순서이고, 입력 칸에 결제·구독·광고가 없다.
 */
export function selectStrip(rows: readonly ActivityRow[], criteria: StripCriteria | null): ActivityRow[] {
  if (criteria === null) return [];
  return rows
    .filter((r) => !r.sanctioned && r.acceptedCount >= 1 && r.acceptedCount >= criteria.minAccepted && r.acceptanceRate >= criteria.minRate)
    .sort((a, b) => b.acceptedCount - a.acceptedCount || b.acceptanceRate - a.acceptanceRate || a.expertProfileId - b.expertProfileId)
    .slice(0, criteria.stripSize);
}
