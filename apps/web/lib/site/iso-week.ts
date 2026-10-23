// ISO 8601 주 (월요일 시작) — 순수 모듈 (시험 iso-week.test.ts). DB 함수 iso_week_key·iso_week_start(마이그레이션 …63)와 같은 규칙.
// 날짜는 모두 한국 날짜 'YYYY-MM-DD' 글자이고 시간대 계산을 하지 않는다(UTC 달력만 쓴다). 주간 페이지 주소 /local/[sido]/weekly/[yyyy-ww]가 쓴다 (LG-01).

const DAY = 86_400_000;
const parts = (date: string): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? [y, mo, d] : null;
};
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (date: string): number => {
  const p = parts(date);
  if (!p) throw new RangeError(`날짜 형식이 아닙니다: ${date}`);
  return Date.UTC(p[0], p[1] - 1, p[2]);
};
/** 월요일 = 0 */
const weekday = (ms: number) => (new Date(ms).getUTCDay() + 6) % 7;

export const addDays = (date: string, n: number): string => fmt(utc(date) + n * DAY);

/** 날짜가 속한 ISO 주 — 'YYYY-WW' (2027-01-01 → '2026-53', 2027-01-04 → '2027-01') */
export function isoWeekKey(date: string): string {
  const ms = utc(date);
  const thursday = ms - weekday(ms) * DAY + 3 * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const week1Monday = jan4 - weekday(jan4) * DAY;
  const week = Math.floor((ms - weekday(ms) * DAY - week1Monday) / (7 * DAY)) + 1;
  return `${year}-${String(week).padStart(2, "0")}`;
}

/** 주차 → 그 주 월요일. 형식이 틀리거나 존재하지 않는 주(2027-53)면 null */
export function isoWeekStart(key: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (year < 2000 || week < 1 || week > 53) return null;
  const jan4 = Date.UTC(year, 0, 4);
  const monday = jan4 - weekday(jan4) * DAY + (week - 1) * 7 * DAY;
  const start = fmt(monday);
  return isoWeekKey(start) === key ? start : null;
}

/** 주차 → { start 월요일, end 일요일 }. 존재하지 않는 주면 null */
export function isoWeekRange(key: string): { start: string; end: string } | null {
  const start = isoWeekStart(key);
  return start ? { start, end: addDays(start, 6) } : null;
}

/** 바로 앞 주 */
export function previousWeekKey(key: string): string | null {
  const start = isoWeekStart(key);
  return start ? isoWeekKey(addDays(start, -7)) : null;
}

/** 가장 최근 주에서 거슬러 이어진 주 수 (시·도별 연속 발행 주 수 - 4주 연속 완료 기준). 주차 목록이 비면 0 */
export function consecutiveWeekCount(keys: readonly string[]): number {
  const set = new Set(keys.filter((k) => isoWeekStart(k) !== null));
  let cur: string | null = [...set].sort().pop() ?? null;
  let n = 0;
  while (cur !== null && set.has(cur)) {
    n += 1;
    cur = previousWeekKey(cur);
  }
  return n;
}
