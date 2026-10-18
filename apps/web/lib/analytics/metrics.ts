// 지표 대시보드의 세는 규칙 (GROW-01 — PRD-01A 4장·12장, PRD_최종 §3.3, PRD-00 13장, docs/dev/W2-c_설계.md 8.3) — 순수 모듈 (시험 metrics.test.ts).
// 시각은 UTC 밀리초, 날짜는 한국 날짜(UTC+9) YYYY-MM-DD. DB 함수 analytics_metric_sessions는 이벤트를 세션별로 묶어 주기만 하고, 규칙은 모두 여기 있다.
//  · 세션 단위로 센다. 세션은 첫 이벤트 시각이 든 구간(기간·시험 기간/운영 구간)에 속하고, 그 세션의 이벤트는 모두 그 세션 것으로 본다
//  · 봇·편집국·관리자 세션은 어느 지표에도 넣지 않는다 — 세션 안에 봇·편집국 표시가 붙은 이벤트가 하나라도 있으면 그 세션 전체 (GROW-01 '대시보드에서 빠진다')
//  · 분야별 유효 방문 = 분모: 분야 허브를 본 세션(hub_viewed) · 분자: 그 세션 가운데 같은 분야 기사를 30초 이상 읽은(article_engaged) 세션.
//    30초는 브라우저가 정한다(engagement.ts — 29초는 이벤트 0, 30초는 1). 허브와 기사의 순서는 보지 않는다(같은 세션이면 된다)
//  · 재방문율 = 분모: 그 분야를 본(hub_viewed·article_viewed) 측정 동의 방문자(방문자 ID 있음 — 측정 거부·GPC는 저장 자체가 없다) ·
//    분자: 그 분야를 기간 안에서 처음 본 한국 날짜 + 30일 날짜까지(30일째 포함 · 31일째 제외) 다른 세션에서 같은 분야를 다시 본 방문자
//  · 첫 방문 깔때기 = ① 첫 방문 세션(first_visit) → ② 4대 분야 카드·상황 카드 클릭 또는 검색 → ③ ②의 뒤에 기사 30초 열람, 그 뒤에 다음 행동 클릭.
//    첫 방문 문제해결률(보조, BM-L2) = 첫 방문 세션 가운데 기사 30초 열람 뒤 다음 행동을 누른 세션(②를 거치지 않아도 된다)
import { SECTION_KEYS, type SectionKey } from "@/lib/server/public/constants";

export const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

/** PRD 정의 값 — "30일 안에 같은 분야를 다시 본" (기준 날짜 + 30일 날짜까지 포함). 운영 조정값이 아니라 지표 정의라 코드에 둔다 */
export const REVISIT_DAYS = 30;
/** PRD 정의 값 — 전환 후 "첫 4주 기준선" */
export const BASELINE_DAYS = 28;
/** 기간 고르기 — 최근 N일(오늘 포함) */
export const PRESET_DAYS = [7, 30, 90] as const;
export const DEFAULT_PRESET_DAYS = 30;
/** 직접 고른 기간의 최대 길이 — 원본 이벤트 보존(analytics.retention_days 씨앗 395일)보다 길 필요가 없다 */
export const MAX_RANGE_DAYS = 400;

/** 지표가 쓰는 이벤트 — DB 함수에 이 순서로 넘기고, 응답의 이름 번호는 이 목록의 번호다 */
export const METRIC_EVENT_NAMES = [
  "hub_viewed",
  "article_viewed",
  "article_engaged",
  "home_entry_clicked",
  "situation_card_clicked",
  "search_submitted",
  "next_action_clicked",
] as const;
export type MetricEventName = (typeof METRIC_EVENT_NAMES)[number];

/** 그 분야를 '본' 이벤트 (재방문율) — PRD-01A 12장 hub_viewed·article_viewed의 '쓰는 지표: 재방문율' */
const SECTION_VIEWS: ReadonlySet<MetricEventName> = new Set(["hub_viewed", "article_viewed"]);
/** 깔때기 ② — 4대 분야 카드 · 상황 카드 · 검색 */
export const FUNNEL_ENTRY_NAMES = ["home_entry_clicked", "situation_card_clicked", "search_submitted"] as const satisfies readonly MetricEventName[];
const ENTRY_SET: ReadonlySet<MetricEventName> = new Set(FUNNEL_ENTRY_NAMES);

// ── 한국 날짜 ─────────────────────────────────────────────

