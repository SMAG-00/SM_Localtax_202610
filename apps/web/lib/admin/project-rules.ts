// 프로젝트 트래커 규칙 (W4 12단계 — docs/dev/W4_설계.md 1장 12단계 · 2.1 · 2.2 · 3장 · 12장 #10, PRD-01B PR-02 · PR-03 · PR-05) — 순수 함수
// DB(마이그레이션 20261023000047 — project_settings_guard · projects_guard · project_events_check · project_events 제약 · project_note_has_amount)와
// 같은 규칙이다 — 한쪽만 바꾸지 않는다. 운영 설정 API(project_types · project_stage_lists)가 지금 쓰고, 프로젝트 관리 API(14단계)가 저장 전에
// 칸마다 사유(422)를 낸다. 서비스를 건너뛴 삽입은 DB가 막는다(설계 8장 '같은 규칙은 DB와 서버 함수 양쪽').
// 가격·분양가·분담금·수익률·시세는 받는 칸 자체가 없다(PR-05) — 메모의 숫자 + 원·%는 저장 경고(막지 않음).
import { LICENSE_TYPES } from "@ltr/editorial";
import { isValidOn, type RegionRouteRow } from "@/lib/site/region-route";

/** 2.1 project.status */
export const PROJECT_STATUSES = ["draft", "public", "hidden"] as const;
/** 2.1 project_event.kind — 단계 기록 · 해당 없는 단계 · 정정 */
export const PROJECT_EVENT_KINDS = ["stage", "not_applicable", "correction"] as const;
export type ProjectEventKind = (typeof PROJECT_EVENT_KINDS)[number];

/** 설정 한도 — 마이그레이션 …47 project_settings_guard와 같다 */
export const PROJECT_LIMITS = { types: 30, stagesMin: 2, stagesMax: 40, label: 40 } as const;
/** 2.2 씨앗 — 둘 다 빈 값(12장 #10, 비면 프로젝트를 만들 수 없다) */
export const PROJECT_SETTING_SEEDS = { project_types: {}, project_stage_lists: {} } as const;

export const PROJECT_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const PROJECT_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const URL_RE = /^https?:\/\/\S+$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 메모의 금액·비율 표현 — 숫자(쉼표·소수점) + 큰 수 낱말(조·억·천·백·만) + 원 또는 %. '원문'·'원본'의 원은 뺀다. DB project_note_has_amount와 같은 식 */
export const NOTE_AMOUNT_RE = /[0-9][0-9,.]*(?:\s*(?:조|억|천|백|만))*\s*(?:원(?!문|본)|%|％)/;

export type ProjectTypes = Record<string, { label: string }>;
export type StageItem = { key: string; label: string };
export type StageLists = Record<string, StageItem[]>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const sameKeys = (v: Obj, keys: readonly string[]) => {
  const own = Object.keys(v).sort();
  return own.length === keys.length && [...keys].sort().every((k, i) => own[i] === k);
};
const labelOk = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= PROJECT_LIMITS.label;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// ── 설정 ─────────────────────────────────────────

/** project_types — { "유형 키": { "label": "1~40자" } }, 0~30개, 글자 중복 0 */
export function projectTypesErrors(value: unknown): string[] {
  if (!isObj(value)) return ['값은 { "유형 키": { "label": "글자" } } 객체입니다 (빈 값은 {})'];
  const errors: string[] = [];
  const entries = Object.entries(value);
  if (entries.length > PROJECT_LIMITS.types) errors.push(`사업 유형은 ${PROJECT_LIMITS.types}개까지입니다`);
  const labels = new Set<string>();
  for (const [k, v] of entries) {
    if (!PROJECT_KEY_RE.test(k)) errors.push(`${k}: 사업 유형 키는 영문 소문자로 시작하는 영문 소문자·숫자·_ 2~40자입니다`);
    if (!isObj(v) || !sameKeys(v, ["label"]) || !labelOk(v.label)) {
      errors.push(`${k}: 값은 { "label": "1~${PROJECT_LIMITS.label}자" }입니다`);
      continue;
    }
    const label = v.label.trim();
    if (labels.has(label)) errors.push(`${k}: 사업 유형 글자 '${label}'가 두 번 있습니다`);
    labels.add(label);
  }
  return errors;
}

