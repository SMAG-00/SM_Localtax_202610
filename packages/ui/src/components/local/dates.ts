// 날짜 도우미 — "YYYY-MM-DD"(KST 달력 날짜) 문자열만 다룬다. 현재 시각을 읽지 않는다(오늘은 늘 인자로 받는다)

/** KST 달력 날짜 "YYYY-MM-DD" */
export type IsoDate = string;
/** 달 "YYYY-MM" */
export type YearMonth = string;

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 있는 날짜인지까지 확인한다 (2026-02-30은 거짓) */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** 1970-01-01부터 센 날 수 — 시간대와 상관없이 날짜 차이만 쓴다 */
export function dayNumber(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** to − from (날 수) */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

export function monthOf(date: IsoDate): YearMonth {
  return date.slice(0, 7);
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(ym: YearMonth): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 그 달 1일의 요일 — 0 일요일 … 6 토요일 */
export function firstWeekday(ym: YearMonth): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
}

export function dateIn(ym: YearMonth, day: number): IsoDate {
  return `${ym}-${String(day).padStart(2, "0")}`;
}

/** "2026-10" → "2026년 10월" */
export function monthLabel(ym: YearMonth): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}년 ${m}월`;
}

/** 빈 글자·공백만 있는 값은 없는 값으로 본다 */
export function filled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
