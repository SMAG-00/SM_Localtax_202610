// 기사 생산 대시보드의 기간 (NAV-14 — docs/dev/W2-c_설계.md 2.8·8.5) — 순수 모듈 (시험 windows.test.ts).
// 기간은 한국 달력의 달로 잡는다(한국에는 일광 절약 시간이 없어 달 경계는 늘 UTC 15시).
//  · closed_months — 지난달까지 완결된 달 N개: [N달 전 1일 0시, 이번 달 1일 0시)
//  · including_current — 이번 달(오늘까지)을 넣은 N개: [N−1달 전 1일 0시, 내일 0시)
// 기간 길이·잡는 법은 설정 news_readiness_windows(내부 정의)와 규정 버전의 심사 대상 기간(공식 정의)에서 읽는다 — NAV-14 '기간 정의는 규정 버전·settings에서 읽는다'.
// 기준 숫자(기사 수·비율)는 여기에 없다.
import { addDays, kstDate, kstDayStart } from "@/lib/analytics/metrics";

export const WINDOW_SETTING_KEY = "news_readiness_windows";
export const WINDOW_BASES = ["closed_months", "including_current"] as const;
export type WindowBasis = (typeof WINDOW_BASES)[number];
export const WINDOW_BASIS_LABELS: Readonly<Record<WindowBasis, string>> = { closed_months: "완결된 달 (이번 달 제외)", including_current: "이번 달 오늘까지 포함" };

export interface WindowsSetting {
  version: string;
  /** 기간 길이(개월) — 작은 것부터 */
  months: number[];
  basis: WindowBasis;
}

/** PRD 정의 — NAV-14 '3·6·12개월 기간별'. 설정이 없거나 틀릴 때만 쓴다(그 사실을 화면이 알린다) */
export const NAV14_WINDOWS: Readonly<WindowsSetting> = Object.freeze({ version: "NAV-14", months: [3, 6, 12], basis: "closed_months" });

const MONTHS_MAX = 24;
const WINDOWS_MAX = 4;

export interface MonthWindow {
  months: number;
  basis: WindowBasis;
  /** 한국 날짜 — 첫날 · 끝날 (둘 다 포함) */
  from: string;
  to: string;
  /** [start, end) 밀리초 */
  start: number;
  end: number;
  /** 월평균을 낼 때 나누는 달 수 (이번 달 포함이면 이번 달도 한 달로 센다) */
  monthsCounted: number;
}

/** 한국 날짜의 달 번호 (연 × 12 + 달 − 1) */
const monthIndexOf = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const firstDayOf = (index: number) => `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}-01`;

/** N개월 기간 — now는 UTC 밀리초 */
export function monthWindow(months: number, basis: WindowBasis, now: number): MonthWindow {
  const today = kstDate(now);
  const current = monthIndexOf(today);
  if (basis === "closed_months") {
    const from = firstDayOf(current - months);
    const endDay = firstDayOf(current);
    return { months, basis, from, to: addDays(endDay, -1), start: kstDayStart(from), end: kstDayStart(endDay), monthsCounted: months };
  }
  const from = firstDayOf(current - months + 1);
  return { months, basis, from, to: today, start: kstDayStart(from), end: kstDayStart(addDays(today, 1)), monthsCounted: months };
}

export const inWindow = (ms: number, w: Pick<MonthWindow, "start" | "end">): boolean => ms >= w.start && ms < w.end;

export function windowsFor(setting: WindowsSetting, now: number): MonthWindow[] {
  return setting.months.map((m) => monthWindow(m, setting.basis, now));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sameMonths = (a: unknown, b: unknown) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

/** 설정 값 검사 — 관리자 설정 화면·설정 API와 대시보드가 같은 검사. current는 지금 저장된 값(버전 규칙) */
export function checkWindowsSetting(value: unknown, current?: unknown): string[] {
  if (!isObj(value)) return ['값은 JSON 객체여야 합니다 — { "version": "…", "months": [3, 6, 12], "basis": "closed_months" }'];
  const errors: string[] = [];
  for (const k of ["version", "months", "basis"]) if (value[k] === undefined) errors.push(`${k}: 필요합니다`);
  for (const k of Object.keys(value)) if (!["version", "months", "basis"].includes(k)) errors.push(`${k}: 모르는 칸입니다 — 기준 숫자는 규정 버전에만 적습니다`);
  if (value.version !== undefined && (typeof value.version !== "string" || value.version.trim() === "" || value.version.length > 80)) errors.push("version: 버전 글자가 필요합니다");
  const m = value.months;
  if (m !== undefined) {
    const ok =
      Array.isArray(m) &&
      m.length >= 1 &&
      m.length <= WINDOWS_MAX &&
      m.every((x, i) => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= MONTHS_MAX && (i === 0 || (x as number) > (m[i - 1] as number)));
    if (!ok) errors.push(`months: 1~${MONTHS_MAX} 정수 1~${WINDOWS_MAX}개를 작은 것부터 적습니다`);
  }
  if (value.basis !== undefined && !(WINDOW_BASES as readonly unknown[]).includes(value.basis)) errors.push(`basis: ${WINDOW_BASES.join("·")} 중 하나여야 합니다`);
  if (errors.length === 0 && isObj(current) && current.version === value.version && (current.basis !== value.basis || !sameMonths(current.months, value.months))) {
    errors.push(`version: 값을 바꾸면 버전도 바꿔야 합니다 (지금 ${String(current.version)})`);
  }
  return errors;
}

/** 대시보드의 설정 읽기 — 없거나 틀리면 NAV-14 정의로 세고 그 문제를 알린다 */
export function readWindowsSetting(value: unknown, exists: boolean): { setting: WindowsSetting; problem: string | null } {
  if (!exists) return { setting: NAV14_WINDOWS, problem: `내부 집계 기간 설정(${WINDOW_SETTING_KEY})이 없습니다 — NAV-14 정의(3·6·12개월, 완결된 달)로 셉니다` };
  const errors = checkWindowsSetting(value);
  if (errors.length) return { setting: NAV14_WINDOWS, problem: `내부 집계 기간 설정이 틀렸습니다(${errors[0]}) — NAV-14 정의(3·6·12개월, 완결된 달)로 셉니다` };
  return { setting: value as WindowsSetting, problem: null };
}
