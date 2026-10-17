// 편집국 화면 폼 공용 도구 — 순수 함수. 칸 오류는 { 칸 id: 문장 } (화면은 aria-describedby로 칸에 잇는다)

export type FieldErrors = Record<string, string>;

export const blank = (s: string | null | undefined): boolean => s === null || s === undefined || s.trim() === "";

/** 빈 칸은 null, 아니면 앞뒤 공백을 뺀 글자 */
export const textOrNull = (s: string | null | undefined): string | null => (blank(s) ? null : s!.trim());

/** YYYY-MM-DD이고 실제 있는 날짜 */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const KST_OFFSET_MS = 9 * 3600_000;

/** 한국 날짜(YYYY-MM-DD) → 그날 한국 시각 ISO 8601 (시각 기본 00:00) */
export function kstDateToIso(date: string, time = "00:00:00"): string {
  return `${date}T${time}+09:00`;
}

/** ISO 8601 시각 → 한국 날짜 YYYY-MM-DD. 읽을 수 없으면 "" */
export function isoToKstDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO 8601 시각 → 한국 시각 "YYYY-MM-DD HH:MM". 읽을 수 없으면 "" */
export function isoToKstDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + KST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

/** 쉼표·줄바꿈으로 나눈 글자 목록 (빈 칸 제외) */
export function splitList(text: string, separator: RegExp = /[,\n]/): string[] {
  return text
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 줄마다 하나 (빈 줄 제외) */
export const splitLines = (text: string): string[] => splitList(text, /\r?\n/);

/** 번호 칸 — 1 이상 정수 글자면 번호, 아니면 null */
export function idOrNull(text: string | null | undefined): number | null {
  if (blank(text)) return null;
  const n = Number(text!.trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}
