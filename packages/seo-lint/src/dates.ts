// 날짜 읽기 — 실행 환경의 시간대에 기대지 않는다 (결정론). Date.parse의 느슨한 해석을 쓰지 않는다.

// 시간대가 붙은 ISO 8601 시각: 2026-10-15T09:00, 2026-10-15T09:00:00.123+09:00, 2026-10-15T00:00:00Z
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const isValidYmd = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 시간대가 붙은 시각 → epoch ms. 시간대가 없거나 없는 날짜·시각이면 null */
export function parseInstant(value: string): number | null {
  const m = DATETIME.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number];
  const s = m[6] === undefined ? 0 : Number(m[6]);
  const ms = m[7] === undefined ? 0 : Number(m[7].slice(0, 3).padEnd(3, "0"));
  if (!isValidYmd(y, mo, d) || h > 23 || mi > 59 || s > 59) return null;
  let offsetMinutes = 0;
  if (m[8] !== undefined) {
    const oh = Number(m[9]);
    const om = Number(m[10]);
    if (oh > 23 || om > 59) return null;
    offsetMinutes = (m[8] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  return Date.UTC(y, mo - 1, d, h, mi, s, ms) - offsetMinutes * 60_000;
}

/** YYYY-MM-DD 달력 날짜 — 올바르면 그대로, 아니면 null */
export function parseCalendarDate(value: string): string | null {
  const m = DATE_ONLY.exec(value);
  if (!m) return null;
  return isValidYmd(Number(m[1]), Number(m[2]), Number(m[3])) ? value : null;
}

/** epoch ms를 주어진 시차(분)의 달력 날짜 YYYY-MM-DD로 */
export function calendarDateAt(instant: number, offsetMinutes: number): string {
  const d = new Date(instant + offsetMinutes * 60_000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
