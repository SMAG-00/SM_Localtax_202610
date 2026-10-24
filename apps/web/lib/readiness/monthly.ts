// 제휴 준비 월 마감·임의 3개월 조합·부정평가 누적 (W7 · NAV-17·19·20, docs/dev/W7_설계.md) — 순수 모듈 (시험 monthly.test.ts).
//  · 숫자 기준(합격선·배점·기사 수)은 이 파일에 없다 — 규정 버전의 판단 값(news_partner_requirement_rules)과 설정에서만 온다 (NAV-13 저장소 검사)
//  · 자체 생산 분자는 보도기사(reported_news)만 — digest·정보 목록·opinion·sponsored·분양 정보는 분자에 넣지 않는다 (NAV-17)
//  · 지표마다 분자·분모·정의·제외 조건을 함께 남긴다. 0인 지표는 0으로 보이고 경고한다
import { kstDate } from "@/lib/analytics/metrics";
import { windowArticles, type Facts } from "./production";
import { monthWindow, type MonthWindow } from "./windows";

export interface MetricValue {
  numerator: number;
  /** 비율·1인당 지표의 분모. 건수 지표는 null */
  denominator: number | null;
  definition: string;
  exclusions: string;
}

export type MonthMetrics = Record<string, MetricValue>;

export const METRIC_KEYS = ["own_ratio", "monthly_output", "feature_output", "per_reporter", "evidence_rate", "similarity_judged", "column_share"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** 0이면 경고하는 지표 (규정상 하나라도 0점이면 탈락이라는 점을 반영 — NAV-17). 비율의 분모가 0이면 판단하지 않는다 */
export const ZERO_WATCH: readonly MetricKey[] = ["own_ratio", "monthly_output", "feature_output", "per_reporter", "evidence_rate"];

export const METRIC_LABELS: Readonly<Record<MetricKey, string>> = {
  own_ratio: "자체 생산 비율",
  monthly_output: "월 송출량(전송 전 발행량)",
  feature_output: "기획·탐사 실적",
  per_reporter: "기자 1인당 생산량",
  evidence_rate: "근거 충족률",
  similarity_judged: "유사 기사 판정",
  column_share: "칼럼 비중",
};

const OWN = "reported_news";
const OPINION = "opinion";
const FEATURE_KINDS = new Set(["feature", "investigative"]);

/** 'YYYY-MM' → 그 달의 한국 날짜 기준 기간 (완결된 한 달) */
export function monthWindowOf(month: string): MonthWindow {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return monthWindow(1, "closed_months", Date.parse(`${next}-01T12:00:00+09:00`));
}

export const isMonth = (v: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** 한국 날짜의 직전 완결 달 'YYYY-MM' */
export function lastClosedMonth(now: number): string {
  const today = kstDate(now);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** 직전 완결 달부터 거꾸로 n개월 (오래된 달이 앞) */
export function recentClosedMonths(now: number, n: number): string[] {
  const out: string[] = [];
  let [y, m] = lastClosedMonth(now).split("-").map(Number) as [number, number];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    if (m === 1) {
      y -= 1;
      m = 12;
    } else m -= 1;
  }
  return out;
}

/**
 * 기자 수 (기자 1인당 생산량의 분모) — 글을 쓴 사람 가운데 내부(고용 형태가 external이 아닌) 기자는 한 명씩,
 * 외부 기고자는 규정 버전 값 merge_external이 참이면 전부 합쳐 1명, 아니면 한 명씩 (NAV-19)
 */
export function reporterCount(authorIds: readonly number[], people: Map<number, { employment: string | null }>, mergeExternal: boolean): number {
  const ids = [...new Set(authorIds)];
  const external = ids.filter((id) => people.get(id)?.employment === "external");
  const internal = ids.length - external.length;
  return internal + (mergeExternal ? (external.length > 0 ? 1 : 0) : external.length);
}

export function monthlyMetrics(facts: Facts, window: MonthWindow, opts: { mergeExternal: boolean }): MonthMetrics {
  const base = windowArticles(facts, window);
  const total = base.length;
  const own = base.filter((a) => a.contentType === OWN);
  const ownWithEvidence = own.filter((a) => a.evidenceVerified > 0).length;
  const reporters = reporterCount(
    own.flatMap((a) => (a.authorId === null ? [] : [a.authorId])),
    facts.people,
    opts.mergeExternal,
  );
  const blocked = new Set(facts.similarityChecks.filter((c) => c.status === "blocked" && c.at >= window.start && c.at < window.end).map((c) => c.articleId)).size;
  const noOwnExclusion = "digest·정보 목록·분양 정보·opinion(칼럼)·sponsored는 분자에 넣지 않음";
  return {
    own_ratio: { numerator: own.length, denominator: total, definition: "자체 취재 보도기사 ÷ 월 발행", exclusions: noOwnExclusion },
    monthly_output: { numerator: total, denominator: null, definition: "월 발행 기사 수(전송 전에는 발행량)", exclusions: "이관 기사·보류·삭제 제외" },
    feature_output: {
      numerator: base.filter((a) => a.assignmentKind !== null && FEATURE_KINDS.has(a.assignmentKind)).length,
      denominator: null,
      definition: "기획·탐사 기획에서 나온 발행 기사 수",
      exclusions: "일반 기획 제외",
    },
    per_reporter: { numerator: own.length, denominator: reporters, definition: "자체 취재 보도기사 ÷ 기자 수", exclusions: opts.mergeExternal ? "외부 기고자는 1명으로 합산(규정 버전 값)" : "외부 기고자도 한 명씩 셈" },
    evidence_rate: { numerator: ownWithEvidence, denominator: own.length, definition: "확인된 취재 근거가 있는 자체 취재 기사 ÷ 자체 취재 기사", exclusions: "자체 취재가 아닌 기사 제외" },
    similarity_judged: { numerator: blocked, denominator: total, definition: "기간 안 유사도 점검에서 기준을 넘은 원고 수 ÷ 월 발행", exclusions: "발행되지 않은 원고도 분자에 포함" },
    column_share: { numerator: base.filter((a) => a.contentType === OPINION).length, denominator: total, definition: "칼럼(opinion) ÷ 월 발행", exclusions: "—" },
  };
}

/** 지표 값 — 분모가 있으면 비율(분자÷분모, 분모 0이면 null), 없으면 건수 */
export function valueOf(m: Pick<MetricValue, "numerator" | "denominator">): number | null {
  if (m.denominator === null) return m.numerator;
  return m.denominator === 0 ? null : m.numerator / m.denominator;
}

/** 0이어서 경고할 지표 — 분자가 0이고(분모가 있으면 분모는 0이 아닐 때) ZERO_WATCH에 든 것 */
export function zeroMetrics(metrics: MonthMetrics): MetricKey[] {
  return ZERO_WATCH.filter((k) => {
    const m = metrics[k];
    if (!m || m.numerator !== 0) return false;
    return m.denominator === null || m.denominator > 0;
  });
}

/** 칼럼 비중이 기준(설정 readiness_warn.columnShareMax, 0~1)을 넘는가 — 기준과 같은 값은 경고 아님 */
export function columnShareExceeded(metrics: MonthMetrics, max: number | null): boolean {
  if (max === null) return false;
  const v = metrics.column_share ? valueOf(metrics.column_share) : null;
  return v !== null && v > max;
}

// ── 임의 3개월 조합 ──────────────────────────────────────

export interface ComboResult {
  months: string[];
  metrics: MonthMetrics;
}

/** n개 중 k개 조합 (사전순) */
export function choose<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) {
      acc.push(items[i]!);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  if (k >= 1 && items.length >= k) pick(0, []);
  return out;
}

export function sumMetrics(rows: readonly MonthMetrics[]): MonthMetrics {
  const first = rows[0]!;
  const out: MonthMetrics = {};
  for (const key of Object.keys(first)) {
    const parts = rows.map((r) => r[key]).filter((m): m is MetricValue => m !== undefined);
    const base = parts[0]!;
    out[key] = {
      ...base,
      numerator: parts.reduce((s, m) => s + m.numerator, 0),
      denominator: base.denominator === null ? null : parts.reduce((s, m) => s + (m.denominator ?? 0), 0),
    };
  }
  return out;
}

export type CombosOutcome = { kind: "insufficient"; months: number } | { kind: "ok"; combos: ComboResult[] };

/**
 * 마감된 달들의 3개월 조합 — 달이 12개면 220개, n개(3 ≤ n < 12)면 C(n,3)개, 3개월 미만이면 기간 부족.
 * 조합 정의(연속 여부)는 규정 원문을 따르고 확정 전에는 연속이 아닌 모든 조합으로 계산한다 [확인 필요] — onlyConsecutive가 참이면 연속 3개월만.
 */
export function threeMonthCombos(rows: readonly { month: string; metrics: MonthMetrics }[], opts: { onlyConsecutive?: boolean } = {}): CombosOutcome {
  const sorted = [...rows].sort((a, b) => (a.month < b.month ? -1 : 1));
  if (sorted.length < 3) return { kind: "insufficient", months: sorted.length };
  const idx = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  const all = choose(sorted, 3).filter((c) => !opts.onlyConsecutive || (idx(c[1]!.month) - idx(c[0]!.month) === 1 && idx(c[2]!.month) - idx(c[1]!.month) === 1));
  return { kind: "ok", combos: all.map((c) => ({ months: c.map((r) => r.month), metrics: sumMetrics(c.map((r) => r.metrics)) })) };
}

export interface LowestCombo {
  key: MetricKey;
  value: number;
  months: string[];
  metric: MetricValue;
}

/** 지표마다 값이 가장 낮은 조합 (값이 없는 조합은 건너뜀, 같으면 앞선 달 조합) */
export function lowestCombos(combos: readonly ComboResult[]): LowestCombo[] {
  const out: LowestCombo[] = [];
  for (const key of METRIC_KEYS) {
    let best: LowestCombo | null = null;
    for (const c of combos) {
      const m = c.metrics[key];
      if (!m) continue;
      const v = valueOf(m);
      if (v === null) continue;
      if (best === null || v < best.value) best = { key, value: v, months: c.months, metric: m };
    }
    if (best) out.push(best);
  }
  return out;
}

// ── 부정평가 누적 (NAV-20) ───────────────────────────────

export interface PenaltyRecord {
  points: number;
  /** 일어난 한국 날짜 YYYY-MM-DD */
  occurredOn: string;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 날짜 + N개월 (같은 날이 없으면 그 달 마지막 날), YYYY-MM-DD */
export function addMonthsToDate(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(Math.min(d, daysInMonth(ny, nm))).padStart(2, "0")}`;
}

const prevDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * 기준일(asOf)까지의 부정평가 누적 점수 — 기록은 일어난 날부터 N개월 뒤 전날까지(마지막 날 포함) 창 안에 있고, 그다음 날에는 빠진다.
 * 기준일 이후에 일어난 기록은 세지 않는다.
 */
export function penaltyTotal(records: readonly PenaltyRecord[], asOf: string, windowMonths: number): number {
  return records
    .filter((r) => r.occurredOn <= asOf && asOf <= prevDay(addMonthsToDate(r.occurredOn, windowMonths)))
    .reduce((s, r) => s + r.points, 0);
}

export function penaltyReached(total: number, rule: { warn_points: number; comparator: "gt" | "gte" }): boolean {
  return rule.comparator === "gt" ? total > rule.warn_points : total >= rule.warn_points;
}

// ── 규정 판단 값 읽기 ────────────────────────────────────

export interface PenaltyRule {
  window_months: number;
  warn_points: number;
  comparator: "gt" | "gte";
}

export function readPenaltyRule(raw: unknown): PenaltyRule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const ok = typeof r.window_months === "number" && Number.isInteger(r.window_months) && r.window_months >= 1 && r.window_months <= 60;
  if (!ok || typeof r.warn_points !== "number" || !(r.warn_points > 0) || (r.comparator !== "gt" && r.comparator !== "gte")) return null;
  return { window_months: r.window_months as number, warn_points: r.warn_points, comparator: r.comparator };
}

export function readMergeExternal(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && (raw as { merge_external?: unknown }).merge_external === true;
}

/** 규정 유사도 기준 → @ltr/similarity RegulationSimilarityRule (버전 글자는 호출하는 쪽이 정한다). 모양이 틀리면 null(내부 기준) */
export function readSimilarityRule(raw: unknown, version: string) {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const ratio = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;
  const cmp = (v: unknown) => v === "gt" || v === "gte";
  if (!ratio(r.sentence_similarity) || !ratio(r.article_ratio) || !cmp(r.sentence_comparator) || !cmp(r.article_comparator)) return null;
  return {
    version,
    sentenceSimilarity: r.sentence_similarity as number,
    sentenceComparator: r.sentence_comparator as "gt" | "gte",
    articleRatio: r.article_ratio as number,
    articleComparator: r.article_comparator as "gt" | "gte",
  };
}

// ── 설정: 경고 기준·다음 접수 목표 (NAV-16·17) ────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** 설정 readiness_warn — 칼럼 비중 경고 기준(0~1 비율). 비어 있으면 경고 기준 없음 */
export function readinessWarnErrors(value: unknown): string[] {
  if (!isObj(value)) return ["값: { \"columnShareMax\": 0~1 비율 } 객체여야 합니다 (비우려면 {})"];
  const errors: string[] = [];
  for (const k of Object.keys(value)) if (k !== "columnShareMax") errors.push(`${k}: 모르는 칸입니다 — columnShareMax만 있습니다`);
  if (value.columnShareMax !== undefined && !(typeof value.columnShareMax === "number" && value.columnShareMax >= 0 && value.columnShareMax <= 1)) {
    errors.push("columnShareMax: 0 이상 1 이하의 숫자여야 합니다 (예: 0.3 = 30%)");
  }
  return errors;
}

export function readColumnShareMax(value: unknown): number | null {
  return readinessWarnErrors(value).length === 0 && isObj(value) && typeof value.columnShareMax === "number" ? value.columnShareMax : null;
}

export interface NextIntake {
  label: string | null;
  targetMonth: string | null;
}

/** 다음 접수 목표 문구에 쓰면 안 되는 보장 표현 (NAV-16 — '선정 예정'·'제휴 확정' 같은 문구 0) */
const GUARANTEE_WORDS = ["선정 예정", "제휴 확정", "합격 예정", "선정 확정"] as const;

/** 설정 news_next_intake — { label?: 공고 이름, target_month?: 'YYYY-MM' }. 비어 있으면 '목표 접수 미정' */
export function nextIntakeErrors(value: unknown): string[] {
  if (!isObj(value)) return ["값: { \"label\": \"공고 이름\", \"target_month\": \"YYYY-MM\" } 객체여야 합니다 (비우려면 {})"];
  const errors: string[] = [];
  for (const k of Object.keys(value)) if (k !== "label" && k !== "target_month") errors.push(`${k}: 모르는 칸입니다 — label·target_month만 있습니다`);
  if (value.label !== undefined) {
    if (typeof value.label !== "string" || value.label.trim() === "" || [...value.label].length > 100) errors.push("label: 1~100자 글이어야 합니다");
    else if (GUARANTEE_WORDS.some((w) => (value.label as string).includes(w))) errors.push(`label: ‘${GUARANTEE_WORDS.join("’·‘")}’ 같은 보장 표현은 쓸 수 없습니다 — 선정은 외부 결정입니다`);
  }
  if (value.target_month !== undefined && !(typeof value.target_month === "string" && isMonth(value.target_month))) errors.push("target_month: YYYY-MM 모양이어야 합니다");
  return errors;
}

export function readNextIntake(value: unknown): NextIntake | null {
  if (nextIntakeErrors(value).length > 0 || !isObj(value)) return null;
  const label = typeof value.label === "string" ? value.label.trim() : null;
  const targetMonth = typeof value.target_month === "string" ? value.target_month : null;
  return label === null && targetMonth === null ? null : { label, targetMonth };
}
