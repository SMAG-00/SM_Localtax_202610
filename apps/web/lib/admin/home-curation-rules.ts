// 홈 배치(home_curations) 규칙 (HOME-03 · ADM-01 홈 큐레이션) — 순수 모듈. 홈 배치 API와 /admin/home 화면이 같이 쓴다.
//  · 종류 2종: tracker(개정 트래커 하이라이트 — 같은 날 3장까지) · story(해설 스토리 — 같은 날 6장까지, 7장째 거부)
//  · 노출 기간 = 한국 날짜 시작일~종료일(그날까지, 비우면 끝 없음). 상한은 기간이 겹치는 날마다 센다 — DB 트리거
//    (20261018000011_home_curations.sql home_curations_guard)와 같은 셈이라 화면·서버가 먼저 막고 DB가 마지막에 막는다
//  · 새 카드·고친 기간의 종료일은 오늘 이후 — 이미 끝난 카드를 만들지 않는다. 종류·대상은 고치지 않는다(빼고 다시 더한다)
import { blank, isValidDate, type FieldErrors } from "./form-utils";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Obj = Record<string, unknown>;

export const CURATION_KINDS = ["tracker", "story"] as const;
export type CurationKind = (typeof CURATION_KINDS)[number];
export const CURATION_LIMITS: Readonly<Record<CurationKind, number>> = { tracker: 3, story: 6 };
export const CURATION_KIND_LABELS: Readonly<Record<CurationKind, string>> = { tracker: "개정 트래커 하이라이트", story: "해설 스토리" };
export const CURATION_STATUS_LABELS = { active: "노출 중", upcoming: "예정", expired: "끝남" } as const;
export type CurationStatus = keyof typeof CURATION_STATUS_LABELS;

export const isCurationKind = (v: unknown): v is CurationKind => typeof v === "string" && (CURATION_KINDS as readonly string[]).includes(v);

export interface CurationPeriod {
  id?: number;
  starts_on: string;
  ends_on: string | null;
}

/** 상태 — today는 한국 날짜 YYYY-MM-DD */
export function curationStatus(c: CurationPeriod, today: string): CurationStatus {
  if (c.ends_on !== null && c.ends_on < today) return "expired";
  if (c.starts_on > today) return "upcoming";
  return "active";
}

const end = (c: CurationPeriod) => c.ends_on ?? "9999-12-31";
const overlaps = (a: CurationPeriod, b: CurationPeriod) => a.starts_on <= end(b) && b.starts_on <= end(a);

/** 새(또는 고친) 기간에 같은 날 보이는 카드 수의 최대값과 그날 — 자기 자신(excludeId)은 빼고 세고 새 카드 1장을 더한다 */
export function peakCount(existing: readonly CurationPeriod[], candidate: CurationPeriod, excludeId?: number): { count: number; day: string } {
  const others = existing.filter((c) => c.id === undefined || c.id !== excludeId);
  const days = [candidate.starts_on, ...others.filter((c) => c.starts_on > candidate.starts_on && c.starts_on <= end(candidate)).map((c) => c.starts_on)];
  let best = { count: 0, day: candidate.starts_on };
  for (const day of days) {
    const count = others.filter((c) => c.starts_on <= day && end(c) >= day).length + 1;
    if (count > best.count) best = { count, day };
  }
  return best;
}

/** 상한 초과 문장 — 괜찮으면 null */
export function capacityError(kind: CurationKind, existing: readonly CurationPeriod[], candidate: CurationPeriod, excludeId?: number): string | null {
  const limit = CURATION_LIMITS[kind];
  const peak = peakCount(existing, candidate, excludeId);
  return peak.count > limit
    ? `${CURATION_KIND_LABELS[kind]}는 같은 날 ${limit}장까지입니다 — ${peak.day}에 ${peak.count}장째가 됩니다. 끝나는 카드를 빼거나 기간을 고치세요 (HOME-03)`
    : null;
}

/** 같은 대상이 겹치는 기간에 이미 있는가 */
export function duplicateTargetError(existing: readonly (CurationPeriod & { targetId: number })[], targetId: number, candidate: CurationPeriod, excludeId?: number): string | null {
  return existing.some((c) => c.targetId === targetId && c.id !== excludeId && overlaps(c, candidate)) ? "같은 대상이 겹치는 기간에 이미 배치되어 있습니다 — 기간을 고치세요 (HOME-03)" : null;
}

/** 기간 검사 — 종료일 ≥ 시작일, 종료일 ≥ 오늘 */
export function periodErrors(p: CurationPeriod, today: string, at = "curation"): string[] {
  const errors: string[] = [];
  if (p.ends_on !== null && p.ends_on < p.starts_on) errors.push(`${at}.endsOn: 종료일이 시작일보다 앞입니다`);
  else if (p.ends_on !== null && p.ends_on < today) errors.push(`${at}.endsOn: 종료일이 오늘(${today})보다 앞입니다 — 이미 끝난 카드는 만들지 않습니다`);
  return errors;
}

export interface CurationCreate {
  kind: CurationKind;
  targetId: number;
  starts_on: string;
  ends_on: string | null;
  sort?: number;
}

export type CurationPatch = Partial<Pick<CurationCreate, "starts_on" | "ends_on" | "sort">>;

const MAX_SORT = 100_000;
const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;

function dateField(raw: Obj, key: "startsOn" | "endsOn", errors: string[], nullable: boolean): string | null | undefined {
  const v = raw[key];
  if (v === undefined) return undefined;
  if (v === null && nullable) return null;
  if (typeof v !== "string" || !isValidDate(v)) {
    errors.push(`curation.${key}: YYYY-MM-DD 날짜${nullable ? "이거나 null" : ""}이어야 합니다`);
    return undefined;
  }
  return v;
}

