// 문의함 순수 규칙 (ADM-03 · W2-e 설계 7.3) — 이름표 · 정정·반론 완료 조건 · 변경 입력 검사. DB·네트워크·시계를 쓰지 않는다.
import { INQUIRY_KINDS, type InquiryKind } from "@/lib/access";

export const INQUIRY_KIND_LABELS: Readonly<Record<InquiryKind, string>> = {
  tip: "기사 제보",
  subscription: "구독 문의",
  advertising: "광고 문의",
  reader_submission: "독자 투고",
  correction: "정정·반론",
  product: "상품 문의",
  assistant_report: "도우미 정정·제보",
};
export const INQUIRY_STATUSES = ["received", "in_progress", "done"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const INQUIRY_STATUS_LABELS: Readonly<Record<InquiryStatus, string>> = { received: "접수", in_progress: "처리 중", done: "완료" };
export const INQUIRY_RESOLUTIONS = ["correction_published", "rebuttal_published", "dismissed"] as const;
export const INQUIRY_RESOLUTION_LABELS: Readonly<Record<(typeof INQUIRY_RESOLUTIONS)[number], string>> = {
  correction_published: "정정 게재",
  rebuttal_published: "반론 게재",
  dismissed: "기각",
};
export const MAIL_STATUS_LABELS: Readonly<Record<string, string>> = { none: "연락 이메일 없음", queued: "대기", sent: "발송됨", failed: "발송 실패", skipped: "메일 설정 없음" };

export const isInquiryKind = (v: unknown): v is InquiryKind => typeof v === "string" && (INQUIRY_KINDS as readonly string[]).includes(v);
export const isInquiryStatus = (v: unknown): v is InquiryStatus => typeof v === "string" && (INQUIRY_STATUSES as readonly string[]).includes(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MEMO_MAX = 2000;

export interface InquiryPatch {
  status?: InquiryStatus;
  assignee?: string | null;
  memo?: string | null;
  resolution?: (typeof INQUIRY_RESOLUTIONS)[number];
  resolutionReason?: string;
}
export type InquiryPatchParse = { ok: true; patch: InquiryPatch } | { ok: false; message: string };

/** 변경 요청 본문 → 허용한 칸만. 모르는 칸·잘못된 값은 거부 */
export function parseInquiryPatch(raw: Record<string, unknown>): InquiryPatchParse {
  const patch: InquiryPatch = {};
  if ("status" in raw) {
    if (!isInquiryStatus(raw.status)) return { ok: false, message: "상태는 접수·처리 중·완료 중 하나여야 합니다" };
    patch.status = raw.status;
  }
  if ("assignee" in raw) {
    if (raw.assignee !== null && !(typeof raw.assignee === "string" && UUID.test(raw.assignee))) return { ok: false, message: "담당자 값이 올바르지 않습니다" };
    patch.assignee = raw.assignee as string | null;
  }
  if ("memo" in raw) {
    if (raw.memo !== null && (typeof raw.memo !== "string" || Array.from(raw.memo).length > MEMO_MAX)) return { ok: false, message: `메모는 ${MEMO_MAX}글자 이하여야 합니다` };
    patch.memo = typeof raw.memo === "string" && raw.memo.trim() !== "" ? raw.memo : null;
  }
  if ("resolution" in raw) {
    if (!(INQUIRY_RESOLUTIONS as readonly unknown[]).includes(raw.resolution)) return { ok: false, message: "처리 결과는 정정 게재·반론 게재·기각 중 하나여야 합니다" };
    patch.resolution = raw.resolution as (typeof INQUIRY_RESOLUTIONS)[number];
  }
  if ("resolutionReason" in raw) {
    if (typeof raw.resolutionReason !== "string" || Array.from(raw.resolutionReason).length > MEMO_MAX) return { ok: false, message: "처리 사유가 올바르지 않습니다" };
    patch.resolutionReason = raw.resolutionReason.trim();
  }
  if (Object.keys(patch).length === 0) return { ok: false, message: "바꿀 내용이 없습니다" };
  return { ok: true, patch };
}

/** 정정·반론은 처리 결과와 사유가 없으면 완료로 바꿀 수 없다 (DB 제약 inquiries_correction_done과 같은 규칙). 막히면 사유 문장, 아니면 null */
export function completionBlocked(kind: InquiryKind, nextStatus: InquiryStatus, resolution: string | null | undefined, reason: string | null | undefined): string | null {
  if (kind !== "correction" || nextStatus !== "done") return null;
  if (!resolution) return "정정·반론은 처리 결과(정정 게재·반론 게재·기각)를 정해야 완료할 수 있습니다";
  if (!reason || reason.trim() === "") return "정정·반론은 처리 사유를 적어야 완료할 수 있습니다";
  return null;
}
