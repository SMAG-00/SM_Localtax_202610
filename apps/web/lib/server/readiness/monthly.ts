import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDate } from "@/lib/analytics/metrics";
import {
  columnShareExceeded,
  lastClosedMonth,
  lowestCombos,
  monthWindowOf,
  monthlyMetrics,
  penaltyReached,
  penaltyTotal,
  readColumnShareMax,
  readMergeExternal,
  readNextIntake,
  readPenaltyRule,
  readSimilarityRule,
  recentClosedMonths,
  threeMonthCombos,
  zeroMetrics,
  METRIC_LABELS,
  type ComboResult,
  type LowestCombo,
  type MonthMetrics,
  type NextIntake,
  type PenaltyRule,
} from "@/lib/readiness/monthly";
import { decodeFacts } from "@/lib/readiness/production";
import { PLATFORMS, platformState, type Platform, type RequirementRow } from "@/lib/readiness/requirements";
import { listRequirementRows } from "./requirements";

// 제휴 준비 월 마감·조합·부정평가 (W7 · NAV-16~20, docs/dev/W7_설계.md 1장 5단계) — 세는 규칙은 lib/readiness/monthly.ts(순수).
//  · service_role로만 읽고 쓴다. 마감 행은 바꾸지 않는다 — 재계산은 사유와 함께 새 version 행(DB 트리거가 수정·삭제를 막는다)
//  · 규정 버전이 확정되지 않았으면 platform=internal 행만 만든다(내부 정의 지표). 확정된 플랫폼은 같은 지표를 규정 버전과 함께 한 번 더 남긴다
//  · 숫자 기준은 코드에 없다 — 규정 판단 값(news_partner_requirement_rules)과 설정(readiness_warn · news_next_intake)에서만 읽는다

const fail = (what: string, error: { code?: string } | null | undefined) => new Error(`${what} 실패 (${error?.code ?? "응답 없음"})`);
const CLOSE_MONTHS = 12;

export interface ActiveRules {
  platform: Platform;
  requirementId: number;
  version: number;
  similarity: ReturnType<typeof readSimilarityRule>;
  penalty: PenaltyRule | null;
  mergeExternal: boolean;
}

/** 오늘 적용되는 확정 규정 버전(플랫폼 순서: 네이버 → 카카오)의 판단 값. 없으면 빈 목록 */
export async function loadActiveRules(db: SupabaseClient, today: string): Promise<ActiveRules[]> {
  const requirements = await listRequirementRows(db);
  const confirmed: { platform: Platform; row: RequirementRow }[] = [];
  for (const platform of PLATFORMS) {
    const state = platformState(requirements, platform, today);
    if (state.kind === "confirmed") confirmed.push({ platform, row: state.row });
  }
  if (confirmed.length === 0) return [];
  const { data, error } = await db
    .from("news_partner_requirement_rules")
    .select("requirement_id, similarity_rule, penalty_rule, contributor_rule")
    .in(
      "requirement_id",
      confirmed.map((c) => c.row.id),
    );
  if (error) throw fail("규정 판단 값 읽기", error);
  const byId = new Map((data ?? []).map((r: { requirement_id: number; similarity_rule: unknown; penalty_rule: unknown; contributor_rule: unknown }) => [Number(r.requirement_id), r]));
  return confirmed.map(({ platform, row }) => {
    const rules = byId.get(Number(row.id));
    return {
      platform,
      requirementId: Number(row.id),
      version: row.version,
      similarity: readSimilarityRule(rules?.similarity_rule, `${platform} 규정 v${row.version}`),
      penalty: readPenaltyRule(rules?.penalty_rule),
      mergeExternal: readMergeExternal(rules?.contributor_rule),
    };
  });
}