/** project_stage_lists — { "유형 키": [{ "key", "label" }, …] }, 유형마다 2~40단계, 키·글자 중복 0 (유형이 project_types에 있는지는 projectSettingsCrossErrors) */
export function projectStageListsErrors(value: unknown): string[] {
  if (!isObj(value)) return ['값은 { "유형 키": [{ "key": "단계 키", "label": "글자" }, …] } 객체입니다 (빈 값은 {})'];
  const errors: string[] = [];
  for (const [type, list] of Object.entries(value)) {
    if (!Array.isArray(list) || list.length < PROJECT_LIMITS.stagesMin || list.length > PROJECT_LIMITS.stagesMax) {
      errors.push(`${type}: 단계 목록은 ${PROJECT_LIMITS.stagesMin}~${PROJECT_LIMITS.stagesMax}단계 배열입니다 (첫 단계 … 마지막 단계 순서)`);
      continue;
    }
    const keys = new Set<string>();
    const labels = new Set<string>();
    list.forEach((item, i) => {
      if (!isObj(item) || !sameKeys(item, ["key", "label"]) || typeof item.key !== "string" || !PROJECT_KEY_RE.test(item.key) || !labelOk(item.label)) {
        errors.push(`${type}[${i}]: 단계는 { "key": "영문 소문자·숫자·_ 2~40자", "label": "1~${PROJECT_LIMITS.label}자" }입니다`);
        return;
      }
      if (keys.has(item.key)) errors.push(`${type}[${i}]: 단계 키 ${item.key}가 두 번 있습니다`);
      const label = item.label.trim();
      if (labels.has(label)) errors.push(`${type}[${i}]: 단계 글자 '${label}'가 두 번 있습니다`);
      keys.add(item.key);
      labels.add(label);
    });
  }
  return errors;
}

/** 두 설정 사이 — 단계 목록의 유형은 project_types에 있어야 한다. other = 다른 키의 지금 값 */
export function projectSettingsCrossErrors(key: "project_types" | "project_stage_lists", value: unknown, other: unknown): string[] {
  if (!isObj(value)) return [];
  const otherObj = isObj(other) ? other : {};
  if (key === "project_stage_lists") {
    return Object.keys(value)
      .filter((k) => !Object.hasOwn(otherObj, k))
      .map((k) => `${k}: project_types에 없는 사업 유형입니다 — 사업 유형을 먼저 넣으세요`);
  }
  return Object.keys(otherObj)
    .filter((k) => !Object.hasOwn(value, k))
    .map((k) => `${k}: 단계 목록이 있는 사업 유형은 뺄 수 없습니다 — 먼저 project_stage_lists에서 빼세요`);
}

export const parseProjectTypes = (value: unknown): ProjectTypes | null => (projectTypesErrors(value).length ? null : (value as ProjectTypes));
export const parseStageLists = (value: unknown): StageLists | null => (projectStageListsErrors(value).length ? null : (value as StageLists));

/** 그 사업 유형의 단계 키 (순서대로). 목록이 없으면 [] — 프로젝트를 만들 수 없다 */
export function stageKeysOf(lists: StageLists | null, type: string): string[] {
  const list = lists && Object.hasOwn(lists, type) ? lists[type] : undefined;
  return list ? list.map((s) => s.key) : [];
}

// ── 프로젝트 ─────────────────────────────────────

/** 프로젝트 지역 — 오늘(KST 날짜 today) 유효한 행정구역만 (DB projects_guard와 같다) */
export function projectRegionErrors(code: unknown, row: Pick<RegionRouteRow, "valid_from" | "valid_to"> | null | undefined, today: string): string[] {
  if (typeof code !== "string" || !/^[0-9]{10}$/.test(code)) return ["region_code: 법정동코드 10자리가 필요합니다"];
  return row && isValidOn(row, today) ? [] : [`region_code: ${code}는 오늘 유효한 행정구역(regions)이 아닙니다`];
}

