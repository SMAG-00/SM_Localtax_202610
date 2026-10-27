// 라운지·전문가 계정 연결 관리 입력 검사 (W13-g EXP-01·02, QNA-05) - 순수 함수. 정본 규칙은 DB(RPC·트리거)이고 여기는 칸 모양만 먼저 본다.
type Body = Record<string, unknown>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const LINK_OPS = ["link", "end", "renew"] as const;
export const QNA_OPS = ["release", "hide", "report_handle", "sanction_add", "sanction_lift"] as const;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : typeof v === "string" && /^[1-9]\d{0,15}$/.test(v.trim()) ? Number(v) : null);

/** 날짜(YYYY-MM-DD, 한국) -> 그날 끝(23:59:59 KST)의 ISO. 달력에 없는 날짜는 null */
export function expiryOf(date: string): string | null {
  if (!DATE.test(date)) return null;
  const d = new Date(`${date}T23:59:59+09:00`);
  if (Number.isNaN(d.getTime()) || new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) !== date) return null;
  return d.toISOString();
}

export function parseLink(b: Body): Parsed<{ userId: string; profileId: number; expiresAt: string }> {
  const errors: string[] = [];
  const userId = text(b.user_id).toLowerCase();
  if (!UUID.test(userId)) errors.push("user_id: 회원 계정 번호(UUID)입니다");
  const profileId = int(b.profile_id);
  if (profileId === null) errors.push("profile_id: 프로필 번호입니다");
  const expiresAt = expiryOf(text(b.expires_on));
  if (expiresAt === null) errors.push("expires_on: 재검증 기한(YYYY-MM-DD)입니다");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { userId, profileId: profileId!, expiresAt: expiresAt! } };
}

export function parseEnd(b: Body): Parsed<{ id: number; reason: string }> {
  const errors: string[] = [];
  const id = int(b.id);
  if (id === null) errors.push("id: 연결 번호입니다");
  const reason = text(b.reason);
  if (reason.length < 1 || reason.length > 300) errors.push("reason: 해제 사유는 1~300자입니다");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { id: id!, reason } };
}

export function parseRenew(b: Body): Parsed<{ id: number; expiresAt: string }> {
  const errors: string[] = [];
  const id = int(b.id);
  if (id === null) errors.push("id: 연결 번호입니다");
  const expiresAt = expiryOf(text(b.expires_on));
  if (expiresAt === null) errors.push("expires_on: 재검증 기한(YYYY-MM-DD)입니다");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { id: id!, expiresAt: expiresAt! } };
}

const target = (b: Body): Parsed<{ type: "question" | "answer"; id: number }> => {
  const type = b.type;
  const id = int(b.id);
  const errors: string[] = [];
  if (type !== "question" && type !== "answer") errors.push("type: question 또는 answer입니다");
  if (id === null) errors.push("id: 글 번호입니다");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { type: type as "question" | "answer", id: id! } };
};

export const parseRelease = target;

export function parseHide(b: Body): Parsed<{ type: "question" | "answer"; id: number; reason: string }> {
  const t = target(b);
  const reason = text(b.reason);
  const errors = t.ok ? [] : [...t.errors];
  if (reason.length < 1 || reason.length > 300) errors.push("reason: 숨김 사유는 1~300자입니다");
  return errors.length > 0 || !t.ok ? { ok: false, errors } : { ok: true, value: { ...t.value, reason } };
}

export function parseReportHandle(b: Body): Parsed<{ id: number; decision: "upheld" | "dismissed"; hide: boolean; sanctionDays: number | null; note: string }> {
  const errors: string[] = [];
  const id = int(b.id);
  if (id === null) errors.push("id: 신고 번호입니다");
  if (b.decision !== "upheld" && b.decision !== "dismissed") errors.push("decision: upheld 또는 dismissed입니다");
  const note = text(b.note);
  if (note.length < 1 || note.length > 300) errors.push("note: 처리 메모는 1~300자입니다");
  const days = b.sanction_days === undefined || b.sanction_days === null || b.sanction_days === "" ? null : int(b.sanction_days);
  if (days === null && b.sanction_days !== undefined && b.sanction_days !== null && b.sanction_days !== "") errors.push("sanction_days: 1 이상의 정수입니다");
  const hide = b.hide === true;
  if (b.decision === "dismissed" && (hide || days !== null)) errors.push("기각한 신고에는 숨김·제재를 함께 할 수 없습니다");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { id: id!, decision: b.decision as "upheld" | "dismissed", hide, sanctionDays: days, note } };
}

export function parseSanctionAdd(b: Body): Parsed<{ userId: string; reason: string; days: number | null }> {
  const errors: string[] = [];
  const userId = text(b.user_id).toLowerCase();
  if (!UUID.test(userId)) errors.push("user_id: 회원 계정 번호(UUID)입니다");
  const reason = text(b.reason);
  if (reason.length < 1 || reason.length > 300) errors.push("reason: 제재 사유는 1~300자입니다");
  const raw = b.days;
  const days = raw === undefined || raw === null || raw === "" ? null : int(raw);
  if (days === null && raw !== undefined && raw !== null && raw !== "") errors.push("days: 1 이상의 정수입니다(비우면 해제할 때까지)");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { userId, reason, days } };
}

export function parseSanctionLift(b: Body): Parsed<{ id: number }> {
  const id = int(b.id);
  return id === null ? { ok: false, errors: ["id: 제재 번호입니다"] } : { ok: true, value: { id } };
}

/** 신고 처리 목표를 넘겼는가 (QNA-05 1영업일) */
export const reportOverdue = (dueAt: string, now: Date): boolean => new Date(dueAt).getTime() < now.getTime();