/** 시각 → 한국 날짜 */
export const kstDate = (ms: number): string => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
/** 한국 날짜 0시의 시각 */
export const kstDayStart = (date: string): number => Date.parse(`${date}T00:00:00+09:00`);

/** 날짜 + n일 (달력 날짜 — 한국에는 일광 절약 시간이 없어 하루는 늘 24시간) */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD이고 실제 있는 날짜 */
export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** a에서 b까지 며칠 (같은 날 0) */
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

// ── 기간 ──────────────────────────────────────────────────

export type PeriodKind = "recent" | "custom" | "baseline";

export interface Period {
  kind: PeriodKind;
  /** 최근 N일의 N (직접 고른 기간·기준선은 날 수) */
  days: number;
  /** 한국 날짜 — 첫날 · 끝날 (둘 다 포함) */
  from: string;
  to: string;
  /** [start, end) — 첫날 0시 · 끝날 다음 날 0시 (한국 시각) */
  start: number;
  end: number;
}

export interface PeriodQuery {
  period?: string;
  from?: string;
  to?: string;
}

export interface PeriodChoice {
  period: Period;
  /** 고른 기간을 쓸 수 없어 기본 기간(최근 30일)으로 보일 때의 이유 */
  error: string | null;
}

function range(kind: PeriodKind, from: string, to: string): Period {
  return { kind, days: daysBetween(from, to) + 1, from, to, start: kstDayStart(from), end: kstDayStart(addDays(to, 1)) };
}

const recent = (today: string, days: number) => range("recent", addDays(today, -(days - 1)), today);

/**
 * 화면 주소의 기간 → 기간. 최근 N일은 오늘(한국 날짜) 포함 N일. 직접 고른 기간은 오늘까지·최대 400일.
 * 기준선(baseline)은 전환일부터 28일(첫 4주) — 아직 28일이 지나지 않았으면 오늘까지.
 */
export function resolvePeriod(query: PeriodQuery, now: number, cutover: string | null): PeriodChoice {
  const today = kstDate(now);
  const fallback = (error: string | null): PeriodChoice => ({ period: recent(today, DEFAULT_PRESET_DAYS), error });
  const p = query.period ?? "";
  if (p === "") return fallback(null);
  const preset = PRESET_DAYS.find((d) => String(d) === p);
  if (preset) return { period: recent(today, preset), error: null };
  if (p === "baseline") {
    if (cutover === null) return fallback("운영 도메인 전환일이 아직 없어 기준선 기간을 정할 수 없습니다");
    if (cutover > today) return fallback(`전환일(${cutover})이 아직 오지 않아 기준선 기간이 없습니다`);
    const last = addDays(cutover, BASELINE_DAYS - 1);
    return { period: range("baseline", cutover, last < today ? last : today), error: null };
  }
  if (p === "custom") {
    const { from, to } = query;
    if (!isDate(from) || !isDate(to)) return fallback("시작일과 끝날을 YYYY-MM-DD 날짜로 적어 주세요");
    if (from > to) return fallback("시작일이 끝날보다 늦습니다");
    if (to > today) return fallback(`끝날은 오늘(${today})까지 고를 수 있습니다`);
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return fallback(`기간은 ${MAX_RANGE_DAYS}일까지 고를 수 있습니다`);
    return { period: range("custom", from, to), error: null };
  }
  return fallback("알 수 없는 기간입니다");
}

// ── 운영 도메인 전환일 설정 (settings.domain_cutover — 설계 2.6) ──

export const CUTOVER_SETTING_KEY = "domain_cutover";

