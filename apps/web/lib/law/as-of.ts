// 법령 기준일 선택 (LAW-02 · LAW-03 · LAW-05) - 순수 모듈. 기준일(?date=)에 시행 중인 개정판을 고른다.
// 규칙: 시행일자 <= 기준일인 개정판 가운데 시행일자가 가장 늦은 것(같으면 공포일자, 그다음 번호가 큰 것). 시행일 '당일'은 새 개정판, '전날'은 이전 개정판이다.
// 날짜는 한국 날짜(Asia/Seoul)의 YYYY-MM-DD 글자로만 다룬다 - 시각대 변환으로 하루가 밀리지 않게.

export interface VersionLike {
  id: number;
  promulgated_on: string;
  effective_on: string;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** 한국 날짜 (UTC + 9시간) */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const m = ISO.exec(date)!;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10);
}

export interface AsOf {
  /** 실제로 쓰는 기준일 */
  date: string;
  /** 주소에 ?date=가 있었고 올바른 날짜였다 */
  explicit: boolean;
}

/** ?date= 값 -> 기준일. 없거나 올바른 날짜가 아니면 오늘(한국 날짜) */
export function parseAsOf(value: string | string[] | undefined, today: string): AsOf {
  const v = Array.isArray(value) ? value[0] : value;
  return isRealIsoDate(v) ? { date: v, explicit: true } : { date: today, explicit: false };
}

const newer = (a: VersionLike, b: VersionLike) =>
  a.effective_on !== b.effective_on ? a.effective_on > b.effective_on : a.promulgated_on !== b.promulgated_on ? a.promulgated_on > b.promulgated_on : a.id > b.id;

export function pickVersionAsOf<T extends VersionLike>(versions: readonly T[], date: string): T | null {
  let best: T | null = null;
  for (const v of versions) if (v.effective_on <= date && (best === null || newer(v, best))) best = v;
  return best;
}

/** 가장 이른 개정판 - 기준일이 이보다 앞서면 '이 날짜의 원문이 없어요' (LAW-02) */
export function earliestVersion<T extends VersionLike>(versions: readonly T[]): T | null {
  let best: T | null = null;
  for (const v of versions) if (best === null || newer(best, v)) best = v;
  return best;
}

/** 어떤 개정판 바로 앞 개정판 (신구조문 대비의 '구') */
export function previousVersion<T extends VersionLike>(versions: readonly T[], current: T): T | null {
  let best: T | null = null;
  for (const v of versions) if (v.id !== current.id && newer(current, v) && (best === null || newer(v, best))) best = v;
  return best;
}

/** 시행 예정 - 공포일자가 오늘 이전(포함)이고 시행일자가 오늘 이후(제외)인 개정판. 시행일 당일부터는 예정이 아니다 (LAW-03) */
export function upcomingVersions<T extends VersionLike>(versions: readonly T[], today: string): T[] {
  return versions.filter((v) => v.promulgated_on <= today && v.effective_on > today).sort((a, b) => (a.effective_on < b.effective_on ? -1 : 1));
}

/** '2027.1.1 시행 예정' 배지 글자 */
export function upcomingBadge(effectiveOn: string): string {
  const [y, m, d] = effectiveOn.split("-").map(Number);
  return `${y}.${m}.${d} 시행 예정`;
}