/** 프로젝트 사업 유형 — 단계 목록이 있는 유형만 */
export function projectTypeErrors(type: unknown, types: ProjectTypes | null, lists: StageLists | null): string[] {
  if (typeof type !== "string" || !PROJECT_KEY_RE.test(type)) return ["project_type: 사업 유형 키가 필요합니다"];
  if (!types || !Object.hasOwn(types, type) || stageKeysOf(lists, type).length === 0) {
    return [`project_type: 사업 유형 ${type}의 단계 목록이 없습니다 — 사업 유형·단계 목록을 먼저 넣으세요 (편집국 초안 + 감수)`];
  }
  return [];
}

// ── 단계 기록 ────────────────────────────────────

export interface ProjectEventRow {
  id: number;
  kind: ProjectEventKind;
  stage: string | null;
  public: boolean;
  correction_of: number | null;
  recorded_at: string;
}

export interface ProjectEventInput {
  kind?: unknown;
  stage?: unknown;
  notice_no?: unknown;
  notice_date?: unknown;
  issuer?: unknown;
  source_url?: unknown;
  snapshot_id?: unknown;
  license_type?: unknown;
  note?: unknown;
  correction_of?: unknown;
  reason?: unknown;
  public?: unknown;
}

const correctedIds = (events: readonly ProjectEventRow[]) => new Set(events.flatMap((e) => (e.correction_of === null ? [] : [e.correction_of])));
/** 정정되지 않은 기록 */
export const effectiveEvents = (events: readonly ProjectEventRow[]) => {
  const corrected = correctedIds(events);
  return events.filter((e) => !corrected.has(e.id));
};
/** 현재 단계를 정하는 기록인가 — 단계가 있고 해당 없음이 아님 */
const bearsStage = (e: Pick<ProjectEventRow, "kind" | "stage">) => e.stage !== null && e.kind !== "not_applicable";