export interface DomainCutover {
  version: string;
  /** 한국 날짜 — null이면 전환 전 */
  date: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 설정 값 검사 — 관리자 설정 화면·설정 API와 대시보드가 같은 검사. current는 지금 저장된 값(버전 규칙) */
export function checkDomainCutover(value: unknown, current?: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다 — { \"version\": \"…\", \"date\": \"YYYY-MM-DD\" 또는 null }"];
  const errors: string[] = [];
  for (const k of ["version", "date"]) if (value[k] === undefined) errors.push(`${k}: 필요합니다`);
  for (const k of Object.keys(value)) if (k !== "version" && k !== "date") errors.push(`${k}: 모르는 칸입니다`);
  if (value.version !== undefined && (typeof value.version !== "string" || value.version.trim() === "" || value.version.length > 80)) errors.push("version: 버전 글자가 필요합니다");
  if (value.date !== undefined && value.date !== null && !isDate(value.date)) errors.push("date: 한국 날짜 YYYY-MM-DD 또는 null(전환 전)이어야 합니다");
  if (errors.length === 0 && isObj(current) && current.version === value.version && current.date !== value.date) {
    errors.push(`version: 값을 바꾸면 버전도 바꿔야 합니다 (지금 ${String(current.version)})`);
  }
  return errors;
}

/** 대시보드의 전환일 읽기 — 설정이 없거나 모양이 틀리면 전환일 없음으로 보고(모두 시험 기간) 그 문제를 알린다 */
export function readCutover(value: unknown, exists: boolean): { date: string | null; problem: string | null } {
  if (!exists) return { date: null, problem: "전환일 설정(domain_cutover)이 없습니다 — 모두 시험 기간으로 봅니다" };
  const errors = checkDomainCutover(value);
  if (errors.length) return { date: null, problem: `전환일 설정이 틀렸습니다(${errors[0]}) — 모두 시험 기간으로 봅니다` };
  return { date: (value as DomainCutover).date, problem: null };
}

// ── 시험 기간 · 운영 구간 (GROW-01 '전환일 이전 수치는 시험 기간으로 따로') ──

export type SegmentKind = "trial" | "live";

export interface Segment {
  kind: SegmentKind;
  from: string;
  to: string;
  start: number;
  end: number;
}

/** 전환일(그날 0시부터 운영)로 기간을 나눈다 — 전환일이 없으면 모두 시험 기간 */
export function splitAtCutover(period: Period, cutover: string | null): Segment[] {
  const seg = (kind: SegmentKind, from: string, to: string): Segment => ({ kind, from, to, start: kstDayStart(from), end: kstDayStart(addDays(to, 1)) });
  if (cutover === null || cutover > period.to) return [seg("trial", period.from, period.to)];
  if (cutover <= period.from) return [seg("live", period.from, period.to)];
  return [seg("trial", period.from, addDays(cutover, -1)), seg("live", cutover, period.to)];
}

// ── 세션 묶음 (DB 함수 응답) ─────────────────────────────

export interface MetricEvent {
  name: MetricEventName;
  section: SectionKey | null;
  at: number;
}

export interface MetricSession {
  /** 방문자 번호 (응답 안에서만 쓰는 번호) — 측정 동의 방문자 ID가 없으면 null */
  visitor: number | null;
  firstVisit: boolean;
  bot: boolean;
  staff: boolean;
  /** 첫 이벤트 시각 (이름과 관계없이) */
  start: number;
  /** 지표 이벤트 — 시각 순 */
  events: readonly MetricEvent[];
}

export type MetricSessionsRead = { over: false; sessions: MetricSession[] } | { over: true; count: number };

const isSection = (v: unknown): v is SectionKey => typeof v === "string" && (SECTION_KEYS as readonly string[]).includes(v);
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** DB 함수 응답 → 세션 목록. 모양이 틀리면 오류(우리 함수가 만든 값이라 틀리면 고장이다) — 받은 값은 문장에 넣지 않는다 */
export function decodeMetricSessions(payload: unknown, fromMs: number): MetricSessionsRead {
  const bad = (what: string) => new Error(`지표 응답 모양이 틀렸습니다 (${what})`);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw bad("객체 아님");
  const p = payload as Record<string, unknown>;
  if (p.over === true) {
    if (!isCount(p.count)) throw bad("count");
    return { over: true, count: p.count };
  }
  if (p.over !== false || !Array.isArray(p.sessions)) throw bad("sessions");
  const sessions = p.sessions.map((row, i): MetricSession => {
    if (!Array.isArray(row) || row.length !== 6) throw bad(`sessions[${i}]`);
    const [visitor, firstVisit, bot, staff, start, events] = row as unknown[];
    if (!(visitor === null || (isCount(visitor) && visitor >= 1))) throw bad(`sessions[${i}].visitor`);
    if (typeof firstVisit !== "boolean" || typeof bot !== "boolean" || typeof staff !== "boolean") throw bad(`sessions[${i}].flags`);
    if (!isCount(start) || !Array.isArray(events)) throw bad(`sessions[${i}].start`);
    return {
      visitor: visitor as number | null,
      firstVisit,
      bot,
      staff,
      start: fromMs + start,
      events: events.map((e, j): MetricEvent => {
        if (!Array.isArray(e) || e.length !== 3) throw bad(`sessions[${i}].events[${j}]`);
        const [n, section, at] = e as unknown[];
        const name = typeof n === "number" ? METRIC_EVENT_NAMES[n] : undefined;
        if (!name || !(section === null || isSection(section)) || !isCount(at)) throw bad(`sessions[${i}].events[${j}]`);
        return { name, section: section as SectionKey | null, at: fromMs + at };
      }),
    };
  });
  return { over: false, sessions };
}

// ── 세기 ──────────────────────────────────────────────────

/** 지표에 넣는 세션 — 봇·편집국·관리자 세션은 0 */
export const countable = (s: MetricSession): boolean => !s.bot && !s.staff;
const inSegment = (s: MetricSession, seg: { start: number; end: number }) => s.start >= seg.start && s.start < seg.end;

export interface Ratio {
  numerator: number;
  denominator: number;
}

/** 비율 (0~1) — 분모 0이면 null (화면은 '—'와 '분모 0') */
export const ratio = (r: Ratio): number | null => (r.denominator === 0 ? null : r.numerator / r.denominator);

const perSection = <T>(make: () => T): Record<SectionKey, T> => Object.fromEntries(SECTION_KEYS.map((k) => [k, make()])) as Record<SectionKey, T>;

export interface Exclusions {
  /** 구간에서 시작한 세션 전부 */
  sessions: number;
  bot: number;
  /** 편집국·관리자 (봇 표시가 함께 있으면 봇으로 센다) */
  staff: number;
}

export function countExclusions(sessions: readonly MetricSession[], seg: Segment): Exclusions {
  const out: Exclusions = { sessions: 0, bot: 0, staff: 0 };
  for (const s of sessions) {
    if (!inSegment(s, seg)) continue;
    out.sessions += 1;
    if (s.bot) out.bot += 1;
    else if (s.staff) out.staff += 1;
  }
  return out;
}

export interface ValidVisits {
  sections: Record<SectionKey, Ratio>;
  /** 전체 — 허브를 하나라도 본 세션 · 그중 본 허브와 같은 분야 기사를 30초 이상 읽은 세션 (분야 합보다 작을 수 있다) */
  total: Ratio;
}

/** 분야별 유효 방문 (GROW-01 · PRD_최종 §3.3) */
export function countValidVisits(sessions: readonly MetricSession[], seg: Segment): ValidVisits {
  const sections = perSection<Ratio>(() => ({ numerator: 0, denominator: 0 }));
  const total: Ratio = { numerator: 0, denominator: 0 };
  for (const s of sessions) {
    if (!countable(s) || !inSegment(s, seg)) continue;
    const hubs = new Set<SectionKey>();
    const engaged = new Set<SectionKey>();
    for (const e of s.events) {
      if (e.section === null) continue;
      if (e.name === "hub_viewed") hubs.add(e.section);
      else if (e.name === "article_engaged") engaged.add(e.section);
    }
    if (hubs.size === 0) continue;
    total.denominator += 1;
    let valid = false;
    for (const section of hubs) {
      sections[section].denominator += 1;
      if (engaged.has(section)) {
        sections[section].numerator += 1;
        valid = true;
      }
    }
    if (valid) total.numerator += 1;
  }
  return { sections, total };
}

export interface RevisitCount {
  /** 분모 — 그 분야를 본 측정 동의 방문자 */
  visitors: number;
  /** 분자 — 30일 안에 다른 세션에서 같은 분야를 다시 본 방문자 */
  revisited: number;
  /** 아직 다시 오지 않았고 30일 날짜가 오늘 이후라 숫자가 늘 수 있는 방문자 (분모에 들어 있다) */
  pending: number;
}

export interface Revisits {
  sections: Record<SectionKey, RevisitCount>;
  /** 전체 — 분야를 하나라도 본 방문자 · 그중 어느 분야든 같은 분야를 다시 본 방문자 */
  total: RevisitCount;
  /** 분야를 봤지만 방문자 ID가 없는 세션 — 측정 동의 방문자가 아니라 분모에서 뺀다 */
  withoutVisitor: number;
}

interface View {
  at: number;
  session: number;
  inSegment: boolean;
}

/** 재방문율 (GROW-01 · PRD-00 13장 '재방문율은 측정에 동의한 방문자로만') — today는 오늘 한국 날짜(아직 끝나지 않은 30일 창을 알리려고) */
export function countRevisits(sessions: readonly MetricSession[], seg: Segment, today: string): Revisits {
  const views = new Map<number, Map<SectionKey, View[]>>();
  let withoutVisitor = 0;
  sessions.forEach((s, index) => {
    if (!countable(s)) return;
    const own = inSegment(s, seg);
    const seen = s.events.filter((e) => SECTION_VIEWS.has(e.name) && e.section !== null);
    if (s.visitor === null) {
      if (own && seen.length) withoutVisitor += 1;
      return;
    }
    let bySection = views.get(s.visitor);
    if (!bySection) views.set(s.visitor, (bySection = new Map()));
    for (const e of seen) {
      const list = bySection.get(e.section!) ?? [];
      list.push({ at: e.at, session: index, inSegment: own });
      bySection.set(e.section!, list);
    }
  });

  const sections = perSection<RevisitCount>(() => ({ visitors: 0, revisited: 0, pending: 0 }));
  const total: RevisitCount = { visitors: 0, revisited: 0, pending: 0 };
  for (const bySection of views.values()) {
    let counted = false;
    let anyRevisit = false;
    let anyOpen = false;
    for (const [section, list] of bySection) {
      const base = list.filter((v) => v.inSegment).sort((a, b) => a.at - b.at)[0];
      if (!base) continue;
      const lastDay = addDays(kstDate(base.at), REVISIT_DAYS);
      const revisited = list.some((v) => v.session !== base.session && v.at > base.at && kstDate(v.at) <= lastDay);
      const open = !revisited && lastDay >= today;
      const c = sections[section];
      c.visitors += 1;
      if (revisited) c.revisited += 1;
      if (open) c.pending += 1;
      counted = true;
      anyRevisit ||= revisited;
      anyOpen ||= open;
    }
    if (!counted) continue;
    total.visitors += 1;
    if (anyRevisit) total.revisited += 1;
    else if (anyOpen) total.pending += 1;
  }
  return { sections, total, withoutVisitor };
}

export interface Funnel {
  /** ① 첫 방문 세션 */
  firstVisits: number;
  /** ② 그중 4대 분야 카드·상황 카드를 누르거나 검색한 세션 */
  entered: number;
  /** ③ 그중 ②의 뒤에 기사를 30초 이상 읽고, 그 뒤에 다음 행동을 누른 세션 */
  engagedAction: number;
  /** 첫 방문 문제해결 세션 (보조 — ②를 거치지 않아도 된다): 기사 30초 열람 뒤 다음 행동 클릭 */
  solved: number;
}

/** 기사 30초 열람(from 이후 첫 것) 뒤에 다음 행동 클릭이 있나 */
function engagedThenAction(events: readonly MetricEvent[], from: number): boolean {
  const engaged = events.find((e) => e.name === "article_engaged" && e.at >= from);
  return engaged !== undefined && events.some((e) => e.name === "next_action_clicked" && e.at >= engaged.at);
}

/** 첫 방문 깔때기 (GROW-01 보조 지표 · BM-L2) */
export function countFunnel(sessions: readonly MetricSession[], seg: Segment): Funnel {
  const out: Funnel = { firstVisits: 0, entered: 0, engagedAction: 0, solved: 0 };
  for (const s of sessions) {
    if (!countable(s) || !inSegment(s, seg) || !s.firstVisit) continue;
    out.firstVisits += 1;
    if (engagedThenAction(s.events, -Infinity)) out.solved += 1;
    const entry = s.events.find((e) => ENTRY_SET.has(e.name));
    if (!entry) continue;
    out.entered += 1;
    if (engagedThenAction(s.events, entry.at)) out.engagedAction += 1;
  }
  return out;
}

export interface SegmentMetrics {
  segment: Segment;
  exclusions: Exclusions;
  validVisits: ValidVisits;
  revisits: Revisits;
  funnel: Funnel;
}

/** 한 구간의 지표 전부 */
export function computeSegment(sessions: readonly MetricSession[], seg: Segment, today: string): SegmentMetrics {
  return {
    segment: seg,
    exclusions: countExclusions(sessions, seg),
    validVisits: countValidVisits(sessions, seg),
    revisits: countRevisits(sessions, seg, today),
    funnel: countFunnel(sessions, seg),
  };
}

/** DB 함수에 넘기는 읽기 범위 — 세션은 [start, end)에서 시작한 것, 재방문은 끝날 + 30일 날짜가 끝나는 때까지 */
export function readWindow(period: Period): { from: number; to: number; until: number } {
  return { from: period.start, to: period.end, until: kstDayStart(addDays(period.to, REVISIT_DAYS + 1)) };
}
