// 브리핑 발행·재확인 일정 (W10-e - BRIEF-01 · BRIEF-02). 순수 함수 - 시각은 모두 Asia/Seoul(UTC+9, 서머타임 없음) 기준이고
// 서버 시간대(UTC 서버·사내 서버)와 무관하게 같은 값이 나온다.

/** ISO 요일 1=월 ... 7=일 */
export interface PublishPolicy {
  weekday: number;
  hour: number;
  minute: number;
}

/** PRD-02 BRIEF-01 - 매주 월요일 10:00(한국 시간). settings.brief_publish_policy 값이 있으면 그 값이 우선 */
export const DEFAULT_PUBLISH_POLICY: PublishPolicy = { weekday: 1, hour: 10, minute: 0 };
/** PRD-02 BRIEF-02 - 2년마다 재확인. settings.brief_reconfirm_policy.interval_months가 우선 */
export const DEFAULT_RECONFIRM_MONTHS = 24;

const KST_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** 설정 값 -> 정책. 모양이 틀린 칸은 PRD 기본값으로 둔다 */
export function parsePublishPolicy(value: unknown): PublishPolicy {
  const o = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    weekday: isInt(o.weekday, 1, 7) ? o.weekday : DEFAULT_PUBLISH_POLICY.weekday,
    hour: isInt(o.hour, 0, 23) ? o.hour : DEFAULT_PUBLISH_POLICY.hour,
    minute: isInt(o.minute, 0, 59) ? o.minute : DEFAULT_PUBLISH_POLICY.minute,
  };
}

export function parseReconfirmMonths(value: unknown): number {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>).interval_months : undefined;
  return isInt(v, 1, 120) ? v : DEFAULT_RECONFIRM_MONTHS;
}

/** 한국 날짜 YYYY-MM-DD */
export function kstDate(d: Date): string {
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
}

/** 기준 시각 '다음' 발행 시각 - 기준 시각과 같은 순간은 포함하지 않는다(그 시각에 이미 발행). 한국 시간 요일·시각으로 계산 */
export function nextPublishAt(after: Date, policy: PublishPolicy = DEFAULT_PUBLISH_POLICY): Date {
  const shifted = new Date(after.getTime() + KST_MS); // UTC 필드를 한국 시계로 읽는다
  const isoWeekday = shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay();
  const ahead = (policy.weekday - isoWeekday + 7) % 7;
  let candidate = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + ahead, policy.hour, policy.minute, 0, 0);
  if (candidate <= shifted.getTime()) candidate += 7 * DAY_MS;
  return new Date(candidate - KST_MS);
}

/** 발행 시각이 됐나 - 같은 순간부터 발행 */
export const isPublishDue = (publishAt: Date, now: Date): boolean => publishAt.getTime() <= now.getTime();

/** YYYY-MM-DD + n개월 (달 끝은 그 달 마지막 날로 맞춘다 - DB 날짜 계산과 같은 규칙) */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = (y as number) * 12 + ((m as number) - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d as number, last)).padStart(2, "0")}`;
}

/** 재확인 기한 - 확인한 순간의 한국 날짜 + 주기 */
export const reconfirmDue = (confirmedAt: Date, months: number = DEFAULT_RECONFIRM_MONTHS): string => addMonths(kstDate(confirmedAt), months);

/** 재확인 상태 - 기한 당일까지 발송 대상, 안내는 당일 한 번, 다음 날부터 발송 중지(무응답) */
export function reconfirmState(due: string, today: string): "ok" | "notify_today" | "stopped" {
  if (today === due) return "notify_today";
  return today > due ? "stopped" : "ok";
}