/** API 본문 → 저장 값. create는 종류·대상·시작일 필수, patch는 기간·순서만 */
export function parseCurationInput(raw: Obj, mode: "create", today: string): Result<CurationCreate>;
export function parseCurationInput(raw: Obj, mode: "patch", today: string): Result<CurationPatch>;
export function parseCurationInput(raw: Obj, mode: "create" | "patch", today: string): Result<CurationCreate | CurationPatch> {
  const errors: string[] = [];
  const known = mode === "create" ? ["kind", "targetId", "startsOn", "endsOn", "sort"] : ["startsOn", "endsOn", "sort", "kind", "targetId"];
  for (const key of Object.keys(raw)) if (!known.includes(key)) errors.push(`curation.${key}: 모르는 칸입니다`);
  if (mode === "patch" && (raw.kind !== undefined || raw.targetId !== undefined)) errors.push("curation: 종류·대상은 바꿀 수 없습니다 — 카드를 빼고 다시 더하세요");
  if (mode === "create" && !isCurationKind(raw.kind)) errors.push("curation.kind: tracker·story 중 하나여야 합니다");
  if (mode === "create" && !isId(raw.targetId)) errors.push("curation.targetId: 대상 번호가 필요합니다");
  const starts = dateField(raw, "startsOn", errors, false);
  const ends = dateField(raw, "endsOn", errors, true);
  if (mode === "create" && raw.startsOn === undefined) errors.push("curation.startsOn: 시작일이 필요합니다");
  if (raw.sort !== undefined && !(typeof raw.sort === "number" && Number.isInteger(raw.sort) && raw.sort >= 0 && raw.sort <= MAX_SORT)) {
    errors.push(`curation.sort: 0~${MAX_SORT} 정수여야 합니다`);
  }
  if (errors.length) return { ok: false, errors };
  if (mode === "create") {
    const value: CurationCreate = { kind: raw.kind as CurationKind, targetId: raw.targetId as number, starts_on: starts!, ends_on: ends ?? null };
    if (raw.sort !== undefined) value.sort = raw.sort as number;
    const period = periodErrors(value, today);
    return period.length ? { ok: false, errors: period } : { ok: true, value };
  }
  const value: CurationPatch = {};
  if (starts !== undefined && starts !== null) value.starts_on = starts;
  if (ends !== undefined) value.ends_on = ends;
  if (raw.sort !== undefined) value.sort = raw.sort as number;
  if (Object.keys(value).length === 0) return { ok: false, errors: ["curation: 바꿀 칸이 없습니다"] };
  return { ok: true, value };
}

export function parseCurationOrder(raw: Obj): Result<{ kind: CurationKind; ids: number[] }> {
  const errors: string[] = [];
  for (const key of Object.keys(raw)) if (key !== "kind" && key !== "ids") errors.push(`order.${key}: 모르는 칸입니다`);
  if (!isCurationKind(raw.kind)) errors.push("order.kind: tracker·story 중 하나여야 합니다");
  const ids = raw.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every(isId)) errors.push("order.ids: 1개 이상 번호 목록이어야 합니다");
  else if (new Set(ids).size !== ids.length) errors.push("order.ids: 같은 번호가 두 번 있습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: { kind: raw.kind as CurationKind, ids: ids as number[] } };
}

/** 다음 순서 값 — 그 종류의 맨 끝 (10 간격) */
export function nextSort(rows: readonly { sort: number }[]): number {
  return rows.reduce((m, r) => Math.max(m, r.sort), 0) + 10;
}

// ── 화면 폼 ───────────────────────────────────────────────

export interface CurationForm {
  targetId: string;
  startsOn: string;
  endsOn: string;
}

/** 더하기 폼 → 본문. 칸 오류 키는 `${base}-target` 같은 칸 id. existing = 그 종류의 지금 배치(상한·겹침을 화면이 먼저 막는다) */
export function curationFormToBody(
  kind: CurationKind,
  form: CurationForm,
  today: string,
  existing: readonly (CurationPeriod & { targetId: number })[],
  base = `curation-new-${kind}`,
): { ok: true; body: Obj } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const targetId = Number(form.targetId);
  if (blank(form.targetId) || !isId(targetId)) errors[`${base}-target`] = kind === "tracker" ? "개정 트래커를 골라 주세요" : "기사를 골라 주세요";
  if (!isValidDate(form.startsOn)) errors[`${base}-starts`] = "시작일을 골라 주세요";
  if (!blank(form.endsOn) && !isValidDate(form.endsOn)) errors[`${base}-ends`] = "종료일을 골라 주세요";
  if (Object.keys(errors).length) return { ok: false, errors };
  const period: CurationPeriod = { starts_on: form.startsOn, ends_on: blank(form.endsOn) ? null : form.endsOn };
  const periodProblem = periodErrors(period, today)[0];
  if (periodProblem) return { ok: false, errors: { [`${base}-ends`]: periodProblem.replace(/^curation\.endsOn: /, "") } };
  const full = capacityError(kind, existing, period);
  if (full) return { ok: false, errors: { [`${base}-starts`]: full } };
  const dup = duplicateTargetError(existing, targetId, period);
  if (dup) return { ok: false, errors: { [`${base}-target`]: dup } };
  return { ok: true, body: { kind, targetId, startsOn: period.starts_on, endsOn: period.ends_on } };
}

/** 지금 상한만큼 보이는가 — 화면이 [카드 더하기]를 막고 사유를 보인다 (7장째 지정 불가) */
export function fullToday(kind: CurationKind, existing: readonly CurationPeriod[], today: string): boolean {
  return existing.filter((c) => curationStatus(c, today) === "active").length >= CURATION_LIMITS[kind];
}