function validDate(v: unknown): boolean {
  const m = typeof v === "string" ? DATE_RE.exec(v) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
const positiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * 단계 기록 한 건의 저장 검사 — 칸마다 "칸: 문장". ctx.stageKeys = 그 프로젝트 사업 유형의 단계 키(순서대로), ctx.events = 그 프로젝트의 기록 전부
 * (DB 제약 project_events_* · 트리거 project_events_check와 같다)
 */
export function projectEventErrors(input: ProjectEventInput, ctx: { stageKeys: readonly string[]; events: readonly ProjectEventRow[] }): string[] {
  const errors: string[] = [];
  const kind = input.kind;
  if (typeof kind !== "string" || !(PROJECT_EVENT_KINDS as readonly string[]).includes(kind)) {
    return [`kind: ${PROJECT_EVENT_KINDS.join("·")} 중 하나입니다`];
  }
  const stage = input.stage === undefined || input.stage === null || input.stage === "" ? null : input.stage;
  let stageOk = false;
  if (stage === null) {
    if (kind !== "correction") errors.push("stage: 단계가 필요합니다");
  } else if (typeof stage !== "string" || !ctx.stageKeys.includes(stage)) {
    errors.push(`stage: ${String(stage)}는 이 사업 유형의 단계 목록에 없습니다`);
  } else {
    stageOk = true;
  }

  // 단계를 정하는 기록 — 고시 번호·고시일·고시 기관·원문 URL·원본 스냅샷·공공누리 유형 (PR-03)
  if (stage !== null && kind !== "not_applicable") {
    if (!text(input.notice_no)) errors.push("notice_no: 고시 번호가 필요합니다 (PR-03)");
    if (!validDate(input.notice_date)) errors.push("notice_date: 고시일(YYYY-MM-DD)이 필요합니다 (PR-03)");
    if (!text(input.issuer)) errors.push("issuer: 고시 기관이 필요합니다 (PR-03)");
    if (!URL_RE.test(text(input.source_url))) errors.push("source_url: 고시 원문 주소(http·https)가 필요합니다 (PR-03)");
    if (!positiveInt(input.snapshot_id)) errors.push("snapshot_id: 원본 스냅샷이 필요합니다 (PR-03)");
    if (typeof input.license_type !== "string" || !(LICENSE_TYPES as readonly string[]).includes(input.license_type)) {
      errors.push("license_type: 원문의 공공누리 유형이 필요합니다 (PR-07)");
    }
  }
  if (kind !== "stage" && !text(input.reason)) errors.push(kind === "correction" ? "reason: 정정 사유가 필요합니다" : "reason: 이 단계가 없는 사유가 필요합니다");
  if (input.public !== undefined && typeof input.public !== "boolean") errors.push("public: true 또는 false입니다");
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") errors.push("note: 글자입니다");

  const effective = effectiveEvents(ctx.events);
  if (kind === "correction") {
    const target = positiveInt(input.correction_of) ? ctx.events.find((e) => e.id === input.correction_of) : undefined;
    if (!target) {
      errors.push("correction_of: 같은 프로젝트의 기록 번호가 필요합니다");
    } else {
      if (correctedIds(ctx.events).has(target.id)) errors.push(`correction_of: 이미 정정된 기록(${target.id})입니다 — 정정은 한 번만, 다시 고치려면 정정 기록을 정정하세요`);
      if (stageOk && effective.some((e) => e.id !== target.id && e.stage === stage)) errors.push(`stage: 이미 기록된 단계입니다 (${String(stage)}) — 그 기록을 정정하세요`);
    }
    return errors;
  }
  if (input.correction_of !== undefined && input.correction_of !== null) errors.push("correction_of: 정정 기록(kind correction)에만 씁니다");
  if (!stageOk) return errors;
  if (effective.some((e) => e.stage === stage)) {
    errors.push(`stage: 이미 기록된 단계입니다 (${String(stage)}) — 고치려면 정정 기록을 쓰세요`);
    return errors;
  }
  if (kind === "stage") {
    const pos = ctx.stageKeys.indexOf(stage as string);
    const max = Math.max(-1, ...effective.filter(bearsStage).map((e) => ctx.stageKeys.indexOf(e.stage as string)));
    if (pos < max) errors.push(`stage: 앞 순서 단계로 돌아가는 기록은 거부합니다 (현재 ${ctx.stageKeys[max]} → 새 기록 ${String(stage)}) — 잘못된 기록은 정정 기록으로 고치세요`);
  }
  return errors;
}

/** 메모 저장 경고 — 막지 않는다 (PR-05) */
export function projectNoteWarnings(note: unknown): string[] {
  return typeof note === "string" && NOTE_AMOUNT_RE.test(note)
    ? ["note: 메모에 숫자 + 원·% 표현이 있습니다 — 가격 정보는 편집 승인을 거친 기사로만 씁니다 (PR-05 저장 경고)"]
    : [];
}

/** 현재 단계 — 정정되지 않은 공개 단계 기록 가운데 단계 목록 순서가 가장 늦은 것 (뷰 project_current_stages와 같다) */
export function currentStage(events: readonly ProjectEventRow[], stageKeys: readonly string[]): ProjectEventRow | null {
  let best: { e: ProjectEventRow; pos: number } | null = null;
  for (const e of effectiveEvents(events)) {
    if (!e.public || !bearsStage(e)) continue;
    const pos = stageKeys.indexOf(e.stage as string);
    if (pos < 0) continue;
    if (!best || pos > best.pos || (pos === best.pos && (e.recorded_at > best.e.recorded_at || (e.recorded_at === best.e.recorded_at && e.id > best.e.id)))) best = { e, pos };
  }
  return best?.e ?? null;
}

/** 공개 전환 검사 — 공개 단계 기록 1건 이상 + 데이터 출처·정보 확인일 (DB projects_guard와 같다) */
export function projectPublishErrors(
  project: { source_name: string | null; last_verified_at: string | null },
  events: readonly ProjectEventRow[],
  stageKeys: readonly string[],
): string[] {
  const errors: string[] = [];
  if (currentStage(events, stageKeys) === null) errors.push("status: 공개 단계 기록이 0건인 프로젝트는 공개할 수 없습니다 (PR-02)");
  if (!text(project.source_name)) errors.push("source_name: 데이터 출처가 있어야 공개합니다 (PR-02 데이터 출처 줄)");
  if (!project.last_verified_at) errors.push("last_verified_at: 정보 확인일이 있어야 공개합니다 (PR-02 데이터 출처 줄)");
  return errors;
}
