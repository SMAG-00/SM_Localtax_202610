import { isoToKstDate } from "@/lib/admin/form-utils";

// 원문 변경·시점 만료 검수 큐 규칙 (W4 6단계 — PRD-01B REG1-13, docs/dev/W4_설계.md 1장 6단계 · 2.1 · 2.2 · 12장 #23) — 순수 함수.
// 관리 API(/api/admin/source-review)·관리 화면·만료 배치(source-expiry)·운영 설정 검사가 같은 값을 쓴다. DB(마이그레이션 …42)도 같은 규칙이다:
//  · 만료 = 확인일(한국 날짜)부터 official_source_expiry_days(씨앗 365)일을 '넘긴' 날부터 — 기준 당일(365일째) 0건, 하루 넘김(366일째) 1건
//  · 실행 키 = 한국 날짜(YYYY-MM-DD) — 같은 날 두 번 돌려도 한 벌
//  · 원문 해시 = sha256:<64자리> (출처 API의 원본 스냅샷과 같은 모양)

/** 2.1 — DB check와 같은 값 (시험이 설계 문서 표를 읽어 맞춘다) */
export const SOURCE_REVIEW_TARGETS = ["article_source", "project_event", "dev_method_fact"] as const;
export const SOURCE_REVIEW_REASONS = ["snapshot_changed", "expired"] as const;
export const SOURCE_REVIEW_STATUSES = ["open", "resolved"] as const;
export type SourceReviewReason = (typeof SOURCE_REVIEW_REASONS)[number];

export const REASON_LABELS: Record<SourceReviewReason, string> = {
  snapshot_changed: "원문 바뀜",
  expired: "확인일 지남",
};

/** 2.2 official_source_expiry_days 씨앗 (12장 #23) · 저장 범위 */
export const EXPIRY_DAYS_DEFAULT = 365;
export const EXPIRY_DAYS_MIN = 1;
export const EXPIRY_DAYS_MAX = 3650;
/** 다시 받는 원문 한도 — 넘으면 받지 않는다 (원본 스냅샷 칸은 글자) */
export const REFETCH_MAX_BYTES = 5 * 1024 * 1024;
export const REFETCH_TIMEOUT_MS = 10_000;
export const NOTE_MAX = 500;

const DAY = 86_400_000;
const HASH = /^sha256:[0-9a-f]{64}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** 설정 값 검사 — 1~3650 정수 (DB 트리거 settings_source_review_guard와 같다) */
export function expiryDaysErrors(value: unknown): string[] {
  return typeof value === "number" && Number.isInteger(value) && value >= EXPIRY_DAYS_MIN && value <= EXPIRY_DAYS_MAX
    ? []
    : [`값: ${EXPIRY_DAYS_MIN}~${EXPIRY_DAYS_MAX} 정수여야 합니다 (REG1-13 초기값 ${EXPIRY_DAYS_DEFAULT})`];
}

/** 저장된 값 → 일수. 틀리면 씨앗 값 (DB 배치 함수와 같은 대체) */
export function expiryDaysOf(value: unknown): number {
  return expiryDaysErrors(value).length === 0 ? (value as number) : EXPIRY_DAYS_DEFAULT;
}

/** 실행 키 = 그 시각의 한국 날짜 */
export function runKeyOf(now: Date): string {
  return isoToKstDate(now.toISOString());
}

const dayNumber = (kstDate: string) => Math.floor(Date.parse(`${kstDate}T00:00:00Z`) / DAY);

/** 확인일(시각)부터 오늘(한국 날짜)까지 지난 날 수 — 한국 날짜끼리의 차. 읽을 수 없으면 null */
export function elapsedKstDays(verifiedAtIso: string | null | undefined, today: string): number | null {
  const from = isoToKstDate(verifiedAtIso);
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  return dayNumber(today) - dayNumber(from);
}

/** 만료인가 — 기준 일수를 '넘겼을 때'만 (기준 당일 false, 하루 넘김 true) */
export function isExpired(verifiedAtIso: string | null | undefined, today: string, days: number): boolean {
  const elapsed = elapsedKstDays(verifiedAtIso, today);
  return elapsed !== null && elapsed > days;
}

/** 만료로 잡히는 첫 날(한국 날짜) — 확인일 + 기준 일수 + 1. 읽을 수 없으면 "" */
export function expiresOn(verifiedAtIso: string | null | undefined, days: number): string {
  const from = isoToKstDate(verifiedAtIso);
  if (!from) return "";
  return new Date((dayNumber(from) + days + 1) * DAY).toISOString().slice(0, 10);
}

export const isSnapshotHash = (v: unknown): v is string => typeof v === "string" && HASH.test(v);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const positiveId = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** 출처 번호 — 숫자 또는 'src:N' */
export function parseSourceRef(v: unknown): number | null {
  if (typeof v === "string" && /^src:\d+$/i.test(v.trim())) return positiveId(v.trim().slice(4));
  return positiveId(v);
}

export interface RefetchInput {
  sourceId: number;
  /** 편집자가 붙여 넣은 원문 — 없으면 서버가 원문 주소에서 받는다 */
  text: string | null;
}

/** op=refetch 입력 — 출처 번호 필수, 붙여 넣은 원문은 선택(빈 글자 거부·한도) */
export function parseRefetch(body: unknown): Parsed<RefetchInput> {
  if (!isObj(body)) return { ok: false, errors: ["본문은 JSON 객체여야 합니다"] };
  const errors: string[] = [];
  const sourceId = parseSourceRef(body.sourceId);
  if (sourceId === null) errors.push("sourceId: 출처 번호(숫자 또는 src:N)가 필요합니다");
  let text: string | null = null;
  if (body.text !== undefined && body.text !== null) {
    if (typeof body.text !== "string" || body.text.trim() === "") errors.push("text: 붙여 넣은 원문이 비었습니다 — 비우려면 칸을 지우세요");
    else if (new TextEncoder().encode(body.text).length > REFETCH_MAX_BYTES) errors.push(`text: 원문은 ${REFETCH_MAX_BYTES / 1024 / 1024}MB 이하입니다`);
    else text = body.text;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { sourceId: sourceId as number, text } };
}

export interface ResolveInput {
  id: number;
  note: string | null;
  /** 시점 만료 항목 — 출처의 확인일을 지금으로 다시 적는다(원문을 다시 확인함) */
  reverify: boolean;
}

/** op=resolve 입력 — 항목 번호 필수, 메모 500자 이하, reverify는 참·거짓 */
export function parseResolve(body: unknown): Parsed<ResolveInput> {
  if (!isObj(body)) return { ok: false, errors: ["본문은 JSON 객체여야 합니다"] };
  const errors: string[] = [];
  const id = positiveId(body.id);
  if (id === null) errors.push("id: 검수 항목 번호가 필요합니다");
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") errors.push("note: 글자여야 합니다");
    else if (body.note.trim().length > NOTE_MAX) errors.push(`note: ${NOTE_MAX}자 이하입니다`);
    else note = body.note.trim() || null;
  }
  if (body.reverify !== undefined && typeof body.reverify !== "boolean") errors.push("reverify: true 또는 false입니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: { id: id as number, note, reverify: body.reverify === true } };
}
