/**
 * 보유기간 계산 유틸.
 *
 * 소득세법상 보유기간은 취득일부터 양도일까지다.
 * "1년 미만"의 경계를 정확히 다루기 위해 달력 기준(연/월/일)으로 판정한다.
 * 밀리초 나눗셈으로 연수를 구하면 윤년에서 경계가 어긋나므로 쓰지 않는다.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface YMD {
  readonly year: number;
  readonly month: number; // 1~12
  readonly day: number; // 1~31
}

export function parseDate(iso: string): YMD {
  if (!ISO_DATE.test(iso)) {
    throw new RangeError(`parseDate: 날짜는 YYYY-MM-DD 형식이어야 합니다 (${iso})`);
  }
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new RangeError(`parseDate: 존재하지 않는 날짜입니다 (${iso})`);
  }
  return { year: y, month: m, day: d };
}

function toUtc(d: YMD): number {
  return Date.UTC(d.year, d.month - 1, d.day);
}

/** to − from 의 만(滿) 연수. 예: 2025-01-01 → 2026-01-01 = 1년, 2025-12-31 = 0년 */
export function fullYearsBetween(fromIso: string, toIso: string): number {
  const from = parseDate(fromIso);
  const to = parseDate(toIso);
  if (toUtc(to) < toUtc(from)) {
    throw new RangeError(
      `fullYearsBetween: 양도일(${toIso})이 취득일(${fromIso})보다 빠릅니다.`,
    );
  }
  let years = to.year - from.year;
  const beforeAnniversary =
    to.month < from.month || (to.month === from.month && to.day < from.day);
  if (beforeAnniversary) years -= 1;
  return years;
}

/**
 * to − from 의 만(滿) 개월수. fullYearsBetween과 같은 응당일 규약(초과일 미도래 시 1개월 감산).
 * 상속 동일세대 보유·거주 통산 등 '개월' 단위 판정에 쓴다 — 연 단위로 버린 뒤 합산하면 최대 23개월이 사라진다.
 * 예: 2025-01-01 → 2026-06-01 = 17개월, 2020-01-15 → 2020-02-14 = 0개월.
 */
export function fullMonthsBetween(fromIso: string, toIso: string): number {
  const from = parseDate(fromIso);
  const to = parseDate(toIso);
  if (toUtc(to) < toUtc(from)) {
    throw new RangeError(
      `fullMonthsBetween: 종료일(${toIso})이 기산일(${fromIso})보다 빠릅니다.`,
    );
  }
  let months = (to.year - from.year) * 12 + (to.month - from.month);
  if (to.day < from.day) months -= 1;
  return months;
}

/** 일수 차이 (경계 테스트용) */
export function daysBetween(fromIso: string, toIso: string): number {
  const ms = toUtc(parseDate(toIso)) - toUtc(parseDate(fromIso));
  return Math.round(ms / 86_400_000);
}

/**
 * dateIso가 referenceIso보다 나중인가 (같은 날은 false).
 * 한시 유예·일몰기한 판정에 쓴다. 종료일 당일까지는 유예 기간에 포함된다.
 */
export function isAfterDate(dateIso: string, referenceIso: string): boolean {
  return toUtc(parseDate(dateIso)) > toUtc(parseDate(referenceIso));
}

/**
 * 예정신고·납부 기한 = 양도일이 속하는 달의 말일부터 N개월 (소득세법 §105①).
 *
 * 예: filingDueDate('2026-03-15', 2) → '2026-05-31' (3월 말일 + 2개월).
 * 부담부증여의 채무액 부분은 months=3 (§105①3호).
 * 반환은 YYYY-MM-DD.
 */
export function filingDueDate(transferIso: string, months: number): string {
  if (!Number.isInteger(months) || months < 0) {
    throw new RangeError(`filingDueDate: months는 0 이상 정수여야 합니다 (${months})`);
  }
  const d = parseDate(transferIso);
  const total = d.month + months; // 1-based 월 누적
  const year = d.year + Math.floor((total - 1) / 12);
  const month = ((total - 1) % 12) + 1; // 1~12로 환원
  // Date.UTC(year, month, 0) = month(1-based)월의 마지막 날 (다음 달의 0일)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  const dd = String(lastDay).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * 민법식 기간 계산: months개월 후의 응당일. 응당일이 없으면 그 달의 말일로 보정한다.
 * (증여 이월과세 10년/5년 기간 판정 등에 쓴다.)
 *
 * 예: addMonths('2023-01-15', 120) → '2033-01-15',
 *     addMonths('2020-02-29', 12) → '2021-02-28' (2월 29일이 없어 말일).
 */
export function addMonths(iso: string, months: number): string {
  if (!Number.isInteger(months)) {
    throw new RangeError(`addMonths: months는 정수여야 합니다 (${months})`);
  }
  const d = parseDate(iso);
  const total = d.month + months; // 1-based
  const year = d.year + Math.floor((total - 1) / 12);
  const month = ((total - 1) % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d.day, lastDay); // 응당일 없으면 말일
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}
