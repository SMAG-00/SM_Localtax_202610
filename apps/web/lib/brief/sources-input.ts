// 브리핑 원천 표 입력 검사 (W10-e SM 이식) - 달력·진행 중 개정안·수집 대상. 순수 함수 - 서버 API와 시험이 같이 쓴다.
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z][a-z0-9_]{1,40}$/;

/** 존재하는 날짜인가 (2월 30일 같은 값 거부) */
export function isRealDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** MM-DD가 윤년 기준으로 존재하는가 */
export function isRealMonthDay(s: string): boolean {
  return MD.test(s) && isRealDate(`2024-${s}`);
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export interface CalendarRow {
  id: number | null;
  text: string;
  is_always: boolean;
  is_yearly: boolean;
  start_md: string | null;
  end_md: string | null;
  start_on: string | null;
  end_on: string | null;
}

/** mode: always(상시) | yearly(매년 반복, startMd 필수) | once(한 번만, startOn 필수) */
export function parseCalendarInput(b: Record<string, unknown>): Parsed<CalendarRow> {
  const errors: string[] = [];
  const text = str(b.text);
  if (text === "" || text.length > 300) errors.push("text: 1~300자로 적으세요");
  const mode = str(b.mode);
  const id = b.id === undefined || b.id === null ? null : Number(b.id);
  if (id !== null && (!Number.isInteger(id) || id <= 0)) errors.push("id: 올바른 번호가 아닙니다");
  const row: CalendarRow = { id, text, is_always: false, is_yearly: false, start_md: null, end_md: null, start_on: null, end_on: null };
  if (mode === "always") {
    row.is_always = true;
  } else if (mode === "yearly") {
    row.is_yearly = true;
    const s = str(b.startMd);
    const e = str(b.endMd);
    if (!isRealMonthDay(s)) errors.push("startMd: 월-일(MM-DD) 형식으로 적으세요");
    else row.start_md = s;
    if (e !== "") {
      if (!isRealMonthDay(e)) errors.push("endMd: 월-일(MM-DD) 형식으로 적으세요");
      else row.end_md = e;
    }
  } else if (mode === "once") {
    const s = str(b.startOn);
    const e = str(b.endOn);
    if (!isRealDate(s)) errors.push("startOn: 날짜(YYYY-MM-DD)를 적으세요");
    else row.start_on = s;
    if (e !== "") {
      if (!isRealDate(e)) errors.push("endOn: 날짜(YYYY-MM-DD) 형식으로 적으세요");
      else if (row.start_on && e < row.start_on) errors.push("endOn: 시작일보다 빠를 수 없습니다");
      else row.end_on = e;
    }
  } else {
    errors.push("mode: always, yearly, once 중 하나여야 합니다");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: row };
}

export interface OngoingRow {
  id: number | null;
  name: string;
  stage: string;
  as_of: string;
  source: string | null;
  source_url: string | null;
  points: string[];
}

export function parseOngoingInput(b: Record<string, unknown>): Parsed<OngoingRow> {
  const errors: string[] = [];
  const name = str(b.name);
  const stage = str(b.stage);
  const asOf = str(b.asOf);
  const source = str(b.source);
  const url = str(b.sourceUrl);
  const id = b.id === undefined || b.id === null ? null : Number(b.id);
  if (id !== null && (!Number.isInteger(id) || id <= 0)) errors.push("id: 올바른 번호가 아닙니다");
  if (name === "" || name.length > 200) errors.push("name: 1~200자로 적으세요");
  if (stage === "" || stage.length > 100) errors.push("stage: 1~100자로 적으세요");
  if (!isRealDate(asOf)) errors.push("asOf: 기준일(YYYY-MM-DD)을 적으세요");
  if (source.length > 200) errors.push("source: 200자 이내로 적으세요");
  if (url !== "" && !/^https?:\/\/\S{1,490}$/.test(url)) errors.push("sourceUrl: http 또는 https 주소를 적으세요");
  const rawPoints = Array.isArray(b.points) ? (b.points as unknown[]) : typeof b.points === "string" ? b.points.split("\n") : [];
  const points = rawPoints.map(str).filter((p) => p !== "");
  if (points.length > 10 || points.some((p) => p.length > 300)) errors.push("points: 10줄 이하, 줄마다 300자 이하로 적으세요");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { id, name, stage, as_of: asOf, source: source || null, source_url: url || null, points } };
}

/** 켜기·끄기 - 달력과 개정안은 id, 수집 대상은 key */
export function parseActiveInput(b: Record<string, unknown>, by: "id" | "key"): Parsed<{ id?: number; key?: string; active: boolean }> {
  const errors: string[] = [];
  if (typeof b.active !== "boolean") errors.push("active: true 또는 false여야 합니다");
  if (by === "id") {
    const id = Number(b.id);
    if (!Number.isInteger(id) || id <= 0) errors.push("id: 올바른 번호가 아닙니다");
    return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { id, active: b.active === true } };
  }
  const key = str(b.key);
  if (!KEY.test(key)) errors.push("key: 올바른 대상 이름이 아닙니다");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { key, active: b.active === true } };
}
