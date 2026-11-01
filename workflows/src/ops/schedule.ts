// 알림 구독 재확인 일정 (W10-e - BRIEF-02). 주간 브리핑 호 발행 일정(BRIEF-01)은 PO 2026-11-01 결정으로 지웠다. 순수 함수 - 시각은 모두 Asia/Seoul(UTC+9, 서머타임 없음) 기준이고
// 서버 시간대(UTC 서버·사내 서버)와 무관하게 같은 값이 나온다.

/** PRD-02 BRIEF-02 - 2년마다 재확인. settings.brief_reconfirm_policy.interval_months가 우선 */
export const DEFAULT_RECONFIRM_MONTHS = 24;

const KST_MS = 9 * 3_600_000;

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

export function parseReconfirmMonths(value: unknown): number {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>).interval_months : undefined;
  return isInt(v, 1, 120) ? v : DEFAULT_RECONFIRM_MONTHS;
}

/** 한국 날짜 YYYY-MM-DD */
export function kstDate(d: Date): string {
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
}

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
