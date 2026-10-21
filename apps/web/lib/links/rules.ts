import { isoToKstDate } from "@/lib/admin/form-utils";

// 바깥 연결(official_links) 규칙 — 순수 함수. 점검 배치·관리 API·화면이 같은 판정을 쓴다 (docs/dev/W3_설계.md 3·4장).

export const LINK_KINDS = ["sm_calculator", "external_calculator", "fallback"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export type LinkStatus = "ok" | "broken" | "unchecked";

/** 마지막 점검이 이 일수보다 오래되면 경고 — 7일 전 점검은 0건, 8일 전은 1건 (KST 날짜 차이) */
export const STALE_AFTER_DAYS = 7;

const DAY = 86400_000;
const kstDayNumber = (iso: string) => Math.floor(Date.parse(`${isoToKstDate(iso)}T00:00:00Z`) / DAY);

/** KST 날짜 기준으로 며칠 지났나 */
export function daysSince(checkedAtIso: string, now: Date): number {
  return kstDayNumber(now.toISOString()) - kstDayNumber(checkedAtIso);
}

/** 점검이 낡았나 — 주소가 있는데 한 번도 점검하지 않았거나 8일 이상 지난 행. 주소 없는 행은 점검 대상이 아니다 */
export function isStale(link: { url: string | null; checked_at: string | null }, now: Date): boolean {
  if (!link.url) return false;
  if (!link.checked_at) return true;
  return daysSince(link.checked_at, now) > STALE_AFTER_DAYS;
}

/** 실행 키 = KST 날짜 기준 ISO 주 (예 2026-W43) — 한 주에 점검 기록은 링크당 한 벌 */
export function isoWeekKey(now: Date): string {
  const d = new Date(`${isoToKstDate(now.toISOString())}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow); // 그 주의 목요일
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** 응답 상태 → 점검 결과. 2xx만 ok (3xx는 요청 쪽에서 따라간 뒤의 최종 상태) */
export function resultOf(status: number | null): "ok" | "broken" {
  return status !== null && status >= 200 && status < 300 ? "ok" : "broken";
}

export const isHttpUrl = (v: string) => /^https?:\/\/[^\s]+$/i.test(v);

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface LinkUpdate {
  id: number;
  label?: string;
  url?: string | null;
  termsNote?: string | null;
  active?: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);

export function parseLinkUpdate(body: Record<string, unknown>): Parsed<LinkUpdate> {
  const errors: string[] = [];
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) errors.push("id: 연결 번호를 확인하세요");
  const out: LinkUpdate = { id };
  if (body.label !== undefined) {
    const label = str(body.label);
    if (!label || label.length > 80) errors.push("label: 1~80자");
    else out.label = label;
  }
  if (body.url !== undefined) {
    const url = body.url === null ? "" : str(body.url);
    if (url === undefined) errors.push("url: 글자로 입력하세요");
    else if (url === "") out.url = null;
    else if (!isHttpUrl(url)) errors.push("url: http:// 또는 https:// 로 시작해야 합니다");
    else out.url = url;
  }
  if (body.termsNote !== undefined) {
    const note = body.termsNote === null ? "" : str(body.termsNote);
    if (note === undefined || note.length > 300) errors.push("termsNote: 300자 이하");
    else out.termsNote = note === "" ? null : note;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") errors.push("active: 참/거짓");
    else out.active = body.active;
  }
  if (errors.length === 0 && Object.keys(out).length === 1) errors.push("바꿀 칸이 없습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function parseManualCheck(body: Record<string, unknown>): Parsed<{ id: number; result: "ok" | "broken" }> {
  const errors: string[] = [];
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) errors.push("id: 연결 번호를 확인하세요");
  if (body.result !== "ok" && body.result !== "broken") errors.push("result: ok 또는 broken");
  return errors.length ? { ok: false, errors } : { ok: true, value: { id, result: body.result as "ok" | "broken" } };
}
