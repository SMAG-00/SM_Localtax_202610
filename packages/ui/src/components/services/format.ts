// services 묶음 내부 도우미 — 날짜 표기·주소 검사·문구 검사 (묶음 밖으로 내보내지 않는 것은 index.ts에 없다)

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 시각 문자열 → 밀리초. 읽을 수 없으면 null */
export function toTime(value: string | undefined | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function kstIso(value: string): string | null {
  const t = toTime(value);
  return t === null ? null : new Date(t + KST_OFFSET_MS).toISOString();
}

/** 한국 시간 날짜 "2026-10-17" — 날짜만 온 값은 그대로, 읽을 수 없는 값도 그대로 보인다 */
export function kstDate(value: string): string {
  if (DATE_ONLY.test(value)) return value;
  return kstIso(value)?.slice(0, 10) ?? value;
}

/** 한국 시간 날짜·시각 "2026-10-17 09:30" — 날짜만 온 값은 날짜만 */
export function kstDateTime(value: string): string {
  if (DATE_ONLY.test(value)) return value;
  const iso = kstIso(value);
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : value;
}

/** http(s) 절대 주소인가 (원문·주문 경로처럼 쿼리가 있어도 되는 주소) */
export function isHttpUrl(url: string): boolean {
  if (!url || url.trim() !== url) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * 계산기 연결 주소 검사 (TX-02 · FAM-08) — http(s) 절대 주소이고 쿼리(?)·조각(#)이 없다.
 * 빈 '?'·'#'도 막는다. 이 사이트의 값이 주소에 실려 나가는 길을 없앤다.
 */
export function isCleanExternalUrl(url: string): boolean {
  if (!isHttpUrl(url)) return false;
  return !url.includes("?") && !url.includes("#");
}

/** 바깥 사이트 주소인가 (새 창으로 연다) */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
/** 평문 이메일 주소가 들어 있는가 */
export function hasEmail(text: string): boolean {
  return EMAIL.test(text);
}

const AMOUNT = /\d\s*(?:천|만|억|조)?\s*원/;
/** 세액 표현(숫자 + 원)이 들어 있는가 — 「지방세로 읽기」는 세액을 쓰지 않는다 (CORE-01) */
export function hasAmount(text: string): boolean {
  return AMOUNT.test(text);
}

/** 앞뒤 공백을 지운 빈 값이 아닌 글자들 */
export function nonBlank(lines: readonly string[]): string[] {
  return lines.map((l) => l.trim()).filter(Boolean);
}

export const isBlank = (v: string | undefined | null) => !v || v.trim() === "";