async function loadSettings(db: SupabaseClient): Promise<{ columnShareMax: number | null; intake: NextIntake | null }> {
  const { data, error } = await db.from("settings").select("key, value").in("key", ["readiness_warn", "news_next_intake"]);
  if (error) throw fail("제휴 준비 설정 읽기", error);
  const byKey = new Map((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  return { columnShareMax: readColumnShareMax(byKey.get("readiness_warn")), intake: readNextIntake(byKey.get("news_next_intake")) };
}

async function loadMonthFacts(db: SupabaseClient, months: readonly string[]) {
  const from = monthWindowOf(months[0]!).start;
  const to = monthWindowOf(months.at(-1)!).end;
  const { data, error } = await db.rpc("news_production_facts", { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
  if (error) throw fail("기사 생산 읽기", error);
  return decodeFacts(data);
}

interface MonthlyRow {
  month: string;
  platform: string;
  requirement_id: number | null;
  version: number;
  metrics: MonthMetrics;
  computed_at: string;
}

/** 월 마감 — 직전 12개월 가운데 행이 없는 달을 채운다(멱등). 가장 최근 완결 달에는 경고 알림도 낸다 */
export async function closeReadinessMonths(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const t = now.getTime();
  const today = kstDate(t);
  const months = recentClosedMonths(t, CLOSE_MONTHS);
  const rules = await loadActiveRules(db, today);
  const mergeExternal = rules.some((r) => r.mergeExternal);
  const { data: existing, error } = await db.from("partner_readiness_monthly").select("month, platform, requirement_id").in(
    "month",
    months.map((m) => `${m}-01`),
  );
  if (error) throw fail("월 마감 행 읽기", error);
  const have = new Set((existing ?? []).map((r: { month: string; platform: string; requirement_id: number | null }) => `${r.month.slice(0, 7)}|${r.platform}|${r.requirement_id ?? 0}`));
  const targets: { platform: "internal" | Platform; requirementId: number | null; version: number | null }[] = [
    { platform: "internal", requirementId: null, version: null },
    ...rules.map((r) => ({ platform: r.platform, requirementId: r.requirementId, version: r.version })),
  ];
  const missing = months.flatMap((m) => targets.filter((x) => !have.has(`${m}|${x.platform}|${x.requirementId ?? 0}`)).map((x) => ({ month: m, ...x })));
  let created = 0;
  if (missing.length > 0) {
    const facts = await loadMonthFacts(db, months);
    for (const row of missing) {
      const metrics = monthlyMetrics(facts, monthWindowOf(row.month), { mergeExternal });
      const { error: insertError } = await db.from("partner_readiness_monthly").insert({
        month: `${row.month}-01`,
        platform: row.platform,
        requirement_id: row.requirementId,
        requirement_version: row.version,
        metrics,
      });
      if (insertError?.code === "23505") continue; // 겹친 실행이 먼저 넣었다
      if (insertError) throw fail("월 마감 행 저장", insertError);
      created += 1;
    }
  }
  const alerts = await raiseAlerts(db, lastClosedMonth(t), today, rules);
  return { status: "ok", months: months.length, created, alerts };
}

async function raiseAlerts(db: SupabaseClient, month: string, today: string, rules: ActiveRules[]): Promise<number> {
  const { data: row, error } = await db
    .from("partner_readiness_monthly")
    .select("metrics, version")
    .eq("month", `${month}-01`)
    .eq("platform", "internal")
    .order("version", { ascending: false })
    .limit(1);
  if (error) throw fail("월 지표 읽기", error);
  const metrics = (row?.[0] as { metrics: MonthMetrics } | undefined)?.metrics;
  const { columnShareMax } = await loadSettings(db);
  const alerts: { kind: string; month: string; key: string; detail: string }[] = [];
  if (metrics) {
    for (const key of zeroMetrics(metrics)) alerts.push({ kind: "zero_metric", month: `${month}-01`, key, detail: `${month} ${METRIC_LABELS[key]}이(가) 0입니다 — 규정상 하나라도 0점이면 탈락일 수 있어 확인이 필요합니다` });
    if (columnShareExceeded(metrics, columnShareMax)) alerts.push({ kind: "column_share", month: `${month}-01`, key: "column_share", detail: `${month} 칼럼 비중이 설정 기준(readiness_warn)을 넘었습니다` });
  }
  const penalty = rules.find((r) => r.penalty);
  if (penalty?.penalty) {
    const records = await loadPenaltyRecords(db);
    const total = penaltyTotal(records, today, penalty.penalty.window_months);
    if (penaltyReached(total, penalty.penalty)) {
      alerts.push({ kind: "penalty", month: `${month}-01`, key: `requirement:${penalty.requirementId}`, detail: `부정평가 위험 누적이 ${total}점으로 규정 버전의 경고 기준에 이르렀습니다 (최근 ${penalty.penalty.window_months}개월)` });
    }
  }
  if (alerts.length === 0) return 0;
  const { data, error: insertError } = await db.from("partner_readiness_alerts").upsert(alerts, { onConflict: "kind,month,key", ignoreDuplicates: true }).select("id");
  if (insertError) throw fail("경고 알림 저장", insertError);
  return data?.length ?? 0;
}

/** 부정평가 위험 기록 — 정정(supersedes)으로 대체된 기록은 뺀다 */
export async function loadPenaltyRecords(db: SupabaseClient) {
  const { data, error } = await db.from("news_partner_checks").select("id, item, points, occurred_at, supersedes_id, checked_by, checked_at").eq("kind", "penalty_risk").order("occurred_at", { ascending: false }).limit(500);
  if (error) throw fail("부정평가 기록 읽기", error);
  const rows = (data ?? []) as { id: number; item: string; points: number | null; occurred_at: string | null; supersedes_id: number | null; checked_by: string; checked_at: string }[];
  const superseded = new Set(rows.flatMap((r) => (r.supersedes_id === null ? [] : [Number(r.supersedes_id)])));
  return rows
    .filter((r) => !superseded.has(Number(r.id)) && r.points !== null && r.occurred_at !== null)
    .map((r) => ({ id: Number(r.id), item: r.item, points: Number(r.points), occurredOn: kstDate(Date.parse(r.occurred_at!)), checkedBy: r.checked_by, checkedAt: r.checked_at }));
}

/** 재계산 — 사유와 함께 새 version 행(마감 행은 그대로) */
export async function recalculateMonth(db: SupabaseClient, month: string, reason: string, now: Date): Promise<{ created: number }> {
  const t = now.getTime();
  const rules = await loadActiveRules(db, kstDate(t));
  const mergeExternal = rules.some((r) => r.mergeExternal);
  const facts = await loadMonthFacts(db, [month]);
  const metrics = monthlyMetrics(facts, monthWindowOf(month), { mergeExternal });
  const targets: { platform: "internal" | Platform; requirementId: number | null; version: number | null }[] = [
    { platform: "internal", requirementId: null, version: null },
    ...rules.map((r) => ({ platform: r.platform, requirementId: r.requirementId, version: r.version })),
  ];
  let created = 0;
  for (const target of targets) {
    let q = db.from("partner_readiness_monthly").select("version").eq("month", `${month}-01`).eq("platform", target.platform).order("version", { ascending: false }).limit(1);
    q = target.requirementId === null ? q.is("requirement_id", null) : q.eq("requirement_id", target.requirementId);
    const { data, error } = await q;
    if (error) throw fail("월 마감 행 읽기", error);
    const latest = (data?.[0] as { version: number } | undefined)?.version;
    if (latest === undefined) continue; // 마감된 적 없는 달은 재계산이 아니라 월 마감이 만든다
    const { error: insertError } = await db.from("partner_readiness_monthly").insert({
      month: `${month}-01`,
      platform: target.platform,
      requirement_id: target.requirementId,
      requirement_version: target.version,
      version: latest + 1,
      metrics,
      recompute_reason: reason,
    });
    if (insertError) throw fail("재계산 행 저장", insertError);
    created += 1;
  }
  return { created };
}

export interface MonthlyReadiness {
  /** 'YYYY-MM' → 최신 version의 내부 지표 */
  months: { month: string; version: number; computedAt: string; metrics: MonthMetrics }[];
  combos: { kind: "insufficient"; months: number } | { kind: "ok"; count: number; lowest: LowestCombo[]; byCombo?: ComboResult[] };
  /** 규정 버전이 확정되지 않았으면 true — 내부 정의 지표만 보인다 */
  requirementUnconfirmed: boolean;
  alerts: { id: number; kind: string; month: string; detail: string; acknowledged: boolean }[];
  penalty: {
    rule: PenaltyRule | null;
    total: number | null;
    reached: boolean;
    asOf: string;
    records: { id: number; item: string; points: number; occurredOn: string; checkedBy: string }[];
  };
  intake: NextIntake | null;
  columnShareMax: number | null;
}

export async function loadMonthlyReadiness(db: SupabaseClient, now: Date): Promise<MonthlyReadiness> {
  const t = now.getTime();
  const today = kstDate(t);
  const months = recentClosedMonths(t, CLOSE_MONTHS);
  const [rules, settings, penaltyRecords] = await Promise.all([loadActiveRules(db, today), loadSettings(db), loadPenaltyRecords(db)]);
  const { data, error } = await db
    .from("partner_readiness_monthly")
    .select("month, platform, requirement_id, version, metrics, computed_at")
    .eq("platform", "internal")
    .in(
      "month",
      months.map((m) => `${m}-01`),
    )
    .order("version", { ascending: false });
  if (error) throw fail("월 마감 행 읽기", error);
  const latest = new Map<string, MonthlyRow>();
  for (const r of (data ?? []) as MonthlyRow[]) if (!latest.has(r.month)) latest.set(r.month, r);
  const rows = [...latest.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).map((r) => ({ month: r.month.slice(0, 7), version: r.version, computedAt: r.computed_at, metrics: r.metrics }));
  const combos = threeMonthCombos(rows.map((r) => ({ month: r.month, metrics: r.metrics })));
  const { data: alertRows, error: alertError } = await db.from("partner_readiness_alerts").select("id, kind, month, detail, acknowledged_at").order("created_at", { ascending: false }).limit(50);
  if (alertError) throw fail("경고 알림 읽기", alertError);
  const penaltyRule = rules.find((r) => r.penalty)?.penalty ?? null;
  const total = penaltyRule ? penaltyTotal(penaltyRecords, today, penaltyRule.window_months) : null;
  return {
    months: rows,
    combos: combos.kind === "insufficient" ? combos : { kind: "ok", count: combos.combos.length, lowest: lowestCombos(combos.combos) },
    requirementUnconfirmed: rules.length === 0,
    alerts: ((alertRows ?? []) as { id: number; kind: string; month: string; detail: string; acknowledged_at: string | null }[]).map((a) => ({
      id: Number(a.id),
      kind: a.kind,
      month: a.month.slice(0, 7),
      detail: a.detail,
      acknowledged: a.acknowledged_at !== null,
    })),
    penalty: {
      rule: penaltyRule,
      total,
      reached: penaltyRule !== null && total !== null && penaltyReached(total, penaltyRule),
      asOf: today,
      records: penaltyRecords.map((r) => ({ id: r.id, item: r.item, points: r.points, occurredOn: r.occurredOn, checkedBy: r.checkedBy })),
    },
    intake: settings.intake,
    columnShareMax: settings.columnShareMax,
  };
}

export interface RecordsBoard {
  monthly: MonthlyReadiness;
  requirements: { id: number; platform: string; version: number; title: string; status: string; rules: { similarity_rule: unknown; penalty_rule: unknown; contributor_rule: unknown } | null }[];
}

/** 제휴 준비 기록 화면·API가 읽는 한 벌 - 월 마감·조합·알림·부정평가 + 규정 버전별 판단 값 */
export async function loadRecordsBoard(db: SupabaseClient, now: Date): Promise<RecordsBoard> {
  const [monthly, requirements, rules] = await Promise.all([
    loadMonthlyReadiness(db, now),
    listRequirementRows(db),
    db.from("news_partner_requirement_rules").select("requirement_id, similarity_rule, penalty_rule, contributor_rule"),
  ]);
  if (rules.error) throw fail("규정 판단 값 읽기", rules.error);
  const byId = new Map((rules.data ?? []).map((r: { requirement_id: number; similarity_rule: unknown; penalty_rule: unknown; contributor_rule: unknown }) => [Number(r.requirement_id), r]));
  return {
    monthly,
    requirements: requirements.map((r) => {
      const found = byId.get(Number(r.id));
      return { id: Number(r.id), platform: r.platform, version: r.version, title: r.title, status: r.status, rules: found ? { similarity_rule: found.similarity_rule, penalty_rule: found.penalty_rule, contributor_rule: found.contributor_rule } : null };
    }),
  };
}
